// compile2bit.mjs — the OFFLINE 2-bit compiler (the "compile" half of the 7B infra). Decouples COMPILE from
// LOAD: a Q8 GGUF is re-quantized ONCE, offline, into a content-addressed native-2-bit κ-object the browser
// downloads and runs directly (no hour-class re-quant at load; hosting = serve the block dir, κ-store/κ-disk
// verify per-sector). Reuses the engine's EXACT ingestion (qvac-ingest makeDiskFetcher).
//
// DEFAULT mode = "ldlq": codebook-aware LDLQ to the 2-bit scalar grid (NO incoherence ⇒ no power-of-2
// padding, no runtime Hadamard) + fp16 scales ⇒ ~2.5 bits/weight. LDLQ uses a PROXY input Hessian H=EᵀE from
// the token embeddings (real per-layer calibration needs running the model — a GPU-box job); applied to every
// K=d matrix, scalar fallback for the FFN down-proj (K=ff). Resumable: re-running skips tensors already done.
// Usage: node compile2bit.mjs <gguf-url> <out-dir> [ldlq|incoherent]
import { readHeader, parseGgufHeader, buildManifest, makeDiskFetcher, ggufNameFor } from "./qvac-ingest.mjs";
import { requant2bit, ldlqRound2bit, f32ToF16 } from "./qvac-2bit.mjs";
import { ldlDecompose } from "./e8-quant.mjs";
import { buildE8LUT, packE8, lutNormIndex } from "./e8-lut.mjs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { stampFrame } from "./holo-model-frame.mjs";   // A1: born-stamped shared-frame descriptor + conformance fingerprint

// friendly model registry → Q8_0 GGUF source (or pass a full URL). Add your own here.
const REGISTRY = {
  "smollm2-135m": "https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q8_0.gguf",
  "qwen2.5-0.5b": "https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q8_0.gguf",
  "qwen2.5-1.5b": "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q8_0.gguf",
  "qwen2.5-3b": "https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q8_0.gguf",
  "qwen2.5-7b": "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q8_0.gguf",
  "llama-3.2-1b": "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q8_0.gguf",
  "llama-3.2-3b": "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q8_0.gguf",
};
const arg = process.argv[2];
if (!arg || arg === "--help" || arg === "-h") {
  console.log(`usage: npm run compile2bit <model> [mode] [out-dir]
  mode  : q4 (default, coherent) | ldlq | incoherent (2-bit, research)
  model : ${Object.keys(REGISTRY).join(", ")}\n          …or a full Q8_0 GGUF URL
  out   : default ./models/<model>-<mode>  (a content-addressed κ-object dir: manifest.json + b/<κ>.gz)
example: npm run compile2bit qwen2.5-7b          → ./models/qwen2.5-7b-q4`);
  process.exit(arg ? 0 : 1);
}
const isUrl = /^https?:\/\//.test(arg);
const isLocal = !isUrl && existsSync(arg);                       // a local GGUF path (browser-downloaded — sidesteps HF throttle)
const URL = isUrl || isLocal ? arg : REGISTRY[arg];
if (!URL) { console.error(`unknown model "${arg}". known: ${Object.keys(REGISTRY).join(", ")} (or pass a GGUF URL / local path)`); process.exit(1); }
const name = isUrl ? "model" : arg;
const MODE = process.argv[3] || "q4";                          // q4 = coherent default
const OUT = process.argv[4] || `./models/${name}-${MODE}`;
// local-file OR http range reader: a non-http arg is treated as a path on disk (sidesteps the
// HF throttle — download the GGUF in a browser, point us at the file).
let _localFd = null;
const readRange = async (url, start, len) => {
  if (!/^https?:\/\//.test(url)) {
    const fs = await import("node:fs");
    if (_localFd === null) _localFd = fs.openSync(url, "r");
    const buf = Buffer.allocUnsafe(len);
    let got = 0;
    while (got < len) { const n = fs.readSync(_localFd, buf, got, len - got, start + got); if (n <= 0) break; got += n; }
    return new Uint8Array(buf.buffer, buf.byteOffset, got);
  }
  for (let a = 0; a < 8; a++) { try { const r = await fetch(url, { headers: { Range: `bytes=${start}-${start + len - 1}` }, redirect: "follow" }); if (r.ok || r.status === 206) return new Uint8Array(await r.arrayBuffer()); } catch {} await new Promise(z => setTimeout(z, 500 * (a + 1))); } throw new Error("range fetch failed @" + start);
};
const sha = (b) => "sha256:" + createHash("sha256").update(b).digest("hex");
const MB = (n) => (n / 1e6).toFixed(1);

