#!/usr/bin/env node
// holo-factory-tend-witness.mjs — proves the AUTONOMOUS tender (ADR-0097, the self-observing keystone):
// a check is monitor AND oracle; a red check auto-signals a factory fix verified by that same check; the
// loop runs ONLY under a standing user intent and NEVER fires itself. Booleans over the real
// os/usr/lib/holo/q/holo-factory-tend.mjs:
//   1. tendConverges    — a RED parse-check drives a factory.run; the verifier IS the check; status "fixed", target now parses
//   2. greenSkipped     — a GREEN check is left untouched: NO factory run, the proposer is never called (no fabrication)
//   3. durableShip      — a verified fix is WRITTEN back through the check's own write() (the loop closes), shipped:true
//   4. neverFakesInTend — a check that stays red ⇒ status "unverified" (NOT "fixed") and write() is NEVER called (Law L5)
//   5. drivenByIntent   — watch() seals a holo:Intent source "user"; every tend links it (prov:used); the FactoryTend re-derives
//   6. optInNoAutofire  — registering a red check fires NOTHING; with intervalMs 0 watch arms no timer; the act happens only on the explicit call (driven only by user intent)
//   7. tendReDerives    — the sealed FactoryTend + its whole DAG re-derive (Law L5)
//   8. gateSignals      — gateChecks() turns the OS gate's EARL report into checks: FAILED rows become signals, PASSED rows do not
//
//   node tools/holo-factory-tend-witness.mjs        (also run live by tools/gate.mjs)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createTender, parseCheck, gateChecks } from "../os/usr/lib/holo/q/holo-factory-tend.mjs";
import { createFactory } from "../os/usr/lib/holo/q/holo-factory.mjs";
import { verifyDeep, resolve } from "../os/usr/lib/holo/holo-mind.mjs";
import { failures } from "../os/usr/lib/holo/holo-mind-evolve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {};
const ACCEPT = async () => ({ outcome: "accept" });
const GOOD = "function f(){ return 1; }";
const BAD = "function f({ ";
const box = (init) => { let s = init, writes = 0; return { read: () => s, write: (v) => { s = v; writes++; }, get: () => s, writes: () => writes }; };

// ── 1+3. tendConverges + durableShip — red check → factory fix → verified → written back ──
{
  const t = box(BAD);
  const factory = createFactory({ propose: async () => ({ source: GOOD, lang: "js" }), gate: ACCEPT });
  const tender = createTender({ factory });
  tender.register("f", parseCheck("f", { read: t.read, write: t.write }));
  const r = await tender.tend();
  const row = r.results.find((x) => x.name === "f");
  checks.tendConverges = !!row && row.status === "fixed" && t.get() === GOOD;
  checks.durableShip = !!row && row.shipped === true && t.writes() === 1;
}

// ── 2. greenSkipped — a green check runs no factory (proposer never called) ──
{
  let proposed = 0;
  const t = box(GOOD);
  const factory = createFactory({ propose: async () => { proposed++; return { source: GOOD, lang: "js" }; }, gate: ACCEPT });
  const tender = createTender({ factory });
  tender.register("f", parseCheck("f", { read: t.read, write: t.write }));
  const r = await tender.tend();
  checks.greenSkipped = r.results[0].status === "green" && proposed === 0 && t.writes() === 0;
}

// ── 4. neverFakesInTend — a check that stays red is never "fixed" and never written ──
{
  const t = box(BAD);
  const factory = createFactory({ propose: async () => ({ source: BAD, lang: "js" }), gate: ACCEPT });   // brain can't fix it
  const tender = createTender({ factory });
  tender.register("f", parseCheck("f", { read: t.read, write: t.write }));
  const r = await tender.tend({ budget: 2 });
  const row = r.results.find((x) => x.name === "f");
  checks.neverFakesInTend = row.status === "unverified" && row.shipped === false && t.writes() === 0 && t.get() === BAD;
}

// ── 5+7. drivenByIntent + tendReDerives — watch seals a user intent every tend links; the receipt re-derives ──
{
  const t = box(BAD);
  const factory = createFactory({ propose: async () => ({ source: GOOD, lang: "js" }), gate: ACCEPT });
  const tender = createTender({ factory });
  tender.register("f", parseCheck("f", { read: t.read, write: t.write }));
  const handle = tender.watch("keep my holospace green", { intervalMs: 0 });   // intervalMs 0 → no timer
  const intentObj = resolve(tender.store, handle.intent);
  const r = await handle.tendNow();
  const rec = resolve(tender.store, r.receipt);
  const usesIntent = (rec.links || []).some((l) => l.rel === "prov:used" && l.id === handle.intent);
  checks.drivenByIntent = !!intentObj && intentObj["holo:source"] === "user" && r.intentKappa === handle.intent && usesIntent;
  checks.tendReDerives = verifyDeep(tender.store, rec).ok === true;
}

