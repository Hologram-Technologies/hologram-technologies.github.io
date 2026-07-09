// holo-fabric-webgpu.mjs — the WebGPU SUBSTRATE DRIVER for the fabric: it runs a κ-addressed linear kernel
// (the novelty the compute-memo didn't already have) on the GPU, and admits the result ONLY if it passes
// the PARITY GATE — re-derives to the same κ as the CPU reference (exact for integer kernels, ULP-tolerance
// for float) (Law L5). That gate is the whole safety story: it is precisely what stops a wrong kernel (the
// known q8-LLM-WebGPU gibberish) from reaching a user — a mismatch FALLS BACK to the CPU result and never
// serves the bad bytes. The driver is FAIL-OPEN: no navigator.gpu ⇒ the CPU reference (so any browser
// works); WebGPU is an accelerator, never a requirement. It plugs into holo-fabric as a tier-"silicon"
// transform driver. CPU kernels + the gate are pure (node-witnessable); makeWebgpuRun needs a real device.

import { reDerive } from "./holo-resolver.mjs";
const kappaOf = async (bytes) => "did:holo:sha256:" + (await reDerive(bytes));

// ── typed-array ⇄ bytes (one canonical layout, little-endian as the platform serves it) ───────────
export function typedFrom(bytes, dtype) {
  const u = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);   // copy ⇒ aligned, exact-length buffer
  return dtype === "f32" ? new Float32Array(u.buffer) : new Uint32Array(u.buffer);
}
export const bytesOf = (typed) => new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);

// ── CPU reference kernels (the parity oracle) ────────────────────────────────────────────────────
// iaffine: out[i] = (in[i] * mul + add) mod 2^32 — integer, so CPU and GPU agree BIT-EXACT (exact gate).
// matmul:  C[m×n] = A[m×k] · B[k×n], f32 — GPU accumulation order differs, so this gate is ULP-tolerance.
export function cpuKernel(spec, input) {
  if (spec.kind === "iaffine") {
    const out = new Uint32Array(input.length);
    const mul = spec.mul >>> 0, add = spec.add >>> 0;
    for (let i = 0; i < input.length; i++) out[i] = (Math.imul(input[i], mul) + add) >>> 0;
    return out;
  }
  if (spec.kind === "matmul") {
    const { m, k, n } = spec, A = input, B = Float32Array.from(spec.b), C = new Float32Array(m * n);
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
      let s = 0; for (let p = 0; p < k; p++) s = Math.fround(s + Math.fround(A[i * k + p] * B[p * n + j]));
      C[i * n + j] = s;
    }
    return C;
  }
  throw new Error("holo-fabric-webgpu: unknown kernel " + (spec && spec.kind));
}

// ── the PARITY GATE ──────────────────────────────────────────────────────────────────────────────
// mode "exact" → bit-identical (integer kernels); { tol } → max abs elementwise diff ≤ tol (float kernels).
export function gateParity(a, b, mode = "exact") {
  if (!a || !b || a.length !== b.length) return false;
  if (mode === "exact") { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
  const tol = (mode && mode.tol) || 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > tol) return false;
  return true;
}

// ── the fabric driver ────────────────────────────────────────────────────────────────────────────
// makeWebgpuDriver({ gpuRun, parity }) — gpuRun: async (spec, inputTyped) → outputTyped (the GPU execution;
// injectable so the gate is node-witnessable with a mock). parity: "exact" | { tol }.
export function makeWebgpuDriver({ gpuRun = null, parity = "exact", label = "webgpu" } = {}) {
  return {
    label, tier: "silicon", caps: ["transform"],
    async transform(opKappa, inKappa, { resolve } = {}) {
      const spec = JSON.parse(new TextDecoder().decode(await resolve(opKappa)));
      const input = typedFrom(await resolve(inKappa), spec.dtype);
      const cpu = cpuKernel(spec, input);                       // the reference (the gate's oracle)
      let out = cpu, ranOn = "cpu", gated = null;
      if (gpuRun) {
        try {
          const g = await gpuRun(spec, input);
          gated = gateParity(g, cpu, parity);
          if (gated) { out = g; ranOn = "webgpu"; } else { ranOn = "cpu-fallback"; }   // GPU disagreed ⇒ refuse it, serve CPU
        } catch (e) { ranOn = "cpu-error"; gated = false; }                            // GPU threw ⇒ fail-open to CPU
      }
      const bytes = bytesOf(out);
      return { kappa: await kappaOf(bytes), bytes, ranOn, gated };
    },
  };
}

// ── the real GPU runner (browser only — needs a GPUDevice) ───────────────────────────────────────
// Implements iaffine as a compute shader; u32 arithmetic wraps mod 2^32, matching the CPU reference EXACTLY
// (so the exact gate passes on real hardware). matmul GPU is left to the SD-native parity-proven kernels.
export function makeWebgpuRun(device) {
  return async function gpuRun(spec, input) {
    if (spec.kind !== "iaffine") throw new Error("webgpu kernel not implemented: " + spec.kind);
    const n = input.length, bytes = n * 4;
    const wgsl = `
      @group(0) @binding(0) var<storage, read> inp : array<u32>;
      @group(0) @binding(1) var<storage, read_write> outp : array<u32>;
      struct P { mul : u32, add : u32, n : u32, _pad : u32 };
      @group(0) @binding(2) var<uniform> p : P;
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
        let i = gid.x; if (i >= p.n) { return; }
        outp[i] = inp[i] * p.mul + p.add;
      }`;
    const module = device.createShaderModule({ code: wgsl });
    const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
    const inBuf = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const outBuf = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const uni = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const read = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    device.queue.writeBuffer(inBuf, 0, bytesOf(input));
    device.queue.writeBuffer(uni, 0, new Uint32Array([spec.mul >>> 0, spec.add >>> 0, n, 0]));
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: inBuf } }, { binding: 1, resource: { buffer: outBuf } }, { binding: 2, resource: { buffer: uni } } ] });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(n / 64)); pass.end();
    enc.copyBufferToBuffer(outBuf, 0, read, 0, bytes);
    device.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const out = new Uint32Array(read.getMappedRange().slice(0));
    read.unmap();
    return out;
  };
}

export default { cpuKernel, gateParity, typedFrom, bytesOf, makeWebgpuDriver, makeWebgpuRun };
