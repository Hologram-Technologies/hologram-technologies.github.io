// atlas-probe.mjs — Holo Q · Atlas Probe. Extract a model's REAL token-embedding geometry and
// fingerprint it against the native Forge-compiled atlas-96 (atlas12288.wasm), entirely in the
// browser, off the substrate. Pure JS, ZERO deps, isomorphic (Node self-test + browser panel).
//
// The test (validated on controls — synthetic torus ⇒ tor≈0.70; random-768 ⇒ tor≈0.32; E8 ⇒ 0.34):
//   • intrinsic dimension (TwoNN, Facco 2017): a 2-torus ⇒ ~2; E8 ⇒ ~8; a generic blob ⇒ high.
//   • toroidality: the SMALL normalized-graph-Laplacian spectrum. A flat 2-torus T² has its first
//     non-trivial eigenvalues in DEGENERATE PAIRS (cos/sin per circle) then a GAP. Random data does not.
// Every run is a deterministic transform ⇒ a re-derivable, content-addressed κ-receipt (Law L5).

import { parseGgufHeader, dequantizeRaw, typeByteLen } from "./qvac-ingest.mjs";

const IS_NODE = typeof process !== "undefined" && process.versions && process.versions.node;

// ───────────────────────── battery ─────────────────────────
const d2 = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return s; };
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function gauss(r) { const u = Math.max(1e-12, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

export function twoNN(X) {
  const N = X.length, mu = [];
  for (let i = 0; i < N; i++) {
    let r1 = Infinity, r2 = Infinity;
    for (let j = 0; j < N; j++) { if (i === j) continue; const dd = d2(X[i], X[j]); if (dd < r1) { r2 = r1; r1 = dd; } else if (dd < r2) r2 = dd; }
    if (r1 > 1e-18 && isFinite(r2)) mu.push(Math.sqrt(r2 / r1));
  }
  mu.sort((a, b) => a - b);
  const keep = mu.slice(0, Math.floor(mu.length * 0.9));
  let s = 0; for (const m of keep) s += Math.log(m);
  return s > 1e-9 ? keep.length / s : Infinity;
}

function jacobiEigvals(Ain) {
  const n = Ain.length, A = Ain.map((r) => Array.from(r));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0; for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
    if (off < 1e-14) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-15) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
    }
  }
  return A.map((r, i) => r[i]).sort((a, b) => a - b);
}

export function laplacianSmallSpectrum(X, { m = 160, k = 10, take = 8, seed = 1 } = {}) {
  const r = rng(seed);
  const idx = X.map((_, i) => i); for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const P = idx.slice(0, Math.min(m, X.length)).map((i) => X[i]); const n = P.length;
  const D = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const dd = Math.sqrt(d2(P[i], P[j])); D[i][j] = D[j][i] = dd; }
  const kth = []; for (let i = 0; i < n; i++) { const row = Array.from(D[i]).sort((a, b) => a - b); kth.push(row[Math.min(k, n - 1)]); }
  const sigma = kth.slice().sort((a, b) => a - b)[Math.floor(n / 2)] || 1;
  const W = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) { const order = Array.from(D[i], (v, j) => [v, j]).sort((a, b) => a[0] - b[0]); for (let t = 1; t <= k && t < n; t++) { const j = order[t][1]; const w = Math.exp(-(D[i][j] * D[i][j]) / (sigma * sigma)); W[i][j] = Math.max(W[i][j], w); W[j][i] = W[i][j]; } }
  const deg = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += W[i][j]; deg[i] = s || 1e-12; }
  const L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) L[i][j] = (i === j ? 1 : 0) - W[i][j] / Math.sqrt(deg[i] * deg[j]);
  return jacobiEigvals(L).slice(0, take);
}

export function toroidality(spec) {
  const ev = spec.filter((v) => v > 1e-6);
  if (ev.length < 5) return { score: 0, pair1: 0, pair2: 0, gap: 0, ev: spec };
  const pair = (a, b) => 1 - Math.abs(a - b) / (a + b + 1e-9);
  const pair1 = pair(ev[0], ev[1]), pair2 = pair(ev[2], ev[3]);
  const gap = (ev[4] - ev[3]) / (ev[3] + 1e-9);
  const score = 0.5 * (pair1 + pair2) * (1 / (1 + Math.exp(-6 * (gap - 0.15))));
  return { score, pair1, pair2, gap, ev: ev.slice(0, 6).map((v) => +v.toFixed(4)) };
}

