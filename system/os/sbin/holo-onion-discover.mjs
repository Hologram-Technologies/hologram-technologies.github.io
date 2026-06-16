// holo-onion-discover.mjs — the DISCOVER half: find onion services from a free-text query, so the onion web
// is browsable from the omnibar, not just openable when you already know an address. Onion services aren't in
// DNS and most directories are themselves onion; the pragmatic clearnet-reachable index is **Ahmia**
// (ahmia.fi — a long-running, abuse-filtering onion search engine). This is a thin, honest adapter: it queries
// Ahmia's clearnet endpoint (through the same /web proxy the browser uses), extracts v3 .onion results, and
// hands back a list the omnibar renders — each result opens through the SAME validated onion path (ADR-0103),
// so every byte still re-derives to its κ (L5). We mint nothing and index nothing ourselves; we read a public
// index and re-present it. Pure ESM, isomorphic; the fetch + parse are separable so the witness drives parse
// with a fixture and no network.

export const AHMIA_SEARCH = "https://ahmia.fi/search/?q=";

// V3 onion host, anywhere in text. (v2 is dead; we surface v3 only.)
const ONION_RE = /\b([a-z2-7]{56}\.onion)\b/gi;

// parseAhmia(html) → [{ host, url, title, snippet }] — tolerant extraction from Ahmia result HTML. Ahmia wraps
// each hit in <li class="result"> with a title <a> and a <cite>http://<onion>/</cite>; structures drift, so we
// anchor on the onion host (self-verifying shape) and best-effort the surrounding title/snippet. Deduped.
export function parseAhmia(html) {
  const s = String(html || "");
  const seen = new Map();
  // Prefer block-structured results when present.
  const blocks = s.split(/<li[^>]*class=["'][^"']*result[^"']*["'][^>]*>/i).slice(1);
  const harvest = (chunk) => {
    const m = chunk.match(ONION_RE); if (!m) return;
    const host = m[0].toLowerCase();
    if (seen.has(host)) return;
    const title = decodeEntities(firstGroup(chunk, /<h4[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i) || firstGroup(chunk, /<a[^>]*>([\s\S]*?)<\/a>/i) || "") || host;
    const snippet = decodeEntities(firstGroup(chunk, /<p[^>]*>([\s\S]*?)<\/p>/i) || "").slice(0, 280);
    const pathM = chunk.match(new RegExp(host.replace(/\./g, "\\.") + "([^\\s\"'<]*)", "i"));
    const url = "http://" + host + (pathM && pathM[1] && pathM[1].startsWith("/") ? pathM[1] : "/");
    seen.set(host, { host, url, title: stripTags(title).trim() || host, snippet: stripTags(snippet).trim() });
  };
  if (blocks.length) for (const b of blocks) harvest(b);
  // Fallback: scan the whole document for any onion hosts we missed (e.g. layout changes).
  let mm; ONION_RE.lastIndex = 0;
  while ((mm = ONION_RE.exec(s))) { const host = mm[1].toLowerCase(); if (!seen.has(host)) seen.set(host, { host, url: "http://" + host + "/", title: host, snippet: "" }); }
  return [...seen.values()];
}

const firstGroup = (s, re) => { const m = String(s).match(re); return m ? m[1] : ""; };
const stripTags = (s) => String(s).replace(/<[^>]+>/g, "");
const decodeEntities = (s) => String(s).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");

// searchOnionWeb(query, cfg) → { ok, query, results, via } | { ok:false, reason }
// cfg.fetchImpl is the transport (the browser passes a proxy-bound fetch so it goes through /web, avoiding
// CORS and minting κ); cfg.endpoint overrides the index. Honest: returns the source it read in `via`.
export async function searchOnionWeb(query, cfg = {}) {
  const q = String(query || "").trim();
  if (!q) return { ok: false, reason: "empty query", results: [] };
  const f = cfg.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return { ok: false, reason: "no fetch available", results: [] };
  const endpoint = (cfg.endpoint || AHMIA_SEARCH) + encodeURIComponent(q);
  let html;
  try { const r = await f(endpoint, { headers: { accept: "text/html" } }); if (!r || !r.ok) return { ok: false, reason: "index returned " + (r && r.status), results: [], via: "ahmia" }; html = await r.text(); }
  catch (e) { return { ok: false, reason: "index unreachable: " + ((e && e.message) || e), results: [], via: "ahmia" }; }
  const results = parseAhmia(html);
  return { ok: true, query: q, results, via: "ahmia", endpoint };
}

export default { AHMIA_SEARCH, parseAhmia, searchOnionWeb };
