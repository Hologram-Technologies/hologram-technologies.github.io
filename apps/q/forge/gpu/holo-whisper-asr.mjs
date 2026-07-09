// holo-whisper-asr.mjs — Q's κ-native WebGPU ear, end-to-end and self-contained for the browser:
//   PCM(16k) → log-mel (fast, hoisted DFT) → conv-stem → tiled encoder → fused KV-cache greedy decode
//   → detok → text.  Weights are 100% κ-streamed from a .holo (HTTP-Range, per-block SHA-256 L5 verify,
//   OPFS cache) via holo-whisper-stream. Model-agnostic (base S=512 / tiny S=384; hd=64 assumed).
//   createWhisperASR(holoUrl) → { transcribe(pcm16k) -> {text, ids, melMs, gpuMs, ms}, hparams, ready }
import { streamHolo } from "./holo-whisper-stream.mjs";

// ── ggml whisper head: hparams + mel filterbank + vocab (from the .holo Extension) ──
function parseHead(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let o = 0;
  const i32 = () => { const v = dv.getInt32(o, true); o += 4; return v; };
  if (dv.getUint32(o, true) !== 0x67676d6c) throw new Error("bad ggml magic"); o += 4;
  const HP = ["n_vocab", "n_audio_ctx", "n_audio_state", "n_audio_head", "n_audio_layer", "n_text_ctx", "n_text_state", "n_text_head", "n_text_layer", "n_mels", "ftype"];
  const hparams = {}; for (const k of HP) hparams[k] = i32();
  const n_mel = i32(), n_fft = i32();
  const filters = new Float32Array(bytes.slice(o, o + n_mel * n_fft * 4).buffer); o += n_mel * n_fft * 4;
  const nVocab = i32(), tokens = []; for (let i = 0; i < nVocab; i++) { const len = i32(); tokens.push(bytes.subarray(o, o + len)); o += len; }
  return { hparams, nMel: n_mel, nBins: n_fft, filters, tokens };
}
// whisper.cpp log-mel: periodic Hann, nFft=400 window, hop=160, |DFT|² → mel filterbank → log10 + (max−8)/4
// normalization, padded/truncated to 30s. Power spectrum computed ONCE per frame (the oracle recomputed it
// per mel bin — 80× waste); numerically identical, ~80× faster. Returns mel[k*nFrames+f].
// Cos/sin DFT tables are large (nBins×nFft) and identical every call → build once, cache by nBins.
const _melTab = new Map();
function melTab(nBins, nFft) {
  let t = _melTab.get(nBins);
  if (!t) { const cosT = new Float32Array(nBins * nFft), sinT = new Float32Array(nBins * nFft); for (let b = 0; b < nBins; b++) for (let n = 0; n < nFft; n++) { const a = -2 * Math.PI * b * n / nFft; cosT[b * nFft + n] = Math.cos(a); sinT[b * nFft + n] = Math.sin(a); } t = { cosT, sinT }; _melTab.set(nBins, t); }
  return t;
}
function logMel(samples, filters, nMel, nBins) {
  const nFft = 400, hop = 160, nSamples = 480000;
  const x = new Float32Array(nSamples + nFft); x.set(samples.subarray(0, Math.min(samples.length, nSamples)));
  const nFrames = (nSamples / hop) | 0;
  // only the frames overlapping real audio carry signal; zero-padded silence → constant log10(1e-10)=-10.
  // Computing the DFT only over those frames makes mel cost scale with SPEECH length, not the 30s window.
  const realFrames = Math.min(nFrames, Math.ceil(Math.min(samples.length, nSamples) / hop) + 2);
  const hann = new Float32Array(nFft); for (let i = 0; i < nFft; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / nFft);
  const { cosT, sinT } = melTab(nBins, nFft);
  const mel = new Float32Array(nMel * nFrames).fill(-10), win = new Float32Array(nFft), pow = new Float32Array(nBins);
  let mmax = -Infinity;
  for (let f = 0; f < realFrames; f++) {
    const off = f * hop; for (let n = 0; n < nFft; n++) win[n] = hann[n] * x[off + n];
    for (let b = 0; b < nBins; b++) { let re = 0, im = 0; const tb = b * nFft; for (let n = 0; n < nFft; n++) { re += win[n] * cosT[tb + n]; im += win[n] * sinT[tb + n]; } pow[b] = re * re + im * im; }
    for (let k = 0; k < nMel; k++) { let s = 0; const fb = k * nBins; for (let b = 0; b < nBins; b++) s += filters[fb + b] * pow[b]; const lv = Math.log10(Math.max(s, 1e-10)); mel[k * nFrames + f] = lv; if (lv > mmax) mmax = lv; }
  }
  if (mmax === -Infinity) mmax = -10;
  const floor = mmax - 8; for (let i = 0; i < mel.length; i++) mel[i] = (Math.max(mel[i], floor) + 4) / 4;
  return mel;
}
function detok(tokens, ids) { let n = 0; for (const id of ids) if (id < tokens.length) n += tokens[id].length; const o = new Uint8Array(n); let p = 0; for (const id of ids) if (id < tokens.length) { o.set(tokens[id], p); p += tokens[id].length; } return new TextDecoder().decode(o); }

