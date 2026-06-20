// holo-fix-proposer.mjs — A REAL FIX PROPOSER (C5 of the autonomy spine). The evolve loop (holo-evolve.mjs)
// ships a fix ONLY through trust.act; until now no proposer was bound, so Q could only SURFACE concerns. This
// is the real adapter: for the concerns Q raises, it produces SAFE, REVERSIBLE fixes the OS already knows how
// to do — with NO code-generating brain required — and honestly STOPS (returns null ⇒ Q just surfaces) on the
// ones that do need one. So Q starts actually fixing things, within granted trust, reversibly.
//
//   makeFixProposer({ reloadApp, reHeal, maxReloads }) → async (proposal) → fix PLAN | null
//     • app.error      → RELOAD the crashed app frame (reversible: it reopens, nothing destroyed). Capped per
//                        app so a persistently-crashing app is surfaced, not reload-looped (honest stop).
//     • heal.unresolved / heal.flaky → RE-ATTEMPT recovery (the heal sweep re-derives from every source incl.
//                        mesh/IPFS; reversible: heal only admits L5-verified bytes, never destroys). Recovers
//                        if a source has since become reachable; a true dead-end simply no-ops.
//     • gate.red / anything else → null. An honest stop: repairing a failing conformance row needs a real
//                        code-gen brain (the factory), not an operational action — so Q surfaces it instead.
//
// Every plan is REVERSIBLE with an undo, so trust.act can ship it silently only where the user granted it and
// the risk cap allows. Pure + dependency-injected (reloadApp/reHeal are the live seams) — Node-witnessed.

export function makeFixProposer({ reloadApp = null, reHeal = null, maxReloads = 2 } = {}) {
  const reloads = new Map();   // app subject → times reloaded this session (the crash-loop cap)

  return async function propose(proposal = {}) {
    const kind = String(proposal.kind || ""), subject = String(proposal.subject || "");

    if (kind === "app.error") {
      if (typeof reloadApp !== "function") return null;
      const n = reloads.get(subject) || 0;
      if (n >= maxReloads) return null;                 // a persistently-crashing app → surface it, don't loop
      return {
        kind: "app.reload", reversible: true,
        summary: `reload ${subject}`,
        apply: async () => { reloads.set(subject, n + 1); const ok = await reloadApp(subject); return { reloaded: !!ok, app: subject }; },
        undo: () => {},                                  // the app reopened; nothing to revert
      };
    }

    if (kind === "heal.unresolved" || kind === "heal.flaky") {
      if (typeof reHeal !== "function") return null;
      return {
        kind: "heal.retry", reversible: true,
        summary: `re-attempt recovery (${subject})`,
        apply: async () => { const r = await reHeal(); return { reHealed: true, result: r || null }; },
        undo: () => {},                                  // heal only admits L5-verified bytes — nothing to revert
      };
    }

    return null;                                         // gate.red & all else — needs a code brain; Q surfaces it
  };
}

// ── browser binding: window.__holoFixProposer over the live seams, once Q.trust + the spine are up. The evolve
// loop reads __holoFixProposer lazily, so binding it here flips Q from propose-only to ACTUALLY FIXING (within
// granted trust). reloadApp = the shell's __holoAppReload seam; reHeal = the heal supervisor's manual tick.
if (typeof window !== "undefined") {
  const wire = () => {
    try {
      if (window.__holoFixProposer) return;
      const reloadApp = (name) => { try { return typeof window.__holoAppReload === "function" ? window.__holoAppReload(name) : false; } catch (e) { return false; } };
      const reHeal = async () => { try { return typeof self.__holoHealTick === "function" ? await self.__holoHealTick() : null; } catch (e) { return null; } };
      window.__holoFixProposer = makeFixProposer({ reloadApp, reHeal });
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-fix-proposer-ready"));
    } catch (e) { /* leave unset; evolve stays propose-only (safe) */ }
  };
  if (window.Q && window.Q.trust) wire();
  else if (document.documentElement) document.documentElement.addEventListener("holo-spine-ready", wire, { once: true });
}

export default { makeFixProposer };
