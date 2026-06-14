// holo-cid.mjs — encode a Hologram κ (did:holo:sha256:<hex>) as a CIDv1, and back, LOSSLESSLY.
// A κ is a sha2-256 of canonical bytes. A CIDv1 wraps that exact digest in the self-describing
// multiformats envelope the whole content-addressing ecosystem speaks (IPFS · IPLD · libp2p):
//   CIDv1 = <multibase-prefix> base( 0x01 ‖ 0x55 ‖ 0x12 ‖ 0x20 ‖ <32-byte digest> )
//            version 1 ┘        raw ┘   sha2-256 ┘  len 32 ┘
// So the SAME bytes get a SHORTER, prettier, MORE-interoperable address — and it round-trips back to
// the identical κ, which still re-derives from the object (Law L5). The name is a hint; the κ is the
// truth; the CID is just a shorter, standard spelling of that truth. Pure + dependency-free.
//
//   import { kappaToCid, cidToKappa, isCid } from "/_shared/holo-cid.mjs";
//   kappaToCid("did:holo:sha256:5838…")        → "bafkrei…"      (base32, the canonical CIDv1)
//   kappaToCid("did:holo:sha256:5838…","base58btc") → "z…"       (shorter)
//   cidToKappa("bafkrei…")                      → "did:holo:sha256:5838…"

const B32 = "abcdefghijklmnopqrstuvwxyz234567";                       // RFC4648 lower, no pad (multibase 'b')
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; // base58btc (multibase 'z')
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"; // base64url (multibase 'u')
const hexBytes = (h) => { const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return u; };
const bytesHex = (u) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");

function b32(u) { let bits = 0, val = 0, out = ""; for (const b of u) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32d(s) { let bits = 0, val = 0; const out = []; for (const c of s) { const i = B32.indexOf(c); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); }
function b64(u) { let bits = 0, val = 0, out = ""; for (const b of u) { val = (val << 8) | b; bits += 8; while (bits >= 6) { out += B64[(val >>> (bits - 6)) & 63]; bits -= 6; } } if (bits) out += B64[(val << (6 - bits)) & 63]; return out; }
function b64d(s) { let bits = 0, val = 0; const out = []; for (const c of s) { const i = B64.indexOf(c); if (i < 0) continue; val = (val << 6) | i; bits += 6; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); }
function b58(u) { let n = 0n; for (const b of u) n = (n << 8n) | BigInt(b); let out = ""; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; } for (const b of u) { if (b === 0) out = "1" + out; else break; } return out; }
function b58d(s) { let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) continue; n = n * 58n + BigInt(i); } const out = []; while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; } for (const c of s) { if (c === "1") out.unshift(0); else break; } return new Uint8Array(out); }

const PREFIX = Uint8Array.from([0x01, 0x55, 0x12, 0x20]);             // CIDv1 · raw · sha2-256 · 32 bytes
const hexOf = (k) => String(k).split(":").pop().toLowerCase();

// kappaToCid(κ, base) — the SAME digest, spelled as a self-describing CIDv1. base ∈ base32|base58btc|base64url.
export function kappaToCid(kappa, base = "base32") {
  const hex = hexOf(kappa);
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("holo-cid: not a sha256 κ: " + kappa);
  const cid = new Uint8Array(PREFIX.length + 32); cid.set(PREFIX, 0); cid.set(hexBytes(hex), PREFIX.length);
  if (base === "base58btc") return "z" + b58(cid);
  if (base === "base64url") return "u" + b64(cid);
  return "b" + b32(cid);
}

// cidToKappa(cid) — decode any of our multibase CIDv1 spellings back to the EXACT κ (or null if not ours).
export function cidToKappa(cid) {
  const s = String(cid).trim(); if (!s) return null;
  const mb = s[0], body = s.slice(1);
  let bytes; try { bytes = mb === "z" ? b58d(body) : mb === "u" ? b64d(body) : mb === "b" ? b32d(body) : null; } catch { return null; }
  if (!bytes || bytes.length !== 36) return null;
  for (let i = 0; i < 4; i++) if (bytes[i] !== PREFIX[i]) return null;   // must be CIDv1 · raw · sha2-256 · 32
  return "did:holo:sha256:" + bytesHex(bytes.subarray(4));
}

// isCid(s) — does this string parse as one of our κ-CIDs? (used to tell a #k= CID from a did:holo).
export function isCid(s) { return !!cidToKappa(s); }
