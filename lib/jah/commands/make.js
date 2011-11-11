"use strict";

var sys       = require('sys')
  , logger    = require('../logger')
  , opts      = require('../opts')
  , fs        = require('fs')
  , path      = require('path')
  , copytree  = require('../copytree').copytree
  , mkdir     = require('../copytree').mkdir
  , T         = require('../template').Template
  , mimetypes = require('../mimetypes')

var OPTIONS = [ { short:       'c'
                , long:        'config'
                , description: 'Configuration file. Default is jah.json'
                , value:       true
                }
              ]

var DEFAULT_JAH_JSON = { mainModule:  'main'
                       , resourceURL: 'resources'
                       , sourcePath:  'src'
                       }

var JAH_ROOT = path.normalize(path.dirname(path.join(__dirname, '../../')))


var TEMPLATES = { code:      new T('function (exports, require, module, __filename, __dirname) {$data$}')
                , jahFooter: new T(fs.readFileSync(path.join(__dirname, 'module_js'), 'utf8'))
                , resource:  new T('__jah__.resources["$filename$"] = {data: $data$, mimetype: "$mimetype$", remote: $remote$}')
                }

exports.description = 'Build the current Jah project';
exports.run = function () {
    opts.parse(OPTIONS, true)

    var config = opts.get('config') || 'jah.json'
      , compiler = new Compiler(config)

    compiler.build()
}
function readJSONFile (filename) {
    var j = fs.readFileSync(filename, 'utf8');

    // Strip comments
    j = j.replace(/\/\/.*/g, '');
    j = j.replace(/\/\*(.|[\n\r])*?\*\//mg, '');

    // Fix unquoted keys
    j = j.replace(/\{\s*(\w)/g, '{"$1');
    j = j.replace(/,(\s*)(\w)/g, ',$1"$2');
    j = j.replace(/(\w):/g, '$1":');

    // Fix trailing comma
    j = j.replace(/,\s+\}/mg, '}');

    return JSON.parse(j);
}

function mergeObjects () {
    var o = {};
    for (var i = 0, len = arguments.length; i < len; i++) {
        var obj = arguments[i];
        for (var x in obj) {
            if (obj.hasOwnProperty(x)) {
                o[x] = obj[x];
            }
        }
    }

    return o;
}

function Compiler (configFile) {
    if (configFile) {
        this.loadConfig(configFile)
    }
}

Compiler.prototype.loadConfig = function (configFile) {
    this.config = this.readConfig(configFile)
    this.buildQueue = {}

    this.isJah = (path.normalize(JAH_ROOT) == path.normalize(path.dirname(configFile)))

    // Add Jah built-ins to build queue (unless this is Jah)
    if (!this.isJah) {
        this.addToBuildQueue(JAH_ROOT, null, 'jah.js')
    }

    // Add each lib to build queue
    if (this.config.libs instanceof Array) {
        var libname, libpath, i
        for (i=0; i<this.config.libs.length; i++) {
            libname = this.config.libs[i]
            libpath = this.findLibPath(libname)
            if (!libpath) {
                throw "Unable to find location of library: " + libpath
            }
            this.addToBuildQueue(libpath, null, libname + '.js')
        }
    }

    // TODO handle libs as a dictionary: {libname: mount}
}

Compiler.prototype.findLibPath = function (libname) {
    var possiblePaths = [ path.join('node_modules', libname, 'jah.json')
                        , path.join(process.installPrefix, 'lib', 'node_modules', libname, 'jah.json')
                        , path.join('~/.node_modules', libname, 'jah.json')
                        ]

    var p, i
    for (i=0; i<possiblePaths.length; i++) {
        p = possiblePaths[i]
        if (path.existsSync(p)) {
            return path.dirname(p)
        }
    }

    return false
}

Compiler.prototype.readConfig = function (configFile) {
    logger.info('Using config', configFile)

    var config = readJSONFile(configFile)

    // Force .js files to be packed
    if (config.pack_resources instanceof Array) {
        config.pack_resources.push('js')
    } else if (config.pack_resources === false) {
        config.pack_resources = ['js']
    }

    config = mergeObjects(DEFAULT_JAH_JSON, config)

    // Fix relative paths to source code
    if (config.sourcePath[0] != "/") {
        config.sourcePath = path.join(path.dirname(configFile), config.sourcePath)
    }

    return config
}

Compiler.prototype.addToBuildQueue = function (src, dst, filename) {
    this.buildQueue[src] = { filename: filename
                           , mount: dst
                           }
}

Compiler.prototype.build = function () {
    var packages = this.buildPackages()

    var pkgName, pkg
    for (pkgName in packages) {
        if (packages.hasOwnProperty(pkgName)) {
            pkg = packages[pkgName]

            // Write out the package to disk
            mkdir(path.join('build'));
            fs.writeFileSync(path.join('build', pkgName), pkg, 'utf8')
        }
    }

}

Compiler.prototype.buildPackages = function (mount) {
    mount = mount || '/'

    var packages = {}

    var codePath, pkg
      , pkgCompiler = new Compiler()

    for (codePath in this.buildQueue) {
        if (this.buildQueue.hasOwnProperty(codePath)) {
            pkg = this.buildQueue[codePath]

            // Create blank package file contents
            if (!packages[pkg.filename]) {
                packages[pkg.filename] = ''
            }

            // Load the config for the package
            pkgCompiler.loadConfig(path.join(codePath, 'jah.json'))

            // Append code to package file contents
            packages[pkg.filename] += pkgCompiler.buildProject(pkg.mount)
        }
    }


    // Create blank package for the project
    if (!packages[this.config.output]) {
        packages[this.config.output] = ''
    }

    // Append code to package file contents
    packages[this.config.output] += this.buildProject(mount)

    return packages
}

// FIXME DRY this method with buildPackages
Compiler.prototype.collectFilenames = function (mount) {
    mount = mount || this.config.mount || '/'

    var filenames = []

    var codePath, pkg
      , pkgCompiler = new Compiler()

    for (codePath in this.buildQueue) {
        if (this.buildQueue.hasOwnProperty(codePath)) {
            pkg = this.buildQueue[codePath]

            // Load the config for the package
            pkgCompiler.loadConfig(path.join(codePath, 'jah.json'))

            pkg.mount = pkg.mount || pkgCompiler.config.mount

            // Append code to package file contents
            filenames = filenames.concat(pkgCompiler.collectPathFilenames(pkgCompiler.config.sourcePath, pkg.mount))
        }
    }


    filenames = filenames.concat(this.collectPathFilenames(this.config.sourcePath, mount))

    return filenames
}

Compiler.prototype.jahHeader = function () {
    return 'if (!window.__jah__) window.__jah__ = {resources:{}};\n'
}

Compiler.prototype.jahFooter = function () {
    return TEMPLATES.jahFooter.toString()
}

Compiler.prototype.buildProject = function (mount) {
    mount = mount || this.config.mount || '/'

    var code = this.buildPath(this.config.sourcePath, mount).join("\n")

    // Add Jah header to the main Jah file
    if (this.isJah) {
        code = this.jahHeader() + code + this.jahFooter()
    }

    return '(function(){\n' + code + '\n})();'
}

Compiler.prototype.collectPathFilenames = function (filename, mountRoot) {
    mount = mount || '/'

    var files = fs.readdirSync(filename)
      , file, fullPath, i, len, mount
      , foundFiles = []

    for (i = 0, len = files.length; i < len; i++) {
        file = files[i]
        if (file[0] == '.') continue // Skip hidden files
        fullPath = path.join(filename, file)
        mount = path.join(mountRoot, file)

        if (fs.statSync(fullPath).isFile()) {
            foundFiles.push(mount)
        } else {
            foundFiles = foundFiles.concat(this.collectPathFilenames(fullPath, mount))
        }
    }

    return foundFiles
}


Compiler.prototype.buildPath = function (filename, mountRoot) {
    logger.group('Build ' + 'Path'.underline, filename + ' => '.yellow + mountRoot)

    // If it's a file rather than a directory
    if (fs.statSync(filename).isFile()) {
        logger.ungroup()
        return [this.buildFile(filename, mountRoot)]
    }

    var builtFiles = []

    var files = fs.readdirSync(filename)
      , file, fullPath, i, len, mount

    for (i = 0, len = files.length; i < len; i++) {
        file = files[i]
        if (file[0] == '.') continue // Skip hidden files
        fullPath = path.join(filename, file)
        mount = path.join(mountRoot, file)

        if (fs.statSync(fullPath).isFile()) {
            builtFiles.push(this.buildFile(fullPath, mount))
        } else {
            builtFiles = builtFiles.concat(this.buildPath(fullPath, mount))
        }
    }

    logger.ungroup()

    return builtFiles
}

Compiler.prototype.buildFile = function (filename, mount, tight) {
    logger.info('Build ' + 'File'.underline, filename + ' => '.yellow + mount)

    var mimetype = mimetypes.guessType(filename)
      , data = ''

    switch (mimetype) {
    case 'application/javascript':
        data = this.wrapModule(fs.readFileSync(filename, 'utf8'), mount, tight)
        break;
    default:
        data = this.wrapBinary(filename, mount, mimetype)
        break;
    }

    return data
}

Compiler.prototype.wrapResource = function (data, mount, mimetype, remote) {
    return TEMPLATES.resource.substitute({ filename: mount
                                         , data: data
                                         , mimetype: mimetype || 'text/plain'
                                         , remote: (!!remote).toString()
                                         })
}

Compiler.prototype.wrapBinary = function (filename, mount, mimetype) {
    return this.wrapResource("__jah__.assetURL + " + JSON.stringify(mount), mount, mimetype, true)
}

Compiler.prototype.wrapModule = function (data, mount, tight) {
    if (!tight) {
        data = "\n" + data + "\n"
    }

    var code = this.wrapResource(TEMPLATES.code.substitute({ data: data }), mount, 'application/javascript')

    if (!tight) { 
        code += " // END: " + mount + "\n\n";
    }

    return code
}

Compiler.prototype.filePathForScript = function (scriptname) {
    if (scriptname[0] != '/') {
        scriptname = '/' + scriptname
    }

    var bestMatch = null
      , codePath
      , pkg
      , config
      , srcname
      , jahJson

    for (codePath in this.buildQueue) {
        if (this.buildQueue.hasOwnProperty(codePath)) {
            pkg = this.buildQueue[codePath]
            jahJson = path.join(codePath, 'jah.json')
            if (!path.existsSync(jahJson)) {
                continue;
            }
            config = this.readConfig(jahJson)
            pkg.mount = pkg.mount || config.mount

            // If script begins with the mount point
            // TODO handle multiple matches -- use the longest match??
            if (scriptname.indexOf(pkg.mount) === 0) {
                // Find location of source code and replace mount point with it
                srcname = scriptname.substring(pkg.mount.length)
                bestMatch = { filename: path.join(config.sourcePath, srcname)
                            , mount: path.join(pkg.mount, srcname)
                            }
                break;
            }
        }
    }

    if (!bestMatch) {
        bestMatch = { filename: path.join(this.config.sourcePath, scriptname)
                    , mount: path.join('/', scriptname)
                    }
    }

    if (!path.existsSync(bestMatch.filename)) {
        bestMatch = null
    }

    return bestMatch
}

Compiler.prototype.getAllMountFilenames = function () {
    return this.collectFilenames()
}

exports.Compiler = Compiler
