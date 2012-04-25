"use strict"

var util = require('./index'),
    events = require('events')

/**
 * @namespace
 */
var remote_resources = {}

/**
 * @class
 * @memberOf remote_resources
 */
function RemoteResource(url, path) {
    this.url = url
    this.path = path
}
remote_resources.RemoteResource = RemoteResource

/**
 * Load the remote resource via ajax
 */
remote_resources.RemoteResource.prototype.load = function () {
    var xhr = new XMLHttpRequest()
    xhr.onreadystatechange = function () {
        if (xhr.readyState == 4) {
            __jah__.resources[this.path].data = xhr.responseText
            __jah__.resources[this.path].loaded = true

            events.trigger(this, 'load', this)
        }
    }.bind(this)

    xhr.open('GET', this.url, true)  
    xhr.send(null)
}

/**
 * @class
 * @memberOf remote_resources
 * @extends remote_resources.RemoteResource
 */
function RemoteImage(url, path) {
    RemoteResource.apply(this, arguments)
}
remote_resources.RemoteImage = RemoteImage

remote_resources.RemoteImage.prototype = Object.create(RemoteResource.prototype)

remote_resources.RemoteImage.prototype.load = function () {
    var img = new Image()
    __jah__.resources[this.path].data = img

    /**
     * @ignore
     */
    img.onload = function () {
        __jah__.resources[this.path].loaded = true
        events.trigger(this, 'load', this)
    }.bind(this)

    /**
     * @ignore
     */
    img.onerror = function () {
        console.warn("Failed to load resource: [%s] from [%s]", this.path, img.src)
        __jah__.resources[this.path].loaded = true
        events.trigger(this, 'load', this)
    }.bind(this)
    
    img.src = this.url

    return img
}


/**
 * @class
 * @memberOf remote_resources
 * @extends remote_resources.RemoteResource
 */
function RemoteScript(url, path) {
    RemoteResource.apply(this, arguments)
}
remote_resources.RemoteScript = RemoteScript

remote_resources.RemoteScript.prototype = Object.create(RemoteResource.prototype)

remote_resources.RemoteScript.prototype.load = function () {
    var script = document.createElement('script')
    __jah__.resources[this.path].data = script

    /**
     * @ignore
     */
    script.onload = function () {
        __jah__.resources[this.path].loaded = true
        events.trigger(this, 'load', this)
    }.bind(this)

    script.src = this.url
    document.getElementsByTagName('head')[0].appendChild(script)

    return script
}

remote_resources.getRemoteResourceConstructor = function (mime) {
    mime = mime.split('/')

    var RemoteObj
    if (mime[0] == 'image') {
        RemoteObj = RemoteImage
    } else if(mime[1] == 'javascript') {
        RemoteObj = RemoteScript
    } else {
        RemoteObj = RemoteResource
    }

    return RemoteObj
}

remote_resources.getRemoteResource = function (resourcePath) {
    var resource = __jah__.resources[resourcePath]

    if (!resource) {
        return null
    }

    if (resource.remoteResource) {
        return resource.remoteResource
    }

    var RemoteObj = remote_resources.getRemoteResourceConstructor(resource.mimetype)

    resource.remoteResource = new RemoteObj(resource.data, resourcePath)

    return resource.remoteResource
}

module.exports = remote_resources
