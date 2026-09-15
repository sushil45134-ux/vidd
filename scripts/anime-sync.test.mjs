#!/usr/bin/env node
/**
 * Offline logic tests for anime-sync.mjs (no network needed).
 * Run: node scripts/anime-sync.test.mjs
 */
import assert from "node:assert";
import {
  parseEmbedTemplate,
  buildEmbed,
  airedCount,
  buildChain,
  pickBest,
  scoreTitleMatch,
  seasonTitleFromRows,
} from "./anime-sync.mjs";

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (e) {
    console.error(`❌ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

/* ── embed template parsing ── */
ok("parse nxsha embed url", () => {
  const t = parseEmbedTemplate(
    "https://nxsha.space/embed/tv/tt13616990/1/4?lang=hi&server=GbruHindi&one_server=true",
  );
  assert.equal(t.imdbId, "tt13616990");
  assert.equal(t.provider, "Nxsha");
  assert.equal(
    t.template,
    "https://nxsha.space/embed/tv/{id}/{s}/{e}?lang=hi&server=GbruHindi&one_server=true",
  );
});

ok("parse nhd embed url", () => {
  const t = parseEmbedTemplate("https://nhdapi.com/tv/tt9335498/2/11");
  assert.equal(t.imdbId, "tt9335498");
  assert.equal(t.provider, "NHD");
  assert.equal(t.template, "https://nhdapi.com/tv/{id}/{s}/{e}");
});

ok("reject non-tv embed url", () => {
  assert.equal(parseEmbedTemplate("https://youtube.com/embed/abc123"), null);
});

ok("buildEmbed substitutes id/s/e", () => {
  const url = buildEmbed("https://nhdapi.com/tv/{id}/{s}/{e}", "tt9335498", 2, 11);
  assert.equal(url, "https://nhdapi.com/tv/tt9335498/2/11");
});

/* ── aired count ── */
ok("airedCount uses nextAiringEpisode", () => {
  const { aired, known } = airedCount({ nextAiringEpisode: { episode: 8, airingAt: 0 } });
  assert.equal(aired, 7);
  assert.equal(known, true);
});

ok("airedCount FINISHED uses episodes", () => {
  const { aired, known } = airedCount({ status: "FINISHED", episodes: 12 });
  assert.equal(aired, 12);
  assert.equal(known, true);
});

ok("airedCount RELEASING w/o nextAiring is unknown", () => {
  const { known } = airedCount({ status: "RELEASING", episodes: 24 });
  assert.equal(known, false);
});

/* ── season chain ── */
ok("buildChain orders prequel → main → sequel", () => {
  const main = {
    id: 2,
    startDate: { year: 2020 },
    relations: {
      edges: [
        { relationType: "PREQUEL" },
        { relationType: "SEQUEL" },
        { relationType: "SIDE_STORY" },
      ],
      nodes: [
        { id: 1, startDate: { year: 2018 } },
        { id: 3, startDate: { year: 2022 } },
        { id: 4, startDate: { year: 2021 } },
      ],
    },
  };
  const chain = buildChain(main);
  assert.deepEqual(
    chain.map((m) => m.id),
    [1, 2, 3],
  );
});

/* ── title matching ── */
ok("scoreTitleMatch exact > contains > partial", () => {
  assert.equal(scoreTitleMatch("Chainsaw Man", "Chainsaw Man"), 100);
  assert.ok(scoreTitleMatch("chainsaw", "Chainsaw Man") >= 80);
  assert.ok(scoreTitleMatch("zzz", "Chainsaw Man") < 30);
});

ok("pickBest prefers exact airing match", () => {
  const best = pickBest("Dandadan", [
    { title: { english: "Dan Da Dan" }, status: "FINISHED" },
    { title: { english: "Dandadan" }, status: "RELEASING", idMal: 1 },
  ]);
  assert.equal(best.title.english, "Dandadan");
});

/* ── season title inference ── */
ok("seasonTitleFromRows strips episode suffix", () => {
  const t = seasonTitleFromRows([{ title: "Chainsaw Man - The Devil Hunter" }], "Chainsaw Man", 1);
  assert.equal(t, "Chainsaw Man");
});

ok("seasonTitleFromRows fallback adds Season N", () => {
  const t = seasonTitleFromRows([{ title: "Something Else" }], "Naruto", 2);
  assert.equal(t, "Naruto Season 2");
});

console.log(`\n${passed} checks passed${process.exitCode ? " (with failures)" : " 🎉"}`);
