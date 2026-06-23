#!/usr/bin/env node
// holo-stream-agent-witness.mjs — proves S6 "just ask": the streaming spine registered as Q tools routes a
// turn to the SAME seams the taps use (window.HoloOpen, window.HoloContinue, the ♥ Share button). Stubs the
// browser seams; asserts each tool reaches its seam, is ungated (navigation runs ambiently), and fails soft.
//
// Checks:
//   1 toolsListed     — play_open · continue_watching · share_current, all low-risk + ungated.
//   2 playOpenRoutes  — invoke play_open{query} → calls window.HoloOpen with that query.
//   3 continueResumes — invoke continue_watching → opens the top window.HoloContinue item.
//   4 shareClicks     — invoke share_current → clicks #share-btn.
//   5 failSoft        — play_open with no query → ok:false; a missing seam → ok:false (never throws).
//
// Authority: rests on #holo-stream-agent + #holo-agent-registry (+ #holo-open S2 / #holo-continue S1).
// node tools/holo-stream-agent-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// stub the browser seams BEFORE importing (the module reads window/document at call time)
const log = { open: [], resume: [], share: 0 };
globalThis.window = {
  HoloOpen: async (ref) => { log.open.push(ref); return "opened:" + ref; },
  HoloContinue: { items: () => [{ addr: "holo://org.holo.notes", kind: "app", title: "Notes" }, { addr: "holo://space/research", kind: "holospace", title: "Research" }], open: async (it) => { log.resume.push(it.title); } },
};
globalThis.document = { getElementById: (id) => (id === "share-btn" ? { click: () => { log.share++; } } : null) };

const A = await import("../os/usr/lib/holo/holo-stream-agent.mjs");

// ── 1 · tools listed ─────────────────────────────────────────────────────────────────────────────────
{
  const tools = A.listTools();
  const names = tools.map((t) => t.name).sort();
  ok("toolsListed", names.join(",") === "continue_watching,play_open,share_current" && tools.every((t) => t.gated === false && t.risk === "low"), JSON.stringify(names));
}
// ── 2 · play_open → HoloOpen ─────────────────────────────────────────────────────────────────────────
{
  const r = await A.invoke("play_open", { query: "holo amp" });
  ok("playOpenRoutes", r.ok === true && log.open[log.open.length - 1] === "holo amp", JSON.stringify({ r, open: log.open }));
}
// ── 3 · continue_watching → resume top recent ────────────────────────────────────────────────────────
{
  const r = await A.invoke("continue_watching", {});
  ok("continueResumes", r.ok === true && r.resumed === "Notes" && log.resume[log.resume.length - 1] === "Notes", JSON.stringify(r));
  // with a query, resume the matching one
  const r2 = await A.invoke("continue_watching", { query: "research" });
  ok("continueResumes", r2.ok === true && r2.resumed === "Research", JSON.stringify(r2));
}
// ── 4 · share_current → click the ♥ Share button ─────────────────────────────────────────────────────
{
  const r = await A.invoke("share_current", {});
  ok("shareClicks", r.ok === true && log.share === 1, JSON.stringify({ r, share: log.share }));
}
// ── 5 · fail-soft ────────────────────────────────────────────────────────────────────────────────────
{
  const noQuery = await A.invoke("play_open", {});
  globalThis.window.HoloOpen = null;
  const noSeam = await A.invoke("play_open", { query: "x" });
  ok("failSoft", noQuery.ok === false && noSeam.ok === false, JSON.stringify({ noQuery, noSeam }));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-stream-agent S6 — 'just ask': the streaming spine (open · continue · share) registered as ungated Q tools that route a spoken/typed turn to the SAME seams the taps use (window.HoloOpen, window.HoloContinue, the ♥ Share button). Navigation runs ambiently; fail-soft on a missing seam. Q reaches the streaming spine through the tool router it already runs.",
  authority: "rests on #holo-stream-agent + #holo-agent-registry (+ #holo-open + #holo-continue)",
  witnessed,
  covers: witnessed ? ["tools-listed", "play-open-routes", "continue-resumes", "share-clicks", "fail-soft"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-stream-agent-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-stream-agent witness — just ask: open · continue · share, through the one spine\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  spoken/typed intents reach the same play/continue/share seams as taps" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
