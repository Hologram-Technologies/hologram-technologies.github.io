#!/usr/bin/env node
// build-repo-graph.mjs — connect the repository's linked-data ROOTS into ONE navigable W3C graph from
// codemeta.json (the repo's root node). codemeta gains a schema:hasPart edge to each published root —
// the content-addressed OS image (os-root.jsonld), the W3C conformance catalog, the holospace (app)
// catalog, the three agent-surface projections over the one MCP roster (Project NANDA agent index,
// the agentskills.io Agent Skills index, the Agent2Agent (A2A) card directory), and the hosc:
// vocabulary — so the whole semantic graph dereferences from one node. DERIVED + byte-pinned: the
// content-addressed roots (OS image, NANDA, skills, A2A) are linked by their CURRENT κ, so a stale
// link is a verifiable drift (repo-graph-witness, Law L5). Mints nothing: schema.org/DCAT/PROV/OWL
// only. Re-run after the OS image or any agent index changes:  node scripts/build-repo-graph.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");   // repo root
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const idOf = (d) => d.id || d["@id"] || d.root;                    // a UOR/JSON-LD node's identity

// the published linked-data roots, in dependency order. `type` is the target's self-declared @type
// (or, for NANDA which declares none, the role it plays) — used only as a navigability hint.
export const ROOTS = [
  { url: "os/os-root.jsonld",                  type: ["schema:SoftwareApplication", "prov:Collection"], name: "Hologram OS image — the whole content-addressed OS as one self-verifying UOR Merkle-DAG (ADR-026)" },
  { url: "conformance/w3c-conformance.jsonld", type: "dcat:Catalog",                                     name: "W3C / open-semantic-web conformance catalog (ADR-024)" },
  { url: "os/apps/index.jsonld",               type: "dcat:Catalog",                                     name: "Holospace (app) catalog — content-addressed, DCAT" },
  { url: "os/nanda/index.jsonld",              type: "dcat:Catalog",                                     name: "Project NANDA agent index — the Internet of AI Agents projection (ADR-034)" },
  { url: "os/skills/index.jsonld",             type: "dcat:Catalog",                                     name: "Agent Skills index — the agentskills.io / Hermes projection (ADR-035)" },
  { url: "os/a2a/index.jsonld",                type: "dcat:Catalog",                                     name: "Agent2Agent (A2A) card directory — the horizontal agent↔agent projection (ADR-036)" },
  { url: "os/agenttrust/index.jsonld",         type: "dcat:Catalog",                                     name: "Holo AgentTrust — content-addressed, append-only agent reputation chains (ADR-039)" },
  { url: "os/delegate/index.jsonld",           type: "dcat:Catalog",                                     name: "Holo Delegate — content-addressed UCAN capability chains (scoped, revocable authority) (ADR-042)" },
  { url: "os/orchestrate/index.jsonld",        type: "dcat:Catalog",                                     name: "Holo Orchestrate — verifiable multi-agent work receipts (content-addressed execution DAGs) (ADR-045)" },
  { url: "os/settle/index.jsonld",             type: "dcat:Catalog",                                     name: "Holo Settle — verifiable settlement: pay agents against proven work (x402-NP over content-addressed receipts) (ADR-048)" },
  { url: "os/.well-known/agents.json",         type: ["schema:WebAPI", "prov:Entity"],                   name: "Holo Agents — the unified agent discovery entry point: every door (MCP · NANDA · A2A · Skills) + the agent-stack verbs (ADR-049)" },
  { url: "os/ns/conformance.jsonld",           type: "owl:Ontology",                                     name: "The hosc: vocabulary — the OS's one minted namespace, published as JSON-LD (ADR-024 A25)" },
];

export function buildRepoGraph() {
  const codemeta = J("codemeta.json");
  // ensure the @context carries the prefixes the links use (CodeMeta 2.0 + schema/dcat/prov/owl).
  codemeta["@context"] = ["https://doi.org/10.5063/schema/codemeta-2.0",
    { schema: "https://schema.org/", dcat: "http://www.w3.org/ns/dcat#", prov: "http://www.w3.org/ns/prov#", owl: "http://www.w3.org/2002/07/owl#" }];
  codemeta["schema:hasPart"] = ROOTS.map((r) => ({ "@id": idOf(J(r.url)), "@type": r.type, "schema:name": r.name, "schema:url": r.url }));
  writeFileSync(join(ROOT, "codemeta.json"), JSON.stringify(codemeta, null, 2) + "\n");
  return codemeta["schema:hasPart"];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const parts = buildRepoGraph();
  console.log(`codemeta.json now links ${parts.length} roots into one graph:`);
  for (const p of parts) console.log(`  → ${p["@id"]}  (${p["schema:url"]})`);
}
