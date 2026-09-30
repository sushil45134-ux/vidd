#!/usr/bin/env node
/**
 * Offline tests for Vidd's own-player source routing (src/lib/mediaSource.ts).
 * No network, no browser download.
 *
 * What these pin down:
 *   - which URLs Vidd can play ITSELF (and therefore fullscreen with zero
 *     clicks) versus which have to stay in a third-party iframe
 *   - query strings and fragments never break the decision
 *   - an uploaded file always wins over an embed page
 *   - provider embed pages (Nxsha, Drive, MEGA, YouTube…) are never
 *     mistaken for playable media
 *
 * Run: node --experimental-strip-types scripts/vidd-player.test.mjs
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(here, "../src/lib/mediaSource.ts");

const { isHlsUrl, isDashUrl, isDirectMediaUrl, pickDirectSource, levelLabel, trackLabel } =
  await import(modulePath);

/* ------------------------------------------------------------------ *
 * Tiny runner
 * ------------------------------------------------------------------ */

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message.split("\n")[0]}`);
  }
}

console.log("\nVidd player — media source routing\n");

/* ------------------------------------------------------------------ *
 * Playable by Vidd itself
 * ------------------------------------------------------------------ */

test("mp4 file is playable by Vidd", () => {
  assert.equal(isDirectMediaUrl("https://cdn.example.com/ep1.mp4"), true);
});

test("webm / mkv / mov are playable", () => {
  for (const ext of ["webm", "mkv", "mov", "m4v", "ogv"]) {
    assert.equal(isDirectMediaUrl(`https://cdn.example.com/a.${ext}`), true, ext);
  }
});

test("HLS manifest is playable", () => {
  assert.equal(isHlsUrl("https://cdn.example.com/master.m3u8"), true);
  assert.equal(isDirectMediaUrl("https://cdn.example.com/master.m3u8"), true);
});

test("HLS with a query string and token still detected", () => {
  const url = "https://cdn.example.com/hls/master.m3u8?token=abc123&expires=999";
  assert.equal(isHlsUrl(url), true);
  assert.equal(isDirectMediaUrl(url), true);
});

test("extension check ignores the query string, not just the tail", () => {
  // A .mp4 in a query param must NOT make an embed page look playable.
  assert.equal(isDirectMediaUrl("https://nxsha.space/embed/tv/1?file=x.mp4"), false);
});

test("uppercase extensions are accepted", () => {
  assert.equal(isDirectMediaUrl("https://cdn.example.com/EP1.MP4"), true);
});

test("fresh upload blob: URL is playable", () => {
  assert.equal(isDirectMediaUrl("blob:https://vidd.app/9f1c-4a2b"), true);
});

test("blob: is never treated as HLS", () => {
  assert.equal(isHlsUrl("blob:https://vidd.app/9f1c-4a2b"), false);
});

test("DASH manifest is recognised separately", () => {
  assert.equal(isDashUrl("https://cdn.example.com/manifest.mpd"), true);
  assert.equal(isHlsUrl("https://cdn.example.com/manifest.mpd"), false);
});

/* ------------------------------------------------------------------ *
 * Must stay in the iframe
 * ------------------------------------------------------------------ */

test("Nxsha embed page is NOT playable by Vidd", () => {
  const url = "https://nxsha.space/embed/tv/1399/1/1?lang=hi&server=GbruHindi&one_server=true";
  assert.equal(isDirectMediaUrl(url), false);
});

test("Google Drive / MEGA embed pages are NOT playable by Vidd", () => {
  assert.equal(isDirectMediaUrl("https://drive.google.com/file/d/ABC/preview"), false);
  assert.equal(isDirectMediaUrl("https://mega.nz/embed/ABC#key"), false);
});

test("YouTube and generic pages are NOT playable by Vidd", () => {
  assert.equal(isDirectMediaUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), false);
  assert.equal(isDirectMediaUrl("https://example.com/player"), false);
});

test("empty / missing input is not playable", () => {
  assert.equal(isDirectMediaUrl(undefined), false);
  assert.equal(isDirectMediaUrl(null), false);
  assert.equal(isDirectMediaUrl(""), false);
  assert.equal(isDirectMediaUrl("   "), false);
});

/* ------------------------------------------------------------------ *
 * Source picking
 * ------------------------------------------------------------------ */

test("an uploaded file beats an embed page", () => {
  const picked = pickDirectSource({
    videoUrl: "https://cdn.example.com/ep1.mp4",
    embedUrl: "https://nxsha.space/embed/tv/1399/1/1",
  });
  assert.equal(picked, "https://cdn.example.com/ep1.mp4");
});

test("a stream pasted into embedUrl is still picked up", () => {
  const picked = pickDirectSource({ embedUrl: "https://cdn.example.com/master.m3u8" });
  assert.equal(picked, "https://cdn.example.com/master.m3u8");
});

test("embed-only titles fall through to the iframe player", () => {
  const picked = pickDirectSource({
    embedUrl: "https://nxsha.space/embed/tv/1399/1/1?lang=hi",
  });
  assert.equal(picked, null);
});

test("a title with nothing on file picks nothing", () => {
  assert.equal(pickDirectSource({}), null);
});

/* ------------------------------------------------------------------ *
 * Labels shown in the menus
 * ------------------------------------------------------------------ */

test("quality labels prefer height, then name, then bitrate", () => {
  assert.equal(levelLabel({ height: 1080 }, 0), "1080p");
  assert.equal(levelLabel({ name: "HD" }, 0), "HD");
  assert.equal(levelLabel({ bitrate: 2_500_000 }, 0), "2500 kbps");
  assert.equal(levelLabel({}, 2), "Level 3");
});

test("track labels prefer name, then language, then index", () => {
  assert.equal(trackLabel({ name: "Hindi" }, 0), "Hindi");
  assert.equal(trackLabel({ lang: "en" }, 0), "en");
  assert.equal(trackLabel({}, 1), "Track 2");
});

/* ------------------------------------------------------------------ */

console.log(`\n${passed} passed, ${failures.length} failed (${passed + failures.length} total)\n`);

if (failures.length > 0) {
  for (const { name, err } of failures) {
    console.error(`\n✗ ${name}\n${err.stack}`);
  }
  process.exit(1);
}
