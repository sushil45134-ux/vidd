#!/usr/bin/env node
/**
 * Offline logic tests for MovieBox helpers (no network needed).
 * Run: node scripts/moviebox.test.mjs
 *
 * Do jagah ka logic test hota hai:
 *  - scripts/moviebox-probe.mjs ke standalone JS helpers
 *  - src/lib/moviebox.ts ke app helpers (Node ka type-stripping lagega;
 *    na mile to wo hissa skip ho jata hai, fail nahi)
 */
import assert from "node:assert";
import crypto from "node:crypto";
import {
  clientToken,
  manifestUrlFromSignCookie,
  normalizeStreams,
  parseMovieboxUrl,
} from "./moviebox-probe.mjs";

let passed = 0;
function ok(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(
        () => {
          passed++;
          console.log(`✅ ${name}`);
        },
        (e) => {
          console.error(`❌ ${name}: ${e.message}`);
          process.exitCode = 1;
        },
      );
    }
    passed++;
    console.log(`✅ ${name}`);
  } catch (e) {
    console.error(`❌ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
  return Promise.resolve();
}

const M2BOX =
  "https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail&detailSe=&detailEp=&lang=en";
const PLAYER =
  "https://mzfi.me/spa/videoPlayPage/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail&detailSe=1&detailEp=3&lang=en";

await ok("parse m2box watch link (user wali link)", () => {
  const r = parseMovieboxUrl(M2BOX);
  assert.equal(r.subjectId, "8598850449111924848");
  assert.equal(r.detailPath, "my-demon-hindi-SfaaEeePcfa");
  assert.equal(r.se, undefined); // detailSe khali hai
  assert.equal(r.ep, undefined);
});

await ok("parse spa videoPlayPage link", () => {
  const r = parseMovieboxUrl(PLAYER);
  assert.equal(r.subjectId, "8598850449111924848");
  assert.equal(r.detailPath, "my-demon-hindi-SfaaEeePcfa");
  assert.equal(r.se, 1);
  assert.equal(r.ep, 3);
});

await ok("parse bare detailPath / subjectId", () => {
  assert.equal(
    parseMovieboxUrl("my-demon-hindi-SfaaEeePcfa").detailPath,
    "my-demon-hindi-SfaaEeePcfa",
  );
  assert.equal(parseMovieboxUrl("8598850449111924848").subjectId, "8598850449111924848");
  assert.equal(parseMovieboxUrl("https://example.com/watch?v=abc"), null);
});

await ok("X-Client-Token = sec,md5(reverse(sec))", () => {
  const t = clientToken(1789185091000);
  const [sec, hash] = t.split(",");
  assert.equal(sec, "1789185091");
  const expected = crypto.createHash("md5").update(sec.split("").reverse().join("")).digest("hex");
  assert.equal(hash, expected);
});

await ok("signCookie urlprefix → manifest", () => {
  const cookie = "CloudFront-Policy=xyz; urlprefix=https%3A%2F%2Fcdn.example.com%2Fv%2F9%2F";
  assert.equal(manifestUrlFromSignCookie(cookie, "hls"), "https://cdn.example.com/v/9/index.m3u8");
  assert.equal(manifestUrlFromSignCookie(cookie, "dash"), "https://cdn.example.com/v/9/index.mpd");
  assert.equal(manifestUrlFromSignCookie("nothing=here", "hls"), null);
  assert.equal(manifestUrlFromSignCookie("", "hls"), null);
});

await ok("normalizeStreams: play/download response roop", () => {
  // Upstream /subject/play ka asal shape (faisal/kelvin code + live khali
  // response se verify): streams[].resolutions string hoti hai.
  const play = normalizeStreams({
    streams: [
      {
        id: "1",
        format: "MP4",
        url: "https://cdn.example.com/v-720.mp4",
        resolutions: "720",
        size: "734003200",
        duration: 3900,
        codecName: "h264",
      },
      {
        id: "2",
        format: "MP4",
        url: "https://cdn.example.com/v-1080.mp4",
        resolutions: "1080",
        size: "1500000000",
        codecName: "hevc",
      },
      { id: "3", format: "MP4", url: "", resolutions: "360" },
    ],
    hls: [],
    dash: [],
  });
  assert.equal(play.length, 2); // khali url wala drop
  assert.equal(play[0].resolution, 1080); // best pehle
  assert.equal(play[0].kind, "mp4");
  assert.equal(play[1].sizeMB, 734);

  // /subject/download wala roop: downloads[].resolution number, 1080 vipLocked.
  const dl = normalizeStreams({
    downloads: [
      { url: "https://cdn.example.com/d-480.mp4", resolution: 480 },
      { url: "", resolution: 1080, vipLocked: true },
    ],
  });
  assert.equal(dl.length, 1);
  assert.equal(dl[0].resolution, 480);

  // Khali hasResource:false wala jawab (bina Referer ke yahi milta hai).
  assert.deepEqual(normalizeStreams({ streams: [], dash: [], hls: [], hasResource: false }), []);
});

/* ── app helpers (src/lib/moviebox.ts) — type-stripping mile tabhi ── */
let lib = null;
try {
  lib = await import("../src/lib/moviebox.ts");
} catch {
  console.log(
    "⚠️ src/lib/moviebox.ts import nahi hua (Node type-stripping unavailable) — app-helper tests skip",
  );
}

if (lib) {
  await ok("lib: md5Hex RFC 1321 vectors", () => {
    assert.equal(lib.md5Hex(""), "d41d8cd98f00b204e9800998ecf8427e");
    assert.equal(lib.md5Hex("abc"), "900150983cd24fb0d6963f7d28e17f72");
    assert.equal(
      lib.md5Hex("The quick brown fox jumps over the lazy dog"),
      "9e107d9d372bb6826bd81d3542a419d6",
    );
    for (const s of ["1789185091", "x".repeat(200), "हिंदी मूवी"]) {
      assert.equal(lib.md5Hex(s), crypto.createHash("md5").update(s).digest("hex"));
    }
  });

  await ok("lib: parse + isMovieboxUrl", () => {
    const r = lib.parseMovieboxInput(M2BOX);
    assert.equal(r.subjectId, "8598850449111924848");
    assert.equal(r.detailPath, "my-demon-hindi-SfaaEeePcfa");
    assert.equal(lib.isMovieboxUrl(M2BOX), true);
    assert.equal(lib.isMovieboxUrl(PLAYER), true);
    assert.equal(lib.isMovieboxUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), false);
    assert.equal(lib.isMovieboxUrl("https://nxsha.space/embed/tv/312949/1/1"), false);
    assert.equal(lib.isMovieboxUrl("/api/moviebox?detailPath=x-y12345678"), false);
  });

  await ok("lib: resolver URL (row ke s/e link par jeette hain)", () => {
    assert.equal(
      lib.buildMovieboxResolverUrl(PLAYER, { se: 2, ep: 5 }),
      "/api/moviebox?subjectId=8598850449111924848&detailPath=my-demon-hindi-SfaaEeePcfa&se=2&ep=5",
    );
    assert.equal(
      lib.buildMovieboxResolverUrl(M2BOX, {}),
      "/api/moviebox?subjectId=8598850449111924848&detailPath=my-demon-hindi-SfaaEeePcfa",
    );
    assert.equal(lib.buildMovieboxResolverUrl("https://example.com/x"), null);
  });

  await ok("lib: full watch-page URL (screenshot wala /movies format)", () => {
    assert.equal(
      lib.buildMovieboxPageUrl(M2BOX, { se: 1, ep: 2 }),
      "https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail&detailSe=1&detailEp=2&lang=en",
    );
    // Player-domain (spa) link bhi canonical m2box page me badle
    assert.equal(
      lib.buildMovieboxPageUrl(PLAYER, {}),
      "https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail&detailSe=1&detailEp=3&lang=en",
    );
    // se/ep na ho to khali chhoro — site pehla episode khud kholta hai
    assert.equal(
      lib.buildMovieboxPageUrl(M2BOX, {}),
      "https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail&detailSe=&detailEp=&lang=en",
    );
    assert.equal(lib.buildMovieboxPageUrl("not-a-url"), null);
  });

  await ok("lib: sirf-player crop nap-tol (fixed stage)", () => {
    const desktop = lib.getMovieboxCrop(1920, 900);
    assert.equal(desktop.stageWidth, 1536); // iframe fixed stage par (chhota 5-col guide)
    assert.equal(desktop.cropLeft, lib.MOVIEBOX_STAGE_CROP_LEFT); // sidebar kata
    assert.equal(desktop.stageVisibleWidth, 1300); // 1536 - 236
    assert.equal(desktop.scale, 1920 / 1300);
    assert.equal(desktop.cropTop, lib.MOVIEBOX_STAGE_CROP_TOP); // header+menu kata
    assert.equal(desktop.stacked, false);
    // Dikhne wala hissa = stage ka 545 x scale — player ke just neeche khatm
    assert.equal(desktop.height, Math.round(lib.MOVIEBOX_STAGE_VISIBLE_HEIGHT * (1920 / 1300)));
    const mobile = lib.getMovieboxCrop(390, 700);
    assert.equal(mobile.stacked, true);
    assert.ok(mobile.height > 450, `mobile height ${mobile.height}`); // player + episode grid
    const capped = lib.getMovieboxCrop(1360, 300);
    assert.equal(capped.height, 300); // screen se bada kabhi nahi
  });

  await ok("lib: player page URL (Referer wala exact format)", () => {
    assert.equal(
      lib.buildMovieboxPlayerPageUrl(
        "https://mzfi.me/",
        "my-demon-hindi-SfaaEeePcfa",
        "8598850449111924848",
        1,
        3,
      ),
      "https://mzfi.me/spa/videoPlayPage/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail&detailSe=1&detailEp=3&lang=en",
    );
  });
}

console.log(`\n${passed} tests passed${process.exitCode ? " (UPAR FAILURES HAIN)" : ""}`);
