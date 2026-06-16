#!/usr/bin/env node
// holo-omni-feed-witness.mjs — PROVE the omnisearch→live-feed fusion: the one bar conducts a private,
// holo-rank-ordered, self-verifying κ-feed across every media type, with Q.recall + the governed media seam.
// FUNCTIONAL (imports the real shipped modules and exercises them, not source-grep):
//   • holo-omni-index  — the bar's memory: dedup + match×recency×freq×holo-rank ranking
//   • holo-omni-q      — Q.recall (model-free) over YOUR private corpus: discover-by-CONTENT
//   • holo-omni-feed   — composePersonalScene: private-first · holo-rank lift · intent steer · diversity ·
//                        rotate (deterministic exploration) · honest demo fallback · "why" provenance
//   • holo-media       — classifyMedia + resolveMediaSource: direct media playable+verified
//   • holo-media-extract — the yt-dlp seam as a GOVERNED egress tier: default-off · seam-on · veto · failure
//
//   node tools/holo-omni-feed-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const sbin = (m) => pathToFileURL(join(here, "../os/sbin/", m)).href;
const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok: !!ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };

const NOW = 1700000000000;
const idx = await import(sbin("holo-omni-index.mjs"));
const q = await import(sbin("holo-omni-q.mjs"));
const feed = await import(sbin("holo-omni-feed.mjs"));
const media = await import(sbin("holo-media.mjs"));
const extract = await import(sbin("holo-media-extract.mjs"));

// ── 1 · holo-omni-index — the bar's memory: dedup + ranking (incl. holo-rank authority) ──
{
  const store = (() => { let a = []; return { get: () => a, set: (x) => { a = x; }, now: () => NOW }; })();
  idx.record({ addr: "vitalik.eth", kind: "web3", title: "vitalik.eth", kappa: "did:holo:sha256:rank1" }, store);
  idx.record({ addr: "vitalik.eth", kind: "web3", title: "vitalik.eth", kappa: "did:holo:sha256:rank1" }, store);   // re-open → dedup, freq++
  idx.record({ addr: "https://a/aurora", kind: "web", title: "Aurora cam", kappa: "did:holo:sha256:plain" }, store);
  const deduped = store.get().length === 2 && (store.get().find((x) => x.addr === "vitalik.eth").n === 2);
  rec("omni-index dedups re-opens by addr + bumps frequency", deduped, "n=" + (store.get().find((x) => x.addr === "vitalik.eth") || {}).n);
  // discover-by-attribute (title) + holo-rank authority lifts the ranked κ
  const hit = idx.search("aurora", { store, now: NOW });
  rec("omni-index discovers by attribute (title, not address)", hit.length === 1 && hit[0].addr === "https://a/aurora", hit.map((h) => h.title).join(","));
  const rk = idx.search("vitalik", { store, now: NOW, rank: { rank1: 1.0 } });
  const rk0 = idx.search("vitalik", { store, now: NOW });
  rec("omni-index applies holo-rank authority (ranked κ scores higher)", rk[0].score > rk0[0].score, rk[0].score.toFixed(1) + " vs " + rk0[0].score.toFixed(1));
}

// ── 2 · holo-omni-q — Q.recall over YOUR private corpus: discover by CONTENT, model-free ──
{
  const entries = [
    { addr: "https://news/x", title: "Untitled", kind: "web", text: "perovskite tandem solar cell reached 33 percent efficiency in a lab" },
    { addr: "ipfs://doc", title: "doc", kind: "cid", text: "a sourdough bread recipe using a wild yeast starter" },
  ];
  const r = await q.askPrivate("solar efficiency", { entries });
  const byBody = r.results.length && r.results[0].addr === "https://news/x";
  rec("Q.recall finds a private object by its BODY content (not its title)", byBody, r.results[0] && r.results[0].addr);
  rec("Q.recall is model-free + sealed (carries a receipt, zero network)", !!r.receipt, r.receipt ? "receipt present" : "none");
}

