/**
 * Boot polyfills for Samsung Tizen 5.5 (Chromium 69) and similar TV
 * browsers. The tag is rendered at the very start of <body>, before any
 * module/deferred script can evaluate TanStack or Supabase.
 *
 * Keep the payload dependency-free and ES5-compatible. In particular, do
 * not use globalThis, optional chaining, Promise helpers, or modern syntax in
 * this string: this is the code that makes those APIs safe to use.
 */
export const TV_BOOT_MARKER = "data-tv-boot";

export const TV_BOOT_SCRIPT = String.raw`
(function () {
  var g = (function () {
    if (typeof globalThis !== "undefined") return globalThis;
    if (typeof window !== "undefined") return window;
    if (typeof self !== "undefined") return self;
    if (typeof global !== "undefined") return global;
    try { return Function("return this")(); } catch (e) { return {}; }
  })();
  var O = g.Object || Object;
  var doc = g.document;

  function defineValue(target, name, value) {
    try {
      O.defineProperty(target, name, {
        value: value,
        writable: true,
        configurable: true,
        enumerable: false
      });
    } catch (e) {
      try { target[name] = value; } catch (ignored) {}
    }
  }

  function defineProto(proto, name, value) {
    if (!proto) return;
    try {
      if (typeof proto[name] !== "function") defineValue(proto, name, value);
    } catch (ignored) {}
  }

  /* ── Early TV detection — runs before any module code ─────────────── */
  var userAgentEarly = "";
  try { userAgentEarly = String((g.navigator && g.navigator.userAgent) || ""); } catch (ignored) {}
  var isTvEarly = /SMART-TV|SMARTTV|Tizen|Web0S|webOS|NetCast|BRAVIA|Viera|HbbTV|GoogleTV|Android TV|TV Safari/i.test(userAgentEarly);

  /* Add tv-layout class immediately so CSS applies even before React hydrates. */
  if (isTvEarly) {
    try {
      var htmlEl = doc && doc.documentElement;
      if (htmlEl && htmlEl.classList) htmlEl.classList.add("tv-layout");
    } catch (ignored) {}
    /* Pin viewport to 1280px on TVs that report a small width (some Tizen sets report 960x540). */
    try {
      if (doc) {
        var viewportMeta = doc.querySelector('meta[name="viewport"]');
        if (viewportMeta) {
          var currentContent = viewportMeta.getAttribute("content") || "";
          if (currentContent.indexOf("width=1280") === -1) {
            viewportMeta.setAttribute("content", "width=1280, initial-scale=1");
          }
        } else {
          /* If no viewport meta yet, create one — SSR should have it but be safe. */
          var meta = doc.createElement("meta");
          meta.name = "viewport";
          meta.content = "width=1280, initial-scale=1";
          if (doc.head) doc.head.appendChild(meta);
        }
      }
    } catch (ignored) {}
  }

  /* globalThis — Chromium 69 predates this global. */
  if (typeof g.globalThis === "undefined") defineValue(g, "globalThis", g);

  /* Object.hasOwn — used by recent TanStack packages; added in Chromium 93. */
  if (typeof O.hasOwn !== "function") {
    defineValue(O, "hasOwn", function (object, property) {
      if (object === null || object === undefined) {
        throw new TypeError("Object.hasOwn called on null or undefined");
      }
      return O.prototype.hasOwnProperty.call(O(object), property);
    });
  }

  /* Object.assign — Chrome 45+, but ensure for very old TV (Chrome 38-44) */
  if (typeof O.assign !== "function") {
    defineValue(O, "assign", function (target) {
      if (target === null || target === undefined) throw new TypeError("Cannot convert undefined or null to object");
      var to = O(target);
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i];
        if (source === null || source === undefined) continue;
        for (var key in source) {
          if (O.prototype.hasOwnProperty.call(source, key)) to[key] = source[key];
        }
      }
      return to;
    });
  }

  /* Object.entries — Chromium 54+, missing on Tizen 3 (Chrome 49) */
  if (typeof O.entries !== "function") {
    defineValue(O, "entries", function (obj) {
      var ownProps = O.keys(obj);
      var i = ownProps.length;
      var resArray = new Array(i);
      while (i--) resArray[i] = [ownProps[i], obj[ownProps[i]]];
      return resArray;
    });
  }

  /* Object.values — Chromium 54+ */
  if (typeof O.values !== "function") {
    defineValue(O, "values", function (obj) {
      var ownProps = O.keys(obj);
      var i = ownProps.length;
      var resArray = new Array(i);
      while (i--) resArray[i] = obj[ownProps[i]];
      return resArray;
    });
  }

  /* Object.is — Chromium 19+, but safe */
  if (typeof O.is !== "function") {
    defineValue(O, "is", function (x, y) {
      if (x === y) return x !== 0 || 1 / x === 1 / y;
      return x !== x && y !== y;
    });
  }

  function toList(value) {
    var list = [];
    var i;
    var iterator;
    var step;
    if (value === null || value === undefined) return list;
    if (typeof value.length === "number") {
      for (i = 0; i < value.length; i++) list.push(value[i]);
      return list;
    }
    try {
      if (g.Symbol && g.Symbol.iterator && value[g.Symbol.iterator]) {
        iterator = value[g.Symbol.iterator]();
        while (!(step = iterator.next()).done) list.push(step.value);
      }
    } catch (ignored) {}
    return list;
  }

  /* Object.fromEntries — Chromium 73+. */
  if (typeof O.fromEntries !== "function") {
    defineValue(O, "fromEntries", function (entries) {
      var result = {};
      var list = toList(entries);
      var i;
      var entry;
      for (i = 0; i < list.length; i++) {
        entry = list[i];
        if (entry !== null && entry !== undefined) {
          result[entry[0]] = entry[1];
        }
      }
      return result;
    });
  }

  /* Object.groupBy — Chromium 117+. Used by newer libraries. */
  if (typeof O.groupBy !== "function") {
    defineValue(O, "groupBy", function (items, callback) {
      var result = {};
      var list = toList(items);
      var i;
      var key;
      for (i = 0; i < list.length; i++) {
        key = callback(list[i], i);
        if (!result[key]) result[key] = [];
        result[key].push(list[i]);
      }
      return result;
    });
  }

  /* Map.groupBy — Chromium 117+. */
  if (typeof g.Map === "function" && typeof g.Map.groupBy !== "function") {
    defineValue(g.Map, "groupBy", function (items, callback) {
      var result = new g.Map();
      var list = toList(items);
      var i;
      var key;
      var group;
      for (i = 0; i < list.length; i++) {
        key = callback(list[i], i);
        group = result.get(key);
        if (!group) {
          group = [];
          result.set(key, group);
        }
        group.push(list[i]);
      }
      return result;
    });
  }

  /* Promise polyfills */
  var P = g.Promise;
  if (typeof P === "function") {
    if (typeof P.allSettled !== "function") {
      defineValue(P, "allSettled", function (values) {
        var list = toList(values);
        return P.all(list.map(function (value) {
          return P.resolve(value).then(
            function (result) { return { status: "fulfilled", value: result }; },
            function (reason) { return { status: "rejected", reason: reason }; }
          );
        }));
      });
    }

    if (typeof P.prototype.finally !== "function") {
      defineProto(P.prototype, "finally", function (onFinally) {
        var C = this.constructor;
        var isFunction = typeof onFinally === "function";
        return this.then(
          function (value) {
            return C.resolve(isFunction ? onFinally() : onFinally).then(function () { return value; });
          },
          function (reason) {
            return C.resolve(isFunction ? onFinally() : onFinally).then(function () { throw reason; });
          }
        );
      });
    }

    if (typeof P.withResolvers !== "function") {
      defineValue(P, "withResolvers", function () {
        var resolve;
        var reject;
        var promise = new P(function (promiseResolve, promiseReject) {
          resolve = promiseResolve;
          reject = promiseReject;
        });
        return { promise: promise, resolve: resolve, reject: reject };
      });
    }

    if (typeof P.try !== "function") {
      defineValue(P, "try", function (callback) {
        return new P(function (resolve, reject) {
          try {
            resolve(callback());
          } catch (e) {
            reject(e);
          }
        });
      });
    }

    if (typeof P.any !== "function") {
      defineValue(P, "any", function (values) {
        var list = toList(values);
        return new P(function (resolve, reject) {
          var errors = [];
          var remaining = list.length;
          if (remaining === 0) {
            reject(new g.AggregateError([], "All promises were rejected"));
            return;
          }
          list.forEach(function (value, index) {
            P.resolve(value).then(function (v) {
              resolve(v);
            }, function (e) {
              errors[index] = e;
              remaining--;
              if (remaining === 0) {
                reject(new g.AggregateError(errors, "All promises were rejected"));
              }
            });
          });
        });
      });
    }
  }

  /* String polyfills — many TV browsers lack ES2017+ string methods */
  if (typeof String.prototype.includes !== "function") {
    defineProto(String.prototype, "includes", function (search, start) {
      if (typeof start !== "number") start = 0;
      if (start + search.length > this.length) return false;
      return this.indexOf(search, start) !== -1;
    });
  }
  if (typeof String.prototype.startsWith !== "function") {
    defineProto(String.prototype, "startsWith", function (search, pos) {
      pos = !pos || pos < 0 ? 0 : +pos;
      return this.substring(pos, pos + search.length) === search;
    });
  }
  if (typeof String.prototype.endsWith !== "function") {
    defineProto(String.prototype, "endsWith", function (search, this_len) {
      if (this_len === undefined || this_len > this.length) this_len = this.length;
      return this.substring(this_len - search.length, this_len) === search;
    });
  }
  if (typeof String.prototype.repeat !== "function") {
    defineProto(String.prototype, "repeat", function (count) {
      if (this == null) throw new TypeError("can't convert " + this + " to object");
      var str = "" + this;
      count = +count;
      if (count < 0 || count === Infinity) throw new RangeError("Invalid count value");
      count = Math.floor(count);
      if (str.length === 0 || count === 0) return "";
      if (str.length * count >= 1 << 28) throw new RangeError("Repeat count must not overflow maximum string size");
      var rpt = "";
      for (var i = 0; i < count; i++) rpt += str;
      return rpt;
    });
  }
  if (typeof String.prototype.padStart !== "function") {
    defineProto(String.prototype, "padStart", function (targetLength, padString) {
      targetLength = targetLength >> 0;
      padString = String(typeof padString !== "undefined" ? padString : " ");
      if (this.length > targetLength) return String(this);
      targetLength = targetLength - this.length;
      if (targetLength > padString.length) padString += padString.repeat(targetLength / padString.length);
      return padString.slice(0, targetLength) + String(this);
    });
  }
  if (typeof String.prototype.padEnd !== "function") {
    defineProto(String.prototype, "padEnd", function (targetLength, padString) {
      targetLength = targetLength >> 0;
      padString = String(typeof padString !== "undefined" ? padString : " ");
      if (this.length > targetLength) return String(this);
      targetLength = targetLength - this.length;
      if (targetLength > padString.length) padString += padString.repeat(targetLength / padString.length);
      return String(this) + padString.slice(0, targetLength);
    });
  }
  if (typeof String.prototype.trimStart !== "function") {
    defineProto(String.prototype, "trimStart", function () { return this.replace(/^\s+/, ""); });
  }
  if (typeof String.prototype.trimEnd !== "function") {
    defineProto(String.prototype, "trimEnd", function () { return this.replace(/\s+$/, ""); });
  }

  /* String.replaceAll — Chromium 85+, used by the main bundle on boot. */
  if (typeof String.prototype.replaceAll !== "function") {
    defineProto(String.prototype, "replaceAll", function (search, replacement) {
      var s = String(this);
      if (search !== null && typeof search === "object" && typeof search.source !== "undefined") {
        var flags = String(search.flags || "");
        var re = new RegExp(search.source, flags.indexOf("g") >= 0 ? flags : flags + "g");
        return s.replace(re, replacement);
      }
      var needle = String(search);
      var parts = s.split(needle);
      if (typeof replacement === "function") {
        var out = "";
        for (var i = 0; i < parts.length; i++) {
          if (i > 0) out += String(replacement(needle));
          out += parts[i];
        }
        return out;
      }
      return parts.join(String(replacement));
    });
  }

  /* String.matchAll — Chromium 73+. Returns an iterable of matches. */
  if (typeof String.prototype.matchAll !== "function") {
    defineProto(String.prototype, "matchAll", function (regex) {
      var flags = String(regex && regex.flags ? regex.flags : "g");
      var re = new RegExp(regex.source, flags.indexOf("g") >= 0 ? flags : flags + "g");
      var s = String(this);
      var out = [];
      var m;
      while ((m = re.exec(s))) {
        out.push(m);
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      return out;
    });
  }

  /* AbortSignal.timeout — Chromium 103+. Playlist sync uses it. */
  try {
    if (typeof g.AbortSignal === "function" && typeof g.AbortSignal.timeout !== "function") {
      defineValue(g.AbortSignal, "timeout", function (ms) {
        var controller = new g.AbortController();
        g.setTimeout(function () {
          try { controller.abort(); } catch (ignored) {}
        }, ms);
        return controller.signal;
      });
    }
  } catch (ignored) {}

  /* Array polyfills for Chrome 49 */
  if (typeof Array.prototype.includes !== "function") {
    defineProto(Array.prototype, "includes", function (searchElement, fromIndex) {
      if (this == null) throw new TypeError('"this" is null or not defined');
      var o = O(this);
      var len = o.length >>> 0;
      if (len === 0) return false;
      var n = fromIndex | 0;
      var k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);
      while (k < len) {
        if (o[k] === searchElement || (typeof o[k] === "number" && typeof searchElement === "number" && isNaN(o[k]) && isNaN(searchElement))) return true;
        k++;
      }
      return false;
    });
  }
  if (typeof Array.prototype.find !== "function") {
    defineProto(Array.prototype, "find", function (predicate, thisArg) {
      if (this == null) throw new TypeError('"this" is null or not defined');
      var o = O(this);
      var len = o.length >>> 0;
      if (typeof predicate !== "function") throw new TypeError("predicate must be a function");
      var k = 0;
      while (k < len) {
        var kValue = o[k];
        if (predicate.call(thisArg, kValue, k, o)) return kValue;
        k++;
      }
      return undefined;
    });
  }
  if (typeof Array.prototype.findIndex !== "function") {
    defineProto(Array.prototype, "findIndex", function (predicate, thisArg) {
      if (this == null) throw new TypeError('"this" is null or not defined');
      var o = O(this);
      var len = o.length >>> 0;
      if (typeof predicate !== "function") throw new TypeError("predicate must be a function");
      var k = 0;
      while (k < len) {
        if (predicate.call(thisArg, o[k], k, o)) return k;
        k++;
      }
      return -1;
    });
  }

  function isNaNPoly(v) { return v !== v; }

  /* NodeList.forEach — Chrome 51+ */
  if (typeof g.NodeList !== "undefined" && typeof g.NodeList.prototype.forEach !== "function") {
    defineProto(g.NodeList.prototype, "forEach", function (callback, thisArg) {
      for (var i = 0; i < this.length; i++) callback.call(thisArg, this[i], i, this);
    });
  }
  /* DOMTokenList.forEach */
  if (typeof g.DOMTokenList !== "undefined" && typeof g.DOMTokenList.prototype.forEach !== "function") {
    defineProto(g.DOMTokenList.prototype, "forEach", function (callback, thisArg) {
      for (var i = 0; i < this.length; i++) callback.call(thisArg, this[i], i, this);
    });
  }
  /* HTMLCollection.forEach — not standard but some code expects it */
  if (typeof g.HTMLCollection !== "undefined" && typeof g.HTMLCollection.prototype.forEach !== "function") {
    defineProto(g.HTMLCollection.prototype, "forEach", function (callback, thisArg) {
      for (var i = 0; i < this.length; i++) callback.call(thisArg, this[i], i, this);
    });
  }

  /* Element polyfills — closest, matches, remove */
  if (typeof g.Element !== "undefined") {
    if (typeof g.Element.prototype.matches !== "function") {
      var protoMatches = g.Element.prototype.matchesSelector ||
        g.Element.prototype.mozMatchesSelector ||
        g.Element.prototype.msMatchesSelector ||
        g.Element.prototype.oMatchesSelector ||
        g.Element.prototype.webkitMatchesSelector;
      if (protoMatches) {
        defineProto(g.Element.prototype, "matches", function (selector) { return protoMatches.call(this, selector); });
      } else {
        defineProto(g.Element.prototype, "matches", function (selector) {
          var matches = (this.document || this.ownerDocument).querySelectorAll(selector);
          var i = matches.length;
          while (--i >= 0 && matches[i] !== this) {}
          return i > -1;
        });
      }
    }
    defineProto(g.Element.prototype, "closest", function (selector) {
      var el = this;
      while (el && el.nodeType === 1) {
        if (el.matches(selector)) return el;
        el = el.parentElement || el.parentNode;
      }
      return null;
    });
    defineProto(g.Element.prototype, "remove", function () {
      if (this.parentNode) this.parentNode.removeChild(this);
    });
  }

  /* CustomEvent polyfill — Chrome 49+ has it but some TV shells strip it */
  if (typeof g.CustomEvent !== "function") {
    var CustomEventPoly = function (event, params) {
      params = params || { bubbles: false, cancelable: false, detail: null };
      var evt = doc.createEvent("CustomEvent");
      evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
      return evt;
    };
    CustomEventPoly.prototype = g.Event ? g.Event.prototype : {};
    defineValue(g, "CustomEvent", CustomEventPoly);
  }

  /* String.prototype.matchAll — Chromium 73+. */
  if (typeof String.prototype.matchAll !== "function") {
    defineValue(String.prototype, "matchAll", function (pattern) {
      var text = String(this);
      var regex;
      var flags = "";
      var iterator;
      var finished = false;

      if (pattern instanceof RegExp) {
        if (!pattern.global) {
          throw new TypeError("String.prototype.matchAll requires a global RegExp");
        }
        flags = "g";
        if (pattern.ignoreCase) flags += "i";
        if (pattern.multiline) flags += "m";
        if (pattern.unicode) flags += "u";
        if (pattern.sticky) flags += "y";
        if (pattern.dotAll) flags += "s";
        regex = new RegExp(pattern.source, flags);
        regex.lastIndex = pattern.lastIndex;
      } else {
        regex = new RegExp(String(pattern), "g");
      }

      iterator = {
        next: function () {
          var match;
          if (finished) return { value: undefined, done: true };
          match = regex.exec(text);
          if (match === null) {
            finished = true;
            return { value: undefined, done: true };
          }
          if (match[0] === "") regex.lastIndex += 1;
          return { value: match, done: false };
        }
      };
      if (g.Symbol && g.Symbol.iterator) {
        iterator[g.Symbol.iterator] = function () { return this; };
      }
      return iterator;
    });
  }

  /* String.prototype.replaceAll — Chromium 85+. */
  if (typeof String.prototype.replaceAll !== "function") {
    defineValue(String.prototype, "replaceAll", function (search, replacement) {
      var text = String(this);
      var start = 0;
      var index;
      var result = "";
      var replacementText;

      if (search instanceof RegExp) {
        if (!search.global) {
          throw new TypeError("String.prototype.replaceAll requires a global RegExp");
        }
        return text.replace(search, replacement);
      }
      search = String(search);
      if (search === "") {
        for (index = 0; index < text.length; index++) {
          replacementText = typeof replacement === "function"
            ? replacement("", index, text)
            : replacement;
          result += String(replacementText) + text.charAt(index);
        }
        return result + (typeof replacement === "function" ? String(replacement("", text.length, text)) : String(replacement));
      }
      while ((index = text.indexOf(search, start)) !== -1) {
        result += text.slice(start, index);
        replacementText = typeof replacement === "function"
          ? replacement(search, index, text)
          : replacement;
        result += String(replacementText);
        start = index + search.length;
      }
      return result + text.slice(start);
    });
  }

  function toInteger(value) {
    var number = Number(value);
    if (number !== number || number === 0) return 0;
    return number < 0 ? Math.ceil(number) : Math.floor(number);
  }

  function at(index) {
    var position = toInteger(index);
    if (position < 0) position += this.length;
    if (position < 0 || position >= this.length) return undefined;
    return this[position];
  }

  /* Array.prototype.at / String.prototype.at — Chromium 92+. */
  defineProto(Array.prototype, "at", at);
  defineProto(String.prototype, "at", at);

  function flattenInto(result, source, depth) {
    var object = O(source);
    var length = object.length >>> 0;
    var i;
    var item;
    for (i = 0; i < length; i++) {
      if (!(i in object)) continue;
      item = object[i];
      if (depth > 0 && Array.isArray(item)) {
        flattenInto(result, item, depth === Infinity ? Infinity : depth - 1);
      } else {
        result.push(item);
      }
    }
  }

  /* Array.prototype.flat / flatMap — Chromium 69 predates both. */
  defineProto(Array.prototype, "flat", function (depth) {
    var level = depth === undefined ? 1 : Number(depth);
    var result = [];
    if (level !== level || level < 0) level = 0;
    flattenInto(result, this, level);
    return result;
  });
  defineProto(Array.prototype, "flatMap", function (callback, thisArg) {
    var object = O(this);
    var length = object.length >>> 0;
    var result = [];
    var i;
    var mapped;
    if (typeof callback !== "function") throw new TypeError("flatMap callback must be a function");
    for (i = 0; i < length; i++) {
      if (!(i in object)) continue;
      mapped = callback.call(thisArg, object[i], i, object);
      if (Array.isArray(mapped)) {
        flattenInto(result, mapped, 0);
      } else {
        result.push(mapped);
      }
    }
    return result;
  });

  /* Array.prototype.findLast / findLastIndex — Chromium 97+. */
  defineProto(Array.prototype, "findLast", function (callback, thisArg) {
    var object = O(this);
    var length = object.length >>> 0;
    var i;
    if (typeof callback !== "function") throw new TypeError("findLast callback must be a function");
    for (i = length - 1; i >= 0; i--) {
      if (i in object) {
        var value = object[i];
        if (callback.call(thisArg, value, i, object)) return value;
      }
    }
    return undefined;
  });
  defineProto(Array.prototype, "findLastIndex", function (callback, thisArg) {
    var object = O(this);
    var length = object.length >>> 0;
    var i;
    if (typeof callback !== "function") throw new TypeError("findLastIndex callback must be a function");
    for (i = length - 1; i >= 0; i--) {
      if (i in object) {
        if (callback.call(thisArg, object[i], i, object)) return i;
      }
    }
    return -1;
  });

  /* Array.prototype.toReversed / toSorted / toSpliced / with — Chromium 110+. */
  defineProto(Array.prototype, "toReversed", function () {
    var object = O(this);
    var length = object.length >>> 0;
    var result = new Array(length);
    var i;
    for (i = 0; i < length; i++) {
      result[i] = object[length - 1 - i];
    }
    return result;
  });
  defineProto(Array.prototype, "toSorted", function (compareFn) {
    var copy = Array.prototype.slice.call(this);
    return copy.sort(compareFn);
  });
  defineProto(Array.prototype, "toSpliced", function (start, deleteCount) {
    var args = Array.prototype.slice.call(arguments);
    var copy = Array.prototype.slice.call(this);
    Array.prototype.splice.apply(copy, args);
    return copy;
  });
  defineProto(Array.prototype, "with", function (index, value) {
    var object = O(this);
    var length = object.length >>> 0;
    var pos = toInteger(index);
    if (pos < 0) pos += length;
    if (pos < 0 || pos >= length) throw new RangeError("Invalid index");
    var copy = Array.prototype.slice.call(object);
    copy[pos] = value;
    return copy;
  });

  /* queueMicrotask — Chromium 71+. */
  if (typeof g.queueMicrotask !== "function") {
    defineValue(g, "queueMicrotask", function (callback) {
      if (typeof callback !== "function") throw new TypeError("callback is not a function");
      P.resolve().then(callback);
    });
  }

  /* structuredClone — Chromium 98+. JSON is sufficient for app cache data. */
  if (typeof g.structuredClone !== "function") {
    defineValue(g, "structuredClone", function (value) {
      if (value === undefined) return undefined;
      return JSON.parse(JSON.stringify(value));
    });
  }

  /* AggregateError — Chromium 85+. */
  if (typeof g.AggregateError !== "function") {
    var TVAggregateError = function (errors, message) {
      if (!(this instanceof TVAggregateError)) return new TVAggregateError(errors, message);
      this.name = "AggregateError";
      this.message = message === undefined ? "" : String(message);
      this.errors = toList(errors);
      if (Error.captureStackTrace) Error.captureStackTrace(this, TVAggregateError);
    };
    TVAggregateError.prototype = O.create(Error.prototype);
    TVAggregateError.prototype.constructor = TVAggregateError;
    defineValue(g, "AggregateError", TVAggregateError);
  }

  /* reportError — Chromium 110+. Report asynchronously like the native API. */
  if (typeof g.reportError !== "function") {
    defineValue(g, "reportError", function (error) {
      var reported = error instanceof Error ? error : new Error(String(error));
      g.setTimeout(function () { throw reported; }, 0);
    });
  }

  /* crypto.randomUUID — Chromium 92+. */
  var cryptoObject = g.crypto;
  if (!cryptoObject) {
    cryptoObject = {};
    defineValue(g, "crypto", cryptoObject);
  }
  if (typeof cryptoObject.randomUUID !== "function") {
    defineValue(cryptoObject, "randomUUID", function () {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (character) {
        var random = (Math.random() * 16) | 0;
        var value = character === "x" ? random : (random & 3) | 8;
        return value.toString(16);
      });
    });
  }

  /* AbortSignal.timeout / any — Chromium 100+ / 117+. Supabase uses timeout. */
  if (typeof g.AbortSignal === "function") {
    if (typeof g.AbortSignal.timeout !== "function") {
      defineValue(g.AbortSignal, "timeout", function (ms) {
        var controller = new g.AbortController();
        g.setTimeout(function () {
          controller.abort(new DOMException("TimeoutError", "TimeoutError"));
        }, ms);
        return controller.signal;
      });
    }
    if (typeof g.AbortSignal.any !== "function") {
      defineValue(g.AbortSignal, "any", function (signals) {
        var controller = new g.AbortController();
        var list = toList(signals);
        var i;
        var signal;
        function abort() {
          controller.abort();
        }
        for (i = 0; i < list.length; i++) {
          signal = list[i];
          if (signal && signal.aborted) {
            controller.abort(signal.reason);
            break;
          }
          if (signal && signal.addEventListener) {
            signal.addEventListener("abort", abort);
          }
        }
        return controller.signal;
      });
    }
  }

  /* URL.canParse — Chromium 120+. */
  if (typeof g.URL === "function" && typeof g.URL.canParse !== "function") {
    defineValue(g.URL, "canParse", function (url, base) {
      try {
        if (base !== undefined) new g.URL(url, base);
        else new g.URL(url);
        return true;
      } catch (e) {
        return false;
      }
    });
  }

  /* Element.prototype.replaceChildren — Chromium 86+. */
  if (typeof g.Element !== "undefined") {
    defineProto(g.Element.prototype, "replaceChildren", function () {
      var args = arguments;
      var i;
      while (this.firstChild) this.removeChild(this.firstChild);
      for (i = 0; i < args.length; i++) {
        var node = args[i];
        if (typeof node === "string") node = doc.createTextNode(node);
        if (node) this.appendChild(node);
      }
    });
  }

  /* Element.prototype.toggleAttribute — Chromium 69 exactly, but be safe. */
  if (typeof g.Element !== "undefined") {
    defineProto(g.Element.prototype, "toggleAttribute", function (name, force) {
      var has = this.hasAttribute(name);
      var shouldAdd = force !== undefined ? !!force : !has;
      if (shouldAdd) this.setAttribute(name, "");
      else this.removeAttribute(name);
      return shouldAdd;
    });
  }

  /* requestIdleCallback / cancelIdleCallback — Chrome 47+, but some TV shells strip it. */
  if (typeof g.requestIdleCallback !== "function") {
    defineValue(g, "requestIdleCallback", function (callback, options) {
      var timeout = options && options.timeout ? options.timeout : 0;
      var start = Date.now();
      return g.setTimeout(function () {
        callback({
          didTimeout: false,
          timeRemaining: function () {
            return Math.max(0, 50 - (Date.now() - start));
          }
        });
      }, timeout || 1);
    });
  }
  if (typeof g.cancelIdleCallback !== "function") {
    defineValue(g, "cancelIdleCallback", function (id) {
      g.clearTimeout(id);
    });
  }

  /* requestAnimationFrame — old TV shells sometimes expose neither rAF nor
   * the vendor-prefixed variant. Rows and modal episode paging call rAF on
   * scroll, so leaving this missing turns a harmless remote press into an
   * uncaught TypeError. A timer is the correct low-cost fallback for these
   * already-low-frame-rate devices. */
  if (typeof g.requestAnimationFrame !== "function") {
    defineValue(g, "requestAnimationFrame", function (callback) {
      return g.setTimeout(function () {
        callback(Date.now());
      }, 16);
    });
  }
  if (typeof g.cancelAnimationFrame !== "function") {
    defineValue(g, "cancelAnimationFrame", function (id) {
      g.clearTimeout(id);
    });
  }

  /* matchMedia — not present in a few embedded TV webviews. The app only
   * needs the matches value and listener shape, so provide a conservative
   * viewport-only implementation instead of failing while Navbar mounts. */
  if (typeof g.matchMedia !== "function") {
    defineValue(g, "matchMedia", function (query) {
      var text = String(query || "");
      var width = Number(g.innerWidth || 0);
      var max = text.match(/max-width\s*:\s*(\d+)px/i);
      var min = text.match(/min-width\s*:\s*(\d+)px/i);
      var matches = true;
      if (max) matches = matches && width <= Number(max[1]);
      if (min) matches = matches && width >= Number(min[1]);
      if (!max && !min) matches = false;
      return {
        matches: matches,
        media: text,
        addListener: function () {},
        removeListener: function () {},
        addEventListener: function () {},
        removeEventListener: function () {},
        onchange: null,
      };
    });
  }

  /* ResizeObserver — Chrome 64+, but TV may lack. No-op fallback keeps app from crashing. */
  if (typeof g.ResizeObserver !== "function") {
    var NoopResizeObserver = function () {};
    NoopResizeObserver.prototype.observe = function () {};
    NoopResizeObserver.prototype.unobserve = function () {};
    NoopResizeObserver.prototype.disconnect = function () {};
    defineValue(g, "ResizeObserver", NoopResizeObserver);
  }

  /* scrollBy / scrollTo with options object — ensure object form works on Chromium 69. */
  if (typeof g.Element !== "undefined") {
    (function () {
      var originalScrollBy = g.Element.prototype.scrollBy;
      var originalScrollTo = g.Element.prototype.scrollTo;
      try {
        defineValue(g.Element.prototype, "scrollBy", function (optionsOrX, y) {
          if (typeof optionsOrX === "object" && optionsOrX !== null) {
            var left = optionsOrX.left || 0;
            var top = optionsOrX.top || 0;
            if (typeof originalScrollBy === "function") {
              try {
                return originalScrollBy.call(this, optionsOrX);
              } catch (e) {}
            }
            this.scrollLeft += left;
            this.scrollTop += top;
          } else {
            if (typeof originalScrollBy === "function") {
              try {
                return originalScrollBy.call(this, optionsOrX, y);
              } catch (e) {}
            }
            this.scrollLeft += optionsOrX || 0;
            this.scrollTop += y || 0;
          }
        });
      } catch (ignored) {}
      try {
        defineValue(g.Element.prototype, "scrollTo", function (optionsOrX, y) {
          if (typeof optionsOrX === "object" && optionsOrX !== null) {
            var left = optionsOrX.left !== undefined ? optionsOrX.left : this.scrollLeft;
            var top = optionsOrX.top !== undefined ? optionsOrX.top : this.scrollTop;
            if (typeof originalScrollTo === "function") {
              try {
                return originalScrollTo.call(this, optionsOrX);
              } catch (e) {}
            }
            this.scrollLeft = left;
            this.scrollTop = top;
          } else {
            if (typeof originalScrollTo === "function") {
              try {
                return originalScrollTo.call(this, optionsOrX, y);
              } catch (e) {}
            }
            if (optionsOrX !== undefined) this.scrollLeft = optionsOrX;
            if (y !== undefined) this.scrollTop = y;
          }
        });
      } catch (ignored) {}
    })();
  }

  /* IntersectionObserver fallback: load lazy posters immediately on old TVs. */
  if (typeof g.IntersectionObserver !== "function") {
    var TVIntersectionObserver = function (callback) {
      this._callback = callback;
      this._observed = [];
    };
    TVIntersectionObserver.prototype.observe = function (element) {
      var i;
      var rect = null;
      for (i = 0; i < this._observed.length; i++) {
        if (this._observed[i] === element) return;
      }
      this._observed.push(element);
      try {
        if (element && element.getBoundingClientRect) rect = element.getBoundingClientRect();
      } catch (ignored) {}
      this._callback([{
        time: new Date().getTime(),
        target: element,
        rootBounds: null,
        boundingClientRect: rect,
        intersectionRect: rect,
        isIntersecting: true,
        intersectionRatio: 1
      }], this);
    };
    TVIntersectionObserver.prototype.unobserve = function (element) {
      var next = [];
      var i;
      for (i = 0; i < this._observed.length; i++) {
        if (this._observed[i] !== element) next.push(this._observed[i]);
      }
      this._observed = next;
    };
    TVIntersectionObserver.prototype.disconnect = function () {
      this._observed = [];
    };
    TVIntersectionObserver.prototype.takeRecords = function () { return []; };
    TVIntersectionObserver.__tvBootShim = true;
    defineValue(g, "IntersectionObserver", TVIntersectionObserver);
  }

  /* ── Extra hardening for very old TV browsers ───────────────────── */
  /* Ensure console exists — some TV shells lack it until devtools open */
  if (typeof g.console === "undefined") {
    g.console = { log: function(){}, error: function(){}, warn: function(){}, info: function(){} };
  }

  /* Ensure Symbol exists at least minimally */
  if (typeof g.Symbol === "undefined") {
    defineValue(g, "Symbol", { iterator: "@@iterator" });
  }

  /*
   * A boot-time handler is deliberately here rather than in React. If a
   * module throws while it is being evaluated, React never gets to mount its
   * own error boundary. Tizen users still get a useful red diagnostic panel.
   */
  var userAgent = "";
  try { userAgent = String((g.navigator && g.navigator.userAgent) || ""); } catch (ignored) {}
  var isTv = /SMART-TV|SMARTTV|Tizen|Web0S|webOS|NetCast|BRAVIA|Viera|HbbTV|GoogleTV|Android TV|TV Safari/i.test(userAgent);

  if (isTv && typeof g.addEventListener === "function") {
    function errorText(error) {
      var text;
      try {
        if (error && error.stack) return String(error.stack);
        if (error && error.message) return String(error.message);
        text = String(error);
      } catch (ignored) { text = "Unknown runtime error"; }
      return text;
    }

    function showRuntimeError(error, event) {
      var documentObject = g.document;
      var render;
      if (!documentObject) return;
      render = function () {
        var panel = documentObject.getElementById("tv-runtime-error");
        var detail;
        var title;
        var reload;
        var message = errorText(error);
        if (event && event.filename) {
          message += "\n\n" + String(event.filename) + ":" + String(event.lineno || 0) + ":" + String(event.colno || 0);
        }
        if (panel) {
          detail = panel.getElementsByTagName("pre")[0];
          if (detail) detail.textContent = message;
          return;
        }
        panel = documentObject.createElement("div");
        panel.id = "tv-runtime-error";
        panel.setAttribute("data-tv-error-overlay", "1");
        panel.setAttribute("role", "alert");
        panel.style.cssText = "position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;background:#b00020;color:#fff;padding:42px;box-sizing:border-box;font:24px/1.45 Arial,sans-serif;overflow:auto;";
        title = documentObject.createElement("h1");
        title.textContent = "TV runtime error";
        title.style.cssText = "margin:0 0 20px;font-size:32px;color:#fff;";
        panel.appendChild(title);
        detail = documentObject.createElement("pre");
        detail.textContent = message;
        detail.style.cssText = "margin:0 0 28px;white-space:pre-wrap;word-wrap:break-word;font:20px/1.45 monospace;color:#fff;";
        panel.appendChild(detail);
        reload = documentObject.createElement("button");
        reload.type = "button";
        reload.textContent = "Reload";
        reload.style.cssText = "padding:12px 24px;border:2px solid #fff;border-radius:4px;background:#fff;color:#8b0019;font:bold 20px Arial;";
        reload.onclick = function () {
          try { g.location.reload(); } catch (ignored) {}
        };
        panel.appendChild(reload);
        if (documentObject.body) documentObject.body.appendChild(panel);
      };
      if (documentObject.body) {
        render();
      } else if (typeof documentObject.addEventListener === "function") {
        documentObject.addEventListener("DOMContentLoaded", render, false);
      } else {
        g.setTimeout(render, 0);
      }
    }

    g.addEventListener("error", function (event) {
      // Errors from an embedded provider or another third-party script must
      // not replace the whole catalogue with the red TV diagnostic panel.
      // They are outside this app's origin and the player owns its own
      // recovery UI. Keep reporting errors from our document/bundle.
      var filename = "";
      var origin = "";
      try { filename = String((event && event.filename) || ""); } catch (ignored) {}
      try { origin = String((g.location && g.location.origin) || ""); } catch (ignored) {}
      if (filename && origin && origin !== "null" && filename.indexOf(origin) !== 0) return;
      if (event && event.target && event.target !== g && !event.error && !event.message) return;
      showRuntimeError(event && (event.error || event.message) || event, event);
    }, false);
    g.addEventListener("unhandledrejection", function (event) {
      showRuntimeError(event && event.reason || event, event);
    }, false);
  }
})();
`;

export function renderTvBootScriptTag(): string {
  return `<script ${TV_BOOT_MARKER}="1">\n${TV_BOOT_SCRIPT}\n</script>`;
}
