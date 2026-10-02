// holo-torrent-stream.mjs — VS: acquire bytes from a lawful origin and verify every piece IN
// ISOLATION before release. The verifier is a gate in the byte path: nothing is returned to the
// caller (→ the media decoder) until its piece re-derives the torrent's own commitment.
//
// VS0 (this file): the WebSeed origin (BEP 19, GetRight HTTP) — a browser-reachable, peerless, lawful
// byte source that is nothing but HTTP Range requests. streamPiece() fetches one piece's byte range,
// verifies it against the torrent's SHA-1 piece hash (v1) with no other piece present, and throws
// TamperRefused on any mismatch. Origins that are not on the lawful allowlist are refused before fetch.
//
// Pure + injectable (fetchRange). Node / Service-Worker / DOM safe. No transport hard-coded — the same
// gate later sits behind a WebTorrent WSS peer origin (VS3) unchanged.

import { makeVerifier, TamperRefused } from "./holo-torrent-kappa.mjs";

// Lawful-origin allowlist (registrable domains). VS ships on content that is unambiguously legal to
// stream; a webseed URL is admissible iff https AND its host is (a sub of) one of these. Tighten/extend
// as the operator admits sources — this is the boundary the codebase's anti-piracy stance lives in.
export const LAWFUL_DOMAINS = [
  "debian.org", "ubuntu.com", "archive.org", "blender.org", "kernel.org",
  "fedoraproject.org", "archlinux.org", "linuxmint.com", "torproject.org", "videolan.org",
  "wikimedia.org", "wikipedia.org", // Wikimedia Commons — CC / public-domain media (Range + CORS)
];

export function isLawfulOrigin(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;                 // no cleartext, no SSRF-friendly schemes
    const h = u.hostname.toLowerCase();
    return LAWFUL_DOMAINS.some((d) => h === d || h.endsWith("." + d));
  } catch { return false; }
}

// pieceRange(rec, index) → { start, end, length } — byte span of piece `index` (single-file torrent).
// (Multi-file webseed mapping, where a piece straddles files, is VS2+; VS0 targets single-file ISOs.)
export function pieceRange(rec, index) {
  const total = rec.files.reduce((s, f) => s + (f.length || 0), 0);
  const start = index * rec.pieceLength;
  if (start >= total) throw new RangeError("piece index out of range: " + index);
  const end = Math.min(start + rec.pieceLength, total);        // exclusive
  return { start, end, length: end - start };
}

// webseedUrl(rec, base) → the request URL for a GetRight webseed. For a single-file torrent the
// url-list entry is the direct file URL; a base ending in "/" gets the torrent name appended.
export function webseedUrl(rec, base) {
  return base.endsWith("/") ? base + encodeURIComponent(rec.name) : base;
}

// ── origins — the byte source is swappable; the GATE is not (VS3) ─────────────────────────────
// An Origin is anything that can hand over a piece's bytes:
//   { id, kind: "webseed"|"peer"|…, lawful?: bool, fetchRange(startIncl, endIncl) → Uint8Array }
// A WebSeed (HTTP Range) and a WebTorrent WebRTC peer are just two Origins behind ONE verifier. The
// verifier (makeVerifier → verifyPiece) is origin- AND protocol-agnostic (v1 SHA-1 or v2 merkle path),
// so a lying peer is caught exactly like a corrupt CDN, and the piece heals from the next origin.

// webseedOrigin(rec, url, httpRange) → an HTTP-Range Origin (lawful-checked).
//   httpRange(url, a, b) → Uint8Array
export function webseedOrigin(rec, url, httpRange) {
  return { id: url, kind: "webseed", lawful: isLawfulOrigin(url), fetchRange: (a, b) => httpRange(webseedUrl(rec, url), a, b) };
}

// ── multi-file torrents — stream ONE file out of many, verified (BEP 19 GetRight per file) ─────
// Real Archive.org / Blender torrents wrap the video with metadata (12 files in one torrent). v1 pieces
// span the concatenation of all files, so to play file F verified we: (1) find the pieces covering F,
// (2) assemble each piece's global byte-range from the per-file webseeds, (3) verify it against the
// torrent's own piece hash, (4) hand back just F's slice of the piece. Integrity is the whole piece; the
// player only ever sees verified bytes.
const catU8 = (arrs) => { const n = arrs.reduce((s, a) => s + a.length, 0); const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };

