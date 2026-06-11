#!/usr/bin/env node
// wire-constitution.mjs — make the Hologram OS Constitution (ADR-033) easily DISCOVERABLE and
// READABLE by AI agents. The sealed, self-verifying UOR object lives at os/etc/constitution/ (the
// FHS home for system policy). This wires the agent-facing doors so an agent finds + reads it three
// canonical ways: (1) an MCP resource (resources/list → resources/read), (2) a /.well-known door
// (RFC 8615 — where agents look first), (3) the agents.json entry point. Idempotent.
//
//   node tools/wire-constitution.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS2 = join(here, "../os");
const wk = join(OS2, ".well-known");

// the sealed object's content address (Law L1) — re-derivable, immutable.
const obj = JSON.parse(readFileSync(join(OS2, "etc/constitution/constitution.uor.json"), "utf8"));
const CK = obj.root;
const PATH = "/etc/constitution/constitution.uor.json";
const NAME = "Hologram OS Constitution";
const DESC = "The immutable, self-verifying constitutional core of Hologram OS (ADR-033) — the perimeter every holospace and AI agent operates within. Machine-readable JSON-LD; re-derive its did:holo over the object's canonical content to verify it (Law L5, no server to trust). Human-readable text alongside it.";

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJSON = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
const done = [];

// 1 · MCP resource — the agent READ surface (resources/list → resources/read).
{
  const p = join(wk, "mcp.json"); const m = readJSON(p);
  m.resources = m.resources || [];
  if (!m.resources.some((r) => r.uri === CK)) {
    m.resources.unshift({ uri: CK, name: NAME, type: "odrl:Policy", description: DESC + ` Served at ${PATH}; human text at ${PATH.replace(/[^/]+$/, "CONSTITUTION.md")}.`, mimeType: "application/ld+json" });
    writeJSON(p, m); done.push("mcp.json resources[] (+1, now " + m.resources.length + ")");
  } else done.push("mcp.json — already present");
}

// 2 · /.well-known/constitution.json — the discovery DOOR (RFC 8615).
{
  const door = {
    "@context": { schema: "https://schema.org/", dcterms: "http://purl.org/dc/terms/", odrl: "http://www.w3.org/ns/odrl/2/", hosc: "https://hologram.os/ns/conformance#" },
    "@id": CK,
    "@type": ["odrl:Policy", "schema:CreativeWork"],
    "schema:name": NAME,
    "schema:description": DESC,
    "dcterms:conformsTo": "https://hologram.os/adr/0033-holo-constitution",
    "schema:url": PATH,
    "schema:encoding": [
      { "@type": "schema:MediaObject", "schema:encodingFormat": "application/ld+json", "schema:contentUrl": PATH, "schema:description": "the sealed UOR object — machine-readable + self-verifying" },
      { "@type": "schema:MediaObject", "schema:encodingFormat": "text/markdown", "schema:contentUrl": "/etc/constitution/CONSTITUTION.md", "schema:description": "the full human-readable text" },
    ],
    "schema:hasPart": [
      { "@type": "schema:Dataset", "schema:name": "amendments", "schema:url": "/etc/constitution/amendments.uor.json" },
      { "@type": "schema:Dataset", "schema:name": "proof", "schema:url": "/etc/constitution/proof.json" },
    ],
    "hosc:howToVerify": "Re-derive the did:holo over the object's canonical content; it MUST equal this @id (" + CK + "). No server is trusted (Law L5).",
  };
  writeJSON(join(wk, "constitution.json"), door); done.push(".well-known/constitution.json (written)");
}

// 3 · agents.json — the agent ENTRY POINT lists the constitution among the system's parts.
{
  const p = join(wk, "agents.json"); const a = readJSON(p);
  a["schema:hasPart"] = a["schema:hasPart"] || [];
  if (!a["schema:hasPart"].some((h) => h["schema:url"] === PATH)) {
    a["schema:hasPart"].unshift({ "@type": ["odrl:Policy", "schema:CreativeWork"], "schema:name": "constitution", "schema:identifier": CK, "schema:url": PATH, "schema:description": "the immutable, self-verifying constitutional core every agent operates within (ADR-033) — re-derive its κ to verify (Law L5)" });
    writeJSON(p, a); done.push("agents.json hasPart (+1, now " + a["schema:hasPart"].length + ")");
  } else done.push("agents.json — already present");
}

console.log(`✓ Constitution wired for AI agents — κ ${CK.slice(0, 30)}…`);
for (const d of done) console.log("  · " + d);
console.log("  served at " + PATH + " (FHS /etc passthrough) · door at /.well-known/constitution.json · MCP resource + agents.json entry");
