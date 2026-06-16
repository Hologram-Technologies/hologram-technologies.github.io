// holo-web-snapshot.mjs — the COMMONS leg: seal a browsed (public) page into a content-addressed κ-DAG
// snapshot that the EXISTING IPFS gateway resolves, serverlessly, forever. "Browse once → the commons serves
// it." A sha256 κ IS a CIDv1 (sha2-256), so a snapshot is a real IPFS object: the same UnixFS DAG IPFS uses,
// every block re-deriving to its CID (Law L5). No origin, no proxy — once sealed, the page resolves from the
// κ-store (local commons) or from any IPFS peer/gateway, never from the origin again.
//
// A page = a flat UnixFS directory: index.html + its subresources, each a RAW leaf block, linked by name from
// a dag-pb directory node. The directory's root CID names the whole snapshot. Pure ESM (Node + SW); it only
// ENCODES (the mint) — the gateway already DECODES + resolves. Reuses holo-ipfs.js verbatim.

import * as holoIpfs from "../usr/lib/holo/holo-ipfs.js";

// sealSnapshot({ resources }) → { rootCid, did, blocks: Map<cidStr,Uint8Array>, manifest } | throws.
// resources: [{ name, bytes }] — "index.html" + flat asset names the HTML references (e.g. "style.css").
// Each resource → a raw leaf (CIDv1 raw, sha256); a dag-pb UnixFS directory links them; rootCid = the dir.
export async function sealSnapshot({ resources = [] } = {}) {
  const { sha256, makeCIDv1, cidToString, CODEC, HASH, encodeDagPb, encodeUnixFsDir, cidToDid } = holoIpfs;
  if (!resources.length) throw new Error("sealSnapshot: no resources");
  const blocks = new Map(), links = [];
  for (const r of resources) {
    const bytes = r.bytes instanceof Uint8Array ? r.bytes : new TextEncoder().encode(String(r.bytes == null ? "" : r.bytes));
    const cid = cidToString(makeCIDv1(CODEC.RAW, HASH.SHA2_256, await sha256(bytes)));   // raw leaf — gateway serves it as file bytes
    blocks.set(cid, bytes);
    links.push({ cid, name: String(r.name), tsize: bytes.length });
  }
  links.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));               // canonical link order → stable root CID
  const dirBlock = encodeDagPb({ data: encodeUnixFsDir(), links });
  const rootCid = cidToString(makeCIDv1(CODEC.DAG_PB, HASH.SHA2_256, await sha256(dirBlock)));
  blocks.set(rootCid, dirBlock);
  return { rootCid, did: cidToDid(rootCid), blocks, manifest: links.map((l) => ({ name: l.name, cid: l.cid, size: l.tsize })) };
}

// blockSource(blocks) → getBlock(cidStr) for resolveIpfsPath — serve the snapshot from a blocks Map (the
// in-memory commons; the witness drives the gateway with this). Normalizes the CID string form either way.
export function blockSource(blocks) {
  const norm = (c) => { try { return holoIpfs.cidToString(holoIpfs.parseCID(c)); } catch { return c; } };
  return async (cidStr) => blocks.get(cidStr) || blocks.get(norm(cidStr)) || null;
}

// publishToKStore(blocks) — write every verified snapshot block into the UNIFIED κ-store (the gateway's own
// block cache, keyed /.holo/ipfs/<cid>), so the live IPFS gateway resolves the snapshot from the local commons
// with NO network. This is "publishing to the local commons." Browser/SW only (no-op in Node — no `caches`).
export async function publishToKStore(blocks, cacheName = "holo-kappa-v2") {
  if (typeof caches === "undefined") return 0;
  let n = 0; const c = await caches.open(cacheName);
  for (const [cid, bytes] of blocks) { try { await c.put("/.holo/ipfs/" + cid, new Response(bytes, { headers: { "x-holo-cid": cid, "x-holo-verified": "L5", "cache-control": "public, max-age=31536000, immutable" } })); n++; } catch {} }
  return n;
}

// ── CARv1 — the standard IPFS archive (one file: a dag-cbor header naming the root, then length-framed
// blocks). It makes a sealed snapshot PUBLISHABLE by ANY transport — an in-browser IPFS node, a pin service,
// a P2P share, a USB stick — the universal payload. Pure; verified by self-roundtrip + the gateway resolving
// a re-imported CAR. (Real-tool interop, e.g. `ipfs dag import`, is owed — testable once a node is present.)
const _u8 = (...a) => { let n = 0; for (const x of a) n += x.length; const o = new Uint8Array(n); let k = 0; for (const x of a) { o.set(x, k); k += x.length; } return o; };
const _uvarint = (n) => { const o = []; while (n >= 0x80) { o.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } o.push(n); return new Uint8Array(o); };
const _readUvarint = (b, off) => { let x = 0, s = 1, p = off; for (;;) { const c = b[p++]; x += (c & 0x7f) * s; if (!(c & 0x80)) break; s *= 128; } return [x, p]; };
const _ascii = (s) => { const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; };
const _cborText = (s) => _u8(new Uint8Array([0x60 | s.length]), _ascii(s));                 // text string, len < 24
const _cborBytes = (b) => { const L = b.length, h = L < 24 ? [0x40 | L] : L < 256 ? [0x58, L] : [0x59, (L >> 8) & 255, L & 255]; return _u8(new Uint8Array(h), b); };

// toCar(rootCid, blocks: Map<cidStr,Uint8Array>) → Uint8Array (a CARv1 file).
export function toCar(rootCid, blocks) {
  const cidBytes = holoIpfs.parseCID(rootCid).bytes;
  // dag-cbor header { roots:[CID], version:1 } — map keys length-sorted (roots(5) < version(7)); CID = tag42(0x00‖cid)
  const cidEl = _u8(new Uint8Array([0xd8, 0x2a]), _cborBytes(_u8(new Uint8Array([0x00]), cidBytes)));
  const header = _u8(new Uint8Array([0xa2]), _cborText("roots"), new Uint8Array([0x81]), cidEl, _cborText("version"), new Uint8Array([0x01]));
  const parts = [_u8(_uvarint(header.length), header)];
  for (const [cidStr, bytes] of blocks) { const body = _u8(holoIpfs.parseCID(cidStr).bytes, bytes); parts.push(_u8(_uvarint(body.length), body)); }
  return _u8(...parts);
}

// fromCar(car) → { blocks: Map<cidStr,Uint8Array> } — parse a CARv1; the caller re-derives each block (L5).
export function fromCar(car) {
  const c = car instanceof Uint8Array ? car : new Uint8Array(car);
  let p = 0; const [hlen, p1] = _readUvarint(c, 0); p = p1 + hlen;          // skip the header (we re-derive the blocks)
  const blocks = new Map();
  while (p < c.length) {
    const [blen, p2] = _readUvarint(c, p); p = p2; const end = p + blen;
    const { cid, length } = holoIpfs.parseCIDPrefix(c, p);
    blocks.set(holoIpfs.cidToString(cid), c.subarray(p + length, end));
    p = end;
  }
  return { blocks };
}

export default { sealSnapshot, blockSource, publishToKStore, toCar, fromCar };