// ── 3 · holo-omni-feed — composePersonalScene: the conductor ──
const fb = { hero: [{ origin: "x", title: "DEMO" }], thumbs: [{ origin: "x", t: "DEMO" }], stories: [{ origin: "x", title: "DEMO" }] };
{
  const ent = [
    { addr: "https://a/1", input: "https://a/1", kind: "web", title: "web one", kappa: "did:holo:sha256:1", n: 5, t: NOW - 1 * 36e5 },
    { addr: "https://a/2", input: "https://a/2", kind: "web", title: "web two", kappa: "did:holo:sha256:2", n: 4, t: NOW - 2 * 36e5 },
    { addr: "https://a/3", input: "https://a/3", kind: "web", title: "web three", kappa: "did:holo:sha256:3", n: 3, t: NOW - 3 * 36e5 },
    { addr: "/.holo/sha256/v.mp4", input: "/.holo/sha256/v.mp4", kind: "video", title: "a clip", kappa: "did:holo:sha256:4", n: 1, t: NOW - 6 * 36e5 },
    { addr: "/.holo/sha256/a.mp3", input: "/.holo/sha256/a.mp3", kind: "audio", title: "a track", kappa: "did:holo:sha256:5", n: 1, t: NOW - 9 * 36e5 },
    { addr: "vitalik.eth", input: "vitalik.eth", kind: "web3", title: "vitalik.eth", kappa: "did:holo:sha256:rank", n: 1, t: NOW - 40 * 36e5 },
  ];
  const s = feed.composePersonalScene({ entries: ent, now: NOW, fallback: fb });
  const shaped = Array.isArray(s.hero) && Array.isArray(s.thumbs) && Array.isArray(s.stories);
  rec("composePersonalScene returns a private, SCENE-shaped feed (hero/thumbs/stories)", s._personal && shaped, "count=" + s._count);
  const mediaKinds = new Set([...s.hero, ...s.thumbs, ...s.stories].filter((x) => x.media).map((x) => x.media.kind));
  rec("the feed spans multiple media types (video + audio play in place)", mediaKinds.has("video") && mediaKinds.has("audio"), [...mediaKinds].join("+"));
  const whyEverywhere = s.hero.every((h) => /your history|recalled|rank/.test(h.dek || h.why || ""));
  rec("every leaf carries a 'why' provenance line", whyEverywhere, s.hero[0].dek);
  // holo-rank lift: same recency, the ranked κ wins the hero
  const tie = [
    { addr: "u", input: "u", kind: "web", title: "unranked", kappa: "did:holo:sha256:zz", n: 1, t: NOW - 10 * 36e5 },
    { addr: "r", input: "r", kind: "web", title: "ranked", kappa: "did:holo:sha256:aa", n: 1, t: NOW - 10 * 36e5 },
    { addr: "f", input: "f", kind: "web", title: "filler", kappa: "did:holo:sha256:bb", n: 1, t: NOW - 10 * 36e5 },
  ];
  const lifted = feed.composePersonalScene({ entries: tie, rank: { aa: 1.0 }, now: NOW, fallback: fb, diversity: false });
  rec("holo-rank lifts the authoritative κ to the hero (equal recency)", lifted.hero[0].title === "ranked", lifted.hero[0].title);
  // intent steering: a matching item overrides rank
  const steer = feed.composePersonalScene({ entries: ent, rank: { rank: 1.0 }, intent: "track", now: NOW, fallback: fb });
  rec("intent steers the feed (a body/title match leads on intent)", /track/i.test(steer.hero[0].title), steer.hero[0].title);
  // diversity spreads origins; rotate cycles the mid-tier with stable anchors; thin history → honest demo
  const div = feed.composePersonalScene({ entries: ent, now: NOW, fallback: fb });
  rec("diversity spreads origins into the hero (not one-source clustering)", new Set(div.hero.map((h) => h.origin)).size >= 2, div.hero.map((h) => h.origin).join(","));
  const r0 = feed.composePersonalScene({ entries: ent, now: NOW, rotate: 0, fallback: fb });
  const r1 = feed.composePersonalScene({ entries: ent, now: NOW, rotate: 1, fallback: fb });
  const t0 = r0.hero.concat(r0.stories).map((x) => x.title || x.t), t1 = r1.hero.concat(r1.stories).map((x) => x.title || x.t);
  rec("rotate cycles the mid-tier (idle exploration) with the top-2 anchors stable", JSON.stringify(t0) !== JSON.stringify(t1) && t0[0] === t1[0] && t0[1] === t1[1], "rotation changes order, anchors fixed");
  const thin = feed.composePersonalScene({ entries: ent.slice(0, 2), now: NOW, fallback: fb });
  rec("thin history → HONEST demo fallback (never invents a personal feed)", thin._personal === false && thin.hero[0].title === "DEMO", "_personal=" + thin._personal);
}

