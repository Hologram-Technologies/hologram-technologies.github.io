// holo-ipfs-gateway.mjs — a VERIFIED IPFS path gateway. Resolve ipfs/<cid>/<path> through the UnixFS DAG,
// re-deriving every block against its CID (Law L5), and hand back a renderable payload. The point: an IPFS
// site browses NATIVELY in Hologram — a page served at /ipfs/<cid>/index.html loads its relative ./style.css
// and follows its <a href="docs/"> through THIS SAME gateway, so the whole object graph feels like the web,
// except every byte is content-addressed and gateway-trustless (a source is a latency choice, never trust).
//
// Pure ESM, no DOM, no top-level effects → Node-witnessable and SW-importable. It REUSES the DAG walk
// (assembleUnixFs) and the trustless-gateway set; this file adds path traversal + directory index + a
// beautiful native listing + the nav-reporter the shell reads to track the address bar. Block fetch is
// injected, so the witness drives it with a fixture store and the SW drives it with real gateways.

import * as holoIpfs from "./holo-ipfs.js";
import { discoverGateways } from "./holo-routing.mjs";
import { selectRender, kindOfContentType } from "./holo-render-contract.mjs";   // dependency-free (no node:crypto) — SW-safe
import { imageMeta, humanBytes as imgHuman } from "./holo-image-meta.mjs";        // dependency-free EXIF/dimensions from verified bytes
// Vendored into the browser app's _shared/ (Milestone 1 convergence) beside its holo-ipfs.js compute +
// the pure holo-routing / render-contract leaves. OS canonical: holo-os/system/os/sbin/holo-ipfs-gateway.mjs.
// Two deps of the OS copy are intentionally dropped here so the SW closure stays lean: assembleUnixFs
// (holo-omni-object) is unused by the serve path, and holo-peers' IPFS_GATEWAYS is inlined below (importing
// it would pull holo-resolver + holo-sources). Keep the read-path logic in lock-step with the OS canonical.
const IPFS_GATEWAYS = ["https://trustless-gateway.link", "https://ipfs.io", "https://dweb.link", "https://w3s.link", "https://4everland.io"];

const MIME = {
  html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript",
  json: "application/json", jsonld: "application/ld+json", svg: "image/svg+xml", png: "image/png",
  jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  ico: "image/x-icon", pdf: "application/pdf", txt: "text/plain", md: "text/markdown", xml: "application/xml",
  wasm: "application/wasm", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
};
export const mimeOf = (name) => MIME[String(name || "").split(".").pop().toLowerCase()] || null;

// sniff(bytes, name) — content type for a leaf with no (or unknown) extension. Magic bytes first, then a
// crude printable-ratio test for text vs binary. HTML detection lets an extensionless root page render.
export function sniff(bytes, name) {
  const ext = mimeOf(name); if (ext) return ext;
  if (!bytes || !bytes.length) return "application/octet-stream";
  const b = bytes.subarray(0, 16);
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 256)).trim().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<svg")) return head.startsWith("<svg") ? "image/svg+xml" : "text/html";
  let printable = 0; for (const c of bytes.subarray(0, 256)) if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable++;
  return printable > bytes.subarray(0, 256).length * 0.85 ? "text/plain" : "application/octet-stream";
}

