#!/usr/bin/env node
// holo-ingest-coverage-witness.mjs — proves S7 of "the +": ONE PORT, EVERY TYPE. The router dispatches every
// media/file/stream family to its handler (text native; video→Holo Tube, audio→κ-audio+Moonshine, model→Forge
// as injected adapters) and NEVER silently drops: an unhandled family is sealed raw (≥1 κ, honest about it) and
// coverage() logs exactly what is real vs sealed-raw (ADR: no silent caps). The headline check is CROSS-MODALITY:
// a mock ASR adapter (standing for Moonshine) turns audio bytes into a transcript text view that flows all the way
// through MAP → REASON → a proactive insight — proving the Port unifies modalities into the one κ-hypergraph.
//
// The witness uses DETERMINISTIC stand-in adapters (no GPU/ffmpeg) so it proves routing MECHANICS; the real
// encoders (holo-tube-ingest, createMoonshineASR, the Forge) are the production adapters injected in the browser.
//
// Checks (all must hold):
//   1 everyFamilyRoutesNoDrop    — text/structured/image/audio/video/model/richdoc/archive/binary each route, each ≥1 κ, none dropped.
//   2 nativeTextYieldsView       — text & structured route natively to a decoded text view (MAP can run).
//   3 unhandledSealedRawHonest   — image/model/etc with NO adapter are sealed raw, flagged (no text view), never dropped.
//   4 injectedAdapterTakesOver   — wiring a video adapter (Holo Tube stand-in) routes video THROUGH it, yielding its segment κs.
//   5 boundedCapIsLogged         — an adapter that caps (e.g. "first 90s") surfaces `bounded` so coverage isn't silently truncated.
//   6 coverageReportIsHonest     — coverage() names every family and flags which have a real adapter vs are sealed-raw.
//   7 crossModalityEndToEnd      — mock ASR audio → transcript text view → MAP → REASON → a proactive insight (κ-hypergraph unifies modalities).
//   8 familyClassificationSane   — extension + MIME both classify correctly (mp4→video, mp3→audio, png→image, gguf→model, csv→structured).
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L2/L5 · rests on #holo-ingest (S0) + #holo-map +
// #holo-insight. node tools/holo-ingest-coverage-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeRouter, familyOf, sealIngest } from "../os/usr/lib/holo/holo-ingest.mjs";
import { extractGraph } from "../os/usr/lib/holo/holo-map.mjs";
import { investigate } from "../os/usr/lib/holo/holo-insight.mjs";
import { sha256hex, didHolo } from "../os/usr/lib/holo/holo-uor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);
const kOf = (b) => didHolo("sha256", sha256hex(b));

// ── production-shaped stand-in adapters (deterministic; no GPU/ffmpeg) ──────────────────────────────
// video: Holo Tube stand-in → an init κ + segment κs (MediaGraph shape), bounded to first 90s.
const videoAdapter = async (s) => {
  const init = kOf(s.bytes.slice(0, 4)); const seg = kOf(s.bytes);
  return { kind: "MediaGraph", kappas: [init, seg], bounded: "first 90s", textView: null };
};
// audio: Moonshine stand-in → seal the audio κ + a TRANSCRIPT text view (this is the cross-modality bridge).
const TRANSCRIPT = "Acme Corp is based in Berlin. Acme Corp raised funding in 2024.";
const asrAdapter = async (s) => {
  const audioKappa = kOf(s.bytes); const tv = enc(TRANSCRIPT);
  return { kind: "audio+transcript", kappas: [audioKappa, kOf(tv)], textView: { kappa: kOf(tv), text: TRANSCRIPT, chars: TRANSCRIPT.length } };
};

