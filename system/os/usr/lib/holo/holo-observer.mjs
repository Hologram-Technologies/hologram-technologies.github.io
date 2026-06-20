// holo-observer.mjs — Q'S AMBIENT OBSERVER (S2 of the autonomy spine: sense → reason → speak). This is the
// reactive→copilot pivot. S0 made the OS observable; S1 folded it into "what's true now" (a coherence
// snapshot). This READS that snapshot and decides what is worth RAISING — emitting ranked PROPOSALS, never
// actions. Q proposes; it does not act. (Acting is gated at S4 behind the trust boundary.) A proposal is
// inert data: a subject, a rationale, a suggested action, a salience. Nothing here executes anything.
//
// The discipline is the point — a copilot that raises everything is noise. So the observer reuses the
// WITNESSED Holo Control DSP core (holo-control-dsp.js): SALIENCE = magnitude × novelty × governance-risk
// ranks what deserves the user's eyes, and HYSTERESIS (raise at `hi`, release below `lo`) stops a borderline
// concern from flapping in and out. Two properties fall out, both the inbox (S3) will depend on:
//   • NO-NOISE: a whole + coherent snapshot has an empty attention set ⇒ zero proposals (nothing to say).
//   • ANTI-NAG: novelty decays as a concern persists, so a freshly-broken thing is raised prominently and a
//     CHRONIC known one fades out of the raised set — Q flags the new, it does not nag about the old.
//
//   observe(snapshot) → { proposals[ranked], object, kappa, quiet, snr }   // stateful across ticks (hysteresis)
//
// The observer is STATEFUL across ticks (hysteresis + novelty need history) but DETERMINISTIC — no clock, no
// randomness — so a witness replays a snapshot sequence and gets byte-identical proposals. The proposal SET
// seals to a self-verifying κ (identity = its content, no clock) that prov:wasDerivedFrom the snapshot —
// every proposal is traceable to the reflection it came from (Law L5). Pure + dependency-injected: the DSP
// and κ-store are injected (the witness passes the real DSP; the browser passes window.HoloControlDSP).

import { seal, verify, UOR_CONTEXT } from "./holo-object.mjs";

// seal by content (Law L5) without storing bytes — pure sha256hex(jcs), browser/SW-safe (no Node Buffer).
const sealObj = (type, context, props) => seal({ "@context": [...UOR_CONTEXT, ...context], "@type": type, ...props });

const NS = "https://hologram.os/ns/observer#";
const round3 = (x) => Math.round(x * 1000) / 1000;

// per-attention-kind → how the observer scores and phrases it. z is a representative anomaly magnitude fed
// to the DSP squash; risk is the governance weight (a red REQUIRED row blocks a release; an unrecoverable
// object is data loss; a flaky κ is instability). action is the inert suggestion S3 may turn into a message.
// say() is Q's own voice — first-person, calm, specific. It is the HANDED message body (the courier never
// rewrites it), so this is literally what Q tells the user. High signal, no alarm theatre.
const KIND = {
  "app.error": { z: 6, risk: 0.7,
    say: (ref) => `${ref} ran into a problem. Open it to see what happened, or ask me to look.` },
  "gate.red": { z: 6, risk: 0.8,
    say: (ref) => `Conformance row ${ref} is failing. Required rows block a release until they pass.` },
  "heal.unresolved": { z: 6, risk: 0.9,
    say: (ref) => `${ref} object${ref === "1" ? "" : "s"} can't be recovered from any source. Pin ${ref === "1" ? "it" : "them"} or connect a peer before you need ${ref === "1" ? "it" : "them"}.` },
  "heal.flaky": { z: 3, risk: 0.5,
    say: (ref) => `A source keeps needing repair and is looking unstable. I'll keep watching it.` },
};
const DEFAULT_KIND = { z: 2, risk: 0.3, say: (ref) => `Something is worth a look: ${ref}.` };

