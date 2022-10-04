const { readFileSync, statSync } = require('fs')
const dotenv = require('dotenv')

function parseDotenvFile(path, verbose = false) {
  let content
  try {
    content = readFileSync(path)
  } catch (error) {
    // The env file does not exist.
    if (verbose) {
      console.error('rn-config-env:error:', error)
    }

    return {}
  }

  return dotenv.parse(content)
}

function safeObjectAssign(targetObject, sourceObject, exceptions = []) {
  const keys = Object.keys(targetObject)
  for (let i = 0, length = keys.length; i < length; i++) {
    if (targetObject[keys[i]] && sourceObject[keys[i]]) {
      targetObject[keys[i]] = sourceObject[keys[i]]
    }
  }

  for (let j = 0, length = exceptions.length; j < length; j++) {
    if (sourceObject[exceptions[j]]) {
      targetObject[exceptions[j]] = sourceObject[exceptions[j]]
    }
  }

  return targetObject
}

function mtime(filePath) {
  try {
    return statSync(filePath).mtimeMs
  } catch {
    return null
  }
}

module.exports = (api, options) => {
  const t = api.types
  this.env = {}
  options = {
    moduleName: '@env',
    safe: true,
    verbose: true,
    ...options,
  }
  const envMode = process.env.ENVMODE || 'development'

  const envPath = `.env.${envMode}`

  api.cache.using(() => mtime(envPath))

  const dotenvTemporary = Object.assign({}, process.env)
  if (options.safe) {
    const envParsed = parseDotenvFile(envPath, options.verbose)

    this.env = safeObjectAssign(envParsed, dotenvTemporary, [])

    this.env.NODE_ENV = envMode || babelMode
  } else {
    dotenv.config({ path: envPath, silent: true, })
    this.env = process.env
    this.env = Object.assign(this.env, dotenvTemporary)
  }

  api.addExternalDependency(envPath)

  return ({
    name: 'rn-config-env',

    pre() {
      this.opts = {
        moduleName: '@env',
        safe: true,
        verbose: false,
        ...this.opts,
      }

      const dotenvTemporary = Object.assign({}, process.env)

      if (this.opts.safe) {
        const envParsed = parseDotenvFile(envPath, options.verbose)
        this.env = safeObjectAssign(envParsed, dotenvTemporary, [])
        this.env.NODE_ENV = process.env.ENVMODE || babelMode
      } else {
        dotenv.config({ path: envPath, silent: true, })
        this.env = process.env
        this.env = Object.assign(this.env, dotenvTemporary)
      }
    },

    visitor: {
      ImportDeclaration(path, { opts }) {
        if (path.node.source.value === opts.moduleName) {
          for (const [idx, specifier] of path.node.specifiers.entries()) {
            if (specifier.type === 'ImportDefaultSpecifier') {
              throw path.get('specifiers')[idx].buildCodeFrameError('Default import is not supported')
            }

            if (specifier.type === 'ImportNamespaceSpecifier') {
              throw path.get('specifiers')[idx].buildCodeFrameError('Wildcard import is not supported')
            }

            if (specifier.imported && specifier.local) {
              const importedId = specifier.imported.name
              const localId = specifier.local.name
              const binding = path.scope.getBinding(localId)
              for (const refPath of binding.referencePaths) {
                refPath.replaceWith(t.valueToNode(this.env[importedId]))
              }
            }
          }

          path.remove()
        }
      },
      MemberExpression(path, { opts }) {
        if (path.get('object').matchesPattern('process.env')) {
          const key = path.toComputedKey()
          if (t.isStringLiteral(key)) {
            const importedId = key.value
            const value = (opts.env && importedId in opts.env) ? opts.env[importedId] : process.env[importedId]

            path.replaceWith(t.valueToNode(value))
          }
        }
      },
    },
  })
}