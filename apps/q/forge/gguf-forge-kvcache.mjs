// GGUF Forge — KV-state codec (substrate-convergence S1). Serializes the executor's
// KV-cache for a token prefix to a flat byte buffer and restores it bit-for-bit. This
// is the first NON-WEIGHT runtime state to become a κ-object: a serialized KV-block,
// content-addressed by κ(model-root ‖ prefix-token-ids), is what lets a shared prefix
// (system prompt / RAG / history) be stored once, deduped (L2), verified (L5), and
// restored to skip recomputation — identical logits, portable across the process
// boundary. This mirrors qvac's own llama_state_seq_get_data/set_data round-trip
// (src/llama-context.cpp:2409/2419), which is behavior-preserving by construction.
//
// KV state shape (from the Tier-A executor): per layer, per position, a Float32Array
// of length kvDim = n_head_kv * head_dim, for both K and V.
//   kv = { nLayer, nPos, kvDim, Kc: Float32Array[nLayer][nPos], Vc: same }

import { sha256hex, didHolo } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const MAGIC = [0x48, 0x4b, 0x56, 0x31];       // "HKV1"
const HEADER = 16;                             // magic(4) + nLayer(4) + nPos(4) + kvDim(4)
export const KV_LAYOUT_VERSION = 1;            // bump if the on-wire layout changes → new κ

// bytes for a KV state (header + K block + V block, both f32).
export function kvByteLen(nLayer, nPos, kvDim) { return HEADER + 2 * nLayer * nPos * kvDim * 4; }

// kv → Uint8Array. Layout: [MAGIC][nLayer][nPos][kvDim] then K (layer-major, then
// position, then kvDim), then V the same. f32 little-endian.
export function kvSerialize(kv) {
  const { nLayer, nPos, kvDim, Kc, Vc } = kv;
  const out = new Uint8Array(kvByteLen(nLayer, nPos, kvDim));
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  dv.setUint32(4, nLayer, true); dv.setUint32(8, nPos, true); dv.setUint32(12, kvDim, true);
  const f = new Float32Array(out.buffer, HEADER, 2 * nLayer * nPos * kvDim);
  let o = 0;
  for (let il = 0; il < nLayer; il++) for (let p = 0; p < nPos; p++) { f.set(Kc[il][p], o); o += kvDim; }
  for (let il = 0; il < nLayer; il++) for (let p = 0; p < nPos; p++) { f.set(Vc[il][p], o); o += kvDim; }
  return out;
}

// Uint8Array → kv (Kc/Vc as per-layer arrays of Float32Array copies, ready to seed forward).
export function kvRestore(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) throw new Error("kvRestore: bad magic");
  const nLayer = dv.getUint32(4, true), nPos = dv.getUint32(8, true), kvDim = dv.getUint32(12, true);
  if (bytes.byteLength !== kvByteLen(nLayer, nPos, kvDim)) throw new Error("kvRestore: length mismatch");
  // copy out of the (possibly unaligned) source via a byte-accurate read
  const want = 2 * nLayer * nPos * kvDim;
  const f = new Float32Array(want);
  const src = new DataView(bytes.buffer, bytes.byteOffset + HEADER, want * 4);
  for (let i = 0; i < want; i++) f[i] = src.getFloat32(i * 4, true);
  const Kc = [], Vc = []; let o = 0;
  const take = (arr) => { for (let il = 0; il < nLayer; il++) { const layer = []; for (let p = 0; p < nPos; p++) { layer.push(f.slice(o, o + kvDim)); o += kvDim; } arr.push(layer); } };
  take(Kc); take(Vc);
  return { nLayer, nPos, kvDim, Kc, Vc };
}

// κ of a KV-block: keyed on the model identity + the EXACT cumulative token prefix +
// layout version (causally correct — KV at pos p depends on all tokens 0..p). Two
// requests sharing a leading prefix hit the same κ. NOT keyed on KV bytes (GPU f16 is
// non-deterministic); the tokens fully determine the state for a given model.
export function kvBlockKappa(modelRootKappa, tokenIds, layoutVersion = KV_LAYOUT_VERSION) {
  const root = String(modelRootKappa).split(":").pop();
  const payload = `${root}|v${layoutVersion}|${tokenIds.join(",")}`;
  const hex = sha256hex(new TextEncoder().encode(payload));
  return { hex, kappa: didHolo("sha256", hex) };
}

// Content-addressed prefix-KV store. Blocks are keyed by κ(model ‖ cumulative prefix
// tokens) so identical leading prefixes (shared system prompt / RAG / history) DEDUP to
// one block (L2). Stored bytes carry their own content hash, re-derived on every read
// (L5) → tamper/corruption refused. longestPrefix() is the radix lookup: the longest
// cached leading prefix of a request, restorable to skip its recomputation.
export class KvStore {
  constructor() { this.map = new Map(); }                 // tokenκ-hex → {contentHex, bytes, nPos}
  put(modelRoot, tokenIds, kv) {
    const { hex, kappa } = kvBlockKappa(modelRoot, tokenIds);
    if (!this.map.has(hex)) { const bytes = kvSerialize(kv); this.map.set(hex, { contentHex: sha256hex(bytes), bytes, nPos: kv.nPos }); }
    return kappa;                                          // second put of same prefix = L2 dedup no-op
  }
  has(modelRoot, tokenIds) { return this.map.has(kvBlockKappa(modelRoot, tokenIds).hex); }
  get(modelRoot, tokenIds) {
    const e = this.map.get(kvBlockKappa(modelRoot, tokenIds).hex);
    if (!e) return null;
    if (sha256hex(e.bytes) !== e.contentHex) throw new Error("kv L5 REFUSE (tampered KV block)");
    return kvRestore(e.bytes);
  }
  // longest cached leading prefix (leave ≥1 suffix token to actually decode)
  longestPrefix(modelRoot, tokenIds) {
    for (let len = tokenIds.length - 1; len >= 1; len--) {
      if (this.map.has(kvBlockKappa(modelRoot, tokenIds.slice(0, len)).hex)) return { len, kv: this.get(modelRoot, tokenIds.slice(0, len)) };
    }
    return null;
  }
  get size() { return this.map.size; }
  byteLen() { let n = 0; for (const e of this.map.values()) n += e.bytes.length; return n; }

  // Pure (IO-free) persistence: split into an identity INDEX (prefix-κ → content hash)
  // and a content-addressed BLOB set (content hash → bytes). The caller writes these to
  // disk / OPFS / IPFS. Two different prefixes with identical KV share one blob (file-
  // level dedup); the blob's name IS its hash, so restoring is L5 by construction.
  export() {
    const index = {}, blocks = {};
    for (const [tokenHex, e] of this.map) { index[tokenHex] = { contentHex: e.contentHex, nPos: e.nPos }; blocks[e.contentHex] = e.bytes; }
    return { index, blocks };
  }
  // Rebuild from {index, blocks}, re-deriving each blob's hash (L5) — a corrupted blob
  // restored in ANY process is refused, not silently trusted.
  import({ index, blocks }) {
    for (const tokenHex of Object.keys(index)) {
      const { contentHex, nPos } = index[tokenHex];
      const bytes = blocks[contentHex];
      if (!bytes) throw new Error("kv import: missing blob " + contentHex);
      if (sha256hex(bytes) !== contentHex) throw new Error("kv import L5 REFUSE " + contentHex);
      this.map.set(tokenHex, { contentHex, bytes, nPos });
    }
    return this;
  }
}
