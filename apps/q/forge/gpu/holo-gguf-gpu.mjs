// holo-gguf-gpu.mjs — the ONE WebGPU kernel runtime for the forge transformer forward.
//
// Single source of truth for the WGSL kernels + the dispatch/uniform-pool helpers that were
// duplicated inline in run-native.html AND holo-brain-engine.mjs (and the standalone gpu/*.html
// witnesses). run-native and Q's brain now import these EXACT kernels, so the standalone bit-exact
// witnesses prove the runtime kernels, not copies. The forward (kernel set + dispatch order) is the
// proven greedy-parity-with-llama.cpp path; this module only de-duplicates it.
//
// The one reconciled divergence: ATTN ships the sc[2048] (MAX_CTX) scratch — the superset of
// run-native's old sc[64] — so a single-forward and a multi-turn chat share one kernel. (Witnessed
// working at workgroup_size(64) on RDNA-3 in the brain engine.)

// ── matvecs ──
// generic per-32 (f32 scale + packed int8) weight · f32 activation
export const MATVECQ = `@group(0)@binding(0)var<storage,read>scales:array<f32>;@group(0)@binding(1)var<storage,read>quants:array<u32>;@group(0)@binding(2)var<storage,read>act:array<f32>;@group(0)@binding(3)var<storage,read_write>outv:array<f32>;@group(0)@binding(4)var<uniform>p:vec4<u32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let n=g.x;let N=p.x;let K=p.y;if(n>=N){return;}let nb=K/32u;var acc=0.0;for(var b=0u;b<nb;b++){let s=scales[n*nb+b];let base=n*K+b*32u;let ab=b*32u;var inner=0.0;for(var i=0u;i<32u;i++){let idx=base+i;let u=quants[idx>>2u];let lane=(idx&3u)*8u;let q=(i32(u<<(24u-lane)))>>24u;inner=inner+f32(q)*act[ab+i];}acc=acc+s*inner;}outv[p.z+n]=acc;}`;
// dense f32 weight · f32 activation
export const MATVECF = `@group(0)@binding(0)var<storage,read>W:array<f32>;@group(0)@binding(1)var<storage,read>x:array<f32>;@group(0)@binding(2)var<storage,read_write>y:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let n=g.x;let N=p.x;let K=p.y;if(n>=N){return;}var acc=0.0;let b=n*K;for(var k=0u;k<K;k++){acc=acc+W[b+k]*x[k];}y[p.z+n]=acc;}`;
// quantize an f32 activation row to Q8_0 (per-32 f32 scale + packed int8) — ggml's vec_dot_type for
// Q5_0/Q8_0/Q4_0. round-half-away matches roundf.
export const Q8QUANT = `@group(0)@binding(0)var<storage,read>x:array<f32>;@group(0)@binding(1)var<storage,read_write>scales:array<f32>;@group(0)@binding(2)var<storage,read_write>quants:array<u32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let b=g.x;let nb=p.x;if(b>=nb){return;}var amax=0.0;for(var i=0u;i<32u;i++){amax=max(amax,abs(x[b*32u+i]));}let d=amax/127.0;let id=select(0.0,1.0/d,amax>0.0);scales[b]=d;for(var j=0u;j<8u;j++){var packed=0u;for(var k=0u;k<4u;k++){let xi=x[b*32u+j*4u+k]*id;let q=select(i32(ceil(xi-0.5)),i32(floor(xi+0.5)),xi>=0.0);let qc=clamp(q,-127,127);packed=packed|((u32(qc)&0xffu)<<(k*8u));}quants[b*8u+j]=packed;}}`;
// integer dot: Q5_0/Q8_0/Q4_0 weight (per-32 scale+int8) · Q8_0 activation. Mirrors ggml
// vec_dot_q*_0_q8_0 (integer sumi per block, then wscale*ascale*sumi).
export const MATVECQI = `@group(0)@binding(0)var<storage,read>wscales:array<f32>;@group(0)@binding(1)var<storage,read>wquants:array<u32>;@group(0)@binding(2)var<storage,read>ascales:array<f32>;@group(0)@binding(3)var<storage,read>aquants:array<u32>;@group(0)@binding(4)var<storage,read_write>outv:array<f32>;@group(0)@binding(5)var<uniform>p:vec4<u32>;
fn d4(wu:u32,au:u32)->i32{return (i32(wu<<24u)>>24u)*(i32(au<<24u)>>24u)+(i32(wu<<16u)>>24u)*(i32(au<<16u)>>24u)+(i32(wu<<8u)>>24u)*(i32(au<<8u)>>24u)+(i32(wu)>>24u)*(i32(au)>>24u);}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let n=g.x;let N=p.x;let K=p.y;if(n>=N){return;}let nb=K/32u;var acc=0.0;for(var b=0u;b<nb;b++){var sumi=0;let wb=(n*K+b*32u)>>2u;let ab=(b*32u)>>2u;for(var u=0u;u<8u;u++){sumi=sumi+d4(wquants[wb+u],aquants[ab+u]);}acc=acc+wscales[n*nb+b]*ascales[b]*f32(sumi);}outv[p.z+n]=acc;}`;
// In-shader unpack: read the ORIGINAL ggml κ-block bytes (uploaded packed, ~half the upload + zero JS
// unpack) and dequantize per-element in WGSL. gb(i) reads byte i; unpack2x16float decodes the f16 scale.
export const MATVECQ5RAW = `@group(0)@binding(0)var<storage,read>rb:array<u32>;@group(0)@binding(1)var<storage,read>act:array<f32>;@group(0)@binding(2)var<storage,read_write>outv:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
fn gb(i:u32)->u32{return (rb[i>>2u]>>((i&3u)*8u))&0xffu;}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let n=g.x;let N=p.x;let K=p.y;if(n>=N){return;}let nb=K/32u;let rowBase=n*nb*22u;var acc=0.0;
for(var b=0u;b<nb;b++){let bp=rowBase+b*22u;let d=unpack2x16float(gb(bp)|(gb(bp+1u)<<8u)).x;let qh=gb(bp+2u)|(gb(bp+3u)<<8u)|(gb(bp+4u)<<16u)|(gb(bp+5u)<<24u);let qb=bp+6u;let aB=b*32u;
for(var j=0u;j<16u;j++){let qsj=gb(qb+j);let lo=i32((qsj&0xFu)|(((qh>>j)&1u)<<4u))-16;let hi=i32((qsj>>4u)|(((qh>>(j+16u))&1u)<<4u))-16;acc=acc+d*f32(lo)*act[aB+j]+d*f32(hi)*act[aB+j+16u];}}
outv[p.z+n]=acc;}`;
export const MATVECQ8RAW = `@group(0)@binding(0)var<storage,read>rb:array<u32>;@group(0)@binding(1)var<storage,read>act:array<f32>;@group(0)@binding(2)var<storage,read_write>outv:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
fn gb(i:u32)->u32{return (rb[i>>2u]>>((i&3u)*8u))&0xffu;}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let n=g.x;let N=p.x;let K=p.y;if(n>=N){return;}let nb=K/32u;let rowBase=n*nb*34u;var acc=0.0;
for(var b=0u;b<nb;b++){let bp=rowBase+b*34u;let d=unpack2x16float(gb(bp)|(gb(bp+1u)<<8u)).x;let qb=bp+2u;let aB=b*32u;
for(var i=0u;i<32u;i++){let q=(i32(gb(qb+i)<<24u))>>24u;acc=acc+d*f32(q)*act[aB+i];}}
outv[p.z+n]=acc;}`;