console.log(`compiling [${MODE}] ${URL}`);
const { dataOffset, tensors, headerBytes } = await readHeader(URL, readRange);
const meta = parseGgufHeader(headerBytes).meta;
const manifest = buildManifest(meta, tensors, 8);
// MoE (G5): buildManifest enumerates only the router per layer (experts are too many to stream-name);
// the κ-object compiler DOES enumerate every expert slice so each is packed + content-addressed. The
// expert FFN runs in the engine's Q4 path (ExpQ/ExpS expect engine-Q4 [nibbles][f32 scales]), so MoE
// compiles in q4 mode only. makeDiskFetcher resolves `l{i}.e{e}.{role}` → the e-th slab of ffn_*_exps.
if (manifest.moe) {
  if (MODE !== "q4") throw new Error(`MoE compiles in q4 mode only (got "${MODE}") — the resident expert FFN runs the engine's Q4 GEMV`);
  const { n_experts } = manifest.moe, { d: dM, ff: ffM, n_layers: nL } = manifest;
  const exp = [];
  for (let i = 0; i < nL; i++) for (let e = 0; e < n_experts; e++) {
    exp.push({ name: `l${i}.e${e}.gate`, N: ffM, K: dM, blk: true });
    exp.push({ name: `l${i}.e${e}.up`, N: ffM, K: dM, blk: true });
    exp.push({ name: `l${i}.e${e}.down`, N: dM, K: ffM, blk: true });
  }
  manifest.tensors = manifest.tensors.concat(exp);
  console.log(`  MoE: ${n_experts} experts × ${nL} layers × 3 = ${exp.length} expert matrices enumerated (+ routers)`);
}
const BITS = (MODE === "q4" || MODE === "q3" || MODE === "e8") ? 4 : 8;   // q4/q3/e8 source from Q4 (fast relayout); old 2-bit modes from Q8
// 3-bit bit-plane packer: per 32-block, 3 u32 planes (low/mid/high bit) + one f32 scale; level = 2q−7 ∈ {−7…7}.
function packQ3(W, N, K) {
  const nb = K / 32, planes = new Uint32Array(N * nb * 3), sc = new Float32Array(N * nb);
  for (let n = 0; n < N; n++) for (let b = 0; b < nb; b++) {
    const o = n * K + b * 32; let mx = 0; for (let i = 0; i < 32; i++) { const a = Math.abs(W[o + i]); if (a > mx) mx = a; }
    // MSE-optimal scale (k-quant trick): search the step that minimises block reconstruction error on the zero-centered grid {−3…4}.
    let s = (mx / 3) || 1e-12, bestMse = Infinity;
    for (let c = 0; c < 9; c++) { const sc2 = (mx * (0.22 + c * 0.035)) || 1e-12; let mse = 0; for (let i = 0; i < 32; i++) { let q = Math.round(W[o + i] / sc2) + 3; if (q < 0) q = 0; else if (q > 7) q = 7; const d = W[o + i] - (q - 3) * sc2; mse += d * d; } if (mse < bestMse) { bestMse = mse; s = sc2; } }
    sc[n * nb + b] = s;
    // FIELD layout ("q3f"): 10×3-bit direct fields per u32 (w0-9→p0, w10-19→p1, w20-29→p2); w30/w31
    // ride the three spare 2-bit stubs (sp6 = q30|q31<<3, split 2+2+2 across the word tops). Same
    // 12 B/block as the old bit-planes, but the GPU unpack is ONE shift+and per weight (~½ the ALU).
    let p0 = 0, p1 = 0, p2 = 0, sp6 = 0;
    for (let i = 0; i < 32; i++) {
      let q = Math.round(W[o + i] / s) + 3; if (q < 0) q = 0; else if (q > 7) q = 7;
      if (i < 10) p0 |= q << (i * 3);
      else if (i < 20) p1 |= q << ((i - 10) * 3);
      else if (i < 30) p2 |= q << ((i - 20) * 3);
      else sp6 |= q << ((i - 30) * 3);
    }
    p0 |= (sp6 & 3) << 30; p1 |= ((sp6 >> 2) & 3) << 30; p2 |= ((sp6 >> 4) & 3) << 30;
    const bp = (n * nb + b) * 3; planes[bp] = p0 >>> 0; planes[bp + 1] = p1 >>> 0; planes[bp + 2] = p2 >>> 0;
  }
  return { q: new Uint8Array(planes.buffer), s: sc };
}
// ── bitnet raw fetch: i2_s (ternary), f16, f32 read straight off the GGUF (makeDiskFetcher
// doesn't know i2_s). i2_s layout (ground-truthed vs the bf16 master, 0 non-boundary misses):
// 128-weight blocks → 32 bytes; weight j of a block lives in byte (j mod 32) at bit-pair
// (j div 32), MSB-first (shift = 6−2·plane); codes {0,1,2} = {−1,0,+1}; ONE f32 tensor scale
// in a 32-byte tail. We re-pack to the engine's canonical t2 order: 16 codes per u32, LSB-first.
const GGML_I2S_BYTES = (el) => el / 4 + 32;
const rawFetch = async (name) => {
  const gname = ggufNameFor(name, !manifest.tied); const t = tensors.find((x) => x.name === gname);
  if (!t) throw new Error("no gguf tensor for " + name);
  const el = t.dims.reduce((a, b) => a * b, 1);
  const ty = t.ggmlType;
  const len = ty === 0 ? el * 4 : ty === 1 ? el * 2 : ty === 35 ? el / 256 * 66 : ty === 12 ? el / 256 * 144 : ty === 14 ? el / 256 * 210 : GGML_I2S_BYTES(el);
  return { t, el, ty, bytes: await readRange(URL, dataOffset + Number(t.offset), len) };
};
const f16f = (u) => { const s = (u >> 15) & 1, e = (u >> 10) & 31, m = u & 1023; const v = e === 0 ? m / 1024 * 2 ** -14 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15); return s ? -v : v; };
const decodeT = (bytes, el) => {                            // i2_s → codes {0,1,2} in natural order + scale
  const dv = new DataView(bytes.buffer, bytes.byteOffset + el / 4, 32);
  const scale = dv.getFloat32(0, true);
  const codes = new Uint8Array(el);
  let bad = 0;
  for (let i = 0; i < el; i++) { const blk = (i / 128) | 0, j = i % 128; const c = (bytes[blk * 32 + (j % 32)] >> (6 - 2 * ((j / 32) | 0))) & 3; if (c === 3) bad++; codes[i] = c; }
  if (bad > 0) throw new Error(`i2_s alphabet violation: ${bad} fields decode to 3 — layout differs for this model`);
  if (!(scale > 0 && scale < 1e3)) throw new Error(`implausible i2_s scale ${scale}`);
  return { codes, scale };
};
const packT2 = (codes, el) => {                             // canonical t2: 16 codes/u32, LSB-first
  const w = new Uint32Array(el / 16);
  for (let i = 0; i < el; i++) w[i >> 4] |= codes[i] << ((i & 15) * 2);
  return new Uint8Array(w.buffer);
};
// TQ2_0 (mainline llama.cpp ternary, type 35): 256-w blocks of 66 B = qs[64] (four 32-byte planes,
// LSB-first: trit j of a 128-w half in byte (j mod 32) at bit-pair (j div 32)) + ONE f16 scale/block.
// Returns codes {0,1,2} + the per-block scales (collapsed to per-tensor upstream when uniform).
const decodeTQ2 = (bytes, el) => {
  const nb = el / 256, codes = new Uint8Array(el), scales = new Float32Array(nb);
  let bad = 0;
  for (let b = 0; b < nb; b++) {
    const o = b * 66;
    for (let i = 0; i < 256; i++) {
      const half = (i / 128) | 0, j = i % 128;
      const c = (bytes[o + half * 32 + (j % 32)] >> (2 * ((j / 32) | 0))) & 3;
      if (c === 3) bad++;
      codes[b * 256 + i] = c;
    }
    scales[b] = f16f(bytes[o + 64] | (bytes[o + 65] << 8));
  }
  if (bad > 0) throw new Error(`TQ2_0 alphabet violation: ${bad} fields = 3`);
  return { codes, scales };
};
// K-quant dequant (verbatim ggml layouts) — for the 8B's Q4_K embed / Q6_K output
const decodeQ4K = (bytes, el) => {
  const nb = el / 256, W = new Float32Array(el);
  for (let b = 0; b < nb; b++) {
    const o = b * 144, d = f16f(bytes[o] | (bytes[o + 1] << 8)), dmin = f16f(bytes[o + 2] | (bytes[o + 3] << 8));
    const sc = bytes.subarray(o + 4, o + 16), qs = bytes.subarray(o + 16, o + 144);
    const sm = (j) => j < 4 ? [sc[j] & 63, sc[j + 4] & 63] : [(sc[j + 4] & 0xF) | ((sc[j - 4] >> 6) << 4), (sc[j + 4] >> 4) | ((sc[j] >> 6) << 4)];
    let y = b * 256, is = 0, q = 0;
    for (let j = 0; j < 256; j += 64) {
      const [s1, m1] = sm(is), [s2, m2] = sm(is + 1);
      for (let l = 0; l < 32; l++) W[y + l] = d * s1 * (qs[q + l] & 0xF) - dmin * m1;
      for (let l = 0; l < 32; l++) W[y + 32 + l] = d * s2 * (qs[q + l] >> 4) - dmin * m2;
      y += 64; q += 32; is += 2;
    }
  }
  return W;
};
const decodeQ6K = (bytes, el) => {
  const nb = el / 256, W = new Float32Array(el);
  for (let b = 0; b < nb; b++) {
    const o = b * 210, ql = bytes.subarray(o, o + 128), qh = bytes.subarray(o + 128, o + 192);
    const sc = new Int8Array(bytes.buffer, bytes.byteOffset + o + 192, 16), d = f16f(bytes[o + 208] | (bytes[o + 209] << 8));
    let y = b * 256, pql = 0, pqh = 0, psc = 0;
    for (let n = 0; n < 256; n += 128) {
      for (let l = 0; l < 32; l++) {
        const is = (l / 16) | 0;
        W[y + l] = d * sc[psc + is] * (((ql[pql + l] & 0xF) | (((qh[pqh + l] >> 0) & 3) << 4)) - 32);
        W[y + l + 32] = d * sc[psc + is + 2] * (((ql[pql + l + 32] & 0xF) | (((qh[pqh + l] >> 2) & 3) << 4)) - 32);
        W[y + l + 64] = d * sc[psc + is + 4] * (((ql[pql + l] >> 4) | (((qh[pqh + l] >> 4) & 3) << 4)) - 32);
        W[y + l + 96] = d * sc[psc + is + 6] * (((ql[pql + l + 32] >> 4) | (((qh[pqh + l] >> 6) & 3) << 4)) - 32);
      }
      y += 128; pql += 64; pqh += 32; psc += 8;
    }
  }
  return W;
};
const fetchTensor = MODE === "bitnet" ? null : makeDiskFetcher({ url: URL, readRange, dataOffset, tensors, manifest, bits: BITS });
const { d, ff, vocab } = manifest, nbD = d / 32;

