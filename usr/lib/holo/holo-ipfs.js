// holo-ipfs.js — the UOR IPFS engine for Holo IPFS.
//
// First principles: IPFS is ALREADY content addressing. A CID is
// multibase(version ‖ multicodec ‖ multihash), and a multihash is
// (hash-code ‖ length ‖ H(block-bytes)). So holospaces' Law L5 — "verify by
// re-derivation" — is NATIVE here: every block a gateway hands back is re-hashed
// in the browser and a digest that doesn't match the CID is REFUSED. The gateway
// (or peer) is never trusted; the browser is the verifier. This is exactly the
// IETF Trustless Gateway contract (application/vnd.ipld.raw / .car).
//
// The substrate already speaks the same primitives (ADR-022 / ADR-025: multihash,
// multibase, digestMultibase, did:holo:sha256). A CIDv1 whose multihash is
// sha2-256 IS a sha256 κ. So IPFS content is not bridged — it is ADOPTED into the
// κ-address space: one set of bytes, addressable as a CID, a did:holo, and a
// holo:// alias on either the sha2-256 or the BLAKE3 axis. ADR-025 names this gap
// directly ("content addressing alone — raw IPFS — gives a DAG of opaque blobs");
// this engine supplies the structural half (verify + walk the Merkle-DAG) so the
// UOR object layer can supply the semantic half.
//
// Pure, dependency-free ES module. SHA-256/512 via Web Crypto (browser, module
// worker, and Node ≥18 all expose globalThis.crypto.subtle); BLAKE3 is implemented
// here (the substrate's native fast axis), witnessed against the official BLAKE3
// test vectors. No network in this file — retrieval lives in the worker/page; this
// is the compute: encode, decode, verify, reassemble.
//
// Authorities (realized, not restated):
//   multiformats: CID (v0/v1), multibase (RFC 4648 base32/base16, base58btc),
//     multicodec (raw 0x55, dag-pb 0x70, dag-cbor 0x71, identity 0x00), multihash
//     (sha2-256 0x12, sha2-512 0x13, blake3 0x1e, identity 0x00), unsigned-varint.
//   IPLD dag-pb (PBNode/PBLink) + UnixFS (Data: Type/Data/filesize/blocksizes).
//   IPLD dag-cbor (RFC 8949 subset; tag 42 = CID link).
//   CARv1 (ipld/specs car) — dag-cbor header {version,roots} ‖ (varint ‖ CID ‖ block)*.
//   BLAKE3 (the reference tree hash; 2019-12-27 test-vector context).

const HAS_SUBTLE = typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle;

// ── byte / hex / utf8 utilities ───────────────────────────────────────────────────
export const toBytes = (v) => v instanceof Uint8Array ? v : typeof v === "string" ? new TextEncoder().encode(v) : new Uint8Array(v);
const HEXT = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, "0"));
export const toHex = (b) => { let s = ""; for (let i = 0; i < b.length; i++) s += HEXT[b[i]]; return s; };
export const fromHex = (h) => { const s = h.startsWith("0x") ? h.slice(2) : h; const o = new Uint8Array(s.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16); return o; };
export const concat = (...arrs) => { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };
export const equalBytes = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const utf8 = (b) => new TextDecoder().decode(b);

// ── unsigned varint (LEB128) ────────────────────────────────────────────────────────
export function varintEncode(n) {
  const out = []; let v = typeof n === "bigint" ? n : Math.floor(n);
  if (typeof v === "bigint") { while (v >= 0x80n) { out.push(Number(v & 0x7fn) | 0x80); v >>= 7n; } out.push(Number(v)); }
  else { while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); } out.push(v); }
  return Uint8Array.from(out);
}
export function varintRead(buf, off = 0) { let x = 0, s = 0, i = off; for (; ;) { const b = buf[i++]; x += (b & 0x7f) * Math.pow(2, s); if ((b & 0x80) === 0) break; s += 7; if (s > 56) throw new Error("varint too long"); } return [x, i]; }
function varintReadBig(buf, off = 0) { let x = 0n, s = 0n, i = off; for (; ;) { const b = buf[i++]; x |= BigInt(b & 0x7f) << s; if ((b & 0x80) === 0) break; s += 7n; } return [x, i]; }

