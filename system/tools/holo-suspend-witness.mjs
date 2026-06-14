#!/usr/bin/env node
// holo-suspend-witness.mjs — proves DEHYDRATE ↔ REHYDRATE: a live run is frozen to ONE content-addressed
// checkpoint κ and restored EXACTLY, so an orchestration can pause · migrate · resume with no server and no
// loss of proof. Holo Orchestrate (ADR-045) verifies a FINISHED DAG; this proves the missing leg — a run you
// can stop in flight and continue elsewhere — entirely on the substrate already shipped (the UOR envelope +
// content-addressed store). A spike toward an ADR.
//
// Checks (all must hold):
//   1 roundTrips            — rehydrate(dehydrate(state)) restores cursor + frontier + step-chain + program EXACTLY.
//   2 checkpointAddressed   — a checkpoint IS its content: same state ⇒ same κ; one more step ⇒ a different κ.
//   3 resumeEqualsUninterrupted — a run suspended at step k and resumed reaches the SAME final receipt κ as one
//                            that ran straight through — even across SEPARATE stores (κ depends on content, not host).
//   4 tamperRefused         — flip a byte in the checkpoint (or in a frozen step it commits to) and rehydrate REFUSES
//                            (Law L5 / verifyDeep) — a corrupted run is never silently resumed.
//   5 migratesToFreshStore  — copy only the checkpoint's κ-closure into a NEW store (as a peer would fetch it) and
//                            resume there to the SAME final κ — suspend on one machine, resume on another.
//   6 authorityNotWidened   — the checkpoint commits to its program κ and authority-context κ; resuming with a
//                            swapped plan OR a different context κ is refused (resume cannot escalate scope).
//   7 provenanceIntact      — verifyDeep(checkpoint) re-derives the whole frozen DAG, depth ≥ the steps completed.
//
// Authority (external): W3C PROV-O (a checkpoint is a prov:Entity wasDerivedFrom the step Activities) · W3C DID
// Core (did:holo content id) · W3C Subresource Integrity (the Merkle link digests) · IETF RFC 8785 (JCS, the
// canonical bytes a κ commits to) · holospaces Laws L1/L3/L5 (identity is content · dedup by content · verify by
// re-derivation) · ADR-025 (UOR envelope) · ADR-045 (Holo Orchestrate work receipt). Usage: node tools/holo-suspend-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeRunner } from "../os/usr/lib/holo/holo-suspend.mjs";
import { makeObject, verifyDeep } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-suspend-witness.result.json"), JSON.stringify(r, null, 2) + "\n");

// A deterministic 3-step pipeline (the ADR's read → assess → compose, in miniature): double, increment, render.
const OPS = {
  double: (o) => o[o.length - 1] * 2,
  inc: (o) => o[o.length - 1] + 1,
  render: (o) => `result=${o[o.length - 1]}`,
};
const STEPS = ["double", "inc", "render"];
const NOW = () => "2026-06-13T00:00:00Z";
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// copyClosure(src, dst, κ) — copy the transitive κ-closure of an object (its links + any did:holo it names) into
// a fresh store, exactly as a peer fetching a checkpoint from the mesh would assemble what it needs to resume.
function copyClosure(src, dst, kappa, seen = new Set()) {
  const hex = String(kappa).split(":").pop();
  if (seen.has(hex)) return; seen.add(hex);
  const bytes = src.get(hex); if (!bytes) return;
  dst.set(hex, bytes);
  const obj = JSON.parse(bytes.toString("utf8"));
  for (const l of obj.links || []) copyClosure(src, dst, l.id, seen);
  for (const v of Object.values(obj)) {
    const arr = Array.isArray(v) ? v : [v];
    for (const x of arr) if (typeof x === "string" && x.startsWith("did:holo:")) copyClosure(src, dst, x, seen);
  }
}

const checks = {};

// ── 1 · round-trip: freeze at step 2 (after double, inc), restore the exact state ───────────────────────
{
  const store = new Map();
  const r = makeRunner({ ops: OPS, store, now: NOW });
  const program = r.sealProgram(STEPS);
  let s = r.start(program, 5);
  s = r.step(s); s = r.step(s);                       // ran double(→10) and inc(→11); cursor at 2, render pending
  const susp = r.dehydrate(s);
  const back = r.rehydrate(susp.id, { program });
  checks.roundTrips = back.cursor === 2 && eq(back.outputs, [5, 10, 11]) && eq(back.steps, s.steps) && back.program.id === program.id;
}

// ── 2 · the checkpoint is content-addressed: same state → same κ; one more step → a different κ ──────────
{
  const store = new Map();
  const r = makeRunner({ ops: OPS, store, now: NOW });
  const program = r.sealProgram(STEPS);
  let s = r.start(program, 5); s = r.step(s); s = r.step(s);
  const k1 = r.dehydrate(s).id, k1b = r.dehydrate(s).id;     // identical state + clock ⇒ identical κ
  const k2 = r.dehydrate(r.step(s)).id;                       // after one more step ⇒ different κ
  checks.checkpointAddressed = k1 === k1b && k1 !== k2;
}

// ── 3 · resume == uninterrupted: suspend@2 + resume reaches the SAME final κ as a straight run, even in a
//        SEPARATE store (the final receipt κ is a function of content, not of which machine produced it) ──
let finalStraight = null;
{
  const straight = makeRunner({ ops: OPS, store: new Map(), now: NOW });
  const pA = straight.sealProgram(STEPS);
  finalStraight = straight.finalReceipt(straight.runToEnd(straight.start(pA, 5)));

  const split = makeRunner({ ops: OPS, store: new Map(), now: NOW });   // a DIFFERENT store
  const pB = split.sealProgram(STEPS);
  let s = split.step(split.step(split.start(pB, 5)));                   // run 2 of 3, then pause
  const susp = split.dehydrate(s);
  const resumed = split.runToEnd(split.rehydrate(susp.id, { program: pB }));
  const finalResumed = split.finalReceipt(resumed);

  checks.resumeEqualsUninterrupted = finalStraight !== null && finalStraight === finalResumed;
}

