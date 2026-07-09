// holo-parakeet-encoder-gpu.mjs — the WebGPU backend for the Parakeet 24-layer FastConformer encoder. This is
// the proven runner of holo-q-voice-pack/s3/parakeet-encoder-gpu.html (cosine 0.98903 vs onnxruntime on AMD
// RDNA-3 → exact transcript) lifted into a DOM-free module and wired as holo-parakeet-encoder.mjs's `_gpuEncode`.
//
// REUSE (per the Q/Hologram stack survey — don't reinvent the substrate):
//   • WEIGHT DELIVERY: weights arrive through the injected `getWeight(kappa) -> Uint8Array`. In production that
//     is the ear's streamHolo accessor — HTTP-Range → GitHub release → κ-route → OPFS, with verified bodies
//     cached in the cross-model `holo-kappa` OPFS dir. So first load streams, warm visits are ~0-network/instant
//     (the "precompile + stream fast to any user" path) — this module adds no caching, it consumes that one.
//   • RESIDENT PATTERN (holo-brain-engine): the device is kept alive across calls; G3 will keep int8 weights
//     GPU-resident for real-time repeats. G0 here streams per-layer (fetch→dequant→upload→run→free, peak ~one
//     layer) — same memory-frugal shape as the brain on a phone, correct first, fast next.
//   • KERNELS: the batched matmul/LN/GLU/DW/HEAD + relpos-attn are the WITNESSED encoder kernels (the gguf-gpu
//     library is matrix-VECTOR/LLM-decode; the encoder is matrix-MATRIX over T frames — different kernel), so
//     they are inlined verbatim from the passing page, not re-derived.
//
//   createParakeetEncoderGPU({ device?, getWeight, rescale, rescaleBin }) →
//     { ready(): Promise, encode(features /*[T*1024]*/, T) -> Promise<Float32Array[T*1024]>, free() }

const D = 1024, H = 8, dk = 128, dff = 4096, k = 9;
const SIG = 'fn sg(x:f32)->f32{return 1.0/(1.0+exp(-x));}';