// ── base encodings (multibase) ────────────────────────────────────────────────────
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58MAP = (() => { const m = {}; for (let i = 0; i < B58.length; i++) m[B58[i]] = i; return m; })();
export function base58encode(bytes) {
  let zeros = 0; while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [0]; for (let i = zeros; i < bytes.length; i++) { let carry = bytes[i]; for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; } while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; } }
  let s = ""; for (let i = 0; i < zeros; i++) s += "1"; for (let i = digits.length - 1; i >= 0; i--) s += B58[digits[i]]; return s;
}
export function base58decode(str) {
  let zeros = 0; while (zeros < str.length && str[zeros] === "1") zeros++;
  const bytes = [0]; for (let i = zeros; i < str.length; i++) { const val = B58MAP[str[i]]; if (val === undefined) throw new Error("bad base58 char " + str[i]); let carry = val; for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; } while (carry) { bytes.push(carry & 0xff); carry >>= 8; } }
  const out = new Uint8Array(zeros + bytes.length); for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i]; return out;
}
const B32A = "abcdefghijklmnopqrstuvwxyz234567";   // RFC 4648 base32, lowercase, no padding (multibase 'b')
const B32MAP = (() => { const m = {}; for (let i = 0; i < B32A.length; i++) m[B32A[i]] = i; return m; })();
export function base32encode(bytes) { let bits = 0, val = 0, out = ""; for (let i = 0; i < bytes.length; i++) { val = (val << 8) | bytes[i]; bits += 8; while (bits >= 5) { out += B32A[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32A[(val << (5 - bits)) & 31]; return out; }
export function base32decode(str) { let bits = 0, val = 0; const out = []; for (const ch of str.toLowerCase()) { if (ch === "=") break; const v = B32MAP[ch]; if (v === undefined) throw new Error("bad base32 char " + ch); val = (val << 5) | v; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } } return Uint8Array.from(out); }

export function multibaseDecode(str) {
  const p = str[0], body = str.slice(1);
  if (p === "b") return base32decode(body);
  if (p === "B") return base32decode(body.toLowerCase());
  if (p === "z") return base58decode(body);
  if (p === "f") return fromHex(body);
  if (p === "F") return fromHex(body.toLowerCase());
  if (p === "u" || p === "m") { const b = atobU(body); return b; }
  throw new Error("unsupported multibase prefix '" + p + "'");
}
function atobU(s) { const norm = s.replace(/-/g, "+").replace(/_/g, "/"); const bin = (typeof atob === "function") ? atob(norm.padEnd(Math.ceil(norm.length / 4) * 4, "=")) : Buffer.from(norm, "base64").toString("binary"); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }

// ── multicodec / multihash codes ────────────────────────────────────────────────────
export const CODEC = { IDENTITY: 0x00, RAW: 0x55, DAG_PB: 0x70, DAG_CBOR: 0x71, DAG_JSON: 0x0129, LIBP2P_KEY: 0x72 };
export const HASH = { IDENTITY: 0x00, SHA2_256: 0x12, SHA2_512: 0x13, BLAKE3: 0x1e };
const CODEC_NAME = { 0x00: "identity", 0x55: "raw", 0x70: "dag-pb", 0x71: "dag-cbor", 0x0129: "dag-json", 0x72: "libp2p-key" };
const HASH_NAME = { 0x00: "identity", 0x12: "sha2-256", 0x13: "sha2-512", 0x1e: "blake3" };
export const codecName = (c) => CODEC_NAME[c] || ("codec-0x" + c.toString(16));
export const hashName = (h) => HASH_NAME[h] || ("hash-0x" + h.toString(16));

// ── CID (content identifier) ──────────────────────────────────────────────────────
// A CID is parsed into { version, codec, hashCode, hashSize, digest, bytes }. CIDv0 is a
// bare base58 sha2-256 multihash with an implicit dag-pb codec. CIDv1 is multibase.
export function parseCID(input) {
  if (input && typeof input === "object" && input.__cid) return input;
  let bytes;
  if (input instanceof Uint8Array) bytes = input;
  else {
    let s = String(input).trim();
    s = s.replace(/^ipfs:\/\//i, "").replace(/^\/ipfs\//i, "").split(/[/?#]/)[0];
    if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(s)) bytes = base58decode(s);
    else bytes = multibaseDecode(s);
  }
  if (bytes.length === 34 && bytes[0] === 0x12 && bytes[1] === 0x20)
    return mkcid(0, CODEC.DAG_PB, 0x12, 32, bytes.subarray(2), bytes);
  let off = 0, version, codec, hashCode, hashSize;
  [version, off] = varintRead(bytes, off);
  if (version !== 1) throw new Error("unsupported CID version " + version);
  [codec, off] = varintRead(bytes, off);
  const mhStart = off;
  [hashCode, off] = varintRead(bytes, off);
  [hashSize, off] = varintRead(bytes, off);
  const digest = bytes.subarray(off, off + hashSize);
  if (digest.length !== hashSize) throw new Error("CID multihash truncated");
  return mkcid(1, codec, hashCode, hashSize, digest, bytes.subarray(0, off + hashSize), bytes.subarray(mhStart, off + hashSize));
}
function mkcid(version, codec, hashCode, hashSize, digest, bytes, multihash) {
  return { __cid: true, version, codec, hashCode, hashSize, digest, bytes, multihash: multihash || concat(varintEncode(hashCode), varintEncode(hashSize), digest) };
}
// Parse a CID sitting at offset `off` inside a larger buffer (CAR/dag-pb); returns length consumed too.
export function parseCIDPrefix(buf, off) {
  if (buf[off] === 0x12 && buf[off + 1] === 0x20) { const b = buf.subarray(off, off + 34); return { cid: parseCID(b), length: 34 }; }
  let o = off, version, codec, hashCode, hashSize;
  [version, o] = varintRead(buf, o); [codec, o] = varintRead(buf, o);
  const mhStart = o; [hashCode, o] = varintRead(buf, o); [hashSize, o] = varintRead(buf, o);
  const end = o + hashSize; const digest = buf.subarray(o, end);
  // SEC-8: a declared multihash length is bounded by ACTUAL payload, never trusted. Refuse a length that
  // runs past the bytes present — otherwise the parser advances `off` by a DECLARED count into untrusted
  // space and the caller over-reads the next block. Mirrors parseCID's truncation guard (this is the same
  // multihash, parsed in place inside a CAR/dag-pb stream).
  if (digest.length !== hashSize) throw new Error("CID multihash truncated (declared " + hashSize + " bytes, " + digest.length + " present)");
  return { cid: mkcid(1, codec, hashCode, hashSize, digest, buf.subarray(off, end), buf.subarray(mhStart, end)), length: end - off };
}
export function makeCIDv1(codec, hashCode, digest) {
  const mh = concat(varintEncode(hashCode), varintEncode(digest.length), digest);
  const bytes = concat(varintEncode(1), varintEncode(codec), mh);
  return mkcid(1, codec, hashCode, digest.length, digest, bytes, mh);
}
export function cidToString(cid, base = "base32") {
  const c = parseCID(cid);
  if (c.version === 0) return base58encode(c.bytes);
  if (base === "base58btc") return "z" + base58encode(c.bytes);
  if (base === "base16") return "f" + toHex(c.bytes);
  return "b" + base32encode(c.bytes);
}
// CIDv0 → CIDv1 (base32) without rehashing — same digest, explicit version/codec.
export const cidToV1 = (cid) => { const c = parseCID(cid); return makeCIDv1(c.codec, c.hashCode, c.digest); };
export const cidEqual = (a, b) => equalBytes(parseCID(a).digest, parseCID(b).digest) && parseCID(a).codec === parseCID(b).codec;

// cidToKappa(cid) → 64-hex sha-256 κ — the inverse of kappaToCid: a CIDv1 (raw|dag-pb) over a sha2-256
// multihash IS a κ on the open-web axis. Refuses a non-sha2-256 / wrong-length CID (Law L1: a κ is the
// sha-256 of canonical bytes, so a fragment CID that isn't sha2-256 can never name a κ-object).
export function cidToKappa(input) {
  const c = parseCID(input);
  if (c.hashCode !== 0x12 || c.digest.length !== 32) throw new Error("cidToKappa: not a sha2-256 CID");
  return toHex(c.digest);
}

// ── hashing ───────────────────────────────────────────────────────────────────────
export async function sha256(bytes) { if (!HAS_SUBTLE) throw new Error("WebCrypto unavailable"); return new Uint8Array(await crypto.subtle.digest("SHA-256", toBytes(bytes))); }
export async function sha512(bytes) { return new Uint8Array(await crypto.subtle.digest("SHA-512", toBytes(bytes))); }
export async function hashByCode(code, bytes) {
  const b = toBytes(bytes);
  if (code === HASH.SHA2_256) return await sha256(b);
  if (code === HASH.BLAKE3) return blake3(b);
  if (code === HASH.SHA2_512) return await sha512(b);
  if (code === HASH.IDENTITY) return b;
  throw new Error("unsupported multihash code " + hashName(code));
}
// THE safety property (Law L5 / Trustless Gateway): re-derive the block's multihash and
// compare to the CID. A tampered byte anywhere flips the hash and is refused.
export async function verifyBlock(cid, bytes) {
  const c = parseCID(cid);
  if (c.hashCode === HASH.IDENTITY) return equalBytes(c.digest, toBytes(bytes));
  const h = await hashByCode(c.hashCode, bytes);
  return equalBytes(h.subarray(0, c.hashSize), c.digest);
}
export async function cidOf(bytes, codec = CODEC.RAW, hashCode = HASH.SHA2_256) {
  const digest = await hashByCode(hashCode, bytes);
  return makeCIDv1(codec, hashCode, digest);
}

// ── BLAKE3 (reference tree hash; the substrate's native fast axis) ──────────────────
const B3_IV = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
const B3_PERM = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const CHUNK_START = 1, CHUNK_END = 2, PARENT = 4, ROOT = 8;
// Hot path: the compression below is the flat/unrolled form of the reference b3g round — state in
// LOCALS, message-word order via precomputed per-round schedules (σ[r+1][i] = σ[r][PERM[i]]), zero
// allocations per block. Byte-identical to the reference (gated by tools/holo-blake3-parity-vectors.json,
// the official `i % 251` vectors re-derived by the Rust blake3 crate). ~25× the naive per-round-permute
// form — content-addressing at the ingest boundary (Law L2) has to run at line rate.
const B3_SIGMA = (() => {
  const s = new Uint8Array(7 * 16); let cur = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  for (let r = 0; r < 7; r++) { for (let i = 0; i < 16; i++) s[r * 16 + i] = cur[i]; cur = B3_PERM.map((p) => cur[p]); }
  return s;
})();
function b3compress(cv, m, counter, blockLen, flags, out8) {
  const S = B3_SIGMA;
  let w0 = cv[0], w1 = cv[1], w2 = cv[2], w3 = cv[3], w4 = cv[4], w5 = cv[5], w6 = cv[6], w7 = cv[7];
  let w8 = B3_IV[0], w9 = B3_IV[1], w10 = B3_IV[2], w11 = B3_IV[3];
  let w12 = counter >>> 0, w13 = Math.floor(counter / 4294967296) >>> 0, w14 = blockLen >>> 0, w15 = flags >>> 0;
  for (let o = 0; o < 112; o += 16) {
    w0 = (w0 + w4 + m[S[o]]) >>> 0; w12 ^= w0; w12 = (w12 >>> 16 | w12 << 16) >>> 0; w8 = (w8 + w12) >>> 0; w4 ^= w8; w4 = (w4 >>> 12 | w4 << 20) >>> 0;
    w0 = (w0 + w4 + m[S[o + 1]]) >>> 0; w12 ^= w0; w12 = (w12 >>> 8 | w12 << 24) >>> 0; w8 = (w8 + w12) >>> 0; w4 ^= w8; w4 = (w4 >>> 7 | w4 << 25) >>> 0;
    w1 = (w1 + w5 + m[S[o + 2]]) >>> 0; w13 ^= w1; w13 = (w13 >>> 16 | w13 << 16) >>> 0; w9 = (w9 + w13) >>> 0; w5 ^= w9; w5 = (w5 >>> 12 | w5 << 20) >>> 0;
    w1 = (w1 + w5 + m[S[o + 3]]) >>> 0; w13 ^= w1; w13 = (w13 >>> 8 | w13 << 24) >>> 0; w9 = (w9 + w13) >>> 0; w5 ^= w9; w5 = (w5 >>> 7 | w5 << 25) >>> 0;
    w2 = (w2 + w6 + m[S[o + 4]]) >>> 0; w14 ^= w2; w14 = (w14 >>> 16 | w14 << 16) >>> 0; w10 = (w10 + w14) >>> 0; w6 ^= w10; w6 = (w6 >>> 12 | w6 << 20) >>> 0;
    w2 = (w2 + w6 + m[S[o + 5]]) >>> 0; w14 ^= w2; w14 = (w14 >>> 8 | w14 << 24) >>> 0; w10 = (w10 + w14) >>> 0; w6 ^= w10; w6 = (w6 >>> 7 | w6 << 25) >>> 0;
    w3 = (w3 + w7 + m[S[o + 6]]) >>> 0; w15 ^= w3; w15 = (w15 >>> 16 | w15 << 16) >>> 0; w11 = (w11 + w15) >>> 0; w7 ^= w11; w7 = (w7 >>> 12 | w7 << 20) >>> 0;
    w3 = (w3 + w7 + m[S[o + 7]]) >>> 0; w15 ^= w3; w15 = (w15 >>> 8 | w15 << 24) >>> 0; w11 = (w11 + w15) >>> 0; w7 ^= w11; w7 = (w7 >>> 7 | w7 << 25) >>> 0;
    w0 = (w0 + w5 + m[S[o + 8]]) >>> 0; w15 ^= w0; w15 = (w15 >>> 16 | w15 << 16) >>> 0; w10 = (w10 + w15) >>> 0; w5 ^= w10; w5 = (w5 >>> 12 | w5 << 20) >>> 0;
    w0 = (w0 + w5 + m[S[o + 9]]) >>> 0; w15 ^= w0; w15 = (w15 >>> 8 | w15 << 24) >>> 0; w10 = (w10 + w15) >>> 0; w5 ^= w10; w5 = (w5 >>> 7 | w5 << 25) >>> 0;
    w1 = (w1 + w6 + m[S[o + 10]]) >>> 0; w12 ^= w1; w12 = (w12 >>> 16 | w12 << 16) >>> 0; w11 = (w11 + w12) >>> 0; w6 ^= w11; w6 = (w6 >>> 12 | w6 << 20) >>> 0;
    w1 = (w1 + w6 + m[S[o + 11]]) >>> 0; w12 ^= w1; w12 = (w12 >>> 8 | w12 << 24) >>> 0; w11 = (w11 + w12) >>> 0; w6 ^= w11; w6 = (w6 >>> 7 | w6 << 25) >>> 0;
    w2 = (w2 + w7 + m[S[o + 12]]) >>> 0; w13 ^= w2; w13 = (w13 >>> 16 | w13 << 16) >>> 0; w8 = (w8 + w13) >>> 0; w7 ^= w8; w7 = (w7 >>> 12 | w7 << 20) >>> 0;
    w2 = (w2 + w7 + m[S[o + 13]]) >>> 0; w13 ^= w2; w13 = (w13 >>> 8 | w13 << 24) >>> 0; w8 = (w8 + w13) >>> 0; w7 ^= w8; w7 = (w7 >>> 7 | w7 << 25) >>> 0;
    w3 = (w3 + w4 + m[S[o + 14]]) >>> 0; w14 ^= w3; w14 = (w14 >>> 16 | w14 << 16) >>> 0; w9 = (w9 + w14) >>> 0; w4 ^= w9; w4 = (w4 >>> 12 | w4 << 20) >>> 0;
    w3 = (w3 + w4 + m[S[o + 15]]) >>> 0; w14 ^= w3; w14 = (w14 >>> 8 | w14 << 24) >>> 0; w9 = (w9 + w14) >>> 0; w4 ^= w9; w4 = (w4 >>> 7 | w4 << 25) >>> 0;
  }
  if (out8) {   // chain mode: only the next cv is needed — write into the caller's buffer, no alloc
    out8[0] = (w0 ^ w8) >>> 0; out8[1] = (w1 ^ w9) >>> 0; out8[2] = (w2 ^ w10) >>> 0; out8[3] = (w3 ^ w11) >>> 0;
    out8[4] = (w4 ^ w12) >>> 0; out8[5] = (w5 ^ w13) >>> 0; out8[6] = (w6 ^ w14) >>> 0; out8[7] = (w7 ^ w15) >>> 0;
    return out8;
  }
  const s = new Uint32Array(16);
  s[0] = (w0 ^ w8) >>> 0; s[1] = (w1 ^ w9) >>> 0; s[2] = (w2 ^ w10) >>> 0; s[3] = (w3 ^ w11) >>> 0;
  s[4] = (w4 ^ w12) >>> 0; s[5] = (w5 ^ w13) >>> 0; s[6] = (w6 ^ w14) >>> 0; s[7] = (w7 ^ w15) >>> 0;
  s[8] = (w8 ^ cv[0]) >>> 0; s[9] = (w9 ^ cv[1]) >>> 0; s[10] = (w10 ^ cv[2]) >>> 0; s[11] = (w11 ^ cv[3]) >>> 0;
  s[12] = (w12 ^ cv[4]) >>> 0; s[13] = (w13 ^ cv[5]) >>> 0; s[14] = (w14 ^ cv[6]) >>> 0; s[15] = (w15 ^ cv[7]) >>> 0;
  return s;
}
// load ≤64 bytes at data[off..off+len) into 16 message words, zero-padded (no scratch block copy)
function b3loadWords(data, off, len, m) {
  const full = len >> 2; let i = 0;
  for (; i < full; i++) { const o = off + i * 4; m[i] = (data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) | (data[o + 3] << 24)) >>> 0; }
  if (len & 3) { const o = off + (i << 2); let w = 0; for (let b = 0; b < (len & 3); b++) w |= data[o + b] << (8 * b); m[i++] = w >>> 0; }
  for (; i < 16; i++) m[i] = 0;
}
function b3output(cv, block, counter, blockLen, flags) { return { cv, block, counter, blockLen, flags }; }
const b3cv = (o) => b3compress(o.cv, o.block, o.counter, o.blockLen, o.flags).subarray(0, 8);
function b3rootBytes(o, len) { const out = new Uint8Array(len); let i = 0, ctr = 0; while (i < len) { const w = b3compress(o.cv, o.block, ctr, o.blockLen, o.flags | ROOT); for (let j = 0; j < 16 && i < len; j++) { const word = w[j]; for (let b = 0; b < 4 && i < len; b++) out[i++] = (word >>> (8 * b)) & 0xff; } ctr++; } return out; }
const _b3m = new Uint32Array(16);   // reused message words for the non-retained chain blocks (single-threaded JS)
const _b3cvA = new Uint32Array(8), _b3cvB = new Uint32Array(8);   // ping-pong cv chain buffers (never escape)
function b3chunkOutput(chunk, counter) {
  let cv = B3_IV.subarray(0, 8); const n = Math.max(1, Math.ceil(chunk.length / 64));
  for (let i = 0; i < n - 1; i++) { b3loadWords(chunk, i * 64, 64, _b3m); cv = b3compress(cv, _b3m, counter, 64, i === 0 ? CHUNK_START : 0, cv === _b3cvA ? _b3cvB : _b3cvA); }
  const i = n - 1, start = i * 64, blockLen = chunk.length - start;
  const m = new Uint32Array(16);   // retained inside the output (root/parent compress re-reads it) — must be fresh
  b3loadWords(chunk, start, blockLen, m);
  return b3output(Uint32Array.from(cv), m, counter, blockLen, (i === 0 ? CHUNK_START : 0) | CHUNK_END);   // cv copied: the output object outlives the ping-pong buffers
}
const b3parent = (l, r) => { const block = new Uint32Array(16); block.set(l.subarray(0, 8), 0); block.set(r.subarray(0, 8), 8); return b3output(B3_IV.subarray(0, 8), block, 0, 64, PARENT); };
export function blake3(input, outLen = 32) {
  const data = toBytes(input), nChunks = Math.max(1, Math.ceil(data.length / 1024)); const stack = [];
  for (let c = 0; c < nChunks - 1; c++) {
    let cv = b3cv(b3chunkOutput(data.subarray(c * 1024, c * 1024 + 1024), c)), tc = c + 1;
    while ((tc & 1) === 0) { cv = b3cv(b3parent(stack.pop(), cv)); tc >>= 1; }
    stack.push(cv);
  }
  let out = b3chunkOutput(data.subarray((nChunks - 1) * 1024, data.length), nChunks - 1);
  for (let k = stack.length - 1; k >= 0; k--) out = b3parent(stack[k], b3cv(out));
  return b3rootBytes(out, outLen);
}

// ── protobuf (minimal reader/writer; dag-pb + UnixFS only need varint + len-delimited) ─
function* pbFields(buf, start = 0, end = buf.length) {
  let off = start;
  while (off < end) {
    let key; [key, off] = varintRead(buf, off);
    const field = Math.floor(key / 8), wire = key & 7;
    if (wire === 0) { let v; [v, off] = varintReadBig(buf, off); yield { field, wire, value: v }; }
    else if (wire === 2) { let len; [len, off] = varintRead(buf, off); yield { field, wire, value: buf.subarray(off, off + len) }; off += len; }
    else if (wire === 5) { yield { field, wire, value: buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24) }; off += 4; }
    else if (wire === 1) { yield { field, wire, value: buf.subarray(off, off + 8) }; off += 8; }
    else throw new Error("bad protobuf wire type " + wire);
  }
}
const pbLen = (field, bytes) => concat(varintEncode(field * 8 + 2), varintEncode(bytes.length), bytes);
const pbVar = (field, value) => concat(varintEncode(field * 8 + 0), varintEncode(value));

