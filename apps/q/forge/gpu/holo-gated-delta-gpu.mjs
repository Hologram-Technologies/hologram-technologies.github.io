// holo-gated-delta-gpu.mjs — the ONE new WGSL kernel qwen35 needs: the gated-DeltaNet single-token recurrent
// step. Everything else (quantized matvec, residual, RMSNorm, partial RoPE, KV-cached GQA attention, SwiGLU)
// already exists in holo-gguf-gpu.mjs. This mirrors the PROVEN CPU `gatedDeltaStep` (gguf-forge-gated-delta.mjs)
// op-for-op; it is parity-verified vs that oracle by gated-delta-gpu-parity.html (open in a WebGPU browser).
//
// NOTE: this file defines the kernel + a thin dispatcher. WebGPU runs only in a browser — there is no Node
// WebGPU here, so this is verified in the harness, never by eye. The l2norm(q,k)+q·1/√d preprocessing and the
// gated RMSNorm are applied OUTSIDE this kernel (reuse the existing rmsnorm/elementwise kernels), exactly as the
// CPU layer prepares q,k before calling gatedDeltaStep.
//
// State layout: S[h*headK*headV + ki*headV + vj]. One workgroup per v-head; headV threads (thread vj owns
// column vj of that head's state). Single token: S·exp(g) → kv=kᵀS → δ=β(v−kv) → S+=k⊗δ → o=qᵀS.

export const GATED_DELTA_STEP_WGSL = /* wgsl */`
struct P { nHeads:u32, headK:u32, headV:u32, _pad:u32 };
@group(0) @binding(0) var<storage,read_write> S:array<f32>;   // [nHeads*headK*headV] in/out
@group(0) @binding(1) var<storage,read>        q:array<f32>;   // [nHeads*headK] (already l2norm'd + scaled)
@group(0) @binding(2) var<storage,read>        k:array<f32>;   // [nHeads*headK] (already l2norm'd)
@group(0) @binding(3) var<storage,read>        v:array<f32>;   // [nHeads*headV]
@group(0) @binding(4) var<storage,read>        decay:array<f32>; // [nHeads] = exp(g)
@group(0) @binding(5) var<storage,read>        beta:array<f32>;  // [nHeads]
@group(0) @binding(6) var<storage,read_write>  o:array<f32>;   // [nHeads*headV] out
@group(0) @binding(7) var<uniform>             p:P;

@compute @workgroup_size(128)
fn main(@builtin(workgroup_id) wid:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>) {
  let h = wid.x; let vj = lid.x;
  if (h >= p.nHeads || vj >= p.headV) { return; }
  let headK = p.headK; let headV = p.headV;
  let sBase = h*headK*headV; let kBase = h*headK; let vBase = h*headV;
  let dec = decay[h]; let b = beta[h];
  // pass 1: decay column vj and accumulate kv_mem[vj] = Σ_ki (S·dec)[ki][vj]·k[ki]
  var kv = 0.0;
  for (var ki=0u; ki<headK; ki++) {
    let idx = sBase + ki*headV + vj;
    let s = S[idx]*dec; S[idx] = s; kv = kv + s*k[kBase+ki];
  }
  let delta = (v[vBase+vj] - kv) * b;
  // pass 2: S[ki][vj] += k[ki]·delta ; o[vj] = Σ_ki q[ki]·S[ki][vj]
  var acc = 0.0;
  for (var ki=0u; ki<headK; ki++) {
    let idx = sBase + ki*headV + vj;
    let s = S[idx] + k[kBase+ki]*delta; S[idx] = s; acc = acc + q[kBase+ki]*s;
  }
  o[vBase+vj] = acc;
}`;

// Dispatch one gated-delta step. device: GPUDevice. Buffers are created/owned by the caller's engine in
// production; here a self-contained helper for the parity harness. Returns Float32Array o.
let _gdCache;
export async function gatedDeltaStepGPU(device, { S, q, k, v, decay, beta, nHeads, headK, headV }) {
  const mk = (data, usage) => { const b = device.createBuffer({ size: Math.max(16, data.byteLength), usage, mappedAtCreation: true }); new Float32Array(b.getMappedRange()).set(data); b.unmap(); return b; };
  const ST = 0x80 | 0x8 /* STORAGE|COPY_SRC */, RD = 0x80 | 0x4 /* STORAGE|COPY_DST */;
  const sBuf = mk(S, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
  const qBuf = mk(q, GPUBufferUsage.STORAGE), kBuf = mk(k, GPUBufferUsage.STORAGE), vBuf = mk(v, GPUBufferUsage.STORAGE);
  const dBuf = mk(decay, GPUBufferUsage.STORAGE), bBuf = mk(beta, GPUBufferUsage.STORAGE);
  const oBuf = device.createBuffer({ size: nHeads * headV * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const uni = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uni, 0, new Uint32Array([nHeads, headK, headV, 0]));
  _gdCache = _gdCache || new WeakMap(); let pipe = _gdCache.get(device);
  if (!pipe) { pipe = device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code: GATED_DELTA_STEP_WGSL }), entryPoint: "main" } }); _gdCache.set(device, pipe); }
  const bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [sBuf, qBuf, kBuf, vBuf, dBuf, bBuf, oBuf, uni].map((b, i) => ({ binding: i, resource: { buffer: b } })) });
  const enc = device.createCommandEncoder(); const pass = enc.beginComputePass();
  pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(nHeads); pass.end();
  const read = device.createBuffer({ size: nHeads * headV * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  enc.copyBufferToBuffer(oBuf, 0, read, 0, nHeads * headV * 4);
  const sRead = device.createBuffer({ size: S.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  enc.copyBufferToBuffer(sBuf, 0, sRead, 0, S.byteLength);
  device.queue.submit([enc.finish()]);
  await read.mapAsync(GPUMapMode.READ); const o = new Float32Array(read.getMappedRange().slice(0));
  await sRead.mapAsync(GPUMapMode.READ); const sOut = new Float32Array(sRead.getMappedRange().slice(0));
  return { o, S: sOut };
}

export default { GATED_DELTA_STEP_WGSL, gatedDeltaStepGPU };
