#!/usr/bin/env node
// holo-telemetry-tap-witness.mjs — proves S0 of the autonomy spine: PERCEPTION ADOPTION. Holo Telemetry
// (holo-telemetry.mjs) is a witnessed observability RUNTIME, but a runtime that nothing feeds observes
// nothing. This proves the OS's real signal seams now flow through it: a REAL heal-supervisor sweep, an app
// lifecycle event, and the conformance gate's verdict each become content-addressed telemetry whose W3C ids
// RE-DERIVE from content (Law L5). Crucially the heal seam is driven LIVE — a genuine makeSupervisor().tick()
// over a real makeHealer() — so the tapped span carries the ACTUAL sweep counts, not a mock: adoption, not a
// stub. Tamper a tapped signal and its id breaks; timing stays honestly attested; egress stays default-deny.
//
// Checks (all must hold):
//   1 healSweepEmitsVerifiableSpan — a real tick → a heal.sweep span that verify()s, carrying the REAL counts.
//   2 healMetricsAndLogsReDerive   — the gauges + one INFO log per real repair receipt all re-derive (Law L5).
//   3 tamperedTappedSignalRefused  — mutate the stored span's structural field ⇒ verify fails; restore ⇒ passes.
//   4 appLifecycleEmitsVerifiable  — observeApp(open) → a counter + a correlated log that re-derive.
//   5 gateVerdictEmitsVerifiable   — observeGate(rows) → failing_required gauge = the REAL red count; a WARN per red row.
//   6 honestSplitPreserved         — the tapped span's wall-clock measurement is rederivable:false (attested, not faked).
//   7 deterministicIdContentNotClock — the SAME tick tapped under two different clocks yields the SAME span id.
//   8 localOnlyEgressStillGated    — the tap never bypasses the privacy boundary: export without consent is refused.
//
// Authority (external): OpenTelemetry data model + W3C Trace Context · W3C PROV-O · IETF RFC 8785 (JCS) ·
// UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L1 (private-first) / L2 (one canonical wire) / L5
// (verify by re-derivation) · rests on #holo-telemetry (the runtime) + #heal (the seam being adopted).
//   node tools/holo-telemetry-tap-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeTelemetry } from "../os/usr/lib/holo/holo-telemetry.mjs";
import { makeStore, memBackend } from "../os/usr/lib/holo/holo-store.js";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { makeTap } from "../os/usr/lib/holo/holo-telemetry-tap.mjs";
import { makeHealer } from "../os/sbin/holo-heal.mjs";
import { makeSupervisor } from "../os/sbin/holo-heal-supervisor.mjs";
import { reDerive, hexOf } from "../os/sbin/holo-resolver.mjs";
import { makeObject } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);
const kOf = async (bytes) => "did:holo:sha256:" + (await reDerive(bytes));
const source = (label, pairs) => { const m = new Map(pairs.map(([k, b]) => [hexOf(k), b])); const s = async (k) => m.get(hexOf(k)) || null; s.peer = label; return s; };

// ── build a telemetry runtime over an in-memory κ-store (the collector), exactly like the telemetry witness ──
const newTelemetry = (clock) => makeTelemetry({
  store: makeStore({ hash: (b) => sha256hex(b), axis: "did:holo:sha256", backend: memBackend() }),
  hash: (b) => sha256hex(b), now: clock,
});

// ── drive a REAL heal sweep: one healthy-on-device object + one healable-from-mesh object → healed:1 ─────
const A = enc("tap-witness · object-A (healthy on device)"), B = enc("tap-witness · object-B (healable from mesh)");
const kA = await kOf(A), kB = await kOf(B);
const realTick = await (async () => {
  const durable = new Map([[hexOf(kA), A]]);
  const intact = async (hex) => durable.has(hex) && (await reDerive(durable.get(hex))) === hex;
  const sealReceipt = (info) => makeObject(new Map(), {
    type: ["prov:Activity", "hosheal:Heal"], context: [{ hosheal: "https://hologram.os/ns/heal#" }],
    "hosheal:target": info.kappa, "hosheal:recoveredFrom": info.recoveredFrom, "prov:generatedAtTime": info.generatedAtTime,
  });
  const healer = makeHealer({ sources: [source("ipfs", [[kA, A], [kB, B]])],
    store: new Map(), persist: async (hex, b) => durable.set(hex, b), sealReceipt, now: () => "2026-06-19T00:00:00Z" });
  const sup = makeSupervisor({ loadClosure: async () => ({ "a.js": kA, "b.js": kB }), healer, intact, now: () => "2026-06-19T00:00:00Z" });
  return sup.tick("boot");   // → summary {total:2, healthy:1, healed:1, unresolved:0, receipts:[1]}
})();

// ── 1 · the real sweep becomes a verifiable span carrying the ACTUAL counts (adoption, not a mock) ──────
const tel = newTelemetry(() => 1000);
const tap = makeTap({ telemetry: tel, service: "witness" });
const heal = await tap.observeHeal(realTick);
const attrs = heal.span.object["hostel:attributes"];
ok("healSweepEmitsVerifiableSpan",
  (await tel.verify(heal.span.kappa)).ok === true
  && heal.span.object["hostel:name"] === "heal.sweep"
  && attrs.healed === realTick.summary.healed && attrs.healthy === realTick.summary.healthy
  && attrs.unresolved === realTick.summary.unresolved && attrs.total === realTick.summary.total,
  `span counts must mirror the real tick (healed=${realTick.summary.healed})`);

