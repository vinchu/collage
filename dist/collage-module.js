;module.exports = (function(){
var __m26 = function(module,exports){module.exports=exports;
/*!
 * mustache.js - Logic-less {{mustache}} templates with JavaScript
 * http://github.com/janl/mustache.js
 */

/*global define: false*/

(function (root, factory) {
  if (typeof exports === "object" && exports) {
    module.exports = factory; // CommonJS
  } else if (typeof define === "function" && define.amd) {
    define(factory); // AMD
  } else {
    root.Mustache = factory; // <script>
  }
}(this, (function () {

  var exports = {};

  exports.name = "mustache.js";
  exports.version = "0.7.2";
  exports.tags = ["{{", "}}"];

  exports.Scanner = Scanner;
  exports.Context = Context;
  exports.Writer = Writer;

  var whiteRe = /\s*/;
  var spaceRe = /\s+/;
  var nonSpaceRe = /\S/;
  var eqRe = /\s*=/;
  var curlyRe = /\s*\}/;
  var tagRe = /#|\^|\/|>|\{|&|=|!/;

  // Workaround for https://issues.apache.org/jira/browse/COUCHDB-577
  // See https://github.com/janl/mustache.js/issues/189
  function testRe(re, string) {
    return RegExp.prototype.test.call(re, string);
  }

  function isWhitespace(string) {
    return !testRe(nonSpaceRe, string);
  }

  var isArray = Array.isArray || function (obj) {
    return Object.prototype.toString.call(obj) === "[object Array]";
  };

  function escapeRe(string) {
    return string.replace(/[\-\[\]{}()*+?.,\\\^$|#\s]/g, "\\$&");
  }

  var entityMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': '&quot;',
    "'": '&#39;',
    "/": '&#x2F;'
  };

  function escapeHtml(string) {
    return String(string).replace(/[&<>"'\/]/g, function (s) {
      return entityMap[s];
    });
  }

  // Export the escaping function so that the user may override it.
  // See https://github.com/janl/mustache.js/issues/244
  exports.escape = escapeHtml;

  function Scanner(string) {
    this.string = string;
    this.tail = string;
    this.pos = 0;
  }

  /**
   * Returns `true` if the tail is empty (end of string).
   */
  Scanner.prototype.eos = function () {
    return this.tail === "";
  };

  /**
   * Tries to match the given regular expression at the current position.
   * Returns the matched text if it can match, the empty string otherwise.
   */
  Scanner.prototype.scan = function (re) {
    var match = this.tail.match(re);

    if (match && match.index === 0) {
      this.tail = this.tail.substring(match[0].length);
      this.pos += match[0].length;
      return match[0];
    }

    return "";
  };

  /**
   * Skips all text until the given regular expression can be matched. Returns
   * the skipped string, which is the entire tail if no match can be made.
   */
  Scanner.prototype.scanUntil = function (re) {
    var match, pos = this.tail.search(re);

    switch (pos) {
    case -1:
      match = this.tail;
      this.pos += this.tail.length;
      this.tail = "";
      break;
    case 0:
      match = "";
      break;
    default:
      match = this.tail.substring(0, pos);
      this.tail = this.tail.substring(pos);
      this.pos += pos;
    }

    return match;
  };

  function Context(view, parent) {
    this.view = view;
    this.parent = parent;
    this.clearCache();
  }

  Context.make = function (view) {
    return (view instanceof Context) ? view : new Context(view);
  };

  Context.prototype.clearCache = function () {
    this._cache = {};
  };

  Context.prototype.push = function (view) {
    return new Context(view, this);
  };

  Context.prototype.lookup = function (name) {
    var value = this._cache[name];

    if (!value) {
      if (name === ".") {
        value = this.view;
      } else {
        var context = this;

        while (context) {
          if (name.indexOf(".") > 0) {
            var names = name.split("."), i = 0;

            value = context.view;

            while (value && i < names.length) {
              value = value[names[i++]];
            }
          } else {
            value = context.view[name];
          }

          if (value != null) {
            break;
          }

          context = context.parent;
        }
      }

      this._cache[name] = value;
    }

    if (typeof value === "function") {
      value = value.call(this.view);
    }

    return value;
  };

  function Writer() {
    this.clearCache();
  }

  Writer.prototype.clearCache = function () {
    this._cache = {};
    this._partialCache = {};
  };

  Writer.prototype.compile = function (template, tags) {
    var fn = this._cache[template];

    if (!fn) {
      var tokens = exports.parse(template, tags);
      fn = this._cache[template] = this.compileTokens(tokens, template);
    }

    return fn;
  };

  Writer.prototype.compilePartial = function (name, template, tags) {
    var fn = this.compile(template, tags);
    this._partialCache[name] = fn;
    return fn;
  };

  Writer.prototype.compileTokens = function (tokens, template) {
    var fn = compileTokens(tokens);
    var self = this;

    return function (view, partials) {
      if (partials) {
        if (typeof partials === "function") {
          self._loadPartial = partials;
        } else {
          for (var name in partials) {
            self.compilePartial(name, partials[name]);
          }
        }
      }

      return fn(self, Context.make(view), template);
    };
  };

  Writer.prototype.render = function (template, view, partials) {
    return this.compile(template)(view, partials);
  };

  Writer.prototype._section = function (name, context, text, callback) {
    var value = context.lookup(name);

    switch (typeof value) {
    case "object":
      if (isArray(value)) {
        var buffer = "";

        for (var i = 0, len = value.length; i < len; ++i) {
          buffer += callback(this, context.push(value[i]));
        }

        return buffer;
      }

      return value ? callback(this, context.push(value)) : "";
    case "function":
      var self = this;
      var scopedRender = function (template) {
        return self.render(template, context);
      };

      var result = value.call(context.view, text, scopedRender);
      return result != null ? result : "";
    default:
      if (value) {
        return callback(this, context);
      }
    }

    return "";
  };

  Writer.prototype._inverted = function (name, context, callback) {
    var value = context.lookup(name);

    // Use JavaScript's definition of falsy. Include empty arrays.
    // See https://github.com/janl/mustache.js/issues/186
    if (!value || (isArray(value) && value.length === 0)) {
      return callback(this, context);
    }

    return "";
  };

  Writer.prototype._partial = function (name, context) {
    if (!(name in this._partialCache) && this._loadPartial) {
      this.compilePartial(name, this._loadPartial(name));
    }

    var fn = this._partialCache[name];

    return fn ? fn(context) : "";
  };

  Writer.prototype._name = function (name, context) {
    var value = context.lookup(name);

    if (typeof value === "function") {
      value = value.call(context.view);
    }

    return (value == null) ? "" : String(value);
  };

  Writer.prototype._escaped = function (name, context) {
    return exports.escape(this._name(name, context));
  };

  /**
   * Low-level function that compiles the given `tokens` into a function
   * that accepts three arguments: a Writer, a Context, and the template.
   */
  function compileTokens(tokens) {
    var subRenders = {};

    function subRender(i, tokens, template) {
      if (!subRenders[i]) {
        var fn = compileTokens(tokens);
        subRenders[i] = function (writer, context) {
          return fn(writer, context, template);
        };
      }

      return subRenders[i];
    }

    return function (writer, context, template) {
      var buffer = "";
      var token, sectionText;

      for (var i = 0, len = tokens.length; i < len; ++i) {
        token = tokens[i];

        switch (token[0]) {
        case "#":
          sectionText = template.slice(token[3], token[5]);
          buffer += writer._section(token[1], context, sectionText, subRender(i, token[4], template));
          break;
        case "^":
          buffer += writer._inverted(token[1], context, subRender(i, token[4], template));
          break;
        case ">":
          buffer += writer._partial(token[1], context);
          break;
        case "&":
          buffer += writer._name(token[1], context);
          break;
        case "name":
          buffer += writer._escaped(token[1], context);
          break;
        case "text":
          buffer += token[1];
          break;
        }
      }

      return buffer;
    };
  }

  /**
   * Forms the given array of `tokens` into a nested tree structure where
   * tokens that represent a section have two additional items: 1) an array of
   * all tokens that appear in that section and 2) the index in the original
   * template that represents the end of that section.
   */
  function nestTokens(tokens) {
    var tree = [];
    var collector = tree;
    var sections = [];

    var token;
    for (var i = 0, len = tokens.length; i < len; ++i) {
      token = tokens[i];
      switch (token[0]) {
      case '#':
      case '^':
        sections.push(token);
        collector.push(token);
        collector = token[4] = [];
        break;
      case '/':
        var section = sections.pop();
        section[5] = token[2];
        collector = sections.length > 0 ? sections[sections.length - 1][4] : tree;
        break;
      default:
        collector.push(token);
      }
    }

    return tree;
  }

  /**
   * Combines the values of consecutive text tokens in the given `tokens` array
   * to a single token.
   */
  function squashTokens(tokens) {
    var squashedTokens = [];

    var token, lastToken;
    for (var i = 0, len = tokens.length; i < len; ++i) {
      token = tokens[i];
      if (token[0] === 'text' && lastToken && lastToken[0] === 'text') {
        lastToken[1] += token[1];
        lastToken[3] = token[3];
      } else {
        lastToken = token;
        squashedTokens.push(token);
      }
    }

    return squashedTokens;
  }

  function escapeTags(tags) {
    return [
      new RegExp(escapeRe(tags[0]) + "\\s*"),
      new RegExp("\\s*" + escapeRe(tags[1]))
    ];
  }

  /**
   * Breaks up the given `template` string into a tree of token objects. If
   * `tags` is given here it must be an array with two string values: the
   * opening and closing tags used in the template (e.g. ["<%", "%>"]). Of
   * course, the default is to use mustaches (i.e. Mustache.tags).
   */
  exports.parse = function (template, tags) {
    template = template || '';
    tags = tags || exports.tags;

    if (typeof tags === 'string') tags = tags.split(spaceRe);
    if (tags.length !== 2) {
      throw new Error('Invalid tags: ' + tags.join(', '));
    }

    var tagRes = escapeTags(tags);
    var scanner = new Scanner(template);

    var sections = [];     // Stack to hold section tokens
    var tokens = [];       // Buffer to hold the tokens
    var spaces = [];       // Indices of whitespace tokens on the current line
    var hasTag = false;    // Is there a {{tag}} on the current line?
    var nonSpace = false;  // Is there a non-space char on the current line?

    // Strips all whitespace tokens array for the current line
    // if there was a {{#tag}} on it and otherwise only space.
    function stripSpace() {
      if (hasTag && !nonSpace) {
        while (spaces.length) {
          tokens.splice(spaces.pop(), 1);
        }
      } else {
        spaces = [];
      }

      hasTag = false;
      nonSpace = false;
    }

    var start, type, value, chr;
    while (!scanner.eos()) {
      start = scanner.pos;
      value = scanner.scanUntil(tagRes[0]);

      if (value) {
        for (var i = 0, len = value.length; i < len; ++i) {
          chr = value.charAt(i);

          if (isWhitespace(chr)) {
            spaces.push(tokens.length);
          } else {
            nonSpace = true;
          }

          tokens.push(["text", chr, start, start + 1]);
          start += 1;

          if (chr === "\n") {
            stripSpace(); // Check for whitespace on the current line.
          }
        }
      }

      start = scanner.pos;

      // Match the opening tag.
      if (!scanner.scan(tagRes[0])) {
        break;
      }

      hasTag = true;
      type = scanner.scan(tagRe) || "name";

      // Skip any whitespace between tag and value.
      scanner.scan(whiteRe);

      // Extract the tag value.
      if (type === "=") {
        value = scanner.scanUntil(eqRe);
        scanner.scan(eqRe);
        scanner.scanUntil(tagRes[1]);
      } else if (type === "{") {
        var closeRe = new RegExp("\\s*" + escapeRe("}" + tags[1]));
        value = scanner.scanUntil(closeRe);
        scanner.scan(curlyRe);
        scanner.scanUntil(tagRes[1]);
        type = "&";
      } else {
        value = scanner.scanUntil(tagRes[1]);
      }

      // Match the closing tag.
      if (!scanner.scan(tagRes[1])) {
        throw new Error('Unclosed tag at ' + scanner.pos);
      }

      // Check section nesting.
      if (type === '/') {
        if (sections.length === 0) {
          throw new Error('Unopened section "' + value + '" at ' + start);
        }

        var section = sections.pop();

        if (section[1] !== value) {
          throw new Error('Unclosed section "' + section[1] + '" at ' + start);
        }
      }

      var token = [type, value, start, scanner.pos];
      tokens.push(token);

      if (type === '#' || type === '^') {
        sections.push(token);
      } else if (type === "name" || type === "{" || type === "&") {
        nonSpace = true;
      } else if (type === "=") {
        // Set the tags for the next time around.
        tags = value.split(spaceRe);

        if (tags.length !== 2) {
          throw new Error('Invalid tags at ' + start + ': ' + tags.join(', '));
        }

        tagRes = escapeTags(tags);
      }
    }

    // Make sure there are no open sections when we're done.
    var section = sections.pop();
    if (section) {
      throw new Error('Unclosed section "' + section[1] + '" at ' + scanner.pos);
    }

    return nestTokens(squashTokens(tokens));
  };

  // The high-level clearCache, compile, compilePartial, and render functions
  // use this default writer.
  var _writer = new Writer();

  /**
   * Clears all cached templates and partials in the default writer.
   */
  exports.clearCache = function () {
    return _writer.clearCache();
  };

  /**
   * Compiles the given `template` to a reusable function using the default
   * writer.
   */
  exports.compile = function (template, tags) {
    return _writer.compile(template, tags);
  };

  /**
   * Compiles the partial with the given `name` and `template` to a reusable
   * function using the default writer.
   */
  exports.compilePartial = function (name, template, tags) {
    return _writer.compilePartial(name, template, tags);
  };

  /**
   * Compiles the given array of tokens (the output of a parse) to a reusable
   * function using the default writer.
   */
  exports.compileTokens = function (tokens, template) {
    return _writer.compileTokens(tokens, template);
  };

  /**
   * Renders the `template` with the given `view` and `partials` using the
   * default writer.
   */
  exports.render = function (template, view, partials) {
    return _writer.render(template, view, partials);
  };

  // This is here for backwards compatibility with 0.4.x.
  exports.to_html = function (template, view, partials, send) {
    var result = exports.render(template, view, partials);

    if (typeof send === "function") {
      send(result);
    } else {
      return result;
    }
  };

  return exports;

}())));

;return module.exports;}({},{});
var __m25 = function(module,exports){module.exports=exports;
/**
 * EventEmitter v4.0.5 - git.io/ee
 * Oliver Caldwell
 * MIT license
 * @preserve
 */

;(function(exports) {
    // JSHint config - http://www.jshint.com/
    /*jshint laxcomma:true*/
    /*global define:true*/

    // Place the script in strict mode
    'use strict';

    /**
     * Class for managing events.
     * Can be extended to provide event functionality in other classes.
     *
     * @class Manages event registering and emitting.
     */
    function EventEmitter(){}

    // Shortcuts to improve speed and size

        // Easy access to the prototype
    var proto = EventEmitter.prototype

      // Existence of a native indexOf
      , nativeIndexOf = Array.prototype.indexOf ? true : false;

    /**
     * Finds the index of the listener for the event in it's storage array
     *
     * @param {Function} listener Method to look for.
     * @param {Function[]} listeners Array of listeners to search through.
     * @return {Number} Index of the specified listener, -1 if not found
     */
    function indexOfListener(listener, listeners) {
        // Return the index via the native method if possible
        if(nativeIndexOf) {
            return listeners.indexOf(listener);
        }

        // There is no native method
        // Use a manual loop to find the index
        var i = listeners.length;
        while(i--) {
            // If the listener matches, return it's index
            if(listeners[i] === listener) {
                return i;
            }
        }

        // Default to returning -1
        return -1;
    }

    /**
     * Fetches the events object and creates one if required.
     *
     * @return {Object} The events storage object.
     */
    proto._getEvents = function() {
        return this._events || (this._events = {});
    };

    /**
     * Returns the listener array for the specified event.
     * Will initialise the event object and listener arrays if required.
     *
     * @param {String} evt Name of the event to return the listeners from.
     * @return {Function[]} All listener functions for the event.
     * @doc
     */
    proto.getListeners = function(evt) {
        // Create a shortcut to the storage object
        // Initialise it if it does not exists yet
        var events = this._getEvents();

        // Return the listener array
        // Initialise it if it does not exist
        return events[evt] || (events[evt] = []);
    };

    /**
     * Adds a listener function to the specified event.
     * The listener will not be added if it is a duplicate.
     * If the listener returns true then it will be removed after it is called.
     *
     * @param {String} evt Name of the event to attach the listener to.
     * @param {Function} listener Method to be called when the event is emitted. If the function returns true then it will be removed after calling.
     * @return {Object} Current instance of EventEmitter for chaining.
     * @doc
     */
    proto.addListener = function(evt, listener) {
        // Fetch the listeners
        var listeners = this.getListeners(evt);

        // Push the listener into the array if it is not already there
        if(indexOfListener(listener, listeners) === -1) {
            listeners.push(listener);
        }

        // Return the instance of EventEmitter to allow chaining
        return this;
    };

    /**
     * Alias of addListener
     * @doc
     */
    proto.on = proto.addListener;

    /**
     * Removes a listener function from the specified event.
     *
     * @param {String} evt Name of the event to remove the listener from.
     * @param {Function} listener Method to remove from the event.
     * @return {Object} Current instance of EventEmitter for chaining.
     * @doc
     */
    proto.removeListener = function(evt, listener) {
        // Fetch the listeners
        // And get the index of the listener in the array
        var listeners = this.getListeners(evt)
          , index = indexOfListener(listener, listeners);

        // If the listener was found then remove it
        if(index !== -1) {
            listeners.splice(index, 1);

            // If there are no more listeners in this array then remove it
            if(listeners.length === 0) {
                this.removeEvent(evt);
            }
        }

        // Return the instance of EventEmitter to allow chaining
        return this;
    };

    /**
     * Alias of removeListener
     * @doc
     */
    proto.off = proto.removeListener;

    /**
     * Adds listeners in bulk using the manipulateListeners method.
     * If you pass an object as the second argument you can add to multiple events at once. The object should contain key value pairs of events and listeners or listener arrays.
     * You can also pass it an event name and an array of listeners to be added.
     *
     * @param {String|Object} evt An event name if you will pass an array of listeners next. An object if you wish to add to multiple events at once.
     * @param {Function[]} [listeners] An optional array of listener functions to add.
     * @return {Object} Current instance of EventEmitter for chaining.
     * @doc
     */
    proto.addListeners = function(evt, listeners) {
        // Pass through to manipulateListeners
        return this.manipulateListeners(false, evt, listeners);
    };

    /**
     * Removes listeners in bulk using the manipulateListeners method.
     * If you pass an object as the second argument you can remove from multiple events at once. The object should contain key value pairs of events and listeners or listener arrays.
     * You can also pass it an event name and an array of listeners to be removed.
     *
     * @param {String|Object} evt An event name if you will pass an array of listeners next. An object if you wish to remove from multiple events at once.
     * @param {Function[]} [listeners] An optional array of listener functions to remove.
     * @return {Object} Current instance of EventEmitter for chaining.
     * @doc
     */
    proto.removeListeners = function(evt, listeners) {
        // Pass through to manipulateListeners
        return this.manipulateListeners(true, evt, listeners);
    };

    /**
     * Edits listeners in bulk. The addListeners and removeListeners methods both use this to do their job. You should really use those instead, this is a little lower level.
     * The first argument will determine if the listeners are removed (true) or added (false).
     * If you pass an object as the second argument you can add/remove from multiple events at once. The object should contain key value pairs of events and listeners or listener arrays.
     * You can also pass it an event name and an array of listeners to be added/removed.
     *
     * @param {Boolean} remove True if you want to remove listeners, false if you want to add.
     * @param {String|Object} evt An event name if you will pass an array of listeners next. An object if you wish to add/remove from multiple events at once.
     * @param {Function[]} [listeners] An optional array of listener functions to add/remove.
     * @return {Object} Current instance of EventEmitter for chaining.
     * @doc
     */
    proto.manipulateListeners = function(remove, evt, listeners) {
        // Initialise any required variables
        var i
          , value
          , single = remove ? this.removeListener : this.addListener
          , multiple = remove ? this.removeListeners : this.addListeners;

        // If evt is an object then pass each of it's properties to this method
        if(typeof evt === 'object') {
            for(i in evt) {
                if(evt.hasOwnProperty(i) && (value = evt[i])) {
                    // Pass the single listener straight through to the singular method
                    if(typeof value === 'function') {
                        single.call(this, i, value);
                    }
                    else {
                        // Otherwise pass back to the multiple function
                        multiple.call(this, i, value);
                    }
                }
            }
        }
        else {
            // So evt must be a string
            // And listeners must be an array of listeners
            // Loop over it and pass each one to the multiple method
            i = listeners.length;
            while(i--) {
                single.call(this, evt, listeners[i]);
            }
        }

        // Return the instance of EventEmitter to allow chaining
        return this;
    };

    /**
     * Removes all listeners from a specified event.
     * If you do not specify an event then all listeners will be removed.
     * That means every event will be emptied.
     *
     * @param {String} [evt] Optional name of the event to remove all listeners for. Will remove from every event if not passed.
     * @return {Object} Current instance of EventEmitter for chaining.
     * @doc
     */
    proto.removeEvent = function(evt) {
        // Remove different things depending on the state of evt
        if(evt) {
            // Remove all listeners for the specified event
            delete this._getEvents()[evt];
        }
        else {
            // Remove all listeners in all events
            delete this._events;
        }

        // Return the instance of EventEmitter to allow chaining
        return this;
    };

    /**
     * Emits an event of your choice.
     * When emitted, every listener attached to that event will be executed.
     * If you pass the optional argument array then those arguments will be passed to every listener upon execution.
     * Because it uses `apply`, your array of arguments will be passed as if you wrote them out separately.
     * So they will not arrive within the array on the other side, they will be separate.
     *
     * @param {String} evt Name of the event to emit and execute listeners for.
     * @param {Array} [args] Optional array of arguments to be passed to each listener.
     * @return {Object} Current instance of EventEmitter for chaining.
     * @doc
     */
    proto.emitEvent = function(evt, args) {
        // Get the listeners for the event
        // Also initialise any other required variables
        var listeners = this.getListeners(evt)
          , i = listeners.length
          , response;

        // Loop over all listeners assigned to the event
        // Apply the arguments array to each listener function
        while(i--) {
            // If the listener returns true then it shall be removed from the event
            // The function is executed either with a basic call or an apply if there is an args array
            response = args ? listeners[i].apply(null, args) : listeners[i]();
            if(response === true) {
                this.removeListener(evt, listeners[i]);
            }
        }

        // Return the instance of EventEmitter to allow chaining
        return this;
    };

    /**
     * Alias of emitEvent
     * @doc
     */
    proto.trigger = proto.emitEvent;

    /**
     * Subtly different from emitEvent in that it will pass its arguments on to the listeners, as
     * opposed to taking a single array of arguments to pass on.
     *
     * @param {String} evt Name of the event to emit and execute listeners for.
     * @param {...*} Optional additional arguments to be passed to each listener.
     * @return {Object} Current instance of EventEmitter for chaining.
     * @doc
     */
    proto.emit = function(evt) {
        var args = Array.prototype.slice.call(arguments, 1);
        return this.emitEvent(evt, args);
    };

    // Expose the class either via AMD or the global object
    if(typeof define === 'function' && define.amd) {
        define(function() {
            return EventEmitter;
        });
    }
    else {
        exports.EventEmitter = EventEmitter;
    }
}(this));
;return module.exports;}({},{});
var __m24 = function(module,exports){module.exports=exports;
module.exports = Element;

function Element(domElement, width, height){
	this.element = domElement;
	this.width = width || domElement.width || parseInt(domElement.clientWidth);
	this.height = height || domElement.height || parseInt(domElement.clientHeight);
	this.locations = [];
	this.isVisible;
	
	this.element.style.position = "absolute";
};

Element.create = function(domElement, width, height){
	var element = new Element(domElement, width, height);
	return Element.getApi(element);
};

Element.getApi = function(element){
	var api = {};
	api.element = element.element;
	api.isIn = element.isIn.bind(element);
	api.reposition = element.reposition.bind(element);
	api.show = element.show.bind(element);
	api.hide = element.hide.bind(element);

	Object.defineProperty(api, "width", {
		get: function(){return element.width;}
	});

	Object.defineProperty(api, "visible", {
		get: function(){return element.isVisible;}
	});

	Object.defineProperty(api, "height", {
		get: function(){return element.height;}
	});

	Object.defineProperty(api, "chanceMultiplier", {
		get: function(){return element.chanceMultiplier;},
		set: function(value){ element.chanceMultiplier = value;}
	});

	Object.defineProperty(api, "locations", {
		get: function(){return element.locations}
	});

	return api;
};

Element.prototype.chanceMultiplier = 1;

Element.prototype.isIn = function(left, top, right, bottom){
	var locationIndex = this.locations.length,
		boundingBox;

	while(boundingBox = this.locations[--locationIndex]){
		if((((left < boundingBox.left && boundingBox.left < right) ||
				(boundingBox.right < right && left < boundingBox.right)) &&
			((top < boundingBox.top && boundingBox.top < bottom) || 
				(boundingBox.bottom < bottom && top < boundingBox.bottom)))){
			return true;
		}
	}

	return false;
}

Element.prototype.reposition = function(left, top){
	this.element.style.left = left + "px";
	this.element.style.top = top + "px";
};

Element.prototype.hide = function(){
	this.isVisible = false;
};

Element.prototype.show = function(left, top){
	this.reposition(left, top);
	this.isVisible = true;
};
;return module.exports;}({},{});
var __m20 = function(module,exports){module.exports=exports;
var Element = __m24;

module.exports = IframeElement;

// iOS has a rendering bug related to iframes,
var isiOS = (navigator.userAgent.match(/(iPad|iPhone|iPod)/g) ? true : false );

function IframeElement (element){
	Element.call(this, element, parseInt(element.width), parseInt(element.height));

	this.iframe = this.element.querySelector('iframe') || this.element;
	this.isLocal = this.iframe.contentDocument && this.iframe.contentDocument.body && this.iframe.contentDocument.body.innerHTML !== "";
	
	// Hack to fix for iOS's failure to render the inside of a iframe 
	// when using css transforms. If we have permission to edit the iframe,
	// this method is much more performant that the hack in .show
	if(isiOS && this.isLocal){
		this.iframe.contentDocument.body.style.webkitTransform = "translate3d(0, 0, 0)";
	}
	
	this.hide();
};
IframeElement.prototype = Object.create(Element.prototype);

IframeElement.create = function(element){
	element = new IframeElement(element);
	return IframeElement.getApi(element);
};

IframeElement.getApi = function(element){
	return Element.getApi(element);
};

IframeElement.prototype.hide = function(){
	Element.prototype.hide.call(this);
	this.element.style.opacity = 0;
	
	if(this.fidget){
		clearInterval(this.fidget);
		this.fidget = void 0;
	}
};

IframeElement.prototype.show = function(left, top){
	Element.prototype.show.call(this, left, top);
	this.element.style.opacity = 1;

	// Hack to fix for iOS's failure to render the 
	// inside of a iframe when using css transforms.
	if(isiOS && !this.isLocal && !this.fidget){
		var iframe = this.iframe,
			flipper = 0.001,
			originalHeight = parseInt(iframe.style.height);

		this.fidget = setInterval(function(){
			iframe.style.opacity = 1 + flipper;
			flipper *= -1;
		}, 200);
	}
};

;return module.exports;}({},{});
var __m21 = function(module,exports){module.exports=exports;
var Element = __m24;

module.exports = SimpleElement;

function SimpleElement (element){
	Element.call(this, element, parseInt(element.width), parseInt(element.height));
	this.appended;
};
SimpleElement.prototype = Object.create(Element.prototype);

SimpleElement.create = function(element){
	element = new SimpleElement(element);
	return SimpleElement.getApi(element);
}

SimpleElement.getApi = function(element){
	return Element.getApi(element);
};

var hidingArea = document.createDocumentFragment();
SimpleElement.prototype.hide = function(){	
	Element.prototype.hide.call(this);
	this.element.style.display = "none";
	//hidingArea.appendChild(this.element);
};

SimpleElement.prototype.show = function(left, top, container){
	Element.prototype.show.call(this, left, top);
	this.element.style.display = "block";
	if(!this.appended){
		container.appendChild(this.element);
		this.appended = true;
	}
};
;return module.exports;}({},{});
var __m22 = function(module,exports){module.exports=exports;
__m25;
var Element = __m24;

module.exports = VideoElement;

// Manages global tasks, such as periodic polling of players
// to gather time information
var timeManager = (function(){
	var ACTIVE_ELEMENTS = [],
		PERIODIC_LISTENER,
		api = {};

	api.add = function(element){
		ACTIVE_ELEMENTS.push(element);
		if(ACTIVE_ELEMENTS.length === 1){
			PERIODIC_LISTENER = setInterval(function(){
				ACTIVE_ELEMENTS.forEach(function(element){
					var time = Math.round(element.player.getCurrentTime()),
						elapsed = time - element.lastReportedTime;
					
					if(elapsed === 0) return;
					if(elapsed === 1){
						element.lastReportedTime = time;
						element.emitter.emit('time', time);
						element.emitter.emit('time:' + time);
					} else { // In case we missed some ticks, make up for them
						var start = element.lastReportedTime + 1;
						for(; start < time; start++){
							element.lastReportedTime = start;
							element.emitter.emit('time', start);
							element.emitter.emit('time:' + start);
						}
					}
				});
			}, 500); 	// 500 ms ensures that we account for fluctuations in 
					// timing so we report the time accurate to the second
		}
	}

	api.remove = function(element){
		var index = ACTIVE_ELEMENTS.indexOf(element);
		if(~index){
			ACTIVE_ELEMENTS.splice(index, 1);
			if(ACTIVE_ELEMENTS.length === 0){
				clearInterval(PERIODIC_LISTENER);  
			}	
		}
	}

	return api;
}());

function VideoElement (element, player){
	Element.call(this, element);
	this.player = player;
	this.emitter = new EventEmitter();
	this.lastReportedTime = 0;
	player.addEventListener("onStateChange", this.statusChangeHandler.bind(this));
	player.addEventListener("onError", this.errorHandler.bind(this));
	this.hide();
};
VideoElement.prototype = Object.create(Element.prototype);

VideoElement.create = function(element, player, options){
	var videoElement = new VideoElement(element, player);

	if(options.continuousPlay) videoElement.continuousPlay = true;
	if(options.autoplay) videoElement.autoplay = true;
	if(options.loop) videoElement.loop = true;
	
	return VideoElement.getApi(videoElement);
};

VideoElement.getApi = function(element){
	var api = Element.getApi(element);
	api.player = element.player;
	api.element = element.element;
	api.on = element.emitter.on.bind(element.emitter);
	api.removeListener = element.emitter.removeListener.bind(element.emitter);
	api.destroy = element.destroy.bind(element);
	return api;
};

VideoElement.prototype.continuousPlay = false;
VideoElement.prototype.autoplay = (navigator.userAgent.match(/(iPad|iPhone|iPod)/g) ? false : true );
VideoElement.prototype.loop = false;
VideoElement.prototype.playing = false;

VideoElement.prototype.errorHandler = function(e){
	if(e.data === 150){
		console.log(this);
		this.destroy();
	}
};

VideoElement.prototype.destroy = function(){
	this.height = 0;
	this.width = 0;
	this.bottom = this.top;
	this.left = this.right;
	this.element.parentNode.removeChild(this.element);
};

VideoElement.prototype.hide = function(){
	Element.prototype.hide.call(this);
	this.element.style.opacity = 0;
	
	if(!this.continuousPlay){
		this.player.pauseVideo();
	}
};

VideoElement.prototype.show = function(left, top){
	this.element.style.opacity = 1;
	Element.prototype.show.call(this, left, top);
	
	if(this.playing && !this.continuousPlay){
		this.player.playVideo();
	} else if(!this.playing && this.autoplay) {
		this.playing = true;
		this.player.playVideo();
	}
};

VideoElement.prototype.statusChangeHandler = function(status){
	switch(status.data){
		case -1:
			this.emitter.emit('unstarted');
		break;
		case 0:
			this.emitter.emit('ended');
			timeManager.remove(this);
			if(this.loop){
				this.player.seekTo(0);
				this.player.playVideo();
			}
		break;
		case 1:
			this.emitter.emit('playing');
			timeManager.add(this);
		break;
		case 2:
			this.emitter.emit('paused');
			timeManager.remove(this);
		break;
		case 3:
			this.emitter.emit('buffering');
		break;
		case 5:
			this.emitter.emit('video cued');
		break;
	}
}
;return module.exports;}({},{});
var __m7 = function(module,exports){module.exports=exports;
exports.Iframe = __m20;
exports.Simple = __m21;
exports.Video = __m22;
;return module.exports;}({},{});
var __m9 = function(module,exports){module.exports=exports;
;module.exports = (function(){
var __m2 = function(module,exports){module.exports=exports;
;module.exports = (function(){
var __m1 = function(module,exports){module.exports=exports;
// Adapted from http://gizma.com/easing/ (which was created by Robert Penner)

exports.linear = function(currentTime, startValue, changeInValue, totalTime) {
	return changeInValue * currentTime / totalTime + startValue; 
};


exports.quadraticIn = function(currentTime, startValue, changeInValue, totalTime) {
	return changeInValue * (currentTime /= totalTime) * currentTime + startValue;
};

exports.quadraticOut = function(currentTime, startValue, changeInValue, totalTime) {
	return -changeInValue * (currentTime /= totalTime) * (currentTime - 2) + startValue;
};

exports.quadraticInOut = function(currentTime, startValue, changeInValue, totalTime) {
	currentTime /= totalTime / 2;
	
	if(currentTime < 1) return changeInValue / 2 * currentTime * currentTime + startValue;
	
	return -changeInValue / 2 * (--currentTime * (currentTime - 2) - 1) + startValue;
};

exports.cubicIn = function(currentTime, startValue, changeInValue, totalTime) {
	return changeInValue * (currentTime /= totalTime) * currentTime * currentTime + startValue;
};

exports.cubicOut = function(currentTime, startValue, changeInValue, totalTime) {
	currentTime /= totalTime;

	return changeInValue * (--currentTime * currentTime * currentTime + 1) + startValue;
};

exports.cubicInOut = function(currentTime, startValue, changeInValue, totalTime) {
	currentTime /= totalTime / 2;
	
	if(currentTime < 1) return changeInValue * (currentTime /= totalTime) * currentTime * currentTime + startValue;

	return changeInValue / 2 * ((currentTime -= 2) * currentTime * currentTime + 2) + startValue;
};


var HALF_PI = Math.PI / 2;
exports.sinusoidalIn = function(currentTime, startValue, changeInValue, totalTime) {
	return -changeInValue * Math.cos(currentTime / totalTime * HALF_PI) + changeInValue + startValue;
};

exports.sinusoidalOut = function(currentTime, startValue, changeInValue, totalTime) {
	return changeInValue * Math.sin(currentTime / totalTime * HALF_PI) + startValue;
};

exports.sinusoidalInOut = function(currentTime, startValue, changeInValue, totalTime){
	return -changeInValue / 2 * (Math.cos(Math.PI * currentTime / totalTime) - 1) + startValue;
};


exports.exponentialIn = function(currentTime, startValue, changeInValue, totalTime){
	return changeInValue * Math.pow(2, 10 * (currentTime / totalTime - 1)) + startValue;
};

exports.exponentialOut = function(currentTime, startValue, changeInValue, totalTime){
	return changeInValue * (-Math.pow(2, -10 * currentTime / totalTime) + 1) + startValue;
};

exports.exponentialInOut = function(currentTime, startValue, changeInValue, totalTime){
	currentTime /= totalTime / 2;
	
	if(currentTime < 1) return changeInValue / 2 * Math.pow(2, 10 * (currentTime -1))  + startValue;

	return changeInValue / 2 * (-Math.pow(2, -10 * --t) + 2) + startValue;
};

;return module.exports;}({},{});
var __m0 = function(module,exports){module.exports=exports;
var requestAnimationFrame = window.requestAnimationFrame || 
								window.mozRequestAnimationFrame ||
                              	window.webkitRequestAnimationFrame || 
                              	window.msRequestAnimationFrame || 
                              	function(cb){return setTimeout(cb, 15);};

var cancelAnimationFrame = 	window.cancelAnimationFrame || 
								window.mozCancelAnimationFrame ||
                              	window.webkitCancelAnimationFrame || 
                              	window.msCancelAnimationFrame || 
                              	function(timeout){return clearTimeout(timeout);};

var tween = module.exports = function(easingFunc, obj, prop, targetValue, duration, callback){
	duration = duration || 0;
	
	var startValue = obj[prop],
		valueDiff = targetValue - startValue,
		startTime = Date.now(),
		pauseStart = startTime,
		paused = true,
		animationRequestId;

	function pause(){
		if(paused) return;
		paused = true;

		cancelAnimationFrame(animationRequestId);	
		pauseStart = Date.now();
	}

	function resume(){
		if(!paused) return;
		paused = false;

		startTime += Date.now() - pauseStart;
		
		animationRequestId = requestAnimationFrame(step);
	}

	function step(){
		var currentTime = Date.now() - startTime;

		if(currentTime < duration){
			obj[prop] = easingFunc(currentTime, startValue, valueDiff, duration);
			animationRequestId = requestAnimationFrame(step);
		} else {
			obj[prop] = easingFunc(duration, startValue, valueDiff, duration);
			callback && callback();
		}
	}

	resume();

	return {
		resume: resume,
		pause: pause
	};
};

// Bind easing helpers
var easing = __m1,
	easingFuncName;

for(easingFuncName in easing){
	if(easing.hasOwnProperty(easingFuncName)){
		tween[easingFuncName] = tween.bind(void 0, easing[easingFuncName]);
	}
}

tween.easing = easing;
;return module.exports;}({},{});return __m0;}());
;return module.exports;}({},{});
var __m1 = function(module,exports){module.exports=exports;
var noop = exports.noop = function(){};

exports.requestAnimationFrame = window.requestAnimationFrame || 
								window.mozRequestAnimationFrame ||
                              	window.webkitRequestAnimationFrame || 
                              	window.msRequestAnimationFrame || 
                              	function(cb){return setTimeout(cb, 15);};

exports.cancelAnimationFrame = 	window.cancelAnimationFrame || 
								window.mozCancelAnimationFrame ||
                              	window.webkitCancelAnimationFrame || 
                              	window.msCancelAnimationFrame || 
                              	function(timeout){return clearTimeout(timeout);};

exports.requestFullscreen = document.documentElement.requestFullscreen ||
							document.documentElement.mozRequestFullScreen ||
							document.documentElement.webkitRequestFullscreen ||
							noop;

var bodyStyle = document.body.style;
exports.transformAttribute = 	(bodyStyle.msTransform !== void 0) && "msTransform" ||
								(bodyStyle.webkitTransform !== void 0) && "webkitTransform" ||
								(bodyStyle.MozTransform !== void 0) && "MozTransform" ||
								(bodyStyle.transform !== void 0) && "transform";
								
exports.transitionAttribute =	(bodyStyle.msTransition !== void 0) && "msTransition" ||
								(bodyStyle.webkitTransition !== void 0) && "webkitTransition" ||
								(bodyStyle.MozTransition !== void 0) && "MozTransition" || 
								(bodyStyle.transition !== void 0) && "transition";

exports.filterAttribute = 		(bodyStyle.msFilter !== void 0) && "msFilter" ||
								(bodyStyle.webkitFilter !== void 0) && "webkitFilter" ||
								(bodyStyle.MozFilter !== void 0) && "MozFilter" ||
								(bodyStyle.filter !== void 0) && "filter";
;return module.exports;}({},{});
var __m0 = function(module,exports){module.exports=exports;
var utils = __m1,
	requestAnimationFrame = utils.requestAnimationFrame,
	cancelAnimationFrame = utils.cancelAnimationFrame,
	tween = __m2;

var Surface = module.exports = function(container){
	this.container = container;
	this.element = document.createElement("div");
	this.element.style.position = "absolute";
	container.appendChild(this.element);

	this.refit();

	this.offsetX = 0;
	this.offsetY = 0;
	
	this.speedMultiplierX = 0;
	this.speedMultiplierY = 0;
	
	this.multiStyle = {};
	this.multiStyle[utils.transformAttribute] = {};
	this.multiStyle[utils.transitionAttribute] = {};
	this.multiStyle[utils.filterAttribute] = {};

	this.pointerEventHandler = this.pointerEventHandler.bind(this);
	this.step = this.step.bind(this);
};

Surface.create = function(container){
	var surface = new Surface(container);

	return Surface.getApi(surface);
};

Surface.getApi = function(surface){
	var api = {};

	api.start = surface.start.bind(surface);
	api.pause = surface.pause.bind(surface);
	api.refit = surface.refit.bind(surface);
	api.element = surface.element;

	api.blur = surface.setBlur.bind(surface);
	api.grayscale = surface.setGrayscale.bind(surface);
	api.opacity = surface.setOpacity.bind(surface);

	api.speed = surface.setSpeedLimit.bind(surface);
	api.horizontalSpeed = surface.setHorizontalSpeedLimit.bind(surface);
	api.verticalSpeed = surface.setVerticalSpeedLimit.bind(surface);

	api.horizontalWind = surface.setHorizontalWind.bind(surface);
	api.verticalWind = surface.setVerticalWind.bind(surface);
	
	return api;
};

Surface.prototype.horizontalSpeedLimit = 4;
Surface.prototype.verticalSpeedLimit = 4;

Surface.prototype.horizontalWind = 0;
Surface.prototype.verticalWind = 0;

Surface.prototype.msPerStep = 16; // Milliseconds per step

// These functions take current position relative to the center and return a number between -1 and 1
Surface.prototype.horizontalSpeedGradient = tween.easing.quadraticIn;
Surface.prototype.verticalSpeedGradient = tween.easing.quadraticIn;

Surface.prototype.pointerTrackingEvents = ['mousemove', 'touchstart', 'touchend', 'touchmove'];

Surface.prototype.start = function(){
	if(this.active) return;
	this.active = true;

	this.attachPointerListeners();
	
	this.lastStepTime = Date.now();

	this.animationRequestId = requestAnimationFrame(this.step);
};

Surface.prototype.pause = function(){
	if(!this.active) return;
	this.active = false;
	cancelAnimationFrame(this.animationRequestId);
	this.detachPointerListeners();
};

Surface.prototype.step = function(){
	this.refit();

	var currentTime = Date.now(),
		lagMultiplier = (currentTime - this.lastStepTime) / this.msPerStep;

	this.lastStepTime = currentTime;
	
	this.offsetX += lagMultiplier * (this.horizontalWind + (this.speedMultiplierX * this.horizontalSpeedLimit));
	this.offsetY += lagMultiplier * (this.verticalWind + (this.speedMultiplierY * this.verticalSpeedLimit));
	
	this.setCssTransform("translate", this.offsetX + "px, " + this.offsetY + "px");

	this.animationRequestId = requestAnimationFrame(this.step);
};

Surface.prototype.attachPointerListeners = function(){
	var self = this;
	this.pointerTrackingEvents.forEach(function(event){
		self.container.addEventListener(event, self.pointerEventHandler);
	});
	this.container.addEventListener("mousemove", self.pointerEventHandler);
};

Surface.prototype.detachPointerListeners = function(){
	var self = this;
	this.pointerTrackingEvents.forEach(function(event){
		self.container.removeEventListener(event, self.pointerEventHandler);
	});
};

// This updates the x and y speed multipliers based on the pointers relative position to the
// center of the container element
Surface.prototype.pointerEventHandler = function(e){
	// If touch event, find first touch
	var pointer = e.changedTouches && e.changedTouches[0] || e;

	var x = pointer.clientX - this.left;
		y = pointer.clientY - this.top;

	this.speedMultiplierX = this.horizontalSpeedGradient(x - this.halfWidth, 0, (x > this.halfWidth? -1 : 1), this.halfWidth);
	this.speedMultiplierY = this.verticalSpeedGradient(y - this.halfHeight, 0, (y > this.halfHeight? -1 : 1), this.halfHeight);
};

Surface.prototype.refit = function(){
	var rect = this.container.getBoundingClientRect();

	this.width = rect.width;
	this.halfWidth = this.width / 2;

	this.height = rect.height;
	this.halfHeight = this.height / 2;

	this.top = rect.top;
	this.left = rect.left;
};

Surface.prototype.setHorizontalWind = function(target, duration, easingFunc){
	if(!duration) return this.horizontalWind = target;

	easingFunc = easingFunc || (this.horizontalWind < target)? tween.easing.quadraticIn : tween.easing.quadraticOut;

	tween(easingFunc, this, "horizontalWind", target, duration);
};

Surface.prototype.setVerticalWind = function(target, duration, easingFunc){
	if(!duration) return this.verticalWind = target;

	easingFunc = easingFunc || (this.verticalWind < target)? tween.easing.quadraticIn : tween.easing.quadraticOut;

	tween(easingFunc, this, "verticalWind", target, duration);
};

Surface.prototype.setSpeedLimit = function(target, duration, easingFunc, callback){
	if(!duration){
		this.horizontalSpeedLimit = target;
		this.verticalSpeedLimit = target;
		return;
	}

	this.setHorizontalSpeedLimit(target, duration, easingFunc, callback);
	this.setVerticalSpeedLimit(target, duration, easingFunc);
};

Surface.prototype.setHorizontalSpeedLimit = function(target, duration, easingFunc, callback){
	if(!duration) return this.horizontalSpeedLimit = target;

	easingFunc = easingFunc || (this.horizontalSpeedLimit < target)? tween.easing.quadraticIn : tween.easing.quadraticOut;

	tween(easingFunc, this, "horizontalSpeedLimit", target, duration, callback);
};

Surface.prototype.setVerticalSpeedLimit = function(target, duration, easingFunc, callback){
	if(!duration) return this.verticalSpeedLimit = target;
	
	easingFunc = easingFunc || (this.verticalSpeedLimit < target)? tween.easing.quadraticIn : tween.easing.quadraticOut;

	tween(easingFunc, this, "verticalSpeedLimit", target, duration, callback);
};

Surface.prototype.setBlur = function(target, duration){
	if(duration !== void 0) this.setCssTransition("-webkit-filter", duration + "s");
	this.setCssFilter("blur", target + "px");
};

Surface.prototype.setGrayscale = function(target, duration){
	if(duration !== void 0) this.setCssTransition("-webkit-filter", duration + "s");
	this.setCssFilter("grayscale", target);
};

Surface.prototype.setOpacity = function(target, duration){
	if(duration !== void 0) this.setCssTransition("opacity", duration + "s");
	this.element.style.opacity = target;
};

Surface.prototype.setCssTransform = function(name, value){
	this.cssTransforms[name] = value;
	this.updateMultiAttributeStyle(utils.transformAttribute, this.cssTransforms);
};

Surface.prototype.setCssFilter = function(name, value){
	this.cssFilters[name] = value;
	this.updateMultiAttributeStyle(utils.filterAttribute, this.cssFilters);
};

Surface.prototype.setCssTransition = function(name, value){
	this.cssTransitions[name] = value;
	this.updateMultiAttributeStyle(utils.transitionAttribute, this.cssTransitions, true);
};

Surface.prototype.cssTransitions = {
	"-webkit-filter": "0s",
	opacity: "0s"	
};

Surface.prototype.cssFilters = {
	blur: "0px",
	grayscale: "0"
};

Surface.prototype.cssTransforms = {
	translate: "0px, 0px"
};

Surface.prototype.updateMultiAttributeStyle = function(styleName, attributes, withComma){
	var name,
		list = [];

	for(name in attributes){
		if(attributes.hasOwnProperty(name)){
			list.push(name + (withComma?" ":"(") + attributes[name] + (withComma?"":")"));
		}
	}

	this.element.style[styleName] = list.join((withComma?", ":" "));
}

;return module.exports;}({},{});return __m0;}());
;return module.exports;}({},{});
var __m8 = function(module,exports){module.exports=exports;
// vim:ts=4:sts=4:sw=4:
/*!
 *
 * Copyright 2009-2012 Kris Kowal under the terms of the MIT
 * license found at http://github.com/kriskowal/q/raw/master/LICENSE
 *
 * With parts by Tyler Close
 * Copyright 2007-2009 Tyler Close under the terms of the MIT X license found
 * at http://www.opensource.org/licenses/mit-license.html
 * Forked at ref_send.js version: 2009-05-11
 *
 * With parts by Mark Miller
 * Copyright (C) 2011 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

(function (definition) {
    // Turn off strict mode for this function so we can assign to global.Q
    /*jshint strict: false*/

    // This file will function properly as a <script> tag, or a module
    // using CommonJS and NodeJS or RequireJS module formats.  In
    // Common/Node/RequireJS, the module exports the Q API and when
    // executed as a simple <script>, it creates a Q global instead.

    // Montage Require
    if (typeof bootstrap === "function") {
        bootstrap("promise", definition);

    // CommonJS
    } else if (typeof exports === "object") {
        definition(void 0, exports);

    // RequireJS
    } else if (typeof define === "function") {
        define(definition);

    // SES (Secure EcmaScript)
    } else if (typeof ses !== "undefined") {
        if (!ses.ok()) {
            return;
        } else {
            ses.makeQ = function () {
                var Q = {};
                return definition(void 0, Q);
            };
        }

    // <script>
    } else {
        definition(void 0, Q = {});
    }

})(function (require, exports) {
"use strict";

// All code after this point will be filtered from stack traces reported
// by Q.
var qStartingLine = captureLine();
var qFileName;

// shims

// used for fallback "defend" and in "allResolved"
var noop = function () {};

// for the security conscious, defend may be a deep freeze as provided
// by cajaVM.  Otherwise we try to provide a shallow freeze just to
// discourage promise changes that are not compatible with secure
// usage.  If Object.freeze does not exist, fall back to doing nothing
// (no op).
var defend = Object.freeze || noop;
if (typeof cajaVM !== "undefined") {
    defend = cajaVM.def;
}

// use the fastest possible means to execute a task in a future turn
// of the event loop.
var nextTick;
if (typeof process !== "undefined") {
    // node
    nextTick = process.nextTick;
} else if (typeof setImmediate === "function") {
    // In IE10, or use https://github.com/NobleJS/setImmediate
    nextTick = setImmediate;
} else if (typeof MessageChannel !== "undefined") {
    // modern browsers
    // http://www.nonblocking.io/2011/06/windownexttick.html
    var channel = new MessageChannel();
    // linked list of tasks (single, with head node)
    var head = {}, tail = head;
    channel.port1.onmessage = function () {
        head = head.next;
        var task = head.task;
        delete head.task;
        task();
    };
    nextTick = function (task) {
        tail = tail.next = {task: task};
        channel.port2.postMessage(0);
    };
} else {
    // old browsers
    nextTick = function (task) {
        setTimeout(task, 0);
    };
}

// Attempt to make generics safe in the face of downstream
// modifications.
// There is no situation where this is necessary.
// If you need a security guarantee, these primordials need to be
// deeply frozen anyway, and if you don’t need a security guarantee,
// this is just plain paranoid.
// However, this does have the nice side-effect of reducing the size
// of the code by reducing x.call() to merely x(), eliminating many
// hard-to-minify characters.
// See Mark Miller’s explanation of what this does.
// http://wiki.ecmascript.org/doku.php?id=conventions:safe_meta_programming
var uncurryThis;
// I have kept both variations because the first is theoretically
// faster, if bind is available.
if (Function.prototype.bind) {
    var Function_bind = Function.prototype.bind;
    uncurryThis = Function_bind.bind(Function_bind.call);
} else {
    uncurryThis = function (f) {
        return function () {
            return f.call.apply(f, arguments);
        };
    };
}

var array_slice = uncurryThis(Array.prototype.slice);

var array_reduce = uncurryThis(
    Array.prototype.reduce || function (callback, basis) {
        var index = 0,
            length = this.length;
        // concerning the initial value, if one is not provided
        if (arguments.length === 1) {
            // seek to the first value in the array, accounting
            // for the possibility that is is a sparse array
            do {
                if (index in this) {
                    basis = this[index++];
                    break;
                }
                if (++index >= length) {
                    throw new TypeError();
                }
            } while (1);
        }
        // reduce
        for (; index < length; index++) {
            // account for the possibility that the array is sparse
            if (index in this) {
                basis = callback(basis, this[index], index);
            }
        }
        return basis;
    }
);

var array_indexOf = uncurryThis(
    Array.prototype.indexOf || function (value) {
        // not a very good shim, but good enough for our one use of it
        for (var i = 0; i < this.length; i++) {
            if (this[i] === value) {
                return i;
            }
        }
        return -1;
    }
);

var array_map = uncurryThis(
    Array.prototype.map || function (callback, thisp) {
        var self = this;
        var collect = [];
        array_reduce(self, function (undefined, value, index) {
            collect.push(callback.call(thisp, value, index, self));
        }, void 0);
        return collect;
    }
);

var object_create = Object.create || function (prototype) {
    function Type() { }
    Type.prototype = prototype;
    return new Type();
};

var object_keys = Object.keys || function (object) {
    var keys = [];
    for (var key in object) {
        keys.push(key);
    }
    return keys;
};

var object_toString = Object.prototype.toString;

// generator related shims

function isStopIteration(exception) {
    return (
        object_toString(exception) === "[object StopIteration]" ||
        exception instanceof QReturnValue
    );
}

var QReturnValue;
if (typeof ReturnValue !== "undefined") {
    QReturnValue = ReturnValue;
} else {
    QReturnValue = function (value) {
        this.value = value;
    };
}

// long stack traces

var STACK_JUMP_SEPARATOR = "From previous event:";

function makeStackTraceLong(error, promise) {
    // If possible (that is, if in V8), transform the error stack
    // trace by removing Node and Q cruft, then concatenating with
    // the stack trace of the promise we are ``done``ing. See #57.
    if (promise.stack &&
        typeof error === "object" &&
        error !== null &&
        error.stack &&
        error.stack.indexOf(STACK_JUMP_SEPARATOR) === -1
    ) {
        error.stack = filterStackString(error.stack) +
            "\n" + STACK_JUMP_SEPARATOR + "\n" +
            filterStackString(promise.stack);
    }
}

function filterStackString(stackString) {
    var lines = stackString.split("\n");
    var desiredLines = [];
    for (var i = 0; i < lines.length; ++i) {
        var line = lines[i];

        if (!isInternalFrame(line) && !isNodeFrame(line)) {
            desiredLines.push(line);
        }
    }
    return desiredLines.join("\n");
}

function isNodeFrame(stackLine) {
    return stackLine.indexOf("(module.js:") !== -1 ||
           stackLine.indexOf("(node.js:") !== -1;
}

function isInternalFrame(stackLine) {
    var pieces = /at .+ \((.*):(\d+):\d+\)/.exec(stackLine);

    if (!pieces) {
        return false;
    }

    var fileName = pieces[1];
    var lineNumber = pieces[2];

    return fileName === qFileName &&
        lineNumber >= qStartingLine &&
        lineNumber <= qEndingLine;
}

// discover own file name and line number range for filtering stack
// traces
function captureLine() {
    if (Error.captureStackTrace) {
        var fileName, lineNumber;

        var oldPrepareStackTrace = Error.prepareStackTrace;

        Error.prepareStackTrace = function (error, frames) {
            fileName = frames[1].getFileName();
            lineNumber = frames[1].getLineNumber();
        };

        // teases call of temporary prepareStackTrace
        // JSHint and Closure Compiler generate known warnings here
        /*jshint expr: true */
        new Error().stack;

        Error.prepareStackTrace = oldPrepareStackTrace;
        qFileName = fileName;
        return lineNumber;
    }
}

function deprecate(callback, name, alternative) {
    return function () {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
            console.warn(name + " is deprecated, use " + alternative + " instead.", new Error("").stack);
        }
        return callback.apply(callback, arguments);
    };
}

// end of shims
// beginning of real work

/**
 * Performs a task in a future turn of the event loop.
 * @param {Function} task
 */
exports.nextTick = nextTick;

/**
 * Constructs a {promise, resolve} object.
 *
 * The resolver is a callback to invoke with a more resolved value for the
 * promise. To fulfill the promise, invoke the resolver with any value that is
 * not a function. To reject the promise, invoke the resolver with a rejection
 * object. To put the promise in the same state as another promise, invoke the
 * resolver with that other promise.
 */
exports.defer = defer;
function defer() {
    // if "pending" is an "Array", that indicates that the promise has not yet
    // been resolved.  If it is "undefined", it has been resolved.  Each
    // element of the pending array is itself an array of complete arguments to
    // forward to the resolved promise.  We coerce the resolution value to a
    // promise using the ref promise because it handles both fully
    // resolved values and other promises gracefully.
    var pending = [], progressListeners = [], value;

    var deferred = object_create(defer.prototype);
    var promise = object_create(makePromise.prototype);

    promise.promiseSend = function (op, _, __, progress) {
        var args = array_slice(arguments);
        if (pending) {
            pending.push(args);
            if (op === "when" && progress) {
                progressListeners.push(progress);
            }
        } else {
            nextTick(function () {
                value.promiseSend.apply(value, args);
            });
        }
    };

    promise.valueOf = function () {
        if (pending) {
            return promise;
        }
        return value.valueOf();
    };

    if (Error.captureStackTrace) {
        Error.captureStackTrace(promise, defer);

        // Reify the stack into a string by using the accessor; this prevents
        // memory leaks as per GH-111. At the same time, cut off the first line;
        // it's always just "[object Promise]\n", as per the `toString`.
        promise.stack = promise.stack.substring(promise.stack.indexOf("\n") + 1);
    }

    function become(resolvedValue) {
        if (!pending) {
            return;
        }
        value = resolve(resolvedValue);
        array_reduce(pending, function (undefined, pending) {
            nextTick(function () {
                value.promiseSend.apply(value, pending);
            });
        }, void 0);
        pending = void 0;
        progressListeners = void 0;
    }

    defend(promise);

    deferred.promise = promise;
    deferred.resolve = become;
    deferred.reject = function (exception) {
        become(reject(exception));
    };
    deferred.notify = function (progress) {
        if (pending) {
            array_reduce(progressListeners, function (undefined, progressListener) {
                nextTick(function () {
                    progressListener(progress);
                });
            }, void 0);
        }
    };

    return deferred;
}

/**
 * Creates a Node-style callback that will resolve or reject the deferred
 * promise.
 * @returns a nodeback
 */
defer.prototype.makeNodeResolver = function () {
    var self = this;
    return function (error, value) {
        if (error) {
            self.reject(error);
        } else if (arguments.length > 2) {
            self.resolve(array_slice(arguments, 1));
        } else {
            self.resolve(value);
        }
    };
};
// XXX deprecated
defer.prototype.node = deprecate(defer.prototype.makeNodeResolver, "node", "makeNodeResolver");

/**
 * @param makePromise {Function} a function that returns nothing and accepts
 * the resolve, reject, and notify functions for a deferred.
 * @returns a promise that may be resolved with the given resolve and reject
 * functions, or rejected by a thrown exception in makePromise
 */
exports.promise = promise;
function promise(makePromise) {
    var deferred = defer();
    fcall(
        makePromise,
        deferred.resolve,
        deferred.reject,
        deferred.notify
    ).fail(deferred.reject);
    return deferred.promise;
}

/**
 * Constructs a Promise with a promise descriptor object and optional fallback
 * function.  The descriptor contains methods like when(rejected), get(name),
 * put(name, value), post(name, args), and delete(name), which all
 * return either a value, a promise for a value, or a rejection.  The fallback
 * accepts the operation name, a resolver, and any further arguments that would
 * have been forwarded to the appropriate method above had a method been
 * provided with the proper name.  The API makes no guarantees about the nature
 * of the returned object, apart from that it is usable whereever promises are
 * bought and sold.
 */
exports.makePromise = makePromise;
function makePromise(descriptor, fallback, valueOf, exception) {
    if (fallback === void 0) {
        fallback = function (op) {
            return reject(new Error("Promise does not support operation: " + op));
        };
    }

    var promise = object_create(makePromise.prototype);

    promise.promiseSend = function (op, resolved /* ...args */) {
        var args = array_slice(arguments, 2);
        var result;
        try {
            if (descriptor[op]) {
                result = descriptor[op].apply(promise, args);
            } else {
                result = fallback.apply(promise, [op].concat(args));
            }
        } catch (exception) {
            result = reject(exception);
        }
        if (resolved) {
            resolved(result);
        }
    };

    if (valueOf) {
        promise.valueOf = valueOf;
    }

    if (exception) {
        promise.exception = exception;
    }

    defend(promise);

    return promise;
}

// provide thenables, CommonJS/Promises/A
makePromise.prototype.then = function (fulfilled, rejected, progressed) {
    return when(this, fulfilled, rejected, progressed);
};

makePromise.prototype.thenResolve = function (value) {
    return when(this, function () { return value; });
};

// Chainable methods
array_reduce(
    [
        "isResolved", "isFulfilled", "isRejected",
        "when", "spread", "send",
        "get", "put", "del",
        "post", "invoke",
        "keys",
        "apply", "call", "bind",
        "fapply", "fcall", "fbind",
        "all", "allResolved",
        "view", "viewInfo",
        "timeout", "delay",
        "catch", "finally", "fail", "fin", "progress", "end", "done",
        "nfcall", "nfapply", "nfbind",
        "ncall", "napply", "nbind",
        "npost", "ninvoke",
        "nend", "nodeify"
    ],
    function (undefined, name) {
        makePromise.prototype[name] = function () {
            return exports[name].apply(
                exports,
                [this].concat(array_slice(arguments))
            );
        };
    },
    void 0
);

makePromise.prototype.toSource = function () {
    return this.toString();
};

makePromise.prototype.toString = function () {
    return "[object Promise]";
};

defend(makePromise.prototype);

/**
 * If an object is not a promise, it is as "near" as possible.
 * If a promise is rejected, it is as "near" as possible too.
 * If it’s a fulfilled promise, the fulfillment value is nearer.
 * If it’s a deferred promise and the deferred has been resolved, the
 * resolution is "nearer".
 * @param object
 * @returns most resolved (nearest) form of the object
 */
exports.nearer = valueOf;
function valueOf(value) {
    if (isPromise(value)) {
        return value.valueOf();
    }
    return value;
}

/**
 * @returns whether the given object is a promise.
 * Otherwise it is a fulfilled value.
 */
exports.isPromise = isPromise;
function isPromise(object) {
    return object && typeof object.promiseSend === "function";
}

/**
 * @returns whether the given object can be coerced to a promise.
 * Otherwise it is a fulfilled value.
 */
exports.isPromiseAlike = isPromiseAlike;
function isPromiseAlike(object) {
    return object && typeof object.then === "function";
}

/**
 * @returns whether the given object is a resolved promise.
 */
exports.isResolved = isResolved;
function isResolved(object) {
    return isFulfilled(object) || isRejected(object);
}

/**
 * @returns whether the given object is a value or fulfilled
 * promise.
 */
exports.isFulfilled = isFulfilled;
function isFulfilled(object) {
    return !isPromiseAlike(valueOf(object));
}

/**
 * @returns whether the given object is a rejected promise.
 */
exports.isRejected = isRejected;
function isRejected(object) {
    object = valueOf(object);
    return isPromise(object) && 'exception' in object;
}

var rejections = [];
var errors = [];
var errorsDisplayed;
function displayErrors() {
    if (
        !errorsDisplayed &&
        typeof window !== "undefined" &&
        !window.Touch &&
        window.console
    ) {
        // This promise library consumes exceptions thrown in handlers so
        // they can be handled by a subsequent promise.  The rejected
        // promises get added to this array when they are created, and
        // removed when they are handled.
        console.log("Should be empty:", errors);
    }
    errorsDisplayed = true;
}

/**
 * Constructs a rejected promise.
 * @param exception value describing the failure
 */
exports.reject = reject;
function reject(exception) {
    var rejection = makePromise({
        "when": function (rejected) {
            // note that the error has been handled
            if (rejected) {
                var at = array_indexOf(rejections, this);
                if (at !== -1) {
                    errors.splice(at, 1);
                    rejections.splice(at, 1);
                }
            }
            return rejected ? rejected(exception) : reject(exception);
        }
    }, function fallback() {
        return reject(exception);
    }, function valueOf() {
        return this;
    }, exception);
    // note that the error has not been handled
    displayErrors();
    rejections.push(rejection);
    errors.push(exception);
    return rejection;
}

/**
 * Constructs a promise for an immediate reference.
 * @param value immediate reference
 */
exports.begin = resolve; // XXX experimental
exports.resolve = resolve;
exports.ref = deprecate(resolve, "ref", "resolve"); // XXX deprecated, use resolve
function resolve(object) {
    // If the object is already a Promise, return it directly.  This enables
    // the resolve function to both be used to created references from objects,
    // but to tolerably coerce non-promises to promises.
    if (isPromise(object)) {
        return object;
    }
    // In order to break infinite recursion or loops between `then` and
    // `resolve`, it is necessary to attempt to extract fulfilled values
    // out of foreign promise implementations before attempting to wrap
    // them as unresolved promises.  It is my hope that other
    // implementations will implement `valueOf` to synchronously extract
    // the fulfillment value from their fulfilled promises.  If the
    // other promise library does not implement `valueOf`, the
    // implementations on primordial prototypes are harmless.
    object = valueOf(object);
    // assimilate thenables, CommonJS/Promises/A
    if (isPromiseAlike(object)) {
        var deferred = defer();
        object.then(deferred.resolve, deferred.reject, deferred.notify);
        return deferred.promise;
    }
    return makePromise({
        "when": function () {
            return object;
        },
        "get": function (name) {
            return object[name];
        },
        "put": function (name, value) {
            object[name] = value;
            return object;
        },
        "del": function (name) {
            delete object[name];
            return object;
        },
        "post": function (name, value) {
            return object[name].apply(object, value);
        },
        "apply": function (self, args) {
            return object.apply(self, args);
        },
        "fapply": function (args) {
            return object.apply(void 0, args);
        },
        "viewInfo": function () {
            var on = object;
            var properties = {};

            function fixFalsyProperty(name) {
                if (!properties[name]) {
                    properties[name] = typeof on[name];
                }
            }

            while (on) {
                Object.getOwnPropertyNames(on).forEach(fixFalsyProperty);
                on = Object.getPrototypeOf(on);
            }
            return {
                "type": typeof object,
                "properties": properties
            };
        },
        "keys": function () {
            return object_keys(object);
        }
    }, void 0, function valueOf() {
        return object;
    });
}

/**
 * Annotates an object such that it will never be
 * transferred away from this process over any promise
 * communication channel.
 * @param object
 * @returns promise a wrapping of that object that
 * additionally responds to the "isDef" message
 * without a rejection.
 */
exports.master = master;
function master(object) {
    return makePromise({
        "isDef": function () {}
    }, function fallback() {
        var args = array_slice(arguments);
        return send.apply(void 0, [object].concat(args));
    }, function () {
        return valueOf(object);
    });
}

exports.viewInfo = viewInfo;
function viewInfo(object, info) {
    object = resolve(object);
    if (info) {
        return makePromise({
            "viewInfo": function () {
                return info;
            }
        }, function fallback() {
            var args = array_slice(arguments);
            return send.apply(void 0, [object].concat(args));
        }, function () {
            return valueOf(object);
        });
    } else {
        return send(object, "viewInfo");
    }
}

exports.view = view;
function view(object) {
    return viewInfo(object).when(function (info) {
        var view;
        if (info.type === "function") {
            view = function () {
                return apply(object, void 0, arguments);
            };
        } else {
            view = {};
        }
        var properties = info.properties || {};
        object_keys(properties).forEach(function (name) {
            if (properties[name] === "function") {
                view[name] = function () {
                    return post(object, name, arguments);
                };
            }
        });
        return resolve(view);
    });
}

/**
 * Registers an observer on a promise.
 *
 * Guarantees:
 *
 * 1. that fulfilled and rejected will be called only once.
 * 2. that either the fulfilled callback or the rejected callback will be
 *    called, but not both.
 * 3. that fulfilled and rejected will not be called in this turn.
 *
 * @param value      promise or immediate reference to observe
 * @param fulfilled  function to be called with the fulfilled value
 * @param rejected   function to be called with the rejection exception
 * @param progressed function to be called on any progress notifications
 * @return promise for the return value from the invoked callback
 */
exports.when = when;
function when(value, fulfilled, rejected, progressed) {
    var deferred = defer();
    var done = false;   // ensure the untrusted promise makes at most a
                        // single call to one of the callbacks

    function _fulfilled(value) {
        try {
            return typeof fulfilled === "function" ? fulfilled(value) : value;
        } catch (exception) {
            return reject(exception);
        }
    }

    function _rejected(exception) {
        if (typeof rejected === "function") {
            makeStackTraceLong(exception, resolvedValue);
            try {
                return rejected(exception);
            } catch (newException) {
                return reject(newException);
            }
        }
        return reject(exception);
    }

    function _progressed(value) {
        return typeof progressed === "function" ? progressed(value) : value;
    }

    var resolvedValue = resolve(value);
    nextTick(function () {
        resolvedValue.promiseSend("when", function (value) {
            if (done) {
                return;
            }
            done = true;

            deferred.resolve(_fulfilled(value));
        }, function (exception) {
            if (done) {
                return;
            }
            done = true;

            deferred.resolve(_rejected(exception));
        });
    });

    // Progress propagator need to be attached in the current tick.
    resolvedValue.promiseSend("when", void 0, void 0, function (value) {
        deferred.notify(_progressed(value));
    });

    return deferred.promise;
}

/**
 * Spreads the values of a promised array of arguments into the
 * fulfillment callback.
 * @param fulfilled callback that receives variadic arguments from the
 * promised array
 * @param rejected callback that receives the exception if the promise
 * is rejected.
 * @returns a promise for the return value or thrown exception of
 * either callback.
 */
exports.spread = spread;
function spread(promise, fulfilled, rejected) {
    return when(promise, function (valuesOrPromises) {
        return all(valuesOrPromises).then(function (values) {
            return fulfilled.apply(void 0, values);
        }, rejected);
    }, rejected);
}

/**
 * The async function is a decorator for generator functions, turning
 * them into asynchronous generators.  This presently only works in
 * Firefox/Spidermonkey, however, this code does not cause syntax
 * errors in older engines.  This code should continue to work and
 * will in fact improve over time as the language improves.
 *
 * Decorates a generator function such that:
 *  - it may yield promises
 *  - execution will continue when that promise is fulfilled
 *  - the value of the yield expression will be the fulfilled value
 *  - it returns a promise for the return value (when the generator
 *    stops iterating)
 *  - the decorated function returns a promise for the return value
 *    of the generator or the first rejected promise among those
 *    yielded.
 *  - if an error is thrown in the generator, it propagates through
 *    every following yield until it is caught, or until it escapes
 *    the generator function altogether, and is translated into a
 *    rejection for the promise returned by the decorated generator.
 *  - in present implementations of generators, when a generator
 *    function is complete, it throws ``StopIteration``, ``return`` is
 *    a syntax error in the presence of ``yield``, so there is no
 *    observable return value. There is a proposal[1] to add support
 *    for ``return``, which would permit the value to be carried by a
 *    ``StopIteration`` instance, in which case it would fulfill the
 *    promise returned by the asynchronous generator.  This can be
 *    emulated today by throwing StopIteration explicitly with a value
 *    property.
 *
 *  [1]: http://wiki.ecmascript.org/doku.php?id=strawman:async_functions#reference_implementation
 *
 */
exports.async = async;
function async(makeGenerator) {
    return function () {
        // when verb is "send", arg is a value
        // when verb is "throw", arg is an exception
        function continuer(verb, arg) {
            var result;
            try {
                result = generator[verb](arg);
            } catch (exception) {
                if (isStopIteration(exception)) {
                    return exception.value;
                } else {
                    return reject(exception);
                }
            }
            return when(result, callback, errback);
        }
        var generator = makeGenerator.apply(this, arguments);
        var callback = continuer.bind(continuer, "send");
        var errback = continuer.bind(continuer, "throw");
        return callback();
    };
}

/**
 * Throws a ReturnValue exception to stop an asynchronous generator.
 * Only useful presently in Firefox/SpiderMonkey since generators are
 * implemented.
 * @param value the return value for the surrounding generator
 * @throws ReturnValue exception with the value.
 * @example
 * Q.async(function () {
 *      var foo = yield getFooPromise();
 *      var bar = yield getBarPromise();
 *      Q.return(foo + bar);
 * })
 */
exports['return'] = _return;
function _return(value) {
    throw new QReturnValue(value);
}

/**
 * The promised function decorator ensures that any promise arguments
 * are resolved and passed as values (`this` is also resolved and passed
 * as a value).  It will also ensure that the result of a function is
 * always a promise.
 *
 * @example
 * var add = Q.promised(function (a, b) {
 *     return a + b;
 * });
 * add(Q.resolve(a), Q.resolve(B));
 *
 * @param {function} callback The function to decorate
 * @returns {function} a function that has been decorated.
 */
exports.promised = promised;
function promised(callback) {
    return function () {
        return all([this, all(arguments)]).spread(function (self, args) {
          return callback.apply(self, args);
        });
    };
}

/**
 * Constructs a promise method that can be used to safely observe resolution of
 * a promise for an arbitrarily named method like "propfind" in a future turn.
 */
exports.sender = deprecate(sender, "sender", "dispatcher"); // XXX deprecated, use dispatcher
exports.Method = deprecate(sender, "Method", "dispatcher"); // XXX deprecated, use dispatcher
function sender(op) {
    return function (object) {
        var args = array_slice(arguments, 1);
        return send.apply(void 0, [object, op].concat(args));
    };
}

/**
 * sends a message to a value in a future turn
 * @param object* the recipient
 * @param op the name of the message operation, e.g., "when",
 * @param ...args further arguments to be forwarded to the operation
 * @returns result {Promise} a promise for the result of the operation
 */
exports.send = deprecate(send, "send", "dispatch"); // XXX deprecated, use dispatch
function send(object, op) {
    var deferred = defer();
    var args = array_slice(arguments, 2);
    object = resolve(object);
    nextTick(function () {
        object.promiseSend.apply(
            object,
            [op, deferred.resolve].concat(args)
        );
    });
    return deferred.promise;
}

/**
 * sends a message to a value in a future turn
 * @param object* the recipient
 * @param op the name of the message operation, e.g., "when",
 * @param args further arguments to be forwarded to the operation
 * @returns result {Promise} a promise for the result of the operation
 */
exports.dispatch = dispatch;
function dispatch(object, op, args) {
    var deferred = defer();
    object = resolve(object);
    nextTick(function () {
        object.promiseSend.apply(
            object,
            [op, deferred.resolve].concat(args)
        );
    });
    return deferred.promise;
}

/**
 * Constructs a promise method that can be used to safely observe resolution of
 * a promise for an arbitrarily named method like "propfind" in a future turn.
 *
 * "dispatcher" constructs methods like "get(promise, name)" and "put(promise)".
 */
exports.dispatcher = dispatcher;
function dispatcher(op) {
    return function (object) {
        var args = array_slice(arguments, 1);
        return dispatch(object, op, args);
    };
}

/**
 * Gets the value of a property in a future turn.
 * @param object    promise or immediate reference for target object
 * @param name      name of property to get
 * @return promise for the property value
 */
exports.get = dispatcher("get");

/**
 * Sets the value of a property in a future turn.
 * @param object    promise or immediate reference for object object
 * @param name      name of property to set
 * @param value     new value of property
 * @return promise for the return value
 */
exports.put = dispatcher("put");

/**
 * Deletes a property in a future turn.
 * @param object    promise or immediate reference for target object
 * @param name      name of property to delete
 * @return promise for the return value
 */
exports["delete"] = // XXX experimental
exports.del = dispatcher("del");

/**
 * Invokes a method in a future turn.
 * @param object    promise or immediate reference for target object
 * @param name      name of method to invoke
 * @param value     a value to post, typically an array of
 *                  invocation arguments for promises that
 *                  are ultimately backed with `resolve` values,
 *                  as opposed to those backed with URLs
 *                  wherein the posted value can be any
 *                  JSON serializable object.
 * @return promise for the return value
 */
// bound locally because it is used by other methods
var post = exports.post = dispatcher("post");

/**
 * Invokes a method in a future turn.
 * @param object    promise or immediate reference for target object
 * @param name      name of method to invoke
 * @param ...args   array of invocation arguments
 * @return promise for the return value
 */
exports.invoke = function (value, name) {
    var args = array_slice(arguments, 2);
    return post(value, name, args);
};

/**
 * Applies the promised function in a future turn.
 * @param object    promise or immediate reference for target function
 * @param thisp     the `this` object for the call
 * @param args      array of application arguments
 */
// XXX deprecated, use fapply
var apply = exports.apply = deprecate(dispatcher("apply"), "apply", "fapply");

/**
 * Applies the promised function in a future turn.
 * @param object    promise or immediate reference for target function
 * @param args      array of application arguments
 */
var fapply = exports.fapply = dispatcher("fapply");

/**
 * Calls the promised function in a future turn.
 * @param object    promise or immediate reference for target function
 * @param thisp     the `this` object for the call
 * @param ...args   array of application arguments
 */
// XXX deprecated, use fcall
exports.call = deprecate(call, "call", "fcall");
function call(value, thisp) {
    var args = array_slice(arguments, 2);
    return apply(value, thisp, args);
}

/**
 * Calls the promised function in a future turn.
 * @param object    promise or immediate reference for target function
 * @param ...args   array of application arguments
 */
exports["try"] = fcall; // XXX experimental
exports.fcall = fcall;
function fcall(value) {
    var args = array_slice(arguments, 1);
    return fapply(value, args);
}

/**
 * Binds the promised function, transforming return values into a fulfilled
 * promise and thrown errors into a rejected one.
 * @param object    promise or immediate reference for target function
 * @param thisp   the `this` object for the call
 * @param ...args   array of application arguments
 */
exports.bind = deprecate(bind, "bind", "fbind"); // XXX deprecated, use fbind
function bind(value, thisp) {
    var args = array_slice(arguments, 2);
    return function bound() {
        var allArgs = args.concat(array_slice(arguments));
        return apply(value, thisp, allArgs);
    };
}

/**
 * Binds the promised function, transforming return values into a fulfilled
 * promise and thrown errors into a rejected one.
 * @param object    promise or immediate reference for target function
 * @param ...args   array of application arguments
 */
exports.fbind = fbind;
function fbind(value) {
    var args = array_slice(arguments, 1);
    return function fbound() {
        var allArgs = args.concat(array_slice(arguments));
        return fapply(value, allArgs);
    };
}

/**
 * Requests the names of the owned properties of a promised
 * object in a future turn.
 * @param object    promise or immediate reference for target object
 * @return promise for the keys of the eventually resolved object
 */
exports.keys = dispatcher("keys");

/**
 * Turns an array of promises into a promise for an array.  If any of
 * the promises gets rejected, the whole array is rejected immediately.
 * @param {Array*} an array (or promise for an array) of values (or
 * promises for values)
 * @returns a promise for an array of the corresponding values
 */
// By Mark Miller
// http://wiki.ecmascript.org/doku.php?id=strawman:concurrency&rev=1308776521#allfulfilled
exports.all = all;
function all(promises) {
    return when(promises, function (promises) {
        var countDown = promises.length;
        if (countDown === 0) {
            return resolve(promises);
        }
        var deferred = defer();
        array_reduce(promises, function (undefined, promise, index) {
            if (isFulfilled(promise)) {
                promises[index] = valueOf(promise);
                if (--countDown === 0) {
                    deferred.resolve(promises);
                }
            } else {
                when(promise, function (value) {
                    promises[index] = value;
                    if (--countDown === 0) {
                        deferred.resolve(promises);
                    }
                })
                .fail(deferred.reject);
            }
        }, void 0);
        return deferred.promise;
    });
}

/**
 * Waits for all promises to be resolved, either fulfilled or
 * rejected.  This is distinct from `all` since that would stop
 * waiting at the first rejection.  The promise returned by
 * `allResolved` will never be rejected.
 * @param promises a promise for an array (or an array) of promises
 * (or values)
 * @return a promise for an array of promises
 */
exports.allResolved = allResolved;
function allResolved(promises) {
    return when(promises, function (promises) {
        return when(all(array_map(promises, function (promise) {
            return when(promise, noop, noop);
        })), function () {
            return array_map(promises, resolve);
        });
    });
}

/**
 * Captures the failure of a promise, giving an oportunity to recover
 * with a callback.  If the given promise is fulfilled, the returned
 * promise is fulfilled.
 * @param {Any*} promise for something
 * @param {Function} callback to fulfill the returned promise if the
 * given promise is rejected
 * @returns a promise for the return value of the callback
 */
exports["catch"] = // XXX experimental
exports.fail = fail;
function fail(promise, rejected) {
    return when(promise, void 0, rejected);
}

/**
 * Attaches a listener that can respond to progress notifications from a
 * promise's originating deferred. This listener receives the exact arguments
 * passed to ``deferred.notify``.
 * @param {Any*} promise for something
 * @param {Function} callback to receive any progress notifications
 * @returns the given promise, unchanged
 */
exports.progress = progress;
function progress(promise, progressed) {
    return when(promise, void 0, void 0, progressed);
}

/**
 * Provides an opportunity to observe the rejection of a promise,
 * regardless of whether the promise is fulfilled or rejected.  Forwards
 * the resolution to the returned promise when the callback is done.
 * The callback can return a promise to defer completion.
 * @param {Any*} promise
 * @param {Function} callback to observe the resolution of the given
 * promise, takes no arguments.
 * @returns a promise for the resolution of the given promise when
 * ``fin`` is done.
 */
exports["finally"] = // XXX experimental
exports.fin = fin;
function fin(promise, callback) {
    return when(promise, function (value) {
        return when(callback(), function () {
            return value;
        });
    }, function (exception) {
        return when(callback(), function () {
            return reject(exception);
        });
    });
}

/**
 * Terminates a chain of promises, forcing rejections to be
 * thrown as exceptions.
 * @param {Any*} promise at the end of a chain of promises
 * @returns nothing
 */
exports.end = deprecate(done, "end", "done"); // XXX deprecated, use done
exports.done = done;
function done(promise, fulfilled, rejected, progress) {
    function onUnhandledError(error) {
        // forward to a future turn so that ``when``
        // does not catch it and turn it into a rejection.
        nextTick(function () {
            makeStackTraceLong(error, promise);

            if (exports.onerror) {
                exports.onerror(error);
            } else {
                throw error;
            }
        });
    }

    // Avoid unnecessary `nextTick`ing via an unnecessary `when`.
    var promiseToHandle = fulfilled || rejected || progress ?
        when(promise, fulfilled, rejected, progress) :
        promise;

    fail(promiseToHandle, onUnhandledError);
}

/**
 * Causes a promise to be rejected if it does not get fulfilled before
 * some milliseconds time out.
 * @param {Any*} promise
 * @param {Number} milliseconds timeout
 * @returns a promise for the resolution of the given promise if it is
 * fulfilled before the timeout, otherwise rejected.
 */
exports.timeout = timeout;
function timeout(promise, ms) {
    var deferred = defer();
    var timeoutId = setTimeout(function () {
        deferred.reject(new Error("Timed out after " + ms + " ms"));
    }, ms);

    when(promise, function (value) {
        clearTimeout(timeoutId);
        deferred.resolve(value);
    }, function (exception) {
        clearTimeout(timeoutId);
        deferred.reject(exception);
    });

    return deferred.promise;
}

/**
 * Returns a promise for the given value (or promised value) after some
 * milliseconds.
 * @param {Any*} promise
 * @param {Number} milliseconds
 * @returns a promise for the resolution of the given promise after some
 * time has elapsed.
 */
exports.delay = delay;
function delay(promise, timeout) {
    if (timeout === void 0) {
        timeout = promise;
        promise = void 0;
    }
    var deferred = defer();
    setTimeout(function () {
        deferred.resolve(promise);
    }, timeout);
    return deferred.promise;
}

/**
 * Passes a continuation to a Node function, which is called with the given
 * arguments provided as an array, and returns a promise.
 *
 *      Q.nfapply(FS.readFile, [__filename])
 *      .then(function (content) {
 *      })
 *
 */
exports.nfapply = nfapply;
function nfapply(callback, args) {
    var nodeArgs = array_slice(args);
    var deferred = defer();
    nodeArgs.push(deferred.makeNodeResolver());

    fapply(callback, nodeArgs).fail(deferred.reject);
    return deferred.promise;
}

/**
 * Passes a continuation to a Node function, which is called with the given
 * arguments provided individually, and returns a promise.
 *
 *      Q.nfcall(FS.readFile, __filename)
 *      .then(function (content) {
 *      })
 *
 */
exports.nfcall = nfcall;
function nfcall(callback/*, ...args */) {
    var nodeArgs = array_slice(arguments, 1);
    var deferred = defer();
    nodeArgs.push(deferred.makeNodeResolver());

    fapply(callback, nodeArgs).fail(deferred.reject);
    return deferred.promise;
}

/**
 * Wraps a NodeJS continuation passing function and returns an equivalent
 * version that returns a promise.
 *
 *      Q.nfbind(FS.readFile, __filename)("utf-8")
 *      .then(console.log)
 *      .done()
 *
 */
exports.nfbind = nfbind;
function nfbind(callback/*, ...args */) {
    var baseArgs = array_slice(arguments, 1);
    return function () {
        var nodeArgs = baseArgs.concat(array_slice(arguments));
        var deferred = defer();
        nodeArgs.push(deferred.makeNodeResolver());

        fapply(callback, nodeArgs).fail(deferred.reject);
        return deferred.promise;
    };
}

/**
 * Passes a continuation to a Node function, which is called with a given
 * `this` value and arguments provided as an array, and returns a promise.
 *
 *      Q.napply(FS.readFile, FS, [__filename])
 *      .then(function (content) {
 *      })
 *
 */
exports.napply = deprecate(napply, "napply", "npost");
function napply(callback, thisp, args) {
    return nbind(callback, thisp).apply(void 0, args);
}

/**
 * Passes a continuation to a Node function, which is called with a given
 * `this` value and arguments provided individually, and returns a promise.
 *
 *      Q.ncall(FS.readFile, FS, __filename)
 *      .then(function (content) {
 *      })
 *
 */
exports.ncall = deprecate(ncall, "ncall", "ninvoke");
function ncall(callback, thisp /*, ...args*/) {
    var args = array_slice(arguments, 2);
    return napply(callback, thisp, args);
}

/**
 * Wraps a NodeJS continuation passing function and returns an equivalent
 * version that returns a promise.
 *
 *      Q.nbind(FS.readFile, FS)(__filename)
 *      .then(console.log)
 *      .done()
 *
 */
exports.nbind = deprecate(nbind, "nbind", "nfbind");
function nbind(callback /* thisp, ...args*/) {
    if (arguments.length > 1) {
        var thisp = arguments[1];
        var args = array_slice(arguments, 2);

        var originalCallback = callback;
        callback = function () {
            var combinedArgs = args.concat(array_slice(arguments));
            return originalCallback.apply(thisp, combinedArgs);
        };
    }
    return function () {
        var deferred = defer();
        var args = array_slice(arguments);
        // add a continuation that resolves the promise
        args.push(deferred.makeNodeResolver());
        // trap exceptions thrown by the callback
        fapply(callback, args)
        .fail(deferred.reject);
        return deferred.promise;
    };
}

/**
 * Calls a method of a Node-style object that accepts a Node-style
 * callback with a given array of arguments, plus a provided callback.
 * @param object an object that has the named method
 * @param {String} name name of the method of object
 * @param {Array} args arguments to pass to the method; the callback
 * will be provided by Q and appended to these arguments.
 * @returns a promise for the value or error
 */
exports.npost = npost;
function npost(object, name, args) {
    var nodeArgs = array_slice(args);
    var deferred = defer();
    nodeArgs.push(deferred.makeNodeResolver());

    post(object, name, nodeArgs).fail(deferred.reject);
    return deferred.promise;
}

/**
 * Calls a method of a Node-style object that accepts a Node-style
 * callback, forwarding the given variadic arguments, plus a provided
 * callback argument.
 * @param object an object that has the named method
 * @param {String} name name of the method of object
 * @param ...args arguments to pass to the method; the callback will
 * be provided by Q and appended to these arguments.
 * @returns a promise for the value or error
 */
exports.ninvoke = ninvoke;
function ninvoke(object, name /*, ...args*/) {
    var nodeArgs = array_slice(arguments, 2);
    var deferred = defer();
    nodeArgs.push(deferred.makeNodeResolver());

    post(object, name, nodeArgs).fail(deferred.reject);
    return deferred.promise;
}

exports.nend = deprecate(nodeify, "nend", "nodeify"); // XXX deprecated, use nodeify
exports.nodeify = nodeify;
function nodeify(promise, nodeback) {
    if (nodeback) {
        promise.then(function (value) {
            nextTick(function () {
                nodeback(null, value);
            });
        }, function (error) {
            nextTick(function () {
                nodeback(error);
            });
        });
    } else {
        return promise;
    }
}

// All code before this point will be filtered from stack traces.
var qEndingLine = captureLine();

});

