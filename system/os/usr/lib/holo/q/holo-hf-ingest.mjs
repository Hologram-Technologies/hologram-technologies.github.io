// holo-hf-ingest.mjs — ADR-0114 S1: in-browser HuggingFace ingestion (the input to the forge seam).
//
// Ports the logic of the native Rust hf_api.rs to a BROWSER fetch: discover model info, select the GGUF/ONNX
// file + companions, range-stream multi-GB weights (never whole-file), resume what we already have, map HF's
// auth/gated/404 statuses honestly, detect the format by magic, and register the bytes as κ-blocks into the
// store the Service Worker already serves. Pure + isomorphic; ALL IO injected (fetch, kput). §1.2: the content
// address (block + whole-file κ) is minted with the canonical BLAKE3 hash (blake3hex, sync) — did:holo:blake3.
//
// HONEST LINE: whether huggingface.co answers cross-origin RANGE reads (CORS + 206) cannot be settled by a mock —
// `servedWhole` surfaces the case where the server IGNORED Range and returned 200 (a CORS/range fallback, not a
// failure), and a thrown fetch surfaces as a clear network/cors error rather than a silent partial. The live
// check is a browser-session step. Relates: ADR-0114 · ADR-0092 (governed fetch) · v86 kblocks (the streaming unit).

import { blake3hex } from "../holo-blake3.mjs"; // §1.2 BLAKE3-only: the ONE canonical content hash for κ mint

export class HfError extends Error { constructor(kind, msg) { super(msg); this.kind = kind; this.name = "HfError"; } }

export const hfApiUrl = (repo) => `https://huggingface.co/api/models/${repo}`;
export const hfResolveUrl = (repo, file, revision = "main") => `https://huggingface.co/${repo}/resolve/${revision}/${file}`;
const authHeaders = (token) => (token ? { Authorization: `Bearer ${token}` } : {});

// Map HF HTTP status → an honest, actionable reason. Gated (403) and auth (401) are distinct user actions.
export function mapHfStatus(status) {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 401) return { ok: false, kind: "auth", reason: "authentication required — set a HuggingFace token" };
  if (status === 403) return { ok: false, kind: "gated", reason: "gated model — accept the terms on its model page first" };
  if (status === 404) return { ok: false, kind: "notfound", reason: "model or file not found" };
  return { ok: false, kind: "http", reason: "HTTP " + status };
}

export async function fetchModelInfo(repo, { fetch, token } = {}) {
  let res;
  try { res = await fetch(hfApiUrl(repo), { headers: authHeaders(token) }); }
  catch (e) { throw new HfError("network/cors", "model info fetch failed (CORS/network): " + (e && e.message)); }
  const m = mapHfStatus(res.status);
  if (!m.ok) throw new HfError(m.kind, m.reason);
  return res.json();
}

const COMPANIONS = ["tokenizer.json", "tokenizer.model", "config.json", "tokenizer_config.json", "special_tokens_map.json", "generation_config.json"];
const isGguf = (f) => /\.gguf$/i.test(f);
const isOnnx = (f) => /\.onnx$/i.test(f);
const baseName = (f) => String(f).split("/").pop();

// Pick the model file (smallest matching quant when sizes are known) + its companion configs/tokenizer.
export function selectModelFile(info, { format } = {}) {
  const sib = (info.siblings || []).map((s) => s.rfilename || s.path).filter(Boolean);
  const sizeOf = (f) => { const s = (info.siblings || []).find((x) => (x.rfilename || x.path) === f); return (s && (s.size ?? s.lfs?.size)) ?? Infinity; };
  const smallest = (arr) => arr.slice().sort((a, b) => sizeOf(a) - sizeOf(b) || (a < b ? -1 : 1))[0];
  let file = null, fmt = null;
  if (format !== "onnx") { const g = sib.filter(isGguf); if (g.length) { file = smallest(g); fmt = "gguf"; } }
  if (!file && format !== "gguf") { const o = sib.filter(isOnnx); if (o.length) { file = smallest(o); fmt = "onnx"; } }
  if (!file) throw new HfError("format", "no GGUF or ONNX file in repo");
  const companions = sib.filter((f) => COMPANIONS.includes(baseName(f)));
  const external = fmt === "onnx" ? sib.filter((f) => f === file + "_data" || f === file + ".data") : [];
  return { file, format: fmt, companions: [...companions, ...external] };
}

// Detect format from the first bytes: GGUF has the literal magic "GGUF"; ONNX is a protobuf ModelProto (best-effort).
export function detectFormatFromMagic(bytes) {
  if (!bytes || bytes.length < 4) return null;
  if (bytes[0] === 0x47 && bytes[1] === 0x47 && bytes[2] === 0x55 && bytes[3] === 0x46) return "gguf"; // "GGUF"
  if (bytes[0] === 0x08 || bytes[0] === 0x3a) return "onnx"; // protobuf field 1 (ir_version) / field 7 (graph)
  return null;
}