// BitNet TQ2_0 ternary in-shader GEMV (witnessed bit-faithful vs CPU oracle in gpu/bitnet-gemv.html):
// block = 256 elems / 66 bytes (64 B of 2-bit codes + f16 scale at +64). value = (q-1)·d, q∈{0,1,2}.
// Same signature as q5raw/q8raw (raw κ-block bytes in, f32 activation, output offset p.z) → slots into mv().
export const MATVECTQ2 = `@group(0)@binding(0)var<storage,read>rb:array<u32>;@group(0)@binding(1)var<storage,read>act:array<f32>;@group(0)@binding(2)var<storage,read_write>outv:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
fn gb(i:u32)->u32{return (rb[i>>2u]>>((i&3u)*8u))&0xffu;}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let n=g.x;let N=p.x;let K=p.y;if(n>=N){return;}let nb=K/256u;let rowBase=n*nb*66u;var acc=0.0;
for(var blk=0u;blk<nb;blk++){let base=rowBase+blk*66u;let d=unpack2x16float(gb(base+64u)|(gb(base+65u)<<8u)).x;let aB=blk*256u;
for(var oo=0u;oo<256u;oo++){let jb=oo>>7u;let l=(oo>>5u)&3u;let m=oo&31u;let q=(gb(base+jb*32u+m)>>(l*2u))&3u;acc=acc+(f32(q)-1.0)*d*act[aB+oo];}}
outv[p.z+n]=acc;}`;

// Quantize an f32 activation row to Q8_K (per-256 block: f32 scale + 256 int8) — bit-faithful to ggml
// quantize_row_q8_K_ref: iscale = -127/max (max = the SIGNED value of largest |·|), q = nearestInt
// (magic-round, round-half-to-even), top-only clamp min(127), d = 1/iscale (SIGNED). The vec_dot_type
// for TQ2_0/Q6_K. (Distinct from Q8_0's convention — don't reuse Q8QUANT here.)
export const Q8K = `@group(0)@binding(0)var<storage,read>x:array<f32>;@group(0)@binding(1)var<storage,read_write>ad:array<f32>;@group(0)@binding(2)var<storage,read_write>aq:array<u32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
fn ni(f:f32)->i32{let t=f+12582912.0;return (bitcast<i32>(t)&0x7fffff)-0x400000;}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let b=g.x;let nb=p.x;if(b>=nb){return;}
var amax=0.0;var maxv=0.0;for(var i=0u;i<256u;i++){let xv=x[b*256u+i];let ax=abs(xv);if(ax>amax){amax=ax;maxv=xv;}}
if(amax==0.0){ad[b]=0.0;for(var w=0u;w<64u;w++){aq[b*64u+w]=0u;}return;}
let iscale=-127.0/maxv;ad[b]=1.0/iscale;
for(var w=0u;w<64u;w++){var packed=0u;for(var k=0u;k<4u;k++){let qc=min(127,ni(iscale*x[b*256u+w*4u+k]));packed=packed|((u32(qc)&0xffu)<<(k*8u));}aq[b*64u+w]=packed;}}`;
// BitNet TQ2_0 · Q8_K INTEGER dot — bit-faithful mirror of vecDotTq2_0 (ggml_vec_dot_tq2_0_q8_K): per
// 256-block sumi = Σ q8[j*4+l*32+k]·(code-1), scaled once by actD·f16(wD). This is the path that matches
// llama.cpp greedy (the f32 dequant-dot is correct-but-different, like dense fast vs HIFI).
export const MATVECTQ2I = `@group(0)@binding(0)var<storage,read>rb:array<u32>;@group(0)@binding(1)var<storage,read>ad:array<f32>;@group(0)@binding(2)var<storage,read>aq:array<u32>;@group(0)@binding(3)var<storage,read_write>outv:array<f32>;@group(0)@binding(4)var<uniform>p:vec4<u32>;
fn gb(i:u32)->u32{return (rb[i>>2u]>>((i&3u)*8u))&0xffu;}
fn aqb(i:u32)->i32{return i32(aq[i>>2u]<<((3u-(i&3u))*8u))>>24u;}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let n=g.x;let N=p.x;let K=p.y;if(n>=N){return;}let nb=K/256u;let rowBase=n*nb*66u;var acc=0.0;
for(var blk=0u;blk<nb;blk++){let base=rowBase+blk*66u;let q8base=blk*256u;var sumi=0;
for(var j=0u;j<64u;j+=32u){for(var l=0u;l<4u;l++){for(var k=0u;k<32u;k++){let code=i32((gb(base+j+k)>>(l*2u))&3u)-1;sumi=sumi+aqb(q8base+j*4u+l*32u+k)*code;}}}
let d=ad[blk]*unpack2x16float(gb(base+64u)|(gb(base+65u)<<8u)).x;acc=acc+f32(sumi)*d;}
outv[p.z+n]=acc;}`;

