#!/usr/bin/env node
// holo-ingest-signal-witness.mjs — proves S3 of "the +": THE SIGNAL WIRE. Ingesting+mapping a source emits
// one verifiable signal into the autonomy spine's perception plane (the telemetry tap, S0 of the spine), with
// NO query. This is the reflex trigger: the REASON layer (Q, S4) subscribes to THIS span and investigates
// unbidden. The signal is adoption, not a mock — it carries the REAL graph stats (entity/claim counts + the
// graphClosure κ + source κ) from a genuine holo-ingest → holo-map run, and its W3C id re-derives (Law L5).
//
// Checks (all must hold):
//   1 ingestEmitsVerifiableSpan   — a real mapped graph → an "ingest.mapped" span that verify()s.
//   2 spanCarriesRealStats        — the span's attributes mirror the ACTUAL graph stats + graphClosure κ (adoption).
//   3 metricsAndLogsReDerive      — the ingest gauges + one INFO log per source all re-derive (Law L5).
//   4 oneLogPerSource             — a 2-source merged graph emits exactly 2 ingest.source logs naming both κs.
//   5 tamperedSignalRefused       — mutate the stored span's stats ⇒ verify fails; restore ⇒ passes (Law L5).
//   6 deterministicIdNotClock     — the SAME graph tapped under two clocks yields the SAME span id (Law L2).
//   7 emptyGraphHonestStatus      — a source that yields no entities taps a span with status "empty" (no fake signal).
//   8 localOnlyEgressStillGated   — the ingest signal never bypasses the privacy boundary (export without consent refused).
//
// Authority: OpenTelemetry data model + W3C Trace Context · W3C PROV-O · IETF RFC 8785 (JCS) · UOR-ADDR ·
// holospaces Laws L1/L2/L5 · rests on #holo-telemetry + #holo-ingest (S0) + #holo-map (S1) + #holo-telemetry-tap.
//   node tools/holo-ingest-signal-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeTelemetry } from "../os/usr/lib/holo/holo-telemetry.mjs";
import { makeStore, memBackend } from "../os/usr/lib/holo/holo-store.js";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { makeTap } from "../os/usr/lib/holo/holo-telemetry-tap.mjs";
import { sealIngest } from "../os/usr/lib/holo/holo-ingest.mjs";
import { extractGraph, mergeGraphs } from "../os/usr/lib/holo/holo-map.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);
const newTelemetry = (clock) => makeTelemetry({
  store: makeStore({ hash: (b) => sha256hex(b), axis: "did:holo:sha256", backend: memBackend() }),
  hash: (b) => sha256hex(b), now: clock,
});

// ── a real ingest → map run (the seam being adopted; not a mock) ────────────────────────────────────
const DOC = "Acme Corp was founded in Berlin in 2019. CEO: Dana Lee. Acme Corp raised €4,200,000 in 2024.";
const src = sealIngest({ name: "acme.txt", bytes: enc(DOC) });
const graph = extractGraph({ text: DOC, sourceKappa: src.source });

// ── 1 · the mapped graph becomes a verifiable span ──────────────────────────────────────────────────
const tel = newTelemetry(() => 1000);
const tap = makeTap({ telemetry: tel, service: "the-plus" });
const sig = await tap.observeIngest(graph);
ok("ingestEmitsVerifiableSpan",
  (await tel.verify(sig.span.kappa)).ok === true && sig.span.object["hostel:name"] === "ingest.mapped");

// ── 2 · the span carries the REAL graph stats (adoption, not a mock) ─────────────────────────────────
const attrs = sig.span.object["hostel:attributes"];
ok("spanCarriesRealStats",
  attrs.entities === graph["holo:stats"].entities && attrs.claims === graph["holo:stats"].claims
  && attrs.provenance === graph["holo:stats"].provenance && attrs.graphClosure === graph["holo:graphClosure"]
  && attrs.sources === 1,
  `span entities=${attrs.entities} vs graph ${graph["holo:stats"].entities}`);

// ── 3 · gauges + logs re-derive (Law L5) ─────────────────────────────────────────────────────────────
const metricsVerify = (await Promise.all(Object.values(sig.metrics).map((m) => tel.verify(m.kappa)))).every((v) => v.ok);
const logsVerify = (await Promise.all(sig.logs.map((l) => tel.verify(l.kappa)))).every((v) => v.ok);
ok("metricsAndLogsReDerive", metricsVerify && logsVerify && sig.logs.length === 1);