// ── witnessed encoder kernels (verbatim from s3/parakeet-encoder-gpu.html) ──
const K = {
  MM: `struct U{M:u32,K:u32,N:u32,act:u32};@group(0)@binding(0)var<uniform>u:U;@group(0)@binding(1)var<storage,read>x:array<f32>;@group(0)@binding(2)var<storage,read>w:array<f32>;@group(0)@binding(3)var<storage,read>b:array<f32>;@group(0)@binding(4)var<storage,read_write>o:array<f32>;${SIG}
var<workgroup> As:array<f32,256>;var<workgroup> Bs:array<f32,256>;
@compute @workgroup_size(16,16)fn main(@builtin(local_invocation_id)l:vec3<u32>,@builtin(workgroup_id)wg:vec3<u32>){let row=wg.y*16u+l.y;let col=wg.x*16u+l.x;var acc=0.0;let nt=(u.K+15u)/16u;for(var t=0u;t<nt;t++){let ac=t*16u+l.x;let br=t*16u+l.y;As[l.y*16u+l.x]=select(0.0,x[row*u.K+ac],row<u.M&&ac<u.K);Bs[l.y*16u+l.x]=select(0.0,w[br*u.N+col],br<u.K&&col<u.N);workgroupBarrier();for(var kk=0u;kk<16u;kk++){acc=acc+As[l.y*16u+kk]*Bs[kk*16u+l.x];}workgroupBarrier();}if(row<u.M&&col<u.N){acc=acc+b[col];if(u.act==1u){acc=acc*sg(acc);}o[row*u.N+col]=acc;}}`,
  // int8 matmul with IN-SHADER dequant: w is packed uint8 (array<u32>, 4 bytes/word), dequant (byte-zp)*scale
  // on read. Mathematically identical to JS-dequant→f32 MM, but skips the per-utterance 619MB→2.4GB JS dequant
  // and quarters the GPU upload (the real-time + mobile win). Tiled, same shape as MM.
  MMI8: `struct U{M:u32,K:u32,N:u32,act:u32,zp:u32,scale:f32};@group(0)@binding(0)var<uniform>u:U;@group(0)@binding(1)var<storage,read>x:array<f32>;@group(0)@binding(2)var<storage,read>w:array<u32>;@group(0)@binding(3)var<storage,read>b:array<f32>;@group(0)@binding(4)var<storage,read_write>o:array<f32>;${SIG}
var<workgroup> As:array<f32,256>;var<workgroup> Bs:array<f32,256>;
fn wb(idx:u32)->f32{let v=w[idx>>2u];let by=(v>>((idx&3u)*8u))&0xffu;return (f32(by)-f32(u.zp))*u.scale;}
@compute @workgroup_size(16,16)fn main(@builtin(local_invocation_id)l:vec3<u32>,@builtin(workgroup_id)wg:vec3<u32>){let row=wg.y*16u+l.y;let col=wg.x*16u+l.x;var acc=0.0;let nt=(u.K+15u)/16u;for(var t=0u;t<nt;t++){let ac=t*16u+l.x;let br=t*16u+l.y;As[l.y*16u+l.x]=select(0.0,x[row*u.K+ac],row<u.M&&ac<u.K);Bs[l.y*16u+l.x]=select(0.0,wb(br*u.N+col),br<u.K&&col<u.N);workgroupBarrier();for(var kk=0u;kk<16u;kk++){acc=acc+As[l.y*16u+kk]*Bs[kk*16u+l.x];}workgroupBarrier();}if(row<u.M&&col<u.N){acc=acc+b[col];if(u.act==1u){acc=acc*sg(acc);}o[row*u.N+col]=acc;}}`,
  LN: `struct U{M:u32,D:u32};@group(0)@binding(0)var<uniform>u:U;@group(0)@binding(1)var<storage,read>x:array<f32>;@group(0)@binding(2)var<storage,read>g:array<f32>;@group(0)@binding(3)var<storage,read>b:array<f32>;@group(0)@binding(4)var<storage,read_write>o:array<f32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)gi:vec3<u32>){let m=gi.x;if(m>=u.M){return;}var mu=0.0;for(var j=0u;j<u.D;j++){mu=mu+x[m*u.D+j];}mu=mu/f32(u.D);var v=0.0;for(var j=0u;j<u.D;j++){let d=x[m*u.D+j]-mu;v=v+d*d;}v=v/f32(u.D);let iv=1.0/sqrt(v+1e-5);for(var j=0u;j<u.D;j++){o[m*u.D+j]=(x[m*u.D+j]-mu)*iv*g[j]+b[j];}}`,
  ADD: `struct U{N:u32,p:u32,s:f32,p2:f32};@group(0)@binding(0)var<uniform>u:U;@group(0)@binding(1)var<storage,read>a:array<f32>;@group(0)@binding(2)var<storage,read>b:array<f32>;@group(0)@binding(3)var<storage,read_write>o:array<f32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let i=g.x;if(i>=u.N){return;}o[i]=a[i]+u.s*b[i];}`,
  GLU: `struct U{T:u32,d:u32};@group(0)@binding(0)var<uniform>u:U;@group(0)@binding(1)var<storage,read>x:array<f32>;@group(0)@binding(2)var<storage,read_write>o:array<f32>;${SIG}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let i=g.x;if(i>=u.T*u.d){return;}let t=i/u.d;let c=i%u.d;o[i]=x[t*2u*u.d+c]*sg(x[t*2u*u.d+u.d+c]);}`,
  SW: `struct U{N:u32};@group(0)@binding(0)var<uniform>u:U;@group(0)@binding(1)var<storage,read>x:array<f32>;@group(0)@binding(2)var<storage,read_write>o:array<f32>;${SIG}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let i=g.x;if(i>=u.N){return;}o[i]=x[i]*sg(x[i]);}`,
  DW: `struct U{T:u32,d:u32,k:u32,pad:u32};@group(0)@binding(0)var<uniform>u:U;@group(0)@binding(1)var<storage,read>x:array<f32>;@group(0)@binding(2)var<storage,read>w:array<f32>;@group(0)@binding(3)var<storage,read>b:array<f32>;@group(0)@binding(4)var<storage,read_write>o:array<f32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)gi:vec3<u32>){let i=gi.x;if(i>=u.T*u.d){return;}let t=i/u.d;let c=i%u.d;var acc=b[c];for(var kk=0u;kk<u.k;kk++){let tt=i32(t)+i32(kk)-i32(u.pad);if(tt>=0&&tt<i32(u.T)){acc=acc+x[u32(tt)*u.d+c]*w[c*u.k+kk];}}o[i]=acc;}`,
  HEAD: `struct U{H:u32,Tr:u32,dk:u32,srcW:u32,colOff:u32,p:u32,p2:u32,p3:u32};@group(0)@binding(0)var<uniform>u:U;@group(0)@binding(1)var<storage,read>q:array<f32>;@group(0)@binding(2)var<storage,read>b:array<f32>;@group(0)@binding(3)var<storage,read_write>o:array<f32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)gi:vec3<u32>){let i=gi.x;if(i>=u.H*u.Tr*u.dk){return;}let h=i/(u.Tr*u.dk);let r=i%(u.Tr*u.dk);let t=r/u.dk;let dd=r%u.dk;o[i]=q[t*u.srcW+u.colOff+h*u.dk+dd]+b[h*u.dk+dd];}`,
  // Conformer relative-position attention (witnessed; mirrors relpos-attn.wgsl op-for-op, inlined for sealing).
  RELPOS: `struct Dims{H:u32,T:u32,dk:u32,P:u32,d_model:u32,_p:u32,_p2:u32,_p3:u32};@group(0)@binding(0)var<uniform>dims:Dims;@group(0)@binding(1)var<storage,read>q_u:array<f32>;@group(0)@binding(2)var<storage,read>q_v:array<f32>;@group(0)@binding(3)var<storage,read>k:array<f32>;@group(0)@binding(4)var<storage,read>v:array<f32>;@group(0)@binding(5)var<storage,read>p:array<f32>;@group(0)@binding(6)var<storage,read_write>ctx_out:array<f32>;
const MAX_T:u32=1024u;
fn qidx(h:u32,t:u32,d:u32)->u32{return (h*dims.T+t)*dims.dk+d;}
fn pidx(h:u32,pp:u32,d:u32)->u32{return (h*dims.P+pp)*dims.dk+d;}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)gid:vec3<u32>){let lin=gid.x;let total=dims.H*dims.T;if(lin>=total){return;}let h=lin/dims.T;let t=lin%dims.T;let scale=1.0/sqrt(f32(dims.dk));var scores:array<f32,MAX_T>;var mx:f32=-3.0e38;for(var s:u32=0u;s<dims.T;s=s+1u){var ac:f32=0.0;for(var d:u32=0u;d<dims.dk;d=d+1u){ac=ac+q_u[qidx(h,t,d)]*k[qidx(h,s,d)];}let idx=dims.T+t*dims.P+s;let pp1=dims.P+1u;let tp=idx/pp1;let jj=idx%pp1;var bd:f32=0.0;if(jj>=1u){let pj=jj-1u;for(var d:u32=0u;d<dims.dk;d=d+1u){bd=bd+q_v[qidx(h,tp,d)]*p[pidx(h,pj,d)];}}let sc=(ac+bd)*scale;scores[s]=sc;mx=max(mx,sc);}var denom:f32=0.0;for(var s:u32=0u;s<dims.T;s=s+1u){let e=exp(scores[s]-mx);scores[s]=e;denom=denom+e;}for(var d:u32=0u;d<dims.dk;d=d+1u){var acc:f32=0.0;for(var s:u32=0u;s<dims.T;s=s+1u){acc=acc+(scores[s]/denom)*v[qidx(h,s,d)];}ctx_out[t*dims.d_model+h*dims.dk+d]=acc;}}`,
};

