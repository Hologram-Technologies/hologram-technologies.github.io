// holospace-identity.mjs — root a holospace in the TEE-authorized owner (the keystone gap of the sovereign
// holospace: κ-addressable identity + TEE authorisation).
//
// A holospace is OWNED by an operator — a Hologram DID κ (holo-identity). Its STATE (disk/snapshot/spec bytes)
// is AES-GCM sealed under a key DERIVED FROM the operator's TEE secret (the "It's me" WebAuthn assertion,
// holo-session.deriveOperatorKeyBytes) — so a holospace opens ONLY under that operator's biometric, on this
// device. Privileged ops are gated by a TEE step-up whose challenge IS the action's κ (holo-stepup) — bound to
// the exact action, fail-closed (no TEE ⇒ refused, never a weaker path). Guests get an EPHEMERAL, UNSEALED
// holospace (mirror a Linux live session) that they can CLAIM — re-seal under a real operator — on sign-in.
//
// Identity-rooting + content-addressing together: WHO owns it (owner DID) + that it's INTACT (κ, L5) + that only
// the TEE owner can OPEN it (AES-GCM under the TEE-derived key). No new crypto — composes the substrate.

import { makeCipher, deriveOperatorKeyBytes } from "./holo-session.mjs";
import { ephemeral } from "./holo-identity.mjs";
import { requireStepUp } from "./holo-stepup.mjs";
import { withFields } from "./holospace.mjs";

const u8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));

// ── ownership: a holospace is bound to an operator DID (part of its identity/manifest) ──
export const ownHolospace = (spec, ownerDID) => withFields(spec, { owner: String(ownerDID) });
export const ownerOf = (manifest) => (manifest && manifest.owner) || null;
export const isOwnedBy = (manifest, operator) => ownerOf(manifest) === String(operator);

// ── the seal: state sealed under the operator's TEE-derived key (secret = the TEE assertion, NEVER stored) ──
async function operatorCipher(operator, secret, deviceSalt) {
  return makeCipher(await deriveOperatorKeyBytes(operator, secret, deviceSalt));
}
// sealState(stateBytes, operator, secret, deviceSalt) → iv‖ct. Deterministic per (key,plaintext) — κ-memo holds.
export async function sealState(stateBytes, operator, secret, deviceSalt) {
  return (await operatorCipher(operator, secret, deviceSalt)).seal(u8(stateBytes));
}
// openState(blob, operator, secret, deviceSalt) → bytes, or NULL on wrong operator/secret or tamper (AES-GCM
// auth + L5). A holospace cannot be opened by anyone but its TEE-authorized owner.
export async function openState(blob, operator, secret, deviceSalt) {
  return (await operatorCipher(operator, secret, deviceSalt)).open(u8(blob));
}

// ── the TEE gate: a step-up for a privileged holospace op (mount device files, egress, share, claim) ──
// The challenge IS the holospace/action κ → the biometric is bound to THIS exact action. FAIL-CLOSED: no TEE
// present ⇒ requireStepUp throws (never a weaker path). Returns { token, secret } — the secret derives the seal key.
export async function gateAction({ kind, holospaceKappa, operator, reason = "" }, { credentialId } = {}) {
  if (!operator) throw new Error("holospace gate needs the owner operator κ");
  return requireStepUp({ kind, payload: holospaceKappa, operator, reason, appId: "holospace" },
                       { credentialId, exposeSecret: true });
}

// ── guests: an ephemeral, UNSEALED holospace (live session); CLAIM re-seals it under a real operator ──
export async function guestHolospace(spec) {
  const guest = await ephemeral({ label: "Guest" });
  return { manifest: ownHolospace(spec, guest.kappa), guest, sealed: false };
}
// claimGuest(overlayBytes, spec, operator, secret, deviceSalt) — sign in (TEE) → adopt the ephemeral overlay
// into an OWNED, SEALED holospace. The work survives, now sovereign (caller appends it to holo-home separately).
export async function claimGuest(overlayBytes, spec, operator, secret, deviceSalt) {
  return { manifest: ownHolospace(spec, operator),
           sealed: await sealState(overlayBytes, operator, secret, deviceSalt),
           owner: String(operator) };
}

export default { ownHolospace, ownerOf, isOwnedBy, sealState, openState, gateAction, guestHolospace, claimGuest };
