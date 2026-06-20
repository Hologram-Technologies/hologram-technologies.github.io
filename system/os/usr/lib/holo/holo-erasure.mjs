// holo-erasure.mjs — fractal/erasure redundancy for the κ substrate. Extends the native-store shard model
// (hologram-store-native: ordered (κ,size) shards, content-addressed, dedup'd) with Reed–Solomon PARITY
// over GF(256), so ANY k of (k+m) shards reconstruct the whole BYTE-EXACT — "cut it in half, still recover
// the whole" (the holographic property). The whole-object κ is UNCHANGED (erasure is an additional
// representation layer, L1-preserving); every data AND parity shard is itself a κ-object (blake3 σ-axis,
// matching the store); below k shards reconstruction FAILS CLOSED. Isomorphic pure JS (Node + browser).
//
// Code: a systematic [I_n ; C] encoding matrix where C is an m×n CAUCHY matrix over GF(256). The combined
// matrix is MDS (any n rows are invertible), which is exactly the any-k-of-(k+m) guarantee. Authority: the
// Reed–Solomon spec (MDS), verified exhaustively by holo-erasure-witness.mjs. Isomorphic: zero hard deps;
// blake3 is loaded by a relative dynamic import that resolves in both Node (file://) and the browser (/_shared/).

// ── GF(256) with primitive polynomial 0x11d (the standard RS / QR field) ──────────────────────────
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x = (x << 1) ^ ((x & 0x80) ? 0x11d : 0); x &= 0xff; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
const ginv = (a) => EXP[255 - LOG[a]];                 // a !== 0

// an m×n Cauchy matrix: C[i][j] = 1/(x_i ^ y_j), with X={n..n+m-1}, Y={0..n-1} disjoint ⇒ never singular.
function cauchy(n, m) {
  const C = [];
  for (let i = 0; i < m; i++) { const row = new Uint8Array(n); for (let j = 0; j < n; j++) row[j] = ginv((n + i) ^ j); C.push(row); }
  return C;
}
// the global encoding-matrix row for shard index r: identity row e_r for r<n, else the Cauchy row.
const growOf = (r, n, C) => { if (r < n) { const e = new Uint8Array(n); e[r] = 1; return e; } return C[r - n]; };

// invert an n×n GF(256) matrix (Gauss–Jordan on [A | I]); throws if singular (shouldn't happen for MDS rows).
function invert(A, n) {
  const M = A.map((row, i) => { const r = new Uint8Array(2 * n); r.set(row); r[n + i] = 1; return r; });
  for (let col = 0; col < n; col++) {
    let piv = col; while (piv < n && M[piv][col] === 0) piv++;
    if (piv === n) throw new Error("erasure: singular submatrix (unrecoverable)");
    if (piv !== col) { const t = M[piv]; M[piv] = M[col]; M[col] = t; }
    const inv = ginv(M[col][col]);
    for (let j = 0; j < 2 * n; j++) M[col][j] = gmul(M[col][j], inv);
    for (let r = 0; r < n; r++) { if (r === col) continue; const f = M[r][col]; if (!f) continue; for (let j = 0; j < 2 * n; j++) M[r][j] ^= gmul(f, M[col][j]); }
  }
  return M.map((r) => r.slice(n, 2 * n));
}

let _blake3 = null;
async function blake3hex(bytes) {
  if (!_blake3) _blake3 = (await import("./holo-blake3.mjs")).blake3hex;   // relative — resolves in Node (file://) and browser (/_shared/)
  return _blake3(bytes);
}
const kappaOf = async (bytes) => "did:holo:blake3:" + (await blake3hex(bytes));

// encode(bytes, {data, parity, shardSize}) → { manifest, shards } — data shards + RS parity, all κ-objects.
export async function encode(bytes, { data, parity, shardSize } = {}) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const n = data, m = parity, ss = shardSize || Math.ceil(u.length / n);
  if (n * ss < u.length) throw new Error("erasure: data*shardSize < input");
  // split into n data shards (zero-padded to ss)
  const dataShards = []; for (let j = 0; j < n; j++) { const s = new Uint8Array(ss); s.set(u.subarray(j * ss, Math.min((j + 1) * ss, u.length))); dataShards.push(s); }
  // m parity shards: parity_i = Σ_j C[i][j]·data_j  (per byte, over GF(256))
  const C = cauchy(n, m), parityShards = [];
  for (let i = 0; i < m; i++) { const p = new Uint8Array(ss); for (let j = 0; j < n; j++) { const c = C[i][j], dj = dataShards[j]; if (!c) continue; for (let b = 0; b < ss; b++) p[b] ^= gmul(c, dj[b]); } parityShards.push(p); }
  const shards = [];
  for (let j = 0; j < n; j++) shards.push({ index: j, role: "data", bytes: dataShards[j], kappa: await kappaOf(dataShards[j]) });
  for (let i = 0; i < m; i++) shards.push({ index: n + i, role: "parity", bytes: parityShards[i], kappa: await kappaOf(parityShards[i]) });
  const manifest = {
    "@type": "holo:ErasureManifest",
    kappa: await kappaOf(u),                              // the WHOLE-object κ — UNCHANGED (L1-preserving seam)
    data: n, parity: m, shardSize: ss, totalBytes: u.length,
    shards: shards.map((s) => ({ index: s.index, role: s.role, kappa: s.kappa })),
  };
  return { manifest, shards };
}

// reconstruct(manifest, availableShards) → Uint8Array — byte-exact from ANY k=data shards; throws below k.
export async function reconstruct(manifest, availableShards) {
  const n = manifest.data, ss = manifest.shardSize;
  // first n DISTINCT shard indices that are present (verify each κ before trusting it — Law L5)
  const seen = new Set(), rows = [], vals = [];
  for (const s of availableShards) {
    if (seen.has(s.index) || rows.length >= n) continue;
    const k = await kappaOf(s.bytes);
    const claimed = (manifest.shards.find((x) => x.index === s.index) || {}).kappa || s.kappa;
    if (k !== claimed) continue;                          // refuse a shard whose bytes don't re-derive to its κ
    seen.add(s.index); rows.push(s.index); vals.push(s.bytes);
  }
  if (rows.length < n) throw new Error(`erasure: only ${rows.length} of ${n} shards — unrecoverable (fail-closed)`);
  const C = cauchy(n, manifest.parity);
  const A = rows.map((r) => growOf(r, n, C));
  const Ainv = invert(A, n);
  // recover the n DATA shards: dataVec = Ainv · survivingVals (per byte)
  const out = new Uint8Array(n * ss);
  for (let b = 0; b < ss; b++) {
    for (let r = 0; r < n; r++) { let acc = 0; const ar = Ainv[r]; for (let c = 0; c < n; c++) { const f = ar[c]; if (f) acc ^= gmul(f, vals[c][b]); } out[r * ss + b] = acc; }
  }
  return out.subarray(0, manifest.totalBytes);
}

export default { encode, reconstruct };
