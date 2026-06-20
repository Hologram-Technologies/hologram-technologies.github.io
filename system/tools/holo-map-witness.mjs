#!/usr/bin/env node
// holo-map-witness.mjs — proves S1 of "the +": THE MAP LAYER. An ingested source's text VIEW becomes the
// κ-hypergraph — entities, attributes, relationships — each a content-addressed, W3C-legible node/edge.
// This is the stage that makes the data graph-shaped; it chains off S0 (uses a REAL holo-ingest source κ as
// the evidence anchor) and lays the foundation for S2 (dedup) and S5 (structural provenance to evidence).
//
// The witness drives the DETERMINISTIC heuristic extractor (no GPU) so it proves graph MECHANICS, not LLM
// quality — exactly the honest split: Q's brain is the production extractor (makeQExtractor), witnessed in
// the browser; here we prove the κ-graph is correct, deduped, provenance-bearing, and re-derivable.
//
// Checks (all must hold):
//   1 extractBuildsKappaGraph     — text view → a HyperGraph with entity nodes + claim edges, all @id/@type/@context.
//   2 entityIdentityDedup         — the same entity named twice → ONE entity node κ (identity, not occurrence).
//   3 claimCarriesProvenance      — EVERY claim edge has a prov κ linking it to the SOURCE κ (structural, seeds S5).
//   4 relationshipLinksEntityKappas — a relationship edge's subject+object are entity NODE κs present in the graph.
//   5 nodesAndEdgesReDerive       — every node/edge/prov κ re-derives from its canonical bytes (Law L5, independent hash).
//   6 graphClosureCoversMembers   — the graphClosure κ changes iff graph membership changes; stable when identical.
//   7 extractorSeamIsSwappable    — injecting a custom extractor changes the graph; the MECHANICS are identical (Q drop-in).
//   8 tamperRefused               — mutate a node's canonical identity ⇒ its κ no longer re-derives.
//   9 schemaLegibleNodes          — entity nodes carry a schema.org @type + @id (legible to any W3C JSON-LD/RDF tool).
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · W3C PROV-O · schema.org · IETF RFC 8785 (JCS) · holospaces
// Laws L2/L5. Rests on #holo-uor + #holo-resolver + #holo-ingest (S0). node tools/holo-map-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sealIngest } from "../os/usr/lib/holo/holo-ingest.mjs";
import { extractGraph, heuristicExtract } from "../os/usr/lib/holo/holo-map.mjs";
import { sha256hex, jcs } from "../os/usr/lib/holo/holo-uor.mjs";
import { reDerive, hexOf } from "../os/sbin/holo-resolver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);
const reKappa = async (bytes) => "did:holo:sha256:" + (await reDerive(bytes));   // independent resolver

// ── chain off S0: ingest a real text source, then map its decoded view into the hypergraph ──────────
const DOC = "Acme Corp was founded in Berlin in 2019. CEO: Dana Lee. Acme Corp raised €4,200,000 in 2024.";
const src = sealIngest({ name: "acme.txt", bytes: enc(DOC) });
const text = new TextDecoder().decode(enc(DOC));
const graph = extractGraph({ text, sourceKappa: src.source });

// ── 1 · the graph is built and every member is a proper κ-object ────────────────────────────────────
const allMembers = [...graph["holo:entities"], ...graph["holo:claims"], ...graph["holo:provenance"]];
ok("extractBuildsKappaGraph",
  graph["@type"].includes("holo:HyperGraph") && graph["holo:entities"].length >= 2 && graph["holo:claims"].length >= 1
  && allMembers.every((n) => /^did:holo:sha256:[0-9a-f]{64}$/.test(n["@id"]) && Array.isArray(n["@type"]) && n["@context"]),
  `entities=${graph["holo:entities"].length} claims=${graph["holo:claims"].length}`);

// ── 2 · identity dedup: "Acme Corp" appears twice in DOC → exactly ONE Acme entity node ─────────────
const acme = graph["holo:entities"].filter((e) => e["schema:name"] === "Acme Corp");
ok("entityIdentityDedup", acme.length === 1, `found ${acme.length} Acme nodes (expected 1)`);

// ── 3 · structural provenance: every claim edge has a prov κ pointing at the SOURCE κ (seeds S5) ────
const provForClaim = (ck) => graph["holo:provenance"].filter((p) => p["holo:claim"] === ck && p["prov:wasDerivedFrom"] === src.source);
ok("claimCarriesProvenance",
  graph["holo:claims"].length > 0 && graph["holo:claims"].every((c) => provForClaim(c["@id"]).length === 1),
  "each claim must derive from exactly one source-κ provenance triple");

// ── 4 · a relationship edge links two entity NODE κs that exist in the graph ────────────────────────
const nodeKappas = new Set(graph["holo:entities"].map((e) => e["@id"]));
const rels = graph["holo:claims"].filter((c) => c["holo:objectKind"] === "entity");
ok("relationshipLinksEntityKappas",
  rels.length >= 1 && rels.every((r) => nodeKappas.has(r["holo:subject"]) && nodeKappas.has(r["holo:object"])),
  `${rels.length} relationship edges, all endpoints resolved`);

