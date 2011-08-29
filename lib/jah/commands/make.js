/*globals require module exports process console __dirname*/
/*jslint undef: true, strict: true, white: true, newcap: true, indent: 4 */
"use strict";

var sys       = require('sys'),
    logger    = require('../logger'),
    opts      = require('../opts'),
    fs        = require('fs'),
    path      = require('path'),
    copytree  = require('../copytree').copytree,
    mkdir     = require('../copytree').mkdir,
    Template  = require('../template').Template,
    mimetypes = require('../mimetypes');


var cwd = process.cwd();

var OPTIONS = [
    {   short: 'f',
        long: 'file',
        description: 'File to write output to. Overrides config file',
        value: true },

    {   short: 'c',
        long: 'config',
        description: 'Configuration file. Default is jah.json',
        value: true }
];

mimetypes.addType('application/xml', '.tmx');
mimetypes.addType('application/xml', '.tsx');
mimetypes.addType('application/xml', '.plist');

var RESOURCE_TEMPLATE = new Template('__resources__[__mount_point__ + "$resource$"] = {meta: {mimetype: "$mimetype$"}, data: $data$};');
var REMOTE_RESOURCE_TEMPLATE = new Template('__remote_resources__[__mount_point__ + "$resource$"] = {meta: {mimetype: "$mimetype$"}, data: __remote_resources_prefix__ + "$data$"};');
var TEXT_MIMETYPES = 'application/xml text/plain text/json application/json text/html'.split(' ');
var CODE_MIMETYPES = 'text/javascript application/javascript application/x-javascript'.split(' ');


var DEFAULT_JAH_JSON = {
    output: {
        script: "jah-app.js",
        resources: "resources"
    },
    extensions: ["js", "gif", "jpeg", "jpg", "png", "tmx", "tsx", "plist"],
    ignore: null,
    main_module: "main",
    pack_resources: true,
    resource_url: false,
    paths: { src: '/' }
};

var JAH_ROOT = path.normalize(path.join(__dirname, '../../../'));

/**
 * Merge an number of objects together and return the result as a new object
 */
