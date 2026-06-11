// holo-admit.mjs — constitutional ADMISSION for every holospace (ADR-033 enforcement).
//
// No holospace app runs in Hologram OS except by being mounted through holo-launch.mjs `mount()`.
// That is the one unbypassable chokepoint, so it is where the Constitution is ENFORCED: before any
// app mounts, the conscience gate (holo-conscience.js — itself self-verifying + fail-closed) evaluates
// the app's declaration against the eight constitutional principles. A red-line violation, or a
// constitution that has not self-verified (sealed!==true), REFUSES the mount. Fail-closed: if the
// Constitution is tampered or absent, nothing runs. Isomorphic (browser + Node 20+) — co-located with
// the gate so the same module proves in the witness and enforces in the browser.

import { verifyConstitution, evaluate, sealed, WORLD_VARS, RED_LINE } from "./holo-conscience.js";

// seal the gate ONCE (idempotent, cached): re-derive the Constitution's principles and compare to the
// pinned κ (Law L5). Until this resolves true, `evaluate` (and therefore `admit`) refuses everything.
let _seal = null;
export function sealConstitution(opts) { return _seal || (_seal = verifyConstitution(opts)); }
export { sealed };

// decisionFor(def): map a holospace's declaration → the constitutional world-model (the ten booleans).
// Default-benign — a normal app asserts no governed action. An app that DECLARES a governed action via
// `capabilities.attests.<var>` is evaluated against it; declaring a red-line action ⇒ refused at the door.
export function decisionFor(def = {}) {
  const attests = (def.capabilities && def.capabilities.attests) || {};
  const d = {};
  for (const v of WORLD_VARS) d[v] = !!attests[v];
  return d;
}

// admit(def): the admission verdict for one holospace. ok=false ⇒ mount MUST refuse. Fail-closed via
// the gate (evaluate blocks everything when the Constitution is unsealed). Pure + deterministic once sealed.
export function admit(def = {}) {
  const v = evaluate(decisionFor(def));
  const ok = v.outcome === "accept" || v.outcome === "caveat";   // block ⇒ refused (red line OR unsealed)
  return {
    ok,
    outcome: v.outcome,
    sealed: v.sealed === true,
    blocked: v.blocked || [],
    reason: ok ? (v.caveats && v.caveats.length ? "admitted with caveats: " + v.caveats.join(",") : "admitted")
               : (v.sealed === false ? "Constitution unverified — failed closed" : "violates red-line principle(s): " + (v.blocked || []).join(",")),
    verdicts: v.verdicts || [],
  };
}

export { RED_LINE };
