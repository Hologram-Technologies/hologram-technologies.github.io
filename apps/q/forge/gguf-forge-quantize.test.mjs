// κ-native quantizer fidelity witness: the JS quantizer vs ggml's REAL ggml_quantize_chunk
// (quantize_row_q*_ref), BIT-FOR-BIT on random f32 rows. Quantization is deterministic
// (no transcendental seam) so the contract is exact byte equality, not a tolerance. Plus
// a round-trip sanity: re-dequantizing the JS blocks (oracle) reproduces ggml's dequant.
//
// quant-ref.exe runs via execFileSync with the MinGW bin on PATH (its runtime DLLs).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import assert from "node:assert";
import { quantizeRowQ8_0, quantizeRowQ4_0, quantizeRowQ5_0, quantizeRowQ4K, quantizeRowQ6K, forgeQuantize } from "./gguf-forge-quantize.mjs";
import "node:assert"; // (quantizeRowQ4K/Q6K take an optional imatrix arg)
import { dequantizeExact, GGML } from "./gguf-forge-dequant.mjs";

const QV = "C:/Users/pavel/Desktop/qvac-fabric-llm.cpp-master/qvac-fabric-llm.cpp-master";
const REF = `${QV}/quant-ref.exe`;
const MINGW = "C:/Users/pavel/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin";

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hx = (f) => { const b = new ArrayBuffer(4); new Float32Array(b)[0] = f; return new Uint32Array(b)[0].toString(16).padStart(8, "0"); };

function ggmlQuant(typeId, x, imatrix = null) {
  const args = [String(typeId), String(x.length)].concat(imatrix ? ["1"] : []);
  const input = [...x, ...(imatrix || [])].map(hx).join(" ");
  const out = execFileSync(REF, args, { input, env: { ...process.env, PATH: `${MINGW};${process.env.PATH}` }, maxBuffer: 1 << 24 }).toString().trim();
  return Uint8Array.from(out.split(/\s+/).map((h) => parseInt(h, 16)));
}

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };
assert(existsSync(REF), "quant-ref.exe missing — build it first");

const CASES = [
  ["Q8_0", GGML.Q8_0, quantizeRowQ8_0, 34, 32],
  ["Q4_0", GGML.Q4_0, quantizeRowQ4_0, 18, 32],
  ["Q5_0", GGML.Q5_0, quantizeRowQ5_0, 22, 32],
  ["Q4_K", GGML.Q4_K, quantizeRowQ4K, 144, 256],
  ["Q6_K", GGML.Q6_K, quantizeRowQ6K, 210, 256],
];

for (const [name, typeId, qfn, blockBytes, be] of CASES) {
  t(`${name} quantizer BIT-EXACT vs ggml_quantize_chunk (random rows + edge values)`, () => {
    let mism = 0;
    for (let trial = 0; trial < 6; trial++) {
      const rnd = mulberry32(0x100 + typeId * 7 + trial), nb = 2, n = be * nb, x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = (rnd() * 2 - 1) * (1 + trial); // varying scale per trial
      if (trial === 5) { x[0] = 0; x[1] = 1e-30; x[2] = -3.14159; x[3] = 7.5; } // edge values
      const js = qfn(x, n), gg = ggmlQuant(typeId, x);
      assert.strictEqual(js.length, blockBytes * nb, `${name} length`);
      assert.strictEqual(gg.length, js.length, `${name} ggml length`);
      for (let i = 0; i < js.length; i++) if (js[i] !== gg[i]) { mism++; if (mism <= 3) console.log(`      byte ${i}: js=${js[i]} ggml=${gg[i]} (trial ${trial})`); }
    }
    assert.strictEqual(mism, 0, `${mism} byte mismatches`);
  });
}

t("round-trip: dequantize(JS-quantized) == dequantize(ggml-quantized)", () => {
  for (const [name, typeId, qfn, , be] of CASES) {
    const rnd = mulberry32(777 + typeId), n = be * 2, x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = (rnd() * 2 - 1) * 0.7;
    const a = dequantizeExact(typeId, qfn(x, n), n), b = dequantizeExact(typeId, ggmlQuant(typeId, x), n);
    for (let i = 0; i < n; i++) assert.strictEqual(a[i], b[i], `${name} dequant[${i}]`);
  }
});

