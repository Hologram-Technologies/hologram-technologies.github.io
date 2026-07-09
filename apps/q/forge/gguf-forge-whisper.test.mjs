// Holo Whisper S0 witness: legacy-ggml reader + κ-forge on the REAL ggml-small.bin.
// Proves: format parsed exactly (every byte consumed), hparams match Whisper-small,
// all 479 tensors forge to κ-objects, L5 re-derive holds, tamper is refused, the
// model gets one deterministic root κ. (Forges 488 MB → pure-JS sha256 ~40 s.)

import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { parseWhisperHeader, forgeWhisper, whisperConvStem, whisperEncoder, whisperDecoder } from "./gguf-forge-whisper.mjs";
import { loadByKappa, mapStore } from "./gguf-forge.mjs";
import { dequantizeExact } from "./gguf-forge-dequant.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

const MODEL = "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/ggml-small.bin";
if (!existsSync(MODEL)) { console.log("  (skipped — ggml-small.bin not present)"); process.exit(0); }

const bytes = new Uint8Array(readFileSync(MODEL));

t("legacy-ggml header parses EXACTLY (every byte consumed, no drift)", () => {
  const h = parseWhisperHeader(bytes);
  assert.strictEqual(h.bytesConsumed, bytes.byteLength, "trailing/short bytes → format drift");
  assert.deepStrictEqual(h.hparams, {
    n_vocab: 51865, n_audio_ctx: 1500, n_audio_state: 768, n_audio_head: 12, n_audio_layer: 12,
    n_text_ctx: 448, n_text_state: 768, n_text_head: 12, n_text_layer: 12, n_mels: 80, ftype: 1,
  });
  assert.strictEqual(h.mel.n_mel, 80); assert.strictEqual(h.mel.n_fft, 201);
  assert.strictEqual(h.tensors.length, 479);
});

const f = forgeWhisper(bytes);
const store = mapStore(f.blocks);

t("forge: 479 tensors → κ-objects, encoder+decoder+conv+cross-attn all present", () => {
  assert.strictEqual(f.tensors.length, 479);
  assert.strictEqual(f.plan.arch, "whisper");
  assert.strictEqual(f.plan.hparams.n_audio_layer, 12);
  const names = new Set(f.tensors.map((x) => x.name));
  for (const n of ["encoder.conv1.weight", "encoder.conv2.weight", "encoder.positional_embedding",
    "encoder.blocks.0.attn.query.weight", "encoder.blocks.11.mlp.2.weight",
    "decoder.token_embedding.weight", "decoder.blocks.0.cross_attn.key.weight", "decoder.ln.weight"])
    assert.ok(names.has(n), `missing tensor ${n}`);
  // Whisper quirk: attention KEY projection has no bias (query/value do).
  assert.ok(!names.has("encoder.blocks.0.attn.key.bias"), "K proj should have no bias");
  assert.ok(names.has("encoder.blocks.0.attn.query.bias"), "Q proj has bias");
});

t("root κ is a did:holo sha256 and re-hashing the plan reproduces it", () => {
  assert.match(f.rootKappa, /^did:holo:sha256:[0-9a-f]{64}$/);
  const again = forgeWhisper(bytes).rootKappa; // deterministic from the same bytes
  assert.strictEqual(again, f.rootKappa);
});

t("L5 re-derive holds on a sample of tensors (incl largest)", () => {
  const sample = [f.tensors[0], f.tensors[f.tensors.length - 1],
    f.tensors.reduce((a, b) => (b.nbytes > a.nbytes ? b : a))]; // biggest = token_embedding
  for (const ts of sample) { const got = loadByKappa(store, ts.kappa); assert.strictEqual(got.byteLength, ts.nbytes); }
});

t("L5 REFUSES a tampered block", () => {
  const victim = f.tensors[10], hex = victim.kappa.split(":").pop();
  const tampered = mapStore(new Map(f.blocks));
  const b = f.blocks.get(hex).slice(); b[0] ^= 0xff; tampered.get = (h) => (h === hex ? b : f.blocks.get(h));
  assert.throws(() => loadByKappa(tampered, victim.kappa), /L5 REFUSE/);
});

