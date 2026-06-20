// holo-media.mjs — native κ-addressed media streaming for Hologram (the MSE κ-feed).
//
// A MediaGraph is a content-addressed DAG: an init segment + an ordered list of media
// segments, EACH ONE κ. A stream is immutable per segment, so a video is a finite κ-DAG
// and a radio/playlist is an open DAG walked through "next". Identity is the bytes, never
// the URL (Law L1). openStream() pulls every segment BY ITS κ through the κ-store
// (arena → OPFS → /.holo route → heal), which RE-DERIVES each segment against its κ
// (Law L5) BEFORE it reaches the decoder — a tampered byte is refused, never fed. This is
// strictly stronger than a native player: the decoder only ever sees content-verified bytes.
//
// Two surfaces:
//   • ISOMORPHIC (Node · browser · SW) — the graph algebra + L5 segment verification. The
//     witness imports these; no MediaSource needed.
//   • BROWSER — openStream(videoEl, graph): the MSE feed loop (MediaSource/SourceBuffer).
//
//   import { openStream, mediaGraphClosureKappa, orderedSegmentKappas,
//            verifySegment, pickRepresentation, nextVideoId } from "/_shared/holo-media.mjs";
//
// Authorities: W3C Media Source Extensions · ISO/IEC 14496-12 (BMFF / fMP4) · WebM byte
// stream · holospaces Laws L1 (content not location) · L2 (canonical forms) · L5 (verify by
// re-derivation). Reuses the OS κ-store (holo-kstore) and content-addressing (holo-uor).

import { sha256hex, jcs } from "./holo-uor.mjs";

const SHA = "did:holo:sha256:";
const hexOf = (k) => String(k).split(":").pop().toLowerCase();

// ── isomorphic graph algebra ────────────────────────────────────────────────────────────────

// segmentKappa(bytes) — the content address of one segment on the OS serving (σ) axis.
// Byte-identical to what relock-app seals into the closure, so the /.holo/sha256/<hex> route
// resolves it (Law L1).
export const segmentKappa = (bytes) => SHA + sha256hex(bytes);

// verifySegment(bytes, κ) — Law L5: re-derive the content address and compare. The single
// trust boundary; a wrong byte changes the κ and is refused.
export const verifySegment = (bytes, kappa) => sha256hex(bytes) === hexOf(kappa);

// orderedSegmentKappas(graph) — every segment κ the graph references, in deterministic play
// order: for each video, each representation, the init segment then its media segments. This
// is the graph's segment CLOSURE — the exact set a player will ever feed a decoder.
export function orderedSegmentKappas(graph) {
  const out = [];
  for (const v of graph.videos || [])
    for (const r of v.representations || []) {
      if (r.initSegment) out.push(r.initSegment);
      for (const s of r.segments || []) out.push(s.kappa);
    }
  return out;
}

// mediaGraphClosureKappa(graph) — a single root κ over the WHOLE segment closure (the sorted,
// deduped κ set). Non-circular (it never includes itself), so it re-derives from the segments
// alone: prove the closure κ and you've pinned every byte the graph can ever play (Law L2·L5).
export function mediaGraphClosureKappa(graph) {
  const set = [...new Set(orderedSegmentKappas(graph).map(hexOf))].sort();
  return SHA + sha256hex(jcs(set));
}

// nextVideoId(graph, currentId) — the gapless successor. Explicit "next" wins (radio/autoplay
// link); otherwise the next video in playlist order. Returns null at the end of a finite graph.
export function nextVideoId(graph, currentId) {
  const vs = graph.videos || [];
  const i = vs.findIndex((v) => v.id === currentId);
  if (i < 0) return vs[0]?.id ?? null;
  if (vs[i].next) return typeof vs[i].next === "string" ? vs[i].next : vs[i].next.id;
  return vs[i + 1]?.id ?? null;
}

const videoById = (graph, id) =>
  (graph.videos || []).find((v) => v.id === id) || (graph.videos || [])[0] || null;

// pickRepresentation(video, { quality, isSupported }) — choose a playable representation. Only
// reps whose container/codec the browser's MSE can decode are eligible (no transcode on the
// identity path — bit-exact segments only, Law L2). `quality` is a target height; we pick the
// supported rep nearest it (default: the highest supported). isSupported is injectable for tests.
export function pickRepresentation(video, { quality, isSupported } = {}) {
  const supports =
    isSupported ||
    ((mime) => (typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(mime)));
  const ok = (video.representations || []).filter((r) => r.mime && supports(r.mime));
  if (!ok.length) return null;
  if (quality) {
    return ok.reduce((best, r) =>
      Math.abs((r.height || 0) - quality) < Math.abs((best.height || 0) - quality) ? r : best);
  }
  return ok.reduce((best, r) => ((r.height || 0) >= (best.height || 0) ? r : best));
}

// ── browser: the MSE κ-feed ─────────────────────────────────────────────────────────────────

const AHEAD = 6;          // prefetch window: segments to keep resolved ahead of the play head
const NEXT_TAIL = 12;     // seconds before a video ends to begin resolving the next one