// Q6_K · Q8_K INTEGER dot — mirror of vecDotQ6K (ggml_vec_dot_q6_K_q8_K). Block = 210 B (ql[128] +
// qh[64] + scales[16 int8] + f16 d). Per element: 6-bit weight (ql nibble | qh 2 bits) − 32, times the
// int8 activation, times the 16-int8 group scale; scaled per block by f16(wD)·actD. This is BitNet's
// tied lm_head arithmetic — the ONLY op that needs integer dot to match llama.cpp greedy (layers are
// robust in f32; the final argmax is not). Used for the lm_head; activation pre-quantized to Q8_K.
export const MATVECQ6KI = `@group(0)@binding(0)var<storage,read>rb:array<u32>;@group(0)@binding(1)var<storage,read>ad:array<f32>;@group(0)@binding(2)var<storage,read>aq:array<u32>;@group(0)@binding(3)var<storage,read_write>outv:array<f32>;@group(0)@binding(4)var<uniform>p:vec4<u32>;
fn gb(i:u32)->u32{return (rb[i>>2u]>>((i&3u)*8u))&0xffu;}
fn aqb(i:u32)->i32{return i32(aq[i>>2u]<<((3u-(i&3u))*8u))>>24u;}
fn s8(b:u32)->i32{return i32(b<<24u)>>24u;}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let n=g.x;let N=p.x;let K=p.y;if(n>=N){return;}let nb=K/256u;let rowBase=n*nb*210u;var acc=0.0;
for(var blk=0u;blk<nb;blk++){let bp=rowBase+blk*210u;let dW=unpack2x16float(gb(bp+208u)|(gb(bp+209u)<<8u)).x;let q8base=blk*256u;var bsum=0;
for(var jg=0u;jg<2u;jg++){let ql=bp+jg*64u;let qh=bp+128u+jg*32u;let aBase=jg*128u;
for(var l=0u;l<32u;l++){let qhl=gb(qh+l);
let v0=i32((gb(ql+l)&0xfu)|(((qhl)&3u)<<4u))-32;let v32=i32((gb(ql+l+32u)&0xfu)|(((qhl>>2u)&3u)<<4u))-32;let v64=i32((gb(ql+l)>>4u)|(((qhl>>4u)&3u)<<4u))-32;let v96=i32((gb(ql+l+32u)>>4u)|(((qhl>>6u)&3u)<<4u))-32;
let e0=aBase+l;let e32=aBase+l+32u;let e64=aBase+l+64u;let e96=aBase+l+96u;
bsum=bsum+s8(gb(bp+192u+(e0>>4u)))*aqb(q8base+e0)*v0+s8(gb(bp+192u+(e32>>4u)))*aqb(q8base+e32)*v32+s8(gb(bp+192u+(e64>>4u)))*aqb(q8base+e64)*v64+s8(gb(bp+192u+(e96>>4u)))*aqb(q8base+e96)*v96;}}
acc=acc+dW*ad[blk]*f32(bsum);}
outv[p.z+n]=acc;}`;

// F16 weight · F16 activation dot (BitNet ffn_down). llama rounds the activation to f16 before the dot;
// matching that (vs full-f32) is what tips the near-tie greedy. Weight stays f16 (2 per u32); h16 rounds
// the activation to f16. f32 accumulate.
export const MATVECF16 = `@group(0)@binding(0)var<storage,read>W:array<u32>;@group(0)@binding(1)var<storage,read>x:array<f32>;@group(0)@binding(2)var<storage,read_write>y:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
fn h16(v:f32)->f32{return unpack2x16float(pack2x16float(vec2<f32>(v,0.0))).x;}
fn wf(i:u32)->f32{let w=W[i>>1u];if((i&1u)==0u){return unpack2x16float(w).x;}return unpack2x16float(w).y;}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let n=g.x;let N=p.x;let K=p.y;if(n>=N){return;}var acc=0.0;let b=n*K;for(var k=0u;k<K;k++){acc=acc+wf(b+k)*h16(x[k]);}y[p.z+n]=acc;}`;

// Q4_K in-shader dequant-dot (raw κ-block bytes, f32 activation) — mirrors dequantQ4K exactly: block =
// 144 B (f16 d, f16 dmin, 12 B of 6-bit scales/mins via get_scale_min_k4, 128 B of 4-bit quants / 256
// elems). value = d·sc·q − dmin·m. This is the FAST path for Q4_K — it keeps the weight PACKED on the GPU
// (no f32 expansion: ~2.6× less VRAM for qwen-class models) instead of dequantizing to f32 on the host.
export const MATVECQ4KRAW = `@group(0)@binding(0)var<storage,read>rb:array<u32>;@group(0)@binding(1)var<storage,read>act:array<f32>;@group(0)@binding(2)var<storage,read_write>outv:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
fn gb(i:u32)->u32{return (rb[i>>2u]>>((i&3u)*8u))&0xffu;}
fn smk4(j:u32,scB:u32)->vec2<u32>{if(j<4u){return vec2<u32>(gb(scB+j)&63u,gb(scB+j+4u)&63u);}return vec2<u32>((gb(scB+j+4u)&0xFu)|((gb(scB+j-4u)>>6u)<<4u),(gb(scB+j+4u)>>4u)|((gb(scB+j)>>6u)<<4u));}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let n=g.x;let N=p.x;let K=p.y;if(n>=N){return;}let nb=K/256u;let rowBase=n*nb*144u;var acc=0.0;
for(var blk=0u;blk<nb;blk++){let base=rowBase+blk*144u;let d=unpack2x16float(gb(base)|(gb(base+1u)<<8u)).x;let dmin=unpack2x16float(gb(base+2u)|(gb(base+3u)<<8u)).x;let scB=base+4u;let qsB=base+16u;let aB=blk*256u;
for(var jj=0u;jj<4u;jj++){let s0=smk4(jj*2u,scB);let s1=smk4(jj*2u+1u,scB);let d1=d*f32(s0.x);let m1=dmin*f32(s0.y);let d2=d*f32(s1.x);let m2=dmin*f32(s1.y);let qb=qsB+jj*32u;let oB=aB+jj*64u;
for(var l=0u;l<32u;l++){let qv=gb(qb+l);acc=acc+(d1*f32(qv&0xFu)-m1)*act[oB+l]+(d2*f32(qv>>4u)-m2)*act[oB+32u+l];}}}
outv[p.z+n]=acc;}`;