t("forged tensor bytes account for ~all of the 488 MB file", () => {
  const totalTensor = f.tensors.reduce((a, x) => a + x.nbytes, 0);
  assert.ok(totalTensor > bytes.byteLength * 0.98, `tensors ${totalTensor} vs file ${bytes.byteLength}`);
  console.log(`      ${f.tensors.length} tensors, ${(totalTensor / 1e6).toFixed(0)} MB forged, root ${f.rootKappa.slice(0, 28)}…`);
});

t("S2 conv stem runs on REAL weights: [80,3000] mel → [1500,768] encoder input, finite, deterministic", () => {
  // deterministic synthetic log-mel in a plausible range (~[-1, 0.4])
  const nF = 2 * f.plan.hparams.n_audio_ctx, mel = new Float32Array(80 * nF);
  let s = 12345; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < mel.length; i++) mel[i] = rnd() * 1.4 - 1.0;
  const { x, n_ctx, n_state } = whisperConvStem(f.plan, store, mel);
  assert.strictEqual(n_ctx, 1500); assert.strictEqual(n_state, 768);
  assert.strictEqual(x.length, 1500 * 768);
  assert.ok(x.every(Number.isFinite), "conv stem produced NaN/Inf");
  const x2 = whisperConvStem(f.plan, store, mel).x;
  for (let i = 0; i < x.length; i += 4096) assert.strictEqual(x[i], x2[i]); // deterministic
  let mn = Infinity, mx = -Infinity; for (const v of x) { if (v < mn) mn = v; if (v > mx) mx = v; }
  console.log(`      encoder input [1500,768] range [${mn.toFixed(3)}, ${mx.toFixed(3)}], finite ✓`);
});

// ── S3: encoder vs an independent f64 reference (real weights, small n_ctx) ──
const { n_audio_state: S, n_audio_head: H } = f.plan.hparams, HD = S / H, SCALE = 1 / Math.sqrt(HD), FF = 4 * S, LN_EPS = 1e-5;
const D = (name) => { const t = f.plan.tensors.find((x) => x.name === name); return dequantizeExact(t.type, loadByKappa(store, t.kappa), t.dims.reduce((a, b) => a * b, 1)); };
function linR(X, n, W, inD, outD, bias) { const Y = new Float64Array(n * outD); for (let p = 0; p < n; p++) for (let o = 0; o < outD; o++) { let s = bias ? bias[o] : 0; for (let i = 0; i < inD; i++) s += X[p * inD + i] * W[o * inD + i]; Y[p * outD + o] = s; } return Y; }
function lnR(X, n, w, b) { const Y = new Float64Array(n * S); for (let p = 0; p < n; p++) { let m = 0; for (let i = 0; i < S; i++) m += X[p * S + i]; m /= S; let v = 0; for (let i = 0; i < S; i++) v += (X[p * S + i] - m) ** 2; const sc = 1 / Math.sqrt(v / S + LN_EPS); for (let i = 0; i < S; i++) Y[p * S + i] = (X[p * S + i] - m) * sc * w[i] + b[i]; } return Y; }
const geluR = (x) => 0.5 * x * (1 + Math.tanh(0.7978845608028654 * (x + 0.044715 * x ** 3)));
function mhaR(q, k, v, n) { const out = new Float64Array(n * S); for (let h = 0; h < H; h++) { const ho = h * HD; for (let i = 0; i < n; i++) { const sc = []; for (let j = 0; j < n; j++) { let s = 0; for (let d = 0; d < HD; d++) s += q[i * S + ho + d] * k[j * S + ho + d]; sc.push(s * SCALE); } const mx = Math.max(...sc); let z = 0; const e = sc.map((s) => { const x = Math.exp(s - mx); z += x; return x; }); for (let d = 0; d < HD; d++) { let a = 0; for (let j = 0; j < n; j++) a += (e[j] / z) * v[j * S + ho + d]; out[i * S + ho + d] = a; } } } return out; }
function encoderRef(x0, n) {
  let x = Array.from(x0);
  for (let il = 0; il < f.plan.hparams.n_audio_layer; il++) {
    const p = `encoder.blocks.${il}.`;
    const an = lnR(x, n, D(p + "attn_ln.weight"), D(p + "attn_ln.bias"));
    const q = linR(an, n, D(p + "attn.query.weight"), S, S, D(p + "attn.query.bias"));
    const k = linR(an, n, D(p + "attn.key.weight"), S, S, null);
    const v = linR(an, n, D(p + "attn.value.weight"), S, S, D(p + "attn.value.bias"));
    const ao = linR(mhaR(q, k, v, n), n, D(p + "attn.out.weight"), S, S, D(p + "attn.out.bias"));
    for (let i = 0; i < x.length; i++) x[i] += ao[i];
    const mn = lnR(x, n, D(p + "mlp_ln.weight"), D(p + "mlp_ln.bias"));
    const h1 = linR(mn, n, D(p + "mlp.0.weight"), S, FF, D(p + "mlp.0.bias"));
    for (let i = 0; i < h1.length; i++) h1[i] = geluR(h1[i]);
    const h2 = linR(h1, n, D(p + "mlp.2.weight"), FF, S, D(p + "mlp.2.bias"));
    for (let i = 0; i < x.length; i++) x[i] += h2[i];
  }
  return lnR(x, n, D("encoder.ln_post.weight"), D("encoder.ln_post.bias"));
}

