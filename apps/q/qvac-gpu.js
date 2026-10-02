// QVAC WebGPU decode engine — GPU-resident inference for the int8 Llama model.
//
// "type-1" lean path: int8 weights + KV cache live on the GPU; each token is ONE
// command buffer chaining every kernel (intermediates stay in GPU buffers, no
// per-op CPU round-trip), with a single async readback of the logits. The wasm
// hands over the weights via qvac_gpu_export(); JS keeps only the embedding table
// for the host-side lookup. Mirrors the CPU DecodeSession op-for-op so its output
// matches (greedy decode → identical tokens).

// Per-block GEMV (Q8: int8 1B/weight, or Q4: nibble 2 weights/byte), weights in
// [out,in] layout (K-split reads are contiguous → coalesced), with a scale per
// 32-weight block (GGUF-native precision). One workgroup per output row, 64
// threads reduce over K. `add` fuses a residual: o = x·dequant(qw,sc) [+ r].
import { requant2bit, signsFor } from "./qvac-2bit.mjs";

const mmKernel = (bits, add, q3f = false) => `
@group(0) @binding(0) var<storage,read> x: array<f32>;
@group(0) @binding(1) var<storage,read> qw: array<u32>;
@group(0) @binding(2) var<storage,read> sc: array<f32>;
${add
    ? "@group(0) @binding(3) var<storage,read> r: array<f32>;\n@group(0) @binding(4) var<storage,read_write> o: array<f32>;\n@group(0) @binding(5) var<uniform> P: vec4<u32>;"
    : "@group(0) @binding(3) var<storage,read_write> o: array<f32>;\n@group(0) @binding(4) var<uniform> P: vec4<u32>;"}
var<workgroup> red: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let n=wg.y*65535u+wg.x; let K=P.x; let nblk=P.z; let t=lid.x;
  if(n>=P.y){return;}                                    // 2D grid for N>65535 (big vocab)
  var acc=0.0;
${bits === 2
    ? `  let words=K>>4u; let rowW=n*words; let rowS=n*nblk; var w=t;     // 2-bit: 16 weights/u32
  loop{ if(w>=words){break;} let packed=qw[rowW+w]; let kb=w<<4u; let sca=sc[rowS+(kb>>5u)];
    for(var j=0u;j<16u;j=j+1u){ acc=acc+x[kb+j]*f32(i32((packed>>(j*2u))&3u)*2-3)*sca; } w=w+64u;
  }`
    : bits === 3 && q3f
    ? `  let rowB=n*nblk; var blk=t;                                       // Q3 FIELDS: 10×3-bit per u32 (+ the 3 spare 2-bit stubs = w30/w31); 1 shift+and per weight
  loop{ if(blk>=nblk){break;} let bp=(rowB+blk)*3u; let p0=qw[bp]; let p1=qw[bp+1u]; let p2=qw[bp+2u]; let kb=blk<<5u; var bacc=0.0;
    for(var j=0u;j<10u;j=j+1u){ bacc=bacc+x[kb+j]*f32(i32((p0>>(j*3u))&7u)-3); }
    for(var j=0u;j<10u;j=j+1u){ bacc=bacc+x[kb+10u+j]*f32(i32((p1>>(j*3u))&7u)-3); }
    for(var j=0u;j<10u;j=j+1u){ bacc=bacc+x[kb+20u+j]*f32(i32((p2>>(j*3u))&7u)-3); }
    let sp=(p0>>30u)|((p1>>30u)<<2u)|((p2>>30u)<<4u);
    bacc=bacc+x[kb+30u]*f32(i32(sp&7u)-3)+x[kb+31u]*f32(i32((sp>>3u)&7u)-3);
    acc=acc+bacc*sc[rowB+blk]; blk=blk+64u;
  }`
    : bits === 3
    ? `  let rowB=n*nblk; var blk=t;                                       // Q3: bit-planes — 3 u32 per 32-block, level {−7…7}
  loop{ if(blk>=nblk){break;} let bp=(rowB+blk)*3u; let p0=qw[bp]; let p1=qw[bp+1u]; let p2=qw[bp+2u]; let sca=sc[rowB+blk]; let kb=blk<<5u;
    for(var j=0u;j<32u;j=j+1u){ let q=((p0>>j)&1u)|(((p1>>j)&1u)<<1u)|(((p2>>j)&1u)<<2u); acc=acc+x[kb+j]*f32(i32(q)-3)*sca; } blk=blk+64u;
  }`
    : bits === 4
    ? `  let words=K>>3u; let rowW=n*words; let rowS=n*nblk; var w=t;     // Q4: 8 nibbles/u32, hoisted block scale (word-oriented)
  loop{ if(w>=words){break;} let packed=qw[rowW+w]; let kb=w<<3u; let sca=sc[rowS+(kb>>5u)];
    for(var j=0u;j<8u;j=j+1u){ acc=acc+x[kb+j]*f32(i32((packed>>(j*4u))&0xfu)-8)*sca; } w=w+64u;
  }`
    : `  var k=t;
  loop{ if(k>=K){break;}
    let g=n*K+k;
    let q=f32(i32(((qw[g/4u]>>((g%4u)*8u))&0xffu)<<24u)>>24u);
    acc=acc+x[k]*q*sc[n*nblk + (k>>5u)];
    k=k+64u;
  }`}
  red[t]=acc; workgroupBarrier();
  var s=32u; loop{ if(s==0u){break;} if(t<s){ red[t]=red[t]+red[t+s]; } workgroupBarrier(); s=s/2u; }
  if(t==0u){ o[P.w + n]=red[0]${add ? "+r[n]" : ""}; }  // P.w = output-row base (0 except tiled lm_head)
}`;

// native-2-bit input rotation (incoherence undo): x′ = FWHT(sign ⊙ x) over Kp = next-pow2(K). MULTI-
// WORKGROUP / multi-pass so any Kp works (no shared-memory limit): a load+sign pass, log2(Kp) in-place
// butterfly passes (one per stride; WebGPU orders passes in an encoder), then a normalise pass. The
// weights were quantized in this same rotated basis (requant2bit) so the rotation cancels: Ŵ′·x′ = W·x.
const FWHT_LOAD = `
@group(0) @binding(0) var<storage,read> x: array<f32>;
@group(0) @binding(1) var<storage,read> sgn: array<f32>;
@group(0) @binding(2) var<storage,read_write> xr: array<f32>;
@group(0) @binding(3) var<uniform> P: vec4<u32>;                 // K (real), Kp (padded)
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>){ let i=gid.x; let K=P.x; let Kp=P.y; if(i>=Kp){return;} var xi=0.0; if(i<K){ xi=x[i]; } xr[i]=xi*sgn[i]; }`;
const FWHT_BFLY = `
@group(0) @binding(0) var<storage,read_write> xr: array<f32>;
@group(0) @binding(1) var<uniform> P: vec4<u32>;                 // Kp, len
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>){ let i=gid.x; let Kp=P.x; let len=P.y; if(i>=(Kp>>1u)){return;} let blk=i/len; let j=i%len; let a=blk*(len<<1u)+j; let b=a+len; let u=xr[a]; let v=xr[b]; xr[a]=u+v; xr[b]=u-v; }`;
const FWHT_NORM = `
@group(0) @binding(0) var<storage,read_write> xr: array<f32>;
@group(0) @binding(1) var<uniform> P: vec4<u32>;                 // Kp
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>){ let i=gid.x; let Kp=P.x; if(i>=Kp){return;} xr[i]=xr[i]*(1.0/sqrt(f32(Kp))); }`;

const RMS = `
@group(0) @binding(0) var<storage,read> x: array<f32>;
@group(0) @binding(1) var<storage,read> gamma: array<f32>;
@group(0) @binding(2) var<storage,read_write> o: array<f32>;
@group(0) @binding(3) var<uniform> P: vec4<u32>;                 // d
var<workgroup> sh: array<f32,256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid:vec3<u32>){
  let d=P.x; let t=lid.x;
  var s=0.0; var i=t; loop{ if(i>=d){break;} s=s+x[i]*x[i]; i=i+256u; }
  sh[t]=s; workgroupBarrier();
  var stride=128u; loop{ if(stride==0u){break;} if(t<stride){ sh[t]=sh[t]+sh[t+stride]; } workgroupBarrier(); stride=stride/2u; }
  let inv=1.0/sqrt(sh[0]/f32(d)+1e-9);
  var j=t; loop{ if(j>=d){break;} o[j]=x[j]*inv*gamma[j]; j=j+256u; }
}`;

// Qwen3 QK-Norm: per-head RMSNorm over head_dim (≤128), one workgroup per head.
const QKNORM = `
@group(0) @binding(0) var<storage,read_write> x: array<f32>;     // [nh*hd] in place
@group(0) @binding(1) var<storage,read> w: array<f32>;           // [hd]
@group(0) @binding(2) var<uniform> P: vec4<u32>;                 // nh, hd, _, _
var<workgroup> sh: array<f32, 128>;
@compute @workgroup_size(128)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let h=wg.x; let hd=P.y; let t=lid.x; let base=h*hd;
  var v=0.0; if(t<hd){ v=x[base+t]; }
  sh[t]=v*v; workgroupBarrier();
  var s=64u; loop{ if(s==0u){break;} if(t<s){ sh[t]=sh[t]+sh[t+s]; } workgroupBarrier(); s=s/2u; }
  let inv=1.0/sqrt(sh[0]/f32(hd)+1e-6);
  if(t<hd){ x[base+t]=v*inv*w[t]; }
}`;

const ARGMAX2C = `
@group(0) @binding(0) var<storage,read> c: array<vec2<u32>>;
@group(0) @binding(1) var<storage,read_write> o: array<u32>;
@group(0) @binding(2) var<uniform> P: vec4<u32>;
var<workgroup> wm: array<f32,256>; var<workgroup> wi: array<u32,256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid:vec3<u32>){
  let t=lid.x; let e=c[t]; wm[t]=bitcast<f32>(e.x); wi[t]=e.y; workgroupBarrier();
  var s=128u; loop{ if(s==0u){break;} if(t<s&&(wm[t+s]>wm[t]||(wm[t+s]==wm[t]&&wi[t+s]<wi[t]))){wm[t]=wm[t+s];wi[t]=wi[t+s];} workgroupBarrier(); s=s/2u; }
  if(t==0u){ o[P.x*2u]=wi[0]; o[P.x*2u+1u]=bitcast<u32>(wm[0]); }
}`;
const ARGMAX2K = `
@group(0) @binding(0) var<storage,read> c: array<vec2<u32>>;
@group(0) @binding(1) var<storage,read_write> o: array<u32>;
@group(0) @binding(2) var<uniform> P: vec4<u32>;
var<workgroup> wm: array<f32,256>; var<workgroup> wi: array<u32,256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid:vec3<u32>){
  let t=lid.x; let e=c[t]; wm[t]=bitcast<f32>(e.x); wi[t]=e.y; workgroupBarrier();
  var s=128u; loop{ if(s==0u){break;} if(t<s&&(wm[t+s]>wm[t]||(wm[t+s]==wm[t]&&wi[t+s]<wi[t]))){wm[t]=wm[t+s];wi[t]=wi[t+s];} workgroupBarrier(); s=s/2u; }
  if(t==0u){ o[P.x]=wi[0]; }
}`;
// ── SPECULATIVE WINDOW KERNELS (batched-k verify: all k input tokens known ⇒ the window forwards
// like a tiny prefill — weights read ONCE per pass for all k rows). Row-major [k][dim] buffers. ──
const ATTNQK = (cap, kvd) => `
@group(0) @binding(0) var<storage,read> q: array<f32>;           // [k][nh*hd]
@group(0) @binding(1) var<storage,read> kc: array<u32>;
@group(0) @binding(2) var<storage,read> vc: array<u32>;
@group(0) @binding(3) var<storage,read_write> o: array<f32>;     // [k][nh*hd]
@group(0) @binding(4) var<uniform> P: vec4<u32>;                 // nh, nkv, hd, basePos (wg.y = row; pos = basePos+row)
var<workgroup> sc: array<f32, ${cap}>;
var<workgroup> red: array<f32, 64>;
const S: u32 = ${kvd / 8 + kvd / 32}u;
const CW: u32 = ${kvd / 8}u;
fn kval(j:u32, c:u32) -> f32 { let w=kc[j*S+(c>>3u)]; return (f32((w>>((c&7u)*4u))&15u)-7.0)*bitcast<f32>(kc[j*S+CW+(c>>5u)]); }
fn vval(j:u32, c:u32) -> f32 { let w=vc[j*S+(c>>3u)]; return (f32((w>>((c&7u)*4u))&15u)-7.0)*bitcast<f32>(vc[j*S+CW+(c>>5u)]); }
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let h=wg.x; let nh=P.x; let nkv=P.y; let hd=P.z; let pos=P.w+wg.y;
  let group=nh/nkv; let kh=h/group; let rb=wg.y*nh*hd;
  let scale=1.0/sqrt(f32(hd)); let qb=rb+h*hd; let kb=kh*hd; let t=lid.x;
  var j=t; loop{ if(j>pos){break;} var d=0.0; for(var c=0u;c<hd;c++){ d=d+q[qb+c]*kval(j,kb+c); } sc[j]=d*scale; j=j+64u; }
  workgroupBarrier();
  var lm=-1e30; j=t; loop{ if(j>pos){break;} lm=max(lm,sc[j]); j=j+64u; }
  red[t]=lm; workgroupBarrier();
  var s=32u; loop{ if(s==0u){break;} if(t<s){ red[t]=max(red[t],red[t+s]); } workgroupBarrier(); s=s/2u; }
  let mx=red[0]; workgroupBarrier();
  var ld=0.0; j=t; loop{ if(j>pos){break;} let e=exp(sc[j]-mx); sc[j]=e; ld=ld+e; j=j+64u; }
  red[t]=ld; workgroupBarrier();
  s=32u; loop{ if(s==0u){break;} if(t<s){ red[t]=red[t]+red[t+s]; } workgroupBarrier(); s=s/2u; }
  let dn=red[0]; workgroupBarrier();
  var c=t; loop{ if(c>=hd){break;} var acc=0.0; for(var jj=0u;jj<=pos;jj++){ acc=acc+sc[jj]*vval(jj,kb+c); } o[qb+c]=acc/dn; c=c+64u; }
}`;
const ATTNK = (cap) => `
@group(0) @binding(0) var<storage,read> q: array<f32>;           // [k][nh*hd]
@group(0) @binding(1) var<storage,read> kc: array<f32>;          // f32 cache (layer 0)
@group(0) @binding(2) var<storage,read> vc: array<f32>;
@group(0) @binding(3) var<storage,read_write> o: array<f32>;
@group(0) @binding(4) var<uniform> P: vec4<u32>;                 // nh, nkv, hd, basePos (wg.y = row)
var<workgroup> sc: array<f32, ${cap}>;
var<workgroup> red: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let h=wg.x; let nh=P.x; let nkv=P.y; let hd=P.z; let pos=P.w+wg.y;
  let group=nh/nkv; let kh=h/group; let kvdim=nkv*hd; let rb=wg.y*nh*hd;
  let scale=1.0/sqrt(f32(hd)); let qb=rb+h*hd; let kb=kh*hd; let t=lid.x;
  var j=t; loop{ if(j>pos){break;} var d=0.0; for(var c=0u;c<hd;c++){ d=d+q[qb+c]*kc[j*kvdim+kb+c]; } sc[j]=d*scale; j=j+64u; }
  workgroupBarrier();
  var lm=-1e30; j=t; loop{ if(j>pos){break;} lm=max(lm,sc[j]); j=j+64u; }
  red[t]=lm; workgroupBarrier();
  var s=32u; loop{ if(s==0u){break;} if(t<s){ red[t]=max(red[t],red[t+s]); } workgroupBarrier(); s=s/2u; }
  let mx=red[0]; workgroupBarrier();
  var ld=0.0; j=t; loop{ if(j>pos){break;} let e=exp(sc[j]-mx); sc[j]=e; ld=ld+e; j=j+64u; }
  red[t]=ld; workgroupBarrier();
  s=32u; loop{ if(s==0u){break;} if(t<s){ red[t]=red[t]+red[t+s]; } workgroupBarrier(); s=s/2u; }
  let dn=red[0]; workgroupBarrier();
  var c=t; loop{ if(c>=hd){break;} var acc=0.0; for(var jj=0u;jj<=pos;jj++){ acc=acc+sc[jj]*vc[jj*kvdim+kb+c]; } o[qb+c]=acc/dn; c=c+64u; }
}`;
const RMSK = `
@group(0) @binding(0) var<storage,read> x: array<f32>;
@group(0) @binding(1) var<storage,read> gamma: array<f32>;
@group(0) @binding(2) var<storage,read_write> o: array<f32>;
@group(0) @binding(3) var<uniform> P: vec4<u32>;                 // d (wg.y = row)
var<workgroup> sh: array<f32,256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let d=P.x; let t=lid.x; let b=wg.y*d;
  var s=0.0; var i=t; loop{ if(i>=d){break;} s=s+x[b+i]*x[b+i]; i=i+256u; }
  sh[t]=s; workgroupBarrier();
  var stride=128u; loop{ if(stride==0u){break;} if(t<stride){ sh[t]=sh[t]+sh[t+stride]; } workgroupBarrier(); stride=stride/2u; }
  let inv=1.0/sqrt(sh[0]/f32(d)+1e-9);
  var j=t; loop{ if(j>=d){break;} o[b+j]=x[b+j]*inv*gamma[j]; j=j+256u; }
}`;
const ROPEK = (theta) => `
@group(0) @binding(0) var<storage,read_write> x: array<f32>;     // [k][stride] in place
@group(0) @binding(1) var<uniform> P: vec4<u32>;                 // nh, hd, basePos, stride (wg.y = row)
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let nh=P.x; let hd=P.y; let pos=f32(P.z+wg.y); let half=hd/2u;
  let id=wg.x*64u+lid.x; if(id>=nh*half){return;}
  let head=id/half; let i=id%half; let base=wg.y*P.w+head*hd;
  let freq=pow(${theta}, -2.0*f32(i)/f32(hd));
  let ang=pos*freq; let c=cos(ang); let s=sin(ang);
  let a=x[base+i]; let b=x[base+i+half];
  x[base+i]=a*c-b*s;
  x[base+i+half]=b*c+a*s;
}`;
const KVQK = (kvd) => `
@group(0) @binding(0) var<storage,read> x: array<f32>;           // [k][kvd]
@group(0) @binding(1) var<storage,read_write> out: array<u32>;
@group(0) @binding(2) var<uniform> P: vec4<u32>;                 // .w = basePos (wg.y = row)
const S: u32 = ${kvd / 8 + kvd / 32}u;
const CW: u32 = ${kvd / 8}u;
const NG: u32 = ${kvd / 32}u;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let base=(P.w+wg.y)*S; let xb=wg.y*${kvd}u; var g=lid.x;
  loop{ if(g>=NG){break;}
    var mx=0.0; for(var i=0u;i<32u;i++){ let a=abs(x[xb+g*32u+i]); if(a>mx){mx=a;} }
    let s=max(mx/7.0, 1e-12);
    out[base+CW+g]=bitcast<u32>(s);
    for(var w=0u;w<4u;w++){
      var word=0u;
      for(var i=0u;i<8u;i++){ let qv=clamp(i32(round(x[xb+g*32u+w*8u+i]/s)),-7,7); word=word|(u32(qv+7)<<(i*4u)); }
      out[base+g*4u+w]=word;
    }
    g=g+64u; }
}`;
// batched-x ternary GEMM: weights read once for all KX rows. o[c*N+n]; optional residual r same layout.
const mmT2KK = (add, KX) => `
@group(0) @binding(0) var<storage,read> x: array<vec4<f32>>;     // [KX][K/4]
@group(0) @binding(1) var<storage,read> qw: array<u32>;
${add
    ? "@group(0) @binding(2) var<storage,read> r: array<f32>;\n@group(0) @binding(3) var<storage,read_write> o: array<f32>;\n@group(0) @binding(4) var<uniform> P: vec4<u32>;"
    : "@group(0) @binding(2) var<storage,read_write> o: array<f32>;\n@group(0) @binding(3) var<uniform> P: vec4<u32>;"}
var<workgroup> red: array<f32, 256>;
${"" /* dot16 via shared fn */}
fn dot16(word:u32, v:u32) -> f32 {
  var s4=vec4<f32>(0.0);
  var x0=x[v];   s4=s4+x0*(vec4<f32>(f32(word&3u),f32((word>>2u)&3u),f32((word>>4u)&3u),f32((word>>6u)&3u))-vec4<f32>(1.0));
  x0=x[v+1u];    s4=s4+x0*(vec4<f32>(f32((word>>8u)&3u),f32((word>>10u)&3u),f32((word>>12u)&3u),f32((word>>14u)&3u))-vec4<f32>(1.0));
  x0=x[v+2u];    s4=s4+x0*(vec4<f32>(f32((word>>16u)&3u),f32((word>>18u)&3u),f32((word>>20u)&3u),f32((word>>22u)&3u))-vec4<f32>(1.0));
  x0=x[v+3u];    s4=s4+x0*(vec4<f32>(f32((word>>24u)&3u),f32((word>>26u)&3u),f32((word>>28u)&3u),f32((word>>30u)&3u))-vec4<f32>(1.0));
  return s4.x+s4.y+s4.z+s4.w;
}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let K=P.x; let nw=K>>4u; let rr=lid.x/64u; let t=lid.x%64u;
  let n0=(wg.y*65535u+wg.x)*4u+rr; let n=min(n0, P.y-1u);
  let rowW=n*nw; var acc: array<f32, ${KX}>;
  for(var c=0u;c<${KX}u;c++){ acc[c]=0.0; }
  var w=t;
  loop{ if(w>=nw){break;}
    let word=qw[rowW+w]; let v=w<<2u;
    ${Array.from({ length: 8 }, (_, c) => `if(${c}u<${KX}u){ acc[${c}]=acc[${c}]+dot16(word, ${c}u*(K>>2u)+v); }`).slice(0, KX).join("\n    ")}
    w=w+64u; }
  for(var c=0u;c<${KX}u;c++){
    red[lid.x]=acc[c]; workgroupBarrier();
    var s=32u; loop{ if(s==0u){break;} if(t<s){ red[rr*64u+t]=red[rr*64u+t]+red[rr*64u+t+s]; } workgroupBarrier(); s=s/2u; }
    if(t==0u && n0<P.y){ o[c*P.y+n0]=red[rr*64u]*bitcast<f32>(P.w)${add ? "+r[c*P.y+n0]" : ""}; }
    workgroupBarrier();
  }
}`;
// t2r batched (per-256-block scales) — binding order mirrors mmT2RKernel: x,qw,sc,(r),o,P
const mmT2RKK = (add, KX) => `
@group(0) @binding(0) var<storage,read> x: array<vec4<f32>>;     // [KX][K/4]
@group(0) @binding(1) var<storage,read> qw: array<u32>;
@group(0) @binding(2) var<storage,read> sc: array<f32>;
${add
    ? "@group(0) @binding(3) var<storage,read> r: array<f32>;\n@group(0) @binding(4) var<storage,read_write> o: array<f32>;\n@group(0) @binding(5) var<uniform> P: vec4<u32>;"
    : "@group(0) @binding(3) var<storage,read_write> o: array<f32>;\n@group(0) @binding(4) var<uniform> P: vec4<u32>;"}
var<workgroup> red: array<f32, 256>;
${t2Dot16}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let K=P.x; let nw=K>>4u; let rr=lid.x/64u; let t=lid.x%64u;
  let n0=(wg.y*65535u+wg.x)*4u+rr; let n=min(n0, P.y-1u);
  let rowW=n*nw; let rowB=n*(K>>8u); var acc: array<f32, ${KX}>;
  for(var c=0u;c<${KX}u;c++){ acc[c]=0.0; }
  var w=t;
  loop{ if(w>=nw){break;}
    let word=qw[rowW+w]; let v=w<<2u; let s=sc[rowB+(w>>4u)];
    ${Array.from({ length: KX }, (_, c) => `acc[${c}]=acc[${c}]+dot16(word, ${c}u*(K>>2u)+v)*s;`).join("\n    ")}
    w=w+64u; }
  for(var c=0u;c<${KX}u;c++){
    red[lid.x]=acc[c]; workgroupBarrier();
    var s2=32u; loop{ if(s2==0u){break;} if(t<s2){ red[rr*64u+t]=red[rr*64u+t]+red[rr*64u+t+s2]; } workgroupBarrier(); s2=s2/2u; }
    if(t==0u && n0<P.y){ o[c*P.y+n0]=red[rr*64u]${add ? "+r[c*P.y+n0]" : ""}; }
    workgroupBarrier();
  }
}`;
// q3f batched (lm_head: logits for all KX window rows, weights read once)
const mmQ3KK = (KX) => `
@group(0) @binding(0) var<storage,read> x: array<f32>;           // [KX][K]
@group(0) @binding(1) var<storage,read> qw: array<u32>;
@group(0) @binding(2) var<storage,read> sc: array<f32>;
@group(0) @binding(3) var<storage,read_write> o: array<f32>;
@group(0) @binding(4) var<uniform> P: vec4<u32>;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let K=P.x; let nblk=P.z; let rr=lid.x/64u; let t=lid.x%64u;
  let n0=(wg.y*65535u+wg.x)*4u+rr; let n=min(n0, P.y-1u);
  let rowB=n*nblk; var acc: array<f32, ${KX}>;
  for(var c=0u;c<${KX}u;c++){ acc[c]=0.0; }
  var blk=t;
  loop{ if(blk>=nblk){break;}
    let bp=(rowB+blk)*3u; let p0=qw[bp]; let p1=qw[bp+1u]; let p2=qw[bp+2u]; let kb=blk<<5u; let sca=sc[rowB+blk];
    for(var c=0u;c<${KX}u;c++){ let xb=c*K+kb; var bacc=0.0;
      for(var j=0u;j<10u;j=j+1u){ bacc=bacc+x[xb+j]*f32(i32((p0>>(j*3u))&7u)-3); }
      for(var j=0u;j<10u;j=j+1u){ bacc=bacc+x[xb+10u+j]*f32(i32((p1>>(j*3u))&7u)-3); }
      for(var j=0u;j<10u;j=j+1u){ bacc=bacc+x[xb+20u+j]*f32(i32((p2>>(j*3u))&7u)-3); }
      let sp=(p0>>30u)|((p1>>30u)<<2u)|((p2>>30u)<<4u);
      bacc=bacc+x[xb+30u]*f32(i32(sp&7u)-3)+x[xb+31u]*f32(i32((sp>>3u)&7u)-3);
      acc[c]=acc[c]+bacc*sca;
    }
    blk=blk+64u;
  }
  for(var c=0u;c<${KX}u;c++){
    red[lid.x]=acc[c]; workgroupBarrier();
    var s=32u; loop{ if(s==0u){break;} if(t<s){ red[rr*64u+t]=red[rr*64u+t]+red[rr*64u+t+s]; } workgroupBarrier(); s=s/2u; }
    if(t==0u && n0<P.y){ o[c*P.y+n0]=red[rr*64u]; }
    workgroupBarrier();
  }
}`;

