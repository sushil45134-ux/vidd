/**
 * Production TV probe.
 *
 * Fetches the deployed site (default https://vidd-zeta.vercel.app) with a
 * Samsung Tizen 5.5 User-Agent and answers the questions that decide whether
 * the TV fix is actually LIVE:
 *
 *   1. Does the served HTML contain the inline TV boot script (data-tv-boot)?
 *   2. Which asset filenames does it reference (so we can tell if the deploy
 *      is stale compared to the current commit)?
 *   3. Does the served stylesheet still contain the legacy
 *      `@supports not (color: color-mix(...))` fallback block?
 *   4. Does the SSR document carry real library rows (poster <img>/<h2>), i.e.
 *      is there something on screen for a browser that never runs the bundle?
 *   5. What do the exact response headers look like (cache-control / age)?
 *
 * Usage:
 *   node scripts/live-tv-probe.mjs [url]
 */
const url = process.argv[2] || "https://vidd-zeta.vercel.app";
const TV_UA =
  "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.5 TV Safari/537.36";

const res = await fetch(url, {
  headers: { "user-agent": TV_UA, accept: "text/html,application/xhtml+xml" },
});
const html = await res.text();

console.log(`== GET ${url}`);
console.log("status:", res.status, res.statusText);
for (const [k, v] of res.headers) console.log(`header ${k}: ${v}`);
console.log("html bytes:", Buffer.byteLength(html));

const count = (re) => (html.match(re) || []).length;
console.log("\n== HTML markers");
console.log("data-tv-boot occurrences:", count(/data-tv-boot/g));
console.log("tv-layout in html class:", /<html[^>]*class="[^"]*tv-layout/.test(html));
console.log("script src list:", JSON.stringify(html.match(/<script[^>]*\bsrc="[^"]+"/g) ?? []));
console.log("stylesheet hrefs:", JSON.stringify(html.match(/<link[^>]*rel="stylesheet"[^>]*>/g) ?? []));
console.log("modulepreload count:", count(/rel="modulepreload"/g));
console.log("inline <script> tags:", count(/<script(?![^>]*\bsrc=)[^>]*>/g));
console.log("ssr rows (h2):", count(/<h2/g), "imgs:", count(/<img/g));
console.log(
  "first visible text:",
  JSON.stringify(
    html
      .slice(html.indexOf("<body"))
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220),
  ),
);

// Follow the stylesheet the TV will actually load.
const cssHref = (html.match(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/) ?? [])[1];
if (cssHref) {
  const cssUrl = new URL(cssHref, url).href;
  const cssRes = await fetch(cssUrl, { headers: { "user-agent": TV_UA } });
  const css = await cssRes.text();
  console.log(`\n== stylesheet ${cssUrl} (${cssRes.status}, ${Buffer.byteLength(css)} bytes)`);
  console.log(
    "legacy @supports-not-color-mix block:",
    /@supports not \(color: color-mix\(in oklab/.test(css),
  );
  console.log("leftover @layer:", (css.match(/@layer/g) || []).length);
  console.log("@keyframes:", (css.match(/@keyframes/g) || []).length);
  console.log(":where( rules:", (css.match(/:where\(/g) || []).length);
  console.log("color-mix( usages:", (css.match(/color-mix\(/g) || []).length);
}

// Which assets does the document reference? Printed so a stale deploy is
// obvious when compared with the newest local build.
const assets = [...new Set(html.match(/\/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g) ?? [])];
console.log("\n== referenced assets (" + assets.length + ")");
console.log(assets.join("\n"));
