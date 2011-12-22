/**
 * @namespace
 * Support for listening for and triggering events
 */
var events = {};

/**
 * @private
 * @ignore
 * Returns the event listener property of an object, creating it if it doesn't
 * already exist.
 *
 * @returns {Object}
 */
function getListeners(obj, eventName) {
    if (!obj.js_listeners_) {
        obj.js_listeners_ = {};
    }
    if (!eventName) {
        return obj.js_listeners_;
    }
    if (!obj.js_listeners_[eventName]) {
        obj.js_listeners_[eventName] = {};
    }
    return obj.js_listeners_[eventName];
}


function Event () {}
events.Event = Event

/**
 * @private
 * @ignore
 * Keep track of the next ID for each new EventListener
 */
var eventID = 0;

/**
 * @class
 * Represents an event being listened to. You should not create instances of
 * this directly, it is instead returned by events.addListener
 *
 * @extends Object
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
    this.id = ++eventID;

    getListeners(source, eventName)[this.id] = this;
};

/**
 * Register an event listener
 *
 * @param {Object} source Object to listen to for an event
 * @param {String|Stringp[} eventName Name or Array of names of the event(s) to listen for
 * @param {Function} handler Callback to fire when the event triggers
 *
 * @returns {events.EventListener|events.EventListener[]} The event listener(s). Pass to removeListener to destroy it.
 */
events.addListener = function (source, eventName, handler) {
    if (eventName instanceof Array) {
        var listeners = [];
        for (var i = 0, len = eventName.length; i < len; i++) {
            listeners.push(new events.EventListener(source, eventName[i], handler));
        }
        return listeners;
    } else {
        // Watching for a property value change
        if (/(.*)_changed$/.test(eventName)) {
            // Add a magical setter to notify when the property does change
            var propName = RegExp.$1
            if (propName in source) {
                var propDesc = Object.getOwnPropertyDescriptor(source, propName)

                var trigger = function (target, prevVal) {
                    var e = new Event
                    e.target = target
                    e.type = eventName
                    e.oldValue = prevVal
                    events.trigger(target, eventName, e)
                }

                if (propDesc.writable) {
                    var currentVal = propDesc.value
                      , prevVal
                      , getter = function () {
                            return currentVal
                        }
                      , setter = function (newVal) {
                            prevVal = currentVal
                            currentVal = newVal

                            trigger(this, prevVal)
                        }

                    setter.__trigger = true

                    delete propDesc.value
                    delete propDesc.writable
                    propDesc.get = getter
                    propDesc.set = setter

                    Object.defineProperty(source, propName, propDesc)
                } else if (propDesc.set && !propDesc.set.__trigger) {
                    var originalSetter = propDesc.set
                      , currentVal = source[propName]
                      , prevVal
                      , setter = function (newVal) {
                            prevVal = currentVal
                            originalSetter.call(this, newVal)
                            currentVal = this[propName]

                            trigger(this, prevVal)
                        }
                    propDesc.set = setter
                    Object.defineProperty(source, propName, propDesc)
                }

            }
        }
        return new events.EventListener(source, eventName, handler);
    }
};

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

    for (eventID in listeners) {
        if (listeners.hasOwnProperty(eventID)) {
            l = listeners[eventID];
            if (l) {
                l.handler.apply(undefined, args);
            }
        }
    }
};

/**
 * Remove a previously registered event listener
 *
 * @param {events.EventListener} listener EventListener to remove, as returned by events.addListener
 */
events.removeListener = function (listener) {
    delete getListeners(listener.source, listener.eventName)[listener.eventID];
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
