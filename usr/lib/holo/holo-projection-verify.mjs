// holo-projection-verify.mjs — the GPU κ-verifier (E1 of HOLO-PORTAL-ENGINE-PROMPT.md).
//
// The full BLAKE3 tree on the GPU without a readback bound: BLAKE3's tree for n chunks IS the binary
// decomposition of n — each set bit is a PERFECT power-of-two subtree, chained right-to-left with ROOT
// on the final compress. So: (1) chunkCVs — one invocation per 1024-B chunk (same compress core as the
// witness, KAT-proven lineage); (2) pairReduce — log2 passes per component collapse each perfect subtree
// to ONE CV on the GPU; (3) the CPU chains the ≤26 component CVs (a few compressions — microseconds).
// Readback = 32 B × components, not 32 B × chunks: the E0 fold/readback bound (2 MB, 65k folds for
// 64 MiB) collapses to under a kilobyte.
//
// L5 stance: this module ANSWERS "do these bytes derive this κ?" — callers refuse on false BEFORE any
// byte is cached, textured, or painted. Fail-soft: no WebGPU → makeGpuKappa() returns null and callers
// keep the JS ladder (the verifier is an accelerator, never a correctness dependency).

const WGSL = /* wgsl */`
const IV = array<u32,8>(0x6A09E667u,0xBB67AE85u,0x3C6EF372u,0xA54FF53Au,0x510E527Fu,0x9B05688Cu,0x1F83D9ABu,0x5BE0CD19u);
const CHUNK_START:u32=1u; const CHUNK_END:u32=2u; const PARENT:u32=4u; const ROOT:u32=8u;
struct Params { len:u32, count:u32, srcOff:u32, dstOff:u32 }
@group(0) @binding(0) var<storage,read> input: array<u32>;
@group(0) @binding(1) var<uniform> P: Params;
@group(0) @binding(2) var<storage,read_write> cvs: array<u32>;
var<private> m: array<u32,16>;
var<private> v: array<u32,16>;
fn rotr(x:u32, n:u32) -> u32 { return (x >> n) | (x << (32u - n)); }
fn g(a:u32,b:u32,c:u32,d:u32, mx:u32, my:u32) {
  v[a] = v[a] + v[b] + mx; v[d] = rotr(v[d]^v[a],16u);
  v[c] = v[c] + v[d];      v[b] = rotr(v[b]^v[c],12u);
  v[a] = v[a] + v[b] + my; v[d] = rotr(v[d]^v[a],8u);
  v[c] = v[c] + v[d];      v[b] = rotr(v[b]^v[c],7u);
}
fn round_() {
  g(0u,4u,8u,12u,  m[0], m[1]); g(1u,5u,9u,13u,  m[2], m[3]);
  g(2u,6u,10u,14u, m[4], m[5]); g(3u,7u,11u,15u, m[6], m[7]);
  g(0u,5u,10u,15u, m[8], m[9]); g(1u,6u,11u,12u, m[10],m[11]);
  g(2u,7u,8u,13u,  m[12],m[13]); g(3u,4u,9u,14u,  m[14],m[15]);
}
fn permute() {
  var t: array<u32,16>;
  t[0]=m[2]; t[1]=m[6]; t[2]=m[3]; t[3]=m[10]; t[4]=m[7]; t[5]=m[0]; t[6]=m[4]; t[7]=m[13];
  t[8]=m[1]; t[9]=m[11]; t[10]=m[12]; t[11]=m[5]; t[12]=m[9]; t[13]=m[14]; t[14]=m[15]; t[15]=m[8];
  for (var i=0u;i<16u;i++){ m[i]=t[i]; }
}
fn compress(cv: ptr<function, array<u32,8>>, counter:u32, blockLen:u32, flags:u32) {
  for (var i=0u;i<8u;i++){ v[i]=(*cv)[i]; }
  v[8]=IV[0]; v[9]=IV[1]; v[10]=IV[2]; v[11]=IV[3];
  v[12]=counter; v[13]=0u; v[14]=blockLen; v[15]=flags;
  round_(); permute(); round_(); permute(); round_(); permute();
  round_(); permute(); round_(); permute(); round_(); permute(); round_();
  for (var i=0u;i<8u;i++){ (*cv)[i]=v[i]^v[i+8u]; }
}
@compute @workgroup_size(64)
fn chunkCVs(@builtin(global_invocation_id) gid: vec3<u32>) {
  let c = gid.x;
  if (c >= P.count) { return; }
  let chunkLen = min(P.len - c * 1024u, 1024u);
  let counter = P.srcOff + c;                       // ABSOLUTE chunk index — segments verify mid-object
  var cv: array<u32,8>;
  for (var i=0u;i<8u;i++){ cv[i]=IV[i]; }
  var off:u32 = 0u;
  loop {
    let bl = min(chunkLen - off, 64u);
    for (var i=0u;i<16u;i++){ m[i]=0u; }
    for (var i=0u;i<(bl+3u)/4u;i++){ m[i]=input[c*256u + off/4u + i]; }
    var flags:u32 = 0u;
    if (off == 0u) { flags |= CHUNK_START; }
    let last = off + 64u >= chunkLen;
    if (last) { flags |= CHUNK_END; }
    compress(&cv, counter, bl, flags);
    if (last) { break; }
    off += 64u;
  }
  for (var i=0u;i<8u;i++){ cvs[c*8u + i]=cv[i]; }
}
// pairReduce: cvs[srcOff + 2j], cvs[srcOff + 2j+1] → parent → cvs[dstOff + j]  (never ROOT — CPU chains)
@compute @workgroup_size(64)
fn pairReduce(@builtin(global_invocation_id) gid: vec3<u32>) {
  let j = gid.x;
  if (j >= P.count) { return; }
  for (var i=0u;i<8u;i++){ m[i]=cvs[(P.srcOff + 2u*j)*8u + i]; m[i+8u]=cvs[(P.srcOff + 2u*j + 1u)*8u + i]; }
  var cv: array<u32,8>;
  for (var i=0u;i<8u;i++){ cv[i]=IV[i]; }
  compress(&cv, 0u, 64u, PARENT);
  for (var i=0u;i<8u;i++){ cvs[(P.dstOff + j)*8u + i]=cv[i]; }
}`;

