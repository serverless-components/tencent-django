const CONFIGS = {
  framework: 'django',
  frameworkFullname: 'Django',
  handler: 'index.main_handler',
  runtime: 'Python3.6',
  exclude: ['.git/**', '.gitignore', '.DS_Store'],
  timeout: 3,
  memorySize: 128,
  namespace: 'default',
  description: 'This is a function created by serverless component'
}

module.exports = CONFIGS
