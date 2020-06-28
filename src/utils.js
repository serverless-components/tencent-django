const { Domain } = require('tencent-component-toolkit')
const ensureObject = require('type/object/ensure')
const ensureIterable = require('type/iterable/ensure')
const ensureString = require('type/string/ensure')
const CONFIGS = require('./config')

/*
 * Pauses execution for the provided miliseconds
 *
 * @param ${number} wait - number of miliseconds to wait
 */
const sleep = async (wait) => new Promise((resolve) => setTimeout(() => resolve(), wait))

/*
 * Generates a random id
 */
const generateId = () =>
  Math.random()
    .toString(36)
    .substring(6)
/*
 * Packages framework app and injects shims and sdk
 *
 * @param ${instance} instance - the component instance
 * @param ${object} config - the component config
 */
const packageCode = async (instance, sourceDirectory) => {
  // zip the source directory with the shim and the sdk
  console.log(`Packaging ${CONFIGS.frameworkFullname} application...`)
  console.log(`Zipping files...`)
  console.log(sourceDirectory)
  const zipPath = await instance.zip(String(sourceDirectory))
  console.log(`Files zipped into ${zipPath}...`)

  // save the zip path to state for lambda to use it
  instance.state.zipPath = zipPath

  return zipPath
}

const mergeJson = (sourceJson, targetJson) => {
  for (const eveKey in sourceJson) {
    if (targetJson.hasOwnProperty(eveKey)) {
      if (['protocols', 'endpoints', 'customDomain'].indexOf(eveKey) != -1) {
        for (let i = 0; i < sourceJson[eveKey].length; i++) {
          const sourceEvents = JSON.stringify(sourceJson[eveKey][i])
          const targetEvents = JSON.stringify(targetJson[eveKey])
          if (targetEvents.indexOf(sourceEvents) == -1) {
            targetJson[eveKey].push(sourceJson[eveKey][i])
          }
        }
      } else {
        if (typeof sourceJson[eveKey] != 'string') {
          mergeJson(sourceJson[eveKey], targetJson[eveKey])
        } else {
          targetJson[eveKey] = sourceJson[eveKey]
        }
      }
    } else {
      targetJson[eveKey] = sourceJson[eveKey]
    }
  }
  return targetJson
}

const capitalString = (str) => {
  if (str.length < 2) {
    return str.toUpperCase()
  }

  return `${str[0].toUpperCase()}${str.slice(1)}`
}

const getDefaultProtocol = (protocols) => {
  if (protocols.map((i) => i.toLowerCase()).includes('https')) {
    return 'https'
  }
  return 'http'
}

const deleteRecord = (newRecords, historyRcords) => {
  const deleteList = []
  for (let i = 0; i < historyRcords.length; i++) {
    let temp = false
    for (let j = 0; j < newRecords.length; j++) {
      if (
        newRecords[j].domain == historyRcords[i].domain &&
        newRecords[j].subDomain == historyRcords[i].subDomain &&
        newRecords[j].recordType == historyRcords[i].recordType &&
        newRecords[j].value == historyRcords[i].value &&
        newRecords[j].recordLine == historyRcords[i].recordLine
      ) {
        temp = true
        break
      }
    }
    if (!temp) {
      deleteList.push(historyRcords[i])
    }
  }
  return deleteList
}

