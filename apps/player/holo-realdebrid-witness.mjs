#!/usr/bin/env node
// holo-realdebrid-witness.mjs — proves the Real-Debrid client + resolver: a hoster link or a (cached)
// torrent infoHash becomes an instant direct HTTPS stream; the right file is picked; uncached is reported
// honestly (pending); a dead torrent fails closed; the token validates. Fake RD, no network, no token.
//
// Checks:
//   1 tokenValidate   — user() hits /user and returns the account.
//   2 unrestrictLink  — a hoster link → instant httpDirect download URL.
//   3 magnetCached    — an infoHash that's cached → addMagnet→select→info(downloaded)→unrestrict→httpDirect.
//   4 picksFile       — fileIdx selects the matching link.
//   5 magnetUncached  — an infoHash still downloading → { pending:true } (no fake stream).
//   6 deadTorrent     — status magnet_error → null (fail closed).
//
// node holo-realdebrid-witness.mjs   (from holo-apps/apps/player/)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRealDebrid, resolveStream } from "./holo-realdebrid.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── fake Real-Debrid (routes by method+path) ─────────────────────────────────────────────────────────────
const DL = (name) => ({ download: "https://x.rdeb.io/" + name, filename: name, filesize: 123 });
const make = (script) => async (url, opts = {}) => {
  const m = (opts.method || "GET") + " " + url.replace(API, "");
  const body = opts.body || "";
  const r = script(m, body);
  return { ok: r.ok !== false, status: r.status || 200, json: async () => r.json || {} };
};
const API = "https://api.real-debrid.com/rest/1.0";

// 1 + 2 — token + hoster unrestrict
{
  const rd = createRealDebrid({ token: "t", fetch: make((m) => {
    if (m === "GET /user") return { json: { username: "ilya", premium: 1 } };
    if (m === "POST /unrestrict/link") return { json: DL("Movie.2024.1080p.mp4") };
    return { ok: false, status: 404 };
  }) });
  const u = await rd.user();
  ok("tokenValidate", u.username === "ilya" && u.premium === 1, JSON.stringify(u));
  const s = await resolveStream(rd, { url: "https://hoster.example/file" });
  ok("unrestrictLink", s && s.httpDirect && /rdeb\.io\/Movie/.test(s.playSrc) && s.type === "video/mp4" && /Real-Debrid/.test(s.provenance.label), JSON.stringify(s && s.playSrc));
}
// 3 + 4 — cached magnet, pick file index 1 (1-based "2")
{
  let selected = null;
  const rd = createRealDebrid({ token: "t", fetch: make((m, body) => {
    if (m === "POST /torrents/addMagnet") return { json: { id: "T1" } };
    if (m === "POST /torrents/selectFiles/T1") { selected = body; return { status: 204 }; }
    if (m === "GET /torrents/info/T1") return { json: { status: "downloaded", links: ["L0", "L1", "L2"] } };
    if (m === "POST /unrestrict/link") return { json: DL(decodeURIComponent(body).includes("L1") ? "S01E02.mkv" : "other.mkv") };
    return { ok: false, status: 404 };
  }) });
  const s = await resolveStream(rd, { infoHash: "abc123", fileIdx: 1, quality: 2160, label: "4K" }, { sleep: async () => {} });
  ok("magnetCached", s && s.httpDirect && s.cached === true && /rdeb\.io/.test(s.playSrc), JSON.stringify(s && [s.playSrc, s.cached]));
  ok("picksFile", selected === "files=2" && /S01E02/.test(s.filename || ""), JSON.stringify({ selected, file: s && s.filename }));
}
// 5 — uncached (always "downloading") → pending
{
  const rd = createRealDebrid({ token: "t", fetch: make((m) => {
    if (m === "POST /torrents/addMagnet") return { json: { id: "T2" } };
    if (m === "POST /torrents/selectFiles/T2") return { status: 204 };
    if (m === "GET /torrents/info/T2") return { json: { status: "downloading", links: [] } };
    return { ok: false, status: 404 };
  }) });
  const s = await resolveStream(rd, { infoHash: "uncached" }, { sleep: async () => {}, tries: 3 });
  ok("magnetUncached", s && s.pending === true && !s.playSrc, JSON.stringify(s));
}
// 6 — dead torrent → null
{
  const rd = createRealDebrid({ token: "t", fetch: make((m) => {
    if (m === "POST /torrents/addMagnet") return { json: { id: "T3" } };
    if (m === "POST /torrents/selectFiles/T3") return { status: 204 };
    if (m === "GET /torrents/info/T3") return { json: { status: "magnet_error", links: [] } };
    return { ok: false, status: 404 };
  }) });
  const s = await resolveStream(rd, { infoHash: "dead" }, { sleep: async () => {} });
  ok("deadTorrent", s === null, JSON.stringify(s));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-realdebrid — the user's Real-Debrid account turns a Stremio addon's torrent infoHash (or a hoster link) into an INSTANT, cached, direct HTTPS stream (addMagnet→selectFiles→info→unrestrict); the right file is picked; uncached content is reported honestly (pending), dead torrents fail closed, the token validates. RD is the user's paid backend; nothing is bundled.",
  authority: "rests on #holo-realdebrid — Phase 1 of the Stremio+RD+Jellyfin plan",
  witnessed,
  covers: witnessed ? ["token-validate", "unrestrict-link", "magnet-cached", "picks-file", "magnet-uncached", "dead-torrent"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-realdebrid-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-realdebrid witness — infoHash → instant cached HTTPS stream (the missing link)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the catalogue actually streams — instant, high-quality, honest" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
