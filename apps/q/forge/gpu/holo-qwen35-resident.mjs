// holo-qwen35-resident.mjs — ON-GPU RESIDENT decode for the qwen35 9B brain. Same math as the readback engine
// (holo-qwen35-gpu-real-forward.mjs), but the ENTIRE per-token forward is recorded into ONE command submission:
// activations live in persistent VRAM buffers the whole way down the stack, the CPU glue (splits, silu, gates,
// v-head permute, residual, argmax) is moved into small WGSL kernels, and only ONE value (the argmax token)
// comes back per token. The readback engine did ~400-500 mapAsync/token — each a full pipeline flush + CPU
// stall; that sum WAS the seconds/token. This does 1. Correctness is gated token-for-token vs the readback
// engine (itself == HF). Weights already stream into VRAM once (holo-qwen35-gpu-real.mjs); nothing here reloads.

import { RMSNORM_1P_WGSL, CONV1D_STEP_WGSL, GATED_RMSNORM_WGSL, HEAD_NORM_ROPE_WGSL } from "./holo-qwen35-kernels.mjs";
import { GATED_DELTA_STEP_WGSL } from "./holo-gated-delta-gpu.mjs";
import { dequantizeExact } from "../gguf-forge-dequant.mjs";

// ── cooperative matvec: ONE workgroup (64 threads) per output row, threads split the K-blocks and reduce in
//    shared memory. Replaces the one-thread-per-row RAW kernels (only 4096-8192 threads, strided reads → the
//    ~2 tok/s wall). Same byte-exact math; Q4_K/Q5_K blocks are 4-aligned → word loads; Q6_K (210B) uses gb().
//    NOTE: caller dispatches N workgroups (not ceil(N/64)). ──
export const MATVECQ4K_COOP = /* wgsl */`
@group(0)@binding(0)var<storage,read>rb:array<u32>;@group(0)@binding(1)var<storage,read>act:array<f32>;@group(0)@binding(2)var<storage,read_write>outv:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
fn gb(i:u32)->u32{return (rb[i>>2u]>>((i&3u)*8u))&0xffu;}
fn smk4(j:u32,scB:u32)->vec2<u32>{if(j<4u){return vec2<u32>(gb(scB+j)&63u,gb(scB+j+4u)&63u);}return vec2<u32>((gb(scB+j+4u)&0xFu)|((gb(scB+j-4u)>>6u)<<4u),(gb(scB+j+4u)>>4u)|((gb(scB+j)>>6u)<<4u));}
var<workgroup> red:array<f32,64>;
@compute @workgroup_size(64) fn main(@builtin(workgroup_id) wg:vec3<u32>,@builtin(local_invocation_id) lid:vec3<u32>){
  let n=wg.x+wg.y*p.w; let N=p.x; let K=p.y; if(n>=N){ return; }
  let nb=K/256u; let rowBase=n*nb*144u; let nsub=nb*4u; let t=lid.x; var acc=0.0;
  var sb=t; loop{ if(sb>=nsub){break;}
    let blk=sb>>2u; let jj=sb&3u; let base=rowBase+blk*144u;
    let dd=rb[base>>2u]; let d=unpack2x16float(dd).x; let dmin=unpack2x16float(dd).y; let scB=base+4u;
    let s0=smk4(jj*2u,scB); let s1=smk4(jj*2u+1u,scB);
    let d1=d*f32(s0.x); let m1=dmin*f32(s0.y); let d2=d*f32(s1.x); let m2=dmin*f32(s1.y);
    let qw=(base+16u+jj*32u)>>2u; let oB=blk*256u+jj*64u;
    for(var w=0u;w<8u;w++){ let word=rb[qw+w]; let l=w*4u;
      acc=acc+(d1*f32(word&0xFu)-m1)*act[oB+l]+(d2*f32((word>>4u)&0xFu)-m2)*act[oB+32u+l]
             +(d1*f32((word>>8u)&0xFu)-m1)*act[oB+l+1u]+(d2*f32((word>>12u)&0xFu)-m2)*act[oB+32u+l+1u]
             +(d1*f32((word>>16u)&0xFu)-m1)*act[oB+l+2u]+(d2*f32((word>>20u)&0xFu)-m2)*act[oB+32u+l+2u]
             +(d1*f32((word>>24u)&0xFu)-m1)*act[oB+l+3u]+(d2*f32((word>>28u)&0xFu)-m2)*act[oB+32u+l+3u];
    }
    sb=sb+64u;
  }
  red[t]=acc; workgroupBarrier();
  var s=32u; loop{ if(s==0u){break;} if(t<s){red[t]=red[t]+red[t+s];} workgroupBarrier(); s=s>>1u; }
  if(t==0u){ outv[p.z+n]=red[0]; }
}`;
export const MATVECQ5K_COOP = /* wgsl */`
@group(0)@binding(0)var<storage,read>rb:array<u32>;@group(0)@binding(1)var<storage,read>act:array<f32>;@group(0)@binding(2)var<storage,read_write>outv:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
fn gb(i:u32)->u32{return (rb[i>>2u]>>((i&3u)*8u))&0xffu;}
fn smk4(j:u32,scB:u32)->vec2<u32>{if(j<4u){return vec2<u32>(gb(scB+j)&63u,gb(scB+j+4u)&63u);}return vec2<u32>((gb(scB+j+4u)&0xFu)|((gb(scB+j-4u)>>6u)<<4u),(gb(scB+j+4u)>>4u)|((gb(scB+j)>>6u)<<4u));}
var<workgroup> red:array<f32,64>;
@compute @workgroup_size(64) fn main(@builtin(workgroup_id) wg:vec3<u32>,@builtin(local_invocation_id) lid:vec3<u32>){
  let n=wg.x+wg.y*p.w; let N=p.x; let K=p.y; if(n>=N){ return; }
  let nb=K/256u; let rowBase=n*nb*176u; let nsub=nb*4u; let t=lid.x; var acc=0.0;
  var sb=t; loop{ if(sb>=nsub){break;}
    let blk=sb>>2u; let jj=sb&3u; let base=rowBase+blk*176u;
    let dd=rb[base>>2u]; let d=unpack2x16float(dd).x; let dmin=unpack2x16float(dd).y; let scB=base+4u;
    let s0=smk4(jj*2u,scB); let s1=smk4(jj*2u+1u,scB);
    let d1=d*f32(s0.x); let m1=dmin*f32(s0.y); let d2=d*f32(s1.x); let m2=dmin*f32(s1.y);
    let qlw=(base+48u+jj*32u)>>2u; let qhw=(base+16u)>>2u; let oB=blk*256u+jj*64u; let bl=jj*2u; let bh=jj*2u+1u;
    for(var w=0u;w<8u;w++){ let qlword=rb[qlw+w]; let qhword=rb[qhw+w]; let l=w*4u;
      for(var k=0u;k<4u;k++){ let li=l+k; let sh=k*8u; let qv=(qlword>>sh)&0xffu; let qhl=(qhword>>sh)&0xffu;
        let lo=f32((qv&0xFu)+(((qhl>>bl)&1u)*16u)); let hi=f32((qv>>4u)+(((qhl>>bh)&1u)*16u));
        acc=acc+(d1*lo-m1)*act[oB+li]+(d2*hi-m2)*act[oB+32u+li]; } }
    sb=sb+64u;
  }
  red[t]=acc; workgroupBarrier();
  var s=32u; loop{ if(s==0u){break;} if(t<s){red[t]=red[t]+red[t+s];} workgroupBarrier(); s=s>>1u; }
  if(t==0u){ outv[p.z+n]=red[0]; }
}`;
export const MATVECQ6K_COOP = /* wgsl */`
@group(0)@binding(0)var<storage,read>rb:array<u32>;@group(0)@binding(1)var<storage,read>act:array<f32>;@group(0)@binding(2)var<storage,read_write>outv:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
fn gb(i:u32)->u32{return (rb[i>>2u]>>((i&3u)*8u))&0xffu;}
fn s8(b:u32)->i32{return i32(b<<24u)>>24u;}
var<workgroup> red:array<f32,64>;
@compute @workgroup_size(64) fn main(@builtin(workgroup_id) wg:vec3<u32>,@builtin(local_invocation_id) lid:vec3<u32>){
  let n=wg.x+wg.y*p.w; let N=p.x; let K=p.y; if(n>=N){ return; }
  let nb=K/256u; let rowBase=n*nb*210u; let nunit=nb*2u; let t=lid.x; var acc=0.0;
  var u=t; loop{ if(u>=nunit){break;}
    let blk=u>>1u; let jg=u&1u; let bp=rowBase+blk*210u;
    let d=unpack2x16float(gb(bp+208u)|(gb(bp+209u)<<8u)).x;
    let ql=bp+jg*64u; let qh=bp+128u+jg*32u; let aBase=jg*128u; let aB=blk*256u;
    for(var l=0u;l<32u;l++){ let qhl=gb(qh+l);
      let v0=f32(i32((gb(ql+l)&0xfu)|(((qhl)&3u)<<4u))-32); let v32=f32(i32((gb(ql+l+32u)&0xfu)|(((qhl>>2u)&3u)<<4u))-32);
      let v64=f32(i32((gb(ql+l)>>4u)|(((qhl>>4u)&3u)<<4u))-32); let v96=f32(i32((gb(ql+l+32u)>>4u)|(((qhl>>6u)&3u)<<4u))-32);
      let e0=aBase+l; let e32=aBase+l+32u; let e64=aBase+l+64u; let e96=aBase+l+96u;
      acc=acc+d*f32(s8(gb(bp+192u+(e0>>4u))))*v0*act[aB+e0]+d*f32(s8(gb(bp+192u+(e32>>4u))))*v32*act[aB+e32]+d*f32(s8(gb(bp+192u+(e64>>4u))))*v64*act[aB+e64]+d*f32(s8(gb(bp+192u+(e96>>4u))))*v96*act[aB+e96];
    }
    u=u+64u;
  }
  red[t]=acc; workgroupBarrier();
  var s=32u; loop{ if(s==0u){break;} if(t<s){red[t]=red[t]+red[t+s];} workgroupBarrier(); s=s>>1u; }
  if(t==0u){ outv[p.z+n]=red[0]; }
}`;