// ── the tiny CPU side: compress (for the component chain) — same schedule, in-place typed arrays ──────
const IV = new Uint32Array([0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19]);
const PERM = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const _v = new Uint32Array(16), _m = new Uint32Array(16), _t = new Uint32Array(16);
const A = [0, 1, 2, 3, 0, 1, 2, 3], B = [4, 5, 6, 7, 5, 6, 7, 4], C = [8, 9, 10, 11, 10, 11, 8, 9], D = [12, 13, 14, 15, 15, 12, 13, 14];
function jsCompress(cv, block16, counter, blockLen, flags) {
  const v = _v; _m.set(block16);
  for (let i = 0; i < 8; i++) v[i] = cv[i];
  v[8] = IV[0]; v[9] = IV[1]; v[10] = IV[2]; v[11] = IV[3];
  v[12] = counter >>> 0; v[13] = 0; v[14] = blockLen; v[15] = flags;
  let m = _m;
  for (let r = 0; ; r++) {
    for (let q = 0; q < 8; q++) {
      const a = A[q], b = B[q], c = C[q], d = D[q];
      let va = v[a], vb = v[b], vc = v[c], vd = v[d];
      va = (va + vb + m[q * 2]) >>> 0; vd ^= va; vd = (vd >>> 16 | vd << 16) >>> 0;
      vc = (vc + vd) >>> 0; vb ^= vc; vb = (vb >>> 12 | vb << 20) >>> 0;
      va = (va + vb + m[q * 2 + 1]) >>> 0; vd ^= va; vd = (vd >>> 8 | vd << 24) >>> 0;
      vc = (vc + vd) >>> 0; vb ^= vc; vb = (vb >>> 7 | vb << 25) >>> 0;
      v[a] = va; v[b] = vb; v[c] = vc; v[d] = vd;
    }
    if (r === 6) break;
    for (let i = 0; i < 16; i++) _t[i] = m[PERM[i]];
    m.set(_t);
  }
  const out = new Uint32Array(8);
  for (let i = 0; i < 8; i++) out[i] = (v[i] ^ v[i + 8]) >>> 0;
  return out;
}
const PARENT = 4, ROOT = 8;
const _blk = new Uint32Array(16);
const parentCV = (l, r, root) => { _blk.set(l, 0); _blk.set(r, 8); return jsCompress(IV, _blk, 0, 64, PARENT | (root ? ROOT : 0)); };
const hexOf = (u32s) => Array.from(u32s, (w) => [w & 255, (w >>> 8) & 255, (w >>> 16) & 255, (w >>> 24) & 255].map((b) => b.toString(16).padStart(2, "0")).join("")).join("");

/** Segment layout for stream manifests: 256-chunk aligned groups (exact BLAKE3 subtree nodes) + the
 *  tail's binary components. Shared by the mint tool, the resolver (byte slicing) and the verifier. */
