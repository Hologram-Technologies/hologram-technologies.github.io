// holo-search-tools.js — Holo Search, exposed as AGENT TOOLS (the isomorphic tool layer).
//
// THE THESIS (made concrete for search): an AI agent today asks a search backend a question
// and gets back a ranked list it cannot check — then it hallucinates around it. Holo Search
// flips that: every tool answer carries the searched corpus's κ, every hit carries its own
// re-derivable did:holo, and a `search` answer carries a content address over {index κ, query,
// ranking} that the agent (or anyone) RE-DERIVES — verify the ranking instead of trusting it.
//
// One tool layer, isomorphic: the MCP server (holo-search-mcp.mjs, Node/stdio) exposes it to
// any agent, and the in-OS MCP server (mcp/holo-mcp.mjs) registers the same tools from the
// holospace manifest. The browser page could expose the exact same envelopes. Same substrate.
//
// Faithful to OpenSearch (the engine is _shared/holo-search.js: BM25 + the full Query DSL +
// k-NN); ranked by HoloRank (_shared/holo-rank.js); content-addressed (Law L5). No network.

import { Index, embed, cosine, jcs } from "./holo-search.js";
import { buildGraph, query as rankQuery } from "./holo-rank.js";

const GAIN = 800, SEMW = 0.25, DIMS = 64;     // identical blend constants to search-worker.js
const toRankEdge = (e) => ({ "rel": e.rel, "prov:wasDerivedFrom": e.from, "schema:itemReviewed": e.to,
  "prov:wasAttributedTo": "did:holo:system", "schema:reviewRating": e.weight ?? 1, "dcterms:created": e.at || 0 });
const MAPPINGS = { properties: {
  title: { type: "text", analyzer: "english" }, summary: { type: "text", analyzer: "english" },
  body: { type: "text", analyzer: "english" }, keywords: { type: "text", analyzer: "english" },
  kind: { type: "keyword" }, categories: { type: "keyword" }, developer: { type: "keyword" },
  holorank: { type: "float" }, vec: { type: "knn_vector", dimension: DIMS, from: ["title", "summary", "keywords"] } } };
const DISCLAIMER = "Holo Search ranks the Hologram OS corpus (every holospace, spec, doc and UOR object). Every hit carries a re-derivable did:holo and a `search` result carries a content address over {index κ, query, ranking}; the ranking is DETERMINISTIC, so re-derive it (Law L5) or recompute to confirm — verify, don't trust.";

