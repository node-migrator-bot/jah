if (!Object.keys) {
    /**
     * @see https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Object/keys
     */
    Object.keys = function(o) {
        if (o !== Object(o)) {
            throw new TypeError('Object.keys called on non-object');
        }
        var ret = []
          , p;
        for (p in o) {
            if (Object.prototype.hasOwnProperty.call(o,p)) {
                ret.push(p);
            }
        }
        return ret;
    };
}

if (!Object.create) {
    /**
     * @see https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Object/create
     */
    Object.create = function (o) {
        if (arguments.length > 1) {
            throw new Error('Object.create implementation only accepts the first parameter.');
        }
        function F() {}
        F.prototype = o;
        return new F();
    };
}