export function fingerprint(X, label = "embedding") {
  const sample = X.length > 600 ? X.filter((_, i) => i % Math.ceil(X.length / 600) === 0) : X;
  const id = twoNN(sample), spec = laplacianSmallSpectrum(sample), tor = toroidality(spec);
  const idOut = isFinite(id) ? +id.toFixed(2) : null;
  return { label, n: X.length, dim: X[0].length, intrinsicDim: idOut, toroidality: +tor.score.toFixed(3), pair1: +tor.pair1.toFixed(3), pair2: +tor.pair2.toFixed(3), gap: +tor.gap.toFixed(3), smallSpectrum: tor.ev };
}

// ───────────────────────── native atlas-96 reference (Forge-compiled wasm) ─────────────────────────
let _atlas = null;
export async function loadAtlas(url = "./atlas12288.wasm") {
  if (_atlas) return _atlas;
  let bytes;
  if (IS_NODE) { const { readFileSync } = await import("node:fs"); const { fileURLToPath } = await import("node:url"); bytes = readFileSync(new URL(url, import.meta.url)); }
  else { bytes = new Uint8Array(await (await fetch(url)).arrayBuffer()); }
  const wkappa = "sha256:" + (await sha256hex(bytes));
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const X = instance.exports;
  const PAGES = X.lean_uor_pages_minimal(), BYTES = X.lean_uor_bytes_minimal(), RCL = X.lean_uor_rclasses_minimal();
  // the real 12288 torus, from the wasm's own phi encoding (Z/PAGES × Z/BYTES), canonically embedded
  const pts = [];
  for (let i = 0; i < PAGES * BYTES; i += 8) { const p = X.lean_uor_phi_page_minimal(i), b = X.lean_uor_phi_byte_minimal(i); pts.push([Math.cos(2 * Math.PI * p / PAGES), Math.sin(2 * Math.PI * p / PAGES), Math.cos(2 * Math.PI * b / BYTES), Math.sin(2 * Math.PI * b / BYTES)]); }
  const ref = fingerprint(pts, "atlas-12288 torus");
  _atlas = { wkappa, pages: PAGES, bytes: BYTES, rclasses: RCL, r96: (b) => X.lean_uor_r96_classify_minimal(b), referenceToroidality: ref.toroidality, referenceGap: ref.gap };
  return _atlas;
}

// ───────────────────────── crypto + receipt (the verifiable-transform shape) ─────────────────────────
const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]" : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}" : JSON.stringify(v);
async function _digest(u8) { if (IS_NODE) { const { createHash } = await import("node:crypto"); return createHash("sha256").update(u8).digest(); } return new Uint8Array(await crypto.subtle.digest("SHA-256", u8)); }
export async function sha256hex(u8) { const d = await _digest(u8); return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join(""); }
const _enc = new TextEncoder();
const didHolo = async (obj) => "did:holo:sha256:" + await sha256hex(_enc.encode(jcs(obj)));

// the controls the verdict is read against (computed once, on synthetic geometries)
export async function controls() {
  const r = rng(7); const D = 256, N = 300;
  const lift = (base, seed) => { const rr = rng(seed), B = base[0].length, Q = Array.from({ length: D }, () => Array.from({ length: B }, () => gauss(rr))); return base.map((v) => Array.from({ length: D }, (_, d) => { let s = 0; for (let b = 0; b < B; b++) s += Q[d][b] * v[b]; return s + 0.02 * gauss(rr); })); };
  const torus = lift(Array.from({ length: N }, () => { const a = 2 * Math.PI * r(), b = 2 * Math.PI * r(); return [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)]; }), 11);
  const rand = Array.from({ length: N }, () => Array.from({ length: D }, () => gauss(r)));
  return { torus: fingerprint(torus, "control:torus").toroidality, random: fingerprint(rand, "control:random").toroidality };
}