// ── 4 · tamper-evident: a corrupted checkpoint, or a corrupted frozen step it commits to, is REFUSED ────
{
  const store = new Map();
  const r = makeRunner({ ops: OPS, store, now: NOW });
  const program = r.sealProgram(STEPS);
  let s = r.step(r.step(r.start(program, 5)));
  const susp = r.dehydrate(s);
  const hex = (did) => String(did).split(":").pop();

  // (a) tamper the checkpoint's OWN bytes (raise the cursor) — its id no longer re-derives → refused
  const orig = store.get(hex(susp.id));
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(orig.toString("utf8")), "hosus:cursor": 99 }), "utf8");
  store.set(hex(susp.id), forged);
  let refusedCheckpoint = false;
  try { r.rehydrate(susp.id, { program }); } catch { refusedCheckpoint = true; }
  store.set(hex(susp.id), orig);                                        // restore for the next sub-check

  // (b) tamper a FROZEN step receipt — verifyDeep follows the head link, the digest mismatches → refused
  const stepHex = hex(s.steps[s.steps.length - 1]);
  const sOrig = store.get(stepHex);
  store.set(stepHex, Buffer.from(JSON.stringify({ ...JSON.parse(sOrig.toString("utf8")), "hosus:output": 999 }), "utf8"));
  let refusedStep = false;
  try { r.rehydrate(susp.id, { program }); } catch { refusedStep = true; }

  checks.tamperRefused = refusedCheckpoint && refusedStep;
}

// ── 5 · migrate: copy ONLY the checkpoint's κ-closure to a fresh store and resume there to the SAME final κ ─
{
  const src = new Map();
  const r = makeRunner({ ops: OPS, store: src, now: NOW });
  const program = r.sealProgram(STEPS);
  const susp = r.dehydrate(r.step(r.step(r.start(program, 5))));        // suspend@2 on "machine A"

  const dst = new Map();
  copyClosure(src, dst, susp.id);                                      // "machine B" fetches only what the κ commits to
  const lackedAnswer = !dst.has(finalStraight.split(":").pop());       // B did NOT inherit the result — it must compute it
  const r2 = makeRunner({ ops: OPS, store: dst, now: NOW });           // B has the bytes + the code (ops), never ran the start
  const resumed = r2.runToEnd(r2.rehydrate(susp.id, { program }));
  checks.migratesToFreshStore = lackedAnswer && r2.finalReceipt(resumed) === finalStraight && resumed.cursor === STEPS.length;
}

// ── 6 · authority cannot be widened: a swapped program OR a different context κ is refused ───────────────
{
  const store = new Map();
  const r = makeRunner({ ops: OPS, store, now: NOW });
  const program = r.sealProgram(STEPS);
  const ctx = makeObject(store, { type: ["prov:Entity", "schema:DigitalDocument"], "schema:name": "delegation/conscience baseline" });
  const other = makeObject(store, { type: ["prov:Entity", "schema:DigitalDocument"], "schema:name": "a BROADER authority" });
  const otherProgram = r.sealProgram(["double", "inc", "render", "render"]);   // a different plan
  const susp = r.dehydrate(r.step(r.step(r.start(program, 5))), { context: ctx.id });

  const okSame = r.rehydrate(susp.id, { program, context: ctx.id }).cursor === 2;   // same authority resumes
  let refusedCtx = false, refusedPlan = false;
  try { r.rehydrate(susp.id, { program, context: other.id }); } catch { refusedCtx = true; }
  try { r.rehydrate(susp.id, { program: otherProgram, context: ctx.id }); } catch { refusedPlan = true; }
  checks.authorityNotWidened = okSame && refusedCtx && refusedPlan;
}

// ── 7 · provenance intact: the checkpoint re-derives the whole frozen DAG, depth ≥ steps completed ───────
{
  const store = new Map();
  const r = makeRunner({ ops: OPS, store, now: NOW });
  const program = r.sealProgram(STEPS);
  const s = r.step(r.step(r.start(program, 5)));
  const susp = r.dehydrate(s);
  const deep = verifyDeep(store, susp);
  checks.provenanceIntact = deep.ok === true && deep.depth >= s.steps.length;
}

const witnessed = Object.values(checks).every(Boolean);
write({
  spec: "Hologram OS suspend/resume — dehydrate ↔ rehydrate a live run to a content-addressed checkpoint κ: freeze the provenance DAG + the live frontier into one self-verifying object, restore it exactly (Law L5), and pause · migrate · resume with no server and no loss of proof (resume reaches the same final receipt κ as an uninterrupted run)",
  authority: "W3C PROV-O · W3C DID Core · W3C Subresource Integrity · IETF RFC 8785 (JCS) · holospaces Laws L1/L3/L5 · ADR-025 (UOR envelope) · ADR-045 (Holo Orchestrate work receipt)",
  witnessed,
  covers: witnessed ? ["suspend-resume", "dehydrate-rehydrate", "checkpoint", "resumable-orchestration", "migrate", "tamper-evident", "law-l5"] : [],
  checks,
});

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ a live run freezes to one κ and resumes exactly — pause · migrate · resume on the substrate, the pause invisible in the proof" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
