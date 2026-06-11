// holo-uor.mjs — THE one canonical content-addressing primitive for Hologram OS, a downstream
// of UOR-ADDR (uor-foundation/uor-addr): a κ-label is `<axis>:<hex>` = H(canonical_form). The
// engine's Law L2 ("canonical forms only — canonicalize at the ingest boundary, hold κ") is
// made literal here: canonicalization + the σ-axis hashes + the multibase/SRI digests live in
// ONE module, never re-derived per file. Every product path — the holospace descriptor, the
// UOR object envelope, the witnesses — imports these. Pure Node (node:crypto).
//
// Equivalence to the engine's σ-axis is witnessed against its cc1 hash-KATs
// (kappa-uor-equivalence-witness.mjs); that is what makes us a CANONICAL downstream, not a
// lookalike. Authorities: UOR-ADDR (κ-label = H(canonical_form)); IETF RFC 8785 (JCS);
// multiformats (multihash); W3C Subresource Integrity / VC Data Integrity (digestSRI/Multibase).

import { createHash } from "node:crypto";

// RFC 8785 JSON Canonicalization Scheme — the canonical_form for JSON-LD objects. Sufficient
// for string/number/array/object descriptors (sorted keys, arrays in order).
export const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
  : JSON.stringify(v);

const buf = (x) => Buffer.isBuffer(x) ? x : Buffer.from(x);

// the σ-axis: SHA-256 over a canonical form → the open-web κ axis (Web Crypto / SRI speak it).
export const sha256bytes = (x) => createHash("sha256").update(buf(x)).digest();
export const sha256hex = (x) => sha256bytes(x).toString("hex");

// W3C Subresource Integrity / VC Data Integrity digest (a browser verifies it; L5 = SRI).
export const sriOf = (x) => "sha256-" + sha256bytes(x).toString("base64");

// multibase(base64url) multihash: sha2-256 = 0x12, blake3 = 0x1e (the native fast axis).
const multihash = (code, digest) => "u" + Buffer.concat([Buffer.from([code, digest.length]), digest]).toString("base64url");
export const mbSha256 = (x) => multihash(0x12, sha256bytes(x));
export const mbBlake3 = (hex) => multihash(0x1e, Buffer.from(hex, "hex"));

// a κ-label / content-derived DID. axis ∈ {sha256, blake3}; hex = H_axis(canonical_form).
export const kappa = (axis, hex) => `${axis}:${hex}`;
export const didHolo = (axis, hex) => `did:holo:${axis}:${hex}`;
