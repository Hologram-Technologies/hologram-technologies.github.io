// holo-moonshine-asr.mjs — Q's κ-native WebGPU ear, Moonshine edition. Same interface as holo-whisper-asr
// (createMoonshineASR(url).transcribe(pcm16k) → {text, ids, gpuMs, ms}) but Moonshine arch: RAW audio (NO
// mel) → conv stem → RoPE encoder → KV-cache RoPE/cross decoder → gated SwiGLU → tied head → SPM detok.
// Weights 100% κ-streamed + L5-verified from the .holo. Decode is incremental (KV-cache) for live latency.
import { streamHolo } from "./holo-whisper-stream.mjs";

// Llama SentencePiece detok: Replace(▁→space) → ByteFallback(<0xNN>→byte) → Fuse → Strip one leading space.
function makeDetok(tokJson) {
  const vocab = tokJson.model.vocab, inv = []; for (const [tok, id] of Object.entries(vocab)) inv[id] = tok;
  const tenc = new TextEncoder(), tdec = new TextDecoder();
  return (ids) => {
    const bytes = [];
    for (const id of ids) { if (id <= 2) continue; const piece = inv[id]; if (piece === undefined) continue;
      const m = /^<0x([0-9A-Fa-f]{2})>$/.exec(piece);
      if (m) bytes.push(parseInt(m[1], 16));
      else { const u = tenc.encode(piece.replace(/▁/g, " ")); for (const b of u) bytes.push(b); } }
    let t = tdec.decode(new Uint8Array(bytes)); return t.startsWith(" ") ? t.slice(1) : t;
  };
}

