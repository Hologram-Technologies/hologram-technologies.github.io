// gguf-forge-kstream.mjs — load an LLM 100% from its sealed .holo, by κ, native to the substrate.
//
// The vision's load path: a model is a content-addressed archive of per-tensor κ-bodies (sealHolo /
// writeHolo). This opens it WITHOUT re-forging the monolithic GGUF — every tensor is fetched BY ITS κ
// and re-derived before use (L5), with a global κ-cache (a block seen once is reused, O(1) warm). The
// embedded gguf.header gives the plan (arch + hparams + tensor infos + tokenizer); meta.order gives
// name→κ. Output is forge-compatible: { plan, store } feed synthesizeGraph + forward unchanged, and
// (in the browser) the SAME .holo streams over HTTP-Range / SW κ-route / IPFS — serverless, verified.
//
// readHolo (whole bytes, Node/in-memory) and openGgufHoloStream (rangeReader, browser cold-load) share
// one shape. The per-body L5 lives in holo-archive's store; we add the name→κ plan + a verify-once
// global κ-cache so a forward doesn't re-hash every matvec.

import { readHolo, openHoloStream } from "./holo-archive.mjs";
import { parseGgufHeader } from "../qvac-ingest.mjs";
import { GGML_TYPE_NAME } from "./gguf-forge.mjs";

// build the forge-compatible plan (name→κ + dims/type) from the embedded gguf header + meta.order
function planFrom(headerBytes, order) {
  const hd = parseGgufHeader(headerBytes);
  const byName = new Map(order.map((o) => [o.name, o.kappa]));
  const tensors = hd.tensors.map((t) => ({
    name: t.name, dims: t.dims, type: t.ggmlType, typeName: GGML_TYPE_NAME[t.ggmlType] || String(t.ggmlType),
    kappa: "sha256:" + byName.get(t.name),                 // identity = content (from the κ-body directory)
  }));
  return { arch: hd.meta["general.architecture"], meta: hd.meta, tensors };
}

// the head region = [0, firstBodyOffset): the 64-byte head + section table + Extension (baked gguf
// header + tokenizer) + Metadata + the weights directory — everything BEFORE the first weight body.
// Found cheaply (head + section table + the weights count, ~200B) without reading the 6MB header.
async function firstBodyOffset(range) {
  const head = await range(0, 64), hdv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const sc = hdv.getUint16(8, true);
  const tbl = await range(10, sc * 17), tdv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength);
  let wOff = null;
  for (let i = 0, p = 0; i < sc; i++, p += 17) if (tbl[p] === 3) wOff = Number(tdv.getBigUint64(p + 1, true));  // Weights=3
  const cntB = await range(wOff, 4); const count = new DataView(cntB.buffer, cntB.byteOffset, cntB.byteLength).getUint32(0, true);
  return wOff + 4 + count * 48;   // [count u32] + count×[κ32 off8 len8]
}

// Resolve the head blob from the persistent store (0 transport on warm) or fetch+persist it (cold).
// Keyed by its own content κ (headκ = sha256(head)) → store.peek L5-verifies it. A pointer maps the
// archive identity to headκ: the .holo footer κ (rootKappa, the LINK — content-addressed) and/or a
// local url hint (a non-identity accelerator for open-by-URL). Returns the head bytes + warm flag.
async function resolveHeadBlob(range, persist, { rootKappa, urlHint }) {
  const footHex = rootKappa ? String(rootKappa).split(":").pop() : null;
  const urlKey = urlHint ? await persist.hash(new TextEncoder().encode(urlHint)) : null;
  let headK = null;
  if (footHex) headK = await persist.getHint("head_" + footHex);     // content-addressed pointer (the link)
  if (!headK && urlKey) headK = await persist.getHint("url_" + urlKey);  // local url accelerator
  if (headK) { const blob = await persist.peek(headK); if (blob) return { blob, warm: true }; }
  // cold: one fetch of the contiguous head region, content-address + persist, write the pointers
  const fbo = await firstBodyOffset(range);
  const blob = await range(0, fbo);
  const hk = await persist.hash(blob);
  await persist.putBody(hk, blob);
  if (footHex) await persist.putHint("head_" + footHex, hk);
  if (urlKey) await persist.putHint("url_" + urlKey, hk);
  return { blob, warm: false };
}

