const { generateId, getServerlessSdk } = require('./utils')

// set enough timeout for deployment to finish
jest.setTimeout(30000)

// the yaml file we're testing against
const instanceYaml = {
  org: 'orgDemo',
  app: 'appDemo',
  component: 'django@dev',
  name: `django-integration-tests-${generateId()}`,
  stage: 'dev',
  inputs: {
    djangoProjectName: 'djangotest'
    // region: 'ap-guangzhou'
  }
}

process.env.SERVERLESS_PLATFORM_VENDOR = 'tencent'
process.env.TENCENT_SECRET_ID = ''
process.env.TENCENT_SECRET_KEY = ''
process.env.SERVERLESS_PLATFORM_STAGE = 'dev'

// get credentials from process.env but need to init empty credentials object
const credentials = {
  tencent: {}
}

// get serverless construct sdk
const sdk = getServerlessSdk(instanceYaml.org)

// clean up the instance after tests
afterAll(async () => {
  await sdk.remove(instanceYaml, credentials)
})

it('should successfully deploy django app', async () => {
  const instance = await sdk.deploy(instanceYaml, { tencent: {} })
  expect(instance).toBeDefined()
  expect(instance.instanceName).toEqual(instanceYaml.name)
})

it('should successfully update basic configuration', async () => {
  instanceYaml.inputs.region = 'ap-shanghai'

  const instance = await sdk.deploy(instanceYaml, credentials)

  expect(instance.outputs).toBeDefined()
  expect(instance.outputs.region).toEqual(instanceYaml.inputs.region)
})

it('should successfully update apigatewayConf', async () => {
  instanceYaml.inputs.apigatewayConf = { environment: 'test' }
  const instance = await sdk.deploy(instanceYaml, credentials)

  expect(instance.outputs).toBeDefined()
  expect(instance.outputs.apigw).toBeDefined()
  expect(instance.outputs.apigw.environment).toEqual(instanceYaml.inputs.apigatewayConf.environment)

})

it('should successfully disable auto create api gateway', async () => {
  instanceYaml.inputs.apigatewayConf = { isDisabled: true }
  const instance = await sdk.deploy(instanceYaml, credentials)

  expect(instance.outputs).toBeDefined()
  expect(instance.outputs.apigw).not.toBeDefined()
})

it('should successfully remove django app', async () => {
  await sdk.remove(instanceYaml, credentials)
  result = await sdk.getInstance(instanceYaml.org, instanceYaml.stage, instanceYaml.app, instanceYaml.name)

  // remove action won't delete the service cause the apigw have the api binded
  expect(result.instance.instanceStatus).toEqual('inactive')
})
