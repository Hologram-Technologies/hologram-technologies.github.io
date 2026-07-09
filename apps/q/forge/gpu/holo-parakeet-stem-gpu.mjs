// holo-parakeet-stem-gpu.mjs — WebGPU backend for the conv-subsampling STEM (mel image → features [T,1024]).
// The CPU stem (holo-parakeet-stem.mjs) is validated to cosine 0.99874 vs the real pre_encode output but is
// ~28s/utterance (nested-array conv); this runs the same 5 grouped convs + flatten + linear on GPU. Kernels are
// the WITNESSED conv-subsampling.wgsl (matched torch 2e-8) + the encoder's tiled MM; weights stream from the
// encoder .holo BY κ (the 6 pre_encode tensors), dequantized f32 ((uint8−zp)·scale). Same `device` is reused
// across calls (kept resident, brain pattern). createParakeetStemGPU({device?,getWeight,rescale,rescaleBin}).

const SIG = 'fn sg(x:f32)->f32{return 1.0/(1.0+exp(-x));}';
const K = {
  // grouped conv2d (conv-subsampling.wgsl) + relu. 2D dispatch (spanX = gx*64) so >65535-workgroup convs work.
  CONV: `struct Conv{Cin:u32,H:u32,W:u32,Cout:u32,kh:u32,kw:u32,stride:u32,pad:u32,groups:u32,Ho:u32,Wo:u32,relu:u32,spanX:u32};@group(0)@binding(0)var<uniform>c:Conv;@group(0)@binding(1)var<storage,read>inp:array<f32>;@group(0)@binding(2)var<storage,read>wt:array<f32>;@group(0)@binding(3)var<storage,read>bias:array<f32>;@group(0)@binding(4)var<storage,read_write>out:array<f32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)gid:vec3<u32>){let total=c.Cout*c.Ho*c.Wo;let n=gid.y*c.spanX+gid.x;if(n>=total){return;}let co=n/(c.Ho*c.Wo);let rem=n%(c.Ho*c.Wo);let oh=rem/c.Wo;let ow=rem%c.Wo;let cinG=c.Cin/c.groups;let coutG=c.Cout/c.groups;let g=co/coutG;var acc:f32=bias[co];for(var cig:u32=0u;cig<cinG;cig=cig+1u){let ci=g*cinG+cig;for(var i:u32=0u;i<c.kh;i=i+1u){let ih_s=i32(oh*c.stride+i)-i32(c.pad);if(ih_s<0||ih_s>=i32(c.H)){continue;}let ih=u32(ih_s);for(var j:u32=0u;j<c.kw;j=j+1u){let iw_s=i32(ow*c.stride+j)-i32(c.pad);if(iw_s<0||iw_s>=i32(c.W)){continue;}let iw=u32(iw_s);acc=acc+inp[ci*c.H*c.W+ih*c.W+iw]*wt[((co*cinG+cig)*c.kh+i)*c.kw+j];}}}if(c.relu==1u&&acc<0.0){acc=0.0;}out[co*c.Ho*c.Wo+oh*c.Wo+ow]=acc;}`,
  // flatten conv output [C][T][F] (co-major) → flat [T][C*F] channel-major (matches the CPU stem layout)
  FLAT: `struct U{C:u32,T:u32,F:u32,spanX:u32};@group(0)@binding(0)var<uniform>u:U;@group(0)@binding(1)var<storage,read>x:array<f32>;@group(0)@binding(2)var<storage,read_write>o:array<f32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let i=g.y*u.spanX+g.x;if(i>=u.C*u.T*u.F){return;}let cc=i/(u.T*u.F);let r=i%(u.T*u.F);let t=r/u.F;let f=r%u.F;o[t*(u.C*u.F)+cc*u.F+f]=x[cc*(u.T*u.F)+t*u.F+f];}`,
  // tiled matmul x[M,K]@w[K,N]+bias (the encoder's witnessed MM; act unused here)
  MM: `struct U{M:u32,K:u32,N:u32,act:u32};@group(0)@binding(0)var<uniform>u:U;@group(0)@binding(1)var<storage,read>x:array<f32>;@group(0)@binding(2)var<storage,read>w:array<f32>;@group(0)@binding(3)var<storage,read>b:array<f32>;@group(0)@binding(4)var<storage,read_write>o:array<f32>;${SIG}
var<workgroup> As:array<f32,256>;var<workgroup> Bs:array<f32,256>;
@compute @workgroup_size(16,16)fn main(@builtin(local_invocation_id)l:vec3<u32>,@builtin(workgroup_id)wg:vec3<u32>){let row=wg.y*16u+l.y;let col=wg.x*16u+l.x;var acc=0.0;let nt=(u.K+15u)/16u;for(var t=0u;t<nt;t++){let ac=t*16u+l.x;let br=t*16u+l.y;As[l.y*16u+l.x]=select(0.0,x[row*u.K+ac],row<u.M&&ac<u.K);Bs[l.y*16u+l.x]=select(0.0,w[br*u.N+col],br<u.K&&col<u.N);workgroupBarrier();for(var kk=0u;kk<16u;kk++){acc=acc+As[l.y*16u+kk]*Bs[kk*16u+l.x];}workgroupBarrier();}if(row<u.M&&col<u.N){acc=acc+b[col];o[row*u.N+col]=acc;}}`,
};

