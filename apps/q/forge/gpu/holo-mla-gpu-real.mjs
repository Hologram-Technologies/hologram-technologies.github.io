// holo-mla-gpu-real.mjs — the REAL DeepSeek-V2-Lite forward on WebGPU, weights STREAMED by κ.
//
// Generalizes holo-mla-gpu.mjs to: 27 layers (residual + per-layer KV cache), K-quant weights fetched on
// demand from the served .gguf (HTTP Range) and BLAKE-... SHA-256-verified (WebCrypto, Law L1) before use,
// a leading dense layer (ffn_swiglu) + MoE layers (mul_mat_id, softmax router, ungated 2×shared), and a
// Q6_K lm_head. Only routed expert κ-slices are fetched (sparse). Raw K-quant kernels do FLOAT dequant-dot;
// this matches the CPU float-dequant oracle to the f32 floor. Driven by gpu/_qtest/real-model.json.
import { createGpuRuntime } from "./holo-gguf-gpu.mjs";

const G = (n) => Math.ceil(n / 64);
const RAW = { 12: "q4kraw", 13: "q5kraw", 14: "q6kraw", 8: "q8raw", 6: "q5raw" };   // ggmlType → pipe key

const halfToFloat = (h) => { const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (m / 1024); if (e === 31) return m ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + m / 1024); };
// minimal Q4_K row dequant (embd lookup) — mirrors MATVECQ4KRAW unpack (block 144 B / 256 elems)
function dequantQ4K(bytes, n) {
  const out = new Float32Array(n), nb = n / 256, dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let b = 0; b < nb; b++) {
    const base = b * 144, d = halfToFloat(dv.getUint16(base, true)), dmin = halfToFloat(dv.getUint16(base + 2, true));
    const gb = (i) => bytes[base + 4 + i];
    const sc = (j) => j < 4 ? [gb(j) & 63, gb(j + 4) & 63] : [(gb(j + 4) & 0xF) | ((gb(j - 4) >> 6) << 4), (gb(j + 4) >> 4) | ((gb(j) >> 6) << 4)];
    for (let jj = 0; jj < 4; jj++) {
      const [s0d, s0m] = sc(jj * 2), [s1d, s1m] = sc(jj * 2 + 1);
      const d1 = d * s0d, m1 = dmin * s0m, d2 = d * s1d, m2 = dmin * s1m, qb = base + 16 + jj * 32, oB = b * 256 + jj * 64;
      for (let l = 0; l < 32; l++) { const qv = bytes[qb + l]; out[oB + l] = d1 * (qv & 0xF) - m1; out[oB + 32 + l] = d2 * (qv >> 4) - m2; }
    }
  }
  return out;
}
async function sha256hex(bytes) { const d = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); }