t("S3 encoder matches independent f64 reference (12 layers, real weights)", () => {
  const n = 4, x0 = new Float32Array(n * S);
  let s = 99; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  for (let i = 0; i < x0.length; i++) x0[i] = rnd() * 0.5;
  const got = whisperEncoder(f.plan, store, x0, n), ref = encoderRef(x0, n);
  let worst = 0; for (let i = 0; i < got.length; i++) worst = Math.max(worst, Math.abs(got[i] - ref[i]) / (Math.abs(ref[i]) + 1e-3));
  assert.ok(worst < 5e-3, `encoder rel err ${worst}`);
  console.log(`      12-layer encoder vs f64 ref: worst relErr ${worst.toExponential(2)}`);
});

t("S3 encoder runs on REAL conv-stem output (finite, deterministic)", () => {
  const nF = 2 * f.plan.hparams.n_audio_ctx, mel = new Float32Array(80 * nF);
  let s = 7; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < mel.length; i++) mel[i] = rnd() * 1.4 - 1.0;
  const stem = whisperConvStem(f.plan, store, mel);
  const N = 96, sub = stem.x.subarray(0, N * S);                // a slice of the real stem output
  const enc = whisperEncoder(f.plan, store, sub, N);
  assert.strictEqual(enc.length, N * S);
  assert.ok(enc.every(Number.isFinite), "encoder produced NaN/Inf");
  const enc2 = whisperEncoder(f.plan, store, sub, N);
  for (let i = 0; i < enc.length; i += 4096) assert.strictEqual(enc[i], enc2[i]);
  console.log(`      encoder output [${N},${S}] on real conv-stem slice, finite ✓`);
});

