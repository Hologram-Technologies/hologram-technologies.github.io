// holo-plainwords.mjs — the PLAIN-WORDS layer. It removes wall #3: crypto jargon in the default path
// (wallet · κ · did: · seal · sovereign · holospace · delegate · attest). The substrate keeps its precise
// internal vocabulary; this is the presentation seam that ensures my mother only ever sees plain English and
// human NAMES — never a Greek letter, a DID, or a hash. It is the complement to the consent/onboarding
// deny-lists: where they refuse to SHOW jargon, this MAPS it to plain words and strips raw addresses.
//
// Pure + deterministic (node-witnessable). Surfaces (shell, identity, wallet, splash) adopt it for any
// user-facing string and for object titles (via truenames / three-words, never the hash).

import { JARGON } from "./holo-consent.mjs";

// substrate noun → plain word. Empty string = "drop it entirely" (the user never needed that concept).
const PLAIN = {
  "wallet": "Money",
  "sign in": "Continue", "sign-in": "Continue", "signin": "Continue",
  "holospace": "space", "holospaces": "spaces",
  "did:holo": "", "did": "",
  "sealed": "saved", "seal": "save",
  "attest": "confirm", "attestation": "confirmation",
  "delegate": "let it act for you",
  "sovereign": "", "passkey": "",
  "biometric": "fingerprint or face",
  "kappa": "", "principal": "you", "credential": "pass",
};

// noun(concept) → its plain word (or the concept unchanged if not jargon).
export function noun(concept) {
  const k = String(concept).toLowerCase();
  return Object.prototype.hasOwnProperty.call(PLAIN, k) ? PLAIN[k] : concept;
}

// humanize(text) → strip raw κ/DID addresses + the κ symbol, then map every jargon token to plain words.
export function humanize(text) {
  let out = String(text);
  out = out.replace(/did:holo:[a-z0-9]+:[0-9a-f]+/gi, "");     // raw κ / DID address → gone
  out = out.replace(/did:holo/gi, "");                          // bare did:holo → gone
  out = out.replace(/κ/g, "");                                  // the Greek letter → gone
  for (const [j, p] of Object.entries(PLAIN)) {
    out = out.replace(new RegExp("\\b" + j.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), p);
  }
  return out.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim();
}

// displayName(kappa, { name, words }) → the human label for a thing. NEVER the hash: prefer a given name,
// else its three-words / truename, else a friendly fallback.
export function displayName(kappa, { name = null, words = null } = {}) {
  return (name && String(name).trim()) || (words && String(words).trim()) || "untitled";
}

// isJargon(word) → is this on the deny-list the surfaces must not show?
export function isJargon(word) { return JARGON.includes(String(word).toLowerCase()); }

export default { noun, humanize, displayName, isJargon, PLAIN };
