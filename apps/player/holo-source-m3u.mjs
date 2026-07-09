// holo-source-m3u.mjs — an M3U/M3U8 playlist (IPTV / a curated VOD list) as a SourceProvider.
// Parses #EXTINF entries → channels/titles; resolve → the entry URL (HLS plays directly). Pure parse + a
// fetched playlist; injected fetch → Node-witnessable.

// parseM3U(text) → [{ name, url, logo, group }]
export function parseM3U(text) {
  const out = []; const lines = String(text || "").split(/\r?\n/); let cur = null;
  for (const ln of lines) {
    const s = ln.trim();
    if (s.startsWith("#EXTINF")) {
      const name = (s.split(",").pop() || "").trim();
      const logo = (s.match(/tvg-logo="([^"]*)"/) || [])[1] || null;
      const group = (s.match(/group-title="([^"]*)"/) || [])[1] || null;
      cur = { name, logo, group };
    } else if (s && !s.startsWith("#")) { if (cur) { cur.url = s; out.push(cur); cur = null; } else out.push({ name: s.split("/").pop(), url: s }); }
  }
  return out.filter((e) => e.url);
}

export function createM3UProvider({ base, url, name, fetch: f, cache } = {}) {
  const playlistUrl = url || base;
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-source-m3u: fetch required");
  const label = name || "Playlist";
  let entries = null;
  async function load() {
    if (entries) return entries;
    const go = async () => { const r = await doFetch(playlistUrl); if (!r.ok) throw new Error("m3u " + r.status); return r.text(); };
    const text = cache ? (await cache.through("m3u|" + playlistUrl, go)).body : await go();
    entries = parseM3U(text);
    return entries;
  }
  const norm = (e, i) => ({
    id: "m3u:" + i + ":" + (e.url || "").slice(-24), _url: e.url, kind: "movie", name: e.name || "Item " + i, year: null,
    overview: e.group || "", blurb: e.group || "", posterUrl: e.logo || null, backdrop: e.logo || null, runtimeSec: 0,
    rating: null, genres: e.group ? [e.group] : [], topics: e.group ? [String(e.group).toLowerCase()] : [],
    channel: label, quality: 0.6, license: "", source: "tmdb", provider: "m3u", kappa: "", holoKappa: "m3u:" + i,
    live: /\.m3u8(\?|$)/i.test(e.url || ""), availability: { playable: false, source: null, kappa: "", playSrc: "", type: "" },
  });
  const provider = {
    id: "m3u:" + playlistUrl, name: label, kind: "m3u", enabled: true, trust: 3,
    async catalogs() { const es = await load(); const groups = [...new Set(es.map((e) => e.group).filter(Boolean))]; return groups.length ? groups.slice(0, 6).map((g) => ({ id: g, type: "movie", name: g + " · " + label })) : [{ id: "all", type: "movie", name: label }]; },
    async browse(catalogId) { const es = await load(); return es.filter((e) => catalogId === "all" || e.group === catalogId).map(norm); },
    async search(q) { const es = await load(); return es.map(norm).filter((x) => x.name.toLowerCase().includes(String(q).toLowerCase())); },
    async resolve(item) { if (!item._url) return []; const isHls = /\.m3u8(\?|$)/i.test(item._url); return [{ playSrc: item._url, type: isHls ? "application/x-mpegURL" : "video/mp4", kind: "m3u", httpDirect: true, quality: 1080, provenance: { resolver: label, kind: "m3u", label: "Playlist · " + label } }]; },
  };
  return provider;
}
export default { createM3UProvider, parseM3U };
if (typeof window !== "undefined") window.HoloSourceM3U = { createM3UProvider, parseM3U };
