// holo-qwen35-kernels.mjs — the 3 small WGSL kernels qwen35 needs beyond the existing engine + the gated-delta
// step: (1) causal depthwise conv1d + SiLU (single-token incremental, with conv tail), (2) gated RMSNorm
// (per head_v, ·w·silu(z)), (3) (1+w) RMSNorm (Qwen3.5's Gemma-style regular norm). Each mirrors the proven
// CPU op and is parity-verified in qwen35-kernels-parity.html (WebGPU browser). Dispatch helpers are
// self-contained for the harness; production binds via the engine's buffer pool.

const U = (GPUBufferUsage) => ({ ST: GPUBufferUsage.STORAGE, SRC: GPUBufferUsage.COPY_SRC, DST: GPUBufferUsage.COPY_DST, UNI: GPUBufferUsage.UNIFORM, MR: GPUBufferUsage.MAP_READ });
function mkF32(device, data, usage) { const b = device.createBuffer({ size: Math.max(16, data.byteLength), usage, mappedAtCreation: true }); new Float32Array(b.getMappedRange()).set(data); b.unmap(); return b; }
async function readBack(device, buf, bytes) { const r = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }); const e = device.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, r, 0, bytes); device.queue.submit([e.finish()]); await r.mapAsync(GPUMapMode.READ); return new Float32Array(r.getMappedRange().slice(0)); }
const _pipeCache = new WeakMap();   // device → Map<wgsl, pipeline>  (compile each kernel once, not per call)
export function cachedPipe(device, wgsl) {
  let m = _pipeCache.get(device); if (!m) { m = new Map(); _pipeCache.set(device, m); }
  let p = m.get(wgsl); if (!p) { p = device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code: wgsl }), entryPoint: "main" } }); m.set(wgsl, p); }
  return p;
}
function dispatch(device, wgsl, binds, uniBytes, groups) {
  const pipe = cachedPipe(device, wgsl);
  const uni = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uni, 0, uniBytes);
  const bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [...binds, uni].map((b, i) => ({ binding: i, resource: { buffer: b } })) });
  const enc = device.createCommandEncoder(); const pass = enc.beginComputePass();
  pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(groups); pass.end();
  device.queue.submit([enc.finish()]);
}