const CONV1F = `@group(0)@binding(0)var<storage,read>inp:array<f32>;@group(0)@binding(1)var<storage,read>w:array<f32>;@group(0)@binding(2)var<storage,read>b:array<f32>;@group(0)@binding(3)var<storage,read_write>outp:array<f32>;@group(0)@binding(4)var<uniform>p:vec4<u32>;@group(0)@binding(5)var<uniform>q:vec4<u32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let idx=g.x;let IC=p.x;let OC=p.y;let K=p.z;let OL=p.w;let L=q.x;let stride=q.y;if(idx>=OC*OL){return;}
let oc=idx/OL;let ol=idx%OL;var s=select(0.0,b[oc],q.w==1u);let wb=oc*IC*K;let st=ol*stride;for(var ic=0u;ic<IC;ic++){let ib=ic*L;let wcb=wb+ic*K;for(var k=0u;k<K;k++){s=s+inp[ib+st+k]*w[wcb+k];}}outp[oc*OL+ol]=s;}`;
const TANH = `@group(0)@binding(0)var<storage,read_write>c:array<f32>;@group(0)@binding(1)var<uniform>p:vec4<u32>;@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){if(g.x>=p.x){return;}c[g.x]=tanh(c[g.x]);}`;
const GELU = `@group(0)@binding(0)var<storage,read_write>c:array<f32>;@group(0)@binding(1)var<uniform>p:vec4<u32>;
fn erf(x:f32)->f32{let s=sign(x);let ax=abs(x);let t=1.0/(1.0+0.3275911*ax);let y=1.0-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*exp(-ax*ax);return s*y;}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){if(g.x>=p.x){return;}let x=c[g.x];c[g.x]=0.5*x*(1.0+erf(x*0.7071067811865476));}`;
const GNSTATS = `@group(0)@binding(0)var<storage,read>x:array<f32>;@group(0)@binding(1)var<storage,read_write>o:array<f32>;@group(0)@binding(2)var<uniform>p:vec4<u32>;
var<workgroup> ss:array<f32,256>;var<workgroup> sq:array<f32,256>;
@compute @workgroup_size(256)fn main(@builtin(local_invocation_id)l:vec3<u32>){let t=l.x;let N=p.x;var a=0.0;var b=0.0;for(var i=t;i<N;i=i+256u){let v=x[i];a=a+v;b=b+v*v;}ss[t]=a;sq[t]=b;workgroupBarrier();
var st=128u;loop{if(st==0u){break;}if(t<st){ss[t]=ss[t]+ss[t+st];sq[t]=sq[t]+sq[t+st];}workgroupBarrier();st=st/2u;}
if(t==0u){let m=ss[0]/f32(N);let v=sq[0]/f32(N)-m*m;o[0]=m;o[1]=1.0/sqrt(v+1e-5);}}`;
const GNAPPLY = `@group(0)@binding(0)var<storage,read_write>x:array<f32>;@group(0)@binding(1)var<storage,read>st:array<f32>;@group(0)@binding(2)var<storage,read>w:array<f32>;@group(0)@binding(3)var<storage,read>b:array<f32>;@group(0)@binding(4)var<uniform>p:vec4<u32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let idx=g.x;let C=p.x;let T=p.y;if(idx>=C*T){return;}x[idx]=(x[idx]-st[0])*st[1]*w[idx/T]+b[idx/T];}`;
const TRANSP = `@group(0)@binding(0)var<storage,read>inp:array<f32>;@group(0)@binding(1)var<storage,read_write>o:array<f32>;@group(0)@binding(2)var<uniform>p:vec4<u32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let idx=g.x;let F=p.x;let S=p.y;if(idx>=F*S){return;}let f=idx/S;let c=idx%S;o[idx]=inp[c*F+f];}`;
const TILED = `@group(0)@binding(0)var<storage,read>A:array<f32>;@group(0)@binding(1)var<storage,read>B:array<f32>;@group(0)@binding(2)var<storage,read>bias:array<f32>;@group(0)@binding(3)var<storage,read_write>Y:array<f32>;@group(0)@binding(4)var<uniform>p:vec4<u32>;
var<workgroup> As:array<f32,256>;var<workgroup> Bs:array<f32,256>;
@compute @workgroup_size(16,16)fn main(@builtin(workgroup_id)wg:vec3<u32>,@builtin(local_invocation_id)l:vec3<u32>){
let rows=p.x;let inD=p.y;let outD=p.z;let tx=l.x;let ty=l.y;let r=wg.y*16u+ty;let o=wg.x*16u+tx;var acc=0.0;let nT=(inD+15u)/16u;
for(var kt=0u;kt<nT;kt++){let ai=kt*16u+tx;let bi=kt*16u+ty;
As[ty*16u+tx]=select(0.0,A[r*inD+ai],r<rows&&ai<inD);Bs[ty*16u+tx]=select(0.0,B[o*inD+bi],o<outD&&bi<inD);
workgroupBarrier();for(var kk=0u;kk<16u;kk++){acc=acc+As[ty*16u+kk]*Bs[kk*16u+tx];}workgroupBarrier();}
if(r<rows&&o<outD){Y[r*outD+o]=acc+select(0.0,bias[o],p.w==1u);}}`;
const LN = `@group(0)@binding(0)var<storage,read>x:array<f32>;@group(0)@binding(1)var<storage,read>w:array<f32>;@group(0)@binding(2)var<storage,read>b:array<f32>;@group(0)@binding(3)var<storage,read_write>y:array<f32>;@group(0)@binding(4)var<uniform>p:vec4<u32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let row=g.x;let n=p.x;let S=p.y;if(row>=n){return;}let base=row*S;var mean=0.0;for(var i=0u;i<S;i++){mean=mean+x[base+i];}mean=mean/f32(S);var v=0.0;for(var i=0u;i<S;i++){let d=x[base+i]-mean;v=v+d*d;}let sc=1.0/sqrt(v/f32(S)+1e-5);for(var i=0u;i<S;i++){y[base+i]=(x[base+i]-mean)*sc*w[i]+b[i];}}`;
const ROPE = `@group(0)@binding(0)var<storage,read_write>v:array<f32>;@group(0)@binding(1)var<uniform>p:vec4<u32>;@group(0)@binding(2)var<uniform>pb:vec4<u32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let idx=g.x;let n=p.x;let S=p.y;let H=p.z;let hd=p.w;let half=16u;let rot=32u;if(idx>=n*H*half){return;}
let row=idx/(H*half);let rem=idx%(H*half);let h=rem/half;let j=rem%half;let pos=row+pb.x;let base=row*S+h*hd;let i0=base+2u*j;
let freq=exp(-(f32(2u*j)/f32(rot))*9.210340371976182);let ang=f32(pos)*freq;let c=cos(ang);let s=sin(ang);
let a=v[i0];let b=v[i0+1u];v[i0]=a*c-b*s;v[i0+1u]=b*c+a*s;}`;
const ATTN = `@group(0)@binding(0)var<storage,read>q:array<f32>;@group(0)@binding(1)var<storage,read>k:array<f32>;@group(0)@binding(2)var<storage,read>v:array<f32>;@group(0)@binding(3)var<storage,read_write>o:array<f32>;@group(0)@binding(4)var<uniform>p:vec4<u32>;@group(0)@binding(5)var<uniform>pc:vec4<u32>;@group(0)@binding(6)var<uniform>pf:vec4<f32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let idx=g.x;let nQ=p.x;let nK=p.y;let H=p.z;let hd=p.w;let Sd=H*hd;let scale=pf.x;if(idx>=H*nQ){return;}
let h=idx/nQ;let i=idx%nQ;let ho=h*hd;let qb=i*Sd+ho;let lim=select(nK,i+1u,pc.x==1u);
var m=-3.0e38;var l=0.0;var acc:array<f32,64>;for(var d=0u;d<hd;d++){acc[d]=0.0;}
for(var jj=0u;jj<lim;jj++){let kb=jj*Sd+ho;var s=0.0;for(var d=0u;d<hd;d++){s=s+q[qb+d]*k[kb+d];}s=s*scale;let mn=max(m,s);let cr=exp(m-mn);let e=exp(s-mn);l=l*cr+e;let vb=jj*Sd+ho;for(var d=0u;d<hd;d++){acc[d]=acc[d]*cr+e*v[vb+d];}m=mn;}
let ob=i*Sd+ho;for(var d=0u;d<hd;d++){o[ob+d]=acc[d]/l;}}`;
const SWIGLU = `@group(0)@binding(0)var<storage,read>h1:array<f32>;@group(0)@binding(1)var<storage,read_write>gg:array<f32>;@group(0)@binding(2)var<uniform>p:vec4<u32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let idx=g.x;let n=p.x;let IFF=p.y;if(idx>=n*IFF){return;}let r=idx/IFF;let o=idx%IFF;let gate=h1[r*2u*IFF+IFF+o];let hid=h1[r*2u*IFF+o];gg[idx]=(gate/(1.0+exp(-gate)))*hid;}`;
const ADD = `@group(0)@binding(0)var<storage,read_write>x:array<f32>;@group(0)@binding(1)var<storage,read>y:array<f32>;@group(0)@binding(2)var<uniform>p:vec4<u32>;@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){if(g.x>=p.x){return;}x[g.x]=x[g.x]+y[g.x];}`;
// EMBED: dx[d] = embed[ids[pos]*S+d] (token stays on GPU → no per-token CPU round-trip)
const EMBED = `@group(0)@binding(0)var<storage,read>ids:array<u32>;@group(0)@binding(1)var<storage,read>te:array<f32>;@group(0)@binding(2)var<storage,read_write>x:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let d=g.x;let pos=p.x;let S=p.y;if(d>=S){return;}x[d]=te[ids[pos]*S+d];}`;
// GPU argmax over full vocab (Moonshine: no token suppression) → writes next id into ids[outPos]
const ARGMAX = `@group(0)@binding(0)var<storage,read>logits:array<f32>;@group(0)@binding(1)var<storage,read_write>ids:array<u32>;@group(0)@binding(2)var<uniform>p:vec4<u32>;
var<workgroup> bV:array<f32,256>;var<workgroup> bI:array<u32,256>;
@compute @workgroup_size(256)fn main(@builtin(local_invocation_id)l:vec3<u32>){let t=l.x;let V=p.y;var mv=-3.0e38;var mi=0u;
for(var i=t;i<V;i=i+256u){let s=logits[i];if(s>mv){mv=s;mi=i;}}
bV[t]=mv;bI[t]=mi;workgroupBarrier();
var st=128u;loop{if(st==0u){break;}if(t<st){if(bV[t+st]>bV[t]){bV[t]=bV[t+st];bI[t]=bI[t+st];}}workgroupBarrier();st=st/2u;}
if(t==0u){ids[p.x]=bI[0];}}`;
// in-shader int8 dequant tiled GEMM: B = int8 weights packed 4/u32, per-row f32 scale → ¼ GPU mem + ~1.8× (bandwidth)
const TILED_Q8 = `@group(0)@binding(0)var<storage,read>A:array<f32>;@group(0)@binding(1)var<storage,read>B:array<u32>;@group(0)@binding(2)var<storage,read>scl:array<f32>;@group(0)@binding(3)var<storage,read>bias:array<f32>;@group(0)@binding(4)var<storage,read_write>Y:array<f32>;@group(0)@binding(5)var<uniform>p:vec4<u32>;
var<workgroup> As:array<f32,256>;var<workgroup> Bs:array<f32,256>;
fn rdq(idx:u32)->f32{let w=B[idx>>2u];let sh=(idx&3u)*8u;let b=(w>>sh)&0xffu;return f32(i32(b<<24u)>>24u);}
@compute @workgroup_size(16,16)fn main(@builtin(workgroup_id)wg:vec3<u32>,@builtin(local_invocation_id)l:vec3<u32>){
let rows=p.x;let inD=p.y;let outD=p.z;let tx=l.x;let ty=l.y;let r=wg.y*16u+ty;let o=wg.x*16u+tx;var acc=0.0;let nT=(inD+15u)/16u;
for(var kt=0u;kt<nT;kt++){let ai=kt*16u+tx;let bi=kt*16u+ty;
As[ty*16u+tx]=select(0.0,A[r*inD+ai],r<rows&&ai<inD);Bs[ty*16u+tx]=select(0.0,rdq(o*inD+bi),o<outD&&bi<inD);
workgroupBarrier();for(var kk=0u;kk<16u;kk++){acc=acc+As[ty*16u+kk]*Bs[kk*16u+tx];}workgroupBarrier();}
if(r<rows&&o<outD){Y[r*outD+o]=acc*scl[o]+select(0.0,bias[o],p.w==1u);}}`;
// int8 embedding gather: dx[d] = int8_embed[tok*S+d] * scale[tok]
const EMBED_Q8 = `@group(0)@binding(0)var<storage,read>ids:array<u32>;@group(0)@binding(1)var<storage,read>te:array<u32>;@group(0)@binding(2)var<storage,read>scl:array<f32>;@group(0)@binding(3)var<storage,read_write>x:array<f32>;@group(0)@binding(4)var<uniform>p:vec4<u32>;
fn rdq(idx:u32)->f32{let w=te[idx>>2u];let sh=(idx&3u)*8u;let b=(w>>sh)&0xffu;return f32(i32(b<<24u)>>24u);}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let d=g.x;let pos=p.x;let S=p.y;if(d>=S){return;}let tok=ids[pos];x[d]=rdq(tok*S+d)*scl[tok];}`;

