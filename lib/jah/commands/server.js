/*globals require module exports process console*/
/*jslint undef: true, strict: true, white: true, newcap: true, indent: 4 */
"use strict";

var opts      = require('../opts'),
    Server    = require('../server').Server;


var options = [
    {   short: 'u',
        long: 'url',
        description: 'URL to serve the JavaScript as. Default is output defined in the config file',
        value: true },

    {   short: 'c',
        long: 'config',
        description: 'Project configuration file. Default is jah.json',
        value: true },

    {   short: 'h',
        long: 'host',
        description: 'Hostname or IP address to listen on. Default is 127.0.0.1',
        value: true },

    {   short: 'p',
        long: 'port',
        description: 'Port to listen on. Default is 4000',
        value: true }
];

exports.description = 'Run the Jah development web server';
exports.run = function () {
    opts.parse(options, true);
    var host     = opts.get('host')   || '127.0.0.1',
        port     = opts.get('port')   || 4000,
        config   = opts.get('config') || 'jah.json',
        server   = new Server(config)

    server.start(host, port)
};
