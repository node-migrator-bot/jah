/**
 * @namespace
 * Support for listening for and triggering events
 */
var events = {};


/**
 * @class
 * Jah Event
 *
 * @memberOf events
 */
function Event (type, cancelable) {
    if (cancelable) {
        Object.defineProperty(this, 'cancelable', { value: true, writable: false })
    }
    this.type = type
}
Object.defineProperty(Event.prototype, 'defaultPrevented', { value: false, writable: false })
Object.defineProperty(Event.prototype, 'cancelable',       { value: false, writable: false })

Event.prototype = /** @lends events.Event# */ {
    constructor: Event
  , preventDefault: function () {
        if (this.cancelable) {
            Object.defineProperty(this, 'defaultPrevented', { value: true, writable: false })
        }
    }
}
events.Event = Event



/**
 * @class
 * Jah Property Event
 *
 * @memberOf events
 * @extends events.Event
 */
function PropertyEvent () {
    Event.apply(this, arguments)
}
PropertyEvent.prototype = Object.create(Event.prototype)
events.PropertyEvent = PropertyEvent




/**
 * @private
 * @ignore
 * Add a magical setter to notify when the property does change
 */
function watchProperty (target, name) {
    var propDesc
      , realTarget = target

    // Search up prototype chain to find where the property really lives
    while (!(propDesc = Object.getOwnPropertyDescriptor(realTarget, name))) {
        realTarget = Object.getPrototypeOf(realTarget)

        if (!realTarget) {
            break
        }
    }

    if (!propDesc) {
        throw new Error("Unable to find property: " + name)
    }

    /**
     * @ignore
     * @inner
     * Triggers the 'beforechange' event on a property
     */
    var triggerBefore = function (target, newVal) {
        var e = new PropertyEvent('beforechange', true)
        e.target = {object: target, property: name}
        e.newValue = newVal
        events.triggerProperty(target, name, e.type, e)

        return e
    }

    /**
     * @ignore
     * @inner
     * Triggers the 'change' event on a property
     */
    var triggerAfter = function (target, prevVal) {
        var e = new PropertyEvent('change')
        e.target = {object: target, property: name}
        e.oldValue = prevVal
        events.triggerProperty(target, name, e.type, e)

        return e
    }

    // Listening to a normal property
    if (propDesc.writable) {
        var currentVal = propDesc.value
          , prevVal
          , getter = function () {
                return currentVal
            }
          , setter = function (newVal) {
                var e = triggerBefore(this, newVal)
                if (!e.defaultPrevented) {
                    prevVal = currentVal
                    currentVal = newVal

                    e = triggerAfter(this, prevVal)
                }
            }

        setter.__trigger = true

        delete propDesc.value
        delete propDesc.writable
        propDesc.get = getter
        propDesc.set = setter

        Object.defineProperty(target, name, propDesc)
    }

    // Listening for calls to an accessor (getter/setter)
    else if (propDesc.set && !propDesc.set.__trigger) {
        var originalSetter = propDesc.set
          , currentVal = target[name]
          , prevVal
          , setter = function (newVal) {
                var e = triggerBefore(this, newVal)
                if (!e.defaultPrevented) {
                    prevVal = currentVal
                    originalSetter.call(this, newVal)
                    currentVal = this[name]

                    triggerAfter(this, prevVal)
                }
            }
        propDesc.set = setter
        Object.defineProperty(target, name, propDesc)
    }

}

/**
 * @private
 * @ignore
 * Returns the event listener property of an object, creating it if it doesn't
 * already exist.
 *
 * @returns {Object}
 */
function getListeners(obj, eventName) {
    var listenerDesc = Object.getOwnPropertyDescriptor(obj, '__jahEventListeners__')
    if (!listenerDesc) {
        Object.defineProperty(obj, '__jahEventListeners__', {
            value: {}
        })
    }
    if (!eventName) {
        return obj.__jahEventListeners__;
    }
    if (!obj.__jahEventListeners__[eventName]) {
        obj.__jahEventListeners__[eventName] = {};
    }
    return obj.__jahEventListeners__[eventName];
}

function getPropertyListeners(obj, property, eventName) {
    var listenerDesc = Object.getOwnPropertyDescriptor(obj, '__jahPropertyEventListeners__')
    if (!listenerDesc) {
        Object.defineProperty(obj, '__jahPropertyEventListeners__', {
            value: {}
        })
    }
    if (!property) {
        return obj.__jahPropertyEventListeners__
    }
    if (!obj.__jahPropertyEventListeners__[property]) {
        obj.__jahPropertyEventListeners__[property] = {}
    }

    if (!eventName) {
        return obj.__jahPropertyEventListeners__[property]
    }

    if (!obj.__jahPropertyEventListeners__[property][eventName]) {
        obj.__jahPropertyEventListeners__[property][eventName] = {};
    }
    return obj.__jahPropertyEventListeners__[property][eventName];
}


/**
 * @private
 * @ignore
 * Keep track of the next ID for each new EventListener
 */
var eventID = 0
  , propertyEventID = 0