// Q5_K in-shader dequant-dot (raw κ-block bytes, f32 activation) — mirrors dequantQ5K exactly: block = 176 B
// (f16 d, f16 dmin, 12 B scales via smk4, 32 B qh high-bits, 128 B ql 4-bit / 256 elems). value = d·sc·(ql |
// (qh_bit<<4)) − dmin·m. (The engine's older "q5raw" is Q5_0, a DIFFERENT format — qwen35's attn_qkv is Q5_K.)
export const MATVECQ5KRAW = `@group(0)@binding(0)var<storage,read>rb:array<u32>;@group(0)@binding(1)var<storage,read>act:array<f32>;@group(0)@binding(2)var<storage,read_write>outv:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
fn gb(i:u32)->u32{return (rb[i>>2u]>>((i&3u)*8u))&0xffu;}
fn smk4(j:u32,scB:u32)->vec2<u32>{if(j<4u){return vec2<u32>(gb(scB+j)&63u,gb(scB+j+4u)&63u);}return vec2<u32>((gb(scB+j+4u)&0xFu)|((gb(scB+j-4u)>>6u)<<4u),(gb(scB+j+4u)>>4u)|((gb(scB+j)>>6u)<<4u));}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let n=g.x;let N=p.x;let K=p.y;if(n>=N){return;}let nb=K/256u;let rowBase=n*nb*176u;var acc=0.0;
for(var blk=0u;blk<nb;blk++){let base=rowBase+blk*176u;let d=unpack2x16float(gb(base)|(gb(base+1u)<<8u)).x;let dmin=unpack2x16float(gb(base+2u)|(gb(base+3u)<<8u)).x;let scB=base+4u;let qhB=base+16u;let qlB=base+48u;let aB=blk*256u;
for(var jj=0u;jj<4u;jj++){let s0=smk4(jj*2u,scB);let s1=smk4(jj*2u+1u,scB);let d1=d*f32(s0.x);let m1=dmin*f32(s0.y);let d2=d*f32(s1.x);let m2=dmin*f32(s1.y);let qb=qlB+jj*32u;let oB=aB+jj*64u;let bl=jj*2u;let bh=jj*2u+1u;
for(var l=0u;l<32u;l++){let qv=gb(qb+l);let qhl=gb(qhB+l);let lo=f32((qv&0xFu)+(((qhl>>bl)&1u)*16u));let hi=f32((qv>>4u)+(((qhl>>bh)&1u)*16u));acc=acc+(d1*lo-m1)*act[oB+l]+(d2*hi-m2)*act[oB+32u+l];}}}
outv[p.z+n]=acc;}`;

// Q6_K in-shader dequant-dot (raw κ-block bytes, f32 activation) — the FAST path for Q6_K (e.g. qwen's
// ffn_down). Same block unpack as MATVECQ6KI (ql nibble | qh 2 bits − 32, ·d·s8(scale[e>>4])) but dotted
// against the f32 activation directly (no Q8_K quant). Keeps Q6_K PACKED on the GPU (no f32 expansion).
export const MATVECQ6KRAW = `@group(0)@binding(0)var<storage,read>rb:array<u32>;@group(0)@binding(1)var<storage,read>act:array<f32>;@group(0)@binding(2)var<storage,read_write>outv:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
fn gb(i:u32)->u32{return (rb[i>>2u]>>((i&3u)*8u))&0xffu;}
fn s8(b:u32)->i32{return i32(b<<24u)>>24u;}
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let n=g.x;let N=p.x;let K=p.y;if(n>=N){return;}let nb=K/256u;let rowBase=n*nb*210u;var acc=0.0;
for(var blk=0u;blk<nb;blk++){let bp=rowBase+blk*210u;let d=unpack2x16float(gb(bp+208u)|(gb(bp+209u)<<8u)).x;let aB=blk*256u;
for(var jg=0u;jg<2u;jg++){let ql=bp+jg*64u;let qh=bp+128u+jg*32u;let aBase=jg*128u;
for(var l=0u;l<32u;l++){let qhl=gb(qh+l);
let v0=f32(i32((gb(ql+l)&0xfu)|(((qhl)&3u)<<4u))-32);let v32=f32(i32((gb(ql+l+32u)&0xfu)|(((qhl>>2u)&3u)<<4u))-32);let v64=f32(i32((gb(ql+l)>>4u)|(((qhl>>4u)&3u)<<4u))-32);let v96=f32(i32((gb(ql+l+32u)>>4u)|(((qhl>>6u)&3u)<<4u))-32);
let e0=aBase+l;let e32=aBase+l+32u;let e64=aBase+l+64u;let e96=aBase+l+96u;
acc=acc+d*f32(s8(gb(bp+192u+(e0>>4u))))*v0*act[aB+e0]+d*f32(s8(gb(bp+192u+(e32>>4u))))*v32*act[aB+e32]+d*f32(s8(gb(bp+192u+(e64>>4u))))*v64*act[aB+e64]+d*f32(s8(gb(bp+192u+(e96>>4u))))*v96*act[aB+e96];}}}
outv[p.z+n]=acc;}`;

