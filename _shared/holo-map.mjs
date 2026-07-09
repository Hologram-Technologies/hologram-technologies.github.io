// holo-map.mjs — THE MAP LAYER (S1 of "the +"). Turns an ingested source's decoded text VIEW (from
// holo-ingest, S0) into the κ-hypergraph: entities, attributes, and relationships, EACH sealed as a
// content-addressed, W3C-legible node/edge (schema.org @type + PROV-O + @id = did:holo). This is where
// raw bytes become a navigable, self-verifying graph Q can reason over (S4) and cite (S5).
//
// THE κ-DESIGN THAT MAKES S2 DEDUP + S5 PROVENANCE FREE — separate IDENTITY from ASSERTION:
//   • Entity node  κ = H(identity {type, name})        → the SAME entity from ANY source collapses to ONE κ.
//   • Claim  edge  κ = H(claim {subject, predicate, object}) → the SAME claim dedups to ONE κ.
//   • Provenance   κ = H({claim, prov:wasDerivedFrom, source})   → multi-source attestation = MANY prov κs
//                                                                  pointing at ONE claim. No mutable sets.
// So an insight (S5) cites a claim κ; its evidence is exactly the prov κs whose holo:claim is that κ, each
// naming a source κ that re-derives from the original bytes (Law L5). Provenance is the edge set, not prose.
//
// THE EXTRACTOR IS A SWAPPABLE SEAM. extractGraph(...) takes an `extract(text) → {entities, relationships}`
// function. Production injects Q's zero-shot .holo brain (makeQExtractor below). The built-in heuristic
// extractor is a DETERMINISTIC baseline — it exists so the graph MECHANICS (κ identity, dedup, provenance,
// closure, re-derivation) are Node-witnessable WITHOUT a GPU. It is NOT the intelligence; Q is. (Mirrors
// ANIMA's "LLM-assisted, falls back to rule-based" split.) Pure ESM, isomorphic, hash injectable.

import { sha256hex, didHolo, jcs } from "./holo-uor.mjs";

const SHA = "sha256";
const enc = new TextEncoder();
const HOLO_CONTEXT = { holo: "https://hologram.os/ns#", schema: "http://schema.org/", prov: "http://www.w3.org/ns/prov#" };

// schema.org @type for an entity kind (semantic-web legibility; falls back to schema:Thing).
const SCHEMA_TYPE = { Organization: "schema:Organization", Person: "schema:Person", Place: "schema:Place",
  Date: "schema:Date", Money: "schema:MonetaryAmount", Product: "schema:Product", Event: "schema:Event" };
const schemaTypeOf = (kind) => SCHEMA_TYPE[kind] || "schema:Thing";

const normName = (s) => String(s || "").trim().replace(/\s+/g, " ");
const idKey = (s) => normName(s).toLowerCase();            // identity is case-insensitive on the name

// ── node / edge constructors — each is a canonical κ-object (Law L2: address = H(canonical_form)) ──
function makeKappa(canonical, hash) { return didHolo(SHA, hash(enc.encode(jcs(canonical)))); }

function entityNode(name, kind, hash) {
  const identity = { t: "entity", type: kind, name: idKey(name) };   // IDENTITY ONLY → dedups across sources
  const kappa = makeKappa(identity, hash);
  return { "@context": HOLO_CONTEXT, "@id": kappa, "@type": ["holo:Entity", schemaTypeOf(kind)],
           "schema:name": normName(name), "holo:entityType": kind, kappa };
}

// a claim is an attribute (object is a literal) or a relationship (object is an entity κ).
function claimEdge({ subject, predicate, object, objectKind }, hash) {
  const claim = { t: "claim", subject, predicate, object, objectKind };
  const kappa = makeKappa(claim, hash);
  const type = objectKind === "entity" ? ["holo:Relationship", "rdf:Statement"]
                                        : ["holo:Attribute", "schema:PropertyValue"];
  return { "@context": HOLO_CONTEXT, "@id": kappa, "@type": type,
           "holo:subject": subject, "holo:predicate": predicate, "holo:object": object, "holo:objectKind": objectKind, kappa };
}

function provTriple({ claim, source }, hash) {
  const triple = { t: "prov", claim, source };
  const kappa = makeKappa(triple, hash);
  return { "@context": HOLO_CONTEXT, "@id": kappa, "@type": ["prov:Entity", "holo:Provenance"],
           "holo:claim": claim, "prov:wasDerivedFrom": source, kappa };
}

