// _shared/holo-find.js — Holo Find (ADR-044): the browser orchestration behind the homepage search bar.
// The in-tab counterpart of holo-ask (037→038→040→041): one typed query → SCREEN (immune perimeter) →
// ROUTE → either RESOLVE the identifier, or FEDERATE the free text (the evidence), ANCHOR the entity on
// Wikipedia's primary topic, resolve it, and COMPOSE the answer — all client-side, live from the open web,
// no AI, no keys. Returns a render model the homepage paints. The deterministic logic is the already-
// witnessed pipeline (resolve/federate/answer/ask); this only adds the browser fetch + a render shape.
//
// fetchJson is INJECTED — window.fetch live in the browser, or a fixture-backed fetch in the witness — so
// the whole homepage flow is testable offline and deterministic.

import { classify, RESOLVERS, KIND_RESOLVER, screen } from "./holo-resolve.js";
import { route, anchorEntity } from "./holo-ask.js";
import { SEARCHERS, federate } from "./holo-federate.js";
import { composeAnswer } from "./holo-answer.js";
export { screen, route };

// normalizeToObject(resolverKind, id, resp) → a plain UOR-shaped object (schema.org props + a source-URL
// id for provenance rendering). No sealing — the homepage RENDERS; the self-verifying κ pipeline is the
// Node layer (holo-ask). composeAnswer reads schema:name/description/sameAs/dcterms:source + the id.
export function normalizeToObject(resolverKind, id, resp) {
  const r = RESOLVERS[resolverKind]; if (!r || !resp) return null;
  const { props, reconcile } = r.normalize(resp, id);
  const clean = {};
  for (const [k, v] of Object.entries(props)) if (v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)) clean[k] = v;
  if (!clean["schema:name"]) return null;
  return { id: clean["schema:url"] || `${resolverKind}:${id}`, "@type": [r.schemaType], ...clean,
    "dcterms:source": r.source, ...(reconcile ? { "schema:sameAs": `https://www.wikidata.org/entity/${reconcile}` } : {}) };
}

// find(query, {fetchJson, limit}) → { query, mode, answer, results, anchor, screen }. The browser pipeline.
export async function find(query, { fetchJson, limit = 6 } = {}) {
  const scr = screen(query);
  const r = route(query);
  if (r.mode === "resolve") {
    const rk = KIND_RESOLVER[r.kind];
    if (!rk) return { query, mode: "resolve", answer: composeAnswer(query, []), results: [], delegated: true, kind: r.kind, screen: scr };
    let obj = null; try { obj = normalizeToObject(rk, r.id, await fetchJson(RESOLVERS[rk].endpoint(r.id))); } catch (e) {}
    return { query, mode: "resolve", answer: composeAnswer(query, obj ? [obj] : []), results: [], screen: scr };
  }
  // federate (evidence) — fan across the sources in parallel; a slow/failed source never blocks the rest.
  const responses = {};
  await Promise.all(Object.entries(SEARCHERS).map(async ([kind, s]) => { try { responses[kind] = await fetchJson(s.endpoint(query, limit)); } catch (e) {} }));
  const fed = federate(query, responses);
  // anchor the entity on Wikipedia's primary topic, then resolve it across Wikipedia + Wikidata.
  const objs = []; let anchor = null;
  try {
    const wpObj = normalizeToObject("wikipedia", query, await fetchJson(RESOLVERS.wikipedia.endpoint(query)));
    if (wpObj) objs.push(wpObj);
    anchor = anchorEntity(wpObj, fed.results[0]);
    if (anchor.qid) { const wdObj = normalizeToObject("wikidata", anchor.qid, await fetchJson(RESOLVERS.wikidata.endpoint(anchor.qid))); if (wdObj) objs.push(wdObj); }
  } catch (e) {}
  return { query, mode: "federate", answer: composeAnswer(query, objs), results: fed.results, sources: fed.sources, anchor, screen: scr };
}

// browserFetchJson — window.fetch wrapper handling the open APIs' CORS quirks: the MediaWiki action API
// (Wikidata) needs &origin=* for a cross-origin read. The homepage uses this; the witness injects fixtures.
export const browserFetchJson = async (url) => {
  let u = url;
  if (/\/w\/api\.php/.test(url) && !/[?&]origin=/.test(url)) u = url + (url.includes("?") ? "&" : "?") + "origin=*";
  const res = await fetch(u, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

if (typeof window !== "undefined") window.HoloFind = { find, normalizeToObject, browserFetchJson, screen, route };
