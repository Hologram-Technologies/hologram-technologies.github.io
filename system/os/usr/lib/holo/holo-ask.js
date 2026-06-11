// _shared/holo-ask.js — Holo Ask (ADR-041): the one search-bar entry point — the routing that ties the
// universal window together. One typed query flows: SCREEN (the immune perimeter) → CLASSIFY → either
// RESOLVE directly (the query IS an identifier) or FEDERATE (free text → fan across the open web), take
// the top reconciled cluster, RESOLVE its sources, and COMPOSE the answer. This is a certainty
// ladder (L0 lookup vs L1+ federate) made deterministic over the open web — no AI, just routing.
//
// This module is the pure routing core; the orchestration that fetches + seals lives in holo-ask.mjs
// (Node) / the browser. route() decides the path from the query's SHAPE alone; clusterToResolves() maps a
// fused result cluster back to the resolve calls that fetch its full objects (so the answer composes over
// the entity's real sources, reconciled). Pure + isomorphic + deterministic.

import { classify, KIND_RESOLVER, DELEGATED, reconcileKey } from "./holo-resolve.js";
import { norm } from "./holo-federate.js";
import { screen } from "./holo-resolve.js";
export { screen };

// route(query) → { mode, kind, id }. The certainty-ladder decision, deterministic from the query shape:
//   "resolve"  — the query is (or delegates to) a single identifier ⇒ resolve it directly (L0);
//   "federate" — free text ⇒ fan across the open web, fuse, then answer the top entity (L1+).
export function route(query) {
  const c = classify(query);
  const resolvable = !!KIND_RESOLVER[c.kind] && c.kind !== "freetext";   // doi / isbn / wikidata / geo
  const delegated = !!DELEGATED[c.kind];                                 // holo / κ / ipfs / eth / url
  return { mode: resolvable || delegated ? "resolve" : "federate", kind: c.kind, id: c.id };
}

// clusterToResolves(top) → [{ kind, id }]: the resolve calls that fetch the full objects behind a fused
// search cluster, so the answer composes over the ENTITY across independent sources. A reconciled Wikidata
// Q-id resolves the canonical record; the cluster name resolves the Wikipedia article. Deduped, ordered.
export function clusterToResolves(top) {
  const out = [];
  if (top && /^Q\d+$/.test(top.reconcile || "")) out.push({ kind: "wikidata", id: top.reconcile });
  if (top && top.name) out.push({ kind: "freetext", id: top.name });    // Wikipedia (REST summary) by title
  const seen = new Set();
  return out.filter((r) => { const key = r.kind + ":" + norm(r.id); if (seen.has(key)) return false; seen.add(key); return true; });
}

// anchorEntity(wikipediaObj, federatedTop) → the canonical entity for a free-text query. Wikipedia's own
// PRIMARY-TOPIC disambiguation — the resolved article's wikibase_item Q-id — is authoritative for "what
// does this name mean", so it is PREFERRED over the federated top cluster's reconcile (which a same-named
// book or film can win by ranking). This fixes the entity-collision case (e.g. "marie curie" the person,
// Q7186, vs a 2022 book titled "Marie Curie", Q114939443, that topped the fused search). Falls back to the
// federated cluster only when Wikipedia has no entity. Pure + deterministic — the disambiguation is data.
export function anchorEntity(wikipediaObj, federatedTop) {
  const wikipediaQid = reconcileKey(wikipediaObj);                              // the article's wikibase_item
  const federatedQid = federatedTop && /^Q\d+$/.test(federatedTop.reconcile || "") ? federatedTop.reconcile : null;
  const qid = wikipediaQid || federatedQid;                                     // PREFER Wikipedia's primary topic
  return { qid, wikipediaQid, federatedQid, agreed: !!wikipediaQid && !!federatedQid && wikipediaQid === federatedQid,
    anchoredBy: wikipediaQid ? "wikipedia" : federatedQid ? "federate" : "none" };
}

if (typeof window !== "undefined") window.HoloAsk = { route, clusterToResolves, anchorEntity, screen };