// dispatchRender(bytes, name) — the SINGLE serve-time render dispatch the SW imports. If the bytes are a
// UOR envelope that DECLARES a render contract, honor it (a self-describing object chooses how it renders);
// otherwise fall back to the existing extension/magic-byte sniff. Pure over ALREADY-VERIFIED bytes — trust
// is recovered upstream by re-derivation (Law L5), never here. Returns { kind, contentType }.
export function dispatchRender(bytes, name) {
  const obj = tryParseUor(bytes);
  if (obj && obj.render) {
    const r = selectRender(obj);
    return { kind: r.kind, contentType: r.contentType || mimeOf(name) || sniff(bytes, name), declared: true };
  }
  const ct = mimeOf(name) || sniff(bytes, name);
  return { kind: kindOfContentType(ct), contentType: ct, declared: false };
}
// tryParseUor(bytes) → a UOR envelope object | null. A UOR object is canonical JSON-LD with @context + a
// content-derived id; anything that does not parse as one is left to the byte sniffer untouched.
function tryParseUor(bytes) {
  try {
    if (!bytes || bytes.length > 1 << 20) return null;            // contracts are tiny; don't parse large media
    const o = JSON.parse(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
    return (o && o["@context"] && typeof o.id === "string" && o.id.startsWith("did:holo:")) ? o : null;
  } catch { return null; }
}

// parseIpfsPath(rel) → { ns, root, path } | null. rel is the BASE-stripped path, e.g. "ipfs/<cid>/a/b.html".
export function parseIpfsPath(rel) {
  const m = String(rel || "").match(/^(ipfs|ipns)\/([^/?#]+)(?:\/([^?#]*))?/i);
  if (!m) return null;
  return { ns: m[1].toLowerCase(), root: m[2], path: m[3] || "" };
}

// makeGetBlock(fetchImpl, cfg) → async (cidStr) => Uint8Array | null. Races the trustless gateways, accepts
// the FIRST block that re-derives against its CID (Law L5), and falls back to Delegated-Routing discovery.
export function makeGetBlock(fetchImpl, { gateways = IPFS_GATEWAYS, discover = true, timeoutMs = 9000 } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const pull = async (gws, cidStr) => {
    const tasks = gws.map(async (g) => {
      // Time-box each gateway: a slow/blocked endpoint (e.g. a browser shield dropping the cross-origin
      // fetch) must FAIL FAST so Promise.any can settle and the caller surfaces a clear error, not a blank
      // hang. AbortController works in both the SW and Node.
      const ac = (typeof AbortController !== "undefined") ? new AbortController() : null;
      const to = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
      try {
        const r = await f(`${String(g).replace(/\/$/, "")}/ipfs/${cidStr}?format=raw`, { headers: { accept: "application/vnd.ipld.raw" }, ...(ac ? { signal: ac.signal } : {}) });
        if (!r || !r.ok) throw new Error("gateway " + (r && r.status));
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (!(await holoIpfs.verifyBlock(cidStr, bytes))) throw new Error("cid mismatch — gateway not trusted");
        return bytes;
      } finally { if (to) clearTimeout(to); }
    });
    try { return await Promise.any(tasks); } catch { return null; }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // ── CAR one-shot warm — the "feels instant" primitive ─────────────────────────────────────────────
  // A UnixFS file / page is a DAG of many blocks. Fetching them one at a time is N sequential round-trips
  // (the old ~15s Wikipedia lag). The IETF Trustless Gateway lets us pull a whole entity's DAG in ONE
  // request (?format=car&dag-scope=entity) and stream it: CarParser hands back each block as it arrives,
  // we re-derive it (Law L5) and cache it. The subsequent DAG walk then assembles ENTIRELY from cache —
  // one round-trip instead of hundreds. Best-effort: a gateway that can't speak CAR yields 0 and the
  // per-block path still works. This is the biggest single latency win for content-addressed rendering.
  async function warm(rootCid, scope = "entity") {
    let key; try { key = holoIpfs.cidToString(holoIpfs.parseCID(rootCid)); } catch { return 0; }
    for (const g of gateways) {
      const gw = String(typeof g === "string" ? g : (g && g.origin) || "").replace(/\/$/, "");
      if (!gw) continue;
      const ac = (typeof AbortController !== "undefined") ? new AbortController() : null;
      const to = ac ? setTimeout(() => ac.abort(), timeoutMs * 3) : null;   // a whole DAG deserves more than one block's budget
      try {
        const r = await f(`${gw}/ipfs/${key}?format=car&dag-scope=${scope}`, { headers: { accept: "application/vnd.ipld.car" }, ...(ac ? { signal: ac.signal } : {}) });
        if (!r || !r.ok || !r.body || typeof r.body.getReader !== "function") continue;
        const parser = new holoIpfs.CarParser(); const reader = r.body.getReader(); let got = 0;
        for (; ;) {
          const { done, value } = await reader.read(); if (done) break;
          for (const blk of parser.push(value)) { try { if (await holoIpfs.verifyBlock(blk.cidObj, blk.bytes)) { await blockCachePut(blk.cid, blk.bytes); got++; } } catch {} }
        }
        if (got > 0) return got;                                            // one gateway served the DAG — done
      } catch {} finally { if (to) clearTimeout(to); }
    }
    return 0;
  }
  const get = async (cidStr) => {
    if (!f) return null;
    const cached = await blockCacheGet(cidStr); if (cached) return cached;   // L1/L2 — O(1), no network
    // Resilience: a single flaky / rate-limited gateway must not fail a whole multi-block page. Race the
    // gateways; on a miss, WIDEN the set via Delegated-Routing discovery, then RETRY the race with a short
    // backoff — public gateways 429 under load, and a deep HAMT site (Wikipedia) fetches hundreds of blocks,
    // so a lone transient miss would otherwise blank the page. A verified block is cached immediately, so a
    // retry only ever re-attempts the blocks that actually missed (never re-fetches what already landed).
    let gws = gateways, b = null;
    for (let attempt = 0; attempt < 3 && !b; attempt++) {
      if (attempt > 0) await sleep(200 * attempt);                           // 0 · 200 · 400 ms backoff
      b = await pull(gws, cidStr);
      if (!b && discover) { try { const extra = await discoverGateways(cidStr, { fetchImpl: f }); if (extra.length) gws = [...new Set([...gateways, ...extra])]; } catch {} }
    }
    if (b) await blockCachePut(cidStr, b);                                   // verified block → unified κ-store
    return b;
  };
  get.warm = warm;                                                          // attach the CAR one-shot to the block fetcher
  return get;
}
// Block cache — every CID-verified block is content-addressed (immutable), so cache it: L1 an in-memory hot
// map (O(1), no async), L2 the durable Cache API shared with the OS (holo-kappa-v2). Re-access of any block —
// a re-visited page, a shared chunk, a streamed file walked twice — is then network-free. The IPFS twin of
// the browser seam's L1/L2. No-op caching in Node (no `caches`); the L1 map still gives intra-run O(1).
const BLOCK_L1 = new Map();
async function blockCacheGet(cidStr) {
  const hot = BLOCK_L1.get(cidStr); if (hot) return hot;
  if (typeof caches === "undefined") return null;
  try { const c = await caches.open("holo-kappa-v2"); const r = await c.match("/.holo/ipfs/" + cidStr); if (r) { const b = new Uint8Array(await r.arrayBuffer()); BLOCK_L1.set(cidStr, b); return b; } } catch {}
  return null;
}
async function blockCachePut(cidStr, bytes) {
  BLOCK_L1.set(cidStr, bytes);
  if (typeof caches === "undefined") return;
  try { const c = await caches.open("holo-kappa-v2"); await c.put("/.holo/ipfs/" + cidStr, new Response(bytes, { headers: { "x-holo-cid": cidStr, "x-holo-verified": "L5" } })); } catch {}
}

// ── UnixFS HAMT (sharded directory) lookup ──────────────────────────────────────────────────────────
// A directory too large for one block is a HAMT (UnixFS type 5). Each child link is named <BUCKET><entry>,
// where BUCKET is the entry's hash bucket as an UPPERCASE 2-hex-char prefix; a link named with ONLY the
// 2-char bucket (no entry) is a nested sub-shard. Lookup hashes the name with murmur3-x64-64 (go-ipfs /
// js-ipfs's UnixFS hash — calibrated BYTE-EXACT against Wikipedia-on-IPFS shards), then walks ONE hash byte
// per level (bitWidth 8, fanout 256 — the universal default) into sub-shards until it finds the entry. This
// is what lets a giant IPFS site (Wikipedia's millions-of-articles `wiki/` dir) browse like the web.
const _M64 = 0xffffffffffffffffn;
const _rotl = (x, r) => ((x << r) | (x >> (64n - r))) & _M64;
const _mul = (a, b) => (a * b) & _M64;
function murmur3x64_64(data) {                          // the low 64 bits (go's murmur3.Sum64), as a bigint
  const nb = Math.floor(data.length / 16); let h1 = 0n, h2 = 0n;
  const c1 = 0x87c37b91114253d5n, c2 = 0x4cf5ad432745937fn;
  const rd = (o) => { let v = 0n; for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(data[o + i] || 0); return v; };
  for (let i = 0; i < nb; i++) {
    let k1 = rd(i * 16), k2 = rd(i * 16 + 8);
    k1 = _mul(k1, c1); k1 = _rotl(k1, 31n); k1 = _mul(k1, c2); h1 ^= k1;
    h1 = _rotl(h1, 27n); h1 = (h1 + h2) & _M64; h1 = (_mul(h1, 5n) + 0x52dce729n) & _M64;
    k2 = _mul(k2, c2); k2 = _rotl(k2, 33n); k2 = _mul(k2, c1); h2 ^= k2;
    h2 = _rotl(h2, 31n); h2 = (h2 + h1) & _M64; h2 = (_mul(h2, 5n) + 0x38495ab5n) & _M64;
  }
  let k1 = 0n, k2 = 0n; const t = nb * 16, r = data.length & 15, b = (j) => BigInt(data[t + j]);
  if (r >= 15) k2 ^= b(14) << 48n; if (r >= 14) k2 ^= b(13) << 40n; if (r >= 13) k2 ^= b(12) << 32n;
  if (r >= 12) k2 ^= b(11) << 24n; if (r >= 11) k2 ^= b(10) << 16n; if (r >= 10) k2 ^= b(9) << 8n;
  if (r >= 9) { k2 ^= b(8); k2 = _mul(k2, c2); k2 = _rotl(k2, 33n); k2 = _mul(k2, c1); h2 ^= k2; }
  if (r >= 8) k1 ^= b(7) << 56n; if (r >= 7) k1 ^= b(6) << 48n; if (r >= 6) k1 ^= b(5) << 40n; if (r >= 5) k1 ^= b(4) << 32n;
  if (r >= 4) k1 ^= b(3) << 24n; if (r >= 3) k1 ^= b(2) << 16n; if (r >= 2) k1 ^= b(1) << 8n;
  if (r >= 1) { k1 ^= b(0); k1 = _mul(k1, c1); k1 = _rotl(k1, 31n); k1 = _mul(k1, c2); h1 ^= k1; }
  h1 ^= BigInt(data.length); h2 ^= BigInt(data.length);
  h1 = (h1 + h2) & _M64; h2 = (h2 + h1) & _M64;
  const fmix = (k) => { k ^= k >> 33n; k = _mul(k, 0xff51afd7ed558ccdn); k ^= k >> 33n; k = _mul(k, 0xc4ceb9fe1a85ec53n); k ^= k >> 33n; return k; };
  h1 = fmix(h1); h2 = fmix(h2); h1 = (h1 + h2) & _M64;   // fold h2 into h1 (Sum64 result)
  return h1;
}
const HAMT_PREFIXLEN = 2;                              // fanout 256 → bitWidth 8 → one hash byte / level
const hamtPrefix = (h1, depth) => Number((h1 >> BigInt(56 - depth * 8)) & 0xffn).toString(16).toUpperCase().padStart(HAMT_PREFIXLEN, "0");
// hamtLookup(rootNode, name, getBlock) → the entry's cidStr, or null. Walks ≤ 8 levels (the 64-bit hash).
export async function hamtLookup(rootNode, name, getBlock) {
  const { cidToString, decodeDagPb } = holoIpfs;
  const h1 = murmur3x64_64(new TextEncoder().encode(name));
  let node = rootNode;
  for (let depth = 0; depth < 8; depth++) {
    const px = hamtPrefix(h1, depth);
    const link = node.links.find((l) => (l.name || "").slice(0, HAMT_PREFIXLEN) === px);
    if (!link) return null;
    if ((link.name || "").length === HAMT_PREFIXLEN) {   // a bare bucket → nested sub-shard, recurse deeper
      const blk = await getBlock(cidToString(link.cid));
      if (!blk) return null; node = decodeDagPb(blk); continue;
    }
    return (link.name.slice(HAMT_PREFIXLEN) === name) ? cidToString(link.cid) : null;
  }
  return null;
}

// childCid(dirCid, name, getBlock) → the cid of a named link in a UnixFS/dag-pb directory, or null.
async function childCid(dirCid, name, getBlock) {
  const { parseCID, cidToString, decodeDagPb, decodeUnixFs, UNIXFS, CODEC } = holoIpfs;
  const cid = parseCID(dirCid);
  const block = await getBlock(cidToString(cid));
  if (!block) throw new Error("missing block " + String(dirCid).slice(0, 16) + "…");
  if (cid.codec !== CODEC.DAG_PB) return null;            // not a directory we can descend
  const node = decodeDagPb(block);
  const u = node.data ? decodeUnixFs(node.data) : null;
  if (u && u.type === UNIXFS.HAMTShard) return await hamtLookup(node, name, getBlock);   // sharded directory
  for (const l of node.links) if ((l.name || "") === name) return cidToString(l.cid);
  return null;
}

// peekNode(cidStr, getBlock) → { kind:"directory"|"file"|"raw"|"missing", node?, block?, raw? } — decide a
// node's kind from its OWN block only (cheap; does NOT walk a file's whole DAG, unlike assembleUnixFs).
async function peekNode(cidStr, getBlock) {
  const { parseCID, cidToString, decodeDagPb, decodeUnixFs, UNIXFS, CODEC } = holoIpfs;
  const cid = parseCID(cidStr);
  const block = await getBlock(cidToString(cid));
  if (!block) return { kind: "missing" };
  if (cid.codec === CODEC.RAW) return { kind: "file", raw: true, block };
  if (cid.codec !== CODEC.DAG_PB) return { kind: "raw", block };
  const node = decodeDagPb(block);
  const u = node.data ? decodeUnixFs(node.data) : null;
  if (u && u.type === UNIXFS.Directory) return { kind: "directory", node, block };
  if (u && u.type === UNIXFS.HAMTShard) return { kind: "directory", hamt: true, node, block };   // sharded dir
  return { kind: "file", node, block };
}

// streamUnixFsFile(rootCid, getBlock) → ReadableStream of a file's bytes — walk the DAG IN ORDER and enqueue
// each leaf as it is fetched + re-derived to its CID (Law L5, in getBlock). A big file (video / large image /
// server-rendered page) starts rendering on its FIRST leaf instead of after the whole tree assembles. This is
// the κ-addressable object, STREAMED. Bounded by the DAG; blocks are O(1) on re-walk (block cache above).
export function streamUnixFsFile(rootCid, getBlock) {
  const { parseCID, cidToString, decodeDagPb, decodeUnixFs, CODEC } = holoIpfs;
  return new ReadableStream({
    async start(ctrl) {
      try {
        // CAR one-shot warm: pull the WHOLE file DAG in one request before walking, so every leaf below is a
        // cache hit (N sequential gateway round-trips → 1). Best-effort; a non-CAR gateway just no-ops here.
        if (getBlock && typeof getBlock.warm === "function") { try { await getBlock.warm(rootCid, "entity"); } catch {} }
        const walk = async (cidStr) => {
          const cid = parseCID(cidStr);
          const block = await getBlock(cidToString(cid));
          if (!block) throw new Error("missing block " + String(cidStr).slice(0, 16) + "…");
          if (cid.codec === CODEC.RAW) { ctrl.enqueue(block); return; }
          if (cid.codec !== CODEC.DAG_PB) { ctrl.enqueue(block); return; }
          const node = decodeDagPb(block);
          const u = node.data ? decodeUnixFs(node.data) : null;
          if (!node.links.length) { ctrl.enqueue((u && u.data) || new Uint8Array(0)); return; }
          if (u && u.data && u.data.length) ctrl.enqueue(u.data);   // inline head (rare)
          for (const l of node.links) await walk(cidToString(l.cid));
        };
        await walk(rootCid);
        ctrl.close();
      } catch (e) { ctrl.error(e); }
    },
  });
}

// resolveIpfsPath(root, path, getBlock) → a renderable result:
//   { kind:"file", cidStr, bytes, contentType, name, servedIndex? }
//   { kind:"directory", cidStr, entries:[{name,cid,size}] }
//   { kind:"error", reason, status }
// Path segments must be directories; the final node is assembled (file bytes) or listed (directory). A
// directory with an index.html serves it (the web's "open the folder → see the page" convention).
export async function resolveIpfsPath(root, path, getBlock) {
  const { parseCID, cidToString } = holoIpfs;
  let cur;
  try { cur = cidToString(parseCID(root)); } catch { return { kind: "error", reason: "not a CID: " + root, status: 400 }; }
  // %-decode each segment: a link/HAMT name is stored DECODED (UTF-8, e.g. "Türkiye"), but a navigation
  // arrives percent-encoded ("T%C3%BCrkiye"). Without decoding, the murmur3 bucket hash (and a plain link
  // match) is computed over the wrong bytes and every non-ASCII path 404s. Decoding an ASCII name is a no-op.
  const segs = String(path || "").split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  for (const seg of segs) {
    let next; try { next = await childCid(cur, seg, getBlock); } catch (e) { return { kind: "error", reason: (e && e.message) || String(e), status: 502 }; }
    if (next == null) return { kind: "error", reason: "no such path segment: " + seg, status: 404 };
    cur = next;
  }
  // PEEK the target node from its own block (cheap — does not assemble a whole file), then either list a
  // directory or hand back a STREAM factory for a file. The file's bytes are never buffered here.
  let peek; try { peek = await peekNode(cur, getBlock); } catch (e) { return { kind: "error", reason: (e && e.message) || String(e), status: 502 }; }
  if (peek.kind === "missing") return { kind: "error", reason: "missing block for " + cur, status: 502 };
  if (peek.kind === "directory") {
    // A HAMT (sharded) directory: find index.html by hash (it may live in a sub-shard, not the direct
    // links), and list only this shard's DIRECT named entries — a full HAMT walk could be millions of nodes.
    if (peek.hamt) {
      const idxCid = await hamtLookup(peek.node, "index.html", getBlock).catch(() => null);
      if (idxCid) return { kind: "file", cidStr: idxCid, contentType: "text/html", name: "index.html", servedIndex: true, stream: () => streamUnixFsFile(idxCid, getBlock) };
      const entries = peek.node.links.filter((l) => (l.name || "").length > HAMT_PREFIXLEN)
        .map((l) => ({ name: l.name.slice(HAMT_PREFIXLEN), cid: cidToString(l.cid), size: l.tsize, isDir: l.cid.codec === holoIpfs.CODEC.DAG_PB && looksDir(l.name.slice(HAMT_PREFIXLEN)) }));
      return { kind: "directory", cidStr: cur, entries, hamt: true };
    }
    const entries = peek.node.links.map((l) => ({ name: l.name, cid: cidToString(l.cid), size: l.tsize, isDir: l.cid.codec === holoIpfs.CODEC.DAG_PB && looksDir(l.name) }));
    const idx = entries.find((e) => e.name === "index.html") || entries.find((e) => e.name === "index.htm");
    if (idx) return { kind: "file", cidStr: idx.cid, contentType: "text/html", name: idx.name, servedIndex: true, stream: () => streamUnixFsFile(idx.cid, getBlock) };
    return { kind: "directory", cidStr: cur, entries };
  }
  // file / raw → STREAM. A render contract DECLARED in the bytes wins (a self-describing object chooses how
  // it renders, S1); else the name extension; else sniff the raw leaf / the file's first leaf. For a single
  // raw leaf we hold the whole block, so dispatchRender can honor a UOR render-contract envelope right here.
  const name = segs.length ? segs[segs.length - 1] : "";
  let ct = null, renderKind = null;
  if (peek.raw) { const d = dispatchRender(peek.block, name); ct = d.contentType; if (d.declared) renderKind = d.kind; }
  if (!ct) ct = mimeOf(name);
  if (!ct && peek.node && peek.node.links && peek.node.links.length) { try { const first = await getBlock(cidToString(peek.node.links[0].cid)); if (first) ct = sniff(first, name); } catch {} }
  if (!ct && peek.node && !(peek.node.links || []).length && peek.node.data) { try { const u = holoIpfs.decodeUnixFs(peek.node.data); if (u && u.data) ct = sniff(u.data, name); } catch {} }
  if (!ct) ct = "application/octet-stream";
  return { kind: "file", cidStr: cur, contentType: ct, name, ...(renderKind ? { renderKind } : {}), stream: () => streamUnixFsFile(cur, getBlock) };
}

// ── the navigation reporter — a tiny script injected into served HTML (a COPY of already-verified bytes,
//    the same discipline as the OS subpath rewrite). It reports the iframe's current URL UP to the shell so
//    the omnibox address bar tracks the journey, and nudges a report after each in-page link click. The
//    page's own bytes are unchanged on the wire/in the κ — this rides only on the rendered copy. ──
export function navReporter() {
  return "<script>(function(){try{"
    + "var rep=function(){try{var bt=((document.body&&document.body.innerText)||'').replace(/\\s+/g,' ').trim().slice(0,6000);parent.postMessage({type:'holo-ipfs:nav',url:location.href,title:document.title,text:bt},'*')}catch(e){}};"
    + "rep();addEventListener('load',rep);addEventListener('hashchange',rep);addEventListener('popstate',rep);"
    + "addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(a)setTimeout(rep,40);},true);"
    + "}catch(e){}})();</script>";
}
export function injectNavReporter(htmlText) {
  const s = navReporter();
  if (/<head[^>]*>/i.test(htmlText)) return htmlText.replace(/<head[^>]*>/i, (m) => m + s);
  if (/<html[^>]*>/i.test(htmlText)) return htmlText.replace(/<html[^>]*>/i, (m) => m + s);
  return s + htmlText;
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const human = (n) => { n = +n || 0; if (n < 1024) return n + " B"; if (n < 1048576) return (n / 1024).toFixed(1) + " KB"; if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB"; return (n / 1073741824).toFixed(2) + " GB"; };
const looksDir = (name) => !/\.[a-z0-9]{1,8}$/i.test(name || "");   // no extension → probably a directory (the SW redirects either way)

// classify a filename → a visual category (icon + accent) for the file browser. A directory is chosen by the
// caller (isDir); otherwise by extension. This is what turns a raw DAG listing into a web2-familiar browser.
const EXT_CAT = {
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", avif: "image", svg: "image", bmp: "image", ico: "image",
  mp4: "video", webm: "video", mov: "video", mkv: "video", m4v: "video", avi: "video",
  mp3: "audio", wav: "audio", flac: "audio", ogg: "audio", m4a: "audio", aac: "audio",
  js: "code", mjs: "code", ts: "code", jsx: "code", tsx: "code", json: "code", html: "code", htm: "code", css: "code", py: "code", rs: "code", go: "code", c: "code", cpp: "code", sh: "code", xml: "code", yml: "code", yaml: "code", wasm: "code",
  pdf: "doc", md: "doc", txt: "doc", csv: "doc", doc: "doc", docx: "doc", rtf: "doc",
  zip: "archive", tar: "archive", gz: "archive", tgz: "archive", "7z": "archive", rar: "archive", bz2: "archive", xz: "archive", car: "archive",
};
const catOf = (name, isDir) => isDir ? "dir" : (EXT_CAT[String(name || "").split(".").pop().toLowerCase()] || "file");
// clean line-icons (stroke=currentColor), one per category; images render a real thumbnail instead.
const ICON = {
  dir: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.2h8a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-2.5v9L16 14z"/>',
  audio: '<path d="M9 18V6l10-2.2V16"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="16.5" cy="16" r="2.6"/>',
  code: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4M13.5 5l-3 14"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h6M10 15.5h6M10 8.5h3"/>',
  archive: '<rect x="4" y="4" width="16" height="4.5" rx="1"/><path d="M5 8.5h14V20H5z"/><path d="M11 12h2v2.5h-2z"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="10" r="1.7"/><path d="M4 17l5-4 4 3 3.5-2.5L21 17"/>',
};
const CAT_HUE = { dir: 262, image: 190, video: 350, audio: 150, code: 41, doc: 24, archive: 220, file: 220 };

// directoryListingHtml(root, path, entries) — a beautiful, web2-familiar file browser (native Hologram). Links
// are RELATIVE to the directory's URL (served with a trailing slash), so clicking an entry browses deeper
// through the gateway. Image entries lazy-load a real thumbnail; every other type gets a tinted line-icon.
export function directoryListingHtml(root, path, entries) {
  const crumbs = String(path || "").split("/").filter(Boolean);
  const rootShort = esc(String(root).slice(0, 8) + "…" + String(root).slice(-4));
  // breadcrumb: root → each path segment, each a relative up-link
  const crumbHtml = crumbs.map((c, i) => `<span class="sep">/</span><a class="crumb" href="${"../".repeat(crumbs.length - 1 - i) || "./"}">${esc(c)}</a>`).join("");
  const cells = (entries || []).map((e) => {
    const isDir = e.isDir != null ? !!e.isDir : looksDir(e.name);
    const cat = catOf(e.name, isDir);
    const href = esc(e.name) + (isDir ? "/" : "");
    const hue = CAT_HUE[cat] || 220;
    const meta = isDir ? "folder" : (e.size != null ? human(e.size) : "");
    const thumb = cat === "image"
      ? `<img class="thumb" loading="lazy" decoding="async" src="${href}" alt="" onerror="this.style.display='none';this.parentElement.classList.add('noimg')">`
      : "";
    return `<a class="cell ${cat}" href="${href}" style="--h:${hue}" title="${esc(e.name)}">`
      + `<div class="ph">${thumb}<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON[cat] || ICON.file}</svg></div>`
      + `<div class="lb"><span class="nm">${esc(e.name)}</span><span class="mt">${esc(meta)}</span></div></a>`;
  }).join("");
  const up = crumbs.length ? `<a class="cell up" href="../"><div class="ph"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></div><div class="lb"><span class="nm">Up a level</span><span class="mt">..</span></div></a>` : "";
  const n = (entries || []).length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ipfs://${rootShort}${crumbs.length ? " / " + esc(crumbs.join("/")) : ""}</title>
<style>
  :root{--bg:#070a12;--panel:#0e1421;--card:#131b2b;--card2:#182236;--line:#1e2942;--ink:#eaf0fb;--dim:#8a97b2;--good:#34d399;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
  @media(prefers-color-scheme:light){:root{--bg:#f6f8fc;--panel:#fff;--card:#fff;--card2:#f2f5fb;--line:#e5eaf3;--ink:#0f1626;--dim:#5a6782}}
  *{box-sizing:border-box}html,body{margin:0}
  body{background:radial-gradient(1200px 600px at 50% -12%,#101a33,var(--bg) 62%);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;min-height:100vh;padding:26px 20px 80px;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1120px;margin:0 auto}
  header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 14px;margin:-8px -8px 20px;border-radius:14px;background:color-mix(in srgb,var(--bg) 74%,transparent);backdrop-filter:blur(14px);border:1px solid var(--line)}
  .brand{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(150deg,#7c5cff,#4dd0e1);color:#fff;font-size:16px;flex:none;box-shadow:0 4px 16px rgba(124,92,255,.35)}
  .path{display:flex;align-items:center;gap:2px;flex-wrap:wrap;font:12.5px var(--mono);min-width:0}
  .path a.crumb,.path .root{color:var(--ink);text-decoration:none;padding:3px 7px;border-radius:7px} .path a.crumb:hover,.path .root:hover{background:var(--card2)}
  .path .root{color:var(--dim)} .path .sep{color:var(--dim);opacity:.5}
  .pill{margin-left:auto;display:inline-flex;align-items:center;gap:7px;font:11.5px/1 var(--mono);color:var(--good);background:color-mix(in srgb,var(--good) 12%,transparent);border:1px solid color-mix(in srgb,var(--good) 30%,transparent);padding:6px 10px;border-radius:999px;white-space:nowrap}
  .pill .dot{width:7px;height:7px;border-radius:50%;background:var(--good);box-shadow:0 0 8px var(--good)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:14px}
  .cell{display:flex;flex-direction:column;text-decoration:none;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;transition:transform .12s ease,border-color .12s ease,box-shadow .12s ease}
  .cell:hover{transform:translateY(-3px);border-color:color-mix(in srgb,hsl(var(--h,220) 80% 62%) 55%,var(--line));box-shadow:0 10px 30px rgba(0,0,0,.35)}
  .ph{position:relative;aspect-ratio:4/3;display:grid;place-items:center;background:radial-gradient(120% 120% at 50% 0%,hsl(var(--h,220) 42% 22% / .55),var(--card2));color:hsl(var(--h,220) 85% 72%)}
  .ph .ic{width:38px;height:38px;opacity:.92} .cell.up .ph{color:var(--dim);background:var(--card2)}
  .thumb{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:var(--card2)} .cell.image:not(.noimg) .ph .ic{display:none}
  .lb{padding:9px 11px 11px;display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--line)}
  .nm{font-size:13px;font-weight:560;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mt{font:11px var(--mono);color:var(--dim)}
  .empty{grid-column:1/-1;text-align:center;color:var(--dim);padding:60px 0;font:13px var(--mono)}
  .foot{color:var(--dim);opacity:.7;font:11px var(--mono);margin-top:26px;text-align:center}
</style></head><body>
<div class="wrap">
  <header>
    <div class="brand">⬡</div>
    <div class="path"><a class="root" href="${"../".repeat(crumbs.length) || "./"}" title="ipfs://${esc(root)}">${rootShort}</a>${crumbHtml}</div>
    <span class="pill"><span class="dot"></span>${n} item${n === 1 ? "" : "s"} · verified L5</span>
  </header>
  <div class="grid">${up}${cells || '<div class="empty">∅ &nbsp; this directory is empty</div>'}</div>
  <div class="foot">ipfs://${esc(root)} · content-addressed · gateway-trustless · every block re-hashed to its CID</div>
</div></body></html>`;
}

// imageViewerHtml(bytes, opts) — a STUNNING full-page viewer for a navigated image. Parses format, true
// pixel dimensions and EXIF (camera · lens · date · exposure · GPS) from the already-verified bytes (no
// server, no thumbnail service), renders a gallery-grade frame + metadata panel, and derives an ambient
// backdrop from the image's own dominant color client-side. The <img> re-fetches the raw bytes via ?raw
// (a cache hit after the CAR warm). Everything web2-familiar, everything on-device.
export function imageViewerHtml(bytes, { name = "", cidStr = "", rawUrl = "?raw=1" } = {}) {
  let m; try { m = imageMeta(bytes); } catch { m = null; }
  m = m || { format: "", mime: "", bytes: bytes ? bytes.length : 0 };
  const ex = m.exif || {};
  const dims = (m.width && m.height) ? `${m.width.toLocaleString()} × ${m.height.toLocaleString()}` : "";
  const rows = [];
  const row = (k, v) => { if (v) rows.push(`<div class="mr"><span class="k">${esc(k)}</span><span class="v">${esc(String(v))}</span></div>`); };
  row("Dimensions", dims + (m.megapixels ? `  ·  ${m.megapixels} MP` : ""));
  row("Format", (m.format || "").toUpperCase() + (m.aspect ? `  ·  ${m.aspect}∶1` : ""));
  row("File size", imgHuman(m.bytes));
  if (ex.make || ex.model) row("Camera", [ex.make, ex.model].filter(Boolean).join(" ").replace(/\s+/g, " "));
  if (ex.lens) row("Lens", ex.lens);
  if (ex.dateTaken || ex.dateTime) row("Captured", (ex.dateTaken || ex.dateTime).replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3"));
  const shot = [ex.fNumber ? `ƒ/${ex.fNumber}` : "", ex.exposure || "", ex.iso ? `ISO ${ex.iso}` : "", ex.focalLength ? `${ex.focalLength} mm` : ""].filter(Boolean).join("   ·   ");
  row("Exposure", shot);
  if (ex.software) row("Software", ex.software);
  const gps = ex.gps
    ? `<a class="mr gps" href="https://www.openstreetmap.org/?mlat=${ex.gps.lat}&mlon=${ex.gps.lon}#map=13/${ex.gps.lat}/${ex.gps.lon}" target="_blank" rel="noopener"><span class="k">Location</span><span class="v">${ex.gps.lat.toFixed(5)}, ${ex.gps.lon.toFixed(5)}  ↗</span></a>`
    : "";
  const title = esc(name || (m.format ? m.format.toUpperCase() + " image" : "Image"));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
  :root{--bg:#06080e;--panel:#0e1420cc;--line:#20293e;--ink:#eef2fb;--dim:#93a0bd;--good:#34d399;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--amb:260}
  *{box-sizing:border-box}html,body{margin:0;height:100%}
  body{background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}
  .amb{position:fixed;inset:0;background:radial-gradient(120% 90% at 30% 0%,hsl(var(--amb) 60% 30% / .55),transparent 60%),radial-gradient(120% 90% at 100% 100%,hsl(calc(var(--amb) + 40) 55% 28% / .4),transparent 55%),var(--bg);transition:background .6s ease;z-index:0}
  .app{position:relative;z-index:1;display:flex;height:100%;gap:0}
  .stage{flex:1;min-width:0;display:grid;place-items:center;padding:34px}
  .frame{max-width:100%;max-height:100%;border-radius:14px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.06);background:#0006}
  .frame img{display:block;max-width:100%;max-height:calc(100vh - 68px);object-fit:contain;opacity:0;transition:opacity .5s ease}
  .frame img.on{opacity:1}
  aside{width:330px;flex:none;background:var(--panel);backdrop-filter:blur(18px);border-left:1px solid var(--line);padding:22px 22px 26px;overflow:auto;display:flex;flex-direction:column;gap:2px}
  .hd{display:flex;align-items:center;gap:10px;margin-bottom:6px}
  .glyph{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(150deg,#7c5cff,#4dd0e1);color:#fff;font-size:14px;flex:none}
  h1{font-size:15px;font-weight:640;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
  .seal{display:inline-flex;align-items:center;gap:6px;font:11px var(--mono);color:var(--good);margin:2px 0 16px}
  .seal .dot{width:7px;height:7px;border-radius:50%;background:var(--good);box-shadow:0 0 8px var(--good)}
  .mr{display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid var(--line);text-decoration:none;color:inherit}
  .mr:last-of-type{border-bottom:0}
  .mr .k{color:var(--dim);font-size:12.5px;flex:none} .mr .v{text-align:right;font:12.5px var(--mono);word-break:break-word}
  .mr.gps:hover .v{color:#7cc4ff}
  .cid{margin-top:16px;font:10.5px var(--mono);color:#55627f;word-break:break-all;line-height:1.4}
  @media(max-width:720px){.app{flex-direction:column}.stage{padding:16px;max-height:60vh}aside{width:auto;border-left:0;border-top:1px solid var(--line)}}
</style></head><body>
<div class="amb" id="amb"></div>
<div class="app">
  <div class="stage"><div class="frame"><img id="img" src="${esc(rawUrl)}" alt="${title}" crossorigin="anonymous"></div></div>
  <aside>
    <div class="hd"><div class="glyph">⬡</div><h1>${title}</h1></div>
    <div class="seal"><span class="dot"></span>verified by re-derivation · Law L5</div>
    ${rows.join("")}
    ${gps}
    ${cidStr ? `<div class="cid">ipfs://${esc(cidStr)}</div>` : ""}
  </aside>
</div>
<script>(function(){
  var img=document.getElementById('img'),amb=document.getElementById('amb');
  function paint(){ img.classList.add('on');
    try{ var c=document.createElement('canvas'),n=16;c.width=c.height=n;var x=c.getContext('2d');x.drawImage(img,0,0,n,n);
      var d=x.getImageData(0,0,n,n).data,best=null,bs=-1;
      for(var i=0;i<d.length;i+=4){var r=d[i],g=d[i+1],b=d[i+2],a=d[i+3];if(a<128)continue;var mx=Math.max(r,g,b),mn=Math.min(r,g,b);var sat=mx-mn,lum=(mx+mn)/2;if(lum<24||lum>236)continue;var sc=sat*1.4+40;if(sc>bs){bs=sc;best=[r,g,b];}}
      if(best){var r=best[0]/255,g=best[1]/255,b=best[2]/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),h=0,l=(mx+mn)/2,s=mx-mn;
        if(s){if(mx==r)h=((g-b)/s)%6;else if(mx==g)h=(b-r)/s+2;else h=(r-g)/s+4;h*=60;if(h<0)h+=360;}
        document.documentElement.style.setProperty('--amb',Math.round(h));}
    }catch(e){}
  }
  if(img.complete&&img.naturalWidth)paint();else img.addEventListener('load',paint);
})();</script>
</body></html>`;
}

// ipfsErrorHtml(p, out) — a clear, native failure page (not a raw gateway error).
export function ipfsErrorHtml(p, out) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ipfs · ${esc(out.status || "")}</title>
<style>body{margin:0;background:radial-gradient(900px 480px at 50% -10%,#0b1426,#05070d 60%);color:#e8eef9;font:15px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;display:grid;place-items:center;padding:30px}.c{max-width:520px;text-align:center}.g{font-size:34px}.t{font-size:16px;font-weight:650;margin:12px 0 6px}.s{color:#7d8aa6;font:12px ui-monospace,monospace;word-break:break-all}.r{color:#f87171;margin-top:10px;font:12.5px ui-monospace,monospace}</style></head>
<body><div class="c"><div class="g">⬡</div><div class="t">Couldn't resolve this object</div><div class="s">ipfs://${esc(p.root)}${p.path ? "/" + esc(p.path) : ""}</div><div class="r">${esc(out.reason || "no source served a verified copy")} · ${esc(out.status || 502)}</div></div></body></html>`;
}

export default { parseIpfsPath, makeGetBlock, resolveIpfsPath, directoryListingHtml, ipfsErrorHtml, injectNavReporter, navReporter, mimeOf, sniff, dispatchRender };