// ── DP4a integer-dot ternary path (opt-in, spec verify): quantize activations to int8 once, then
// dot4I8Packed the 2-bit weights (unpacked to int8 in-register — weights stay 2-bit on-wire). Bake-off
// measured 2–3.7× vs f32 dot16 at KX=8. Weights t2 only. logit = wscale·ascale[c]·Σ(int8 act · ±1 weight).
// ACTQUANTK: per-32-BLOCK int8 quant (Q8_0-style) of x[m][K] → aq[m][K/4] + scales asc[m][K/32].
// Per-block scales (not one per column) are required for f32 greedy fidelity — one big value can no
// longer crush the whole column into 0. Block b (32 vals) → u32 indices b*8..b*8+7. One thread per block.
const ACTQUANTK = `
@group(0) @binding(0) var<storage,read> x: array<f32>;            // [m][K]
@group(0) @binding(1) var<storage,read_write> aq: array<u32>;     // [m][K/4] int8x4
@group(0) @binding(2) var<storage,read_write> asc: array<f32>;    // [m][K/32]
@group(0) @binding(3) var<uniform> P: vec4<u32>;                  // K
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let K=P.x; let col=wg.y; let base=col*K; let nb=K>>5u; let kq=K>>2u; let t=lid.x;
  var b=t;
  loop{ if(b>=nb){break;}
    let bb=base+b*32u;
    var mx=0.0; for(var i=0u;i<32u;i++){ mx=max(mx, abs(x[bb+i])); }
    let scale=mx/127.0+1e-12; asc[col*nb+b]=scale;
    for(var u=0u;u<8u;u++){ var word=0u;
      for(var q=0u;q<4u;q++){ let val=clamp(i32(round(x[bb+u*4u+q]/scale)),-127,127); word=word|((u32(val)&0xffu)<<(q*8u)); }
      aq[col*kq + b*8u + u]=word; }
    b=b+256u; }
}`;
// mmT2DP4A: batched ternary GEMV via dot4I8Packed with per-block activation scales. Accumulate in f32:
// a 2-bit word (16 acts) is HALF a 32-block → block=w>>1; acc += f32(word_int_dot)·asc[block].
// o[c*N+n] = wscale·Σ_words (blockscale · int_dot) (+ r[c*N+n]).
const mmT2DP4A = (add, KX) => `
@group(0) @binding(0) var<storage,read> aq: array<u32>;           // [KX][K/4] int8x4
@group(0) @binding(1) var<storage,read> qw: array<u32>;           // [N][K/16] 2-bit
@group(0) @binding(2) var<storage,read> asc: array<f32>;          // [KX][K/32]
${add
  ? "@group(0) @binding(3) var<storage,read> r: array<f32>;\n@group(0) @binding(4) var<storage,read_write> o: array<f32>;\n@group(0) @binding(5) var<uniform> P: vec4<u32>;"
  : "@group(0) @binding(3) var<storage,read_write> o: array<f32>;\n@group(0) @binding(4) var<uniform> P: vec4<u32>;"}
var<workgroup> red: array<f32,256>;
fn pk(byte:u32) -> u32 {
  let v0=byte&3u; let v1=(byte>>2u)&3u; let v2=(byte>>4u)&3u; let v3=(byte>>6u)&3u;
  return ((v0-1u)&0xffu)|(((v1-1u)&0xffu)<<8u)|(((v2-1u)&0xffu)<<16u)|(((v3-1u)&0xffu)<<24u);
}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let K=P.x; let nw=K>>4u; let kq=K>>2u; let nb=K>>5u; let rr=lid.x/64u; let t=lid.x%64u;
  let n0=(wg.y*65535u+wg.x)*4u+rr; let n=min(n0,P.y-1u); let rowW=n*nw;
  var acc: array<f32, ${KX}>; for(var c=0u;c<${KX}u;c++){ acc[c]=0.0; }
  var w=t;
  loop{ if(w>=nw){break;}
    let word=qw[rowW+w]; let blk=w>>1u;
    let wi0=pk(word&0xffu); let wi1=pk((word>>8u)&0xffu); let wi2=pk((word>>16u)&0xffu); let wi3=pk((word>>24u)&0xffu);
    ${Array.from({length:KX},(_,c)=>`{ let bz=${c}u*kq + w*4u; let id=dot4I8Packed(wi0,aq[bz])+dot4I8Packed(wi1,aq[bz+1u])+dot4I8Packed(wi2,aq[bz+2u])+dot4I8Packed(wi3,aq[bz+3u]); acc[${c}]=acc[${c}]+f32(id)*asc[${c}u*nb+blk]; }`).join("\n    ")}
    w=w+64u; }
  for(var c=0u;c<${KX}u;c++){
    red[lid.x]=acc[c]; workgroupBarrier();
    var s=32u; loop{ if(s==0u){break;} if(t<s){ red[rr*64u+t]=red[rr*64u+t]+red[rr*64u+t+s]; } workgroupBarrier(); s=s/2u; }
    if(t==0u && n0<P.y){ o[c*P.y+n0]=red[rr*64u]*bitcast<f32>(P.w)${add?"+r[c*P.y+n0]":""}; }
    workgroupBarrier();
  }
}`;

const ROPE = (theta) => `
@group(0) @binding(0) var<storage,read_write> x: array<f32>;     // [nh*hd] in place
@group(0) @binding(1) var<uniform> P: vec4<u32>;                 // nh, hd, pos, _
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3<u32>){
  let nh=P.x; let hd=P.y; let pos=f32(P.z); let half=hd/2u;
  let id=g.x; if(id>=nh*half){return;}
  let head=id/half; let i=id%half; let base=head*hd;
  let freq=pow(${theta}, -2.0*f32(i)/f32(hd));
  let ang=pos*freq; let c=cos(ang); let s=sin(ang);
  let a=x[base+i]; let b=x[base+i+half];
  x[base+i]=a*c-b*s;
  x[base+i+half]=b*c+a*s;
}`;

// One workgroup per head; 64 threads cooperate on scores → softmax → weighted V.
// The score tile is sized to the KV allocation (the old fixed 1024 silently broke ctx > 1024);
// workgroup storage caps this at ~4000 positions (cap·4B + reductions ≤ 16 KB).
const ATTN = (cap) => `
@group(0) @binding(0) var<storage,read> q: array<f32>;           // [nh*hd]
@group(0) @binding(1) var<storage,read> kc: array<f32>;          // [cap*kvdim] position-major
@group(0) @binding(2) var<storage,read> vc: array<f32>;
@group(0) @binding(3) var<storage,read_write> o: array<f32>;     // [nh*hd]
@group(0) @binding(4) var<uniform> P: vec4<u32>;                 // nh, nkv, hd, pos(attend 0..pos)
var<workgroup> sc: array<f32, ${cap}>;                           // score tile = full KV allocation
var<workgroup> red: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let h=wg.x; let nh=P.x; let nkv=P.y; let hd=P.z; let pos=P.w;
  let group=nh/nkv; let kh=h/group; let kvdim=nkv*hd;
  let scale=1.0/sqrt(f32(hd)); let qb=h*hd; let kb=kh*hd; let t=lid.x;
  var j=t; loop{ if(j>pos){break;} var d=0.0; for(var c=0u;c<hd;c++){ d=d+q[qb+c]*kc[j*kvdim+kb+c]; } sc[j]=d*scale; j=j+64u; }
  workgroupBarrier();
  var lm=-1e30; j=t; loop{ if(j>pos){break;} lm=max(lm,sc[j]); j=j+64u; }
  red[t]=lm; workgroupBarrier();
  var s=32u; loop{ if(s==0u){break;} if(t<s){ red[t]=max(red[t],red[t+s]); } workgroupBarrier(); s=s/2u; }
  let mx=red[0]; workgroupBarrier();
  var ld=0.0; j=t; loop{ if(j>pos){break;} let e=exp(sc[j]-mx); sc[j]=e; ld=ld+e; j=j+64u; }
  red[t]=ld; workgroupBarrier();
  s=32u; loop{ if(s==0u){break;} if(t<s){ red[t]=red[t]+red[t+s]; } workgroupBarrier(); s=s/2u; }
  let dn=red[0]; workgroupBarrier();
  var c=t; loop{ if(c>=hd){break;} var acc=0.0; for(var jj=0u;jj<=pos;jj++){ acc=acc+sc[jj]*vc[jj*kvdim+kb+c]; } o[qb+c]=acc/dn; c=c+64u; }
}`;

// ── SPLIT-KV attention (flash-decoding): the single-dispatch ATTN runs ONE workgroup per head
// (20 wgs on a 2B model) with a serial loop over every KV position — occupancy collapses as the
// context grows (measured: 1.9 → 19.5 ms/token from pos≈70 to pos≈420). Split the position axis:
// P1 computes per-TILE partial softmax (tile max, exp-sum, unnormalized V-accum) on a (heads ×
// tiles) grid; P2 combines the ≤cap/TILE partials with the standard max-rescale. Deterministic
// (fixed summation order) — within-engine greedy identity holds on every path via layerBody.
const ATILE = 64;
// P1 v3: SMALL tiles (64 positions) so the tile grid grows with context (occupancy scales) and the
// serial V slab loop inside each workgroup stays short (makespan, not throughput, is what a decode
// attention dispatch pays). THREADS = max(tile, hd): one position per thread in the score phase,
// one channel per thread in the V phase; V staged through shared memory in 8-row slabs (coalesced).
const ATTNP1 = (maxTiles, tile, hdL) => { const TH = Math.max(tile, hdL); return `
@group(0) @binding(0) var<storage,read> q: array<vec4<f32>>;     // [nh*hd/4]
@group(0) @binding(1) var<storage,read> kc: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> vc: array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> pt: array<f32>;    // [nh*${maxTiles}*(hd+2)]
@group(0) @binding(4) var<uniform> P: vec4<u32>;                 // nh, nkv, hd, pos
var<workgroup> e: array<f32, ${tile}>;
var<workgroup> red: array<f32, ${TH}>;
var<workgroup> vsh: array<f32, ${8 * hdL}>;
@compute @workgroup_size(${TH})
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let h=wg.x; let t=wg.y; let nh=P.x; let nkv=P.y; let hd=P.z; let pos=P.w;
  let j0=t*${tile}u;
  let jn=min(pos+1u-j0, ${tile}u);
  let group=nh/nkv; let kh=h/group; let kvd4=(nkv*hd)>>2u;
  let scale=1.0/sqrt(f32(hd)); let qb4=(h*hd)>>2u; let kb4=(kh*hd)>>2u; let tid=lid.x;
  var sc=-1.0e30;
  if(tid<jn){
    var s4=vec4<f32>(0.0);
    let rb=(j0+tid)*kvd4+kb4;
    for(var c=0u;c<(hd>>2u);c++){ s4=s4+q[qb4+c]*kc[rb+c]; }
    sc=(s4.x+s4.y+s4.z+s4.w)*scale;
  }
  if(tid<${tile}u){ e[tid]=sc; }
  red[tid]=sc; workgroupBarrier();
  var s=${TH / 2}u; loop{ if(s==0u){break;} if(tid<s){ red[tid]=max(red[tid],red[tid+s]); } workgroupBarrier(); s=s/2u; }
  let mx=red[0]; workgroupBarrier();
  var ee=0.0; if(tid<jn){ ee=exp(e[tid]-mx); }
  if(tid<${tile}u){ e[tid]=ee; }
  red[tid]=ee; workgroupBarrier();
  s=${TH / 2}u; loop{ if(s==0u){break;} if(tid<s){ red[tid]=red[tid]+red[tid+s]; } workgroupBarrier(); s=s/2u; }
  let sm=red[0];
  var acc=0.0;
  var jc=0u;
  loop{ if(jc>=jn){break;}
    let rows=min(8u, jn-jc);
    workgroupBarrier();
    var idx=tid; loop{ if(idx>=rows*hd){break;} let r=idx/hd; let c=idx%hd; let v4=vc[(j0+jc+r)*kvd4+kb4+(c>>2u)]; vsh[idx]=v4[c&3u]; idx=idx+${TH}u; }
    workgroupBarrier();
    if(tid<hd){ for(var r=0u;r<rows;r++){ acc=acc+e[jc+r]*vsh[r*hd+tid]; } }
    jc=jc+8u;
  }
  let base=(h*${maxTiles}u+t)*(hd+2u);
  if(tid<hd){ pt[base+tid]=acc; }
  if(tid==0u){ pt[base+hd]=mx; pt[base+hd+1u]=sm; }
}`; };
// int4-KV split variant (the SHIPPED Q brain runs kv4:true): same partial-softmax structure over the
// packed int4 records ([codes kvd/8 u32][scales kvd/32 u32] per position). Word-wise K unpack.
const ATTNQP1 = (maxTiles, tile, hdL, kvd) => { const TH = Math.max(tile, hdL); return `
@group(0) @binding(0) var<storage,read> q: array<f32>;           // [nh*hd]
@group(0) @binding(1) var<storage,read> kc: array<u32>;
@group(0) @binding(2) var<storage,read> vc: array<u32>;
@group(0) @binding(3) var<storage,read_write> pt: array<f32>;    // [nh*${maxTiles}*(hd+2)]
@group(0) @binding(4) var<uniform> P: vec4<u32>;                 // nh, nkv, hd, pos
const S: u32 = ${kvd / 8 + kvd / 32}u;
const CW: u32 = ${kvd / 8}u;
var<workgroup> e: array<f32, ${tile}>;
var<workgroup> red: array<f32, ${TH}>;
var<workgroup> vsh: array<f32, ${8 * hdL}>;
fn vval(j:u32, c:u32) -> f32 { let w=vc[j*S+(c>>3u)]; return (f32((w>>((c&7u)*4u))&15u)-7.0)*bitcast<f32>(vc[j*S+CW+(c>>5u)]); }
@compute @workgroup_size(${TH})
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let h=wg.x; let t=wg.y; let nh=P.x; let nkv=P.y; let hd=P.z; let pos=P.w;
  let j0=t*${tile}u;
  let jn=min(pos+1u-j0, ${tile}u);
  let group=nh/nkv; let kh=h/group;
  let scale=1.0/sqrt(f32(hd)); let qb=h*hd; let kb=kh*hd; let tid=lid.x;
  var sc=-1.0e30;
  if(tid<jn){
    let jr=(j0+tid)*S; var dd=0.0;
    for(var w=0u;w<(hd>>3u);w++){                                 // word-wise: 8 codes/u32, scale per 32
      let word=kc[jr+((kb>>3u)+w)]; let sca=bitcast<f32>(kc[jr+CW+((kb>>5u)+(w>>2u))]);
      var ws=0.0;
      for(var i=0u;i<8u;i++){ ws=ws+q[qb+(w<<3u)+i]*(f32((word>>(i*4u))&15u)-7.0); }
      dd=dd+ws*sca;
    }
    sc=dd*scale;
  }
  if(tid<${tile}u){ e[tid]=sc; }
  red[tid]=sc; workgroupBarrier();
  var s=${TH / 2}u; loop{ if(s==0u){break;} if(tid<s){ red[tid]=max(red[tid],red[tid+s]); } workgroupBarrier(); s=s/2u; }
  let mx=red[0]; workgroupBarrier();
  var ee=0.0; if(tid<jn){ ee=exp(e[tid]-mx); }
  if(tid<${tile}u){ e[tid]=ee; }
  red[tid]=ee; workgroupBarrier();
  s=${TH / 2}u; loop{ if(s==0u){break;} if(tid<s){ red[tid]=red[tid]+red[tid+s]; } workgroupBarrier(); s=s/2u; }
  let sm=red[0];
  var acc=0.0;
  var jc=0u;
  loop{ if(jc>=jn){break;}
    let rows=min(8u, jn-jc);
    workgroupBarrier();
    var idx=tid; loop{ if(idx>=rows*hd){break;} let r=idx/hd; let c=idx%hd; vsh[idx]=vval(j0+jc+r, kb+c); idx=idx+${TH}u; }
    workgroupBarrier();
    if(tid<hd){ for(var r=0u;r<rows;r++){ acc=acc+e[jc+r]*vsh[r*hd+tid]; } }
    jc=jc+8u;
  }
  let base=(h*${maxTiles}u+t)*(hd+2u);
  if(tid<hd){ pt[base+tid]=acc; }
  if(tid==0u){ pt[base+hd]=mx; pt[base+hd+1u]=sm; }
}`; };
const ATTNP2 = (maxTiles, tile) => `
@group(0) @binding(0) var<storage,read> pt: array<f32>;
@group(0) @binding(1) var<storage,read_write> o: array<f32>;     // [nh*hd]
@group(0) @binding(2) var<uniform> P: vec4<u32>;                 // nh, nkv, hd, pos
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let h=wg.x; let hd=P.z; let nt=(P.w/${tile}u)+1u; let bh=h*${maxTiles}u*(hd+2u); let tid=lid.x;
  var M=-1e30; for(var t=0u;t<nt;t++){ M=max(M, pt[bh+t*(hd+2u)+hd]); }
  var total=0.0; for(var t=0u;t<nt;t++){ total=total+pt[bh+t*(hd+2u)+hd+1u]*exp(pt[bh+t*(hd+2u)+hd]-M); }
  var c=tid; loop{ if(c>=hd){break;} var acc=0.0; for(var t=0u;t<nt;t++){ acc=acc+pt[bh+t*(hd+2u)+c]*exp(pt[bh+t*(hd+2u)+hd]-M); } o[h*hd+c]=acc/total; c=c+64u; }
}`;

// ── int4 KV cache (E6, measured: ≈0.1 rel-err @4.5 bits, ~6.4× KV memory/traffic) ──
// Layers 1+ store K/V as symmetric int4 (codes nib−7 ∈ [−7,7]) with one f32 scale per 32
// channels; layer 0 stays f32 (measured pathological at low bits). Per-token record in u32s:
// [codes kv_dim/8][scale bits kv_dim/32]. Same attention flow; dequant inline.
const ATTNQ = (cap, kvd) => `
@group(0) @binding(0) var<storage,read> q: array<f32>;
@group(0) @binding(1) var<storage,read> kc: array<u32>;
@group(0) @binding(2) var<storage,read> vc: array<u32>;
@group(0) @binding(3) var<storage,read_write> o: array<f32>;
@group(0) @binding(4) var<uniform> P: vec4<u32>;                 // nh, nkv, hd, pos
var<workgroup> sc: array<f32, ${cap}>;
var<workgroup> red: array<f32, 64>;
const S: u32 = ${kvd / 8 + kvd / 32}u;
const CW: u32 = ${kvd / 8}u;
fn kval(j:u32, c:u32) -> f32 { let w=kc[j*S+(c>>3u)]; return (f32((w>>((c&7u)*4u))&15u)-7.0)*bitcast<f32>(kc[j*S+CW+(c>>5u)]); }
fn vval(j:u32, c:u32) -> f32 { let w=vc[j*S+(c>>3u)]; return (f32((w>>((c&7u)*4u))&15u)-7.0)*bitcast<f32>(vc[j*S+CW+(c>>5u)]); }
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let h=wg.x; let nh=P.x; let nkv=P.y; let hd=P.z; let pos=P.w;
  let group=nh/nkv; let kh=h/group;
  let scale=1.0/sqrt(f32(hd)); let qb=h*hd; let kb=kh*hd; let t=lid.x;
  var j=t; loop{ if(j>pos){break;} var d=0.0; for(var c=0u;c<hd;c++){ d=d+q[qb+c]*kval(j,kb+c); } sc[j]=d*scale; j=j+64u; }
  workgroupBarrier();
  var lm=-1e30; j=t; loop{ if(j>pos){break;} lm=max(lm,sc[j]); j=j+64u; }
  red[t]=lm; workgroupBarrier();
  var s=32u; loop{ if(s==0u){break;} if(t<s){ red[t]=max(red[t],red[t+s]); } workgroupBarrier(); s=s/2u; }
  let mx=red[0]; workgroupBarrier();
  var ld=0.0; j=t; loop{ if(j>pos){break;} let e=exp(sc[j]-mx); sc[j]=e; ld=ld+e; j=j+64u; }
  red[t]=ld; workgroupBarrier();
  s=32u; loop{ if(s==0u){break;} if(t<s){ red[t]=red[t]+red[t+s]; } workgroupBarrier(); s=s/2u; }
  let dn=red[0]; workgroupBarrier();
  var c=t; loop{ if(c>=hd){break;} var acc=0.0; for(var jj=0u;jj<=pos;jj++){ acc=acc+sc[jj]*vval(jj,kb+c); } o[qb+c]=acc/dn; c=c+64u; }
}`;

// quantize+pack ONE token's K or V row into the int4 cache record at position P.w (binds the
// attention uniform — its .w is already the position on every path, step and batched decode)
const KVQ = (kvd) => `
@group(0) @binding(0) var<storage,read> x: array<f32>;
@group(0) @binding(1) var<storage,read_write> out: array<u32>;
@group(0) @binding(2) var<uniform> P: vec4<u32>;                 // .w = pos
const S: u32 = ${kvd / 8 + kvd / 32}u;
const CW: u32 = ${kvd / 8}u;
const NG: u32 = ${kvd / 32}u;
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_id) lid:vec3<u32>){
  let base=P.w*S; var g=lid.x;
  loop{ if(g>=NG){break;}
    var mx=0.0; for(var i=0u;i<32u;i++){ let a=abs(x[g*32u+i]); if(a>mx){mx=a;} }
    let s=max(mx/7.0, 1e-12);
    out[base+CW+g]=bitcast<u32>(s);
    for(var w=0u;w<4u;w++){
      var word=0u;
      for(var i=0u;i<8u;i++){ let qv=clamp(i32(round(x[g*32u+w*8u+i]/s)),-7,7); word=word|(u32(qv+7)<<(i*4u)); }
      out[base+g*4u+w]=word;
    }
    g=g+64u; }
}`;

const SILUMUL = `
@group(0) @binding(0) var<storage,read> gate: array<f32>;
@group(0) @binding(1) var<storage,read> up: array<f32>;
@group(0) @binding(2) var<storage,read_write> o: array<f32>;
@group(0) @binding(3) var<uniform> P: vec4<u32>;                 // ff
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3<u32>){
  let i=g.x; if(i>=P.x){return;}
  let v=gate[i]; o[i]=(v/(1.0+exp(-v)))*up[i];
}`;

const ADD = `
@group(0) @binding(0) var<storage,read> a: array<f32>;
@group(0) @binding(1) var<storage,read> b: array<f32>;
@group(0) @binding(2) var<storage,read_write> o: array<f32>;
@group(0) @binding(3) var<uniform> P: vec4<u32>;                 // n
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3<u32>){ let i=g.x; if(i>=P.x){return;} o[i]=a[i]+b[i]; }`;

// MoE accumulate: o += w · x  (w = router weight, passed as f32 bits in P.y). Sums
// each active expert's contribution into the residual without a separate add.
const AXPY = `
@group(0) @binding(0) var<storage,read_write> o: array<f32>;
@group(0) @binding(1) var<storage,read> x: array<f32>;
@group(0) @binding(2) var<uniform> P: vec4<u32>;                 // n, f32bits(w)
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3<u32>){ let i=g.x; if(i>=P.x){return;} o[i]=o[i]+bitcast<f32>(P.y)*x[i]; }`;

// ── BATCHED-EXPERT MoE kernels (G5c): collapse the per-expert dispatch storm into ONE dispatch per
// stage by looping the nUsed chosen experts INSIDE the kernel, indexing each expert's slab via an
// id table. 640 tiny dispatches/token → ~64. The expert slab is ONE resident buffer (all nExp experts
// contiguous: expert e at u32 offset e·(N·K/8) for q, e·(N·K/32) for f32 scales). q4 decode, verbatim. ──
const MOE_GU = `
@group(0) @binding(0) var<storage,read> x: array<f32>;          // [K=d] shared input (normed2)
@group(0) @binding(1) var<storage,read> qw: array<u32>;         // WHOLE gate|up slab (all experts)
@group(0) @binding(2) var<storage,read> sc: array<f32>;
@group(0) @binding(3) var<storage,read_write> o: array<f32>;    // [nUsed·ff]
@group(0) @binding(4) var<uniform> P: vec4<u32>;                // K=d, ff(rows/expert), nblk=d/32, nUsed
@group(0) @binding(5) var<uniform> idx: array<vec4<u32>,2>;     // chosen expert ids (≤8)
var<workgroup> red: array<f32,64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let r=wg.y*65535u+wg.x; let K=P.x; let ff=P.y; let nblk=P.z; let t=lid.x;
  if(r>=P.w*ff){return;}                                        // row r → expert slot s, local row i
  let s=r/ff; let i=r-s*ff; let e=idx[s>>2u][s&3u];
  let qStride=(ff*K)>>3u; let sStride=(ff*K)>>5u; let words=K>>3u;
  let rowW=e*qStride+i*words; let rowS=e*sStride+i*nblk;
  var acc=0.0; var w=t;
  loop{ if(w>=words){break;} let packed=qw[rowW+w]; let kb=w<<3u; let sca=sc[rowS+(kb>>5u)];
    for(var j=0u;j<8u;j=j+1u){ acc=acc+x[kb+j]*f32(i32((packed>>(j*4u))&0xfu)-8)*sca; } w=w+64u; }
  red[t]=acc; workgroupBarrier();
  var st=32u; loop{ if(st==0u){break;} if(t<st){red[t]=red[t]+red[t+st];} workgroupBarrier(); st=st/2u; }
  if(t==0u){ o[r]=red[0]; }
}`;
const MOE_DN = `
@group(0) @binding(0) var<storage,read> hid: array<f32>;        // [nUsed·ff] (silu(gate)·up per expert)
@group(0) @binding(1) var<storage,read> qw: array<u32>;         // WHOLE down slab
@group(0) @binding(2) var<storage,read> sc: array<f32>;
@group(0) @binding(3) var<storage,read> res: array<f32>;        // residual [N=d]
@group(0) @binding(4) var<storage,read_write> o: array<f32>;    // [N=d] = res + Σ_s w_s·down_s
@group(0) @binding(5) var<uniform> P: vec4<u32>;                // K=ff, N=d, nblk=ff/32, nUsed
@group(0) @binding(6) var<uniform> idx: array<vec4<u32>,2>;
@group(0) @binding(7) var<uniform> wts: array<vec4<f32>,2>;     // router weights
var<workgroup> red: array<f32,64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let n=wg.y*65535u+wg.x; let K=P.x; let N=P.y; let nblk=P.z; let nUsed=P.w; let t=lid.x;
  if(n>=N){return;}
  let qStride=(K*N)>>3u; let sStride=(K*N)>>5u; let words=K>>3u;
  var acc=0.0;
  for(var s=0u;s<nUsed;s=s+1u){                                 // accumulate all chosen experts for row n
    let e=idx[s>>2u][s&3u]; let wv=wts[s>>2u][s&3u]; let hb=s*K;
    let rowW=e*qStride+n*words; let rowS=e*sStride+n*nblk; var ww=t;
    loop{ if(ww>=words){break;} let packed=qw[rowW+ww]; let kb=ww<<3u; let sca=sc[rowS+(kb>>5u)];
      for(var j=0u;j<8u;j=j+1u){ acc=acc+wv*hid[hb+kb+j]*f32(i32((packed>>(j*4u))&0xfu)-8)*sca; } ww=ww+64u; }
  }
  red[t]=acc; workgroupBarrier();
  var st=32u; loop{ if(st==0u){break;} if(t<st){red[t]=red[t]+red[t+st];} workgroupBarrier(); st=st/2u; }
  if(t==0u){ o[n]=red[0]+res[n]; }
}`;

