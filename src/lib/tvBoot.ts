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

  /* Promise.allSettled — Chromium 76+. */
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

    /* Promise.withResolvers — Chromium 119+. */
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
          /* Prevent an empty expression from making no progress. */
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
  if (typeof Array.prototype.at !== "function") {
    defineValue(Array.prototype, "at", at);
  }
  if (typeof String.prototype.at !== "function") {
    defineValue(String.prototype, "at", at);
  }

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
  if (typeof Array.prototype.flat !== "function") {
    defineValue(Array.prototype, "flat", function (depth) {
      var level = depth === undefined ? 1 : Number(depth);
      var result = [];
      if (level !== level || level < 0) level = 0;
      flattenInto(result, this, level);
      return result;
    });
  }
  if (typeof Array.prototype.flatMap !== "function") {
    defineValue(Array.prototype, "flatMap", function (callback, thisArg) {
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
  }

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
    defineValue(g, "IntersectionObserver", TVIntersectionObserver);
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
      /* Ignore resource-load events; show uncaught script/runtime errors. */
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
