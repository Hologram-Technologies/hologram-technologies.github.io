// BitNet TQ2_0 fidelity witness — both directions, BIT-FOR-BIT vs ggml (the real
// dequantize_row_tq2_0 / quantize_row_tq2_0_ref in the llama.cpp fork).
//   • dequant: JS oracle (gguf-forge-dequant) vs iq-ref.exe to_float
//   • quant:   JS quantizer (gguf-forge-quantize) vs quant-ref.exe ggml_quantize_chunk
//   • round-trip: dequant(quant(x)) is ternary·d, idempotent under re-quant
// TQ2_0 = ggml type 35, block 66 B / 256 elems (qs[64] + f16 d). No tolerance —
// quant/dequant are deterministic. Both .exe via execFileSync + MinGW PATH (DLLs).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import assert from "node:assert";
import { GGML, dequantizeExact, typeByteLen } from "./gguf-forge-dequant.mjs";
import { quantizeRowTq2_0 } from "./gguf-forge-quantize.mjs";
import { f16ToF32 } from "../qvac-ingest.mjs";

const QV = "C:/Users/pavel/Desktop/qvac-fabric-llm.cpp-master/qvac-fabric-llm.cpp-master";
const IQREF = `${QV}/iq-ref.exe`, QREF = `${QV}/quant-ref.exe`;
const MINGW = "C:/Users/pavel/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin";
const ENV = { env: { ...process.env, PATH: `${MINGW};${process.env.PATH}` }, maxBuffer: 1 << 26 };
const TQ2_0 = 35;

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const f32bits = (f) => { const b = new ArrayBuffer(4); new Float32Array(b)[0] = f; return new Uint32Array(b)[0]; };
const hexf = (arr) => Array.from(arr, (v) => f32bits(v).toString(16).padStart(8, "0")).join(" ");

// ggml dequant: block bytes hex → float32 bits
function refDequant(n, raw) {
  const out = execFileSync(IQREF, [String(TQ2_0), String(n), Buffer.from(raw).toString("hex")], ENV).toString().trim();
  return out.split(/\s+/).map((h) => parseInt(h, 16) >>> 0);
}
// ggml quant: n f32 (hex, stdin) → quant block bytes hex
function refQuant(n, x) {
  const out = execFileSync(QREF, [String(TQ2_0), String(n)], { ...ENV, input: hexf(x) + "\n" }).toString().trim();
  return out.split(/\s+/).map((h) => parseInt(h, 16));
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
assert(existsSync(IQREF), "iq-ref.exe missing"); assert(existsSync(QREF), "quant-ref.exe missing");

// ── 1. DEQUANT bit-exact (random qs, d pinned 1.0 at offset 64) ──
{
  const nb = 4, n = 256 * nb, raw = new Uint8Array(66 * nb), rnd = mulberry32(0xb17);
  for (let b = 0; b < nb; b++) {
    for (let i = 0; i < 64; i++) raw[b * 66 + i] = (rnd() * 256) | 0;
    raw[b * 66 + 64] = 0x00; raw[b * 66 + 65] = 0x3c; // d = 1.0
  }
  assert.equal(typeByteLen(TQ2_0, n), 66 * nb, "typeByteLen");
  const ref = refDequant(n, raw), js = dequantizeExact(TQ2_0, raw, n);
  let mism = -1; for (let i = 0; i < n; i++) if (f32bits(js[i]) !== ref[i]) { mism = i; break; }
  ok(mism < 0, `dequant bit-exact vs ggml to_float (${n} elems)${mism < 0 ? "" : ` first@${mism} js=${js[mism]} ref=${ref[mism]}`}`);
}

// ── 2. QUANT bit-exact (random f32, varied amax → varied f16 d) ──
{
  const nb = 4, n = 256 * nb, x = new Float32Array(n), rnd = mulberry32(0x7c2);
  for (let i = 0; i < n; i++) x[i] = (rnd() * 2 - 1) * (1 + (i % 7)); // spread of magnitudes
  const ref = refQuant(n, x), js = quantizeRowTq2_0(x, n);
  assert.equal(js.length, 66 * nb, "quant byte length");
  let mism = -1; for (let i = 0; i < js.length; i++) if (js[i] !== ref[i]) { mism = i; break; }
  ok(mism < 0, `quant bit-exact vs ggml quantize_chunk (${js.length} bytes)${mism < 0 ? "" : ` first@${mism} js=${js[mism]} ref=${ref[mism]}`}`);
}

// ── 3. ROUND-TRIP: dequant(quant(x)) is ternary·d, and re-quant is idempotent ──
{
  const n = 256, x = new Float32Array(n), rnd = mulberry32(0x3ee);
  for (let i = 0; i < n; i++) x[i] = (rnd() * 2 - 1) * 3.5;
  const q1 = quantizeRowTq2_0(x, n);
  const y = dequantizeExact(TQ2_0, q1, n);
  // d actually stored = f16(amax); dequant values are exactly {-1,0,1}·d_f16.
  const d = f16ToF32(new DataView(q1.buffer).getUint16(64, true));
  let ternary = true; for (let i = 0; i < n; i++) { const r = y[i] / d; if (Math.abs(Math.round(r) - r) > 1e-6 || Math.abs(r) > 1.0001) ternary = false; }
  ok(ternary, "round-trip: every dequant value ∈ {-d, 0, +d}");
  const q2 = quantizeRowTq2_0(y, n);
  let idem = true; for (let i = 0; i < q1.length; i++) if (q1[i] !== q2[i]) idem = false;
  ok(idem, "round-trip: re-quant(dequant(q)) == q (idempotent)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
