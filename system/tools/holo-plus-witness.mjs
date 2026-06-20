#!/usr/bin/env node
// holo-plus-witness.mjs — proves "THE +" AS ONE CALL: the orchestrator (holo-plus.runPlus) the UI invokes. Drop a
// mix of sources (text + an audio file via a Moonshine-shaped adapter) and, with NO query, get back the whole
// reflex: a deduped κ-hypergraph, proactive insights, a sealed brief delivered to an inbox sink, and the entire
// run as one pinnable investigation κ-DAG. This is the exact path the "+" app runs; the app is thin DOM over it.
//
// Checks (all must hold):
//   1 oneCallRunsWholeReflex  — runPlus(inputs) returns graph + insights + brief + investigation, no query issued.
//   2 multiSourceDedup        — text + audio-transcript both mention "Acme Corp" → ONE entity κ (S2 across modalities).
//   3 proactiveInsights       — ≥1 insight, incl. a corroboration insight from the cross-modal overlap.
//   4 briefDeliveredToSink    — the brief was pushed to the injected inbox sink (proactive, unrequested).
//   5 investigationIsOneDag   — the run composes one investigation root κ over its members.
//   6 coverageHonest          — coverage() reports audio via adapter, image/etc sealed-raw (no silent caps).
//   7 qSeamUpgrades           — passing a Q-shaped investigator via the seam adds its insights (Q drop-in, async).
//   8 gracefulWithoutQ        — with NO Q/tap/sink, runPlus still returns a full brief on the baselines (no hard dep).
//
// Authority: holospaces Laws L2/L5 · rests on #holo-ingest + #holo-map + #holo-insight + #holo-brief + #holo-investigation.
//   node tools/holo-plus-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeTelemetry } from "../os/usr/lib/holo/holo-telemetry.mjs";
import { makeStore, memBackend } from "../os/usr/lib/holo/holo-store.js";
import { sha256hex, didHolo } from "../os/usr/lib/holo/holo-uor.mjs";
import { makeTap } from "../os/usr/lib/holo/holo-telemetry-tap.mjs";
import { runPlus } from "../os/usr/lib/holo/holo-plus.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);
const kOf = (b) => didHolo("sha256", sha256hex(b));

// a Moonshine-shaped audio adapter: audio bytes → a transcript text view (the cross-modality bridge).
const TRANSCRIPT = "Acme Corp is based in Berlin. Dana Lee is the CEO of Acme Corp.";
const asrAdapter = async (s) => { const tv = enc(TRANSCRIPT); return { kind: "audio+transcript", kappas: [kOf(s.bytes), kOf(tv)], textView: { kappa: kOf(tv), text: TRANSCRIPT, chars: TRANSCRIPT.length } }; };

// inbox sink + telemetry tap (the live S3/S6 seams, here injected)
let delivered = null;
const sink = async (msg) => { delivered = msg; return { delivered: true, id: "inbox-1" }; };
const tel = makeTelemetry({ store: makeStore({ hash: (b) => sha256hex(b), axis: "did:holo:sha256", backend: memBackend() }), hash: (b) => sha256hex(b), now: () => 1000 });
const tap = makeTap({ telemetry: tel, service: "the-plus" });