for (const [name, typeId, qfn] of [["Q6_K", GGML.Q6_K, quantizeRowQ6K], ["Q4_K", GGML.Q4_K, quantizeRowQ4K]]) {
  t(`S2 ${name} imatrix-aware quantizer BIT-EXACT vs ggml quantize_${name.toLowerCase()}(quant_weights)`, () => {
    let mism = 0;
    for (let trial = 0; trial < 4; trial++) {
      const rnd = mulberry32(0x900 + typeId * 5 + trial), n = 256 * 2, x = new Float32Array(n), im = new Float32Array(n);
      for (let i = 0; i < n; i++) { x[i] = (rnd() * 2 - 1) * (1 + trial); im[i] = rnd() * rnd() + 1e-4; } // imatrix > 0
      const js = qfn(x, n, im), gg = ggmlQuant(typeId, x, im);
      for (let i = 0; i < js.length; i++) if (js[i] !== gg[i]) { mism++; if (mism <= 3) console.log(`      byte ${i}: js=${js[i]} ggml=${gg[i]} (trial ${trial})`); }
    }
    assert.strictEqual(mism, 0, `${mism} byte mismatches`);
  });
}

t("S3 forgeQuantize: deterministic κ-model, content-dedup, blocks bit-exact vs ggml", () => {
  const rnd = mulberry32(2024);
  const mk = (name, n, type) => ({ name, dims: [n], data: Float32Array.from({ length: n }, () => (rnd() * 2 - 1) * 0.6), type });
  const dup = mk("blk.dup", 256, GGML.Q4_K);                    // two identical tensors → one κ (dedup)
  const tensors = [mk("blk.0.w", 256, GGML.Q4_K), mk("blk.1.w", 64, GGML.Q8_0), { ...dup, name: "blk.2.w" }, dup];
  const a = forgeQuantize(tensors), b = forgeQuantize(tensors);
  assert.strictEqual(a.rootKappa, b.rootKappa, "not deterministic");          // identical f32 in ⇒ identical root κ
  assert.match(a.rootKappa, /^did:holo:sha256:[0-9a-f]{64}$/);
  assert.strictEqual(a.blocks.size, 3, "dup tensors should dedup to 3 κ-objects"); // 4 tensors, 2 identical
  for (const pt of a.tensors) {                                                // every κ-block byte-identical to ggml
    const src = tensors.find((t) => t.name === pt.name);
    const blob = a.blocks.get(pt.kappa.split(":").pop()), gg = ggmlQuant(pt.type, src.data);
    assert.strictEqual(blob.length, gg.length); for (let i = 0; i < gg.length; i++) assert.strictEqual(blob[i], gg[i], `${pt.name} byte ${i}`);
  }
  console.log(`      4 tensors → ${a.blocks.size} κ-objects (deduped), root ${a.rootKappa.slice(0, 28)}…, all bit-exact vs ggml`);
});

t("S3 forgeQuantize with per-row imatrix: imatrix = its own κ-object, rows bit-exact vs ggml", () => {
  const rnd = mulberry32(4242), nper = 256, nrows = 3, n = nper * nrows;
  const data = Float32Array.from({ length: n }, () => (rnd() * 2 - 1) * 0.8);
  const imatrix = Float32Array.from({ length: nper }, () => rnd() * rnd() + 1e-4);
  const a = forgeQuantize([{ name: "blk.0.w", dims: [nper, nrows], data, type: GGML.Q4_K, imatrix }]);
  const b = forgeQuantize([{ name: "blk.0.w", dims: [nper, nrows], data, type: GGML.Q4_K, imatrix }]);
  assert.strictEqual(a.rootKappa, b.rootKappa, "not deterministic with imatrix");
  const pt = a.tensors[0];
  assert.match(pt.imatrix, /^sha256:[0-9a-f]{64}$/, "imatrix κ ref missing");
  assert.ok(a.blocks.has(pt.imatrix.split(":").pop()), "imatrix κ-object not stored");
  // each row's quant bytes == ggml row-quant with the same imatrix (proves per-row tiling)
  const blob = a.blocks.get(pt.kappa.split(":").pop());
  for (let r = 0; r < nrows; r++) {
    const gg = ggmlQuant(GGML.Q4_K, data.subarray(r * nper, r * nper + nper), imatrix);
    for (let i = 0; i < 144; i++) assert.strictEqual(blob[r * 144 + i], gg[i], `row ${r} byte ${i}`);
  }
  console.log(`      [${nper}×${nrows}] q4_K tensor + imatrix-κ ${pt.imatrix.slice(0, 20)}…, all rows bit-exact vs ggml`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