export function segmentsFor(size) {
  const n = Math.max(1, Math.ceil(size / 1024)), G = 256, segs = [];
  const full = Math.floor(n / G);
  for (let i = 0; i < full; i++) segs.push({ chunkOff: i * G, chunks: G });
  let rem = n - full * G, off = full * G;
  for (let bit = 8; bit >= 0 && rem; bit--) { const sz = 1 << bit; if (rem & sz) { segs.push({ chunkOff: off, chunks: sz }); off += sz; rem -= sz; } }
  return segs;
}
/** Fold verified SEGMENT CVs (spans in chunks) to the root — canonical incremental shape, ROOT last. */
export function foldSegmentCVs(segs) {
  if (segs.length === 1) return hexOf(segs[0].cv);
  const st = [];
  for (let i = 0; i < segs.length - 1; i++) {
    let cv = segs[i].cv, span = segs[i].chunks;
    while (st.length && st[st.length - 1][1] === span) { const [l, ls] = st.pop(); cv = parentCV(l, cv, false); span += ls; }
    st.push([cv, span]);
  }
  let cur = segs[segs.length - 1].cv;
  while (st.length) { const l = st.pop()[0]; cur = parentCV(l, cur, st.length === 0); }
  return hexOf(cur);
}

/** makeGpuKappa() → { hash(bytes) → hex, device } | null (no WebGPU → callers keep the JS ladder). */
export async function makeGpuKappa({ device: given = null } = {}) {
  try {
    let device = given;
    if (!device) {
      if (!navigator.gpu) return null;
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      device = await adapter.requestDevice();
    }
    const module = device.createShaderModule({ code: WGSL });
    const cvPipe = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "chunkCVs" } });
    const rdPipe = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "pairReduce" } });

    // single-chunk (≤1024 B) on CPU: CHUNK_START/END|ROOT over ≤16 blocks — GPU dispatch would cost more
    function jsSingleChunk(bytes) {
      let cv = IV.slice();
      const n = bytes.length;
      let off = 0;
      const CHUNK_START = 1, CHUNK_END = 2;
      do {
        const bl = Math.min(n - off, 64);
        _blk.fill(0);
        for (let i = 0; i < bl; i++) _blk[i >> 2] |= bytes[off + i] << ((i & 3) * 8);
        let flags = (off === 0 ? CHUNK_START : 0);
        const last = off + 64 >= n;
        if (last) flags |= CHUNK_END | ROOT;
        cv = jsCompress(cv, _blk, 0, bl, flags);
        off += 64;
      } while (off < n);
      return hexOf(cv);
    }

    async function hash(bytes) {
      const n = Math.max(1, Math.ceil(bytes.length / 1024));
      if (n === 1) return jsSingleChunk(bytes);                                     // the measured floor
      const inBuf = device.createBuffer({ size: Math.ceil(bytes.length / 4) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      if (bytes.length % 4) { const pad = new Uint8Array(Math.ceil(bytes.length / 4) * 4); pad.set(bytes); device.queue.writeBuffer(inBuf, 0, pad); }
      else device.queue.writeBuffer(inBuf, 0, bytes);
      // CV arena: chunk CVs [0..n) + TWO disjoint scratch regions (ping-pong — reducing in overlapping
      // regions races reads against writes; the two-region layout makes every level write disjoint)
      const half = Math.ceil(n / 2) + 1;
      const R1 = n, R2 = n + half;
      const cvBuf = device.createBuffer({ size: (n + 2 * half) * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      // finals live in their OWN buffer: WebGPU forbids same-buffer copyBufferToBuffer (the park would
      // silently validation-fail), and scratch is reused across components anyway.
      const finBuf = device.createBuffer({ size: 34 * 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      const pBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      // "auto" layouts contain ONLY the bindings an entry point actually uses — pairReduce never touches
      // input, so supplying binding 0 to its bind group is a validation error (and the pass silently
      // no-ops). Per-pipe entries.
      const bind = (pipe) => device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: (pipe === cvPipe
        ? [{ binding: 0, resource: { buffer: inBuf } }, { binding: 1, resource: { buffer: pBuf } }, { binding: 2, resource: { buffer: cvBuf } }]
        : [{ binding: 1, resource: { buffer: pBuf } }, { binding: 2, resource: { buffer: cvBuf } }]) });
      const dispatch = (pipe, params, count) => {
        device.queue.writeBuffer(pBuf, 0, new Uint32Array(params));
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipe); pass.setBindGroup(0, bind(pipe)); pass.dispatchWorkgroups(Math.ceil(count / 64)); pass.end();
        device.queue.submit([enc.finish()]);                                       // queue order = pass order
      };

      dispatch(cvPipe, [bytes.length, n, 0, 0], n);

      // binary decomposition: each set bit of n = a PERFECT subtree, contiguous left→right. Reduce each
      // on the GPU. A single component (n = 2^k) stops at TWO CVs so the CPU applies ROOT on the final
      // parent (the E0 lesson: a full on-GPU merge would finish without ROOT).
      const comps = [];
      { let off = 0; for (let bit = 31; bit >= 0; bit--) { const sz = 1 << bit; if (n & sz) { comps.push({ off, size: sz }); off += sz; } } }
      const single = comps.length === 1;
      let finTop = 0;                                                               // CVs parked in FIN so far
      for (const comp of comps) {
        let srcOff = comp.off, cnt = comp.size, level = 0;
        const stopAt = single ? 2 : 1;
        while (cnt > stopAt) {
          const dst = (level % 2 === 0) ? R1 : R2;
          dispatch(rdPipe, [0, cnt >> 1, srcOff, dst], cnt >> 1);
          srcOff = dst; cnt >>= 1; level++;
        }
        const enc = device.createCommandEncoder();                                  // park finals OUT of scratch (queue-ordered)
        enc.copyBufferToBuffer(cvBuf, srcOff * 32, finBuf, finTop * 32, cnt * 32);
        device.queue.submit([enc.finish()]);
        finTop += cnt;
      }
      const rd = device.createBuffer({ size: finTop * 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(finBuf, 0, rd, 0, finTop * 32);
      device.queue.submit([enc.finish()]);
      await rd.mapAsync(GPUMapMode.READ);
      const words = new Uint32Array(rd.getMappedRange().slice(0)); rd.unmap();
      inBuf.destroy(); cvBuf.destroy(); pBuf.destroy(); rd.destroy(); finBuf.destroy();

      if (single) return hexOf(parentCV(words.subarray(0, 8), words.subarray(8, 16), true));
      // chain component CVs right-to-left, ROOT on the final compress (canonical incremental shape)
      const cvsArr = comps.map((_, i) => words.subarray(i * 8, i * 8 + 8));
      let cur = cvsArr[cvsArr.length - 1];
      for (let i = cvsArr.length - 2; i >= 0; i--) cur = parentCV(cvsArr[i], cur, i === 0);
      return hexOf(cur);
    }
    // segmentCV: hash one ALIGNED pow2 segment (subtree node) — chunk counters are ABSOLUTE (chunkBase)
    async function segmentCV(bytes, chunkBase) {
      const n = Math.max(1, Math.ceil(bytes.length / 1024));
      const inBuf = device.createBuffer({ size: Math.ceil(bytes.length / 4) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      if (bytes.length % 4) { const pad = new Uint8Array(Math.ceil(bytes.length / 4) * 4); pad.set(bytes); device.queue.writeBuffer(inBuf, 0, pad); }
      else device.queue.writeBuffer(inBuf, 0, bytes);
      const half = Math.ceil(n / 2) + 1;
      const R1 = n, R2 = n + half;
      const cvBuf = device.createBuffer({ size: (n + 2 * half) * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const pBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const bind = (pipe) => device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: (pipe === cvPipe
        ? [{ binding: 0, resource: { buffer: inBuf } }, { binding: 1, resource: { buffer: pBuf } }, { binding: 2, resource: { buffer: cvBuf } }]
        : [{ binding: 1, resource: { buffer: pBuf } }, { binding: 2, resource: { buffer: cvBuf } }]) });
      const dispatch = (pipe, params, count) => {
        device.queue.writeBuffer(pBuf, 0, new Uint32Array(params));
        const enc = device.createCommandEncoder(); const pass = enc.beginComputePass();
        pass.setPipeline(pipe); pass.setBindGroup(0, bind(pipe)); pass.dispatchWorkgroups(Math.ceil(count / 64)); pass.end();
        device.queue.submit([enc.finish()]);
      };
      dispatch(cvPipe, [bytes.length, n, chunkBase, 0], n);
      let srcOff = 0, cnt = n, level = 0;
      while (cnt > 1) { const dst = (level % 2 === 0) ? R1 : R2; dispatch(rdPipe, [0, cnt >> 1, srcOff, dst], cnt >> 1); srcOff = dst; cnt >>= 1; level++; }
      const rd = device.createBuffer({ size: 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(cvBuf, srcOff * 32, rd, 0, 32); device.queue.submit([enc.finish()]);
      await rd.mapAsync(GPUMapMode.READ);
      const cv = new Uint32Array(rd.getMappedRange().slice(0)); rd.unmap();
      inBuf.destroy(); cvBuf.destroy(); pBuf.destroy(); rd.destroy();
      return cv;
    }
    return { hash, segmentCV, device };
  } catch (e) { return null; }
}