// ── WGSL (lifted verbatim from the witnessed harnesses) ──
const CONV1D = `@group(0)@binding(0)var<storage,read>inp:array<f32>;@group(0)@binding(1)var<storage,read>w:array<f32>;@group(0)@binding(2)var<storage,read_write>outp:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;@group(0)@binding(4)var<uniform>q:vec4<u32>;
fn f16r(x:f32)->f32{return unpack2x16float(pack2x16float(vec2<f32>(x,0.0))).x;}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let idx=g.x;let IC=p.x;let OC=p.y;let K=p.z;let OL=p.w;let L=q.x;let stride=q.y;let pad=q.z;if(idx>=OC*OL){return;}
let oc=idx/OL;let ol=idx%OL;var s=0.0;let wb=oc*IC*K;for(var ic=0u;ic<IC;ic++){let ib=ic*L;let wcb=wb+ic*K;for(var k=0u;k<K;k++){let ip=i32(ol*stride)-i32(pad)+i32(k);if(ip<0||ip>=i32(L)){continue;}s=s+f16r(inp[ib+u32(ip)])*w[wcb+k];}}outp[oc*OL+ol]=s;}`;
const GELUBIAS = `@group(0)@binding(0)var<storage,read_write>c:array<f32>;@group(0)@binding(1)var<storage,read>b:array<f32>;@group(0)@binding(2)var<uniform>p:vec4<u32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let idx=g.x;let OC=p.x;let OL=p.y;if(idx>=OC*OL){return;}let x=c[idx]+b[idx/OL];c[idx]=0.5*x*(1.0+tanh(0.7978845608028654*(x+0.044715*x*x*x)));}`;
const TPOS = `@group(0)@binding(0)var<storage,read>c2:array<f32>;@group(0)@binding(1)var<storage,read>pos:array<f32>;@group(0)@binding(2)var<storage,read_write>x:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let idx=g.x;let OL=p.x;let S=p.y;if(idx>=OL*S){return;}let pp=idx/S;let d=idx%S;x[idx]=c2[d*OL+pp]+pos[idx];}`;
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
const ATTN = `@group(0)@binding(0)var<storage,read>q:array<f32>;@group(0)@binding(1)var<storage,read>k:array<f32>;@group(0)@binding(2)var<storage,read>v:array<f32>;@group(0)@binding(3)var<storage,read_write>o:array<f32>;@group(0)@binding(4)var<uniform>p:vec4<u32>;@group(0)@binding(5)var<uniform>pc:vec4<u32>;@group(0)@binding(6)var<uniform>pf:vec4<f32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let idx=g.x;let nQ=p.x;let nK=p.y;let Hh=p.z;let hd=p.w;let Sd=Hh*hd;let scale=pf.x;if(idx>=Hh*nQ){return;}
let h=idx/nQ;let i=idx%nQ;let ho=h*hd;let qb=i*Sd+ho;let lim=select(nK,i+1u,pc.x==1u);
var m=-3.0e38;var l=0.0;var acc:array<f32,64>;for(var d=0u;d<hd;d++){acc[d]=0.0;}
for(var j=0u;j<lim;j++){let kb=j*Sd+ho;var s=0.0;for(var d=0u;d<hd;d++){s=s+q[qb+d]*k[kb+d];}s=s*scale;let mn=max(m,s);let corr=exp(m-mn);let e=exp(s-mn);l=l*corr+e;let vb=j*Sd+ho;for(var d=0u;d<hd;d++){acc[d]=acc[d]*corr+e*v[vb+d];}m=mn;}
let ob=i*Sd+ho;for(var d=0u;d<hd;d++){o[ob+d]=acc[d]/l;}}`;
const GELU = `@group(0)@binding(0)var<storage,read_write>c:array<f32>;@group(0)@binding(1)var<uniform>p:vec4<u32>;@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let idx=g.x;if(idx>=p.x){return;}let x=c[idx];c[idx]=0.5*x*(1.0+tanh(0.7978845608028654*(x+0.044715*x*x*x)));}`;
const ADD = `@group(0)@binding(0)var<storage,read_write>x:array<f32>;@group(0)@binding(1)var<storage,read>y:array<f32>;@group(0)@binding(2)var<uniform>p:vec4<u32>;@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let idx=g.x;if(idx>=p.x){return;}x[idx]=x[idx]+y[idx];}`;
const EMBED1 = `@group(0)@binding(0)var<storage,read>ids:array<u32>;@group(0)@binding(1)var<storage,read>te:array<f32>;@group(0)@binding(2)var<storage,read>pe:array<f32>;@group(0)@binding(3)var<storage,read_write>x:array<f32>;@group(0)@binding(4)var<uniform>p:vec4<u32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let d=g.x;let pos=p.x;let S=p.y;if(d>=S){return;}let tok=ids[pos];x[d]=te[tok*S+d]+pe[pos*S+d];}`;
const ARGMAX = `@group(0)@binding(0)var<storage,read>logits:array<f32>;@group(0)@binding(1)var<storage,read_write>ids:array<u32>;@group(0)@binding(2)var<uniform>p:vec4<u32>;
var<workgroup> bV:array<f32,256>;var<workgroup> bI:array<u32,256>;
@compute @workgroup_size(256)fn main(@builtin(local_invocation_id)l:vec3<u32>){let t=l.x;let VOCAB=p.y;var mv=-3.0e38;var mi=0u;
for(var i=t;i<VOCAB;i=i+256u){if(i>50256u&&i!=50257u){continue;}let s=logits[i];if(s>mv){mv=s;mi=i;}}
bV[t]=mv;bI[t]=mi;workgroupBarrier();
var stride=128u;loop{if(stride==0u){break;}if(t<stride){if(bV[t+stride]>bV[t]){bV[t]=bV[t+stride];bI[t]=bI[t+stride];}}workgroupBarrier();stride=stride/2u;}
if(t==0u){ids[p.x]=bI[0];}}`;
const makeFused = (S, FF) => {
  const SS = S * S, FFS = FF * S; let o = 0; const m = {};
  for (const [kk, len] of [["ALNW", S], ["ALNB", S], ["QW", SS], ["QB", S], ["KW", SS], ["VW", SS], ["VB", S], ["OW", SS], ["OB", S], ["CLNW", S], ["CLNB", S], ["CQW", SS], ["CQB", S], ["COW", SS], ["COB", S], ["MLNW", S], ["MLNB", S], ["M0W", FFS], ["M0B", FF], ["M2W", FFS], ["M2B", S]]) { m[kk] = o; o += len; }
  const code = `
@group(0)@binding(0)var<storage,read>W:array<f32>;@group(0)@binding(1)var<storage,read_write>dx:array<f32>;@group(0)@binding(2)var<storage,read_write>Kc:array<f32>;@group(0)@binding(3)var<storage,read_write>Vc:array<f32>;@group(0)@binding(4)var<storage,read>cK:array<f32>;@group(0)@binding(5)var<storage,read>cV:array<f32>;@group(0)@binding(6)var<uniform>P:vec4<u32>;
const ALNW=${m.ALNW}u;const ALNB=${m.ALNB}u;const QW=${m.QW}u;const QB=${m.QB}u;const KW=${m.KW}u;const VW=${m.VW}u;const VB=${m.VB}u;const OW=${m.OW}u;const OB=${m.OB}u;
const CLNW=${m.CLNW}u;const CLNB=${m.CLNB}u;const CQW=${m.CQW}u;const CQB=${m.CQB}u;const COW=${m.COW}u;const COB=${m.COB}u;
const MLNW=${m.MLNW}u;const MLNB=${m.MLNB}u;const M0W=${m.M0W}u;const M0B=${m.M0B}u;const M2W=${m.M2W}u;const M2B=${m.M2B}u;
var<workgroup> x:array<f32,${S}>;var<workgroup> an:array<f32,${S}>;var<workgroup> qh:array<f32,${S}>;var<workgroup> ff:array<f32,${FF}>;var<workgroup> red:array<f32,256>;
fn lnorm(t:u32,wo:u32,bo:u32){var a=0.0;for(var i=t;i<${S}u;i=i+256u){a=a+x[i];}red[t]=a;workgroupBarrier();
var st=128u;loop{if(st==0u){break;}if(t<st){red[t]=red[t]+red[t+st];}workgroupBarrier();st=st/2u;}
let mean=red[0]/${S}.0;workgroupBarrier();var v=0.0;for(var i=t;i<${S}u;i=i+256u){let d=x[i]-mean;v=v+d*d;}red[t]=v;workgroupBarrier();
st=128u;loop{if(st==0u){break;}if(t<st){red[t]=red[t]+red[t+st];}workgroupBarrier();st=st/2u;}
let rstd=1.0/sqrt(red[0]/${S}.0+1e-5);workgroupBarrier();for(var i=t;i<${S}u;i=i+256u){an[i]=(x[i]-mean)*rstd*W[wo+i]+W[bo+i];}workgroupBarrier();}
@compute @workgroup_size(256)fn main(@builtin(local_invocation_id)l:vec3<u32>){let t=l.x;let p=P.z;let nE=P.w;
for(var i=t;i<${S}u;i=i+256u){x[i]=dx[i];}workgroupBarrier();
lnorm(t,ALNW,ALNB);
for(var o=t;o<${S}u;o=o+256u){var sq=W[QB+o];var sk=0.0;var sv=W[VB+o];let qb=QW+o*${S}u;let kb=KW+o*${S}u;let vb=VW+o*${S}u;
for(var i=0u;i<${S}u;i++){let a=an[i];sq=sq+a*W[qb+i];sk=sk+a*W[kb+i];sv=sv+a*W[vb+i];}qh[o]=sq;Kc[p*${S}u+o]=sk;Vc[p*${S}u+o]=sv;}
workgroupBarrier();let nK=p+1u;
for(var oo=t;oo<${S}u;oo=oo+256u){let h=oo/64u;let d=oo%64u;let ho=h*64u;var m=-3.0e38;var ll=0.0;var ac=0.0;
for(var j=0u;j<nK;j++){var s=0.0;let kb=j*${S}u+ho;for(var e=0u;e<64u;e++){s=s+qh[ho+e]*Kc[kb+e];}s=s*0.125;
let mn=max(m,s);let cr=exp(m-mn);let ee=exp(s-mn);ll=ll*cr+ee;ac=ac*cr+ee*Vc[j*${S}u+ho+d];m=mn;}an[oo]=ac/ll;}
workgroupBarrier();
for(var o=t;o<${S}u;o=o+256u){var s=W[OB+o];let wb=OW+o*${S}u;for(var i=0u;i<${S}u;i++){s=s+an[i]*W[wb+i];}x[o]=x[o]+s;}workgroupBarrier();
lnorm(t,CLNW,CLNB);
for(var o=t;o<${S}u;o=o+256u){var s=W[CQB+o];let wb=CQW+o*${S}u;for(var i=0u;i<${S}u;i++){s=s+an[i]*W[wb+i];}qh[o]=s;}workgroupBarrier();
for(var oo=t;oo<${S}u;oo=oo+256u){let h=oo/64u;let d=oo%64u;let ho=h*64u;var m=-3.0e38;var ll=0.0;var ac=0.0;
for(var j=0u;j<nE;j++){var s=0.0;let kb=j*${S}u+ho;for(var e=0u;e<64u;e++){s=s+qh[ho+e]*cK[kb+e];}s=s*0.125;
let mn=max(m,s);let cr=exp(m-mn);let ee=exp(s-mn);ll=ll*cr+ee;ac=ac*cr+ee*cV[j*${S}u+ho+d];m=mn;}an[oo]=ac/ll;}
workgroupBarrier();
for(var o=t;o<${S}u;o=o+256u){var s=W[COB+o];let wb=COW+o*${S}u;for(var i=0u;i<${S}u;i++){s=s+an[i]*W[wb+i];}x[o]=x[o]+s;}workgroupBarrier();
lnorm(t,MLNW,MLNB);
for(var o=t;o<${FF}u;o=o+256u){var s=W[M0B+o];let wb=M0W+o*${S}u;for(var i=0u;i<${S}u;i++){s=s+an[i]*W[wb+i];}ff[o]=0.5*s*(1.0+tanh(0.7978845608028654*(s+0.044715*s*s*s)));}workgroupBarrier();
for(var o=t;o<${S}u;o=o+256u){var s=W[M2B+o];let wb=M2W+o*${FF}u;for(var i=0u;i<${FF}u;i++){s=s+ff[i]*W[wb+i];}x[o]=x[o]+s;}workgroupBarrier();
for(var i=t;i<${S}u;i=i+256u){dx[i]=x[i];}}`;
  return { code, EXP: o };
};