// ── 6. optInNoAutofire — nothing runs until the user calls; intervalMs 0 arms no timer (driven only by intent) ──
{
  let proposed = 0;
  const t = box(BAD);
  const factory = createFactory({ propose: async () => { proposed++; return { source: GOOD, lang: "js" }; }, gate: ACCEPT });
  const tender = createTender({ factory });
  tender.register("f", parseCheck("f", { read: t.read, write: t.write }));
  const before = proposed;                                        // registering fired nothing
  const handle = tender.watch("tend", { intervalMs: 0 });          // sealing intent fires nothing (no timer)
  const afterWatch = proposed;
  await handle.tendNow();                                          // the explicit act
  checks.optInNoAutofire = before === 0 && afterWatch === 0 && proposed === 1;
}

// ── 8. gateSignals — the EARL report's FAILED rows become checks; PASSED rows do not ──
{
  const report = { "@graph": [
    { "earl:test": { "@id": "https://hologram.os/conformance/os2#alpha", "dcterms:title": "alpha" }, "earl:result": { "earl:outcome": { "@id": "earl:failed" } } },
    { "earl:test": { "@id": "https://hologram.os/conformance/os2#beta", "dcterms:title": "beta" }, "earl:result": { "earl:outcome": { "@id": "earl:passed" } } },
  ] };
  const built = gateChecks(report, {});
  checks.gateSignals = built.length === 1 && built[0].name === "gate:alpha";
}

// ── 9. headThreads — tend() threads + PUBLISHES the advancing shared corpus head across red checks, so a
//      watch session's failures accumulate on ONE chain and failures(head) sees them (the seam opt-in
//      auto-grow depends on: hands-off self-improvement during watch() can only fire if it can SEE failures) ──
{
  const a = box(BAD), b = box(BAD);
  const factory = createFactory({ propose: async () => ({ source: BAD, lang: "js" }), gate: ACCEPT });   // unfixable → failure traces
  let head = null; const pubs = [];
  const tender = createTender({ factory, getHead: () => head, setHead: (h) => { head = h; pubs.push(h); } });
  tender.register("a", parseCheck("a", { read: a.read, write: a.write }));
  tender.register("b", parseCheck("b", { read: b.read, write: b.write }));
  const r = await tender.tend({ budget: 1 });
  const seen = failures(tender.store, r.corpusHead).length;
  checks.headThreads = typeof r.corpusHead === "string" && head === r.corpusHead && pubs.length >= 1 && seen >= 2;
}

const witnessed = Object.values(checks).every(Boolean);
const out = {
  spec: "Holo Factory autonomous tender (ADR-0097) — the self-observing keystone: a CHECK is monitor AND oracle, so signal "
    + "and verification collapse into one object; the tender runs every check, each RED one auto-drives a factory.run verified by "
    + "that same check, and a verified fix is SHIPPED through the check's own write(). DRIVEN ONLY BY USER INTENT: nothing fires "
    + "until watch() seals a standing holo:Intent (source 'user'); that intent is the authority every tend links (prov:used); the "
    + "conscience gates every change (inherited from the factory); no timer arms and no act happens without the user's intent. The "
    + "OS gate's own EARL report ingests as checks (failed rows = signals). Never fakes green; the FactoryTend receipt re-derives (Law L5).",
  authority: "W3C PROV-O · W3C DID Core · IETF RFC 8785 (JCS) · W3C Subresource Integrity · UOR-ADDR (κ = H(canonical form)) · "
    + "W3C EARL 1.0 (the conformance report the gate emits) · the Holo Constitution conscience gate (ADR-033) · Holo Mind ADR-0081 "
    + "(GoalStack intent + opt-in scheduler discipline) · Holo Factory ADR-0097 · holospaces Laws L1/L3/L4/L5",
  witnessed,
  covers: ["holo-factory", "factory-tender", "self-observing", "auto-signal", "witness-verified", "user-intent-only", "shared-corpus-head", "self-improvement-seam", "never-fakes-green", "law-l4", "law-l5"],
  checks,
  notes: { core: "os/usr/lib/holo/q/holo-factory-tend.mjs", basis: "drives holo-factory.mjs; check = monitor ⊕ oracle; gate EARL report = signal source. tend() threads + publishes the shared corpus head (getHead/setHead) so a watch session's failures accumulate on ONE chain — the seam opt-in, gated auto-grow (holo-mind-ui.factoryWatch{grow}) consumes to self-improve hands-off." },
};
writeFileSync(join(here, "holo-factory-tend-witness.result.json"), JSON.stringify(out, null, 2));
console.log(`holo-factory-tend-witness: ${witnessed ? "PASS" : "FAIL"}`);
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"} ${k}`);
process.exit(witnessed ? 0 : 1);