// a verify-once global κ-cache over a base store (the holo store already L5-verifies on first get).
// Subsequent gets are O(1) and offline. Shared across loads when the same Map is passed in.
function cachedStore(base, cache = new Map()) {
  return { get: (hex) => { let b = cache.get(hex); if (b === undefined) { b = base.get(hex); cache.set(hex, b); } return b; }, has: (hex) => base.has(hex), cache };
}

// ── whole-bytes (Node / fully-in-memory): open a .holo and load by κ with L5 + cache ──
export function openGgufHolo(bytes, { cache } = {}) {
  const h = readHolo(bytes);                                // footer L5 + per-body L5 store + meta.order
  return { plan: planFrom(h.headerBytes, h.meta.order), store: cachedStore(h.store, cache), rootHolo: h.footer, meta: h.meta, headerBytes: h.headerBytes };
}

// ── streaming (browser cold-load): open a .holo over a Range reader; bodies fetched on demand by κ ──
// rangeReader(off,len)->Promise<Uint8Array> (HTTP-Range, SW κ-route, or IPFS). store.get is async.
// persist (optional, browser): a makeKappaStore() instance — OPFS-first, 0-network warm, survives
// reload + offline. Injected (not imported) so this module stays Node-safe. The in-mem cache sits in
// front for same-session O(1); persist sits behind for cross-session O(1). getBody L5-verifies every
// transport body, so a persisted body is trusted only after re-derivation.
export async function openGgufHoloStream(rangeReader, { cache = new Map(), persist = null, rootKappa = null, urlHint = null } = {}) {
  // HEAD PERSISTENCE: when a persistent store + an identity hint are present, serve the whole head
  // region from a content-addressed blob (0 transport on warm) so the ~6MB gguf header/tokenizer is
  // offline too — not just the weight bodies. effRange serves head reads from the blob, bodies via wire.
  let effRange = rangeReader, headWarm = null;
  if (persist && persist.putBody && (rootKappa || urlHint)) {
    const h = await resolveHeadBlob(rangeReader, persist, { rootKappa, urlHint });
    headWarm = h.warm;
    effRange = (off, len) => (off + len <= h.blob.length) ? Promise.resolve(h.blob.subarray(off, off + len)) : rangeReader(off, len);
  }
  const s = await openHoloStream(effRange);                // header + directory up front; bodies on demand
  const fetchBody = (hex) => s.getBody(hex);               // Range + per-block L5 (refuses mismatch)
  const base = persist ? (hex) => persist.get(hex, () => fetchBody(hex)) : fetchBody;
  const aget = async (hex) => { let b = cache.get(hex); if (b === undefined) { b = await base(hex); cache.set(hex, b); } return b; };
  return { plan: planFrom(s.headerBytes, s.meta.order), store: { get: aget, cache }, meta: s.meta, headerBytes: s.headerBytes, persist, headWarm };
}

// UNIFIED-PACK adapter: build the SAME { plan, store, headerBytes, headWarm } the brain consumes, but sourced from a
// pack model view (openModelPack/holo-q-pack-provider) instead of a per-model rangeReader. The view already carries the
// baked gguf header (view.headerBytes) + name→κ (view.order) + a per-κ L5 getBody — exactly planFrom + a verify-once
// store. So createHoloBrain runs over the unified pack with ZERO forge/forward changes: same plan, same bodies, same κ.
export function ggufStreamFromPackModel(view, { cache = new Map(), persist = null } = {}) {
  const plan = planFrom(view.headerBytes, view.order);
  const fetchBody = (hex) => view.getBody(hex);                         // pack getBody = Range + per-block L5
  const base = persist ? (hex) => persist.get(hex, () => fetchBody(hex)) : fetchBody;
  const aget = async (hex) => { let b = cache.get(hex); if (b === undefined) { b = await base(hex); cache.set(hex, b); } return b; };
  return { plan, store: { get: aget, cache }, meta: { order: view.order }, headerBytes: view.headerBytes, persist, headWarm: true };
}

// the exec loader seam: forward(plan, graph, store, tokens, { load }) — verify-once (store already L5).
export const kstreamLoad = (store, kappaRef) => store.get(String(kappaRef).split(":").pop());