// ── extractGraph — the one entry point. Builds the hypergraph from a source's text view ────────────
// sourceKappa: the ingest source κ (from holo-ingest, S0) — the immutable evidence anchor every claim cites.
// extract: the swappable extractor (default heuristic; production = makeQExtractor wrapping Q's brain).
export function extractGraph({ text, sourceKappa, extract = heuristicExtract } = {}, { hash = sha256hex } = {}) {
  const raw = extract(String(text || "")) || { entities: [], relationships: [] };

  const nodes = new Map();   // κ → entity node      (Map = automatic intra-doc identity dedup)
  const edges = new Map();   // κ → claim edge       (automatic claim dedup)
  const provs = new Map();   // κ → provenance triple (automatic (claim,source) dedup)
  const byName = new Map();  // idKey → entity κ      (resolve relationship endpoints by name)

  const addEntity = (name, kind) => {
    const node = entityNode(name, kind, hash);
    if (!nodes.has(node.kappa)) nodes.set(node.kappa, node);
    byName.set(idKey(name), node.kappa);
    return node.kappa;
  };
  const addClaim = (edge) => {
    if (!edges.has(edge.kappa)) edges.set(edge.kappa, edge);
    const p = provTriple({ claim: edge.kappa, source: sourceKappa }, hash);
    if (!provs.has(p.kappa)) provs.set(p.kappa, p);   // structural provenance → the source bytes
    return edge.kappa;
  };

  // entities + their attributes
  for (const e of raw.entities || []) {
    if (!e || !e.name) continue;
    const subj = addEntity(e.name, e.type || "Thing");
    for (const [k, v] of Object.entries(e.attributes || {})) {
      if (v == null || v === "") continue;
      addClaim(claimEdge({ subject: subj, predicate: String(k), object: String(v), objectKind: "literal" }, hash));
    }
  }
  // relationships (endpoints become entities too, so a relationship never dangles)
  for (const r of raw.relationships || []) {
    if (!r || !r.subject || !r.object || !r.predicate) continue;
    const s = addEntity(r.subject, r.subjectType || "Thing");
    const o = addEntity(r.object, r.objectType || "Thing");
    addClaim(claimEdge({ subject: s, predicate: String(r.predicate), object: o, objectKind: "entity" }, hash));
  }

  const members = [...nodes.keys(), ...edges.keys(), ...provs.keys()].sort();
  const graph = {
    "@context": HOLO_CONTEXT, "@type": ["holo:HyperGraph"],
    "holo:source": sourceKappa,
    "holo:entities": [...nodes.values()],
    "holo:claims": [...edges.values()],
    "holo:provenance": [...provs.values()],
    "holo:stats": { entities: nodes.size, claims: edges.size, provenance: provs.size },
  };
  // non-circular closure: H over the SORTED member κs only (never includes itself).
  graph["holo:graphClosure"] = didHolo(SHA, hash(enc.encode(jcs(members))));
  return graph;
}

// ── mergeGraphs — fold per-source graphs into ONE κ-hypergraph (the whole investigation, S2/S8) ────
// Union by @id: identical entity nodes (same identity κ) and identical claims (same claim κ) collapse to
// one; provenance triples accumulate, so a claim asserted by N sources keeps N prov κs — multi-source
// attestation, no mutable sets. Deterministic: members are sorted, so the closure is merge-order-invariant.
export function mergeGraphs(graphs, { hash = sha256hex } = {}) {
  const nodes = new Map(), edges = new Map(), provs = new Map(), sources = new Set();
  for (const g of graphs || []) {
    if (!g) continue;
    if (g["holo:source"]) sources.add(g["holo:source"]);
    for (const e of g["holo:entities"]   || []) if (!nodes.has(e["@id"])) nodes.set(e["@id"], e);
    for (const c of g["holo:claims"]      || []) if (!edges.has(c["@id"])) edges.set(c["@id"], c);
    for (const p of g["holo:provenance"]  || []) if (!provs.has(p["@id"])) provs.set(p["@id"], p);
  }
  const members = [...nodes.keys(), ...edges.keys(), ...provs.keys()].sort();
  const merged = {
    "@context": HOLO_CONTEXT, "@type": ["holo:HyperGraph"],
    "holo:sources": [...sources].sort(),
    "holo:entities": [...nodes.values()], "holo:claims": [...edges.values()], "holo:provenance": [...provs.values()],
    "holo:stats": { entities: nodes.size, claims: edges.size, provenance: provs.size, sources: sources.size },
  };
  merged["holo:graphClosure"] = didHolo(SHA, hash(enc.encode(jcs(members))));
  return merged;
}