// ── THE CALL: a text doc + an audio file + an (unsupported) image, no query ─────────────────────────
const inputs = [
  { name: "memo.txt", bytes: enc("Acme Corp operates in Berlin. Acme Corp shipped 12 products in 2023.") },
  { name: "interview.mp3", bytes: new Uint8Array([0xff, 0xfb, 1, 2, 3, 4]) },
  { name: "logo.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]) },
];
const out = await runPlus(inputs, { adapters: { audio: asrAdapter }, tap, sink, title: "What the + found", now: () => "2026-06-19T00:00:00Z" });

// ── 1 · one call ran the whole reflex ───────────────────────────────────────────────────────────────
ok("oneCallRunsWholeReflex",
  out.graph["@type"].includes("holo:HyperGraph") && Array.isArray(out.insights) && out.brief["@type"].includes("holo:Brief") && out.investigation["@type"].includes("holo:Investigation"));

// ── 2 · cross-modal dedup: text + transcript both name Acme → ONE entity κ ──────────────────────────
const acme = out.graph["holo:entities"].filter((e) => e["schema:name"] === "Acme Corp");
ok("multiSourceDedup", acme.length === 1, `${acme.length} Acme nodes`);

// ── 3 · proactive insights incl. corroboration from the cross-modal overlap ─────────────────────────
const corro = out.insights.find((i) => i["holo:kind"] === "corroboration" && /Acme Corp/.test(i["schema:text"]));
ok("proactiveInsights", out.insights.length >= 1 && !!corro, corro ? corro["schema:text"] : "no corroboration");

// ── 4 · the brief was delivered to the inbox sink ───────────────────────────────────────────────────
ok("briefDeliveredToSink", !!delivered && delivered.briefKappa === out.brief["@id"] && delivered.lineCount >= 1 && !!out.delivery.ack.delivered);

// ── 5 · the run is one investigation κ-DAG ──────────────────────────────────────────────────────────
ok("investigationIsOneDag", /^did:holo:sha256:[0-9a-f]{64}$/.test(out.investigation["holo:root"]) && out.investigation["holo:memberCount"] >= 3);

// ── 6 · coverage is honest (audio via adapter, image sealed-raw) ────────────────────────────────────
const cov = out.coverage; const au = cov.find((c) => c.family === "audio"), im = cov.find((c) => c.family === "image");
ok("coverageHonest", au.adapter === true && im.adapter === false);

// ── 7 · the Q seam upgrades insights (async Q-shaped investigator drops in) ─────────────────────────
const qInvestigator = async (g) => [{ kind: "opportunity", text: "Q: Acme's Berlin base aligns with its 2023 product push.", confidence: 0.8, evidence: [g["holo:entities"][0]["@id"]], sources: out.sources.slice(0, 1) }];
const outQ = await runPlus(inputs, { adapters: { audio: asrAdapter }, investigators: { q: qInvestigator }, title: "Q run", now: () => "2026-06-19T00:00:00Z" });
ok("qSeamUpgrades", outQ.insights.some((i) => i["holo:kind"] === "opportunity" && /^Q:/.test(i["schema:text"])));

// ── 8 · graceful without Q/tap/sink — still a full brief on the baselines ───────────────────────────
const bare = await runPlus(inputs, { adapters: { audio: asrAdapter }, now: () => "2026-06-19T00:00:00Z" });
ok("gracefulWithoutQ", bare.brief["holo:insightCount"] >= 1 && bare.signal === null && bare.delivery === null);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "THE + as one call (holo-plus.runPlus): a mix of sources (text + audio via a Moonshine-shaped adapter + an unsupported image) runs the whole reflex with no query — a deduped cross-modal κ-hypergraph, proactive insights (incl. corroboration), a sealed brief delivered to an inbox sink, and the run as one pinnable investigation κ-DAG. The Q intelligence is a swappable seam that upgrades insights when present; absent Q/tap/sink the call still returns a full brief on the witnessed baselines. This is the exact path the '+' app invokes",
  authority: "holospaces Laws L2/L5 · rests on #holo-ingest + #holo-map + #holo-insight + #holo-brief + #holo-investigation",
  witnessed,
  covers: witnessed ? ["one-call-reflex","cross-modal-dedup","proactive-insights","inbox-delivery","investigation-dag","honest-coverage","q-seam-upgrade","graceful-baseline"] : [],
  sample: { entities: out.graph["holo:stats"], insightCount: out.insights.length, briefKappa: out.brief["@id"], root: out.investigation["holo:root"], coverage: out.coverage.map((c) => `${c.family}:${c.adapter ? "adapter" : "raw"}`) },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-plus-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-plus witness — THE + as one call (drop sources → proactive brief, no query)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ran on ${inputs.length} mixed sources → ${out.graph["holo:stats"].entities} entities · ${out.insights.length} insights · brief delivered · root ${out.investigation["holo:root"].slice(0, 20)}…`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the + is one call: any sources in → proactive, provenance-verified brief out" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