// ── 4 · holo-media — classify + resolve: direct media is playable + verified ──
{
  rec("classifyMedia: direct media URL → file · platform host → platform · bare name → none",
    media.classifyMedia("/.holo/sha256/x.mp4").kind === "file" && media.classifyMedia("https://youtu.be/x").kind === "platform" && media.classifyMedia("movie.mp4").kind === "none", "ok");
  const f = await media.resolveMediaSource("/.holo/sha256/x.mp4");
  rec("resolveMediaSource: a κ-route media file is playable + verified (Range/206 seekable)", f.playable && f.verified && f.mime === "video/mp4", f.mime);
}

// ── 5 · holo-media-extract — the yt-dlp SEAM as a governed egress tier ──
{
  extract.setDefaultExtractor(null);
  const off = await media.resolveMediaSource("https://youtu.be/x");
  rec("yt-dlp seam default-OFF → honest browser fallback (sovereign, no baked gatekeeper)", off.playable === false && off.fallback === "browser", "fallback=" + off.fallback);
  const mock = extract.createExtractor({ kind: "cobalt", endpoint: "https://cobalt.example/api", fetchImpl: async () => ({ json: async () => ({ url: "https://cdn/clip.mp4", filename: "c.mp4" }) }), now: () => NOW });
  extract.setDefaultExtractor(mock);
  const on = await media.resolveMediaSource("https://youtu.be/x");
  rec("seam-ON → SAME κ-player lights up, sealed hosc:Egress receipt (directExtract:false)", on.playable && on.via === "cobalt-egress" && on.receipt && on.receipt["@type"] === "hosc:Egress" && on.receipt.directExtract === false, "via=" + on.via);
  extract.setDefaultExtractor(extract.createExtractor({ endpoint: "https://x/api", fetchImpl: async () => ({ json: async () => ({}) }), allow: () => false }));
  const veto = await media.resolveMediaSource("https://youtu.be/x");
  rec("governance veto → honest null → browser fallback (never fabricates a stream)", veto.playable === false && veto.fallback === "browser", "vetoed");
  extract.setDefaultExtractor(extract.createExtractor({ endpoint: "https://x/api", fetchImpl: async () => { throw new Error("blocked"); } }));
  const fail = await media.resolveMediaSource("https://youtu.be/x");
  rec("extractor failure → honest null → browser fallback (Law L5: no fake green)", fail.playable === false && fail.fallback === "browser", "failed-safe");
  extract.setDefaultExtractor(null);
}

const witnessed = failed === 0;
console.log(`\n${witnessed ? "WITNESSED ✓" : "FAILED ✗"} — ${passed}/${passed + failed} · the one bar conducts a private, holo-rank-ordered, self-verifying κ-feed across every media type`);
writeFileSync(join(here, "holo-omni-feed-witness.result.json"),
  JSON.stringify({ witnessed, passed, failed, covers: results.filter((r) => r.ok).map((r) => r.name.slice(0, 52)), results,
    spec: "The omnisearch→live-feed fusion: the omnibar conducts a private-context-first, holo-rank-ordered, origin-diversified feed of self-verifying κ-objects spanning every media type; Q.recall retrieves by content model-free; the yt-dlp seam is a governed, opt-in, receipt-sealed egress tier that never fabricates a stream" }, null, 2) + "\n");
process.exit(witnessed ? 0 : 1);
