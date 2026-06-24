#!/usr/bin/env node
// holo-churn-router-witness.mjs — PROVE the full-motion classifier: each region is routed to a raw κ TILE
// (low churn) or a κ video CHUNK (high churn), with hysteretic promote/demote so a paused video goes free and
// nothing flaps. The producer ports this verbatim over its per-slot delta state.
//   • starts as tile; sustained change PROMOTES to vchunk; occasional change stays tile.
//   • a vchunk that goes static DEMOTES back to tile (paused video = free).
//   • hysteresis: a promoted region survives a brief still moment (demoteAfter > 1) — no flapping.
//   • per-slot independent; promotions are reported (each needs a codec keyframe).
//   node tools/holo-churn-router-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeChurnRouter } from "../os/usr/lib/holo/holo-churn-router.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {};

// 1 · a new slot starts as a raw tile
{ const r = makeChurnRouter(); checks.startsAsTile = r.classify("t0_0", true) === "tile" && r.kindOf("t0_0") === "tile"; }

// 2 · sustained change PROMOTES to vchunk at promoteAfter; promotion is reported (needs a keyframe)
{
  const r = makeChurnRouter({ promoteAfter: 4, demoteAfter: 8 });
  let kind; for (let i = 0; i < 4; i++) kind = r.classify("v", true);
  const tr = r.frameTransitions();
  checks.promotesOnSustainedChange = kind === "vchunk" && tr.promoted.includes("v");
}

// 3 · occasional (non-sustained) change stays a tile — the change run resets on a static frame
{
  const r = makeChurnRouter({ promoteAfter: 4, demoteAfter: 8 });
  let kind = "tile";
  for (let i = 0; i < 12; i++) kind = r.classify("ui", i % 3 === 0);   // changes 1-in-3, never 4 in a row
  checks.staysTileIfLowChurn = kind === "tile";
}

// 4 · a vchunk that goes static DEMOTES back to a tile (paused video becomes free)
{
  const r = makeChurnRouter({ promoteAfter: 3, demoteAfter: 5 });
  for (let i = 0; i < 3; i++) r.classify("v", true);                    // → vchunk
  let kind; for (let i = 0; i < 5; i++) kind = r.classify("v", false);  // static for demoteAfter → tile
  const tr = r.frameTransitions();
  checks.demotesWhenStatic = kind === "tile" && tr.demoted.includes("v");
}

// 5 · hysteresis: a promoted region survives a brief still moment (1 static frame < demoteAfter) — no flap
{
  const r = makeChurnRouter({ promoteAfter: 3, demoteAfter: 5 });
  for (let i = 0; i < 3; i++) r.classify("v", true);                    // → vchunk
  r.classify("v", false);                                              // 1 still frame
  const kind = r.classify("v", true);                                  // moving again
  checks.hysteresisNoFlap = kind === "vchunk";                         // stayed a chunk (didn't demote on 1 frame)
}

// 6 · slots are classified independently (a video region + a static UI region coexist)
{
  const r = makeChurnRouter({ promoteAfter: 3, demoteAfter: 5 });
  for (let i = 0; i < 4; i++) { r.classify("video", true); r.classify("toolbar", false); }
  checks.perSlotIndependent = r.kindOf("video") === "vchunk" && r.kindOf("toolbar") === "tile";
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-churn-router-witness.result.json"), JSON.stringify({
  spec: "Full-motion churn router: classify each tile slot as a raw κ tile (low churn — lossless/sharp) or a κ video chunk (high churn — WebCodecs, ~300× smaller), with hysteretic promote/demote so a paused video demotes to a free raw tile and regions don't flap. Pure; the producer ports it over its per-slot delta state.",
  authority: "damage/dirty-region rendering · adaptive codec selection · hysteresis (Schmitt-trigger) · the full-motion prompt",
  witnessed,
  covers: witnessed ? ["churn-router", "starts-tile", "promote-on-churn", "stay-tile-low-churn", "demote-when-static", "hysteresis-no-flap", "per-slot-independent"] : [],
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ high-churn regions route to κ video chunks, low-churn to lossless tiles, paused video goes free — no flapping" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
