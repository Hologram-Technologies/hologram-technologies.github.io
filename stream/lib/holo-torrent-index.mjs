// holo-torrent-index.mjs — M0 of HOLO-TORRENT-TV: the origin index + the id-join.
//
// The mount adds ZERO concepts. A torrent is not a new catalogue entry — it is one more VERIFIED ORIGIN
// under a title that already exists. This module is the join that makes that automatic: parse a torrent's
// release name → canonical id (IMDb/TMDB/TVDB/MBID) → the SAME contentKappa the library card already uses
// → attach the origin. Identity does the linking (dedup-by-κ, holo-stremio.contentKappa); nothing is
// hand-mapped. The origin index is `content-κ → [verified origins]`, itself a κ-shard like the TV library.
//
// Pure + injectable (resolveId = the metadata plane; hash = blake3). node / SW / DOM safe.

import { contentKappa } from "./holo-stremio.mjs";
import { isLawfulOrigin } from "./holo-torrent-stream.mjs";

// ── release-name grammar → {kind, …} ─────────────────────────────────────────────────────────
// Enough to route a torrent name to the right metadata authority. Media-agnostic downstream.
const SCENE = /\b(1080p|2160p|720p|480p|4k|uhd|bluray|blu-ray|bdrip|brrip|web-?dl|web-?rip|hdtv|dvdrip|x26[45]|h ?26[45]|hevc|aac|ac3|dd5 1|ddp?5? ?1?|10bit|hdr|remux|proper|repack|extended|internal|amzn|nf|dsnp)\b.*/i;
const AUDIO = /\b(flac|mp3|m4a|opus|aac|alac|wav|discography|vinyl|24 ?bit|lossless|cbr|vbr|kbps)\b/i;
const clean = (s) => String(s).replace(/[._]+/g, " ").replace(/\s+/g, " ").replace(SCENE, "")
  .replace(/\s*[[({][^\])}]*[\])}]\s*$/g, "").replace(/\s+\(?(?:19|20)\d{2}\)?\s*$/, "").replace(/[-\s]+$/, "").trim();

