// holo-locator.mjs — the WHERE axis: a κ → a deterministic, self-verifying IPv6
// locator, so every κ-object is a first-class, directly reachable endpoint on the
// global IPv6 Internet (no NAT, no name server in the path) — the Internet Society
// Deploy360 end-to-end vision, met by content addressing.
//
// The address is DERIVED FROM THE HASH, exactly like RFC 3972 Cryptographically
// Generated Addresses (CGA): the address proves the identity. That is Law L5 on the
// location axis. 120 bits of the κ map into the 128-bit space; it is lossy (256→128)
// and therefore a LOCATOR, never the identity (Law L1) — the fetched bytes are always
// re-hashed to the full κ regardless of how they arrived.
//
//   κ → IPv6:   fd | 40-bit Global-ID(κ) | 16-bit subnet(κ) | 64-bit IID(κ)
//   ULA prefix fd00::/8 (RFC 4193) — a HASH-DERIVED global id needs no allocation
//   authority (RFC 4193 §3.2.2 mandates exactly this). IID is RFC 7217 stable+opaque.
//   Text form is RFC 5952-canonical (≡ Law L2: one canonical form).
//
// A κ on the sha2-256 axis already IS a CIDv1, so we reuse the witnessed CID
// primitive (holo-ipfs) — Law L2, no re-derivation — to pair the IPv6 address with
// an /ipfs/<CID> multiaddr: a dual-stack, multiformats-native, IPv6 locator.
//
// Authority: RFC 4291 · RFC 5952 · RFC 4193 · RFC 3972 (CGA) · RFC 7217 · RFC 8305
//   (Happy Eyeballs, prefer IPv6) · multiformats (multiaddr/CID) · Law L1/L2/L5.

import { makeCIDv1, cidToString, cidToDid, CODEC, HASH } from "./holo-ipfs.js";

const hexOf = (k) => String(k).split(":").pop();
const hexToBytes = (hex) => { const u = new Uint8Array(hex.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(hex.substr(i * 2, 2), 16); return u; };

// κ → the 16 IPv6 bytes (CGA/ULA-style, deterministic).
export function kappaToIPv6Bytes(kappa) {
  const k = hexToBytes(hexOf(kappa));
  if (k.length < 15) throw new Error("kappaToIPv6: need ≥15 κ bytes");
  const b = new Uint8Array(16);
  b[0] = 0xfd;                     // ULA, fd00::/8 with L=1 (RFC 4193)
  b.set(k.subarray(0, 5), 1);      // 40-bit Global ID — hash-derived (RFC 4193 §3.2.2)
  b.set(k.subarray(5, 7), 6);      // 16-bit subnet
  b.set(k.subarray(7, 15), 8);     // 64-bit interface id — opaque/stable (RFC 7217), CGA-style
  return b;
}

// RFC 5952 canonical text: lowercase, no leading zeros, longest (leftmost on tie)
// run of ≥2 zero groups compressed to "::".
export function formatIPv6(b) {
  const g = [];
  for (let i = 0; i < 16; i += 2) g.push((b[i] << 8) | b[i + 1]);
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (g[i] === 0) { if (curStart < 0) curStart = i; curLen++; if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; } }
    else { curStart = -1; curLen = 0; }
  }
  const parts = g.map((x) => x.toString(16));     // lowercase, minimal digits (RFC 5952 §4.1–4.2)
  if (bestLen >= 2) return parts.slice(0, bestStart).join(":") + "::" + parts.slice(bestStart + bestLen).join(":");
  return parts.join(":");
}

// parse an IPv6 string back to 16 bytes (inverse of formatIPv6 for the canonical form).
export function parseIPv6(str) {
  const s = String(str).trim();
  let head, tail;
  if (s.includes("::")) { const [h, t] = s.split("::"); head = h ? h.split(":") : []; tail = t ? t.split(":") : []; }
  else { head = s.split(":"); tail = []; }
  const mid = 8 - head.length - tail.length;
  if (mid < 0) throw new Error("bad IPv6: " + str);
  const groups = [...head, ...Array(mid).fill("0"), ...tail].map((x) => parseInt(x || "0", 16) & 0xffff);
  const b = new Uint8Array(16);
  for (let i = 0; i < 8; i++) { b[i * 2] = (groups[i] >>> 8) & 0xff; b[i * 2 + 1] = groups[i] & 0xff; }
  return b;
}

// κ → RFC 5952 IPv6 string.
export const kappaToIPv6 = (kappa) => formatIPv6(kappaToIPv6Bytes(kappa));

// κ → CIDv1 (raw, sha2-256) — the same bytes, addressed for IPFS. Round-trips back
// to the did:holo κ via cidToDid (identity preserved across the location view).
export const kappaToCID = (kappa) => cidToString(makeCIDv1(CODEC.RAW, HASH.SHA2_256, hexToBytes(hexOf(kappa))));
export const cidToKappaDid = (cid) => cidToDid(cid);

// κ → a dual-stack-ready multiaddr. Default host = the derived self-verifying ULA;
// pass an explicit IPv6 gateway literal to locate via a dual-stack gateway/peer.
// (Operators publish AAAA + an /ip6/ multiaddr — the Deploy360 dual-stack step.)
export function kappaToMultiaddr(kappa, { ip6, port = 4001 } = {}) {
  const host = ip6 || kappaToIPv6(kappa);
  return `/ip6/${host}/tcp/${port}/ipfs/${kappaToCID(kappa)}`;
}