// ── GPU decode head (penalty + argmax ON the GPU): kills the per-token 600 KB logits readback,
// the measured ~13 ms/token queue+readback tax — only the chosen token id (4 B) crosses back. ──
const PENALTY = `
@group(0) @binding(0) var<storage,read_write> l: array<f32>;
@group(0) @binding(1) var<storage,read> ids: array<u32>;
@group(0) @binding(2) var<uniform> P: vec4<u32>;                 // count, f32bits(rp)
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3<u32>){ let i=g.x; if(i>=P.x){return;} let id=ids[i]; let rp=bitcast<f32>(P.y); let v=l[id]; if(v>0.0){ l[id]=v/rp; } else { l[id]=v*rp; } }`;
// two-stage argmax; tie-break = smallest index on equal value (matches the JS first-max scan exactly)
const ARGMAX1 = `
@group(0) @binding(0) var<storage,read> l: array<f32>;
@group(0) @binding(1) var<storage,read_write> o: array<vec2<u32>>; // (f32bits(max), idx) per workgroup
@group(0) @binding(2) var<uniform> P: vec4<u32>;                 // vocab
var<workgroup> wm: array<f32,256>; var<workgroup> wi: array<u32,256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let V=P.x; let t=lid.x; var bm=-3.0e38; var bi=0xffffffffu; var i=wg.x*256u+t;
  loop{ if(i>=V){break;} let v=l[i]; if(v>bm||(v==bm&&i<bi)){bm=v;bi=i;} i=i+65536u; }
  wm[t]=bm; wi[t]=bi; workgroupBarrier();
  var s=128u; loop{ if(s==0u){break;} if(t<s&&(wm[t+s]>wm[t]||(wm[t+s]==wm[t]&&wi[t+s]<wi[t]))){wm[t]=wm[t+s];wi[t]=wi[t+s];} workgroupBarrier(); s=s/2u; }
  if(t==0u){ o[wg.x]=vec2<u32>(bitcast<u32>(wm[0]),wi[0]); }
}`;
const ARGMAX2 = `
@group(0) @binding(0) var<storage,read> c: array<vec2<u32>>;
@group(0) @binding(1) var<storage,read_write> o: array<u32>;
var<workgroup> wm: array<f32,256>; var<workgroup> wi: array<u32,256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid:vec3<u32>){
  let t=lid.x; let e=c[t]; wm[t]=bitcast<f32>(e.x); wi[t]=e.y; workgroupBarrier();
  var s=128u; loop{ if(s==0u){break;} if(t<s&&(wm[t+s]>wm[t]||(wm[t+s]==wm[t]&&wi[t+s]<wi[t]))){wm[t]=wm[t+s];wi[t]=wi[t+s];} workgroupBarrier(); s=s/2u; }
  if(t==0u){ o[0]=wi[0]; }
}`;

// ── E₈ codebook GEMV (2.5 bits/weight): per 8 weights ONE u16 codeword = 8 shape bits into a
// 256×8 |magnitude| LUT (the sealed E₈ codebook, a κ-object) + 8 sign bits; per-32 f16 scale.
// Decode = 1 LUT read + sign-select + fma per weight (~4 ops — cheaper than even q3f) at 0.625×
// q3f's traffic. The LUT rides a storage binding (8 KB, scalar-cache hot). ──
const mmE8Kernel = (add) => `
@group(0) @binding(0) var<storage,read> x: array<f32>;
@group(0) @binding(1) var<storage,read> qw: array<u32>;
@group(0) @binding(2) var<storage,read> sc: array<u32>;
@group(0) @binding(3) var<storage,read> lut: array<f32>;
${add
    ? "@group(0) @binding(4) var<storage,read> r: array<f32>;\n@group(0) @binding(5) var<storage,read_write> o: array<f32>;\n@group(0) @binding(6) var<uniform> P: vec4<u32>;"
    : "@group(0) @binding(4) var<storage,read_write> o: array<f32>;\n@group(0) @binding(5) var<uniform> P: vec4<u32>;"}
var<workgroup> red: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let n=wg.y*65535u+wg.x; let K=P.x; let nblk=P.z; let t=lid.x;
  if(n>=P.y){return;}
  var acc=0.0;
  let rowC=n*nblk*2u; let rowS=n*nblk; var blk=t;
  loop{ if(blk>=nblk){break;}
    let si=rowS+blk; let s2=sc[si>>1u]; let sca=select(unpack2x16float(s2).x, unpack2x16float(s2).y, (si&1u)==1u);
    let kb=blk<<5u; var bacc=0.0;
    for(var c=0u;c<2u;c=c+1u){
      let w2=qw[rowC+blk*2u+c];
      for(var h2=0u;h2<2u;h2=h2+1u){
        let code=(w2>>(h2*16u))&0xffffu; let shp=(code&0xffu)<<3u; let sgn=code>>8u;
        let kk=kb+(c*2u+h2)*8u;
        for(var j=0u;j<8u;j=j+1u){ let mag=lut[shp+j]; bacc=bacc+x[kk+j]*select(mag,-mag,((sgn>>j)&1u)==1u); }
      }
    }
    acc=acc+bacc*sca; blk=blk+64u;
  }
  red[t]=acc; workgroupBarrier();
  var s=32u; loop{ if(s==0u){break;} if(t<s){ red[t]=red[t]+red[t+s]; } workgroupBarrier(); s=s/2u; }
  if(t==0u){ o[P.w + n]=red[0]${add ? "+r[n]" : ""}; }
}`;

// ── BitNet ternary GEMV (2 bits/weight): 16 codes per u32 LSB-first, code∈{0,1,2} ⇒ weight = (code−1)·s
// with ONE f32 per-tensor scale s (BitNet b1.58 trains per-tensor absmean scales — no per-block scales at
// all). s rides the uniform as f32 bits (P.w), so the kernel reads ONLY x + codes: the lightest GEMV in the
// engine (~3 ops/weight, 0.25 B/weight traffic). ──
// Big-geometry q3f GEMV (lm_head: 50-128k vocab × d — the largest single GPU item after the
// ternary wins): the V2 shape (4 rows × 64 lanes / 256-thread wg) applied to the q3f field
// layout. Decode body verbatim from mmKernel's q3f branch. No-add only (logits never add).
const mmQ3BigKernel = (R = 4, L = 64) => `
@group(0) @binding(0) var<storage,read> x: array<f32>;
@group(0) @binding(1) var<storage,read> qw: array<u32>;
@group(0) @binding(2) var<storage,read> sc: array<f32>;
@group(0) @binding(3) var<storage,read_write> o: array<f32>;
@group(0) @binding(4) var<uniform> P: vec4<u32>;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let nblk=P.z; let rr=lid.x/${L}u; let t=lid.x%${L}u;
  let n0=(wg.y*65535u+wg.x)*${R}u+rr; let n=min(n0, P.y-1u);
  let rowB=n*nblk; var acc=0.0; var blk=t;
  loop{ if(blk>=nblk){break;}
    let bp=(rowB+blk)*3u; let p0=qw[bp]; let p1=qw[bp+1u]; let p2=qw[bp+2u]; let kb=blk<<5u; var bacc=0.0;
    for(var j=0u;j<10u;j=j+1u){ bacc=bacc+x[kb+j]*f32(i32((p0>>(j*3u))&7u)-3); }
    for(var j=0u;j<10u;j=j+1u){ bacc=bacc+x[kb+10u+j]*f32(i32((p1>>(j*3u))&7u)-3); }
    for(var j=0u;j<10u;j=j+1u){ bacc=bacc+x[kb+20u+j]*f32(i32((p2>>(j*3u))&7u)-3); }
    let sp=(p0>>30u)|((p1>>30u)<<2u)|((p2>>30u)<<4u);
    bacc=bacc+x[kb+30u]*f32(i32(sp&7u)-3)+x[kb+31u]*f32(i32((sp>>3u)&7u)-3);
    acc=acc+bacc*sc[rowB+blk]; blk=blk+${L}u;
  }
  red[lid.x]=acc; workgroupBarrier();
  var s=${L >> 1}u; loop{ if(s==0u){break;} if(t<s){ red[rr*${L}u+t]=red[rr*${L}u+t]+red[rr*${L}u+t+s]; } workgroupBarrier(); s=s/2u; }
  if(t==0u && n0<P.y){ o[n0]=red[rr*${L}u]; }
}`;

// Geometry-parameterized ternary GEMV: R rows × L lanes per 256-thread workgroup, U-deep unroll.
// Measured (cold-buffer sweep, _bwlab): R4/L64/U1 wins small square shapes; R16/L16/U4 wins the
// big FFN shapes by 1.6-2× (fewer, fatter workgroups — dispatch latency dominates small passes).
const t2Dot16 = `
fn dot16(word:u32, v:u32) -> f32 {
  var s4=vec4<f32>(0.0);
  var x0=x[v];   s4=s4+x0*(vec4<f32>(f32(word&3u),f32((word>>2u)&3u),f32((word>>4u)&3u),f32((word>>6u)&3u))-vec4<f32>(1.0));
  x0=x[v+1u];    s4=s4+x0*(vec4<f32>(f32((word>>8u)&3u),f32((word>>10u)&3u),f32((word>>12u)&3u),f32((word>>14u)&3u))-vec4<f32>(1.0));
  x0=x[v+2u];    s4=s4+x0*(vec4<f32>(f32((word>>16u)&3u),f32((word>>18u)&3u),f32((word>>20u)&3u),f32((word>>22u)&3u))-vec4<f32>(1.0));
  x0=x[v+3u];    s4=s4+x0*(vec4<f32>(f32((word>>24u)&3u),f32((word>>26u)&3u),f32((word>>28u)&3u),f32((word>>30u)&3u))-vec4<f32>(1.0));
  return s4.x+s4.y+s4.z+s4.w;
}`;
const mmT2Kernel = (add, R = 4, L = 64, U = 1) => `
@group(0) @binding(0) var<storage,read> x: array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> qw: array<u32>;
${add
    ? "@group(0) @binding(2) var<storage,read> r: array<f32>;\n@group(0) @binding(3) var<storage,read_write> o: array<f32>;\n@group(0) @binding(4) var<uniform> P: vec4<u32>;"
    : "@group(0) @binding(2) var<storage,read_write> o: array<f32>;\n@group(0) @binding(3) var<uniform> P: vec4<u32>;"}
var<workgroup> red: array<f32, 256>;
${t2Dot16}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let K=P.x; let nw=K>>4u; let rr=lid.x/${L}u; let t=lid.x%${L}u;
  let n0=(wg.y*65535u+wg.x)*${R}u+rr; let n=min(n0, P.y-1u);   // clamp keeps barriers uniform
  let rowW=n*nw; var acc=0.0; var w=t*${U}u;
  loop{ if(w>=nw){break;}
    ${Array.from({ length: U }, (_, u) => `if(w+${u}u<nw){ acc=acc+dot16(qw[rowW+w+${u}u], (w+${u}u)<<2u); }`).join("\n    ")}
    w=w+${L * U}u; }
  red[lid.x]=acc; workgroupBarrier();
  var s=${L >> 1}u; loop{ if(s==0u){break;} if(t<s){ red[rr*${L}u+t]=red[rr*${L}u+t]+red[rr*${L}u+t+s]; } workgroupBarrier(); s=s/2u; }
  if(t==0u && n0<P.y){ o[n0]=red[rr*${L}u]*bitcast<f32>(P.w)${add ? "+r[n0]" : ""}; }
}`;

// Ternary GEMV with PER-256-BLOCK scales (fmt t2r — exact TQ2_0 re-layout for models whose trained
// scale structure is per-row/per-channel, e.g. TriLM): same V2 shape as mmT2Kernel, ONE extra scale
// read per 16 weights (a u32 word never straddles a 256-block). 2.125 bpw traffic.
const mmT2RKernel = (add, R = 4, L = 64, U = 1) => `
@group(0) @binding(0) var<storage,read> x: array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> qw: array<u32>;
@group(0) @binding(2) var<storage,read> sc: array<f32>;
${add
    ? "@group(0) @binding(3) var<storage,read> r: array<f32>;\n@group(0) @binding(4) var<storage,read_write> o: array<f32>;\n@group(0) @binding(5) var<uniform> P: vec4<u32>;"
    : "@group(0) @binding(3) var<storage,read_write> o: array<f32>;\n@group(0) @binding(4) var<uniform> P: vec4<u32>;"}
var<workgroup> red: array<f32, 256>;
${t2Dot16}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let K=P.x; let nw=K>>4u; let rr=lid.x/${L}u; let t=lid.x%${L}u;
  let n0=(wg.y*65535u+wg.x)*${R}u+rr; let n=min(n0, P.y-1u);
  let rowW=n*nw; let rowB=n*(K>>8u); var acc=0.0; var w=t*${U}u;
  loop{ if(w>=nw){break;}
    ${Array.from({ length: U }, (_, u) => `if(w+${u}u<nw){ acc=acc+dot16(qw[rowW+w+${u}u], (w+${u}u)<<2u)*sc[rowB+((w+${u}u)>>4u)]; }`).join("\n    ")}
    w=w+${L * U}u; }
  red[lid.x]=acc; workgroupBarrier();
  var s=${L >> 1}u; loop{ if(s==0u){break;} if(t<s){ red[rr*${L}u+t]=red[rr*${L}u+t]+red[rr*${L}u+t+s]; } workgroupBarrier(); s=s/2u; }
  if(t==0u && n0<P.y){ o[n0]=red[rr*${L}u]${add ? "+r[n0]" : ""}; }
}`;

// Binary GEMV (fmt q1 — Bonsai/PrismML Q1_0 pass-through: sign bits {−1,+1}, LSB-first, one f32
// scale per 128 weights = per 4 u32 words). Same V2 shape as mmT2RKernel: R rows × L lanes × U
// unroll over 32-weight u32 words, vec4 input reads, ONE scale read per word. 1.125 bpw traffic —
// the leanest kernel in the family: unpack is a bare select on each bit.
const mmQ1Kernel = (add, R = 4, L = 64, U = 1) => `
@group(0) @binding(0) var<storage,read> x: array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> qw: array<u32>;
@group(0) @binding(2) var<storage,read> sc: array<f32>;
${add
    ? "@group(0) @binding(3) var<storage,read> r: array<f32>;\n@group(0) @binding(4) var<storage,read_write> o: array<f32>;\n@group(0) @binding(5) var<uniform> P: vec4<u32>;"
    : "@group(0) @binding(3) var<storage,read_write> o: array<f32>;\n@group(0) @binding(4) var<uniform> P: vec4<u32>;"}
var<workgroup> red: array<f32, 256>;
fn dot32(w:u32, xo:u32)->f32{
  var s=0.0;
  for(var j=0u;j<8u;j=j+1u){
    let v=x[xo+j]; let b=w>>(j*4u);
    s=s+select(-v.x,v.x,(b&1u)!=0u)+select(-v.y,v.y,(b&2u)!=0u)+select(-v.z,v.z,(b&4u)!=0u)+select(-v.w,v.w,(b&8u)!=0u);
  }
  return s;
}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let K=P.x; let nw=K>>5u; let rr=lid.x/${L}u; let t=lid.x%${L}u;
  let n0=(wg.y*65535u+wg.x)*${R}u+rr; let n=min(n0, P.y-1u);
  let rowW=n*nw; let rowB=n*(K>>7u); var acc=0.0; var w=t*${U}u;
  loop{ if(w>=nw){break;}
    ${Array.from({ length: U }, (_, u) => `if(w+${u}u<nw){ acc=acc+dot32(qw[rowW+w+${u}u], (w+${u}u)<<3u)*sc[rowB+((w+${u}u)>>2u)]; }`).join("\n    ")}
    w=w+${L * U}u; }
  red[lid.x]=acc; workgroupBarrier();
  var s=${L >> 1}u; loop{ if(s==0u){break;} if(t<s){ red[rr*${L}u+t]=red[rr*${L}u+t]+red[rr*${L}u+t+s]; } workgroupBarrier(); s=s/2u; }
  if(t==0u && n0<P.y){ o[n0]=red[rr*${L}u]${add ? "+r[n0]" : ""}; }
}`;

// Fused ternary QKV/gate-up GEMV: THREE (or two) stacked weight tensors over the same input x in ONE
// pass — rows 0..N1 from qw1 (scale s1), N1..N1+N2 from qw2 (s2), rest from qw3 (s3). Outputs land in
// one concat buffer that downstream passes bind as sub-ranges. Cuts 3 dispatches → 1 (the dispatch/
// encode tax is measured ~35% of wall at 2B scale).
const mmT2FusedKernel = (R = 4, L = 64, U = 1) => `
@group(0) @binding(0) var<storage,read> x: array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> qw1: array<u32>;
@group(0) @binding(2) var<storage,read> qw2: array<u32>;
@group(0) @binding(3) var<storage,read> qw3: array<u32>;
@group(0) @binding(4) var<storage,read_write> o: array<f32>;
@group(0) @binding(5) var<uniform> P: vec4<u32>;                 // K, Ntotal, N1, N2
@group(0) @binding(6) var<uniform> S: vec4<u32>;                 // f32bits(s1), f32bits(s2), f32bits(s3)
var<workgroup> red: array<f32, 256>;
${t2Dot16}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let K=P.x; let nw=K>>4u; let rr=lid.x/${L}u; let t=lid.x%${L}u;
  let n0=(wg.y*65535u+wg.x)*${R}u+rr; let n=min(n0, P.y-1u);
  var rowW=n*nw; var sc=bitcast<f32>(S.x); var src=0u;
  if(n>=P.z+P.w){ rowW=(n-P.z-P.w)*nw; sc=bitcast<f32>(S.z); src=2u; }
  else if(n>=P.z){ rowW=(n-P.z)*nw; sc=bitcast<f32>(S.y); src=1u; }
  var acc=0.0; var w=t*${U}u;
  loop{ if(w>=nw){break;}
    ${Array.from({ length: U }, (_, u) => `if(w+${u}u<nw){ var word=0u; if(src==0u){ word=qw1[rowW+w+${u}u]; } else if(src==1u){ word=qw2[rowW+w+${u}u]; } else { word=qw3[rowW+w+${u}u]; } acc=acc+dot16(word, (w+${u}u)<<2u); }`).join("\n    ")}
    w=w+${L * U}u; }
  red[lid.x]=acc; workgroupBarrier();
  var s=${L >> 1}u; loop{ if(s==0u){break;} if(t<s){ red[rr*${L}u+t]=red[rr*${L}u+t]+red[rr*${L}u+t+s]; } workgroupBarrier(); s=s/2u; }
  if(t==0u && n0<P.y){ o[n0]=red[rr*${L}u]*sc; }
}`;

// Fused act+down GEMV: w_down whose input is computed ON THE FLY as relu(gate)²·up (or silu·up) from
// the concat gate‖up buffer — kills the separate activation pass AND the hid round-trip.
const mmT2ActAddKernel = (relu2) => `
@group(0) @binding(0) var<storage,read> gu: array<vec4<f32>>;    // [gate(ff) ‖ up(ff)]
@group(0) @binding(1) var<storage,read> qw: array<u32>;
@group(0) @binding(2) var<storage,read> r: array<f32>;
@group(0) @binding(3) var<storage,read_write> o: array<f32>;
@group(0) @binding(4) var<uniform> P: vec4<u32>;                 // K(=ff), N, ff/4 (vec4 offset of up), f32bits(s)
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let K=P.x; let nw=K>>4u; let rr=lid.x>>6u; let t=lid.x&63u;
  let n0=(wg.y*65535u+wg.x)*4u+rr; let n=min(n0, P.y-1u);
  let rowW=n*nw; let uo=P.z; var acc=0.0; var w=t;
  loop{ if(w>=nw){break;}
    let word=qw[rowW+w]; let v=w<<2u;
    var s4=vec4<f32>(0.0);
    for(var c=0u;c<4u;c=c+1u){
      let g4=gu[v+c]; let u4=gu[uo+v+c];
      ${relu2 ? "let a4=max(g4,vec4<f32>(0.0)); let x0=a4*a4*u4;" : "let x0=(g4/(vec4<f32>(1.0)+exp(-g4)))*u4;"}
      let sh=c*8u;
      s4=s4+x0*(vec4<f32>(f32((word>>(sh*1u))&3u),f32((word>>(sh+2u))&3u),f32((word>>(sh+4u))&3u),f32((word>>(sh+6u))&3u))-vec4<f32>(1.0));
    }
    acc=acc+s4.x+s4.y+s4.z+s4.w;
    w=w+64u; }
  red[lid.x]=acc; workgroupBarrier();
  var s=32u; loop{ if(s==0u){break;} if(t<s){ red[rr*64u+t]=red[rr*64u+t]+red[rr*64u+t+s]; } workgroupBarrier(); s=s/2u; }
  if(t==0u && n0<P.y){ o[n0]=red[rr*64u]*bitcast<f32>(P.w)+r[n0]; }
}`;

// Fused RoPE: q and k rotated in ONE pass (k heads tail the grid).
const ROPE2 = (theta) => `
@group(0) @binding(0) var<storage,read_write> q: array<f32>;
@group(0) @binding(1) var<storage,read_write> k: array<f32>;
@group(0) @binding(2) var<uniform> P: vec4<u32>;                 // nh, hd, pos, nkv
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3<u32>){
  let nh=P.x; let hd=P.y; let pos=f32(P.z); let nkv=P.w; let half=hd/2u;
  let id=g.x; if(id>=(nh+nkv)*half){return;}
  let head=id/half; let i=id%half;
  let freq=pow(${theta}, -2.0*f32(i)/f32(hd));
  let ang=pos*freq; let c=cos(ang); let s=sin(ang);
  if(head<nh){
    let base=head*hd;
    let a=q[base+i]; let b=q[base+i+half];
    q[base+i]=a*c-b*s; q[base+i+half]=b*c+a*s;
  } else {
    let base=(head-nh)*hd;
    let a=k[base+i]; let b=k[base+i+half];
    k[base+i]=a*c-b*s; k[base+i+half]=b*c+a*s;
  }
}`;

// Fused activation + sub-norm (BitNet FFN): h = act(gate)·up, then RMSNorm(h)·gamma — one pass over
// the concat gate‖up buffer instead of act-pass + rms-pass (+ the hid round-trip). Single workgroup
// like RMS; each thread re-reads only its own writes (no cross-thread aliasing).
const ACTNORM = (relu2) => `
@group(0) @binding(0) var<storage,read> gu: array<f32>;          // [gate(ff) ‖ up(ff)]
@group(0) @binding(1) var<storage,read> gamma: array<f32>;
@group(0) @binding(2) var<storage,read_write> o: array<f32>;
@group(0) @binding(3) var<uniform> P: vec4<u32>;                 // ff
var<workgroup> sh: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid:vec3<u32>){
  let ff=P.x; let t=lid.x;
  var ss=0.0;
  var j=t; loop{ if(j>=ff){break;}
    let g=gu[j]; let u=gu[ff+j];
    ${relu2 ? "let a=max(g,0.0); let h=a*a*u;" : "let h=(g/(1.0+exp(-g)))*u;"}
    o[j]=h; ss=ss+h*h; j=j+256u; }
  sh[t]=ss; workgroupBarrier();
  var s=128u; loop{ if(s==0u){break;} if(t<s){ sh[t]=sh[t]+sh[t+s]; } workgroupBarrier(); s=s/2u; }
  let inv=1.0/sqrt(sh[0]/f32(ff)+1e-9);
  j=t; loop{ if(j>=ff){break;} o[j]=o[j]*inv*gamma[j]; j=j+256u; }
}`;

// BitNet FFN activation: h = relu(gate)² ⊙ up (squared ReLU — b1.58 2B4T uses this instead of SiLU)
const RELU2MUL = `
@group(0) @binding(0) var<storage,read> gate: array<f32>;
@group(0) @binding(1) var<storage,read> up: array<f32>;
@group(0) @binding(2) var<storage,read_write> o: array<f32>;
@group(0) @binding(3) var<uniform> P: vec4<u32>;                 // ff
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3<u32>){
  let i=g.x; if(i>=P.x){return;}
  let v=max(gate[i],0.0); o[i]=v*v*up[i];
}`;

// batched decode: embed lookup ON the GPU (token id read from the seq ring) → B.x, no CPU per token
const EMBED = (bits, q3f) => `
@group(0) @binding(0) var<storage,read> ring: array<u32>;
@group(0) @binding(1) var<storage,read> eq: array<u32>;
@group(0) @binding(2) var<storage,read> es: array<f32>;
@group(0) @binding(3) var<storage,read_write> x: array<f32>;
@group(0) @binding(4) var<uniform> P: vec4<u32>;                 // ringIdx, d
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g:vec3<u32>){
  let i=g.x; let d=P.y; if(i>=d){return;} let tok=ring[P.x]; let sb=tok*(d/32u)+(i>>5u);
${bits === 3 && q3f ? `  let bp=sb*3u; let j=i&31u; var q:u32;
  if(j<10u){ q=(eq[bp]>>(j*3u))&7u; } else if(j<20u){ q=(eq[bp+1u]>>((j-10u)*3u))&7u; } else if(j<30u){ q=(eq[bp+2u]>>((j-20u)*3u))&7u; }
  else { let sp=(eq[bp]>>30u)|((eq[bp+1u]>>30u)<<2u)|((eq[bp+2u]>>30u)<<4u); if(j==30u){ q=sp&7u; } else { q=(sp>>3u)&7u; } }
  x[i]=f32(i32(q)-3)*es[sb];`
  : bits === 4 ? `  let gg=tok*d+i; let nib=(eq[gg>>3u]>>((gg&7u)*4u))&0xfu; x[i]=f32(i32(nib)-8)*es[sb];`
  : bits === 1 ? `  let gg=tok*d+i; let bit=(eq[gg>>5u]>>(gg&31u))&1u; x[i]=select(-1.0,1.0,bit==1u)*es[gg>>7u];`
  : `  let gg=tok*d+i; let b=(eq[gg>>2u]>>((gg&3u)*8u))&0xffu; x[i]=f32(i32(b<<24u)>>24u)*es[sb];`}
}`;
// dedup-aware repetition penalty over the ring's last-64 window (exact Set semantics: first occurrence only)
const PENALTY2 = `
@group(0) @binding(0) var<storage,read_write> l: array<f32>;
@group(0) @binding(1) var<storage,read> ring: array<u32>;
@group(0) @binding(2) var<uniform> P: vec4<u32>;                 // seqLen, f32bits(rp)
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3<u32>){
  let t=g.x; let n=P.x; if(t>=min(64u,n)){return;} let id=ring[n-1u-t];
  for(var j=0u;j<t;j=j+1u){ if(ring[n-1u-j]==id){return;} }
  let rp=bitcast<f32>(P.y); let v=l[id]; if(v>0.0){ l[id]=v/rp; } else { l[id]=v*rp; }
}`;
const APPEND = `
@group(0) @binding(0) var<storage,read_write> ring: array<u32>;
@group(0) @binding(1) var<storage,read> w: array<u32>;
@group(0) @binding(2) var<uniform> P: vec4<u32>;                 // ringIdx
@compute @workgroup_size(1)
fn main(){ ring[P.x]=w[0]; }`;

// f32 KV-cache save as a KERNEL (not copyBufferToBuffer) so the whole token can run inside ONE
// compute pass (a copy would force a pass break — pass boundaries are the measured dispatch tax).
// Fused variant reads the packed qkv buffer at compile-time offsets; split variant reads B.k/B.v.
const KVSAVE_F = (qOff, kvd) => `
@group(0) @binding(0) var<storage,read> src: array<f32>;         // B.qkv [q|k|v]
@group(0) @binding(1) var<storage,read_write> kc: array<f32>;
@group(0) @binding(2) var<storage,read_write> vc: array<f32>;
@group(0) @binding(3) var<uniform> P: vec4<u32>;                 // .w = pos (the attn uniform)
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3<u32>){
  let i=g.x; if(i>=${kvd}u){return;}
  kc[P.w*${kvd}u+i]=src[${qOff}u+i];
  vc[P.w*${kvd}u+i]=src[${qOff + kvd}u+i];
}`;
const KVSAVE_S = (kvd) => `
@group(0) @binding(0) var<storage,read> k: array<f32>;
@group(0) @binding(1) var<storage,read> v: array<f32>;
@group(0) @binding(2) var<storage,read_write> kc: array<f32>;
@group(0) @binding(3) var<storage,read_write> vc: array<f32>;
@group(0) @binding(4) var<uniform> P: vec4<u32>;                 // .w = pos
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g:vec3<u32>){
  let i=g.x; if(i>=${kvd}u){return;}
  kc[P.w*${kvd}u+i]=k[i];
  vc[P.w*${kvd}u+i]=v[i];
}`;