// Range-stream a file: request fixed-size byte ranges (206), assemble in order, resume by skipping `have` chunks.
// If the server IGNORES Range and returns 200 (whole file), set servedWhole and stop — honest about that fallback.
export async function rangeDownload(url, { fetch, token, size, chunkSize = 8 << 20, have = new Set(), onProgress } = {}) {
  if (!(size > 0)) throw new HfError("size", "unknown file size — cannot range-stream");
  const out = new Uint8Array(size);
  const nChunks = Math.ceil(size / chunkSize);
  let servedWhole = false; const fetched = [];
  for (let i = 0; i < nChunks; i++) {
    if (have.has(i)) continue;
    const start = i * chunkSize, end = Math.min(start + chunkSize, size) - 1;
    let res;
    try { res = await fetch(url, { headers: { ...authHeaders(token), Range: `bytes=${start}-${end}` } }); }
    catch (e) { throw new HfError("network/cors", `range fetch failed (CORS/network): ${e && e.message}`); }
    if (res.status === 200) { // server ignored Range → whole body (CORS/range fallback)
      const whole = new Uint8Array(await res.arrayBuffer());
      out.set(whole.subarray(0, size)); servedWhole = true; fetched.push("whole");
      onProgress && onProgress({ loaded: size, total: size }); break;
    }
    const m = mapHfStatus(res.status);
    if (!m.ok) throw new HfError(m.kind, m.reason);
    if (res.status !== 206) throw new HfError("range", `expected 206 Partial Content, got ${res.status}`);
    out.set(new Uint8Array(await res.arrayBuffer()), start);
    fetched.push(i);
    onProgress && onProgress({ loaded: Math.min(end + 1, size), total: size });
  }
  return { bytes: out, servedWhole, fetched };
}

// ingest(repo, ctx) -> manifest { repo, format, file, size, kappa, blocks:[{kappa,off,len}], companions, servedWhole, gated }
// The whole-file κ is the model identity; the fixed-size blocks are the lazy-stream + dedup unit (the v86 pattern).
export async function ingest(repo, ctx = {}) {
  // §1.2: κ mint is BLAKE3 (blake3hex, sync, self-contained). `sha256hex` remains an accepted ctx dep for
  // back-compat with callers/witnesses that still pass it, but it is NO LONGER used to mint the content address.
  const { fetch, token, revision = "main", format, kput, chunkSize, blockSize = 1 << 18, onProgress } = ctx;
  const info = await fetchModelInfo(repo, { fetch, token });
  // /api/models/{id} siblings omit size — patch from the tree endpoint FIRST, so selection picks the SMALLEST quant
  // (otherwise the size-blind picker falls back to name order and grabs e.g. fp16 because "f" < "q").
  try {
    const tree = await (await fetch(`https://huggingface.co/api/models/${repo}/tree/${revision}?recursive=true`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })).json();
    if (Array.isArray(tree)) { const sz = new Map(tree.map((t) => [t.path, t.size])); for (const s of (info.siblings || [])) { const z = sz.get(s.rfilename || s.path); if (z) s.size = z; } }
  } catch { /* selection falls back to name order; honest size error below if truly unknown */ }
  const sel = selectModelFile(info, { format });
  const sib = (info.siblings || []).find((s) => (s.rfilename || s.path) === sel.file);
  const size = (sib && (sib.size ?? sib.lfs?.size));
  if (!(size > 0)) throw new HfError("size", "model file size unknown in repo info");

  const dl = await rangeDownload(hfResolveUrl(repo, sel.file, revision), { fetch, token, size, chunkSize, onProgress });
  const magic = detectFormatFromMagic(dl.bytes);
  if (magic && magic !== sel.format) throw new HfError("format", `magic '${magic}' != selected '${sel.format}'`);

  const blocks = [];
  for (let off = 0; off < size; off += blockSize) {
    const slice = dl.bytes.subarray(off, Math.min(off + blockSize, size));
    const bk = "did:holo:blake3:" + blake3hex(slice);
    if (kput) await kput(bk, slice);
    blocks.push({ kappa: bk, off, len: slice.length });
  }
  const kappa = "did:holo:blake3:" + blake3hex(dl.bytes);
  if (kput) await kput(kappa, dl.bytes);
  return { repo, format: sel.format, file: sel.file, size, kappa, blocks, companions: sel.companions, servedWhole: dl.servedWhole, gated: !!info.gated };
}