const PACK_ORDER = ["attn_ln.weight", "attn_ln.bias", "attn.query.weight", "attn.query.bias", "attn.key.weight", "attn.value.weight", "attn.value.bias", "attn.out.weight", "attn.out.bias", "cross_attn_ln.weight", "cross_attn_ln.bias", "cross_attn.query.weight", "cross_attn.query.bias", "cross_attn.out.weight", "cross_attn.out.bias", "mlp_ln.weight", "mlp_ln.bias", "mlp.0.weight", "mlp.0.bias", "mlp.2.weight", "mlp.2.bias"];

export async function createWhisperASR(holoUrl, { onProgress } = {}) {
  if (!navigator.gpu) throw new Error("no WebGPU");
  const log = (s) => { onProgress && onProgress(s); };
  log("streaming model by κ…");
  const H0 = await streamHolo(holoUrl);
  const head = parseHead(H0.headerBytes), hp = head.hparams;
  const S = hp.n_audio_state, H = hp.n_audio_head, hd = S / H, FF = 4 * S, encNL = hp.n_audio_layer, decNL = hp.n_text_layer;
  const VOCAB = hp.n_vocab, n_enc = hp.n_audio_ctx, IC0 = hp.n_mels, Kk = 3, L = 3000, scale = 1 / Math.sqrt(hd);
  if (hd !== 64) throw new Error("fused shader assumes hd=64, got " + hd);
  const fused = makeFused(S, FF);
  const W = new Map(); await Promise.all(H0.meta.order.map(async (o) => W.set(o.name, await H0.getF32(o.name))));
  log(`streamed ${W.size} tensors · ${(H0.stats.bytesFetched / 1e6).toFixed(1)}MB · ${H0.stats.verifies} L5 verifies${H0.stats.opfsHits ? " · " + H0.stats.opfsHits + " OPFS hits" : ""}`);

  const dev = await (await navigator.gpu.requestAdapter()).requestDevice();
  const pipe = (c) => dev.createComputePipeline({ layout: "auto", compute: { module: dev.createShaderModule({ code: c }), entryPoint: "main" } });
  const P = { conv: pipe(CONV1D), gb: pipe(GELUBIAS), tpos: pipe(TPOS), ln: pipe(LN), tiled: pipe(TILED), attn: pipe(ATTN), gelu: pipe(GELU), add: pipe(ADD), emb: pipe(EMBED1), argmax: pipe(ARGMAX), fused: pipe(fused.code) };
  const sb = (k) => dev.createBuffer({ size: Math.max(4, k * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const wb = (a) => { const b = dev.createBuffer({ size: Math.max(4, a.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(b, 0, a); return b; };
  const u4 = (v) => { const b = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(b, 0, new Uint32Array([...v, 0, 0, 0, 0].slice(0, 4))); return b; };
  const f4 = (v) => { const b = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(b, 0, new Float32Array([...v, 0, 0, 0, 0].slice(0, 4))); return b; };
  const G = (k) => Math.ceil(k / 64), T16 = (x) => Math.ceil(x / 16);
  const bg = (pl, a) => dev.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: a.map((b, i) => ({ binding: i, resource: { buffer: b } })) });
  const disp = (e, pl, a, k, wg) => { const pa = e.beginComputePass(); pa.setPipeline(pl); pa.setBindGroup(0, bg(pl, a)); pa.dispatchWorkgroups(wg || G(k)); pa.end(); };
  const tile = (e, A, B, bias, Y, rows, inD, outD, hb) => { const pa = e.beginComputePass(); pa.setPipeline(P.tiled); pa.setBindGroup(0, bg(P.tiled, [A, B, bias, Y, u4([rows, inD, outD, hb])])); pa.dispatchWorkgroups(T16(outD), T16(rows)); pa.end(); };

  // resident model buffers
  const EW = {}; for (const o of H0.meta.order) if (o.name.startsWith("encoder.")) EW[o.name] = wb(W.get(o.name));
  const tokEmb = wb(W.get("decoder.token_embedding.weight")), posEmb = wb(W.get("decoder.positional_embedding"));
  const dlnW = wb(W.get("decoder.ln.weight")), dlnB = wb(W.get("decoder.ln.bias")), dummy = wb(new Float32Array([0]));
  const c1w = wb(W.get("encoder.conv1.weight")), c1b = wb(W.get("encoder.conv1.bias")), c2w = wb(W.get("encoder.conv2.weight")), c2b = wb(W.get("encoder.conv2.bias")), epos = wb(W.get("encoder.positional_embedding"));
  const ckw = [], cvw = [], cvb = [], packW = [];
  for (let il = 0; il < decNL; il++) {
    const p = `decoder.blocks.${il}.`;
    ckw[il] = wb(W.get(p + "cross_attn.key.weight")); cvw[il] = wb(W.get(p + "cross_attn.value.weight")); cvb[il] = wb(W.get(p + "cross_attn.value.bias"));
    const parts = PACK_ORDER.map((n) => W.get(p + n)), tot = parts.reduce((a, b) => a + b.length, 0);
    if (tot !== fused.EXP) throw new Error(`pack ${tot}!=${fused.EXP}`);
    const buf = new Float32Array(tot); let o = 0; for (const pp of parts) { buf.set(pp, o); o += pp.length; } packW[il] = wb(buf);
  }
  W.clear();
  // resident encoder activations + cross K/V + decode KV-cache (reused across calls)
  const c1B = sb(S * L), c2B = sb(S * n_enc), encX = sb(n_enc * S);
  const an = sb(n_enc * S), q = sb(n_enc * S), k = sb(n_enc * S), v = sb(n_enc * S), at = sb(n_enc * S), ao = sb(n_enc * S), mn = sb(n_enc * S), h1 = sb(n_enc * FF), h2 = sb(n_enc * S);
  const cK = [], cV = [], Kc = [], Vc = []; const MAXTOK = 256;
  for (let l = 0; l < decNL; l++) { cK[l] = sb(n_enc * S); cV[l] = sb(n_enc * S); Kc[l] = sb(MAXTOK * S); Vc[l] = sb(MAXTOK * S); }
  const dx = sb(S), fnLast = sb(S), logitsB = sb(VOCAB);
  const fScale = f4([scale]), causal0 = u4([0]), uNE = u4([n_enc, S]), uNEadd = u4([n_enc * S]), uNEgelu = u4([n_enc * FF]), aEnc = u4([n_enc, n_enc, H, hd]), u1S = u4([1, S]);
  // whisper special tokens (derive from vocab; large-v3 shifts by +1)
  const TS = VOCAB - 1501, SOT = 50258, LANG_EN = 50259, TRANSCRIBE = TS - 5, NOTS = TS - 1, EOT = 50257;
  const prompt = [SOT, LANG_EN, TRANSCRIBE, NOTS], PN = prompt.length;

  async function transcribe(pcm16k, { maxNew = 200, lang = LANG_EN } = {}) {
    const t0 = performance.now();
    const mel = logMel(pcm16k, head.filters, head.nMel, head.nBins);
    const melMs = Math.round(performance.now() - t0);
    const tg = performance.now();
    const melB = wb(mel);
    // encoder (tiled) + cross K/V
    let e = dev.createCommandEncoder();
    disp(e, P.conv, [melB, c1w, c1B, u4([IC0, S, Kk, L]), u4([L, 1, 1])], S * L);
    disp(e, P.gb, [c1B, c1b, u4([S, L])], S * L);
    disp(e, P.conv, [c1B, c2w, c2B, u4([S, S, Kk, n_enc]), u4([L, 2, 1])], S * n_enc);
    disp(e, P.gb, [c2B, c2b, u4([S, n_enc])], S * n_enc);
    disp(e, P.tpos, [c2B, epos, encX, u4([n_enc, S])], n_enc * S);
    for (let il = 0; il < encNL; il++) {
      const T = (s) => EW[`encoder.blocks.${il}.` + s];
      disp(e, P.ln, [encX, T("attn_ln.weight"), T("attn_ln.bias"), an, uNE], n_enc);
      tile(e, an, T("attn.query.weight"), T("attn.query.bias"), q, n_enc, S, S, 1);
      tile(e, an, T("attn.key.weight"), dummy, k, n_enc, S, S, 0);
      tile(e, an, T("attn.value.weight"), T("attn.value.bias"), v, n_enc, S, S, 1);
      disp(e, P.attn, [q, k, v, at, aEnc, causal0, fScale], H * n_enc);
      tile(e, at, T("attn.out.weight"), T("attn.out.bias"), ao, n_enc, S, S, 1);
      disp(e, P.add, [encX, ao, uNEadd], n_enc * S);
      disp(e, P.ln, [encX, T("mlp_ln.weight"), T("mlp_ln.bias"), mn, uNE], n_enc);
      tile(e, mn, T("mlp.0.weight"), T("mlp.0.bias"), h1, n_enc, S, FF, 1);
      disp(e, P.gelu, [h1, uNEgelu], n_enc * FF);
      tile(e, h1, T("mlp.2.weight"), T("mlp.2.bias"), h2, n_enc, FF, S, 1);
      disp(e, P.add, [encX, h2, uNEadd], n_enc * S);
    }
    disp(e, P.ln, [encX, EW["encoder.ln_post.weight"], EW["encoder.ln_post.bias"], an, uNE], n_enc);
    for (let il = 0; il < decNL; il++) { tile(e, an, ckw[il], dummy, cK[il], n_enc, S, S, 0); tile(e, an, cvw[il], cvb[il], cV[il], n_enc, S, S, 1); }
    dev.queue.submit([e.finish()]);

    // chunked GPU-resident greedy decode (on-GPU argmax feeds next embed); read back per chunk to stop at EOT
    const Ptot = Math.min(PN + maxNew, MAXTOK - 1);
    const idsB = dev.createBuffer({ size: (Ptot + 1) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(idsB, 0, new Uint32Array(prompt));
    const rb = dev.createBuffer({ size: (Ptot + 1) * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const CH = 24; let p = 0; const gen = []; let eot = false;
    while (p < Ptot && !eot) {
      const end = Math.min(p + CH, Ptot);
      const ec = dev.createCommandEncoder();
      for (; p < end; p++) {
        disp(ec, P.emb, [idsB, tokEmb, posEmb, dx, u4([p, S])], S);
        for (let il = 0; il < decNL; il++) disp(ec, P.fused, [packW[il], dx, Kc[il], Vc[il], cK[il], cV[il], u4([S, FF, p, n_enc])], 0, 1);
        if (p >= PN - 1) { disp(ec, P.ln, [dx, dlnW, dlnB, fnLast, u1S], 1); tile(ec, fnLast, tokEmb, dummy, logitsB, 1, S, VOCAB, 0); disp(ec, P.argmax, [logitsB, idsB, u4([p + 1, VOCAB])], 0, 1); }
      }
      ec.copyBufferToBuffer(idsB, 0, rb, 0, (Ptot + 1) * 4);
      dev.queue.submit([ec.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const ids = new Uint32Array(rb.getMappedRange().slice(0)); rb.unmap();
      gen.length = 0; for (let i = PN; i <= p; i++) { if (ids[i] === EOT) { eot = true; break; } gen.push(ids[i]); }
    }
    idsB.destroy(); rb.destroy(); melB.destroy();
    await dev.queue.onSubmittedWorkDone();
    const gpuMs = Math.round(performance.now() - tg);
    return { text: detok(head.tokens, gen).trim(), ids: gen, melMs, gpuMs, ms: melMs + gpuMs };
  }

  return { transcribe, hparams: hp, vocabCount: VOCAB, S, decNL, encNL, stats: H0.stats };
}
