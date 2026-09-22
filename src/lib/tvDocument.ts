/**
 * Server-side document tweaks for TV browsers.
 *
 * Everything in here runs while the SSR HTML is streamed out of Nitro, before
 * the TV has parsed anything. Two real-world problems are solved here:
 *
 * 1. **Inline scripts are not transpiled.** TanStack Router inlines a
 *    scroll-restoration script that is written in ES2020 (`?.`, `??`).
 *    Chromium 69 (Tizen 5.5) throws `SyntaxError: Unexpected token '.'` on it,
 *    so the script never runs — and, more importantly, any *other* inline
 *    script written in modern syntax would die the same way (the `$tsr` stream
 *    scripts are what make the server-rendered markup hydratable). For TV UAs
 *    the ES2020 script is removed and replaced by a tiny ES5 equivalent.
 *
 * 2. **A TV whose JS engine cannot run the bundle must still be usable.** The
 *    `tv-layout` class is added server-side (no first-frame desktop flash, and
 *    it stays correct when JS never boots), `<script type="module">` is dropped
 *    for engines that predate ES modules, and an ES5 remote-control helper
 *    wires up D-pad navigation for the server-rendered poster library.
 *
 * `?tv=1` forces the static variant from any device — handy for diagnosing a
 * real TV ("does even the JS-free page open?").
 */

export const TV_UA_PATTERN =
  /SMART-TV|SMARTTV|Tizen|Web0S|webOS|NetCast|BRAVIA|Viera|HbbTV|GoogleTV|Android TV|TV Safari|Maple|NetFront|Opera TV/i;

export function isTvUserAgent(userAgent: string | null | undefined): boolean {
  return !!userAgent && TV_UA_PATTERN.test(userAgent);
}

/**
 * Can this TV browser execute ES modules? Chromium 61+ can; Tizen before 5.0
 * (Chromium 56 on the 2017 sets, older still on 2015/2016 ones) cannot, and
 * those browsers ignore `type="module"` silently while still downloading it.
 */
export function tvBrowserSupportsModules(userAgent: string): boolean {
  if (!TV_UA_PATTERN.test(userAgent)) return true;
  const chrome = /Chrome\/(\d+)/.exec(userAgent);
  if (chrome) return Number(chrome[1]) >= 61;
  const tizen = /Tizen\s+(\d+)/i.exec(userAgent);
  if (tizen) {
    const major = Number(tizen[1]);
    // Tizen 5.0 => Chromium 63 (modules fine); Tizen 4.0 => Chromium 56 (no).
    if (major >= 5) return true;
    return major >= 6;
  }
  const webos = /Web0S|webOS/i.test(userAgent);
  if (webos) {
    const version = /(?:Web0S|webOS)[^;)]*?(\d+)\./i.exec(userAgent);
    if (version) return Number(version[1]) >= 4;
    return false;
  }
  // Unknown SMART-TV UA: assume the worst, the static page is always readable.
  return false;
}

/** `<html lang="en">` (or with an existing class) becomes TV-layout immediately. */
export function markTvLayout(html: string): string {
  const openTag = /<html\b([^>]*)>/i.exec(html);
  if (!openTag) return html;
  const attrs = openTag[1];
  if (/\bclass\s*=\s*"[^"]*\btv-layout\b/i.test(attrs)) return html;
  const withClass = /\bclass\s*=\s*"([^"]*)"/i.test(attrs)
    ? attrs.replace(
        /\bclass\s*=\s*"([^"]*)"/i,
        (_m, existing: string) => `class="${existing} tv-layout"`,
      )
    : `${attrs} class="tv-layout"`;
  return (
    html.slice(0, openTag.index) +
    `<html${withClass}>` +
    html.slice(openTag.index + openTag[0].length)
  );
}

/**
 * Removes the ES2020 inline scroll-restoration script TanStack emits. The
 * router restores scroll from its own client code; the inline copy exists only
 * to avoid a visible jump, which is worth far less than a parse-clean document
 * on a TV.
 */
export function stripModernInlineScripts(html: string): string {
  const patterns = [
    // TanStack scroll restoration: `sessionStorage.getItem(...)` + __TSR_key.
    /<script\b(?![^>]*\bsrc=)[^>]*>(?:(?!<\/script>)[\s\S])*?__TSR_key(?:(?!<\/script>)[\s\S])*?<\/script>\s*/gi,
    // Any other inline script that uses optional chaining / nullish coalescing
    // (Chromium 80+) or BigInt/numeric separators would be a parse error too.
    /<script\b(?![^>]*\bsrc=)[^>]*>(?:(?!<\/script>)[\s\S])*?(?:\?\.|\?\?)[^<]*(?:(?!<\/script>)[\s\S])*?<\/script>\s*/gi,
  ];
  let out = html;
  for (const re of patterns) out = out.replace(re, "");
  return out;
}

/** Drops the ES-module entry + preload hints for engines that cannot use them. */
export function stripModuleScripts(html: string): string {
  return html
    .replace(/<link\b[^>]*\brel="modulepreload"[^>]*>\s*/gi, "")
    .replace(/<script\b[^>]*\btype="module"[^>]*>(?:(?!<\/script>)[\s\S])*?<\/script>\s*/gi, "");
}

