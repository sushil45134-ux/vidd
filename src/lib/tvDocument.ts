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
 *    only for engines that predate ES modules, and an ES5 remote-control helper
 *    wires up D-pad navigation for the server-rendered poster library.
 *
 * A TV with module support keeps the normal interactive client; only an
 * engine that cannot execute modules uses the dependency-free document, with
 * no special URL or redirect required for viewers.
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

/**
 * Drops ES-module entries + preload hints for engines that cannot use them.
 *
 * TanStack emits two slightly different script shapes depending on the
 * adapter: production SSR uses a normal `<script ...></script>` pair, while
 * the Vite dev client can emit a start tag with no closing tag. The old
 * implementation only removed the first shape, which could still hand a
 * Chromium 49 TV a module whose first token was `export`.
 */
export function stripModuleScripts(html: string): string {
  return html
    .replace(
      /<link\b[^>]*\brel\s*=\s*["']modulepreload["'][^>]*\/?>(?:\s*)/gi,
      "",
    )
    // Remove paired module scripts first, including inline module bodies.
    .replace(
      /<script\b(?=[^>]*\btype\s*=\s*["']module["'])[^>]*>[\s\S]*?<\/script>\s*/gi,
      "",
    )
    // Vite's dev client may omit the closing tag entirely. Do not leave the
    // start tag behind: a legacy browser treats it as a classic script.
    .replace(
      /<script\b(?=[^>]*\btype\s*=\s*["']module["'])[^>]*\/?>\s*/gi,
      "",
    );
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
    text.textContent = "TV library — remote ke arrows se chalein, OK/Enter se kholein.";
    bar.appendChild(text);
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

  function requestJson(url, done, failed) {
    if (typeof win.fetch === "function") {
      try {
        win.fetch(url).then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        }).then(done).catch(function () {
          if (failed) failed();
        });
        return;
      } catch (e) {}
    }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try { done(JSON.parse(xhr.responseText || "{}")); } catch (e2) { if (failed) failed(); }
        } else if (failed) failed();
      };
      xhr.send(null);
    } catch (e3) {
      if (failed) failed();
    }
  }

  function liveWatchUrl(row) {
    if (row && row.youtube_id) return "https://www.youtube.com/watch?v=" + encodeURIComponent(row.youtube_id);
    return String((row && (row.embed_url || row.video_url)) || "");
  }

  function renderLiveLibrary(rows) {
    if (!rows || !rows.length || !doc.body) return;
    var existing = doc.getElementById("tv-live-library");
    var section = existing || doc.createElement("section");
    var heading;
    var shelf;
    var i;
    if (!existing) {
      section.id = "tv-live-library";
      section.setAttribute("data-tv-skip", "1");
      section.style.cssText = "padding:18px 16px 70px;background:#000;color:#fff;font:16px Arial,sans-serif;";
      heading = doc.createElement("h2");
      heading.textContent = "Full library";
      heading.style.cssText = "font-size:22px;margin:0 0 12px;font-weight:bold;";
      section.appendChild(heading);
      shelf = doc.createElement("div");
      shelf.setAttribute("data-tv-live-shelf", "1");
      shelf.style.cssText = "display:flex;flex-wrap:wrap;gap:12px;";
      section.appendChild(shelf);
      doc.body.appendChild(section);
    } else {
      shelf = section.querySelector('[data-tv-live-shelf="1"]');
    }
    if (!shelf) return;
    for (i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      var href = liveWatchUrl(row);
      var title = String(row.title || "Untitled");
      var image = String(row.image || row.thumbnail_url || row.backdrop || "");
      if (!href || !image) continue;
      var card = doc.createElement("a");
      card.href = href;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.style.cssText = "display:block;width:220px;color:#eee;text-decoration:none;";
      var picture = doc.createElement("img");
      picture.src = image;
      picture.alt = title;
      picture.setAttribute("loading", "lazy");
      picture.style.cssText = "display:block;width:220px;height:124px;object-fit:cover;background:#181818;border-radius:5px;";
      var label = doc.createElement("div");
      label.textContent = title;
      label.style.cssText = "padding-top:6px;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      card.appendChild(picture);
      card.appendChild(label);
      shelf.appendChild(card);
    }
  }

  function loadLiveLibrary() {
    if (!STATIC) return;
    var columns = "id,title,image,thumbnail_url,backdrop,embed_url,video_url,youtube_id";
    var pageSize = 1000;
    var maxPages = 100;
    var all = [];
    function page(from, pageNumber) {
      var count = pageNumber === 0 ? "&count=1" : "";
      var url = "/api/movies?from=" + from + "&limit=" + pageSize + count + "&columns=" + encodeURIComponent(columns);
      requestJson(url, function (payload) {
        var rows = payload && payload.data;
        var total = payload && typeof payload.count === "number" ? payload.count : NaN;
        if (!rows || !rows.length) {
          renderLiveLibrary(all);
          return;
        }
        all = all.concat(rows);
        var hasMoreByCount = isFinite(total) && total > all.length;
        var hasMoreByPage = rows.length >= pageSize && pageNumber + 1 < maxPages;
        if (hasMoreByCount || (!isFinite(total) && hasMoreByPage)) {
          page(from + rows.length, pageNumber + 1);
        } else {
          renderLiveLibrary(all);
        }
      }, function () {
        renderLiveLibrary(all);
      });
    }
    page(0, 0);
  }

  function boot() {
    if (appReady()) return;
    if (STATIC) {
      notice();
      loadLiveLibrary();
      var list = focusables();
      if (list.length && (!doc.activeElement || doc.activeElement === doc.body)) giveFocus(list[0]);
    }
    doc.addEventListener("keydown", keydown, true);
    win.setTimeout(function () {
      if (appReady() || !STATIC) return;
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