// ── 1 · every family routes, every route yields ≥1 κ, nothing dropped (router with NO adapters = pure fallback) ─
const bare = makeRouter({});
const samples = [
  { name: "notes.txt", bytes: enc("Acme Corp in Berlin."), fam: "text" },
  { name: "data.csv", bytes: enc("a,b\n1,2"), fam: "structured" },
  { name: "photo.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]), fam: "image" },
  { name: "song.mp3", bytes: new Uint8Array([0xff, 0xfb, 0, 0, 9]), fam: "audio" },
  { name: "clip.mp4", bytes: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), fam: "video" },
  { name: "brain.gguf", bytes: new Uint8Array([0x47, 0x47, 0x55, 0x46, 0]), fam: "model" },
  { name: "report.pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x00, 0xe2, 0xe3, 0xcf]), fam: "richdoc" }, // "%PDF-1.4" + binary body (NUL)
  { name: "bundle.zip", bytes: new Uint8Array([0x50, 0x4b, 3, 4]), fam: "archive" },
  { name: "unknown.dat", bytes: new Uint8Array([0, 1, 2, 0, 3, 0]), fam: "binary" },
];
const routed = [];
for (const s of samples) routed.push({ s, r: await bare.route(s) });
ok("everyFamilyRoutesNoDrop",
  routed.every(({ s, r }) => r.family === s.fam && r.kappas.length >= 1 && r.dropped === false),
  routed.filter(({ s, r }) => r.family !== s.fam).map(({ s, r }) => `${s.name}→${r.family}≠${s.fam}`).join(","));

// ── 2 · text & structured yield a native decoded text view (MAP can run) ────────────────────────────
const txt = routed.find(({ s }) => s.fam === "text").r, csv = routed.find(({ s }) => s.fam === "structured").r;
ok("nativeTextYieldsView", txt.textView && /Acme/.test(txt.textView.text) && csv.textView && !txt.viaAdapter);

// ── 3 · unhandled families sealed raw, honest (no text view), never dropped ─────────────────────────
const rawFams = routed.filter(({ s }) => ["image", "audio", "video", "model", "richdoc", "archive", "binary"].includes(s.fam));
ok("unhandledSealedRawHonest",
  rawFams.every(({ r }) => r.viaAdapter === false && r.textView === null && r.kappas.length >= 1 && /sealed raw|raw|no text view/.test(r.note)));

// ── 4 · inject a video adapter → video routes THROUGH it, yielding the adapter's segment κs ──────────
const wired = makeRouter({ adapters: { video: videoAdapter, audio: asrAdapter } });
const vid = await wired.route({ name: "clip.mp4", bytes: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 9, 9]) });
ok("injectedAdapterTakesOver", vid.viaAdapter === true && vid.kind === "MediaGraph" && vid.kappas.length === 2);

// ── 5 · a bounded adapter surfaces its cap (no silent truncation) ───────────────────────────────────
ok("boundedCapIsLogged", vid.bounded === "first 90s" && /bounded/.test(vid.note));

// ── 6 · coverage() is honest about what is real vs sealed-raw ───────────────────────────────────────
const cov = wired.coverage();
const vidCov = cov.find((c) => c.family === "video"), imgCov = cov.find((c) => c.family === "image");
ok("coverageReportIsHonest",
  cov.length >= 9 && vidCov.adapter === true && imgCov.adapter === false && cov.find((c) => c.family === "text").textViewNative === true);

// ── 7 · CROSS-MODALITY: audio → ASR transcript → MAP → REASON → a proactive insight ─────────────────
const au = await wired.route({ name: "talk.mp3", bytes: new Uint8Array([0xff, 0xfb, 1, 2, 3]) });
const graph = extractGraph({ text: au.textView.text, sourceKappa: au.textView.kappa });
const insights = await investigate(graph);
ok("crossModalityEndToEnd",
  au.viaAdapter && au.textView && graph["holo:entities"].some((e) => e["schema:name"] === "Acme Corp")
  && insights.length >= 1 && insights.every((i) => i["holo:evidence"].length > 0),
  `entities=${graph["holo:stats"].entities} insights=${insights.length}`);

// ── 8 · family classification by extension AND mime ─────────────────────────────────────────────────
ok("familyClassificationSane",
  familyOf("a.mp4") === "video" && familyOf("a.mp3") === "audio" && familyOf("a.png") === "image"
  && familyOf("a.gguf") === "model" && familyOf("a.csv") === "structured"
  && familyOf("x", "video/mp4") === "video" && familyOf("x", "image/png") === "image" && familyOf("x", "text/plain", enc("hi")) === "text");

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "the + — S7 COVERAGE: one Port routes every media/file/stream family to its handler (text native; video→Holo Tube, audio→κ-audio+Moonshine, model→Forge as injected adapters) and never silently drops — an unhandled family is sealed raw (≥1 κ, honest) and coverage() logs what is real vs sealed-raw (no silent caps). Cross-modality is proven end-to-end: audio → ASR transcript → MAP → REASON → a proactive insight, unifying modalities into the one κ-hypergraph. Routing mechanics witnessed with deterministic stand-ins; real encoders are the production adapters",
  authority: "UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L2/L5 · rests on #holo-ingest + #holo-map + #holo-insight",
  witnessed,
  covers: witnessed ? ["universal-port","family-routing","no-silent-drop","injected-adapter-seam","bounded-logged","honest-coverage","cross-modality","classification"] : [],
  sample: { families: bare.families, coverage: wired.coverage().map((c) => `${c.family}:${c.adapter ? "adapter" : "raw"}`),
            crossModality: `audio→"${TRANSCRIPT.slice(0, 40)}…"→${graph["holo:stats"].entities} entities→${insights.length} insights` },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ingest-coverage-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ingest coverage witness — S7 the + (one Port, every type; no silent drop; cross-modality)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  coverage: ${wired.coverage().map((c) => `${c.family}:${c.adapter ? "✓adapter" : "raw"}`).join("  ")}`);
console.log(`  cross-modality: audio bytes → transcript → ${graph["holo:stats"].entities} entities → ${insights.length} insights (one hypergraph)`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the + accepts ANY source; modalities converge into one κ-hypergraph; nothing dropped" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