// ── IPLD dag-pb (PBNode { Data=1 bytes, Links=2 repeated PBLink }) ──────────────────
// PBLink { Hash=1 (CID bytes), Name=2 (string), Tsize=3 (uint64) }.
export function decodeDagPb(bytes) {
  let data = null; const links = [];
  for (const f of pbFields(bytes)) {
    if (f.field === 1 && f.wire === 2) data = f.value;
    else if (f.field === 2 && f.wire === 2) {
      let hash = null, name = "", tsize = 0;
      for (const g of pbFields(f.value)) {
        if (g.field === 1 && g.wire === 2) hash = g.value;
        else if (g.field === 2 && g.wire === 2) name = utf8(g.value);
        else if (g.field === 3 && g.wire === 0) tsize = Number(g.value);
      }
      links.push({ cid: hash ? parseCID(hash) : null, name, tsize });
    }
  }
  return { data, links };
}
// Canonical dag-pb: links (field 2) first, then data (field 1); each link Hash,Name,Tsize.
export function encodeDagPb(node) {
  const parts = [];
  for (const l of node.links || []) {
    const hb = l.cid ? parseCID(l.cid).bytes : l.hash;
    let sub = pbLen(1, hb);
    if (l.name != null) sub = concat(sub, pbLen(2, toBytes(l.name)));
    if (l.tsize != null) sub = concat(sub, pbVar(3, l.tsize));
    parts.push(pbLen(2, sub));
  }
  if (node.data != null && node.data.length) parts.push(pbLen(1, node.data));
  return concat(...parts);
}

