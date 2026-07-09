// IQ-quant dequant fidelity witness: the float32-exact JS oracle vs ggml's real
// to_float (dequantize_row_iq*, compiled into iq-ref.exe from the llama.cpp fork).
// Per-type, on crafted random blocks, compared BIT-FOR-BIT (raw float32 bits).
//
// iq-ref.exe must be invoked via execFileSync with the MinGW bin on PATH (its
// runtime DLLs); under Git Bash it exits 127. Build:
//   g++ -O2 -std=c++17 -I ggml/include iq-ref.cpp build-cpu/ggml/src/{ggml,ggml-cpu,ggml-base}.a -o iq-ref.exe -lpthread
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import assert from "node:assert";
import { GGML, dequantizeExact, typeByteLen } from "./gguf-forge-dequant.mjs";

const QV = "C:/Users/pavel/Desktop/qvac-fabric-llm.cpp-master/qvac-fabric-llm.cpp-master";
const REF = `${QV}/iq-ref.exe`;
const MINGW = "C:/Users/pavel/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin";

// deterministic PRNG
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// d (f16) lives at block byte 0 for every IQ type except IQ1_M (no d). Pin it to
// a finite value (1.0 = 0x3c00) so the witness doesn't trip over random Inf/NaN.
const D_OFFSET = { IQ2_XXS: 0, IQ2_XS: 0, IQ2_S: 0, IQ3_XXS: 0, IQ3_S: 0, IQ1_S: 0, IQ4_NL: 0, IQ4_XS: 0 };

function craft(name, blockBytes, nb, seed) {
  const rnd = mulberry32(seed);
  const raw = new Uint8Array(blockBytes * nb);
  for (let i = 0; i < raw.length; i++) raw[i] = (rnd() * 256) | 0;
  if (name in D_OFFSET) for (let b = 0; b < nb; b++) { raw[b * blockBytes + 0] = 0x00; raw[b * blockBytes + 1] = 0x3c; }
  return raw;
}

function refBits(typeId, n, raw) {
  const hex = Buffer.from(raw).toString("hex");
  const out = execFileSync(REF, [String(typeId), String(n), hex], {
    env: { ...process.env, PATH: `${MINGW};${process.env.PATH}` }, maxBuffer: 1 << 26,
  }).toString().trim();
  return out.split(/\s+/).map((h) => parseInt(h, 16) >>> 0);
}

const f32bits = (f) => { const b = new ArrayBuffer(4); new Float32Array(b)[0] = f; return new Uint32Array(b)[0]; };

const CASES = [
  ["IQ2_XXS", 66, 256], ["IQ2_XS", 74, 256], ["IQ2_S", 82, 256], ["IQ3_XXS", 98, 256],
  ["IQ3_S", 110, 256], ["IQ1_S", 50, 256], ["IQ1_M", 56, 256], ["IQ4_NL", 18, 32], ["IQ4_XS", 136, 256],
];

let pass = 0, fail = 0;
assert(existsSync(REF), "iq-ref.exe missing — build it first");

for (const [name, bytes, blockElems] of CASES) {
  const nb = 3, n = blockElems * nb, t = GGML[name];
  assert.equal(typeByteLen(t, n), bytes * nb, `${name} typeByteLen`);
  const raw = craft(name, bytes, nb, 0x1234 + t);
  const ref = refBits(t, n, raw);
  const js = dequantizeExact(t, raw, n);
  assert.equal(js.length, n, `${name} length`);
  assert.equal(ref.length, n, `${name} ref length`);
  let mism = 0, finite = 0, firstBad = -1;
  for (let i = 0; i < n; i++) {
    // skip non-finite ref outputs (random scales can still produce Inf/NaN)
    const rf = new Float32Array(new Uint32Array([ref[i]]).buffer)[0];
    if (!Number.isFinite(rf)) continue;
    finite++;
    if (f32bits(js[i]) !== ref[i]) { mism++; if (firstBad < 0) firstBad = i; }
  }
  if (mism === 0) { console.log(`  ok  ${name.padEnd(8)} bit-exact vs ggml to_float  (${finite}/${n} finite)`); pass++; }
  else {
    const i = firstBad;
    console.log(`  XX  ${name.padEnd(8)} ${mism}/${finite} mismatch; first@${i} js=${js[i]} ref=${new Float32Array(new Uint32Array([ref[i]]).buffer)[0]}`);
    fail++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
