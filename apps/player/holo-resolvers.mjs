// holo-resolvers.mjs — sources as an OPEN, federated plugin point (the Gelato/Stremio-addon model, κ-native).
//
// P2 bound a discovered title to whatever was already in the local pool. P4 generalizes that into a REGISTRY
// of resolvers, each answering one question — "given this title, where can I play it?" — and returns ranked
// candidates with provenance. The registry federates them with Reciprocal Rank Fusion (the same robust
// method as HoloRank, ADR-038) weighted by source trust (owned κ > κ-store > linked server > open > addon),
// so the best legal/owned source wins without any single resolver dominating. The catalog brain is permanent;
// sources are swappable. A title with no candidate is a "virtual item" — browsable now, resolved on play.
//
// Honesty: resolvers carry an `enabled` flag and provenance; only legal sources ship enabled, and every
// bound stream tells you where it came from. No infringing indexers are bundled — the user brings sources.
//
// Pure ESM (fetch/registry injected) so Node witnesses the federation exactly.

import { buildIndex, resolve as matchSource, availabilityFrom } from "./holo-availability.mjs";

export const TRUST = { owned: 0, native: 1, kappa: 1, jellyfin: 2, open: 3, live: 4, addon: 5 };
const weight = (kind) => 10 - (TRUST[kind] ?? 6);   // higher trust → higher fusion weight

// Reciprocal Rank Fusion over candidates keyed by their playable handle, each voted by its resolver's
// trust weight and its within-resolver rank. k=60 (the standard constant).
function rrf(candidates, k = 60) {
  const score = new Map();
  for (const c of candidates) {
    const key = c.playSrc || c.kappa || JSON.stringify(c);
    const s = (score.get(key)?.s || 0) + weight(c.kind) / (k + (c.rank ?? 0) + 1);
    score.set(key, { s, c });
  }
  return [...score.values()].sort((a, b) => b.s - a.s).map((x) => x.c);
}

// ── the registry ─────────────────────────────────────────────────────────────────────────────────────────
export function createResolverRegistry() {
  const resolvers = [];
  const register = (r) => { if (r && typeof r.resolve === "function") resolvers.push({ enabled: true, priority: TRUST[r.kind] ?? 6, ...r }); return r; };
  const list = () => resolvers.map(({ id, name, kind, enabled }) => ({ id, name, kind, enabled }));
  const setEnabled = (id, on) => { const r = resolvers.find((x) => x.id === id); if (r) r.enabled = on; };

  // resolve(query) → { best, candidates }. Federates every enabled resolver, fuses with RRF, stamps provenance.
  async function resolve(query) {
    const lists = await Promise.all(resolvers.filter((r) => r.enabled).map(async (r) => {
      try {
        const out = (await r.resolve(query)) || [];
        return out.map((c, i) => ({ ...c, kind: c.kind || r.kind, rank: i, provenance: c.provenance || { resolver: r.name, kind: r.kind, label: r.label || r.name } }));
      } catch { return []; }
    }));
    const candidates = rrf(lists.flat());
    return { best: candidates[0] || null, candidates };
  }
  return { register, list, setEnabled, resolve, _resolvers: resolvers };
}

// ── built-in resolvers ───────────────────────────────────────────────────────────────────────────────────

// Your local library — owned κ-objects, the κ-store, the open/CC catalog, a linked server's already-loaded
// items. Reuses the P2 matcher. getSources() returns the current pool of held items.
export function catalogResolver(getSources) {
  return {
    id: "builtin:catalog", name: "Your library", kind: "open", label: "Your library",
    resolve(query) {
      const idx = buildIndex(getSources ? getSources() : []);
      const s = matchSource({ tmdbId: query.tmdbId, name: query.name, year: query.year }, idx);
      if (!s) return [];
      const a = availabilityFrom(s);
      return [{ playSrc: a.playSrc, type: a.type, kappa: a.kappa, kind: s.source, confidence: 1,
        // carry-overs the player applies to the bound card (and the source id to merge the duplicate away)
        sourceId: s.id, posterUrl: s.posterUrl, backdrop: s.backdrop, runtimeSec: s.runtimeSec, channel: s.channel, page: s.page, live: s.live, embed: s.embed,
        provenance: { resolver: "Your library", kind: s.source, label: s.source === "owned" ? "Owned · κ" : s.source === "native" ? "Your κ-store" : s.source === "open" ? "Open · " + (s.license || "CC") : s.source } }];
    },
  };
}

