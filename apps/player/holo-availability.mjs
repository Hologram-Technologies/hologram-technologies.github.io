// holo-availability.mjs — the honest bytes-vs-metadata resolver: bind a discovered title to a source you
// actually have. This is Jellyseerr's "request" collapsed into κ — a TMDb title is browsable metadata until
// a real source binds, at which point it becomes truly playable (through Holo Video, the same as any item).
//
// It matches a metadata item (a TMDb movie/series) against the sources the user holds — owned κ-objects,
// the native κ-store library, a linked Jellyfin server, the open/CC catalog — by TMDb id when present, else
// by normalized title (+ year proximity). The best source by PRIORITY wins (owned κ > κ-store > server >
// open), and its playable handle (playSrc/kappa/type) is what the title plays. No match → stays browse-only.
//
// Pure ESM, no network — Node witnesses the matching exactly.

// source priority: a content-addressed object you own beats a server URL beats an open stream.
const PRIO = { owned: 0, native: 1, jellyfin: 2, open: 3, live: 4 };

// normalize a title for matching: lowercase, drop a leading article, strip quality/edition noise, keep
// alphanumerics. "The Matrix" → "matrix"; "Big Buck Bunny 4K" → "big buck bunny".
const QUALITY = /\b(4k|8k|uhd|hd|fhd|60fps|30fps|remastered|extended|directors? cut|special edition|official|blender foundation short film)\b/g;
export function matchKey(name, year) {
  let s = String(name || "").toLowerCase();
  s = s.replace(/[‘’'`]/g, "").replace(QUALITY, " ").replace(/[^a-z0-9]+/g, " ").trim();
  s = s.replace(/^(the|a|an) /, "").trim();
  return s + (year ? "" : "");   // title-only key; year used as a soft guard, not part of the key
}

// buildIndex(sources) → { byTmdb, byTitle } maps to the best (lowest-prio) candidate per key.
export function buildIndex(sources = []) {
  const byTmdb = new Map(), byTitle = new Map();
  const consider = (map, key, item) => {
    if (!key) return;
    const prio = PRIO[item.source] ?? 9;
    const cur = map.get(key);
    if (!cur || prio < cur.prio) map.set(key, { item, prio, year: yearOf(item) });
  };
  for (const it of sources) {
    if (it.tmdbId) consider(byTmdb, String(it.tmdbId), it);
    consider(byTitle, matchKey(it.name, yearOf(it)), it);
  }
  return { byTmdb, byTitle };
}
const yearOf = (it) => it.year || (it.releaseDate && /^\d{4}/.test(it.releaseDate) ? +it.releaseDate.slice(0, 4) : null);

// resolve(metaItem, index) → the matched source item | null. Year guard: if BOTH sides have a year and they
// differ by more than 1, a title match is rejected (avoids a remake binding to the wrong file).
export function resolve(metaItem, index) {
  if (!index) return null;
  if (metaItem.tmdbId && index.byTmdb.has(String(metaItem.tmdbId))) return index.byTmdb.get(String(metaItem.tmdbId)).item;
  const cand = index.byTitle.get(matchKey(metaItem.name, yearOf(metaItem)));
  if (!cand) return null;
  const my = yearOf(metaItem);
  if (my && cand.year && Math.abs(my - cand.year) > 1) return null;
  return cand.item;
}

// availabilityFrom(sourceItem) → the honest availability block the player reads. Maps a source kind to the
// availability.source label; carries the playable handle.
export function availabilityFrom(s) {
  if (!s) return { playable: false, source: null, kappa: "", playSrc: "", type: "" };
  const source = s.source === "owned" || s.source === "native" ? "kappa" : s.source;   // both are content-addressed
  return { playable: true, source, kappa: s.kappa || "", playSrc: s.playSrc || s.src || "", type: s.type || "" };
}

export default { matchKey, buildIndex, resolve, availabilityFrom };

if (typeof window !== "undefined") window.HoloAvail = { matchKey, buildIndex, resolve, availabilityFrom };