/**
 * Inline ES5 script (no arrows, no let/const, no template literals) that keeps
 * a TV usable when the interactive bundle never boots:
 *
 *   - D-pad arrows move focus between the server-rendered poster links,
 *   - Enter/Space activates the focused element,
 *   - a small note explains that the TV is on the simplified page, and offers
 *     the full app again.
 *
 * When the app *did* boot (`window.__VIDD_READY__`), the script stays out of
 * the way — the app has its own spatial navigation.
 */
export function renderTvFallbackScript(options: { static: boolean }): string {
  const staticFlag = options.static ? "true" : "false";
  return `<script data-tv-fallback="1">
(function () {
  var STATIC = ${staticFlag};
  var doc = document;
  var win = window;
  var NOTICE_ID = "tv-simple-notice";
  var READY_ATTR = "__VIDD_READY__";

  function appReady() {
    try { return win[READY_ATTR] === true; } catch (e) { return false; }
  }

  function giveFocus(el) {
    if (!el) return;
    try { el.focus(); } catch (e) {
      try { el.setAttribute("tabindex", "-1"); el.focus(); } catch (e2) {}
    }
    try {
      if (el.scrollIntoView) el.scrollIntoView({ block: "center", inline: "center" });
    } catch (e3) {
      try { if (el.scrollIntoView) el.scrollIntoView(false); } catch (e4) {}
    }
  }

  function focusables() {
    var nodes = doc.querySelectorAll('a[href], button:not([disabled]), [tabindex="0"]');
    var list = [];
    var i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var rect = null;
      try { rect = el.getBoundingClientRect(); } catch (e) { rect = null; }
      var visible = !!rect && rect.width > 1 && rect.height > 1;
      if (!visible) continue;
      if (el.getAttribute("data-tv-skip") === "1") continue;
      list.push(el);
    }
    return list;
  }

  function indexOf(list, el) {
    var i;
    for (i = 0; i < list.length; i++) if (list[i] === el) return i;
    return -1;
  }

  function move(step) {
    var list = focusables();
    if (!list.length) return;
    var current = indexOf(list, doc.activeElement);
    var next;
    if (current === -1) next = step > 0 ? 0 : list.length - 1;
    else if (step > 0) next = current + 1 < list.length ? current + 1 : current;
    else next = current > 0 ? current - 1 : 0;
    giveFocus(list[next]);
  }

  function notice() {
    if (doc.getElementById(NOTICE_ID)) return;
    if (!doc.body) return;
    var bar = doc.createElement("div");
    bar.id = NOTICE_ID;
    bar.setAttribute("data-tv-skip", "1");
    bar.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:2147483645;background:#111;color:#eee;" +
      "border-top:2px solid #f47521;padding:10px 16px;font:14px/1.4 Arial,sans-serif;text-align:center;";
    var text = doc.createElement("span");
    text.textContent = STATIC
      ? "Simple TV mode — remote ke arrows se chalein, OK/Enter se kholein. "
      : "App load nahi ho paya — remote se library browse karein. ";
    bar.appendChild(text);
    var link = doc.createElement("a");
    link.href = STATIC ? "/" : "/?tv=1";
    link.textContent = STATIC ? "Full app try karein" : "Simple mode";
    link.style.cssText = "color:#f47521;font-weight:bold;text-decoration:underline;margin-left:6px;";
    bar.appendChild(link);
    doc.body.appendChild(bar);
  }

  function keydown(event) {
    if (appReady()) return;
    var key = event.key || "";
    var code = event.keyCode;
    var isUp = key === "ArrowUp" || code === 38;
    var isDown = key === "ArrowDown" || code === 40;
    var isLeft = key === "ArrowLeft" || code === 37;
    var isRight = key === "ArrowRight" || code === 39;
    if (isUp || isLeft) {
      move(-1);
      event.preventDefault();
      return;
    }
    if (isDown || isRight) {
      move(1);
      event.preventDefault();
      return;
    }
    if (key === "Enter" || code === 13) {
      var active = doc.activeElement;
      if (active && doc.body !== active && active.click) {
        try { active.click(); } catch (e) {}
      }
    }
  }

  function boot() {
    if (appReady()) return;
    if (STATIC) {
      notice();
      var list = focusables();
      if (list.length && (!doc.activeElement || doc.activeElement === doc.body)) giveFocus(list[0]);
    }
    doc.addEventListener("keydown", keydown, true);
    win.setTimeout(function () {
      if (appReady()) return;
      notice();
      var list = focusables();
      if (list.length && (!doc.activeElement || doc.activeElement === doc.body)) giveFocus(list[0]);
    }, 9000);
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", boot, false);
  } else {
    boot();
  }
})();
</script>`;
}

export interface TvDocumentOptions {
  userAgent: string;
  forceStatic: boolean;
}

/**
 * Applies every TV document fix. Returns the HTML unchanged for normal
 * browsers so the desktop/mobile output stays byte-for-byte what it was.
 */
export function applyTvDocumentTweaks(html: string, options: TvDocumentOptions): string {
  const isTv = isTvUserAgent(options.userAgent);
  if (!isTv && !options.forceStatic) return html;
  const modulesOk = isTv ? tvBrowserSupportsModules(options.userAgent) : true;
  const staticMode = options.forceStatic || !modulesOk;

  let out = markTvLayout(html);
  out = stripModernInlineScripts(out);
  if (staticMode) out = stripModuleScripts(out);
  if (!out.includes("data-tv-fallback=")) {
    const script = renderTvFallbackScript({ static: staticMode });
    out = out.includes("</body>")
      ? out.replace(/<\/body>/i, `${script}\n</body>`)
      : `${out}\n${script}`;
  }
  return out;
}
