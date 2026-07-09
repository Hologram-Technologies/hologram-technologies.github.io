// TurboQuant / PolarQuant fidelity witness — both directions, BIT-FOR-BIT vs ggml's
// real to_float / quantize_chunk (types 42-49) in the llama.cpp fork.
//   • dequant: tqDequant vs iq-ref.exe to_float       (all 8 types)
//   • quant:   tqQuant   vs quant-ref.exe quantize     (all 8: PQ Stage-1 + TBQ Stage-1+QJL)
// PQ = PolarQuant (Stage 1: rotation-graph-level + Lloyd-Max codebook + bit-pack).
// TBQ = TurboQuant (+ QJL 1-bit residual sketch). Per-block kernels exclude the
// Hadamard rotation (graph-level), exactly like ggml's type_traits to_float.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import assert from "node:assert";
import { tqDequant, tqQuant, TQ_TYPES } from "./gguf-forge-turboquant.mjs";

const QV = "C:/Users/pavel/Desktop/qvac-fabric-llm.cpp-master/qvac-fabric-llm.cpp-master";
const IQREF = `${QV}/iq-ref.exe`, QREF = `${QV}/quant-ref.exe`;
const MINGW = "C:/Users/pavel/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin";
const ENV = { env: { ...process.env, PATH: `${MINGW};${process.env.PATH}` }, maxBuffer: 1 << 26 };

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const f32bits = (f) => { const b = new ArrayBuffer(4); new Float32Array(b)[0] = f; return new Uint32Array(b)[0]; };
const hexf = (arr) => Array.from(arr, (v) => f32bits(v).toString(16).padStart(8, "0")).join(" ");

function refDequant(typeId, n, raw) {
  const out = execFileSync(IQREF, [String(typeId), String(n), Buffer.from(raw).toString("hex")], ENV).toString().trim();
  return out.split(/\s+/).map((h) => parseInt(h, 16) >>> 0);
}
function refQuant(typeId, n, x) {
  const out = execFileSync(QREF, [String(typeId), String(n)], { ...ENV, input: hexf(x) + "\n" }).toString().trim();
  return out.split(/\s+/).map((h) => parseInt(h, 16));
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
assert(existsSync(IQREF), "iq-ref.exe missing"); assert(existsSync(QREF), "quant-ref.exe missing");

// Per type: forge a block from random data with OUR quantizer, dequant both via ggml
// and ours from the SAME bytes, and separately compare OUR quant bytes to ggml's.
for (const [id, t] of Object.entries(TQ_TYPES)) {
  const typeId = Number(id), nb = 3, n = t.d * nb;
  // varied-magnitude random KV-like vector
  const rnd = mulberry32(0x5151 + typeId), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (rnd() * 2 - 1) * (0.5 + (i % 5) * 0.4);

  // QUANT: our bytes vs ggml bytes (Stage-1 for PQ; Stage-1 + QJL for TBQ)
  const jsq = tqQuant(typeId, x, n), refq = refQuant(typeId, n, x);
  assert.equal(jsq.length, t.total * nb, `${t.name} quant length`);
  let qbad = -1; for (let i = 0; i < jsq.length; i++) if (jsq[i] !== refq[i]) { qbad = i; break; }
  ok(qbad < 0, `${t.name.padEnd(9)} quant BIT-EXACT vs ggml (${jsq.length} B)${qbad < 0 ? "" : ` first@${qbad} js=${jsq[qbad]} ref=${refq[qbad]}`}`);

  // DEQUANT: feed ggml's own block bytes to our dequant → must equal ggml to_float
  const ref = refDequant(typeId, n, Uint8Array.from(refq)), js = tqDequant(typeId, Uint8Array.from(refq), n);
  let dbad = -1, fin = 0; for (let i = 0; i < n; i++) { const rf = new Float32Array(new Uint32Array([ref[i]]).buffer)[0]; if (!Number.isFinite(rf)) continue; fin++; if (f32bits(js[i]) !== ref[i]) { dbad = i; break; } }
  ok(dbad < 0, `${t.name.padEnd(9)} dequant BIT-EXACT vs ggml to_float (${fin}/${n})${dbad < 0 ? "" : ` first@${dbad}`}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
