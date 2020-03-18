const ensureIterable = require('type/iterable/ensure')
const path = require('path')
const { Component } = require('@serverless/core')
const fs = require('fs')

const DEFAULTS = {
  handler: 'index.main_handler',
  runtime: 'Python3.6',
  exclude: ['.git/**', '.gitignore', '.DS_Store']
}

class TencentDjango extends Component {
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

  async default(inputs = {}) {
    if (!inputs.djangoProjectName) {
      throw new Error(`'djangoProjectName' is required in serverless.yaml`)
    }
    const cachePath = path.join(inputs.code, '.cache')
    inputs.include = ensureIterable(inputs.include, { default: [] })
    inputs.include.push(cachePath)

    const src = path.join(__dirname, 'component')
    await this.copyDir(src, cachePath)
    const indexPyFile = await fs.readFileSync(
      path.join(path.resolve(inputs.code), '.cache', 'index.py'),
      'utf8'
    )
    const replacedFile = indexPyFile.replace(
      eval('/{{django_project}}/g'),
      inputs.djangoProjectName
    )
    await fs.writeFileSync(path.join(path.resolve(inputs.code), '.cache', 'index.py'), replacedFile)

    inputs.handelr = DEFAULTS.handler
    inputs.runtime = DEFAULTS.runtime

    const Framework = await this.load('@serverless/tencent-framework')

    const framworkOutpus = await Framework({
      ...inputs,
      ...{
        framework: 'django'
      }
    })

    this.state = framworkOutpus
    await this.save()
    return framworkOutpus
  }

  async remove(inputs = {}) {
    const Framework = await this.load('@serverless/tencent-framework')
    await Framework.remove({
      ...inputs,
      ...{
        framework: 'django'
      }
    })
    this.state = {}
    await this.save()
    return {}
  }
}

module.exports = TencentDjango