// fileByteRange(rec, fileIndex) → { start, end, length } of a file within the torrent's global byte space.
export function fileByteRange(rec, fileIndex) {
  let start = 0; for (let i = 0; i < fileIndex; i++) start += rec.files[i].length || 0;
  const length = rec.files[fileIndex].length || 0;
  return { start, end: start + length, length };
}

// piecesForFile(rec, fileIndex) → { first, last, count } — the piece indices that cover this file.
export function piecesForFile(rec, fileIndex) {
  const { start, end } = fileByteRange(rec, fileIndex);
  const first = Math.floor(start / rec.pieceLength);
  const last = Math.floor((Math.max(start, end - 1)) / rec.pieceLength);
  return { first, last, count: last - first + 1 };
}

// fileWebseedUrl(rec, base, fileIndex) → the GetRight per-file URL. rec.files[].path already includes the
// torrent name as its root (as parseTorrent stores it), so base + path is the file's URL on the webseed.
export function fileWebseedUrl(rec, base, fileIndex) {
  if (!base.endsWith("/")) return base;                          // single direct-file webseed (unusual for multi-file)
  return base + rec.files[fileIndex].path.split("/").map(encodeURIComponent).join("/");
}

// assembleGlobalRange(rec, base, a, b, httpRange) → global torrent bytes [a..b] inclusive, fetched by
// splitting the range across the per-file webseeds it spans (a piece may straddle two files).
export async function assembleGlobalRange(rec, base, a, b, httpRange) {
  const parts = []; let fileStart = 0;
  for (let i = 0; i < rec.files.length && a <= b; i++) {
    const fEnd = fileStart + (rec.files[i].length || 0);
    if (a < fEnd) {
      const from = a - fileStart, to = Math.min(b, fEnd - 1) - fileStart;   // inclusive, file-relative
      parts.push(await httpRange(fileWebseedUrl(rec, base, i), from, to));
      a += to - from + 1;
    }
    fileStart = fEnd;
  }
  return catU8(parts);
}

// multiFileWebseedOrigin(rec, base, httpRange) → a webseed Origin for a multi-file torrent: its fetchRange
// assembles any global piece-range from the per-file webseeds. Plugs into streamPieceFrom unchanged.
export function multiFileWebseedOrigin(rec, base, httpRange) {
  return { id: base, kind: "webseed", lawful: isLawfulOrigin(base), fetchRange: (a, b) => assembleGlobalRange(rec, base, a, b, httpRange) };
}

// readFileChunk(rec, fileIndex, chunkIndex, origins, opts) → the portion of FILE `fileIndex` contained in
// its `chunkIndex`-th covering piece, VERIFIED (via streamPieceFrom) and trimmed to the file's bounds.
// Feeding chunk 0..count-1 sequentially yields exactly the file's bytes, in order, all verified.
export async function readFileChunk(rec, fileIndex, chunkIndex, origins, { store, onDrop } = {}) {
  const { first } = piecesForFile(rec, fileIndex);
  const pieceIndex = first + chunkIndex;
  const { bytes } = await streamPieceFrom(origins, rec, pieceIndex, { store, onDrop });
  const f = fileByteRange(rec, fileIndex);
  const pStart = pieceIndex * rec.pieceLength, pEnd = pStart + bytes.length;
  const lo = Math.max(f.start, pStart) - pStart, hi = Math.min(f.end, pEnd) - pStart;
  return bytes.subarray(lo, hi);
}

