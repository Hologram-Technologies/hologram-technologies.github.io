// holo-archive-source.mjs — a first-party κ-source backed by the Internet Archive (public-domain / CC).
//
// archive.org is a legal library of public-domain & Creative-Commons media. This source emits the SAME
// content-κ card + stream-handle shapes as holo-stremio.mjs, so it federates into the unified κ-graph
// identically to any Stremio addon — and its streams are REAL, FULL-QUALITY, and fully legitimate (the native
// "magic moment" content for First Light). Injectable fetchJson/hash (host proxy + κ-cache + blake3 in-shell).

import { contentKappa, routeStream } from './holo-stremio.mjs';

const SEARCH = 'https://archive.org/advancedsearch.php';
const META   = 'https://archive.org/metadata/';

// BOUNDARY: archive.org hosts BOTH legitimate public-domain content AND infringing uploads. Restrict to the
// curated public-domain collections, and drop any title carrying piracy-rip markers — so this source can never
// surface a pirated rip even on a free-text search.
const PD  = 'collection:(feature_films OR silent_films OR more_animation OR classic_cartoons OR prelinger OR classic_tv)';
const BAD = /\b(4k|uhd|blu-?ray|bdrip|remux|web-?dl|web-?rip|hd-?rip|hdtv|x26[45]|h26[45]|1080p|720p|2160p|hevc|dvdrip)\b/i;

function toCard(d, hash) {
  const id = 'ia:' + d.identifier;
  return {
    ok: true, lane: 'vod', kind: 'title', kappa: contentKappa('movie', id, hash),
    id, type: 'movie', name: d.title, year: d.year,
    description: Array.isArray(d.description) ? d.description[0] : d.description,
    poster: `https://archive.org/services/img/${d.identifier}`,
    via: { addon: 'hologram-archive', addonKappa: 'k:addon:hologram-archive' },
  };
}

// Search the public-domain movie collections → content-κ cards.
export async function searchArchive(query, { fetchJson, hash, rows = 20 } = {}) {
  const q = `(${query}) AND mediatype:(movies) AND ${PD}`;   // public-domain collections only
  const url = `${SEARCH}?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=year&fl[]=description&rows=${rows}&output=json`;
  const r = await fetchJson(url);
  return (r.response && r.response.docs ? r.response.docs : [])
    .filter((d) => d.identifier && d.title && !BAD.test(d.title))
    .map((d) => toCard(d, hash));
}

// Curated public-domain rail (no query) — feature films collection.
export async function archiveCatalog({ fetchJson, hash, rows = 24 } = {}) {
  const url = `${SEARCH}?q=${encodeURIComponent('collection:(feature_films) AND mediatype:(movies)')}&sort[]=downloads+desc&fl[]=identifier&fl[]=title&fl[]=year&fl[]=description&rows=${rows}&output=json`;
  const r = await fetchJson(url);
  return (r.response && r.response.docs ? r.response.docs : []).map((d) => toCard(d, hash));
}

// Resolve playable streams for a title → routed handles (best-quality mp4 first). All "native" (full quality).
export async function archiveStreams(id, { fetchJson } = {}) {
  const identifier = id.replace(/^ia:/, '');
  const r = await fetchJson(META + identifier);
  const files = (r.files || []).filter((f) => /\.(mp4|m4v|webm|ogv)$/i.test(f.name || ''));
  files.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0)); // largest = best quality
  return files.slice(0, 4).map((f) => {
    const url = `https://archive.org/download/${identifier}/${encodeURIComponent(f.name)}`;
    return { title: f.name, sizeMB: Math.round((Number(f.size) || 0) / 1e6), route: routeStream({ url }) };
  }).filter((s) => s.route.mode !== 'EXCLUDED');
}

export default { searchArchive, archiveCatalog, archiveStreams };
