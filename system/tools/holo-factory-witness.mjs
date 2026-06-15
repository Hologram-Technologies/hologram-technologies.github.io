#!/usr/bin/env node
// holo-factory-witness.mjs — proves Holo Factory (ADR-0097): the software factory is a re-derivable,
// honest, closed κ-loop over Holo Mind's core. All checks are booleans over the REAL
// os/usr/lib/holo/q/holo-factory.mjs (faculties injected as deterministic stubs — the holo-mind idiom):
//   1. loopConverges     — change→verify retries until the verifier passes; stops AT green (attempt 2 of a bad→good proposer)
//   2. runReDerives      — the sealed FactoryRun + its whole DAG (intent · attempt receipts · trace) re-derive (Law L5)
//   3. neverFakesGreen   — with NO verifier bound, ok=false / outcome="unverified" / change=null; the raw attempt is exposed as `proposal` only (Law L5 honesty)
//   4. failClosed        — a BLOCK gate seals NO attempt receipt and produces NO effect (outcome "blocked"); no path skips conscience
//   5. learnsFromFailure — a failed run appends a Trace (outcome "failure") to the append-only corpus; a second run chains onto it (continual learning)
//   6. parseOracle       — the in-tab "parse" verifier passes valid JS and FAILS syntactically broken JS (a real serverless oracle, never executes code)
//   7. noFabrication     — with NO brain (propose=null) the factory acts on nothing yet STILL seals an honest, re-deriving run receipt (no invented change)
//   8. tamperRefused     — verifyDeep refuses a FactoryRun whose bytes were flipped (Law L5, depth ≥ 1)
//   9. sealEquivalence   — the FactoryRun id is byte-identical to the canonical Node envelope (holo-object.address) — one κ axis across runtimes
//
//   node tools/holo-factory-witness.mjs        (also run live by tools/gate.mjs)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createFactory } from "../os/usr/lib/holo/q/holo-factory.mjs";
import { verifyDeep, resolve, address } from "../os/usr/lib/holo/holo-mind.mjs";
import { walkCorpus, failures } from "../os/usr/lib/holo/holo-mind-evolve.mjs";
import { address as objAddress } from "../os/usr/lib/holo/holo-object.mjs";   // canonical Node envelope — byte-identity cross-check

const here = dirname(fileURLToPath(import.meta.url));
const checks = {};
const ACCEPT = async () => ({ outcome: "accept" });
const BLOCK = async () => ({ outcome: "block" });
const GOOD = "function f(){ return 1; }";
const BAD = "function f({ ";                                      // a syntax error → the parse oracle must reject it

// a proposer that emits BAD on attempt 1, GOOD thereafter — exercises the retry loop deterministically
const badThenGood = async ({ attempt }) => ({ source: attempt < 2 ? BAD : GOOD, lang: "js" });

// ── 1. loopConverges — retry until the verifier passes, stop at green ──
{
  const f = createFactory({ propose: badThenGood, gate: ACCEPT });
  const r = await f.run("fix f", { verify: "parse", budget: 4 });
  checks.loopConverges = r.ok === true && r.outcome === "success" && r.attempts === 2 && r.verified === true && !!r.effectKappa;
}

// ── 2. runReDerives — the FactoryRun and its whole DAG re-derive (Law L5) ──
{
  const f = createFactory({ propose: badThenGood, gate: ACCEPT });
  const r = await f.run("fix f", { verify: "parse", budget: 4 });
  const runObj = resolve(r.store, r.receipt);
  checks.runReDerives = r.reDerives === true && !!runObj && verifyDeep(r.store, runObj).ok === true;
}

// ── 3. neverFakesGreen — no verifier ⇒ honest "unverified", change withheld, proposal exposed ──
{
  const f = createFactory({ propose: async () => ({ source: GOOD, lang: "js" }), gate: ACCEPT });
  const r = await f.run("do a thing");                            // NO verify bound
  checks.neverFakesGreen = r.ok === false && r.outcome === "unverified" && r.change === null && r.proposal === GOOD && r.reDerives === true;
}

// ── 4. failClosed — a blocked gate seals nothing, dispatches nothing ──
{
  const f = createFactory({ propose: badThenGood, gate: BLOCK });
  const r = await f.run("fix f", { verify: "parse", budget: 4 });
  const runObj = resolve(r.store, r.receipt);
  const noActionReceipts = (runObj.links || []).every((l) => l.rel !== "prov:wasInformedBy");
  checks.failClosed = r.ok === false && r.outcome === "blocked" && r.attempts === 0 && r.effectKappa === null && noActionReceipts && r.blocked === true;
}

