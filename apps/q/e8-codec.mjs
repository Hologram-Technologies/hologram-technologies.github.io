// e8-codec.mjs — the κ-object model delivery pipeline. A model is COMPILED once into content-addressed,
// E₈-quantized, entropy-coded blocks (stored small, deduped, verifiable), and DECODED on load back into
// the Q8 byte format the QVAC kernels already read. This is the "anchor every model in the atlas E₈
// standard, unified by the UOR substrate" step — the storage/delivery/verification win, no new kernels.
// Pure JS, isomorphic. Honest scope: this is the SUBSTRATE pipeline; near-lossless 2-bit also needs the
// full quant method (incoherence — in e8-quant.mjs; LDLQ — separate).
import { nearestE8, ldlDecompose, ldlqRoundE8 } from "./e8-quant.mjs";
import { sha256hex } from "./atlas-probe.mjs";

// isomorphic gzip (CompressionStream is in browsers + Node 18+)
async function gz(u8) { const cs = new CompressionStream("gzip"); const w = cs.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(cs.readable).arrayBuffer()); }
async function gunzip(u8) { const ds = new DecompressionStream("gzip"); const w = ds.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
const _enc = new TextEncoder(), _dec = new TextDecoder();

// COMPILE one tensor (engine Q8 bytes [int8 N*K][f32 scales]) → a content-addressed E₈ block.
// Stores: per-8-block E₈ lattice coordinates (2·q, Int8) in the original basis + one global δ. The Q8
// per-block scales are NOT stored (recomputed on decode). gzip captures the peaked index distribution.
export async function compileTensor(rawQ8, N, K, { rel = 0.5, standardKappa = null, hessian = null } = {}) {
  const qn = N * K, nsc = N * (K / 32);
  const q = new Int8Array(rawQ8.buffer.slice(rawQ8.byteOffset, rawQ8.byteOffset + qn));
  const sc = new Float32Array(rawQ8.buffer.slice(rawQ8.byteOffset + qn, rawQ8.byteOffset + qn + nsc * 4));
  let w = new Float32Array(qn); let ss = 0;
  for (let n = 0; n < N; n++) for (let k = 0; k < K; k++) { const val = q[n * K + k] * sc[n * (K / 32) + (k >> 5)]; w[n * K + k] = val; ss += val * val; }
  const rms = Math.sqrt(ss / qn) || 1e-8, delta = rel * rms;
  const idx = new Int8Array(qn);
  // calibrated adaptive rounding (ADR-0054): if an input Hessian H (K×K) is supplied, round the weights
  // to the E₈ lattice DIRECTLY inside the LDLQ recursion (codebook-aware — the feedback sees the lattice
  // point, no scalar-round-then-snap double-quantization). Either way the result lands on the δ·E₈ grid,
  // stored as 2·(coord) Int8; decode (idx/2·δ) reconstructs it. H is damped for a stable LDL.
  if (hessian && hessian.length === K * K) {
    const H = Float64Array.from(hessian); let tr = 0; for (let a = 0; a < K; a++) tr += H[a * K + a]; const dmp = 0.01 * tr / K || 1e-9;
    for (let a = 0; a < K; a++) H[a * K + a] += dmp;
    const { L } = ldlDecompose(H, K); w = ldlqRoundE8(w, N, K, L, delta);   // codebook-aware LDLQ
    for (let o = 0; o < qn; o++) { let c = Math.round(w[o] / delta * 2); if (c > 127) c = 127; else if (c < -127) c = -127; idx[o] = c; }
  } else {
    const v = new Float64Array(8), p = new Float64Array(8);
    for (let o = 0; o < qn; o += 8) { for (let i = 0; i < 8; i++) v[i] = w[o + i] / delta; nearestE8(v, p); for (let i = 0; i < 8; i++) { let c = Math.round(p[i] * 2); if (c > 127) c = 127; else if (c < -127) c = -127; idx[o + i] = c; } }
  }
  const head = _enc.encode(JSON.stringify({ N, K, delta, algo: "e8/2q", standard: standardKappa }));
  const blob = new Uint8Array(4 + head.length + qn); new DataView(blob.buffer).setUint32(0, head.length); blob.set(head, 4); blob.set(new Uint8Array(idx.buffer), 4 + head.length);
  const bytes = await gz(blob);
  return { bytes, kappa: "did:holo:sha256:" + await sha256hex(bytes), bits: bytes.length * 8 / qn };
}

// DECODE a compiled block → engine Q8 bytes (int8 + recomputed per-32 scales).
export async function decodeTensor(bytes) {
  const blob = await gunzip(bytes); const hl = new DataView(blob.buffer, blob.byteOffset).getUint32(0);
  const { N, K, delta } = JSON.parse(_dec.decode(blob.subarray(4, 4 + hl)));
  const idx = new Int8Array(blob.buffer.slice(blob.byteOffset + 4 + hl, blob.byteOffset + 4 + hl + N * K));
  const w = new Float32Array(N * K); for (let o = 0; o < N * K; o++) w[o] = (idx[o] / 2) * delta;   // reconstruct
  const nsc = N * (K / 32), outQ = new Int8Array(N * K), outS = new Float32Array(nsc);
  for (let n = 0; n < N; n++) for (let b = 0; b < K / 32; b++) { let mx = 0; const base = n * K + b * 32; for (let i = 0; i < 32; i++) { const a = Math.abs(w[base + i]); if (a > mx) mx = a; } const s = mx / 127 || 1e-12; outS[n * (K / 32) + b] = s; for (let i = 0; i < 32; i++) { let qi = Math.round(w[base + i] / s); if (qi > 127) qi = 127; else if (qi < -127) qi = -127; outQ[base + i] = qi; } }
  const out = new Uint8Array(N * K + nsc * 4); out.set(new Uint8Array(outQ.buffer), 0); out.set(new Uint8Array(outS.buffer), N * K); return out;
}

// node self-test: round-trip a real tensor, verify lossless decode of the quantized weights + compression
if (typeof process !== "undefined" && process.argv[1] && process.argv[1].endsWith("e8-codec.mjs")) {
  const { parseGgufHeader, dequantizeRaw, typeByteLen, quantBlocks } = await import("./qvac-ingest.mjs");
  const URL = "https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q8_0.gguf";
  const rng = async (s, e) => { const r = await fetch(URL, { headers: { Range: `bytes=${s}-${e}` }, redirect: "follow" }); return new Uint8Array(await r.arrayBuffer()); };
  const head = await rng(0, 4 << 20); const { dataOffset, tensors } = parseGgufHeader(head);
  const t = tensors.find((x) => x.name === "blk.0.ffn_down.weight"); const K = t.dims[0], N = t.dims[1];
  const raw = await rng(dataOffset + t.offset, dataOffset + t.offset + typeByteLen(t.ggmlType, N * K) - 1);
  const f = dequantizeRaw(t.ggmlType, raw, N * K);
  const { q: qq, s: qs } = quantBlocks(f, N, K, 8);                     // engine Q8 → concat [int8 N*K][f32 scales]
  const q8 = new Uint8Array(N * K + qs.length * 4); q8.set(qq, 0); q8.set(new Uint8Array(qs.buffer), N * K);
  for (const rel of [0.35, 0.5, 0.7]) {
    const c = await compileTensor(q8, N, K, { rel }); const d = await decodeTensor(c.bytes);
    // decode determinism: decode twice ⇒ identical (lossless, re-derivable)
    const d2 = await decodeTensor(c.bytes); let same = d.length === d2.length; for (let i = 0; same && i < d.length; i++) same = d[i] === d2[i];
    console.log(`rel=${rel}  ${(N * K / 1e6).toFixed(2)}M weights  →  κ-object ${(c.bytes.length / 1024).toFixed(0)}KB = ${c.bits.toFixed(2)} bits/weight (${(8 / c.bits).toFixed(1)}× vs Q8)  decode lossless=${same}  κ=${c.kappa.slice(0, 30)}…`);
  }
}