const conv2dOut = (H, kh, stride, pad) => (((H + 2 * pad - kh) / stride) | 0) + 1;

export function createParakeetStemGPU({ device = null, getWeight, rescale, rescaleBin } = {}) {
  if (!getWeight || !rescale || !rescaleBin) throw new Error("createParakeetStemGPU needs getWeight + rescale + rescaleBin");
  const bin = rescaleBin instanceof Uint8Array ? rescaleBin : new Uint8Array(rescaleBin.buffer || rescaleBin);
  const rbin = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
  const vec = (v) => rbin.subarray(v.off, v.off + v.len);
  const byRole = {}; for (const w of rescale.weights) if (w.layer < 0) byRole[w.role] = w;
  let dev = device, plc = new Map(), W = null, ready = false;
  const SB = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const pipe = (c) => { if (!plc.has(c)) plc.set(c, dev.createComputePipeline({ layout: "auto", compute: { module: dev.createShaderModule({ code: c }), entryPoint: "main" } })); return plc.get(c); };
  const upload = (a) => { const b = dev.createBuffer({ size: Math.max(4, a.byteLength), usage: SB() }); dev.queue.writeBuffer(b, 0, a); return b; };

  async function dqFlat(role) { const w = byRole[role], b = await getWeight(w.kappa), o = new Float32Array(b.length); for (let i = 0; i < b.length; i++) o[i] = (b[i] - w.zp) * w.scale; return o; }

  async function ensure() {
    if (ready) return;
    if (!dev) { const a = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }); dev = await a.requestDevice(); }
    // dequant + upload the 6 pre_encode weights once (resident across calls)
    const mk = async (role) => upload(await dqFlat(role));
    const bias = (role) => upload(vec(byRole[role].bias));
    W = {
      c0: await mk("stem.conv0"), c0b: bias("stem.conv0"),
      dw1: await mk("stem.conv2"), dw1b: bias("stem.conv2"), pw1: await mk("stem.conv3"), pw1b: bias("stem.conv3"),
      dw2: await mk("stem.conv5"), dw2b: bias("stem.conv5"), pw2: await mk("stem.conv6"), pw2b: bias("stem.conv6"),
      lin: await mk("stem.out_proj"), linb: bias("stem.out_proj"),
      linIn: byRole["stem.out_proj"].shape[0], linOut: byRole["stem.out_proj"].shape[1],
    };
    ready = true;
  }

  async function stem(mel, F, Tmel) {
    await ensure();
    const u32 = (...a) => new Uint32Array(a), ceil = (a, b) => Math.ceil(a / b);
    let trash = [], enc = dev.createCommandEncoder();
    const tmp = (n) => { const b = dev.createBuffer({ size: n * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }); trash.push(b); return b; };
    const uni = (arr) => { const b = dev.createBuffer({ size: Math.max(16, arr.byteLength), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(b, 0, arr); trash.push(b); return b; };
    function runRaw(code, uarr, ins, outN, gx, gy) { const pl = pipe(code), ub = uni(uarr), out = tmp(outN); const ent = [{ binding: 0, resource: { buffer: ub } }]; ins.forEach((b, i) => ent.push({ binding: i + 1, resource: { buffer: b } })); ent.push({ binding: ins.length + 1, resource: { buffer: out } }); const bg = dev.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: ent }); const p = enc.beginComputePass(); p.setPipeline(pl); p.setBindGroup(0, bg); p.dispatchWorkgroups(gx, gy || 1); p.end(); return out; }
    // 2D dispatch split for >65535-workgroup passes; spanX (=gx*64) appended to the uniform array's last slot
    const MAXWG = 65535;
    function disp1d(code, baseUni, ins, total) { const wg = ceil(total, 64); const gx = Math.min(MAXWG, wg), gy = ceil(wg, gx), spanX = gx * 64; const uarr = new Uint32Array([...baseUni, spanX]); return runRaw(code, uarr, ins, total, gx, gy); }
    // conv2d(inp, w, b, Cin,H,W,Cout,kh,kw,stride,pad,groups,relu)
    const conv = (inp, w, b, Cin, H, Wd, Cout, kh, kw, stride, pad, groups, relu) => { const Ho = conv2dOut(H, kh, stride, pad), Wo = conv2dOut(Wd, kw, stride, pad); const out = disp1d(K.CONV, [Cin, H, Wd, Cout, kh, kw, stride, pad, groups, Ho, Wo, relu], [inp, w, b], Cout * Ho * Wo); return { out, Ho, Wo }; };

    // mel [F*Tmel] freq-major → image [1][Tmel][128]: img[t*F+f] = mel[f*Tmel+t]
    const img = new Float32Array(Tmel * F); for (let t = 0; t < Tmel; t++) for (let f = 0; f < F; f++) img[t * F + f] = mel[f * Tmel + t];
    const x0 = upload(img); trash.push(x0);
    let r = conv(x0, W.c0, W.c0b, 1, Tmel, F, 256, 3, 3, 2, 1, 1, 1);                       // c0 → relu
    r = conv(r.out, W.dw1, W.dw1b, 256, r.Ho, r.Wo, 256, 3, 3, 2, 1, 256, 0);               // dw1
    r = conv(r.out, W.pw1, W.pw1b, 256, r.Ho, r.Wo, 256, 1, 1, 1, 0, 1, 1);                 // pw1 → relu
    r = conv(r.out, W.dw2, W.dw2b, 256, r.Ho, r.Wo, 256, 3, 3, 2, 1, 256, 0);               // dw2
    r = conv(r.out, W.pw2, W.pw2b, 256, r.Ho, r.Wo, 256, 1, 1, 1, 0, 1, 1);                 // pw2 → relu
    const C = 256, Tout = r.Ho, Fout = r.Wo, inDim = C * Fout;
    const flat = disp1d(K.FLAT, [C, Tout, Fout], [r.out], Tout * inDim);   // [Tout][C*Fout]
    const feat = runRaw(K.MM, u32(Tout, inDim, W.linOut, 0), [flat, W.lin, W.linb], Tout * W.linOut, ceil(W.linOut, 16), ceil(Tout, 16));
    const rd = dev.createBuffer({ size: Tout * W.linOut * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); enc.copyBufferToBuffer(feat, 0, rd, 0, Tout * W.linOut * 4);
    dev.queue.submit([enc.finish()]); await rd.mapAsync(GPUMapMode.READ); const features = new Float32Array(rd.getMappedRange().slice(0)); rd.unmap(); rd.destroy();
    for (const b of trash) b.destroy();
    return { features, T: Tout };
  }

  return { ready: ensure, stem, free() { plc = new Map(); } };
}
export default createParakeetStemGPU;