export function parseRelease(name) {
  const raw = String(name);
  let s = raw.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  let m;
  if ((m = s.match(/^(.*?)[ ]*[sS](\d{1,2})[ ]*[eE](\d{1,2})/)))       // Show S01E02
    return { kind: "series", show: clean(m[1]), season: +m[2], episode: +m[3] };
  if ((m = s.match(/^(.*?)[ ]+(\d{1,2})x(\d{2})\b/)))                    // Show 1x02
    return { kind: "series", show: clean(m[1]), season: +m[2], episode: +m[3] };
  if (AUDIO.test(raw) && (m = s.match(/^(.+?)\s[-–]\s(.+?)(?:\s\(?((?:19|20)\d{2})\)?)?$/)))   // Artist - Album
    return { kind: "music", artist: clean(m[1]), album: clean(m[2]), year: m[3] ? +m[3] : undefined };
  if ((m = s.match(/^(.*?)[ (]((?:19|20)\d{2})\b/)))                     // Movie Title 2010
    return { kind: "movie", title: clean(m[1]), year: +m[2] };
  return { kind: "movie", title: clean(s) };
}

// qualityFromRelease(name) → a rendition's quality descriptor, parsed from the release name. A title may
// carry several renditions (SD/HD/4K, lossy/lossless) as parallel origins; the resolver ranks by this.
export function qualityFromRelease(name) {
  const s = String(name);
  const height = /\b(4320p|8k)\b/i.test(s) ? 4320 : /\b(2160p|4k|uhd)\b/i.test(s) ? 2160 : /\b1440p\b/i.test(s) ? 1440 : /\b1080p\b/i.test(s) ? 1080 : /\b720p\b/i.test(s) ? 720 : /\b480p\b/i.test(s) ? 480 : /\b360p\b/i.test(s) ? 360 : 0;
  return {
    height,
    hdr: /\b(hdr(?:10)?|dolby\s?vision|dovi|\bdv\b)\b/i.test(s),
    vcodec: /\b(x265|hevc|h ?265)\b/i.test(s) ? "hevc" : /\b(x264|h ?264|avc)\b/i.test(s) ? "h264" : /\b(av1)\b/i.test(s) ? "av1" : null,
    lossless: /\b(flac|alac|lossless|24 ?bit)\b/i.test(s) || undefined,
    bitrate: 0,
  };
}

// ── the join: a torrent → { contentKappa, origin } via the metadata plane ─────────────────────
//   resolveId(parsed) → { type, id } | null   (type ∈ "movie"|"series"|"music"; id = the canonical id)
//   hash(str) → str                            (the substrate blake3, so κ matches library cards)
export function originFromTorrent(rec, { resolveId, hash, provenance = null, quality = null }) {
  const parsed = parseRelease(rec.name);
  const idr = resolveId(parsed);
  if (!idr || !idr.id) return null;                                     // unknown title → no origin (refuse, never invent)
  const kappa = contentKappa(idr.type, idr.id, hash);                   // SAME κ the library card already carries
  const origin = {
    kind: "verified-torrent",
    id: rec.infoHashV2 || rec.infoHashV1 || rec.name,                   // dedup key
    v1: rec.infoHashV1 || null, v2: rec.infoHashV2 || null,
    name: rec.name, webseeds: rec.webseeds || [], provenance,
    quality: quality || qualityFromRelease(rec.name),                   // the rendition's quality (for ranking)
  };
  return { contentKappa: kappa, parsed, idr, origin };
}

// ── admitOrigin — the ONE place the legal posture lives ───────────────────────────────────────
// Default policy ships today with no decision: a verified-torrent origin is admitted iff it is lawful —
// a webseed to a lawful host, OR the title/origin carries CC/public-domain provenance, OR it is the
// user's own library. Broadening reach later is a change to THIS function alone, nowhere else.
export const LAWFUL_PROVENANCE = new Set(["cc", "pd", "public-domain", "own", "own-library"]);
export function admitOrigin(origin, title = {}, policy = null) {
  if (policy) return !!policy(origin, title);
  if (!origin || origin.kind !== "verified-torrent") return false;
  const lawfulSeed = (origin.webseeds || []).some(isLawfulOrigin);
  const provOk = LAWFUL_PROVENANCE.has(origin.provenance) || LAWFUL_PROVENANCE.has(title.provenance);
  return lawfulSeed || provOk;
}

// ── the origin index — content-κ → [verified origins], dedup-by-origin, serializable as a κ-shard ─
export function makeOriginIndex() {
  const map = new Map();                                                // κ → Map(originId → origin)
  return {
    attach(kappa, origin) { if (!map.has(kappa)) map.set(kappa, new Map()); map.get(kappa).set(origin.id, origin); return this; },
    // ingest(rec, opts) — parse+join+admit+attach in one call; returns the κ it attached to, or null.
    ingest(rec, opts) {
      const j = originFromTorrent(rec, opts);
      if (!j) return null;
      if (!admitOrigin(j.origin, opts.title || {}, opts.policy)) return null;   // inadmissible → not indexed
      this.attach(j.contentKappa, j.origin); return j.contentKappa;
    },
    originsOf(kappa) { return [...(map.get(kappa)?.values() || [])]; },
    detach(kappa, originId) { const m = map.get(kappa); if (m) { m.delete(originId); if (!m.size) map.delete(kappa); } return this; },
    entries() { return [...map].map(([k, v]) => [k, [...v.values()]]); },   // for bounded retire (global sweep)
    has(kappa) { return map.has(kappa); },
    stats() { let o = 0; for (const v of map.values()) o += v.size; return { titles: map.size, origins: o }; },
    toShard() { return Object.fromEntries([...map].map(([k, v]) => [k, [...v.values()]])); },   // → JSON → κ
  };
}

export default { parseRelease, qualityFromRelease, originFromTorrent, admitOrigin, makeOriginIndex, LAWFUL_PROVENANCE };