export async function createMoonshineASR(holoUrl, { onProgress, kappa = "", release = "", openStream = null } = {}) {
  if (!navigator.gpu) throw new Error("no WebGPU");
  const log = (s) => onProgress && onProgress(s);
  log("streaming Moonshine by κ…");
  const H0 = await (openStream || streamHolo)(holoUrl, { kappa, release });   // openStream = unified-pack view (fail-soft → streamHolo)
  const cfg = H0.meta.config, S = cfg.hidden_size, NH = cfg.encoder_num_attention_heads, hd = S / NH, IFF = cfg.intermediate_size;
  const NL = cfg.encoder_num_hidden_layers, DL = cfg.decoder_num_hidden_layers, VOCAB = cfg.vocab_size, scale = 1 / Math.sqrt(hd);
  const detok = makeDetok(JSON.parse(new TextDecoder().decode(H0.headerBytes)));
  const W = new Map(); await Promise.all(H0.meta.order.map(async (o) => W.set(o.name, await H0.getF32(o.name))));
  log(`streamed ${W.size} tensors · ${(H0.stats.bytesFetched / 1e6).toFixed(1)}MB · ${H0.stats.verifies} L5${H0.stats.opfsHits ? " · " + H0.stats.opfsHits + " OPFS" : ""}`);

  const dev = await (await navigator.gpu.requestAdapter()).requestDevice();
  const pipe = (c) => dev.createComputePipeline({ layout: "auto", compute: { module: dev.createShaderModule({ code: c }), entryPoint: "main" } });
  const P = { conv: pipe(CONV1F), tanh: pipe(TANH), gelu: pipe(GELU), gns: pipe(GNSTATS), gna: pipe(GNAPPLY), transp: pipe(TRANSP), tiled: pipe(TILED), tiledq8: pipe(TILED_Q8), ln: pipe(LN), rope: pipe(ROPE), attn: pipe(ATTN), swiglu: pipe(SWIGLU), add: pipe(ADD), emb: pipe(EMBED), embq8: pipe(EMBED_Q8), argmax: pipe(ARGMAX) };
  const sb = (k) => dev.createBuffer({ size: Math.max(4, k * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const wb = (a) => { const b = dev.createBuffer({ size: Math.max(4, a.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(b, 0, a); return b; };
  const u4 = (v) => { const b = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(b, 0, new Uint32Array([...v, 0, 0, 0, 0].slice(0, 4))); return b; };
  const f4 = (v) => { const b = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(b, 0, new Float32Array([...v, 0, 0, 0, 0].slice(0, 4))); return b; };
  const G = (k) => Math.ceil(k / 64), T16 = (x) => Math.ceil(x / 16);
  const bg = (pl, a) => dev.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: a.map((b, i) => ({ binding: i, resource: { buffer: b } })) });
  const disp = (e, pl, a, k, wg) => { const pa = e.beginComputePass(); pa.setPipeline(pl); pa.setBindGroup(0, bg(pl, a)); pa.dispatchWorkgroups(wg || G(k)); pa.end(); };
  const i8buf = (u8) => { const b = dev.createBuffer({ size: Math.max(4, Math.ceil(u8.length / 4) * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(b, 0, u8); return b; };
  // tile() now takes a TYPED weight w = {f32:buf} or {q8:buf, sc:buf} → routes to TILED or in-shader int8 TILED_Q8
  const tile = (e, A, w, bias, Y, rows, inD, outD, hb) => { const pa = e.beginComputePass();
    if (w.q8) { pa.setPipeline(P.tiledq8); pa.setBindGroup(0, bg(P.tiledq8, [A, w.q8, w.sc, bias, Y, u4([rows, inD, outD, hb])])); }
    else { pa.setPipeline(P.tiled); pa.setBindGroup(0, bg(P.tiled, [A, w.f32, bias, Y, u4([rows, inD, outD, hb])])); }
    pa.dispatchWorkgroups(T16(outD), T16(rows)); pa.end(); };
  const GW = (n) => wb(W.get(n)), dummy = wb(new Float32Array([0])), zeroS = wb(new Float32Array(S));
  const readback = async (buf, len) => { const rb = dev.createBuffer({ size: len * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }); const e = dev.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, rb, 0, len * 4); dev.queue.submit([e.finish()]); await rb.mapAsync(GPUMapMode.READ); const r = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy(); return r; };

  // resident weights: matmul weights (.q/k/v/o_proj, .fc1/fc2, embed) = TYPED (int8 in-shader when the .holo
  // is int8 → ¼ GPU mem + ~1.8× matmul); conv + 1D (norm/bias) stay f32 buffers. f16/f32 models → {f32} (untouched).
  const isMM = (n) => /(q_proj|k_proj|v_proj|o_proj|fc1|fc2)\.weight$/.test(n) || n === "model.decoder.embed_tokens.weight";
  const loadW = async (name) => { const q = await H0.getQuant(name); return q.q8 ? { q8: i8buf(q.int8), sc: wb(q.scales) } : { f32: wb(q.f32) }; };
  const EW = {}, DW = {};
  for (const o of H0.meta.order) {
    if (o.name.startsWith("model.encoder.")) EW[o.name] = isMM(o.name) ? await loadW(o.name) : GW(o.name);
    else if (o.name.startsWith("model.decoder.layers.")) DW[o.name] = isMM(o.name) ? await loadW(o.name) : GW(o.name);
  }
  const embedW = await loadW("model.decoder.embed_tokens.weight"), dnorm = GW("model.decoder.norm.weight");
  const q8model = !!embedW.q8;
  const fScale = f4([scale]), causal0 = u4([0]), causal1 = u4([1]), pb0 = u4([0]);
  const MAXTOK = 256, EOS = 2, BOS = 1;

  async function transcribe(pcm16k, { maxNew = 200 } = {}) {
    const tg = performance.now();
    const L = pcm16k.length, T1 = ((L - 127) / 64 | 0) + 1, T2 = ((T1 - 7) / 3 | 0) + 1, frames = ((T2 - 3) / 2 | 0) + 1, C2 = 2 * S;
    const pcmB = wb(pcm16k), c1 = sb(S * T1), c2 = sb(C2 * T2), c3 = sb(S * frames), gstat = sb(2), encX = sb(frames * S);
    let e = dev.createCommandEncoder();
    disp(e, P.conv, [pcmB, EW["model.encoder.conv1.weight"], dummy, c1, u4([1, S, 127, T1]), u4([L, 64, 0, 0])], S * T1);
    disp(e, P.tanh, [c1, u4([S * T1])], S * T1);
    disp(e, P.gns, [c1, gstat, u4([S * T1])], 0, 1);
    disp(e, P.gna, [c1, gstat, EW["model.encoder.groupnorm.weight"], EW["model.encoder.groupnorm.bias"], u4([S, T1])], S * T1);
    disp(e, P.conv, [c1, EW["model.encoder.conv2.weight"], EW["model.encoder.conv2.bias"], c2, u4([S, C2, 7, T2]), u4([T1, 3, 0, 1])], C2 * T2);
    disp(e, P.gelu, [c2, u4([C2 * T2])], C2 * T2);
    disp(e, P.conv, [c2, EW["model.encoder.conv3.weight"], EW["model.encoder.conv3.bias"], c3, u4([C2, S, 3, frames]), u4([T2, 2, 0, 1])], S * frames);
    disp(e, P.gelu, [c3, u4([S * frames])], S * frames);
    disp(e, P.transp, [c3, encX, u4([frames, S])], frames * S);
    // encoder layers
    const an = sb(frames * S), q = sb(frames * S), k = sb(frames * S), v = sb(frames * S), at = sb(frames * S), ao = sb(frames * S), mn = sb(frames * S), h1 = sb(frames * IFF), h2 = sb(frames * S);
    const aEnc = u4([frames, frames, NH, hd]), uNES = u4([frames, S]), uNEadd = u4([frames * S]), uIFF = u4([frames * IFF]), uRopeE = u4([frames, S, NH, hd]);
    for (let il = 0; il < NL; il++) { const pf = `model.encoder.layers.${il}.`;
      disp(e, P.ln, [encX, EW[pf + "input_layernorm.weight"], zeroS, an, uNES], frames);
      tile(e, an, EW[pf + "self_attn.q_proj.weight"], dummy, q, frames, S, S, 0);
      tile(e, an, EW[pf + "self_attn.k_proj.weight"], dummy, k, frames, S, S, 0);
      tile(e, an, EW[pf + "self_attn.v_proj.weight"], dummy, v, frames, S, S, 0);
      disp(e, P.rope, [q, uRopeE, pb0], frames * NH * 16); disp(e, P.rope, [k, uRopeE, pb0], frames * NH * 16);
      disp(e, P.attn, [q, k, v, at, aEnc, causal0, fScale], NH * frames);
      tile(e, at, EW[pf + "self_attn.o_proj.weight"], dummy, ao, frames, S, S, 0);
      disp(e, P.add, [encX, ao, uNEadd], frames * S);
      disp(e, P.ln, [encX, EW[pf + "post_attention_layernorm.weight"], zeroS, mn, uNES], frames);
      tile(e, mn, EW[pf + "mlp.fc1.weight"], EW[pf + "mlp.fc1.bias"], h1, frames, S, IFF, 1);
      disp(e, P.gelu, [h1, uIFF], frames * IFF);
      tile(e, h1, EW[pf + "mlp.fc2.weight"], EW[pf + "mlp.fc2.bias"], h2, frames, IFF, S, 1);
      disp(e, P.add, [encX, h2, uNEadd], frames * S);
    }
    const encO = sb(frames * S);
    disp(e, P.ln, [encX, EW["model.encoder.layer_norm.weight"], zeroS, encO, uNES], frames);
    // cross K/V per layer (once)
    const cK = [], cV = []; for (let il = 0; il < DL; il++) { const pf = `model.decoder.layers.${il}.`; cK[il] = sb(frames * S); cV[il] = sb(frames * S); tile(e, encO, DW[pf + "encoder_attn.k_proj.weight"], dummy, cK[il], frames, S, S, 0); tile(e, encO, DW[pf + "encoder_attn.v_proj.weight"], dummy, cV[il], frames, S, S, 0); }
    dev.queue.submit([e.finish()]);
    const encMs = Math.round(performance.now() - tg);

    // GPU-resident chunked decode: EMBED reads the ids buffer, GPU ARGMAX writes the next id → ONE submit
    // per chunk (no per-token CPU round-trip / 32768-logit readback). Read ids back per chunk to stop at EOS.
    const Kc = [], Vc = []; for (let il = 0; il < DL; il++) { Kc[il] = sb(MAXTOK * S); Vc[il] = sb(MAXTOK * S); }
    const idsB = dev.createBuffer({ size: (MAXTOK + 1) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(idsB, 0, new Uint32Array([BOS]));
    const idsRb = dev.createBuffer({ size: (MAXTOK + 1) * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const dx = sb(S), dan = sb(S), dq = sb(S), dk = sb(S), dvv = sb(S), dsa = sb(S), dso = sb(S), dcn = sb(S), dcq = sb(S), dcr = sb(S), dco = sb(S), dmn = sb(S), dh1 = sb(2 * IFF), dgg = sb(IFF), dh2 = sb(S), logitsB = sb(VOCAB);
    const u1 = u4([1, S]), aCross = u4([1, frames, NH, hd]), uadd = u4([S]), uswig = u4([1, IFF]);
    const gen = []; const td = performance.now(); const CH = 16, limit = Math.min(maxNew, MAXTOK - 2); let p = 0, eot = false;
    while (p < limit && !eot) {
      const end = Math.min(p + CH, limit); const ec = dev.createCommandEncoder();
      for (; p < end; p++) {
      const pbP = u4([p]), aSelf = u4([1, p + 1, NH, hd]), uRope1 = u4([1, S, NH, hd]);
      if (q8model) disp(ec, P.embq8, [idsB, embedW.q8, embedW.sc, dx, u4([p, S])], S);
      else disp(ec, P.emb, [idsB, embedW.f32, dx, u4([p, S])], S);
      for (let il = 0; il < DL; il++) { const pf = `model.decoder.layers.${il}.`;
        disp(ec, P.ln, [dx, DW[pf + "input_layernorm.weight"], zeroS, dan, u1], 1);
        tile(ec, dan, DW[pf + "self_attn.q_proj.weight"], dummy, dq, 1, S, S, 0);
        tile(ec, dan, DW[pf + "self_attn.k_proj.weight"], dummy, dk, 1, S, S, 0);
        tile(ec, dan, DW[pf + "self_attn.v_proj.weight"], dummy, dvv, 1, S, S, 0);
        disp(ec, P.rope, [dq, uRope1, pbP], NH * 16); disp(ec, P.rope, [dk, uRope1, pbP], NH * 16);
        ec.copyBufferToBuffer(dk, 0, Kc[il], p * S * 4, S * 4); ec.copyBufferToBuffer(dvv, 0, Vc[il], p * S * 4, S * 4);
        disp(ec, P.attn, [dq, Kc[il], Vc[il], dsa, aSelf, causal0, fScale], NH);
        tile(ec, dsa, DW[pf + "self_attn.o_proj.weight"], dummy, dso, 1, S, S, 0);
        disp(ec, P.add, [dx, dso, uadd], S);
        disp(ec, P.ln, [dx, DW[pf + "post_attention_layernorm.weight"], zeroS, dcn, u1], 1);
        tile(ec, dcn, DW[pf + "encoder_attn.q_proj.weight"], dummy, dcq, 1, S, S, 0);
        disp(ec, P.attn, [dcq, cK[il], cV[il], dcr, aCross, causal0, fScale], NH);
        tile(ec, dcr, DW[pf + "encoder_attn.o_proj.weight"], dummy, dco, 1, S, S, 0);
        disp(ec, P.add, [dx, dco, uadd], S);
        disp(ec, P.ln, [dx, DW[pf + "final_layernorm.weight"], zeroS, dmn, u1], 1);
        tile(ec, dmn, DW[pf + "mlp.fc1.weight"], DW[pf + "mlp.fc1.bias"], dh1, 1, S, 2 * IFF, 1);
        disp(ec, P.swiglu, [dh1, dgg, uswig], IFF);
        tile(ec, dgg, DW[pf + "mlp.fc2.weight"], DW[pf + "mlp.fc2.bias"], dh2, 1, IFF, S, 1);
        disp(ec, P.add, [dx, dh2, uadd], S);
      }
      disp(ec, P.ln, [dx, dnorm, zeroS, dan, u1], 1);
      tile(ec, dan, embedW, dummy, logitsB, 1, S, VOCAB, 0);
      disp(ec, P.argmax, [logitsB, idsB, u4([p + 1, VOCAB])], 0, 1);
      }
      ec.copyBufferToBuffer(idsB, 0, idsRb, 0, (MAXTOK + 1) * 4);
      dev.queue.submit([ec.finish()]);
      await idsRb.mapAsync(GPUMapMode.READ); const ids = new Uint32Array(idsRb.getMappedRange().slice(0)); idsRb.unmap();
      gen.length = 0; for (let i = 1; i <= p; i++) { if (ids[i] === EOS) { eot = true; break; } gen.push(ids[i]); }
    }
    const gpuMs = Math.round(performance.now() - tg), decMs = Math.round(performance.now() - td);
    [pcmB, c1, c2, c3, gstat, encX, an, q, k, v, at, ao, mn, h1, h2, encO, dx, dan, dq, dk, dvv, dsa, dso, dcn, dcq, dcr, dco, dmn, dh1, dgg, dh2, logitsB, idsB, idsRb, ...cK, ...cV, ...Kc, ...Vc].forEach((b) => b.destroy());
    return { text: detok(gen), ids: gen, gpuMs, encMs, decMs, frames, ms: gpuMs };
  }
  return { transcribe, config: cfg, S, encNL: NL, decNL: DL, stats: H0.stats };
}
