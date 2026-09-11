/**
 * Boot polyfills for Samsung Tizen 5.5 (Chromium 69) and similar TV
 * browsers. This runs as an inline <script> in the SSR'd <head>, i.e.
 * BEFORE any bundle JS is evaluated — that order matters: a single
 * `ReferenceError: globalThis is not defined` anywhere in a module's top
 * level (Supabase's client does reference it) kills the whole bundle and
 * the app renders as a black screen on the TV.
 *
 * Kept dependency-free and ES5-only on purpose: the script itself must run
 * on the very browsers it fixes.
 */
export const TV_BOOT_SCRIPT = String.raw`
(function () {
  var g = (function () {
    if (typeof globalThis !== "undefined") return globalThis;
    if (typeof window !== "undefined") return window;
    if (typeof self !== "undefined") return self;
    if (typeof global !== "undefined") return global;
    try { return Function("return this")(); } catch (e) { return {}; }
  })();

  /* globalThis — added in Chromium 71; Tizen 5.5 ships Chromium 69. */
  if (typeof g.globalThis === "undefined") {
    try {
      Object.defineProperty(g, "globalThis", {
        value: g, writable: true, configurable: true, enumerable: false,
      });
    } catch (e) { g.globalThis = g; }
  }

  /* Object.fromEntries — Chromium 73+ */
  if (typeof Object.fromEntries !== "function") {
    Object.fromEntries = function (entries) {
      var out = {};
      var list = Object(entries);
      for (var i = 0; i < list.length; i++) {
        var entry = list[i];
        if (entry && entry.length) { out[entry[0]] = entry[1]; }
      }
      return out;
    };
  }

  /* Promise.allSettled — Chromium 76+ */
  if (typeof Promise.allSettled !== "function") {
    Promise.allSettled = function (values) {
      var list = Array.prototype.slice.call(values);
      return Promise.all(list.map(function (v) {
        return Promise.resolve(v).then(
          function (r) { return { status: "fulfilled", value: r }; },
          function (e) { return { status: "rejected", reason: e }; }
        );
      }));
    };
  }

  /* String.prototype.replaceAll — Chromium 85+ */
  if (typeof String.prototype.replaceAll !== "function") {
    Object.defineProperty(String.prototype, "replaceAll", {
      value: function (search, replacement) {
        if (search instanceof RegExp) {
          if (!search.global) {
            throw new TypeError("String.prototype.replaceAll requires a global RegExp");
          }
          return this.replace(search, replacement);
        }
        return this.split(search).join(replacement);
      },
      writable: true, configurable: true,
    });
  }

  /* Array.prototype.at / String.prototype.at — Chromium 92+ */
  var at = function (n) {
    n = Math.trunc(n) || 0;
    if (n < 0) { n += this.length; }
    if (n < 0 || n >= this.length) { return undefined; }
    return this[n];
  };
  if (typeof Array.prototype.at !== "function") {
    Object.defineProperty(Array.prototype, "at", { value: at, writable: true, configurable: true });
  }
  if (typeof String.prototype.at !== "function") {
    Object.defineProperty(String.prototype, "at", { value: at, writable: true, configurable: true });
  }

  /* queueMicrotask — Chromium 71+ */
  if (typeof g.queueMicrotask !== "function") {
    g.queueMicrotask = function (cb) { Promise.resolve().then(cb); };
  }

  /* structuredClone — Chromium 98+ (JSON fallback is enough for the app) */
  if (typeof g.structuredClone !== "function") {
    g.structuredClone = function (value) {
      if (value === undefined) { return undefined; }
      return JSON.parse(JSON.stringify(value));
    };
  }

  /* crypto.randomUUID — Chromium 92+ */
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {
    crypto.randomUUID = function () {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
    };
  }
})();
`;
