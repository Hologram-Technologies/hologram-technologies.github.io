#!/usr/bin/env node
// seal-pm.mjs — materialize Holo Product Manager (ADR-0066) into the substrate as a SELF-VERIFYING
// UOR object: the full-cycle PM framework (Pragmatic) that ORCHESTRATES the existing tools. Writes:
//   1 · os/usr/share/ns/pm.jsonld        — the dereferenceable hospm: OWL ontology + SKOS framework.
//   2 · os/etc/holo-pm/pm.uor.json       — the sealed framework: embeds the 7 categories + 37 boxes +
//        the principle/mantras + the wiring coverage, and Merkle-LINKS the Holo Product foundation it
//        manages AND every distinct tool an activity is wired to (by content address). Re-derives (L5).
//
// Re-run after editing holo-pm.mjs or any wired tool. Deterministic + re-runnable.
//   node tools/seal-pm.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PRINCIPLE, MANTRAS, CATEGORIES, ACTIVITIES, TOTAL, wiredActivities, toOntology } from "../os/usr/lib/holo/holo-pm.mjs";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { makeObject, contentLink } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const read = (rel) => readFileSync(join(OS, rel));
const slug = (p) => p.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");

// 1 · ontology ──────────────────────────────────────────────────────────────────────────────────────
const ontology = toOntology();
writeFileSync(join(OS, "usr/share/ns/pm.jsonld"), JSON.stringify(ontology, null, 2) + "\n");

// 2 · the sealed framework ────────────────────────────────────────────────────────────────────────────
const leaf = (rel, p, type = "schema:MediaObject") => contentLink(rel, `did:holo:sha256:${sha256hex(read(p))}`, type);
const wiredTools = [...new Set(wiredActivities().map((a) => a.realizedBy))].sort();   // distinct tools, deduped (Law L3)
const links = [
  leaf("hospm:source", "usr/lib/holo/holo-pm.mjs", "schema:SoftwareSourceCode"),
  leaf("hospm:ontology", "usr/share/ns/pm.jsonld", "schema:DigitalDocument"),
  leaf("hospm:foundation", "etc/holo-product/product.uor.json", "schema:CreativeWork"),   // the Holo Product it manages
  ...wiredTools.map((p) => leaf(`hospm:tool:${slug(p)}`, p, "schema:SoftwareSourceCode")),
];

const perCat = Object.fromEntries(CATEGORIES.map((c) => [c.id, ACTIVITIES.filter((a) => a.cat === c.id).length]));
const wiredCount = wiredActivities().length;

const obj = makeObject(new Map(), {
  type: ["schema:CreativeWork", "prov:Entity", "skos:Collection"],
  context: [{ skos: "http://www.w3.org/2004/02/skos/core#", hospm: "https://hologram.os/ns/pm#", hosc: "https://hologram.os/ns/conformance#" }],
  "schema:name": "Holo Product Manager — the canonical full-cycle PM framework for Hologram-native products",
  "schema:description": "Why: a great product is a full cycle — from a real market problem, through plan and build, to launch and support — and it needs one coordinated framework, not scattered tools. How: this one self-verifying object adopts the Pragmatic Framework verbatim (37 activities in 7 categories, a clear path from idea to product) and WIRES each activity Hologram realizes to the tool that does it (Holo UX · UI · Product · Share-to-Run · Own · App · the gate), so the framework is executed, not just described. What: the bridge that turns ideas into scalable, enterprise-grade products that solve real pain points — re-derive this did and each linked tool to verify (Law L5).",
  "schema:softwareVersion": "1.0",
  "dcterms:conformsTo": "https://hologram.os/ns/pm",
  "dcterms:source": "https://www.pragmaticinstitute.com/product/framework/",
  "dcterms:license": "https://creativecommons.org/publicdomain/zero/1.0/",
  "hospm:principle": PRINCIPLE,
  "hospm:mantras": MANTRAS,
  "hospm:categories": CATEGORIES.map((c) => ({ "@id": `hospm:${c.id}`, prefLabel: c.label, axis: c.axis, facing: c.facing })),
  "hospm:activities": ACTIVITIES.map((a) => ({ "@id": `hospm:${a.id}`, broader: `hospm:${a.cat}`, prefLabel: a.label, ...(a.realizedBy ? { "hospm:realizedBy": a.realizedBy } : {}), "hospm:obligation": a.obligation })),
  "hospm:coverage": { categories: CATEGORIES.length, activities: TOTAL, perCategory: perCat, wired: wiredCount, distinctTools: wiredTools.length },
  "hosc:authority": "ADR-0066 (Holo Product Manager) · the Pragmatic Framework (pragmaticinstitute.com/product/framework, cited verbatim) · ADR-0065 (Holo Product) · ADR-0062/0030/0057 (Holo UX/UI) · ADR-0064 (Share-to-Run) · ADR-0053 (Own/Settle) · W3C OWL 2 / RDFS / SKOS · UOR-ADDR (κ = H(canonical_form)) · verify by re-derivation (Law L5)",
  "hosc:witness": "tools/holo-pm-witness.mjs",
  links,
});

mkdirSync(join(OS, "etc/holo-pm"), { recursive: true });
writeFileSync(join(OS, "etc/holo-pm/pm.uor.json"), JSON.stringify(obj, null, 2) + "\n");

console.log(`sealed Holo Product Manager`);
console.log(`  ns/pm.jsonld     — ${ontology["@graph"].length} terms (${CATEGORIES.length} categories · ${TOTAL} activities)`);
console.log(`  pm.uor.json      — ${obj.id}`);
console.log(`  per category     — ${CATEGORIES.map((c) => c.label + ":" + perCat[c.id]).join(" · ")} = ${TOTAL}`);
console.log(`  wired            — ${wiredCount}/${TOTAL} activities → ${wiredTools.length} distinct tools (+ the Holo Product foundation)`);