// ── the small glue kernels that let the whole token stay on-GPU ──
const QK_EXPAND = /* wgsl */`
struct P { nvh:u32, nkh:u32, hk:u32, _p:u32 };
@group(0)@binding(0)var<storage,read>qS:array<f32>;@group(0)@binding(1)var<storage,read>kS:array<f32>;
@group(0)@binding(2)var<storage,read_write>qE:array<f32>;@group(0)@binding(3)var<storage,read_write>kE:array<f32>;
@group(0)@binding(4)var<uniform>p:P;
@compute @workgroup_size(1) fn main(@builtin(workgroup_id) wid:vec3<u32>){
  let h=wid.x; if(h>=p.nvh){return;} let hk=p.hk; let grp=p.nvh/p.nkh; let kh=(h/grp)*hk; let oB=h*hk;
  var ssq=0.0; var ssk=0.0; for(var i=0u;i<hk;i++){ssq=ssq+qS[kh+i]*qS[kh+i];ssk=ssk+kS[kh+i]*kS[kh+i];}
  let qi=(1.0/sqrt(ssq+1e-6))*(1.0/sqrt(f32(hk))); let ki=1.0/sqrt(ssk+1e-6);
  for(var i=0u;i<hk;i++){qE[oB+i]=qS[kh+i]*qi;kE[oB+i]=kS[kh+i]*ki;}
}`;
const DECAY_BETA = /* wgsl */`
struct P { nvh:u32, _a:u32, _b:u32, _c:u32 };
@group(0)@binding(0)var<storage,read>aP:array<f32>;@group(0)@binding(1)var<storage,read>bP:array<f32>;
@group(0)@binding(2)var<storage,read>sA:array<f32>;@group(0)@binding(3)var<storage,read>sDt:array<f32>;
@group(0)@binding(4)var<storage,read_write>decay:array<f32>;@group(0)@binding(5)var<storage,read_write>beta:array<f32>;
@group(0)@binding(6)var<uniform>p:P;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){
  let h=g.x; if(h>=p.nvh){return;} let s=aP[h]+sDt[h]; let sp=select(log(1.0+exp(s)),s,s>20.0);
  decay[h]=exp(-exp(sA[h])*sp); beta[h]=1.0/(1.0+exp(-bP[h]));
}`;
const PERMUTE_VHEAD = /* wgsl */`
struct P { nvh:u32, hv:u32, _a:u32, _b:u32 };
@group(0)@binding(0)var<storage,read>inb:array<f32>;@group(0)@binding(1)var<storage,read>idx:array<u32>;
@group(0)@binding(2)var<storage,read_write>outb:array<f32>;@group(0)@binding(3)var<uniform>p:P;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){
  let id=g.x; if(id>=p.nvh*p.hv){return;} let gh=id/p.hv; let i=id%p.hv; outb[id]=inb[idx[gh]*p.hv+i];
}`;
const DEINTERLEAVE = /* wgsl */`
struct P { nh:u32, hd:u32, _a:u32, _b:u32 };
@group(0)@binding(0)var<storage,read>qg:array<f32>;@group(0)@binding(1)var<storage,read_write>qraw:array<f32>;
@group(0)@binding(2)var<storage,read_write>gate:array<f32>;@group(0)@binding(3)var<uniform>p:P;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){
  let id=g.x; if(id>=p.nh*p.hd){return;} let h=id/p.hd; let i=id%p.hd; let b=h*2u*p.hd;
  qraw[id]=qg[b+i]; gate[id]=qg[b+p.hd+i];
}`;
const GATEMUL = /* wgsl */`
@group(0)@binding(0)var<storage,read>gate:array<f32>;@group(0)@binding(1)var<storage,read_write>ctx:array<f32>;
@group(0)@binding(2)var<uniform>p:vec4<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){
  let i=g.x; if(i>=p.x){return;} let v=gate[i]; ctx[i]=ctx[i]*(1.0/(1.0+exp(-v)));
}`;
const CONVTAIL_BUILD = /* wgsl */`
struct P { C:u32, K:u32, _a:u32, _b:u32 };   // newTail = [oldTail[C:], cur]
@group(0)@binding(0)var<storage,read>oldT:array<f32>;@group(0)@binding(1)var<storage,read>cur:array<f32>;
@group(0)@binding(2)var<storage,read_write>newT:array<f32>;@group(0)@binding(3)var<uniform>p:P;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){
  let i=g.x; let tailLen=(p.K-1u)*p.C; if(i>=tailLen){return;}
  let cut=(p.K-2u)*p.C; if(i<cut){newT[i]=oldT[i+p.C];} else {newT[i]=cur[i-cut];}
}`;
const ARGMAX = /* wgsl */`
@group(0)@binding(0)var<storage,read>x:array<f32>;@group(0)@binding(1)var<storage,read_write>outi:array<u32>;
@group(0)@binding(2)var<uniform>p:vec4<u32>;
var<workgroup> sv:array<f32,256>; var<workgroup> si:array<u32,256>;
@compute @workgroup_size(256) fn main(@builtin(local_invocation_id) lid:vec3<u32>){
  let t=lid.x; let N=p.x; var bv=-3.0e38; var bi=0u;
  var i=t; loop{ if(i>=N){break;} let v=x[i]; if(v>bv){bv=v;bi=i;} i=i+256u; }
  sv[t]=bv; si[t]=bi; workgroupBarrier();
  var stride=128u; loop{ if(stride==0u){break;} if(t<stride){ if(sv[t+stride]>sv[t]){sv[t]=sv[t+stride];si[t]=si[t+stride];} } workgroupBarrier(); stride=stride>>1u; }
  if(t==0u){outi[0]=si[0];}
}`;

