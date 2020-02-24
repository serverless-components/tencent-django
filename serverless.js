const ensureIterable = require('type/iterable/ensure')
const ensurePlainObject = require('type/plain-object/ensure')
const ensureString = require('type/string/ensure')
const random = require('ext/string/random')
const path = require('path')
const { Component } = require('@serverless/core')
const fs = require('fs')

const DEFAULTS = {
  handler: 'index.main_handler',
  runtime: 'Python3.6',
  exclude: ['.git/**', '.gitignore', '.DS_Store']
}

class TencentDjango extends Component {
  getDefaultProtocol(protocols) {
    if (protocols.map((i) => i.toLowerCase()).includes('https')) {
      return 'https'
    }
    return 'http'
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

  async prepareInputs(inputs = {}) {
    inputs.name =
      ensureString(inputs.functionName, { isOptional: true }) ||
      this.state.functionName ||
      `DjangoComponent_${random({ length: 6 })}`
    inputs.codeUri = ensureString(inputs.code, { isOptional: true }) || process.cwd()
    inputs.region = ensureString(inputs.region, { default: 'ap-guangzhou' })
    inputs.include = ensureIterable(inputs.include, { default: [], ensureItem: ensureString })
    inputs.exclude = ensureIterable(inputs.exclude, { default: [], ensureItem: ensureString })
    inputs.apigatewayConf = ensurePlainObject(inputs.apigatewayConf, { default: {} })

    const src = path.join(__dirname, 'component')
    const dst = path.join(inputs.codeUri, '.cache')
    await this.copyDir(src, dst)
    const indexPyFile = await fs.readFileSync(
      path.join(path.resolve(inputs.codeUri), '.cache', 'index.py'),
      'utf8'
    )
    const replacedFile = indexPyFile.replace(
      eval('/{{django_project}}/g'),
      inputs.djangoProjectName
    )
    await fs.writeFileSync(
      path.join(path.resolve(inputs.codeUri), '.cache', 'index.py'),
      replacedFile
    )

    inputs.include = [path.join(inputs.codeUri, '.cache')]
    inputs.exclude.push('.git/**', '.gitignore', '.serverless', '.DS_Store')

    inputs.handler = ensureString(inputs.handler, { default: DEFAULTS.handler })
    inputs.runtime = ensureString(inputs.runtime, { default: DEFAULTS.runtime })
    inputs.apigatewayConf = ensurePlainObject(inputs.apigatewayConf, { default: {} })

    if (inputs.functionConf) {
      inputs.timeout = inputs.functionConf.timeout ? inputs.functionConf.timeout : 3
      inputs.memorySize = inputs.functionConf.memorySize ? inputs.functionConf.memorySize : 128
      if (inputs.functionConf.environment) {
        inputs.environment = inputs.functionConf.environment
      }
      if (inputs.functionConf.vpcConfig) {
        inputs.vpcConfig = inputs.functionConf.vpcConfig
      }
    }

    return inputs
  }

  async default(inputs = {}) {
    if (!inputs.djangoProjectName) {
      throw new Error(`'djangoProjectName' is required in serverless.yaml`)
    }
    inputs = await this.prepareInputs(inputs)

    const tencentCloudFunction = await this.load('@serverless/tencent-scf')
    const tencentApiGateway = await this.load('@serverless/tencent-apigateway')

    inputs.fromClientRemark = inputs.fromClientRemark || 'tencent-django'
    const tencentCloudFunctionOutputs = await tencentCloudFunction(inputs)
    const apigwParam = {
      serviceName: inputs.serviceName,
      description: 'Serverless Framework Tencent-Django Component',
      serviceId: inputs.serviceId,
      region: inputs.region,
      protocols: inputs.apigatewayConf.protocols || ['http'],
      environment:
        inputs.apigatewayConf && inputs.apigatewayConf.environment
          ? inputs.apigatewayConf.environment
          : 'release',
      endpoints: [
        {
          path: '/',
          method: 'ANY',
          function: {
            isIntegratedResponse: true,
            functionName: tencentCloudFunctionOutputs.Name
          }
        }
      ]
    }

    if (inputs.apigatewayConf && inputs.apigatewayConf.auth) {
      apigwParam.endpoints[0].usagePlan = inputs.apigatewayConf.usagePlan
    }
    if (inputs.apigatewayConf && inputs.apigatewayConf.auth) {
      apigwParam.endpoints[0].auth = inputs.apigatewayConf.auth
    }

    apigwParam.fromClientRemark = inputs.fromClientRemark || 'tencent-django'
    const tencentApiGatewayOutputs = await tencentApiGateway(apigwParam)
    const outputs = {
      region: inputs.region,
      functionName: inputs.name,
      apiGatewayServiceId: tencentApiGatewayOutputs.serviceId,
      url: `${this.getDefaultProtocol(tencentApiGatewayOutputs.protocols)}://${
        tencentApiGatewayOutputs.subDomain
      }/${tencentApiGatewayOutputs.environment}/`
    }

    this.state = outputs

    await this.save()

    return outputs
  }

  async remove(inputs = {}) {
    const removeInput = {
      fromClientRemark: inputs.fromClientRemark || 'tencent-django'
    }
    const tencentCloudFunction = await this.load('@serverless/tencent-scf')
    const tencentApiGateway = await this.load('@serverless/tencent-apigateway')

    await tencentCloudFunction.remove(removeInput)
    await tencentApiGateway.remove(removeInput)

    return {}
  }
}

module.exports = TencentDjango
