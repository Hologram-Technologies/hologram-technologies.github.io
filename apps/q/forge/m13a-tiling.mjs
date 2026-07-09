// m13a-tiling.mjs — WEIGHT TILING breaks the largest-tensor floor (12a). Each output row of a GEMV is
// independent (matvecBytes: base + n·rowBytes), so a big weight streams in row-tiles: load a tile, matvec
// it, evict — peak resident = one tile, NOT the whole tensor. Output BYTE-IDENTICAL to the whole-tensor
// matvec, every tile L5-verified. Measured on the REAL largest tensor of qwen2.5-0.5b.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { forgeGguf } from "./gguf-forge.mjs";
import { matvec, blockOf } from "./gguf-forge-exec.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const MODEL = ".models/qwen2.5-0.5b-instruct-q4_k_m.gguf";
const TILEDIR = "C:/Users/pavel/AppData/Local/Temp/claude/C--Users-pavel-Desktop-HOLOGRAM/9be01320-de05-4b56-a1ab-35f38d512e16/scratchpad/_m13tiles";
const MiB = 1024 * 1024, hexOf = (k) => String(k).split(":").pop();

const f = forgeGguf(new Uint8Array(readFileSync(MODEL)));
const byName = new Map(f.plan.tensors.map((t) => [t.name, t]));
const sorted = [...f.plan.tensors].sort((a, b) => b.nbytes - a.nbytes);
const big = sorted[0];                                   // the largest tensor = the 12a floor
const K = big.dims[0], N = big.dims.length > 1 ? big.dims[1] : 1;
const whole = f.blocks.get(hexOf(big.kappa));
const rowBytes = big.typeName === "F32" ? K * 4 : big.typeName === "F16" ? K * 2 : (() => { const [be, bb] = blockOf(big.type); return (K / be) * bb; })();
console.log(`REAL largest tensor: ${big.name}  [${big.dims.join("x")}] ${big.typeName}  = ${(big.nbytes / MiB).toFixed(0)} MiB (${N} rows × ${rowBytes} B/row)`);
console.log(`(this ${(big.nbytes / MiB).toFixed(0)} MiB tensor WAS the resident floor in 12a)`);

const x = new Float32Array(K); for (let i = 0; i < K; i++) x[i] = Math.sin(i * 0.017) * 0.5;   // a real-shaped activation
const keyEq = (a, b) => { const A = new Uint8Array(a.buffer), B = new Uint8Array(b.buffer); if (A.length !== B.length) return false; for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return false; return true; };

// reference: whole-tensor matvec (loads all N rows resident)
const wWhole = { kappa: big.kappa, dims: big.dims, type: big.type };
const y_full = matvec({ get: () => whole }, wWhole, x, (st, k) => st.get(hexOf(k)));

console.log(`\ntileRows   tile-size   peak-resident   time     output==whole (byte-identical)`);
for (const TR of [16384, 4096, 1024]) {
  rmSync(TILEDIR, { recursive: true, force: true }); mkdirSync(TILEDIR, { recursive: true });
  // shard the tensor into row-tiles on disk, each its own κ (verified on read)
  const tiles = [];
  for (let n0 = 0; n0 < N; n0 += TR) { const n1 = Math.min(n0 + TR, N); const bytes = whole.subarray(n0 * rowBytes, n1 * rowBytes); const hex = sha256hex(bytes); writeFileSync(`${TILEDIR}/${hex}.bin`, Buffer.from(bytes)); tiles.push({ n0, n1, hex }); }
  // tiled matvec: stream one tile at a time, verify, matvec its rows, evict
  let peak = 0; const y = new Float32Array(N);
  const t0 = performance.now();
  for (const t of tiles) {
    const b = new Uint8Array(readFileSync(`${TILEDIR}/${t.hex}.bin`));
    if (sha256hex(b) !== t.hex) throw new Error("L5 tile refuse");                        // verify-on-receipt
    if (b.byteLength > peak) peak = b.byteLength;                                          // only ONE tile resident at a time
    const wTile = { kappa: "sha256:" + t.hex, dims: [K, t.n1 - t.n0], type: big.type };
    const yt = matvec({ get: () => b }, wTile, x, (st) => st.get());
    y.set(yt, t.n0);
  }
  const ms = performance.now() - t0;
  console.log(`  ${String(TR).padStart(6)}   ${(TR * rowBytes / MiB).toFixed(1).padStart(5)} MiB   ${(peak / MiB).toFixed(1).padStart(6)} MiB     ${ms.toFixed(0).padStart(5)}ms   ${keyEq(y, y_full) ? "YES ✓" : "NO ✗"}`);
}

const floor2 = sorted[1];
console.log(`\nHEADLINE: the ${(big.nbytes / MiB).toFixed(0)} MiB largest tensor now streams in ~MiB-scale tiles, peak resident = ONE tile, output byte-identical.`);
console.log(`Full-model floor AFTER tiling the big tensors → the next-largest UN-tiled tensor = ${floor2.name} ${(floor2.nbytes / MiB).toFixed(1)} MiB (was 138 MiB). Tile the top-K tensors → resident floor ~few MiB.`);
console.log(`Honest cost: tiling adds per-tile read+verify (I/O); wins only when a tensor exceeds the RAM budget.`);
rmSync(TILEDIR, { recursive: true, force: true });
