#!/usr/bin/env node
// fhs-graph-witness.mjs — proves the Hologram OS filesystem is a conformant, self-verifying
// GRAPH (not a flat tree). Reads every index.jsonld off disk and checks: each directory node
// self-verifies and the WHOLE DAG re-derives top-to-bottom (Law L5); a tampered node is refused
// (Merkle-DAG); the graph is navigable from one root κ; every node satisfies its W3C SHACL shape;
// it mints nothing outside the published hosfs: OWL ontology (ADR-024); it carries only standard
// vocab (dcat + prov + schema.org); and the Linux-path labels cover the canonical FHS 3.0 root.
//
// Authority (external): Linux Foundation FHS 3.0 · W3C SHACL · RDF Schema 1.1 / OWL 2 · schema.org
// + DCAT 3 + PROV-O · W3C DID Core · IETF RFC 8785 (JCS). Usage: node tools/fhs-graph-witness.mjs

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { verify, verifyDeep, jcs } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS2 = join(here, "../os");
const hexOf = (did) => String(did).split(":").pop();
const write = (r) => writeFileSync(join(here, "fhs-graph-witness.result.json"), JSON.stringify(r, null, 2) + "\n");

// ── collect every directory node (index.jsonld), skipping tooling/vendor dirs ──
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === "tools" || n === "node_modules" || n === ".git") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n === "index.jsonld") out.push(p);
  }
  return out;
}
// only OUR FHS directory nodes carry hosfs:fhs — ignore any other index.jsonld living in the tree
// (e.g. the a2a/nanda/skills/atlas interop catalogs under /srv) so the gate verifies the FHS graph only.
const nodes = walk(OS2).map((p) => JSON.parse(readFileSync(p, "utf8"))).filter((n) => n["hosfs:fhs"]);
const root = nodes.find((n) => n["hosfs:fhs"] === "/");

// rebuild the content-addressed store exactly as the engine would (hex → canonical JCS bytes).
const store = new Map();
for (const n of nodes) store.set(hexOf(n.id), Buffer.from(jcs(n), "utf8"));

// ── the published ontology + SHACL shape (the standards this graph answers to) ──
const vocab = JSON.parse(readFileSync(join(OS2, "usr/share/ns/fs.jsonld"), "utf8"));
const shape = JSON.parse(readFileSync(join(OS2, "usr/share/shapes/holo-fhs-shape.jsonld"), "utf8"));

// constraint-subset SHACL (minCount · hasValue · in · datatype) — the shape file is full, valid
// SHACL any engine can run; this enforces the subset in pure Node (same approach as A40).
function validateAgainstShape(obj, shp) {
  const errors = [];
  const valueOf = (id) => id === "schema:hasPart" ? obj.links : id === "@type" ? obj["@type"] : obj[id];
  for (const p of shp["sh:property"] || []) {
    const id = p["sh:path"]["@id"];
    const v = valueOf(id);
    const arr = Array.isArray(v) ? v : v == null ? [] : [v];
    if (p["sh:minCount"] != null && arr.length < p["sh:minCount"]) errors.push(`${id}: minCount`);
    if (p["sh:hasValue"] != null && !arr.includes(p["sh:hasValue"])) errors.push(`${id}: hasValue ${p["sh:hasValue"]}`);
    if (p["sh:in"] && !arr.every((x) => p["sh:in"]["@list"].includes(x))) errors.push(`${id}: in`);
    if (p["sh:datatype"]?.["@id"] === "xsd:string" && !arr.every((x) => typeof x === "string")) errors.push(`${id}: datatype`);
  }
  return { ok: errors.length === 0, errors };
}

const FHS_ROOT = ["/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/media", "/mnt", "/opt", "/proc", "/root", "/run", "/sbin", "/srv", "/sys", "/tmp", "/usr", "/var"];
const checks = {};