// ── UnixFS (the Data field of a dag-pb node) ────────────────────────────────────────
export const UNIXFS = { Raw: 0, Directory: 1, File: 2, Metadata: 3, Symlink: 4, HAMTShard: 5 };
const UNIXFS_NAME = { 0: "raw", 1: "directory", 2: "file", 3: "metadata", 4: "symlink", 5: "hamt-shard" };
export function decodeUnixFs(bytes) {
  const r = { type: UNIXFS.File, data: null, filesize: 0, blocksizes: [] };
  for (const f of pbFields(bytes)) {
    if (f.field === 1 && f.wire === 0) r.type = Number(f.value);
    else if (f.field === 2 && f.wire === 2) r.data = f.value;
    else if (f.field === 3 && f.wire === 0) r.filesize = Number(f.value);
    else if (f.field === 4 && f.wire === 0) r.blocksizes.push(Number(f.value));
  }
  r.typeName = UNIXFS_NAME[r.type] || "unknown";
  return r;
}
export const encodeUnixFsDir = () => pbVar(1, UNIXFS.Directory);
export function encodeUnixFsFile(data, filesize, blocksizes) {
  let out = pbVar(1, UNIXFS.File);
  if (data && data.length) out = concat(out, pbLen(2, data));
  out = concat(out, pbVar(3, filesize == null ? (data ? data.length : 0) : filesize));
  for (const b of blocksizes || []) out = concat(out, pbVar(4, b));
  return out;
}