// ── 5 · Law L5: every node/edge/prov κ re-derives from its canonical identity bytes (independent hash) ─
// Recompute each member's κ from its canonical sub-form via the resolver — must equal its claimed @id.
async function reDerivesById(node) {
  let canonical;
  if (node["@type"].includes("holo:Entity")) canonical = { t: "entity", type: node["holo:entityType"], name: node["schema:name"].trim().replace(/\s+/g, " ").toLowerCase() };
  else if (node["@type"].includes("holo:Provenance")) canonical = { t: "prov", claim: node["holo:claim"], source: node["prov:wasDerivedFrom"] };
  else canonical = { t: "claim", subject: node["holo:subject"], predicate: node["holo:predicate"], object: node["holo:object"], objectKind: node["holo:objectKind"] };
  return (await reKappa(enc(jcs(canonical)))) === node["@id"];
}
const reDeriveAll = (await Promise.all(allMembers.map(reDerivesById))).every(Boolean);
ok("nodesAndEdgesReDerive", reDeriveAll, "a member κ did not re-derive from its canonical form");

// ── 6 · the graphClosure κ is membership-sensitive: stable when identical, moves when content differs ─
const same = extractGraph({ text, sourceKappa: src.source });
const diff = extractGraph({ text: "Beta Labs was founded in Oslo in 2021. CTO: Sam Roe.", sourceKappa: src.source });
ok("graphClosureCoversMembers",
  same["holo:graphClosure"] === graph["holo:graphClosure"] && diff["holo:graphClosure"] !== graph["holo:graphClosure"]);

// ── 7 · the extractor is a swappable SEAM: a custom extractor changes the graph; mechanics unchanged ─
const customExtract = () => ({ entities: [{ name: "Zeta", type: "Organization", attributes: { "holo:year": "2030" } }], relationships: [] });
const custom = extractGraph({ text, sourceKappa: src.source, extract: customExtract });
ok("extractorSeamIsSwappable",
  custom["holo:entities"].some((e) => e["schema:name"] === "Zeta")
  && !custom["holo:entities"].some((e) => e["schema:name"] === "Acme Corp")
  && custom["@type"].includes("holo:HyperGraph") && typeof custom["holo:graphClosure"] === "string",
  "Q's brain must drop into the same seam the heuristic uses");

// ── 8 · Law L5 tamper-refuse: mutate a node's identity ⇒ its κ no longer re-derives ─────────────────
const ent = acme[0];
const tampered = { t: "entity", type: ent["holo:entityType"], name: "acme corp EVIL" };
ok("tamperRefused", (await reKappa(enc(jcs(tampered)))) !== ent["@id"] && hexOf(ent["@id"]).length === 64);

// ── 9 · entity nodes are W3C-legible (schema.org @type present alongside the holo type + @id) ───────
ok("schemaLegibleNodes",
  graph["holo:entities"].every((e) => e["@type"].some((t) => t.startsWith("schema:")) && e["@id"] && e["@context"].schema));

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "the + — S1 MAP (holo-map): a source's decoded text view becomes the κ-hypergraph — entities, attributes, relationships — each a content-addressed, schema.org-typed, PROV-O-bearing node/edge. Identity is separated from assertion so the same entity collapses to one κ (S2 dedup foundation) and every claim carries a provenance κ to the ingest source κ (S5 structural provenance). The extractor is a swappable seam (heuristic baseline witnessed here; Q's zero-shot .holo brain is the production extractor). All κs re-derive via the independent resolver (Law L5); the graphClosure is membership-sensitive (Law L2)",
  authority: "UOR-ADDR (κ = H(canonical_form)) · W3C PROV-O · schema.org · IETF RFC 8785 (JCS) · holospaces Laws L2/L5 · rests on #holo-uor + #holo-resolver + #holo-ingest (S0)",
  witnessed,
  covers: witnessed ? ["hypergraph","entity-nodes","claim-edges","identity-dedup","structural-provenance","extractor-seam","law-l5","law-l2","w3c-legible"] : [],
  sample: { source: src.source, graphClosure: graph["holo:graphClosure"], stats: graph["holo:stats"],
            entities: graph["holo:entities"].map((e) => `${e["holo:entityType"]}:${e["schema:name"]}`) },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-map-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-map witness — S1 the + MAP (source view → κ-hypergraph: entities, claims, provenance)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  graph: ${graph["holo:stats"].entities} entities · ${graph["holo:stats"].claims} claims · ${graph["holo:stats"].provenance} prov · closure ${graph["holo:graphClosure"].slice(0, 24)}…`);
console.log(`  entities: ${graph["holo:entities"].map((e) => e["schema:name"]).join(", ")}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  ingested bytes are now a deduped, provenance-bearing κ-hypergraph" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
