// holo-q-search.mjs — the canonical SEARCH/RETRIEVAL plane: ONE on-device embedder, bound ONCE to the
// search faculties (session-search + skills-hub) on holo-q-mux, so every SEMANTIC search in the OS shares
// the SAME vector space — no app ships its own embedder, no two surfaces mix a real-model document vector
// with a floor query vector. This is the search analogue of holo-q-active (which does the same for the
// generative faculties): a surface asks the mux "give me the search brain", gets the bound embedder when
// one is ready, and an HONEST lexical fallback (the caller's BM25 / substring match) when none is — never
// blocking, never faking, always able to say which path ran (semantic vs lexical). The embedder FACTORY is
// injected (holo-q-embed.autowire in the browser; a fake in the witness) → Node-witnessed, no model load.
//
//   resolveSearch(mux, {faculty})       → the bound embedder provider NOW, or null (→ the caller's lexical search)
//   describeSearch(mux, {faculty})      → the honest badge: "<model> · semantic" | "lexical (no embedder)"
//   searchSemantic(mux, query, items)   → rank items by cosine when an embedder is bound, else mode:"lexical"
//   ensureSearchEmbedder(mux, {autowire}) → bind ONE embedder to BOTH search faculties, once, lazily

export const SEARCH_FACULTIES = ["session-search", "skills-hub"];

// a search provider is READY unless it says otherwise (mirrors holo-q-active's readiness gate): an embedder
// still streaming its κ-disk reports isReady()===false / ready===false, so resolveSearch treats it as not
// yet usable and the surface stays lexical until it's ready. No flag ⇒ ready (back-compat with holo-q-embed).
function ready(p) {
  if (!p) return false;
  if (typeof p.isReady === "function") { try { return !!p.isReady(); } catch (e) { return false; } }
  if (p.ready === false) return false;
  return true;
}
const hasEmbed = (p) => !!(p && typeof p.embed === "function") && ready(p);   // a usable embedder; the main sentinel has no embed
function cosine(a, b) { let d = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) d += a[i] * b[i]; return d; }
function identityId(mux, faculty) { try { const r = mux.resolveModel(faculty); return r && r.id; } catch (e) { return null; } }

// resolveSearch — which embedder answers this search faculty right now (or null → the caller goes lexical).
export function resolveSearch(mux, { faculty = "session-search" } = {}) {
  if (!mux || typeof mux.routeTask !== "function") throw new Error("resolveSearch needs the mux ({ routeTask })");
  const p = mux.routeTask(faculty);
  const embedder = hasEmbed(p) ? p : null;
  return { faculty, embedder, semantic: !!embedder, id: embedder ? (embedder.id || identityId(mux, faculty)) : null };
}

// describeSearch — the honest "how is this searching" badge. semantic when an embedder is bound, lexical
// otherwise (the surface is doing BM25/substring — still useful, just not neural). The user always knows.
export function describeSearch(mux, { faculty = "session-search" } = {}) {
  const r = resolveSearch(mux, { faculty });
  return r.semantic
    ? { mode: "semantic", id: r.id, label: r.id, note: "" }
    : { mode: "lexical", id: null, label: "lexical", note: "no embedder loaded — lexical search" };
}

// searchSemantic — rank {id,text} items by cosine to the query when an embedder is bound; otherwise return
// { mode:"lexical", results:null } so the CALLER runs its own lexical search (one space, never mixed).
// Never throws. Prefers the bound provider's own search()/embedder (its O(1) cache) over the generic loop.
export async function searchSemantic(mux, query, items = [], { faculty = "session-search", k = 10 } = {}) {
  const r = resolveSearch(mux, { faculty });
  if (!r.embedder) return { mode: "lexical", model: null, results: null };
  try {
    const full = r.embedder.embedder || r.embedder;                  // the bound provider may carry the full embedder (search()/cache)
    if (typeof full.search === "function") return { mode: "semantic", model: r.id, results: await full.search(query, items, k) };
    const qv = await r.embedder.embed(query, { kind: "query" });     // asymmetric retrieval: query vs document prompts
    const scored = [];
    for (const it of items) scored.push({ id: it.id, text: it.text, score: cosine(qv, await r.embedder.embed(it.text, { kind: "document" })) });
    return { mode: "semantic", model: r.id, results: scored.sort((a, b) => b.score - a.score).slice(0, k) };
  } catch (e) { return { mode: "lexical", model: null, results: null, error: String((e && e.message) || e) }; }
}

function bindBoth(mux, prov) {
  for (const f of SEARCH_FACULTIES) { const cur = mux.routeTask(f); if (!hasEmbed(cur)) mux.bindSpecialist(f, prov); }
}

// ensureSearchEmbedder(mux, { autowire, fetch }) — bind ONE embedder to BOTH search faculties, once. Uses
// holo-q-embed's autowire (which prefers the unified OS embedder, else the discovered bge-small, else the
// deterministic reference floor) to bind session-search, then binds the SAME provider to skills-hub so skill
// search and recall share one vector space. Lazy + idempotent + never throws: a surface calls it the first
// time it wants semantic search; until it resolves, resolveSearch returns null and the surface stays lexical.
let _ensuring = null;
export async function ensureSearchEmbedder(mux, { autowire = null, fetch } = {}) {
  if (!mux || typeof mux.routeTask !== "function") throw new Error("ensureSearchEmbedder needs the mux");
  const existing = mux.routeTask("session-search");
  if (hasEmbed(existing)) { bindBoth(mux, existing); return { ok: true, id: existing.id || identityId(mux, "session-search"), cached: true }; }
  if (_ensuring) return _ensuring;
  _ensuring = (async () => {
    try {
      if (typeof autowire !== "function") return { ok: false, reason: "no autowire provided — surface stays lexical" };
      const res = await autowire({ mux, fetch });
      const prov = mux.routeTask("session-search");
      if (hasEmbed(prov)) { bindBoth(mux, prov); return { ok: true, id: prov.id || identityId(mux, "session-search"), via: res && res.via }; }
      return { ok: false, reason: "autowire bound nothing usable — surface stays lexical" };
    } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
    finally { _ensuring = null; }
  })();
  return _ensuring;
}

export default { SEARCH_FACULTIES, resolveSearch, describeSearch, searchSemantic, ensureSearchEmbedder };