// makeObserver({ dsp, store, hi, lo }) → { observe, raised }.
//   dsp  : the Holo Control DSP core (salience · hysteresis · rank · aggregateSnr) — injected, reused, witnessed.
//   store: the κ-store the sealed proposal-set is put into.
//   hi/lo: the hysteresis band (raise at hi, release below lo). Defaults match the dashboard's calm gates.
export function makeObserver({ dsp, store = new Map(), hi = 0.66, lo = 0.4 } = {}) {
  if (!dsp || typeof dsp.salience !== "function" || typeof dsp.hysteresis !== "function") {
    throw new Error("makeObserver needs the Holo Control DSP core ({ salience, hysteresis, rank, aggregateSnr })");
  }
  const mem = new Map();   // subjectId → { ticksSeen, active } — hysteresis + novelty state (deterministic)

  // A concern's stable IDENTITY. Usually its ref IS its identity (an app name, a row id, a κ hex). But a kind
  // whose ref is a live scalar (e.g. heal.unresolved's count) declares an explicit `subject` so it stays ONE
  // concern as the scalar moves — otherwise every count would read as a brand-new concern (a growing pile).
  const subjectOf = (it) => (it && it.subject != null ? String(it.subject) : String(it && it.ref));

  function observe(snapshot = {}) {
    const items = snapshot.attention || (snapshot.object && snapshot.object["holcoh:attention"]) || [];
    const derivedFrom = snapshot.kappa || (snapshot.object && snapshot.object.id) || null;
    const present = new Map(items.map((it) => [it.kind + ":" + subjectOf(it), it]));
    const ids = [...new Set([...present.keys(), ...mem.keys()])].sort();   // union (so a gone concern is released), stable order

    const proposals = [];
    for (const id of ids) {
      const it = present.get(id);
      const st = mem.get(id) || { ticksSeen: -1, active: false };
      let sal = 0, novelty = 0;
      if (it) {
        const k = KIND[it.kind] || DEFAULT_KIND;
        st.ticksSeen = Math.min(st.ticksSeen + 1, 64);
        novelty = 1 / (1 + st.ticksSeen);                         // 1 when first seen, decays as it persists (anti-nag)
        sal = dsp.salience({ z: k.z, novelty, risk: k.risk });
      }                                                            // absent subject ⇒ sal 0 ⇒ hysteresis releases it
      const active = dsp.hysteresis(st.active, sal, { hi, lo });
      st.active = active;
      if (it && active) mem.set(id, st);
      else if (it) mem.set(id, st);                               // still tracked (for novelty/decay) though not raised
      else mem.delete(id);                                        // gone AND released ⇒ stop tracking

      if (active && it) {
        const k = KIND[it.kind] || DEFAULT_KIND;
        proposals.push({
          id, kind: it.kind, subject: subjectOf(it), salience: round3(sal), novelty: round3(novelty),
          rationale: novelty > 0.5 ? "new" : "persisting",
          suggestedAction: k.say(it.ref),
        });
      }
    }

    const ranked = dsp.rank(proposals);
    const object = sealObj(["prov:Entity", "holobs:ProposalSet"], [{ holobs: NS }], {
      "holobs:count": ranked.length,
      "holobs:proposals": ranked,
      ...(derivedFrom ? { "prov:wasDerivedFrom": derivedFrom } : {}),
    });
    const snr = dsp.aggregateSnr(ranked.length ? ranked : [{ salience: 0 }]);
    return { proposals: ranked, object, kappa: object.id, quiet: ranked.length === 0, snr };
  }

  // raised() — the subjects currently in the raised (alerting) state, for inspection. Pure read.
  const raised = () => [...mem.entries()].filter(([, s]) => s.active).map(([id]) => id).sort();

  return { observe, raised };
}

export { verify };

// ── browser binding: window.HoloObserver over the DSP + κ-store, once both coherence and the DSP are ready.
// It does NOT start a loop — S2 only decides what's worth raising when asked; S3 (the inbox) owns cadence and
// the final send filter. Fail-soft if the substrate or the DSP global is absent.
if (typeof window !== "undefined") {
  const wire = () => {
    try {
      if (window.HoloObserver || !window.HoloApp || !window.HoloControlDSP) return;
      window.HoloObserver = makeObserver({ dsp: window.HoloControlDSP, store: window.HoloApp.store });
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-observer-ready"));
    } catch (e) { /* leave unset; callers fail-soft */ }
  };
  if (window.HoloApp && window.HoloControlDSP) wire();
  else if (document.documentElement) document.documentElement.addEventListener("holo-coherence-ready", wire, { once: true });
}
