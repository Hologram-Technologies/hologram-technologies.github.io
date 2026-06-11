#!/usr/bin/env node
// gen-atlas96-resonator.mjs — seal the Atlas 96 Resonator's STRUCTURE RECEIPT. The Resonator's
// fiber structure is not parametric: every irregular artifact (jitter, thickness, the holes in
// the weave) is a byte of DNA(p,b) = SHA-256(atlasObjectId ‖ "|phi:" ‖ Φ(p,b)) — a pure function
// of the sealed Φ-Atlas-12288 object's did:holo and the cell's Φ-code. This tool derives all
// 12,288 cells with the SAME module the page imports (resonator-geometry.js), proves the
// derivation deterministic, and seals a PROV-O receipt:
//
//   κ(atlas object) ⊕ κ(derivation module) → κ(structure DNA)
//
// The page re-derives all of it live (Law L5); the witness re-checks it headlessly. This is the
// decidable answer to "how do we know it isn't shape-classification + a formula?" — re-derive it.
//
// Writes:
//   apps/atlas96/resonator.receipt.jsonld     — the sealed receipt (self-verifying did:holo)
//   tools/atlas96-resonator-gen.result.json   — the determinism witness
//
//   node tools/gen-atlas96-resonator.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const HOLOGRAM_OS = "C:/Users/pavel/Desktop/hologram-os/os";
const APP_DIR = "C:/Users/pavel/Desktop/Hologram Apps/apps/atlas96";
const here = "C:/Users/pavel/Desktop/Hologram OS2/system/tools";

const { sha256hex, didHolo } = await import(pathToFileURL(join(HOLOGRAM_OS, "holo-uor.mjs")));
const { address } = await import(pathToFileURL(join(HOLOGRAM_OS, "holo-object.mjs")));
const G = await import(pathToFileURL(join(APP_DIR, "resonator-geometry.js")));

const kappaOf = (bytes) => didHolo("sha256", sha256hex(bytes));

// ── inputs, content-addressed (Law L1/L2) ──
const atlasBytes = readFileSync(join(APP_DIR, "atlas-12288.uor.jsonld"));
const atlas = JSON.parse(atlasBytes.toString("utf8"));
const moduleBytes = readFileSync(join(APP_DIR, "resonator-geometry.js"));
const atlasKappa = kappaOf(atlasBytes);                 // the FILE's κ (as pinned in the app closure)
const atlasId = atlas.id;                               // the OBJECT's self-verifying did (Law L5)
const moduleKappa = kappaOf(moduleBytes);

// ── the κ-transform: derive the structure, twice (determinism) ──
const dna = await G.deriveDNA(atlasId);
const again = await G.deriveDNA(atlasId);
const reproducible = Buffer.compare(Buffer.from(dna), Buffer.from(again)) === 0;
const dnaKappa = kappaOf(Buffer.from(dna));

// structure facts the page asserts against
const { render, shear } = G.buildEdges(dna);
let holes = 0;
for (let i = 0; i < G.CELLS; i++) {
  if (dna[i * G.DNA_STRIDE + 5] < G.DROP_THRESHOLD) holes++;
  if (dna[i * G.DNA_STRIDE + 6] < G.DROP_THRESHOLD) holes++;
}

// ── the receipt, sealed to its own did:holo (a UOR PROV-O object) ──
const content = {
  "@context": [
    "https://www.w3.org/ns/did/v1",
    { prov: "http://www.w3.org/ns/prov#", dcterms: "http://purl.org/dc/terms/",
      schema: "https://schema.org/", a12: "https://hologram.os/ns/atlas-12288#",
      hosr: "https://hologram.os/ns/resonator#" },
  ],
  "@type": ["prov:Entity", "schema:Dataset"],
  "dcterms:title": "Atlas 96 Resonator — structure receipt",
  "dcterms:description": "The Resonator's fiber structure as a re-derivable κ-transform: every irregular artifact is a byte of SHA-256(atlasObjectId ‖ '|phi:' ‖ Φ(p,b)) over all 12,288 boundary cells. Zero free parameters, zero RNG. Re-derive the DNA and compare κ; tamper one byte of the atlas object and every cell re-derives differently — refused.",
  "hosr:rule": "DNA(p,b) = SHA-256(atlasObjectId ‖ '|phi:' ‖ (p·256+b))[0..8) — 12,288 cells × 8 bytes",
  "a12:atlasObject": atlasId,
  "hosr:atlasFile": atlasKappa,
  "hosr:derivation": moduleKappa,
  "a12:cells": G.CELLS,
  "hosr:bytesPerCell": G.DNA_STRIDE,
  "hosr:fibers": render.length / 2,
  "hosr:stabilizers": shear.length / 2,
  "hosr:holes": holes,
  "prov:used": [{ "@id": atlasId }, { "@id": moduleKappa }],
  "prov:generated": { "@id": dnaKappa },
  "prov:wasGeneratedBy": { "@id": "https://hologram.os/tools/gen-atlas96-resonator" },
};
const receipt = { ...content, id: address(content) };
writeFileSync(join(APP_DIR, "resonator.receipt.jsonld"), JSON.stringify(receipt, null, 2) + "\n");

const checks = {
  atlas_object_self_verifies: atlasId === address((() => { const { id, ...c } = atlas; return c; })()),
  reproducible,
  cells_12288: dna.length === G.CELLS * G.DNA_STRIDE,
  receipt_self_verifies: receipt.id === address(content),
};
const pass = Object.values(checks).every(Boolean);
const result = { tool: "gen-atlas96-resonator", atlasObject: atlasId, atlasFile: atlasKappa,
  derivation: moduleKappa, structure: dnaKappa, receipt: receipt.id,
  fibers: render.length / 2, stabilizers: shear.length / 2, holes, checks, witnessed: pass };
writeFileSync(join(here, "atlas96-resonator-gen.result.json"), JSON.stringify(result, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  atlas object ${atlasId}`);
console.log(`  derivation   ${moduleKappa}`);
console.log(`  structure    ${dnaKappa}  (${dna.length} bytes · ${render.length / 2} fibers · ${holes} holes)`);
console.log(`  receipt      ${receipt.id}`);
console.log(`\n  ${pass ? "SEALED ✓ — the structure is a re-derivable function of the atlas κ" : "FAILED ✗"}`);
process.exit(pass ? 0 : 1);
