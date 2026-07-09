// Holo GGUF — κ-native MEMORY framework (the qvac llama_memory_* analogue).
//
// Every KV vector is stored as a CONTENT-ADDRESSED κ-block (optionally quantized,
// reusing the bit-exact quantizer), deduped by content and L5-verifiable. A
// "sequence" is a κ-addressed KV state; the llama_memory_* ops are content-addressed:
//   seq_cp = SHARE the source's κ refs (zero-copy, 0 new blocks) — qvac copies cells.
//   branch = the two sequences share the prefix's κ-blocks; only suffixes diverge.
//   seq_rm = drop refs (re-key); the κ-blocks stay (deduped, GC'd when unreferenced).
//
// K1: quantized KV (type_k/type_v ∈ {0=F32, 8=Q8_0, 2=Q4_0, …} whose block divides kvDim).
// K2: multi-sequence (seq_cp/keep/rm/clear, pos_max) + materialize() → executor inKV.

import { quantizeRow } from "./gguf-forge-quantize.mjs";
import { dequantizeExact } from "./gguf-forge-dequant.mjs";
import { isTqType, tqEncodeKV, tqDecodeKV, TQ_TYPES, qjlDotCorrection } from "./gguf-forge-turboquant.mjs";
import { f16ToF32 } from "../qvac-ingest.mjs";
import { sha256hex, kappa } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const F32 = 0;

export class KvMemory {
  constructor({ typeK = 0, typeV = 0, typeR = 0, nLayer = 0 } = {}) {
    this.tk = typeK; this.tv = typeV; this.tr = typeR; this.nLayer = nLayer;
    this.blocks = new Map();                 // hex -> bytes (content-addressed, deduped)
    this.bytes = 0;                          // total UNIQUE κ-bytes (post-dedup)
    this.seqs = new Map(); this.cur = 0; this._seq(0); // sequence id -> { K:[layer][pos]→κ, V, posMax }
    this.swa = [];                           // per-layer sliding-window size (0 = global/unbounded)
  }
  setSwa(perLayer) { this.swa = perLayer; }  // K4: bound SWA layers to a ring of n_swa
  // evict K/V outside the SWA window: query at pos attends [pos−w+1, pos], so pos−w is
  // outside EVERY current/future window → safe to drop (the executor masks it anyway).
  _evict(s, il, pos) { const w = this.swa[il] || 0; if (!w) return; const cut = pos - w; if (cut >= 0) { delete s.K[il][cut]; delete s.V[il][cut]; } }
  // live (retained) positions for a layer — bounded to n_swa for SWA layers.
  liveCount(seq, il) { const K = this._seq(seq).K[il]; let c = 0; for (let p = 0; p < K.length; p++) if (K[p] !== undefined) c++; return c; }
  livePositions(seq, il) { const K = this._seq(seq).K[il], out = []; for (let p = 0; p < K.length; p++) if (K[p] !== undefined) out.push(p); return out; }
  _seq(id) { let s = this.seqs.get(id); if (!s) { s = { K: Array.from({ length: this.nLayer }, () => []), V: Array.from({ length: this.nLayer }, () => []), R: Array.from({ length: this.nLayer }, () => ({})), posMax: -1 }; this.seqs.set(id, s); } return s; }
  get refsK() { return this._seq(this.cur).K; }            // K1 compat: current sequence's refs
  get refsV() { return this._seq(this.cur).V; }
  setSeq(id) { this.cur = id; this._seq(id); }