// ── IPLD dag-cbor (RFC 8949 subset; enough to read CAR headers + browse objects) ────
export function decodeCbor(buf, off = 0) {
  const b = buf[off++], mt = b >> 5, ai = b & 31;
  let val, len = ai;
  if (ai === 24) { len = buf[off++]; } else if (ai === 25) { len = (buf[off] << 8) | buf[off + 1]; off += 2; }
  else if (ai === 26) { len = (buf[off] * 0x1000000) + (buf[off + 1] << 16) + (buf[off + 2] << 8) + buf[off + 3]; off += 4; }
  else if (ai === 27) { let n = 0n; for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(buf[off++]); len = n <= 9007199254740991n ? Number(n) : n; }
  switch (mt) {
    case 0: return [len, off];
    case 1: return [typeof len === "bigint" ? -1n - len : -1 - len, off];
    case 2: { val = buf.subarray(off, off + len); return [val, off + len]; }
    case 3: { val = utf8(buf.subarray(off, off + len)); return [val, off + len]; }
    case 4: { const a = []; for (let i = 0; i < len; i++) { let v; [v, off] = decodeCbor(buf, off); a.push(v); } return [a, off]; }
    case 5: { const m = {}; for (let i = 0; i < len; i++) { let k, v; [k, off] = decodeCbor(buf, off); [v, off] = decodeCbor(buf, off); m[k] = v; } return [m, off]; }
    case 6: { let inner; [inner, off] = decodeCbor(buf, off); if (len === 42) { const cidBytes = inner[0] === 0x00 ? inner.subarray(1) : inner; return [{ "/": cidToString(parseCID(cidBytes)) }, off]; } return [inner, off]; }
    case 7: { if (ai === 20) return [false, off]; if (ai === 21) return [true, off]; if (ai === 22) return [null, off]; return [len, off]; }
  }
  throw new Error("cbor: unsupported major type " + mt);
}
function cborHead(mt, n) { const out = []; const big = typeof n === "bigint"; const v = big ? n : n; if ((big ? v < 24n : v < 24)) out.push((mt << 5) | Number(v)); else if ((big ? v < 256n : v < 256)) { out.push((mt << 5) | 24, Number(v)); } else if ((big ? v < 65536n : v < 65536)) { out.push((mt << 5) | 25, (Number(v) >> 8) & 0xff, Number(v) & 0xff); } else { out.push((mt << 5) | 26, (Number(v) >>> 24) & 0xff, (Number(v) >>> 16) & 0xff, (Number(v) >>> 8) & 0xff, Number(v) & 0xff); } return Uint8Array.from(out); }
function encodeCborCidLink(cid) { const cidBytes = parseCID(cid).bytes; const tagged = concat(Uint8Array.of(0x00), cidBytes); return concat(cborHead(6, 42), cborHead(2, tagged.length), tagged); }