;return module.exports;}({},{});
var __m11 = function(module,exports){module.exports=exports;
var Q = __m8;
var SimpleElement = __m21;

var documentFragment = document.createDocumentFragment();

module.exports = function(collage, src){
	var	deferred = Q.defer(),
		img = new Image();
	
	img.src = src;

	img.onload = function(){
		// This forces FF to set the width/height
		documentFragment.appendChild(img);
		deferred.resolve(new SimpleElement(img));
	};

	img.onerror = deferred.reject.bind(deferred);

	return deferred.promise;
};
;return module.exports;}({},{});
var __m15 = function(module,exports){module.exports=exports;
var Q = __m8,
	SimpleElement = __m21,
	mustache = __m26;

window.credits = window.credits || {};
var credits = window.credits.nyTimes = {};

var ARTICLE_TEMPLATE = '' +
		'<h2><a href="{{url}}">{{{title}}}</a></h2>' +
		'{{#image}}<img class="article-image" src="{{image.src}}" width="{{image.width}}" height="{{image.height}}"/>{{/image}}' + 
		'<div class="article-attribution">' +
			'<img class="nyt-brand" src="http://graphics8.nytimes.com/packages/images/developer/logos/poweredby_nytimes_30a.png"/>' +
			'<span class="byline">{{{byline}}}</span>' + 
			'<span class="date">{{date}}</span>' + 
		'</div>' +
		'<p>{{{body}}}</p>';

var documentFragment = document.createDocumentFragment();

var endpoint = "/svc/search/v1/article";
//var endpoint = "http://api.nytimes.com/svc/search/v1/article";

module.exports = function(collage, options){
	return query(options);
};

function query(options){
	function parseResponse(data){
		return data.results.map(function(data){
			element = document.createElement("div");
			element.className = "nytimes-article";

			if(data.byline){
				credits[data.byline.replace("By ", "")] = data.url;
			}
			
			var templateData = {
				title: data.title,
				byline: data.byline,
				date: (new Date(data.publication_year, data.publication_month, data.publication_day)).toLocaleDateString(),
				body: data.body,
				url: data.url
			};

			if(data.small_image_url){
				templateData.image = {
					src: data.small_image_url.replace(/thumbStandard.*\./, "hpMedium."),
					height: 253,
					width: 337
				};
			}

			element.innerHTML = mustache.render(ARTICLE_TEMPLATE, templateData);
			document.body.appendChild(element);

			element.width = element.clientWidth;
			element.height = element.clientHeight;

			documentFragment.appendChild(element);
			return new SimpleElement(element);
		});
	}

	if(options.data){
		return Q.when(parseResponse(options.data));
	} else {

	}
	return load(options).then(function(response){
		return parseResponse(response);
	});
}

function load(options){
	var deferred = Q.defer();

	var params = [
		"format=json",
		"fields=publication_year,publication_month,publication_day,body,date,title,url,byline,small_image_url,small_image_height,small_image_width",
		"api-key=af04c123c8988a12245668f5b5fa4f4c:8:67325739",
		"query=" + options.query
	];
	
	var request = new XMLHttpRequest();

	request.onload = function(){
		deferred.resolve(JSON.parse(this.responseText));
	};

	request.onerror = function(){
		deferred.reject();
	};

	request.open("get", endpoint + "?" + params.join("&"), true);
	request.send();

	return deferred.promise;
}

;return module.exports;}({},{});
var __m23 = function(module,exports){module.exports=exports;
var Q = __m8;

window.API_CALLBACKS = {};

module.exports = (function(){
	var callbackCounter = 0,
		callbacks = window.API_CALLBACKS,
		defaultTimeout = 10 * 1000;

	return function(endpoint, callbackParam, params, timeout){
		var callbackId = "c" + callbackCounter++,
			deferred = Q.defer(),
			script = document.createElement("script"),
			timeoutId;
		
		if(typeof callbackParam !== "string"){
			timeout = params;
			params = callbackParam;
			callbackParam = "callback";
		}

		timeout = timeout || defaultTimeout;
		params = params || [];
		params.push(callbackParam + "=API_CALLBACKS." + callbackId);

		timeoutId = setTimeout(function(){
			deferred.reject("timeout");
		}, timeout);
		
		callbacks[callbackId] = function(response){
			clearTimeout(timeoutId);
			delete callbacks[callbackId];
			deferred.resolve(response);
		}

		script.async = true;
		script.src = endpoint + "?" + params.join("&"); 
		document.body.appendChild(script);

		return deferred.promise;
	}
}());
;return module.exports;}({},{});
var __m12 = function(module,exports){module.exports=exports;
__m25;

var Q = __m8;
var VideoElement = __m22;
var getFromApi = __m23;
var TIMEOUT = 10 * 1000;

window.credits = window.credits || {};
var credits = window.credits.youtube = {};

module.exports = function(collage, options){
	if(options.query){
		return queryVideos(options).then(function(videoIds){
			options.videoIds = videoIds;
			return loadVideos(collage, options);
		})
	}

	if(options.videoId){
		options.videoIds = [options.videoId];

		return loadVideos(collage, options).then(function(elements){
			return elements[0];
		});
	} else if(options.videoIds){
		return loadVideos(collage, options);	
	}
};

var defaults = {
	duration: "short",
	key: 'AIzaSyAZw0kviWeCOidthcZAYs5oCZ0k8DsOuUk'
};

var queryVideos = (function(){
	var endpoint = "https://www.googleapis.com/youtube/v3/search";
	//var endpoint = "https://d3ggoqbhpexke2.cloudfront.net/youtube/v3/search";

	return function(options){
		utils.extend(options, defaults);

		var params = [
				"part=id,snippet",
				"videoDuration=" + options.duration,
				"type=video",
				"videoEmbeddable=true",
				"videoSyndicated=true",
				"key=" + options.key,
				"q=" + encodeURIComponent(options.query)
			];
		
		return getFromApi(endpoint, params).then(function(response){
			var videoIds = [];

			response.items.forEach(function(item){
				credits[item.snippet.channelTitle] = "http://youtube.com/" + item.snippet.channelTitle;
				videoIds.push(item.id.videoId);
			});

			return videoIds;
		});
	};
}());

var loadVideos = (function(){
	return function(collage, options){
		if(!Array.isArray(options.videoIds)) return;
		
		var index = options.videoIds.length,
			deferred = Q.defer(),
			elements = [],
			videoOptions,
			timedOut = false,
			timeout = setTimeout(function(){
				timedOut = true;
				deferred.resolve(elements);
			}, TIMEOUT);

		options.callback = function(element){
			if(timedOut || !element) return;
			elements.push(element);

			if(elements.length === options.videoIds.length){
				clearTimeout(timeout);
				deferred.resolve(elements);
			}
		}

		while(index--){
			videoOptions = Object.create(options);
			videoOptions.videoId = options.videoIds[index];
			loadVideo(collage, videoOptions);
		}

		return deferred.promise;
	};
}());

var isiOS = (navigator.userAgent.match(/(iPad|iPhone|iPod)/g) ? true : false );

var loadVideo = (function(){
	var playerIdCounter = 0;
	return function(collage, options){
		var videoId = options.videoId,
			width = options.width || 1060,
			height = options.height || 650;

		var playerId = "player" + (playerIdCounter++);

		var element = document.createElement("div");
		element.width = width;
		element.height = height;
		element.className = "youtube-video";
		
		if(isiOS) element.className += " hide-video-mask";

		element.innerHTML = '<div id="' + playerId + '"></div><div class="video-mask"></div>';
		collage.element.appendChild(element);
		
		var videoElement;

		new YT.Player(playerId, {
			height: height,
			width: width,
			playerVars: { 
				controls: 0, 
				html5: 1,
				start: (options.startTime || 0)
			},
			videoId: videoId,
			events: {
				onReady: function(e){
					var playerObj = e.target;
					videoElement = VideoElement.create(element, playerObj, {
						continuousPlay: options.continuousPlay,
						autoplay: options.autoplay,
						loop: options.loop
					});
					
					if(isiOS){
						videoElement.on("playing", function(){
							element.className = element.className.replace(' hide-video-mask', '');
						});

						videoElement.on("paused", function(){
							element.className += ' hide-video-mask';
						});
					}

					playerObj.pauseVideo();
					if(options.continuousPlay){
						playerObj.unMute();
						playerObj.setVolume(100);
					}

					if(options.mute){
						playerObj.mute();
						playerObj.setVolume(0);
					}
					
					if(options.callback) options.callback(videoElement);
				},
				onError: function(e){
				}
			}
		});
	};
}());

;return module.exports;}({},{});
var __m13 = function(module,exports){module.exports=exports;
var Q = __m8;
var mustache = __m26;
var getFromApi = __m23;
var SimpleElement = __m21;
	
window.credits = window.credits || {};
var credits = window.credits.googlePlus = {};

module.exports = function(collage, query){
	return queryActivities(query);
};

var ARTICLE_TEMPLATE = '' +
'<div class="article-wrapper">' +
	'<div class="post-attribution">' +
		'<a href="{{authorUrl}}">' +
			'{{#authorImage}}<img class="author-image" src="{{authorImage.src}}" width="{{authorImage.width}}" height="{{authorImage.height}}"/>{{/authorImage}}' +
			'<span class="author-name">{{authorName}}</span>' +
		'</a>' + 
		'<span class="post-date">on Google Plus &ndash; {{date}}</span>' +
	'</div>' +
	'<p class="author-comments">{{{authorComments}}}</p>' + 
	'<div class="article">' + 
		'<a href="{{articleUrl}}">' +
			'{{#image}}<img class="article-image" src="{{image.src}}" width="{{image.width}}" height="{{image.height}}"/>{{/image}}' + 
			'<div class="article-attribution">' +
				'<span>{{title}}</span>' + 
			'</div>' + 
		'</a>' +
		'<p class="article-body">{{body}}</p>' +
	'</div>' +
'</div>';

var documentFragment = document.createDocumentFragment();

var queryActivities = (function(){
	var endpoint = "https://www.googleapis.com/plus/v1/activities";

	return function(query){
		var params = [
				"key=AIzaSyAZw0kviWeCOidthcZAYs5oCZ0k8DsOuUk",
				"query=" + encodeURIComponent(query)
			];
		
		return getFromApi(endpoint, params).then(function(response){
			var elements = [];

			response.items.forEach(function(item){
				if(!(item && item.object && item.object.attachments && item.object.attachments.length > 0)) return;
				var article = item.object.attachments[0];
				if(article.objectType !== "article") return;

				var actor = item.object.actor || item.actor,
					authorComments = item.object.content;
				if(authorComments && authorComments.length > 150){
					authorComments = authorComments.substr(0, 150) + "&hellip;";
				}

				var templateParams = {
					authorName: actor.displayName,
					authorUrl: actor.url,
					authorId: actor.id,
					date: new Date(item.published).toLocaleDateString(),
					authorComments: authorComments,
					articleUrl: article.url,
					title: article.displayName,
					body: article.content
				};
								
				if(actor.image){
					templateParams.authorImage = {
						src: actor.image.url,
						width: 50,
						height: 50
					};
				}

				if(article.image){
					templateParams.image = {
						src: article.image.url,
						width: article.image.width,
						height: article.image.height
					};
				}
				
				var element = document.createElement("div");
				element.className = "gplus-article";
				element.innerHTML = mustache.render(ARTICLE_TEMPLATE, templateParams);
				document.body.appendChild(element);
				
				element.width = element.clientWidth;
				element.height = element.clientHeight;

				elements.push(new SimpleElement(element));
				documentFragment.appendChild(element);

			});

			return elements;
		});
	};
}());

;return module.exports;}({},{});
var __m14 = function(module,exports){module.exports=exports;
// This one is a bit questionable since it's deprecated, and the TOS for use in
// collages is unclear.

var Q = __m8;
var mustache = __m26;
var getFromApi = __m23;
var SimpleElement = __m21;
	
window.credits = window.credits || {};
var credits = window.credits.googleNews = {};

module.exports = function(collage, query){
	return search(query);
};

var ARTICLE_TEMPLATE = '' +
'<div class="article-wrapper">' +
	'{{#image}}' +
		'<a href="{{image.contextUrl}}">' +
			'<img title="Image by {{image.publisher}}" class="article-image" src="{{image.src}}" width="{{image.width}}" height="{{image.height}}"/>' + 
		'</a>' +
	'{{/image}}' +
	'<a class="article-title" href="{{sourceUrl}}">{{{title}}}</a>' + 
	'<p class="article-attribution">' +
		'<span class="article-publisher">{{{publisher}}}</span>' +
		' &ndash; <span class="article-date">{{date}}</span>' +
		' via {{#gnewsUrl}}<a class="article-via" href="{{gnewsUrl}}">{{/gnewsUrl}}Google News{{#gnewsUrl}}</a>{{/gnewsUrl}}' +
	'</p>' +
	'<p class="article-body">{{{body}}}</p>' +
'</div>';

var documentFragment = document.createDocumentFragment();

var search = (function(){
	var endpoint = "https://ajax.googleapis.com/ajax/services/search/news";
	//var endpoint = "/ajax/services/search/news";

	return function(query){
		var params = [
				"v=1.0",
				"rsz=8",
				"q=" + encodeURIComponent(query)
			];
		
		return getFromApi(endpoint, params).then(function(response){
			var elements = [];
			response.responseData.results.forEach(function(item){
				credits[item.publisher] = item.unescapedUrl;

				var templateParams = {
					title: item.titleNoFormatting,
					sourceUrl: item.unescapedUrl,
					publisher: item.publisher,
					date: (new Date(item.publishedDate)).toLocaleDateString(),
					gnewsUrl: item.clusterUrl,
					body: item.content
				};
								
				if(item.image){
					templateParams.image = {
						src: item.image.tbUrl,
						width: item.image.tbWidth,
						height: item.image.tbHeight,
						publisher: item.image.publisher,
						contextUrl: item.image.originalContextUrl
					};
				}

				var element = document.createElement("div");
				element.className = "gnews-article";
				element.innerHTML = mustache.render(ARTICLE_TEMPLATE, templateParams);
				document.body.appendChild(element);
				
				element.width = element.clientWidth;
				element.height = element.clientHeight;

				elements.push(new SimpleElement(element));
				documentFragment.appendChild(element);
			});

			return elements;
		});
	};
}());


;return module.exports;}({},{});
var __m5 = function(module,exports){module.exports=exports;
module.exports = Tag;

function Tag(){
	this.elements = [];
}

Tag.create = function(options){
	options = options || {};
	var tag = new Tag();
	
	if("skipProbability" in options) tag.skipProbability = options.skipProbability;
	if("tryLimit" in options) tag.tryLimit = options.tryLimit;

	return tag;
};

Tag.prototype.chanceMultiplier = 1;
Tag.prototype.skipProbability = 0;

Tag.prototype.add = function(element){
	var chanceMultiplier = element.chanceMultiplier;
	while(chanceMultiplier--) this.elements.push(element);
};

Tag.prototype.remove = function(element){
	var	index;

	// Remove all instances of the element
	while(~(index =  this.elements.indexOf(element))){
		this.elements.splice(index, 1);
	}
};

Tag.prototype.getElements = function(){
	return this.elements.slice();
};

Tag.prototype.getRandomElement = function(){
	return this.elements[(Math.random() * this.elements.length)|0];
};



;return module.exports;}({},{});
var __m4 = function(module,exports){module.exports=exports;
var BoundingBox = module.exports = function(element, left, top){
	this.element = element;
	this.top = top || 0;
	this.left = left || 0;
	this.width = this.element.width;
	this.height = this.element.height;
	this.bottom = this.top + this.height;
	this.right = this.left + this.width;

	element.locations.push(this);
}

BoundingBox.prototype.show = function(container){
	if(this.visible) return;
	
	this.visible = true;
	this.element.show(this.left, this.top, container);
};

BoundingBox.prototype.hide = function(container){
	if(!this.visible) return;

	this.visible = false;
	this.element.hide(container);
};
;return module.exports;}({},{});
var __m3 = function(module,exports){module.exports=exports;
exports.extend = function(destination, nSource){
	var sources = arguments.length,
		index = 1,
		source,
		key;

	for(; index < sources; index++){
		source = arguments[index];
		for(key in source){
			if(source.hasOwnProperty(key) && !(key in destination)){
				destination[key] = source[key];
			}
		}
	}
};

exports.attachIframeToCollage = function(collage, iframe, width, height){
	var container = document.createElement("div");
	container.className="iframe-container";
	
	var overflowWrapper = document.createElement("div");
	overflowWrapper.className = "iframe-overflow-wrapper";
	overflowWrapper.style.width = width + "px";
	overflowWrapper.style.height = height + "px";
	container.appendChild(overflowWrapper);

	iframe.style.width = width + "px";
	iframe.style.height = height + "px";
	overflowWrapper.appendChild(iframe);

	var mask = document.createElement("div");
	mask.className = "iframe-mask";
	container.appendChild(mask);

	var hasFocus = false;
	mask.addEventListener("click", function(e){
		hasFocus = true;
		container.className += " in-focus";
		collage.pause(0.4);
	});

	mask.addEventListener("mouseover", function(e){
		if(!hasFocus) return;
		hasFocus = false;
		container.className = container.className.replace(" in-focus", "");
		collage.resume(0.4);
	});

	collage.element.appendChild(container);
	
	return container;
}


exports.requestAnimationFrame = window.requestAnimationFrame || 
								window.mozRequestAnimationFrame ||
                              	window.webkitRequestAnimationFrame || 
                              	window.msRequestAnimationFrame || 
                              	function(cb){return setTimeout(cb, 15);};

exports.cancelAnimationFrame = 	window.cancelAnimationFrame || 
								window.mozCancelAnimationFrame ||
                              	window.webkitCancelAnimationFrame || 
                              	window.msCancelAnimationFrame || 
                              	function(timeout){return clearTimeout(timeout);};

exports.requestFullscreen = document.documentElement.requestFullscreen ||
							document.documentElement.mozRequestFullScreen ||
							document.documentElement.webkitRequestFullscreen ||
							function(){};

var bodyStyle = document.body.style;	
exports.transitionAttribute =	(bodyStyle.msTransition !== void 0) && "msTransition" ||
								(bodyStyle.webkitTransition !== void 0) && "webkitTransition" ||
								(bodyStyle.MozTransition !== void 0) && "MozTransition" || 
								(bodyStyle.transition !== void 0) && "transition";

;return module.exports;}({},{});
var __m10 = function(module,exports){module.exports=exports;
var Q = __m8,
	SimpleElement = __m21,
	utils = __m3,
	getFromApi = __m23;

window.credits = window.credits || {};
var credits = window.credits.flickr = {};

var endpoint = "http://api.flickr.com/services/rest/";
//var endpoint = "/services/rest/";

module.exports = getPhotos;

var defaults = {
	sort: "relevance",
	count: "20",
	license: "1,2,3,4,5,6,7,8", // http://www.flickr.com/services/api/flickr.photos.licenses.getInfo.html
	apiKey: "06960d3c3c8affd01e65ec032513557b",
	media: "photos",
	tagMode: "all",
	isCommons: false,
	contentType: "1" // Photos only (not screenshots or drawings)
};

function getPhotos(collage, options){
	var deferred = Q.defer(),
		params;
	
	if(typeof options === "string") options = {tags: options};
	utils.extend(options, defaults);

	params = [
		"format=json",
		"method=flickr.photos.search",
		"extras=url_z,url_m,path_alias",
		"api_key=" + options.apiKey,
		"license=" + options.license, 
		"sort=" + options.sort,
		"tag_mode=" + options.tagMode,
		"per_page=" + options.count,
		"content_type=" + options.contentType,
		"media=" + options.media,
		"tags=" + options.tags
	];

	if(options.isCommons){
		params.push("is_commons=" + options.isCommons);
	}

	getFromApi(endpoint, "jsoncallback", params).then(function(response){
		var elements = [],
			photos = response.photos && response.photos.photo || [],
			waiting = photos.length;

		photos.forEach(function(item){
			var url = item.url_z || item.url_m;

			if(!url){
				waiting--;
				return;
			};

			loadImage(item.url_z || item.url_m).then(function(element){
				var anchor = document.createElement("a");
				anchor.href = "http://www.flickr.com/photos/" + item.pathalias + "/" + item.id + "/";
				anchor.width = element.width;
				anchor.height = element.height;
				anchor.target = "_blank";
				anchor.style.display = "block";
				anchor.appendChild(element);
				
				credits[item.pathalias] = anchor.href;
				
				elements.push(SimpleElement.create(anchor));
				if(--waiting === 0) deferred.resolve(elements);
			}, function(){
				if(--waiting === 0) deferred.resolve(elements);
			});
		});
	});

	return deferred.promise;
};

var documentFragment = document.createDocumentFragment();
function loadImage(src){
	var	deferred = Q.defer(),
		img = new Image();
	
	img.src = src;

	img.onload = function(){
		// This forces FF to set the width/height
		documentFragment.appendChild(img);
		deferred.resolve(img);
	};

	img.onerror = deferred.reject.bind(deferred);

	return deferred.promise;
};
;return module.exports;}({},{});
var __m16 = function(module,exports){module.exports=exports;
// This uses an undocumented twitter api (twttr.widget.createTweet) so it might break

var Q = __m8,
	getFromApi = __m23,	
	utils = __m3,
	IframeElement = __m20;

var TIMEOUT = 1000 * 10;

window.credits = window.credits || {};
var credits = window.credits.twitter = {};

// options should have container and query
module.exports = function(collage, options){
	var container = collage.element;

	if(options.query){
		return queryTweets(options.query).then(function(tweetIds){
			return loadTweets(tweetIds, container, collage);
		});	
	} else if(options.ids) {
		return loadTweets(options.ids, container, collage);
	} else if(options.id){
		return loadTweets([options.id], container, collage).then(function(elements){
			if(elements && elements.length) return elements[0];
		});
	}
};

var loadTweets = (function(){
	return function(ids, container, collage){
		if(!Array.isArray(ids) || !container) return;

		var index = ids.length,
			deferred = Q.defer(),
			elements = [],
			timedOut = false,
			waitingForResize = [];
			timeout = setTimeout(function(){
				timedOut = true;
				clearInterval(heightChecker);
				deferred.resolve(elements);
			}, TIMEOUT);

		function heightCheck(){
			var index = waitingForResize.length,
				element;

			while(index--){
				element = waitingForResize[index];
				if(element.height !== "0"  && element.width !== "0"){
					elements.push(IframeElement.create(element));

					if(elements.length === ids.length){
						clearTimeout(timeout);
						clearInterval(heightChecker);
						deferred.resolve(elements);
					}

					waitingForResize.splice(index, 1);
				}
			}
		}

		var heightChecker = setInterval(heightCheck, 250);

		while(index--){
			twttr.widgets.createTweet(ids[index], container, function(element){
				if(timedOut) return;

				var iframeWindow =  'contentWindow' in element? element.contentWindow : element.contentDocument.defaultView;
				
				var onResizeCallback = iframeWindow.onresize,
					onMouseMoveCallback = iframeWindow.onmousemove;
				
				// Iframes capture all events, this allows us to bubble the event
				// up to this window's scope
				iframeWindow.onmousemove = function(e){
					onMouseMoveCallback && onMouseMoveCallback(e);
					var evt = document.createEvent("MouseEvents"),
						boundingClientRect = element.getBoundingClientRect();

					evt.initMouseEvent(	"mousemove", 
										true, 
										false, 
										window,
										e.detail,
										e.screenX,
										e.screenY, 
										e.clientX + boundingClientRect.left, 
										e.clientY + boundingClientRect.top, 
										e.ctrlKey, 
										e.altKey,
										e.shiftKey, 
										e.metaKey,
										e.button, 
										null);
					
					element.dispatchEvent(evt);
				};

				waitingForResize.push(element);
				element.style.opacity = 0;
			});
		}

		return deferred.promise;
	};
}());

var queryTweets = (function(){
	var endpoint = "http://search.twitter.com/search.json";
	//var endpoint = "/search.json";

	return function(query){
		return getFromApi(endpoint, [
			'format=json',
			'q=' + encodeURIComponent(query)
		]).then(function(response){
			var tweetIds = [],
				dupeCheck = [];

			response.results.forEach(function(item){
				// Skip retweets
				if(~dupeCheck.indexOf(item.text)){
					return;
				} else {
					dupeCheck.push(item.text);
				}

				// Skip matches on username
				if(~item.from_user.toLowerCase().indexOf(query.toLowerCase())){
					return;	
				}

				credits[item.from_user] = "http://twitter.com/" + item.from_user;

				tweetIds.push(item.id_str);
			});

			return tweetIds;
		});
	};
}());
;return module.exports;}({},{});
var __m17 = function(module,exports){module.exports=exports;
var Q = __m8,
	getFromApi = __m23,
	IframeElement = __m20,
	mustache = __m26,
	utils = __m3;

var endpoint = "https://graph.facebook.com/search";
//var endpoint = "/search";

window.credits = window.credits || {};
var credits = window.credits.facebook = {};

module.exports = function(collage, options){
	if(!options.type) options.type = "pages";
	
	switch(options.type){
		case "pages":
			return createPages(collage, options)
		break;
	}
};

var ACTIVITY_BOX_TEMPLATE = '<div class="fb-activity" data-site="www.hrc.org" data-width="{{width}}" data-height="{{height}}" data-header="false" data-recommendations="false"></div>'
var LIKE_BOX_TEMPLATE = '<div class="fb-like-box" data-href="http://www.facebook.com/{{id}}" data-width="{{width}}" data-height="{{height}}" data-show-faces="true" data-stream="false" data-header="false"></div>';

var defaults = {
	limit: 3,
	width: 400,
	height: 600,
	minLikes: 0,
	showFaces: true,
	showStream: true,
	showHeader: false,
	ids: []
};

function createPages(collage, options){
	utils.extend(options, defaults);
	var ids = options.ids;
	var gatherIds = Q.when(ids);
	
	if(options.query){
		return getFromApi(endpoint, [
			'type=page',
			'fields=name,link,likes,category',
			'limit=' + options.limit,
			'q=' + encodeURIComponent(options.query)
		]).then(function(response){
			response.data.forEach(function(item){
				if(item.likes < options.minLikes) return;
			
				credits[item.name] = item.link;
				ids.push(item.id);
			});

			return loadLikeBoxes(collage, ids, options);
		});
	} else {
		return Q.when(loadLikeBoxes(collage, ids, options));
	}
};

function loadLikeBoxes(collage, ids, options){
	var elements = [];

	ids.forEach(function(id){
		var element = document.createElement("div");
		element.className="fb-like-box";
		element.setAttribute("data-href", "http://www.facebook.com/" + id);
		element.setAttribute("data-width", options.width);
		element.setAttribute("data-height", options.height);
		element.setAttribute("data-show-faces", options.showFaces);
		element.setAttribute("data-stream", options.showStream);
		element.setAttribute("data-header", options.showHeader);

		var iframeElement = utils.attachIframeToCollage(collage, element, options.width, options.height);
		
		FB.XFBML.parse(iframeElement);

		elements.push(new IframeElement(iframeElement));
	});
	
	return elements;
}

;return module.exports;}({},{});
var __m19 = function(module,exports){module.exports=exports;
var Q = __m8,
	SimpleElement = __m21,
	IframeElement = __m20,
	utils = __m3,
	getFromApi = __m23;

window.credits = window.credits || {};
var credits = window.credits.reddit = {};

var endpoint = "http://www.reddit.com/r/all/search.json";
//var endpoint = "/r/all/search.json";

module.exports = function(collage, options){
	if(options.type === "embed"){
		return getEmbed(collage, options);
	} else {
		return getPhotos(collage, options);
	}
};

function getEmbed(collage, options){
	utils.extend(options, defaults);
	params = [
		"limit=" + options.limit,
		"restrict_sr=" + options.restrict_sr, 
		"sort=" + options.sort,
		"t=" + options.time,
		"q=" + options.query
	];

	var iframe;
	var self = this,
		iframe = document.createElement("IFRAME"),
		iframeDoc,
		iframeContent;

	var element = utils.attachIframeToCollage(collage, iframe, options.width, options.height);

	iframeDoc = (iframe.contentDocument) ? iframe.contentDocument : iframe.contentWindow.document;
	iframeContent = "<html><head><title></title></head><body>";
	iframeContent += '<script type="text/javascript" src="http://www.reddit.com/r/' + options.subreddit + '/search.embed?' + params.join("&").replace(' ', '%20') + '"></script>';
	iframeContent += "</body></html>";
	
	iframeDoc.open();
	iframeDoc.write(iframeContent);
	iframeDoc.close();
	
	return Q.when(new IframeElement(element));
}

var defaults = {
	limit: "20",
	subreddit: "all",
	restrict_sr: "false",
	sort: "top",
	time: "all",
	nsfw: "false",
	minComments: 0,
	width: 500,
	height:600,
	minScore: 0
};

function getPhotos(collage, options){
	var deferred = Q.defer(),
		params;
	
	if(typeof options === "string") options = {tags: options};
	utils.extend(options, defaults);

	params = [
		"limit=" + options.limit,
		"restrict_sr=" + options.restrict_sr, 
		"sort=" + options.sort,
		"t=" + options.time,
		"q=" + options.query
	];
	
	getFromApi(endpoint, "jsonp", params).then(function(response){
		var elements = [],
			photos = response.data && response.data.children || [],
			waiting;

		photos = photos.filter(function(item){
			item = item.data;

			if(	item.score < options.minScore || 
				item.num_comments < options.minComments ||
				(!~item.url.indexOf(".jpg"))){
				return false;	
			}

			return true;
		});

		waiting = photos.length;
		photos.forEach(function(item){
			item = item.data;
			
			credits[item.author] = "http://www.reddit.com" + item.permalink;
			
			loadImage(item.url).then(function(element){
				var anchor = document.createElement("a");
				anchor.href = "http://www.reddit.com" + item.permalink;
				anchor.width = element.width;
				anchor.height = element.height;
				anchor.target = "_blank";
				anchor.style.display = "block";
				anchor.appendChild(element);
				
				elements.push(SimpleElement.create(anchor));

				if(--waiting === 0) deferred.resolve(elements);
			}, function(){
				if(--waiting === 0) deferred.resolve(elements);
			});
		});
	});

	return deferred.promise;
};

var documentFragment = document.createDocumentFragment();
function loadImage(src){
	var	deferred = Q.defer(),
		img = new Image();
	
	img.src = src;

	img.onload = function(){
		// This forces FF to set the width/height
		documentFragment.appendChild(img);
		deferred.resolve(img);
	};

	img.onerror = deferred.reject.bind(deferred);

	return deferred.promise;
};
;return module.exports;}({},{});
var __m18 = function(module,exports){module.exports=exports;
var Q = __m8,
	IframeElement = __m20,
	utils = __m3;

module.exports = function(collage, options){
	var width = options.width || 500,
		height = options.height || 500;

	var iframe = document.createElement("iframe");
	iframe.src = options.url;

	var element = utils.attachIframeToCollage(collage, iframe, width, height);

	return Q.when(new IframeElement(element));
};

;return module.exports;}({},{});
var __m6 = function(module,exports){module.exports=exports;
exports.flickr = __m10;
exports.image = __m11;
exports.youtube = __m12;
exports.googlePlus = __m13;
exports.googleNews = __m14;
exports.nyTimes = __m15;
exports.twitter = __m16;
exports.facebook = __m17;
exports.iframe = __m18;
exports.reddit = __m19;
;return module.exports;}({},{});
var __m2 = function(module,exports){module.exports=exports;
;module.exports = (function(){
var __m4 = function(module,exports){module.exports=exports;
/*! Hammer.JS - v1.0.3 - 2013-03-02
 * http://eightmedia.github.com/hammer.js
 *
 * Copyright (c) 2013 Jorik Tangelder <j.tangelder@gmail.com>;
 * Licensed under the MIT license */

(function(window) {
    'use strict';

/**
 * Hammer
 * use this to create instances
 * @param   {HTMLElement}   element
 * @param   {Object}        options
 * @returns {Hammer.Instance}
 * @constructor
 */
var Hammer = function(element, options) {
    return new Hammer.Instance(element, options || {});
};

// default settings
Hammer.defaults = {
    // add styles and attributes to the element to prevent the browser from doing
    // its native behavior. this doesnt prevent the scrolling, but cancels
    // the contextmenu, tap highlighting etc
    // set to false to disable this
    stop_browser_behavior: {
        userSelect: 'none', // this also triggers onselectstart=false for IE
        touchCallout: 'none',
        touchAction: 'none',
        contentZooming: 'none',
        userDrag: 'none',
        tapHighlightColor: 'rgba(0,0,0,0)'
    }

    // more settings are defined per gesture at gestures.js
};

// detect touchevents
Hammer.HAS_POINTEREVENTS = navigator.pointerEnabled || navigator.msPointerEnabled;
Hammer.HAS_TOUCHEVENTS = ('ontouchstart' in window);

// eventtypes per touchevent (start, move, end)
// are filled by Hammer.event.determineEventTypes on setup
Hammer.EVENT_TYPES = {};

// direction defines
Hammer.DIRECTION_DOWN = 'down';
Hammer.DIRECTION_LEFT = 'left';
Hammer.DIRECTION_UP = 'up';
Hammer.DIRECTION_RIGHT = 'right';

// pointer type
Hammer.POINTER_MOUSE = 'mouse';
Hammer.POINTER_TOUCH = 'touch';
Hammer.POINTER_PEN = 'pen';

// touch event defines
Hammer.EVENT_START = 'start';
Hammer.EVENT_MOVE = 'move';
Hammer.EVENT_END = 'end';

// plugins namespace
Hammer.plugins = {};

// if the window events are set...
Hammer.READY = false;

/**
 * setup events to detect gestures on the document
 */
function setup() {
    if(Hammer.READY) {
        return;
    }

    // find what eventtypes we add listeners to
    Hammer.event.determineEventTypes();

    // Register all gestures inside Hammer.gestures
    for(var name in Hammer.gestures) {
        if(Hammer.gestures.hasOwnProperty(name)) {
            Hammer.detection.register(Hammer.gestures[name]);
        }
    }

    // Add touch events on the document
    Hammer.event.onTouch(document, Hammer.EVENT_MOVE, Hammer.detection.detect);
    Hammer.event.onTouch(document, Hammer.EVENT_END, Hammer.detection.endDetect);

    // Hammer is ready...!
    Hammer.READY = true;
}

/**
 * create new hammer instance
 * all methods should return the instance itself, so it is chainable.
 * @param   {HTMLElement}       element
 * @param   {Object}            [options={}]
 * @returns {Hammer.Instance}
 * @constructor
 */
Hammer.Instance = function(element, options) {
    var self = this;

    // setup HammerJS window events and register all gestures
    // this also sets up the default options
    setup();

    this.element = element;

    // start/stop detection option
    this.enabled = true;

    // merge options
    this.options = Hammer.utils.extend(
        Hammer.utils.extend({}, Hammer.defaults),
        options || {});

    // add some css to the element to prevent the browser from doing its native behavoir
    if(this.options.stop_browser_behavior) {
        Hammer.utils.stopDefaultBrowserBehavior(this.element, this.options.stop_browser_behavior);
    }

    // start detection on touchstart
    Hammer.event.onTouch(element, Hammer.EVENT_START, function(ev) {
        if(self.enabled) {
            Hammer.detection.startDetect(self, ev);
        }
    });

    // return instance
    return this;
};


Hammer.Instance.prototype = {
    /**
     * bind events to the instance
     * @param   {String}      gesture
     * @param   {Function}    handler
     * @returns {Hammer.Instance}
     */
    on: function onEvent(gesture, handler){
        var gestures = gesture.split(' ');
        for(var t=0; t<gestures.length; t++) {
            this.element.addEventListener(gestures[t], handler, false);
        }
        return this;
    },


    /**
     * unbind events to the instance
     * @param   {String}      gesture
     * @param   {Function}    handler
     * @returns {Hammer.Instance}
     */
    off: function offEvent(gesture, handler){
        var gestures = gesture.split(' ');
        for(var t=0; t<gestures.length; t++) {
            this.element.removeEventListener(gestures[t], handler, false);
        }
        return this;
    },


    /**
     * trigger gesture event
     * @param   {String}      gesture
     * @param   {Object}      eventData
     * @returns {Hammer.Instance}
     */
    trigger: function triggerEvent(gesture, eventData){
        // trigger DOM event
        var event = document.createEvent('Event');
		event.initEvent(gesture, true, true);
		event.gesture = eventData;
		this.element.dispatchEvent(event);
        return this;
    },


    /**
     * enable of disable hammer.js detection
     * @param   {Boolean}   state
     * @returns {Hammer.Instance}
     */
    enable: function enable(state) {
        this.enabled = state;
        return this;
    }
};

/**
 * this holds the last move event,
 * used to fix empty touchend issue
 * see the onTouch event for an explanation
 * @type {Object}
 */
var last_move_event = null;


/**
 * when the mouse is hold down, this is true
 * @type {Boolean}
 */
var enable_detect = false;


/**
 * when touch events have been fired, this is true
 * @type {Boolean}
 */
var touch_triggered = false;


Hammer.event = {
    /**
     * simple addEventListener
     * @param   {HTMLElement}   element
     * @param   {String}        type
     * @param   {Function}      handler
     */
    bindDom: function(element, type, handler) {
        var types = type.split(' ');
        for(var t=0; t<types.length; t++) {
            element.addEventListener(types[t], handler, false);
        }
    },


    /**
     * touch events with mouse fallback
     * @param   {HTMLElement}   element
     * @param   {String}        eventType        like Hammer.EVENT_MOVE
     * @param   {Function}      handler
     */
    onTouch: function onTouch(element, eventType, handler) {
		var self = this;
        this.bindDom(element, Hammer.EVENT_TYPES[eventType], function(ev) {
            var sourceEventType = ev.type.toLowerCase();

            // onmouseup, but when touchend has been fired we do nothing.
            // this is for touchdevices which also fire a mouseup on touchend
            if(sourceEventType.match(/mouseup/) && touch_triggered) {
                touch_triggered = false;
                return;
            }

            // mousebutton must be down or a touch event
            if(sourceEventType.match(/touch/) ||   // touch events are always on screen
                (sourceEventType.match(/mouse/) && ev.which === 1) ||   // mousedown
                (Hammer.HAS_POINTEREVENTS && sourceEventType.match(/down/))  // pointerevents touch
            ){
                enable_detect = true;
            }

            // we are in a touch event, set the touch triggered bool to true,
            // this for the conflicts that may occur on ios and android
            if(sourceEventType.match(/touch|pointer/)) {
                touch_triggered = true;
            }


            // when touch has been triggered in this detection session
            // and we are now handling a mouse event, we stop that to prevent conflicts
            if(enable_detect && !(touch_triggered && sourceEventType.match(/mouse/))) {
                // update pointer
                if(Hammer.HAS_POINTEREVENTS && eventType != Hammer.EVENT_END) {
                    Hammer.PointerEvent.updatePointer(eventType, ev);
                }

                // because touchend has no touches, and we often want to use these in our gestures,
                // we send the last move event as our eventData in touchend
                if(eventType === Hammer.EVENT_END && last_move_event !== null) {
                    ev = last_move_event;
                }
                // store the last move event
                else {
                    last_move_event = ev;
                }
                // trigger the handler
                handler.call(Hammer.detection, self.collectEventData(element, eventType, ev));

                // remove pointer after the handler is done
                if(Hammer.HAS_POINTEREVENTS && eventType == Hammer.EVENT_END) {
                    Hammer.PointerEvent.updatePointer(eventType, ev);
                }
            }


            // on the end we reset everything
            if(sourceEventType.match(/up|cancel|end/)) {
                enable_detect = false;
                last_move_event = null;
                Hammer.PointerEvent.reset();
            }
        });
    },


    /**
     * we have different events for each device/browser
     * determine what we need and set them in the Hammer.EVENT_TYPES constant
     */
    determineEventTypes: function determineEventTypes() {
        // determine the eventtype we want to set
        var types;
        if(Hammer.HAS_POINTEREVENTS) {
            types = Hammer.PointerEvent.getEvents();
        }
        // for non pointer events browsers
        else {
            types = [
                'touchstart mousedown',
                'touchmove mousemove',
                'touchend touchcancel mouseup'];
        }

        Hammer.EVENT_TYPES[Hammer.EVENT_START]  = types[0];
        Hammer.EVENT_TYPES[Hammer.EVENT_MOVE]   = types[1];
        Hammer.EVENT_TYPES[Hammer.EVENT_END]    = types[2];
    },


    /**
     * create touchlist depending on the event
     * @param   {Object}    ev
     * @param   {String}    eventType   used by the fakemultitouch plugin
     */
    getTouchList: function getTouchList(ev/*, eventType*/) {
        // get the fake pointerEvent touchlist
        if(Hammer.HAS_POINTEREVENTS) {
            return Hammer.PointerEvent.getTouchList();
        }
        // get the touchlist
        else if(ev.touches) {
            return ev.touches;
        }
        // make fake touchlist from mouse position
        else {
            return [{
                identifier: 1,
                pageX: ev.pageX,
                pageY: ev.pageY,
                target: ev.target
            }];
        }
    },


    /**
     * collect event data for Hammer js
     * @param   {HTMLElement}   element
     * @param   {String}        eventType        like Hammer.EVENT_MOVE
     * @param   {Object}        eventData
     */
    collectEventData: function collectEventData(element, eventType, ev) {
        var touches = this.getTouchList(ev, eventType);

        // find out pointerType
        var pointerType = Hammer.POINTER_TOUCH;
        if(ev.type.match(/mouse/) || Hammer.PointerEvent.matchType(Hammer.POINTER_MOUSE, ev)) {
            pointerType = Hammer.POINTER_MOUSE;
        }

        return {
            center      : Hammer.utils.getCenter(touches),
            timestamp   : ev.timestamp || new Date().getTime(), // for IE
            target      : ev.target,
            touches     : touches,
            eventType   : eventType,
            pointerType : pointerType,
            srcEvent    : ev,

            /**
             * prevent the browser default actions
             * mostly used to disable scrolling of the browser
             */
            preventDefault: function() {
                if(this.srcEvent.preventManipulation) {
                    this.srcEvent.preventManipulation();
                }

                if(this.srcEvent.preventDefault) {
                    this.srcEvent.preventDefault();
                }
            },

            /**
             * stop bubbling the event up to its parents
             */
            stopPropagation: function() {
                this.srcEvent.stopPropagation();
            },

            /**
             * immediately stop gesture detection
             * might be useful after a swipe was detected
             * @return {*}
             */
            stopDetect: function() {
                return Hammer.detection.stopDetect();
            }
        };
    }
};

Hammer.PointerEvent = {
    /**
     * holds all pointers
     * @type {Object}
     */
    pointers: {},

    /**
     * get a list of pointers
     * @returns {Array}     touchlist
     */
    getTouchList: function() {
        var pointers = this.pointers;
        var touchlist = [];

        // we can use forEach since pointerEvents only is in IE10
        Object.keys(pointers).sort().forEach(function(id) {
            touchlist.push(pointers[id]);
        });
        return touchlist;
    },

    /**
     * update the position of a pointer
     * @param   {String}   type             Hammer.EVENT_END
     * @param   {Object}   pointerEvent
     */
    updatePointer: function(type, pointerEvent) {
        if(type == Hammer.EVENT_END) {
            delete this.pointers[pointerEvent.pointerId];
        }
        else {
            pointerEvent.identifier = pointerEvent.pointerId;
            this.pointers[pointerEvent.pointerId] = pointerEvent;
        }
    },

    /**
     * check if ev matches pointertype
     * @param   {String}        pointerType     Hammer.POINTER_MOUSE
     * @param   {PointerEvent}  ev
     */
    matchType: function(pointerType, ev) {
        if(!ev.pointerType) {
            return false;
        }

        var types = {};
        types[Hammer.POINTER_MOUSE] = (ev.pointerType == ev.MSPOINTER_TYPE_MOUSE || ev.pointerType == Hammer.POINTER_MOUSE);
        types[Hammer.POINTER_TOUCH] = (ev.pointerType == ev.MSPOINTER_TYPE_TOUCH || ev.pointerType == Hammer.POINTER_TOUCH);
        types[Hammer.POINTER_PEN] = (ev.pointerType == ev.MSPOINTER_TYPE_PEN || ev.pointerType == Hammer.POINTER_PEN);
        return types[pointerType];
    },


    /**
     * get events
     */
    getEvents: function() {
        return [
            'pointerdown MSPointerDown',
            'pointermove MSPointerMove',
            'pointerup pointercancel MSPointerUp MSPointerCancel'
        ];
    },

    /**
     * reset the list
     */
    reset: function() {
        this.pointers = {};
    }
};

Hammer.utils = {
    /**
     * extend method,
     * also used for cloning when dest is an empty object
     * @param   {Object}    dest
     * @param   {Object}    src
     * @returns {Object}    dest
     */
    extend: function extend(dest, src) {
        for (var key in src) {
            dest[key] = src[key];
        }

        return dest;
    },


    /**
     * get the center of all the touches
     * @param   {Array}     touches
     * @returns {Object}    center
     */
    getCenter: function getCenter(touches) {
        var valuesX = [], valuesY = [];

        for(var t= 0,len=touches.length; t<len; t++) {
            valuesX.push(touches[t].pageX);
            valuesY.push(touches[t].pageY);
        }

        return {
            pageX: ((Math.min.apply(Math, valuesX) + Math.max.apply(Math, valuesX)) / 2),
            pageY: ((Math.min.apply(Math, valuesY) + Math.max.apply(Math, valuesY)) / 2)
        };
    },


    /**
     * calculate the velocity between two points
     * @param   {Number}    delta_time
     * @param   {Number}    delta_x
     * @param   {Number}    delta_y
     * @returns {Object}    velocity
     */
    getVelocity: function getSimpleDistance(delta_time, delta_x, delta_y) {
        return {
            x: Math.abs(delta_x / delta_time) || 0,
            y: Math.abs(delta_y / delta_time) || 0
        };
    },


    /**
     * calculate the angle between two coordinates
     * @param   {Touch}     touch1
     * @param   {Touch}     touch2
     * @returns {Number}    angle
     */
    getAngle: function getAngle(touch1, touch2) {
        var y = touch2.pageY - touch1.pageY,
            x = touch2.pageX - touch1.pageX;
        return Math.atan2(y, x) * 180 / Math.PI;
    },


    /**
     * angle to direction define
     * @param   {Touch}     touch1
     * @param   {Touch}     touch2
     * @returns {String}    direction constant, like Hammer.DIRECTION_LEFT
     */
    getDirection: function getDirection(touch1, touch2) {
        var x = Math.abs(touch1.pageX - touch2.pageX),
            y = Math.abs(touch1.pageY - touch2.pageY);

        if(x >= y) {
            return touch1.pageX - touch2.pageX > 0 ? Hammer.DIRECTION_LEFT : Hammer.DIRECTION_RIGHT;
        }
        else {
            return touch1.pageY - touch2.pageY > 0 ? Hammer.DIRECTION_UP : Hammer.DIRECTION_DOWN;
        }
    },


    /**
     * calculate the distance between two touches
     * @param   {Touch}     touch1
     * @param   {Touch}     touch2
     * @returns {Number}    distance
     */
    getDistance: function getDistance(touch1, touch2) {
        var x = touch2.pageX - touch1.pageX,
            y = touch2.pageY - touch1.pageY;
        return Math.sqrt((x*x) + (y*y));
    },


    /**
     * calculate the scale factor between two touchLists (fingers)
     * no scale is 1, and goes down to 0 when pinched together, and bigger when pinched out
     * @param   {Array}     start
     * @param   {Array}     end
     * @returns {Number}    scale
     */
    getScale: function getScale(start, end) {
        // need two fingers...
        if(start.length >= 2 && end.length >= 2) {
            return this.getDistance(end[0], end[1]) /
                this.getDistance(start[0], start[1]);
        }
        return 1;
    },


    /**
     * calculate the rotation degrees between two touchLists (fingers)
     * @param   {Array}     start
     * @param   {Array}     end
     * @returns {Number}    rotation
     */
    getRotation: function getRotation(start, end) {
        // need two fingers
        if(start.length >= 2 && end.length >= 2) {
            return this.getAngle(end[1], end[0]) -
                this.getAngle(start[1], start[0]);
        }
        return 0;
    },


    /**
     * boolean if the direction is vertical
     * @param    {String}    direction
     * @returns  {Boolean}   is_vertical
     */
    isVertical: function isVertical(direction) {
        return (direction == Hammer.DIRECTION_UP || direction == Hammer.DIRECTION_DOWN);
    },


    /**
     * stop browser default behavior with css props
     * @param   {HtmlElement}   element
     * @param   {Object}        css_props
     */
    stopDefaultBrowserBehavior: function stopDefaultBrowserBehavior(element, css_props) {
        var prop,
            vendors = ['webkit','khtml','moz','ms','o',''];

        if(!css_props || !element.style) {
            return;
        }

        // with css properties for modern browsers
        for(var i = 0; i < vendors.length; i++) {
            for(var p in css_props) {
                if(css_props.hasOwnProperty(p)) {
                    prop = p;

                    // vender prefix at the property
                    if(vendors[i]) {
                        prop = vendors[i] + prop.substring(0, 1).toUpperCase() + prop.substring(1);
                    }

                    // set the style
                    element.style[prop] = css_props[p];
                }
            }
        }

        // also the disable onselectstart
        if(css_props.userSelect == 'none') {
            element.onselectstart = function() {
                return false;
            };
        }
    }
};

Hammer.detection = {
    // contains all registred Hammer.gestures in the correct order
    gestures: [],

    // data of the current Hammer.gesture detection session
    current: null,

    // the previous Hammer.gesture session data
    // is a full clone of the previous gesture.current object
    previous: null,

    // when this becomes true, no gestures are fired
    stopped: false,


    /**
     * start Hammer.gesture detection
     * @param   {Hammer.Instance}   inst
     * @param   {Object}            eventData
     */
    startDetect: function startDetect(inst, eventData) {
        // already busy with a Hammer.gesture detection on an element
        if(this.current) {
            return;
        }

        this.stopped = false;

        this.current = {
            inst        : inst, // reference to HammerInstance we're working for
            startEvent  : Hammer.utils.extend({}, eventData), // start eventData for distances, timing etc
            lastEvent   : false, // last eventData
            name        : '' // current gesture we're in/detected, can be 'tap', 'hold' etc
        };

        this.detect(eventData);
    },


    /**
     * Hammer.gesture detection
     * @param   {Object}    eventData
     */
    detect: function detect(eventData) {
        if(!this.current || this.stopped) {
            return;
        }

        // extend event data with calculations about scale, distance etc
        eventData = this.extendEventData(eventData);

        // instance options
        var inst_options = this.current.inst.options;

        // call Hammer.gesture handlers
        for(var g=0,len=this.gestures.length; g<len; g++) {
            var gesture = this.gestures[g];

            // only when the instance options have enabled this gesture
            if(!this.stopped && inst_options[gesture.name] !== false) {
                // if a handler returns false, we stop with the detection
                if(gesture.handler.call(gesture, eventData, this.current.inst) === false) {
                    this.stopDetect();
                    break;
                }
            }
        }

        // store as previous event event
        if(this.current) {
            this.current.lastEvent = eventData;
        }
    },


    /**
     * end Hammer.gesture detection
     * @param   {Object}    eventData
     */
    endDetect: function endDetect(eventData) {
        this.detect(eventData);
        this.stopDetect();
    },


    /**
     * clear the Hammer.gesture vars
     * this is called on endDetect, but can also be used when a final Hammer.gesture has been detected
     * to stop other Hammer.gestures from being fired
     */
    stopDetect: function stopDetect() {
        // clone current data to the store as the previous gesture
        // used for the double tap gesture, since this is an other gesture detect session
        this.previous = Hammer.utils.extend({}, this.current);

        // reset the current
        this.current = null;

        // stopped!
        this.stopped = true;
    },


    /**
     * extend eventData for Hammer.gestures
     * @param   {Object}   ev
     * @returns {Object}   ev
     */
    extendEventData: function extendEventData(ev) {
        var startEv = this.current.startEvent;

        // if the touches change, set the new touches over the startEvent touches
        // this because touchevents don't have all the touches on touchstart, or the
        // user must place his fingers at the EXACT same time on the screen, which is not realistic
        // but, sometimes it happens that both fingers are touching at the EXACT same time
        if(startEv && (ev.touches.length != startEv.touches.length || ev.touches === startEv.touches)) {
            // extend 1 level deep to get the touchlist with the touch objects
            startEv.touches = [];
            for(var i=0,len=ev.touches.length; i<len; i++) {
                startEv.touches.push(Hammer.utils.extend({}, ev.touches[i]));
            }
        }

        var delta_time = ev.timestamp - startEv.timestamp,
            delta_x = ev.center.pageX - startEv.center.pageX,
            delta_y = ev.center.pageY - startEv.center.pageY,
            velocity = Hammer.utils.getVelocity(delta_time, delta_x, delta_y);

        Hammer.utils.extend(ev, {
            deltaTime   : delta_time,

            deltaX      : delta_x,
            deltaY      : delta_y,

            velocityX   : velocity.x,
            velocityY   : velocity.y,

            distance    : Hammer.utils.getDistance(startEv.center, ev.center),
            angle       : Hammer.utils.getAngle(startEv.center, ev.center),
            direction   : Hammer.utils.getDirection(startEv.center, ev.center),

            scale       : Hammer.utils.getScale(startEv.touches, ev.touches),
            rotation    : Hammer.utils.getRotation(startEv.touches, ev.touches),

            startEvent  : startEv
        });

        return ev;
    },


    /**
     * register new gesture
     * @param   {Object}    gesture object, see gestures.js for documentation
     * @returns {Array}     gestures
     */
    register: function register(gesture) {
        // add an enable gesture options if there is no given
        var options = gesture.defaults || {};
        if(typeof(options[gesture.name]) == 'undefined') {
            options[gesture.name] = true;
        }

        // extend Hammer default options with the Hammer.gesture options
        Hammer.utils.extend(Hammer.defaults, options);

        // set its index
        gesture.index = gesture.index || 1000;

        // add Hammer.gesture to the list
        this.gestures.push(gesture);

        // sort the list by index
        this.gestures.sort(function(a, b) {
            if (a.index < b.index) {
                return -1;
            }
            if (a.index > b.index) {
                return 1;
            }
            return 0;
        });

        return this.gestures;
    }
};


Hammer.gestures = Hammer.gestures || {};

/**
 * Custom gestures
 * ==============================
 *
 * Gesture object
 * --------------------
 * The object structure of a gesture:
 *
 * { name: 'mygesture',
 *   index: 1337,
 *   defaults: {
 *     mygesture_option: true
 *   }
 *   handler: function(type, ev, inst) {
 *     // trigger gesture event
 *     inst.trigger(this.name, ev);
 *   }
 * }

 * @param   {String}    name
 * this should be the name of the gesture, lowercase
 * it is also being used to disable/enable the gesture per instance config.
 *
 * @param   {Number}    [index=1000]
 * the index of the gesture, where it is going to be in the stack of gestures detection
 * like when you build an gesture that depends on the drag gesture, it is a good
 * idea to place it after the index of the drag gesture.
 *
 * @param   {Object}    [defaults={}]
 * the default settings of the gesture. these are added to the instance settings,
 * and can be overruled per instance. you can also add the name of the gesture,
 * but this is also added by default (and set to true).
 *
 * @param   {Function}  handler
 * this handles the gesture detection of your custom gesture and receives the
 * following arguments:
 *
 *      @param  {Object}    eventData
 *      event data containing the following properties:
 *          timestamp   {Number}        time the event occurred
 *          target      {HTMLElement}   target element
 *          touches     {Array}         touches (fingers, pointers, mouse) on the screen
 *          pointerType {String}        kind of pointer that was used. matches Hammer.POINTER_MOUSE|TOUCH
 *          center      {Object}        center position of the touches. contains pageX and pageY
 *          deltaTime   {Number}        the total time of the touches in the screen
 *          deltaX      {Number}        the delta on x axis we haved moved
 *          deltaY      {Number}        the delta on y axis we haved moved
 *          velocityX   {Number}        the velocity on the x
 *          velocityY   {Number}        the velocity on y
 *          angle       {Number}        the angle we are moving
 *          direction   {String}        the direction we are moving. matches Hammer.DIRECTION_UP|DOWN|LEFT|RIGHT
 *          distance    {Number}        the distance we haved moved
 *          scale       {Number}        scaling of the touches, needs 2 touches
 *          rotation    {Number}        rotation of the touches, needs 2 touches *
 *          eventType   {String}        matches Hammer.EVENT_START|MOVE|END
 *          srcEvent    {Object}        the source event, like TouchStart or MouseDown *
 *          startEvent  {Object}        contains the same properties as above,
 *                                      but from the first touch. this is used to calculate
 *                                      distances, deltaTime, scaling etc
 *
 *      @param  {Hammer.Instance}    inst
 *      the instance we are doing the detection for. you can get the options from
 *      the inst.options object and trigger the gesture event by calling inst.trigger
 *
 *
 * Handle gestures
 * --------------------
 * inside the handler you can get/set Hammer.detection.current. This is the current
 * detection session. It has the following properties
 *      @param  {String}    name
 *      contains the name of the gesture we have detected. it has not a real function,
 *      only to check in other gestures if something is detected.
 *      like in the drag gesture we set it to 'drag' and in the swipe gesture we can
 *      check if the current gesture is 'drag' by accessing Hammer.detection.current.name
 *
 *      @readonly
 *      @param  {Hammer.Instance}    inst
 *      the instance we do the detection for
 *
 *      @readonly
 *      @param  {Object}    startEvent
 *      contains the properties of the first gesture detection in this session.
 *      Used for calculations about timing, distance, etc.
 *
 *      @readonly
 *      @param  {Object}    lastEvent
 *      contains all the properties of the last gesture detect in this session.
 *
 * after the gesture detection session has been completed (user has released the screen)
 * the Hammer.detection.current object is copied into Hammer.detection.previous,
 * this is usefull for gestures like doubletap, where you need to know if the
 * previous gesture was a tap
 *
 * options that have been set by the instance can be received by calling inst.options
 *
 * You can trigger a gesture event by calling inst.trigger("mygesture", event).
 * The first param is the name of your gesture, the second the event argument
 *
 *
 * Register gestures
 * --------------------
 * When an gesture is added to the Hammer.gestures object, it is auto registered
 * at the setup of the first Hammer instance. You can also call Hammer.detection.register
 * manually and pass your gesture object as a param
 *
 */

/**
 * Hold
 * Touch stays at the same place for x time
 * @events  hold
 */
Hammer.gestures.Hold = {
    name: 'hold',
    index: 10,
    defaults: {
        hold_timeout: 500,
        hold_threshold: 1
    },
    timer: null,
    handler: function holdGesture(ev, inst) {
        switch(ev.eventType) {
            case Hammer.EVENT_START:
                // clear any running timers
                clearTimeout(this.timer);

                // set the gesture so we can check in the timeout if it still is
                Hammer.detection.current.name = this.name;

                // set timer and if after the timeout it still is hold,
                // we trigger the hold event
                this.timer = setTimeout(function() {
                    if(Hammer.detection.current.name == 'hold') {
                        inst.trigger('hold', ev);
                    }
                }, inst.options.hold_timeout);
                break;

            // when you move or end we clear the timer
            case Hammer.EVENT_MOVE:
                if(ev.distance > inst.options.hold_threshold) {
                    clearTimeout(this.timer);
                }
                break;

            case Hammer.EVENT_END:
                clearTimeout(this.timer);
                break;
        }
    }
};


/**
 * Tap/DoubleTap
 * Quick touch at a place or double at the same place
 * @events  tap, doubletap
 */
Hammer.gestures.Tap = {
    name: 'tap',
    index: 100,
    defaults: {
        tap_max_touchtime  : 250,
        tap_max_distance   : 10,
        doubletap_distance : 20,
        doubletap_interval : 300
    },
    handler: function tapGesture(ev, inst) {
        if(ev.eventType == Hammer.EVENT_END) {
            // previous gesture, for the double tap since these are two different gesture detections
            var prev = Hammer.detection.previous;

            // when the touchtime is higher then the max touch time
            // or when the moving distance is too much
            if(ev.deltaTime > inst.options.tap_max_touchtime ||
                ev.distance > inst.options.tap_max_distance) {
                return;
            }

            // check if double tap
            if(prev && prev.name == 'tap' &&
                (ev.timestamp - prev.lastEvent.timestamp) < inst.options.doubletap_interval &&
                ev.distance < inst.options.doubletap_distance) {
                Hammer.detection.current.name = 'doubletap';
            }
            else {
                Hammer.detection.current.name = 'tap';
            }

            inst.trigger(Hammer.detection.current.name, ev);
        }
    }
};


/**
 * Swipe
 * triggers swipe events when the end velocity is above the threshold
 * @events  swipe, swipeleft, swiperight, swipeup, swipedown
 */
Hammer.gestures.Swipe = {
    name: 'swipe',
    index: 40,
    defaults: {
        // set 0 for unlimited, but this can conflict with transform
        swipe_max_touches  : 1,
        swipe_velocity     : 0.7
    },
    handler: function swipeGesture(ev, inst) {
        if(ev.eventType == Hammer.EVENT_END) {
            // max touches
            if(inst.options.swipe_max_touches > 0 &&
                ev.touches.length > inst.options.swipe_max_touches) {
                return;
            }

            // when the distance we moved is too small we skip this gesture
            // or we can be already in dragging
            if(ev.velocityX > inst.options.swipe_velocity ||
                ev.velocityY > inst.options.swipe_velocity) {
                // trigger swipe events
                inst.trigger(this.name, ev);
                inst.trigger(this.name + ev.direction, ev);
            }
        }
    }
};


/**
 * Drag
 * Move with x fingers (default 1) around on the page. Blocking the scrolling when
 * moving left and right is a good practice. When all the drag events are blocking
 * you disable scrolling on that area.
 * @events  drag, drapleft, dragright, dragup, dragdown
 */
Hammer.gestures.Drag = {
    name: 'drag',
    index: 50,
    defaults: {
        drag_min_distance : 10,
        // set 0 for unlimited, but this can conflict with transform
        drag_max_touches  : 1,
        // prevent default browser behavior when dragging occurs
        // be careful with it, it makes the element a blocking element
        // when you are using the drag gesture, it is a good practice to set this true
        drag_block_horizontal   : false,
        drag_block_vertical     : false,
        // drag_lock_to_axis keeps the drag gesture on the axis that it started on,
        // It disallows vertical directions if the initial direction was horizontal, and vice versa.
        drag_lock_to_axis       : false
    },
    triggered: false,
    handler: function dragGesture(ev, inst) {
        // current gesture isnt drag, but dragged is true
        // this means an other gesture is busy. now call dragend
        if(Hammer.detection.current.name != this.name && this.triggered) {
            inst.trigger(this.name +'end', ev);
            this.triggered = false;
            return;
        }

        // max touches
        if(inst.options.drag_max_touches > 0 &&
            ev.touches.length > inst.options.drag_max_touches) {
            return;
        }

        switch(ev.eventType) {
            case Hammer.EVENT_START:
                this.triggered = false;
                break;

            case Hammer.EVENT_MOVE:
                // when the distance we moved is too small we skip this gesture
                // or we can be already in dragging
                if(ev.distance < inst.options.drag_min_distance &&
                    Hammer.detection.current.name != this.name) {
                    return;
                }

                // we are dragging!
                Hammer.detection.current.name = this.name;

                // lock drag to axis?
                var last_direction = Hammer.detection.current.lastEvent.direction;
                if(inst.options.drag_lock_to_axis && last_direction !== ev.direction) {
                    // keep direction on the axis that the drag gesture started on
                    if(Hammer.utils.isVertical(last_direction)) {
                        ev.direction = (ev.deltaY < 0) ? Hammer.DIRECTION_UP : Hammer.DIRECTION_DOWN;
                    }
                    else {
                        ev.direction = (ev.deltaX < 0) ? Hammer.DIRECTION_LEFT : Hammer.DIRECTION_RIGHT;
                    }
                }

                // first time, trigger dragstart event
                if(!this.triggered) {
                    inst.trigger(this.name +'start', ev);
                    this.triggered = true;
                }

                // trigger normal event
                inst.trigger(this.name, ev);

                // direction event, like dragdown
                inst.trigger(this.name + ev.direction, ev);

                // block the browser events
                if( (inst.options.drag_block_vertical && Hammer.utils.isVertical(ev.direction)) ||
                    (inst.options.drag_block_horizontal && !Hammer.utils.isVertical(ev.direction))) {
                    ev.preventDefault();
                }
                break;

            case Hammer.EVENT_END:
                // trigger dragend
                if(this.triggered) {
                    inst.trigger(this.name +'end', ev);
                }

                this.triggered = false;
                break;
        }
    }
};


/**
 * Transform
 * User want to scale or rotate with 2 fingers
 * @events  transform, pinch, pinchin, pinchout, rotate
 */
Hammer.gestures.Transform = {
    name: 'transform',
    index: 45,
    defaults: {
        // factor, no scale is 1, zoomin is to 0 and zoomout until higher then 1
        transform_min_scale     : 0.01,
        // rotation in degrees
        transform_min_rotation  : 1,
        // prevent default browser behavior when two touches are on the screen
        // but it makes the element a blocking element
        // when you are using the transform gesture, it is a good practice to set this true
        transform_always_block  : false
    },
    triggered: false,
    handler: function transformGesture(ev, inst) {
        // current gesture isnt drag, but dragged is true
        // this means an other gesture is busy. now call dragend
        if(Hammer.detection.current.name != this.name && this.triggered) {
            inst.trigger(this.name +'end', ev);
            this.triggered = false;
            return;
        }

        // atleast multitouch
        if(ev.touches.length < 2) {
            return;
        }

        // prevent default when two fingers are on the screen
        if(inst.options.transform_always_block) {
            ev.preventDefault();
        }

        switch(ev.eventType) {
            case Hammer.EVENT_START:
                this.triggered = false;
                break;

            case Hammer.EVENT_MOVE:
                var scale_threshold = Math.abs(1-ev.scale);
                var rotation_threshold = Math.abs(ev.rotation);

                // when the distance we moved is too small we skip this gesture
                // or we can be already in dragging
                if(scale_threshold < inst.options.transform_min_scale &&
                    rotation_threshold < inst.options.transform_min_rotation) {
                    return;
                }

                // we are transforming!
                Hammer.detection.current.name = this.name;

                // first time, trigger dragstart event
                if(!this.triggered) {
                    inst.trigger(this.name +'start', ev);
                    this.triggered = true;
                }

                inst.trigger(this.name, ev); // basic transform event

                // trigger rotate event
                if(rotation_threshold > inst.options.transform_min_rotation) {
                    inst.trigger('rotate', ev);
                }

                // trigger pinch event
                if(scale_threshold > inst.options.transform_min_scale) {
                    inst.trigger('pinch', ev);
                    inst.trigger('pinch'+ ((ev.scale < 1) ? 'in' : 'out'), ev);
                }
                break;

            case Hammer.EVENT_END:
                // trigger dragend
                if(this.triggered) {
                    inst.trigger(this.name +'end', ev);
                }

                this.triggered = false;
                break;
        }
    }
};


/**
 * Touch
 * Called as first, tells the user has touched the screen
 * @events  touch
 */
Hammer.gestures.Touch = {
    name: 'touch',
    index: -Infinity,
    defaults: {
        // call preventDefault at touchstart, and makes the element blocking by
        // disabling the scrolling of the page, but it improves gestures like
        // transforming and dragging.
        // be careful with using this, it can be very annoying for users to be stuck
        // on the page
        prevent_default: false
    },
    handler: function touchGesture(ev, inst) {
        if(inst.options.prevent_default) {
            ev.preventDefault();
        }

        if(ev.eventType ==  Hammer.EVENT_START) {
            inst.trigger(this.name, ev);
        }
    }
};


/**
 * Release
 * Called as last, tells the user has released the screen
 * @events  release
 */
Hammer.gestures.Release = {
    name: 'release',
    index: Infinity,
    handler: function releaseGesture(ev, inst) {
        if(ev.eventType ==  Hammer.EVENT_END) {
            inst.trigger(this.name, ev);
        }
    }
};

// node export
if(typeof module === 'object' && typeof module.exports === 'object'){
    module.exports = Hammer;
}
// just window export
else {
    window.Hammer = Hammer;

    // requireJS module definition
    if(typeof window.define === 'function' && window.define.amd) {
        window.define('hammer', [], function() {
            return Hammer;
        });
    }
}
})(this);
;return module.exports;}({},{});
var __m3 = function(module,exports){module.exports=exports;
/**
 * EventEmitter v4.0.5 - git.io/ee
 * Oliver Caldwell
 * MIT license
 * @preserve
 */

;(function(exports) {
    // JSHint config - http://www.jshint.com/
    /*jshint laxcomma:true*/
    /*global define:true*/

    // Place the script in strict mode
    'use strict';

    /**
     * Class for managing events.
     * Can be extended to provide event functionality in other classes.
     *
     * @class Manages event registering and emitting.
     */
    function EventEmitter(){}

    // Shortcuts to improve speed and size

        // Easy access to the prototype
    var proto = EventEmitter.prototype

      // Existence of a native indexOf
      , nativeIndexOf = Array.prototype.indexOf ? true : false;

    /**
     * Finds the index of the listener for the event in it's storage array
     *
     * @param {Function} listener Method to look for.
     * @param {Function[]} listeners Array of listeners to search through.
     * @return {Number} Index of the specified listener, -1 if not found
     */
    function indexOfListener(listener, listeners) {
        // Return the index via the native method if possible
        if(nativeIndexOf) {
            return listeners.indexOf(listener);
        }

        // There is no native method
        // Use a manual loop to find the index
        var i = listeners.length;
        while(i--) {
            // If the listener matches, return it's index
            if(listeners[i] === listener) {
                return i;
            }
        }

        // Default to returning -1
        return -1;
    }

    /**
     * Fetches the events object and creates one if required.
     *
     * @return {Object} The events storage object.
     */
    proto._getEvents = function() {
        return this._events || (this._events = {});
    };

    /**
     * Returns the listener array for the specified event.
     * Will initialise the event object and listener arrays if required.
     *
     * @param {String} evt Name of the event to return the listeners from.
     * @return {Function[]} All listener functions for the event.
     * @doc
     */
    proto.getListeners = function(evt) {
        // Create a shortcut to the storage object
        // Initialise it if it does not exists yet
        var events = this._getEvents();

        // Return the listener array
        // Initialise it if it does not exist
        return events[evt] || (events[evt] = []);
    };

    /**
     * Adds a listener function to the specified event.
     * The listener will not be added if it is a duplicate.
     * If the listener returns true then it will be removed after it is called.
     *
     * @param {String} evt Name of the event to attach the listener to.
     * @param {Function} listener Method to be called when the event is emitted. If the function returns true then it will be removed after calling.
     * @return {Object} Current instance of EventEmitter for chaining.
     * @doc
     */
    proto.addListener = function(evt, listener) {
        // Fetch the listeners
        var listeners = this.getListeners(evt);

        // Push the listener into the array if it is not already there
        if(indexOfListener(listener, listeners) === -1) {
            listeners.push(listener);
        }

        // Return the instance of EventEmitter to allow chaining
        return this;
    };

    /**
     * Alias of addListener
     * @doc
     */
    proto.on = proto.addListener;

    /**
     * Removes a listener function from the specified event.
     *
     * @param {String} evt Name of the event to remove the listener from.
     * @param {Function} listener Method to remove from the event.
     * @return {Object} Current instance of EventEmitter for chaining.
     * @doc
     */
    proto.removeListener = function(evt, listener) {
        // Fetch the listeners
        // And get the index of the listener in the array
        var listeners = this.getListeners(evt)
          , index = indexOfListener(listener, listeners);

        // If the listener was found then remove it
        if(index !== -1) {
            listeners.splice(index, 1);

            // If there are no more listeners in this array then remove it
            if(listeners.length === 0) {
                this.removeEvent(evt);
            }
        }

        // Return the instance of EventEmitter to allow chaining
        return this;
    };

    /**
     * Alias of removeListener
     * @doc
     */
    proto.off = proto.removeListener;

    /**
     * Adds listeners in bulk using the manipulateListeners method.
     * If you pass an object as the second argument you can add to multiple events at once. The object should contain key value pairs of events and listeners or listener arrays.
     * You can also pass it an event name and an array of listeners to be added.
     *
     * @param {String|Object} evt An event name if you will pass an array of listeners next. An object if you wish to add to multiple events at once.
     * @param {Function[]} [listeners] An optional array of listener functions to add.
     * @return {Object} Current instance of EventEmitter for chaining.
     * @doc
     */
    proto.addListeners = function(evt, listeners) {
        // Pass through to manipulateListeners
        return this.manipulateListeners(false, evt, listeners);
    };

    /**
     * Removes listeners in bulk using the manipulateListeners method.
     * If you pass an object as the second argument you can remove from multiple events at once. The object should contain key value pairs of events and listeners or listener arrays.
     * You can also pass it an event name and an array of listeners to be removed.
     *
     * @param {String|Object} evt An event name if you will pass an array of listeners next. An object if you wish to remove from multiple events at once.
     * @param {Function[]} [listeners] An optional array of listener functions to remove.
     * @return {Object} Current instance of EventEmitter for chaining.
     * @doc
     */
    proto.removeListeners = function(evt, listeners) {
        // Pass through to manipulateListeners
        return this.manipulateListeners(true, evt, listeners);
    };

    /**
     * Edits listeners in bulk. The addListeners and removeListeners methods both use this to do their job. You should really use those instead, this is a little lower level.
     * The first argument will determine if the listeners are removed (true) or added (false).
     * If you pass an object as the second argument you can add/remove from multiple events at once. The object should contain key value pairs of events and listeners or listener arrays.
     * You can also pass it an event name and an array of listeners to be added/removed.
     *
     * @param {Boolean} remove True if you want to remove listeners, false if you want to add.
     * @param {String|Object} evt An event name if you will pass an array of listeners next. An object if you wish to add/remove from multiple events at once.
     * @param {Function[]} [listeners] An optional array of listener functions to add/remove.
     * @return {Object} Current instance of EventEmitter for chaining.
     * @doc
     */
    proto.manipulateListeners = function(remove, evt, listeners) {
        // Initialise any required variables
        var i
          , value
          , single = remove ? this.removeListener : this.addListener
          , multiple = remove ? this.removeListeners : this.addListeners;

        // If evt is an object then pass each of it's properties to this method
        if(typeof evt === 'object') {
            for(i in evt) {
                if(evt.hasOwnProperty(i) && (value = evt[i])) {
                    // Pass the single listener straight through to the singular method
                    if(typeof value === 'function') {
                        single.call(this, i, value);
                    }
                    else {
                        // Otherwise pass back to the multiple function
                        multiple.call(this, i, value);
                    }
                }
            }
        }
        else {
            // So evt must be a string
            // And listeners must be an array of listeners
            // Loop over it and pass each one to the multiple method
            i = listeners.length;
            while(i--) {
                single.call(this, evt, listeners[i]);
            }
        }

        // Return the instance of EventEmitter to allow chaining
        return this;
    };

    /**
     * Removes all listeners from a specified event.
     * If you do not specify an event then all listeners will be removed.
     * That means every event will be emptied.
     *
     * @param {String} [evt] Optional name of the event to remove all listeners for. Will remove from every event if not passed.
     * @return {Object} Current instance of EventEmitter for chaining.
     * @doc
     */
    proto.removeEvent = function(evt) {
        // Remove different things depending on the state of evt
        if(evt) {
            // Remove all listeners for the specified event
            delete this._getEvents()[evt];
        }
        else {
            // Remove all listeners in all events
            delete this._events;
        }

        // Return the instance of EventEmitter to allow chaining
        return this;
    };

    /**
     * Emits an event of your choice.
     * When emitted, every listener attached to that event will be executed.
     * If you pass the optional argument array then those arguments will be passed to every listener upon execution.
     * Because it uses `apply`, your array of arguments will be passed as if you wrote them out separately.
     * So they will not arrive within the array on the other side, they will be separate.
     *
     * @param {String} evt Name of the event to emit and execute listeners for.
     * @param {Array} [args] Optional array of arguments to be passed to each listener.
     * @return {Object} Current instance of EventEmitter for chaining.
     * @doc
     */
    proto.emitEvent = function(evt, args) {
        // Get the listeners for the event
        // Also initialise any other required variables
        var listeners = this.getListeners(evt)
          , i = listeners.length
          , response;

        // Loop over all listeners assigned to the event
        // Apply the arguments array to each listener function
        while(i--) {
            // If the listener returns true then it shall be removed from the event
            // The function is executed either with a basic call or an apply if there is an args array
            response = args ? listeners[i].apply(null, args) : listeners[i]();
            if(response === true) {
                this.removeListener(evt, listeners[i]);
            }
        }

        // Return the instance of EventEmitter to allow chaining
        return this;
    };

    /**
     * Alias of emitEvent
     * @doc
     */
    proto.trigger = proto.emitEvent;

    /**
     * Subtly different from emitEvent in that it will pass its arguments on to the listeners, as
     * opposed to taking a single array of arguments to pass on.
     *
     * @param {String} evt Name of the event to emit and execute listeners for.
     * @param {...*} Optional additional arguments to be passed to each listener.
     * @return {Object} Current instance of EventEmitter for chaining.
     * @doc
     */
    proto.emit = function(evt) {
        var args = Array.prototype.slice.call(arguments, 1);
        return this.emitEvent(evt, args);
    };

    // Expose the class either via AMD or the global object
    if(typeof define === 'function' && define.amd) {
        define(function() {
            return EventEmitter;
        });
    }
    else {
        exports.EventEmitter = EventEmitter;
    }
}(this));
;return module.exports;}({},{});
var __m2 = function(module,exports){module.exports=exports;
;module.exports = (function(){
var __m1 = function(module,exports){module.exports=exports;
// Adapted from http://gizma.com/easing/ (which was created by Robert Penner)

exports.linear = function(currentTime, startValue, changeInValue, totalTime) {
	return changeInValue * currentTime / totalTime + startValue; 
};


exports.quadraticIn = function(currentTime, startValue, changeInValue, totalTime) {
	return changeInValue * (currentTime /= totalTime) * currentTime + startValue;
};

exports.quadraticOut = function(currentTime, startValue, changeInValue, totalTime) {
	return -changeInValue * (currentTime /= totalTime) * (currentTime - 2) + startValue;
};

exports.quadraticInOut = function(currentTime, startValue, changeInValue, totalTime) {
	currentTime /= totalTime / 2;
	
	if(currentTime < 1) return changeInValue / 2 * currentTime * currentTime + startValue;
	
	return -changeInValue / 2 * (--currentTime * (currentTime - 2) - 1) + startValue;
};

exports.cubicIn = function(currentTime, startValue, changeInValue, totalTime) {
	return changeInValue * (currentTime /= totalTime) * currentTime * currentTime + startValue;
};

exports.cubicOut = function(currentTime, startValue, changeInValue, totalTime) {
	currentTime /= totalTime;

	return changeInValue * (--currentTime * currentTime * currentTime + 1) + startValue;
};

exports.cubicInOut = function(currentTime, startValue, changeInValue, totalTime) {
	currentTime /= totalTime / 2;
	
	if(currentTime < 1) return changeInValue * (currentTime /= totalTime) * currentTime * currentTime + startValue;

	return changeInValue / 2 * ((currentTime -= 2) * currentTime * currentTime + 2) + startValue;
};


var HALF_PI = Math.PI / 2;
exports.sinusoidalIn = function(currentTime, startValue, changeInValue, totalTime) {
	return -changeInValue * Math.cos(currentTime / totalTime * HALF_PI) + changeInValue + startValue;
};

exports.sinusoidalOut = function(currentTime, startValue, changeInValue, totalTime) {
	return changeInValue * Math.sin(currentTime / totalTime * HALF_PI) + startValue;
};

exports.sinusoidalInOut = function(currentTime, startValue, changeInValue, totalTime){
	return -changeInValue / 2 * (Math.cos(Math.PI * currentTime / totalTime) - 1) + startValue;
};


exports.exponentialIn = function(currentTime, startValue, changeInValue, totalTime){
	return changeInValue * Math.pow(2, 10 * (currentTime / totalTime - 1)) + startValue;
};

exports.exponentialOut = function(currentTime, startValue, changeInValue, totalTime){
	return changeInValue * (-Math.pow(2, -10 * currentTime / totalTime) + 1) + startValue;
};

exports.exponentialInOut = function(currentTime, startValue, changeInValue, totalTime){
	currentTime /= totalTime / 2;
	
	if(currentTime < 1) return changeInValue / 2 * Math.pow(2, 10 * (currentTime -1))  + startValue;

	return changeInValue / 2 * (-Math.pow(2, -10 * --t) + 2) + startValue;
};

;return module.exports;}({},{});
var __m0 = function(module,exports){module.exports=exports;
var requestAnimationFrame = window.requestAnimationFrame || 
								window.mozRequestAnimationFrame ||
                              	window.webkitRequestAnimationFrame || 
                              	window.msRequestAnimationFrame || 
                              	function(cb){return setTimeout(cb, 15);};

var cancelAnimationFrame = 	window.cancelAnimationFrame || 
								window.mozCancelAnimationFrame ||
                              	window.webkitCancelAnimationFrame || 
                              	window.msCancelAnimationFrame || 
                              	function(timeout){return clearTimeout(timeout);};

var tween = module.exports = function(easingFunc, obj, prop, targetValue, duration, callback){
	duration = duration || 0;
	
	var startValue = obj[prop],
		valueDiff = targetValue - startValue,
		startTime = Date.now(),
		pauseStart = startTime,
		paused = true,
		animationRequestId;

	function pause(){
		if(paused) return;
		paused = true;

		cancelAnimationFrame(animationRequestId);	
		pauseStart = Date.now();
	}

	function resume(){
		if(!paused) return;
		paused = false;

		startTime += Date.now() - pauseStart;
		
		animationRequestId = requestAnimationFrame(step);
	}

	function step(){
		var currentTime = Date.now() - startTime;

		if(currentTime < duration){
			obj[prop] = easingFunc(currentTime, startValue, valueDiff, duration);
			animationRequestId = requestAnimationFrame(step);
		} else {
			obj[prop] = easingFunc(duration, startValue, valueDiff, duration);
			callback && callback();
		}
	}

	resume();

	return {
		resume: resume,
		pause: pause
	};
};

// Bind easing helpers
var easing = __m1,
	easingFuncName;

for(easingFuncName in easing){
	if(easing.hasOwnProperty(easingFuncName)){
		tween[easingFuncName] = tween.bind(void 0, easing[easingFuncName]);
	}
}

tween.easing = easing;
;return module.exports;}({},{});return __m0;}());
;return module.exports;}({},{});
var __m1 = function(module,exports){module.exports=exports;
var noop = exports.noop = function(){};

exports.requestAnimationFrame = window.requestAnimationFrame || 
								window.mozRequestAnimationFrame ||
                              	window.webkitRequestAnimationFrame || 
                              	window.msRequestAnimationFrame || 
                              	function(cb){return setTimeout(cb, 15);};

exports.cancelAnimationFrame = 	window.cancelAnimationFrame || 
								window.mozCancelAnimationFrame ||
                              	window.webkitCancelAnimationFrame || 
                              	window.msCancelAnimationFrame || 
                              	function(timeout){return clearTimeout(timeout);};

exports.requestFullscreen = document.documentElement.requestFullscreen ||
							document.documentElement.mozRequestFullScreen ||
							document.documentElement.webkitRequestFullscreen ||
							noop;

var bodyStyle = document.body.style;
exports.transformAttribute = 	(bodyStyle.msTransform !== void 0) && "msTransform" ||
								(bodyStyle.webkitTransform !== void 0) && "webkitTransform" ||
								(bodyStyle.MozTransform !== void 0) && "MozTransform" ||
								"transform";
								
exports.transitionAttribute =	(bodyStyle.msTransition !== void 0) && "msTransition" ||
								(bodyStyle.webkitTransition !== void 0) && "webkitTransition" ||
								(bodyStyle.MozTransition !== void 0) && "MozTransition" || 
								"transition";

exports.filterAttribute = 		(bodyStyle.msFilter !== void 0) && "msFilter" ||
								(bodyStyle.webkitFilter !== void 0) && "webkitFilter" ||
								(bodyStyle.MozFilter !== void 0) && "MozFilter" ||
								"filter";

exports.cssFilterAttribute = 	(bodyStyle.msFilter !== void 0) && "-ms-filter" ||
								(bodyStyle.webkitFilter !== void 0) && "-webkit-filter" ||
								(bodyStyle.MozFilter !== void 0) && "-moz-filter" ||
								"filter";

exports.cssTransformAttribute = (bodyStyle.msTransform !== void 0) && "-ms-transform" ||
								(bodyStyle.webkitTransform !== void 0) && "-webkit-transform" ||
								(bodyStyle.MozTransform !== void 0) && "-moz-transform" ||
								"filter";
;return module.exports;}({},{});
var __m0 = function(module,exports){module.exports=exports;
__m3;
var Hammer = __m4;

var isTouchDevice = 'ontouchstart' in document.documentElement;

var utils = __m1,
	requestAnimationFrame = utils.requestAnimationFrame,
	cancelAnimationFrame = utils.cancelAnimationFrame,
	tween = __m2;

var Surface = module.exports = function(container){
	this.container = container;
	this.element = document.createElement("div");
	this.element.style.position = "absolute";
	container.appendChild(this.element);

	this.refit();
	this.emitter = new EventEmitter();

	this.horizontalPosition = 0;
	this.verticalPosition = 0;
	
	this.horizontalVelocity = 0;
	this.verticalVelocity = 0;

	this.cssTransitions = {};
	this.cssFilters = {};
	this.cssTransforms = {};

	this.pointerEventHandler = this.pointerEventHandler.bind(this);
	this.dragEventHandler = this.dragEventHandler.bind(this);
	this.transformStep = this.transformStep.bind(this);
};

Surface.create = function(container){
	var surface = new Surface(container);

	return Surface.getApi(surface);
};

Surface.getApi = function(surface){
	var api = {};

	api.on = surface.emitter.on.bind(surface.emitter);
	api.removeListener = surface.emitter.removeListener.bind(surface.emitter);

	api.refit = surface.refit.bind(surface);
	api.element = surface.element;
	api.container = surface.container;

	api.css = surface.setCssStyle.bind(surface);
	api.cssTransform = surface.setCssTransform.bind(surface);
	api.cssFilter = surface.setCssFilter.bind(surface);
	api.cssTransition = surface.setCssTransition.bind(surface);

	api.speed = surface.setVelocityScalar.bind(surface);
	api.horizontalSpeed = surface.setHorizontalVelocityScalar.bind(surface);
	api.verticalSpeed = surface.setVerticalVelocityScalar.bind(surface);

	api.horizontalWind = surface.setBaseHorizontalVelocity.bind(surface);
	api.verticalWind = surface.setBaseVerticalVelocity.bind(surface);
	
	Object.defineProperty(api, "speedGradient", {
		get: function(){
			return (surface.horizontalVelocityGradient === surface.verticalVelocityGradient)? 
						surface.horizontalVelocityGradient : 
						void 0;
		},
		set: function(value){
			surface.horizontalVelocityGradient = value;
			surface.verticalVelocityGradient = value;
		}
	});

	Object.defineProperty(api, "horizontalVelocityGradient", {
		get: function(){ return surface.horizontalVelocityGradient;},
		set: function(value){ surface.horizontalVelocityGradient = value;}
	});

	Object.defineProperty(api, "verticalVelocityGradient", {
		get: function(){ return surface.verticalVelocityGradient;},
		set: function(value){ surface.verticalVelocityGradient = value;}
	});

	Object.defineProperty(api, "width", {
		get: function(){return surface.width;}
	});

	Object.defineProperty(api, "height", {
		get: function(){return surface.height;}
	});

	Object.defineProperty(api, "top", {
		get: function(){return surface.top;}
	});

	Object.defineProperty(api, "left", {
		get: function(){return surface.left;}
	});

	return api;
};

Surface.prototype.horizontalVelocityScalar = 0;
Surface.prototype.verticalVelocityScalar = 0;

Surface.prototype.baseHorizontalVelocity = 0;
Surface.prototype.baseVerticalVelocity = 0;

Surface.prototype.msPerStep = 16; // Milliseconds per step

// These functions take current position relative to the center and return a number between -1 and 1
Surface.prototype.horizontalVelocityGradient = tween.easing.quadraticIn;
Surface.prototype.verticalVelocityGradient = tween.easing.quadraticIn;

Surface.prototype.pointerTrackingEvents = ['mousemove'];//, 'touchstart', 'touchend', 'touchmove'];

Surface.prototype.refit = function(){
	var rect = this.container.getBoundingClientRect();

	this.width = rect.width;
	this.halfWidth = this.width / 2;

	this.height = rect.height;
	this.halfHeight = this.height / 2;

	this.top = rect.top;
	this.left = rect.left;
};

Surface.prototype.startTransformLoop = function(){
	if(this.transforming) return;

	this.transforming = true;
	this.lastStepTime = Date.now();
	this.animationRequestId = requestAnimationFrame(this.transformStep);
	this.attachPointerListeners();
	this.emitter.emit("move start");
};

Surface.prototype.stopTransformLoop = function(){
	if(!this.transforming) return;

	this.transforming = false;
	cancelAnimationFrame(this.animationRequestId);
	this.emitter.emit("move stop");
};

Surface.prototype.transformStep = function(){
	var currentTime = Date.now(),
		lagScalar = (currentTime - this.lastStepTime) / this.msPerStep;
	
	this.lastHorizontalDisplacement = lagScalar * (this.baseHorizontalVelocity + (this.horizontalVelocity * this.horizontalVelocityScalar));
	this.lastVerticalDisplacement = lagScalar * (this.baseVerticalVelocity + (this.verticalVelocity * this.verticalVelocityScalar));
	this.lastStepTime = currentTime;

	if(this.lastHorizontalDisplacement || this.lastVerticalDisplacement){
		this.horizontalPosition += this.lastHorizontalDisplacement;
		this.verticalPosition += this.lastVerticalDisplacement;
		this.setCssTransform("translate", this.horizontalPosition + "px, " + this.verticalPosition + "px");
		this.animationRequestId = requestAnimationFrame(this.transformStep);
	} else if(this.trackingPointer || this.baseHorizontalVelocity || this.baseVerticalVelocity){
		this.animationRequestId = requestAnimationFrame(this.transformStep);
	}
};

Surface.prototype.setBaseHorizontalVelocity = function(target, duration, easingFunc){
	if(target === void 0) return this.baseHorizontalVelocity;

	this.horizontalWindTween && this.horizontalWindTween.pause();

	if(duration){
		duration *= 1000; // Tweening occurs in milliseconds
		easingFunc = easingFunc || (this.baseHorizontalVelocity < target)? tween.easing.quadraticIn : tween.easing.quadraticOut;
		this.horizontalWindTween = tween(easingFunc, this, "baseHorizontalVelocity", target, duration);
	} else {
		this.baseHorizontalVelocity = target;
	}
};

Surface.prototype.setBaseVerticalVelocity = function(target, duration, easingFunc){
	if(target === void 0) return this.baseVerticalVelocity;
	
	this.verticalWindTween && this.verticalWindTween.pause();

	if(duration){
		duration *= 1000; // Tweening occurs in milliseconds
		easingFunc = easingFunc || (this.baseVerticalVelocity < target)? tween.easing.quadraticIn : tween.easing.quadraticOut;
		this.verticalWindTween = tween(easingFunc, this, "baseVerticalVelocity", target, duration);
	} else {
		this.baseVerticalVelocity = target;
	}
};

Surface.prototype.setVelocityScalar = function(target, duration, easingFunc, callback){
	if(target === void 0){
		if(this.horizontalVelocityScalar === this.verticalVelocityScalar){
			return this.horizontalVelocityScalar;
		}

		return void 0;
	}
	
	this.setHorizontalVelocityScalar(target, duration, easingFunc, callback);
	this.setVerticalVelocityScalar(target, duration, easingFunc);
};

Surface.prototype.setHorizontalVelocityScalar = function(target, duration, easingFunc, callback){
	if(target === void 0) return this.horizontalVelocityScalar;

	this.horizontalSpeedTween && this.horizontalSpeedTween.pause();

	if(duration){
		duration *= 1000; // Tweening occurs in milliseconds
		easingFunc = easingFunc || (this.horizontalVelocityScalar < target)? tween.easing.quadraticIn : tween.easing.quadraticOut;
		this.horizontalSpeedTween = tween(easingFunc, this, "horizontalVelocityScalar", target, duration, callback);
	} else {
		this.horizontalVelocityScalar = target;
	}
};

Surface.prototype.setVerticalVelocityScalar = function(target, duration, easingFunc, callback){
	if(target === void 0) return this.verticalVelocityScalar;

	this.verticalSpeedTween && this.verticalSpeedTween.pause();

	if(duration){
		duration *= 1000; // Tweening occurs in milliseconds
		easingFunc = easingFunc || (this.verticalVelocityScalar < target)? tween.easing.quadraticIn : tween.easing.quadraticOut;
		this.verticalSpeedTween = tween(easingFunc, this, "verticalVelocityScalar", target, duration, callback);
	} else {
		this.verticalVelocityScalar = target;
	}
};

function preventDefault(e){
	e.preventDefault();
}

Surface.prototype.attachPointerListeners = function(){
	if(this.trackingPointer) return;
	this.trackingPointer = true;

	if(isTouchDevice){
		Hammer(this.container).on("drag", this.dragEventHandler);	
		this.container.addEventListener("touchmove", preventDefault);
	} else {
		this.container.addEventListener("mousemove", this.pointerEventHandler);
	}
	
	this.emitter.emit("pointer tracking start");
};

Surface.prototype.detachPointerListeners = function(){
	if(!this.trackingPointer) return;
	this.trackingPointer = false;
	
	if(isTouchDevice){
		Hammer(this.container).off("drag", this.dragEventHandler);	
		this.container.removeEventListener("touchmove", preventDefault);
	} else {
		this.container.removeEventListener("mousemove", this.pointerEventHandler);
	}
	

	this.emitter.emit("pointer tracking stop");
};

Surface.prototype.dragEventHandler = function(e){
	this.horizontalVelocity = e.gesture.velocityX;
	this.verticalVelocity = e.gesture.velocityY;
	
	if(this.horizontalVelocity < 0.1) this.horizontalVelocity = 0;
	if(this.verticalVelocity < 0.1) this.verticalVelocity = 0;

	if(this.horizontalVelocity > 1) this.horizontalVelocity = 1;
	if(this.verticalVelocity > 1) this.verticalVelocity = 1;

	if(e.gesture.deltaX < 0) this.horizontalVelocity *= -1;
	if(e.gesture.deltaY < 0) this.verticalVelocity *= -1;

};

// This updates the x and y speed multipliers based on the pointers relative position to the
// center of the container element
Surface.prototype.pointerEventHandler = function(e){
	// If touch event, find first touch
	var pointer = e.changedTouches && e.changedTouches[0] || e,
		x = pointer.clientX - this.left;
		y = pointer.clientY - this.top;

	this.horizontalVelocity = this.horizontalVelocityGradient(x - this.halfWidth, 0, (x > this.halfWidth? -1 : 1), this.halfWidth);
	this.verticalVelocity = this.verticalVelocityGradient(y - this.halfHeight, 0, (y > this.halfHeight? -1 : 1), this.halfHeight);
};

Surface.prototype.setCssStyle = function(name, value, duration){
	if(value === void 0) return this.element.style[name];

	if(duration !== void 0) this.setCssTransition(name, duration + "s");
	
	this.element.style[name] = value;
};

Surface.prototype.setCssTransform = function(name, value, duration){
	if(value === void 0) return this.cssTransforms[name];

	this.cssTransforms[name] = value;
	this.updateMultiAttributeStyle(utils.transformAttribute, this.cssTransforms);
};

Surface.prototype.setCssFilter = function(name, value, duration){
	if(value === void 0) return this.cssFilters[name];
	
	if(duration !== void 0) this.setCssTransition(utils.cssFilterAttribute, duration + "s");
	
	this.cssFilters[name] = value;
	this.updateMultiAttributeStyle(utils.filterAttribute, this.cssFilters);
};

Surface.prototype.setCssTransition = function(name, value){
	if(value === void 0) return this.cssTransitions[name];
	
	this.cssTransitions[name] = value;
	this.updateMultiAttributeStyle(utils.transitionAttribute, this.cssTransitions, true);
};

Surface.prototype.updateMultiAttributeStyle = function(styleName, attributes, withComma){
	var name,
		style = "",
		first = true;

	for(name in attributes){
		if(attributes.hasOwnProperty(name)){
			if(first) first = false;
			else style += withComma?", ": " ";

			if(withComma){
				style += name + " " + attributes[name];
			} else {
				style += name + "(" + attributes[name] + ")";
			}
		}
	}

	this.element.style[styleName] = style;
}

;return module.exports;}({},{});return __m0;}());
;return module.exports;}({},{});
var __m1 = function(module,exports){module.exports=exports;
;module.exports = (function(){
var __m1 = function(module,exports){module.exports=exports;
module.exports = Node;

function Node(left, top, width, height, parent){
	this.objects = [];

	this.left = left;
	this.top = top;
	this.width = width;
	this.height = height;
	this.right = this.left + this.width;
	this.bottom = this.top + this.height;
	this.isBase = (this.width / 2) < this.minimumSize;

	this.parent = parent;
}

Node.prototype.tl = void 0;
Node.prototype.tr = void 0;
Node.prototype.br = void 0;
Node.prototype.bl = void 0;

Node.prototype.objectLimit = 200;
Node.prototype.minimumSize = 3000;

Node.prototype.clear = function(){
	this.objects = [];

	if(this.tl){
		this.tl.clear();
		this.tr.clear();
		this.br.clear();
		this.bl.clear();
	}
};

Node.prototype.getObjects = function(){
	if(this.tl){
		return this.objects.concat(this.tl.getObjects(), this.tr.getObjects(), this.br.getObjects(), this.bl.getObjects());
	} else {
		return this.objects.slice();
	}
};

Node.prototype.split = function(){
	var childWidth = this.width / 2,
		childHeight = this.height / 2,
		left = this.left,
		top = this.top;

	this.tl = new Node(left, top, childWidth, childHeight, this);
	this.tr = new Node(left + childWidth, top, childWidth, childHeight, this);
	this.br = new Node(left + childWidth, top + childHeight, childWidth, childHeight, this);
	this.bl = new Node(left, top + childHeight, childWidth, childHeight, this);
};

// This can be called from ANY node in the tree, it'll return the top most node of the tree
// that can contain the element (it will grow the tree if nescessary)
Node.prototype.parentNode = function(obj){
	var node = this,
		parent;

	// If object is left of this node
	if(obj.left < node.left){
		// If object is to the top of this node
		if(obj.top < node.top){
			// Grow towards top left
			parent = node.grow(node.width, node.height);
		} else {
			// Grow towards bottom left
			parent = node.grow(node.width, 0);
		}
	// If object is right of this node
	} else if(obj.left + obj.width > node.left + node.width){
		// If object is to the top of this node
		if(obj.top < node.top){
			// Grow towards top right
			parent = node.grow(0, node.height);
		} else {
			// Grow towards bottom right
			parent = node.grow(0, 0);
		} 

	// If object is within x-axis but top of node
	} else if(obj.top < node.top){
		// Grow towards top right (top left is just as valid though)
		parent = node.grow(0, node.height);
	// If object is within x-axis but bottom of node
	} else if(obj.top + obj.height > node.top + node.height){
		// Grow towards bottom right (bottom left is just as valid though)
		parent = node.grow(0, 0);
	}
	
	// If we had to grow, find the quadrant in the parent
	if(parent){
		return parent.parentNode(obj);
	}

	return node;
};

// Helper function which gets the quadrant node at a given x/y position
// caller function has to check to see if this node is split before calling this
Node.prototype.getQuadrantAt = function(x, y){
	if(!this.tl) return this;

	var xMid = this.left + this.width / 2,
		yMid = this.top + this.height / 2;

	if(x < xMid){
		if(y < yMid){
			return this.tl.tl && this.tl.getQuadrantAt(x, y) || this.tl;
		} else {
			return this.bl.tl && this.bl.getQuadrantAt(x, y) || this.bl;
		}
	} else {
		if(y < yMid){
			return this.tr.tl && this.tr.getQuadrantAt(x, y) || this.tr;
		} else {
			return this.br.tl && this.br.getQuadrantAt(x, y) || this.br;
		}
	}
};

// Gets all the objects in quadrants within the given dimensions. 
// This assumes that the given dimensions can't be larger than a quadrant, 
// meaning it can at most touch 4 quadrants
Node.prototype.getInteractableObjects = function(left, top, width, height){
	if(!this.tl) return this.objects.slice();	

	var node = this.getQuadrant(left, top, width, height),
		objectsList = [node.objects],
		quadrants = [node], // Keeps track to prevent dupes
		parent = node.parent;

	while(parent){
		objectsList.push(parent.objects);
		quadrants.push(parent);
		parent = parent.parent;
	}

	if(node.tl){
		// top left corner
		var quadrant = node.getQuadrantAt(left, top);
		if(!~quadrants.indexOf(quadrant)){
			quadrants.push(quadrant);
			objectsList.push(quadrant.objects);

			if(quadrant.parent && !~quadrants.indexOf(quadrant.parent)){
				quadrants.push(quadrant.parent);
				objectsList.push(quadrant.parent.objects);	
			}
		}
		
		// top right corner
		quadrant = node.getQuadrantAt(left + width, top);
		if(!~quadrants.indexOf(quadrant)){
			quadrants.push(quadrant);
			objectsList.push(quadrant.objects);

			if(quadrant.parent && !~quadrants.indexOf(quadrant.parent)){
				quadrants.push(quadrant.parent);
				objectsList.push(quadrant.parent.objects);	
			}
		}

		// bottom right corner
		quadrant = node.getQuadrantAt(left + width, top + height);
		if(!~quadrants.indexOf(quadrant)){
			quadrants.push(quadrant);
			objectsList.push(quadrant.objects);

			if(quadrant.parent && !~quadrants.indexOf(quadrant.parent)){
				quadrants.push(quadrant.parent);
				objectsList.push(quadrant.parent.objects);	
			}
		}

		// bottom left corner
		quadrant = node.getQuadrantAt(left, top + height);
		if(!~quadrants.indexOf(quadrant)){
			quadrants.push(quadrant);
			objectsList.push(quadrant.objects);
			if(quadrant.parent && !~quadrants.indexOf(quadrant.parent)) objectsList.push(quadrant.parent.objects);
		}
	}

	return Array.prototype.concat.apply([], objectsList);
};

// Gets the quadrant a given bounding box dimensions would be inserted into
Node.prototype.getQuadrant = function(left, top, width, height){
	if(!this.tl) return this;

	var	xMid = this.left + this.width / 2,
		yMid = this.top + this.height / 2,
		topQuadrant = (top < yMid) && ((top + height) < yMid),
		bottomQuadrand = top > yMid;

	if((left < xMid) && ((left + width) < xMid)){
		if(topQuadrant){
			return this.tl.tl && this.tl.getQuadrant(left, top, width, height) || this.tl;
		} else if(bottomQuadrand){
			return this.bl.tl && this.bl.getQuadrant(left, top, width, height) || this.bl;
		}
	} else if(left > xMid){
		if(topQuadrant){
			return this.tr.tl && this.tr.getQuadrant(left, top, width, height) || this.tr;
		} else if(bottomQuadrand) {
			return this.br.tl && this.br.getQuadrant(left, top, width, height) || this.br;
		}
	}

	return this;
};

// Inserts the object to the Node, spliting or growing the tree if nescessary
// Returns the top-most node of this tree
Node.prototype.insert = function(obj){
	var quadrant,
		index,
		length,
		remainingObjects,
		objects,
		node;

	// This call will grow the tree if nescessary and return the parent node
	// if the tree doesn't need to grow, `node` will be `this`.
	node = this.parentNode(obj);
	quadrant = node.getQuadrant(obj.left, obj.top, obj.width, obj.height);

	if(quadrant !== node){
		quadrant.insert(obj);
	} else {
		objects = node.objects;
		objects.push(obj);

		index = 0;
		length = objects.length;
		if(!this.isBase && length > node.objectLimit){
			// Split if not already split
			if(!node.tl) node.split();

			// For objects that don't fit to quadrants
			remainingObjects = [];
		
			// Iterate through all object and try to put them in a
			// Quadrant node, if that doesn't work, retain them	
			for(; index < length; index++){

				// Reusing the obj var
				obj = node.objects[index];
				quadrant = node.getQuadrant(obj.left, obj.top, obj.width, obj.height);
				if(quadrant !== node){
					quadrant.insert(obj);
				} else {
					remainingObjects.push(obj);
				}
			}

			node.objects = remainingObjects;
		}
	}

	return node;
};

// Creates a pre-split parent Node and attaches this Node as a
// node at the given x/y offset (so 0,0 would make this Node the top left node)
Node.prototype.grow = function(xOffset, yOffset){
	var left = this.left - xOffset,
		top = this.top - yOffset,
		parent = new Node(left, top, this.width * 2, this.height * 2);
	
	this.parent = parent;

	if(xOffset){
		if(yOffset){
			parent.br = this;
		} else {
			parent.tr = this;
		}
	} else if(yOffset) {
		parent.bl = this;
	} else {
		parent.tl = this;
	}

	parent.tl = parent.tl || new Node(left, top, this.width, this.height, this);
	parent.tr = parent.tr || new Node(left + this.width, top, this.width, this.height, this);
	parent.br = parent.br || new Node(left + this.width, top + this.height, this.width, this.height, this);
	parent.bl = parent.bl || new Node(left, top + this.height, this.width, this.height, this);

	return parent;
};


;return module.exports;}({},{});
var __m0 = function(module,exports){module.exports=exports;
var Node = __m1;

/* Quadtree by Ozan Turgut (ozanturgut@gmail.com)

   A Quadtree is a structure for managing many nodes interacting in space by
   organizing them within a tree, where each node contains elements which may
   interact with other elements within the node. This is particularly useful in
   collision detection, in which a brute-force algorithm requires the checking of
   every element against every other element, regardless of their distance in space.

   This quadtree handles object in 2d space by their bounding boxes. It splits
   a node once it exceeds the object limit per-node. When a node is split, it's
   contents are divied up in to 4 smaller nodes to fulfill the per-node object limit.
   Nodes are infinitely divisible.

   If an object is inserted which exceeds the bounds of this quadtree, the quadtree
   will grow in the direction the object was inserted in order to encapsulate it. This is
   similar to a node split, except in this case we create a parent node and assign the existing
   quadtree as a quadrant within it. This allows the quadtree to contain any object, regardless of
   its position in space.

   One function is exported which creates a quadtree given a width and height.

   The quadtree api has two methods:

   insert(bounds)
   		Inserts a bounding box (it should contain an left, top, width, and height property).

   	retrieve(bounds)
   		Retrieves a list of bounding boxes that share a node with the given bounds object.
*/

var Quadtree = module.exports = function(width, height){
	if(width){
		this.width = width;
		this.height = height? height : width;
	}
	window.q = this;
	
	this.reset();
};

Quadtree.create = function(width, height){
	var quadtree = new Quadtree(width, height);
	return Quadtree.getApi(quadtree);
};

Quadtree.getApi = function(quadtree){
	var api = {};
	api.insert = quadtree.insert.bind(quadtree);
	api.reset = quadtree.reset.bind(quadtree);
	api.getObjects = quadtree.getObjects.bind(quadtree);
	api.prune = quadtree.prune.bind(quadtree);

	return api;
};

Quadtree.prototype.width = 10000;
Quadtree.prototype.height = 10000;

Quadtree.prototype.reset = function(x, y){
	x = x || 0;
	y = y || 0;

	var negHalfWidth = -(this.width / 2);
	var negHalfHeight = -(this.height / 2);
	this.top = new Node(x, y, this.width, this.height);
//	this.top = new Node(x + negHalfWidth, y + negHalfHeight, this.width, this.height);
};

Quadtree.prototype.insert = function(obj){
	this.top = this.top.insert(obj);
};

function isInNode(node, left, top, right, bottom){
	return node.left <= left && node.top <= top && node.right >= right && node.bottom >= bottom;
};

function getContainingNodeHelper(left, top, right, bottom, node){
	if(!node.tl) return node;

	if(left < node.tr.left){
		if(right < node.tr.left){
			if(bottom < node.bl.top){
				return getContainingNodeHelper(left, top, right, bottom, node.tl);
			} else if(top > node.bl.top) {
				return getContainingNodeHelper(left, top, right, bottom, node.bl);
			}
		}
	} else {
		if(bottom < node.br.top){
			return getContainingNodeHelper(left, top, right, bottom, node.tr);
		} else if(top > node.br.top) {
			return getContainingNodeHelper(left, top, right, bottom, node.br);
		}
	}

	return node;
}

Quadtree.prototype.getContainingNode = function(left, top, right, bottom, node){
	if(left < this.top.left || 
		top < this.top.top || 
		right > this.top.right || 
		bottom > this.top.bottom){
		return;	
	}

	return getContainingNodeHelper(left, top, right, bottom, this.top);
/*
	node = node || this.top;
	if(!node.tl) return node;

	// If area fits in any node, recurse down the tree
	if(isInNode(node.tl, left, top, right, bottom)){
		return this.getContainingNode(left, top, right, bottom, node.tl);
	} else if(isInNode(node.tr, left, top, right, bottom)){
		return this.getContainingNode(left, top, right, bottom, node.tr);
	} else if(isInNode(node.bl, left, top, right, bottom)){
		return this.getContainingNode(left, top, right, bottom, node.bl);
	} else if(isInNode(node.br, left, top, right, bottom)){
		return this.getContainingNode(left, top, right, bottom, node.br);
	} else if(isInNode(node, left, top, right, bottom)){
		return node;
	}*/
};

Quadtree.prototype.minimumSize = 3000;
Quadtree.prototype.getInteractableObjects = function(left, top, right, bottom){
	var self = this,
		minimumSize = this.minimumSize,
		tl = this.getContainingNode(left, top, left + 1, top + 1),
		tr,
		bl,
		br,
		objectsList = tl ? [tl.getObjects()] : [],
		ancestor;

	function addAncestorElements(left, top, right, bottom){
		var ancestor = self.getContainingNode(left, top, right, bottom);
		if(ancestor && !~objectsList.indexOf(ancestor.objects)) objectsList.push(ancestor.objects);
	}

	if(!tl || tl.right < right){
		tr = this.getContainingNode(right - 1, top, right, top + 1);
		if(tr) objectsList.push(tr.getObjects());
		else tr = tl;
	} else {
		tr = tl;
	}

	if(!tl || tl.bottom < bottom){
		bl = this.getContainingNode(left, bottom - 1, left + 1, bottom);
		if(bl) objectsList.push(bl.getObjects());
		else bl = tl;
	} else {
		bl = tl;
	}

	if(!tr || tr.bottom < bottom){
		if(!bl || bl.right < right){
			br = this.getContainingNode(right - 1, bottom - 1, right, bottom);
			if(br) objectsList.push(br.getObjects());
			else br = bl;
		} else {
			br = bl;
		}
	} else {
		br = tr;
	}
	
	if(tl !== tr) addAncestorElements(left, top, right, top + 1);
	if(tr !== br) addAncestorElements(right - 1, top, right, bottom);
	if(br !== bl) addAncestorElements(left, bottom - 1, right, bottom);
	if(bl !== tl) addAncestorElements(left, top, left + 1, bottom);
		
	// Intersections towards top left
	if(tl){
		if((left - minimumSize) < tl.left){
			addAncestorElements(left - minimumSize, top, left + 1, top + 1);
		}

		if((top - minimumSize) < tl.top){
			addAncestorElements(left, top - minimumSize, left + 1, top + 1);
		}
	}
	
	// Intersections towards top right
	if(tr){
		if(tr !== tl && (top - minimumSize) < tr.top){
			addAncestorElements(right - 1, top - minimumSize, right, top + 1);
		}

		if((right + minimumSize) > tr.right){
			addAncestorElements(right - 1, top, right + minimumSize, top + 1);
		}
	}

	// Intersections towards bottom right
	if(br){
		if(br !== tr && (right + minimumSize) > br.right){
			addAncestorElements(right - 1, bottom - 1, right + minimumSize, bottom);
		}

		if((bottom + minimumSize) > br.bottom){
			addAncestorElements(right - 1, bottom - 1, right, bottom + minimumSize);
		}
	}

	// Intersections towards bottom left
	if(bl){
		if(bl !== br && (bottom + minimumSize) > bl.bottom){
			addAncestorElements(left, bottom - 1, left + 1, bottom + minimumSize);
		}

		if(bl !== tl && (left - minimumSize) < bl.left){
			addAncestorElements(left - minimumSize, bottom - 1, left + 1, bottom);
		}
	}

	return Array.prototype.concat.apply([], objectsList);
};

Quadtree.prototype.getObjects = function(left, top, width, height){
	if(left !== void 0){
		var bottom = top + height,
			right = left + width,
			rectangles = this.getInteractableObjects(left, top, right, bottom),
			rectangleIndex = rectangles.length,
			result = [],
			rectangle;

		while(rectangleIndex--){
			rectangle = rectangles[rectangleIndex];
			
			// If there is intersection along the y-axis
			if(	(top <= rectangle.top ?
					(bottom >= rectangle.top) :
					(rectangle.bottom >= top)) && 
				// And if there is intersection along the x-axis
				(left <= rectangle.left ? 
					(right >= rectangle.left) :
					(rectangle.right >= left))){

				
				result.push(rectangle);
			}
		}
		
		return result;
	}

	return this.top.getObjects();
};

Quadtree.prototype.prune = function(left, top, width, height){
	var right = left + width,
		bottom = top + height,
		candidate,
		rejectedObjects = [];
		keptObjects = [];

	var objects = this.top.getObjects(),
		index = 0,
		length = objects.length;

	for(; index < length; index++){
		candidate = objects[index];

		if(	candidate.left < left || 
			candidate.top < top || 
			(candidate.left + candidate.width) > right ||
			(candidate.top + candidate.height) > bottom){
			rejectedObjects.push(candidate);
		} else {
			keptObjects.push(candidate);
		}
	}
	if(keptObjects.length){
		this.reset(keptObjects[0].left, keptObjects[0].top);
		index = 0;
		length = keptObjects.length;
		for(; index < length; index++){
			this.insert(keptObjects[index]);
		}
	} else {
		this.reset();
	}
	
	return rejectedObjects;
};

;return module.exports;}({},{});return __m0;}());
;return module.exports;}({},{});
var __m0 = function(module,exports){module.exports=exports;
var Q = __m8;
var createQuadtree = __m1.create,
	Surface = __m2;
	//Surface = __m9;

var utils = __m3;
var BoundingBox = __m4,
	Tag = __m5;

var Collage = module.exports = function(container){
	Surface.call(this, container);
	this.quadtree = createQuadtree(15000);

	this.tags = {};
	this.activeTags = [];

	this.updateCanvasDimensions();

	var self = this;
	window.c = this;
}
Collage.prototype = Object.create(Surface.prototype);

Collage.create = function(container){
	var collage = new Collage(container);
	return Collage.getApi(collage);
};

Collage.getApi = function(collage){
	var api = Surface.getApi(collage);

	api.createTag = collage.createTag.bind(collage);
	api.configureTag = collage.configureTag.bind(collage);
	
	api.setActiveTags = collage.setActiveTags.bind(collage);
	
	api.pause = collage.pause.bind(collage);
	api.resume = collage.resume.bind(collage);

	api.load = collage.loadElements.bind(collage);
	api.add = collage.addElements.bind(collage);
	api.remove = collage.removeElement.bind(collage);
	api.get = collage.getElements.bind(collage);
	api.showElement = collage.showElement.bind(collage);
	api.loader = collage.loader;

	api.fill = function(){
		collage.updateCanvasDimensions();
		collage.pickNextElement();

		if(collage.nextElement){
			return collage.fillCenter();	
		}

		return [];
	};

	api.start = collage.start.bind(collage);
	
	return api;
};

Collage.loader = __m6;
Collage.element = __m7;

// How many random spot will be checked to place elements per frame
Collage.prototype.scanTryLimit = 20;

// Max number of frames an element has to find a place before another is picked
// this prevents large gaps due to large elements
Collage.prototype.missLimit = 4;

// Minimum pixel spacing between elements
Collage.prototype.elementMargin = 25;

// How much beyond the window to scan for places to put objects when filling
Collage.prototype.overScan = 0;

Collage.prototype.hidingArea =  document.createDocumentFragment();
Collage.prototype.minElementSize = 50;

Collage.prototype.createTag = function(name, options){
	return this.tags[name] = Tag.create(options);
};

Collage.prototype.configureTag = function(name, options){
	var tag = this.tags[name];
	if(!tag){
		this.createTag(options);
		return;
	}

	if("skipProbability" in options) tag.skipProbability = options.skipProbability;
	if("tryLimit" in options) tag.tryLimit = options.tryLimit;
};

Collage.prototype.loadElements = function(tagNames, arg2, arg3){
	var addElements = this.addElements.bind(this, tagNames),
		loaderMap,
		loaderName,
		loader,
		loaderConfig,
		loaderConfigs,
		loaderConfigIndex,
		promise,
		promises = [];

	if(typeof arg2 === "string"){
		// Handle the .load([tag name], [loader name], [loader config]) case
		loaderMap = {};
		loaderMap[arg2] = arg3;	
	} else {
		// Handle the .load([tag name], [loader map]) case
		loaderMap = arg2;
	} 

	for(loaderName in loaderMap){
		if(loaderMap.hasOwnProperty(loaderName)){
			loader = Collage.loader[loaderName];
			loaderConfigs = loaderMap[loaderName];
			if(!Array.isArray(loaderConfigs)) loaderConfigs = [loaderConfigs];		
			loaderConfigIndex = loaderConfigs.length;

			while(loaderConfig = loaderConfigs[--loaderConfigIndex]){
				promise = loader(this, loaderConfig).then(addElements);
				promises.push(promise);	
			}
		}
	}

	return Q.allResolved(promises);
};

Collage.prototype.addElements = function(tagNames, elements){
	if(!Array.isArray(tagNames)) tagNames = [tagNames];
	if(!Array.isArray(elements)) elements = [elements];
	
	var tagNameIndex = tagNames.length,
		tagName,
		tag,
		elementIndex;

	// For each tag...
	while(tagName = tagNames[--tagNameIndex]){
		tag = this.tags[tagName] || this.createTag(tagName);
		elementIndex = elements.length;
		while(elementIndex--) tag.add(elements[elementIndex]);
	}
};

Collage.prototype.fadeInToCenter = function(){};

Collage.prototype.removeElement = function(tagNames, element){
	if(!Array.isArray(tagNames)) tagNames = [tagNames];
	
	var tagNameIndex = tagNames.length,
		tagName,
		tag;

	while(tagName = tagNames[tagNameIndex--]){
		tag = this.tags[tagName];
		if(!tag) continue;
		tag.remove(element);
	}
};

Collage.prototype.getElements = function(){
	var tagNames = (arguments.length > 0)? arguments : Object.keys(this.tags),
		tagNameIndex = tagNames.length,
		tagName,
		tag,
		chanceMultiplier,
		elements = [];

	while(tagName = tagNames[--tagNameIndex]){
		if(tag = this.tags[tagName]){
			elements = elements.concat(tag.getElements());
		}
	}

	return elements;
};

Collage.prototype.setActiveTags = function(){
	var index = arguments.length,
		tagName,
		tag,
		chanceMultiplier,
		activeTags = [];

	while(tagName = arguments[--index]){
		if(tag = this.tags[tagName]){
			chanceMultiplier = tag.chanceMultiplier;
			while(chanceMultiplier--) activeTags.push(tag);
		}
	}

	this.activeTags = activeTags;
};

Collage.prototype.getRandomActiveTag = function(){
	var tag,
		failSafe = this.getRandomActiveTagFailSafe;

	while(failSafe--){
		tag = this.activeTags[(Math.random() * this.activeTags.length)|0]
		if(tag.skipProbability < Math.random()) break;
	}
	
	return tag;
};

Collage.prototype.pause = function(duration){
	if(this.savedHorizontalVelocityScalar !== void 0) return;
	this.savedHorizontalVelocityScalar = this.horizontalVelocityScalar;
	this.savedVerticalVelocityScalar = this.verticalVelocityScalar;
	this.setVelocityScalar(0, duration || 0.4);
};

Collage.prototype.resume = function(duration){
	if(this.savedHorizontalVelocityScalar === void 0) return;

	this.setHorizontalVelocityScalar(this.savedHorizontalVelocityScalar, (duration || 0.4));
	this.setVerticalVelocityScalar(this.savedVerticalVelocityScalar, (duration || 0.4));
	this.savedHorizontalVelocityScalar = void 0;
};

Collage.prototype.savedHorizontalVelocityScalar = void 0;
Collage.prototype.savedVerticalVelocityScalar = void 0;

Collage.prototype.getRandomActiveTagFailSafe = 20;
Collage.prototype.getRandomElementFailSafe = 20;
Collage.prototype.getRandomElementTryLimit = 20;
Collage.prototype.maxElementWidth = 2000;
Collage.prototype.maxElementHeight = 1000;

Collage.prototype.getRandomElement = function(){
	var failSafe = this.getRandomElementFailSafe,
		inCanvasRange = true,
		left = this.viewportLeft - this.maxElementWidth,
		top = this.viewportTop - this.maxElementHeight,
		right = this.viewportRight + this.maxElementWidth,
		bottom = this.viewportBottom + this.maxElementHeight,
		element,
		tag,
		tryLimit;

	while(inCanvasRange && failSafe--){
		tag = this.getRandomActiveTag();
		tryLimit = tag.tryLimit || this.getRandomElementTryLimit;

		while(tryLimit--){
			element = tag.getRandomElement();

			if(!element.isIn(left, top, right, bottom)){
				return element;
			}
		}
	}
};

Collage.prototype.transformStep = function(){
	Surface.prototype.transformStep.call(this);
	this.updateCanvasDimensions();
	this.updateElementVisibility();
	this.maxCheckHeight = 0;
	this.maxCheckWidth = 0;

	this.pickNextElement();
	if(this.nextElement) this.fill();
};

Collage.prototype.start = function(){
	if(arguments.length > 0) this.setActiveTags.apply(this, arguments);
	
	if(this.activeTags.length === 0){
		throw new Error("Unable to start without active tags");
	};
	this.startTransformLoop();
	this.updateCanvasDimensions();
	this.pickNextElement();

	if(this.nextElement){
		this.fillCenter();	
	}
};

Collage.prototype.pickNextElement = function(){
	this.nextElement = this.getRandomElement();
	this.missCount = 0;

	if(this.nextElement){
		this.updateBounds();
	}
};

Collage.prototype.insertNextElement = function(left, top, show){
	var box = this.showElement(this.nextElement, left, top, show);
	this.pickNextElement();
	return box;
};

Collage.prototype.showElement = function(element, left, top, show){
	var boundingBox = new BoundingBox(element, left, top);
	this.quadtree.insert(boundingBox);
	
	if(show){
		boundingBox.show(this.element);
	} else {
		boundingBox.hide(this.hidingArea);
	}

	return boundingBox;
};

Collage.prototype.getViewportBoundingBoxes = function(){
	return this.quadtree.getObjects(this.viewportLeft, this.viewportTop, this.viewportWidth, this.viewportHeight);
};


Collage.prototype.getViewportElements = function(){
	var boundingBoxes = this.getViewportBoundingBoxes(),
		index = boundingBoxes.length,
		result = [];

	// boundingBoxes.map would be proper but is less proc efficient
	while(index--) result.push(boundingBoxes[index].element);

	return result;
};

Collage.prototype.updateElementVisibility = function(){
	var oldBoxes = this.visibleBoxes || [],
		newBoxes = this.quadtree.getObjects(this.viewportLeft, this.viewportTop, this.viewportWidth, this.viewportHeight),
		index,
		box;

	// Mark old visible to hide
	index = oldBoxes.length;
	while(index--) oldBoxes[index].hidePending = true;

	index = newBoxes.length;
	while(index--){
		box = newBoxes[index];
		if(!box.visible) box.show(this.element);

		// Clear hide flags for things that are still visible
		box.hidePending = false;
	}

	// Hide elements no longer in view
	index = oldBoxes.length;
	while(index--){
		box = oldBoxes[index];
		if(box.hidePending) box.hide(this.hidingArea);
	}

	this.visibleBoxes = newBoxes;
};

Collage.prototype.updateCanvasDimensions = function(){
	this.viewportLeft = -1 * this.horizontalPosition - this.overScan,
	this.viewportTop = -1 * this.verticalPosition - this.overScan,
	this.viewportWidth = this.width + this.overScan * 2,
	this.viewportHeight = this.height + this.overScan * 2;
	this.viewportRight = this.viewportLeft + this.viewportWidth;
	this.viewportBottom = this.viewportTop + this.viewportHeight;
	
	this.movingUp = this.lastVerticalDisplacement > 0;
	this.movingLeft = this.lastHorizontalDisplacement > 0;
};

Collage.prototype.fillCenter = function(){
	var boxes = this.quadtree.getObjects(
		this.viewportLeft - this.checkWidth,
		this.viewportTop - this.checkHeight,
		this.viewportWidth + this.checkWidth * 2,
		this.viewportHeight + this.checkHeight * 2
	);

	var	boundingBoxes = [],
		scanCheckLeft,
		scanCheckTop,
		scanCheckRight,
		scanCheckBottom,

		tryCount = 0,
		tryLimit = this.scanTryLimit * 10,
		missCount = 0,
		missLimit = tryLimit / 20;

	for(;tryCount < tryLimit; tryCount++){
		missCount++;

		if(missCount > missLimit){
			missCount = 0;
			this.pickNextElement();
			if(!this.nextElement) break;
		}

		scanCheckLeft = (this.viewportLeft - this.checkWidth) + Math.floor((this.viewportWidth + this.checkWidth) * Math.random()),
		scanCheckTop = (this.viewportTop - this.checkHeight) + Math.floor((this.viewportHeight + this.checkHeight) * Math.random()),
		scanCheckRight = scanCheckLeft + this.checkWidth,
		scanCheckBottom = scanCheckTop + this.checkHeight;
	
		if(!hasCollision(boxes, scanCheckLeft, scanCheckTop, scanCheckRight, scanCheckBottom)){
			boundingBoxes.push(this.insertNextElement(scanCheckLeft + this.elementMargin, scanCheckTop + this.elementMargin));
			if(!this.nextElement) break;

			missCount = 0;
			boxes = this.quadtree.getObjects(
				this.viewportLeft - this.checkWidth,
				this.viewportTop - this.checkHeight,
				this.viewportWidth + this.checkWidth * 2,
				this.viewportHeight + this.checkHeight * 2
			);
		}
	}

	this.updateElementVisibility();
	return boundingBoxes;
};

Collage.prototype.updateBounds = function(){
	this.checkHeight = this.nextElement.height + this.elementMargin * 2,
	this.checkWidth = this.nextElement.width + this.elementMargin * 2;

	this.checkLeft = this.movingLeft ? (this.viewportLeft - this.checkWidth) : this.viewportRight;
	this.checkTop = this.movingUp ? this.viewportTop - this.checkHeight : this.viewportBottom;
	this.checkRight = this.checkLeft + this.checkWidth;
	this.checkBottom = this.checkTop + this.checkHeight;
		
	this.scanLeft = this.viewportLeft - this.checkWidth;
	this.scanTop = this.viewportTop - this.checkHeight;
	this.scanWidth = this.viewportWidth + this.checkWidth;
	this.scanHeight = this.viewportHeight + this.checkHeight;

	this.horizontalBoxes = this.quadtree.getObjects(
		(this.movingLeft ?  this.viewportLeft - this.checkWidth : this.viewportRight),
		this.scanTop,
		this.checkWidth,
		this.scanHeight + this.checkHeight
	);

	this.verticalBoxes = this.quadtree.getObjects(
		this.scanLeft,
		(this.movingUp ? (this.viewportTop - this.checkHeight) : this.viewportBottom),
		this.scanWidth + this.checkWidth,
		this.checkHeight
	);
};

function hasCollision(boxList, left, top, right, bottom){
	var index = boxList.length,
		box;

	while(index--){
		box = boxList[index];

		// If there is a y-axis intersection
		if ((top <= box.top ?
						(bottom >= box.top) :
						(box.bottom >= top)) && 
							// And if there is intersection along the x-axis
							(left <= box.left ?
								(right >= box.left) :
								(box.right >= left))){
			return true;
		}
	}

	return false;
};

Collage.prototype.fill = function(){
	var tryCount = 0,
		tryLimit = this.scanTryLimit,
		scanCheckLeft,
		scanCheckTop,
		scanCheckRight,
		scanCheckBottom;

	this.missCount++;
	if(this.missCount > this.missLimit){
		this.pickNextElement();
		if(!this.nextElement) return;
	}

	for(;tryCount < tryLimit; tryCount++){
		// VERTICAL
		scanCheckLeft = this.scanLeft + Math.floor(this.scanWidth * Math.random());
		scanCheckRight = scanCheckLeft + this.checkWidth;
		
		if(!hasCollision(this.verticalBoxes, scanCheckLeft, this.checkTop, scanCheckRight, this.checkBottom)){
			this.insertNextElement(scanCheckLeft + this.elementMargin, this.checkTop + this.elementMargin);
			if(!this.nextElement) break;
		}

		// HORIZONTAL
		scanCheckTop = this.scanTop + Math.floor(this.scanHeight * Math.random());
		scanCheckBottom = scanCheckTop + this.checkHeight;

		if(!hasCollision(this.horizontalBoxes, this.checkLeft, scanCheckTop, this.checkRight, scanCheckBottom)){
			box = this.insertNextElement(this.checkLeft + this.elementMargin, scanCheckTop + this.elementMargin);
			this.horizontalBoxes.push(box);

			if(!this.nextElement) break;
		}
	}
};

;return module.exports;}({},{});return __m0;}());