// pieceHashOf(rec, index, fileIndex) → the torrent's own content address for a piece (its axis hash):
// v1 → the 20-byte SHA-1 piece hash (hex); v2 → the piece-layer SHA-256 entry (hex). This is the key a
// piece is cached/mirrored under — a piece is content-addressed capacity, exactly like a κ on the ladder.
export function pieceHashOf(rec, index, fileIndex = 0) {
  if (rec.infoHashV2 && rec.pieceLayers) {
    const layer = rec.pieceLayers[rec.files[fileIndex].piecesRoot];
    return layer ? layer[index] : rec.files[fileIndex].piecesRoot;   // single-piece file: the root itself
  }
  if (rec.piecesV1) return [...rec.piecesV1.subarray(index * 20, index * 20 + 20)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return null;
}

// makePieceStore() → a tiny device κ-store for pieces (get/put by piece-hash). In the OS this is the
// real device store; here it lets a verified piece be served from cache on the next read (0-net, offline).
export function makePieceStore() { const m = new Map(); return { get: (k) => m.get(k) || null, put: (k, u8) => m.set(k, u8), size: () => m.size }; }

// storeOrigin(store, rec) → the DEVICE-STORE rung: serves a piece by its own hash if already verified &
// cached. A store miss throws → the ladder tries the next rung (mirror/webseed/peer). Answers first, 0-net.
export function storeOrigin(store, rec, { id = "device-store", fileIndex = 0 } = {}) {
  return { id, kind: "store", fetchRange: async (a) => {
    const key = pieceHashOf(rec, Math.floor(a / rec.pieceLength), fileIndex);
    const u8 = await store.get(key);
    if (!u8) throw new Error("store miss");
    return u8;
  } };
}

// mirrorOrigin(baseUrl, rec, httpGet) → a MIRROR rung: fetch(baseUrl + pieceHash) → bytes, keyed by the
// piece's own hash (like holo-rungs' b/<hex>). Untrusted capacity — verified by the gate before serve.
export function mirrorOrigin(baseUrl, rec, httpGet, { id = null, fileIndex = 0 } = {}) {
  return { id: id || baseUrl, kind: "mirror", fetchRange: async (a) =>
    httpGet(baseUrl + pieceHashOf(rec, Math.floor(a / rec.pieceLength), fileIndex)) };
}

// peerOrigin(id, requestPiece) → a swarm-peer Origin (e.g. a WebTorrent WebRTC data channel).
//   requestPiece(startIncl, endIncl) → Uint8Array   (the wire request over the peer transport)
// Peers are never trusted: `lawful` is irrelevant (the merkle gate is the trust), and a peer that lies
// is dropped by streamPieceFrom and never gets to serve that piece again in this attempt.
export function peerOrigin(id, requestPiece) {
  return { id, kind: "peer", fetchRange: (a, b) => requestPiece(a, b) };
}

// streamPieceFrom(origins, rec, index, opts) → { bytes, origin } — try origins in order, verify each
// through the SAME gate, DROP any that error/lie, heal from the next. Throws only if every origin fails
// (fail-closed: unverified bytes are never returned). onDrop(origin, reason) observes each drop.
export async function streamPieceFrom(origins, rec, index, { fileIndex = 0, onDrop, store = null } = {}) {
  const v = await makeVerifier(rec, fileIndex);
  const { start, end, length } = pieceRange(rec, index);
  let lastErr = null;
  for (const o of origins) {
    if (o.lawful === false) { onDrop && onDrop(o, "origin-not-lawful"); continue; }   // never fetch an off-allowlist webseed
    try {
      const bytes = await o.fetchRange(start, end - 1);
      if (!bytes || bytes.length !== length) throw new Error(`short read: got ${bytes && bytes.length}, want ${length}`);
      await v.verifyPiece(index, bytes);                        // ← the one gate, whatever the origin/version
      if (store && store.put && o.kind !== "store") { try { store.put(pieceHashOf(rec, index, fileIndex), bytes); } catch {} }   // verified bytes enter the store (0-net next time)
      return { bytes, origin: o };                              // passed: safe to decode
    } catch (e) {
      lastErr = e; onDrop && onDrop(o, e instanceof TamperRefused ? "tamper" : "error");   // drop this origin, heal from next
    }
  }
  throw lastErr || new Error("no origin could serve piece " + index);
}

// streamPiece(rec, index, { webseed, fetchRange, fileIndex }) → verified bytes from a single webseed
// (VS0/VS2 entry point). Delegates to the origin pipeline; preserves the explicit allowlist refusal.
export async function streamPiece(rec, index, { webseed, fetchRange, fileIndex = 0 }) {
  if (!isLawfulOrigin(webseed)) throw new Error("refused: webseed not on the lawful allowlist — " + webseed);
  const { bytes } = await streamPieceFrom([webseedOrigin(rec, webseed, fetchRange)], rec, index, { fileIndex });
  return bytes;
}

// firstLawfulWebseed(rec) → the first admissible webseed, or null.
export function firstLawfulWebseed(rec) {
  return (rec.webseeds || []).find(isLawfulOrigin) || null;
}

export default { LAWFUL_DOMAINS, isLawfulOrigin, pieceRange, webseedUrl, streamPiece, streamPieceFrom, webseedOrigin, peerOrigin, storeOrigin, mirrorOrigin, makePieceStore, pieceHashOf, firstLawfulWebseed, fileByteRange, piecesForFile, fileWebseedUrl, assembleGlobalRange, multiFileWebseedOrigin, readFileChunk, TamperRefused };
