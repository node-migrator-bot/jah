var sys       = require('util'),
    logger    = require('./logger'),
    http      = require('http'),
    qs        = require('querystring'),
    url       = require('url'),
    path      = require('path'),
    fs        = require('fs'),
    mimetypes = require('./mimetypes'),
    Template  = require('./template').Template,
    Compiler  = require('./compiler').Compiler;

function Server (config) {
    this.compiler = new Compiler(config)
}

Server.prototype.start = function (host, port) {
    host = host || '127.0.0.1'
    port = port || 4000

    http.createServer(function (req, res) {
        var uri = url.parse(req.url, true)
        logger.group('Request', uri.pathname)

        // Forward index requests to index.html
        if (['/', '/index.html', '/public'].indexOf(uri.pathname) > -1) {
            uri.pathname = '/public/index.html';
        }

        var pathTokens = uri.pathname.replace(/^\/|\/$/, '').split('/')
          , pathRoot = pathTokens.shift()
          , filepath = pathTokens.join('/')


        switch (pathRoot) {
        case 'public':
            this.servePublicFile(res, filepath)
            break;
        case '__jah__':
            if (/^modules\//.test(filepath)) {
                // Server resource as a module
                this.serveJahModule(res, filepath.replace(/^modules\//, ''))
            } else if (/^assets\//.test(filepath)) {
                // Server raw resource
                this.serveJahFile(res, filepath.replace(/^assets\//, ''))
            } else if (filepath == 'footer.js') {
                this.serve(res, this.compiler.jahFooter(), 'text/javascript')
            } else if (filepath == 'header.js') {
                this.serve(res, 'window.__jah__ = {resources:{}, assetURL:"/__jah__/assets"}', 'text/javascript')
            } else {
                this.serveUnmatchedFile(res, filepath)
            }
            break;
        default:
            this.serveNotFound(res)
            break;
        }

        logger.ungroup()

    }.bind(this)).listen(parseInt(port, 10), host);

    logger.notice('Serving from', 'http://' + host + ':' + port + '/');
}

/**
 * Override this method to add support for new special files
 */
Server.prototype.serveUnmatchedFile = function (response, filename) {
    this.serveNotFound(response)
}

Server.prototype.servePublicFile = function (response, filename) {
    filename = path.join(process.cwd(), 'public', path.normalize(filename))
    logger.notice('Serving file', filename)
    var mimetype = mimetypes.guessType(filename)

    if (path.existsSync(filename)) {
        this.serve(response, fs.readFileSync(filename), mimetype)
    } else if (path.existsSync(filename + '.template')) {
        var template = new Template(fs.readFileSync(filename + '.template').toString())
        this.serve(response, template.substitute(this.substitutions()), mimetype)
    } else {
        this.serveNotFound(response)
    }
}

Server.prototype.substitutions = function () {
    return { scripts: this.scriptHTML()
    }
}

Server.prototype.serve = function (response, data, mimetype, status) {
    response.writeHead(status || 200, {'Content-Type': mimetype || 'text/plain'})
    response.end(data)
}

Server.prototype.serveNotFound = function (response, data) {
    logger.warn('Serving error', '404 File not found')
    response.writeHead(404, 'File not found')
    response.end(data || 'File not found')
}

Server.prototype.serveJahModule = function (response, filename) {
    var match = this.compiler.filePathForScript(filename)
    if (!match) {
        this.serveNotFound(response)
        return false
    }
    logger.notice('Serving script', match.filename)
    var data = this.compiler.buildFile(match.filename, match.mount, true)
    this.serve(response, data, 'text/javascript')
}

Server.prototype.serveJahFile = function (response, filename) {
    var match = this.compiler.filePathForScript(filename)
    if (!match) {
        this.serveNotFound(response)
        return false
    }
    logger.notice('Serving Jah resource', match.filename)
    var mimetype = mimetypes.guessType(filename)
    this.serve(response, fs.readFileSync(match.filename), mimetype)
}

Server.prototype.scriptHTML = function () {
    var tag = new Template('\n        <script src="${filename}" type="text/javascript" defer></script>')
      , html = ''
      , allFiles = this.compiler.getAllMountFilenames()

    var filename

    html += tag.substitute({ filename: '/__jah__/header.js' })
    for (var i=0, l = allFiles.length; i<l; i++) {
        filename = allFiles[i]
        html += tag.substitute({ filename: path.join('/__jah__/modules', filename) })
    }
    html += tag.substitute({ filename: '/__jah__/footer.js' })

    return html
}

exports.Server = Server
