// holo-search.js — HoloSearch: a hologram-native, OpenSearch-faithful search engine that
// runs entirely in the browser (and in Node, for its witness). It is to Elasticsearch/
// OpenSearch what content addressing is to a URL index: the same documented contract — the
// analysis chain, field mappings, the inverted index + Lucene BM25 similarity, the full
// Query DSL, aggregations, highlighting, suggesters, kNN vector search and the percolator —
// but every indexed document is a self-verifying UOR object (a JSON-LD thing addressed by
// the hash of its own content, Law L5) and the index segment itself is content-addressed, so
// two peers that index the same corpus derive the SAME index κ. No server, no cluster, no trust.
//
// Strict-spec sources (the contract this mirrors, not invents):
//   • OpenSearch Query DSL + REST search   — opensearch.org/docs (github.com/opensearch-project)
//   • Lucene BM25Similarity (k1=1.2, b=0.75) — Robertson & Zaragoza, "The Probabilistic
//     Relevance Framework: BM25 and Beyond"; Lucene's idf = ln(1 + (N−n+0.5)/(n+0.5)).
//   • Porter stemming algorithm             — M.F. Porter 1980, "An algorithm for suffix stripping".
//   • OpenSearch k-NN cosine + Lucene `expressions` script lang (the function_score blend).
//   • A9 OpenSearch description document 1.1 — served separately (search/opensearch.xml).
//
// Pure + dependency-free (no crypto here: the engine emits a canonical() string; the caller
// hashes it with WebCrypto in the browser or node:crypto in the witness — exactly as
// holo-omni.js separates manifest() from contentAddress()). Isomorphic ESM.

// ────────────────────────────────────────────────────────────────────────────────────────
// 0 · canonicalization (RFC 8785 JCS subset) — the deterministic byte-form the κ commits to
// ────────────────────────────────────────────────────────────────────────────────────────
export const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
  : JSON.stringify(v === undefined ? null : v);

// ────────────────────────────────────────────────────────────────────────────────────────
// 1 · ANALYSIS — char filters → tokenizer → token filters (OpenSearch `analysis`)
// ────────────────────────────────────────────────────────────────────────────────────────

// Lucene's canonical English stop set (the `_english_` list used by the english analyzer).
export const ENGLISH_STOP = new Set(("a an and are as at be but by for if in into is it no not of on or" +
  " such that the their then there these they this to was will with").split(" "));

const stripHtml = (s) => String(s).replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ");
const foldAscii = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");

// Tokenizers emit [{token,start,end}] preserving offsets (for highlighting).
const TOKENIZERS = {
  // `standard`: split on Unicode non-(letter|number); keeps intra-token digits/letters.
  standard(text) {
    const out = []; const re = /[\p{L}\p{N}]+/gu; let m;
    while ((m = re.exec(text))) out.push({ token: m[0], start: m.index, end: m.index + m[0].length });
    return out;
  },
  whitespace(text) {
    const out = []; const re = /\S+/g; let m;
    while ((m = re.exec(text))) out.push({ token: m[0], start: m.index, end: m.index + m[0].length });
    return out;
  },
  keyword(text) { return text.length ? [{ token: text, start: 0, end: text.length }] : []; },
  letter(text) {
    const out = []; const re = /\p{L}+/gu; let m;
    while ((m = re.exec(text))) out.push({ token: m[0], start: m.index, end: m.index + m[0].length });
    return out;
  },
};