// ── 4 · a 2-source merged graph emits exactly 2 ingest.source logs naming both source κs ────────────
const srcB = sealIngest({ name: "b.txt", bytes: enc("Acme Corp is based in Berlin. CTO: Sam Roe.") });
const gB = extractGraph({ text: "Acme Corp is based in Berlin. CTO: Sam Roe.", sourceKappa: srcB.source });
const merged = mergeGraphs([graph, gB]);
const sig2 = await tap.observeIngest(merged);
const loggedSources = sig2.logs.map((l) => l.object["hostel:attributes"].source).sort();
ok("oneLogPerSource",
  sig2.logs.length === 2 && loggedSources.includes(src.source) && loggedSources.includes(srcB.source));

// ── 5 · Law L5 tamper-refuse: mutate the stored span's stats ⇒ verify fails; restore ⇒ passes ───────
{
  const backend = memBackend();
  const store = makeStore({ hash: (b) => sha256hex(b), axis: "did:holo:sha256", backend });
  const tel2 = makeTelemetry({ store, hash: (b) => sha256hex(b), now: () => 1000 });
  const tap2 = makeTap({ telemetry: tel2, service: "the-plus" });
  const s2 = await tap2.observeIngest(graph);
  const before = await store.get(s2.span.kappa);
  const obj = JSON.parse(new TextDecoder().decode(before));
  obj["hostel:attributes"].entities = 999;                       // lie about the graph
  await backend.set(s2.span.kappa, enc(JSON.stringify(obj)));
  const vBad = await tel2.verify(s2.span.kappa);
  await backend.set(s2.span.kappa, before);
  ok("tamperedSignalRefused", vBad.ok === false && (await tel2.verify(s2.span.kappa)).ok === true);
}

// ── 6 · Law L2 determinism: same graph, two clocks → same span id ───────────────────────────────────
const telB = newTelemetry(() => 999999);
const tapB = makeTap({ telemetry: telB, service: "the-plus" });
const sigB = await tapB.observeIngest(graph);
ok("deterministicIdNotClock", sigB.span.spanId === sig.span.spanId && sigB.span.traceId === sig.span.traceId);

// ── 7 · an empty graph taps an honest "empty" status (no fabricated signal) ─────────────────────────
const emptySrc = sealIngest({ name: "blank.txt", bytes: enc("   \n   ") });
const emptyGraph = extractGraph({ text: "   \n   ", sourceKappa: emptySrc.source });
const emptySig = await tap.observeIngest(emptyGraph);
ok("emptyGraphHonestStatus",
  emptySig.hasContent === false && emptySig.span.object["hostel:status"] === "empty"
  && (await tel.verify(emptySig.span.kappa)).ok === true,
  `status=${emptySig.span.object["hostel:status"]}`);

// ── 8 · the ingest signal never bypasses the privacy boundary (Law L1) ──────────────────────────────
const noConsent = await tel.exportTo("https://collector.example/v1/traces", { spans: [sig.span.object] });
ok("localOnlyEgressStillGated", noConsent.ok === false && /local-only/.test(noConsent.reason));

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "the + — S3 SIGNAL: ingesting+mapping a source emits one verifiable signal into the autonomy spine's perception tap (the reflex trigger Q subscribes to, no query). The span carries the REAL graph stats + graphClosure κ (adoption, not a mock), re-derives from content (Law L5), is deterministic under any clock (Law L2), honest about empty inputs, and never bypasses the privacy boundary (Law L1)",
  authority: "OpenTelemetry + W3C Trace Context · W3C PROV-O · IETF RFC 8785 (JCS) · UOR-ADDR · holospaces L1/L2/L5 · rests on #holo-telemetry + #holo-ingest + #holo-map + #holo-telemetry-tap",
  witnessed,
  covers: witnessed ? ["ingest-signal","reflex-trigger","real-stats-adoption","law-l5","law-l2","empty-honest","private-first","perception-tap"] : [],
  sample: { source: src.source, span: sig.span.kappa, graphClosure: graph["holo:graphClosure"], stats: graph["holo:stats"] },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ingest-signal-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ingest-signal witness — S3 the + (ingest → verifiable signal into the autonomy spine)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  span ${sig.span.kappa.slice(0, 28)}… · carries ${attrs.entities} entities/${attrs.claims} claims · closure ${String(attrs.graphClosure).slice(0, 20)}…`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  ingest fires a verifiable reflex trigger — Q can now investigate unbidden (S4)" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