// openStream(videoEl, graph, opts) → controller. Drives an HTMLVideoElement from a MediaGraph:
// resolves each segment by its κ (L5-verified by the κ-store), appends it to a SourceBuffer in
// order, prefetches a small window ahead, and walks "next" for gapless playlist/radio playback.
//
// opts:
//   resolve(κ)  — κ → verified bytes (default: holo-kstore.resolve; refuses on L5 mismatch)
//   startId     — which video to begin on (default: first)
//   quality     — target height for representation selection
//   onProgress({verified, bytes, video, buffered}) — per-segment telemetry (the L5 counter)
//   onVideo(video) — fired when a new video starts streaming
//   onError(err)   — a refused/failed segment (playback stalls rather than plays bad bytes)
//
// Returns { stop(), stats() }.
export function openStream(videoEl, graph, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const onVideo = opts.onVideo || (() => {});
  const onError = opts.onError || ((e) => console.error("[holo-media]", e));
  const stats = { verified: 0, bytes: 0, refused: 0 };
  let stopped = false;

  const resolve =
    opts.resolve ||
    (async (k) => {
      const m = await import("./holo-kstore.js");   // arena → OPFS → /.holo route, L5-refused
      return m.resolve(k, { verify: true });
    });

  const ms = new MediaSource();
  videoEl.src = URL.createObjectURL(ms);

  ms.addEventListener("sourceopen", async () => {
    URL.revokeObjectURL(videoEl.src);
    try {
      await feed();
    } catch (e) {
      stats.refused++;
      onError(e);
      try { if (ms.readyState === "open") ms.endOfStream("decode"); } catch (_) {}
    }
  });

  // Append one segment, awaiting the SourceBuffer's updateend (MSE appends are async + serial).
  const append = (sb, bytes) =>
    new Promise((res, rej) => {
      const done = () => { sb.removeEventListener("updateend", done); sb.removeEventListener("error", err); res(); };
      const err = () => { sb.removeEventListener("updateend", done); sb.removeEventListener("error", err); rej(new Error("SourceBuffer append error")); };
      sb.addEventListener("updateend", done);
      sb.addEventListener("error", err);
      sb.appendBuffer(bytes);
    });

  // Resolve a segment by κ (L5-verified) and feed it to the decoder. The ONLY entry of bytes
  // into the SourceBuffer — so nothing unverified is ever decoded.
  async function feedSegment(sb, kappa) {
    if (stopped) return;
    const bytes = await resolve(kappa);            // throws + refuses on κ mismatch (Law L5)
    if (stopped) return;
    await append(sb, bytes);
    stats.verified++; stats.bytes += bytes.length;
    onProgress({ ...stats, buffered: bufferedAhead(videoEl) });
  }

  async function feed() {
    let id = opts.startId || (graph.videos || [])[0]?.id;
    let sb = null, mime = null;
    let timelineEnd = 0;                           // running play-head offset across videos (seconds)
    const seen = new Set();                        // stop a radio loop from re-feeding forever

    while (!stopped && id && !seen.has(id)) {
      seen.add(id);
      const video = videoById(graph, id);
      const rep = pickRepresentation(video, { quality: opts.quality });
      if (!rep) throw new Error(`no MSE-playable representation for "${id}" (bit-exact, no transcode)`);

      if (!sb || rep.mime !== mime) {              // first video, or a codec/quality change
        if (!sb) { sb = ms.addSourceBuffer(rep.mime); mime = rep.mime; }
        else if (rep.mime !== mime) { sb.changeType(rep.mime); mime = rep.mime; }
      }
      // Lay each video end-to-end on ONE timeline: successive fMP4 files restart at PTS 0, so
      // without this offset video 2 would overwrite video 1's range and the buffer never grows.
      try { sb.timestampOffset = timelineEnd; } catch (_) {}
      onVideo(video);
      if (rep.initSegment) await feedSegment(sb, rep.initSegment);   // init MUST precede media

      const segs = rep.segments || [];
      let i = 0;
      // Pace to a prefetch window so we don't resolve the whole video up front, but always
      // stay AHEAD seconds buffered. Begin resolving the next video near the tail (gapless).
      while (!stopped && i < segs.length) {
        const ahead = bufferedAhead(videoEl);
        if (ahead < AHEAD || videoEl.paused || videoEl.readyState < 3) {
          await feedSegment(sb, segs[i].kappa);
          i++;
        } else {
          await sleep(120);
        }
      }
      timelineEnd += segs.reduce((t, s) => t + (s.dur || 0), 0);     // advance by this video's duration
      id = nextVideoId(graph, id);                 // walk "next" → gapless playlist / radio
    }
    if (!stopped && ms.readyState === "open") ms.endOfStream();
  }

  return {
    stop() { stopped = true; try { if (ms.readyState === "open") ms.endOfStream(); } catch (_) {} },
    stats: () => ({ ...stats }),
  };
}

function bufferedAhead(videoEl) {
  try {
    const b = videoEl.buffered;
    if (!b || !b.length) return 0;
    return Math.max(0, b.end(b.length - 1) - videoEl.currentTime);
  } catch { return 0; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export { NEXT_TAIL, AHEAD };
