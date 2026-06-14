// holo-suspend.mjs — DEHYDRATE ↔ REHYDRATE a live run to a content-addressed CHECKPOINT (a spike toward an ADR).
//
// Holo Orchestrate (ADR-045) proves a FINISHED multi-agent DAG — a work receipt you re-derive after the fact.
// What it cannot do is FREEZE a run in flight and resume it elsewhere. This module turns the live state of a
// run — its completed step chain (the provenance DAG so far) AND its frontier (the outputs that feed the next
// step) — into ONE self-verifying UOR object whose κ IS the checkpoint. Restoring it (rehydrate) re-derives the
// whole frozen DAG (Law L5 — a tampered checkpoint is refused) and reconstructs the exact in-memory state, so
// the run continues as if it never paused: suspend · migrate · resume over the content-addressed substrate, no
// server. The checkpoint is just another substrate object, so it flows into everything κ flows into (Own,
// Settle, the healer's recovery) for free.
//
// Two properties make it a real capability, not a snapshot blob:
//   • RESUME == UNINTERRUPTED. The continuation seals byte-identical step receipts, so a run suspended at step k
//     and resumed reaches the SAME final receipt κ as one that ran straight through — the pause is invisible in
//     the proof. (Deterministic steps re-derive; a model step's output is FROZEN into the checkpoint, so resume
//     continues FROM it rather than re-running it — correct for non-deterministic steps too: you never recompute
//     the past, only the future.)
//   • MIGRATE is free. Fetch the checkpoint κ (and the step κs it commits to) from wherever the bytes live —
//     durable store · peers · IPFS · origin — re-derive, and resume on a machine that never started the run. It
//     composes with the healer/resolver: the same torrent-style, origin-agnostic recovery.
//
// The checkpoint κ commits to the PROGRAM κ and the authority CONTEXT κ it ran under, so resume cannot silently
// swap the plan or widen the delegation — a mismatched program/context is refused. Code (the step functions) is
// out-of-band, referenced by the program κ (as Holo Forge references source by κ); the caller supplies the ops.
//
// Pure + isomorphic + dependency-injected (store + clock injected; no clock/RNG in the core → re-derivation-safe).

import { makeObject, verifyDeep, resolve, linkTo } from "./holo-object.mjs";

const HOSUS = { hosus: "https://hologram.os/ns/suspend#" };

// makeRunner({ ops, store, now }) → { sealProgram, start, step, runToEnd, dehydrate, rehydrate, finalReceipt }
//   ops   : { [stepName]: (outputs:any[]) => any }   deterministic step bodies (a model step returns its
//                                                    attestation/output — frozen into the receipt, never re-run).
//   store : Map(hex → bytes)                          the UOR object store (holo-object put/resolve shape).
//   now   : () → string                              ISO timestamp for the checkpoint (injected; no clock here).
export function makeRunner({ ops = {}, store = new Map(), now = () => "1970-01-01T00:00:00Z" } = {}) {

  // sealProgram(steps) → the static plan as a UOR object; its κ (program.id) is the run's plan identity.
  function sealProgram(steps) {
    return makeObject(store, {
      type: ["prov:Plan", "schema:HowTo"], context: [HOSUS],
      "schema:name": "Run program — ordered step plan", "hosus:steps": steps,
    });
  }

  const start = (program, input) => ({ program, outputs: [input], cursor: 0, steps: [] });
  const planSteps = (state) => state.program["hosus:steps"];
  const done = (state) => state.cursor >= planSteps(state).length;

  // step(state) → execute the next step, seal its PROV-O receipt (linking the prior step = a DAG edge), advance.
  // The receipt is TIMESTAMP-FREE — a pure function of (name, cursor, output, prior, program) — so it re-derives
  // identically whether produced in one run or after a resume. That is precisely what makes a resume invisible.
  function step(state) {
    if (done(state)) return state;
    const name = planSteps(state)[state.cursor];
    const fn = ops[name];
    if (typeof fn !== "function") throw new Error(`holo-suspend: no op for step "${name}"`);
    const output = fn(state.outputs);
    const prior = state.steps.length ? resolve(store, state.steps[state.steps.length - 1]) : null;
    const receipt = makeObject(store, {
      type: ["prov:Activity", "hosus:Step"], context: [HOSUS],
      "schema:name": name, "hosus:cursor": state.cursor, "hosus:output": output,
      "prov:wasInformedBy": state.program.id,
      ...(prior ? { links: [linkTo(store, "prov:used", prior)] } : {}),
    });
    return { ...state, outputs: [...state.outputs, output], cursor: state.cursor + 1, steps: [...state.steps, receipt.id] };
  }

  function runToEnd(state) { let s = state; while (!done(s)) s = step(s); return s; }

  // finalReceipt(state) → κ of the last step receipt (the work-receipt root — what Orchestrate would verify).
  const finalReceipt = (state) => (state.steps.length ? state.steps[state.steps.length - 1] : null);

  // dehydrate(state, { context }) → freeze the run to ONE self-verifying checkpoint object; its id IS the κ.
  // Commits to: the program κ, the authority context κ, the cursor, the FRONTIER (every live output, verbatim),
  // and the completed step chain (the κ list as data + a Merkle link to its head, so verifyDeep re-derives the
  // whole DAG). Tamper any frozen step and the head-link digest — and the checkpoint κ — no longer re-derive.
  function dehydrate(state, { context = null } = {}) {
    const head = state.steps.length ? resolve(store, state.steps[state.steps.length - 1]) : null;
    return makeObject(store, {
      type: ["prov:Entity", "hosus:Suspension", "schema:CreativeWork"], context: [HOSUS],
      "schema:name": "Run checkpoint — dehydrated, content-addressed, resumable (Law L5)",
      "hosus:program": state.program.id,
      "hosus:cursor": state.cursor,
      "hosus:frontier": state.outputs,                 // the live registers — restored verbatim on resume
      "hosus:stepChain": state.steps,                  // the completed provenance DAG (κ list)
      "hosus:status": done(state) ? "done" : "suspended",
      ...(context ? { "hosus:context": context } : {}),
      ...(head ? { links: [linkTo(store, "prov:wasDerivedFrom", head)] } : {}),
      "prov:generatedAtTime": now(),
    });
  }

  // rehydrate(kappa, { program, context }) → re-derive the frozen DAG (Law L5) and reconstruct the EXACT state,
  // refusing a tampered checkpoint, a swapped plan, or a widened authority. The caller re-supplies the program
  // object (its bytes are referenced by κ) and the ops; everything else is restored from the checkpoint.
  function rehydrate(kappa, { program, context = null } = {}) {
    const susp = resolve(store, kappa);
    if (!susp) throw new Error("holo-suspend: checkpoint unresolved");
    const deep = verifyDeep(store, susp);
    if (!deep.ok) throw new Error(`holo-suspend: checkpoint refused — re-derivation failed at ${deep.at} (${deep.why})`);
    if (!program || susp["hosus:program"] !== program.id) throw new Error("holo-suspend: checkpoint refused — program κ mismatch (the plan was swapped)");
    if ((susp["hosus:context"] || null) !== (context || null)) throw new Error("holo-suspend: checkpoint refused — authority context κ mismatch (resume cannot widen authority)");
    return { program, outputs: susp["hosus:frontier"], cursor: susp["hosus:cursor"], steps: susp["hosus:stepChain"] };
  }

  return { sealProgram, start, step, runToEnd, dehydrate, rehydrate, finalReceipt };
}