// A linked Jellyfin/Emby server. getItems() returns the server's already-loaded items (source:"jellyfin",
// normalized by holo-jellyfin). Matches by TMDb id (when the server carries it) else title+year. A server
// URL is a location, not a content κ — so it ranks below owned/κ-store but above the open long tail.
export function jellyfinResolver(getItems, { name = "Jellyfin", enabled = true } = {}) {
  return {
    id: "builtin:jellyfin", name, kind: "jellyfin", enabled, label: name,
    resolve(query) {
      const items = (getItems ? getItems() : []) || [];
      if (!items.length) return [];
      const idx = buildIndex(items);
      const s = matchSource({ tmdbId: query.tmdbId, name: query.name, year: query.year }, idx);
      if (!s) return [];
      return [{ playSrc: s.playSrc, type: s.type, kappa: s.kappa || "", kind: "jellyfin", confidence: 0.9,
        sourceId: s.id, posterUrl: s.posterUrl, backdrop: s.backdrop, runtimeSec: s.runtimeSec, channel: s.channel,
        provenance: { resolver: name, kind: "jellyfin", label: "Server · " + name } }];
    },
  };
}

// A linked Plex server. getItems() returns the user's Plex library items (provider:"plex", each carrying a
// direct-play playSrc). Matches a metadata title by tmdb id / title+year → instantly playable (your own server).
export function plexResolver(getItems, { name = "Plex", enabled = true } = {}) {
  return {
    id: "builtin:plex", name, kind: "plex", enabled, label: name,
    resolve(query) {
      const items = (getItems ? getItems() : []) || [];
      if (!items.length) return [];
      const idx = buildIndex(items);
      const s = matchSource({ tmdbId: query.tmdbId, name: query.name, year: query.year }, idx);
      if (!s || !s.playSrc) return [];
      return [{ playSrc: s.playSrc, type: s.type || "video/mp4", kappa: "", kind: "plex", confidence: 0.9,
        sourceId: s.id, posterUrl: s.posterUrl, backdrop: s.backdrop, runtimeSec: s.runtimeSec, channel: s.channel,
        provenance: { resolver: name, kind: "plex", label: "Server · " + name } }];
    },
  };
}

// A direct URL the user pasted (or a title that already carries one).
export function urlResolver() {
  return { id: "builtin:url", name: "Direct URL", kind: "live", label: "Direct link",
    resolve(query) { return query.url ? [{ playSrc: query.url, type: query.type || "", kind: "live", confidence: 0.5 }] : []; } };
}

// A Stremio-style stream addon: GET {base}/stream/{type}/{id}.json → { streams:[{url,title,...}] }. The id is
// the imdb id (movies) or imdb:season:episode (series). fetch injected. Disabled by default until the user
// adds it — and its provenance is always shown. We do NOT bundle any content addon.
export function addonResolver({ id, name, base, fetch: f, enabled = false }) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  return {
    id: id || "addon:" + base, name: name || "Addon", kind: "addon", enabled, label: "Addon · " + (name || base),
    async resolve(query) {
      if (!doFetch || !query.imdbId) return [];
      const type = query.kind === "series" ? "series" : "movie";
      const sid = type === "series" && query.seasonNumber ? `${query.imdbId}:${query.seasonNumber}:${query.episodeNumber || 1}` : query.imdbId;
      const res = await doFetch(`${String(base).replace(/\/+$/, "")}/stream/${type}/${sid}.json`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.streams || []).map((s) => ({ playSrc: s.url, type: s.type || "", kind: "addon", confidence: 0.6,
        provenance: { resolver: name || "Addon", kind: "addon", label: "Addon · " + (s.title || s.name || name) } }));
    },
  };
}

export default { createResolverRegistry, catalogResolver, jellyfinResolver, plexResolver, urlResolver, addonResolver, TRUST };
if (typeof window !== "undefined") window.HoloResolvers = { createResolverRegistry, catalogResolver, jellyfinResolver, plexResolver, urlResolver, addonResolver };