// ── CARv1 (Content Addressable aRchive) ─────────────────────────────────────────────
export function decodeCar(bytes) {
  let off = 0, hlen; [hlen, off] = varintRead(bytes, off);
  const [header] = decodeCbor(bytes, off); off += hlen;
  const roots = (header.roots || []).map((r) => r && r["/"] ? r["/"] : null).filter(Boolean);
  const blocks = [];
  while (off < bytes.length) {
    let blen; [blen, off] = varintRead(bytes, off); const end = off + blen;
    const { cid, length } = parseCIDPrefix(bytes, off);
    blocks.push({ cid: cidToString(cid), cidObj: cid, bytes: bytes.subarray(off + length, end) });
    off = end;
  }
  return { version: header.version, roots, blocks };
}
// Build a CARv1 from { roots:[cid], blocks:[{cid,bytes}] } — used by the witness + "export".
export function encodeCar(roots, blocks) {
  const header = concat(cborHead(5, 2), cborHead(3, 5), new TextEncoder().encode("roots"), cborHead(4, roots.length), ...roots.map(encodeCborCidLink), cborHead(3, 7), new TextEncoder().encode("version"), cborHead(0, 1));
  const out = [concat(varintEncode(header.length), header)];
  for (const blk of blocks) { const cidBytes = parseCID(blk.cid).bytes; const body = concat(cidBytes, blk.bytes); out.push(concat(varintEncode(body.length), body)); }
  return concat(...out);
}

// ── streaming CAR parser (one round-trip per DAG; verify blocks as they arrive) ────
// Feed network chunks with .push(chunk); it returns the blocks that have fully arrived,
// so the caller can re-derive + render incrementally instead of waiting for the whole DAG.
export class CarParser {
  constructor() { this.buf = new Uint8Array(0); this.headerDone = false; this.roots = []; this.version = null; }
  _tryVarint() { let x = 0, s = 0, i = 0; for (; ;) { if (i >= this.buf.length) return null; const b = this.buf[i++]; x += (b & 0x7f) * Math.pow(2, s); if ((b & 0x80) === 0) break; s += 7; if (s > 56) throw new Error("car varint too long"); } return [x, i]; }
  push(chunk) {
    if (chunk && chunk.length) { const n = new Uint8Array(this.buf.length + chunk.length); n.set(this.buf); n.set(chunk, this.buf.length); this.buf = n; }
    const blocks = [];
    if (!this.headerDone) { const v = this._tryVarint(); if (!v) return blocks; const [hlen, off] = v; if (this.buf.length < off + hlen) return blocks; const header = decodeCbor(this.buf, off)[0]; this.roots = (header.roots || []).map((r) => r && r["/"] ? r["/"] : null).filter(Boolean); this.version = header.version; this.buf = this.buf.subarray(off + hlen); this.headerDone = true; }
    for (; ;) { const v = this._tryVarint(); if (!v) break; const [blen, off] = v; if (this.buf.length < off + blen) break; const frame = this.buf.subarray(off, off + blen); const { cid, length } = parseCIDPrefix(frame, 0); blocks.push({ cid: cidToString(cid), cidObj: cid, bytes: frame.subarray(length) }); this.buf = this.buf.subarray(off + blen); }
    return blocks;
  }
}

