const { Component } = require('@serverless/core')
const fs = require('fs')
const path = require('path')
const { MultiApigw, Scf, Apigw, Cos, Cns } = require('tencent-component-toolkit')
const { TypeError } = require('tencent-component-toolkit/src/utils/error')
const { packageCode, getDefaultProtocol, deleteRecord, prepareInputs } = require('./utils')
const ensureIterable = require('type/iterable/ensure')
const download = require('download')
const CONFIGS = require('./config')

class Django extends Component {
  getCredentials() {
    const { tmpSecrets } = this.credentials.tencent

    if (!tmpSecrets || !tmpSecrets.TmpSecretId) {
      throw new TypeError(
        'CREDENTIAL',
        'Cannot get secretId/Key, your account could be sub-account and does not have the access to use SLS_QcsRole, please make sure the role exists first, then visit https://cloud.tencent.com/document/product/1154/43006, follow the instructions to bind the role to your account.'
      )
    }

    return {
      SecretId: tmpSecrets.TmpSecretId,
      SecretKey: tmpSecrets.TmpSecretKey,
      Token: tmpSecrets.Token
    }
  }

  async copyDir(src, dst) {
    const paths = await fs.readdirSync(src)
    if (!fs.existsSync(dst)) {
      await fs.mkdirSync(dst)
    }
    for (let i = 0; i < paths.length; i++) {
      const thisFileStat = await fs.statSync(path.join(src, paths[i]))
      if (thisFileStat.isFile()) {
        const readable = await fs.readFileSync(path.join(src, paths[i]))
        await fs.writeFileSync(path.join(dst, paths[i]), readable)
      } else {
        if (!fs.existsSync(path.join(dst, paths[i]))) {
          await fs.mkdirSync(path.join(dst, paths[i]))
        }
        await this.copyDir(path.join(src, paths[i]), path.join(dst, paths[i]))
      }
    }
  }

  async uploadCodeToCos(credentials, inputs, region, filePath) {
    const { appId } = this.credentials.tencent.tmpSecrets
    // 创建cos对象
    const cos = new Cos(credentials, region)
    // 创建存储桶 + 设置生命周期
    if (!inputs.code.bucket) {
      inputs.code.bucket = `sls-cloudfunction-${region}-code`
      await cos.deploy({
        bucket: inputs.code.bucket + '-' + appId,
        force: true,
        lifecycle: [
          {
            status: 'Enabled',
            id: 'deleteObject',
            filter: '',
            expiration: { days: '10' },
            abortIncompleteMultipartUpload: { daysAfterInitiation: '10' }
          }
        ]
      })
    }

    // 上传代码
    if (!inputs.code.object) {
      const object = `${inputs.name}-${Math.floor(Date.now() / 1000)}.zip`
      inputs.code.object = object
      await cos.upload({
        bucket: inputs.code.bucket + '-' + appId,
        file: filePath,
        key: inputs.code.object
      })
    }
    this.state.bucket = inputs.code.bucket
    this.state.object = inputs.code.object

    return {
      bucket: inputs.code.bucket,
      object: inputs.code.object
    }
  }

  async deployFunction(credentials, inputs, regionList, outputs, sourceDirectory) {
    // if set bucket and object not pack code
    let packageDir
    if (!inputs.code.bucket || !inputs.code.object) {
      packageDir = await packageCode(this, sourceDirectory)
    }

    // 上传代码到COS
    const uploadCodeHandler = []

    for (let eveRegionIndex = 0; eveRegionIndex < regionList.length; eveRegionIndex++) {
      const curRegion = regionList[eveRegionIndex]
      const funcDeployer = async () => {
        const code = await this.uploadCodeToCos(credentials, inputs, curRegion, packageDir)
        const scf = new Scf(credentials, curRegion)
        const tempInputs = {
          ...inputs,
          code
        }
        const scfOutput = await scf.deploy(tempInputs)
        outputs[curRegion] = {
          functionName: scfOutput.FunctionName,
          runtime: scfOutput.Runtime,
          namespace: scfOutput.Namespace
        }

        this.state[curRegion] = {
          ...(this.state[curRegion] ? this.state[curRegion] : {}),
          ...outputs[curRegion]
        }
      }
      uploadCodeHandler.push(funcDeployer())
    }
    await Promise.all(uploadCodeHandler)
    this.save()
    return outputs
  }

  async deployApigateway(credentials, inputs, regionList) {
    const apigw = new MultiApigw(credentials, regionList)
    inputs.oldState = {
      apiList: (this.state[regionList[0]] && this.state[regionList[0]].apiList) || []
    }
    const apigwOutputs = await apigw.deploy(inputs)
    const outputs = {}
    Object.keys(apigwOutputs).forEach((curRegion) => {
      const curOutput = apigwOutputs[curRegion]
      outputs[curRegion] = {
        serviceId: curOutput.serviceId,
        subDomain: curOutput.subDomain,
        environment: curOutput.environment,
        url: `${getDefaultProtocol(inputs.protocols)}://${curOutput.subDomain}/${
          curOutput.environment
        }/`
      }
      if (curOutput.customDomains) {
        outputs[curRegion].customDomains = curOutput.customDomains
      }
      this.state[curRegion] = {
        created: curOutput.created,
        ...(this.state[curRegion] ? this.state[curRegion] : {}),
        ...outputs[curRegion],
        apiList: curOutput.apiList
      }
    })
    this.save()
    return outputs
  }