// TurboQuant / PolarQuant KV codec (4-bit). d = head_dim, U = u32/block (ceil(total/4)). The KV cache
// stores compact PQ4_0 blocks instead of f32 K vectors (~7× smaller for d=64) — the long-context memory
// win. ENCODE (1 thread/block, sequential FHT, bit-exact to tqEncodeKV): rotate (×signs, FHT, ×1/√d),
// norm, nearest-codebook nibble via boundaries, f16 norm. DECODE (d threads/block, parallel FHT): codebook
// ×norm → inverse rotate. Both reproduce the witnessed turbo-enc / turbo-attn-qjl kernels.
export const TQENC = (d, U) => `
const D:u32=${d}u; const U:u32=${U}u; const INV:f32=${Math.fround(1 / Math.fround(Math.sqrt(d)))};
@group(0)@binding(0)var<storage,read>x:array<f32>;@group(0)@binding(1)var<storage,read>signs:array<f32>;@group(0)@binding(2)var<storage,read_write>outp:array<u32>;@group(0)@binding(3)var<storage,read>B:array<f32>;@group(0)@binding(4)var<uniform>p:vec4<u32>;
fn qv4(v:f32)->u32{if(v<B[7]){if(v<B[3]){if(v<B[1]){return select(1u,0u,v<B[0]);}else{return select(3u,2u,v<B[2]);}}else{if(v<B[5]){return select(5u,4u,v<B[4]);}else{return select(7u,6u,v<B[6]);}}}else{if(v<B[11]){if(v<B[9]){return select(9u,8u,v<B[8]);}else{return select(11u,10u,v<B[10]);}}else{if(v<B[13]){return select(13u,12u,v<B[12]);}else{return select(15u,14u,v<B[14]);}}}}
@compute @workgroup_size(1) fn main(@builtin(workgroup_id) wid:vec3<u32>){
  let b=wid.x; let inBase=b*D; let outBase=p.x+b*U;       // p.x = pos·nBlocks·U
  var buf:array<f32,${d}>;
  for(var i=0u;i<D;i++){buf[i]=x[inBase+i]*signs[i];}
  var len:u32=1u; loop{ if(len>=D){break;} for(var i=0u;i<D;i=i+(len<<1u)){ for(var j=i;j<i+len;j++){let a=buf[j];let bb=buf[j+len];buf[j]=a+bb;buf[j+len]=a-bb;} } len=len<<1u; }
  for(var i=0u;i<D;i++){buf[i]=buf[i]*INV;}
  var ss=0.0; for(var i=0u;i<D;i++){ss=ss+buf[i]*buf[i];} let norm=sqrt(ss);
  for(var u=0u;u<U;u++){outp[outBase+u]=0u;}
  if(norm>=1e-15){let inv=1.0/norm;
    for(var r=0u;r<D;r=r+2u){let i0=qv4(buf[r]*inv);let i1=qv4(buf[r+1u]*inv);let bIdx=r>>1u;let v=i0|(i1<<4u);outp[outBase+(bIdx>>2u)]=outp[outBase+(bIdx>>2u)]|(v<<((bIdx&3u)*8u));}}
  outp[outBase+(D>>3u)]=pack2x16float(vec2<f32>(norm,0.0))&0xffffu;   // f16 norm at byte D/2 → u32 slot D/8
}`;
export const TQDEC = (d, U, cb) => `
const CB=array<f32,16>(${Array.from(cb).join(",")});
const D:u32=${d}u; const STRIDE:u32=${U * 4}u; const INV:f32=${1 / Math.sqrt(d)};
@group(0)@binding(0)var<storage,read>blk:array<u32>;@group(0)@binding(1)var<storage,read>signs:array<f32>;@group(0)@binding(2)var<storage,read_write>outp:array<f32>;
var<workgroup> sh:array<f32,${d}>;
fn gb(b:u32)->u32{let w=blk[b>>2u];return (w>>((b&3u)*8u))&0xffu;}
@compute @workgroup_size(${d}) fn main(@builtin(workgroup_id) wid:vec3<u32>,@builtin(local_invocation_id) lid:vec3<u32>){
  let o=lid.x; let base=wid.x*STRIDE;
  let d16=gb(base+(D>>1u))|(gb(base+(D>>1u)+1u)<<8u); let nrm=unpack2x16float(d16).x;
  let byte=gb(base+(o>>1u)); let idx=select(byte>>4u,byte&0xfu,(o&1u)==0u); sh[o]=CB[idx]*nrm;
  workgroupBarrier();
  var len:u32=1u; loop{ if(len>=D){break;} if((o&len)==0u){let a=sh[o];let b=sh[o+len];sh[o]=a+b;sh[o+len]=a-b;} workgroupBarrier(); len=len<<1u; }
  outp[wid.x*D+o]=sh[o]*signs[o]*INV;
}`;