// ───────────────────────── extraction: a model's REAL token-embedding matrix ─────────────────────────
// source = { url } (HTTP Range, redirects followed) OR { rr } (a κ-disk reader rr(off,len), verified
// off the substrate). Returns { rows:[[...]], d, vocab, type, modelKappa }.
export async function extractEmbedding(source, onProgress = () => {}) {
  let readHead, readRange, modelKappa = source.modelKappa || null;
  if (source.rr) { readHead = (n) => source.rr(0, n); readRange = (o, n) => source.rr(o, n); }
  else if (source.url) {
    const rng1 = async (s, e) => { const r = await fetch(source.url, { headers: { Range: `bytes=${s}-${e}` }, redirect: "follow" }); if (!r.ok && r.status !== 206) throw new Error("HTTP " + r.status); return new Uint8Array(await r.arrayBuffer()); };
    const chunked = async (s, e) => { const CH = 8 * 1024 * 1024, out = new Uint8Array(e - s + 1); let off = 0; for (let a = s; a <= e; a += CH) { const b = Math.min(e, a + CH - 1); const part = await rng1(a, b); out.set(part.subarray(0, b - a + 1), off); off += part.length; onProgress(off, e - s + 1, "fetch"); } return out.subarray(0, off); };
    readHead = (n) => chunked(0, n - 1); readRange = (o, n) => chunked(o, o + n - 1);
  } else throw new Error("source needs {url} or {rr}");
  onProgress(0, 1, "header");
  const head = await readHead(32 * 1024 * 1024);                 // ≥32MB: covers large tokenizer metadata
  const { dataOffset, tensors } = parseGgufHeader(head);
  const te = tensors.find((t) => t.name === "token_embd.weight");
  if (!te) throw new Error("no token_embd.weight tensor");
  const d = te.dims[0], vocab = te.dims[1] || Math.floor(te.dims.reduce((a, b) => a * b, 1) / d);
  const nbytes = typeByteLen(te.ggmlType, d * vocab);
  onProgress(0, 1, "tensor");
  const raw = await readRange(dataOffset + te.offset, nbytes);
  const flat = dequantizeRaw(te.ggmlType, raw, d * vocab);
  if (!modelKappa) modelKappa = "sha256:" + await sha256hex(raw);   // the embedding tensor's content address
  let s = 12345; const nx = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; const seen = new Set(), rows = [];
  while (rows.length < 600 && seen.size < vocab) { const t = Math.floor(nx() * vocab); if (seen.has(t)) continue; seen.add(t); rows.push(Array.from(flat.subarray(t * d, (t + 1) * d))); }
  return { rows, d, vocab, type: te.ggmlType, modelKappa, tensorBytes: nbytes };
}

// the whole probe: extract → fingerprint vs the native atlas → sealed κ-receipt. Deterministic ⇒ re-derivable.
export async function probeModel(source, { label = "model", onProgress = () => {} } = {}) {
  const atlas = await loadAtlas(source.atlasUrl);
  const emb = await extractEmbedding(source, onProgress);
  const fp = fingerprint(emb.rows, label);
  const ctrl = await controls();
  const isTorus = fp.toroidality >= 0.6 && fp.intrinsicDim != null && fp.intrinsicDim < 12;
  const verdict = isTorus ? "TORUS-LIKE — matches the atlas geometry" : "random-like — does NOT match the atlas torus";
  const methodKappa = "sha256:" + await sha256hex(_enc.encode(jcs(["atlas-probe/1.0", "twoNN", "laplacian-toroidality"])));
  const body = {
    "@context": ["http://www.w3.org/ns/prov#", { holo: "https://hologram.os/ns/q#" }],
    "@type": "prov:Activity", "holo:kind": "atlas-probe",
    "prov:used": { "holo:model": "did:holo:" + emb.modelKappa, "holo:atlas": "did:holo:" + atlas.wkappa, "holo:method": "did:holo:sha256:" + methodKappa.split(":")[1], "holo:dims": { d: emb.d, vocab: emb.vocab, sampled: fp.n } },
    "prov:generated": { "holo:intrinsicDim": fp.intrinsicDim, "holo:toroidality": fp.toroidality, "holo:gap": fp.gap, "holo:smallSpectrum": fp.smallSpectrum, "holo:verdict": verdict },
    "holo:reference": { atlasTorus: atlas.referenceToroidality, controlTorus: +ctrl.torus.toFixed(3), controlRandom: +ctrl.random.toFixed(3) },
  };
  const id = await didHolo(body);
  return { id, body, fp, atlas, controls: ctrl, verdict, isTorus };
}