// ── ENS contenthash (EIP-1577): name.eth → /ipfs/<cid> or /ipns/<name> ─────────────
// The web3-name → content bridge. The on-chain contenthash bytes are multicodec-prefixed:
// 0xe3 ipfs-ns, 0xe5 ipns-ns, 0xe4 swarm-ns. (The eth_call to resolve the name is done by
// the page over JSON-RPC, reusing holo-eth's keccak/namehash; this decodes the result.)
export function decodeContenthash(input) {
  const b = input instanceof Uint8Array ? input : fromHex(input);
  if (!b.length) return null;
  let proto, off; [proto, off] = varintRead(b, 0);
  if (proto === 0xe3) { const { cid } = parseCIDPrefix(b, off); return { protocol: "ipfs", cid: cidToString(cid) }; }
  if (proto === 0xe5) { const { cid } = parseCIDPrefix(b, off); return { protocol: "ipns", cid: cidToString(cid) }; }
  if (proto === 0xe4) return { protocol: "swarm", cid: null };
  return { protocol: "0x" + proto.toString(16), cid: null };
}

// ── MIME by extension (so the service-worker gateway serves the right content-type) ─
const MIME = {
  html: "text/html", htm: "text/html", xhtml: "application/xhtml+xml", css: "text/css", js: "text/javascript", mjs: "text/javascript",
  json: "application/json", xml: "application/xml", txt: "text/plain", md: "text/markdown", csv: "text/csv", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon", bmp: "image/bmp",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4",
  pdf: "application/pdf", wasm: "application/wasm", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  m3u8: "application/vnd.apple.mpegurl", ts: "video/mp2t", rss: "application/rss+xml", atom: "application/atom+xml", vtt: "text/vtt", srt: "application/x-subrip",
};
export const mimeByExt = (name) => MIME[String(name || "").split(".").pop().toLowerCase()] || "";

// ── UnixFS DAG construction (local "ipfs add" — real CIDs computed in-browser) ──────
export const DEFAULT_CHUNK = 262144;   // 256 KiB, go-ipfs default fixed-size chunker
export const DEFAULT_FANOUT = 174;     // go-ipfs default max links per dag-pb node
export function chunkFixed(bytes, size = DEFAULT_CHUNK) { const out = []; for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, Math.min(i + size, bytes.length))); if (out.length === 0) out.push(bytes.subarray(0, 0)); return out; }
// Build a balanced UnixFS file DAG (raw leaves). Returns { root, blocks:Map(cidStr→bytes), size }.
export async function buildFileDag(bytes, { chunkSize = DEFAULT_CHUNK, fanout = DEFAULT_FANOUT, hashCode = HASH.SHA2_256 } = {}) {
  const blocks = new Map();
  const put = async (data, codec) => { const cid = await cidOf(data, codec, hashCode); const s = cidToString(cid); blocks.set(s, data); return { cid: s, tsize: data.length, size: data.length }; };
  let layer = [];
  for (const ch of chunkFixed(bytes, chunkSize)) layer.push(await put(ch, CODEC.RAW));   // leaves: raw codec
  if (layer.length === 1 && bytes.length <= chunkSize) {
    // single leaf — wrap in a unixfs file node so the root is a file (matches dir-entry expectations)
    const ufData = encodeUnixFsFile(bytes, bytes.length, []);
    const root = await put(encodeDagPb({ data: ufData, links: [] }), CODEC.DAG_PB);
    return { root: root.cid, blocks, size: bytes.length };
  }
  while (layer.length > 1 || layer[0].cid.length === 0) {
    const next = [];
    for (let i = 0; i < layer.length; i += fanout) {
      const group = layer.slice(i, i + fanout);
      const filesize = group.reduce((a, g) => a + g.size, 0);
      const ufData = encodeUnixFsFile(null, filesize, group.map((g) => g.size));
      const node = encodeDagPb({ data: ufData, links: group.map((g) => ({ cid: g.cid, name: "", tsize: g.tsize })) });
      const made = await put(node, CODEC.DAG_PB); made.size = filesize; next.push(made);
    }
    layer = next;
    if (layer.length === 1) break;
  }
  return { root: layer[0].cid, blocks, size: bytes.length };
}
// Build a UnixFS directory node from named entries → { cid, bytes }. Links sorted by name.
export async function buildDirNode(entries, { hashCode = HASH.SHA2_256 } = {}) {
  const links = entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((e) => ({ cid: e.cid, name: e.name, tsize: e.tsize || 0 }));
  const bytes = encodeDagPb({ data: encodeUnixFsDir(), links });
  const cid = await cidOf(bytes, CODEC.DAG_PB, hashCode);
  return { cid: cidToString(cid), bytes };
}

// ── inspect a block for browsing (dir listing / file / raw / dag-cbor) ──────────────
export function inspectBlock(cid, bytes) {
  const c = parseCID(cid);
  if (c.codec === CODEC.RAW) return { kind: "file", raw: true, size: bytes.length, leaf: true };
  if (c.codec === CODEC.DAG_CBOR || c.codec === CODEC.DAG_JSON) { try { return { kind: "dag-cbor", value: decodeCbor(bytes)[0] }; } catch { return { kind: "raw", size: bytes.length }; } }
  if (c.codec === CODEC.DAG_PB) {
    const node = decodeDagPb(bytes); const uf = node.data ? decodeUnixFs(node.data) : null;
    const named = node.links.length > 0 && node.links.every((l) => l.name);
    if ((uf && uf.type === UNIXFS.Directory) || (uf && uf.type === UNIXFS.HAMTShard) || (!uf && named)) {
      return { kind: "dir", hamt: uf && uf.type === UNIXFS.HAMTShard, entries: node.links.map((l) => ({ name: l.name, cid: cidToString(l.cid), tsize: l.tsize, codec: codecName(l.cid.codec), isDir: l.cid.codec === CODEC.DAG_PB })) };
    }
    if (uf && uf.type === UNIXFS.Symlink) return { kind: "symlink", target: uf.data ? utf8(uf.data) : "" };
    return { kind: "file", size: uf ? Number(uf.filesize || (uf.data ? uf.data.length : 0)) : 0, leaf: node.links.length === 0, links: node.links.map((l) => ({ cid: cidToString(l.cid), tsize: l.tsize })), inline: node.links.length === 0 && uf ? (uf.data || new Uint8Array(0)) : null };
  }
  return { kind: "raw", size: bytes.length };
}

