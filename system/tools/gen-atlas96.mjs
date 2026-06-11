#!/usr/bin/env node
// gen-atlas96.mjs — encode UOR-Foundation/atlas-12288 into the UOR substrate as the Holo Atlas 96
// holospace (Hologram Apps/apps/atlas96), then seal its κ-closure. This tool writes NO mathematics:
// it reads the VENDORED upstream source (verbatim, MIT) and projects its DOCUMENTED invariants into
//   1. apps/atlas96/atlas-12288.uor.jsonld — a self-verifying UOR object (DID-Core identity +
//      OWL classes + a SKOS scheme of the 96 R96 classes + PROV-O provenance + schema.org), whose
//      did:holo re-derives from its own content (Law L5) and which LINKS each vendored file by κ.
//   2. apps/atlas96/holospace.lock.json — the app closure: relpath → { κ · SRI · multibase · bytes },
//      with `root` = the app's did:holo committing to the whole closure (mirrors tools/build-app.mjs).
//
// All content-addressing comes from the canonical substrate primitives (holo-uor.mjs / holo-object.mjs),
// imported, never re-derived here. Determinism: identical bytes ⇒ identical κ ⇒ identical addresses.
//
//   node tools/gen-atlas96.mjs

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { pathToFileURL } from "node:url";

const HOLOGRAM_OS = "C:/Users/pavel/Desktop/hologram-os/os";
const APPS_REPO   = "C:/Users/pavel/Desktop/Hologram Apps";
const APP_DIR     = join(APPS_REPO, "apps", "atlas96");
const VENDOR      = join(APP_DIR, "vendor", "atlas-12288");

// the ONE content-addressing primitive + the UOR object envelope — imported from the substrate.
const { sha256hex, sriOf, mbSha256 } = await import(pathToFileURL(join(HOLOGRAM_OS, "holo-uor.mjs")));
const { makeObject, contentLink, address, jcs } = await import(pathToFileURL(join(HOLOGRAM_OS, "holo-object.mjs")));

const TYPE = { ".html": "schema:WebPage", ".js": "schema:SoftwareSourceCode", ".mjs": "schema:SoftwareSourceCode",
  ".css": "schema:SoftwareSourceCode", ".c": "schema:SoftwareSourceCode", ".h": "schema:SoftwareSourceCode",
  ".ts": "schema:SoftwareSourceCode", ".lean": "schema:SoftwareSourceCode", ".md": "schema:CreativeWork",
  ".txt": "schema:CreativeWork", ".json": "schema:Dataset", ".jsonld": "schema:Dataset",
  ".svg": "schema:ImageObject", ".png": "schema:ImageObject", ".wasm": "schema:SoftwareApplication" };
