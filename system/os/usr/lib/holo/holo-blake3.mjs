// holo-blake3.mjs — BLAKE3 (the hologram substrate's σ-axis, ADR-052), pure JS, lean +
// browser-native. This is the convergence seam made real: the substrate addresses content as
// `blake3:<hex>` = standard BLAKE3 of the canonical bytes (proven: its own differential test
// asserts the blake3 axis == the reference `blake3` crate). Reproducing standard BLAKE3 here —
// witnessed byte-identical against the substrate's own `kappa()` wasm across chunk boundaries —
// makes OS2 κ byte-identical to upstream WITHOUT a 6.5 MB wasm or restating substrate internals
// (BLAKE3 is the public standard the substrate itself consumes). Implements the official spec:
// 1024-byte chunks, 64-byte blocks, 7-round compression, binary tree of chaining values.

const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const MSG = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const CHUNK_START = 1, CHUNK_END = 2, PARENT = 4, ROOT = 8, BLOCK = 64, CHUNK = 1024;
const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

function g(v, a, b, c, d, mx, my) {
  v[a] = (v[a] + v[b] + mx) >>> 0; v[d] = rotr(v[d] ^ v[a], 16);
  v[c] = (v[c] + v[d]) >>> 0;      v[b] = rotr(v[b] ^ v[c], 12);
  v[a] = (v[a] + v[b] + my) >>> 0; v[d] = rotr(v[d] ^ v[a], 8);
  v[c] = (v[c] + v[d]) >>> 0;      v[b] = rotr(v[b] ^ v[c], 7);
}
function roundFn(v, m) {
  g(v, 0, 4, 8, 12, m[0], m[1]); g(v, 1, 5, 9, 13, m[2], m[3]);
  g(v, 2, 6, 10, 14, m[4], m[5]); g(v, 3, 7, 11, 15, m[6], m[7]);
  g(v, 0, 5, 10, 15, m[8], m[9]); g(v, 1, 6, 11, 12, m[10], m[11]);
  g(v, 2, 7, 8, 13, m[12], m[13]); g(v, 3, 4, 9, 14, m[14], m[15]);
}
// compress(cv[8], m[16], counter, blockLen, flags) → out[16]
function compress(cv, m0, counter, blockLen, flags) {
  const cl = counter >>> 0, ch = Math.floor(counter / 4294967296) >>> 0;
  const v = [cv[0], cv[1], cv[2], cv[3], cv[4], cv[5], cv[6], cv[7],
    IV[0], IV[1], IV[2], IV[3], cl, ch, blockLen >>> 0, flags >>> 0];
  let m = m0.slice();
  for (let r = 0; r < 7; r++) { roundFn(v, m); if (r < 6) { const p = new Array(16); for (let i = 0; i < 16; i++) p[i] = m[MSG[i]]; m = p; } }
  const out = new Array(16);
  for (let i = 0; i < 8; i++) { out[i] = (v[i] ^ v[i + 8]) >>> 0; out[i + 8] = (v[i + 8] ^ cv[i]) >>> 0; }
  return out;
}
// read a 64-byte block (zero-padded) into 16 LE u32 words
function words(bytes, off, len) {
  const m = new Array(16).fill(0);
  for (let i = 0; i < len; i++) m[i >> 2] |= bytes[off + i] << ((i & 3) * 8);
  for (let i = 0; i < 16; i++) m[i] >>>= 0;
  return m;
}

// An "output" node: its chaining value, or (with ROOT) its 32-byte hash.
function nodeChainingValue(o) { return compress(o.cv, o.m, o.counter, o.blockLen, o.flags).slice(0, 8); }
function nodeRootBytes(o) {
  const out = compress(o.cv, o.m, 0, o.blockLen, o.flags | ROOT);   // output block counter 0 → first 32 bytes
  const b = new Uint8Array(32);
  for (let i = 0; i < 8; i++) { const w = out[i]; b[i * 4] = w & 255; b[i * 4 + 1] = (w >>> 8) & 255; b[i * 4 + 2] = (w >>> 16) & 255; b[i * 4 + 3] = (w >>> 24) & 255; }
  return b;
}

// One chunk (≤1024 bytes) → its output node (its last block carries CHUNK_END).
function chunkNode(bytes, start, len, counter) {
  let cv = IV.slice();
  const nBlocks = Math.max(1, Math.ceil(len / BLOCK));
  let flags = CHUNK_START;
  for (let i = 0; i < nBlocks - 1; i++) { cv = compress(cv, words(bytes, start + i * BLOCK, BLOCK), counter, BLOCK, flags).slice(0, 8); flags = 0; }
  const lastOff = start + (nBlocks - 1) * BLOCK;
  const lastLen = len - (nBlocks - 1) * BLOCK;                       // 0..64 (0 only when len==0)
  return { cv, m: words(bytes, lastOff, lastLen), counter, blockLen: lastLen, flags: flags | CHUNK_END };
}
function parentNode(leftCV, rightCV) {
  const m = leftCV.concat(rightCV);
  return { cv: IV.slice(), m, counter: 0, blockLen: BLOCK, flags: PARENT };
}
// Hash a subtree [start, start+len) starting at chunk index `counter` → an output node.
function subtree(bytes, start, len, counter) {
  if (len <= CHUNK) return chunkNode(bytes, start, len, counter);
  let left = CHUNK; while (left * 2 < len) left *= 2;               // largest power-of-two chunk span < len
  const leftCV = nodeChainingValue(subtree(bytes, start, left, counter));
  const rightCV = nodeChainingValue(subtree(bytes, start + left, len - left, counter + left / CHUNK));
  return parentNode(leftCV, rightCV);
}

export function blake3(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return nodeRootBytes(subtree(b, 0, b.length, 0));
}
export function blake3hex(bytes) {
  const d = blake3(bytes); let s = "";
  for (let i = 0; i < 32; i++) s += d[i].toString(16).padStart(2, "0");
  return s;
}
// the hologram σ-axis κ-label: "blake3:" + 64 hex (the 71-byte ContentLabel).
export function kappaBlake3(bytes) { return "blake3:" + blake3hex(bytes); }