// ── reassemble a file from its DAG (verifies EVERY block; Law L5 end-to-end) ────────
// getBlock(cidStr) → Uint8Array (the page/worker fetches it via a trustless gateway/peer).
export async function reassembleFile(cid, getBlock, opts = {}) {
  const c = parseCID(cid), s = cidToString(c);
  const bytes = await getBlock(s);
  if (!(await verifyBlock(c, bytes))) { const e = new Error("block failed verification (Law L5 refused): " + s); e.cid = s; throw e; }
  if (opts.onBlock) opts.onBlock(s, bytes.length);
  if (c.codec === CODEC.RAW) return bytes;
  if (c.codec === CODEC.DAG_PB) {
    const node = decodeDagPb(bytes), uf = node.data ? decodeUnixFs(node.data) : null;
    if (node.links.length === 0) return uf && uf.data ? uf.data : (node.data || new Uint8Array(0));
    const parts = []; if (uf && uf.data && uf.data.length) parts.push(uf.data);
    for (const l of node.links) parts.push(await reassembleFile(l.cid, getBlock, opts));
    return concat(...parts);
  }
  if (c.codec === CODEC.IDENTITY) return c.digest;
  throw new Error("cannot reassemble codec " + codecName(c.codec));
}
// Resolve a slash path within a UnixFS directory DAG → the CID it names.
export async function resolvePath(rootCid, path, getBlock) {
  let cid = cidToString(parseCID(rootCid));
  const parts = String(path || "").split("/").filter(Boolean);
  for (const part of parts) {
    const bytes = await getBlock(cid);
    if (!(await verifyBlock(cid, bytes))) throw new Error("path block refused: " + cid);
    const info = inspectBlock(cid, bytes);
    if (info.kind !== "dir") throw new Error("not a directory: " + cid);
    const hit = info.entries.find((e) => e.name === part);
    if (!hit) throw new Error("no such entry: " + part);
    cid = hit.cid;
  }
  return cid;
}

// ── κ-bridge: the same bytes, addressable on every axis (ADR-022/ADR-025) ───────────
export function cidToDid(cid) { const c = parseCID(cid); return c.hashCode === HASH.SHA2_256 ? "did:holo:sha256:" + toHex(c.digest) : null; }
export const holoUri = (cid) => "holo://" + cidToString(parseCID(cid));
export const cidToSRI = (cid) => { const c = parseCID(cid); return c.hashCode === HASH.SHA2_256 ? "sha256-" + b64(c.digest) : null; };
export const cidToMultibase = (cid) => "u" + b64url(parseCID(cid).multihash);
function b64(bytes) { if (typeof btoa === "function") { let s = ""; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); } return Buffer.from(bytes).toString("base64"); }
function b64url(bytes) { return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
// The dual-axis proof: one set of bytes → a sha2-256 CID AND a blake3 CID, both valid.
export async function cidDualAxis(bytes, codec = CODEC.RAW) { return { sha256: cidToString(await cidOf(bytes, codec, HASH.SHA2_256)), blake3: cidToString(makeCIDv1(codec, HASH.BLAKE3, blake3(bytes))) }; }

// ── self-test (runs in page/worker/Node) ────────────────────────────────────────────
export async function selfTest() {
  const checks = []; const ok = (c, m) => { checks.push({ ok: !!c, msg: m }); return !!c; };
  // BLAKE3 known-answer vectors (official; input byte i = i % 251).
  const v = (n) => { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = i % 251; return a; };
  ok(toHex(blake3(v(0))) === "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262", "blake3 KAT len 0");
  ok(toHex(blake3(v(1024))) === "42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7", "blake3 KAT len 1024 (single chunk)");
  ok(toHex(blake3(v(1025))) === "d00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444", "blake3 KAT len 1025 (two chunks)");
  ok(toHex(blake3(v(3072))) === "b98cb0ff3623be03326b373de6b9095218513e64f1ee2edd2525c7ad1e5cffd2", "blake3 KAT len 3072 (parent tree)");
  // The canonical empty UnixFS directory: dag-pb {Data: unixfs{Directory}} = 0a020801.
  const emptyDir = encodeDagPb({ data: encodeUnixFsDir(), links: [] });
  ok(toHex(emptyDir) === "0a020801", "empty UnixFS dir block encodes to 0a020801");
  if (HAS_SUBTLE) {
    const cid0 = await cidOf(emptyDir, CODEC.DAG_PB, HASH.SHA2_256);
    ok(base58encode(cid0.multihash) === "QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn", "empty-dir CIDv0 (base58 multihash) matches the well-known value");
    ok(cidToString(cid0) === "bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354", "empty-dir CIDv1 (base32) matches");
    ok(await verifyBlock(cid0, emptyDir), "verifyBlock accepts the true block");
    const bad = emptyDir.slice(); bad[3] ^= 1; ok(!(await verifyBlock(cid0, bad)), "verifyBlock REFUSES a tampered byte (Law L5)");
  }
  return { ok: checks.every((c) => c.ok), checks };
}

export const VERSION = "holo-ipfs 1.0";
