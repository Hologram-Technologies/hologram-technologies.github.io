// holo-stremio.mjs — κ-native client for the open Stremio addon protocol.
//
// An addon is a stateless HTTP server exposing a manifest + resources (catalog/meta/stream), keyed on stable
// ids (IMDb tt…, or "<prefix>:<id>"). We speak that protocol natively, map every item to a CONTENT-κ (the SAME
// title from N addons collapses to ONE node — the cross-garden dedup), verify+cache each response as a κ, and
// classify each stream for Hologram's playback router.
//
// BOUNDARY ENFORCED IN CODE: torrent (infoHash) and debrid stream handles are REFUSED here — never returned as
// a playable handle. Hologram is a sovereign unifier over LEGITIMATE sources (official metadata, public-domain,
// the user's own library, and premium DRM played IN-PLACE via the user's own login), not a piracy client.
//
// Injectables keep it usable in two worlds:
//   fetchJson(url)  — in the shell: the host proxy (SSRF-guarded) + κ-cache; standalone: global fetch.
//   hash(str)       — in the shell: blake3 (kr_blake3, the canonical κ axis); standalone: any stable hash.

const DRM_HOSTS = [
  "netflix.com", "disneyplus.com", "primevideo.com", "amazon.", "hulu.com", "max.com", "hbomax.com",
  "tv.apple.com", "peacocktv.com", "paramountplus.com",
];

export function contentKappa(type, id, hash) {
  // canonical identity → one κ. Same id across addons ⇒ same κ ⇒ deduped node.
  return "k:vod:" + hash(String(type) + ":" + String(id));
}

// Classify a Stremio stream object → Hologram playback handle, or a refusal.
// Returns { mode, ... } where mode ∈ { native, drm-embed, deep-link, EXCLUDED }.
export function routeStream(stream) {
  if (!stream || typeof stream !== "object") return { mode: "EXCLUDED", reason: "empty" };
  // HARD LINE: torrent / debrid sources are not playable in Hologram.
  if (stream.infoHash || stream.fileIdx != null || /(^|\b)(magnet:|real-debrid|alldebrid|premiumize|debrid)/i.test(JSON.stringify(stream)))
    return { mode: "EXCLUDED", reason: "torrent/debrid source — not a legitimate Hologram stream" };

  if (stream.ytId) return { mode: "native", kind: "youtube", ytId: stream.ytId };       // → /sc/vstream, full quality
  const url = stream.url || stream.externalUrl || "";
  if (!url) return { mode: "EXCLUDED", reason: "no url" };
  let host = ""; try { host = new URL(url).hostname.toLowerCase(); } catch {}
  const isDrm = DRM_HOSTS.some((h) => host.includes(h));
  if (isDrm) return { mode: "drm-embed", kind: "drm", url, service: host };             // → in-place libcef + user login
  if (stream.externalUrl && !stream.url) return { mode: "deep-link", url };             // explicit external
  return { mode: "native", kind: "direct", url, behaviorHints: stream.behaviorHints || {} }; // public-domain / Jellyfin → native κ-stream
}

// ── protocol client ──────────────────────────────────────────────────────────────────────────────────
function base(manifestUrl) { return manifestUrl.replace(/\/manifest\.json.*$/, ""); }

export async function loadAddon(manifestUrl, { fetchJson, hash }) {
  const manifest = await fetchJson(manifestUrl);
  return {
    manifestUrl, base: base(manifestUrl), manifest,
    kappa: "k:addon:" + hash(JSON.stringify(manifest)),      // the addon itself is a κ
    id: manifest.id, name: manifest.name, version: manifest.version,
    resources: manifest.resources || [], types: manifest.types || [], idPrefixes: manifest.idPrefixes || [],
    catalogs: manifest.catalogs || [],
  };
}

const has = (addon, res) => addon.resources.some((r) => r === res || (r && r.name === res));

export async function getCatalog(addon, type, id, { fetchJson, hash, extra = "" } = {}) {
  if (!has(addon, "catalog")) return [];
  const url = `${addon.base}/catalog/${type}/${id}${extra ? "/" + extra : ""}.json`;
  const r = await fetchJson(url);
  return (r.metas || []).map((m) => toCard(addon, m, hash));
}

export async function getMeta(addon, type, id, { fetchJson, hash }) {
  if (!has(addon, "meta")) return null;
  const r = await fetchJson(`${addon.base}/meta/${type}/${id}.json`);
  return r.meta ? toCard(addon, r.meta, hash) : null;
}

export async function getStreams(addon, type, id, { fetchJson }) {
  if (!has(addon, "stream")) return [];
  const r = await fetchJson(`${addon.base}/stream/${type}/${id}.json`);
  const routed = (r.streams || []).map((s) => ({ title: s.title || s.name || "", route: routeStream(s) }));
  return routed.filter((s) => s.route.mode !== "EXCLUDED");   // legitimate handles only
}

// Stremio meta/meta-preview → the SAME κ-card envelope the unified omni emits, so it federates natively.
function toCard(addon, m, hash) {
  const kappa = contentKappa(m.type, m.id, hash);
  return {
    ok: true, lane: "vod", kind: "title", kappa,
    id: m.id, type: m.type, name: m.name, poster: m.poster, background: m.background,
    year: m.year || m.releaseInfo, imdbRating: m.imdbRating, genres: m.genres || m.genre,
    description: m.description, runtime: m.runtime, videos: m.videos,
    via: { addon: addon.id, addonKappa: addon.kappa },
  };
}

// Federate many addons' catalogs into ONE deduped κ-graph (same κ ⇒ one node, many source edges).
export function federate(cardLists) {
  const byKappa = new Map();
  for (const list of cardLists) for (const c of list) {
    const ex = byKappa.get(c.kappa);
    if (!ex) byKappa.set(c.kappa, { ...c, sources: [c.via.addon] });
    else if (!ex.sources.includes(c.via.addon)) ex.sources.push(c.via.addon);
  }
  return [...byKappa.values()];
}

export default { loadAddon, getCatalog, getMeta, getStreams, routeStream, contentKappa, federate };