  async deployCns(credentials, inputs, regionList, apigwOutputs) {
    const cns = new Cns(credentials)
    const cnsRegion = {}
    regionList.forEach((curRegion) => {
      const curApigwOutput = apigwOutputs[curRegion]
      cnsRegion[curRegion] = curApigwOutput.subDomain
    })

    const state = []
    const outputs = {}
    const tempJson = {}
    for (let i = 0; i < inputs.length; i++) {
      const curCns = inputs[i]
      for (let j = 0; j < curCns.records.length; j++) {
        curCns.records[j].value =
          cnsRegion[curCns.records[j].value.replace('temp_value_about_', '')]
      }
      const tencentCnsOutputs = await cns.deploy(curCns)
      outputs[curCns.domain] = tencentCnsOutputs.DNS
        ? tencentCnsOutputs.DNS
        : 'The domain name has already been added.'
      tencentCnsOutputs.domain = curCns.domain
      state.push(tencentCnsOutputs)
    }

    // 删除serverless创建的但是不在本次列表中
    try {
      for (let i = 0; i < state.length; i++) {
        tempJson[state[i].domain] = state[i].records
      }
      const recordHistory = this.state.cns || []
      for (let i = 0; i < recordHistory.length; i++) {
        const delList = deleteRecord(tempJson[recordHistory[i].domain], recordHistory[i].records)
        if (delList && delList.length > 0) {
          await cns.remove({ deleteList: delList })
        }
      }
    } catch (e) {}

    this.state['cns'] = state
    this.save()
    return outputs
  }

  async deploy(inputs) {
    console.log(`Deploying Django App...`)

    const credentials = this.getCredentials()


    // 标准化之前对Django组件的特殊逻辑

    const tempPath =  typeof inputs.src === 'object'
      ? inputs.src
      : {
        src: inputs.src
      }

    // unzip source zip file
    console.log(`Unzipping ${tempPath.src || 'files'}...`)
    const sourceDirectory = await this.unzip(tempPath.src)
    console.log(`Files unzipped into ${sourceDirectory}...`)

    if (!inputs.djangoProjectName) {
      throw new TypeError('PARAMETER_DJANGO_DEPLOY', `'djangoProjectName' is required in serverless.yaml`)
    }
    const src = path.join(__dirname, 'component')
    await this.copyDir(src, sourceDirectory)
    const indexPyFile = await fs.readFileSync(
      path.join(path.resolve(sourceDirectory), 'index.py'),
      'utf8'
    )
    const replacedFile = indexPyFile.replace(
      eval('/{{django_project}}/g'),
      inputs.djangoProjectName
    )
    await fs.writeFileSync(path.join(path.resolve(sourceDirectory), 'index.py'), replacedFile)

    // 将中间层复制到项目代码中
    inputs.include = ensureIterable(inputs.include, { default: [] })
    inputs.include.push(sourceDirectory)


    // 对Inputs内容进行标准化
    const { regionList, functionConf, apigatewayConf, cnsConf } = await prepareInputs(
      this,
      credentials,
      inputs
    )

    console.log("functionConf: ", functionConf)

    // 部署函数 + API网关
    const outputs = {}
    const [apigwOutputs, functionOutputs] = await Promise.all([
      this.deployApigateway(credentials, apigatewayConf, regionList, outputs),
      this.deployFunction(credentials, functionConf, regionList, outputs, sourceDirectory)
    ])

    // optimize outputs for one region
    if (regionList.length === 1) {
      const [oneRegion] = regionList
      outputs.region = oneRegion
      outputs['apigw'] = apigwOutputs[oneRegion]
      outputs['scf'] = functionOutputs[oneRegion]
    } else {
      outputs['apigw'] = apigwOutputs
      outputs['scf'] = functionOutputs
    }

    // 云解析遇到等API网关部署完成才可以继续部署
    if (cnsConf.length > 0) {
      outputs['cns'] = await this.deployCns(credentials, cnsConf, regionList, apigwOutputs)
    }

    this.state.region = regionList[0]
    this.state.regionList = regionList
    this.state.lambdaArn = functionConf.name

    return outputs
  }

  async remove() {
    console.log(`Removing Django App...`)

    const { state } = this
    const { regionList = [] } = state

    const credentials = this.getCredentials()

    const removeHandlers = []
    for (let i = 0; i < regionList.length; i++) {
      const curRegion = regionList[i]
      const curState = state[curRegion]
      const scf = new Scf(credentials, curRegion)
      const apigw = new Apigw(credentials, curRegion)
      const handler = async () => {
        await scf.remove({
          functionName: curState.functionName,
          namespace: curState.namespace
        })
        await apigw.remove({
          created: curState.created,
          environment: curState.environment,
          serviceId: curState.serviceId,
          apiList: curState.apiList,
          customDomains: curState.customDomains
        })
      }
      removeHandlers.push(handler())
    }

    await Promise.all(removeHandlers)

    if (this.state.cns) {
      const cns = new Cns(credentials)
      for (let i = 0; i < this.state.cns.length; i++) {
        await cns.remove({ deleteList: this.state.cns[i].records })
      }
    }

    this.state = {}
  }
}

module.exports = Django
