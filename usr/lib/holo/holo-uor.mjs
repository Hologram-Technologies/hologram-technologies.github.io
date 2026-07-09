// holo-uor.mjs — THE one canonical content-addressing primitive for Hologram OS, a downstream
// of UOR-ADDR (uor-foundation/uor-addr): a κ-label is `<axis>:<hex>` = H(canonical_form). The
// engine's Law L2 ("canonical forms only — canonicalize at the ingest boundary, hold κ") is
// made literal here: canonicalization + the σ-axis hashes + the multibase/SRI digests live in
// ONE module, never re-derived per file. Every product path — the holospace descriptor, the
// UOR object envelope, the witnesses — imports these. ISOMORPHIC (Node · browser · service
// worker): the SHA-256 is a pure-JS synchronous implementation (no node:crypto, no Buffer), so
// the same module loads and re-derives κ identically wherever it runs — the substrate gateway
// Service Worker IS this primitive, byte-for-byte equal to node:crypto's sha256 (witnessed by
// every κ re-derivation in the gate, and self-tested against node:crypto on the block boundaries).
//
// Equivalence to the engine's σ-axis is witnessed against its cc1 hash-KATs; that is what makes
// us a CANONICAL downstream, not a lookalike. Authorities: UOR-ADDR (κ-label = H(canonical_form));
// IETF RFC 8785 (JCS); multiformats (multihash); W3C Subresource Integrity / VC Data Integrity
// (digestSRI/Multibase); FIPS 180-4 (SHA-256).

// ── FIPS 180-4 SHA-256 — pure-JS, synchronous, isomorphic (bytes in → 32-byte digest out) ───────
const SHA_K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const _rotr = (x, n) => (x >>> n) | (x << (32 - n));
function sha256u8(msg) {
  const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const len = msg.length, bitLen = len * 8, withOne = len + 1, k = (56 - (withOne % 64) + 64) % 64, total = withOne + k + 8;
  const m = new Uint8Array(total); m.set(msg); m[len] = 0x80;
  const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
  m[total-8]=(hi>>>24)&255; m[total-7]=(hi>>>16)&255; m[total-6]=(hi>>>8)&255; m[total-5]=hi&255;
  m[total-4]=(lo>>>24)&255; m[total-3]=(lo>>>16)&255; m[total-2]=(lo>>>8)&255; m[total-1]=lo&255;
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = (m[off+i*4]<<24)|(m[off+i*4+1]<<16)|(m[off+i*4+2]<<8)|(m[off+i*4+3]);
    for (let i = 16; i < 64; i++) { const s0=_rotr(w[i-15],7)^_rotr(w[i-15],18)^(w[i-15]>>>3); const s1=_rotr(w[i-2],17)^_rotr(w[i-2],19)^(w[i-2]>>>10); w[i]=(w[i-16]+s0+w[i-7]+s1)|0; }
    let a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
    for (let i = 0; i < 64; i++) { const S1=_rotr(e,6)^_rotr(e,11)^_rotr(e,25); const ch=(e&f)^((~e)&g); const t1=(hh+S1+ch+SHA_K[i]+w[i])|0; const S0=_rotr(a,2)^_rotr(a,13)^_rotr(a,22); const maj=(a&b)^(a&c)^(b&c); const t2=(S0+maj)|0; hh=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0; }
    h[0]=(h[0]+a)|0;h[1]=(h[1]+b)|0;h[2]=(h[2]+c)|0;h[3]=(h[3]+d)|0;h[4]=(h[4]+e)|0;h[5]=(h[5]+f)|0;h[6]=(h[6]+g)|0;h[7]=(h[7]+hh)|0;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) { out[i*4]=(h[i]>>>24)&255; out[i*4+1]=(h[i]>>>16)&255; out[i*4+2]=(h[i]>>>8)&255; out[i*4+3]=h[i]&255; }
  return out;
}

// ── isomorphic byte helpers (no Buffer) ─────────────────────────────────────────────────────────
const _B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const _enc = new TextEncoder();
const utf8Bytes = (s) => _enc.encode(s);
const toHex = (u8) => { let s = ""; for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, "0"); return s; };
const hexToBytes = (hex) => { const u = new Uint8Array(hex.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(hex.substr(i * 2, 2), 16); return u; };
const concatBytes = (...arrs) => { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };
// base64 (urlsafe=false → standard, padded; urlsafe=true → base64url, unpadded) — matches Node's
// Buffer.toString("base64") and .toString("base64url") byte-for-byte.
function toBase64(u8, urlsafe) {
  const alpha = _B64 + (urlsafe ? "-_" : "+/");
  let out = "";
  for (let i = 0; i < u8.length; i += 3) {
    const b0 = u8[i], b1 = u8[i + 1], b2 = u8[i + 2], has1 = i + 1 < u8.length, has2 = i + 2 < u8.length;
    out += alpha[b0 >> 2];
    out += alpha[((b0 & 3) << 4) | ((has1 ? b1 : 0) >> 4)];
    out += has1 ? alpha[((b1 & 15) << 2) | ((has2 ? b2 : 0) >> 6)] : (urlsafe ? "" : "=");
    out += has2 ? alpha[b2 & 63] : (urlsafe ? "" : "=");
  }
  return out;
}

// RFC 8785 JSON Canonicalization Scheme — the canonical_form for JSON-LD objects. Sufficient
// for string/number/array/object descriptors (sorted keys, arrays in order).
export const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
  : JSON.stringify(v);

const buf = (x) => typeof x === "string" ? utf8Bytes(x) : (x instanceof Uint8Array ? x : new Uint8Array(x));

// the σ-axis: SHA-256 over a canonical form → the open-web κ axis (Web Crypto / SRI speak it).
export const sha256bytes = (x) => sha256u8(buf(x));
export const sha256hex = (x) => toHex(sha256bytes(x));

// W3C Subresource Integrity / VC Data Integrity digest (a browser verifies it; L5 = SRI).
export const sriOf = (x) => "sha256-" + toBase64(sha256bytes(x), false);

// multibase(base64url) multihash: sha2-256 = 0x12, blake3 = 0x1e (the native fast axis).
const multihash = (code, digest) => "u" + toBase64(concatBytes(new Uint8Array([code, digest.length]), digest), true);
export const mbSha256 = (x) => multihash(0x12, sha256bytes(x));
export const mbBlake3 = (hex) => multihash(0x1e, hexToBytes(hex));

// a κ-label / content-derived DID. axis ∈ {sha256, blake3}; hex = H_axis(canonical_form).
export const kappa = (axis, hex) => `${axis}:${hex}`;
export const didHolo = (axis, hex) => `did:holo:${axis}:${hex}`;