const prepareInputs = async (instance, credentials, inputs = {}) => {
  // 对function inputs进行标准化
  const tempFunctionConf = inputs.functionConf ? inputs.functionConf : {}
  const fromClientRemark = `tencent-${CONFIGS.framework}`
  const regionList = inputs.region
    ? typeof inputs.region == 'string'
      ? [inputs.region]
      : inputs.region
    : ['ap-guangzhou']

  // chenck state function name
  const stateFunctionName =
    instance.state[regionList[0]] && instance.state[regionList[0]].functionName
  // check state service id
  const stateServiceId = instance.state[regionList[0]] && instance.state[regionList[0]].serviceId

  const functionConf = {
    code:
      typeof inputs.srcOriginal === 'object'
        ? inputs.srcOriginal
        : {
            src: inputs.src
          },
    name:
      ensureString(inputs.functionName, { isOptional: true }) ||
      stateFunctionName ||
      `${CONFIGS.framework}_component_${generateId()}`,
    region: regionList,
    handler: ensureString(tempFunctionConf.handler ? tempFunctionConf.handler : inputs.handler, {
      default: CONFIGS.handler
    }),
    runtime: ensureString(tempFunctionConf.runtime ? tempFunctionConf.runtime : inputs.runtime, {
      default: CONFIGS.runtime
    }),
    namespace: ensureString(
      tempFunctionConf.namespace ? tempFunctionConf.namespace : inputs.namespace,
      { default: CONFIGS.namespace }
    ),
    description: ensureString(
      tempFunctionConf.description ? tempFunctionConf.description : inputs.description,
      {
        default: CONFIGS.description
      }
    ),
    fromClientRemark
  }
  functionConf.tags = ensureObject(tempFunctionConf.tags ? tempFunctionConf.tags : inputs.tag, {
    default: null
  })

  functionConf.include = ensureIterable(
    tempFunctionConf.include ? tempFunctionConf.include : inputs.include,
    { default: [], ensureItem: ensureString }
  )
  functionConf.exclude = ensureIterable(
    tempFunctionConf.exclude ? tempFunctionConf.exclude : inputs.exclude,
    { default: [], ensureItem: ensureString }
  )
  functionConf.exclude.push('.git/**', '.gitignore', '.serverless', '.DS_Store')
  if (inputs.functionConf) {
    functionConf.timeout = inputs.functionConf.timeout
      ? inputs.functionConf.timeout
      : CONFIGS.timeout
    functionConf.memorySize = inputs.functionConf.memorySize
      ? inputs.functionConf.memorySize
      : CONFIGS.memorySize
    if (inputs.functionConf.environment) {
      functionConf.environment = inputs.functionConf.environment
    }
    if (inputs.functionConf.vpcConfig) {
      functionConf.vpcConfig = inputs.functionConf.vpcConfig
    }
  }

  // 对apigw inputs进行标准化
  const apigatewayConf = inputs.apigatewayConf ? inputs.apigatewayConf : {}
  apigatewayConf.isDisabled = apigatewayConf.isDisabled === true
  apigatewayConf.fromClientRemark = fromClientRemark
  apigatewayConf.serviceName = inputs.serviceName
  apigatewayConf.description = `Serverless Framework Tencent-${capitalString(
    CONFIGS.framework
  )} Component`
  apigatewayConf.serviceId = inputs.serviceId || stateServiceId
  apigatewayConf.region = functionConf.region
  apigatewayConf.protocols = apigatewayConf.protocols || ['http']
  apigatewayConf.environment = apigatewayConf.environment ? apigatewayConf.environment : 'release'
  apigatewayConf.endpoints = [
    {
      path: '/',
      enableCORS: apigatewayConf.enableCORS,
      method: 'ANY',
      function: {
        isIntegratedResponse: true,
        functionName: functionConf.name,
        functionNamespace: functionConf.namespace
      }
    }
  ]
  if (apigatewayConf.usagePlan) {
    apigatewayConf.endpoints[0].usagePlan = {
      usagePlanId: apigatewayConf.usagePlan.usagePlanId,
      usagePlanName: apigatewayConf.usagePlan.usagePlanName,
      usagePlanDesc: apigatewayConf.usagePlan.usagePlanDesc,
      maxRequestNum: apigatewayConf.usagePlan.maxRequestNum
    }
  }
  if (apigatewayConf.auth) {
    apigatewayConf.endpoints[0].auth = {
      secretName: apigatewayConf.auth.secretName,
      secretIds: apigatewayConf.auth.secretIds
    }
  }

  // 对cns inputs进行标准化
  const tempCnsConf = {}
  const tempCnsBaseConf = inputs.cloudDNSConf ? inputs.cloudDNSConf : {}

  // 分地域处理functionConf/apigatewayConf/cnsConf
  for (let i = 0; i < functionConf.region.length; i++) {
    const curRegion = functionConf.region[i]
    const curRegionConf = inputs[curRegion]
    if (curRegionConf && curRegionConf.functionConf) {
      functionConf[curRegion] = curRegionConf.functionConf
    }
    if (curRegionConf && curRegionConf.apigatewayConf) {
      apigatewayConf[curRegion] = curRegionConf.apigatewayConf
    }

    const tempRegionCnsConf = mergeJson(
      tempCnsBaseConf,
      curRegionConf && curRegionConf.cloudDNSConf ? curRegionConf.cloudDNSConf : {}
    )

    tempCnsConf[functionConf.region[i]] = {
      recordType: 'CNAME',
      recordLine: tempRegionCnsConf.recordLine ? tempRegionCnsConf.recordLine : undefined,
      ttl: tempRegionCnsConf.ttl,
      mx: tempRegionCnsConf.mx,
      status: tempRegionCnsConf.status ? tempRegionCnsConf.status : 'enable'
    }
  }

  const cnsConf = []
  // 对cns inputs进行检查和赋值
  if (apigatewayConf.customDomain && apigatewayConf.customDomain.length > 0) {
    const domain = new Domain(credentials)
    for (let domianNum = 0; domianNum < apigatewayConf.customDomain.length; domianNum++) {
      const domainData = await domain.check(apigatewayConf.customDomain[domianNum].domain)
      const tempInputs = {
        domain: domainData.domain,
        records: []
      }
      for (let eveRecordNum = 0; eveRecordNum < functionConf.region.length; eveRecordNum++) {
        if (tempCnsConf[functionConf.region[eveRecordNum]].recordLine) {
          tempInputs.records.push({
            subDomain: domainData.subDomain || '@',
            recordType: 'CNAME',
            recordLine: tempCnsConf[functionConf.region[eveRecordNum]].recordLine,
            value: `temp_value_about_${functionConf.region[eveRecordNum]}`,
            ttl: tempCnsConf[functionConf.region[eveRecordNum]].ttl,
            mx: tempCnsConf[functionConf.region[eveRecordNum]].mx,
            status: tempCnsConf[functionConf.region[eveRecordNum]].status || 'enable'
          })
        }
      }
      cnsConf.push(tempInputs)
    }
  }

  return {
    regionList,
    functionConf,
    apigatewayConf,
    cnsConf
  }
}

module.exports = {
  generateId,
  sleep,
  packageCode,
  mergeJson,
  capitalString,
  getDefaultProtocol,
  deleteRecord,
  prepareInputs
}