// ── 5. learnsFromFailure — a failure appends a Trace; a second run chains the corpus (append-only) ──
{
  const f = createFactory({ propose: async () => ({ source: BAD, lang: "js" }), gate: ACCEPT });
  const r1 = await f.run("fix f", { verify: "parse", budget: 2 });
  const r2 = await f.run("fix f again", { verify: "parse", budget: 2, corpusHead: r1.traceHead });
  const chain = walkCorpus(r2.store, r2.traceHead);
  const fails = failures(r2.store, r2.traceHead);
  checks.learnsFromFailure = r1.outcome === "unverified" && chain.length === 2 && fails.length === 2
    && chain[0]["holo:failureKind"] === "syntax";                 // newest trace recorded the parse failure
}

// ── 6. parseOracle — valid JS passes, broken JS fails (a real in-tab oracle, never executes) ──
{
  const f = createFactory({ gate: ACCEPT });
  const good = await f.run("x", { verify: "parse", budget: 1, propose: undefined }) ;  // (propose default null below)
  const fOk = createFactory({ propose: async () => ({ source: GOOD, lang: "js" }), gate: ACCEPT });
  const fBad = createFactory({ propose: async () => ({ source: BAD, lang: "js" }), gate: ACCEPT });
  const ok = await fOk.run("x", { verify: "parse", budget: 1 });
  const bad = await fBad.run("x", { verify: "parse", budget: 1 });
  checks.parseOracle = ok.ok === true && ok.evidence && ok.evidence.lang === "js"
    && bad.ok === false && bad.outcome === "unverified";
}

// ── 7. noFabrication — no brain ⇒ no invented change, yet an honest run receipt still re-derives ──
{
  const f = createFactory({ propose: null, gate: ACCEPT });
  const r = await f.run("nothing to act on", { verify: "parse", budget: 3 });
  checks.noFabrication = r.ok === false && r.proposal === null && r.change === null && r.attempts === 0 && r.reDerives === true && r.outcome === "unverified";
}

// ── 8. tamperRefused — a flipped FactoryRun byte is refused by verifyDeep (Law L5) ──
{
  const f = createFactory({ propose: badThenGood, gate: ACCEPT });
  const r = await f.run("fix f", { verify: "parse", budget: 4 });
  const runObj = resolve(r.store, r.receipt);
  const tampered = { ...runObj, "holo:outcome": "success-FORGED" };   // claim success with mutated bytes
  checks.tamperRefused = verifyDeep(r.store, runObj).ok === true && verifyDeep(r.store, tampered).ok === false;
}

// ── 9. sealEquivalence — the FactoryRun κ is byte-identical to the canonical Node envelope ──
{
  const f = createFactory({ propose: badThenGood, gate: ACCEPT });
  const r = await f.run("fix f", { verify: "parse", budget: 4 });
  const runObj = resolve(r.store, r.receipt);
  const { id, ...content } = runObj;
  checks.sealEquivalence = address(content) === id && objAddress(content) === id;   // holo-mind axis === holo-object axis === sealed id
}

const witnessed = Object.values(checks).every(Boolean);
const out = {
  spec: "Holo Factory (ADR-0097) — the software factory as ONE verb native to Q: a self-observing SDLC loop "
    + "(signal → change → verify → seal → learn) that SPECIALIZES Holo Mind (ADR-0081) and routes the model door per task "
    + "(Dream diffusion infill ADR-0083 for surgical edits · the AR coder for whole-source). The loop is a κ-transform "
    + "κ(signal) ⊕ κ(change) ⊕ κ(verdict) → κ(factory-run) sealed as a re-derivable PROV-O object (Law L5). It claims ok ONLY "
    + "when an injected verifier passed; with none bound it returns the change as an honest unverified proposal, never faking green.",
  authority: "W3C PROV-O · W3C DID Core · IETF RFC 8785 (JCS) · W3C Subresource Integrity · UOR-ADDR (κ = H(canonical form)) · "
    + "the Holo Constitution conscience gate (ADR-033) · Holo Mind ADR-0081 (the ambient loop + trace corpus) · ADR-0083 (diffusion infill) · "
    + "holospaces Laws L1/L3/L4/L5 (identity is content · the store is the memory · everything through the substrate · verify by re-derivation)",
  witnessed,
  covers: ["holo-factory", "software-factory", "sdlc-loop", "self-improvement", "model-router", "never-fakes-green", "law-l3", "law-l4", "law-l5"],
  checks,
  notes: { core: "os/usr/lib/holo/q/holo-factory.mjs", basis: "specializes holo-mind.mjs + holo-mind-evolve.mjs; faculties injected (brain·gate·verifier)" },
};
writeFileSync(join(here, "holo-factory-witness.result.json"), JSON.stringify(out, null, 2));
console.log(`holo-factory-witness: ${witnessed ? "PASS" : "FAIL"}`);
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"} ${k}`);
process.exit(witnessed ? 0 : 1);