  // quantize (or pass through) a vector → content-addressed κ-block; return {ref, val}.
  // TurboQuant/PolarQuant KV types (42-49) route through the rotation-aware KV codec;
  // weight-quant types use quantizeRow; F32 passes through. (val = the lossy round-trip
  // the executor actually attends over.)
  _put(type, vec) {
    const blob = type === F32
      ? new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength).slice()
      : isTqType(type) ? tqEncodeKV(type, vec)
      : quantizeRow[type](vec, vec.length);
    const hex = sha256hex(blob);
    if (!this.blocks.has(hex)) { this.blocks.set(hex, blob); this.bytes += blob.length; } // L2 dedup
    return { ref: kappa("sha256", hex), val: type === F32 ? vec : this._deq(type, blob, vec.length) };
  }
  // dequant dispatch: TQ types reverse the rotation; everything else is the weight oracle.
  _deq(type, blob, n) { return isTqType(type) ? tqDecodeKV(type, blob, n) : dequantizeExact(type, blob, n); }

  // QJL Stage-2 score correction (TBQ K cache only). The decoded K loses the stage-1
  // residual; this adds back the estimate <q, residual> = qjl_dot_correction(qjl, d_r, R·q)
  // for the kvh-th head-block of the K at (il,pos). `qHeadRot` = the head's query already
  // forward-rotated (tqRotate). Default ON for TBQ; this.qjl=false disables (A/B witness).
  qjlActive() { const t = TQ_TYPES[this.tk]; return this.qjl !== false && !!t && t.qjl > 0; }
  qjlBlockElems() { return TQ_TYPES[this.tk]?.d; }
  kCorrection(il, pos, kvh, qHeadRot) {
    const t = TQ_TYPES[this.tk]; const raw = this.load(this._seq(this.cur).K[il][pos]);
    const b0 = kvh * t.total, drOff = b0 + t.idx + 2 + t.qjl;
    const d_r = f16ToF32(raw[drOff] | (raw[drOff + 1] << 8));
    return qjlDotCorrection(raw, b0 + t.idx + 2, d_r, qHeadRot, t.d);
  }
  // executor calls (write to the current sequence) — K1 interface unchanged
  storeK(il, pos, vec) { const s = this._seq(this.cur), r = this._put(this.tk, vec); s.K[il][pos] = r.ref; if (pos > s.posMax) s.posMax = pos; this._evict(s, il, pos); return r.val; }
  storeV(il, pos, vec) { const s = this._seq(this.cur), r = this._put(this.tv, vec); s.V[il][pos] = r.ref; return r.val; }

  // K5: recurrent state (Mamba conv/ssm, RWKV token-shift/wkv) as content-addressed
  // κ-blocks — one per (layer, named state), re-keyed each token. A HYBRID model
  // (Jamba/Granite) populates K/V on attention layers and R on recurrent layers, all in
  // ONE κ-store (the qvac llama_memory_hybrid analogue; recurrent IFF n_head_kv[il]==0).
  storeRecurrent(il, name, vec) { const r = this._put(this.tr, vec); this._seq(this.cur).R[il][name] = r.ref; return r.val; }
  getRecurrent(seq, il, name, n) { const ref = this._seq(seq).R[il][name]; return ref === undefined ? null : this._deq(this.tr, this.load(ref), n); }
  isRecurrentLayer(seq, il) { const s = this._seq(seq); return Object.keys(s.R[il]).length > 0 && s.K[il].length === 0; }

  // ── llama_memory_* (content-addressed) ──
  seqCp(src, dst) { const s = this._seq(src); this.seqs.set(dst, { K: s.K.map((l) => l.slice()), V: s.V.map((l) => l.slice()), R: s.R.map((m) => ({ ...m })), posMax: s.posMax }); } // SHARE κ refs (KV + recurrent) — 0 new blocks
  seqKeep(seq) { const s = this.seqs.get(seq); this.seqs.clear(); if (s) this.seqs.set(seq, s); this.cur = seq; }
  seqRm(seq, p0, p1) { const s = this._seq(seq), hi = p1 < 0 ? s.posMax + 1 : p1; for (let il = 0; il < this.nLayer; il++) for (let p = p0; p < hi; p++) { delete s.K[il][p]; delete s.V[il][p]; } let m = -1; for (let p = 0; p < (s.K[0] || []).length; p++) if (s.K[0][p] !== undefined) m = p; s.posMax = m; }
  clear() { this.seqs.clear(); this.cur = 0; this._seq(0); }
  seqPosMax(seq) { return this.seqs.get(seq)?.posMax ?? -1; }
  seqExists(seq) { return this.seqs.has(seq); }

  // seq_add (RoPE-aware K-shift): shift positions [p0,p1) by delta. K is stored POST-RoPE,
  // and RoPE composes — RoPE(RoPE(k,p),δ) = RoPE(k,p+δ) — so shifting = applying RoPE(δ) on
  // top of the stored K → new content → new κ. V is not RoPE'd (untouched). `ropeShift(kVec,
  // il, delta)` applies the per-layer RoPE delta (the caller supplies it from the graph).
  seqAdd(seq, p0, p1, delta, ropeShift, kvDim) {
    const s = this._seq(seq), hi = p1 < 0 ? s.posMax + 1 : p1;
    for (let il = 0; il < this.nLayer; il++) for (let p = p0; p < hi; p++) {
      if (s.K[il][p] === undefined) continue;
      const k = this._deq(this.tk, this.load(s.K[il][p]), kvDim);
      s.K[il][p] = this._put(this.tk, ropeShift(k, il, delta)).ref;
    }
  }

  // L5: re-derive a stored block's hash, refuse on tamper.
  load(ref) { const hex = String(ref).split(":").pop(), b = this.blocks.get(hex); if (!b) throw new Error("kvmem: κ not found " + ref); if (sha256hex(b) !== hex) throw new Error("kvmem: L5 REFUSE " + ref); return b; }

  // materialize a sequence's KV as dequantized { Kc, Vc } (per layer, per pos) for the
  // executor's inKV seed. kvDim = the K/V vector length.
  materialize(seq, kvDim) {
    const s = this._seq(seq), nPos = s.posMax + 1;
    const Kc = Array.from({ length: this.nLayer }, () => []), Vc = Array.from({ length: this.nLayer }, () => []);
    for (let il = 0; il < this.nLayer; il++) for (let p = 0; p < nPos; p++) {
      Kc[il].push(this._deq(this.tk, this.load(s.K[il][p]), kvDim));
      Vc[il].push(this._deq(this.tv, this.load(s.V[il][p]), kvDim));
    }
    return { nLayer: this.nLayer, nPos, kvDim, Kc, Vc };
  }
}