// ── DIFFUSION KERNELS (Dream-class mask-denoising; bidirectional attention over a resident batch) ──
// The causal flag (P.w bit 31) exists ONLY as the parity gate: causal diffuse(block=1) must equal
// the sequential engine token-for-token, which validates every other pass; Dream runs bidirectional.
const ATTNB = (maxN) => `
@group(0) @binding(0) var<storage,read> q: array<f32>;
@group(0) @binding(1) var<storage,read> k: array<f32>;
@group(0) @binding(2) var<storage,read> v: array<f32>;
@group(0) @binding(3) var<storage,read_write> o: array<f32>;
@group(0) @binding(4) var<uniform> P: vec4<u32>;                 // nh, nkv, hd, n | causal<<31
var<workgroup> sc: array<f32, ${maxN}>;
var<workgroup> red: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let h=wg.x; let i=wg.y; let nh=P.x; let nkv=P.y; let hd=P.z;
  let n=P.w&0x7fffffffu; let lim=select(n-1u, i, (P.w>>31u)==1u);
  let group=nh/nkv; let kh=h/group; let kvd=nkv*hd; let qd=nh*hd;
  let scale=1.0/sqrt(f32(hd)); let qb=i*qd+h*hd; let kb=kh*hd; let t=lid.x;
  var j=t; loop{ if(j>lim){break;} var dd=0.0; for(var c=0u;c<hd;c++){ dd=dd+q[qb+c]*k[j*kvd+kb+c]; } sc[j]=dd*scale; j=j+64u; }
  workgroupBarrier();
  var lm=-1e30; j=t; loop{ if(j>lim){break;} lm=max(lm,sc[j]); j=j+64u; }
  red[t]=lm; workgroupBarrier();
  var st=32u; loop{ if(st==0u){break;} if(t<st){ red[t]=max(red[t],red[t+st]); } workgroupBarrier(); st=st/2u; }
  let mx=red[0]; workgroupBarrier();
  var ld=0.0; j=t; loop{ if(j>lim){break;} let e=exp(sc[j]-mx); sc[j]=e; ld=ld+e; j=j+64u; }
  red[t]=ld; workgroupBarrier();
  st=32u; loop{ if(st==0u){break;} if(t<st){ red[t]=red[t]+red[t+st]; } workgroupBarrier(); st=st/2u; }
  let dn=red[0]; workgroupBarrier();
  var c=t; loop{ if(c>=hd){break;} var acc=0.0; for(var jj=0u;jj<=lim;jj++){ acc=acc+sc[jj]*v[jj*kvd+kb+c]; } o[qb+c]=acc/dn; c=c+64u; }
}`;
const BIASK = `
@group(0) @binding(0) var<storage,read_write> o: array<f32>;     // [rows][N]
@group(0) @binding(1) var<storage,read> bias: array<f32>;        // [N]
@group(0) @binding(2) var<uniform> P: vec4<u32>;                 // N (wg.y = row)
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg:vec3<u32>, @builtin(local_invocation_id) lid:vec3<u32>){
  let i=wg.x*64u+lid.x; if(i>=P.x){return;}
  o[wg.y*P.x+i]=o[wg.y*P.x+i]+bias[i];
}`;
const fbits = (f) => new Uint32Array(new Float32Array([f]).buffer)[0];
const s8 = (b) => (b << 24) >> 24;

// STREAMING constructor: `manifest` is the parsed dims+tensor list; `fetchTensor(name)`
// returns ONE tensor's bytes ([q][f32 scales] or [f32]) on demand. The converted
// ~1 GB of weights is never held whole in wasm — each tensor is fetched, uploaded
// to the GPU, then freed — so 1.7 B+ fits under the wasm memory ceiling.
// ── OPFS frame store: the model's frames live on DISK, paged in on demand ──
// Converts once (downloads + dequant), writes every frame to a single OPFS file
// keyed by content, and persists it. On later loads, if the file already exists
// at the right size, conversion is SKIPPED — the model is read straight off disk.
// This is the RAM-wall break: the bytes never sit in JS heap; only the slice
// being played touches RAM (the browser's own page cache is the bounded cache).
async function openFrameStore(key, totalBytes) {
  const root = await navigator.storage.getDirectory();
  const fh = await root.getFileHandle(key, { create: true });
  let file = await fh.getFile();
  const ready = file.size === totalBytes;                  // already converted + on disk?
  return {
    ready, fh, file,
    async beginWrite() { this._w = await fh.createWritable(); },
    async write(pos, bytes) { await this._w.write({ type: "write", position: pos, data: bytes }); },
    async endWrite() { await this._w.close(); this.file = await fh.getFile(); },
    async read(off, len) { return new Uint8Array(await this.file.slice(off, off + len).arrayBuffer()); },
  };
}