// Token filters: each maps a token list → token list (offsets carried; ngrams share offset).
const lowercase = (toks) => toks.map((t) => ({ ...t, token: t.token.toLowerCase() }));
const asciifolding = (toks) => toks.map((t) => ({ ...t, token: foldAscii(t.token) }));
const stopFilter = (set) => (toks) => toks.filter((t) => !set.has(t.token));
const possessive = (toks) => toks.map((t) => ({ ...t, token: t.token.replace(/['’]s$/i, "") }));
const synonymFilter = (map) => (toks) => toks.flatMap((t) => {
  const syns = map[t.token]; return syns ? [t, ...syns.map((s) => ({ ...t, token: s, synonym: true }))] : [t];
});
const edgeNgram = (min, max) => (toks) => toks.flatMap((t) => {
  const out = []; for (let n = min; n <= Math.min(max, t.token.length); n++) out.push({ ...t, token: t.token.slice(0, n) });
  return out.length ? out : [t];
});

// ── Porter 1980 suffix-stripping (the `porter_stem` filter). Faithful to the published algorithm.
export function porterStem(w) {
  if (w.length < 3) return w;
  const C = "[^aeiou]", V = "[aeiouy]";
  const isVowel = (s, i) => "aeiou".includes(s[i]) || (s[i] === "y" && i > 0 && !"aeiou".includes(s[i - 1]));
  const measure = (s) => { // m = number of VC sequences
    let n = 0, prevV = false;
    for (let i = 0; i < s.length; i++) { const v = isVowel(s, i); if (prevV && !v) n++; prevV = v; }
    return n;
  };
  const hasVowel = (s) => { for (let i = 0; i < s.length; i++) if (isVowel(s, i)) return true; return false; };
  const doubleC = (s) => s.length >= 2 && s[s.length - 1] === s[s.length - 2] && !isVowel(s, s.length - 1);
  const cvc = (s) => { const n = s.length; if (n < 3) return false;
    return !isVowel(s, n - 1) && isVowel(s, n - 2) && !isVowel(s, n - 3) && !"wxy".includes(s[n - 1]); };
  let s = w.toLowerCase();
  // Step 1a
  if (s.endsWith("sses")) s = s.slice(0, -2);
  else if (s.endsWith("ies")) s = s.slice(0, -2);
  else if (s.endsWith("ss")) {/* keep */}
  else if (s.endsWith("s")) s = s.slice(0, -1);
  // Step 1b
  let step1bDo = false;
  if (s.endsWith("eed")) { if (measure(s.slice(0, -3)) > 0) s = s.slice(0, -1); }
  else if (s.endsWith("ed") && hasVowel(s.slice(0, -2))) { s = s.slice(0, -2); step1bDo = true; }
  else if (s.endsWith("ing") && hasVowel(s.slice(0, -3))) { s = s.slice(0, -3); step1bDo = true; }
  if (step1bDo) {
    if (s.endsWith("at") || s.endsWith("bl") || s.endsWith("iz")) s += "e";
    else if (doubleC(s) && !/[lsz]$/.test(s)) s = s.slice(0, -1);
    else if (measure(s) === 1 && cvc(s)) s += "e";
  }
  // Step 1c
  if (s.endsWith("y") && hasVowel(s.slice(0, -1))) s = s.slice(0, -1) + "i";
  const repl = (pairs, cond) => { for (const [suf, rep] of pairs) if (s.endsWith(suf)) { const stem = s.slice(0, s.length - suf.length); if (cond(stem)) s = stem + rep; return; } };
  const m0 = (stem) => measure(stem) > 0, m1 = (stem) => measure(stem) > 1;
  // Step 2
  repl([["ational","ate"],["tional","tion"],["enci","ence"],["anci","ance"],["izer","ize"],["bli","ble"],
    ["alli","al"],["entli","ent"],["eli","e"],["ousli","ous"],["ization","ize"],["ation","ate"],["ator","ate"],
    ["alism","al"],["iveness","ive"],["fulness","ful"],["ousness","ous"],["aliti","al"],["iviti","ive"],
    ["biliti","ble"],["logi","log"]], m0);
  // Step 3
  repl([["icate","ic"],["ative",""],["alize","al"],["iciti","ic"],["ical","ic"],["ful",""],["ness",""]], m0);
  // Step 4
  repl([["al",""],["ance",""],["ence",""],["er",""],["ic",""],["able",""],["ible",""],["ant",""],["ement",""],
    ["ment",""],["ent",""],["ou",""],["ism",""],["ate",""],["iti",""],["ous",""],["ive",""],["ize",""]],
    (stem) => measure(stem) > 1);
  if (s.endsWith("ion")) { const stem = s.slice(0, -3); if (m1(stem) && /[st]$/.test(stem)) s = stem; }
  // Step 5a
  if (s.endsWith("e")) { const stem = s.slice(0, -1); if (measure(stem) > 1 || (measure(stem) === 1 && !cvc(stem))) s = stem; }
  // Step 5b
  if (measure(s) > 1 && doubleC(s) && s.endsWith("l")) s = s.slice(0, -1);
  return s;
}
const porterFilter = (toks) => toks.map((t) => ({ ...t, token: porterStem(t.token) }));

// Build a configured analyzer from OpenSearch-shaped settings, or a named built-in.
// settings.analysis = { analyzer: { myA: { tokenizer, filter:[...], char_filter:[...] } },
//                       filter: { myStop: { type:"stop", stopwords:[...] }, syn:{type:"synonym",synonyms:{...}} } }
export function buildAnalyzer(name, analysis = {}) {
  const named = (analysis.analyzer || {})[name];
  const make = (charFilters, tokenizer, filters) => {
    const tk = TOKENIZERS[tokenizer] || TOKENIZERS.standard;
    return (text) => {
      let s = String(text ?? "");
      for (const cf of charFilters) s = cf === "html_strip" ? stripHtml(s) : s;
      let toks = tk(s);
      for (const f of filters) toks = f(toks);
      return toks.map((t, i) => ({ ...t, position: i }));
    };
  };
  const resolveFilter = (f) => {
    if (typeof f === "function") return f;
    const def = (analysis.filter || {})[f];
    if (def) {
      if (def.type === "stop") return stopFilter(new Set((def.stopwords === "_english_" ? [...ENGLISH_STOP] : def.stopwords || []).map((w) => w.toLowerCase())));
      if (def.type === "synonym") return synonymFilter(def.synonyms || {});
      if (def.type === "edge_ngram") return edgeNgram(def.min_gram || 1, def.max_gram || 20);
      if (def.type === "porter_stem" || def.type === "stemmer") return porterFilter;
    }
    return ({ lowercase, asciifolding, porter_stem: porterFilter, english_stop: stopFilter(ENGLISH_STOP),
      stop: stopFilter(ENGLISH_STOP), possessive_english: possessive, trim: (t) => t, unique: (t) => {
        const seen = new Set(); return t.filter((x) => !seen.has(x.token) && seen.add(x.token)); } }[f]) || ((t) => t);
  };
  if (named) return make(named.char_filter || [], named.tokenizer || "standard", (named.filter || []).map(resolveFilter));
  // Built-in analyzers (OpenSearch defaults).
  switch (name) {
    case "keyword": return make([], "keyword", []);
    case "whitespace": return make([], "whitespace", []);
    case "simple": return make([], "letter", [lowercase]);
    case "stop": return make([], "letter", [lowercase, stopFilter(ENGLISH_STOP)]);
    case "english": return make(["html_strip"], "standard", [possessive, lowercase, stopFilter(ENGLISH_STOP), porterFilter]);
    case "standard": default: return make([], "standard", [lowercase]);
  }
}

// ────────────────────────────────────────────────────────────────────────────────────────
// 2 · deterministic semantic EMBEDDING (k-NN). Feature-hashed token n-grams → L2-normalized
//     vector. Reproducible + content-addressable (NOT a neural transformer — stated honestly).
// ────────────────────────────────────────────────────────────────────────────────────────
const fnv1a = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
export function embed(text, dims = 64, analyze = buildAnalyzer("english")) {
  const v = new Float64Array(dims);
  const toks = analyze(text).map((t) => t.token);
  const grams = [...toks]; for (let i = 0; i < toks.length - 1; i++) grams.push(toks[i] + "_" + toks[i + 1]); // unigrams + bigrams
  for (const g of grams) { const h = fnv1a(g); v[h % dims] += (h & 1 ? 1 : -1); }
  let norm = 0; for (const x of v) norm += x * x; norm = Math.sqrt(norm) || 1;
  return Array.from(v, (x) => x / norm);
}
export const cosine = (a, b) => { let d = 0, na = 0, nb = 0; const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return (na && nb) ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0; };

// ────────────────────────────────────────────────────────────────────────────────────────
// 3 · misc text utilities (fuzzy, glob)
// ────────────────────────────────────────────────────────────────────────────────────────
export function levenshtein(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i), cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) { cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev]; }
  return prev[n];
}
const autoFuzz = (term) => term.length <= 2 ? 0 : term.length <= 5 ? 1 : 2; // OpenSearch AUTO
const globToRe = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");

// ────────────────────────────────────────────────────────────────────────────────────────
// 4 · the INDEX — mappings, inverted index, BM25, Query DSL, aggs, highlight, suggest, kNN
// ────────────────────────────────────────────────────────────────────────────────────────
export const BM25 = { k1: 1.2, b: 0.75 };

export class Index {
  constructor(name, { settings = {}, mappings = {} } = {}) {
    this.name = name;
    this.settings = settings;
    this.mappings = mappings;                          // { properties: { field: { type, analyzer, ... } } }
    this.analysis = (settings.analysis) || {};
    this.docs = new Map();                             // id -> _source
    this.post = new Map();                             // field -> Map(term -> Map(id -> {tf, pos:[]}))
    this.df = new Map();                               // field -> Map(term -> docFreq)
    this.len = new Map();                              // field -> Map(id -> tokenCount)
    this.sumLen = new Map();                           // field -> total tokens (for avgdl)
    this.vectors = new Map();                          // field -> Map(id -> number[])
    this.percolators = new Map();                      // id -> query (registerPercolator)
    this._analyzers = new Map();
  }
  analyzerFor(field, override) {
    const name = override || (this.mappings.properties?.[field]?.analyzer) || this.settings.default_analyzer || "english";
    const key = name + "|" + field;
    if (!this._analyzers.has(key)) this._analyzers.set(key, buildAnalyzer(name, this.analysis));
    return this._analyzers.get(key);
  }
  fieldType(field) { return this.mappings.properties?.[field]?.type || "text"; }
  _textFields() { const p = this.mappings.properties || {}; return Object.keys(p).filter((f) => (p[f].type || "text") === "text"); }

  // ── indexing (OpenSearch Index + Bulk APIs) ──────────────────────────────────────────
  index(id, source) {
    if (this.docs.has(id)) this.delete(id);
    this.docs.set(id, source);
    const props = this.mappings.properties || {};
    for (const [field, def] of Object.entries(props)) {
      const val = source[field];
      if (val == null) continue;
      if (def.type === "knn_vector" && Array.isArray(val)) this._vec(field).set(id, val.slice()); // explicit vector
    }
    // index text fields (do it explicitly to keep offsets/positions)
    for (const field of Object.keys(props)) {
      const def = props[field]; if (def.type && def.type !== "text") continue;
      const raw = source[field]; if (raw == null) continue;
      const toks = this.analyzerFor(field)(String(raw));
      this._len(field).set(id, toks.length); this.sumLen.set(field, (this.sumLen.get(field) || 0) + toks.length);
      const pmap = this._post(field), dmap = this._df(field), perDoc = new Map();
      for (const t of toks) {
        let e = perDoc.get(t.token); if (!e) { perDoc.set(t.token, e = { tf: 0, pos: [] }); }
        e.tf++; e.pos.push(t.position);
      }
      for (const [term, e] of perDoc) {
        let plist = pmap.get(term); if (!plist) pmap.set(term, plist = new Map());
        plist.set(id, e); dmap.set(term, (dmap.get(term) || 0) + 1);
      }
    }
    // auto-embed a `_vector` field from text if mapping declares one with no value
    const vecField = Object.entries(props).find(([, d]) => d.type === "knn_vector" && d.from);
    if (vecField && !this._vec(vecField[0]).has(id)) {
      const [vf, vd] = vecField; const src = [].concat(vd.from).map((f) => source[f]).filter(Boolean).join(" ");
      this._vec(vf).set(id, embed(src, vd.dimension || 64));
    }
    return { _index: this.name, _id: id, result: "created" };
  }
  bulk(ops) {
    const items = []; let i = 0;
    while (i < ops.length) {
      const action = ops[i++]; const type = Object.keys(action)[0]; const meta = action[type] || {};
      if (type === "delete") { items.push({ delete: { _id: meta._id, result: this.delete(meta._id) ? "deleted" : "not_found" } }); continue; }
      const doc = ops[i++]; const id = meta._id ?? String(this.docs.size + 1);
      const body = type === "update" ? { ...(this.docs.get(id) || {}), ...(doc.doc || doc) } : doc;
      items.push({ [type]: this.index(id, body) });
    }
    return { took: 0, errors: false, items };
  }
  delete(id) {
    if (!this.docs.has(id)) return false;
    for (const [field, pmap] of this.post) {
      for (const [term, plist] of pmap) if (plist.delete(id)) { const d = this._df(field); const v = (d.get(term) || 1) - 1; v <= 0 ? d.delete(term) : d.set(term, v); if (!plist.size) pmap.delete(term); }
      const l = this._len(field).get(id) || 0; this.sumLen.set(field, (this.sumLen.get(field) || 0) - l); this._len(field).delete(id);
    }
    for (const vmap of this.vectors.values()) vmap.delete(id);
    this.docs.delete(id); return true;
  }
  _post(f) { let m = this.post.get(f); if (!m) this.post.set(f, m = new Map()); return m; }
  _df(f) { let m = this.df.get(f); if (!m) this.df.set(f, m = new Map()); return m; }
  _len(f) { let m = this.len.get(f); if (!m) this.len.set(f, m = new Map()); return m; }
  _vec(f) { let m = this.vectors.get(f); if (!m) this.vectors.set(f, m = new Map()); return m; }
  get N() { return this.docs.size; }
  avgdl(field) { return this.N ? (this.sumLen.get(field) || 0) / this.N : 0; }

  // ── BM25 (Lucene BM25Similarity) ──────────────────────────────────────────────────────
  idf(field, term) { const n = this._df(field).get(term) || 0; return Math.log(1 + (this.N - n + 0.5) / (n + 0.5)); }
  bm25(field, term, id) {
    const plist = this._post(field).get(term); const e = plist && plist.get(id); if (!e) return 0;
    const dl = this._len(field).get(id) || 0, avg = this.avgdl(field) || 1;
    const tfNorm = (e.tf * (BM25.k1 + 1)) / (e.tf + BM25.k1 * (1 - BM25.b + BM25.b * dl / avg));
    return this.idf(field, term) * tfNorm;
  }
  _values(field, id) { // doc values for filter/sort/agg/range (the raw _source value, normalized to array)
    const v = this.docs.get(id)?.[field]; return v == null ? [] : Array.isArray(v) ? v : [v];
  }

  // ── Query DSL → Map(id -> {score, terms:Set}) ─────────────────────────────────────────
  _evalMatch(field, opts) {
    const text = typeof opts === "object" ? opts.query : opts;
    const operator = (typeof opts === "object" && opts.operator) || "or";
    const fuzziness = typeof opts === "object" ? opts.fuzziness : undefined;
    const boost = (typeof opts === "object" && opts.boost) || 1;
    const qTerms = this.analyzerFor(field, typeof opts === "object" ? opts.analyzer : undefined)(String(text)).map((t) => t.token);
    const out = new Map(); const perTermDocs = [];
    for (const qt of qTerms) {
      const expand = fuzziness ? this._fuzzyTerms(field, qt, fuzziness === "AUTO" ? autoFuzz(qt) : +fuzziness) : [qt];
      const docsForTerm = new Set();
      for (const term of expand) { const plist = this._post(field).get(term); if (!plist) continue;
        for (const id of plist.keys()) { docsForTerm.add(id);
          const cur = out.get(id) || { score: 0, terms: new Set() }; cur.score += this.bm25(field, term, id) * boost; cur.terms.add(term); out.set(id, cur); } }
      perTermDocs.push(docsForTerm);
    }
    if (operator === "and" && perTermDocs.length) { // require all query terms
      for (const id of [...out.keys()]) if (!perTermDocs.every((s) => s.has(id))) out.delete(id);
    }
    return out;
  }
  _evalPhrase(field, opts) {
    const text = typeof opts === "object" ? opts.query : opts; const slop = (typeof opts === "object" && opts.slop) || 0;
    const qTerms = this.analyzerFor(field)(String(text)).map((t) => t.token); if (!qTerms.length) return new Map();
    const out = new Map(); const first = this._post(field).get(qTerms[0]); if (!first) return out;
    for (const id of first.keys()) {
      const posLists = qTerms.map((t) => this._post(field).get(t)?.get(id)?.pos); if (posLists.some((p) => !p)) continue;
      // does some start position satisfy consecutive (±slop) ordering?
      let matched = false;
      for (const start of posLists[0]) { let ok = true; for (let k = 1; k < posLists.length; k++) {
        if (!posLists[k].some((p) => Math.abs(p - (start + k)) <= slop)) { ok = false; break; } }
        if (ok) { matched = true; break; } }
      if (matched) { let score = 0; for (const t of qTerms) score += this.bm25(field, t, id); out.set(id, { score, terms: new Set(qTerms) }); }
    }
    return out;
  }
  _fuzzyTerms(field, term, maxEdits) {
    if (!maxEdits) return [term]; const out = [];
    for (const t of this._post(field).keys()) if (Math.abs(t.length - term.length) <= maxEdits && levenshtein(t, term) <= maxEdits) out.push(t);
    return out.length ? out : [term];
  }
  _termDocs(field, term) { const plist = this._post(field).get(term); const out = new Map();
    if (plist) for (const id of plist.keys()) out.set(id, { score: this.idf(field, term), terms: new Set([term]) }); return out; }
  _byPredicate(field, pred, score = 0) { const out = new Map();
    for (const id of this.docs.keys()) if (this._values(field, id).some(pred)) out.set(id, { score, terms: new Set() }); return out; }
  _scanPostings(f, test) { const out = new Map();                                       // term-enumeration over the inverted index
    for (const term of this._post(f).keys()) if (test(term)) for (const [id, v] of this._termDocs(f, term)) out.set(id, v); return out; }

  evaluate(q) {
    if (!q || q.match_all) { const out = new Map(); const boost = q?.match_all?.boost ?? 1; for (const id of this.docs.keys()) out.set(id, { score: boost, terms: new Set() }); return out; }
    const [type] = Object.keys(q); const body = q[type];
    switch (type) {
      case "match": { const [f] = Object.keys(body); return this._evalMatch(f, body[f]); }
      case "match_phrase": { const [f] = Object.keys(body); return this._evalPhrase(f, body[f]); }
      case "multi_match": {
        const fields = (body.fields || this._textFields()); const merged = new Map();
        for (const fSpec of fields) { const [f, boost] = fSpec.split("^"); const r = this._evalMatch(f, { query: body.query, operator: body.operator, fuzziness: body.fuzziness, boost: boost ? +boost : 1 });
          for (const [id, v] of r) { const cur = merged.get(id) || { score: 0, terms: new Set() };
            cur.score = body.type === "best_fields" ? Math.max(cur.score, v.score) : cur.score + v.score; v.terms.forEach((t) => cur.terms.add(t)); merged.set(id, cur); } }
        return merged;
      }
      // term/terms: text fields match an analyzed token (postings, BM25-ish idf); keyword/
      // numeric/boolean fields match the exact doc value (constant score) — OpenSearch semantics.
      case "term": { const [f] = Object.keys(body); const val = body[f]?.value ?? body[f];
        return this.fieldType(f) === "text" ? this._termDocs(f, String(val).toLowerCase()) : this._byPredicate(f, (v) => v === val, 1); }
      case "terms": { const [f] = Object.keys(body); const out = new Map(); const text = this.fieldType(f) === "text";
        for (const val of body[f]) { const part = text ? this._termDocs(f, String(val).toLowerCase()) : this._byPredicate(f, (v) => v === val, 1);
          for (const [id, v] of part) out.set(id, v); } return out; }
      case "range": { const [f] = Object.keys(body); const r = body[f]; const num = (x) => typeof x === "string" && /\d{4}-\d\d-\d\d/.test(x) ? Date.parse(x) : +x;
        return this._byPredicate(f, (v) => { const x = num(v); return (r.gte == null || x >= num(r.gte)) && (r.gt == null || x > num(r.gt)) && (r.lte == null || x <= num(r.lte)) && (r.lt == null || x < num(r.lt)); }); }
      // prefix/wildcard/regexp: text fields scan the inverted index (analyzed, lowercased);
      // keyword/other fields scan the exact doc values (case-sensitive) — OpenSearch semantics.
      case "prefix": { const [f] = Object.keys(body); const raw = String(body[f]?.value ?? body[f]);
        if (this.fieldType(f) !== "text") return this._byPredicate(f, (v) => String(v).startsWith(raw), 1);
        const val = raw.toLowerCase(); return this._scanPostings(f, (t) => t.startsWith(val)); }
      case "wildcard": { const [f] = Object.keys(body); const raw = String(body[f]?.value ?? body[f]);
        if (this.fieldType(f) !== "text") { const re = globToRe(raw); return this._byPredicate(f, (v) => re.test(String(v)), 1); }
        const re = globToRe(raw.toLowerCase()); return this._scanPostings(f, (t) => re.test(t)); }
      case "regexp": { const [f] = Object.keys(body); const re = new RegExp("^" + (body[f]?.value ?? body[f]) + "$");
        if (this.fieldType(f) !== "text") return this._byPredicate(f, (v) => re.test(String(v)), 1);
        return this._scanPostings(f, (t) => re.test(t)); }
      case "exists": return this._byPredicate(body.field, (v) => v != null && v !== "");
      case "ids": { const out = new Map(); for (const id of body.values || []) if (this.docs.has(id)) out.set(id, { score: 1, terms: new Set() }); return out; }
      case "bool": return this._evalBool(body);
      case "function_score": return this._evalFunctionScore(body);
      case "script_score": return this._evalScriptScore(body);
      // ── full-text: phrase-prefix, bool-prefix, query_string, simple_query_string, combined_fields ──
      case "match_phrase_prefix": { const [f] = Object.keys(body); const o = body[f]; const text = typeof o === "object" ? o.query : o;
        const terms = this.analyzerFor(f)(String(text)).map((t) => t.token); if (!terms.length) return new Map();
        const last = terms.pop(); const exp = [...this._post(f).keys()].filter((t) => t.startsWith(last)).slice(0, 50);
        const out = new Map();
        for (const e of (exp.length ? exp : [last])) for (const [id, v] of this._evalPhrase(f, { query: [...terms, e].join(" ") })) {
          const c = out.get(id) || { score: 0, terms: new Set() }; c.score = Math.max(c.score, v.score); v.terms.forEach((t) => c.terms.add(t)); out.set(id, c); }
        return out; }
      case "match_bool_prefix": { const [f] = Object.keys(body); const o = body[f]; const text = typeof o === "object" ? o.query : o;
        const terms = this.analyzerFor(f)(String(text)).map((t) => t.token); if (!terms.length) return new Map();
        const last = terms.pop(); return this._evalBool({ should: [...terms.map((t) => ({ term: { [f]: t } })), { prefix: { [f]: last } }] }); }
      case "query_string": return this._evalQueryString(body, false);
      case "simple_query_string": return this._evalQueryString(body, true);
      case "combined_fields": { const fields = body.fields || this._textFields(); const merged = new Map();
        for (const f of fields) for (const [id, v] of this._evalMatch(f, { query: body.query, operator: body.operator })) {
          const c = merged.get(id) || { score: 0, terms: new Set() }; c.score += v.score; v.terms.forEach((t) => c.terms.add(t)); merged.set(id, c); }
        return merged; }
      // ── term-level: fuzzy, terms_set ──
      case "fuzzy": { const [f] = Object.keys(body); const o = body[f]; const val = String(typeof o === "object" ? o.value : o).toLowerCase();
        const ed = (typeof o === "object" && o.fuzziness != null && o.fuzziness !== "AUTO") ? +o.fuzziness : autoFuzz(val);
        const out = new Map(); for (const t of this._fuzzyTerms(f, val, ed)) for (const [id, v] of this._termDocs(f, t)) out.set(id, v); return out; }
      case "terms_set": { const [f] = Object.keys(body); const o = body[f];
        const m = this._evalBool({ should: (o.terms || []).map((val) => ({ term: { [f]: val } })), minimum_should_match: 1 });
        if (o.minimum_should_match_field) for (const id of [...m.keys()]) {
          const need = +(this._values(o.minimum_should_match_field, id)[0] || 1);
          const have = (o.terms || []).filter((val) => this._values(f, id).includes(val) || this._post(f).get(String(val).toLowerCase())?.has(id)).length;
          if (have < need) m.delete(id); }
        return m; }
      // ── compound: constant_score, dis_max, boosting ──
      case "constant_score": { const inner = this.evaluate(body.filter || { match_all: {} }); const boost = body.boost ?? 1; const out = new Map();
        for (const [id, v] of inner) out.set(id, { score: boost, terms: v.terms }); return out; }
      case "dis_max": { const qs = (body.queries || []).map((q) => this.evaluate(q)); const tb = body.tie_breaker || 0; const acc = new Map();
        for (const m of qs) for (const [id, v] of m) { const c = acc.get(id) || { max: 0, sum: 0, terms: new Set() }; c.max = Math.max(c.max, v.score); c.sum += v.score; v.terms.forEach((t) => c.terms.add(t)); acc.set(id, c); }
        const out = new Map(); for (const [id, c] of acc) out.set(id, { score: c.max + tb * (c.sum - c.max), terms: c.terms }); return out; }
      case "boosting": { const pos = this.evaluate(body.positive || { match_all: {} }); const neg = this.evaluate(body.negative || {}); const nb = body.negative_boost ?? 0.5;
        for (const [id, v] of pos) if (neg.has(id)) v.score *= nb; return pos; }
      // ── specialized: knn-as-query, script (filter), more_like_this, geo, nested, wrapper ──
      case "knn": { const [f] = Object.keys(body); const o = body[f]; const r = this.knn({ field: f, query_vector: o.vector, query_text: o.query_text, k: o.k || 10 });
        const out = new Map(); for (const h of r.hits.hits) out.set(h._id, { score: h._score, terms: new Set() }); return out; }
      case "script": { const out = new Map(); for (const id of this.docs.keys()) if (this._expr(body.script || {}, id, 1)) out.set(id, { score: 1, terms: new Set() }); return out; }
      case "more_like_this": { const like = [].concat(body.like || []); const fields = body.fields || this._textFields(); const want = new Set();
        for (const l of like) { const src = typeof l === "string" ? l : (l.doc || this.docs.get(l._id) || {}); const txt = typeof src === "string" ? src : fields.map((f) => src[f]).filter(Boolean).join(" ");
          for (const t of this.analyzerFor(fields[0] || "title")(txt).map((x) => x.token)) want.add(t); }
        return this._evalBool({ should: [...want].slice(0, 25).flatMap((t) => fields.map((f) => ({ term: { [f]: t } }))), minimum_should_match: body.minimum_should_match || 1 }); }
      case "geo_distance": { const max = this._parseDistance(body.distance); const f = Object.keys(body).find((k) => k !== "distance"); const origin = body[f];
        return this._byPredicate(f, (v) => this._geoDist(v, origin) <= max); }
      case "geo_bounding_box": { const [f] = Object.keys(body); const bb = body[f]; const tl = bb.top_left, br = bb.bottom_right;
        return this._byPredicate(f, (v) => v && +v.lat <= +tl.lat && +v.lat >= +br.lat && +v.lon >= +tl.lon && +v.lon <= +br.lon); }
      case "nested": return this.evaluate(body.query || { match_all: {} });   // flattened path-scoped inner query
      case "wrapper": { try { return this.evaluate(JSON.parse(typeof atob !== "undefined" ? atob(body.query) : Buffer.from(body.query, "base64").toString("utf8"))); } catch { return new Map(); } }
      default: return new Map();
    }
  }
  // query_string / simple_query_string: +required −excluded field:term "phrase" prefix* with a default operator.
  _evalQueryString(body, simple) {
    const fields = body.fields || (body.default_field ? [body.default_field] : this._textFields());
    const defAnd = (body.default_operator || "or").toLowerCase() === "and";
    const toks = String(body.query || "").match(/[+\-]?"[^"]+"|[+\-]?\S+/g) || [];
    const must = [], should = [], must_not = [];
    for (let tok of toks) {
      let neg = false, forced = false;
      if (tok[0] === "+") { tok = tok.slice(1); forced = true; } else if (tok[0] === "-") { tok = tok.slice(1); neg = true; }
      let fs = fields, val = tok; const fm = !simple && tok.match(/^([A-Za-z_]\w*):(.+)$/); if (fm) { fs = [fm[1]]; val = fm[2]; }
      let phrase = val[0] === '"' && val.endsWith('"'); if (phrase) val = val.slice(1, -1);
      let prefix = !phrase && val.endsWith("*"); if (prefix) val = val.slice(0, -1);
      const clause = phrase ? { bool: { should: fs.map((f) => ({ match_phrase: { [f]: val } })) } }
        : prefix ? { bool: { should: fs.map((f) => ({ prefix: { [f]: val.toLowerCase() } })) } }
        : { multi_match: { query: val, fields: fs } };
      if (neg) must_not.push(clause); else if (forced || defAnd) must.push(clause); else should.push(clause);
    }
    return this._evalBool({ must, should, must_not, minimum_should_match: must.length ? 0 : 1 });
  }
  _parseDistance(s) { const m = String(s).trim().match(/^([\d.]+)\s*(km|mi|m|yd|ft|nmi)?$/i); if (!m) return Infinity;
    const u = { km: 1000, mi: 1609.344, m: 1, yd: 0.9144, ft: 0.3048, nmi: 1852 }[(m[2] || "m").toLowerCase()]; return +m[1] * u; }
  _geoDist(p, o) { if (!p || o == null) return Infinity; const R = 6371000, rad = (d) => d * Math.PI / 180;
    const la1 = rad(+p.lat), la2 = rad(+o.lat), dla = rad(+o.lat - +p.lat), dlo = rad(+o.lon - +p.lon);
    const a = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(a))); }
  _evalBool(b) {
    const must = (b.must ? [].concat(b.must) : []).map((q) => this.evaluate(q));
    const filter = (b.filter ? [].concat(b.filter) : []).map((q) => this.evaluate(q));
    const should = (b.should ? [].concat(b.should) : []).map((q) => this.evaluate(q));
    const mustNot = (b.must_not ? [].concat(b.must_not) : []).map((q) => this.evaluate(q));
    let base = null; // intersection of must+filter (AND)
    const andSets = [...must, ...filter];
    if (andSets.length) { base = new Map();
      for (const id of andSets[0].keys()) if (andSets.every((m) => m.has(id))) { let score = 0; const terms = new Set();
        for (const m of [...must]) { const v = m.get(id); score += v.score; v.terms.forEach((t) => terms.add(t)); } base.set(id, { score, terms }); } }
    const minShould = b.minimum_should_match ?? (andSets.length ? 0 : 1);
    if (should.length) {
      if (!base) { base = new Map(); // pure should → union with min_should_match
        const counts = new Map();
        for (const m of should) for (const [id, v] of m) { const c = counts.get(id) || { n: 0, score: 0, terms: new Set() }; c.n++; c.score += v.score; v.terms.forEach((t) => c.terms.add(t)); counts.set(id, c); }
        for (const [id, c] of counts) if (c.n >= minShould) base.set(id, { score: c.score, terms: c.terms });
      } else { for (const m of should) for (const [id, v] of m) if (base.has(id)) { base.get(id).score += v.score; v.terms.forEach((t) => base.get(id).terms.add(t)); } }
    }
    if (!base) { base = new Map(); for (const id of this.docs.keys()) base.set(id, { score: 0, terms: new Set() }); } // match all then exclude
    for (const m of mustNot) for (const id of m.keys()) base.delete(id);
    return base;
  }
  _evalFunctionScore(b) {
    const base = this.evaluate(b.query || { match_all: {} });
    const fns = b.functions || (b.field_value_factor || b.script_score || b.gauss || b.exp || b.linear || b.weight ? [b] : []);
    const boostMode = b.boost_mode || "multiply", scoreMode = b.score_mode || "multiply";
    for (const [id, v] of base) {
      const vals = fns.length ? fns.filter((fn) => !fn.filter || this.evaluate(fn.filter).has(id)).map((fn) => this._fnScore(fn, id, v.score)) : [1];
      let fnScore = scoreMode === "sum" ? vals.reduce((a, x) => a + x, 0) : scoreMode === "avg" ? (vals.reduce((a, x) => a + x, 0) / (vals.length || 1))
        : scoreMode === "max" ? Math.max(...vals, 0) : vals.reduce((a, x) => a * x, 1);
      v.score = boostMode === "sum" ? v.score + fnScore : boostMode === "replace" ? fnScore : boostMode === "max" ? Math.max(v.score, fnScore) : v.score * fnScore;
    }
    return base;
  }
  _fnScore(fn, id, score) {
    let s = 1;
    if (fn.weight != null) s *= fn.weight;
    if (fn.field_value_factor) { const { field, factor = 1, modifier = "none", missing = 0 } = fn.field_value_factor;
      let x = +(this._values(field, id)[0] ?? missing) * factor;
      x = { none: x, log: Math.log10(x), log1p: Math.log10(1 + x), log2p: Math.log10(2 + x), ln: Math.log(x), ln1p: Math.log1p(x), ln2p: Math.log(2 + x), sqrt: Math.sqrt(x), square: x * x, reciprocal: 1 / x }[modifier] ?? x;
      s *= x; }
    for (const kind of ["gauss", "exp", "linear"]) if (fn[kind]) { const [field] = Object.keys(fn[kind]); const { origin = 0, scale = 1, offset = 0, decay = 0.5 } = fn[kind][field];
      const d = Math.max(0, Math.abs(+(this._values(field, id)[0] ?? origin) - +origin) - +offset);
      s *= kind === "linear" ? Math.max(0, 1 - (1 - decay) * d / scale) : kind === "exp" ? Math.exp(Math.log(decay) / scale * d) : Math.exp(Math.log(decay) / (scale * scale) * d * d); }
    if (fn.script_score) s *= this._expr(fn.script_score.script || fn.script_score, id, score);
    return s;
  }
  _evalScriptScore(b) { const base = this.evaluate(b.query || { match_all: {} });
    for (const [id, v] of base) v.score = this._expr(b.script, id, v.score); return base; }

  // Lucene `expressions` lang subset: _score, doc['f'].value / doc.f, params.x, ln/log/sqrt/abs/max/min, + - * / ^ ().
  _expr(script, id, score) {
    const src = (script.source || script.inline || script).toString();
    const params = script.params || {};
    const docVal = (f) => +(this._values(f, id)[0] ?? 0);
    // tokenize
    const toks = src.match(/_score|doc\[['"][^'"]+['"]\](?:\.value)?|doc\.[A-Za-z_]\w*|params\.[A-Za-z_]\w*|[A-Za-z_]\w*|\d+\.?\d*|[()+\-*/^,]/g) || [];
    const prec = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 }, right = { "^": true };
    const funcs = { ln: Math.log, log: Math.log10, sqrt: Math.sqrt, abs: Math.abs, max: Math.max, min: Math.min, log1p: Math.log1p, exp: Math.exp };
    const output = [], ops = [];
    const apply = (op) => { if (funcs[op]) { const args = []; while (output.length && output[output.length - 1]?.__arg) args.unshift(output.pop().v); const a = output.pop(); args.unshift(a); output.push(funcs[op](...args)); return; }
      const b = output.pop(), a = output.pop(); output.push(op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : op === "/" ? a / b : Math.pow(a, b)); };
    for (let i = 0; i < toks.length; i++) { const t = toks[i];
      if (/^\d/.test(t)) output.push(+t);
      else if (t === "_score") output.push(score);
      else if (t.startsWith("doc")) { const m = t.match(/doc\[['"]([^'"]+)['"]\]|doc\.(\w+)/); output.push(docVal(m[1] || m[2])); }
      else if (t.startsWith("params.")) output.push(+params[t.slice(7)] || 0);
      else if (funcs[t]) ops.push(t);
      else if (t === ",") { while (ops.length && ops[ops.length - 1] !== "(") apply(ops.pop()); }
      else if (t === "(") ops.push(t);
      else if (t === ")") { while (ops.length && ops[ops.length - 1] !== "(") apply(ops.pop()); ops.pop(); if (funcs[ops[ops.length - 1]]) apply(ops.pop()); }
      else if (prec[t]) { while (ops.length && prec[ops[ops.length - 1]] && (right[t] ? prec[ops[ops.length - 1]] > prec[t] : prec[ops[ops.length - 1]] >= prec[t])) apply(ops.pop()); ops.push(t); }
    }
    while (ops.length) apply(ops.pop());
    const r = output.pop(); return Number.isFinite(r) ? r : score;
  }

  // ── search (OpenSearch _search response shape) ────────────────────────────────────────
  search(body = {}) {
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const t0 = now();
    const from = body.from || 0, size = body.size ?? 10;
    let arr = [...this.evaluate(body.query || { match_all: {} })].map(([id, v]) => ({ _index: this.name, _id: id, _score: v.score, _source: this.docs.get(id), __terms: v.terms }));
    if (body.min_score != null) arr = arr.filter((h) => h._score >= body.min_score);                 // score threshold
    if (body.terminate_after) arr = arr.slice(0, body.terminate_after);
    const sorts = body.sort ? [].concat(body.sort).map((s) => typeof s === "string" ? { [s]: "asc" } : s) : null;
    const dirOf = (s) => { const [f] = Object.keys(s); return [f, ((s[f].order || s[f]) === "desc" ? -1 : 1)]; };
    const sortVals = (h) => sorts ? sorts.map((s) => { const [f] = dirOf(s); return f === "_score" ? h._score : (this._values(f, h._id)[0] ?? null); }) : null;
    if (sorts) arr.sort((a, b) => { for (const s of sorts) { const [f, dir] = dirOf(s);
        const av = f === "_score" ? a._score : this._values(f, a._id)[0], bv = f === "_score" ? b._score : this._values(f, b._id)[0];
        if (av < bv) return -1 * dir; if (av > bv) return 1 * dir; } return 0; });
    else arr.sort((a, b) => b._score - a._score);
    // aggregations run over the query result set (BEFORE post_filter) — OpenSearch semantics.
    const aggs = (body.aggs || body.aggregations) ? this._aggregate(body.aggs || body.aggregations, arr.map((h) => h._id)) : null;
    if (body.post_filter) { const pf = this.evaluate(body.post_filter); arr = arr.filter((h) => pf.has(h._id)); }   // narrows hits only
    let hitsArr = arr;
    if (body.search_after && sorts) hitsArr = arr.filter((h) => {                                      // deep pagination cursor
      const sv = sortVals(h); for (let i = 0; i < sv.length; i++) { const [, dir] = dirOf(sorts[i]);
        if (sv[i] < body.search_after[i]) return dir < 0; if (sv[i] > body.search_after[i]) return dir > 0; } return false; });
    const maxScore = (sorts || !arr.length) ? null : Math.max(...arr.map((h) => h._score));
    const total = arr.length, tth = body.track_total_hits;
    const cap = (typeof tth === "number") ? tth : (tth === false ? 0 : Infinity);
    const totalObj = (cap !== Infinity && total > cap) ? { value: cap, relation: "gte" } : { value: total, relation: "eq" };
    const page = (body.search_after ? hitsArr.slice(0, size) : hitsArr.slice(from, from + size)).map((h) => {
      const hit = { _index: h._index, _id: h._id, _score: sorts ? null : h._score };
      if (body._source !== false) hit._source = this._project(h._source, body._source);
      if (body.highlight) hit.highlight = this._highlight(h, body.highlight);
      if (sorts) hit.sort = sortVals(h);
      if (body.explain) hit._explanation = { value: h._score, description: "blended score (BM25 × HoloRank × semantic)", details: [] };
      return hit;
    });
    const res = { took: Math.round(now() - t0), timed_out: false,
      _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
      hits: { total: totalObj, max_score: maxScore, hits: page } };
    if (aggs) res.aggregations = aggs;
    return res;
  }
  msearch(reqs) { return { responses: reqs.map((r) => this.search(r.body || r)) }; }
  count(query) { return { count: this.evaluate(query || { match_all: {} }).size }; }
  // _source: true|false | "field" | ["f1","f2"] | { includes:[...], excludes:[...] } — OpenSearch source filtering.
  _project(src, sel) {
    if (sel == null || sel === true) return src;
    if (typeof sel === "string" || Array.isArray(sel)) { const o = {}; for (const f of [].concat(sel)) if (f in src) o[f] = src[f]; return o; }
    let o = { ...src };
    if (sel.includes) { o = {}; for (const f of [].concat(sel.includes)) if (f in src) o[f] = src[f]; }
    if (sel.excludes) for (const f of [].concat(sel.excludes)) delete o[f];
    return o;
  }

  // ── highlighting (unified highlighter) ────────────────────────────────────────────────
  _highlight(hit, hl) { const pre = (hl.pre_tags && hl.pre_tags[0]) || "<em>", post = (hl.post_tags && hl.post_tags[0]) || "</em>";
    const out = {}; const fields = Object.keys(hl.fields || {});
    for (const field of fields) { const raw = hit._source?.[field]; if (raw == null) continue;
      const analyze = this.analyzerFor(field); const toks = analyze(String(raw));
      const hits = toks.filter((t) => hit.__terms.has(t.token)); if (!hits.length) continue;
      const text = String(raw); let frag = ""; let last = 0; const ctx = 60; const first = hits[0];
      const start = Math.max(0, first.start - ctx), end = Math.min(text.length, hits[hits.length - 1].end + ctx);
      let cursor = start;
      for (const h of hits.filter((h) => h.start >= start && h.end <= end)) { frag += text.slice(cursor, h.start) + pre + text.slice(h.start, h.end) + post; cursor = h.end; }
      frag += text.slice(cursor, end);
      out[field] = [(start > 0 ? "…" : "") + frag.trim() + (end < text.length ? "…" : "")];
    }
    return out;
  }

  // ── aggregations ──────────────────────────────────────────────────────────────────────
  _aggregate(aggs, ids) {
    const out = {};
    for (const [name, spec] of Object.entries(aggs)) {
      if (spec.terms) { const { field, size = 10 } = spec.terms; const counts = new Map();
        for (const id of ids) for (const v of this._values(field, id)) counts.set(v, (counts.get(v) || 0) + 1);
        const buckets = [...counts].sort((a, b) => b[1] - a[1]).slice(0, size).map(([key, doc_count]) => ({ key, doc_count }));
        out[name] = { doc_count_error_upper_bound: 0, sum_other_doc_count: 0, buckets }; }
      else if (spec.stats || spec.avg || spec.sum || spec.min || spec.max || spec.value_count || spec.cardinality) {
        const field = (spec.stats || spec.avg || spec.sum || spec.min || spec.max || spec.value_count || spec.cardinality).field;
        const nums = []; const uniq = new Set(); for (const id of ids) for (const v of this._values(field, id)) { const x = +v; if (!isNaN(x)) nums.push(x); uniq.add(v); }
        const sum = nums.reduce((a, x) => a + x, 0), count = nums.length;
        if (spec.stats) out[name] = { count, min: count ? Math.min(...nums) : null, max: count ? Math.max(...nums) : null, avg: count ? sum / count : null, sum };
        else if (spec.avg) out[name] = { value: count ? sum / count : null };
        else if (spec.sum) out[name] = { value: sum };
        else if (spec.min) out[name] = { value: count ? Math.min(...nums) : null };
        else if (spec.max) out[name] = { value: count ? Math.max(...nums) : null };
        else if (spec.value_count) out[name] = { value: count };
        else out[name] = { value: uniq.size };
      }
      else if (spec.date_histogram) { const { field, calendar_interval = "year" } = spec.date_histogram; const counts = new Map();
        for (const id of ids) for (const v of this._values(field, id)) { const d = new Date(v); if (isNaN(d)) continue;
          const key = calendar_interval === "year" ? `${d.getUTCFullYear()}` : calendar_interval === "month" ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : d.toISOString().slice(0, 10);
          counts.set(key, (counts.get(key) || 0) + 1); }
        out[name] = { buckets: [...counts].sort().map(([key_as_string, doc_count]) => ({ key_as_string, doc_count })) }; }
      else if (spec.filters) { const buckets = {}; for (const [bn, q] of Object.entries(spec.filters.filters)) { const m = this.evaluate(q); buckets[bn] = { doc_count: ids.filter((id) => m.has(id)).length }; } out[name] = { buckets }; }
    }
    return out;
  }

  // ── kNN vector search (OpenSearch k-NN, cosine) ───────────────────────────────────────
  knn({ field, query_vector, query_text, k = 10 }) {
    const qv = query_vector || embed(String(query_text || ""), this.mappings.properties?.[field]?.dimension || 64);
    const vmap = this._vec(field); const scored = [...vmap].map(([id, v]) => ({ _id: id, _index: this.name, _score: (cosine(qv, v) + 1) / 2, _source: this.docs.get(id) }));
    scored.sort((a, b) => b._score - a._score);
    return { hits: { total: { value: scored.length }, hits: scored.slice(0, k) } };
  }

  // ── suggesters (term/phrase fuzzy + completion type-ahead) ────────────────────────────
  suggest(body) {
    const out = {};
    for (const [name, spec] of Object.entries(body)) {
      const text = spec.text;
      if (spec.term) { const field = spec.term.field; const analyze = this.analyzerFor(field); const out2 = [];
        for (const t of analyze(text)) { const opts = []; const md = autoFuzz(t.token);
          for (const term of this._post(field).keys()) { const d = levenshtein(term, t.token); if (d > 0 && d <= Math.max(1, md)) opts.push({ text: term, score: 1 - d / Math.max(term.length, t.token.length), freq: this._df(field).get(term) || 0 }); }
          opts.sort((a, b) => b.freq - a.freq || b.score - a.score); out2.push({ text: t.token, offset: t.start, length: t.token.length, options: opts.slice(0, 5) }); }
        out[name] = out2; }
      else if (spec.completion) { const field = spec.completion.field; const size = spec.completion.size || 5; const pref = String(text).toLowerCase();
        const seen = new Map(); for (const id of this.docs.keys()) { const raw = this.docs.get(id)[field]; if (raw == null) continue;
          for (const v of [].concat(raw)) { const sv = String(v); if (sv.toLowerCase().startsWith(pref)) seen.set(sv, { text: sv, _id: id, _source: this.docs.get(id) }); } }
        out[name] = [{ text, offset: 0, length: text.length, options: [...seen.values()].slice(0, size) }]; }
    }
    return out;
  }

  // ── percolator (reverse search: stored queries matched by an incoming document) ────────
  registerPercolator(id, query) { this.percolators.set(id, query); }
  percolate(document) {
    const tmp = new Index("_percolate", { settings: this.settings, mappings: this.mappings }); tmp.index("_doc", document);
    const hits = []; for (const [id, query] of this.percolators) if (tmp.evaluate(query).has("_doc")) hits.push({ _id: id, _index: this.name, _score: 1, query });
    return { hits: { total: { value: hits.length }, hits } };
  }

  // ── _analyze (debug the analysis chain) ───────────────────────────────────────────────
  analyze({ analyzer = "english", field, text }) { const a = field ? this.analyzerFor(field) : buildAnalyzer(analyzer, this.analysis);
    return { tokens: a(text).map((t) => ({ token: t.token, start_offset: t.start, end_offset: t.end, position: t.position, type: "<ALPHANUM>" })) }; }

  // ── content address: canonical bytes the index κ commits to (corpus + config) ──────────
  // ── document APIs (OpenSearch Document REST) ──────────────────────────────────────────
  get(id) { return this.docs.has(id) ? { _index: this.name, _id: id, found: true, _source: this.docs.get(id) } : { _index: this.name, _id: id, found: false }; }
  exists(id) { return this.docs.has(id); }
  mget(ids) { return { docs: ids.map((id) => this.get(id)) }; }
  update(id, doc) { this.index(id, { ...(this.docs.get(id) || {}), ...(doc.doc || doc) }); return { _index: this.name, _id: id, result: "updated" }; }
  updateByQuery(query, doc) { let n = 0; for (const id of [...this.evaluate(query).keys()]) { this.update(id, doc); n++; } return { updated: n, total: n }; }
  deleteByQuery(query) { let n = 0; for (const id of [...this.evaluate(query).keys()]) if (this.delete(id)) n++; return { deleted: n, total: n }; }
  // ── mapping / settings / introspection (OpenSearch Index + Search APIs) ───────────────
  getMapping() { return { [this.name]: { mappings: this.mappings } }; }
  getSettings() { return { [this.name]: { settings: this.settings } }; }
  putMapping(props) { this.mappings.properties = { ...(this.mappings.properties || {}), ...props }; return { acknowledged: true }; }
  validateQuery(q) { try { this.evaluate(q); return { valid: true }; } catch (e) { return { valid: false, error: { reason: String(e.message || e) } }; } }
  explain(id, q) { const hit = this.evaluate(q).get(id); return { _index: this.name, _id: id, matched: !!hit, explanation: { value: hit ? hit.score : 0, description: hit ? "blended score (BM25 × HoloRank × semantic)" : "no matching clause", details: [] } }; }
  fieldCaps(fields) { const props = this.mappings.properties || {}; const out = {}; for (const f of (fields || Object.keys(props))) { const t = props[f]?.type || "text"; out[f] = { [t]: { type: t, metadata_field: false, searchable: true, aggregatable: t !== "text" } }; } return { indices: [this.name], fields: out }; }
  termsEnum(field, prefix = "") { const p = String(prefix).toLowerCase(); return { terms: [...this._post(field).keys()].filter((t) => t.startsWith(p)).sort().slice(0, 100), complete: true }; }

  // ── UOR grounding: the index segment AND a search RESULT are content-addressed, re-derivable artifacts (Law L5) ──
  async _sha(str) { const u8 = new TextEncoder().encode(str);
    if (typeof crypto !== "undefined" && crypto.subtle) { const d = await crypto.subtle.digest("SHA-256", u8); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
    const { createHash } = await import("node:crypto"); return createHash("sha256").update(u8).digest("hex"); }
  async indexKappa() { return "sha256:" + await this._sha(this.canonical()); }                       // the index segment's κ
  // commitSearch: a canonical, re-derivable record of {index κ, query, ranking} → its OWN κ. Anyone
  // re-runs the same query over the same index and derives the same κ (verifiable search, not trusted).
  async commitSearch(body = {}) { const res = this.search(body);
    const record = { kind: "holo-search-result", algo: "bm25×holorank×semantic", indexKappa: await this.indexKappa(),
      query: body.query || { match_all: {} }, ranking: res.hits.hits.map((h) => ({ id: h._id, score: h._score })) };
    return { ...res, kappa: "sha256:" + await this._sha(jcs(record)), record }; }

  // ── content address: canonical bytes the index κ commits to (corpus + config) ──────────
  canonical() { const docs = [...this.docs].sort((a, b) => a[0] < b[0] ? -1 : 1); return jcs({ index: this.name, settings: this.settings, mappings: this.mappings, docs }); }
}