// sourcesForClaim(graph, claimKappa) → the source κs that attest a claim (its evidence set — S5 reads this).
export function sourcesForClaim(graph, claimKappa) {
  return (graph["holo:provenance"] || []).filter((p) => p["holo:claim"] === claimKappa).map((p) => p["prov:wasDerivedFrom"]);
}

// ── heuristic extractor — DETERMINISTIC baseline (the witness fixture; NOT the production intelligence) ──
// Pulls obvious proper-noun entities + a few "key: value" / "founded in X" patterns. Honest about being a
// baseline: it proves graph mechanics, not extraction quality. Production swaps in Q (makeQExtractor).
export function heuristicExtract(text) {
  const entities = [];
  const relationships = [];
  const seen = new Set();
  const push = (name, type, attributes) => {
    const key = idKey(name) + "|" + type;
    if (seen.has(key)) { if (attributes) { const ex = entities.find((e) => idKey(e.name) === idKey(name) && e.type === type); if (ex) Object.assign(ex.attributes, attributes); } return; }
    seen.add(key); entities.push({ name, type, attributes: attributes || {} });
  };

  // Organizations: proper-noun runs ending in a company suffix.
  // join tokens with space only (no '.') so an org never spans a sentence boundary ("Lee. Acme Corp").
  for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9&\-]*(?:\s+[A-Z][A-Za-z0-9&\-]*)*\s+(?:Corp|Corporation|Inc|Incorporated|Ltd|Limited|LLC|GmbH|PLC|Group|Holdings|Labs|Technologies|Systems))\b/g))
    push(m[1], "Organization", {});
  // Money: €/$/£ amounts.
  for (const m of text.matchAll(/([€$£]\s?\d[\d,.]*\s?(?:[KMB]|million|billion|thousand)?)/g)) push(m[1].trim(), "Money", {});
  // "Role: Proper Name" → a Person + a relationship (Org? — attach to nearest org if any).
  for (const m of text.matchAll(/\b(CEO|CTO|CFO|COO|Founder|President|Director|Chair(?:man|woman|person)?)\s*:?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g)) {
    push(m[2], "Person", {});
    const org = entities.find((e) => e.type === "Organization");
    if (org) relationships.push({ subject: org.name, subjectType: "Organization", predicate: "holo:hasRole/" + m[1], object: m[2], objectType: "Person" });
  }
  // "founded ... in <Place>" and "in <Place>" right after an org context → Place.
  for (const m of text.matchAll(/\bin\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g)) {
    const name = m[1];
    if (/^(The|This|That|These|January|February|March|April|May|June|July|August|September|October|November|December)$/.test(name)) continue;
    push(name, "Place", {});
    const org = entities.find((e) => e.type === "Organization");
    if (org) relationships.push({ subject: org.name, subjectType: "Organization", predicate: "schema:location", object: name, objectType: "Place" });
  }
  // Years → Date, attached as a founding/temporal attribute on the first org.
  const year = text.match(/\b(19|20)\d{2}\b/);
  if (year) { const org = entities.find((e) => e.type === "Organization"); if (org) org.attributes["holo:year"] = year[0]; }

  return { entities, relationships };
}

// ── makeQExtractor — the PRODUCTION seam: Q's zero-shot .holo brain as the extractor ───────────────
// Wraps a brain with a `generate(prompt) → string` contract. Prompts for STRICT JSON, parses defensively.
// NOT witnessed here (requires a live WebGPU brain) — that is honest: the Node witness proves mechanics
// with the heuristic baseline; the browser path proves quality with Q. brain failure → empty graph, never throws.
export function makeQExtractor(brain, { generate = "generate" } = {}) {
  const PROMPT = (text) =>
`Extract a knowledge graph from the text. Return ONLY minified JSON:
{"entities":[{"name":str,"type":"Organization|Person|Place|Date|Money|Product|Event|Thing","attributes":{}}],
 "relationships":[{"subject":str,"predicate":str,"object":str}]}
Text:
"""${text.slice(0, 6000)}"""`;
  return async function extract(text) {
    try {
      const out = await brain[generate](PROMPT(text));
      const m = String(out).match(/\{[\s\S]*\}/);
      const j = JSON.parse(m ? m[0] : out);
      return { entities: Array.isArray(j.entities) ? j.entities : [], relationships: Array.isArray(j.relationships) ? j.relationships : [] };
    } catch { return { entities: [], relationships: [] }; }
  };
}

export default { extractGraph, heuristicExtract, makeQExtractor };
