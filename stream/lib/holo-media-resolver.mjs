// holo-media-resolver.mjs — M1 of HOLO-TORRENT-TV: the resolve(κ) that streams a title, serverless.
//
// This is the seam that makes "every movie / audio / series κ is instantly streamable" true WITHOUT
// touching the one player. holo-player.mjs already plays anything expressible as resolve(κ)→bytes; this
// module IS such a resolver for media κs: content-κ → admitted origins (from the M0 index) → a verified,
// piece-by-piece stream over the VS pipe (webseed HTTP + WebRTC peer, one gate, refuse+heal). No server:
// bytes come from static webseeds and peers; every piece re-derives the torrent's own commitment (P0/VS)
// before it can render. This is the "verified-torrent rung" of the universal resolver — it fires when a
// κ's bytes are not already on a static mirror, so ANY κ-addressable media resolves through one ladder.
//
// Pure orchestration; all transport + torrent-fetch INJECTED (node / SW / DOM safe, 100% serverless).

import { streamPieceFrom, piecesForFile, readFileChunk } from "./holo-torrent-stream.mjs";
import { admitOrigin } from "./holo-torrent-index.mjs";

// videoFileIndex(rec) → the file to play: the largest audio/video file (multi-file torrents wrap the
// media with metadata). Single-file torrents → 0.
const MEDIA_EXT = /\.(mp4|mkv|webm|m4v|mov|avi|ogv|flac|mp3|m4a|opus|ogg|wav)$/i;
export function videoFileIndex(rec) {
  if (rec.files.length <= 1) return 0;
  let best = -1, bestLen = -1;
  rec.files.forEach((f, i) => { if (MEDIA_EXT.test(f.path) && (f.length || 0) > bestLen) { best = i; bestLen = f.length || 0; } });
  return best >= 0 ? best : 0;
}

// ── quality ranking — highest VERIFIED rendition wins (integrity is never traded for quality) ──
// A title may carry several renditions (SD/HD/4K, lossy/lossless) as parallel origins keyed by their own
// infohash. qualityScore ranks them: resolution dominates, then HDR / lossless, then bitrate. verified =
// the exact source bytes = studio quality (no transcode), so "best quality" and "bit-exact" are the same win.
export function qualityScore(q = {}) {
  return (q.height || 0) * 1000 + (q.hdr ? 300 : 0) + (q.lossless ? 200 : 0) + Math.min((q.bitrate || 0) / 1e6, 99);
}
const rendId = (o) => o.v2 || o.v1 || o.name;                          // a rendition = one file = one infohash

// groupRenditions(descs) → [{ id, quality, origins }] sorted best-quality first. Origins of the SAME
// rendition (webseed + peer + mirror of one file) are grouped so within-rendition heal (VS3/L0) applies.
export function groupRenditions(descs) {
  const g = new Map();
  for (const o of descs) {
    const k = rendId(o);
    if (!g.has(k)) g.set(k, { id: k, quality: o.quality || {}, origins: [] });
    const r = g.get(k); r.origins.push(o);
    if (qualityScore(o.quality || {}) > qualityScore(r.quality)) r.quality = o.quality || {};
  }
  return [...g.values()].sort((a, b) => qualityScore(b.quality) - qualityScore(a.quality));
}

// rankOrigins(descs) — within a rendition, prefer origins with a lawful webseed (always-available), then peers.
function rankOrigins(descs) {
  return descs.slice().sort((a, b) => ((b.webseeds && b.webseeds.length ? 1 : 0) - (a.webseeds && a.webseeds.length ? 1 : 0)));
}

// makeMediaResolver({ index, recFor, buildLiveOrigins, policy })
//   index            : makeOriginIndex() — content-κ → origin descriptors
//   recFor(desc)     : async → parsed torrent rec (piece hashes + webseeds) for that origin  (INJECTED:
//                      real = fetch the .torrent by infohash from the index blob store; witness = a map)
//   buildLiveOrigins(rec, descs) : → [Origin] — live webseed/peer Origins for streamPieceFrom (INJECTED transport)
//   policy           : optional admitOrigin override (the one posture knob)
export function makeMediaResolver({ index, recFor, buildLiveOrigins, policy = null, store = null }) {
  if (!index || typeof recFor !== "function" || typeof buildLiveOrigins !== "function")
    throw new Error("makeMediaResolver needs { index, recFor, buildLiveOrigins }");

  // resolveOrigins(κ) → admitted origins for a title (already admitted at ingest; re-checked here).
  function resolveOrigins(kappa, title = {}) {
    return rankOrigins(index.originsOf(kappa).filter((o) => admitOrigin(o, title, policy)));
  }
  // renditions(κ, {maxHeight}) → the title's renditions, best-verified-quality first, capped for the device.
  function renditions(kappa, { title = {}, maxHeight = Infinity } = {}) {
    const admitted = index.originsOf(kappa).filter((o) => admitOrigin(o, title, policy));
    const all = groupRenditions(admitted);
    const capped = all.filter((r) => (r.quality.height || 0) <= maxHeight);
    return capped.length ? capped : all;                             // audio (height 0) & over-cap fall back to any
  }

  // openStream(κ, opts) → a handle for the highest-quality rendition that VERIFIES, or null. It tries
  // renditions best-first, PROBING piece 0 through the gate before committing — so a higher-quality
  // rendition that can't verify (dead/lying origins) is dropped for the next VERIFIED one, and not one
  // unverified byte is ever returned to buy a nicer picture. Quality never trumps integrity.
  async function openStream(kappa, { fileIndex = 0, title = {}, maxHeight = Infinity } = {}) {
    for (const r of renditions(kappa, { title, maxHeight })) {
      const rec = await recFor(r.origins[0]);
      if (!rec) continue;
      const live = buildLiveOrigins(rec, rankOrigins(r.origins));
      const vfi = rec.files.length > 1 ? videoFileIndex(rec) : fileIndex;   // play the media file out of the pack
      const multi = rec.files.length > 1;
      // one verified reader over the target file: single-file → per-piece; multi-file → per-file chunk.
      const read = (i, onDrop) => multi
        ? readFileChunk(rec, vfi, i, live, { store, onDrop })
        : streamPieceFrom(live, rec, i, { fileIndex: vfi, onDrop, store }).then((x) => x.bytes);
      let probe0;
      try { probe0 = await read(0); } catch { continue; }            // integrity probe — rendition must verify
      const file = rec.files[vfi];
      const nPieces = multi ? piecesForFile(rec, vfi).count : Math.max(1, Math.ceil((file ? file.length : 0) / rec.pieceLength));
      const cache = new Map([[0, probe0]]);
      return {
        kappa, rec, nPieces, fileIndex: vfi, quality: r.quality, rendition: r.id, origins: r.origins,
        readPiece: (i, onDrop) => (cache.has(i) ? Promise.resolve(cache.get(i)) : read(i, onDrop)),
      };
    }
    return null;                                                     // no rendition verified → refuse
  }

  // resolveBytes(κ) → the whole file, verified end-to-end (for small media / integrity checks; video
  // uses openStream + the player's delta loop, never a monolithic buffer). null = refuse.
  async function resolveBytes(kappa, { fileIndex = 0, title = {} } = {}) {
    const s = await openStream(kappa, { fileIndex, title });
    if (!s) return null;
    const parts = [];
    for (let i = 0; i < s.nPieces; i++) parts.push(await s.readPiece(i));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  return { resolveOrigins, renditions, openStream, resolveBytes };
}

export default { makeMediaResolver, qualityScore, groupRenditions };
