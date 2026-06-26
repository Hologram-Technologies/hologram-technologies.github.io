// holo-sponsorblock.mjs — strip in-video sponsor segments (the one ad class that lives IN the bytes:
// the creator's "this video is sponsored by…", self-promo, like/subscribe reminders). Projecting the raw
// stream removes PLATFORM ads by construction, but it cannot remove ads baked into the video itself —
// SponsorBlock can. We do it CLIENT-SIDE (like the SponsorBlock extension): fetch community segment data,
// auto-skip during playback. Fast, progressive-compatible (no re-mux), seamless. Pure + node-witnessable.
//
// Privacy: query by the FIRST 4 hex chars of sha256(videoId), not the id (the SponsorBlock private API);
// the server sees a hash prefix shared by many videos, never which video you watch. Filter locally.
//
// SponsorBlock data is YouTube-only — this is a no-op for other platforms (their platform ads are already
// gone via the projected stream; they have no community in-video-segment database).

// The ad-class categories on by default: clear advertisements + self/cross promotion + interaction nags.
// NOT intro/outro/preview/music_offtopic — those are creator content, not ads (opt in via opts.categories).
export const AD_CATEGORIES = ["sponsor", "selfpromo", "interaction"];

// sha256 hex prefix of the video id (default 4 chars) — the SponsorBlock privacy query key.
export async function sha256HexPrefix(videoId, n = 4) {
  const bytes = new TextEncoder().encode(String(videoId));
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
}

// Normalize one SponsorBlock API record's segments → [{start, end, category}] (the API gives [start,end] pairs).
export function normalizeSegments(segments) {
  const out = [];
  for (const s of segments || []) {
    const seg = s && s.segment;
    if (!Array.isArray(seg) || seg.length < 2) continue;
    const start = +seg[0], end = +seg[1];
    if (!(end > start)) continue;                       // drop zero/negative-length (e.g. a "poi" highlight point)
    out.push({ start, end, category: s.category || "sponsor" });
  }
  return out;
}

// Merge overlapping/adjacent segments so a skip lands past ALL of them (sorted by start).
export function mergeSegments(segs, gap = 0.5) {
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  const out = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end + gap) { last.end = Math.max(last.end, s.end); }
    else out.push({ ...s });
  }
  return out;
}

// Given the current time, return where to skip TO if t falls inside a sponsor segment, else null. `pad`
// catches the boundary a touch early; the trailing margin avoids re-triggering right at a segment's end.
export function skipTarget(t, segments, pad = 0.2) {
  for (const s of segments) {
    if (t >= s.start - pad && t < s.end - 0.4) return s.end;
  }
  return null;
}

// Fetch + normalize + merge the ad-class segments for a YouTube video. Returns [] on any failure (fail-open:
// never break playback to strip a sponsor). Inject `fetch` for witnesses; `cache.through` for κ-caching.
export async function fetchSegments(videoId, { categories = AD_CATEGORIES, fetch: f, base = "https://sponsor.ajay.app", cache } = {}) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch || !videoId) return [];
  const prefix = await sha256HexPrefix(videoId, 4);
  const url = base + "/api/skipSegments/" + prefix + "?categories=" + encodeURIComponent(JSON.stringify(categories));
  const go = async () => { const r = await doFetch(url); if (!r.ok) throw new Error("sb " + r.status); return r.text(); };
  let text;
  try { text = cache ? (await cache.through("sb|" + videoId, go)).body : await go(); }
  catch { return []; }
  let data; try { data = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const mine = data.find((d) => d && d.videoID === videoId);   // the private API returns many videos per hash prefix
  if (!mine) return [];
  return mergeSegments(normalizeSegments(mine.segments));
}

// Pull a YouTube video id out of a holo://os/sc/vstream?url=<watch url> source (the projected path). Returns
// null for any non-YouTube / non-vstream source, so the caller stays a no-op there.
export function videoIdFromVstream(src) {
  try {
    const u = new URL(src);
    if (!/\/sc\/vstream$/.test(u.pathname) && !/\/sc\/vstream/.test(u.pathname)) return null;
    const inner = u.searchParams.get("url");
    if (!inner) return null;
    const w = new URL(inner);
    if (/(^|\.)youtube\.com$/.test(w.hostname)) {
      if (w.pathname === "/watch") return w.searchParams.get("v");
      const m = w.pathname.match(/^\/(shorts|embed|live)\/([^/?#]+)/);
      return m ? m[2] : null;
    }
    if (w.hostname === "youtu.be") return w.pathname.slice(1).split("/")[0] || null;
    return null;
  } catch { return null; }
}

if (typeof window !== "undefined") window.HoloSponsorBlock = { AD_CATEGORIES, sha256HexPrefix, normalizeSegments, mergeSegments, skipTarget, fetchSegments, videoIdFromVstream };
export default { AD_CATEGORIES, sha256HexPrefix, normalizeSegments, mergeSegments, skipTarget, fetchSegments, videoIdFromVstream };