export async function runRealForward(dev, meta, { onLayer, log } = {}) {
  const rt = createGpuRuntime(dev), { P, disp, u4, f4, sbuf, wF, rawU32, resetUniforms } = rt;
  const c = meta.cfg, W = meta.weights, D = c.D, NH = c.NH, HK = c.HK, HV = c.HV, ROPE = c.ROPE, NOPE = c.NOPE, KVL = c.KVL, E = c.E, USED = c.USED, eps = c.eps, fb = c.freqBase, yarn = c.yarn, kqScale = yarn ? yarn.kqScale : c.kqScalePlain;
  const dimsOf = (nm) => W[nm].dims, typeOf = (nm) => W[nm].type;

  // ── κ weight store: HTTP Range fetch + SHA-256 verify + LRU byte cache (sparse: only routed experts) ──
  const perf = { fetch: 0, verify: 0, gpu: 0, glue: 0 };   // P0 profiling accumulators (ms)
  const now = () => performance.now();
  const cache = new Map(); let used = 0, netBytes = 0, verified = 0, fetches = 0; const BUDGET = 1.6e9;
  const touch = (h) => { const v = cache.get(h); cache.delete(h); cache.set(h, v); };
  const stash = (h, b) => { cache.set(h, b); used += b.byteLength; while (used > BUDGET && cache.size > 1) { const k = cache.keys().next().value; if (k === h) break; used -= cache.get(k).byteLength; cache.delete(k); } };
  const fetchRange = async (off, len) => { const r = await fetch(meta.modelUrl, { headers: { Range: `bytes=${off}-${off + len - 1}` } }); if (!(r.status === 206 || r.ok)) throw new Error("range " + r.status); fetches++; const b = new Uint8Array(await r.arrayBuffer()); netBytes += b.byteLength; return b; };
  const byHex = async (hex, off, len) => { if (cache.has(hex)) { touch(hex); return cache.get(hex); } let t = now(); const b = await fetchRange(off, len); perf.fetch += now() - t; t = now(); const ok = await sha256hex(b); perf.verify += now() - t; if (ok !== hex) throw new Error("L5 REFUSE " + hex.slice(0, 12)); verified++; stash(hex, b); return b; };
  const weightBytes = (nm) => { const w = W[nm], d = meta.dir[w.hex]; return byHex(w.hex, d.off, d.len); };
  const expertBytes = (nm, e) => { const em = meta.expertMeta[nm], hex = em.experts[e], whole = meta.dir[em.wholeHex]; return byHex(hex, whole.off + e * em.stride, em.stride); };
  // concurrent prefetch — the cold path is fetch-bound (sequential range requests). Fire N fetches at once
  // (the browser pools ~6 connections/origin), each still SHA-256-verified, warming the cache before use.
  const prefetch = (refs) => Promise.all(refs.map((r) => cache.has(r.hex) ? null : byHex(r.hex, r.off, r.len)));
  const expertRefs = (il, sel) => sel.flatMap((e) => ["ffn_gate_exps", "ffn_up_exps", "ffn_down_exps"].map((t) => { const em = meta.expertMeta[`blk.${il}.${t}.weight`]; return { hex: em.experts[e], off: meta.dir[em.wholeHex].off + e * em.stride, len: em.stride }; }));

  // ── GPU primitives (submit + readback per op; correctness over speed). Fresh buffers per op, ALL
  // destroyed after readback (no pool) — else ~4000 ops × MB-scale weight uploads would leak VRAM. ──
  const fa = (a) => a instanceof Float32Array ? a : Float32Array.from(a);
  const uU = (arr, isF) => { const b = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(b, 0, isF ? new Float32Array([...arr, 0, 0, 0, 0].slice(0, 4)) : new Uint32Array([...arr, 0, 0, 0, 0].slice(0, 4))); return b; };
  const readback = async (buf, n) => { const s = dev.createBuffer({ size: n * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); const e = dev.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, s, 0, n * 4); dev.queue.submit([e.finish()]); await s.mapAsync(GPUMapMode.READ); const o = Float32Array.from(new Float32Array(s.getMappedRange().slice(0))); s.unmap(); s.destroy(); return o; };
  // dispatch pipe over bufs (binding order), read back bufs[outIdx], then destroy EVERY buffer.
  const op = async (pipe, bufs, groups, outIdx, outN) => { const t = now(); const e = dev.createCommandEncoder(); disp(e, pipe, bufs, groups); dev.queue.submit([e.finish()]); const out = await readback(bufs[outIdx], outN); for (const b of bufs) b.destroy(); perf.gpu += now() - t; return out; };
  // matvec: weight bytes by ggmlType (F32 → MATVECF; K-quant → raw kernel). N rows, K cols, over f32 x.
  const mv = async (bytes, type, N, K, x) => { const xb = wF(fa(x)), yb = sbuf(N); if (type === 0) return op(P.f, [wF(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)), xb, yb, uU([N, K, 0, 0])], G(N), 2, N); const pk = RAW[type]; if (!pk) throw new Error("no GPU kernel for ggmlType " + type); return op(P[pk], [rawU32(bytes), xb, yb, uU([N, K, 0, 0])], G(N), 2, N); };
  const mvW = async (nm, x) => { const d = dimsOf(nm); return mv(await weightBytes(nm), typeOf(nm), d[1], d[0], x); };            // [K,N] → N rows
  const mvE = async (nm, e, x, N, K) => mv(await expertBytes(nm, e), typeOf(nm), N, K, x);
  const rms = async (x, w, N) => op(P.rms, [wF(fa(x)), wF(fa(w)), sbuf(N), uU([N, eps, 0, 0], true)], 1, 2, N);
  const f32W = async (nm) => { const b = await weightBytes(nm); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
  const rmsW = async (x, nm, N) => rms(x, await f32W(nm), N);
  const ropen = async (x, nHeads, pos) => { const bU = yarn ? uU([fb, 1, yarn.freqScale, yarn.mscale], true) : uU([fb, 0, 0, 0], true); const cU = yarn ? uU([yarn.extFactor, yarn.lo, yarn.hi, 0], true) : uU([0, 0, 0, 0], true); return op(P.ropenorm, [wF(fa(x)), sbuf(x.length), uU([ROPE, ROPE, nHeads, pos], true), bU, cU], G(nHeads * (ROPE / 2)), 1, x.length); };
  const mlaattn = async (q, kcFlat, vcFlat, curPos) => op(P.mlaattn, [wF(fa(q)), wF(fa(kcFlat)), wF(fa(vcFlat)), sbuf(NH * HV), uU([NH, HK, HV, curPos]), uU([kqScale, 0, 0, 0], true)], G(NH), 3, NH * HV);
  const swig = async (g, u, n) => op(P.swiglu, [wF(fa(g)), wF(fa(u)), sbuf(n), uU([n, 0, 0, 0])], G(n), 2, n);
  const add = async (a, b, n) => op(P.add, [wF(fa(a)), wF(fa(b)), sbuf(n), uU([n, 0, 0, 0])], G(n), 2, n);

  // lm_head must be CHUNKED: output.weight (Q6_K [D,vocab]) is ~172 MB, over the 128 MB storage-binding
  // limit. Fetch+verify the whole tensor once, then dispatch q6kraw in row-chunks into one output buffer
  // (p.z = row offset), so each bound weight sub-buffer stays < 128 MB.
  const lmHead = async (nm, rn) => {
    const d = dimsOf(nm), N = d[1], K = d[0], type = typeOf(nm);
    const [bElems, bBytes] = type === 14 ? [256, 210] : type === 12 ? [256, 144] : type === 8 ? [32, 34] : [256, 210];
    const rowBytes = (K / bElems) * bBytes, bytes = await weightBytes(nm), pipe = P[RAW[type]];
    const outBuf = sbuf(N), xb = wF(fa(rn)), rbs = [];
    const CHUNK = Math.max(1, Math.floor((120 * 1024 * 1024) / rowBytes));   // rows per bound sub-buffer (<120 MB)
    for (let r0 = 0; r0 < N; r0 += CHUNK) {
      const r1 = Math.min(N, r0 + CHUNK), nRows = r1 - r0;
      const rb = rawU32(bytes.subarray(r0 * rowBytes, r1 * rowBytes)); rbs.push(rb);
      const e = dev.createCommandEncoder(); disp(e, pipe, [rb, xb, outBuf, uU([nRows, K, r0, 0])], G(nRows)); dev.queue.submit([e.finish()]);
    }
    const out = await readback(outBuf, N); outBuf.destroy(); xb.destroy(); for (const b of rbs) b.destroy();
    return out;
  };

  const step = NOPE + HV, Kc = Array.from({ length: c.nLayer }, () => []), Vc = Array.from({ length: c.nLayer }, () => []);
  // warm ALL non-expert weights concurrently up front (token_embd, output, per-layer attn/norm/ffn) — ~600 MB
  // in parallel instead of inline-sequential; experts are prefetched per layer once the router selects them.
  { let t = now(); await prefetch(Object.keys(W).filter((nm) => !meta.expertMeta[nm]).map((nm) => ({ hex: W[nm].hex, off: meta.dir[W[nm].hex].off, len: meta.dir[W[nm].hex].len }))); perf.glue += now() - t; if (log) log(`prefetched non-expert weights (${(netBytes / 1e6).toFixed(0)}MB) in ${((now() - t) / 1000).toFixed(1)}s`); }
  const embdBytes = await weightBytes("token_embd.weight");   // Q4_K [D, vocab]
  const embdRow = (id) => dequantQ4K(embdBytes.subarray(id * (D / 256) * 144, (id + 1) * (D / 256) * 144), D);
  const softmax = (a) => { const mx = Math.max(...a); let s = 0; const e = a.map((v) => { const x = Math.exp(v - mx); s += x; return x; }); return e.map((x) => x / s); };

  let logits = null;
  for (let pos = 0; pos < meta.ids.length; pos++) {
    let h = embdRow(meta.ids[pos]);
    for (let il = 0; il < c.nLayer; il++) {
      const P_ = `blk.${il}.`;
      const an = await rmsW(h, P_ + "attn_norm.weight", D);
      const q = await mvW(P_ + "attn_q.weight", an);
      const kvc = await mvW(P_ + "attn_kv_a_mqa.weight", an);
      const kvCmpr = await rms(kvc.subarray(0, KVL), await f32W(P_ + "attn_kv_a_norm.weight"), KVL);
      const qPe = new Float32Array(NH * ROPE);
      for (let hh = 0; hh < NH; hh++) for (let d = 0; d < ROPE; d++) qPe[hh * ROPE + d] = q[hh * HK + NOPE + d];
      const qPeR = await ropen(qPe, NH, pos);
      const kPeR = await ropen(kvc.subarray(KVL, KVL + ROPE), 1, pos);
      const kv = await mvW(P_ + "attn_kv_b.weight", kvCmpr);
      const Qc = new Float32Array(NH * HK), Kk = new Float32Array(NH * HK), Vv = new Float32Array(NH * HV);
      for (let hh = 0; hh < NH; hh++) {
        for (let d = 0; d < NOPE; d++) { Kk[hh * HK + d] = kv[hh * step + d]; Qc[hh * HK + d] = q[hh * HK + d]; }
        for (let d = 0; d < ROPE; d++) { Kk[hh * HK + NOPE + d] = kPeR[d]; Qc[hh * HK + NOPE + d] = qPeR[hh * ROPE + d]; }
        for (let d = 0; d < HV; d++) Vv[hh * HV + d] = kv[hh * step + NOPE + d];
      }
      Kc[il].push(Kk); Vc[il].push(Vv);
      const ctx = await mlaattn(Qc, Float32Array.from(Kc[il].flatMap((a) => [...a])), Float32Array.from(Vc[il].flatMap((a) => [...a])), pos);
      const attnOut = await mvW(P_ + "attn_output.weight", ctx);
      const h2 = await add(h, attnOut, D);
      const fn = await rmsW(h2, P_ + "ffn_norm.weight", D);

      let ffn;
      if (il < c.leadingDense) {
        const FF = dimsOf(P_ + "ffn_gate.weight")[1];
        const g = await mvW(P_ + "ffn_gate.weight", fn), u = await mvW(P_ + "ffn_up.weight", fn);
        ffn = await mvW(P_ + "ffn_down.weight", await swig(g, u, FF));
      } else {
        const FFm = dimsOf(P_ + "ffn_gate_exps.weight")[1];
        const le = await mvW(P_ + "ffn_gate_inp.weight", fn);
        const probs = softmax([...le]);
        const sel = [...probs.keys()].sort((a, b) => probs[b] - probs[a] || a - b).slice(0, USED);
        const wt = sel.map((e) => probs[e]);                       // normW=false, wScale=1
        await prefetch(expertRefs(il, sel));                        // fetch all 18 routed-expert slices concurrently
        const out = new Float32Array(D);
        for (let i = 0; i < sel.length; i++) {
          const e = sel[i];
          const gg = await mvE(P_ + "ffn_gate_exps.weight", e, fn, FFm, D);
          const uu = await mvE(P_ + "ffn_up_exps.weight", e, fn, FFm, D);
          const act = await swig(gg, uu, FFm);
          const dn = await mvE(P_ + "ffn_down_exps.weight", e, act, D, FFm);
          for (let j = 0; j < D; j++) out[j] += wt[i] * dn[j];
        }
        const FFs = dimsOf(P_ + "ffn_gate_shexp.weight")[1];
        const sg = await mvW(P_ + "ffn_gate_shexp.weight", fn), su = await mvW(P_ + "ffn_up_shexp.weight", fn);
        const sh = await mvW(P_ + "ffn_down_shexp.weight", await swig(sg, su, FFs));
        for (let j = 0; j < D; j++) out[j] += sh[j];                // ungated shared
        ffn = out;
      }
      h = await add(h2, ffn, D);
      if (onLayer && pos === meta.ids.length - 1) onLayer(il, h);
    }
    if (pos === meta.ids.length - 1) {
      const rn = await rmsW(h, "output_norm.weight", D);
      logits = await lmHead("output.weight", rn);
    }
    if (log) log(`pos ${pos + 1}/${meta.ids.length} done · fetched ${(netBytes / 1e6).toFixed(0)}MB · ${verified} verified · cache ${(used / 1e6).toFixed(0)}MB`);
  }
  const argmax = (a) => { let m = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[m]) m = i; return m; };
  return { argmax: argmax(logits), logits, stats: { netBytes, verified, fetches, perf } };
}

