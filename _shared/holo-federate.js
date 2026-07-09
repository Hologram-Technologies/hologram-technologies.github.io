// _shared/holo-federate.js — Holo Federate (ADR-038): FEDERATED unified search. One query, fanned across
// the open web's sources in PARALLEL, normalised into UOR objects, reconciled across sources, and FUSED
// into one ranked, self-verifying result set — the "one bar, the whole web" moment. This is HoloDiscover
// pointed at the open knowledge graphs, and a deterministic query router realised over them: the
// ranking is math, not a model. No AI, no keys, from any browser.
//
// The fusion is Reciprocal Rank Fusion (Cormack et al., SIGIR 2009) — the standard, deterministic way to
// merge ranked lists from many retrievers: score(d) = Σ_sources 1/(k + rank_source(d)). A result found by
// MORE sources accumulates score and rises — so cross-source AGREEMENT is the signal, and reconciling a
// result to a canonical Wikidata Q-id (the universal join) is what lets two sources agree. Pure +
// isomorphic: the normalizers + fuse are deterministic, so a whole search is content-addressable (the
// sealing lives in holo-federate.mjs / holo-object.js). Untrusted queries are screened by the perimeter.

import { screen } from "./holo-resolve.js";
export { screen };

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const stripHtml = (s) => str(s).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
export const norm = (name) => str(name).toLowerCase().replace(/\s+/g, " ").trim();

// SEARCHERS — each open-data source's SEARCH endpoint + a PURE normalizeList(response) → ranked results.
// (Resolve, in holo-resolve.js, fetches ONE object by id; federate searches MANY and fuses them.)
export const SEARCHERS = {
  wikipedia: {
    source: "Wikipedia (REST search)",
    endpoint: (q, n = 5) => `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=${n}`,
    normalizeList: (r) => (r.pages || []).map((p) => ({ name: str(p.title), description: str(p.description) || stripHtml(p.excerpt), url: p.key ? `https://en.wikipedia.org/wiki/${p.key}` : "", kind: "wikipedia", reconcile: null })),
  },
  wikidata: {
    source: "Wikidata (wbsearchentities)",
    endpoint: (q, n = 5) => `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&format=json&limit=${n}`,
    normalizeList: (r) => (r.search || []).map((s) => ({ name: str(s.label || s.title), description: str(s.description), url: str(s.concepturi || s.url), kind: "wikidata", reconcile: s.id || null })),
  },
  openlibrary: {
    source: "Open Library (search)",
    endpoint: (q, n = 5) => `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${n}&fields=title,author_name,key,first_publish_year`,
    normalizeList: (r) => (r.docs || []).map((d) => ({ name: str(d.title), description: (d.author_name || []).join(", ") + (d.first_publish_year ? ` (${d.first_publish_year})` : ""), url: d.key ? `https://openlibrary.org${d.key}` : "", kind: "openlibrary", reconcile: null })),
  },
  crossref: {
    source: "Crossref (works search)",
    endpoint: (q, n = 5) => `https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=${n}&select=DOI,title,author,container-title,published`,
    normalizeList: (r) => (r.message?.items || []).map((i) => ({ name: str((i.title || [])[0]), description: [(i.author || []).map((a) => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean).slice(0, 3).join(", "), str((i["container-title"] || [])[0])].filter(Boolean).join(" — "), url: i.DOI ? `https://doi.org/${i.DOI}` : "", kind: "crossref", reconcile: null })),
  },
  osm: {
    source: "OpenStreetMap (Nominatim)",
    endpoint: (q, n = 5) => `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=${n}`,
    normalizeList: (r) => (Array.isArray(r) ? r : []).map((p) => ({ name: str(p.name || p.display_name), description: str(p.display_name), url: p.osm_id ? `https://www.openstreetmap.org/${p.osm_type}/${p.osm_id}` : "", kind: "osm", reconcile: null })),
  },
};

// fuse(perSource, {k}) → one ranked result list by Reciprocal Rank Fusion. Results cluster by normalized
// title (deduped WITHIN each source first), each cluster accumulates 1/(k + rank + 1) per source it
// appears in, and a Wikidata Q-id from ANY source enriches the cluster (the universal join). Deterministic
// (stable tiebreak by name), so the fused ranking — and the whole search — is content-addressable.
export function fuse(perSource, { k = 60 } = {}) {
  const clusters = new Map();
  for (const { source, results } of perSource) {
    const seen = new Set(); let rank = 0;
    for (const r of results) {
      if (!r.name) continue;
      const nn = norm(r.name);
      if (seen.has(nn)) continue;                     // within-source title dedup (best rank wins)
      seen.add(nn);
      let c = clusters.get(nn);
      if (!c) { c = { name: r.name, description: str(r.description), url: str(r.url), reconcile: null, sources: [], rrf: 0 }; clusters.set(nn, c); }
      c.rrf += 1 / (k + rank + 1);
      if (!c.sources.includes(source)) c.sources.push(source);
      if (!c.reconcile && r.reconcile) c.reconcile = r.reconcile;   // Q-id enrichment
      if (!c.description && r.description) c.description = str(r.description);
      if (!c.url && r.url) c.url = str(r.url);
      rank++;
    }
  }
  return [...clusters.values()].map((c) => ({ ...c, foundBy: c.sources.length }))
    .sort((a, b) => b.rrf - a.rrf || a.name.localeCompare(b.name));
}

// federate(query, responses, opts) → { query, results, sources, k }. PURE: given the per-source raw
// responses (keyed by source kind), normalize + fuse. The live parallel fetch lives in holo-federate.mjs.
export function federate(query, responses = {}, opts = {}) {
  const perSource = Object.entries(SEARCHERS)
    .filter(([kind]) => responses[kind] != null)
    .map(([kind, s]) => ({ source: s.source, kind, results: s.normalizeList(responses[kind]) }));
  return { query: str(query), k: opts.k ?? 60, sources: perSource.map((p) => p.source), results: fuse(perSource, opts) };
}

if (typeof window !== "undefined") window.HoloFederate = { SEARCHERS, norm, fuse, federate, screen };
