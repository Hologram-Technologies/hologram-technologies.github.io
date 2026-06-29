// holospace-lifecycle.mjs — snapshot & resume a running holospace, SEALED to the TEE owner. This is the fusion:
// the surviving machine (engine `suspend()`/`resume`) × the identity/TEE layer (own/seal/open) × a κ-store
// (persist by content address) × holo-home (roam across devices). The keystone of the sovereign holospace.
//
//   snapshot: machine.suspend() → sealState(under TEE key) → κ = address(sealed blob) → store.put + home.addSpace
//   resume:   store.get(κ) → openState(owner+TEE only) → machine.resume(bytes)   [null ⇒ REFUSED: not the owner/tamper]
//
// The user's STATE (the snapshot) seals under their TEE key; the public kernel/runtime κ are NOT sealed (shared,
// dedup). A snapshot opens ONLY for its owner, on their device — a second identity or a tampered blob is refused.

import { kappo } from "./holo-kappa.mjs";
import { ownHolospace, sealState, openState } from "./holospace-identity.mjs";

// snapshot({ machine, spec, owner, secret, deviceSalt }, { store, home, name })
//   machine.suspend(): Uint8Array (the live VM state). Returns { kappa, manifest, owner }.
export async function snapshot({ machine, spec, owner, secret, deviceSalt }, { store, home = null, name = "" } = {}) {
  if (!machine || typeof machine.suspend !== "function") throw new Error("snapshot needs a machine with suspend()");
  const bytes = await machine.suspend();
  const blob  = await sealState(bytes, owner, secret, deviceSalt);   // sealed under the operator's TEE key
  const kappa = kappo(blob);                                         // content address of the SEALED bytes
  if (store) await store.put(kappa, blob);
  const manifest = ownHolospace({ ...(spec || {}), snapshot: kappa }, owner);
  if (home && name) await home.addSpace(kappa, name);               // roam with the user (signed κ-strand)
  return { kappa, manifest, owner: String(owner) };
}

// resume({ kappa, machine, owner, secret, deviceSalt }, { store })
//   → { ok:true } after machine.resume(bytes); → { ok:false, reason } if not the owner / wrong secret / tampered.
export async function resume({ kappa, machine, owner, secret, deviceSalt }, { store } = {}) {
  if (!machine || typeof machine.resume !== "function") throw new Error("resume needs a machine with resume()");
  const blob = store ? await store.get(kappa) : null;
  if (!blob) return { ok: false, reason: "snapshot κ not found" };
  const bytes = await openState(blob, owner, secret, deviceSalt);
  if (!bytes) return { ok: false, reason: "refused — not the owner, wrong device, or tampered snapshot" };
  await machine.resume(bytes);
  return { ok: true, bytes };
}

export default { snapshot, resume };