mkdirSync(OUT + "/b", { recursive: true });
// self-contained tokenizer: bundle the GGUF header (tokenizer + arch kv) into the κ-object so the
// browser loader needs NO external source URL (works offline / when HF is unreachable).
const LOCAL_SRC = !/^https?:\/\//.test(URL);
if (LOCAL_SRC) writeFileSync(OUT + "/tokenizer.gguf", headerBytes);
const progPath = OUT + "/progress.json";
const index = existsSync(progPath) ? JSON.parse(readFileSync(progPath, "utf8")) : {};
const saveProg = () => writeFileSync(progPath, JSON.stringify(index));
const writeBlock = (bytes) => { const gz = gzipSync(bytes, { level: 6 }); const k = sha(gz); const f = `${OUT}/b/${k.replace(":", "_")}.gz`; if (!existsSync(f)) writeFileSync(f, gz); return { kappa: k, stored: gz.length }; };
const packScales = (sc) => { const u = new Uint16Array(sc.length); for (let i = 0; i < sc.length; i++) u[i] = f32ToF16(sc[i]); return new Uint8Array(u.buffer); };

// LDLQ proxy Hessian: H = Σ_t e_t e_tᵀ over a token subset of the embedding table → L (for every K=d matrix).
// L is cached to disk so a resume skips the 543 MB embed re-fetch + the O(d³) decompose (and the memory peak).
let Ld = null; const Lpath = OUT + "/_L.bin";
if (MODE === "ldlq") {
  if (existsSync(Lpath)) { const buf = readFileSync(Lpath); Ld = new Float64Array(buf.buffer, buf.byteOffset, buf.length / 8); console.log("  loaded cached proxy L (" + (buf.length / 1e6).toFixed(0) + "MB)"); }
  else {
    process.stdout.write("  building proxy Hessian (embed EᵀE)… ");
    let eb = await fetchTensor("embed"); const eq = new Int8Array(eb.buffer, eb.byteOffset, vocab * d), es = new Float32Array(eb.buffer, eb.byteOffset + vocab * d, vocab * nbD);
    const T = 4000, H = new Float64Array(d * d), e = new Float64Array(d); let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let n = 0; n < T; n++) { const tk = (rnd() * vocab) | 0; for (let a = 0; a < d; a++) e[a] = eq[tk * d + a] * es[tk * nbD + (a >> 5)]; for (let a = 0; a < d; a++) { const ea = e[a], row = a * d; for (let b = a; b < d; b++) H[row + b] += ea * e[b]; } }
    eb = null; const es2 = null;                                 // release the 543 MB embed before the decompose
    for (let a = 0; a < d; a++) for (let b = a + 1; b < d; b++) H[b * d + a] = H[a * d + b];
    let tr = 0; for (let a = 0; a < d; a++) tr += H[a * d + a]; const dmp = 0.01 * tr / d; for (let a = 0; a < d; a++) H[a * d + a] += dmp;
    Ld = ldlDecompose(H, d).L; writeFileSync(Lpath, Buffer.from(Ld.buffer)); console.log("done (cached L)");
  }
}

