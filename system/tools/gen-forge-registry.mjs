#!/usr/bin/env node
// gen-forge-registry.mjs — build the content-addressed Holo Forge library registry
// (os/usr/lib/holo/holo-forge/registry.uor.json) from the holo-std/*.hc sources. Each library is
// pinned by the κ of its exact bytes; the registry is a sealed UOR object (ADR-025) that LINKS to
// every library source (Law L5 Merkle-DAG) and embeds it so a browser fetches one file and verifies
// each source against its κ before linking. Exports are the function definitions in each source.
//
//   node tools/gen-forge-registry.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { makeObject } from "../os/sbin/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const STD = join(here, "../os/usr/lib/holo/holo-forge/std");
const OUT = join(here, "../os/usr/lib/holo/holo-forge/registry.uor.json");

// the registry manifest: name → file + declared dependencies (deps resolved by content address).
const MANIFEST = [
  { name: "math", version: "1.0.0", file: "math.hc", deps: [], desc: "integer math primitives" },
  { name: "prime", version: "1.0.0", file: "prime.hc", deps: ["math"], desc: "primality + prime enumeration" },
  { name: "combo", version: "1.0.0", file: "combo.hc", deps: ["math"], desc: "combinatorics" },
];

const exportsOf = (src) => [...src.matchAll(/^\s*int\s+([A-Za-z_]\w*)\s*\(/gm)].map((m) => m[1]);

const store = new Map();
const libraries = [];
const links = [];
for (const m of MANIFEST) {
  const bytes = readFileSync(join(STD, m.file));
  const source = bytes.toString("utf8");
  const hex = sha256hex(bytes);
  const sourceKappa = `did:holo:sha256:${hex}`;
  libraries.push({ name: m.name, version: m.version, "schema:description": m.desc, deps: m.deps, exports: exportsOf(source), sourceKappa, source });
  links.push({ id: sourceKappa, rel: "schema:hasPart", "@type": "schema:SoftwareSourceCode", leaf: true,
    digestSRI: "sha256-" + Buffer.from(hex, "hex").toString("base64"),
    digestMultibase: "u" + Buffer.concat([Buffer.from([0x12, 0x20]), Buffer.from(hex, "hex")]).toString("base64url"),
    "schema:name": `holo-std/${m.name}` });
}
links.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const registry = makeObject(store, {
  type: ["schema:DataCatalog", "hosc:LibraryRegistry", "prov:Collection"],
  context: [{ hosc: "https://hologram.os/ns/conformance#" }],
  "schema:name": "Holo Forge — content-addressed library registry",
  "schema:description": "A verifiable package universe: each Holo-C library is addressed by the κ of its bytes; dependencies are resolved by content address, shared libraries are linked once (Law L3), and the whole graph re-derives byte-for-byte (Law L5). No registry server, no npm.",
  algo: "sha256",
  libraries,
  links,
});

writeFileSync(OUT, JSON.stringify(registry, null, 2) + "\n");
console.log(`registry: ${registry.id}`);
for (const l of libraries) console.log(`  ${l.name}@${l.version}  ${l.sourceKappa.slice(0, 26)}…  deps=[${l.deps}]  exports=[${l.exports}]`);
