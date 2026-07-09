// holo-gguf-gpu-backward.mjs — A5: the GPU BACKWARD kernels (the dual of the forward matvec/saxpy in
// holo-gguf-gpu.mjs). On-device training needs gradients; the inference path never did. These three WGSL
// compute shaders are the whole backward of a LoRA-adapted linear, plus the AdamW optimizer step:
//
//   LoRA fwd:  h = A·x ;  y = W0·x + scale·B·h           (W0 frozen — only A,B train)
//   backward (analytic, from gguf-forge-lora-train.mjs loraBackward):
//     dB[o,k] = scale·dy[o]·h[k]          ← OUTER  (rows=out, cols=r, scale)
//     dh[k]   = scale·Σ_o B[o,k]·dy[o]    ← MATVECT (transpose of B times dy)
//     dA[k,i] = dh[k]·x[i]                ← OUTER  (rows=r, cols=in, scale=1)
//   step: AdamW in-place on (A,B) given (dA,dB)          ← ADAMW
//
// Same runtime conventions as the forward (workgroup_size 64, vec4 uniforms, flat bind groups). Authority =
// finite-difference gradient checking in Node (tools/train-backward-witness.mjs): every kernel reproduces the
// true numeric gradient, so the GPU path inherits the autograd's proven correctness. 100% on-device.

// ── OUTER: G[row*C + col] = scale · u[row] · w[col].  Covers BOTH dB and dA. ──
// dB: u=dy[out], w=h[r], scale=scale, rows=out, cols=r.   dA: u=dh[r], w=x[in], scale=1, rows=r, cols=in.
export const OUTER = `@group(0)@binding(0)var<storage,read>u:array<f32>;@group(0)@binding(1)var<storage,read>w:array<f32>;@group(0)@binding(2)var<storage,read_write>G:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<f32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let i=g.x;let R=u32(p.y);let C=u32(p.z);if(i>=R*C){return;}let row=i/C;let col=i-row*C;G[i]=p.x*u[row]*w[col];}`;

// ── MATVECT: o[c] = scale · Σ_r M[r*C + c] · v[r]  (M is [R*C] row-major; this reads M's COLUMNS = Mᵀ·v). ──
// dh: M=B[out*r], v=dy[out], scale=scale, R=out, C=r → o[k]=scale·Σ_o B[o*r+k]·dy[o].
export const MATVECT = `@group(0)@binding(0)var<storage,read>M:array<f32>;@group(0)@binding(1)var<storage,read>v:array<f32>;@group(0)@binding(2)var<storage,read_write>o:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<f32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let c=g.x;let R=u32(p.y);let C=u32(p.z);if(c>=C){return;}var acc=0.0;for(var r=0u;r<R;r++){acc=acc+M[r*C+c]*v[r];}o[c]=p.x*acc;}`;

// ── ADAMW: in-place AdamW on theta/m/v given grad. Decoupled wd (keep=1-α·wd). t-bias corrections passed in. ──
// p = (alpha, beta1, beta2, eps) ; q = (beta1h=1/(1-β1^t), beta2h=1/(1-β2^t), keep, N).
export const ADAMW = `@group(0)@binding(0)var<storage,read>g:array<f32>;@group(0)@binding(1)var<storage,read_write>th:array<f32>;@group(0)@binding(2)var<storage,read_write>m:array<f32>;@group(0)@binding(3)var<storage,read_write>v:array<f32>;@group(0)@binding(4)var<uniform>p:vec4<f32>;@group(0)@binding(5)var<uniform>q:vec4<f32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)gid:vec3<u32>){let i=gid.x;if(i>=u32(q.w)){return;}let gi=g[i];let mi=m[i]*p.y+gi*(1.0-p.y);let vi=v[i]*p.z+gi*gi*(1.0-p.z);m[i]=mi;v[i]=vi;let mh=mi*q.x;let vh=sqrt(vi*q.y)+p.w;th[i]=th[i]*q.z-p.x*mh/vh;}`;

const G64 = (n) => Math.ceil(n / 64);

