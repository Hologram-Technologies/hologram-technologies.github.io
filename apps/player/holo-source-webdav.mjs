// holo-source-webdav.mjs — a WebDAV / Nextcloud folder of videos as a SourceProvider. PROPFIND lists the
// directory; resolve → the file URL. Light XML parse (regex over <d:response>); injected fetch → Node-
// witnessable. Honest: auth is Basic; in-browser <video> auth is limited (best for public/cookie-auth or
// the native host which can attach the header).

const VIDEO = /\.(mp4|webm|mkv|m4v|mov|ogv|avi)$/i;

// parsePropfind(xml, base) → [{ name, href }] for video files (regex, namespace-agnostic).
export function parsePropfind(xml, base) {
  const out = [];
  const blocks = String(xml || "").split(/<[a-z]*:?response>/i).slice(1);
  for (const b of blocks) {
    const href = (b.match(/<[a-z]*:?href>([^<]+)<\/[a-z]*:?href>/i) || [])[1];
    if (!href || !VIDEO.test(href)) continue;
    const dn = (b.match(/<[a-z]*:?displayname>([^<]*)<\/[a-z]*:?displayname>/i) || [])[1];
    const name = decodeURIComponent(dn || href.split("/").pop());
    const url = /^https?:/.test(href) ? href : (base.replace(/\/[^/]*$/, "") + (href.startsWith("/") ? "" : "/") + href).replace(/([^:])\/\//g, "$1/");
    out.push({ name, href: url });
  }
  return out;
}

export function createWebDAVProvider({ base, user, password, name, fetch: f, cache } = {}) {
  base = String(base || "").replace(/\/+$/, "") + "/";
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-source-webdav: fetch required");
  const label = name || base.replace(/^https?:\/\//, "");
  const authHdr = user ? { Authorization: "Basic " + (typeof btoa !== "undefined" ? btoa(`${user}:${password || ""}`) : Buffer.from(`${user}:${password || ""}`).toString("base64")) } : {};
  let files = null;
  async function load() {
    if (files) return files;
    const go = async () => { const r = await doFetch(base, { method: "PROPFIND", headers: { Depth: "1", ...authHdr } }); if (!r.ok && r.status !== 207) throw new Error("webdav " + r.status); return r.text(); };
    const xml = cache ? (await cache.through("dav|" + base, go)).body : await go();
    files = parsePropfind(xml, base);
    return files;
  }
  const norm = (e) => ({
    id: "dav:" + e.href, _href: e.href, kind: "movie", name: e.name.replace(VIDEO, ""), year: null, overview: "", blurb: "",
    posterUrl: null, backdrop: null, runtimeSec: 0, rating: null, genres: [], topics: [], channel: label, quality: 0.78, license: "",
    source: "tmdb", provider: "webdav", kappa: "", holoKappa: "dav:" + e.href, availability: { playable: false, source: null, kappa: "", playSrc: "", type: "" },
  });
  const provider = {
    id: "webdav:" + base, name: label, kind: "webdav", enabled: true, trust: 1,
    async catalogs() { return [{ id: "all", type: "movie", name: label }]; },
    async browse() { return (await load()).map(norm); },
    async search(q) { return (await load()).map(norm).filter((x) => x.name.toLowerCase().includes(String(q).toLowerCase())); },
    async resolve(item) { if (!item._href) return []; return [{ playSrc: item._href, type: /\.webm$/i.test(item._href) ? "video/webm" : "video/mp4", kind: "webdav", httpDirect: true, quality: 1080, provenance: { resolver: label, kind: "webdav", label: "WebDAV · " + label } }]; },
  };
  return provider;
}
export default { createWebDAVProvider, parsePropfind };
if (typeof window !== "undefined") window.HoloSourceWebDAV = { createWebDAVProvider, parsePropfind };