// relative positional encoding (sinusoid, centered) — same as the CPU module; inlined so this is self-contained.
function relPosEncoding(T) {
  const L = 2 * T - 1, pe = new Float32Array(L * D), half = D >> 1, div = new Float64Array(half);
  for (let kk = 0; kk < half; kk++) div[kk] = Math.exp(-(2 * kk) * Math.log(10000) / D);
  for (let i = 0; i < L; i++) { const pos = (T - 1) - i, base = i * D; for (let kk = 0; kk < half; kk++) { const a = pos * div[kk]; pe[base + 2 * kk] = Math.sin(a); pe[base + 2 * kk + 1] = Math.cos(a); } }
  return pe;
}

export function createParakeetEncoderGPU({ device = null, getWeight, rescale, rescaleBin, resident = true } = {}) {
  if (!getWeight || !rescale || !rescaleBin) throw new Error("createParakeetEncoderGPU needs getWeight + rescale + rescaleBin");
  const bin = rescaleBin instanceof Uint8Array ? rescaleBin : new Uint8Array(rescaleBin.buffer || rescaleBin);
  const rbin = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
  const vec = (v) => rbin.subarray(v.off, v.off + v.len);   // rescale.bin: f32 ELEMENT off/len
  const byL = {}; for (const w of rescale.weights) if (w.layer >= 0) (byL[w.layer] = byL[w.layer] || {})[w.role] = w;
  const NLAYERS = (rescale.config && rescale.config.layers) || 24;
  let dev = device, plc = new Map(), SB, SBC, ready = false;

  async function ensure() {
    if (ready) return;
    if (!dev) { const a = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }); dev = await a.requestDevice(); }   // brain pattern; kept alive across calls
    SB = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST; SBC = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;
    ready = true;
  }
  const pipe = (c) => { if (!plc.has(c)) plc.set(c, dev.createComputePipeline({ layout: "auto", compute: { module: dev.createShaderModule({ code: c }), entryPoint: "main" } })); return plc.get(c); };

  async function encode(features, T) {
    await ensure();
    const P = 2 * T - 1, pe = relPosEncoding(T), u32 = (...a) => new Uint32Array(a);
    const addUni = (N, s) => { const b = new ArrayBuffer(16), v = new DataView(b); v.setUint32(0, N, true); v.setFloat32(8, s, true); return new Uint32Array(b); };
    const ceil = (a, b) => Math.ceil(a / b);
    let trash = [], enc;
    const buf = (a) => { const b = dev.createBuffer({ size: Math.max(4, a.byteLength), usage: SB }); dev.queue.writeBuffer(b, 0, a); trash.push(b); return b; };
    function op(code, uni, ins, outCount, gx, gy) {
      const pl = pipe(code), ub = dev.createBuffer({ size: Math.max(16, uni.byteLength), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      dev.queue.writeBuffer(ub, 0, uni); const out = dev.createBuffer({ size: outCount * 4, usage: SBC }); trash.push(ub, out);
      const ent = [{ binding: 0, resource: { buffer: ub } }]; ins.forEach((b, i) => ent.push({ binding: i + 1, resource: { buffer: b } })); ent.push({ binding: ins.length + 1, resource: { buffer: out } });
      const bg = dev.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: ent });
      const p = enc.beginComputePass(); p.setPipeline(pl); p.setBindGroup(0, bg); p.dispatchWorkgroups(gx, gy || 1); p.end(); return out;
    }
    const mm = (x, Mr, Kk, w, N, b, act = 0) => op(K.MM, u32(Mr, Kk, N, act), [x, w, b], Mr * N, ceil(N, 16), ceil(Mr, 16));
    const ln = (x, Mr, g, b) => op(K.LN, u32(Mr, D), [x, g, b], Mr * D, ceil(Mr, 64));
    const add = (a, b, N, s) => op(K.ADD, addUni(N, s), [a, b], N, ceil(N, 64));
    const sw = (x, N) => op(K.SW, u32(N), [x], N, ceil(N, 64));
    const glu = (x, t) => op(K.GLU, u32(t, D), [x], t * D, ceil(t * D, 64));
    const dw = (x, t, w, b) => op(K.DW, u32(t, D, k, (k - 1) / 2), [x, w, b], t * D, ceil(t * D, 64));
    const head = (q, t, colOff, bias) => op(K.HEAD, u32(H, t, dk, D, colOff, 0, 0, 0), [q, bias], H * t * dk, ceil(H * t * dk, 64));
    const relpos = (qu, qv, kk, v, p, t, Pp) => op(K.RELPOS, u32(H, t, dk, Pp, D, 0, 0, 0), [qu, qv, kk, v, p], t * D, ceil(H * t, 64));

    const deq = async (w, transpose) => { const body = await getWeight(w.kappa); const n = body.length, f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = (body[i] - w.zp) * w.scale; if (transpose) { const [A, B] = transpose, o = new Float32Array(n); for (let i = 0; i < A; i++) for (let j = 0; j < B; j++) o[j * A + i] = f[i * B + j]; return o; } return f; };
    // int8 path: upload raw uint8 weight (dequant in-shader) — no per-utterance JS f32 dequant, ¼ the upload.
    const i8uni = (M, Kk, N, act, zp, scale) => { const b = new ArrayBuffer(32), v = new DataView(b); v.setUint32(0, M, true); v.setUint32(4, Kk, true); v.setUint32(8, N, true); v.setUint32(12, act, true); v.setUint32(16, zp, true); v.setFloat32(20, scale, true); return new Uint8Array(b); };
    const bufI8 = (bytes) => { const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4); padded.set(bytes); const bb = dev.createBuffer({ size: padded.byteLength, usage: SB }); dev.queue.writeBuffer(bb, 0, padded); trash.push(bb); return bb; };
    const fetchI8 = async (w, transpose) => { let body = await getWeight(w.kappa); if (transpose) { const [A, B] = transpose, o = new Uint8Array(body.length); for (let i = 0; i < A; i++) for (let j = 0; j < B; j++) o[j * A + i] = body[i * B + j]; body = o; } return { buf: bufI8(body), scale: w.scale, zp: w.zp }; };
    const mmi8 = (x, Mr, Kk, W, N, b, act = 0) => op(K.MMI8, i8uni(Mr, Kk, N, act, W.zp, W.scale), [x, W.buf, b], Mr * N, ceil(N, 16), ceil(Mr, 16));

    let xCPU = Float32Array.from(features);
    for (let L = 0; L < NLAYERS; L++) {
      const br = byL[L];
      const ff1a = await fetchI8(br["ff1.0"]), ff1b = await fetchI8(br["ff1.1"]), ff2a = await fetchI8(br["ff2.0"]), ff2b = await fetchI8(br["ff2.1"]);
      const Wq = await fetchI8(br["attn.linear_q"]), Wk = await fetchI8(br["attn.linear_k"]), Wv = await fetchI8(br["attn.linear_v"]), Wp = await fetchI8(br["attn.linear_pos"]), Wo = await fetchI8(br["attn.linear_out"]);
      const pw1 = await fetchI8(br["conv.pointwise_conv1"], [2 * D, D]), pw2 = await fetchI8(br["conv.pointwise_conv2"], [D, D]), dww = buf(await deq(br["conv.depthwise_conv"]));
      const z0 = buf(new Float32Array(D)), z2 = buf(new Float32Array(2 * D)), zdff = buf(new Float32Array(dff)), zhk = buf(new Float32Array(H * dk));
      const pw1b = br["conv.pointwise_conv1"].bias ? buf(vec(br["conv.pointwise_conv1"].bias)) : z2;
      const dwb = br["conv.depthwise_conv"].bias ? buf(vec(br["conv.depthwise_conv"].bias)) : z0;
      const pw2b = br["conv.pointwise_conv2"].bias ? buf(vec(br["conv.pointwise_conv2"].bias)) : z0;
      const nm = rescale.norms[L], N = (n) => ({ w: buf(vec(nm[n].weight)), b: buf(vec(nm[n].bias)) });
      const n1 = N("feed_forward1"), n2 = N("self_att"), n3 = N("conv"), n4 = N("feed_forward2"), n5 = N("out");
      const pbu = buf(vec(rescale.pos_bias[L].u)), pbv = buf(vec(rescale.pos_bias[L].v));
      const xb = buf(xCPU), posb = buf(pe);
      enc = dev.createCommandEncoder(); let x = xb;
      let h = ln(x, T, n1.w, n1.b); let f = mmi8(h, T, D, ff1a, dff, zdff, 1); f = mmi8(f, T, dff, ff1b, D, z0, 0); x = add(x, f, T * D, 0.5);
      h = ln(x, T, n2.w, n2.b);
      const q = mmi8(h, T, D, Wq, D, z0), kk = mmi8(h, T, D, Wk, D, z0), v = mmi8(h, T, D, Wv, D, z0), p = mmi8(posb, P, D, Wp, D, z0);
      const qu = head(q, T, 0, pbu), qv = head(q, T, 0, pbv), kh = head(kk, T, 0, zhk), vh = head(v, T, 0, zhk), ph = head(p, P, 0, zhk);
      const ctx = relpos(qu, qv, kh, vh, ph, T, P); x = add(x, mmi8(ctx, T, D, Wo, D, z0), T * D, 1.0);
      h = ln(x, T, n3.w, n3.b); let z = mmi8(h, T, D, pw1, 2 * D, pw1b); z = glu(z, T); z = dw(z, T, dww, dwb); z = sw(z, T * D); x = add(x, mmi8(z, T, D, pw2, D, pw2b), T * D, 1.0);
      h = ln(x, T, n4.w, n4.b); f = mmi8(h, T, D, ff2a, dff, zdff, 1); f = mmi8(f, T, dff, ff2b, D, z0, 0); x = add(x, f, T * D, 0.5);
      x = ln(x, T, n5.w, n5.b);
      const rd = dev.createBuffer({ size: T * D * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); enc.copyBufferToBuffer(x, 0, rd, 0, T * D * 4);
      dev.queue.submit([enc.finish()]); await rd.mapAsync(GPUMapMode.READ); xCPU = new Float32Array(rd.getMappedRange().slice(0)); rd.unmap(); rd.destroy();
      for (const b of trash) b.destroy(); trash = [];   // free this layer before the next (peak ~one layer; mobile-friendly)
    }
    return xCPU;
  }

  // ── RESIDENT single-submission path (high tier): upload all int8 weights ONCE (kept resident across calls),
  // run all 24 layers in ONE queue.submit with activations GPU-resident — no per-layer readback, no re-upload
  // on warm calls. The brain-engine pattern (holo-brain-engine). Mobile/low-VRAM uses the per-layer encode().
  let RW = null, ZB = null;
  const bufP = (a) => { const b = dev.createBuffer({ size: Math.max(4, a.byteLength), usage: SB }); dev.queue.writeBuffer(b, 0, a); return b; };
  const bufI8P = (bytes) => { const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4); padded.set(bytes); return bufP(padded); };
  async function fetchI8P(w, transpose) { let body = await getWeight(w.kappa); if (transpose) { const [A, B] = transpose, o = new Uint8Array(body.length); for (let i = 0; i < A; i++) for (let j = 0; j < B; j++) o[j * A + i] = body[i * B + j]; body = o; } return { buf: bufI8P(body), scale: w.scale, zp: w.zp }; }
  async function deqF32P(w) { const body = await getWeight(w.kappa), f = new Float32Array(body.length); for (let i = 0; i < body.length; i++) f[i] = (body[i] - w.zp) * w.scale; return f; }
  async function prepare() {
    await ensure(); if (RW) return;
    ZB = { z0: bufP(new Float32Array(D)), z2: bufP(new Float32Array(2 * D)), zdff: bufP(new Float32Array(dff)), zhk: bufP(new Float32Array(H * dk)) };
    RW = [];
    for (let L = 0; L < NLAYERS; L++) {
      const br = byL[L], nm = rescale.norms[L], Nf = (n) => ({ w: bufP(vec(nm[n].weight)), b: bufP(vec(nm[n].bias)) });
      RW[L] = {
        ff1a: await fetchI8P(br["ff1.0"]), ff1b: await fetchI8P(br["ff1.1"]), ff2a: await fetchI8P(br["ff2.0"]), ff2b: await fetchI8P(br["ff2.1"]),
        Wq: await fetchI8P(br["attn.linear_q"]), Wk: await fetchI8P(br["attn.linear_k"]), Wv: await fetchI8P(br["attn.linear_v"]), Wp: await fetchI8P(br["attn.linear_pos"]), Wo: await fetchI8P(br["attn.linear_out"]),
        pw1: await fetchI8P(br["conv.pointwise_conv1"], [2 * D, D]), pw2: await fetchI8P(br["conv.pointwise_conv2"], [D, D]), dww: bufP(await deqF32P(br["conv.depthwise_conv"])),
        pw1b: br["conv.pointwise_conv1"].bias ? bufP(vec(br["conv.pointwise_conv1"].bias)) : ZB.z2,
        dwb: br["conv.depthwise_conv"].bias ? bufP(vec(br["conv.depthwise_conv"].bias)) : ZB.z0,
        pw2b: br["conv.pointwise_conv2"].bias ? bufP(vec(br["conv.pointwise_conv2"].bias)) : ZB.z0,
        n1: Nf("feed_forward1"), n2: Nf("self_att"), n3: Nf("conv"), n4: Nf("feed_forward2"), n5: Nf("out"),
        pbu: bufP(vec(rescale.pos_bias[L].u)), pbv: bufP(vec(rescale.pos_bias[L].v)),
      };
    }
  }
  async function encodeResident(features, T) {
    await prepare();
    const P = 2 * T - 1, pe = relPosEncoding(T), u32 = (...a) => new Uint32Array(a), ceil = (a, b) => Math.ceil(a / b);
    const addUni = (N, s) => { const b = new ArrayBuffer(16), v = new DataView(b); v.setUint32(0, N, true); v.setFloat32(8, s, true); return new Uint32Array(b); };
    const i8uni = (M, Kk, N, act, zp, scale) => { const b = new ArrayBuffer(32), v = new DataView(b); v.setUint32(0, M, true); v.setUint32(4, Kk, true); v.setUint32(8, N, true); v.setUint32(12, act, true); v.setUint32(16, zp, true); v.setFloat32(20, scale, true); return new Uint8Array(b); };
    const lt = [], enc = dev.createCommandEncoder();
    const buf = (a) => { const b = dev.createBuffer({ size: Math.max(4, a.byteLength), usage: SB }); dev.queue.writeBuffer(b, 0, a); lt.push(b); return b; };
    function op(code, uni, ins, outCount, gx, gy) { const pl = pipe(code), ub = dev.createBuffer({ size: Math.max(16, uni.byteLength), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(ub, 0, uni); const out = dev.createBuffer({ size: outCount * 4, usage: SBC }); lt.push(ub, out); const ent = [{ binding: 0, resource: { buffer: ub } }]; ins.forEach((b, i) => ent.push({ binding: i + 1, resource: { buffer: b } })); ent.push({ binding: ins.length + 1, resource: { buffer: out } }); const bg = dev.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: ent }); const p = enc.beginComputePass(); p.setPipeline(pl); p.setBindGroup(0, bg); p.dispatchWorkgroups(gx, gy || 1); p.end(); return out; }
    const mmi8 = (x, Mr, Kk, W, N, b, act = 0) => op(K.MMI8, i8uni(Mr, Kk, N, act, W.zp, W.scale), [x, W.buf, b], Mr * N, ceil(N, 16), ceil(Mr, 16));
    const ln = (x, Mr, g, b) => op(K.LN, u32(Mr, D), [x, g, b], Mr * D, ceil(Mr, 64));
    const add = (a, b, N, s) => op(K.ADD, addUni(N, s), [a, b], N, ceil(N, 64));
    const sw = (x, N) => op(K.SW, u32(N), [x], N, ceil(N, 64));
    const glu = (x, t) => op(K.GLU, u32(t, D), [x], t * D, ceil(t * D, 64));
    const dw = (x, t, w, b) => op(K.DW, u32(t, D, k, (k - 1) / 2), [x, w, b], t * D, ceil(t * D, 64));
    const head = (q, t, colOff, bias) => op(K.HEAD, u32(H, t, dk, D, colOff, 0, 0, 0), [q, bias], H * t * dk, ceil(H * t * dk, 64));
    const relpos = (qu, qv, kk, v, p, t, Pp) => op(K.RELPOS, u32(H, t, dk, Pp, D, 0, 0, 0), [qu, qv, kk, v, p], t * D, ceil(H * t, 64));
    let x = buf(features); const posb = buf(pe);
    for (let L = 0; L < NLAYERS; L++) {
      const W = RW[L];
      let h = ln(x, T, W.n1.w, W.n1.b); let f = mmi8(h, T, D, W.ff1a, dff, ZB.zdff, 1); f = mmi8(f, T, dff, W.ff1b, D, ZB.z0, 0); x = add(x, f, T * D, 0.5);
      h = ln(x, T, W.n2.w, W.n2.b);
      const q = mmi8(h, T, D, W.Wq, D, ZB.z0), kk = mmi8(h, T, D, W.Wk, D, ZB.z0), v = mmi8(h, T, D, W.Wv, D, ZB.z0), p = mmi8(posb, P, D, W.Wp, D, ZB.z0);
      const qu = head(q, T, 0, W.pbu), qv = head(q, T, 0, W.pbv), kh = head(kk, T, 0, ZB.zhk), vh = head(v, T, 0, ZB.zhk), ph = head(p, P, 0, ZB.zhk);
      const ctx = relpos(qu, qv, kh, vh, ph, T, P); x = add(x, mmi8(ctx, T, D, W.Wo, D, ZB.z0), T * D, 1.0);
      h = ln(x, T, W.n3.w, W.n3.b); let z = mmi8(h, T, D, W.pw1, 2 * D, W.pw1b); z = glu(z, T); z = dw(z, T, W.dww, W.dwb); z = sw(z, T * D); x = add(x, mmi8(z, T, D, W.pw2, D, W.pw2b), T * D, 1.0);
      h = ln(x, T, W.n4.w, W.n4.b); f = mmi8(h, T, D, W.ff2a, dff, ZB.zdff, 1); f = mmi8(f, T, dff, W.ff2b, D, ZB.z0, 0); x = add(x, f, T * D, 0.5);
      x = ln(x, T, W.n5.w, W.n5.b);
    }
    const rd = dev.createBuffer({ size: T * D * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); enc.copyBufferToBuffer(x, 0, rd, 0, T * D * 4);
    dev.queue.submit([enc.finish()]); await rd.mapAsync(GPUMapMode.READ); const out = new Float32Array(rd.getMappedRange().slice(0)); rd.unmap(); rd.destroy();
    for (const b of lt) b.destroy();
    return out;
  }

  async function encodeFast(features, T) { try { return await encodeResident(features, T); } catch (e) { try { console.warn("[parakeet encoder] resident path failed, per-layer:", e && e.message || e); } catch (_) {} return encode(features, T); } }

  return { ready: ensure, prepare, encode: resident ? encodeFast : encode, free() { plc = new Map(); RW = null; } };
}
export default createParakeetEncoderGPU;