// createBackwardRuntime(dev) — compile the three backward pipelines + minimal buffer/dispatch helpers.
// Standalone (does not require the forward runtime), but uses the IDENTICAL conventions so the two compose.
export function createBackwardRuntime(dev) {
  const pipe = (c) => { const m = dev.createShaderModule({ code: c }); return dev.createComputePipeline({ layout: "auto", compute: { module: m, entryPoint: "main" } }); };
  const P = { outer: pipe(OUTER), matvect: pipe(MATVECT), adamw: pipe(ADAMW) };
  const sbuf = (n) => dev.createBuffer({ size: Math.max(4, n * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const wF = (arr) => { const b = dev.createBuffer({ size: Math.max(4, arr.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(b, 0, arr); return b; };
  const f4 = (v) => { const b = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(b, 0, new Float32Array([...v, 0, 0, 0, 0].slice(0, 4))); return b; };
  const disp = (enc, pl, bufs, groups) => { const bg = dev.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: bufs.map((b, i) => ({ binding: i, resource: { buffer: b } })) }); const pa = enc.beginComputePass(); pa.setPipeline(pl); pa.setBindGroup(0, bg); pa.dispatchWorkgroups(groups); pa.end(); };
  const read = async (buf, n) => { const rb = dev.createBuffer({ size: n * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }); const e = dev.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, rb, 0, n * 4); dev.queue.submit([e.finish()]); await rb.mapAsync(GPUMapMode.READ); const out = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); return out; };
  return { _dev: dev, P, sbuf, wF, f4, disp, read, G: G64 };
}

// loraBackwardGPU(rt, {B, scale, x, h, dy, dims}) → {dA, dB} — runs OUTER·MATVECT·OUTER on the GPU, reads back.
// Mirrors the CPU loraBackward exactly (one submit). dh stays on-GPU between MATVECT and the dA OUTER.
export async function loraBackwardGPU(rt, { B, scale, x, h, dy, dims }) {
  const { inn, out, r } = dims;
  const bB = rt.wF(B), bx = rt.wF(x), bh = rt.wF(h), bdy = rt.wF(dy);
  const bdB = rt.sbuf(out * r), bdh = rt.sbuf(r), bdA = rt.sbuf(r * inn);
  const e = rt._dev.createCommandEncoder();
  rt.disp(e, rt.P.outer, [bdy, bh, bdB, rt.f4([scale, out, r])], rt.G(out * r));   // dB = scale·dy⊗h
  rt.disp(e, rt.P.matvect, [bB, bdy, bdh, rt.f4([scale, out, r])], rt.G(r));        // dh = scale·Bᵀ·dy
  rt.disp(e, rt.P.outer, [bdh, bx, bdA, rt.f4([1, r, inn])], rt.G(r * inn));        // dA = dh⊗x
  rt._dev.queue.submit([e.finish()]);
  const dB = await rt.read(bdB, out * r), dA = await rt.read(bdA, r * inn);
  return { dA, dB };
}

// adamwStepGPU(rt, {theta, grad, m, v, t, alpha, opt}) → {theta, m, v} — one ADAMW dispatch, reads back.
export async function adamwStepGPU(rt, { theta, grad, m, v, t, alpha, opt = {} }) {
  const { beta1 = 0.9, beta2 = 0.999, eps = 1e-8, wd = 0.0 } = opt;
  const beta1h = 1 / (1 - Math.pow(beta1, t)), beta2h = 1 / (1 - Math.pow(beta2, t)), keep = 1 - alpha * wd;
  const bth = rt.wF(theta), bg = rt.wF(grad), bm = rt.wF(m), bv = rt.wF(v);
  const e = rt._dev.createCommandEncoder();
  rt.disp(e, rt.P.adamw, [bg, bth, bm, bv, rt.f4([alpha, beta1, beta2, eps]), rt.f4([beta1h, beta2h, keep, theta.length])], rt.G(theta.length));
  rt._dev.queue.submit([e.finish()]);
  return { theta: await rt.read(bth, theta.length), m: await rt.read(bm, m.length), v: await rt.read(bv, v.length) };
}

export default { OUTER, MATVECT, ADAMW, createBackwardRuntime, loraBackwardGPU, adamwStepGPU };