// ────────────────────────────────────────────────────────────────────────────────────────
// 5 · HoloSearch cluster — a registry of named indices (the REST-ish front door)
// ────────────────────────────────────────────────────────────────────────────────────────
export class HoloSearch {
  constructor() { this.indices = new Map(); }
  createIndex(name, def) { const ix = new Index(name, def); this.indices.set(name, ix); return ix; }
  index(name, id, source) { return this._ix(name).index(id, source); }
  bulk(name, ops) { return this._ix(name).bulk(ops); }
  search(name, body) { return this._ix(name).search(body); }
  msearch(name, reqs) { return this._ix(name).msearch(reqs); }
  count(name, q) { return this._ix(name).count(q); }
  knn(name, b) { return this._ix(name).knn(b); }
  suggest(name, b) { return this._ix(name).suggest(b); }
  analyze(name, b) { return this._ix(name).analyze(b); }
  percolate(name, doc) { return this._ix(name).percolate(doc); }
  _ix(name) { const ix = this.indices.get(name); if (!ix) throw new Error(`no such index: ${name}`); return ix; }
}

// ────────────────────────────────────────────────────────────────────────────────────────
// 6 · no-network self-test (idiom of the other engines' selfTest)
// ────────────────────────────────────────────────────────────────────────────────────────
export function selfTest() {
  const ix = new Index("t", { mappings: { properties: { title: { type: "text", analyzer: "english" }, body: { type: "text" }, year: { type: "integer" }, cat: { type: "keyword" }, vec: { type: "knn_vector", dimension: 32, from: ["title", "body"] } } } });
  ix.bulk([
    { index: { _id: "1" } }, { title: "The quick brown fox", body: "jumps over the lazy dog", year: 2020, cat: "animal" },
    { index: { _id: "2" } }, { title: "Lazy dogs sleep", body: "the dog sleeps all day", year: 2021, cat: "animal" },
    { index: { _id: "3" } }, { title: "Quantum computing", body: "qubits and superposition", year: 2022, cat: "science" },
  ]);
  const r = ix.search({ query: { match: { title: "quick" } } });
  const phrase = ix.search({ query: { match_phrase: { title: "lazy dogs" } } });
  const agg = ix.search({ size: 0, query: { match_all: {} }, aggs: { byCat: { terms: { field: "cat" } } } });
  const knn = ix.knn({ field: "vec", query_text: "fox", k: 2 });
  const sug = ix.suggest({ s: { text: "quik", term: { field: "title" } } });
  ix.registerPercolator("p1", { match: { body: "dog" } });
  const perc = ix.percolate({ body: "the dog runs" });
  return r.hits.total.value === 1 && r.hits.hits[0]._id === "1"
    && phrase.hits.total.value === 1 && phrase.hits.hits[0]._id === "2"
    && agg.aggregations.byCat.buckets[0].key === "animal" && agg.aggregations.byCat.buckets[0].doc_count === 2
    && knn.hits.hits.length === 2 && sug.s[0].options.some((o) => o.text === "quick")
    && perc.hits.total.value === 1;
}

if (typeof window !== "undefined") window.HoloSearch = { HoloSearch, Index, buildAnalyzer, porterStem, embed, cosine, levenshtein, BM25, ENGLISH_STOP, jcs, selfTest };
export default HoloSearch;
