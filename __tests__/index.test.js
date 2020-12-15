const { generateId, getServerlessSdk } = require('./lib/utils')
const path = require('path')

const instanceYaml = {
  org: 'orgDemo',
  app: 'appDemo',
  component: 'django@dev',
  name: `django-integration-tests-${generateId()}`,
  stage: 'dev',
  inputs: {
    djangoProjectName: 'mydjangocomponent',
    src: path.join(__dirname, '..', 'example/src'),
    region: 'ap-guangzhou',
    apigatewayConf: { environment: 'test' }
  }
}

const credentials = {
  tencent: {
    SecretId: process.env.TENCENT_SECRET_ID,
    SecretKey: process.env.TENCENT_SECRET_KEY,
  }
}

const sdk = getServerlessSdk(instanceYaml.org)

it('should successfully deploy django app', async () => {
  const instance = await sdk.deploy(instanceYaml, credentials)
  expect(instance).toBeDefined()
  expect(instance.instanceName).toEqual(instanceYaml.name)
  expect(instance.outputs).toBeDefined()
  expect(instance.outputs.region).toEqual(instanceYaml.inputs.region)
  expect(instance.outputs.apigw).toBeDefined()
  expect(instance.outputs.apigw.environment).toEqual(instanceYaml.inputs.apigatewayConf.environment)
})

it('should successfully remove django app', async () => {
  await sdk.remove(instanceYaml, credentials)
  result = await sdk.getInstance(instanceYaml.org, instanceYaml.stage, instanceYaml.app, instanceYaml.name)

  expect(result.instance.instanceStatus).toEqual('inactive')
})
