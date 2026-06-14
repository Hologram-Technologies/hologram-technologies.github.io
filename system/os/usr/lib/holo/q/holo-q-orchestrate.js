// holo-q-orchestrate.js — the explicit binding that lets the Holo Mind orchestrator (ADR-0081) DRIVE
// the Mixture-of-Specialists fabric end-to-end. It reuses the REAL orchestrator core — holo-mind.mjs's
// runLoop (intent → plan → gate → dispatch → seal) — and wires its dispatch seam to the fabric:
//
//   roster   ← the helper tasks (holo-q-mux TASKS) as callable verbs (Law L4: a verb originates here)
//   plan     ← the model (Holo Q's QVAC sampler) when present, else a deterministic rule planner
//   gate     ← the fail-closed conscience (ADR-0033) when present, else an injected allow (witness)
//   dispatch ← route the verb to its bound specialist (mux.routeTask) and run it THROUGH THE FABRIC
//              (holo-q-fabric: κ-memoized O(1) replay · streamed · sealed to a content κ)
//
// So a request becomes: the orchestrator plans which specialists to call, the conscience gates each,
// the fabric runs them (instant on a repeat, streamed when generative), and every action seals a
// re-derivable PROV-O receipt whose effectKappa IS the fabric's content-addressed output. 100%
// serverless (no network in the loop — discovery is the only fetch, and a bound specialist needs
// none), and low-latency by construction (two O(1) layers: the plan memo AND the compute memo).
//
// Pure browser/Node ESM, dependency-injected (the Holo Atlas isomorphism) — witnessed in Node.

import { composeRoster, runLoop, modelPlan, MAX_ARM } from "../holo-mind.mjs";

// helperRoster(mux) → the helper tasks as a Holo Mind roster (verb name = task id, Law L4 origin).
export function helperRoster(mux) {
  const verbs = (mux.TASKS || mux.default?.TASKS || []).map((t) => ({ name: t.id, description: `${t.job} (${t.need} specialist)` }));
  return composeRoster({ agents: verbs }, { max: MAX_ARM });
}

// rulePlan — the deterministic planner used when no model sampler is bound. Understands "verb: input"
// and falls back to a default task. (In the browser the REAL planner is the QVAC model; this keeps the
// loop runnable — and witnessable — with no model.)
export function rulePlan(intent, roster, { defaultTask = null } = {}) {
  const utter = String(intent["holo:utterance"] || intent.utterance || "").trim();
  const names = new Set((roster || []).map((v) => v.name));
  const m = utter.match(/^([\w-]+)\s*:\s*([\s\S]+)$/);
  if (m && names.has(m[1])) return [{ verb: m[1], args: { input: m[2].trim() }, decision: {} }];
  if (defaultTask && names.has(defaultTask)) return [{ verb: defaultTask, args: { input: utter }, decision: {} }];
  return [];
}

const pickInput = (step) => { const a = step.args || {}; return a.input ?? a.text ?? a.query ?? step.input ?? ""; };

// makeDispatch — the seam that makes the orchestrator drive the fabric. dispatch(step) routes the verb
// to its bound specialist and runs it through the fabric; it RETURNS the fabric's output κ (so the
// action receipt's effectKappa is content-addressed + re-derivable) and pushes the rich result to `sink`.
export function makeDispatch({ mux, fabric, sink, scene = null }) {
  return async function dispatch(step) {
    const task = step.verb;
    const provider = mux.routeTask(task);
    if (!provider || provider.fallback === true || (!provider.embed && !provider.classify && !provider.generate)) {
      const eff = { task, value: null, kappa: null, cached: false, ms: 0, routedTo: provider && provider.id, note: "no specialist bound — main-model floor" };
      sink && sink.push(eff); return null;                          // honest: nothing to seal but the loop continues
    }
    const final = await fabric.compute({ provider, task, input: pickInput(step), params: step.args && step.args.params });
    // feed the CODE face of Holo Perception (ADR-0086): this object's compute-output κ. The renderer
    // feeds the VISUAL face for the same id → the orchestrator perceives both, in real time.
    if (scene) { const id = (step.args && step.args.id) || pickInput(step) || task; scene.observeCode(id, final.kappa, { source: provider.id, kind: task }); }
    sink && sink.push({ task, input: pickInput(step), value: final.value, kappa: final.kappa, cached: final.cached, ms: final.ms, provider: provider.id });
    return final.kappa;                                              // the receipt's effectKappa (content-addressed)
  };
}

// createQOrchestrator — assemble a Holo-Mind-driven, fabric-backed orchestrator. All deps injectable;
// sensible serverless defaults so it runs anywhere (browser or witness).
export function createQOrchestrator({ store = null, fabric, mux, gate = null, sampler = null, defaultTask = null, scene = null } = {}) {
  if (!fabric || !mux) throw new Error("createQOrchestrator: { fabric, mux } are required");
  const kstore = store || new Map();                                // the working κ-store (runLoop seals here)
  const roster = helperRoster(mux);
  const memo = new Map();                                           // the PLAN memo (Law L3) — O(1) re-plan
  const sink = [];                                                  // rich effects of the last run
  const allow = async () => ({ outcome: "accept" });
  const gateFn = gate || allow;                                     // real conscience injected in-browser
  const planFn = sampler ? (intent) => modelPlan(intent, roster, sampler) : (intent) => rulePlan(intent, roster, { defaultTask });
  const dispatch = makeDispatch({ mux, fabric, sink, scene });      // `scene` (Holo Perception) gets the CODE face

  async function orchestrate(utterance, { source = "user", steps = null } = {}) {
    sink.length = 0;
    const deps = { store: kstore, roster, plan: steps ? async () => steps : planFn, gate: gateFn, dispatch, memo };
    const summary = await runLoop({ utterance, source }, deps);
    return { ...summary, effects: sink.slice() };                   // receipts (summary) + fabric outputs
  }

  return {
    orchestrate, roster, fabric, mux,
    fabricStats: () => fabric.stats(),
    describe: () => ({
      bound: "Holo Mind runLoop (ADR-0081) → Mixture-of-Specialists fabric (ADR-0085)",
      roster: roster.map((v) => v.name),
      plan: sampler ? "QVAC model (real)" : "deterministic rule planner (serverless floor)",
      gate: gate ? "conscience (ADR-0033)" : "allow (witness default)",
      latency: "two O(1) layers — the plan memo AND the compute memo; a bound specialist makes the loop network-free",
      receipt: "every action seals a PROV-O receipt whose effectKappa IS the fabric's content-addressed output",
    }),
  };
}

// bindToHoloMind — expose the Q-orchestrator on the page so the shell can drive specialists through the
// fabric. Returns the orchestrator (and registers window.HoloQOrchestrator) — or a reason if deps absent.
export function bindToHoloMind({ fabric, mux, gate, sampler } = {}) {
  const g = (typeof window !== "undefined") ? window : globalThis;
  if (!fabric || !mux) return { connected: false, reason: "fabric + mux required" };
  const realGate = gate || (g.HoloConscience && typeof g.HoloConscience.evaluate === "function" ? (d) => g.HoloConscience.evaluate(d) : null);
  const realSampler = sampler || (g.HoloMind && typeof g.HoloMind.sampler === "function" ? g.HoloMind.sampler : null);
  const orch = createQOrchestrator({ fabric, mux, gate: realGate, sampler: realSampler });
  g.HoloQOrchestrator = orch;
  return { connected: true, ...orch.describe() };
}

export default { helperRoster, rulePlan, makeDispatch, createQOrchestrator, bindToHoloMind };