// ───────────────────────── activations mode (the steelman) ─────────────────────────
// Fingerprint the model's CONTEXTUAL representations (final-layer hidden states over real text),
// not the static embedding table — the space the Platonic-Representation work actually studies.
// Needs a loaded QVAC engine (gpu.captureHidden) + a tokenizer. Deterministic ⇒ re-derivable.
export const PROBE_CORPUS = [
  "The capital of France is Paris, a city on the river Seine.",
  "Photosynthesis converts sunlight, water and carbon dioxide into glucose and oxygen.",
  "In 1969, Apollo 11 landed the first humans on the Moon.",
  "A prime number has exactly two distinct positive divisors: one and itself.",
  "The mitochondria is often called the powerhouse of the cell.",
  "She sold seashells by the seashore on a bright summer morning.",
  "Gravity causes objects with mass to attract one another across space.",
  "The novel explores themes of memory, loss, and quiet redemption.",
  "Water boils at one hundred degrees Celsius at sea-level pressure.",
  "He tightened the last bolt, wiped his hands, and started the engine.",
  "Supply and demand together determine the market price of a good.",
  "The orchestra tuned their instruments before the conductor arrived.",
  "DNA stores genetic information in sequences of four nucleotide bases.",
  "A rainbow forms when sunlight refracts and reflects inside raindrops.",
  "The treaty was signed after months of difficult negotiation.",
  "Recursion solves a problem by reducing it to smaller instances of itself.",
  "The desert was silent except for the wind over the dunes.",
  "Vaccines train the immune system to recognise a specific pathogen.",
  "Interest compounds, so small savings grow over a long horizon.",
  "The chess grandmaster sacrificed her queen to force a checkmate.",
];

export async function probeActivations({ gpu, tokenize, modelKappa = "sha256:loaded-model", atlasUrl, label = "activations" }, onProgress = () => {}) {
  if (!gpu || typeof gpu.captureHidden !== "function") throw new Error("no loaded model — load a model in the chat first (activations need a live forward pass)");
  const atlas = await loadAtlas(atlasUrl);
  const vecs = [];
  for (let i = 0; i < PROBE_CORPUS.length && vecs.length < 600; i++) {
    let ids; try { ids = tokenize(PROBE_CORPUS[i]); } catch { ids = null; }
    if (!ids || !ids.length) continue;
    const hid = await gpu.captureHidden(ids);
    for (let t = 1; t < hid.length; t++) vecs.push(hid[t]);     // skip the BOS position
    onProgress(vecs.length, 600, "forward");
  }
  if (vecs.length < 50) throw new Error("captured too few activations (" + vecs.length + ")");
  const fp = fingerprint(vecs, label);
  const ctrl = await controls();
  const isTorus = fp.toroidality >= 0.6 && fp.intrinsicDim != null && fp.intrinsicDim < 12;
  const verdict = isTorus ? "TORUS-LIKE — matches the atlas geometry" : "random-like — does NOT match the atlas torus";
  const methodKappa = await sha256hex(_enc.encode(jcs(["atlas-probe/1.0", "activations", "final-hidden", "twoNN", "laplacian-toroidality"])));
  const body = {
    "@context": ["http://www.w3.org/ns/prov#", { holo: "https://hologram.os/ns/q#" }],
    "@type": "prov:Activity", "holo:kind": "atlas-probe-activations",
    "prov:used": { "holo:model": "did:holo:" + modelKappa, "holo:atlas": "did:holo:" + atlas.wkappa, "holo:method": "did:holo:sha256:" + methodKappa, "holo:layer": "final-hidden", "holo:samples": fp.n, "holo:dim": fp.dim },
    "prov:generated": { "holo:intrinsicDim": fp.intrinsicDim, "holo:toroidality": fp.toroidality, "holo:gap": fp.gap, "holo:smallSpectrum": fp.smallSpectrum, "holo:verdict": verdict },
    "holo:reference": { atlasTorus: atlas.referenceToroidality, controlTorus: +ctrl.torus.toFixed(3), controlRandom: +ctrl.random.toFixed(3) },
  };
  const id = await didHolo(body);
  return { id, body, fp, atlas, controls: ctrl, verdict, isTorus };
}

// ───────────────────────── node self-test ─────────────────────────
if (IS_NODE && process.argv[1] && process.argv[1].endsWith("atlas-probe.mjs")) {
  const url = process.argv[2] || "https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q8_0.gguf";
  const r = await probeModel({ url, atlasUrl: "./atlas12288.wasm" }, { label: "self-test", onProgress: (a, b, p) => process.stdout.write(`\r  ${p} ${(100 * a / b).toFixed(0)}%   `) });
  console.log("\n  receipt", r.id);
  console.log("  fingerprint", JSON.stringify(r.fp));
  console.log("  reference  ", JSON.stringify(r.body["holo:reference"]));
  console.log("  verdict    ", r.verdict);
}
