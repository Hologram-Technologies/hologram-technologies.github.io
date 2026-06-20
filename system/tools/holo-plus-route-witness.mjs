#!/usr/bin/env node
// holo-plus-route-witness.mjs — proves A6 of "The + Everywhere": RESULT ROUTING. What the "+" found goes to the
// right place: an OMNI drop → a proactive answer card (A5); an ORDINARY input → a lightweight context chip (with
// "see full brief"); a VOICE "add this" → Q grounding (A4). The invariant that makes it feel native: routing NEVER
// mutates or blocks the input — the chip is additive, typing is untouched. Intent-routed.
//
// Checks (all must hold):
//   1 omniRoutesToAnswer     — decideRoute(omni bar) === "answer".
//   2 inputRoutesToChip      — decideRoute(ordinary text input) === "chip" (the least-disruptive default).
//   3 voiceIntentRoutesGround — decideRoute(input, { intent:"ground" }) === "ground".
//   4 chipModelShape         — chipModel → { label, brief κ, investigation root, insightCount, top } — opens the brief.
//   5 chipLabelConcise       — the chip label is short and names the count ("+ N insights ready").
//   6 neverMutatesInput      — routeResult does NOT read or write target.value: the user's draft is untouched.
//   7 routesToCorrectSink    — routeResult dispatches the payload to the matching injected sink (answer|chip|ground), once.
//   8 chipCarriesBriefToOpen — the chip's brief κ + investigation root equal the result's (so "see full brief" works).
//
// Authority: holospaces Law L2 · rests on #holo-plus + #holo-plus-answer (A5) + #holo-plus-q (A4).
//   node tools/holo-plus-route-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decideRoute, chipModel, routeResult } from "../os/usr/lib/holo/holo-plus-route.mjs";
import { runPlus } from "../os/usr/lib/holo/holo-plus.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);
const el = (attrs, value) => ({ tagName: "INPUT", value, getAttribute: (n) => (n in attrs ? attrs[n] : null) });

const result = await runPlus([{ name: "acme.txt", bytes: enc("Acme Corp is based in Berlin. Dana Lee is the CEO of Acme Corp.") }], { context: { surface: "local", activeApp: "notes" }, title: "What the + found" });

const omni = el({ type: "search" });
const input = el({ type: "text" }, "my draft note");

// ── 1/2/3 · routing decisions ───────────────────────────────────────────────────────────────────────
ok("omniRoutesToAnswer", decideRoute(omni) === "answer");
ok("inputRoutesToChip", decideRoute(input) === "chip");
ok("voiceIntentRoutesGround", decideRoute(input, { intent: "ground" }) === "ground");

// ── 4/5 · chip model ──────────────────────────────────────────────────────────────────────────────
const chip = chipModel(result, { activeApp: "notes" });
ok("chipModelShape",
  chip["@type"].includes("holo:ContextChip") && chip.brief === result.brief["@id"]
  && chip.investigation === result.investigation["holo:root"] && chip.insightCount === result.insights.length && typeof chip.top === "string");
ok("chipLabelConcise", /^\+ \d+ insight/.test(chip.label) && chip.label.length < 40, `label="${chip.label}"`);

// ── 6 · routing NEVER mutates the input (the key feel-native invariant) ─────────────────────────────
const before = input.value;
let chipSinkGot = null;
const r6 = routeResult({ target: input, result, context: { activeApp: "notes" }, sinks: { chip: (p) => { chipSinkGot = p; } } });
ok("neverMutatesInput", input.value === before && before === "my draft note" && r6.mode === "chip");

// ── 7 · dispatches to the correct sink, once ────────────────────────────────────────────────────────
const calls = { answer: 0, chip: 0, ground: 0 };
const sinks = { answer: () => calls.answer++, chip: () => calls.chip++, ground: () => calls.ground++ };
routeResult({ target: omni, result, sinks });                 // → answer
routeResult({ target: input, result, sinks });                // → chip
routeResult({ target: input, result, intent: "ground", sinks }); // → ground
ok("routesToCorrectSink", calls.answer === 1 && calls.chip === 1 && calls.ground === 1 && chipSinkGot && chipSinkGot.brief === result.brief["@id"]);

// ── 8 · chip carries the brief + investigation so "see full brief" works ────────────────────────────
ok("chipCarriesBriefToOpen", chip.brief === result.brief["@id"] && chip.investigation === result.investigation["holo:root"]);

const witnessed = Object.values(checks).every(Boolean);
const out = {
  "@type": "earl:TestResult",
  spec: "The + Everywhere — A6 RESULT ROUTING: omni → proactive answer card (A5); ordinary text input → lightweight context chip with 'see full brief'; voice 'add this' → Q grounding (A4). Routing NEVER reads or writes the input's value — the chip is additive and the user's typing is never disturbed (the feel-native invariant). Intent-routed; the chip carries the brief κ + investigation root so the full thing can be opened",
  authority: "holospaces Law L2 · rests on #holo-plus + #holo-plus-answer + #holo-plus-q",
  witnessed,
  covers: witnessed ? ["result-routing","omni-answer","input-chip","voice-ground","never-mutates-input","correct-sink","chip-opens-brief"] : [],
  sample: { chipLabel: chip.label, chipTop: chip.top, modes: { omni: decideRoute(omni), input: decideRoute(input), voice: decideRoute(input, { intent: "ground" }) } },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-plus-route-witness.result.json"), JSON.stringify(out, null, 2) + "\n");
console.log("holo-plus-route witness — A6 The + (omni→answer · input→chip · voice→Q; input never disturbed)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  omni → answer · input → chip ("${chip.label}") · voice → ground · input value untouched`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the + routes to the right surface and never blocks your typing" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