// 1 · the root self-verifies: its id re-derives from its own content (Law L1/L5).
checks.rootSelfVerifies = !!root && verify(root);
// 2 · the WHOLE DAG re-derives top-to-bottom — every directory node is a verified Merkle node.
const deep = verifyDeep(store, root);
checks.dagReDerives = deep.ok === true;
// 3 · every node, individually, self-verifies (deterministic, content-addressed).
checks.allNodesSelfVerify = nodes.every(verify);
// 4 · Merkle-DAG: a tampered node is refused, and the refusal reaches the root.
const store2 = new Map(store);
store2.set(hexOf(root.links[0].id), Buffer.from("tampered", "utf8"));
checks.tamperRefused = verifyDeep(store2, root).ok === false;
// 5 · navigable: following schema:hasPart from the one root reaches every node; every link resolves.
const seen = new Set();
(function navigate(n) {
  if (seen.has(n.id)) return;
  seen.add(n.id);
  for (const l of n.links || []) { const b = store.get(hexOf(l.id)); if (b) navigate(JSON.parse(b.toString("utf8"))); }
})(root);
checks.navigableFromRoot = seen.size === nodes.length;
// 6 · the hosfs: ontology is a published, dereferenceable OWL ontology.
checks.ontologyPublished = vocab["@type"] === "owl:Ontology" && vocab["@id"] === "https://hologram.os/ns/fs";
// 7 · mint-nothing: every hosfs: term any node uses is DEFINED (label+comment) in ns/fs.jsonld.
const graph = Array.isArray(vocab["@graph"]) ? vocab["@graph"] : [];
const defined = new Set(graph.map((t) => t["@id"]));
const wellFormed = graph.length > 0 && graph.every((t) => (t.label ?? t["rdfs:label"]) != null && (t.comment ?? t["rdfs:comment"]) != null);
const usedHosfs = new Set();
for (const n of nodes) {
  for (const k of Object.keys(n)) if (k.startsWith("hosfs:")) usedHosfs.add(k);
  for (const t of [].concat(n["@type"] || [])) if (typeof t === "string" && t.startsWith("hosfs:")) usedHosfs.add(t);
}
const missing = [...usedHosfs].filter((t) => !defined.has(t));
checks.mintNothing = wellFormed && missing.length === 0;
// 8 · standard vocab only: every node is a dcat:Catalog AND a prov:Collection (no bespoke container term).
checks.usesStandardVocab = nodes.every((n) => (n["@type"] || []).includes("dcat:Catalog") && (n["@type"] || []).includes("prov:Collection"));
// 9 · the W3C SHACL shape is well-formed and EVERY directory node satisfies it.
checks.shapeWellFormed = shape["@type"] === "sh:NodeShape" && Array.isArray(shape["sh:property"]);
const shapeErrors = nodes.flatMap((n) => validateAgainstShape(n, shape).errors.map((e) => `${n["hosfs:fhs"]} ${e}`));
checks.shapeValid = shapeErrors.length === 0;
// 10 · it mirrors the canonical Linux root: every FHS 3.0 top-level directory is present.
const paths = new Set(nodes.map((n) => n["hosfs:fhs"]));
const fhsMissing = FHS_ROOT.filter((d) => !paths.has(d));
checks.fhsComplete = fhsMissing.length === 0;

const witnessed = Object.values(checks).every(Boolean);
write({
  spec: "Hologram OS filesystem — the FHS root as one self-verifying, content-addressed semantic graph",
  authority: "Linux Foundation FHS 3.0 · W3C SHACL · RDF Schema 1.1 / OWL 2 · schema.org + DCAT 3 + PROV-O · W3C DID Core · IETF RFC 8785 (JCS)",
  witnessed,
  covers: witnessed ? ["fhs-graph", "uor-object", "shacl", "mint-nothing", "semantic-web", "ai-navigable"] : [],
  root: root?.id, nodes: nodes.length, dagDepth: deep.depth, fhsMissing, missing, shapeErrors, checks,
});

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`· root ${root?.id.slice(0, 30)}… · ${nodes.length} nodes · DAG depth ${deep.depth} · ${[...usedHosfs].length} hosfs: terms (all defined: ${missing.length === 0})`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ the Linux root is one self-verifying, AI-navigable semantic graph" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