function merge() {
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

/**
 * Merges 2 objects loaded from a jah.json files or similar.
 *
 * @param {Object} conf1 First config
 * @param {Object} conf2 Second config. Will override conf1
 * @returns Object A new object
 */
function mergeMakeConfig(conf1, conf2) {
    var o = merge(conf1, conf2);
    o.paths = merge(conf1.paths, conf2.paths);
    return o;
}

/**
 * @memberOf jah.commands.make
 * @class Compile a jah project into a single javascript file
 * @param {String} [configFile=jah.json] The project's config filename
 */
function Compiler(configFile, mountPoint) {
    this.mountPoint = mountPoint || '';

    /**
     * Resources that need copying
     * @type {String[]}
     */
    this.remoteResources = {};

    /**
     * Jah libs that could be compiled with the project
     * @type {String[]|null}
     */
    this.jahLibs = null;

    this.cwd = path.dirname(configFile);

    /**
     * Paths that should be searched for modules in the resulting code
     */
    this.modulePaths = ['/__builtin__', '/__builtin__/libs', '/libs', '/'];

    /**
     * Module paths to run on application initialisation
     */
    this.remoteLibPaths = [];
    this.globalsPaths = ['/__builtin__/globals', '/globals'];

    /**
     * Whether to include Jah built in code
     */
    this.includeJah = true;

    this.readConfig = function (configFile) {
        logger.info('Using config', configFile);

        var config = this.readJSONFile(configFile);
        config = mergeMakeConfig(DEFAULT_JAH_JSON, config);
        // Set resource url to the output path
        if (config.resource_url === false) {
            config.resource_url = config.output.resources || 'resources';
        }
        
        // Force .js files to be packed
        if (config.pack_resources instanceof Array) {
            config.pack_resources.push('js');
        } else if (config.pack_resources === false) {
            config.pack_resources = ['js'];
        }

        this.output = config.output;
        this.mainModule = config.mainModule || config.main_module;
        this.extensions = config.extensions;

        return config;
    };

    this.config = this.readConfig(configFile || 'jah.json');
}
(function () /** @lends jah.commands.make.Compiler# */{

    /**
     * Read a JSON file and clean up any comments, unquoted keys and trailing
     * commas before returning the object
     *
     * @param {String} filename Name of the JSON file to read
     * @returns {Object} The JSON object
     */
    this.readJSONFile = function (filename) {
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
    };

    this.__defineGetter__('appConfigFiles', function () {
        if (this.appConfigFiles_) {
            return this.appConfigFiles_;
        }

        var configs = [];

        for (var source in this.config.paths) {
            if (this.config.paths.hasOwnProperty(source)) {
                var dest = this.config.paths[source];

                var c = path.join(source, 'config.json');
                if (path.existsSync(c)) {
                    configs.push(c);
                }
            }
        }

        this.appConfigFiles_ = configs;

        return this.appConfigFiles_;
    });

    /**
     * Reads all the app's config.js files and returns an of object their
     * values
     */
    this.__defineGetter__('appConfig', function () {
        if (this.appConfig_) {
            return this.appConfig_;
        }

        var vals = {}, data;
        for (var i = 0, len = this.appConfigFiles.length; i < len; i++) {
            var config = this.appConfigFiles[i];
            if (path.existsSync(config)) {
                data = this.readJSONFile(config);
                vals = merge(vals, data);
            }
        }

        this.appConfig_ = vals;
        return this.appConfig_;
    });

    /**
     * Compile everything into a single script
     */
    this.make = function () {
        var code = '';

        // Add config options
        for (var key in this.appConfig) {
            if (this.appConfig.hasOwnProperty(key)) {
                code += 'var ' + key.toUpperCase() + ' = ' + JSON.stringify(this.appConfig[key]) + ';\n';
            }
        }

        // Add built-in code
        if (this.includeJah) {
            code += this.makePath(path.join(JAH_ROOT, 'src'), '/__builtin__', false);
        }

        // Add all the project resources
        for (var source in this.config.paths) {
            if (this.config.paths.hasOwnProperty(source)) {
                var dest = this.config.paths[source];
                code += this.makePath(source, dest);
            }
        }

        // Add all lib resources
        if (this.config.libs) {
            var libs = this.getJahLibPaths(this.config.libs)
              , mount; //, jahFilePath, libCompiler, tokens, libName, subMod;

            for (var source in libs) {
                if (libs.hasOwnProperty(source)) {
                    mount = libs[source];
                    code += REMOTE_RESOURCE_TEMPLATE.substitute({
                        'mimetype': 'application/javascript',
                        'resource': mount,
                        'data': mount + '.js'
                    });

                    if (this.remoteLibPaths.indexOf(mount) == -1) {
                        this.remoteLibPaths.push(mount);
                    }
                    var libsPath = path.join(mount, 'libs');
                    if (this.modulePaths.indexOf(libsPath) == -1) {
                        this.modulePaths.push(libsPath);
                    }

                }
            }
        } // if (this.config.libs)


        if (this.config.is_lib) {
            return this.packageLib(code);
        } else {
            return this.packageApp(code);
        }
    };

    this.makeLib = function (libName) {
        var source = this.findModuleInJahLibs(libName),
            jahFilePath = path.join(source, 'jah.json'),
            libs = this.getJahLibPaths(this.config.libs),
            mount = libs[source];

        if (!path.existsSync(jahFilePath)) {
            sys.puts(jahFilePath);
            return false;
        }

        logger.log()
        logger.info("Building " + "Lib".underline, source + " => ".yellow + mount);

        var libPath = path.join(mount, 'libs'),
            initPath = path.join(mount, 'init'),
            globalsPath = path.join(mount, 'globals');
        if (this.modulePaths.indexOf(libPath) == -1) {
            this.modulePaths.push(libPath);
        }
        if (this.globalsPaths.indexOf(globalsPath) == -1) {
            this.globalsPaths.push(globalsPath);
        }


        var libCompiler = new Compiler(jahFilePath, mount);
        libCompiler.includeJah = false;
        return libCompiler.make();
    };

    this.packageLib = function (libCode) {
        var code = this.header || '';

        code += '(function() {\n';
        code += 'if (!window.__resources__) window.__resources__ = {};\n';
        code += 'if (!window.__remote_resources__) window.__remote_resources__ = {};\n';
        code += 'var __mount_point__ = ' + JSON.stringify(this.mountPoint.replace(/\/$/, '')) + ';\n';
        code += 'var __remote_resources_prefix__ = ' + JSON.stringify(this.config.resource_url) + ';\n';
        code += libCode;
        code += '\n})();\n';

        code += this.footer || '';

        return code;
    };

    this.packageApp = function (appCode) {
        var code = this.header || '';
        code += '(function() {\n';
        code += 'var __main_module_name__ = ' + JSON.stringify(this.mainModule) + ';\n';
        code += 'if (!window.__resources__) window.__resources__ = {};\n';
        code += 'if (!window.__remote_resources__) window.__remote_resources__ = {};\n';
        code += 'var __mount_point__ = ' + JSON.stringify(this.mountPoint.replace(/\/$/, '')) + ';\n';
        code += 'var __remote_resources_prefix__ = ' + JSON.stringify(this.config.resource_url) + ';\n';
        code += 'window.__imageResource = function (data) { var img = new Image(); img.src = data; return img; };\n';

        code += appCode;

        var module_js = new Template(fs.readFileSync(path.join(__dirname, 'module_js'), 'utf8'))
        code += module_js.substitute({ 'modulePaths':  JSON.stringify(this.modulePaths)
                                     , 'remoteLibPaths': JSON.stringify(this.remoteLibPaths)
                                     , 'globalsPaths': JSON.stringify(this.globalsPaths)
                                     });

        code += '\n})();\n';

        code += this.footer || '';

        return code;
    };

    /**
     * Compile everything at a path and return the code
     * 
     * @param {String} source Path to compile
     * @param {String} [dest=source] Output path
     * @param {Boolean} [recursive=true] Include sub-directories
     * @returns {String} Compiled javascript source code
     */
    this.makePath = function (source, dest, recursive) {
        recursive = recursive !== false;

        logger.log()
        logger.info('Building ' + 'Path'.underline, source + ' => '.yellow + dest);

        var code = '';

        // Prefix working directory if not absolute path
        if (source[0] != '/') {
            source = path.join(this.cwd, source);
        }
        var files = this.scanForFiles(source, recursive);
        for (var i = 0, len = files.length; i < len; i++) {
            var sourceFile = files[i];
            if (!!~this.appConfigFiles.indexOf(sourceFile)) {
                continue;
            }

            // If source ends in slash but destination doesn't, we need to fix it
            if (/\/$/.test(source) && !(/\/$/).test(dest)) {
                dest += '/'
            }
            var destFile = sourceFile.replace(source, dest == '/' ? '' : dest),
                mimetype = mimetypes.guessType(sourceFile),
                ext = destFile.split('.').pop().toLowerCase();


            if (destFile[0] != '/') {
                destFile = '/' + destFile;
            }
            logger.info('Building ' + 'File'.underline, sourceFile + ' => '.yellow + path.join(this.mountPoint, destFile));
            code += '\n';

            // Is this a remote resource which should be loaded at runtime
            // rather than be packed into the .js
            var isRemote = (this.config.pack_resources === false || (this.config.pack_resources instanceof Array && !~this.config.pack_resources.indexOf(ext)));

            if (isRemote) {
                this.remoteResources[sourceFile] = destFile;
                code += REMOTE_RESOURCE_TEMPLATE.substitute({
                    'mimetype': mimetype,
                    'resource': destFile,
                    'data': destFile
                });
            } else {
                code += RESOURCE_TEMPLATE.substitute({
                    'mimetype': mimetype,
                    'resource': destFile,
                    'data': this.makeResource(sourceFile)
                });
            }
        }


        return code;
    };

    this.destForSource = function (sourcePath) {
        // Strip off CWD
        if (sourcePath.indexOf(this.cwd) === 0) {
            sourcePath = sourcePath.replace(this.cwd + '/', '');
        }

        for (var source in this.config.paths) {
            if (this.config.paths.hasOwnProperty(source)) {
                var dest = this.config.paths[source];


                // Source starts with config path
                if (sourcePath.indexOf(source) === 0) {
                    return sourcePath.replace(source, dest).replace(/\/+/, '/');
                }
            }
        }

        return null;
    };

    this.sourceForDest = function (uri) {
        for (var source in this.config.paths) {
            if (this.config.paths.hasOwnProperty(source)) {
                var dest = this.config.paths[source];

                // Source starts with config path
                if (uri.indexOf(dest) === 0) {
                    var realPath = path.join(source, uri.replace(dest, '').replace(/\/+/, '/'));
                    if (path.existsSync(realPath)) {
                        return realPath;
                    }
                }
            }
        }

        return null;
    };

    this.makeResource = function (filename) {
        var mimetype = mimetypes.guessType(filename);

        var isCode = (!!~CODE_MIMETYPES.indexOf(mimetype)),
            isText = (!!~TEXT_MIMETYPES.indexOf(mimetype)),
            isImage = (mimetype.split('/')[0] == 'image');

        var data;
        if (isCode) {
            data = fs.readFileSync(filename, 'utf8');
            data = "function(exports, require, module, __filename, __dirname) {\n" + data + "\n}";
        } else if (isText) {
            data = JSON.stringify(fs.readFileSync(filename, 'utf8'));
        } else if (isImage) {
            // Pack images into the file as Base64 encoded strings.
            data = fs.readFileSync(filename).toString('base64');
            data = '__imageResource("data:' + mimetype + ';base64,' + data + '")';
        } else /* isBinary */ {
            data = JSON.stringify(fs.readFileSync(filename).toString('base64'));
        }

        return data;
    };

    this.guessMimeType = function (filename) {
        return 'image/png';
    };

    /**
     * Search for Jah libs inside the node_modules directory
     */
    this.scanForJahLibs = function (source) {
        var source = path.join((source || this.cwd), 'node_modules');
        this.jahLibs = [];
        if (!path.existsSync(source)) {
            return;
        }
        logger.debug("SCANNING FOR JAH LIBS", source);

        var files = fs.readdirSync(source);

        for (var i = 0, len = files.length; i < len; i++) {
            var file = files[i];
            // Skip hidden files
            if (file[0] == '.') {
                continue;
            }

            var fullPath = path.join(source, file);
            this.jahLibs.push(fullPath);
        }
    };

    this.findModuleInJahLibs = function (src) {
        // Scan all installed Node packages for Jah libs
        if (!this.jahLibs) {
            this.scanForJahLibs();
        }

        for (var i = 0, len = this.jahLibs.length; i < len; i++) {
            var lib = this.jahLibs[i]
              , tokens = src.split('/')
              , libName = tokens.shift()
              , subMod = tokens.join('/')
              , result;


            if (libName == path.basename(lib)) {
                if (!subMod) {
                    result = path.join(lib);
                    if (path.existsSync(result)) {
                        return result;
                    }
                } else {
                    result = path.join(lib, 'src', subMod);
                    if (path.existsSync(result)) {
                        return result;
                    }
                }

                result = path.join(lib, 'src', subMod + '.js');
                if (path.existsSync(result)) {
                    return result;
                }

                result = path.join(lib, 'src', subMod, 'index.js');
                if (path.existsSync(result)) {
                    return result;
                }


                return null;
            }
        }

        return null;
    };

    this.getJahLibPaths = function (libs) {
        var paths = {};
        if (!libs) {
            return paths;
        }
        for (var i = 0, len = libs.length; i < len; i++) {

            var lib = libs[i]
              , srcPath
              , dstPath;

            if (typeof lib == 'string') {
                srcPath = lib;
                dstPath = path.join('/libs', lib);
            } else {
                srcPath = Object.keys(lib)[0];
                dstPath = lib[srcPath];
            }

            // Find source in JahLibs
            var libPath = this.findModuleInJahLibs(srcPath);
            if (!libPath) {
                logger.error("Unable to find lib", srcPath)
            } else {
                // Add file extension if missing
                if (path.extname(libPath) != '' && path.extname(dstPath) == '') {
                    dstPath += path.extname(libPath);
                }
                paths[libPath] = dstPath;
            }
        }

        return paths;
    };

    /**
     * Scan for files to build and return them as an array
     *
     * @param {String} source Path to scan
     * @param {Boolean} [recursive=true] Include sub-directories
     * @returns {String[]} List of filenames
     */
    this.scanForFiles = function (source, recursive) {
        recursive = recursive !== false;

        if (!path.existsSync(source)) {
            logger.error('Unable to find path', source);
            return [];
        }

        var foundFiles = [];

        // If given a file rather than a directory they just return that
        if (fs.statSync(source).isFile()) {
            return [source];
        }

        // Find all files in directory
        var files = fs.readdirSync(source);
        for (var i = 0, len = files.length; i < len; i++) {
            var file = files[i];
            // Skip hidden files
            if (file[0] == '.') {
                continue;
            }

            var fullPath = path.join(source, file);

            if (fs.statSync(fullPath).isFile()) {
                // If extension isn't in our list then skip file
                if (this.extensions && this.extensions.length && !~this.extensions.indexOf(path.extname(file).slice(1))) {
                    continue;
                }

                foundFiles.push(fullPath);
            } else if (recursive) {
                // Directory
                foundFiles = foundFiles.concat(this.scanForFiles(fullPath));
            }

        }
        
        return foundFiles;
    };
}).call(Compiler.prototype);

exports.Compiler = Compiler;

exports.description = 'Build the current Jah project';
exports.run = function () {
    opts.parse(OPTIONS, true);

    var config   = opts.get('config') || 'jah.json',
        compiler = new Compiler(config),
        output   = opts.get('file')   || compiler.output,
        outputDir = 'build/';

    var code = compiler.make();

    function cp(src, dst, callback) {
        logger.info('Copying file', src + ' => '.yellow + dst);
        mkdir(path.dirname(dst));

        var reader = fs.createReadStream(src),
            writer = fs.createWriteStream(dst);

        writer.addListener('close', function () { callback(); });

        sys.pump(reader, writer);
    }

    var files = [];
    function next() {
        if (!files.length) {
            return;
        }
        var names = files.shift();
        cp(names[0], names[1], next);
    }

    if (output) {
        var scriptOutput = path.join(outputDir, output.script || output);
        var resourceOutput = path.join(outputDir, output.resources) || path.join(path.dirname(scriptOutput), 'resources');

        // Write script
        logger.log()
        logger.info("Writing script", scriptOutput);
        mkdir(path.dirname(scriptOutput));
        fs.writeFileSync(scriptOutput, code, 'utf8');

        // Copy public folder
        logger.log();
        copytree('public', 'build');

        // Copy resources
        logger.log();
        logger.info("Copying resources", resourceOutput);
        mkdir(resourceOutput);

        for (var source in compiler.remoteResources) {
            if (compiler.remoteResources.hasOwnProperty(source)) {
                var dest = path.join(resourceOutput, compiler.remoteResources[source]);
                files.push([source, dest]);
            }
        }

        next();

    } else {
        sys.puts(code);
    }
};