// ── RESIDENT variant (P1): activations stay in GPU buffers, ops batched into one CommandEncoder, submitted
// ONLY at CPU-sync points (MoE router selection — CPU must know which experts to fetch — and final argmax).
// Collapses ~940 readbacks/token → ~27. Non-expert weights are uploaded ONCE and kept resident (VRAM); the
// MLA interleave runs on the GPU (MLAASM kernel) so the whole MLA path needs no readback. Byte-exact to the
// readback path (same kernels). Expert weight buffers + activations are transient, freed per position.
export async function runRealForwardResident(dev, meta, { log, genTokens = 0 } = {}) {
  const rt = createGpuRuntime(dev), { P, disp } = rt, U = GPUBufferUsage;
  const c = meta.cfg, W = meta.weights, D = c.D, NH = c.NH, HK = c.HK, HV = c.HV, ROPE = c.ROPE, NOPE = c.NOPE, KVL = c.KVL, E = c.E, USED = c.USED, eps = c.eps, fb = c.freqBase, yarn = c.yarn;
  const kqScale = yarn ? yarn.kqScale : c.kqScalePlain, step = NOPE + HV, vocab = meta.vocab, T = meta.ids.length;
  const dimsOf = (nm) => W[nm].dims, typeOf = (nm) => W[nm].type, now = () => performance.now();
  const perf = { fetch: 0, verify: 0, gpu: 0, glue: 0, opfs: 0 };

  // OPFS persistence (origin storage, NOT the capped HTTP cache) → warm reload = 0 network. Each κ-block is a
  // content-addressed file named by its hex. Cold: fetch → verify → write OPFS. Warm: read OPFS → verify (L1).
  let opfsDir = null, opfsHits = 0;
  try { opfsDir = await (await navigator.storage.getDirectory()).getDirectoryHandle("holo-kappa-dsv2lite", { create: true }); } catch (e) { opfsDir = null; }
  const opfsGet = async (hex) => { if (!opfsDir) return null; try { const f = await (await opfsDir.getFileHandle(hex)).getFile(); return new Uint8Array(await f.arrayBuffer()); } catch (e) { return null; } };
  const opfsPut = async (hex, bytes) => { if (!opfsDir) return; try { const w = await (await opfsDir.getFileHandle(hex, { create: true })).createWritable(); await w.write(bytes); await w.close(); } catch (e) {} };

  // κ byte store (RAM cache + OPFS + SHA-256 verify)
  const cache = new Map(); let used = 0, netBytes = 0, verified = 0, fetches = 0; const BUDGET = 1.6e9;
  const touch = (h) => { const v = cache.get(h); cache.delete(h); cache.set(h, v); };
  const stash = (h, b) => { cache.set(h, b); used += b.byteLength; while (used > BUDGET && cache.size > 1) { const k = cache.keys().next().value; if (k === h) break; used -= cache.get(k).byteLength; cache.delete(k); } };
  const fetchRange = async (off, len) => { const r = await fetch(meta.modelUrl, { headers: { Range: `bytes=${off}-${off + len - 1}` } }); if (!(r.status === 206 || r.ok)) throw new Error("range " + r.status); fetches++; const b = new Uint8Array(await r.arrayBuffer()); netBytes += b.byteLength; return b; };
  // P3 verify-once: an OPFS block was SHA-256-verified BEFORE it was written (below), and OPFS is
  // content-addressed same-origin storage → reading it back is trusted, skip the re-hash. Only NET
  // fetches are verified (+ written to OPFS). Trust assumption: OPFS integrity within the origin.
  const byHex = async (hex, off, len) => {
    if (cache.has(hex)) { touch(hex); return cache.get(hex); }
    let t = now(); const cached = await opfsGet(hex); perf.opfs += now() - t;
    if (cached) { opfsHits++; stash(hex, cached); return cached; }   // trusted (verified on write)
    t = now(); const b = await fetchRange(off, len); perf.fetch += now() - t;
    t = now(); const ok = await sha256hex(b); perf.verify += now() - t;
    if (ok !== hex) throw new Error("L5 REFUSE " + hex.slice(0, 12));
    verified++; t = now(); await opfsPut(hex, b); perf.opfs += now() - t;
    stash(hex, b); return b;
  };
  const weightBytes = (nm) => { const w = W[nm], d = meta.dir[w.hex]; return byHex(w.hex, d.off, d.len); };
  const expertBytes = (nm, e) => { const em = meta.expertMeta[nm], hex = em.experts[e], whole = meta.dir[em.wholeHex]; return byHex(hex, whole.off + e * em.stride, em.stride); };
  const prefetch = (refs) => Promise.all(refs.map((r) => cache.has(r.hex) ? null : byHex(r.hex, r.off, r.len)));
  const expertRefs = (il, sel) => sel.flatMap((e) => ["ffn_gate_exps", "ffn_up_exps", "ffn_down_exps"].map((t) => { const em = meta.expertMeta[`blk.${il}.${t}.weight`]; return { hex: em.experts[e], off: meta.dir[em.wholeHex].off + e * em.stride, len: em.stride }; }));

  // GPU buffers: persistent non-expert weights (uploaded once) + transient (activations/uniforms/experts, freed per position)
  const mkBuf = (bytes) => { const n = (bytes.byteLength + 3) & ~3, b = dev.createBuffer({ size: n, usage: U.STORAGE | U.COPY_DST }); if (bytes.byteLength % 4) { const p = new Uint8Array(n); p.set(bytes); dev.queue.writeBuffer(b, 0, p); } else dev.queue.writeBuffer(b, 0, bytes); return b; };
  const wbuf = new Map();
  const weightBuf = async (nm) => { const w = W[nm]; if (wbuf.has(w.hex)) return wbuf.get(w.hex); const b = mkBuf(await weightBytes(nm)); wbuf.set(w.hex, b); return b; };
  let trans = [], enc = dev.createCommandEncoder();
  const alloc = (n) => { const b = dev.createBuffer({ size: Math.max(4, n * 4), usage: U.STORAGE | U.COPY_SRC | U.COPY_DST }); trans.push(b); return b; };
  const uU = (arr, isF) => { const b = dev.createBuffer({ size: 16, usage: U.UNIFORM | U.COPY_DST }); dev.queue.writeBuffer(b, 0, isF ? new Float32Array([...arr, 0, 0, 0, 0].slice(0, 4)) : new Uint32Array([...arr, 0, 0, 0, 0].slice(0, 4))); trans.push(b); return b; };
  const upload = (arr) => { const b = dev.createBuffer({ size: Math.max(4, arr.byteLength), usage: U.STORAGE | U.COPY_DST | U.COPY_SRC }); dev.queue.writeBuffer(b, 0, arr); trans.push(b); return b; };
  // experts: transient GPU buffer per use (uploaded, freed per position). Resident-expert caching was tried
  // (VRAM LRU) but over-subscribed fast VRAM → thrashing (20-50 s/token); transient stays bounded. Re-visit
  // with a locality-tuned small budget only after profiling proves re-upload (not compute) is the cost.
  const expBuf = async (nm, e) => { const b = await expertBytes(nm, e); return upload(new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4)); };

  const readback = async (buf, n) => { const s = dev.createBuffer({ size: n * 4, usage: U.MAP_READ | U.COPY_DST }); const e = dev.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, s, 0, n * 4); dev.queue.submit([e.finish()]); await s.mapAsync(GPUMapMode.READ); const o = Float32Array.from(new Float32Array(s.getMappedRange().slice(0))); s.unmap(); s.destroy(); return o; };
  const flush = () => { dev.queue.submit([enc.finish()]); enc = dev.createCommandEncoder(); };
  const readN = async (buf, n) => { const t = now(); flush(); const o = await readback(buf, n); perf.gpu += now() - t; return o; };
  const rec = (pipe, bufs, groups) => disp(enc, pipe, bufs, groups);
  const mvB = (wb, type, N, K, xb) => { const y = alloc(N); rec(type === 0 ? P.f : P[RAW[type]], [wb, xb, y, uU([N, K, 0, 0])], G(N)); return y; };
  const rmsB = (xb, wb, N) => { const y = alloc(N); rec(P.rms, [xb, wb, y, uU([N, eps, 0, 0], true)], 1); return y; };
  const swigB = (g, u, n) => { const y = alloc(n); rec(P.swiglu, [g, u, y, uU([n, 0, 0, 0])], G(n)); return y; };
  const addB = (a, b, n) => { const y = alloc(n); rec(P.add, [a, b, y, uU([n, 0, 0, 0])], G(n)); return y; };
  const saxpyB = (x, y, s, n) => rec(P.saxpy, [x, y, uU([s, n, 0, 0], true)], G(n));
  const ropenB = (xb, nHeads, pos, len) => { const y = alloc(len); const b = yarn ? uU([fb, 1, yarn.freqScale, yarn.mscale], true) : uU([fb, 0, 0, 0], true); const cc = yarn ? uU([yarn.extFactor, yarn.lo, yarn.hi, 0], true) : uU([0, 0, 0, 0], true); rec(P.ropenorm, [xb, y, uU([ROPE, ROPE, nHeads, pos], true), b, cc], G(nHeads * (ROPE / 2))); return y; };
  const softmax = (a) => { const mx = Math.max(...a); let s = 0; const e = a.map((v) => { const x = Math.exp(v - mx); s += x; return x; }); return e.map((x) => x / s); };

  const maxPos = T + genTokens, Kbuf = [], Vbuf = [];
  for (let il = 0; il < c.nLayer; il++) { Kbuf.push(dev.createBuffer({ size: maxPos * NH * HK * 4, usage: U.STORAGE | U.COPY_DST })); Vbuf.push(dev.createBuffer({ size: maxPos * NH * HV * 4, usage: U.STORAGE | U.COPY_DST })); }
  { let t = now(); await prefetch(Object.keys(W).filter((nm) => !meta.expertMeta[nm]).map((nm) => ({ hex: W[nm].hex, off: meta.dir[W[nm].hex].off, len: meta.dir[W[nm].hex].len }))); perf.glue += now() - t; if (log) log(`prefetched non-expert (${(netBytes / 1e6).toFixed(0)}MB) ${((now() - t) / 1000).toFixed(1)}s`); }
  const embdBytes = await weightBytes("token_embd.weight");
  const embdRow = (id) => dequantQ4K(embdBytes.subarray(id * (D / 256) * 144, (id + 1) * (D / 256) * 144), D);

  const argmax = (a) => { let m = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[m]) m = i; return m; };
  // P1: lm_head weight (172 MB Q6_K) RESIDENT — its row-chunks (chunked for the 128 MB binding limit) are
  // uploaded ONCE and reused every token instead of re-uploaded each decode step.
  let lmChunks = null;
  const lmHead = async (h) => {
    const rn = rmsB(h, await weightBuf("output_norm.weight"), D);
    const K = D, N = vocab;
    if (!lmChunks) {
      const bytes = await weightBytes("output.weight"), rowBytes = (K / 256) * 210, CHUNK = Math.max(1, Math.floor((120 * 1024 * 1024) / rowBytes));
      lmChunks = [];
      for (let r0 = 0; r0 < N; r0 += CHUNK) { const r1 = Math.min(N, r0 + CHUNK), sub = bytes.subarray(r0 * rowBytes, r1 * rowBytes); lmChunks.push({ buf: mkBuf(sub), r0, nRows: r1 - r0 }); }
    }
    // NAIVE q6kraw. The tiled q6ktiled is parity-exact + 5.7× at the kernel level AND proven correct in EVERY
    // isolated repro (single/large-N/non-mult-8/2-chunk/valid-data/own-command-buffer/exact-chunk-size — lm-repro.html)
    // yet reproducibly ZEROS the executor's lm_head. Cause not isolated; needs in-executor instrumentation. Also the
    // lm_head is only ~5% of per-token time — the real win is tiled Q4_K/Q8_0 LAYER matvecs. Naive until both are ready.
    const logitsB = alloc(N);
    for (const { buf, r0, nRows } of lmChunks) rec(P.q6kraw, [buf, rn, logitsB, uU([nRows, K, r0, 0])], G(nRows));
    return readN(logitsB, N);
  };
  // one transformer position (prefill or generate): all ops recorded resident, logits only when needed.
  const runPos = async (pos, token, needLogits) => {
    let h = upload(embdRow(token));
    for (let il = 0; il < c.nLayer; il++) {
      const p = `blk.${il}.`;
      const an = rmsB(h, await weightBuf(p + "attn_norm.weight"), D);
      const q = mvB(await weightBuf(p + "attn_q.weight"), typeOf(p + "attn_q.weight"), NH * HK, D, an);
      const kvc = mvB(await weightBuf(p + "attn_kv_a_mqa.weight"), typeOf(p + "attn_kv_a_mqa.weight"), KVL + ROPE, D, an);
      const kvCmpr = rmsB(kvc, await weightBuf(p + "attn_kv_a_norm.weight"), KVL);
      const qPe = alloc(NH * ROPE);
      for (let hh = 0; hh < NH; hh++) enc.copyBufferToBuffer(q, (hh * HK + NOPE) * 4, qPe, hh * ROPE * 4, ROPE * 4);
      const kPe = alloc(ROPE); enc.copyBufferToBuffer(kvc, KVL * 4, kPe, 0, ROPE * 4);
      const qPeR = ropenB(qPe, NH, pos, NH * ROPE), kPeR = ropenB(kPe, 1, pos, ROPE);
      const kv = mvB(await weightBuf(p + "attn_kv_b.weight"), typeOf(p + "attn_kv_b.weight"), NH * step, KVL, kvCmpr);
      const Qc = alloc(NH * HK), Kc = alloc(NH * HK), Vc = alloc(NH * HV);
      rec(P.mlaasm, [q, kv, qPeR, kPeR, Qc, Kc, Vc, uU([NH, HK, HV, ROPE]), uU([NOPE, step, 0, 0])], G(NH));
      enc.copyBufferToBuffer(Kc, 0, Kbuf[il], pos * NH * HK * 4, NH * HK * 4);
      enc.copyBufferToBuffer(Vc, 0, Vbuf[il], pos * NH * HV * 4, NH * HV * 4);
      const ctx = alloc(NH * HV); rec(P.mlaattn, [Qc, Kbuf[il], Vbuf[il], ctx, uU([NH, HK, HV, pos]), uU([kqScale, 0, 0, 0], true)], G(NH));
      const attnOut = mvB(await weightBuf(p + "attn_output.weight"), typeOf(p + "attn_output.weight"), D, NH * HV, ctx);
      const h2 = addB(h, attnOut, D);
      const fn = rmsB(h2, await weightBuf(p + "ffn_norm.weight"), D);
      let ffn;
      if (il < c.leadingDense) {
        const FF = dimsOf(p + "ffn_gate.weight")[1];
        const g = mvB(await weightBuf(p + "ffn_gate.weight"), typeOf(p + "ffn_gate.weight"), FF, D, fn);
        const u = mvB(await weightBuf(p + "ffn_up.weight"), typeOf(p + "ffn_up.weight"), FF, D, fn);
        ffn = mvB(await weightBuf(p + "ffn_down.weight"), typeOf(p + "ffn_down.weight"), D, FF, swigB(g, u, FF));
      } else {
        const FFm = dimsOf(p + "ffn_gate_exps.weight")[1], gt = typeOf(p + "ffn_gate_exps.weight"), dt = typeOf(p + "ffn_down_exps.weight");
        const leB = mvB(await weightBuf(p + "ffn_gate_inp.weight"), 0, E, D, fn);
        const le = await readN(leB, E);                                  // ROUTER SYNC (only readback per MoE layer)
        const probs = softmax([...le]);
        const sel = [...probs.keys()].sort((a, b) => probs[b] - probs[a] || a - b).slice(0, USED);
        const wt = sel.map((e) => probs[e]);
        await prefetch(expertRefs(il, sel));
        const out = alloc(D);
        for (let i = 0; i < sel.length; i++) {
          const e = sel[i];
          const g = mvB(await expBuf(p + "ffn_gate_exps.weight", e), gt, FFm, D, fn);
          const u = mvB(await expBuf(p + "ffn_up_exps.weight", e), gt, FFm, D, fn);
          const dn = mvB(await expBuf(p + "ffn_down_exps.weight", e), dt, D, FFm, swigB(g, u, FFm));
          saxpyB(dn, out, wt[i], D);
        }
        const FFs = dimsOf(p + "ffn_gate_shexp.weight")[1];
        const sg = mvB(await weightBuf(p + "ffn_gate_shexp.weight"), typeOf(p + "ffn_gate_shexp.weight"), FFs, D, fn);
        const su = mvB(await weightBuf(p + "ffn_up_shexp.weight"), typeOf(p + "ffn_up_shexp.weight"), FFs, D, fn);
        const sh = mvB(await weightBuf(p + "ffn_down_shexp.weight"), typeOf(p + "ffn_down_shexp.weight"), D, FFs, swigB(sg, su, FFs));
        saxpyB(sh, out, 1, D);
        ffn = out;
      }
      h = addB(h2, ffn, D);
    }
    const lg = needLogits ? await lmHead(h) : (flush(), null);
    for (const b of trans) b.destroy(); trans = [];
    return lg;
  };

  // prefill the prompt (only the last position needs logits → the first predicted token)
  let prefillLogits = null;
  for (let pos = 0; pos < T; pos++) { prefillLogits = await runPos(pos, meta.ids[pos], pos === T - 1); if (log) log(`prefill ${pos + 1}/${T} · ${(netBytes / 1e6).toFixed(0)}MB · vram-weights ${wbuf.size}`); }
  // autoregressive generate — each step processes ONE position with weights+KV resident (the steady-state cost)
  let tok = argmax(prefillLogits); const gen = [tok], genTimes = [];
  for (let gi = 0; gi < genTokens; gi++) { const t0 = now(); const lg = await runPos(T + gi, tok, true); const dt = now() - t0; tok = argmax(lg); gen.push(tok); genTimes.push(dt); if (log) log(`gen ${gi + 1}/${genTokens}: id ${tok} · ${dt.toFixed(0)}ms`); }
  for (const b of wbuf.values()) b.destroy(); for (const b of Kbuf) b.destroy(); for (const b of Vbuf) b.destroy();
  if (lmChunks) for (const c of lmChunks) c.buf.destroy();
  const tokPerSec = genTimes.length ? genTimes.length / (genTimes.reduce((a, b) => a + b, 0) / 1000) : null;
  return { argmax: gen[0], logits: prefillLogits, gen, genTimes, tokPerSec, stats: { netBytes, verified, fetches, opfsHits, perf } };
}
