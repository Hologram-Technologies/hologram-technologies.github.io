// holo-torrent-kappa.mjs — P0 of HOLO-TORRENT-UNIVERSE: the κ-bridge.
//
// The keystone claim, made real and testable: a BitTorrent torrent is ALREADY a content-addressed
// merkle object, so it maps natively onto the κ substrate — no trust added, integrity is the format.
//
//   • BitTorrent v2 (BEP 52) commits each file to a SHA-256 merkle tree over 16 KiB blocks. That is
//     structurally a κ-tree in a foreign hash. holo-kappa.mjs already sanctions exactly this seam:
//     SHA-256 is the *bridge encoding for foreign protocols* (shaBridge), NOT a second κ. So a
//     torrent's own hashes are the transport-integrity axis; kappo() (BLAKE3) is the substrate address.
//   • verify-on-read is not a scanner we bolt on — a poisoned peer that flips one byte fails the
//     block's SHA-256 leaf and is refused BEFORE the bytes reach the player (Law L5, mirrored here).
//   • v1 torrents (SHA-1 piece list, no per-file tree) still get a native κ identity via a κ-alias
//     minted over their canonical metainfo; their pieces verify against the SHA-1 list.
//
// CONTENT-NEUTRAL: this is a pure integrity primitive. It proves that streamed bytes match their
// advertised address — true of a Debian ISO, a Blender open movie, or your own backup, identically.
// It carries no catalogue and fetches nothing on its own.
//
// Pure + self-contained (node / Service-Worker / DOM safe). One BLAKE3 dep (holo-blake3), SHA via the
// canonical shaBridge; SHA-1 added locally as a second foreign-protocol bridge for v1 infohashes.

import { kappo, hexOf, shaBridge } from "../_shared/holo-kappa.mjs";

export const BLOCK = 16384; // BEP 52 leaf block size (16 KiB) — the merkle-leaf unit.
const ZERO32_HEX = "00".repeat(32); // BEP 52 pad hash: leaves beyond file end are set to zero.

// ── foreign-protocol digests (bridges, NOT κ) ────────────────────────────────────────────────
const asU8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (h) => new Uint8Array(h.match(/.{2}/g).map((x) => parseInt(x, 16)));

// sha256hex — the v2 axis. Reuse the canonical shaBridge so there is exactly one SHA-256 path.
export const sha256hex = (bytes) => shaBridge(bytes);

// sha1hex — the v1 axis (infohash + piece list). SHA-1 is a bridge encoding, same as sha256hex.
export async function sha1hex(bytes) {
  const u = asU8(bytes);
  if (globalThis.crypto && globalThis.crypto.subtle) {
    const d = await crypto.subtle.digest("SHA-1", u);
    return toHex(new Uint8Array(d));
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha1").update(u).digest("hex");
}

// ── bencode (the metainfo wire format) ───────────────────────────────────────────────────────
// Strings decode to Uint8Array (paths/hashes are binary); dict keys to latin1 strings. Each decoded
// dict carries a non-enumerable __spans{key:[start,end]} so the info dict's RAW bytes can be sliced
// for a canonical infohash (re-encoding is avoided — the hash must cover the exact on-wire bytes).
const L = (b, a, c) => { let s = ""; for (let k = a; k < c; k++) s += String.fromCharCode(b[k]); return s; };

export function bdecode(buf, i = 0) {
  const c = buf[i];
  if (c === 0x69) { const e = buf.indexOf(0x65, i); return [Number(L(buf, i + 1, e)), e + 1]; } // i<n>e
  if (c === 0x6c) { i++; const a = []; while (buf[i] !== 0x65) { const [v, n] = bdecode(buf, i); a.push(v); i = n; } return [a, i + 1]; } // l..e
  if (c === 0x64) { // d..e
    i++; const o = {}, spans = {};
    while (buf[i] !== 0x65) {
      const [k, n] = bdecode(buf, i); i = n; const vs = i;
      const [v, m] = bdecode(buf, i); i = m; const key = L(k, 0, k.length);
      o[key] = v; spans[key] = [vs, i];
    }
    Object.defineProperty(o, "__spans", { value: spans, enumerable: false });
    return [o, i + 1];
  }
  const colon = buf.indexOf(0x3a, i); const len = Number(L(buf, i, colon)); const s = colon + 1; // <len>:<bytes>
  return [buf.subarray(s, s + len), s + len];
}

const concat = (arrs) => { const n = arrs.reduce((s, a) => s + a.length, 0); const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };
const str = (s) => new Uint8Array([...String(s)].map((c) => c.charCodeAt(0)));

// bencode encode — canonical (dict keys sorted). Strings/Uint8Array as byte-strings.
export function bencode(v) {
  if (typeof v === "number") return str("i" + v + "e");
  if (v instanceof Uint8Array) return concat([str(v.length + ":"), v]);
  if (typeof v === "string") { const b = str(v); return concat([str(b.length + ":"), b]); }
  if (Array.isArray(v)) return concat([str("l"), ...v.map(bencode), str("e")]);
  if (v && typeof v === "object") {
    const keys = Object.keys(v).sort();
    return concat([str("d"), ...keys.flatMap((k) => [bencode(k), bencode(v[k])]), str("e")]);
  }
  throw new Error("bencode: unsupported " + typeof v);
}

// ── the SHA-256 merkle tree (BEP 52) ─────────────────────────────────────────────────────────
// merkleLayers(fileBytes) → { root, layers } where layers[0] = per-16KiB-block leaf hashes, padded
// with the zero-hash to a power of two, folded pairwise (sha256(L‖R)) to a single root. This is the
// exact commitment a v2 `pieces root` carries, so this function verifies real Debian/Blender torrents.
export async function merkleLayers(fileBytes) {
  const u = asU8(fileBytes);
  const nBlocks = Math.max(1, Math.ceil(u.length / BLOCK));
  let layer = [];
  for (let i = 0; i < nBlocks; i++) layer.push(await sha256hex(u.subarray(i * BLOCK, (i + 1) * BLOCK)));
  let pad = 1; while (pad < layer.length) pad <<= 1;          // next power of two
  while (layer.length < pad) layer.push(ZERO32_HEX);          // pad leaves = zero (BEP 52)
  const layers = [layer.slice()];
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) next.push(await sha256hex(concat([fromHex(layer[i]), fromHex(layer[i + 1])])));
    layers.push(next.slice()); layer = next;
  }
  return { root: layer[0], layers };
}

