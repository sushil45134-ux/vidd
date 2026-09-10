/* vid — minimal PWA service worker.
 *
 * Goals (kept deliberately simple and safe for an SSR app):
 *  - Make the app installable (Android/Chrome require a SW with a fetch handler).
 *  - Serve the app shell offline when possible (network-first for pages).
 *  - Never cache API/Supabase traffic — always live.
 */

const VERSION = "vid-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => {}) // partial install is fine — don't block activation
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isImmutableAsset(url) {
  // Vite emits hashed build assets (e.g. /assets/name-HASH.js) — cache forever.
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/manifest.webmanifest"
  );
}

function isLiveOnly(url) {
  // Third-party data/API traffic must always be live. The app's own origin is
  // NOT excluded — navigations are network-first, so content is never stale.
  return (
    url.pathname.startsWith("/api/") ||
    (url.hostname.endsWith("supabase.co") &&
      url.hostname !== self.location.hostname) ||
    url.hostname.endsWith("youtube.com") ||
    url.hostname.endsWith("ytimg.com")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (!url.protocol.startsWith("http")) return;
  if (isLiveOnly(url)) return; // always hit the network

  // Immutable static assets: cache-first.
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // Navigations (pages): network-first, fall back to cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match("/")) ||
            new Response("You are offline", {
              status: 503,
              headers: { "content-type": "text/plain" },
            })
          );
        }
      })()
    );
  }
});
