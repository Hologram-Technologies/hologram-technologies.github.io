// holo-source-ia.mjs — Internet Archive as a SourceProvider: a massive, LEGAL, key-free catalogue of
// public-domain films (and more), shipped enabled-by-default so the wall is full of real, beautiful,
// legal content with zero user setup. Uses IA's open JSON APIs (no key):
//   advancedsearch.php?q=…&output=json   → { response:{ docs:[{identifier,title,year,description}] } }
//   metadata/{identifier}                → { files:[{name,format}], metadata:{} }
//   services/img/{identifier}            → poster
//   download/{identifier}/{file}         → the stream (HTTP, instant-play)
//
// createIA({ fetch, cache }) — injected (Node-witnessable). Implements the SourceProvider contract.

import { browseOnly } from "./holo-media-item.mjs";

const IA = "https://archive.org";
// curated, legal shelves (each is an IA search query).
// Curated, LEGAL, key-free public-domain shelves — the out-of-box catalogue you can stream right away with
// zero setup. Every collection id is verified to return streamable films.
const SHELVES = [
  { id: "feature_films", name: "Feature Films · Internet Archive", q: "collection:(feature_films) AND mediatype:(movies)" },
  { id: "comedy", name: "Comedy Classics · Internet Archive", q: "collection:(feature_films) AND subject:(comedy) AND mediatype:(movies)" },
  { id: "scifi_horror", name: "Sci-Fi & Horror · Internet Archive", q: "collection:(SciFi_Horror) AND mediatype:(movies)" },
  { id: "westerns", name: "Westerns · Internet Archive", q: "collection:(feature_films) AND subject:(western) AND mediatype:(movies)" },
  { id: "classic_tv", name: "TV Classics · Internet Archive", q: "collection:(classic_tv) AND mediatype:(movies)" },
  { id: "war", name: "War Films · Internet Archive", q: "collection:(feature_films) AND subject:(war) AND mediatype:(movies)" },
  { id: "animation", name: "Classic Animation · Internet Archive", q: "collection:(animationandcartoons) AND mediatype:(movies)" },
  { id: "noir", name: "Film Noir · Internet Archive", q: "collection:(film_noir) AND mediatype:(movies)" },
  { id: "silent", name: "Silent Cinema · Internet Archive", q: "collection:(silent_films) AND mediatype:(movies)" },
  { id: "documentary", name: "Documentaries · Internet Archive", q: "collection:(opensource_movies) AND subject:(documentary) AND mediatype:(movies)" },
];
const VIDEO_FMT = /h\.264|mpeg4|mp4|ogg video|ogv|matroska|webm/i;
const isVideoFile = (f) => VIDEO_FMT.test(f.format || "") || /\.(mp4|ogv|webm|mkv)$/i.test(f.name || "");
const qualityOf = (name) => /2160|4k/i.test(name) ? 2160 : /1080/.test(name) ? 1080 : /720/.test(name) ? 720 : 0;

function normalizeDoc(d) {
  return {
    id: "ia:" + d.identifier, _iaId: d.identifier, kind: "movie", name: d.title || d.identifier,
    year: d.year ? (String(d.year).match(/\d{4}/) ? +String(d.year).match(/\d{4}/)[0] : null) : null,
    overview: Array.isArray(d.description) ? d.description[0] : (d.description || ""),
    blurb: Array.isArray(d.description) ? d.description[0] : (d.description || ""),
    posterUrl: `${IA}/services/img/${encodeURIComponent(d.identifier)}`,
    backdrop: `${IA}/services/img/${encodeURIComponent(d.identifier)}`,
    topics: [], genres: [], rating: null, runtimeSec: 0,
    channel: "Internet Archive", quality: 0.7, license: "Public Domain",
    source: "tmdb", provider: "ia", kappa: "", holoKappa: "ia:" + d.identifier,
    availability: browseOnly(),
  };
}

export function createIA({ fetch: f, cache } = {}) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-source-ia: fetch required");
  async function api(url) {
    const fetcher = async () => { const r = await doFetch(url); if (!r.ok) throw new Error("ia " + r.status); return r.json(); };
    if (!cache) return fetcher();
    const { body } = await cache.through("ia|" + url, fetcher);
    return body;
  }
  async function searchDocs(q, { rows = 24, page = 1 } = {}) {
    const url = `${IA}/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=year&fl[]=description&sort[]=downloads+desc&rows=${rows}&page=${page}&output=json`;
    const data = await api(url);
    return (data && data.response && data.response.docs) || [];
  }
  return {
    id: "builtin:ia", name: "Internet Archive", kind: "open", enabled: true, trust: 3,
    async catalogs() { return SHELVES.map((s) => ({ id: s.id, type: "movie", name: s.name })); },
    async browse(catalogId, opts = {}) {
      const shelf = SHELVES.find((s) => s.id === catalogId) || SHELVES[0];
      const q = opts.search ? `${shelf.q} AND (title:(${opts.search}))` : shelf.q;
      return (await searchDocs(q, { page: (opts.skip ? Math.floor(opts.skip / 24) + 1 : 1) })).map(normalizeDoc);
    },
    async search(q) { return (await searchDocs(`mediatype:(movies) AND (title:(${q}))`)).map(normalizeDoc); },
    async resolve(item) {
      const id = item._iaId || String(item.id).replace(/^ia:/, "");
      const meta = await api(`${IA}/metadata/${encodeURIComponent(id)}`);
      const files = (meta && meta.files) || [];
      const vids = files.filter(isVideoFile).sort((a, b) => qualityOf(b.name) - qualityOf(a.name) || (+b.size || 0) - (+a.size || 0));
      if (!vids.length) return [];
      return vids.slice(0, 3).map((file) => ({
        playSrc: `${IA}/download/${encodeURIComponent(id)}/${encodeURIComponent(file.name)}`,
        type: /\.ogv$/i.test(file.name) ? "video/ogg" : /\.webm$/i.test(file.name) ? "video/webm" : "video/mp4",
        quality: qualityOf(file.name), hdr: false, kind: "open", httpDirect: true,
        provenance: { resolver: "Internet Archive", kind: "open", label: "Public Domain · Internet Archive" },
      }));
    },
  };
}

export default { createIA };
if (typeof window !== "undefined") window.HoloSourceIA = { createIA };
