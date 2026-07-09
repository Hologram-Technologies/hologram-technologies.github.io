// holo-source.mjs — the ONE abstraction for "where catalogues come from". Every source — a Stremio addon,
// a Jellyfin server, Internet Archive, an M3U playlist, YouTube, the CC catalog — implements the same two
// verbs, so the player never special-cases a source:
//
//   SourceProvider = {
//     id, name, kind, enabled, trust,                 // trust → federation weight (owned>server>open>addon)
//     async catalogs()                                 // [{ id, type, name }] — discovery shelves
//     async browse(catalogId, { search, skip, genre }) // → items[] in the ONE shape (virtual: stream deferred)
//     async resolve(item)                              // → ranked stream candidates [{ playSrc,type,quality,... }]
//     async search?(q)                                 // optional; else browse(firstCatalog,{search})
//   }
//
// createSourceHub() federates them: discover() builds rails across providers, search() merges + dedups by
// id, resolve() delegates to the item's owning provider. Pure (providers inject their own fetch/cache), so
// Node witnesses the federation exactly.

export function createSourceHub() {
  const providers = [];
  const register = (p) => { if (p && typeof p.browse === "function") providers.push({ enabled: true, trust: 5, ...p }); return p; };
  const enabled = () => providers.filter((p) => p.enabled);
  const list = () => providers.map(({ id, name, kind, enabled }) => ({ id, name, kind, enabled }));
  const setEnabled = (id, on) => { const p = providers.find((x) => x.id === id); if (p) p.enabled = on; };

  // a stable identity for dedup across sources (the same film from two providers collapses to one card).
  const idKey = (it) => it.imdbId || (it.tmdbId && "tmdb:" + it.tmdbId) || (String(it.name || "").toLowerCase().trim() + ":" + (it.year || ""));
  const tag = (it, p) => ({ ...it, _sourceId: p.id, channel: it.channel || p.name, provenance: it.provenance || { resolver: p.name, kind: p.kind, label: p.name } });

  // discover() → rails: each enabled provider's catalogs, browsed, normalized, capped. Errors drop a shelf,
  // never the page.
  async function discover({ perCatalog = 24, maxShelves = 16, perProvider = 3 } = {}) {
    const shelves = [];
    for (const p of enabled()) {
      let cats = []; try { cats = (await p.catalogs()) || []; } catch {}
      let n = 0;
      for (const c of cats) {
        if (shelves.length >= maxShelves || n >= perProvider) break;
        let items = []; try { items = (await p.browse(c.id, {})) || []; } catch {}
        items = items.slice(0, perCatalog).map((it) => tag(it, p));
        if (items.length) { shelves.push({ id: p.id + ":" + c.id, title: c.name, source: p.name, items }); n++; }
      }
    }
    return shelves;
  }

  // search() → merged, deduped across all providers.
  async function search(q) {
    const out = [], seen = new Set();
    for (const p of enabled()) {
      let items = [];
      try { items = p.search ? (await p.search(q)) : await (async () => { const c = (await p.catalogs())[0]; return c ? await p.browse(c.id, { search: q }) : []; })(); } catch {}
      for (const it of (items || [])) { const k = idKey(it); if (seen.has(k)) continue; seen.add(k); out.push(tag(it, p)); }
    }
    return out;
  }

  // resolve(item) → { best, candidates }. Delegates to the provider that produced the item; the provider
  // returns its streams already quality-ranked (HTTP-instant first).
  async function resolve(item) {
    const p = providers.find((x) => x.id === item._sourceId);
    if (!p || typeof p.resolve !== "function") return { best: null, candidates: [] };
    let cands = []; try { cands = (await p.resolve(item)) || []; } catch {}
    return { best: cands[0] || null, candidates: cands };
  }

  return { register, list, setEnabled, enabled, discover, search, resolve, idKey, _providers: providers };
}

export default { createSourceHub };
if (typeof window !== "undefined") window.HoloSourceHub = { createSourceHub };