// ── BEP 52 piece layers — verify ONE piece against the file root, in isolation (streaming) ────
// A v2 torrent carries `piece layers`: the SHA-256 hash of each piece-sized subtree. With them, a
// client verifies piece N the instant it arrives — compute the piece's own subtree root and compare —
// without any other piece, and once-check that the layer itself folds to the committed `pieces root`.
const sha256pair = async (aHex, bHex) => sha256hex(concat([fromHex(aHex), fromHex(bHex)]));
const log2int = (n) => { let k = 0; while ((1 << k) < n) k++; return k; };
async function zeroSubtreeRootHex(height) { let h = ZERO32_HEX; for (let i = 0; i < height; i++) h = await sha256pair(h, h); return h; }
async function foldPow2(hexLeaves, padHex) {
  let layer = hexLeaves.slice(); let pad = 1; while (pad < layer.length) pad <<= 1;
  while (layer.length < pad) layer.push(padHex);
  while (layer.length > 1) { const nx = []; for (let i = 0; i < layer.length; i += 2) nx.push(await sha256pair(layer[i], layer[i + 1])); layer = nx; }
  return layer[0] || padHex;
}

// pieceSubtreeRootHex(pieceBytes, pieceLength) → the merkle root of ONE piece's 16 KiB blocks, padded
// within the piece to (pieceLength/BLOCK) leaves. This is exactly what a piece-layer entry commits to.
export async function pieceSubtreeRootHex(pieceBytes, pieceLength) {
  const u = asU8(pieceBytes); const blocksPerPiece = Math.max(1, pieceLength / BLOCK);
  const nb = Math.max(1, Math.ceil(u.length / BLOCK)); const leaves = [];
  for (let i = 0; i < nb; i++) leaves.push(await sha256hex(u.subarray(i * BLOCK, (i + 1) * BLOCK)));
  while (leaves.length < blocksPerPiece) leaves.push(ZERO32_HEX);   // pad within the piece
  return foldPow2(leaves, ZERO32_HEX);
}

// rootFromPieceLayer(pieceLayerHex[], pieceLength) → the file's pieces root, folding the piece layer up
// with zero-subtree padding (spec-correct: equals merkleLayers(fileBytes).root).
export async function rootFromPieceLayer(pieceLayer, pieceLength) {
  if (pieceLayer.length === 1) return hexOf(pieceLayer[0]);
  const zpad = await zeroSubtreeRootHex(log2int(Math.max(1, pieceLength / BLOCK)));
  return foldPow2(pieceLayer.map(hexOf), zpad);
}

// pieceLayerFromFile(fileBytes, pieceLength) → { piecesRoot, pieceLayer } for MINTING a v2 torrent.
export async function pieceLayerFromFile(fileBytes, pieceLength) {
  const u = asU8(fileBytes); const nPieces = Math.max(1, Math.ceil(u.length / pieceLength));
  const pieceLayer = [];
  for (let p = 0; p < nPieces; p++) pieceLayer.push(await pieceSubtreeRootHex(u.subarray(p * pieceLength, (p + 1) * pieceLength), pieceLength));
  return { piecesRoot: await rootFromPieceLayer(pieceLayer, pieceLength), pieceLayer };
}

