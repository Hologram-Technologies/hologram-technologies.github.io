// holo-l5.mjs — THE verify-by-re-derivation primitive (Law L5), in one place. "Does this byte blob re-derive to
// this κ?" is the whole trust model of κ-Portal (source is irrelevant; the math admits). It was copied into the
// closure completeness check (holo-dotholo.verifyClosure) AND the delivery Service Worker (portal-sw) — now both
// call HERE. (The single-file portal inlines an equivalent check on purpose: that file must be dependency-free.)
// Pure + isomorphic; blake3 (the σ-axis) is wired by default, inject others to admit more axes. ────────────────
import { blake3hex } from "./holo-blake3.mjs";

const enc = (s) => new TextEncoder().encode(s);
const kappaOf = (v) => (typeof v === "string" ? v : v && v.kappa);
// parse did:holo:<algo>:<hex>, or a bare 64-hex (assumed blake3 — the canonical σ-axis)
const algoHexOf = (k) => { const s = String(k || ""); const m = /^did:holo:([a-z0-9]+):([0-9a-f]+)$/.exec(s); if (m) return { algo: m[1], hex: m[2] }; return /^[0-9a-f]{64}$/i.test(s) ? { algo: "blake3", hex: s.toLowerCase() } : null; };

// reDerives(bytes, kappa, {digests}) → bool. The atomic L5 check: re-hash the bytes on the κ's axis and compare.
// A κ whose axis has no digest → false (fail-closed; an unverifiable byte is never "trusted").
export async function reDerives(bytes, kappa, { digests = { blake3: blake3hex } } = {}) {
  const ah = algoHexOf(kappa); if (!ah) return false;
  const d = digests[ah.algo]; if (!d || bytes == null) return false;
  return (await d(typeof bytes === "string" ? enc(bytes) : bytes)) === ah.hex;
}

// verifyMembers(members, resolve, {digests}) → the closure COMPLETENESS gate (fail-closed): re-derive EVERY member
// or refuse. members: path → κ (or {kappa}). resolve(path) → bytes|null (content-blind). Returns
// { ok, files, verified, missing, tampered, unverifiable }. (Exposed as holo-dotholo.verifyClosure.)
export async function verifyMembers(members, resolve, { digests = { blake3: blake3hex } } = {}) {
  const missing = [], tampered = [], unverifiable = []; let verified = 0;
  const paths = Object.keys(members);
  for (const p of paths) {
    const ah = algoHexOf(kappaOf(members[p]));
    if (!ah || !digests[ah.algo]) { unverifiable.push(p); continue; }
    let bytes; try { bytes = await resolve(p); } catch { bytes = null; }
    if (bytes == null) { missing.push(p); continue; }
    const hex = await digests[ah.algo](typeof bytes === "string" ? enc(bytes) : bytes);
    if (hex !== ah.hex) { tampered.push(p); continue; }
    verified++;
  }
  return { ok: missing.length === 0 && tampered.length === 0 && unverifiable.length === 0, files: paths.length, verified, missing, tampered, unverifiable };
}

export default { reDerives, verifyMembers };
