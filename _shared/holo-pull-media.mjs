// holo-pull-media.mjs — the bridge that wires the holo-pull streaming core into a media surface
// (apps/player → apps/video). It streams a content-addressed object as deadline-ordered, per-block
// L5-verified κ-blocks through the REAL holo-pull consume loop, reassembles, and hands a *playable*
// object (a Blob URL) to the engine. The byte source is a pluggable getBlock — in production the
// mesh/swarm (holo-mesh-blocks over holo-webrtc-link); a local in-memory mesh proves the wiring with
// zero transport assumptions. This is the ONLY new code the player surface needs: the surface change
// is a thin "?swarm=1 → player.src(url)" branch that calls playableFromSwarm().
//
// Faithful, not magical: a Blob URL needs the whole verified object before play, so this proves the
// streamed-by-block + per-block-L5 + reassemble + play path — NOT live MSE first-frame append (that is
// a further increment: feed verified leaves into a SourceBuffer as they land). What it does prove is
// that the same consume loop witnessed in Node + the browser harness drives the production engine, and
// that a tampered piece is withheld so a mismatched object never reaches the decoder.

import { createPull } from "./holo-pull.mjs";
import { consume } from "./holo-pull-consume.mjs";
import { createMeshBlocks, pairWires } from "../../../sbin/holo-mesh-blocks.mjs";
import { cidOf, cidToString, concat, equalBytes, sha256, toHex } from "./holo-ipfs.js";

export const DEFAULT_PIECE = 262144;   // 256 KiB — IPFS default chunk == a BEP-52 piece

// chunkToDag(bytes, piece) → { order:[cidStr…], store:Map<cidStr,bytes> }
// Content-address the object into fixed leaf pieces (the manifest the picker schedules over).
export async function chunkToDag(bytes, piece = DEFAULT_PIECE) {
  const order = [], store = new Map();
  if (bytes.length === 0) return { order, store };
  for (let off = 0; off < bytes.length; off += piece) {
    const ch = bytes.subarray(off, Math.min(off + piece, bytes.length));
    const cid = cidToString(await cidOf(ch));
    store.set(cid, ch);
    order.push(cid);
  }
  return { order, store };
}

// inMemoryMesh(store) → a holo-mesh-blocks source whose wantBlock verifies every block on receipt (L5).
// This is the default swarm seam: swap this for a mesh over real peers and nothing else changes.
export function inMemoryMesh(store, { timeoutMs = 8000 } = {}) {
  const [seed, edge] = pairWires();
  createMeshBlocks(seed, { getLocalBlock: (c) => store.get(c) || null });
  return createMeshBlocks(edge, { timeoutMs });
}

// streamMedia(bytes, opts) → { bytes, order, stats, verified, kappaOk, timedOut }
//   Pulls every piece through the consume loop over a verify-on-receipt source, reassembles, and
//   checks the whole object re-derives (byte-identical) + optionally matches a declared sha256 κ.
//   opts.makeSource(store, order) lets a caller inject the real swarm source; default = inMemoryMesh.
//   FAIL-CLOSED: holo-pull keeps re-requesting an unverifiable piece (re-eligible on failure), so a
//   piece with no honest source would spin forever — `maxMs` bounds the stream and REFUSES on deadline
//   (verified:false, bytes:null) rather than hanging the decoder. Honest objects finish in ms.
export async function streamMedia(bytes, opts = {}) {
  const { piece = DEFAULT_PIECE, want = "", fps = 0, lookahead = 8, makeSource = null, maxMs = 30000 } = opts;
  const { order, store } = await chunkToDag(bytes, piece);
  const src = makeSource ? makeSource(store, order) : inMemoryMesh(store);
  const parts = new Array(order.length);
  const pull = createPull(src, { blocks: order, strategy: "streaming", window: 16, pipeline: 8 });
  const signal = { aborted: false };
  const run = consume(pull, { order, fps, lookahead, onFrame: (i, _cid, b) => { parts[i] = b; } }, signal);
  let timedOut = false, timer = null, stats;
  if (maxMs > 0) {
    const guard = new Promise((res) => { timer = setTimeout(() => { timedOut = true; signal.aborted = true; pull.stop(); res(null); }, maxMs); });
    stats = await Promise.race([run, guard]);
  } else stats = await run;
  if (timer) clearTimeout(timer);
  const got = !timedOut && parts.every(Boolean) ? concat(...parts) : null;
  const verified = !!got && got.length === bytes.length && equalBytes(got, bytes);
  let kappaOk = null;
  if (verified && want) {
    const h = "sha256:" + toHex(await sha256(got));
    kappaOk = h.split(":").pop() === String(want).split(":").pop();
  }
  return { bytes: got, order, stats, verified, kappaOk, timedOut };
}

// playableFromSwarm(getObjectBytes, opts) → { url, bytes, order, stats, verified, kappaOk }
//   Browser entry for the surface. getObjectBytes() yields the object's bytes (production: pulled from
//   peers; the in-browser proof: one fetch of the served source). Streams + verifies them through
//   holo-pull, then returns a Blob URL the engine plays — or url:null (REFUSED) on any mismatch.
export async function playableFromSwarm(getObjectBytes, opts = {}) {
  const bytes = await getObjectBytes();
  const r = await streamMedia(bytes, opts);
  let url = null;
  if (r.verified && r.kappaOk !== false && typeof URL !== "undefined" && URL.createObjectURL)
    url = URL.createObjectURL(new Blob([r.bytes], { type: opts.type || "video/mp4" }));
  return { url, ...r };
}

export default { DEFAULT_PIECE, chunkToDag, inMemoryMesh, streamMedia, playableFromSwarm };