// verifyPieceLayers(pieceLayerHex[], piecesRootHex, pieceLength) → the layer is authentic (folds to root).
export async function verifyPieceLayers(pieceLayer, piecesRootHex, pieceLength) {
  return (await rootFromPieceLayer(pieceLayer, pieceLength)) === hexOf(piecesRootHex);
}

// ── parse a .torrent → a version-agnostic record ─────────────────────────────────────────────
function walkFileTreeV2(node, prefix, out) {
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (key === "" && child && child["pieces root"] != null) {
      out.push({ path: prefix.join("/"), length: child.length || 0, piecesRoot: toHex(asU8(child["pieces root"])) });
    } else if (child && typeof child === "object" && !(child instanceof Uint8Array)) {
      walkFileTreeV2(child, prefix.concat(L(str(key), 0, str(key).length)), out);
    }
  }
}

// parseTorrent(bytes) → { name, version, infoHashV1?, infoHashV2?, pieceLength, files[], piecesV1?, raw }
export async function parseTorrent(bytes) {
  const buf = asU8(bytes);
  const [dict] = bdecode(buf);
  const info = dict.info; if (!info) throw new Error("parseTorrent: no info dict");
  const [s, e] = dict.__spans.info; const infoBytes = buf.subarray(s, e);
  const name = L(asU8(info.name), 0, asU8(info.name).length);
  const isV2 = info["meta version"] === 2 && info["file tree"];
  const hasV1 = info.pieces != null;
  const rec = { name, pieceLength: info["piece length"], version: isV2 ? (hasV1 ? "hybrid" : 2) : 1, files: [], raw: dict };
  if (isV2) {
    rec.infoHashV2 = await sha256hex(infoBytes);
    walkFileTreeV2(info["file tree"], [name], rec.files);
    // `piece layers` (top-level): { <pieces root bytes>: <concat of 32-byte piece hashes> } → keyed by hex.
    const pl = dict["piece layers"];
    if (pl && typeof pl === "object" && !(pl instanceof Uint8Array)) {
      rec.pieceLayers = {};
      for (const k of Object.keys(pl)) {
        const v = asU8(pl[k]); const arr = [];
        for (let i = 0; i < v.length; i += 32) arr.push(toHex(v.subarray(i, i + 32)));
        rec.pieceLayers[toHex(str(k))] = arr;
      }
    }
  }
  if (hasV1) {
    rec.infoHashV1 = await sha1hex(infoBytes);
    rec.piecesV1 = asU8(info.pieces); // concat of 20-byte SHA-1 piece hashes
    if (!isV2) {
      if (info.length != null) rec.files = [{ path: name, length: info.length }];
      else for (const f of info.files || []) rec.files.push({ path: [name, ...f.path.map((p) => L(asU8(p), 0, asU8(p).length))].join("/"), length: f.length });
    }
  }
  if (!rec.infoHashV1 && !rec.infoHashV2) throw new Error("parseTorrent: neither v1 nor v2 infohash");
  // webseeds — BEP 19 `url-list` (GetRight HTTP) + BEP 17 `httpseeds`. These are UNTRUSTED strings
  // from inside the file; the transport layer validates each against a lawful-host allowlist before
  // any fetch (an attacker-authored webseed URL must never become an SSRF vector).
  const dec = (u) => (u == null ? null : u instanceof Uint8Array ? L(u, 0, u.length) : String(u));
  rec.webseeds = [].concat(dict["url-list"] || [], dict["httpseeds"] || []).map(dec).filter(Boolean);
  return rec;
}