/**
 * @class
 * Represents an event being listened to. You should not create instances of
 * this directly, it is instead returned by events.addListener
 *
 * @param {Object} source Object to listen to for an event
 * @param {String} eventName Name of the event to listen for
 * @param {Function} handler Callback to fire when the event triggers
 */
events.EventListener = function (source, eventName, handler) {
    /**
     * Object to listen to for an event
     * @type Object 
     */
    this.source = source;

    /**
     * Name of the event to listen for
     * @type String
     */
    this.eventName = eventName;

    /**
     * Callback to fire when the event triggers
     * @type Function
     */
    this.handler = handler;

    /**
     * Unique ID number for this instance
     * @type Integer 
     */
    this.id = eventID++;

    getListeners(source, eventName)[this.id] = this;
};

/**
 * @class
 *
 * @extends events.EventListener
 */
events.PropertyEventListener = function (source, property, eventName, handler) {
    this.source = source;
    this.eventName = eventName;
    this.property = property;
    this.handler = handler;
    this.id = propertyEventID++;
    getPropertyListeners(source, property, eventName)[this.id] = this;
}
events.PropertyEventListener.prototype = Object.create(events.EventListener)

/**
 * Register an event listener
 *
 * @param {Object} source Object to listen to for an event
 * @param {String|String[]} eventName Name or Array of names of the event(s) to listen for
 * @param {Function} handler Callback to fire when the event triggers
 *
 * @returns {events.EventListener|events.EventListener[]} The event listener(s). Pass to removeListener to destroy it.
 */
events.addListener = function (source, eventName, handler) {
    if (eventName instanceof Array) {
        var listeners = [];
        for (var i = 0, len = eventName.length; i < len; i++) {
            listeners.push(events.addListener(source, eventName[i], handler));
        }
        return listeners;
    } else {
        return new events.EventListener(source, eventName, handler);
    }
};

events.addPropertyListener = function (source, property, eventName, handler) {
    var listeners = [], i;
    if (eventName instanceof Array) {
        for (i = 0, len = eventName.length; i < len; i++) {
            listeners.push(events.addPropertyListener(source, property, eventName[i], handler));
        }
        return listeners;
    } else if (property instanceof Array) {
        for (i = 0, len = property.length; i < len; i++) {
            listeners.push(events.addPropertyListener(source, property[i], eventName, handler));
        }
        return listeners;
    } else {
        watchProperty(source, property)
        return new events.PropertyEventListener(source, property, eventName, handler);
    }
}

/**
 * Trigger an event. All listeners will be notified.
 *
 * @param {Object} source Object to trigger the event on
 * @param {String} eventName Name of the event to trigger
 */
events.trigger = function (source, eventName) {
    var listeners = getListeners(source, eventName),
        args = Array.prototype.slice.call(arguments, 2),
        eventID,
        l;

    // Call the 'oneventName' method if it exists
    if (typeof source['on' + eventName] == 'function') {
        source['on' + eventName].apply(source, args)
    }

    // Call any registered listeners
    for (eventID in listeners) {
        if (listeners.hasOwnProperty(eventID)) {
            l = listeners[eventID];
            if (l) {
                l.handler.apply(null, args);
            }
        }
    }
};

/**
 * Trigger an event on a property. All listeners will be notified.
 *
 * @param {Object} source Object the property belongs to
 * @param {String} property The name of the property on source
 * @param {String} eventName The name of the event to strigger
 */
events.triggerProperty = function (source, property, eventName) {
    var listeners = getPropertyListeners(source, property, eventName),
        args = Array.prototype.slice.call(arguments, 3),
        eventID,
        l;

    for (eventID in listeners) {
        if (listeners.hasOwnProperty(eventID)) {
            l = listeners[eventID];
            if (l) {
                l.handler.apply(null, args);
            }
        }
    }
};

/**
 * Remove a previously registered event listener
 *
 * @param {events.EventListener|events.PropertyEventListener} listener EventListener to remove, as returned by events.addListener or events.addPropertyListener
 */
events.removeListener = function (listener) {
    if (listener instanceof events.PropertyEventListener) {
        delete getPropertyListeners(listener.source, listener.property, listener.eventName)[listener.eventID];
    } else {
        delete getListeners(listener.source, listener.eventName)[listener.eventID];
    }
};

/**
 * Remove a all event listeners for a given event
 *
 * @param {Object} source Object to remove listeners from
 * @param {String} eventName Name of event to remove listeners from
 */
events.clearListeners = function (source, eventName) {
    var listeners = getListeners(source, eventName),
        eventID;


    for (eventID in listeners) {
        if (listeners.hasOwnProperty(eventID)) {
            var l = listeners[eventID];
            if (l) {
                events.removeListener(l);
            }
        }
    }
};

/**
 * Remove all event listeners on an object
 *
 * @param {Object} source Object to remove listeners from
 */
events.clearInstanceListeners = function (source) {
    var listeners = getListeners(source),
        eventID;

    for (var eventName in listeners) {
        if (listeners.hasOwnProperty(eventName)) {
            var el = listeners[eventName];
            for (eventID in el) {
                if (el.hasOwnProperty(eventID)) {
                    var l = el[eventID];
                    if (l) {
                        events.removeListener(l);
                    }
                }
            }
        }
    }
};

module.exports = events;