// ── elementwise / norm / attention ──
export const ADD = `@group(0)@binding(0)var<storage,read>a:array<f32>;@group(0)@binding(1)var<storage,read>b:array<f32>;@group(0)@binding(2)var<storage,read_write>y:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let i=g.x;if(i>=p.x){return;}y[i]=a[i]+b[i];}`;
export const RMS = `@group(0)@binding(0)var<storage,read>x:array<f32>;@group(0)@binding(1)var<storage,read>w:array<f32>;@group(0)@binding(2)var<storage,read_write>y:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<f32>;
@compute @workgroup_size(1)fn main(){let N=u32(p.x);var ss=0.0;for(var i=0u;i<N;i++){ss=ss+x[i]*x[i];}let sc=1.0/sqrt(ss/p.x+p.y);for(var i=0u;i<N;i++){y[i]=x[i]*sc*w[i];}}`;
export const ROPE = `@group(0)@binding(0)var<storage,read>x:array<f32>;@group(0)@binding(1)var<storage,read_write>y:array<f32>;@group(0)@binding(2)var<uniform>a:vec4<f32>;@group(0)@binding(3)var<uniform>b:vec4<f32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let hd=u32(a.x);let nRot=u32(a.y);let nheads=u32(a.z);let pos=a.w;let half=nRot/2u;let idx=g.x;if(idx>=nheads*half){return;}let head=idx/half;let ic=idx%half;let base=head*hd;let ts=pow(b.x,-2.0/a.y);let th=pos*pow(ts,f32(ic));let c=cos(th);let s=sin(th);let x0=x[base+ic];let x1=x[base+ic+half];y[base+ic]=x0*c-x1*s;y[base+ic+half]=x0*s+x1*c;}`;
// NORM RoPE for the MLA q_pe/k_pe path (deepseek2 / glm-dsa) — pairs of CONSECUTIVE values
// (2k,2k+1), NOT NEOX (k,k+half). Mirrors gguf-forge-exec.ropeNormMla with y=null (plain):
// theta_k = pos·freqBase^(-2k/nRot). a=(headDim,nRot,nHeads,pos), b=(freqBase). One thread per
// (head,k). YaRN (scaled) adds a ramp+mscale term — deferred; DeepSeek-V2-Lite/GLM use plain here
// at freq_scale=1 for prompts ≤ orig_ctx, and the synthetic oracle is plain. hd==nRot on the pe split.
// b=(freqBase, yarnFlag, freqScale, mscale), cc=(extFactor, lo, hi, _). yarnFlag=0 → plain (mscale 1,
// theta=pos·thetaScale^k) byte-identical to before. yarnFlag=1 → ggml rope_yarn blend (mirrors
// gguf-forge-exec.ropeNormMla y-path): ti=freqScale·te; ramp=1−clamp((k−lo)/(hi−lo),0,1); mix=ramp·ext;
// theta=ti·(1−mix)+te·mix; cos/sin ×mscale. Compute freqScale/mscale/lo/hi CPU-side (the deepseek2
// attn_factor chain) and pass them in — kqScale stays scalar on MLAATTN, unaffected.
export const ROPENORM = `@group(0)@binding(0)var<storage,read>x:array<f32>;@group(0)@binding(1)var<storage,read_write>y:array<f32>;@group(0)@binding(2)var<uniform>a:vec4<f32>;@group(0)@binding(3)var<uniform>b:vec4<f32>;@group(0)@binding(4)var<uniform>cc:vec4<f32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let hd=u32(a.x);let nRot=u32(a.y);let nheads=u32(a.z);let pos=a.w;let half=nRot/2u;let idx=g.x;if(idx>=nheads*half){return;}let head=idx/half;let k=idx%half;let base=head*hd;let ts=pow(b.x,-2.0/a.y);let te=pos*pow(ts,f32(k));var theta=te;var ms=1.0;if(b.y>0.5){let ti=b.z*te;let ramp=1.0-clamp((f32(k)-cc.y)/max(0.001,cc.z-cc.y),0.0,1.0);let mix=ramp*cc.x;theta=ti*(1.0-mix)+te*mix;ms=b.w;}let c=cos(theta)*ms;let s=sin(theta)*ms;let x0=x[base+2u*k];let x1=x[base+2u*k+1u];y[base+2u*k]=x0*c-x1*s;y[base+2u*k+1u]=x0*s+x1*c;}`;
// causal attention, single query position, GQA. sc[2048] = MAX_CTX scratch (superset of the old sc[64]).
export const ATTN = `@group(0)@binding(0)var<storage,read>q:array<f32>;@group(0)@binding(1)var<storage,read>kc:array<f32>;@group(0)@binding(2)var<storage,read>vc:array<f32>;@group(0)@binding(3)var<storage,read_write>ctx:array<f32>;@group(0)@binding(4)var<uniform>a:vec4<u32>;@group(0)@binding(5)var<uniform>b:vec4<f32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let nh=a.x;let hd=a.y;let curPos=a.z;let kv=a.w;let scale=b.x;let grp=u32(b.y);let hh=g.x;if(hh>=nh){return;}let kvh=hh/grp;let qoff=hh*hd;let koff=kvh*hd;var sc:array<f32,2048>;var mx=-3.0e38;for(var s=0u;s<=curPos;s++){var d=0.0;for(var i=0u;i<hd;i++){d=d+q[qoff+i]*kc[s*kv+koff+i];}sc[s]=d*scale;if(sc[s]>mx){mx=sc[s];}}var sum=0.0;for(var s=0u;s<=curPos;s++){sc[s]=exp(sc[s]-mx);sum=sum+sc[s];}for(var i=0u;i<hd;i++){var acc=0.0;for(var s=0u;s<=curPos;s++){acc=acc+(sc[s]/sum)*vc[s*kv+koff+i];}ctx[qoff+i]=acc;}}`;
// MLA cached attention (deepseek2 / glm-dsa mla_attn) — each head attends its OWN K/V (no GQA
// grouping), the QUERY/KEY head dim (hk = nope+rope) differs from the VALUE head dim (hv). Mirrors
// gguf-forge-exec mla_attn's per-head score/softmax/context loop. a=(nh,hk,hv,curPos), b=(kqScale).
// Kc laid [pos][nh*hk], Vc laid [pos][nh*hv]; ctx out [nh*hv]. One thread per head.
export const MLAATTN = `@group(0)@binding(0)var<storage,read>q:array<f32>;@group(0)@binding(1)var<storage,read>kc:array<f32>;@group(0)@binding(2)var<storage,read>vc:array<f32>;@group(0)@binding(3)var<storage,read_write>ctx:array<f32>;@group(0)@binding(4)var<uniform>a:vec4<u32>;@group(0)@binding(5)var<uniform>b:vec4<f32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let nh=a.x;let hk=a.y;let hv=a.z;let curPos=a.w;let scale=b.x;let hh=g.x;if(hh>=nh){return;}let qoff=hh*hk;let voff=hh*hv;let ks=nh*hk;let vs=nh*hv;var sc:array<f32,2048>;var mx=-3.0e38;for(var s=0u;s<=curPos;s++){var d=0.0;for(var i=0u;i<hk;i++){d=d+q[qoff+i]*kc[s*ks+qoff+i];}sc[s]=d*scale;if(sc[s]>mx){mx=sc[s];}}var sum=0.0;for(var s=0u;s<=curPos;s++){sc[s]=exp(sc[s]-mx);sum=sum+sc[s];}for(var i=0u;i<hv;i++){var acc=0.0;for(var s=0u;s<=curPos;s++){acc=acc+(sc[s]/sum)*vc[s*vs+voff+i];}ctx[voff+i]=acc;}}`;
export const SWIGLU = `@group(0)@binding(0)var<storage,read>gt:array<f32>;@group(0)@binding(1)var<storage,read>up:array<f32>;@group(0)@binding(2)var<storage,read_write>y:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let i=g.x;if(i>=p.x){return;}let v=gt[i];y[i]=(v/(1.0+exp(-v)))*up[i];}`;
// SAXPY: y += scale·x. The LoRA adapter delta: after a base matvec y=W0·x, add scale·B·(A·x). p.x=scale, p.y=N.
export const SAXPY = `@group(0)@binding(0)var<storage,read>x:array<f32>;@group(0)@binding(1)var<storage,read_write>y:array<f32>;@group(0)@binding(2)var<uniform>p:vec4<f32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let i=g.x;if(i>=u32(p.y)){return;}y[i]=y[i]+p.x*x[i];}`;

