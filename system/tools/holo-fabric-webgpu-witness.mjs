#!/usr/bin/env node
// holo-fabric-webgpu-witness.mjs — PROVE the WebGPU substrate driver and, above all, its PARITY GATE: a
// GPU result is admitted ONLY if it re-derives to the same κ as the CPU reference (Law L5). This is the
// guard that turns "light/GPU does the linear algebra" from a risk into a fact — it is exactly what stops
// a wrong kernel (the known q8-LLM-WebGPU gibberish) from ever reaching a user: a mismatch falls back to
// CPU, never serves the bad bytes. The driver is a normal fabric driver (caps:["transform"]) and is
// FAIL-OPEN: no WebGPU ⇒ CPU reference (any browser works); WebGPU present ⇒ used only after it passes.
//
// The GPU itself needs a browser, so real-GPU parity is verified in-page (preview); HERE we witness the
// math + the GATE deterministically in Node with a mock GPU (correct ⇒ admitted, wrong ⇒ refused→CPU).
//
// Checks: cpu kernels correct (iaffine exact-int, matmul float); gate exact + tolerance; driver fallback
// with no GPU; driver admits a correct GPU; driver REFUSES a wrong GPU and serves CPU (anti-gibberish);
// output content-addressed (L5); deterministic.  Usage: node tools/holo-fabric-webgpu-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cpuKernel, gateParity, bytesOf, makeWebgpuDriver } from "../os/sbin/holo-fabric-webgpu.mjs";
import { kappaOf } from "../os/usr/lib/holo/holo-kappa-stream.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const te = new TextEncoder();
const checks = {};

// build a resolve() over a tiny content map for (op spec, input bytes)
async function callDriver(driver, spec, inputTyped) {
  const opBytes = te.encode(JSON.stringify(spec));
  const inBytes = bytesOf(inputTyped);
  const opK = await kappaOf(opBytes), inK = await kappaOf(inBytes);
  const map = new Map([[opK.split(":").pop(), opBytes], [inK.split(":").pop(), inBytes]]);
  const resolve = async (k) => map.get(k.split(":").pop()) || null;
  return driver.transform(opK, inK, { resolve });
}

// ── 1 · CPU iaffine (exact integer): out = (in*mul + add) mod 2^32 ───────────────────────────────
{
  const spec = { kind: "iaffine", dtype: "u32", mul: 3, add: 7 };
  const out = cpuKernel(spec, new Uint32Array([0, 1, 2, 10]));
  checks.cpuIaffine = out instanceof Uint32Array && out[0] === 7 && out[1] === 10 && out[2] === 13 && out[3] === 37;
}

// ── 2 · CPU matmul (float): [1 2;3 4]·[5 6;7 8] = [19 22;43 50] ───────────────────────────────────
{
  const spec = { kind: "matmul", dtype: "f32", m: 2, k: 2, n: 2, b: [5, 6, 7, 8] };
  const out = cpuKernel(spec, new Float32Array([1, 2, 3, 4]));
  checks.cpuMatmul = out[0] === 19 && out[1] === 22 && out[2] === 43 && out[3] === 50;
}

// ── 3 · gate, exact mode ─────────────────────────────────────────────────────────────────────────
{
  const a = new Uint32Array([1, 2, 3]), b = new Uint32Array([1, 2, 3]), c = new Uint32Array([1, 2, 4]);
  checks.gateExact = gateParity(a, b, "exact") === true && gateParity(a, c, "exact") === false;
}

// ── 4 · gate, tolerance mode (float drift within ULP budget) ─────────────────────────────────────
{
  const a = new Float32Array([1.0, 2.0, 3.0]), near = new Float32Array([1.0000001, 2.0, 3.0]), far = new Float32Array([1.1, 2.0, 3.0]);
  checks.gateTolerance = gateParity(a, near, { tol: 1e-4 }) === true && gateParity(a, far, { tol: 1e-4 }) === false;
}

// ── 5 · no GPU ⇒ CPU reference, content-addressed (any browser works) ─────────────────────────────
{
  const driver = makeWebgpuDriver({ gpuRun: null });
  const spec = { kind: "iaffine", dtype: "u32", mul: 2, add: 1 };
  const r = await callDriver(driver, spec, new Uint32Array([5, 6, 7]));
  const cpu = cpuKernel(spec, new Uint32Array([5, 6, 7]));
  checks.driverFallsBackNoGpu = r.ranOn === "cpu" && r.kappa === (await kappaOf(bytesOf(cpu)));
}

// ── 6 · a CORRECT GPU is admitted (parity passes) ────────────────────────────────────────────────
{
  const gpuRun = async (spec, input) => cpuKernel(spec, input);                    // a faithful GPU
  const driver = makeWebgpuDriver({ gpuRun, parity: "exact" });
  const spec = { kind: "iaffine", dtype: "u32", mul: 4, add: 0 };
  const r = await callDriver(driver, spec, new Uint32Array([1, 2, 3]));
  checks.admitsGoodGpu = r.ranOn === "webgpu" && r.gated === true;
}

// ── 7 · a WRONG GPU is REFUSED → CPU served (anti-gibberish, the load-bearing check) ─────────────
{
  const gpuRun = async (spec, input) => { const w = cpuKernel(spec, input); w[0] = (w[0] + 99) >>> 0; return w; }; // corrupt
  const driver = makeWebgpuDriver({ gpuRun, parity: "exact" });
  const spec = { kind: "iaffine", dtype: "u32", mul: 1, add: 0 };
  const input = new Uint32Array([10, 20, 30]);
  const r = await callDriver(driver, spec, input);
  const cpu = cpuKernel(spec, input);
  checks.refusesBadGpu = r.ranOn === "cpu-fallback" && r.gated === false && r.kappa === (await kappaOf(bytesOf(cpu)));
}

// ── 8 · deterministic: same op+in ⇒ same κ ───────────────────────────────────────────────────────
{
  const driver = makeWebgpuDriver({ gpuRun: null });
  const spec = { kind: "iaffine", dtype: "u32", mul: 9, add: 2 };
  const r1 = await callDriver(driver, spec, new Uint32Array([3, 1, 4]));
  const r2 = await callDriver(driver, spec, new Uint32Array([3, 1, 4]));
  checks.deterministic = r1.kappa === r2.kappa && r1.kappa.startsWith("did:holo:sha256:");
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-fabric-webgpu-witness.result.json"), JSON.stringify({
  spec: "WebGPU substrate driver + PARITY GATE: a GPU result is admitted only if it re-derives to the CPU reference's κ (Law L5) — the guard that stops a wrong kernel (q8-LLM gibberish) reaching a user; mismatch falls back to CPU, never serves bad bytes. Fail-open: no WebGPU ⇒ CPU (any browser). Real-GPU parity verified in-page (preview).",
  authority: "holospaces Laws L1/L2/L5 · SD-native WebGPU exact-parity kernels (external oracle) · WebGPU/WGSL · IEEE-754 ULP tolerance for float",
  witnessed,
  covers: witnessed ? ["webgpu-driver", "parity-gate", "anti-gibberish-fallback", "cpu-reference", "fail-open", "content-addressed", "deterministic"] : [],
  checks,
  note: "Real-GPU exact parity (iaffine) + float tolerance (matmul) verified in a browser with navigator.gpu; this Node witness proves the math + the gate with a mock GPU.",
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ GPU admitted only on κ-parity; a wrong kernel falls back to CPU — never serves gibberish" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