// ── (1+w) RMSNorm: y = x·rsqrt(mean(x²)+eps)·(1+w) ──
export const RMSNORM_1P_WGSL = /* wgsl */`
@group(0)@binding(0) var<storage,read> x:array<f32>;
@group(0)@binding(1) var<storage,read> w:array<f32>;
@group(0)@binding(2) var<storage,read_write> y:array<f32>;
@group(0)@binding(3) var<uniform> p:vec2<f32>;   // p.x=N, p.y=eps
@compute @workgroup_size(1) fn main(){ let N=u32(p.x); var ss=0.0; for(var i=0u;i<N;i++){ss=ss+x[i]*x[i];} let sc=1.0/sqrt(ss/p.x+p.y); for(var i=0u;i<N;i++){y[i]=x[i]*sc*(1.0+w[i]);} }`;
export async function rmsNorm1pGPU(device, x, w, eps) {
  const xb = mkF32(device, x, GPUBufferUsage.STORAGE), wb = mkF32(device, w, GPUBufferUsage.STORAGE);
  const yb = device.createBuffer({ size: x.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  dispatch(device, RMSNORM_1P_WGSL, [xb, wb, yb], new Float32Array([x.length, eps]), 1);
  return readBack(device, yb, x.byteLength);
}

// ── gated RMSNorm (per head_v): y[h][j] = o[h][j]·rsqrt(mean_j(o²)+eps)·w[j]·silu(z[h][j]) ──
export const GATED_RMSNORM_WGSL = /* wgsl */`
struct P { nHeads:u32, headV:u32, pad:u32, eps:f32 };
@group(0)@binding(0) var<storage,read> o:array<f32>;
@group(0)@binding(1) var<storage,read> w:array<f32>;
@group(0)@binding(2) var<storage,read> z:array<f32>;
@group(0)@binding(3) var<storage,read_write> y:array<f32>;
@group(0)@binding(4) var<uniform> p:P;
@compute @workgroup_size(1) fn main(@builtin(workgroup_id) wid:vec3<u32>){
  let h=wid.x; if(h>=p.nHeads){return;} let base=h*p.headV;
  var ss=0.0; for(var j=0u;j<p.headV;j++){ss=ss+o[base+j]*o[base+j];}
  let sc=1.0/sqrt(ss/f32(p.headV)+p.eps);
  for(var j=0u;j<p.headV;j++){ let zz=z[base+j]; y[base+j]=o[base+j]*sc*w[j]*(zz/(1.0+exp(-zz))); }
}`;
export async function gatedRMSNormGPU(device, o, w, z, nHeads, headV, eps) {
  const ob = mkF32(device, o, GPUBufferUsage.STORAGE), wb = mkF32(device, w, GPUBufferUsage.STORAGE), zb = mkF32(device, z, GPUBufferUsage.STORAGE);
  const yb = device.createBuffer({ size: o.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const ub = new ArrayBuffer(16); new Uint32Array(ub, 0, 3).set([nHeads, headV, 0]); new Float32Array(ub, 12, 1)[0] = eps;
  dispatch(device, GATED_RMSNORM_WGSL, [ob, wb, zb, yb], new Uint8Array(ub), nHeads);
  return readBack(device, yb, o.byteLength);
}

// ── causal depthwise conv1d + SiLU, single-token incremental: out[c]=silu(Σ_j W[j·C+c]·win[j][c]),
//    win = [tail(K-1 tokens), cur]. ──
export const CONV1D_STEP_WGSL = /* wgsl */`
struct P { C:u32, K:u32, pad0:u32, pad1:u32 };
@group(0)@binding(0) var<storage,read> tail:array<f32>;   // [(K-1)*C]
@group(0)@binding(1) var<storage,read> cur:array<f32>;    // [C]
@group(0)@binding(2) var<storage,read> cw:array<f32>;     // [K*C]
@group(0)@binding(3) var<storage,read_write> out:array<f32>; // [C]
@group(0)@binding(4) var<uniform> p:P;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){
  let c=g.x; if(c>=p.C){return;}
  var acc=0.0;
  for(var j=0u;j<p.K-1u;j++){ acc=acc+cw[j*p.C+c]*tail[j*p.C+c]; }
  acc=acc+cw[(p.K-1u)*p.C+c]*cur[c];
  out[c]=acc/(1.0+exp(-acc));
}`;
export async function conv1dStepGPU(device, tail, cur, cw, C, K) {
  const tb = mkF32(device, tail, GPUBufferUsage.STORAGE), cb = mkF32(device, cur, GPUBufferUsage.STORAGE), wb = mkF32(device, cw, GPUBufferUsage.STORAGE);
  const ob = device.createBuffer({ size: cur.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const ub = new ArrayBuffer(16); new Uint32Array(ub).set([C, K, 0, 0]);
  dispatch(device, CONV1D_STEP_WGSL, [tb, cb, wb, ob], new Uint8Array(ub), Math.ceil(C / 64));
  return readBack(device, ob, cur.byteLength);
}

// ── f32 matvec: y[n] = Σ_k W[n·K+k]·x[k]  (engine has quantized variants; this is the f32 path for tests) ──
export const MATVECF_WGSL = /* wgsl */`
@group(0)@binding(0) var<storage,read> W:array<f32>;
@group(0)@binding(1) var<storage,read> x:array<f32>;
@group(0)@binding(2) var<storage,read_write> y:array<f32>;
@group(0)@binding(3) var<uniform> p:vec2<u32>;   // p.x=N, p.y=K
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){ let n=g.x; if(n>=p.x){return;} let K=p.y; var acc=0.0; let b=n*K; for(var k=0u;k<K;k++){acc=acc+W[b+k]*x[k];} y[n]=acc; }`;
export async function matvecFGPU(device, W, x, N, K) {
  const wb = mkF32(device, W, GPUBufferUsage.STORAGE), xb = mkF32(device, x, GPUBufferUsage.STORAGE);
  const yb = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const ub = new ArrayBuffer(16); new Uint32Array(ub).set([N, K, 0, 0]);
  dispatch(device, MATVECF_WGSL, [wb, xb, yb], new Uint8Array(ub), Math.ceil(N / 64));
  return readBack(device, yb, N * 4);
}

// ── qwen35 per-head prep: expand q/k (16 k-heads → 32 v-heads), L2-norm both, scale q·1/√headK,
//    decay = exp(−exp(A_log)·softplus(a+dt)), beta = sigmoid(b). One pass per v-head. ──
// Packed to ≤8 storage buffers (WebGPU default max): ph = [aP|bP|sA|sDt] (4·nvh), db out = [decay|beta] (2·nvh).
export const QWEN_PREP_WGSL = /* wgsl */`
struct P { nvh:u32, nkh:u32, headK:u32, _pad:u32 };
@group(0)@binding(0) var<storage,read> qS:array<f32>;   // [nkh*headK]
@group(0)@binding(1) var<storage,read> kS:array<f32>;
@group(0)@binding(2) var<storage,read> ph:array<f32>;   // [4*nvh] = aP,bP,sA(=A_log),sDt
@group(0)@binding(3) var<storage,read_write> qE:array<f32>;  // [nvh*headK]
@group(0)@binding(4) var<storage,read_write> kE:array<f32>;
@group(0)@binding(5) var<storage,read_write> db:array<f32>;  // [2*nvh] = decay, beta
@group(0)@binding(6) var<uniform> p:P;
@compute @workgroup_size(1) fn main(@builtin(workgroup_id) wid:vec3<u32>){
  let h=wid.x; if(h>=p.nvh){return;} let hk=p.headK; let n=p.nvh; let grp=n/p.nkh; let kh=(h/grp)*hk; let oB=h*hk;
  var ssq=0.0; var ssk=0.0; for(var i=0u;i<hk;i++){ ssq=ssq+qS[kh+i]*qS[kh+i]; ssk=ssk+kS[kh+i]*kS[kh+i]; }
  let qi=(1.0/sqrt(ssq+1e-6))*(1.0/sqrt(f32(hk))); let ki=1.0/sqrt(ssk+1e-6);
  for(var i=0u;i<hk;i++){ qE[oB+i]=qS[kh+i]*qi; kE[oB+i]=kS[kh+i]*ki; }
  let s=ph[h]+ph[3u*n+h]; let sp=select(log(1.0+exp(s)), s, s>20.0);   // aP+sDt
  db[h]=exp(-exp(ph[2u*n+h])*sp); db[n+h]=1.0/(1.0+exp(-ph[n+h]));      // decay=exp(-exp(A_log)·softplus), beta=sigmoid(bP)
}`;
export async function qwenPrepGPU(device, { qS, kS, aP, bP, sA, sDt, nvh, nkh, headK }) {
  const ph = new Float32Array(4 * nvh); ph.set(aP, 0); ph.set(bP, nvh); ph.set(sA, 2 * nvh); ph.set(sDt, 3 * nvh);
  const qE = device.createBuffer({ size: nvh * headK * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const kE = device.createBuffer({ size: nvh * headK * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const db = device.createBuffer({ size: 2 * nvh * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const ub = new ArrayBuffer(16); new Uint32Array(ub).set([nvh, nkh, headK, 0]);
  dispatch(device, QWEN_PREP_WGSL, [mkF32(device, qS, GPUBufferUsage.STORAGE), mkF32(device, kS, GPUBufferUsage.STORAGE), mkF32(device, ph, GPUBufferUsage.STORAGE), qE, kE, db], new Uint8Array(ub), nvh);
  const dbr = await readBack(device, db, 2 * nvh * 4);
  return { qE: await readBack(device, qE, nvh * headK * 4), kE: await readBack(device, kE, nvh * headK * 4), decay: dbr.slice(0, nvh), beta: dbr.slice(nvh) };
}

// ── per-head (1+w) RMSNorm + partial NEOX RoPE (Qwen3.5 attention q/k-norm; rotate_half at HEAD_DIM/2,
//    only the first ropeDim dims rotate). cos/sin length = ropeDim. ──
export const HEAD_NORM_ROPE_WGSL = /* wgsl */`
struct P { nHeads:u32, headDim:u32, ropeDim:u32, epsBits:u32 };
@group(0)@binding(0) var<storage,read> x:array<f32>;    // [nHeads*headDim]
@group(0)@binding(1) var<storage,read> w:array<f32>;    // [headDim] norm weight
@group(0)@binding(2) var<storage,read> cs:array<f32>;   // [ropeDim]
@group(0)@binding(3) var<storage,read> sn:array<f32>;
@group(0)@binding(4) var<storage,read_write> y:array<f32>; // [nHeads*headDim]
@group(0)@binding(5) var<uniform> p:P;
@compute @workgroup_size(1) fn main(@builtin(workgroup_id) wid:vec3<u32>){
  let h=wid.x; if(h>=p.nHeads){return;} let hd=p.headDim; let base=h*hd; let eps=bitcast<f32>(p.epsBits);
  var t:array<f32,256>;
  var ss=0.0; for(var i=0u;i<hd;i++){ss=ss+x[base+i]*x[base+i];}
  let sc=1.0/sqrt(ss/f32(hd)+eps);
  for(var i=0u;i<hd;i++){ t[i]=x[base+i]*sc*(1.0+w[i]); }
  let half=hd/2u;
  for(var i=0u;i<hd;i++){
    if(i<p.ropeDim){ let rot = select(t[i-half], -t[i+half], i<half); y[base+i]=t[i]*cs[i]+rot*sn[i]; }
    else { y[base+i]=t[i]; }
  }
}`;
export async function headNormRopeGPU(device, x, w, cos, sin, nHeads, headDim, ropeDim, eps) {
  const B = (a) => mkF32(device, a, GPUBufferUsage.STORAGE);
  const yb = device.createBuffer({ size: x.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const ub = new ArrayBuffer(16); const dv = new DataView(ub); dv.setUint32(0, nHeads, true); dv.setUint32(4, headDim, true); dv.setUint32(8, ropeDim, true); dv.setFloat32(12, eps, true);
  dispatch(device, HEAD_NORM_ROPE_WGSL, [B(x), B(w), B(cos), B(sin), yb], new Uint8Array(ub), nHeads);
  return readBack(device, yb, x.byteLength);
}

// ── causal GQA attention over a full sequence: ctx[t][h] = softmax_p≤t(scale·q_t·k_p)·v_p  (kv head = h/grp) ──
export const CAUSAL_GQA_WGSL = /* wgsl */`
struct P { T:u32, nh:u32, hd:u32, nkv:u32 };
@group(0)@binding(0) var<storage,read> q:array<f32>;   // [T*nh*hd]
@group(0)@binding(1) var<storage,read> k:array<f32>;   // [T*nkv*hd]
@group(0)@binding(2) var<storage,read> v:array<f32>;
@group(0)@binding(3) var<storage,read_write> ctx:array<f32>; // [T*nh*hd]
@group(0)@binding(4) var<uniform> p:P;
@group(0)@binding(5) var<uniform> pf:vec4<f32>;   // pf.x=scale, pf.y=grp
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){
  let idx=g.x; if(idx>=p.T*p.nh){return;} let t=idx/p.nh; let h=idx%p.nh; let kv=u32(f32(h)/pf.y);
  let hd=p.hd; let qoff=(t*p.nh+h)*hd;
  var sc:array<f32,1024>; var mx=-3.0e38;
  for(var pp=0u;pp<=t;pp++){ let koff=(pp*p.nkv+kv)*hd; var d=0.0; for(var i=0u;i<hd;i++){d=d+q[qoff+i]*k[koff+i];} sc[pp]=d*pf.x; if(sc[pp]>mx){mx=sc[pp];} }
  var den=0.0; for(var pp=0u;pp<=t;pp++){ sc[pp]=exp(sc[pp]-mx); den=den+sc[pp]; }
  for(var i=0u;i<hd;i++){ var acc=0.0; for(var pp=0u;pp<=t;pp++){ acc=acc+(sc[pp]/den)*v[(pp*p.nkv+kv)*hd+i]; } ctx[qoff+i]=acc; }
}`;
export async function causalGQAGPU(device, q, k, v, T, nh, hd, nkv, scale) {
  const B = (a) => mkF32(device, a, GPUBufferUsage.STORAGE);
  const cb = device.createBuffer({ size: T * nh * hd * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const ui = new ArrayBuffer(16); new Uint32Array(ui).set([T, nh, hd, nkv]);
  const uf = new ArrayBuffer(16); new Float32Array(uf).set([scale, nh / nkv, 0, 0]);
  const pipe = cachedPipe(device, CAUSAL_GQA_WGSL);
  const u1 = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(u1, 0, new Uint8Array(ui));
  const u2 = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(u2, 0, new Uint8Array(uf));
  const bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [B(q), B(k), B(v), cb, u1, u2].map((b, i) => ({ binding: i, resource: { buffer: b } })) });
  const enc = device.createCommandEncoder(); const pass = enc.beginComputePass(); pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(T * nh / 64)); pass.end(); device.queue.submit([enc.finish()]);
  return readBack(device, cb, T * nh * hd * 4);
}

// ── single-query GQA over a KV cache (the DECODE-step attention): ctx[h] = softmax_p<P(scale·q_h·kc_p)·vc_p ──
export const SINGLE_Q_ATTN_WGSL = /* wgsl */`
struct P { P:u32, nh:u32, hd:u32, nkv:u32 };
@group(0)@binding(0) var<storage,read> q:array<f32>;    // [nh*hd] (current token)
@group(0)@binding(1) var<storage,read> kc:array<f32>;   // [P*nkv*hd] cache
@group(0)@binding(2) var<storage,read> vc:array<f32>;
@group(0)@binding(3) var<storage,read_write> ctx:array<f32>; // [nh*hd]
@group(0)@binding(4) var<uniform> p:P;
@group(0)@binding(5) var<uniform> pf:vec4<f32>;   // pf.x=scale, pf.y=grp
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){
  let h=g.x; if(h>=p.nh){return;} let kv=u32(f32(h)/pf.y); let hd=p.hd; let qoff=h*hd;
  var sc:array<f32,4096>; var mx=-3.0e38;
  for(var pp=0u;pp<p.P;pp++){ let koff=(pp*p.nkv+kv)*hd; var d=0.0; for(var i=0u;i<hd;i++){d=d+q[qoff+i]*kc[koff+i];} sc[pp]=d*pf.x; if(sc[pp]>mx){mx=sc[pp];} }
  var den=0.0; for(var pp=0u;pp<p.P;pp++){ sc[pp]=exp(sc[pp]-mx); den=den+sc[pp]; }
  for(var i=0u;i<hd;i++){ var acc=0.0; for(var pp=0u;pp<p.P;pp++){ acc=acc+(sc[pp]/den)*vc[(pp*p.nkv+kv)*hd+i]; } ctx[qoff+i]=acc; }
}`;
export async function singleQAttnGPU(device, q, kc, vc, P, nh, hd, nkv, scale) {
  const B = (a) => mkF32(device, a, GPUBufferUsage.STORAGE);
  const cb = device.createBuffer({ size: nh * hd * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const ui = new ArrayBuffer(16); new Uint32Array(ui).set([P, nh, hd, nkv]);
  const uf = new ArrayBuffer(16); new Float32Array(uf).set([scale, nh / nkv, 0, 0]);
  const pipe = cachedPipe(device, SINGLE_Q_ATTN_WGSL);
  const u1 = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(u1, 0, new Uint8Array(ui));
  const u2 = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(u2, 0, new Uint8Array(uf));
  const bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [B(q), B(kc), B(vc), cb, u1, u2].map((b, i) => ({ binding: i, resource: { buffer: b } })) });
  const enc = device.createCommandEncoder(); const pass = enc.beginComputePass(); pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(nh / 64)); pass.end(); device.queue.submit([enc.finish()]);
  return readBack(device, cb, nh * hd * 4);
}

export default { RMSNORM_1P_WGSL, GATED_RMSNORM_WGSL, CONV1D_STEP_WGSL, MATVECF_WGSL, QWEN_PREP_WGSL, HEAD_NORM_ROPE_WGSL, CAUSAL_GQA_WGSL, SINGLE_Q_ATTN_WGSL, rmsNorm1pGPU, gatedRMSNormGPU, conv1dStepGPU, matvecFGPU, qwenPrepGPU, headNormRopeGPU, causalGQAGPU, singleQAttnGPU };
