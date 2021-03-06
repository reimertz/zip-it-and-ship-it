const { version: nodeVersion } = require('process')

const findUp = require('find-up')
const pathExists = require('path-exists')
const resolve = require('resolve')
const { lt: ltVersion } = require('semver')

// Find the path to a module's `package.json`
// We need to use `resolve` instead of `require.resolve()` because:
//  - it is async
//  - it preserves symlinks:
//     - this is important because if a file does a `require('./symlink')`, we
//       need to bundle the symlink and its target, not only the target
//     - `path.resolve()` cannot be used for relative|absolute file paths
//       because it does not resolve ommitted file extension,
//       e.g. `require('./file')` instead of `require('./file.js')`
//     - the CLI flag `--preserve-symlinks` can be used with Node.js, but it
//       cannot be set runtime
// However it does not give helpful error messages.
//   https://github.com/browserify/resolve/issues/223
// So, on errors, we fallback to `require.resolve()`
const resolvePackage = async function(moduleName, basedir) {
  try {
    return await resolvePathPreserveSymlinks(`${moduleName}/package.json`, basedir)
  } catch (error) {
    if (ltVersion(nodeVersion, REQUEST_RESOLVE_MIN_VERSION)) {
      throw error
    }

    try {
      return resolvePathFollowSymlinks(`${moduleName}/package.json`, basedir)
    } catch (error) {
      const packagePath = resolvePackageFallback(moduleName, basedir)
      if (packagePath === undefined) {
        throw error
      }
      return packagePath
    }
  }
}

// TODO: remove after dropping support for Node <8.9.0
// `require.resolve()` option `paths` was introduced in Node 8.9.0
const REQUEST_RESOLVE_MIN_VERSION = '8.9.0'

// We need to use `new Promise()` due to a bug with `utils.promisify()` on
// `resolve`:
//   https://github.com/browserify/resolve/issues/151#issuecomment-368210310
const resolvePathPreserveSymlinks = function(path, basedir) {
  return new Promise((success, reject) => {
    resolve(path, { basedir, preserveSymlinks: true }, (error, resolvedLocation) => {
      if (error) {
        return reject(error)
      }

      success(resolvedLocation)
    })
  })
}

const resolvePathFollowSymlinks = function(path, basedir) {
  return require.resolve(path, { paths: [basedir] })
}

// `require.resolve()` on a module's specific file (like `package.json`)
// can be forbidden by the package author by using an `exports` field in
// their `package.json`. We need this fallback.
// It looks for the first directory up from a package's `main` file that:
//   - is named like the package
//   - has a `package.json`
// Theoritically, this might not the root `package.json`, but this is very
// unlikely, and we don't have any better alternative.
const resolvePackageFallback = async function(moduleName, basedir) {
  const mainFilePath = resolvePathFollowSymlinks(moduleName, basedir)
  return findUp(isPackageDir.bind(null, moduleName), { cwd: mainFilePath, type: 'directory' })
}

const isPackageDir = async function(moduleName, dir) {
  // Need to use `endsWith()` to take into account `@scope/package`.
  // Backslashes need to be converted for Windows.
  if (!dir.replace(BACKSLASH_REGEXP, '/').endsWith(moduleName) || !(await pathExists(`${dir}/package.json`))) {
    return
  }

  return dir
}

const BACKSLASH_REGEXP = /\\/g

module.exports = { resolvePackage, resolvePathPreserveSymlinks }