export async function createQvacGPU(manifest, fetchTensor, cap = 64, eos = 2, stream = false, onProgress = null, frameStore = null, cacheBudget = 0) {
  if (!navigator.gpu) throw new Error("no WebGPU");
  const prog = (done, total, label) => { try { onProgress && onProgress(done, total, label); } catch {} };
  // ── cold-load phase timing (near-zero cost; read via window.__qvacLoadStats) ──
  // The resident weight upload was the one serialized stretch of cold boot: each tensor's
  // fetch+gunzip (parts) blocked the next before its GPU write even ran. QLOAD lets a bench
  // A/B the SAME code path at conc=1 (old serial behaviour) vs conc>1 (overlapped) and see the
  // fetch/gunzip-vs-GPU-write split, so we optimize the half that actually costs.
  const _now = () => (globalThis.performance ? performance.now() : 0);
  const QLOAD = { residentMs: 0, partsMs: 0, gpuMs: 0, nTensors: 0, conc: 0 };
  const tmap = {}; for (const t of manifest.tensors) tmap[t.name] = t;
  const { d, n_heads, n_kv_heads, ff, vocab, n_layers, hd } = manifest;
  const bits = manifest.bits || 8;
  const q3f = bits === 3 && manifest.layout === "q3f";             // Q3 FIELD layout (10×3-bit/u32 + spare stubs): ~½ the unpack ALU of bit-planes, same 12 B/block
  const kv_dim = n_kv_heads * hd;
  const ropeBase = manifest.rope_base || 10000;                    // Llama 10000, Qwen2/3 1e6
  const ropeLit = Number.isInteger(ropeBase) ? ropeBase + ".0" : "" + ropeBase;
  const attnBias = !!manifest.attn_bias;                           // Qwen2 has q/k/v bias
  const qkNorm = !!manifest.qk_norm;                               // Qwen3/OLMoE have q/k RMSNorm
  const qkFull = qkNorm && manifest.qk_norm_dim === d;             // OLMoE: RMSNorm over the FULL q/k vector (not per-head)
  const subNorm = !!manifest.sub_norm;                             // BitNet: RMSNorm before wo (attn_sub_norm) + before w_down (ffn_sub_norm)
  const bitlinear = !!manifest.bitlinear;                          // HF-BitNet (BitLinear): WEIGHTLESS RMSNorm on the input of EVERY ternary linear (qkv/wo/gate-up/down)
  const relu2 = manifest.ffn_act === "relu2";                      // BitNet: squared-ReLU gated FFN (else SiLU)
  const moe = !!manifest.moe;                                      // mixture-of-experts (router + per-token expert subset)
  const nExp = moe ? manifest.moe.n_experts : 0, nUsed = moe ? manifest.moe.n_used : 0;
  const remote = stream === "remote";                             // "remote": packed layers stream from a served .qvf via HTTP Range (bound by disk, not RAM/quota)
  const opfs = stream === "opfs" || remote;                        // both use the packed-layer disk path; only the store differs
  const frameGran = stream === "frame";                            // legacy: play ONE matrix at a time (JS, per-matrix)
  stream = !!stream; let streamBuf = 0;                            // streamBuf = the streamed-weight working set
  // NATIVE 2-bit (ADR-0054): weights re-quantized to incoherent 2-bit at load, matmuls read 2-bit DIRECTLY
  // on the GPU + a per-matmul input Hadamard. Resident-dense only for now (streaming/MoE keep Q8/Q4).
  const twoBit = !!manifest.twoBit && !stream && !moe && !frameGran;
  const rotate = twoBit && manifest.incoherent !== false;   // incoherence path rotates inputs; LDLQ κ-objects (incoherent:false) do not
  const preQuant = twoBit && !!manifest.preQuantized;        // load-direct: weights arrive ALREADY 2-bit (compiled offline) — no re-quant at load
  const nextP2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };
  const maxKp = rotate ? nextP2(Math.max(d, ff, kv_dim, n_heads * hd)) : 0;
  const qlenOf = (t) => bits === 1 ? (t.N * t.K) / 8 : bits === 3 ? (t.N * (t.K / 32)) * 12 : bits === 4 ? (t.N * t.K) / 2 : t.N * t.K;   // Q3 = 3 u32 (12 bytes) per 32-block; q1 = 1 sign bit/weight
  const slenOf = (t) => bits === 1 ? t.N * (t.K / 128) * 4 : t.N * (t.K / 32) * 4;   // q1: one f32 scale per 128-weight block

  const adapter = await navigator.gpu.requestAdapter();
  // Big-vocab models (Qwen: 151 k × d int8 ≈ 136 MB) exceed the default 128 MB
  // storage-buffer binding limit — request the adapter's max so the bind succeeds.
  const L = adapter.limits;
  const canTs = adapter.features.has("timestamp-query");   // per-pass GPU profiling (dev: window.__profile)
  const dev = await adapter.requestDevice({
    requiredFeatures: canTs ? ["timestamp-query"] : [],
    requiredLimits: {
      maxStorageBufferBindingSize: L.maxStorageBufferBindingSize,
      maxBufferSize: L.maxBufferSize,
      maxComputeWorkgroupsPerDimension: L.maxComputeWorkgroupsPerDimension,
    },
  });
  // track total GPU memory allocated (weights + KV cache + scratch) so the system
  // monitor can show — and free — exactly what this model holds on the GPU.
  let gpuBytes = 0;
  const _createBuffer = dev.createBuffer.bind(dev);
  dev.createBuffer = (desc) => { gpuBytes += desc.size || 0; return _createBuffer(desc); };
  const U = GPUBufferUsage;
  let pid = 0;
  const pipe = (code, name) => { const p = dev.createComputePipeline({ layout: "auto", compute: { module: dev.createShaderModule({ code }), entryPoint: "main" } }); p._id = ++pid; p._name = name || "p" + pid; return p; };
  if (cap > 4000) throw new Error("cap " + cap + " exceeds the attention score tile (workgroup storage)");
  const kv4 = !!manifest.kv4 && !stream && !moe && !frameGran;     // int4 KV cache for layers 1+ (E6)
  const P_mm = pipe(mmKernel(twoBit ? 2 : bits, false, q3f), "mm"), P_mmadd = pipe(mmKernel(twoBit ? 2 : bits, true, q3f), "mmadd"), P_rms = pipe(RMS, "rms"), P_rope = pipe(ROPE(ropeLit), "rope"), P_attn = pipe(ATTN(cap), "attn"), P_sm = pipe(relu2 ? RELU2MUL : SILUMUL, relu2 ? "relu2" : "silu"), P_qkn = pipe(QKNORM, "qkn");
  const P_attnQ = kv4 ? pipe(ATTNQ(cap, kv_dim), "attnQ") : null, P_kvq = kv4 ? pipe(KVQ(kv_dim), "kvq") : null;
  const P_fwL = twoBit ? pipe(FWHT_LOAD, "fwht") : null, P_fwB = twoBit ? pipe(FWHT_BFLY, "fwht") : null, P_fwN = twoBit ? pipe(FWHT_NORM, "fwht") : null;
  const P_axpy = moe ? pipe(AXPY, "axpy") : null;
  const moeBatch = moe && !frameStore;                                  // resident κ-object MoE → batched-expert kernels
  const P_moeGU = moeBatch ? pipe(MOE_GU, "moeGU") : null, P_moeDn = moeBatch ? pipe(MOE_DN, "moeDn") : null;
  // E₈ codebook tensors (fmt e8q): own pipelines + the sealed 256×8 LUT as a GPU buffer
  const hasE8 = manifest.tensors.some((t) => t.fmt === "e8q");
  const P_mmE8 = hasE8 ? pipe(mmE8Kernel(false), "mmE8") : null, P_mmE8add = hasE8 ? pipe(mmE8Kernel(true), "mmE8add") : null;
  // BitNet ternary tensors (fmt t2): own pipelines; per-tensor scale rides each weight-set's uniform
  const hasT2 = manifest.tensors.some((t) => t.fmt === "t2");
  const P_mmT2 = hasT2 ? pipe(mmT2Kernel(false), "mmT2") : null, P_mmT2add = hasT2 ? pipe(mmT2Kernel(true), "mmT2add") : null;
  const hasT2R = manifest.tensors.some((t) => t.fmt === "t2r");
  const P_mmT2R = hasT2R ? pipe(mmT2RKernel(false), "mmT2R") : null, P_mmT2Radd = hasT2R ? pipe(mmT2RKernel(true), "mmT2Radd") : null;
  // Bonsai binary tensors (fmt q1): own pipelines; per-128-block f32 scale buffer
  const hasQ1 = manifest.tensors.some((t) => t.fmt === "q1");
  const P_mmQ1 = hasQ1 ? pipe(mmQ1Kernel(false), "mmQ1") : null, P_mmQ1add = hasQ1 ? pipe(mmQ1Kernel(true), "mmQ1add") : null;
  // big-tensor geometry (≥16M weights): 16 rows × 16 lanes × unroll-4 — measured 1.6-2× on FFN shapes
  const T2BIG = 16e6;
  const P_mmQ3B = bits === 3 && q3f ? pipe(mmQ3BigKernel(), "mmQ3B") : null;   // big q3f (lm_head)
  const P_mmT2B = hasT2 ? pipe(mmT2Kernel(false, 16, 16, 4), "mmT2B") : null, P_mmT2Badd = hasT2 ? pipe(mmT2Kernel(true, 16, 16, 4), "mmT2Badd") : null;
  const P_mmT2RB = hasT2R ? pipe(mmT2RKernel(false, 16, 16, 4), "mmT2RB") : null, P_mmT2RBadd = hasT2R ? pipe(mmT2RKernel(true, 16, 16, 4), "mmT2RBadd") : null;
  const P_mmQ1B = hasQ1 ? pipe(mmQ1Kernel(false, 16, 16, 4), "mmQ1B") : null, P_mmQ1Badd = hasQ1 ? pipe(mmQ1Kernel(true, 16, 16, 4), "mmQ1Badd") : null;
  // DRAFT: dense sub-norm (BitNet) STREAMING is enabled — the unfused layerBody applies attn/ffn sub-norm
  // (rms over the resident Nrm weights) with ws(role) from R[role], and mmW dispatches t2 (Falcon-E proves it);
  // combined with the t2 stream packing (t2stream), dense sub-norm streams. MoE sub-norm stays resident-only.
  if (subNorm && manifest.moe) throw new Error("bitnet sub-norm MoE path is resident-only for now");
  // fused ternary layer (resident only): qkv 3→1 pass, gate/up 2→1, both ropes 1, act⊕sub-norm 1
  // measured policy (A/B walls, 5-run medians): fusion wins on the sub-norm (BitNet) family
  // (12.3 vs 13.2 ms/tok on bitnet-2b) and LOSES on llama-arch ternary (24.5 vs 19.5 on
  // falcon-e-3b — t2ad recomputes act per workgroup; short-K shapes punish the stacked t2f).
  const fusedT2 = !globalThis.__noFuse && hasT2 && subNorm && !stream && !moe && !frameGran;
  const P_t2f = fusedT2 ? pipe(mmT2FusedKernel(), "t2f") : null;
  const P_t2fB = fusedT2 ? pipe(mmT2FusedKernel(16, 16, 4), "t2fB") : null;   // big-geometry for the gate/up fusion
  const P_rope2 = fusedT2 ? pipe(ROPE2(ropeLit), "rope2") : null;
  const P_actn = fusedT2 && subNorm ? pipe(ACTNORM(relu2), "actn") : null;
  const P_t2ad = fusedT2 && !subNorm ? pipe(mmT2ActAddKernel(relu2), "t2ad") : null;
  let lutBuf = null;
  if (hasE8) {
    const lu = manifest.e8lutData; if (!lu || lu.length !== 2048) throw new Error("e8q tensors but no/bad e8lutData (need 256×8 f32)");
    lutBuf = dev.createBuffer({ size: lu.byteLength, usage: U.STORAGE | U.COPY_DST }); dev.queue.writeBuffer(lutBuf, 0, lu);
  }
  // ── per-pass GPU timestamps (dev-only; armed per-step by window.__profile, zero cost when off) ──
  let PROF = null;
  const profInit = () => { if (PROF || !canTs) return; PROF = { qs: dev.createQuerySet({ type: "timestamp", count: 4096 }), buf: dev.createBuffer({ size: 4096 * 8, usage: U.QUERY_RESOLVE | U.COPY_SRC }), stg: dev.createBuffer({ size: 4096 * 8, usage: U.MAP_READ | U.COPY_DST }), i: 0, tags: [], active: false }; };

  const sbuf = (n) => dev.createBuffer({ size: Math.max(16, n * 4), usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
  const ubuf = (arr) => { const b = dev.createBuffer({ size: 16, usage: U.UNIFORM | U.COPY_DST }); dev.queue.writeBuffer(b, 0, arr); return b; };

  // ── weights → GPU ──
  // Resident: every layer's matrices get their own GPU buffer (all live on-GPU).
  // Stream (store-as-memory): keep the layer matrices in JS and page each layer
  // into ONE reusable buffer set per token — only the working set (1 layer) is
  // ever GPU-resident, so GPU memory is O(1 layer), not O(depth).
  // MoE packs only the attention matrices per layer; the FFN is per-expert frames
  // streamed on demand. Dense packs attention + the FFN trio.
  const ROLES = moe ? ["wq", "wk", "wv", "wo"] : ["wq", "wk", "wv", "wo", "w_gate", "w_up", "w_down"];
  const W = {}, Wb = {}, R = {}, FB = {};
  let RM = null, RMscale = null;                            // single reusable "frame" buffer (frame mode)
  const padQ = (q) => { if (q.length % 4) { const p = new Uint8Array(Math.ceil(q.length / 4) * 4); p.set(q); return p; } return q; };
  // fetchTensor may be sync (wasm) or async (disk-streamed ingestion); `await`
  // handles both (await on a plain value returns it). So all of setup is async.
  const parts = async (name) => {
    const t = tmap[name], bytes = await fetchTensor(name);
    if (t.fmt === "e8q") {                                  // E₈ codebook tensor: [u16 codewords N·K/4 B (4 u16 per 32 weights)][f16 scales N·K/16 B]
      const ql = t.N * t.K / 4;
      return { q: padQ(bytes.subarray(0, ql)), sRaw: bytes.subarray(ql).slice(), N: t.N, K: t.K, e8: true };
    }
    if (t.fmt === "t2r") {                                  // ternary + per-256-block f32 scales (blob = [codes][scales])
      const ql = t.N * t.K / 4;
      const lim = Math.min(ql, 65536);
      for (let i = 0; i < lim; i++) { const b = bytes[i]; if ((b & 3) === 3 || ((b >> 2) & 3) === 3 || ((b >> 4) & 3) === 3 || (b >> 6) === 3) throw new Error(`t2r alphabet violation in ${name} @byte ${i}`); }
      return { q: bytes.subarray(0, ql), sRaw: bytes.subarray(ql).slice(), N: t.N, K: t.K, t2r: true };
    }
    if (t.fmt === "q1") {                                   // binary ±1 (Bonsai Q1_0): blob = [signs N·K/8 B][f32 scales N·K/128·4 B]
      const ql = t.N * t.K / 8;
      return { q: bytes.subarray(0, ql), sRaw: bytes.subarray(ql).slice(), N: t.N, K: t.K, q1: true };
    }
    if (t.fmt === "t2") {                                   // ternary: blob = codes only; scale lives in the manifest rec
      // geometric validity (Law L5 beyond bytes): ternary fields must decode in {0,1,2} — sampled
      // 64 KB/tensor at load; the full-census proof is the sealed atlas-bridge witness receipt.
      const lim = Math.min(bytes.length, 65536);
      for (let i = 0; i < lim; i++) { const b = bytes[i]; if ((b & 3) === 3 || ((b >> 2) & 3) === 3 || ((b >> 4) & 3) === 3 || (b >> 6) === 3) throw new Error(`t2 alphabet violation in ${name} @byte ${i}`); }
      return { q: bytes, N: t.N, K: t.K, t2: true, ts: t.s };
    }
    if (preQuant) {                                         // load-direct: bytes ARE [2-bit packed (N·Kp/4)][f32 scales]
      const Kp = rotate ? nextP2(t.K) : t.K, q2 = (t.N * Kp) / 4;
      return { q: padQ(bytes.subarray(0, q2)), s: new Float32Array(bytes.buffer, bytes.byteOffset + q2, t.N * (Kp / 32)), N: t.N, K: t.K, Kp };
    }
    const qlen = qlenOf(t), slen = slenOf(t);
    const q = padQ(bytes.subarray(0, qlen)), s = new Float32Array(bytes.subarray(qlen, qlen + slen).slice().buffer);
    if (twoBit) { const r = requant2bit(q, s, t.N, t.K); return { q: r.q, s: r.s, N: t.N, K: t.K, Kp: r.Kp }; }   // requant-at-load = incoherence (LDLQ needs pre-compile)
    return { q, s, N: t.N, K: t.K };
  };
  // GPU-side of a resident weight: create buffers + writeBuffer from already-decoded parts `p`.
  // Split out of upW so the fetch+gunzip half (parts, CPU/native-async) can be overlapped across
  // tensors while these device calls stay serialized on the one JS thread (they must be).
  const writeW = (name, p) => {
    if (p.t2) {                                             // ternary: no scale buffer; s → P.w as f32 bits
      const qbuf = dev.createBuffer({ size: p.q.byteLength, usage: U.STORAGE | U.COPY_DST }); dev.queue.writeBuffer(qbuf, 0, p.q);
      W[name] = { qbuf, sbuf: null, uni: ubuf(new Uint32Array([p.K, p.N, p.K / 16, fbits(p.ts)])), N: p.N, K: p.K, Kp: p.K, t2: true, s: p.ts };
      return;
    }
    if (p.t2r) {                                            // ternary + per-256-block scale buffer
      const qbuf = dev.createBuffer({ size: p.q.byteLength, usage: U.STORAGE | U.COPY_DST }); dev.queue.writeBuffer(qbuf, 0, p.q);
      const sb = dev.createBuffer({ size: Math.max(16, p.sRaw.byteLength), usage: U.STORAGE | U.COPY_DST }); dev.queue.writeBuffer(sb, 0, p.sRaw);
      W[name] = { qbuf, sbuf: sb, uni: ubuf(new Uint32Array([p.K, p.N, p.K / 16, 0])), N: p.N, K: p.K, Kp: p.K, t2r: true };
      return;
    }
    if (p.q1) {                                             // binary + per-128-block scale buffer
      const qbuf = dev.createBuffer({ size: p.q.byteLength, usage: U.STORAGE | U.COPY_DST }); dev.queue.writeBuffer(qbuf, 0, p.q);
      const sb = dev.createBuffer({ size: Math.max(16, p.sRaw.byteLength), usage: U.STORAGE | U.COPY_DST }); dev.queue.writeBuffer(sb, 0, p.sRaw);
      W[name] = { qbuf, sbuf: sb, uni: ubuf(new Uint32Array([p.K, p.N, p.K / 128, 0])), N: p.N, K: p.K, Kp: p.K, q1: true };
      return;
    }
    const sBytes = p.sRaw || p.s;                           // e8q scales stay raw f16 bytes; others are f32 arrays
    const qbuf = dev.createBuffer({ size: p.q.byteLength, usage: U.STORAGE | U.COPY_DST }); dev.queue.writeBuffer(qbuf, 0, p.q);
    const sbuf2 = dev.createBuffer({ size: Math.max(16, sBytes.byteLength), usage: U.STORAGE | U.COPY_DST }); dev.queue.writeBuffer(sbuf2, 0, sBytes);
    const Kp = twoBit ? p.Kp : p.K;
    W[name] = { qbuf, sbuf: sbuf2, uni: ubuf(new Uint32Array([Kp, p.N, Kp / 32, 0])), N: p.N, K: p.K, Kp, e8: !!p.e8 };
  };
  const upW = async (name) => writeW(name, await parts(name));
  if (!frameGran) await upW("lm_head");                    // resident in resident/layer modes; TILED (played) in frame mode
  let RQ = null, RS = null, packLayout = null, packStride = 0, packQbytes = 0;
  // DRAFT (t2 layer-streaming — needs WebGPU verification): BitNet/Falcon t2 has a SCALAR scale per matrix
  // (baked into the matmul uniform via fbits), not a per-block scale buffer. So a t2 streamed layer packs
  // q ONLY (no scale blob), and each layer's per-role scalar is written into the reusable R[role].uni before
  // that layer's matmul. t2scales[l][role] = fbits(scale) is precomputed from the manifest (no fetch).
  const t2stream = !!stream && !moe && !frameGran && ROLES.every((r) => (tmap[`l0.${r}`] || {}).fmt === "t2");
  let t2scales = null;
  let opfsStore = null;
  const frameMan = {};                                     // name → {off, qlen, slen, N, K} (frame layout)
  if (frameGran) {
    // FRAME PLAYER: each weight matrix is a "frame", played through ONE reusable
    // buffer sized to the largest single matrix. The frames live either in JS
    // (frame mode) or on DISK in OPFS (opfs mode — the RAM-wall break).
    const names = [];
    for (let l = 0; l < n_layers; l++) for (const role of ROLES) names.push(`l${l}.${role}`);
    names.push("lm_head");
    let mq = 0, ms = 0, off = 0;
    for (const name of names) {                            // deterministic layout (sizes from the manifest, no fetch)
      const t = tmap[name], ql = Math.ceil(qlenOf(t) / 4) * 4, sl = slenOf(t);
      frameMan[name] = { off, qlen: ql, slen: sl, N: t.N, K: t.K };
      off += ql + sl;
      if (name !== "lm_head") { mq = Math.max(mq, ql); ms = Math.max(ms, sl); }
    }
    RM = dev.createBuffer({ size: mq, usage: U.STORAGE | U.COPY_DST });
    RMscale = dev.createBuffer({ size: Math.max(16, ms), usage: U.STORAGE | U.COPY_DST });
    streamBuf = mq + Math.max(16, ms);
    if (opfs) {
      opfsStore = await openFrameStore(`qvac-${vocab}-${n_layers}-${d}-b${bits}.frames`, off);
      if (!opfsStore.ready) {                              // not on disk yet → convert + write (once)
        await opfsStore.beginWrite();
        for (const name of names) { const p = await parts(name), m = frameMan[name]; await opfsStore.write(m.off, p.q); await opfsStore.write(m.off + m.qlen, new Uint8Array(p.s.buffer, p.s.byteOffset, p.s.byteLength)); }
        await opfsStore.endWrite();
      }
    } else {                                               // frame mode: frames in JS
      for (let l = 0; l < n_layers; l++) for (const role of ROLES) { const p = await parts(`l${l}.${role}`); FB[`l${l}.${role}`] = { q: p.q, s: p.s, uni: ubuf(new Uint32Array([p.K, p.N, p.K / 32, 0])), N: p.N }; }
      FB["lm_head"] = await parts("lm_head");
    }
  } else if (stream) {
    // Pack each layer's 7 matrices into ONE q-blob + ONE scale-blob (roles laid
    // out at 256-aligned offsets — the storage-buffer binding-offset granularity).
    // Then the per-token upload is just 2 big writeBuffers/layer instead of 14
    // small ones (cuts 392 calls → 56 and makes each copy a fat, fast DMA), and
    // each role's matmul binds its sub-range. Only one layer is GPU-resident.
    // The packed bytes live in JS ("layer") or on DISK in OPFS ("opfs" — the
    // RAM-wall break); EITHER way the per-layer body is the SAME proven layerBody().
    const al = (n) => Math.ceil(n / 256) * 256;
    // t2 (BitNet/Falcon): q is codes only (N·K/4 B, 4 trits/byte) + a SCALAR scale (→ uniform); no scale blob.
    // Every other stream fmt (q3f/q4/e8/t2r): q (padded) + a per-block scale blob at soff. Same packLayer shape.
    const qbl = (t) => t2stream ? Math.ceil((t.N * t.K / 4) / 4) * 4 : Math.ceil(qlenOf(t) / 4) * 4;
    const sbl = (t) => t2stream ? 0 : slenOf(t);
    packLayout = {}; let qo = 0, so = 0;
    for (const role of ROLES) { const t = tmap[`l0.${role}`]; qo = al(qo); so = al(so); packLayout[role] = { qoff: qo, qsize: qbl(t), soff: so, ssize: sbl(t), N: t.N, K: t.K }; qo += qbl(t); so += sbl(t); }
    const packQ = al(qo), packS = al(so);
    RQ = dev.createBuffer({ size: packQ, usage: U.STORAGE | U.COPY_DST });
    RS = dev.createBuffer({ size: Math.max(16, packS), usage: U.STORAGE | U.COPY_DST });
    streamBuf = packQ + Math.max(16, packS);
    // t2: per-layer-per-role scalar (fbits), refreshed into R[role].uni each layer in the forward. Manifest-only.
    if (t2stream) { t2scales = []; for (let l = 0; l < n_layers; l++) { const row = {}; for (const role of ROLES) row[role] = fbits((tmap[`l${l}.${role}`] || {}).s ?? 1); t2scales.push(row); } }
    for (const role of ROLES) {
      const L = packLayout[role];
      R[role] = t2stream
        ? { qbuf: { buffer: RQ, offset: L.qoff, size: L.qsize }, uni: ubuf(new Uint32Array([L.K, L.N, L.K / 16, 0])), N: L.N, K: L.K, t2: true }   // scale.w set per layer
        : { qbuf: { buffer: RQ, offset: L.qoff, size: L.qsize }, sbuf: { buffer: RS, offset: L.soff, size: L.ssize }, uni: ubuf(new Uint32Array([L.K, L.N, L.K / 32, 0])), N: L.N };
    }
    const packLayer = async (l) => {                       // build one layer's packed (q[,s]) from the κ-object
      const q = new Uint8Array(packQ), s = new Uint8Array(packS);
      for (const role of ROLES) { const p = await parts(`l${l}.${role}`); q.set(p.q, packLayout[role].qoff); if (!t2stream) s.set(new Uint8Array(p.s.buffer, p.s.byteOffset, p.s.byteLength), packLayout[role].soff); }
      return { q, s };
    };
    if (opfs) {                                            // DISK-backed: page each layer's packed blob in per token
      packQbytes = packQ; packStride = packQ + packS;
      if (remote) {                                        // already on the server's disk as a .qvf → just read it via Range
        opfsStore = frameStore; prog(n_layers, n_layers, "layers");
      } else {
        opfsStore = await openFrameStore(`qvac-packed-${vocab}-${n_layers}-${d}-b${bits}.frames`, packStride * n_layers);
        if (!opfsStore.ready) {                            // not on disk yet → convert + write (once)
          await opfsStore.beginWrite();
          for (let l = 0; l < n_layers; l++) { const pk = await packLayer(l); await opfsStore.write(l * packStride, pk.q); await opfsStore.write(l * packStride + packQ, pk.s); prog(l + 1, n_layers, "layers"); }
          await opfsStore.endWrite();
        } else prog(n_layers, n_layers, "layers");
      }
    } else {                                               // JS-backed: packed blobs stay in the heap, paged in per token
      for (let l = 0; l < n_layers; l++) { Wb[l] = await packLayer(l); prog(l + 1, n_layers, "layers"); }
    }
  } else {
    // RESIDENT (default dense path — chat/voice/messenger/diffusion all land here).
    // A bounded pool CAN run parts() (fetch+gunzip+κ-verify) concurrently, but MEASUREMENT
    // (forge/gpu/coldload-bench.html, BitNet-2B on RDNA-3) says default it OFF (conc=1 = the
    // original strictly-serial path): warm the phase is ~4.3s and does NOT parallelize — gunzip
    // + per-block SHA-256 are contention-bound, so conc>1 only trades wall-time for per-op
    // slowdown (conc=8 was ~4% slower). GPU-write is ~0.35s of the whole phase, so there is no
    // upload-overlap win to get. The cold network fetch is already parallelized by
    // prefetchBlocks(conc=12) upstream. Kept opt-in (window.__qUploadConc>1) only for the cold
    // window where the resident loop can outrun prefetch and stall on a serial network miss.
    const names = [];
    for (let l = 0; l < n_layers; l++) for (const role of ROLES) names.push(`l${l}.${role}`);
    const conc = Math.max(1, (globalThis.__qUploadConc | 0) || 1);
    QLOAD.conc = conc; QLOAD.nTensors = names.length;
    const t0 = _now();
    let i = 0;
    const worker = async () => {
      while (i < names.length) {
        const name = names[i++];
        const ta = _now(); const p = await parts(name); QLOAD.partsMs += _now() - ta;
        const tb = _now(); writeW(name, p); QLOAD.gpuMs += _now() - tb;
        prog(i, names.length, "weights");
      }
    };
    await Promise.all(Array.from({ length: Math.min(conc, names.length || 1) }, worker));
    QLOAD.residentMs = _now() - t0;
    try { globalThis.__qvacLoadStats = QLOAD; } catch {}
  }

  const Nrm = {};
  const upN = async (name) => { const f = new Float32Array((await fetchTensor(name)).slice().buffer); const buf = dev.createBuffer({ size: Math.max(16, f.byteLength), usage: U.STORAGE | U.COPY_DST }); dev.queue.writeBuffer(buf, 0, f); Nrm[name] = buf; };
  await upN("final_norm");
  for (let l = 0; l < n_layers; l++) { await upN(`l${l}.attn_norm`); await upN(`l${l}.ffn_norm`); }
  // BitNet sub-norm weights (attn: [q_dim], ffn: [ff])
  if (subNorm) for (let l = 0; l < n_layers; l++) { await upN(`l${l}.attn_sub_norm`); await upN(`l${l}.ffn_sub_norm`); }
  // Qwen2 q/k/v projection biases (f32 vectors, same store as norms)
  if (attnBias) for (let l = 0; l < n_layers; l++) { await upN(`l${l}.bq`); await upN(`l${l}.bk`); await upN(`l${l}.bv`); }
  // Qwen3 per-head q/k RMSNorm weights ([hd] f32)
  if (qkNorm) for (let l = 0; l < n_layers; l++) { await upN(`l${l}.q_norm`); await upN(`l${l}.k_norm`); }

  // embed: per-block int8/nibbles + scales, kept in JS for the host-side lookup
  const eT = tmap["embed"], eb = await fetchTensor("embed"), eqlen = qlenOf(eT);
  const embedQ = eb.subarray(0, eqlen);
  const embedS = new Float32Array(eb.subarray(eqlen, eqlen + slenOf(eT)).slice().buffer);

  // ── scratch + KV cache (GPU-resident) ──
  // The query/attention dim is n_heads·hd, which can EXCEED the hidden d (e.g.
  // Qwen3-30B-A3B: 32·128=4096 vs d=2048). q and the attn output (wo's input) must
  // be sized by q_dim, not d — else the wq matmul overflows a too-small buffer.
  const q_dim = n_heads * hd;
  const B = { x: sbuf(d), normed: sbuf(d), q: sbuf(q_dim), k: sbuf(kv_dim), v: sbuf(kv_dim), attn: sbuf(q_dim), attn_out: sbuf(d), h: sbuf(d), normed2: sbuf(d), gate: sbuf(ff), up: sbuf(ff), hid: sbuf(ff), mlp: sbuf(d), cur: sbuf(d), logits: sbuf(vocab) };
  if (subNorm || bitlinear) { B.attn2 = sbuf(q_dim); B.hid2 = sbuf(ff); }   // BitNet sub-norm / BitLinear outputs (RMS must not run in place on this driver)
  if (bitlinear) {                                                 // unit gammas for the weightless BitLinear input norms
    const unit = (n, name) => { const f = new Float32Array(n).fill(1); const b = dev.createBuffer({ size: f.byteLength, usage: U.STORAGE | U.COPY_DST }); dev.queue.writeBuffer(b, 0, f); Nrm[name] = b; };
    unit(d, "__unit_d"); unit(q_dim, "__unit_qd"); unit(ff, "__unit_ff");
  }
  // fused-ternary concat outputs: q‖k‖v and gate‖up; downstream passes bind 256-aligned sub-ranges
  let qR = null, kR = null, vR = null;
  if (fusedT2) {
    B.qkv = sbuf(q_dim + 2 * kv_dim); B.gu = sbuf(2 * ff);
    if ((q_dim * 4) % 256 || ((q_dim + kv_dim) * 4) % 256 || (ff * 4) % 256) throw new Error("fusedT2 needs 256B-aligned sub-ranges");
    qR = { buffer: B.qkv, offset: 0, size: q_dim * 4 };
    kR = { buffer: B.qkv, offset: q_dim * 4, size: kv_dim * 4 };
    vR = { buffer: B.qkv, offset: (q_dim + kv_dim) * 4, size: kv_dim * 4 };
  }
  const staging = dev.createBuffer({ size: vocab * 4, usage: U.MAP_READ | U.COPY_DST });
  const kcache = [], vcache = [];
  const kvS = kv_dim / 8 + kv_dim / 32;                   // int4 record: u32s per token per side
  for (let l = 0; l < n_layers; l++) {
    const q4 = kv4 && l > 0;                              // layer 0 stays f32 (measured pathological at int4)
    kcache.push(sbuf(q4 ? cap * kvS : cap * kv_dim)); vcache.push(sbuf(q4 ? cap * kvS : cap * kv_dim));
  }
  const uDim = ubuf(new Uint32Array([d, 0, 0, 0])), uFF = ubuf(new Uint32Array([ff, 0, 0, 0]));
  const uRopeQ = ubuf(new Uint32Array([n_heads, hd, 0, 0])), uRopeK = ubuf(new Uint32Array([n_kv_heads, hd, 0, 0])), uAttn = ubuf(new Uint32Array([n_heads, n_kv_heads, hd, 0]));
  const uQkn = ubuf(new Uint32Array([n_heads, hd, 0, 0])); // QK-Norm (P.y=hd; head count from dispatch)
  const uQd = (subNorm || bitlinear) ? ubuf(new Uint32Array([q_dim, 0, 0, 0])) : null;   // attn_sub_norm runs over q_dim (= n_heads·hd)
  // per-layer fused-ternary uniform packs (dims + the three per-tensor scales per fusion)
  const T2F = [];
  if (fusedT2) for (let l = 0; l < n_layers; l++) {
    const g = (r) => W[`l${l}.${r}`];
    const ok = ["wq", "wk", "wv", "w_gate", "w_up", "w_down"].every((r) => g(r) && g(r).t2);
    T2F.push(ok ? {
      qkvP: ubuf(new Uint32Array([d, q_dim + 2 * kv_dim, q_dim, kv_dim])),
      qkvS: ubuf(new Uint32Array([fbits(g("wq").s), fbits(g("wk").s), fbits(g("wv").s), 0])),
      guP: ubuf(new Uint32Array([d, 2 * ff, ff, ff])),
      guS: ubuf(new Uint32Array([fbits(g("w_gate").s), fbits(g("w_up").s), fbits(g("w_up").s), 0])),
      dP: subNorm ? null : ubuf(new Uint32Array([ff, d, ff / 4, fbits(g("w_down").s)])),
    } : null);
  }
  const uLm = frameGran ? ubuf(new Uint32Array([d, 0, d / 32, 0])) : null; // tiled lm_head: [K=d, rows, nblk, base]
  const uFr = opfs ? ubuf(new Uint32Array([0, 0, 0, 0])) : null;            // shared per-frame uniform (rewritten per matrix)

  // ── MoE: router (CPU), per-expert GPU buffers, expert streamer + cache ──
  // The router picks n_used of n_experts per token (CPU top-k off a tiny matmul);
  // only those experts' weights are streamed (frameStore.readExpert) and uploaded
  // into ONE reusable gate/up/down buffer set. Bytes/token ≈ n_used/n_experts of FFN.
  let routerCPU = null, stagingD = null, ExpQ = null, ExpS = null, uMoeIn = null, uMoeDn = null;
  const expCache = new Map(); let expBytesCached = 0; const expInflight = new Map();
  // κ-object MoE (G5): no frame stream → experts come from fetchTensor (`l{l}.e{e}.{role}`, the
  // compiled q4 slab, L5-verified by the loader). They live RESIDENT IN VRAM (below) so the forward
  // never re-uploads weights. Streaming path (frameStore) keeps the bounded per-token RAM cache.
  const residentExperts = moe && !frameStore;
  const EQ = (bits === 4 ? (ff * d) / 2 : ff * d), ES = (ff * d / 32) * 4;   // one expert matrix: q bytes / scale bytes (N·K = ff·d for gate/up/down alike)
  let ExpVRAM = null; const vramSet = new Set();
  if (moe) {
    routerCPU = [];
    for (let l = 0; l < n_layers; l++) routerCPU.push(new Float32Array((await fetchTensor(`l${l}.router`)).slice().buffer)); // [nExp*d] per layer
    stagingD = dev.createBuffer({ size: d * 4, usage: U.MAP_READ | U.COPY_DST });
    uMoeIn = ubuf(new Uint32Array([d, ff, d / 32, 0]));     // gate/up: K=d, N=ff
    uMoeDn = ubuf(new Uint32Array([ff, d, ff / 32, 0]));    // down:   K=ff, N=d
    var uAxpy = ubuf(new Uint32Array([d, 0, 0, 0]));        // AXPY: [n=d, f32bits(weight)] (streaming: rewritten per expert)
    // resident: one AXPY uniform PER expert slot → all nUsed experts' FFN passes ride ONE command
    // encoder / ONE submit per layer (was one submit per expert = 8× the dispatch tax).
    var uAxpyN = Array.from({ length: nUsed }, () => ubuf(new Uint32Array([d, 0, 0, 0])));
    if (residentExperts) {
      // ALL experts RESIDENT IN VRAM: one (q,s) buffer per (layer,role) holding all nExp experts.
      // The forward binds expert e's 256-aligned sub-range (e·EQ / e·ES — EQ,ES are 256-multiples) ⇒
      // ZERO per-token weight upload (the win over the per-token CPU→GPU copy). ≈ nExp·EQ·3·n_layers
      // VRAM (OLMoE ≈ 3.8 GB); attention stays layer-paged so total fits a ~4 GB GPU.
      ExpVRAM = [];
      for (let l = 0; l < n_layers; l++) { const r = {}; for (const role of ["gate", "up", "down"]) r[role] = { q: dev.createBuffer({ size: nExp * EQ, usage: U.STORAGE | U.COPY_DST }), s: dev.createBuffer({ size: nExp * ES, usage: U.STORAGE | U.COPY_DST }) }; ExpVRAM.push(r); }
      // batched-expert scratch + uniforms (all nUsed experts in ONE dispatch per stage)
      B.gate8 = sbuf(nUsed * ff); B.up8 = sbuf(nUsed * ff); B.hid8 = sbuf(nUsed * ff);
      var uMoeGU = ubuf(new Uint32Array([d, ff, d / 32, nUsed]));   // gate/up: K=d, ff rows/expert
      var uMoeDnB = ubuf(new Uint32Array([ff, d, ff / 32, nUsed])); // down: K=ff, N=d
      var uFFb = ubuf(new Uint32Array([nUsed * ff, 0, 0, 0]));      // silu over all experts
      var uIdx = ubuf(new Uint32Array(8)), uWts = ubuf(new Float32Array(8));
    } else {                                                // streaming: ONE reusable expert buffer set, re-uploaded per token
      ExpQ = { gate: sbuf(EQ / 4), up: sbuf(EQ / 4), down: sbuf(EQ / 4) };          // sbuf takes element count → *4 bytes
      ExpS = { gate: sbuf(ES / 4), up: sbuf(ES / 4), down: sbuf(ES / 4) };
    }
  }
  // lazy-upload one expert into its VRAM slab (once, on first activation); bind-only thereafter.
  const ensureVram = async (l, e, role) => {
    const key = (l * nExp + e) * 3 + { gate: 0, up: 1, down: 2 }[role];
    if (vramSet.has(key)) return;
    const b = await fetchTensor(`l${l}.e${e}.${role}`);    // L5-verified q4 slab [q][f32 scales]
    const slab = ExpVRAM[l][role];
    dev.queue.writeBuffer(slab.q, e * EQ, b.subarray(0, EQ));
    dev.queue.writeBuffer(slab.s, e * ES, b.subarray(EQ, EQ + ES));
    vramSet.add(key);
  };
  // Stream + cache one expert role frame ([q][scales]); returns {q,s} (streaming path only).
  const readExpert = async (l, e, role) => {
    const key = (l * nExp + e) * 3 + { gate: 0, up: 1, down: 2 }[role];
    if (expCache.has(key)) return expCache.get(key);
    if (expInflight.has(key)) return expInflight.get(key);
    const eq = (bits === 4 ? (ff * d) / 2 : ff * d);
    const src = residentExperts ? fetchTensor(`l${l}.e${e}.${role}`) : frameStore.readExpert(l, e, role);
    const p = Promise.resolve(src).then((b) => {
      expInflight.delete(key);
      const v = { q: b.subarray(0, eq), s: b.subarray(eq) };
      expCache.set(key, v); expBytesCached += b.byteLength;
      if (!residentExperts) {                              // streaming: bound the cache; resident: keep every expert
        const budget = Math.max(cacheBudget, (nUsed * 3 + 4) * b.byteLength);
        if (expBytesCached > budget) for (const k of expCache.keys()) { if (expBytesCached <= budget) break; const old = expCache.get(k); expBytesCached -= old.q.byteLength + old.s.byteLength; expCache.delete(k); }
      }
      return v;
    });
    expInflight.set(key, p); return p;
  };

  // bind groups are stable across steps (same buffers) → build once, cache by key
  let bid = 0;
  const tag = (b) => { if (b._id === undefined) b._id = ++bid; return b; };
  const bgCache = new Map();
  // ── ONE-PASS dataflow mode: a single open compute pass spans a whole token (or batch of tokens) ──
  // Kills the per-kernel pass-boundary tax (measured: ~300 passes/token is what holds decode at ~13%
  // of the device roofline). Opt-out: window.__onepass = false. KV saves become kernels (KVSAVE_*)
  // because copyBufferToBuffer cannot ride inside a compute pass.
  let openPass = null, P_kvsF = null, P_kvsS = null;
  const ONEPASS = () => (typeof window === "undefined" ? true : window.__onepass !== false);
  // split-KV attention state (f32 + int4 caches): partials buffer + lazily-compiled P1/P2 pipelines
  const A_TILES = Math.ceil(cap / ATILE);
  let P_at1 = null, P_atq1 = null, P_at2 = null, attnPT = null;
  const SPLITATTN = () => (typeof window === "undefined" ? true : window.__splitattn !== false);
  const pass = (enc, pipeline, bufs, groups) => {
    // hot path (~300 passes/token): zero-allocation key build; the entries array (and its
    // resource objects) is constructed ONLY on a bind-group cache miss.
    let key = "";
    for (let i = 0; i < bufs.length; i++) { const b = bufs[i]; key += (b.buffer ? tag(b.buffer)._id + "@" + (b.offset || 0) : tag(b)._id) + ","; }
    let pm = bgCache.get(pipeline._id);
    if (!pm) { pm = new Map(); bgCache.set(pipeline._id, pm); }
    let bg = pm.get(key);
    if (!bg) {
      const entries = bufs.map((b, i) => b.buffer
        ? { binding: i, resource: { buffer: b.buffer, offset: b.offset || 0, size: b.size } }
        : { binding: i, resource: { buffer: b } });
      bg = dev.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
      pm.set(key, bg);
    }
    // ONE-PASS mode (the dataflow loop): when a compute pass is already open, dispatch into it —
    // no per-kernel pass begin/end. WebGPU gives each dispatch its own usage scope inside a pass,
    // so write-then-read ordering between chained kernels is preserved; only the pass-boundary tax goes.
    if (openPass) {
      openPass.setPipeline(pipeline);
      openPass.setBindGroup(0, bg);
      if (Array.isArray(groups)) openPass.dispatchWorkgroups(groups[0], groups[1]); else openPass.dispatchWorkgroups(groups);
      return;
    }
    let desc;                                                       // profiling: timestamp this pass (lm_head's 2D grid tagged apart)
    if (PROF && PROF.active && PROF.i + 2 <= 4096) { desc = { timestampWrites: { querySet: PROF.qs, beginningOfPassWriteIndex: PROF.i, endOfPassWriteIndex: PROF.i + 1 } }; PROF.tags.push(pipeline._name + (Array.isArray(groups) ? ":lm" : "")); PROF.i += 2; }
    const p = enc.beginComputePass(desc);
    p.setPipeline(pipeline);
    p.setBindGroup(0, bg);
    if (Array.isArray(groups)) p.dispatchWorkgroups(groups[0], groups[1]); else p.dispatchWorkgroups(groups);
    p.end();
  };
  // N output rows → 2D grid (x ≤ 65535, the WebGPU per-dimension limit); the
  // kernel reconstructs n = y*65535 + x. Needed for Qwen's 151 k vocab lm_head.
  const grid = (N) => N > 65535 ? [65535, Math.ceil(N / 65535)] : N;
  // native-2-bit: rotate the matmul input into `rot` (FWHT over Kp), then the 2-bit GEMV reads `rot`.
  let rot = null; const signBufs = new Map(), fwhtUnis = new Map();
  const wgN = (n) => Math.ceil(n / 256);
  const fwUni = (key, arr) => { let u = fwhtUnis.get(key); if (!u) { u = ubuf(arr); fwhtUnis.set(key, u); } return u; };
  const fwhtRotate = (enc, xb, K, Kp) => {                 // x′ = FWHT(sign ⊙ pad(x)) → rot, in place over Kp
    if (!rot) rot = sbuf(maxKp);
    let sg = signBufs.get(Kp); if (!sg) { const a = signsFor(Kp); sg = dev.createBuffer({ size: a.byteLength, usage: U.STORAGE | U.COPY_DST }); dev.queue.writeBuffer(sg, 0, a); signBufs.set(Kp, sg); }
    pass(enc, P_fwL, [xb, sg, rot, fwUni("L" + K + "_" + Kp, new Uint32Array([K, Kp, 0, 0]))], wgN(Kp));
    for (let len = 1; len < Kp; len <<= 1) pass(enc, P_fwB, [rot, fwUni("B" + Kp + "_" + len, new Uint32Array([Kp, len, 0, 0]))], wgN(Kp >> 1));
    pass(enc, P_fwN, [rot, fwUni("N" + Kp, new Uint32Array([Kp, 0, 0, 0]))], wgN(Kp));
    return rot;
  };
  const t2big = (ws) => ws.N * ws.K >= T2BIG;             // geometry pick: fat workgroups for big tensors
  const mmW = (enc, xb, ws, ob) => ws.t2
    ? (t2big(ws)
      ? pass(enc, P_mmT2B, [xb, ws.qbuf, ob, ws.uni], grid(Math.ceil(ws.N / 16)))
      : pass(enc, P_mmT2, [xb, ws.qbuf, ob, ws.uni], grid(Math.ceil(ws.N / 4))))
    : ws.t2r
    ? (t2big(ws)
      ? pass(enc, P_mmT2RB, [xb, ws.qbuf, ws.sbuf, ob, ws.uni], grid(Math.ceil(ws.N / 16)))
      : pass(enc, P_mmT2R, [xb, ws.qbuf, ws.sbuf, ob, ws.uni], grid(Math.ceil(ws.N / 4))))
    : ws.q1
    ? (t2big(ws)
      ? pass(enc, P_mmQ1B, [xb, ws.qbuf, ws.sbuf, ob, ws.uni], grid(Math.ceil(ws.N / 16)))
      : pass(enc, P_mmQ1, [xb, ws.qbuf, ws.sbuf, ob, ws.uni], grid(Math.ceil(ws.N / 4))))
    : ws.e8
    ? pass(enc, P_mmE8, [xb, ws.qbuf, ws.sbuf, lutBuf, ob, ws.uni], grid(ws.N))
    : (P_mmQ3B && !rotate && ws.N * ws.K >= T2BIG)
    ? pass(enc, P_mmQ3B, [xb, ws.qbuf, ws.sbuf, ob, ws.uni], grid(Math.ceil(ws.N / 4)))
    : pass(enc, P_mm, [rotate ? fwhtRotate(enc, xb, ws.K, ws.Kp) : xb, ws.qbuf, ws.sbuf, ob, ws.uni], grid(ws.N));
  const mmAddW = (enc, xb, ws, r, ob) => ws.t2
    ? (t2big(ws)
      ? pass(enc, P_mmT2Badd, [xb, ws.qbuf, r, ob, ws.uni], grid(Math.ceil(ws.N / 16)))
      : pass(enc, P_mmT2add, [xb, ws.qbuf, r, ob, ws.uni], grid(Math.ceil(ws.N / 4))))
    : ws.t2r
    ? (t2big(ws)
      ? pass(enc, P_mmT2RBadd, [xb, ws.qbuf, ws.sbuf, r, ob, ws.uni], grid(Math.ceil(ws.N / 16)))
      : pass(enc, P_mmT2Radd, [xb, ws.qbuf, ws.sbuf, r, ob, ws.uni], grid(Math.ceil(ws.N / 4))))
    : ws.q1
    ? (t2big(ws)
      ? pass(enc, P_mmQ1Badd, [xb, ws.qbuf, ws.sbuf, r, ob, ws.uni], grid(Math.ceil(ws.N / 16)))
      : pass(enc, P_mmQ1add, [xb, ws.qbuf, ws.sbuf, r, ob, ws.uni], grid(Math.ceil(ws.N / 4))))
    : ws.e8
    ? pass(enc, P_mmE8add, [xb, ws.qbuf, ws.sbuf, lutBuf, r, ob, ws.uni], grid(ws.N))
    : pass(enc, P_mmadd, [rotate ? fwhtRotate(enc, xb, ws.K, ws.Kp) : xb, ws.qbuf, ws.sbuf, r, ob, ws.uni], grid(ws.N));
  const rms = (enc, xb, gname, ob, u = uDim) => pass(enc, P_rms, [xb, Nrm[gname], ob, u], 1);

  // one transformer layer's passes; `ws(role)` returns the role's weight-set
  // (resident = W[`l.role`], stream = the reusable R[role]). Returns B.cur.
  // `up` overrides the position-dependent bindings for batched decode: {ropeQ, ropeK, attn, pos}.
  function layerBody(enc, l, cur, ws, up = null) {
    const _uRopeQ = up ? up.ropeQ : uRopeQ, _uRopeK = up ? up.ropeK : uRopeK, _uAttn = up ? up.attn : uAttn, _pos = up ? up.pos : pos;
    return layerBodyU(enc, l, cur, ws, _uRopeQ, _uRopeK, _uAttn, _pos);
  }
  // f32-cache attention dispatch: split-KV (flash-decode) once the context outgrows one tile —
  // occupancy scales with position instead of collapsing; short contexts keep the 1-dispatch kernel.
  function attnF32(enc, l, qb, uAttn, pos) {
    if (SPLITATTN() && pos + 1 > ATILE && hd % 4 === 0) {
      P_at1 = P_at1 || pipe(ATTNP1(A_TILES, ATILE, hd), "attnP1");
      P_at2 = P_at2 || pipe(ATTNP2(A_TILES, ATILE), "attnP2");
      attnPT = attnPT || sbuf(n_heads * A_TILES * (hd + 2));
      pass(enc, P_at1, [qb, kcache[l], vcache[l], attnPT, uAttn], [n_heads, Math.floor(pos / ATILE) + 1]);
      pass(enc, P_at2, [attnPT, B.attn, uAttn], n_heads);
    } else {
      pass(enc, P_attn, [qb, kcache[l], vcache[l], B.attn, uAttn], n_heads);
    }
  }
  // int4-KV attention dispatch (the shipped Q brain path): same split, quantized records.
  function attnQ4(enc, l, qb, uAttn, pos) {
    if (SPLITATTN() && pos + 1 > ATILE && hd % 8 === 0) {
      P_atq1 = P_atq1 || pipe(ATTNQP1(A_TILES, ATILE, hd, kv_dim), "attnQP1");
      P_at2 = P_at2 || pipe(ATTNP2(A_TILES, ATILE), "attnP2");
      attnPT = attnPT || sbuf(n_heads * A_TILES * (hd + 2));
      pass(enc, P_atq1, [qb, kcache[l], vcache[l], attnPT, uAttn], [n_heads, Math.floor(pos / ATILE) + 1]);
      pass(enc, P_at2, [attnPT, B.attn, uAttn], n_heads);
    } else {
      pass(enc, P_attnQ, [qb, kcache[l], vcache[l], B.attn, uAttn], n_heads);
    }
  }
  function layerBodyU(enc, l, cur, ws, uRopeQ, uRopeK, uAttn, pos) {
    const F = fusedT2 ? T2F[l] : null;
    if (F) {                                                // fused ternary layer: 10 passes instead of 15
      rms(enc, cur, `l${l}.attn_norm`, B.normed);
      pass(enc, P_t2f, [B.normed, ws("wq").qbuf, ws("wk").qbuf, ws("wv").qbuf, B.qkv, F.qkvP, F.qkvS], grid(Math.ceil((q_dim + 2 * kv_dim) / 4)));
      pass(enc, P_rope2, [qR, kR, uRopeQ], Math.ceil((n_heads + n_kv_heads) * (hd / 2) / 64));   // uRopeQ.w carries nkv
      if (kv4 && l > 0) {
        pass(enc, P_kvq, [kR, kcache[l], uAttn], 1);      // quantize+pack K/V rows (uAttn.w = pos on every path)
        pass(enc, P_kvq, [vR, vcache[l], uAttn], 1);
        attnQ4(enc, l, qR, uAttn, pos);
      } else if (openPass) {                              // one-pass mode: KV save as a kernel (copies can't ride in a pass)
        P_kvsF = P_kvsF || pipe(KVSAVE_F(q_dim, kv_dim), "kvsave");
        pass(enc, P_kvsF, [B.qkv, kcache[l], vcache[l], uAttn], Math.ceil(kv_dim / 64));
        attnF32(enc, l, qR, uAttn, pos);
      } else {
        enc.copyBufferToBuffer(B.qkv, q_dim * 4, kcache[l], pos * kv_dim * 4, kv_dim * 4);
        enc.copyBufferToBuffer(B.qkv, (q_dim + kv_dim) * 4, vcache[l], pos * kv_dim * 4, kv_dim * 4);
        attnF32(enc, l, qR, uAttn, pos);
      }
      let attnO = B.attn;
      if (subNorm) { rms(enc, B.attn, `l${l}.attn_sub_norm`, B.attn2, uQd); attnO = B.attn2; }
      mmAddW(enc, attnO, ws("wo"), cur, B.h);
      rms(enc, B.h, `l${l}.ffn_norm`, B.normed2);
      pass(enc, 2 * ff * d >= T2BIG ? P_t2fB : P_t2f, [B.normed2, ws("w_gate").qbuf, ws("w_up").qbuf, ws("w_up").qbuf, B.gu, F.guP, F.guS], grid(Math.ceil(2 * ff / (2 * ff * d >= T2BIG ? 16 : 4))));
      if (subNorm) {
        pass(enc, P_actn, [B.gu, Nrm[`l${l}.ffn_sub_norm`], B.hid2, uFF], 1);
        mmAddW(enc, B.hid2, ws("w_down"), B.h, B.cur);
      } else {
        pass(enc, P_t2ad, [B.gu, ws("w_down").qbuf, B.h, B.cur, F.dP], grid(Math.ceil(d / 4)));
      }
      return B.cur;
    }
    rms(enc, cur, `l${l}.attn_norm`, B.normed);
    if (_calib) enc.copyBufferToBuffer(B.normed, 0, snapBuf, l * d * 4, d * 4);   // calibration: snapshot this layer's attention input (for LDLQ Hessian)
    if (attnBias) {
      mmAddW(enc, B.normed, ws("wq"), Nrm[`l${l}.bq`], B.q);
      mmAddW(enc, B.normed, ws("wk"), Nrm[`l${l}.bk`], B.k);
      mmAddW(enc, B.normed, ws("wv"), Nrm[`l${l}.bv`], B.v);
    } else {
      let qkvIn = B.normed;
      if (bitlinear) { rms(enc, B.normed, "__unit_d", B.attn_out); qkvIn = B.attn_out; }   // BitLinear: weightless norm into q/k/v
      mmW(enc, qkvIn, ws("wq"), B.q);
      mmW(enc, qkvIn, ws("wk"), B.k);
      mmW(enc, qkvIn, ws("wv"), B.v);
    }
    if (qkNorm) {
      pass(enc, P_qkn, [B.q, Nrm[`l${l}.q_norm`], uQkn], n_heads);
      pass(enc, P_qkn, [B.k, Nrm[`l${l}.k_norm`], uQkn], n_kv_heads);
    }
    pass(enc, P_rope, [B.q, uRopeQ], Math.ceil(n_heads * (hd / 2) / 64));
    pass(enc, P_rope, [B.k, uRopeK], Math.ceil(n_kv_heads * (hd / 2) / 64));
    if (kv4 && l > 0) {
      pass(enc, P_kvq, [B.k, kcache[l], uAttn], 1);       // quantize+pack K/V rows (uAttn.w = pos on every path)
      pass(enc, P_kvq, [B.v, vcache[l], uAttn], 1);
      attnQ4(enc, l, B.q, uAttn, pos);
    } else if (openPass) {                                // one-pass mode: KV save as a kernel (copies can't ride in a pass)
      P_kvsS = P_kvsS || pipe(KVSAVE_S(kv_dim), "kvsave2");
      pass(enc, P_kvsS, [B.k, B.v, kcache[l], vcache[l], uAttn], Math.ceil(kv_dim / 64));
      attnF32(enc, l, B.q, uAttn, pos);
    } else {
      enc.copyBufferToBuffer(B.k, 0, kcache[l], pos * kv_dim * 4, kv_dim * 4);
      enc.copyBufferToBuffer(B.v, 0, vcache[l], pos * kv_dim * 4, kv_dim * 4);
      attnF32(enc, l, B.q, uAttn, pos);
    }
    let attnO = B.attn;
    if (subNorm) { rms(enc, B.attn, `l${l}.attn_sub_norm`, B.attn2, uQd); attnO = B.attn2; }   // BitNet: norm BEFORE the o-projection
    else if (bitlinear) { rms(enc, B.attn, "__unit_qd", B.attn2, uQd); attnO = B.attn2; }      // BitLinear: weightless norm into wo
    mmAddW(enc, attnO, ws("wo"), cur, B.h);                 // h = attn·Wo + residual
    rms(enc, B.h, `l${l}.ffn_norm`, B.normed2);
    if (_calib) enc.copyBufferToBuffer(B.normed2, 0, snapBuf, (n_layers + l) * d * 4, d * 4);   // calibration: snapshot this layer's MLP input (for LDLQ)
    let guIn = B.normed2;
    if (bitlinear) { rms(enc, B.normed2, "__unit_d", B.mlp); guIn = B.mlp; }                   // BitLinear: weightless norm into gate/up
    mmW(enc, guIn, ws("w_gate"), B.gate);
    mmW(enc, guIn, ws("w_up"), B.up);
    pass(enc, P_sm, [B.gate, B.up, B.hid, uFF], Math.ceil(ff / 64));
    let hidO = B.hid;
    if (subNorm) { rms(enc, B.hid, `l${l}.ffn_sub_norm`, B.hid2, uFF); hidO = B.hid2; }        // BitNet: norm BEFORE the down-projection
    else if (bitlinear) { rms(enc, B.hid, "__unit_ff", B.hid2, uFF); hidO = B.hid2; }          // BitLinear: weightless norm into w_down
    mmAddW(enc, hidO, ws("w_down"), B.h, B.cur);            // cur = mlp·Wdown + residual
    return B.cur;
  }

  let pos = 0, cached = [], lastLogits = null, timing = null;

  // ── streamed-layer cache + prefetch pipeline (opfs / remote) ──
  // The layer access pattern is fully predictable (0..n_layers every token), so we
  // prefetch ahead and overlap the storage→host read with GPU compute of earlier
  // layers. A bounded RAM cache keeps as many layers resident as the budget allows
  // (a model ≤ budget runs warm with zero re-fetch; a bigger model streams the tail,
  // RAM stays bounded). cacheBudget = bytes; 0 = no cache (pure stream).
  const layerCache = new Map();      // layer → packed Uint8Array
  const inflight = new Map();        // layer → Promise (dedupe concurrent reads)
  let cacheBytes = 0;
  const PREFETCH = 4;                // read-ahead depth (concurrent reads in flight)
  // Effective budget is at least the prefetch window, so prefetched buffers survive
  // until consumed even in pure-stream (budget 0) mode. A larger cacheBudget keeps
  // more layers warm across tokens (a model ≤ budget runs with no re-fetch).
  const effBudget = () => Math.max(cacheBudget, (PREFETCH + 2) * packStride);
  const getLayer = (l) => {
    if (layerCache.has(l)) return Promise.resolve(layerCache.get(l));
    if (inflight.has(l)) return inflight.get(l);
    const p = Promise.resolve(opfsStore.read(l * packStride, packStride)).then((buf) => {
      inflight.delete(l); layerCache.set(l, buf); cacheBytes += buf.byteLength;
      return buf;
    });
    inflight.set(l, p);
    return p;
  };
  const evictBelow = (l) => {        // drop already-consumed layers once over budget
    const b = effBudget();
    if (cacheBytes <= b) return;
    for (const k of layerCache.keys()) {
      if (cacheBytes <= b) break;
      if (k < l) { cacheBytes -= layerCache.get(k).byteLength; layerCache.delete(k); }
    }
  };

  // Atlas-Probe extension (additive, off by default): when _capHidden is an array, each step
  // reads back B.normed — the final-layer hidden state (post final_norm, the vector fed to lm_head),
  // the model's contextual representation of the token — for fingerprinting. Inert during decode.
  let _capHidden = null, hidStaging = null, _calib = null, snapBuf = null, snapStg = null;
  async function step(token, noRead = false) {                     // noRead: leave logits ON the GPU (decode()'s fast path; resident-dense only)
    const tE = performance.now();
    if (typeof window !== "undefined" && window.__profile) { profInit(); if (PROF) { PROF.active = true; PROF.i = 0; PROF.tags = []; } }
    else if (PROF) PROF.active = false;
    // embed lookup (CPU, per-block dequant) → x
    const x = new Float32Array(d);
    const o = token * d, sb = token * (d / 32);
    if (bits === 1) {                                         // q1 binary embed lookup (Bonsai: the embed row IS the trained sign row)
      for (let i = 0; i < d; i++) { const g = o + i; x[i] = ((embedQ[g >> 3] >> (g & 7)) & 1 ? 1 : -1) * embedS[g >> 7]; }
    } else if (bits === 4) {
      for (let i = 0; i < d; i++) { const gg = o + i; const nib = (embedQ[gg >> 1] >> ((gg & 1) * 4)) & 0xf; x[i] = (nib - 8) * embedS[sb + (i >> 5)]; }
    } else if (bits === 3 && q3f) {                           // Q3 FIELD embed lookup (mirrors the q3f kernel unpack)
      const eq32 = new Uint32Array(embedQ.buffer, embedQ.byteOffset, embedQ.byteLength >> 2), bb = token * (d / 32);
      for (let i = 0; i < d; i++) {
        const bp = (bb + (i >> 5)) * 3, j = i & 31; let q;
        if (j < 10) q = (eq32[bp] >>> (j * 3)) & 7;
        else if (j < 20) q = (eq32[bp + 1] >>> ((j - 10) * 3)) & 7;
        else if (j < 30) q = (eq32[bp + 2] >>> ((j - 20) * 3)) & 7;
        else { const sp = (eq32[bp] >>> 30) | ((eq32[bp + 1] >>> 30) << 2) | ((eq32[bp + 2] >>> 30) << 4); q = j === 30 ? sp & 7 : (sp >>> 3) & 7; }
        x[i] = (q - 3) * embedS[sb + (i >> 5)];
      }
    } else if (bits === 3) {                                  // Q3 bit-plane embed lookup
      const eq32 = new Uint32Array(embedQ.buffer, embedQ.byteOffset, embedQ.byteLength >> 2), bb = token * (d / 32);
      for (let i = 0; i < d; i++) { const bp = (bb + (i >> 5)) * 3, j = i & 31, q = ((eq32[bp] >>> j) & 1) | (((eq32[bp + 1] >>> j) & 1) << 1) | (((eq32[bp + 2] >>> j) & 1) << 2); x[i] = (q - 3) * embedS[sb + (i >> 5)]; }
    } else {
      for (let i = 0; i < d; i++) x[i] = s8(embedQ[o + i]) * embedS[sb + (i >> 5)];
    }
    dev.queue.writeBuffer(B.x, 0, x);
    dev.queue.writeBuffer(uRopeQ, 0, new Uint32Array([n_heads, hd, pos, n_kv_heads]));   // .w = nkv (read only by fused ROPE2)
    dev.queue.writeBuffer(uRopeK, 0, new Uint32Array([n_kv_heads, hd, pos, 0]));
    dev.queue.writeBuffer(uAttn, 0, new Uint32Array([n_heads, n_kv_heads, hd, pos]));

    const tS = performance.now();
    let cur = B.x;
    if (moe) {
      // MoE forward: attention (packed, prefetched) + per-token expert subset. Only
      // the n_used experts the router picks are streamed/uploaded → bytes/token ≈
      // n_used/n_experts of the FFN, so a huge MoE costs ~its active params/token.
      if (opfs) for (let l = 0; l < Math.min(PREFETCH, n_layers); l++) getLayer(l);
      for (let l = 0; l < n_layers; l++) {
        if (opfs) { const buf = await getLayer(l); if (l + PREFETCH < n_layers) getLayer(l + PREFETCH); dev.queue.writeBuffer(RQ, 0, buf.subarray(0, packQbytes)); dev.queue.writeBuffer(RS, 0, buf.subarray(packQbytes)); evictBelow(l); }
        else { dev.queue.writeBuffer(RQ, 0, Wb[l].q); dev.queue.writeBuffer(RS, 0, Wb[l].s); }
        const R_ = (role) => R[role];
        // attention (+ residual into B.h), then ffn_norm → B.normed2
        let enc = dev.createCommandEncoder();
        rms(enc, cur, `l${l}.attn_norm`, B.normed);
        mmW(enc, B.normed, R_("wq"), B.q); mmW(enc, B.normed, R_("wk"), B.k); mmW(enc, B.normed, R_("wv"), B.v);
        const DBG = (typeof window !== "undefined") ? window : {};
        // OLMoE: full-vector q/k RMSNorm. NOT in place (B.normed is free after the q/k/v
        // matmuls) — an in-place storage read-write RMS misbehaves on this driver.
        if (qkFull && !DBG.__skipQKN) {
          rms(enc, B.q, `l${l}.q_norm`, B.normed); enc.copyBufferToBuffer(B.normed, 0, B.q, 0, d * 4);
          rms(enc, B.k, `l${l}.k_norm`, B.normed); enc.copyBufferToBuffer(B.normed, 0, B.k, 0, kv_dim * 4);
        }
        else if (qkNorm) { pass(enc, P_qkn, [B.q, Nrm[`l${l}.q_norm`], uQkn], n_heads); pass(enc, P_qkn, [B.k, Nrm[`l${l}.k_norm`], uQkn], n_kv_heads); }
        pass(enc, P_rope, [B.q, uRopeQ], Math.ceil(n_heads * (hd / 2) / 64));
        pass(enc, P_rope, [B.k, uRopeK], Math.ceil(n_kv_heads * (hd / 2) / 64));
        enc.copyBufferToBuffer(B.k, 0, kcache[l], pos * kv_dim * 4, kv_dim * 4);
        enc.copyBufferToBuffer(B.v, 0, vcache[l], pos * kv_dim * 4, kv_dim * 4);
        pass(enc, P_attn, [B.q, kcache[l], vcache[l], B.attn, uAttn], n_heads);
        mmAddW(enc, B.attn, R_("wo"), cur, B.h);               // h = attn·Wo + residual
        rms(enc, B.h, `l${l}.ffn_norm`, B.normed2);
        enc.copyBufferToBuffer(B.normed2, 0, stagingD, 0, d * 4);
        dev.queue.submit([enc.finish()]);
        // router (CPU): top-k experts off the small d→n_experts matmul, softmax weights
        await stagingD.mapAsync(GPUMapMode.READ);
        const nf = new Float32Array(stagingD.getMappedRange().slice(0)); stagingD.unmap();
        const rw = routerCPU[l], rl = new Float32Array(nExp);
        for (let e = 0; e < nExp; e++) { let s = 0; const base = e * d; for (let j = 0; j < d; j++) s += nf[j] * rw[base + j]; rl[e] = s; }
        const idx = Array.from({ length: nExp }, (_, i) => i).sort((a, b) => rl[b] - rl[a]).slice(0, nUsed);
        if (DBG.__expLog) for (const e of idx) DBG.__expLog.push(l * nExp + e);   // (layer,expert) activations, in order — reuse analysis
        // OLMoE routing: softmax over ALL experts, take the selected probs WITHOUT renormalizing
        // (norm_topk_prob=false). Renormalizing over the top-k (the old code) made weights sum to 1
        // — ~2-3× too large vs the true softmax-over-64 mass — and blew up the residual → garbage.
        // moe.normTopk (Qwen3-MoE = true) re-enables the top-k renorm.
        let mx = -1e30; for (let e = 0; e < nExp; e++) if (rl[e] > mx) mx = rl[e];
        let denAll = 0; for (let e = 0; e < nExp; e++) denAll += Math.exp(rl[e] - mx);
        const wt = new Map(); for (const e of idx) wt.set(e, Math.exp(rl[e] - mx) / denAll);
        if (manifest.moe.normTopk) { let s = 0; for (const e of idx) s += wt.get(e); for (const e of idx) wt.set(e, wt.get(e) / s); }
        // accumulate experts into B.cur (init = residual h)
        const encI = dev.createCommandEncoder(); encI.copyBufferToBuffer(B.h, 0, B.cur, 0, d * 4); dev.queue.submit([encI.finish()]);
        if (DBG.__skipExperts) { cur = B.cur; continue; }   // debug: residual only (no FFN)
        if (residentExperts) {
          // BATCHED: ensure the chosen experts are VRAM-resident (lazy, once), then the WHOLE FFN for
          // all nUsed experts runs in 4 dispatches (gate, up, silu·mul, down+Σ+residual) — vs 5·nUsed.
          for (const e of idx) { await ensureVram(l, e, "gate"); await ensureVram(l, e, "up"); await ensureVram(l, e, "down"); }
          const idxArr = new Uint32Array(8), wArr = new Float32Array(8);
          for (let s = 0; s < idx.length; s++) { idxArr[s] = idx[s]; wArr[s] = wt.get(idx[s]); }
          dev.queue.writeBuffer(uIdx, 0, idxArr); dev.queue.writeBuffer(uWts, 0, wArr);
          const V = ExpVRAM[l];
          const enc3 = dev.createCommandEncoder();
          pass(enc3, P_moeGU, [B.normed2, V.gate.q, V.gate.s, B.gate8, uMoeGU, uIdx], grid(nUsed * ff));   // all experts' gate
          pass(enc3, P_moeGU, [B.normed2, V.up.q, V.up.s, B.up8, uMoeGU, uIdx], grid(nUsed * ff));         // all experts' up
          pass(enc3, P_sm, [B.gate8, B.up8, B.hid8, uFFb], Math.ceil(nUsed * ff / 64));                    // silu(gate)·up
          pass(enc3, P_moeDn, [B.hid8, V.down.q, V.down.s, B.h, B.cur, uMoeDnB, uIdx, uWts], grid(d));      // Σ_s w_s·down_s + residual
          dev.queue.submit([enc3.finish()]);
        } else {
          for (const e of idx) { readExpert(l, e, "gate"); readExpert(l, e, "up"); readExpert(l, e, "down"); } // prefetch the chosen experts
          for (const e of idx) {
            const [g, u, dn] = await Promise.all([readExpert(l, e, "gate"), readExpert(l, e, "up"), readExpert(l, e, "down")]);
            dev.queue.writeBuffer(ExpQ.gate, 0, g.q); dev.queue.writeBuffer(ExpS.gate, 0, g.s);
            dev.queue.writeBuffer(ExpQ.up, 0, u.q); dev.queue.writeBuffer(ExpS.up, 0, u.s);
            dev.queue.writeBuffer(ExpQ.down, 0, dn.q); dev.queue.writeBuffer(ExpS.down, 0, dn.s);
            dev.queue.writeBuffer(uAxpy, 0, new Uint32Array([d, fbits(wt.get(e)), 0, 0]));
            const enc3 = dev.createCommandEncoder();
            mmW(enc3, B.normed2, { qbuf: ExpQ.gate, sbuf: ExpS.gate, uni: uMoeIn, N: ff }, B.gate);
            mmW(enc3, B.normed2, { qbuf: ExpQ.up, sbuf: ExpS.up, uni: uMoeIn, N: ff }, B.up);
            pass(enc3, P_sm, [B.gate, B.up, B.hid, uFF], Math.ceil(ff / 64));
            mmW(enc3, B.hid, { qbuf: ExpQ.down, sbuf: ExpS.down, uni: uMoeDn, N: d }, B.mlp);
            pass(enc3, P_axpy, [B.cur, B.mlp, uAxpy], Math.ceil(d / 64));   // B.cur += w_e · expert_out
            dev.queue.submit([enc3.finish()]);
          }
        }
        cur = B.cur;
      }
      const encF = dev.createCommandEncoder();
      rms(encF, cur, "final_norm", B.normed);
      mmW(encF, B.normed, W["lm_head"], B.logits);
      encF.copyBufferToBuffer(B.logits, 0, staging, 0, vocab * 4);
      dev.queue.submit([encF.finish()]);
    } else if (frameGran) {
      // Play the model: page ONE matrix into the frame buffer, run its matmul,
      // submit, repeat. A weight-matmul's submit must flush before the next frame
      // overwrites the buffer (queue order makes the reuse safe). Non-weight ops
      // (norm/rope/attn/silu) ride along in the current encoder.
      let enc = dev.createCommandEncoder();
      // play a frame: flush the encoder (so reuse is safe), then load the matrix
      // from JS (frame) or DISK (opfs) into the frame buffer. opfs read is async.
      const play = async (name) => {
        dev.queue.submit([enc.finish()]); enc = dev.createCommandEncoder();
        if (opfs) { const m = frameMan[name], buf = await opfsStore.read(m.off, m.qlen + m.slen); dev.queue.writeBuffer(RM, 0, buf.subarray(0, m.qlen)); dev.queue.writeBuffer(RMscale, 0, buf.subarray(m.qlen)); dev.queue.writeBuffer(uFr, 0, new Uint32Array([m.K, m.N, m.K / 32, 0])); return { qbuf: RM, sbuf: RMscale, uni: uFr, N: m.N }; }
        const p = FB[name]; dev.queue.writeBuffer(RM, 0, p.q); dev.queue.writeBuffer(RMscale, 0, p.s); return { qbuf: RM, sbuf: RMscale, uni: p.uni, N: p.N };
      };
      for (let l = 0; l < n_layers; l++) {
        rms(enc, cur, `l${l}.attn_norm`, B.normed);
        let w = await play(`l${l}.wq`); if (attnBias) mmAddW(enc, B.normed, w, Nrm[`l${l}.bq`], B.q); else mmW(enc, B.normed, w, B.q);
        if (qkNorm) pass(enc, P_qkn, [B.q, Nrm[`l${l}.q_norm`], uQkn], n_heads);
        pass(enc, P_rope, [B.q, uRopeQ], Math.ceil(n_heads * (hd / 2) / 64));
        w = await play(`l${l}.wk`); if (attnBias) mmAddW(enc, B.normed, w, Nrm[`l${l}.bk`], B.k); else mmW(enc, B.normed, w, B.k);
        if (qkNorm) pass(enc, P_qkn, [B.k, Nrm[`l${l}.k_norm`], uQkn], n_kv_heads);
        pass(enc, P_rope, [B.k, uRopeK], Math.ceil(n_kv_heads * (hd / 2) / 64));
        enc.copyBufferToBuffer(B.k, 0, kcache[l], pos * kv_dim * 4, kv_dim * 4);
        w = await play(`l${l}.wv`); if (attnBias) mmAddW(enc, B.normed, w, Nrm[`l${l}.bv`], B.v); else mmW(enc, B.normed, w, B.v);
        enc.copyBufferToBuffer(B.v, 0, vcache[l], pos * kv_dim * 4, kv_dim * 4);
        pass(enc, P_attn, [B.q, kcache[l], vcache[l], B.attn, uAttn], n_heads);
        w = await play(`l${l}.wo`); mmAddW(enc, B.attn, w, cur, B.h);
        rms(enc, B.h, `l${l}.ffn_norm`, B.normed2);
        w = await play(`l${l}.w_gate`); mmW(enc, B.normed2, w, B.gate);
        w = await play(`l${l}.w_up`); mmW(enc, B.normed2, w, B.up);
        pass(enc, P_sm, [B.gate, B.up, B.hid, uFF], Math.ceil(ff / 64));
        w = await play(`l${l}.w_down`); mmAddW(enc, B.hid, w, B.h, B.cur);
        cur = B.cur;
      }
      rms(enc, cur, "final_norm", B.normed);
      // PLAY the lm_head in row-tiles through the same frame buffer — not resident.
      const lm = opfs ? null : FB["lm_head"], lmM = frameMan["lm_head"];
      const rowQ = bits === 4 ? d / 2 : d, rowS = (d / 32) * 4, T = Math.floor(RM.size / rowQ);
      for (let v0 = 0; v0 < vocab; v0 += T) {
        const rows = Math.min(T, vocab - v0);
        dev.queue.submit([enc.finish()]); enc = dev.createCommandEncoder();
        if (opfs) {
          dev.queue.writeBuffer(RM, 0, await opfsStore.read(lmM.off + v0 * rowQ, rows * rowQ));
          dev.queue.writeBuffer(RMscale, 0, await opfsStore.read(lmM.off + lmM.qlen + v0 * rowS, rows * rowS));
        } else {
          dev.queue.writeBuffer(RM, 0, lm.q.subarray(v0 * rowQ, (v0 + rows) * rowQ));
          dev.queue.writeBuffer(RMscale, 0, new Uint8Array(lm.s.buffer, lm.s.byteOffset + v0 * rowS, rows * rowS));
        }
        dev.queue.writeBuffer(uLm, 0, new Uint32Array([d, rows, d / 32, v0]));
        pass(enc, P_mm, [B.normed, RM, RMscale, B.logits, uLm], grid(rows));
      }
      enc.copyBufferToBuffer(B.logits, 0, staging, 0, vocab * 4);
      dev.queue.submit([enc.finish()]);
    } else if (stream) {
      // page each layer's matrices into the reusable buffers, run that layer,
      // submit, repeat — only one layer is GPU-resident at a time. Buffer reuse
      // is safe: the queue runs writeBuffer(L+1) only after submit(L) finishes.
      // Source is JS heap ("layer") or DISK ("opfs"/"remote"). For disk sources we
      // PREFETCH a window of layers ahead so the storage→host read overlaps the GPU
      // compute of earlier layers (the access pattern is fully predictable), and a
      // bounded RAM cache serves warm layers without re-fetching.
      if (opfs) for (let l = 0; l < Math.min(PREFETCH, n_layers); l++) getLayer(l);
      for (let l = 0; l < n_layers; l++) {
        if (opfs) {                                        // page this layer's packed blob off DISK (prefetched)
          const buf = await getLayer(l);
          if (l + PREFETCH < n_layers) getLayer(l + PREFETCH); // keep the window full
          dev.queue.writeBuffer(RQ, 0, buf.subarray(0, packQbytes));
          dev.queue.writeBuffer(RS, 0, buf.subarray(packQbytes));
          evictBelow(l);
        } else {
          dev.queue.writeBuffer(RQ, 0, Wb[l].q);           // one fat DMA for the whole layer's matrices
          dev.queue.writeBuffer(RS, 0, Wb[l].s);           // + one for all its scales
        }
        // t2: this layer's per-role scalar scales into the reused uniforms (matmul reads scale from uni.w).
        if (t2stream) for (const role of ROLES) { const L = packLayout[role]; dev.queue.writeBuffer(R[role].uni, 0, new Uint32Array([L.K, L.N, L.K / 16, t2scales[l][role]])); }
        const enc = dev.createCommandEncoder();
        cur = layerBody(enc, l, cur, (role) => R[role]);
        dev.queue.submit([enc.finish()]);
      }
      const encF = dev.createCommandEncoder();
      rms(encF, cur, "final_norm", B.normed);
      mmW(encF, B.normed, W["lm_head"], B.logits);
      encF.copyBufferToBuffer(B.logits, 0, staging, 0, vocab * 4);
      dev.queue.submit([encF.finish()]);
    } else {
      const enc = dev.createCommandEncoder();
      const oneP = ONEPASS() && !(PROF && PROF.active) && !_calib;   // profiling/calibration need per-pass boundaries/copies
      if (oneP) openPass = enc.beginComputePass();
      for (let l = 0; l < n_layers; l++) cur = layerBody(enc, l, cur, (role) => W[`l${l}.${role}`]);
      rms(enc, cur, "final_norm", B.normed);
      mmW(enc, B.normed, W["lm_head"], B.logits);
      if (oneP) { openPass.end(); openPass = null; }
      if (!noRead) enc.copyBufferToBuffer(B.logits, 0, staging, 0, vocab * 4);
      dev.queue.submit([enc.finish()]);
    }
    if (noRead) { timing = { encode: tS - tE, exec: performance.now() - tS }; pos++; return null; }
    await staging.mapAsync(GPUMapMode.READ);
    const logits = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    if (PROF && PROF.active && PROF.i > 0) {                        // resolve + aggregate per-pipeline GPU ns → window.__profileData
      const e = dev.createCommandEncoder(); e.resolveQuerySet(PROF.qs, 0, PROF.i, PROF.buf, 0); e.copyBufferToBuffer(PROF.buf, 0, PROF.stg, 0, PROF.i * 8); dev.queue.submit([e.finish()]);
      await PROF.stg.mapAsync(GPUMapMode.READ);
      const ts = new BigInt64Array(PROF.stg.getMappedRange().slice(0)); PROF.stg.unmap();
      const agg = {}; let sum = 0, t0 = ts[0], t1 = ts[PROF.i - 1];
      for (let k = 0; k < PROF.i; k += 2) { const ms = Number(ts[k + 1] - ts[k]) / 1e6; const tg = PROF.tags[k >> 1]; (agg[tg] = agg[tg] || { ms: 0, n: 0 }).ms += ms; agg[tg].n++; sum += ms; }
      window.__profileData = { passes: agg, passSumMs: sum, gpuSpanMs: Number(t1 - t0) / 1e6, nPasses: PROF.i >> 1 };
    }
    if (_capHidden) {                                       // Atlas-Probe: read back the final hidden state for this token
      hidStaging = hidStaging || dev.createBuffer({ size: d * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const e2 = dev.createCommandEncoder(); e2.copyBufferToBuffer(B.normed, 0, hidStaging, 0, d * 4); dev.queue.submit([e2.finish()]);
      await hidStaging.mapAsync(GPUMapMode.READ); _capHidden.push(Array.from(new Float32Array(hidStaging.getMappedRange().slice(0)))); hidStaging.unmap();
    }
    timing = { encode: tS - tE, exec: performance.now() - tS };
    pos++;
    return logits;
  }

  function reset() { pos = 0; cached = []; lastLogits = null; }
  // KV-COMMONS prefix pin: rewind the decode cursor to a pinned prefix length L, KEEPING the
  // GPU-resident K/V for positions [0..L) intact (byte-identical to what re-prefilling that prefix
  // would produce — same tokens, same positions, deterministic). The next sync/decode call sees
  // cached==prefix and steps ONLY the new tokens, so a shared prefix (system prompt, RAG context,
  // few-shot block) is prefilled ONCE and reused across turns/conversations instead of being nuked
  // by sync()'s divergence-reset. This is the in-session special case of a durable KV commons: the
  // restore-from-bytes path (dumpKV → holo-kappa-v2, keyed by (weightsκ,tokenizerκ,prefixκ)) reduces
  // to this once the bytes are resident. No-op guards keep it safe: L is clamped to [0, cached.length].
  function truncateTo(L) { L = Math.max(0, Math.min(L | 0, cached.length)); cached.length = L; pos = L; lastLogits = null; return L; }

  // dev probe: read back a layer's KV cache rows (+ the current B.q) for offline quantization
  // experiments (the lattice-coded-KV gate). Read-only; no effect on inference state.
  async function dumpKV(l, rows) {
    const n = Math.min(rows || pos, pos), bytes = n * kv_dim * 4;
    const stg = dev.createBuffer({ size: bytes * 2 + q_dim * 4, usage: U.MAP_READ | U.COPY_DST });
    const e = dev.createCommandEncoder();
    e.copyBufferToBuffer(kcache[l], 0, stg, 0, bytes);
    e.copyBufferToBuffer(vcache[l], 0, stg, bytes, bytes);
    e.copyBufferToBuffer(B.q, 0, stg, bytes * 2, q_dim * 4);
    dev.queue.submit([e.finish()]);
    await stg.mapAsync(GPUMapMode.READ);
    const all = new Float32Array(stg.getMappedRange().slice(0)); stg.unmap(); stg.destroy();
    return { k: all.slice(0, n * kv_dim), v: all.slice(n * kv_dim, 2 * n * kv_dim), q: all.slice(2 * n * kv_dim), n, kv_dim, n_heads, n_kv_heads, hd };
  }

  // ── DURABLE KV COMMONS (I1): dump/restore the whole prefix K/V state as ONE byte blob ──
  // Every cache region is pos-major from offset 0, so positions [0..L) of each side of each layer
  // are a single contiguous copy. The layout string travels with the bytes AND is folded into the
  // commons key by the caller — a format/dims change can never mis-restore (it just misses).
  const kvRegion = (l, rows) => rows * ((kv4 && l > 0) ? kvS : kv_dim) * 4;
  const kvLayoutOf = (L) => `kvc1|kv4:${kv4 ? 1 : 0}|kvd:${kv_dim}|layers:${n_layers}|L:${L | 0}`;
  async function dumpState(L) {
    L = Math.min(L | 0, pos);
    if (L <= 1) return null;
    let total = 0; for (let l = 0; l < n_layers; l++) total += 2 * kvRegion(l, L);
    const stg = dev.createBuffer({ size: total, usage: U.MAP_READ | U.COPY_DST });
    const e = dev.createCommandEncoder(); let off = 0;
    for (let l = 0; l < n_layers; l++) {
      const nb = kvRegion(l, L);
      e.copyBufferToBuffer(kcache[l], 0, stg, off, nb); off += nb;
      e.copyBufferToBuffer(vcache[l], 0, stg, off, nb); off += nb;
    }
    dev.queue.submit([e.finish()]);
    await stg.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(stg.getMappedRange().slice(0)); stg.unmap(); stg.destroy();
    return { layout: kvLayoutOf(L), L, bytes };
  }
  // Restores positions [0..L) then sets the cursor to L-1: the caller's next sync() re-derives the
  // LAST prefix token through the normal step path — byte-identical by determinism — which both
  // cross-checks the restore against live compute state and leaves valid resident logits for the
  // decode head. Returns the resident length (L-1), or 0 (state untouched/reset) on any mismatch.
  async function restoreState(tokens, blob) {
    const L = blob && blob.L | 0;
    if (!L || L < 2 || L > tokens.length || L > cap || blob.layout !== kvLayoutOf(L)) return 0;
    let total = 0; for (let l = 0; l < n_layers; l++) total += 2 * kvRegion(l, L);
    if (blob.bytes.byteLength !== total) return 0;
    let off = 0;
    for (let l = 0; l < n_layers; l++) {
      const nb = kvRegion(l, L);
      dev.queue.writeBuffer(kcache[l], 0, blob.bytes, off, nb); off += nb;
      dev.queue.writeBuffer(vcache[l], 0, blob.bytes, off, nb); off += nb;
    }
    cached = tokens.slice(0, L - 1); pos = L - 1; lastLogits = null;
    return L - 1;
  }

  async function sync(tokens, forDecode = false) {
    let p = 0;
    while (p < cached.length && p < tokens.length && cached[p] === tokens[p]) p++;
    if (p < cached.length) { reset(); p = 0; }
    // raw-logits callers need a re-derive when decode() ended without CPU logits; decode() itself
    // recomputes logits on-GPU from the ring — skipping this guard kills a QUADRATIC re-prefill
    // in chunked decode loops (measured 151 → ~16 ms/tok).
    if (!forDecode && p === tokens.length && lastLogits === null && tokens.length > 0) { reset(); p = 0; }
    // PREFILL FAST PATH (resident-dense): ring prefill — GPU-embed, BATCH tokens/submit, no per-token
    // fence, lm_head only on the last token. Falls back to the per-step loop for streamed/MoE models
    // and for the dev probes that snapshot per-token state (_capHidden / Hessian calibration).
    const ringOk = typeof window === "undefined" || window.__ringprefill !== false;   // dev A/B hook
    if (ringOk && p < tokens.length && denseFast() && !_capHidden && !_calib) {
      const r = await prefillGPU(tokens.slice(p), p, !forDecode);
      lastLogits = forDecode ? null : r;
      return;
    }
    // slow path: one step() per token; logits readback only where a caller can read them (the last).
    for (let i = p; i < tokens.length; i++) {
      const needRead = !forDecode && i === tokens.length - 1;
      const r = await step(tokens[i], !needRead);
      if (needRead) lastLogits = r;
      cached.push(tokens[i]);
      if (!needRead && (i & 15) === 15) await dev.queue.onSubmittedWorkDone();
    }
    if (forDecode) lastLogits = null;
  }

  function argmax(a) { let bi = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[bi]) bi = i; return bi; }

  // Greedy decode with a repetition penalty (deterministic → a teleported mind
  // still continues identically). Penalizing recently-seen tokens breaks the
  // greedy loops a small base model otherwise falls into.
  async function generate(prompt, maxNew, repPenalty = 1.3) {
    await sync(prompt);
    let logits = lastLogits, seq = prompt.slice();
    for (let n = 0; n < maxNew; n++) {
      if (seq.length >= cap) break;
      const pen = logits.slice();                       // keep cached logits raw
      for (const id of new Set(seq.slice(Math.max(0, seq.length - 64)))) pen[id] = Math.fround(pen[id] > 0 ? pen[id] / repPenalty : pen[id] * repPenalty);   // f32 like the GPU head — heads must tie-break identically
      const next = argmax(pen);
      if (next === eos) break;                          // EOS → stop
      seq.push(next);
      logits = await step(next);
      lastLogits = logits;
      cached.push(next);
    }
    return seq;
  }

  // BATCHED GPU greedy decode: the whole [penalty → argmax → append → embed → forward] chain runs
  // ON the GPU for BATCH tokens per submit — the token ids live in a GPU seq-ring, the embed lookup
  // is a kernel, and per-position uniforms are prewritten (positions are deterministic). ONE fence
  // per BATCH tokens instead of per token: the measured ~20 ms/token submit/fence tax drops ~6×.
  // Greedy semantics match generate() exactly (same penalty formula over the last-64 unique window
  // — PENALTY2 dedups by first occurrence — and the same first-max argmax tie-break).
  let DEC = null;
  const BATCH = 6;       // tokens per submit; with the pipelined loop below the fence is off the critical path
  const denseFast = () => !(stream || frameGran || moe || (bits === 3 && !q3f));
  function ensureDEC() {
    if (DEC) return DEC;
    const mk = () => Array.from({ length: BATCH }, () => ubuf(new Uint32Array(4)));
    const par2 = (f) => [f(), f()];                                // double-buffered per-parity resources (pipelined batches)
    const eqB = dev.createBuffer({ size: embedQ.byteLength, usage: U.STORAGE | U.COPY_DST });
    dev.queue.writeBuffer(eqB, 0, embedQ.buffer, embedQ.byteOffset, embedQ.byteLength);
    const esB = dev.createBuffer({ size: embedS.byteLength, usage: U.STORAGE | U.COPY_DST });
    dev.queue.writeBuffer(esB, 0, embedS.buffer, embedS.byteOffset, embedS.byteLength);
    DEC = {
      pen2: pipe(PENALTY2, "pen2"), a1: pipe(ARGMAX1, "amax1"), a2: pipe(ARGMAX2, "amax2"),
      app: pipe(APPEND, "append"), emb: pipe(EMBED(bits, q3f), "embed"),
      eqB, esB, ring: dev.createBuffer({ size: Math.max(cap, 1024) * 4, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC }),
      uA1: ubuf(new Uint32Array([vocab, 0, 0, 0])), tmp: sbuf(512),
      out: dev.createBuffer({ size: 16, usage: U.STORAGE | U.COPY_SRC }),
      stg: par2(() => dev.createBuffer({ size: BATCH * 4, usage: U.MAP_READ | U.COPY_DST })),
      uP: par2(mk), uE: par2(mk), uRQ: par2(mk), uRK: par2(mk), uA: par2(mk),
    };
    return DEC;
  }
  // ── RING PREFILL: prompt tokens are KNOWN, so prefill rides the same GPU-embed ring as decode —
  // BATCH tokens per submit, one compute pass each, NO per-token fence, and (the big cut) NO lm_head
  // except for the last token (the old per-step prefill paid the model's largest matmul per prompt
  // token for logits nobody read). Byte-identical KV to step()-prefill: same kernels, same order.
  async function prefillGPU(newTokens, base0, needLogits) {
    ensureDEC();
    const ONE = ONEPASS();
    const tJs0 = performance.now(); let drainMs = 0;
    dev.queue.writeBuffer(DEC.ring, base0 * 4, new Uint32Array(newTokens));
    let par = 0, subs = 0;
    for (let off = 0; off < newTokens.length; off += BATCH) {
      const n = Math.min(BATCH, newTokens.length - off);
      const base = base0 + off, pos0 = pos + off;
      const uE = DEC.uE[par], uRQ = DEC.uRQ[par], uRK = DEC.uRK[par], uA = DEC.uA[par];
      for (let k = 0; k < n; k++) {
        dev.queue.writeBuffer(uE[k], 0, new Uint32Array([base + k, d, 0, 0]));
        dev.queue.writeBuffer(uRQ[k], 0, new Uint32Array([n_heads, hd, pos0 + k, n_kv_heads]));
        dev.queue.writeBuffer(uRK[k], 0, new Uint32Array([n_kv_heads, hd, pos0 + k, 0]));
        dev.queue.writeBuffer(uA[k], 0, new Uint32Array([n_heads, n_kv_heads, hd, pos0 + k]));
      }
      const enc = dev.createCommandEncoder();
      if (ONE) openPass = enc.beginComputePass();
      for (let k = 0; k < n; k++) {
        pass(enc, DEC.emb, [DEC.ring, DEC.eqB, DEC.esB, B.x, uE[k]], Math.ceil(d / 256));
        let cur = B.x;
        const up = { ropeQ: uRQ[k], ropeK: uRK[k], attn: uA[k], pos: pos0 + k };
        for (let l = 0; l < n_layers; l++) cur = layerBody(enc, l, cur, (role) => W[`l${l}.${role}`], up);
        if (off + k === newTokens.length - 1) {                    // logits only where they can be read (last token)
          rms(enc, cur, "final_norm", B.normed);
          mmW(enc, B.normed, W["lm_head"], B.logits);
        }
      }
      if (ONE) { openPass.end(); openPass = null; }
      if (off + n === newTokens.length && needLogits) enc.copyBufferToBuffer(B.logits, 0, staging, 0, vocab * 4);
      dev.queue.submit([enc.finish()]);
      par ^= 1;
      if ((++subs & 15) === 0) { const t = performance.now(); await dev.queue.onSubmittedWorkDone(); drainMs += performance.now() - t; }   // bounded queue depth
    }
    const encodeMs = performance.now() - tJs0 - drainMs;
    pos += newTokens.length;
    for (const t of newTokens) cached.push(t);
    let logits = null;
    const tTail = performance.now();
    if (needLogits) {
      await staging.mapAsync(GPUMapMode.READ);
      logits = new Float32Array(staging.getMappedRange().slice(0)); staging.unmap();
    } else {
      await dev.queue.onSubmittedWorkDone();                       // honest cost: prefill "done" = KV resident
    }
    if (typeof window !== "undefined") window.__prefStats = { n: newTokens.length, encodeMs: +encodeMs.toFixed(1), drainMs: +drainMs.toFixed(1), tailMs: +(performance.now() - tTail).toFixed(1) };
    return logits;
  }
  async function decode(prompt, maxNew, repPenalty = 1.3, onTok = null) {
    if (!denseFast()) {                                            // GPU-embed variants cover q3f/q4/q8
      const seq = await generate(prompt, maxNew, repPenalty);
      if (onTok && seq.length > prompt.length) onTok(seq.slice(prompt.length), seq.length);
      return seq;
    }
    ensureDEC();
    await sync(prompt, true);
    const seq = prompt.slice();
    dev.queue.writeBuffer(DEC.ring, 0, new Uint32Array(seq));      // ring ← current seq (penalty window + embed source)
    const ONE = ONEPASS();
    const pos0Start = pos, baseStart = seq.length;
    // ── PIPELINED DATAFLOW LOOP: keep up to 2 batches in flight — batch N+1 is encoded+submitted
    // BEFORE batch N's 4-byte fence is read, so the GPU never idles on the JS fence/detok/UI work.
    // Positions and ring indices are deterministic, so batch N+1 needs nothing from batch N on the
    // host side (the token ids it consumes live in the GPU ring — data triggers compute, not JS).
    // The first batch is 1 token when streaming (onTok) so the first word lands at 1-token latency.
    // On EOS/stop, an already-submitted speculative batch is simply abandoned: pos/seq rewind below;
    // its ring/KV writes beyond pos are never read (same invariant as the old mid-batch EOS trim).
    const submitBatch = (n, base, pos0, par) => {
      const uP = DEC.uP[par], uE = DEC.uE[par], uRQ = DEC.uRQ[par], uRK = DEC.uRK[par], uA = DEC.uA[par];
      for (let k = 0; k < n; k++) {                                // prewritten per-step uniforms (queued writes, no fence)
        dev.queue.writeBuffer(uP[k], 0, new Uint32Array([base + k, fbits(repPenalty), 0, 0]));
        dev.queue.writeBuffer(uE[k], 0, new Uint32Array([base + k, d, 0, 0]));
        dev.queue.writeBuffer(uRQ[k], 0, new Uint32Array([n_heads, hd, pos0 + k, n_kv_heads]));   // .w = nkv (fused ROPE2)
        dev.queue.writeBuffer(uRK[k], 0, new Uint32Array([n_kv_heads, hd, pos0 + k, 0]));
        dev.queue.writeBuffer(uA[k], 0, new Uint32Array([n_heads, n_kv_heads, hd, pos0 + k]));
      }
      const enc = dev.createCommandEncoder();
      if (ONE) openPass = enc.beginComputePass();
      for (let k = 0; k < n; k++) {
        pass(enc, DEC.pen2, [B.logits, DEC.ring, uP[k]], 1);
        pass(enc, DEC.a1, [B.logits, DEC.tmp, DEC.uA1], 256);
        pass(enc, DEC.a2, [DEC.tmp, DEC.out], 1);
        pass(enc, DEC.app, [DEC.ring, DEC.out, uE[k]], 1);         // ring[base+k] = winner
        pass(enc, DEC.emb, [DEC.ring, DEC.eqB, DEC.esB, B.x, uE[k]], Math.ceil(d / 256));
        let cur = B.x;
        const up = { ropeQ: uRQ[k], ropeK: uRK[k], attn: uA[k], pos: pos0 + k };
        for (let l = 0; l < n_layers; l++) cur = layerBody(enc, l, cur, (role) => W[`l${l}.${role}`], up);
        rms(enc, cur, "final_norm", B.normed);
        mmW(enc, B.normed, W["lm_head"], B.logits);
      }
      if (ONE) { openPass.end(); openPass = null; }
      enc.copyBufferToBuffer(DEC.ring, base * 4, DEC.stg[par], 0, n * 4);
      dev.queue.submit([enc.finish()]);
      pos = pos0 + n;
    };
    let predLen = seq.length, predPos = pos, par = 0, done = false, firstBatch = !!onTok;
    const inflight = [];
    while (!done) {
      while (!done && inflight.length < 2 && predLen - prompt.length < maxNew && predLen < cap) {
        const n = Math.min(firstBatch ? 1 : BATCH, maxNew - (predLen - prompt.length), cap - predLen);
        firstBatch = false;
        submitBatch(n, predLen, predPos, par);
        inflight.push({ n, par });
        predLen += n; predPos += n; par ^= 1;
      }
      const b = inflight.shift();
      if (!b) break;
      await DEC.stg[b.par].mapAsync(GPUMapMode.READ);
      const win = new Uint32Array(DEC.stg[b.par].getMappedRange().slice(0)).subarray(0, b.n); DEC.stg[b.par].unmap();
      const got = [];
      for (let k = 0; k < b.n; k++) {
        if (win[k] === eos) { done = true; break; }
        seq.push(win[k]); cached.push(win[k]); got.push(win[k]);
      }
      if (got.length && onTok && onTok(got, seq.length) === false) done = true;   // caller stop (abort/stop-text)
    }
    pos = pos0Start + (seq.length - baseStart);                    // rewind past EOS/stop + any abandoned speculative batch
    lastLogits = null;                                             // raw-logits callers re-derive via sync()'s guard
    return seq;
  }

  // ── SPECULATIVE DECODE (n-gram draft + batched-k verify; unfused/kv4 path) ──────────────
  // All k window inputs are known ⇒ one prefill-like forward verifies them; weights are read
  // ONCE per pass for all rows. Greedy verification is EXACT: the committed sequence equals
  // sequential decode byte-for-byte by construction (gate G2 asserts it).
  const KX = 8;
  let SP = null;
  let _drafter = null;   // pluggable learned drafter: (seq, max) => ids (sync or async). null = n-gram baseline.
  function specInit() {
    if (SP) return SP;
    if (moe || stream || !kv4 || attnBias || qkNorm) throw new Error("specDecode: resident + kv4, no attn-bias/qk-norm (for now)");
    // BitNet (subNorm+bitlinear) and fusedT2-resident models ARE supported: the spec forward below is
    // always UNFUSED (specMM per matrix) and mirrors the resident unfused BitNet layer's extra norms.
    const sb8 = (n) => dev.createBuffer({ size: n * 4, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
    SP = {
      x: sb8(KX * d), normed: sb8(KX * d), q: sb8(KX * q_dim), k: sb8(KX * kv_dim), v: sb8(KX * kv_dim),
      attn: sb8(KX * q_dim), h: sb8(KX * d), normed2: sb8(KX * d), gate: sb8(KX * ff), up: sb8(KX * ff),
      hid: sb8(KX * ff), cur: sb8(KX * d), logits: sb8(KX * vocab), amax: sb8(KX), amaxStg: dev.createBuffer({ size: KX * 4, usage: U.MAP_READ | U.COPY_DST }),
      attn2: sb8(KX * q_dim), hid2: sb8(KX * ff), nb1: sb8(KX * d), nb2: sb8(KX * d),   // BitNet sub-norm + BitLinear input-norm outputs (batched; RMS must not run in place)
      tmp: sbuf(65536 * 2),
      P_rmsk: pipe(RMSK, "rmsk"), P_ropek: pipe(ROPEK(ropeLit), "ropek"), P_kvqk: pipe(KVQK(kv_dim), "kvqk"),
      P_attnqk: pipe(ATTNQK(cap, kv_dim), "attnqk"), P_attnk: pipe(ATTNK(cap), "attnk"),
      P_t2k: pipe(mmT2KK(false, KX), "t2k"), P_t2ka: pipe(mmT2KK(true, KX), "t2ka"),
      P_t2k2: pipe(mmT2KK(false, 2), "t2k2"), P_t2ka2: pipe(mmT2KK(true, 2), "t2ka2"), P_q3k2: pipe(mmQ3KK(2), "q3k2"),
      P_q3k: pipe(mmQ3KK(KX), "q3k"),
      uD: ubuf(new Uint32Array([d, 0, 0, 0])), uQd: ubuf(new Uint32Array([q_dim, 0, 0, 0])), uFFn: ubuf(new Uint32Array([ff, 0, 0, 0])), uRQ: ubuf(new Uint32Array([4])), uRK: ubuf(new Uint32Array([4])),
      uAT: ubuf(new Uint32Array([4])), uFFK: ubuf(new Uint32Array([4])),
      uPen: Array.from({ length: KX }, () => ubuf(new Uint32Array(4))), uRow: Array.from({ length: KX }, (_, i) => ubuf(new Uint32Array([i, 0, 0, 0]))), uV: ubuf(new Uint32Array([vocab, 0, 0, 0])),
      cold: 0, stats: { windows: 0, drafted: 0, accepted: 0 },
    };
    if (hasT2R) { SP.P_t2rk = pipe(mmT2RKK(false, KX), "t2rk"); SP.P_t2rka = pipe(mmT2RKK(true, KX), "t2rka"); SP.P_t2rk2 = pipe(mmT2RKK(false, 2), "t2rk2"); SP.P_t2rka2 = pipe(mmT2RKK(true, 2), "t2rka2"); }
    // DP4a integer-dot path (opt-in via window.__dp4a; t2 weights only). dot4I8Packed is core WGSL here;
    // on a device without it these compiles would error — gate creation on the flag being pre-set.
    if (typeof window === "undefined" || window.__dp4a) {
      SP.aq = sb8(KX * (Math.max(d, ff) >> 2)); SP.asc = sb8(KX * (Math.max(d, ff) >> 5));
      SP.P_actq = pipe(ACTQUANTK, "actq");
      SP.P_t2dp = pipe(mmT2DP4A(false, KX), "t2dp"); SP.P_t2dpa = pipe(mmT2DP4A(true, KX), "t2dpa");
      SP.P_t2dp2 = pipe(mmT2DP4A(false, 2), "t2dp2"); SP.P_t2dpa2 = pipe(mmT2DP4A(true, 2), "t2dpa2");
      SP.hasDp4a = true;
    }
    return SP;
  }
  const embedRowF32 = (token, out, off) => {
    const eq32 = new Uint32Array(embedQ.buffer, embedQ.byteOffset, embedQ.byteLength >> 2), bb = token * (d / 32), sb = token * (d / 32);
    for (let i = 0; i < d; i++) {
      const bp = (bb + (i >> 5)) * 3, j = i & 31; let q;
      if (j < 10) q = (eq32[bp] >>> (j * 3)) & 7;
      else if (j < 20) q = (eq32[bp + 1] >>> ((j - 10) * 3)) & 7;
      else if (j < 30) q = (eq32[bp + 2] >>> ((j - 20) * 3)) & 7;
      else { const sp = (eq32[bp] >>> 30) | ((eq32[bp + 1] >>> 30) << 2) | ((eq32[bp + 2] >>> 30) << 4); q = j === 30 ? sp & 7 : (sp >>> 3) & 7; }
      out[off + i] = (q - 3) * embedS[sb + (i >> 5)];
    }
  };
  const specMM = (enc, ws, xb, ob, m, rb) => {                    // batched GEMM, route by fmt; m<=2 takes the narrow (KX=2) pipelines
    const g = grid(Math.ceil(ws.N / 4)); const nr = m <= 2;
    if (ws.t2 && SP.hasDp4a && typeof window !== "undefined" && window.__dp4a) {   // DP4a integer-dot: quant xb→int8 (reuses ws.uni's K), then dot4I8Packed
      pass(enc, SP.P_actq, [xb, SP.aq, SP.asc, ws.uni], [1, m]);
      if (rb) pass(enc, nr ? SP.P_t2dpa2 : SP.P_t2dpa, [SP.aq, ws.qbuf, SP.asc, rb, ob, ws.uni], g);
      else    pass(enc, nr ? SP.P_t2dp2  : SP.P_t2dp,  [SP.aq, ws.qbuf, SP.asc, ob, ws.uni], g);
      return;
    }
    if (ws.t2) pass(enc, rb ? (nr ? SP.P_t2ka2 : SP.P_t2ka) : (nr ? SP.P_t2k2 : SP.P_t2k), rb ? [xb, ws.qbuf, rb, ob, ws.uni] : [xb, ws.qbuf, ob, ws.uni], g);
    else if (ws.t2r) pass(enc, rb ? (nr ? SP.P_t2rka2 : SP.P_t2rka) : (nr ? SP.P_t2rk2 : SP.P_t2rk), rb ? [xb, ws.qbuf, ws.sbuf, rb, ob, ws.uni] : [xb, ws.qbuf, ws.sbuf, ob, ws.uni], g);
    else pass(enc, nr ? SP.P_q3k2 : SP.P_q3k, [xb, ws.qbuf, ws.sbuf, ob, ws.uni], g);
  };
  function ngramDraft(seq, max) {                                 // longest suffix match (3→1-gram) proposes following ids
    const n = seq.length; if (n < 4) return [];
    for (let g = 3; g >= 1; g--) {
      const a = seq.slice(n - g);
      for (let i = n - g - 1; i >= 0; i--) {
        let hit = true; for (let j = 0; j < g; j++) if (seq[i + j] !== a[j]) { hit = false; break; }
        if (hit) { const out = seq.slice(i + g, i + g + max); if (out.length) return out; }
      }
    }
    return [];
  }
  async function captureHidden(tokens) { reset(); _capHidden = []; try { await sync(tokens); return _capHidden; } finally { _capHidden = null; } }
  async function specDecode(prompt, maxNew, repPenalty = 1.3, onCommit = null) {
    specInit();
    let seq = prompt.slice();
    await sync(seq.slice(0, -1));                                 // prefill all but the pending token
    let tKnown = seq[seq.length - 1];                             // committed, not yet forwarded
    const ring = DEC && DEC.ring ? DEC.ring : null;               // reuse decode head ring when built…
    const ringBuf = ring || (specInit().ringB = SP.ringB || (SP.ringB = dev.createBuffer({ size: cap * 4, usage: U.STORAGE | U.COPY_DST })));
    dev.queue.writeBuffer(ringBuf, 0, new Uint32Array(seq));
    const xHost = new Float32Array(KX * d);
    const P_pen = pipe(PENALTY2, "pen2k"), P_a1 = pipe(ARGMAX1, "a1k"), P_a2 = pipe(ARGMAX2K, "a2k");
    while (seq.length - prompt.length < maxNew && pos + KX + 2 < cap) {
      let drafts = [];
      if (!SP.stats.noDraft && SP.cold <= 0) {                    // pluggable drafter; n-gram is the fallback
        const dfn = _drafter || ngramDraft;
        drafts = (await dfn(seq, KX - 1)) || [];
        if (drafts.length === 0 && _drafter) drafts = ngramDraft(seq, KX - 1);
        if (drafts.length > KX - 1) drafts = drafts.slice(0, KX - 1);   // window is [tKnown, ...drafts] ≤ KX
      }
      const win = [tKnown, ...drafts]; const m = win.length;
      const base = pos;
      SP.stats.windows++; SP.stats.drafted += drafts.length;
      dev.queue.writeBuffer(ringBuf, base * 4, new Uint32Array(win));   // provisional ring rows
      for (let i = 0; i < m; i++) embedRowF32(win[i], xHost, i * d);
      dev.queue.writeBuffer(SP.x, 0, xHost, 0, m * d);
      dev.queue.writeBuffer(SP.uRQ, 0, new Uint32Array([n_heads, hd, base, q_dim]));
      dev.queue.writeBuffer(SP.uRK, 0, new Uint32Array([n_kv_heads, hd, base, kv_dim]));
      dev.queue.writeBuffer(SP.uAT, 0, new Uint32Array([n_heads, n_kv_heads, hd, base]));
      dev.queue.writeBuffer(SP.uFFK, 0, new Uint32Array([m * ff, 0, 0, 0]));
      for (let i = 0; i < m; i++) dev.queue.writeBuffer(SP.uPen[i], 0, new Uint32Array([base + i + 1, fbits(repPenalty), 0, 0]));
      const enc = dev.createCommandEncoder();
      let cur = SP.x;
      for (let l = 0; l < n_layers; l++) {
        const W_ = (role) => W[`l${l}.${role}`];
        pass(enc, SP.P_rmsk, [cur, Nrm[`l${l}.attn_norm`], SP.normed, SP.uD], [1, m]);
        let qkvIn = SP.normed;
        if (bitlinear) { pass(enc, SP.P_rmsk, [SP.normed, Nrm["__unit_d"], SP.nb1, SP.uD], [1, m]); qkvIn = SP.nb1; }   // BitLinear weightless norm into q/k/v
        specMM(enc, W_("wq"), qkvIn, SP.q, m); specMM(enc, W_("wk"), qkvIn, SP.k, m); specMM(enc, W_("wv"), qkvIn, SP.v, m);
        pass(enc, SP.P_ropek, [SP.q, SP.uRQ], [Math.ceil(n_heads * (hd / 2) / 64), m]);
        pass(enc, SP.P_ropek, [SP.k, SP.uRK], [Math.ceil(n_kv_heads * (hd / 2) / 64), m]);
        if (l === 0) {                                            // layer 0: f32 cache
          for (let i = 0; i < m; i++) { enc.copyBufferToBuffer(SP.k, i * kv_dim * 4, kcache[0], (base + i) * kv_dim * 4, kv_dim * 4); enc.copyBufferToBuffer(SP.v, i * kv_dim * 4, vcache[0], (base + i) * kv_dim * 4, kv_dim * 4); }
          pass(enc, SP.P_attnk, [SP.q, kcache[0], vcache[0], SP.attn, SP.uAT], [n_heads, m]);
        } else {
          pass(enc, SP.P_kvqk, [SP.k, kcache[l], SP.uAT], [1, m]);
          pass(enc, SP.P_kvqk, [SP.v, vcache[l], SP.uAT], [1, m]);
          pass(enc, SP.P_attnqk, [SP.q, kcache[l], vcache[l], SP.attn, SP.uAT], [n_heads, m]);
        }
        let attnO = SP.attn;
        if (subNorm) { pass(enc, SP.P_rmsk, [SP.attn, Nrm[`l${l}.attn_sub_norm`], SP.attn2, SP.uQd], [1, m]); attnO = SP.attn2; }        // BitNet: norm before the o-projection
        else if (bitlinear) { pass(enc, SP.P_rmsk, [SP.attn, Nrm["__unit_qd"], SP.attn2, SP.uQd], [1, m]); attnO = SP.attn2; }            // BitLinear: weightless norm into wo
        specMM(enc, W_("wo"), attnO, SP.h, m, cur);
        pass(enc, SP.P_rmsk, [SP.h, Nrm[`l${l}.ffn_norm`], SP.normed2, SP.uD], [1, m]);
        let guIn = SP.normed2;
        if (bitlinear) { pass(enc, SP.P_rmsk, [SP.normed2, Nrm["__unit_d"], SP.nb2, SP.uD], [1, m]); guIn = SP.nb2; }                       // BitLinear: weightless norm into gate/up
        specMM(enc, W_("w_gate"), guIn, SP.gate, m); specMM(enc, W_("w_up"), guIn, SP.up, m);
        pass(enc, P_sm, [SP.gate, SP.up, SP.hid, SP.uFFK], Math.ceil(m * ff / 64));
        let hidO = SP.hid;
        if (subNorm) { pass(enc, SP.P_rmsk, [SP.hid, Nrm[`l${l}.ffn_sub_norm`], SP.hid2, SP.uFFn], [1, m]); hidO = SP.hid2; }              // BitNet: norm before the down-projection
        else if (bitlinear) { pass(enc, SP.P_rmsk, [SP.hid, Nrm["__unit_ff"], SP.hid2, SP.uFFn], [1, m]); hidO = SP.hid2; }                // BitLinear: weightless norm into w_down
        specMM(enc, W_("w_down"), hidO, SP.cur, m, SP.h);
        cur = SP.cur; if (l < n_layers - 1) { const t_ = SP.x; SP.x = SP.cur; SP.cur = t_; }
      }
      pass(enc, SP.P_rmsk, [cur, Nrm["final_norm"], SP.normed, SP.uD], [1, m]);
      specMM(enc, W["lm_head"], SP.normed, SP.logits, m);
      for (let i = 0; i < m; i++) {                               // per-row penalty + argmax (sub-range bindings)
        const lr = { buffer: SP.logits, offset: i * vocab * 4, size: vocab * 4 };
        pass(enc, P_pen, [lr, ringBuf, SP.uPen[i]], 1);
        pass(enc, P_a1, [lr, SP.tmp, SP.uV], 256);
        pass(enc, P_a2, [SP.tmp, SP.amax, SP.uRow[i]], 1);
      }
      enc.copyBufferToBuffer(SP.amax, 0, SP.amaxStg, 0, m * 4);
      dev.queue.submit([enc.finish()]);
      await SP.amaxStg.mapAsync(GPUMapMode.READ);
      const out = new Uint32Array(SP.amaxStg.getMappedRange().slice(0)).subarray(0, m); SP.amaxStg.unmap();
      let a = 0, expect = out[0], done = false;
      const commit = [];
      for (let i = 1; i < m; i++) { if (win[i] === expect) { commit.push(expect); expect = out[i]; a++; } else break; }
      commit.push(expect);
      SP.stats.accepted += a;
      if (drafts.length && a === 0) SP.cold = 3; else if (SP.cold > 0) SP.cold--;
      for (const tk of commit) { if (tk === eos) { done = true; break; } seq.push(tk); cached.push(tk); if (onCommit && onCommit(tk) === false) { done = true; break; } }
      pos = base + 1 + a;                                         // rows kept: row0 + accepted; stale KV beyond pos never read
      dev.queue.writeBuffer(ringBuf, (base + 1 + a) * 4, new Uint32Array([expect]));   // correct the ring where the draft diverged
      tKnown = expect;
      if (done) break;
    }
    lastLogits = null;
    if (seq.length - prompt.length > maxNew) seq.length = prompt.length + maxNew;   // window overshoot trim (prefix property keeps byte-exactness)
    return seq;
  }
  // Atlas/E₈ calibration (ADR-0054): run a corpus and collect each layer's ATTENTION-INPUT Hessian
  // H = XᵀX (the input to wq/wk/wv) by snapshotting B.normed per layer during the forward — feeds LDLQ.
  async function collectInputHessians(tokens) {
    reset();
    const SZ = 2 * n_layers * d;                          // [attn inputs: n_layers·d][ffn inputs: n_layers·d]
    snapBuf = snapBuf || sbuf(SZ);
    snapStg = snapStg || dev.createBuffer({ size: SZ * 4, usage: U.MAP_READ | U.COPY_DST });
    _calib = true;
    const attn = Array.from({ length: n_layers }, () => new Float64Array(d * d));   // wq/wk/wv input Hessian
    const ffn = Array.from({ length: n_layers }, () => new Float64Array(d * d));    // gate/up input Hessian
    const acc = (H, x, o) => { for (let a = 0; a < d; a++) { const xa = x[o + a], row = a * d; for (let b = a; b < d; b++) H[row + b] += xa * x[o + b]; } };
    try {
      for (const tok of tokens) {
        await step(tok);
        const enc = dev.createCommandEncoder(); enc.copyBufferToBuffer(snapBuf, 0, snapStg, 0, SZ * 4); dev.queue.submit([enc.finish()]);
        await snapStg.mapAsync(GPUMapMode.READ); const all = new Float32Array(snapStg.getMappedRange().slice(0)); snapStg.unmap();
        for (let l = 0; l < n_layers; l++) { acc(attn[l], all, l * d); acc(ffn[l], all, (n_layers + l) * d); }
      }
    } finally { _calib = null; }
    const sym = (H) => { for (let a = 0; a < d; a++) for (let b = a + 1; b < d; b++) H[b * d + a] = H[a * d + b]; };
    for (let l = 0; l < n_layers; l++) { sym(attn[l]); sym(ffn[l]); }
    return { attn, ffn };
  }

  // ── DIFFUSION DECODE (Dream-class): iterative mask-denoising over a resident batch ──
  let DF = null;
  const DF_NMAX = 192, DF_DK = 32;
  function diffuseInit() {
    if (DF) return DF;
    if (manifest.maskId === undefined) throw new Error("diffuse: manifest has no maskId (not a diffusion model)");
    if (stream || moe) throw new Error("diffuse: resident models only");
    const q2 = n_heads * hd, kv2 = n_kv_heads * hd;
    DF = {
      P_g32: pipe(mmQ3KK(DF_DK), "dq3k32"), P_attnB: pipe(ATTNB(DF_NMAX), "attnB"), P_bias: pipe(BIASK, "biasK"),
      P_rms: pipe(RMSK, "drms"), P_rope: pipe(ROPEK(ropeLit), "drope"), P_add: pipe(ADD, "dadd"), P_sm: pipe(SILUMUL, "dsm"),
      P_a1: pipe(ARGMAX1, "da1"), P_a2: pipe(ARGMAX2C, "da2c"),
      x: sbuf((DF_NMAX + DF_DK) * d), normed: sbuf((DF_NMAX + DF_DK) * d), q: sbuf((DF_NMAX + DF_DK) * q2), k: sbuf((DF_NMAX + DF_DK) * kv2), v: sbuf((DF_NMAX + DF_DK) * kv2),
      attn: sbuf((DF_NMAX + DF_DK) * q2), h: sbuf((DF_NMAX + DF_DK) * d), normed2: sbuf((DF_NMAX + DF_DK) * d),
      gate: sbuf((DF_NMAX + DF_DK) * ff), up: sbuf((DF_NMAX + DF_DK) * ff), hid: sbuf((DF_NMAX + DF_DK) * ff), cur: sbuf((DF_NMAX + DF_DK) * d), res: sbuf((DF_NMAX + DF_DK) * d),
      logits: sbuf(DF_DK * vocab), tmp: sbuf(65536 * 2), amax: sbuf(DF_NMAX * 2),
      stgIds: dev.createBuffer({ size: DF_NMAX * 8, usage: U.MAP_READ | U.COPY_DST }),
      uD: ubuf(new Uint32Array([d, 0, 0, 0])), uQd: ubuf(new Uint32Array([q2, 0, 0, 0])), uKv: ubuf(new Uint32Array([kv2, 0, 0, 0])),
      uRopeQ: ubuf(new Uint32Array([n_heads, hd, 0, q2])), uRopeK: ubuf(new Uint32Array([n_kv_heads, hd, 0, kv2])),
      uV: ubuf(new Uint32Array([vocab, 0, 0, 0])),
      uRow: Array.from({ length: DF_NMAX }, (_, i) => ubuf(new Uint32Array([i, 0, 0, 0]))),
      uAdd: new Map(), uAttnCache: new Map(),
      xHost: new Float32Array(DF_NMAX * d),
      stats: { steps: 0, blocks: 0 },
    };
    return DF;
  }
  const dfAddUni = (nEl) => { let u = DF.uAdd.get(nEl); if (!u) { u = ubuf(new Uint32Array([nEl, 0, 0, 0])); DF.uAdd.set(nEl, u); } return u; };
  const dfAttnUni = (key, val) => { let u = DF.uAttnCache.get(key); if (!u) { u = ubuf(val); DF.uAttnCache.set(key, u); } return u; };
  const dfEmbedRow = (token, off) => {                     // q3f embed decode (mirror of the step path)
    const eq32 = new Uint32Array(embedQ.buffer, embedQ.byteOffset, embedQ.byteLength >> 2);
    const x = DF.xHost, nbD2 = d / 32;
    for (let i = 0; i < d; i++) {
      const b = token * nbD2 + (i >> 5), bp = b * 3, j = i & 31; let qv;
      const p0 = eq32[bp], p1 = eq32[bp + 1], p2 = eq32[bp + 2];
      if (j < 10) qv = (p0 >>> (j * 3)) & 7; else if (j < 20) qv = (p1 >>> ((j - 10) * 3)) & 7; else if (j < 30) qv = (p2 >>> ((j - 20) * 3)) & 7;
      else { const sp = (p0 >>> 30) | ((p1 >>> 30) << 2) | ((p2 >>> 30) << 4); qv = j === 30 ? sp & 7 : (sp >> 3) & 7; }
      x[off + i] = (qv - 3) * embedS[token * nbD2 + (i >> 5)];
    }
  };
  // chunked DK-column GEMM over the existing per-tensor uniforms; weights read ceil(n/DK)× per matrix
  const dfGemm = (enc, ws, xb, xStride, ob, oStride, n) => {
    for (let c0 = 0; c0 < n; c0 += DF_DK) {
      pass(enc, DF.P_g32, [
        { buffer: xb, offset: c0 * xStride * 4, size: DF_DK * xStride * 4 },
        ws.qbuf, ws.sbuf,
        { buffer: ob, offset: c0 * oStride * 4, size: DF_DK * oStride * 4 },
        ws.uni], grid(Math.ceil(ws.N / 4)));
    }
  };
  // diffuse(promptIds, genLen, { steps, causal }) → seq with the block denoised (greedy, deterministic)
  async function diffuse(promptIds, genLen = 32, opts = {}) {
    diffuseInit();
    if (DF.busy) throw new Error("diffuse: a denoise is already in flight — await the previous call before starting another (don't fire overlapping diffuse() calls)");
    DF.busy = true;
    try {
    const S = opts.steps || 8, causal = !!opts.causal;
    const MASK = manifest.maskId;
    // two modes: APPEND (genLen masks at the suffix — generation) or FILL (promptIds already
    // contains MASK ids anywhere — infilling/editing, diffusion's structural advantage over AR).
    let seq, n, masked = [];
    if (opts.fill) {
      seq = promptIds.slice(); n = seq.length;
      for (let i = 0; i < n; i++) if (seq[i] === MASK) masked.push(i);
      if (!masked.length) return seq;
    } else {
      n = promptIds.length + genLen;
      seq = promptIds.concat(Array(genLen).fill(MASK));
      for (let i = promptIds.length; i < n; i++) masked.push(i);
    }
    if (n > DF_NMAX) throw new Error("diffuse: n " + n + " > " + DF_NMAX);
    const M0 = masked.length;                               // initial mask count (ramp schedule base)
    const uAttn = dfAttnUni("a" + n + "_" + causal, new Uint32Array([n_heads, n_kv_heads, hd, (n >>> 0) | (causal ? 0x80000000 : 0)]));
    DF.stats.blocks++;
    let stepsLeft = S;
    while (masked.length) {
      for (let i = 0; i < n; i++) dfEmbedRow(seq[i], i * d);
      dev.queue.writeBuffer(DF.x, 0, DF.xHost, 0, n * d);
      const enc = dev.createCommandEncoder();
      let cur = DF.x;
      for (let l = 0; l < n_layers; l++) {
        pass(enc, DF.P_rms, [cur, Nrm["l" + l + ".attn_norm"], DF.normed, DF.uD], [1, n]);
        dfGemm(enc, W["l" + l + ".wq"], DF.normed, d, DF.q, n_heads * hd, n);
        dfGemm(enc, W["l" + l + ".wk"], DF.normed, d, DF.k, n_kv_heads * hd, n);
        dfGemm(enc, W["l" + l + ".wv"], DF.normed, d, DF.v, n_kv_heads * hd, n);
        if (attnBias) {
          pass(enc, DF.P_bias, [DF.q, Nrm["l" + l + ".bq"], DF.uQd], [Math.ceil(n_heads * hd / 64), n]);
          pass(enc, DF.P_bias, [DF.k, Nrm["l" + l + ".bk"], DF.uKv], [Math.ceil(n_kv_heads * hd / 64), n]);
          pass(enc, DF.P_bias, [DF.v, Nrm["l" + l + ".bv"], DF.uKv], [Math.ceil(n_kv_heads * hd / 64), n]);
        }
        pass(enc, DF.P_rope, [DF.q, DF.uRopeQ], [Math.ceil(n_heads * (hd / 2) / 64), n]);
        pass(enc, DF.P_rope, [DF.k, DF.uRopeK], [Math.ceil(n_kv_heads * (hd / 2) / 64), n]);
        pass(enc, DF.P_attnB, [DF.q, DF.k, DF.v, DF.attn, uAttn], [n_heads, n]);
        dfGemm(enc, W["l" + l + ".wo"], DF.attn, n_heads * hd, DF.h, d, n);
        pass(enc, DF.P_add, [DF.h, cur, DF.res, dfAddUni(n * d)], Math.ceil(n * d / 64));   // no aliasing: out ≠ both inputs
        pass(enc, DF.P_rms, [DF.res, Nrm["l" + l + ".ffn_norm"], DF.normed2, DF.uD], [1, n]);
        dfGemm(enc, W["l" + l + ".w_gate"], DF.normed2, d, DF.gate, ff, n);
        dfGemm(enc, W["l" + l + ".w_up"], DF.normed2, d, DF.up, ff, n);
        pass(enc, DF.P_sm, [DF.gate, DF.up, DF.hid, dfAddUni(n * ff)], Math.ceil(n * ff / 64));
        dfGemm(enc, W["l" + l + ".w_down"], DF.hid, ff, DF.cur, d, n);
        pass(enc, DF.P_add, [DF.cur, DF.res, DF.x, dfAddUni(n * d)], Math.ceil(n * d / 64));  // DF.x is free past the first rms — becomes the rotating hidden
        cur = DF.x;
      }
      pass(enc, DF.P_rms, [cur, Nrm["final_norm"], DF.normed, DF.uD], [1, n]);
      dev.queue.submit([enc.finish()]);
      // lm_head + per-masked-row argmax, chunked (logits buf holds DK rows)
      for (let c0 = 0; c0 < n; c0 += DF_DK) {
        const m = Math.min(DF_DK, n - c0);
        let any = false; for (let r = 0; r < m; r++) if (c0 + r + 1 < n && seq[c0 + r + 1] === MASK) { any = true; break; }
        if (!any) continue;
        const e2 = dev.createCommandEncoder();
        pass(e2, DF.P_g32, [
          { buffer: DF.normed, offset: c0 * d * 4, size: DF_DK * d * 4 },
          W["lm_head"].qbuf, W["lm_head"].sbuf, DF.logits, W["lm_head"].uni], grid(Math.ceil(vocab / 4)));
        for (let r = 0; r < m; r++) {
          if (c0 + r + 1 >= n || seq[c0 + r + 1] !== MASK) continue;   // row r predicts position r+1 (Dream shifted head)
          pass(e2, DF.P_a1, [{ buffer: DF.logits, offset: r * vocab * 4, size: vocab * 4 }, DF.tmp, DF.uV], 256);
          pass(e2, DF.P_a2, [DF.tmp, DF.amax, DF.uRow[c0 + r + 1]], 1);
        }
        dev.queue.submit([e2.finish()]);
      }
      { const e3 = dev.createCommandEncoder(); e3.copyBufferToBuffer(DF.amax, 0, DF.stgIds, 0, n * 8); dev.queue.submit([e3.finish()]); }
      await DF.stgIds.mapAsync(GPUMapMode.READ);
      const raw = DF.stgIds.getMappedRange().slice(0); DF.stgIds.unmap();
      const ids = new Uint32Array(raw), conf = new Float32Array(raw);
      DF.lastIds = ids; DF.lastConf = conf;
      const eosId = 151643;
      // ramp schedule: commit few tokens early (fully-masked context = least informed), many late
      const total = S * (S + 1) / 2, sIdx = S - stepsLeft + 1;
      const kUn = Math.max(1, Math.round((M0 * sIdx) / total));
      if (opts.fill) {
        // infill: fixed span, never truncate — commit the highest-confidence cohort each step
        masked.sort((a, b) => conf[b * 2 + 1] - conf[a * 2 + 1]);
        for (let u = 0; u < kUn && masked.length; u++) { const p = masked.shift(); seq[p] = ids[p * 2]; }
        masked.sort((a, b) => a - b);
      } else {
        // generation: EOS-candidates unmask LAST (one confident pad would else kill the block)
        const nonEos = masked.filter((p) => ids[p * 2] !== eosId);
        if (nonEos.length === 0) { for (const p of masked) seq[p] = eosId; masked = []; }
        else {
          nonEos.sort((a, b) => conf[b * 2 + 1] - conf[a * 2 + 1]);
          for (let u = 0; u < kUn && nonEos.length; u++) { const p = nonEos.shift(); seq[p] = ids[p * 2]; masked.splice(masked.indexOf(p), 1); }
          masked.sort((a, b) => a - b);
        }
      }
      stepsLeft = Math.max(1, stepsLeft - 1);
      DF.stats.steps++;
    }
    return seq;
    } finally { DF.busy = false; }
  }
  return { step, reset, truncateTo, get cachedLen() { return cached.length; }, sync, generate, decode, decodeStreamed: true, dumpState, restoreState, kvLayoutOf, diffuse, diffStats: () => (DF ? DF.stats : null), _df: () => DF, _dev: () => dev, specDecode, specStats: () => (SP ? SP.stats : null), setDrafter: (fn) => { _drafter = fn || null; }, argmax, captureHidden, collectInputHessians, dumpKV, dims: manifest, streaming: stream, gran: remote ? "remote (served disk)" : (stream === "opfs" ? "opfs (disk)" : (frameGran ? "frame" : (stream ? "layer" : "resident"))), frameBufBytes: streamBuf, loadStats: QLOAD, destroy: () => { try { dev.destroy(); } catch {} }, get gpuBytes() { return gpuBytes; }, get pos() { return pos; }, get timing() { return timing; } };
}