const typeOf = (p) => TYPE[extname(p).toLowerCase()] || "schema:MediaObject";
const walk = (dir, out = []) => { for (const n of readdirSync(dir).sort()) { const p = join(dir, n);
  statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; };
const relApp = (p) => "apps/atlas96/" + relative(APP_DIR, p).split("\\").join("/");
const kOf = (rel) => `did:holo:sha256:${sha256hex(readFileSync(join(VENDOR, rel)))}`;

// ── 1. the sealed semantic object ───────────────────────────────────────────────────────────────
// Every fact below is DOCUMENTED in the vendored source (Structure.lean / uor_ffi.h / mathematics.md);
// nothing is computed by new mathematics. The R96 partition merely enumerates the documented map
// classifyByte(b) = b % 96 (UOR.Prime.Structure) — its provenance is pinned to that source κ.
const R96 = 96, BYTES = 256, PAGES = 48;
const classes = Array.from({ length: R96 }, (_, c) => {
  const members = [];
  for (let b = 0; b < BYTES; b++) if (b % R96 === c) members.push(b);   // the documented surjection [0,255]→[0,95]
  return { "@id": `a12:r96-${c}`, "@type": "skos:Concept", "skos:inScheme": { "@id": "a12:R96Scheme" },
    "skos:notation": c, "skos:prefLabel": `R96[${c}]`, "a12:bytes": members };
});

// leaf links: the sealed object commits to the EXACT vendored bytes (Merkle continuity, Law L5).
const VENDORED = ["LICENSE", "ffi/c/minimal_wrapper.c", "ffi/c/uor_ffi.h", "pkg/node/lib/index.js",
  "pkg/node/lib/index.d.ts", "lean/UOR/Prime/Structure.lean", "lean/UOR/Atlas/Core.lean",
  "docs/guides/mathematics.md", "PROVENANCE.txt"];
const sourceLinks = VENDORED.map((rel) => ({
  ...contentLink("schema:hasPart", kOf(rel).replace("did:holo:", ""), typeOf(rel)),
  "schema:name": `vendor/atlas-12288/${rel}` }));

const structureKappa = kOf("lean/UOR/Prime/Structure.lean");
const classifierProv = { "@type": "prov:Entity", "@id": `did:holo:sha256:${structureKappa.split(":").pop()}`,
  "schema:name": "UOR.Prime.Structure.classifyByte", "rdfs:comment": "classifyByte(b) = b % 96 (verbatim, Lean 4)" };

const semantic = makeObject(new Map(), {
  type: ["owl:Ontology", "schema:Dataset", "prov:Entity"],
  context: [{
    owl: "http://www.w3.org/2002/07/owl#", rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    skos: "http://www.w3.org/2004/02/skos/core#", xsd: "http://www.w3.org/2001/XMLSchema#",
    hosc: "https://hologram.os/ns/conformance#", a12: "https://hologram.os/ns/atlas-12288#",
  }],
  "dcterms:title": "Φ-Atlas-12288 — the UOR Prime Structure, encoded as a self-verifying UOR object",
  "dcterms:description": "The 12,288-element boundary (48 pages × 256 bytes) of the UOR holographic " +
    "system, compressed by R96 into 96 resonance classes (3/8). Projected — NOT re-implemented — from " +
    "the verbatim UOR-Foundation/atlas-12288 source, each file of which is linked here by its content κ.",
  "schema:identifier": "atlas-12288",
  "schema:isBasedOn": { "@id": "https://github.com/UOR-Foundation/atlas-12288",
    "schema:version": "aef42a6fd5c323373222b6362050b439690136a1", "schema:license": "MIT" },

  // documented constants (Structure.lean / uor_ffi.h / mathematics.md), as typed literals
  "a12:pages": PAGES,
  "a12:bytesPerPage": BYTES,
  "a12:totalElements": 12288,
  "a12:resonanceClasses": R96,
  "a12:compressionRatio": "3/8",
  "a12:factorization": { "total": "2^12 × 3", "pages": "2^4 × 3", "bytes": "2^8", "classes": "3 × 2^5" },
  "a12:unityConstraint": "α₄α₅ = 1",
  "a12:phiEncode": "Φ(page, byte) = (page << 8) | byte",
  "a12:phiDecode": { "page": "code >> 8", "byte": "code & 0xFF" },
  "a12:conservation": "truth ≙ conservation: truth(budget) ↔ budget = 0; truth_add(a,b) ↔ a + b = 0",

  // OWL classes — the boundary vocabulary
  "owl:imports": [],
  "a12:defines": [
    { "@id": "a12:PrimeStructure", "@type": "owl:Class", "rdfs:label": "Prime Structure",
      "rdfs:comment": "The 12,288-element boundary object (48×256) with R96 compression." },
    { "@id": "a12:Page", "@type": "owl:Class", "rdfs:label": "Page", "rdfs:comment": "One of 48 pages; ℤ₄₈." },
    { "@id": "a12:Byte", "@type": "owl:Class", "rdfs:label": "Byte", "rdfs:comment": "One of 256 bytes per page; ℤ₂₅₆." },
    { "@id": "a12:BoundaryElement", "@type": "owl:Class", "rdfs:label": "Boundary Element",
      "rdfs:comment": "A (page, byte) coordinate; one of the 12,288 elements, Φ-encodable to a 32-bit code." },
    { "@id": "a12:ResonanceClass", "@type": "owl:Class", "rdfs:subClassOf": { "@id": "skos:Concept" },
      "rdfs:label": "Resonance Class", "rdfs:comment": "One of 96 R96 classes; the codomain of classifyByte." },
  ],

  // the 96 resonance classes as a SKOS concept scheme (derived from the documented classifier)
  "a12:R96Scheme": { "@id": "a12:R96Scheme", "@type": "skos:ConceptScheme",
    "dcterms:title": "R96 — the 96 resonance classes", "skos:hasTopConcept": classes.map((c) => ({ "@id": c["@id"] })),
    "prov:wasDerivedFrom": classifierProv },
  "skos:member": classes,

  // the discrete torus (structural reading) + the working hypothesis (clearly NOT a theorem)
  "a12:torus": { "@type": ["owl:Class", "schema:StructuredValue"],
    "rdfs:label": "Discrete torus T² = ℤ₄₈ × ℤ₂₅₆",
    "rdfs:comment": "The boundary's periodic (cyclic) page and byte axes (mathematics.md §Topology) make " +
      "it a discrete 2-torus with 12,288 lattice points; R96 quotients the byte fiber into 96 classes." },
  "hosc:hypothesis": { "@type": "prov:Entity", "schema:name": "96-vertex / 12,288 torus as LLM latent topology",
    "schema:disambiguatingDescription": "WORKING HYPOTHESIS, not a proven property of atlas-12288: that this " +
      "torus is a coordinate system for the topological space every LLM maps into. Recorded as a claim to be " +
      "tested; it asserts nothing about the verified upstream mathematics.",
    "prov:wasAttributedTo": { "@id": "org.hologram", "schema:name": "Hologram Technologies" } },

  // PROV-O: where the structure comes from
  "prov:wasGeneratedBy": { "@type": "prov:Activity", "schema:name": "Lean 4 formal verification (UOR-Foundation)" },
  "prov:wasDerivedFrom": { "@id": "https://github.com/UOR-Foundation/atlas-12288",
    "@type": "prov:Entity", "dcterms:license": "https://spdx.org/licenses/MIT.html" },

  links: sourceLinks,
});

writeFileSync(join(APP_DIR, "atlas-12288.uor.jsonld"), JSON.stringify(semantic, null, 2) + "\n");

// ── 2. the κ-closure lock (mirrors build-app.mjs computeApp) ──────────────────────────────────────
const def = JSON.parse(readFileSync(join(APP_DIR, "holospace.json"), "utf8"));
const closure = {}, links = [];
for (const p of walk(APP_DIR)) {
  if (p.endsWith("holospace.lock.json")) continue;          // the lock is the output, not part of its own closure
  const rel = relApp(p), bytes = readFileSync(p), hex = sha256hex(bytes);
  closure[rel] = { kappa: `did:holo:sha256:${hex}`, sri: sriOf(bytes), multibase: mbSha256(bytes), bytes: bytes.length };
  links.push({ ...contentLink("schema:hasPart", `sha256:${hex}`, typeOf(rel)), "schema:name": rel });
}
links.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const root = makeObject(new Map(), {
  type: [...(def.type || ["schema:SoftwareApplication"]), "prov:Entity"],
  context: [{ hosc: "https://hologram.os/ns/conformance#" }],
  "schema:name": def.name, "schema:description": def.summary, "schema:applicationCategory": def.applicationCategory,
  "schema:identifier": def.id, "schema:featureList": def.conforms?.specs || [], "hosc:capabilities": def.capabilities,
  "prov:wasGeneratedBy": { "@id": "https://hologram.os/tools/gen-atlas96" },
  links,
});
const lock = { "@context": { dcterms: "http://purl.org/dc/terms/" },
  root: root.id, identifier: def.id, algo: "sha256", files: Object.keys(closure).length, closure };
writeFileSync(join(APP_DIR, "holospace.lock.json"), JSON.stringify(lock, null, 2) + "\n");

// ── 3. self-witness (Law L5) ──────────────────────────────────────────────────────────────────────
const reread = JSON.parse(readFileSync(join(APP_DIR, "atlas-12288.uor.jsonld"), "utf8"));
const { id, ...content } = reread;
const idOk = id === address(content);
let bytesOk = true; for (const [rel, m] of Object.entries(closure)) {
  const re = `did:holo:sha256:${sha256hex(readFileSync(join(APPS_REPO, rel)))}`; if (re !== m.kappa) bytesOk = false; }
console.log(`✓ atlas-12288.uor.jsonld sealed → ${id}`);
console.log(`  semantic id re-derives (Law L5): ${idOk ? "YES" : "NO"}  ·  96 SKOS concepts · ${VENDORED.length} source links`);
console.log(`✓ holospace.lock.json → root ${root.id}`);
console.log(`  ${Object.keys(closure).length} files, every κ re-hashes from bytes: ${bytesOk ? "YES" : "NO"}`);
if (!idOk || !bytesOk) process.exit(1);