export function makeResident(ctx) {
  const { device, rt, D, BPB, embed, lmHead, outNorm, layers, tok, EOS, G, ropeTables, modelTag = "qwen35-9b" } = ctx;
  const dev = device;
  const pipe = (c) => dev.createComputePipeline({ layout: "auto", compute: { module: dev.createShaderModule({ code: c }), entryPoint: "main" } });
  const P = {
    rms1p: pipe(RMSNORM_1P_WGSL), conv: pipe(CONV1D_STEP_WGSL), gnorm: pipe(GATED_RMSNORM_WGSL), hnr: pipe(HEAD_NORM_ROPE_WGSL),
    gd: pipe(GATED_DELTA_STEP_WGSL), qke: pipe(QK_EXPAND), dcb: pipe(DECAY_BETA), perm: pipe(PERMUTE_VHEAD),
    deint: pipe(DEINTERLEAVE), gmul: pipe(GATEMUL), ctb: pipe(CONVTAIL_BUILD), argmax: pipe(ARGMAX),
    q4: pipe(MATVECQ4K_COOP), q5: pipe(MATVECQ5K_COOP), q6: pipe(MATVECQ6K_COOP), add: rt.P.add, saxpy: rt.P.saxpy, swiglu: rt.P.swiglu, attn: rt.P.attn,
  };
  const mvPipe = (t) => (t === 12 ? P.q4 : t === 13 ? P.q5 : P.q6);

  // ── persistent activation buffers (allocated once, reused every layer) ──
  const sb = (n) => dev.createBuffer({ size: Math.max(16, n * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const dm = D.d_model, vd = D.value_dim, kd = D.key_dim, cd = D.conv_dim, nvh = D.num_v_heads, hk = D.head_k, hv = D.head_v;
  const nh = D.n_head, nkv = D.n_kv, hd = D.head_dim, ffn = D.ffn, vocab = D.vocab, rdim = D.rope_dim;
  const B = {
    h: sb(dm), norm: sb(dm), delta: sb(dm),
    qkv: sb(cd), z: sb(vd), aP: sb(nvh), bP: sb(nvh), conv: sb(cd), qS: sb(kd), kS: sb(kd), vS: sb(vd),
    qE: sb(nvh * hk), kE: sb(nvh * hk), decay: sb(nvh), beta: sb(nvh), gdo: sb(vd), on: sb(vd), onG: sb(vd),
    qg: sb(nh * 2 * hd), qraw: sb(nh * hd), gate: sb(nh * hd), qrope: sb(nh * hd), kraw: sb(nkv * hd), krope: sb(nkv * hd), vv: sb(nkv * hd), attnctx: sb(nh * hd),
    gp: sb(ffn), up: sb(ffn), hh: sb(ffn), fd: sb(dm),
    cos: sb(rdim), sin: sb(rdim), tailTmp: sb((D.conv_k - 1) * cd),
    logits: sb(vocab), argIdx: dev.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    argRead: dev.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
  };
  // v-head permute index (GGUF g → HF source): vpermInv[g] = g<16 ? 2g : 2(g-16)+1
  const vpi = new Uint32Array(nvh); for (let g = 0; g < nvh; g++) vpi[g] = g < nvh / 2 ? 2 * g : 2 * (g - nvh / 2) + 1;
  const vpiBuf = rt.wF(new Uint32Array(vpi.buffer)); { const tmp = dev.createBuffer({ size: nvh * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(tmp, 0, vpi); B.vpi = tmp; }

  // ── uniform pool (own, so mixed u32/f32 structs are exact) ──
  const upool = []; for (let i = 0; i < 1200; i++) upool.push(dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
  let ui = 0; const resetU = () => { ui = 0; };
  const uU = (a) => { const b = upool[ui++]; dev.queue.writeBuffer(b, 0, new Uint32Array([...a, 0, 0, 0, 0].slice(0, 4))); return b; };
  const uF = (a) => { const b = upool[ui++]; dev.queue.writeBuffer(b, 0, new Float32Array([...a, 0, 0, 0, 0].slice(0, 4))); return b; };
  const uMix = (u3, f) => { const b = upool[ui++]; const ab = new ArrayBuffer(16); new Uint32Array(ab, 0, 3).set([...u3, 0, 0, 0].slice(0, 3)); new Float32Array(ab, 12, 1)[0] = f; dev.queue.writeBuffer(b, 0, new Uint8Array(ab)); return b; };
  const epsBits = new Uint32Array(new Float32Array([D.eps]).buffer)[0];

  const d = (enc, pl, bufs, groups) => rt.disp(enc, pl, bufs, groups);
  const mv = (enc, wq, act, out) => {   // COOP: one workgroup per row; 2D grid so N can exceed maxComputeWorkgroupsPerDimension (65535)
    const N = wq.N, gx = Math.min(N, 32768), gy = Math.ceil(N / gx), pl = mvPipe(wq.type);
    const bg = dev.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: [wq.buf, act, out, uU([N, wq.K, 0, gx])].map((b, i) => ({ binding: i, resource: { buffer: b } })) });
    const pa = enc.beginComputePass(); pa.setPipeline(pl); pa.setBindGroup(0, bg); pa.dispatchWorkgroups(gx, gy); pa.end();
  };
  const gather = (id) => { const t = embed.t, K = t.dims[0], rb = (K / 256) * BPB[t.ggmlType]; return dequantizeExact(t.ggmlType, embed.bytes.subarray(id * rb, (id + 1) * rb), K); };
  const rope = ropeTables(4096);

  function newState() {
    return layers.map((l) => l.type === "linear"
      ? { S: sb(nvh * hk * hv), convTail: sb((D.conv_k - 1) * cd) }   // zero-init by WebGPU
      : { Kc: sb(4096 * nkv * hd), Vc: sb(4096 * nkv * hd), len: 0 });
  }

  // ── prefix-KV reuse (fabric A1): the prompt prefix (system + context + history) is deterministic on THIS
  // device, so its per-layer state — linear recurrent {S,convTail} + attention K/V — is memoizable. On a repeat
  // or extension we RESTORE that state (a GPU-side clone, no readback) and prefill only the NEW suffix; that is
  // byte-identical to a full prefill because the state is the complete carry (proven vs the full-prefill oracle).
  // Trust rung: OWN device / THIS model only — never shared cross-device (the GPU↔CPU float boundary). Fabric-
  // gated (holoFabric.enabled). Valid at any temperature: the prefill never samples; only decode does.
  const KV_MAX = 4, linBytes = nvh * hk * hv * 4, ctBytes = (D.conv_k - 1) * cd * 4;
  let kvCache = [], kvUse = 0, lastReuse = { reused: 0, total: 0, hit: false };
  const fabricOn = () => { try { return globalThis.holoFabric ? globalThis.holoFabric.enabled !== false : true; } catch (e) { return true; } };
  const cloneBuf = (src, bytes) => { const dst = sb(bytes / 4); const e = dev.createCommandEncoder(); e.copyBufferToBuffer(src, 0, dst, 0, bytes); dev.queue.submit([e.finish()]); return dst; };
  const evictBuffers = (bs) => bs.forEach((b) => ["S", "convTail", "Kc", "Vc"].forEach((k) => b[k] && b[k].destroy()));
  function kvCheckpoint(tokens, state) {                                     // snapshot the post-prefix state (clone → immune to decode mutation)
    const buffers = state.map((st, L) => layers[L].type === "linear"
      ? { type: "linear", S: cloneBuf(st.S, linBytes), convTail: cloneBuf(st.convTail, ctBytes) }
      : { type: "attn", len: st.len, Kc: cloneBuf(st.Kc, st.len * nkv * hd * 4), Vc: cloneBuf(st.Vc, st.len * nkv * hd * 4) });
    kvCache.push({ tokens: Int32Array.from(tokens), buffers, use: ++kvUse });
    while (kvCache.length > KV_MAX) { let mi = 0; for (let i = 1; i < kvCache.length; i++) if (kvCache[i].use < kvCache[mi].use) mi = i; evictBuffers(kvCache.splice(mi, 1)[0].buffers); }
  }
  function kvFind(ids) {                                                     // longest STRICT prefix among cached entries (≥1 token left to decode)
    let best = null;
    for (const e of kvCache) { const L = e.tokens.length; if (L >= ids.length) continue; let ok = true; for (let i = 0; i < L; i++) if (e.tokens[i] !== ids[i]) { ok = false; break; } if (ok && (!best || L > best.tokens.length)) best = e; }
    if (best) best.use = ++kvUse;
    return best;
  }
  function kvRestore(entry) {                                               // clone the snapshot into a FRESH mutable state (attn K/V re-expanded to full length)
    return entry.buffers.map((b) => b.type === "linear"
      ? { S: cloneBuf(b.S, linBytes), convTail: cloneBuf(b.convTail, ctBytes) }
      : ((st) => { const e = dev.createCommandEncoder(); if (b.len) { e.copyBufferToBuffer(b.Kc, 0, st.Kc, 0, b.len * nkv * hd * 4); e.copyBufferToBuffer(b.Vc, 0, st.Vc, 0, b.len * nkv * hd * 4); } dev.queue.submit([e.finish()]); return st; })({ Kc: sb(4096 * nkv * hd), Vc: sb(4096 * nkv * hd), len: b.len }));
  }
  const clearKV = () => { kvCache.forEach((e) => evictBuffers(e.buffers)); kvCache = []; ansCache.clear(); };

  // ── deterministic-answer memoization (fabric A2): a GREEDY (temp=0) completion is a pure function of
  // (prompt ⊕ model ⊕ deviceClass ⊕ maxTokens). Memoize it κ-addressed — an exact repeat returns the whole
  // answer INSTANTLY, zero GPU work ("answered from verified memory"). Determinism-GATED: temp>0 (sampled)
  // NEVER memoizes or serves (Law: sampled outputs must not be cache-served). Trust rung: OWN device — we
  // computed it, so it's trustworthy without re-verify; OPFS/L2 durability + holo-kmemo backing are follow-ons.
  const ANS_MAX = 64, DEVICE_CLASS = "webgpu";
  let ansCache = new Map();
  async function answerKappa(messages, maxTokens) {
    const s = `${modelTag} ${DEVICE_CLASS} ${maxTokens} ${frame(messages)}`;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // record one linear layer into the encoder (h → h + delta), advancing state.S/convTail on GPU
  function recLinear(enc, W, st) {
    d(enc, P.rms1p, [B.h, W.attn_norm, B.norm, uF([dm, D.eps])], 1);
    mv(enc, W.attn_qkv, B.norm, B.qkv); mv(enc, W.attn_gate, B.norm, B.z); mv(enc, W.ssm_alpha, B.norm, B.aP); mv(enc, W.ssm_beta, B.norm, B.bP);
    d(enc, P.conv, [st.convTail, B.qkv, W.ssm_conv1d, B.conv, uU([cd, D.conv_k])], G(cd));
    d(enc, P.ctb, [st.convTail, B.qkv, B.tailTmp, uU([cd, D.conv_k])], G((D.conv_k - 1) * cd));
    enc.copyBufferToBuffer(B.tailTmp, 0, st.convTail, 0, (D.conv_k - 1) * cd * 4);
    enc.copyBufferToBuffer(B.conv, 0, B.qS, 0, kd * 4); enc.copyBufferToBuffer(B.conv, kd * 4, B.kS, 0, kd * 4); enc.copyBufferToBuffer(B.conv, 2 * kd * 4, B.vS, 0, vd * 4);
    d(enc, P.qke, [B.qS, B.kS, B.qE, B.kE, uU([nvh, D.num_k_heads, hk])], nvh);
    d(enc, P.dcb, [B.aP, B.bP, W.ssm_a, W.ssm_dt, B.decay, B.beta, uU([nvh])], G(nvh));
    d(enc, P.gd, [st.S, B.qE, B.kE, B.vS, B.decay, B.beta, B.gdo, uU([nvh, hk, hv])], nvh);
    d(enc, P.gnorm, [B.gdo, W.ssm_norm, B.z, B.on, uMix([nvh, hv, 0], D.eps)], nvh);
    d(enc, P.perm, [B.on, B.vpi, B.onG, uU([nvh, hv])], G(nvh * hv));
    mv(enc, W.ssm_out, B.onG, B.delta);
    d(enc, P.saxpy, [B.delta, B.h, uF([1, dm])], G(dm));   // h += delta (no buffer aliasing)
  }
  function recAttn(enc, W, pos, st) {
    dev.queue.writeBuffer(B.cos, 0, rope.cos[pos]); dev.queue.writeBuffer(B.sin, 0, rope.sin[pos]);
    d(enc, P.rms1p, [B.h, W.attn_norm, B.norm, uF([dm, D.eps])], 1);
    mv(enc, W.attn_q, B.norm, B.qg);
    d(enc, P.deint, [B.qg, B.qraw, B.gate, uU([nh, hd])], G(nh * hd));
    d(enc, P.hnr, [B.qraw, W.attn_q_norm, B.cos, B.sin, B.qrope, uU([nh, hd, rdim, epsBits])], nh);
    mv(enc, W.attn_k, B.norm, B.kraw);
    d(enc, P.hnr, [B.kraw, W.attn_k_norm, B.cos, B.sin, B.krope, uU([nkv, hd, rdim, epsBits])], nkv);
    mv(enc, W.attn_v, B.norm, B.vv);
    enc.copyBufferToBuffer(B.krope, 0, st.Kc, pos * nkv * hd * 4, nkv * hd * 4);
    enc.copyBufferToBuffer(B.vv, 0, st.Vc, pos * nkv * hd * 4, nkv * hd * 4);
    d(enc, P.attn, [B.qrope, st.Kc, st.Vc, B.attnctx, uU([nh, hd, pos, nkv * hd]), uF([1 / Math.sqrt(hd), nh / nkv])], G(nh));
    d(enc, P.gmul, [B.gate, B.attnctx, uU([nh * hd])], G(nh * hd));
    mv(enc, W.attn_output, B.attnctx, B.delta);
    d(enc, P.saxpy, [B.delta, B.h, uF([1, dm])], G(dm));
    st.len = pos + 1;
  }
  function recMLP(enc, W) {
    d(enc, P.rms1p, [B.h, W.post_attention_norm, B.norm, uF([dm, D.eps])], 1);
    mv(enc, W.ffn_gate, B.norm, B.gp); mv(enc, W.ffn_up, B.norm, B.up);
    d(enc, P.swiglu, [B.gp, B.up, B.hh, uU([ffn])], G(ffn));
    mv(enc, W.ffn_down, B.hh, B.fd);
    d(enc, P.saxpy, [B.fd, B.h, uF([1, dm])], G(dm));
  }

  // one token → argmax token id (greedy). ONE submit; ONE 4-byte readback.
  async function step(id, pos, state) {
    resetU();
    dev.queue.writeBuffer(B.h, 0, gather(id));
    const enc = dev.createCommandEncoder();
    for (let L = 0; L < D.n_layer; L++) {
      const { type, W } = layers[L];
      if (type === "linear") recLinear(enc, W, state[L]); else recAttn(enc, W, pos, state[L]);
      recMLP(enc, W);
    }
    d(enc, P.rms1p, [B.h, outNorm, B.norm, uF([dm, D.eps])], 1);
    mv(enc, lmHead, B.norm, B.logits);
    d(enc, P.argmax, [B.logits, B.argIdx, uU([vocab])], 1);
    enc.copyBufferToBuffer(B.argIdx, 0, B.argRead, 0, 4);
    dev.queue.submit([enc.finish()]);
    await B.argRead.mapAsync(GPUMapMode.READ); const t = new Uint32Array(B.argRead.getMappedRange())[0]; B.argRead.unmap();
    return t;
  }

  function frame(messages) { let s = ""; for (const m of messages) s += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`; return s + "<|im_start|>assistant\n"; }
  async function* generate(messages, { maxTokens = 256, temperature = 0, onReuse } = {}) {
    const useCache = fabricOn(), greedy = !(temperature > 0);
    // A2 — exact deterministic answer: instant, ZERO GPU (determinism-gated: sampled temp>0 never serves)
    let ansKey = null;
    if (useCache && greedy) {
      ansKey = await answerKappa(messages, maxTokens);
      const cached = ansCache.get(ansKey);
      if (cached !== undefined) {
        ansCache.delete(ansKey); ansCache.set(ansKey, cached);   // LRU bump
        lastReuse = { reused: 0, total: 0, hit: true, answer: true, kappa: ansKey };
        if (onReuse) { try { onReuse(lastReuse); } catch (e) {} }
        if (cached) yield cached;   // the whole verified answer, at once
        return;
      }
    }
    // A1 — prefix-KV reuse (partial), then decode
    const ids = tok.encode(frame(messages), { addSpecial: false, parseSpecial: true });
    const hit = useCache ? kvFind(ids) : null;
    let state, startPos = 0;
    if (hit) { state = kvRestore(hit); startPos = hit.tokens.length; } else state = newState();
    // checkpoint boundaries: the SYSTEM prefix (cross-conversation reuse) + the FULL prompt (next-turn reuse)
    const bset = new Set([ids.length]);
    if (useCache && messages[0] && messages[0].role === "system") {
      const sysLen = tok.encode(`<|im_start|>system\n${messages[0].content}<|im_end|>\n`, { addSpecial: false, parseSpecial: true }).length;
      if (sysLen > startPos && sysLen < ids.length) bset.add(sysLen);
    }
    let next, pos = startPos;
    for (; pos < ids.length; pos++) { next = await step(ids[pos], pos, state); if (useCache && bset.has(pos + 1)) kvCheckpoint(ids.slice(0, pos + 1), state); }
    lastReuse = { reused: startPos, total: ids.length, hit: !!hit, answer: false };   // honest label
    if (onReuse) { try { onReuse(lastReuse); } catch (e) {} }
    let text = "", gen = [];
    for (let n = 0; n < maxTokens; n++) {
      if (EOS.has(next)) break;
      gen.push(next); const full = tok.decode(gen), delta = full.slice(text.length); text = full; yield delta;
      next = await step(next, pos++, state);
    }
    if (useCache && greedy && ansKey) { ansCache.set(ansKey, text); while (ansCache.size > ANS_MAX) ansCache.delete(ansCache.keys().next().value); }   // memoize the complete answer
  }
  async function chat(messages, o) { let s = ""; for await (const dt of generate(messages, o)) s += dt; return s.trim(); }
  const argmaxCPU = (v) => { let bi = 0, bv = -Infinity; for (let i = 0; i < v.length; i++) if (v[i] > bv) { bv = v[i]; bi = i; } return bi; };
  const _stepErr = async (id, pos, state) => { dev.pushErrorScope("validation"); dev.pushErrorScope("out-of-memory"); const t = await step(id, pos, state); const oom = await dev.popErrorScope(); const val = await dev.popErrorScope(); return { token: t, validation: val && val.message, oom: oom && oom.message }; };
  const _read = async (name, n) => { const buf = B[name]; const bytes = (n || buf.size / 4) * 4; const r = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }); const e = dev.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, r, 0, bytes); dev.queue.submit([e.finish()]); await r.mapAsync(GPUMapMode.READ); const a = new Float32Array(r.getMappedRange().slice(0)); r.destroy(); return a; };
  return { D, tok, step, newState, generate, chat, argmax: argmaxCPU, clearKV, lastReuse: () => lastReuse, kvStats: () => ({ entries: kvCache.length, lastReuse }), _read, _B: B, _dev: dev, _stepErr, info: () => ({ arch: "qwen35", layers: D.n_layer, resident: true, kvReuse: true }) };
}

export default { makeResident };
