#!/usr/bin/env node
// seal-qvac.mjs — materialize the QVAC SDK (ADR-0067) into the substrate as a SELF-VERIFYING UOR
// object. Writes two files from the one source (holo-qvac.mjs):
//
//   1 · os/usr/share/ns/qvac.jsonld          — the dereferenceable hosqvac: OWL ontology + SKOS scheme.
//   2 · os/etc/holo-qvac/qvac.uor.json       — the sealed contract: it embeds the 13 capabilities, the
//        runtime + model + server surface, and Merkle-LINKS by content address the source, the runtime
//        façade, the ontology, the conscience gate it binds (constitution-bound), and the front doors
//        (the SDK + the scaffolder). Its did re-derives (Law L5); change any linked file and the κ moves.
//
// Deterministic + re-runnable. Re-run after editing holo-qvac.mjs / holo-qvac.js / the wired doors.
//   node tools/seal-qvac.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CAPABILITIES, RUNTIMES, SERVER_ROUTES, RUNTIME_API, P2P_API, MODEL_API, allSymbols, PROVENANCE, toOntology } from "../os/usr/lib/holo/holo-qvac.mjs";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { makeObject, contentLink } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const read = (rel) => readFileSync(join(OS, rel));

// 1 · the ontology materialization ────────────────────────────────────────────────────────────────
const ontology = toOntology();
writeFileSync(join(OS, "usr/share/ns/qvac.jsonld"), JSON.stringify(ontology, null, 2) + "\n");

// 2 · the sealed contract — links every realizing file by content address ───────────────────────────
const leaf = (rel, p, type = "schema:MediaObject") => contentLink(rel, `did:holo:sha256:${sha256hex(read(p))}`, type);
const links = [
  leaf("hosqvac:source", "usr/lib/holo/holo-qvac.mjs", "schema:SoftwareSourceCode"),
  leaf("hosqvac:runtime", "usr/lib/holo/holo-qvac.js", "schema:SoftwareSourceCode"),
  leaf("hosqvac:ontology", "usr/share/ns/qvac.jsonld", "schema:DigitalDocument"),
  // the conscience gate every capability call passes through — the contract is constitution-bound.
  leaf("hosqvac:conscience", "usr/lib/holo/holo-conscience.js", "schema:SoftwareSourceCode"),
  // the front doors: the SDK exposes qvac(); the scaffolder builds QVAC apps on the contract.
  leaf("hosqvac:sdk", "usr/lib/holo/holo-sdk.js", "schema:SoftwareSourceCode"),
  leaf("hosqvac:scaffold", "usr/lib/holo/holo-scaffold.js", "schema:SoftwareSourceCode"),
];

const provisioned = CAPABILITIES.filter((c) => c.provisioned).length;

const obj = makeObject(new Map(), {
  type: ["schema:SoftwareApplication", "prov:Entity", "skos:Collection"],
  context: [{ skos: "http://www.w3.org/2004/02/skos/core#", hosqvac: "https://hologram.os/ns/qvac#", hosc: "https://hologram.os/ns/conformance#" }],
  "schema:name": "QVAC SDK — Tether's local AI SDK, encoded native to Hologram OS",
  "schema:description": "Why: a builder should write QVAC code and have it run on the substrate — beautiful, fast, lean, serverless. How: this one self-verifying object encodes the QVAC contract (13 AI capabilities, the runtime + model lifecycle, P2P delegation, the OpenAI-compatible server) and binds the files that satisfy it — the source, the runtime façade, the conscience gate, and the front doors. What: every capability call is conscience-gated, runs on the substrate, and seals a re-derivable receipt; re-derive this did and each link to verify (Law L5).",
  "schema:softwareVersion": "1.0",
  "schema:license": "https://www.apache.org/licenses/LICENSE-2.0",
  "dcterms:conformsTo": "https://hologram.os/ns/qvac",
  "dcterms:source": "https://docs.qvac.tether.io/",
  "dcterms:license": "https://creativecommons.org/publicdomain/zero/1.0/",
  "hosqvac:provenance": PROVENANCE,
  "hosqvac:capabilities": CAPABILITIES.map((c) => ({ "@id": `hosqvac:${c.id}`, prefLabel: c.label, api: c.api, modelType: c.modelType, provisioned: c.provisioned, "hosqvac:obligation": c.obligation })),
  "hosqvac:provisioned": { total: CAPABILITIES.length, live: provisioned },
  "hosqvac:runtimes": RUNTIMES.map((r) => ({ "@id": `hosqvac:runtime-${r.id}`, prefLabel: r.label, upstream: r.upstream })),
  "hosqvac:server": SERVER_ROUTES,
  "hosqvac:symbols": allSymbols(),
  "hosc:authority": "QVAC SDK (docs.qvac.tether.io, Apache-2.0) · holospaces Laws L1/L2/L4/L5 (github.com/Hologram-Technologies/holospaces) · W3C PROV-O · W3C DID Core · IETF RFC 8785 (JCS) · W3C OWL 2 / RDFS / SKOS · UOR-ADDR (κ = H(canonical_form)) · verify by re-derivation (Law L5)",
  "hosc:witness": "tools/qvac-witness.mjs",
  links,
});

mkdirSync(join(OS, "etc/holo-qvac"), { recursive: true });
writeFileSync(join(OS, "etc/holo-qvac/qvac.uor.json"), JSON.stringify(obj, null, 2) + "\n");

console.log(`sealed QVAC SDK`);
console.log(`  ns/qvac.jsonld     — ${ontology["@graph"].length} terms (${CAPABILITIES.length} capabilities · ${allSymbols().length} symbols)`);
console.log(`  qvac.uor.json      — ${obj.id}`);
console.log(`  provisioned        — ${provisioned}/${CAPABILITIES.length} capabilities run on the substrate now (reference floor); the rest are gated + honest`);
console.log(`  links              — ${links.length} files (re-derive to verify, Law L5)`);
