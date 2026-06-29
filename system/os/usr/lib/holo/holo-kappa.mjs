// holo-kappa.mjs — the ONE canonical κ seam (Law L1/L2). The substrate's address of bytes is
// BLAKE3: kappo(bytes) = "did:holo:blake3:<hex>". This is the single function the whole system
// mints and verifies κ through — render, LLM, media, seal — so the canonical axis lives in exactly
// one place. SHA-256 is NOT a κ here; it is a *bridge* encoding for foreign protocols (IPFS CIDs,
// GitHub release asset names, SRI/CSP). shaBridge() is named so those boundaries are legible and a
// grep for "sha" reads as "this is an external bridge," not "incomplete migration."
//
// Pure + self-contained beyond the one BLAKE3 implementation (holo-blake3.mjs): node-, Service-
// Worker- and DOM-safe. No second hash. crypto.subtle has no BLAKE3, which is exactly why the
// substrate carries its own kappo() rather than leaning on WebCrypto for its canonical address.

import { blake3hex } from "./holo-blake3.mjs";

const HEX = /^[0-9a-f]{64}$/;
export const KAPPA_PREFIX = "did:holo:blake3:";

// kappoHex(bytes) → 64-hex BLAKE3 — the bare content address.
export const kappoHex = (bytes) => blake3hex(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

// kappo(bytes) → "did:holo:blake3:<hex>" — the canonical κ DID (Law L1).
export const kappo = (bytes) => KAPPA_PREFIX + kappoHex(bytes);

// hexOf(κ) → the 64-hex tail of any κ DID / label form ("did:holo:blake3:…", "blake3:…", bare hex).
export const hexOf = (k) => String(k).split(":").pop().toLowerCase();

// isKappa(κ) → is this a well-formed BLAKE3 κ (any accepted form)?
export const isKappa = (k) => HEX.test(hexOf(k));

// kappoVerify(bytes, κ) → true iff bytes re-derive to κ (Law L5 — the admission check).
export const kappoVerify = (bytes, k) => kappoHex(bytes) === hexOf(k);

// ── external-protocol bridge (NOT a κ) ───────────────────────────────────────────────
// shaBridge(bytes) → sha-256 hex. Use ONLY at a foreign-protocol boundary (IPFS, GitHub asset
// names, SRI). Async because the canonical SHA path is WebCrypto where available, node:crypto else.
export async function shaBridge(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (globalThis.crypto && globalThis.crypto.subtle) {
    const d = await crypto.subtle.digest("SHA-256", u);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(u).digest("hex");
}

export default { kappo, kappoHex, kappoVerify, hexOf, isKappa, shaBridge, KAPPA_PREFIX };