// ── 2 · the gauges and one INFO log per REAL repair receipt all re-derive (Law L5) ─────────────────────
const metricsVerify = (await Promise.all(Object.values(heal.metrics).map((m) => tel.verify(m.kappa)))).every((v) => v.ok);
const logsVerify = (await Promise.all(heal.logs.map((l) => tel.verify(l.kappa)))).every((v) => v.ok);
const repairLogs = heal.logs.filter((l) => l.object["hostel:body"] === "heal.repaired").length;
ok("healMetricsAndLogsReDerive",
  metricsVerify && logsVerify && repairLogs === (realTick.summary.receipts || []).length && repairLogs === 1,
  `${repairLogs} repair logs vs ${(realTick.summary.receipts || []).length} receipts`);

// ── 3 · Law L5: a TAMPERED tapped signal (mutate the span name in the store) breaks its id; restore passes ─
// (re-tap on a store we own, so we can mutate the bytes under the same κ key)
{
  const backend = memBackend();
  const store = makeStore({ hash: (b) => sha256hex(b), axis: "did:holo:sha256", backend });
  const tel2 = makeTelemetry({ store, hash: (b) => sha256hex(b), now: () => 1000 });
  const tap2 = makeTap({ telemetry: tel2, service: "witness" });
  const h2 = await tap2.observeHeal(realTick);
  const before = await store.get(h2.span.kappa);
  const obj = JSON.parse(new TextDecoder().decode(before)); obj["hostel:name"] = "evil.sweep";
  await backend.set(h2.span.kappa, enc(JSON.stringify(obj)));
  const vBad = await tel2.verify(h2.span.kappa);
  await backend.set(h2.span.kappa, before);
  ok("tamperedTappedSignalRefused", vBad.ok === false && (await tel2.verify(h2.span.kappa)).ok === true);
}

// ── 4 · an app lifecycle event taps to a verifiable counter + correlated log ────────────────────────────
const appEv = await tap.observeApp({ app: "files", phase: "open", route: "/home" });
ok("appLifecycleEmitsVerifiable",
  (await tel.verify(appEv.count.kappa)).ok === true && (await tel.verify(appEv.log.kappa)).ok === true
  && appEv.log.object["hostel:body"] === "app.open" && appEv.log.object["hostel:attributes"].app === "files");

// ── 5 · the conformance gate's verdict taps to gauges (the REAL red count) + one WARN per red required row ─
const gateRows = [
  { name: "#heal", ok: true, required: true }, { name: "#holo-telemetry", ok: true, required: true },
  { name: "#holo-code", ok: false, required: true }, { name: "#qvac-sdk", ok: false, required: true },
];
const gate = await tap.observeGate({ rows: gateRows });
const realRed = gateRows.filter((r) => !r.ok && r.required).length;
ok("gateVerdictEmitsVerifiable",
  (await tel.verify(gate.metrics.failingRequired.kappa)).ok === true
  && gate.metrics.failingRequired.value === realRed && gate.logs.length === realRed
  && (await Promise.all(gate.logs.map((l) => tel.verify(l.kappa)))).every((v) => v.ok));

// ── 6 · the HONEST SPLIT survives the tap: the span's wall-clock measurement is rederivable:false ───────
const meas = heal.span.object["hostel:measurement"];
ok("honestSplitPreserved", meas["hostel:rederivable"] === false && typeof meas["hostel:durationNano"] === "number");

// ── 7 · DETERMINISM (Law L2): the SAME tick tapped under a DIFFERENT clock yields the SAME span id ──────
const telB = newTelemetry(() => 999999);
const tapB = makeTap({ telemetry: telB, service: "witness" });
const healB = await tapB.observeHeal(realTick);
ok("deterministicIdContentNotClock", healB.span.spanId === heal.span.spanId && healB.span.traceId === heal.span.traceId);

// ── 8 · the tap NEVER bypasses the privacy boundary: egress without consent is refused (Law L1) ─────────
const noConsent = await tel.exportTo("https://collector.example/v1/traces", { spans: [heal.span.object] });
ok("localOnlyEgressStillGated", noConsent.ok === false && /local-only/.test(noConsent.reason));

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "Holo Telemetry TAP (S0 perception adoption) — the OS's live seams (a real heal sweep, app lifecycle, the conformance gate) flow through the witnessed observability runtime as content-addressed PROV-O signals whose W3C ids re-derive from content (Law L5); the heal seam is driven LIVE so the signal carries the real sweep counts (adoption, not a mock); timing stays honestly attested and egress stays default-deny",
  authority: "OpenTelemetry data model + W3C Trace Context · W3C PROV-O · IETF RFC 8785 (JCS) · UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L1/L2/L5 · rests on #holo-telemetry + #heal",
  witnessed,
  covers: witnessed ? ["telemetry-adoption", "perception-tap", "heal-observed", "app-observed", "gate-observed", "law-l5", "honest-split", "private-first"] : [],
  sample: { span: heal.span.kappa, traceId: heal.span.traceId, realHealed: realTick.summary.healed, redRows: realRed },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-telemetry-tap-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Telemetry TAP witness — S0 perception adoption (sense → reason → speak)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  real sweep: healed ${realTick.summary.healed} · healthy ${realTick.summary.healthy} · span ${heal.span.spanId}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the OS's live seams now flow through the observability plane, verifiably" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