// ── the κ-bridge: a torrent's canonical substrate address ────────────────────────────────────
// torrentKappa(rec) → "did:holo:blake3:<hex>" over a canonical identity record. Same torrent (any
// protocol version, any source) collapses to ONE κ — the dedup-by-κ the index depends on. v1-only
// torrents get a first-class κ this way (the "κ-alias" / v1 shim): no v2 tree required for identity.
export function torrentKappa(rec) {
  const identity = {
    v1: rec.infoHashV1 || null,
    v2: rec.infoHashV2 || null,
    name: rec.name,
    files: rec.files.map((f) => ({ path: f.path, length: f.length, root: f.piecesRoot || null })).sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
  return kappo(str(JSON.stringify(identity)));
}

// ── verify-on-read: the safety heart (Law L5 for swarm-sourced bytes) ────────────────────────
// A block released to the player must re-derive to the address the torrent committed to. Any
// mismatch is a poisoned/corrupt peer and is REFUSED before render — never after the file lands.
export class TamperRefused extends Error { constructor(msg) { super(msg); this.name = "TamperRefused"; } }

// makeVerifier(rec, fileIndex) → async verifyBlock(index, bytes) that throws TamperRefused on mismatch.
//   v2: block verifies against the file's SHA-256 merkle LEAF at `index` (16 KiB granularity).
//   v1: block verifies against the SHA-1 PIECE hash at `index` (piece granularity).
export async function makeVerifier(rec, fileIndex = 0) {
  const file = rec.files[fileIndex];
  if (rec.infoHashV2 && file && file.piecesRoot) {
    // Rebuild the leaf layer lazily is impossible without bytes; instead accept the committed leaves
    // as provided by the caller (from the torrent's `piece layers`) — here we recompute-and-check the
    // whole-file root, and per-block check leaves against a supplied leaf table.
    return {
      axis: "sha256-merkle",
      // verifyLeaf(index, block, expectedLeafHex) → true|throws
      async verifyLeaf(index, block, expectedLeafHex) {
        const got = await sha256hex(asU8(block));
        if (got !== hexOf(expectedLeafHex)) throw new TamperRefused(`v2 block ${index}: SHA-256 leaf mismatch — poisoned peer refused`);
        return true;
      },
      // verifyRoot(fileBytes) → true iff the assembled file re-derives the committed pieces root.
      async verifyRoot(fileBytes) {
        const { root } = await merkleLayers(fileBytes);
        if (root !== file.piecesRoot) throw new TamperRefused(`v2 file "${file.path}": merkle root mismatch — refused`);
        return true;
      },
      // verifyPiece(index, pieceBytes) → verify ONE piece IN ISOLATION against the piece layer (VS1).
      // Streaming-safe: no other piece needed, index-bound (wrong index ⇒ refused).
      async verifyPiece(index, pieceBytes) {
        const layer = rec.pieceLayers && rec.pieceLayers[file.piecesRoot];
        const expected = layer ? layer[index] : file.piecesRoot;   // single-piece file: root itself
        if (expected == null) throw new TamperRefused(`v2 piece ${index}: no committed hash (out of range) — refused`);
        const got = await pieceSubtreeRootHex(pieceBytes, rec.pieceLength);
        if (got !== hexOf(expected)) throw new TamperRefused(`v2 piece ${index}: subtree root mismatch — poisoned peer refused`);
        return true;
      },
    };
  }
  if (rec.infoHashV1) {
    return {
      axis: "sha1-piece",
      async verifyPiece(index, pieceBytes) {
        const expected = toHex(rec.piecesV1.subarray(index * 20, index * 20 + 20));
        const got = await sha1hex(asU8(pieceBytes));
        if (got !== expected) throw new TamperRefused(`v1 piece ${index}: SHA-1 mismatch — poisoned peer refused`);
        return true;
      },
    };
  }
  throw new Error("makeVerifier: no verifiable axis for this torrent");
}

// ── safety witness (P4 preview; content-neutral heuristics) ──────────────────────────────────
// safetyWitness(rec) → { ok, flags } — structural + declared-type sanity. Not a moral judge; it
// refuses shapes that cannot be a legitimate media stream (a "movie" that is a bare executable).
const EXEC = /\.(exe|scr|bat|cmd|com|msi|apk|dmg|pkg|deb|rpm|jar|ps1|vbs|lnk)$/i;
const MEDIA = /\.(mp4|mkv|webm|m4v|mov|avi|flac|mp3|m4a|opus|ogg|wav|iso|img|nes|sfc|gb[ac]?)$/i;
export function safetyWitness(rec) {
  const flags = [];
  if (!rec.files.length) flags.push("no-files");
  const total = rec.files.reduce((s, f) => s + (f.length || 0), 0);
  const exec = rec.files.filter((f) => EXEC.test(f.path));
  const media = rec.files.filter((f) => MEDIA.test(f.path));
  const execBytes = exec.reduce((s, f) => s + (f.length || 0), 0);
  if (media.length === 0 && exec.length > 0) flags.push("executable-only");           // no media, only binaries
  if (total > 0 && execBytes / total > 0.5 && media.length === 0) flags.push("executable-dominant");
  return { ok: flags.length === 0, flags, mediaFiles: media.length, execFiles: exec.length };
}

export default {
  BLOCK, bdecode, bencode, sha256hex, sha1hex, merkleLayers, parseTorrent,
  torrentKappa, makeVerifier, safetyWitness, TamperRefused,
  pieceSubtreeRootHex, rootFromPieceLayer, pieceLayerFromFile, verifyPieceLayers,
};