// Q6_K TILED matvec (K=2048 / nb=8 — the lm_head + layer shape). One workgroup computes 8 output ROWS,
// 64 threads = 8 rows × 8 blocks (t = row·8 + blk) so ALL threads are active and the 8 threads of a row
// read ADJACENT blocks (210-byte stride, coalesced) instead of one thread striding a whole 1680-byte row
// (the naive kernel's ~0.5%-of-bandwidth killer). Activation staged in workgroup shared memory (reused by
// all 8 rows). Same dequant math as MATVECQ6KRAW → parity-exact. p=(N,K,zOff,_); dispatch ceil(N/8) groups.
export const MATVECQ6KTILED = `@group(0)@binding(0)var<storage,read>rb:array<u32>;@group(0)@binding(1)var<storage,read>act:array<f32>;@group(0)@binding(2)var<storage,read_write>outv:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
var<workgroup> sa:array<f32,2048>;var<workgroup> part:array<f32,64>;
fn gb(i:u32)->u32{return (rb[i>>2u]>>((i&3u)*8u))&0xffu;}
fn s8(b:u32)->i32{return i32(b<<24u)>>24u;}
@compute @workgroup_size(64)fn main(@builtin(workgroup_id)wid:vec3<u32>,@builtin(local_invocation_id)lid:vec3<u32>){
let N=p.x;let K=p.y;let t=lid.x;let row=t>>3u;let blk=t&7u;
for(var i=t;i<K;i=i+64u){sa[i]=act[i];}
workgroupBarrier();
let n=wid.x*8u+row;var acc=0.0;
if(n<N){let bp=n*8u*210u+blk*210u;let d=unpack2x16float(gb(bp+208u)|(gb(bp+209u)<<8u)).x;let aB=blk*256u;
for(var jg=0u;jg<2u;jg++){let ql=bp+jg*64u;let qh=bp+128u+jg*32u;let aBase=jg*128u;
for(var ll=0u;ll<32u;ll++){let qhl=gb(qh+ll);
let v0=f32(i32((gb(ql+ll)&0xfu)|(((qhl)&3u)<<4u))-32);let v32=f32(i32((gb(ql+ll+32u)&0xfu)|(((qhl>>2u)&3u)<<4u))-32);let v64=f32(i32((gb(ql+ll)>>4u)|(((qhl>>4u)&3u)<<4u))-32);let v96=f32(i32((gb(ql+ll+32u)>>4u)|(((qhl>>6u)&3u)<<4u))-32);
let e0=aBase+ll;let e32=aBase+ll+32u;let e64=aBase+ll+64u;let e96=aBase+ll+96u;
acc=acc+d*f32(s8(gb(bp+192u+(e0>>4u))))*v0*sa[aB+e0]+d*f32(s8(gb(bp+192u+(e32>>4u))))*v32*sa[aB+e32]+d*f32(s8(gb(bp+192u+(e64>>4u))))*v64*sa[aB+e64]+d*f32(s8(gb(bp+192u+(e96>>4u))))*v96*sa[aB+e96];}}}
part[t]=acc;workgroupBarrier();
if(blk==0u&&n<N){var s=0.0;for(var b=0u;b<8u;b++){s=s+part[row*8u+b];}outv[p.z+n]=s;}}`;

// Q4_K TILED matvec (any K; K≤2048 for the shared-act stage) — attn (K=2048) + gate/up experts (K=2048).
// Same 8-rows×8-subthreads coalesced structure as MATVECQ6KTILED but each sub-thread strides its row's blocks
// (blk = sub, sub+8, …) so it generalizes to any nb. Dequant math == MATVECQ4KRAW (get_scale_min_k4). p=(N,K,z,_).
export const MATVECQ4KTILED = `@group(0)@binding(0)var<storage,read>rb:array<u32>;@group(0)@binding(1)var<storage,read>act:array<f32>;@group(0)@binding(2)var<storage,read_write>outv:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
var<workgroup> sa:array<f32,2048>;var<workgroup> part:array<f32,64>;
fn gb(i:u32)->u32{return (rb[i>>2u]>>((i&3u)*8u))&0xffu;}
fn smk4(j:u32,scB:u32)->vec2<u32>{if(j<4u){return vec2<u32>(gb(scB+j)&63u,gb(scB+j+4u)&63u);}return vec2<u32>((gb(scB+j+4u)&0xFu)|((gb(scB+j-4u)>>6u)<<4u),(gb(scB+j+4u)>>4u)|((gb(scB+j)>>6u)<<4u));}
@compute @workgroup_size(64)fn main(@builtin(workgroup_id)wid:vec3<u32>,@builtin(local_invocation_id)lid:vec3<u32>){
let N=p.x;let K=p.y;let nb=K/256u;let t=lid.x;let row=t>>3u;let sub=t&7u;
for(var i=t;i<K;i=i+64u){sa[i]=act[i];}
workgroupBarrier();
let n=wid.x*8u+row;var acc=0.0;
if(n<N){let rowBase=n*nb*144u;
for(var blk=sub;blk<nb;blk=blk+8u){let base=rowBase+blk*144u;let d=unpack2x16float(gb(base)|(gb(base+1u)<<8u)).x;let dmin=unpack2x16float(gb(base+2u)|(gb(base+3u)<<8u)).x;let scB=base+4u;let qsB=base+16u;let aB=blk*256u;
for(var jj=0u;jj<4u;jj++){let s0=smk4(jj*2u,scB);let s1=smk4(jj*2u+1u,scB);let d1=d*f32(s0.x);let m1=dmin*f32(s0.y);let d2=d*f32(s1.x);let m2=dmin*f32(s1.y);let qb=qsB+jj*32u;let oB=aB+jj*64u;
for(var l=0u;l<32u;l++){let qv=gb(qb+l);acc=acc+(d1*f32(qv&0xFu)-m1)*sa[oB+l]+(d2*f32(qv>>4u)-m2)*sa[oB+32u+l];}}}}
part[t]=acc;workgroupBarrier();
if(sub==0u&&n<N){var ss=0.0;for(var b=0u;b<8u;b++){ss=ss+part[row*8u+b];}outv[p.z+n]=ss;}}`;