// ── S4: decoder (self-attn + cross-attn + mlp) vs independent f64 reference ──
function attendR(q, k, v, nQ, nK, w, causal) { const out = new Float64Array(nQ * S); for (let h = 0; h < H; h++) { const ho = h * HD; for (let i = 0; i < nQ; i++) { const lim = causal ? i + 1 : nK, sc = []; for (let j = 0; j < lim; j++) { let s = 0; for (let d = 0; d < HD; d++) s += q[i * S + ho + d] * k[j * S + ho + d]; sc.push(s * SCALE); } const mx = Math.max(...sc); let z = 0; const e = sc.map((s) => { const x = Math.exp(s - mx); z += x; return x; }); for (let d = 0; d < HD; d++) { let a = 0; for (let j = 0; j < lim; j++) a += (e[j] / z) * v[j * S + ho + d]; out[i * S + ho + d] = a; } } } return out; }
function decoderRef(tokenIds, enc, nEnc) {
  const NL = f.plan.hparams.n_text_layer, NV = f.plan.hparams.n_vocab, N = tokenIds.length;
  const tokEmb = D("decoder.token_embedding.weight"), posEmb = D("decoder.positional_embedding");
  let x = new Float64Array(N * S);
  for (let p = 0; p < N; p++) for (let d = 0; d < S; d++) x[p * S + d] = tokEmb[tokenIds[p] * S + d] + posEmb[p * S + d];
  for (let il = 0; il < NL; il++) {
    const p = `decoder.blocks.${il}.`;
    const cK = linR(enc, nEnc, D(p + "cross_attn.key.weight"), S, S, null), cV = linR(enc, nEnc, D(p + "cross_attn.value.weight"), S, S, D(p + "cross_attn.value.bias"));
    const an = lnR(x, N, D(p + "attn_ln.weight"), D(p + "attn_ln.bias"));
    const q = linR(an, N, D(p + "attn.query.weight"), S, S, D(p + "attn.query.bias")), k = linR(an, N, D(p + "attn.key.weight"), S, S, null), v = linR(an, N, D(p + "attn.value.weight"), S, S, D(p + "attn.value.bias"));
    const so = linR(attendR(q, k, v, N, N, null, true), N, D(p + "attn.out.weight"), S, S, D(p + "attn.out.bias"));
    for (let i = 0; i < x.length; i++) x[i] += so[i];
    const cn = lnR(x, N, D(p + "cross_attn_ln.weight"), D(p + "cross_attn_ln.bias"));
    const cq = linR(cn, N, D(p + "cross_attn.query.weight"), S, S, D(p + "cross_attn.query.bias"));
    const co = linR(attendR(cq, cK, cV, N, nEnc, null, false), N, D(p + "cross_attn.out.weight"), S, S, D(p + "cross_attn.out.bias"));
    for (let i = 0; i < x.length; i++) x[i] += co[i];
    const mn = lnR(x, N, D(p + "mlp_ln.weight"), D(p + "mlp_ln.bias"));
    const h1 = linR(mn, N, D(p + "mlp.0.weight"), S, FF, D(p + "mlp.0.bias"));
    for (let i = 0; i < h1.length; i++) h1[i] = geluR(h1[i]);
    const h2 = linR(h1, N, D(p + "mlp.2.weight"), FF, S, D(p + "mlp.2.bias"));
    for (let i = 0; i < x.length; i++) x[i] += h2[i];
  }
  const fn = lnR(x, N, D("decoder.ln.weight"), D("decoder.ln.bias")), logits = new Float64Array(NV);
  for (let tk = 0; tk < NV; tk++) { let s = 0; for (let d = 0; d < S; d++) s += fn[(N - 1) * S + d] * tokEmb[tk * S + d]; logits[tk] = s; }
  return logits;
}

t("S4 decoder (self+cross attn) matches independent f64 reference, real weights", () => {
  const nEnc = 8, N = 4, enc = new Float32Array(nEnc * S);
  let s = 31; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  for (let i = 0; i < enc.length; i++) enc[i] = rnd() * 0.5;          // synthetic encoder output
  const toks = [1, 234, 5000, 99];                                    // arbitrary valid token ids
  const got = whisperDecoder(f.plan, store, toks, enc, nEnc), ref = decoderRef(toks, enc, nEnc);
  assert.strictEqual(got.length, f.plan.hparams.n_vocab);
  let worst = 0; for (let i = 0; i < got.length; i++) worst = Math.max(worst, Math.abs(got[i] - ref[i]) / (Math.abs(ref[i]) + 1e-2));
  assert.ok(worst < 5e-3, `decoder rel err ${worst}`);
  const am = (a) => { let bi = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[bi]) bi = i; return bi; };
  assert.strictEqual(am(got), am(ref), "argmax mismatch");
  const got2 = whisperDecoder(f.plan, store, toks, enc, nEnc);
  for (let i = 0; i < got.length; i += 4096) assert.strictEqual(got[i], got2[i]);
  console.log(`      12-block decoder vs f64 ref: worst relErr ${worst.toExponential(2)}, argmax=${am(got)} (deterministic)`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
