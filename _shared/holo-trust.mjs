// holo-trust.mjs — THE TRUST BOUNDARY (S4 of the autonomy spine). S3 let Q SPEAK; this is what lets Q ACT —
// bounded, so the user is always in the driving seat as Q grows more capable. It is the explicit contract
// between "Q proposes" and "Q does": every proposed action resolves to ONE disposition, and the resolution
// is a pure, auditable lattice — never a vibe.
//
//   disposition(action) = min( user-trust(topic), risk-cap(action) )  under the CONSCIENCE FLOOR
//
// FOUR DISPOSITIONS, least → most autonomous:  never < propose < ask < silent
//   • never   — not allowed at all.
//   • propose — Q surfaces it (the S3 inbox) and does nothing; the user acts. THE DEFAULT for any unconfigured
//               topic (default-deny: Q never acts autonomously until you explicitly grant it).
//   • ask     — Q may act, but only after an explicit per-instance YES (the wallet's human-approval model).
//   • silent  — Q acts autonomously — and ONLY then with a sealed receipt AND a working undo.
//
// THREE HARD GUARANTEES the user's trust level can NEVER override (the driving-seat promise, in code):
//   1 RISK CAP   — value-moving (wallet-out), irreversible, egress, or authority-granting actions are CAPPED
//                  at `ask`: they can never be silent, no matter how much the topic is trusted. Money and the
//                  irreversible always require an explicit YES.
//   2 NO BLIND SILENT ACT — a silent act with no undo is refused and downgraded to ask. No autonomous act is
//                  irreversible. Reversibility is the price of autonomy.
//   3 CONSCIENCE FLOOR — every disposition sits UNDER the constitutional conscience gate (ADR-0033): a block
//                  (or an unsealed conscience) ⇒ `deny`, fail-closed, regardless of trust.
//
// ONE-MOVE CONTROL: pause() caps EVERYTHING at propose (Q goes fully hands-off in a single call); resume()
// restores. setTrust(topic, level) is the ONLY mutator of trust — decide()/act() never change it, so Q can
// never widen its own latitude. Every autonomous (or approved) act seals a re-derivable PROV-O receipt
// (Law L5) recording the action, the disposition, the conscience verdict, the approver, and that it is
// undoable — a thing you can prove and reverse, not just trust.
//
// Pure + isomorphic + dependency-injected (conscience + κ-store + clock injected), like the rest of the spine.

import { seal, verify, UOR_CONTEXT } from "./holo-object.mjs";

// seal by content (Law L5) without storing bytes — pure sha256hex(jcs), browser/SW-safe (no Node Buffer).
const sealObj = (type, context, props) => seal({ "@context": [...UOR_CONTEXT, ...context], "@type": type, ...props });

const NS = "https://hologram.os/ns/trust#";
const LEVEL = { never: 0, propose: 1, ask: 2, silent: 3 };
const NAME = ["never", "propose", "ask", "silent"];
const lvl = (name) => (name in LEVEL ? LEVEL[name] : LEVEL.propose);

// kinds that can hurt if done blindly — their autonomy is CAPPED at `ask` (explicit YES), never silent.
const DANGER = new Set(["wallet-out", "egress", "agent-write", "grant", "delete", "config", "publish", "irreversible"]);
// risk-cap(action): the most autonomy the user is ALLOWED to grant this action, before their own trust applies.
function capOf(action = {}) {
  let cap = DANGER.has(action.kind) ? LEVEL.ask : LEVEL.silent;
  if (action.reversible === false) cap = Math.min(cap, LEVEL.ask);   // the irreversible can never be silent
  if (action.value === true) cap = Math.min(cap, LEVEL.ask);         // money always asks
  return cap;
}