// Q8_0 TILED matvec (any K; K≤2048) — down experts (K=1408, nb=44). 8-rows×8-subthreads, strided blocks, shared
// activation, 8-way reduction. Dequant math == MATVECQ8RAW (f16 scale + int8). p=(N,K,z,_).
export const MATVECQ8TILED = `@group(0)@binding(0)var<storage,read>rb:array<u32>;@group(0)@binding(1)var<storage,read>act:array<f32>;@group(0)@binding(2)var<storage,read_write>outv:array<f32>;@group(0)@binding(3)var<uniform>p:vec4<u32>;
var<workgroup> sa:array<f32,2048>;var<workgroup> part:array<f32,64>;
fn gb(i:u32)->u32{return (rb[i>>2u]>>((i&3u)*8u))&0xffu;}
@compute @workgroup_size(64)fn main(@builtin(workgroup_id)wid:vec3<u32>,@builtin(local_invocation_id)lid:vec3<u32>){
let N=p.x;let K=p.y;let nb=K/32u;let t=lid.x;let row=t>>3u;let sub=t&7u;
for(var i=t;i<K;i=i+64u){sa[i]=act[i];}
workgroupBarrier();
let n=wid.x*8u+row;var acc=0.0;
if(n<N){let rowBase=n*nb*34u;
for(var blk=sub;blk<nb;blk=blk+8u){let base=rowBase+blk*34u;let d=unpack2x16float(gb(base)|(gb(base+1u)<<8u)).x;let qb=base+2u;let aB=blk*32u;
for(var i=0u;i<32u;i++){let q=(i32(gb(qb+i)<<24u))>>24u;acc=acc+d*f32(q)*sa[aB+i];}}}
part[t]=acc;workgroupBarrier();
if(sub==0u&&n<N){var ss=0.0;for(var b=0u;b<8u;b++){ss=ss+part[row*8u+b];}outv[p.z+n]=ss;}}`;

// MLA assemble (deepseek2/glm mla_attn) — GPU-side interleave of the decompressed KV + roped pe into
// per-head Qcur/Kcur (hk = nope+rope) and Vcur (hv), so the MLA path needs NO CPU readback. Mirrors the
// CPU loop in gguf-forge-exec mla_attn / holo-mla-gpu.mjs. a=(NH,HK,HV,ROPE), b=(NOPE,step=NOPE+HV). One
// thread per head. q=[NH*HK] (pre-split query), kv=[NH*step] (decompressed), qpe=[NH*ROPE], kpe=[ROPE] (roped).
export const MLAASM = `@group(0)@binding(0)var<storage,read>q:array<f32>;@group(0)@binding(1)var<storage,read>kv:array<f32>;@group(0)@binding(2)var<storage,read>qpe:array<f32>;@group(0)@binding(3)var<storage,read>kpe:array<f32>;@group(0)@binding(4)var<storage,read_write>Qc:array<f32>;@group(0)@binding(5)var<storage,read_write>Kc:array<f32>;@group(0)@binding(6)var<storage,read_write>Vc:array<f32>;@group(0)@binding(7)var<uniform>a:vec4<u32>;@group(0)@binding(8)var<uniform>b:vec4<u32>;
@compute @workgroup_size(64)fn main(@builtin(global_invocation_id)g:vec3<u32>){let NH=a.x;let HK=a.y;let HV=a.z;let ROPE=a.w;let NOPE=b.x;let step=b.y;let hh=g.x;if(hh>=NH){return;}for(var d=0u;d<NOPE;d++){Kc[hh*HK+d]=kv[hh*step+d];Qc[hh*HK+d]=q[hh*HK+d];}for(var d=0u;d<ROPE;d++){Kc[hh*HK+NOPE+d]=kpe[d];Qc[hh*HK+NOPE+d]=qpe[hh*ROPE+d];}for(var d=0u;d<HV;d++){Vc[hh*HV+d]=kv[hh*step+NOPE+d];}}`;

// dispatch-group helper (workgroup_size 64): how many workgroups cover n lanes.
export const G = (n) => Math.ceil(n / 64);

// createGpuRuntime(dev) — compile every pipeline once + return the dispatch/uniform/buffer helpers.
//   P            : the compiled compute pipelines, keyed (q/qi/q8/q5raw/q8raw/f/add/rms/rope/attn/swiglu)
//   disp         : encode one compute pass (pipeline + bind group from a flat buffer list + workgroups)
//   u4/f4        : write a vec4 uniform from the cycling 16-byte pool (call resetUniforms() per token)
//   sbuf/wF/rawU32: storage buffer / upload f32 array / upload raw κ-block bytes as u32
//   resetUniforms: rewind the uniform pool at the start of each token's single submit
export function createGpuRuntime(dev) {
  const pipe = (c) => { const m = dev.createShaderModule({ code: c }); return dev.createComputePipeline({ layout: "auto", compute: { module: m, entryPoint: "main" } }); };
  const P = { q: pipe(MATVECQ), qi: pipe(MATVECQI), q8: pipe(Q8QUANT), q8k: pipe(Q8K), q5raw: pipe(MATVECQ5RAW), q5kraw: pipe(MATVECQ5KRAW), q8raw: pipe(MATVECQ8RAW), q4kraw: pipe(MATVECQ4KRAW), tq2: pipe(MATVECTQ2), tq2i: pipe(MATVECTQ2I), q6ki: pipe(MATVECQ6KI), q6kraw: pipe(MATVECQ6KRAW), f16: pipe(MATVECF16), f: pipe(MATVECF), add: pipe(ADD), rms: pipe(RMS), rope: pipe(ROPE), ropenorm: pipe(ROPENORM), attn: pipe(ATTN), mlaattn: pipe(MLAATTN), mlaasm: pipe(MLAASM), swiglu: pipe(SWIGLU), saxpy: pipe(SAXPY), q6ktiled: pipe(MATVECQ6KTILED), q4ktiled: pipe(MATVECQ4KTILED), q8tiled: pipe(MATVECQ8TILED) };
  const _upool = []; for (let i = 0; i < 1024; i++) _upool.push(dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
  let _pidx = 0;
  const resetUniforms = () => { _pidx = 0; };
  const u4 = (v) => { const b = _upool[_pidx++]; dev.queue.writeBuffer(b, 0, new Uint32Array([...v, 0, 0, 0, 0].slice(0, 4))); return b; };
  const f4 = (v) => { const b = _upool[_pidx++]; dev.queue.writeBuffer(b, 0, new Float32Array([...v, 0, 0, 0, 0].slice(0, 4))); return b; };
  const sbuf = (n) => dev.createBuffer({ size: Math.max(4, n * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const wF = (arr) => { const b = dev.createBuffer({ size: Math.max(4, arr.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(b, 0, arr); return b; };
  const rawU32 = (b) => wF(new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4));
  const disp = (enc, pl, bufs, groups) => { const bg = dev.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: bufs.map((b, i) => ({ binding: i, resource: { buffer: b } })) }); const pa = enc.beginComputePass(); pa.setPipeline(pl); pa.setBindGroup(0, bg); pa.dispatchWorkgroups(groups); pa.end(); };
  return { P, disp, u4, f4, sbuf, wF, rawU32, resetUniforms };
}
