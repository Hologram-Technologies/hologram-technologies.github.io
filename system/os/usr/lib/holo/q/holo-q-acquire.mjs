// holo-q-acquire.mjs — ADR-0114 S3: the ONE sanctioned path from a skill gap to a bound, served model.
//
// Q detects it lacks a skill → discover a specialist (ADR-0084 pickSpecialist, pure) → AUTHORIZE the acquisition
// (ADR-0114 S2, holo-q-authz) → forge it to a κ-addressed .holo → bind it as the task provider. authorize() is
// NOT optional and NOT bypassable: forge is reached only after accept, and a pinned acquisition is guarded to the
// manifest κ end-to-end (provenance + integrity, not just L5 integrity). Every refusal falls back to the main
// model — never blocks, never fakes (the ADR-0084 honest-pending voice). Warm: a κ-cached model rebinds with no
// download/forge. Pure orchestration; all IO injected. Relates: ADR-0114 · ADR-0084 · ADR-0033 · ADR-0096.

import { authorize as defaultAuthorize } from "./holo-q-authz.mjs";

// acquireSpecialist(taskId, ctx) -> { bound, warm?, tier?, kappa?, provider? } | { bound:false, fallback:"main", reason }
//   ctx: {
//     pickSpecialist(taskId, opts) -> plan        // ADR-0084, pure discovery (injected; it is network-bound)
//     authorize?(plan, authCtx) -> { accept, … }  // defaults to holo-q-authz.authorize
//     authCtx                                      // { manifest, conscience, detail, consent, crypto } for the gate
//     forge(model, { pinKappa, onProgress }) -> holo   // HF range-download → forge → seal .holo (S1); pinKappa guards
//     makeProvider(holo, model) -> provider        // openHoloStream → holoBrainEngine (the brain provider contract)
//     bindSpecialist(taskId, provider) -> { task, provider }   // ADR-0084 runtime bind
//     cache?                                       // Map-like { get, set } keyed by repo id → holo (the warm path)
//     discoverOpts?, onProgress?
//   }
export async function acquireSpecialist(taskId, ctx = {}) {
  const { pickSpecialist, authorize = defaultAuthorize, authCtx = {}, forge, makeProvider, bindSpecialist, cache, discoverOpts, onProgress } = ctx;

  const plan = await pickSpecialist(taskId, discoverOpts);
  if (!plan || !plan.specialist) return { bound: false, fallback: "main", reason: (plan && plan.reason) || "no browser-runnable specialist" };

  // THE GATE — reached before any download/forge. A refusal falls back to main (never fakes).
  const auth = await authorize(plan, authCtx);
  if (!auth.accept) return { bound: false, fallback: "main", reason: auth.reason };

  const repo = auth.model.id;
  let holo = cache && typeof cache.get === "function" ? cache.get(repo) : null;
  const warm = !!holo;
  if (!holo) {
    try {
      // pinKappa is set only for the "pinned" tier → forge verifies the streamed .holo against the manifest κ
      holo = await forge(auth.model, { pinKappa: auth.tier === "pinned" ? auth.model.kappa : null, onProgress });
    } catch (e) {
      return { bound: false, fallback: "main", reason: "forge refused: " + (e && e.message ? e.message : String(e)) };
    }
    if (cache && typeof cache.set === "function") cache.set(repo, holo);
  }

  const provider = await makeProvider(holo, auth.model);
  const b = bindSpecialist(taskId, provider);
  return { bound: true, warm, tier: auth.tier, kappa: auth.model.kappa || (holo && holo.kappa) || null, provider: b && b.provider };
}
