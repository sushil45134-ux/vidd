# AniRoll UI on vid

The home page `/` redirects (307) to the AniRoll UI, so the site opens as AniRoll.

The AniRoll anime UI (originally `UI Demo.html` in `sushil45134-ux/anime`) is
hosted inside vid at **`/aniroll`**, with vid's own data and playback behind it.
The look, layout, and interactions are the original; only the data layer changed.

## Where things live

| Piece | File |
| --- | --- |
| Static UI (markup + CSS from the demo, minus the 24 MB embedded artwork) | `public/aniroll/index.html` |
| UI behaviour (replaces the demo's hard-coded catalogue) | `public/aniroll/app.js` |
| Small additions (embed frame, fallbacks) | `public/aniroll/aniroll-extra.css` |
| hls.js for HLS playback (v1.7.3, MIT) | `public/aniroll/vendor/hls.min.js` |
| Catalogue bridge: one JSON endpoint for the UI | `src/routes/api/aniroll.ts` → `GET /api/aniroll` |
| Pretty URL redirect | `src/routes/aniroll.ts` |

## Data sources (same connections vid already uses)

- **Library** — Supabase `movies` table, read through `/api/movies`. Playlist rows
  become series (sorted by season/episode), standalone rows become movies.
  Nxsha Doraemon/Shinchan films resolve to ToonStream, as in `moviesRepo`.
- **Anime** — official Hindi-dub YouTube feeds through `/api/anime`, grouped into
  series with `episodesToMovies`. Falls back to the bundled seed when the feeds are
  unreachable.
- **Playback** — YouTube episodes play in an embedded YouTube player. Embed and
  ToonStream sources go through `/api/extract` and `/api/toonstream`, and HLS goes
  through `/api/hlsproxy`. If extraction fails, the embed plays in an iframe.

## Local-only state (per browser)

Watchlist, favourites, continue-watching progress and the guest profile are kept in
`localStorage` under the `aniroll.*` keys. Requests and comments are session-only, as
in the original demo.

## Run

```sh
npm ci
npm run dev   # open http://localhost:3000/aniroll
```
