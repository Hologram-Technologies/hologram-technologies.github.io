// holo-evolve.mjs — CLOSE THE LOOP (S0 of the Q-unification: perceive → reason → speak → ACT → re-perceive).
// The verdict found the pieces of "self-evolving Q" all built but disconnected: the spine OBSERVES (proposals),
// the factory CAN FIX, and the trust boundary CAN GOVERN — but nothing wires observe → propose-fix → decide →
// ship → re-observe, and Q.trust was attached yet never called. This is the missing connective tissue, and it
// makes Q.trust LOAD-BEARING: every autonomous fix ships ONLY through trust.act, so the boundary that keeps the
// user in the seat is the real gate, not decoration.
//
//   step(observation) → { applied[], surfaced[], skipped[] }
//     • observation : an S2 observe() result (ranked proposals — what Q noticed).
//     • for the top proposal(s): ask the factory for a fix PLAN, then put SHIPPING it through trust.act —
//       which performs it ONLY if the disposition resolves to `silent` (topic granted + reversible + an undo),
//       sealing a receipt; otherwise it is SURFACED (propose/ask) and Q acts only after you say so. Nothing
//       value-moving or irreversible can ever ship silently (trust's risk cap). Default-deny ⇒ propose-only
//       until you grant a topic — Q earns autonomy, it doesn't assume it.
//     • after a fix ships, onApplied re-observes, so the loop CLOSES: the next snapshot shows the concern gone
//       (or it doesn't, and Q tries again / surfaces it). Self-improvement you can prove and reverse.
//
// Q NEVER acts on its own outside this gate. Human commands stay sovereign (Q.act); this governs Q's
// UNPROMPTED acts. Pure + dependency-injected (trust, the fix proposer, the re-observe hook) — Node-witnessed.

// makeEvolve({ trust, propose, topN, onApplied }) → { step }.
//   trust   : a makeTrust() boundary (the single action gate; conscience floor lives under it).
//   propose : async (proposal) → fix PLAN | null. The factory adapter: given a concern, produce a
//             SHIPPABLE, REVERSIBLE change — { summary, reversible?, value?, kind?, apply:async()=>any, undo:()=>any }.
//             Returns null when the factory can't fix it (honest stop — Q still surfaced the heads-up via S3).
//   topN    : how many of the ranked proposals to attempt per step (default 1 — the single most salient).
//   onApplied : optional (proposal, result) → void — the re-observe hook that closes the loop.
export function makeEvolve({ trust, propose, topN = 1, onApplied = null } = {}) {
  if (!trust || typeof trust.act !== "function") throw new Error("makeEvolve needs a makeTrust() boundary ({ act })");
  if (typeof propose !== "function") throw new Error("makeEvolve needs a propose(proposal) → fix plan adapter");

  async function step(observation = {}) {
    const proposals = (observation.proposals || []).slice(0, topN);
    const applied = [], surfaced = [], skipped = [];
    for (const p of proposals) {
      let plan = null;
      try { plan = await propose(p); } catch (e) { plan = null; }
      if (!plan || typeof plan.apply !== "function") { skipped.push({ subject: p.subject, reason: "no fix available" }); continue; }
      // SHIP only through trust — the single gate. trust.act performs iff the disposition is `silent` AND an
      // undo is supplied; otherwise it returns the disposition (propose/ask/deny) and performs nothing.
      const action = {
        topic: p.subject, kind: plan.kind || "self-fix",
        reversible: plan.reversible !== false, value: !!plan.value,
        summary: plan.summary || ("fix " + p.subject),
      };
      const r = await trust.act(action, plan.apply, { undo: typeof plan.undo === "function" ? plan.undo : null });
      if (r.performed) {
        applied.push({ subject: p.subject, disposition: "silent", receipt: r.receipt && r.receipt.kappa, undo: r.undo });
        try { if (onApplied) await onApplied(p, r); } catch (e) {}     // CLOSE THE LOOP — re-observe
      } else {
        surfaced.push({ subject: p.subject, disposition: r.disposition });   // propose/ask/deny — Q waits for you
      }
    }
    return { applied, surfaced, skipped, acted: applied.length > 0 };
  }

  return { step };
}

// ── browser binding: window.HoloEvolve once Q.trust is up. The spine's cadence (holo-spine runOnce) calls
// HoloEvolve.step(observation) AFTER the courier speaks, so Q both tells you AND (within granted trust) fixes.
// The `propose` adapter wraps the real factory + a live surface adopter; the re-observe hook re-runs the spine.
if (typeof window !== "undefined") {
  const wire = () => {
    try {
      if (window.HoloEvolve || !(window.Q && window.Q.trust)) return;
      // a conservative default adapter, read LAZILY: until a factory + live adopter bind window.__holoFixProposer,
      // propose() returns null (Q only surfaces a heads-up, never fabricates a fix). Lazy so the shell can bind
      // the proposer after boot without re-wiring the loop.
      const propose = (p) => { try { return window.__holoFixProposer ? window.__holoFixProposer(p) : null; } catch (e) { return null; } };
      window.HoloEvolve = makeEvolve({ trust: window.Q.trust, propose, onApplied: () => { try { window.HoloSpine && window.__holoHeal && window.HoloSpine.runOnce({ heal: window.__holoHeal }); } catch (e) {} } });
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-evolve-ready"));
    } catch (e) { /* leave unset; the spine call is guarded */ }
  };
  if (window.Q && window.Q.trust) wire();
  else if (document.documentElement) document.documentElement.addEventListener("holo-spine-ready", wire, { once: true });
}