let tIn = 0, tOut = 0, t0 = Date.now(), nLdlq = 0, E8 = null, embedQ3 = null;
const tlist = manifest.tensors;
for (let ti = 0; ti < tlist.length; ti++) {
  const t = tlist[ti]; if (index[t.name]) { tOut += index[t.name].stored || 0; continue; }   // resume
  if (MODE === "bitnet") {
    const { el, ty, bytes } = await rawFetch(t.name);
    let rec;
    if (t.name === "embed" || t.name === "lm_head") {       // f16/Q4_K/Q6_K → q3f pack (tied models reuse ONE block — content-address dedups)
      let blk3 = manifest.tied ? embedQ3 : null;
      if (!blk3) {
        let W;
        if (ty === 1) { W = new Float32Array(el); const u16 = new Uint16Array(bytes.buffer, bytes.byteOffset, el); for (let i = 0; i < el; i++) W[i] = f16f(u16[i]); }
        else if (ty === 12) W = decodeQ4K(bytes, el);
        else if (ty === 14) W = decodeQ6K(bytes, el);
        else throw new Error(`unsupported ${t.name} ggml type ${ty}`);
        const r = packQ3(W, t.N, t.K); const blob = new Uint8Array(r.q.length + r.s.byteLength); blob.set(r.q, 0); blob.set(new Uint8Array(r.s.buffer), r.q.length);
        blk3 = writeBlock(blob);
        if (manifest.tied) embedQ3 = blk3;
      }
      rec = { fmt: "q3", N: t.N, K: t.K, ...blk3 };
    } else if (t.blk && ty === 35) {                        // TQ2_0 ternary: collapse per-block scales when uniform (trained per-tensor) → t2; else q3 fallback
      const { codes, scales } = decodeTQ2(bytes, el);
      // all-zero blocks quantize to d=0 with codes=1 — exact under ANY scale, so they don't break
      // uniformity (TriLM has many; treating them as deviation forced 209 tensors into q3f).
      let s0 = 0; for (const s of scales) if (s > s0) s0 = s;
      let dev = 0, zeroOk = true;
      for (let b = 0; b < scales.length; b++) {
        const s = scales[b];
        if (s === 0) { for (let i = b * 256; i < (b + 1) * 256; i++) if (codes[i] !== 1) { zeroOk = false; break; } }
        else dev = Math.max(dev, Math.abs(s - s0) / s0);
      }
      if (dev < 1e-3 && zeroOk) {
        rec = { fmt: "t2", N: t.N, K: t.K, s: s0, ...writeBlock(packT2(codes, el)) };
      } else {                                              // non-uniform (per-row/channel scale structure, e.g. TriLM):
        // t2r = EXACT TQ2_0 re-layout — trit codes (the lattice residents) + per-256-block f32
        // scales. 2.125 bpw, runs the ternary kernel, and the atlas-bridge witness reads the codes.
        const blob = new Uint8Array(el / 4 + scales.byteLength);
        blob.set(packT2(codes, el), 0); blob.set(new Uint8Array(scales.buffer), el / 4);
        rec = { fmt: "t2r", N: t.N, K: t.K, ...writeBlock(blob) };
        if (!rawFetch.warned) { console.log(`\n  NOTE: ${t.name} has non-uniform TQ2_0 scales (dev ${dev.toFixed(4)}) → t2r (per-block scales)`); rawFetch.warned = true; }
      }
    } else if (t.blk) {                                     // i2_s ternary matrix → canonical t2 + per-tensor scale in the manifest
      const { codes, scale } = decodeT(bytes, el);
      rec = { fmt: "t2", N: t.N, K: t.K, s: scale, ...writeBlock(packT2(codes, el)) };
    } else {                                                // norms (f32) verbatim
      if (ty !== 0) throw new Error(`expected f32 norm ${t.name}, got ggml type ${ty}`);
      rec = { fmt: "f32", N: t.N, K: t.K, ...writeBlock(bytes) };
    }
    index[t.name] = rec; tIn += bytes.length; tOut += rec.stored;
    if (ti % 10 === 0) { saveProg(); process.stdout.write(`\r  ${Object.keys(index).length}/${tlist.length} tensors · ${MB(tOut)}MB · ${((Date.now() - t0) / 1000).toFixed(0)}s   `); }
    continue;
  }
  const bytes = await fetchTensor(t.name); if (!bytes || bytes.length === 0) continue;
  let rec;
  if (MODE === "q4") {                                       // native Q4: fetchTensor already returns engine [nibbles][f32 scales] — store verbatim
    rec = { fmt: t.blk ? "q4" : "f32", N: t.N, K: t.K, ...writeBlock(bytes) };
  } else if (MODE === "q3" || MODE === "e8") {                // q3: all → 3-bit fields. e8: layers → E₈ codewords (2.5 b/w); embed+lm_head stay q3f
    if (!t.blk) { rec = { fmt: "f32", N: t.N, K: t.K, ...writeBlock(bytes) }; }
    else { const N = t.N, K = t.K, qlen = N * K / 2, nb = K / 32; const q = bytes.subarray(0, qlen), s = new Float32Array(bytes.buffer, bytes.byteOffset + qlen, N * nb);
      const W = new Float32Array(N * K); for (let i = 0; i < N * K; i++) { const nib = (q[i >> 1] >> ((i & 1) * 4)) & 0xf; W[i] = (nib - 8) * s[(((i / K) | 0) * nb) + (((i % K) >> 5))]; }
      const e8only = process.env.E8_ONLY;                   // diagnostic bisect: "attn" | "ffn" restricts which tensor class goes e8q
      const e8Eligible = !e8only || (e8only === "attn" ? /\.(wq|wk|wv|wo)$/.test(t.name) : /\.(w_gate|w_up|w_down)$/.test(t.name));
      if (MODE === "e8" && t.name !== "embed" && t.name !== "lm_head" && e8Eligible) {
        if (!E8) {                                            // build the codebook ONCE from this model's own weights (deterministic; resumable via _lut.bin)
          const lutPath = OUT + "/_lut.bin";
          if (existsSync(lutPath)) { const b = readFileSync(lutPath); E8 = { lut: new Float32Array(b.buffer, b.byteOffset, 2048) }; }
          else { const sample = W.subarray(0, Math.min(1 << 21, N * K)); E8 = buildE8LUT(sample); writeFileSync(lutPath, Buffer.from(E8.lut.buffer)); }
          E8.index = E8.index || new Map(Array.from({ length: 256 }, (_, c) => [Array.from({ length: 8 }, (_, i) => Math.abs(Math.round(E8.lut[c * 8 + i] * 2))).join(",") + ",", c]));
          E8.rec = writeBlock(new Uint8Array(E8.lut.buffer.slice(0)));   // the LUT as a content-addressed block (the substrate anchor)
          console.log(`\n  E₈ LUT sealed: ${E8.rec.kappa.slice(0, 40)}…`);
        }
        const r = packE8(W, N, K, E8.lut, E8.index, f32ToF16);
        rec = { fmt: "e8q", N, K, fp16: true, ...writeBlock(r.blob) };
      } else {
        const r = packQ3(W, N, K); const blob = new Uint8Array(r.q.length + r.s.byteLength); blob.set(r.q, 0); blob.set(new Uint8Array(r.s.buffer), r.q.length);
        rec = { fmt: "q3", N, K, ...writeBlock(blob) };
      }
    }
  } else if (t.blk && t.name !== "embed") {
    const N = t.N, K = t.K, qlen = N * K, nb = K / 32;
    const q = bytes.subarray(0, qlen), s = new Float32Array(bytes.buffer, bytes.byteOffset + qlen, N * nb);
    const W = new Float32Array(qlen); for (let i = 0; i < qlen; i++) W[i] = (q[i] << 24 >> 24) * s[(((i / K) | 0) * nb) + (((i % K) >> 5))];
    if (MODE === "incoherent") {
      const r = requant2bit(bytes.subarray(0, qlen), s, N, K); const blob = new Uint8Array(r.q.length + r.s.byteLength); blob.set(r.q, 0); blob.set(new Uint8Array(r.s.buffer), r.q.length);
      rec = { fmt: "2bit", N, K, Kp: r.Kp, incoherent: true, ...writeBlock(blob) };
    } else {
      const sc = new Float32Array(N * nb); for (let i = 0; i < N; i++) for (let b = 0; b < nb; b++) { let mx = 0; for (let j = 0; j < 32; j++) { const a = Math.abs(W[i * K + b * 32 + j]); if (a > mx) mx = a; } sc[i * nb + b] = (mx / 3) || 1e-12; }
      const useL = (K === d) ? Ld : null; if (useL) nLdlq++;
      const qw = ldlqRound2bit(W, N, K, useL, sc, 256); const f16 = packScales(sc);   // banded LDLQ (256) — feasible at 7B scale
      const blob = new Uint8Array(qw.byteLength + f16.length); blob.set(new Uint8Array(qw.buffer), 0); blob.set(f16, qw.byteLength);
      rec = { fmt: "2bit", N, K, ldlq: !!useL, incoherent: false, fp16: true, ...writeBlock(blob) };
    }
    nLdlq;
  } else {
    rec = { fmt: t.name === "embed" ? "q8" : "f32", N: t.N, K: t.K, ...writeBlock(bytes) };
  }
  index[t.name] = rec; tIn += bytes.length; tOut += rec.stored;
  if (ti % 10 === 0) { saveProg(); process.stdout.write(`\r  ${Object.keys(index).length}/${tlist.length} tensors · ${MB(tOut)}MB · ${((Date.now() - t0) / 1000).toFixed(0)}s   `); }
}
saveProg();
if (MODE === "e8" && !E8 && existsSync(OUT + "/_lut.bin")) {     // resume edge: all tensors journaled, LUT κ still needed
  const b = readFileSync(OUT + "/_lut.bin");
  E8 = { lut: new Float32Array(b.buffer, b.byteOffset, 2048) }; E8.rec = writeBlock(new Uint8Array(E8.lut.buffer.slice(0)));
}
const root = sha(Buffer.from(Object.keys(index).sort().map(n => n + ":" + index[n].kappa).join("\n")));
const { n_heads, n_kv_heads, n_layers, hd, rope_base, attn_bias, qk_norm, qk_norm_dim, tied, sub_norm, ffn_act } = manifest;
const NATIVE3 = MODE === "q3" || MODE === "e8" || MODE === "bitnet";
const outBits = NATIVE3 ? 3 : MODE === "q4" ? 4 : 8;
const out = { format: "holo-2bit/1", mode: MODE, model: meta["general.name"] || "model", source: LOCAL_SRC ? "tokenizer.gguf" : URL, bits: outBits, ...(NATIVE3 ? { layout: "q3f" } : {}), ...(E8 ? { e8lut: E8.rec.kappa } : {}), ...(sub_norm ? { sub_norm: true } : {}), ...(ffn_act ? { ffn_act } : {}), ...(manifest.moe ? { moe: manifest.moe } : {}), twoBit: !NATIVE3 && MODE !== "q4", incoherent: MODE === "incoherent", root, d, n_heads, n_kv_heads, ff, vocab, n_layers, hd, rope_base, attn_bias, qk_norm, qk_norm_dim, tied, tensors: index };
await stampFrame(out);   // A1: stamp the frame (id + fingerprint) so the model is born conformant; root κ is over tensor blocks, so this does not change it
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(out, null, 1));
console.log(`\n\ncompiled → ${OUT}  [${MODE}]`);
console.log(`  ${Object.keys(index).length} tensors · κ-object ${MB(tOut)}MB · ${nLdlq} matrices LDLQ'd (proxy H), rest scalar`);
console.log(`  root κ ${root.slice(0, 44)}…  ·  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