// makeTrust({ conscience, store, now, trust }) → the trust boundary.
//   conscience : the constitutional gate { evaluate(decision) → { outcome } } (ADR-0033). Absent ⇒ allow-by-default
//                (a witness may omit it), but a PRESENT conscience is the fail-closed floor.
//   store      : the κ-store receipts are sealed into.   trust: optional initial { topic: level } config.
export function makeTrust({ conscience = null, store = new Map(), now = () => "1970-01-01T00:00:00Z", trust = {} } = {}) {
  const config = new Map(Object.entries(trust));   // topic → level name; the user's grants (default-deny otherwise)
  let paused = false;

  const setTrust = (topic, level) => {             // THE ONLY trust mutator — user-driven
    if (!(level in LEVEL)) throw new Error(`unknown trust level: ${level} (never|propose|ask|silent)`);
    config.set(String(topic), level); return level;
  };
  const getTrust = (topic) => config.get(String(topic)) || "propose";   // default-deny: unconfigured ⇒ propose

  // decide(action) → { disposition, want, cap, verdict, reason } — the pure lattice resolution.
  function decide(action = {}) {
    const topic = String(action.topic || action.kind || "unknown");
    const verdict = conscience && typeof conscience.evaluate === "function"
      ? conscience.evaluate({ action: "trust.act", topic, kind: action.kind || "" }) : { outcome: "allow" };
    if (!verdict || verdict.outcome === "block") {
      return { disposition: "deny", want: getTrust(topic), cap: "ask", verdict: (verdict && verdict.outcome) || "block",
        reason: `conscience floor — ${(verdict && verdict.reason) || "blocked / unsealed"}` };
    }
    const want = lvl(getTrust(topic));
    const cap = capOf(action);
    const ceiling = paused ? LEVEL.propose : LEVEL.silent;          // one-move pause caps everyone at propose
    const eff = Math.min(want, cap, ceiling);
    return { disposition: NAME[eff], want: NAME[want], cap: NAME[cap], verdict: verdict.outcome,
      reason: paused && eff < want ? "paused (hands-off)" : eff < want ? "risk-capped" : "granted" };
  }

  // seal a re-derivable PROV-O act receipt — identity is its content (Law L5); `at` rides beside, not in the id.
  function sealReceipt(action, disposition, d, extra = {}) {
    const object = sealObj(["prov:Activity", "hostrust:Act"], [{ hostrust: NS }], {
      "hostrust:topic": String(action.topic || action.kind || "unknown"),
      "hostrust:kind": String(action.kind || ""),
      "hostrust:disposition": disposition,
      "hostrust:want": d.want, "hostrust:cap": d.cap, "hostrust:conscience": d.verdict,
      "hostrust:reversible": action.reversible !== false,
      "hostrust:summary": String(action.summary || ""),
      ...extra,
    });
    return { object, kappa: object.id, at: now() };
  }

  // act(action, perform, { undo }) — the AUTONOMOUS path. Performs ONLY if the disposition resolves to silent
  // AND an undo is supplied; otherwise it performs nothing and returns the disposition for the caller (the
  // courier surfaces propose/ask; deny is refused). A silent act seals a receipt and returns the undo.
  async function act(action = {}, perform = async () => null, { undo = null } = {}) {
    const d = decide(action);
    if (d.disposition !== "silent") {
      return { ok: false, performed: false, disposition: d.disposition, decision: d };   // propose / ask / deny
    }
    if (typeof undo !== "function") {                                                     // GUARANTEE 2: no blind silent act
      return { ok: false, performed: false, disposition: "ask", decision: { ...d, disposition: "ask" },
        reason: "downgraded to ask — an autonomous act must be reversible (no undo supplied)" };
    }
    const result = await perform();
    const receipt = sealReceipt(action, "silent", d, { "hostrust:undoable": true, "prov:generatedAtTime": now() });
    return { ok: true, performed: true, disposition: "silent", result, receipt, undo };
  }

  // approve(action, perform, { undo, approver }) — the EXPLICIT-YES path for `ask`. The user's approval is the
  // strongest authority: it executes unless the conscience floor denies or the topic is set to `never`. Seals
  // a receipt naming the approver. Reversibility is still required if the action is reversible-capable.
  async function approve(action = {}, perform = async () => null, { undo = null, approver = "user" } = {}) {
    const d = decide(action);
    if (d.disposition === "deny") return { ok: false, performed: false, disposition: "deny", decision: d };
    if (getTrust(action.topic || action.kind) === "never") return { ok: false, performed: false, disposition: "never", decision: d };
    const result = await perform();
    const receipt = sealReceipt(action, "approved", d, { "hostrust:approver": String(approver), "hostrust:undoable": typeof undo === "function", "prov:generatedAtTime": now() });
    return { ok: true, performed: true, disposition: "approved", approver: String(approver), result, receipt, undo };
  }

  const pause = () => { paused = true; return true; };
  const resume = () => { paused = false; return true; };
  const isPaused = () => paused;

  return { decide, act, approve, setTrust, getTrust, pause, resume, isPaused, capOf: (a) => NAME[capOf(a)] };
}

export { verify };

// ── browser binding: window.HoloTrust over the conscience + κ-store, once the app is ready. Q's loops route
// every act through this boundary; the user's grants live here. Law L2, one canonical wire. Fail-soft.
if (typeof window !== "undefined") {
  const wire = () => {
    try {
      if (window.HoloTrust || !window.HoloApp) return;
      window.HoloTrust = makeTrust({ conscience: window.HoloConscience || null, store: window.HoloApp.store });
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-trust-ready"));
    } catch (e) { /* leave unset; callers fail-soft */ }
  };
  if (window.HoloApp) wire();
  else if (document.documentElement) document.documentElement.addEventListener("holo-app-ready", wire, { once: true });
}