// makeTools({ corpus }) — build the index + HoloRank graph ONCE, return the agent toolset.
export function makeTools({ corpus }) {
  const env = (o) => ({ ok: true, disclaimer: DISCLAIMER, ...o });
  const fail = (tool, msg) => ({ ok: false, tool, error: String(msg), disclaimer: DISCLAIMER });

  const graph = buildGraph(corpus.edges.map(toRankEdge), {});
  const seed = corpus.docs.filter((d) => d.kind === "holospace").map((d) => d.node);
  const rankScores = rankQuery(graph, seed.length ? seed : corpus.docs.map((d) => d.node)).scores;
  const ix = new Index("holo", { settings: { default_analyzer: "english" }, mappings: MAPPINGS });
  for (const d of corpus.docs) ix.index(d.id, { ...d, keywords: (d.keywords || []).join(" "), categories: d.categories || [], holorank: rankScores.get(d.node) || 0 });

  // the blended query (BM25 × HoloRank × semantic) — identical to the in-browser worker.
  function blended(q, { size = 10, kind = null, category = null } = {}) {
    const filter = []; if (kind) filter.push({ term: { kind } }); if (category) filter.push({ term: { categories: category } });
    const res = ix.search({ size: 60, query: { function_score: {
      query: { bool: { must: [{ multi_match: { query: q, fields: ["title^3", "summary^2", "keywords^2", "body"], operator: "or", fuzziness: "AUTO" } }], ...(filter.length ? { filter } : {}) } },
      script_score: { script: { source: "_score * (1 + ln(1 + " + GAIN + " * doc['holorank'].value))" } }, boost_mode: "replace" } },
      highlight: { fields: { summary: {}, body: {} }, pre_tags: ["["], post_tags: ["]"] } });
    const qv = embed(q, DIMS);
    for (const h of res.hits.hits) { const v = ix.vectors.get("vec")?.get(h._id); const sem = v ? Math.max(0, cosine(qv, v)) : 0; h._sem = sem; h._blended = h._score * (1 + SEMW * sem); }
    res.hits.hits.sort((a, b) => b._blended - a._blended);
    return { res, hits: res.hits.hits.slice(0, size) };
  }
  // content-address a search answer (re-derivable): κ = sha256(jcs({index κ, query, ranking})).
  async function commit(query, hits) {
    const record = { kind: "holo-search-result", algo: "bm25×holorank×semantic", indexKappa: await ix.indexKappa(), query, ranking: hits.map((h) => ({ id: h._id, score: +h._blended.toFixed(6) })) };
    return { kappa: "sha256:" + await ix._sha(jcs(record)), record };
  }
  const view = (h) => ({ did: h._source.node, kind: h._source.kind, title: h._source.title,
    summary: h._source.summary, snippet: (h.highlight?.summary?.[0] || h.highlight?.body?.[0] || h._source.summary || "").slice(0, 240),
    loader: h._source.loader || null, url: h._source.url || null, categories: h._source.categories || [], type: h._source.type || [],
    scores: { bm25: +h._score.toFixed(3), holorank: +(h._source.holorank || 0).toFixed(6), semantic: +(h._sem || 0).toFixed(3), blended: +h._blended.toFixed(3) } });

  const handlers = {
    async index_info() {
      const kinds = {}, cats = {}; for (const d of corpus.docs) { kinds[d.kind] = (kinds[d.kind] || 0) + 1; for (const c of d.categories || []) cats[c] = (cats[c] || 0) + 1; }
      return env({ tool: "index_info", summary: `${corpus.count} objects · ${corpus.edges.length} HoloRank edges`,
        data: { documents: corpus.count, edges: corpus.edges.length, byKind: kinds, categories: cats, corpusKappa: corpus.kappa, indexKappa: await ix.indexKappa() },
        content_address: corpus.kappa, verification: { scheme: "sha256(jcs(corpus))", reproducible: true, how: "re-run tools/scan-index.mjs → same corpus κ (Law L5)" },
        honest: "The corpus is the whole OS, content-addressed; the index κ re-derives from it." });
    },
    async search({ query, size = 10, kind = null, category = null } = {}) {
      if (!query || !String(query).trim()) return fail("search", "query is required");
      const { res, hits } = blended(String(query), { size, kind, category });
      const { kappa, record } = await commit(String(query), hits);
      return env({ tool: "search", summary: `${res.hits.total.value} result(s) for “${query}” (${res.took} ms), ranked by HoloRank`,
        data: { query, total: res.hits.total.value, took: res.took, hits: hits.map((h, i) => ({ rank: i + 1, ...view(h) })),
          facets: { kind: res.aggregations?.kinds?.buckets, category: res.aggregations?.cats?.buckets } },
        content_address: kappa,
        verification: { scheme: "sha256(jcs({indexKappa, query, ranking}))", verified: null, reproducible: true, record, how: "recompute search over the same corpus → same κ; resolve each hit's did with `get` and re-derive it (verify_object, Law L5)." },
        honest: "Ranking is deterministic (BM25 × HoloRank × semantic); re-derive the result κ or recompute to confirm — don't trust it." });
    },
    async query_dsl({ body } = {}) {
      if (!body || typeof body !== "object") return fail("query_dsl", "body (an OpenSearch _search request) is required");
      const res = ix.search(body);
      return env({ tool: "query_dsl", summary: `${res.hits.total.value} hit(s) via raw OpenSearch Query DSL (${res.took} ms)`,
        data: res, verification: { scheme: "OpenSearch _search contract", reproducible: true, how: "the engine is faithful to OpenSearch (BM25 + Query DSL); each hit's _id is a re-derivable did:holo." },
        honest: "Full OpenSearch Query DSL — bool/match/term/range/multi_match/function_score/knn/etc. Each _id is a did:holo." });
    },
    async suggest({ query, size = 6 } = {}) {
      if (!query) return fail("suggest", "query is required");
      const r = ix.search({ size, query: { bool: { should: [
        { match_phrase: { title: { query, slop: 2 } } }, { match: { title: { query, operator: "and", fuzziness: "AUTO", boost: 2 } } },
        { prefix: { title: String(query).toLowerCase() } }, { match: { keywords: { query, fuzziness: "AUTO" } } } ], minimum_should_match: 1 } } });
      const seen = new Set(); const items = r.hits.hits.map((h) => ({ text: h._source.title, kind: h._source.kind, did: h._source.node, loader: h._source.loader || null })).filter((s) => !seen.has(s.text) && seen.add(s.text));
      return env({ tool: "suggest", summary: `${items.length} suggestion(s) for “${query}”`, data: { query, items }, verification: { scheme: "none (type-ahead)" }, honest: "Type-ahead over the index (completion + fuzzy)." });
    },
    async get({ id } = {}) {
      if (!id) return fail("get", "id (a did:holo or document id) is required");
      const doc = ix.get(id); if (!doc.found) return fail("get", "not found: " + id);
      return env({ tool: "get", summary: `${doc._source.kind}: ${doc._source.title}`, data: { id, document: doc._source },
        content_address: id, verification: { scheme: "did:holo (content-derived)", reproducible: true, how: "for a holospace, fetch its loader bytes and re-hash to this did (Law L5)." },
        honest: "The document IS a UOR object addressed by its own content." });
    },
    async analyze({ text, analyzer = "english" } = {}) {
      if (text == null) return fail("analyze", "text is required");
      return env({ tool: "analyze", summary: `analyzer=${analyzer}`, data: ix.analyze({ analyzer, text }), verification: { scheme: "OpenSearch _analyze" }, honest: "Shows the exact analysis chain (tokenizer + filters + Porter stemmer)." });
    },
  };

  const manifest = [
    { name: "holo_search", description: "Search the ENTIRE Hologram OS — every holospace (app), conformance spec, doc and self-verifying UOR object — with one query, ranked by HoloRank (a verifiable PageRank) blended with OpenSearch BM25 + semantic similarity. Returns ranked hits (each with its re-derivable did:holo, a snippet, the app loader, and a score breakdown) plus a content address over {index κ, query, ranking} you can RE-DERIVE (Law L5) instead of trusting. Use this to find apps/specs/docs or to ground an answer about the OS.",
      inputSchema: { type: "object", properties: { query: { type: "string", description: "free-text query, e.g. 'ethereum virtual machine' or 'bitcoin mining'" }, size: { type: "integer", description: "max results (default 10)" }, kind: { type: "string", enum: ["holospace", "spec", "doc", "object"], description: "filter to one kind" }, category: { type: "string", description: "filter to a category facet" } }, required: ["query"], additionalProperties: false } },
    { name: "holo_search_query", description: "Power tool: run a RAW OpenSearch Query DSL _search request against the OS index and get back the faithful OpenSearch response (took, hits.total, hits[], aggregations). Supports the full DSL — bool (must/should/must_not/filter), match/match_phrase/multi_match, term/terms/range/prefix/wildcard/regexp/fuzzy, function_score/script_score, knn, aggregations, highlight, sort, from/size. Every hit _id is a did:holo. For agents that want exact control over relevance, filtering and facets.",
      inputSchema: { type: "object", properties: { body: { type: "object", description: "an OpenSearch _search request body, e.g. {\"query\":{\"bool\":{\"must\":[{\"match\":{\"title\":\"ipfs\"}}],\"filter\":[{\"term\":{\"kind\":\"holospace\"}}]}},\"size\":5,\"aggs\":{\"k\":{\"terms\":{\"field\":\"kind\"}}}}" } }, required: ["body"], additionalProperties: false } },
    { name: "holo_search_suggest", description: "Type-ahead suggestions (completion + fuzzy did-you-mean) for a partial query — fast titles to disambiguate before a full search.",
      inputSchema: { type: "object", properties: { query: { type: "string" }, size: { type: "integer" } }, required: ["query"], additionalProperties: false } },
    { name: "holo_search_get", description: "Fetch one indexed object by its did:holo (or document id) — the full self-verifying UOR record. For a holospace the result includes the loader you can re-hash to the did (Law L5).",
      inputSchema: { type: "object", properties: { id: { type: "string", description: "a did:holo or document id (from a search hit)" } }, required: ["id"], additionalProperties: false } },
    { name: "holo_search_index_info", description: "Describe what is searchable: document + edge counts, the kind/category facets, and the corpus + index content addresses (κ). Call this first to learn the corpus shape.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "holo_search_analyze", description: "Debug the OpenSearch analysis chain — see how text is tokenized + filtered + Porter-stemmed (the english/standard/keyword analyzers).",
      inputSchema: { type: "object", properties: { text: { type: "string" }, analyzer: { type: "string", enum: ["english", "standard", "simple", "keyword", "whitespace"] } }, required: ["text"], additionalProperties: false } },
  ];
  // map the agent-facing tool NAMES (manifest) to the internal handler keys.
  const HANDLER = { holo_search: "search", holo_search_query: "query_dsl", holo_search_suggest: "suggest", holo_search_get: "get", holo_search_index_info: "index_info", holo_search_analyze: "analyze" };
  async function call(name, args = {}) { const h = handlers[HANDLER[name] || name]; if (!h) return fail(name, "unknown tool"); try { return await h(args || {}); } catch (e) { return fail(name, e && e.message || e); } }

  return { manifest, call, handlers, names: manifest.map((t) => t.name), ix, blended, commit };
}

export default makeTools;
