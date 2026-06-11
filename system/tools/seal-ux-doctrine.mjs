#!/usr/bin/env node
// seal-ux-doctrine.mjs — materialize the Holo UX doctrine (ADR-0062) into the substrate as a
// SELF-VERIFYING UOR object, the experience analogue of how Holo UI's tokens are the one canonical
// source. It writes TWO files from the one source (holo-ux-doctrine.mjs):
//
//   1 · os/usr/share/ns/ux.jsonld          — the dereferenceable hosux: OWL ontology + SKOS doctrine.
//   2 · os/etc/holo-ux/doctrine.uor.json   — the sealed canonical UX object: it embeds the 13 tenets,
//        the FAITHFUL native-OS profile matrix (driven through the real HoloPlatform resolver), the
//        capability tiers + the resource budget, and Merkle-LINKS the canonical source files by
//        content address. Its did re-derives (Law L5) and a tampered linked byte breaks the address.
//
// Deterministic + re-runnable (no timestamps / no randomness), like seal-greeter.mjs.
//   node tools/seal-ux-doctrine.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TENETS, PLATFORM_OSES, navFor, toOntology } from "../os/usr/lib/holo/holo-ux-doctrine.mjs";
import { profileFor } from "../os/usr/lib/holo/holo-platform.js";
import { TIERS, resolveTier, tierSettings } from "../os/usr/lib/holo/holo-capability.mjs";
import { JARGON } from "../os/usr/lib/holo/holo-voice.mjs";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { makeObject, contentLink } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const read = (rel) => readFileSync(join(OS, rel));

// 1 · the ontology materialization (the dereferenceable hosux: vocabulary) ───────────────────────
const ontology = toOntology();
writeFileSync(join(OS, "usr/share/ns/ux.jsonld"), JSON.stringify(ontology, null, 2) + "\n");

// 2 · the sealed doctrine object ──────────────────────────────────────────────────────────────────
// the FAITHFUL native-OS matrix — the live HoloPlatform resolver's output for each host the doctrine
// spans, so the embedded experience is the code's truth, not a restatement (the witness re-derives it).
const platformMatrix = Object.fromEntries(PLATFORM_OSES.map((os) => {
  const p = profileFor(navFor(os));
  return [os, { label: p.label, mobile: p.mobile, apple: p.apple, touch: p.touch, modKey: p.modKey,
    modSymbol: p.modSymbol, altSymbol: p.altSymbol, controlsSide: p.controlsSide, controlStyle: p.controlStyle,
    font: p.font, accent: p.accent, shortcuts: p.shortcuts }];
}));

const capabilityTiers = Object.fromEntries(TIERS.map((t) => [t, tierSettings(t)]));
const budget = JSON.parse(read("usr/lib/holo/holo-perf-budget.json").toString("utf8"));

const store = new Map();
const leaf = (rel, p, type = "schema:MediaObject") => contentLink(rel, `did:holo:sha256:${sha256hex(read(p))}`, type);
// the canonical source files the doctrine binds — change any byte and this object's did changes (L5).
const links = [
  leaf("hosux:ontology", "usr/share/ns/ux.jsonld", "schema:DigitalDocument"),
  leaf("hosux:doctrineSource", "usr/lib/holo/holo-ux-doctrine.mjs", "schema:SoftwareSourceCode"),
  leaf("hosux:runtime", "usr/lib/holo/holo-ux.js", "schema:SoftwareSourceCode"),
  leaf("hosux:platform", "usr/lib/holo/holo-platform.js", "schema:SoftwareSourceCode"),
  leaf("hosux:capability", "usr/lib/holo/holo-capability.mjs", "schema:SoftwareSourceCode"),
  leaf("hosux:voice", "usr/lib/holo/holo-voice.mjs", "schema:SoftwareSourceCode"),
  leaf("hosux:proportion", "usr/lib/holo/holo-phi.css", "schema:DigitalDocument"),
  leaf("hosux:budget", "usr/lib/holo/holo-perf-budget.json", "schema:Dataset"),
];

const obj = makeObject(store, {
  type: ["schema:CreativeWork", "prov:Entity", "skos:Collection"],
  context: [{ skos: "http://www.w3.org/2004/02/skos/core#", hosux: "https://hologram.os/ns/ux#", hosc: "https://hologram.os/ns/conformance#" }],
  "schema:name": "Holo UX doctrine — the canonical upstream UX parameters of Hologram OS",
  "schema:description": "Why: an experience should feel native, familiar and effortless on every machine, and treat the user's time, attention and energy as sacred. How: one self-verifying object declares the canonical UX parameters — the host OS is autodetected and the experience adapts to its native feel; thirteen tenets (the founding five + Steve Jobs's eight UX lessons) are each a checkable obligation; capability, voice and budget are resolved, not guessed. What: every holospace binds this object's κ rather than re-implementing UX, the same way Holo UI's tokens are bound — re-derive this did and each linked source κ to verify (Law L5).",
  "schema:softwareVersion": "1.0",
  "dcterms:conformsTo": "https://hologram.os/ns/ux",
  "dcterms:license": "https://creativecommons.org/publicdomain/zero/1.0/",
  "hosux:tenets": TENETS.map((t) => ({ "@id": `hosux:${t.id}`, group: t.group, prefLabel: t.label, "hosux:obligation": t.obligation })),
  "hosux:platformProfiles": platformMatrix,
  "hosux:capabilityTiers": capabilityTiers,
  "hosux:voiceRegister": { rule: "jargon-free · why→how→what · concise", lexiconTerms: Object.keys(JARGON).length, scheme: "https://hologram.os/ns/voice" },
  "hosux:resourceBudget": budget.tiers,
  "hosc:authority": "ADR-0062 (Holo UX doctrine) · ADR-0030 (Holo UI) · ADR-0028 (Holo UX Profile) · W3C UA Client Hints · WCAG 2.2 · RAIL / W3C Web Performance · UOR-ADDR (κ = H(canonical_form)) · verify by re-derivation (Law L5)",
  "hosc:witness": "tools/holo-ux-witness.mjs",
  links,
});

mkdirSync(join(OS, "etc/holo-ux"), { recursive: true });
writeFileSync(join(OS, "etc/holo-ux/doctrine.uor.json"), JSON.stringify(obj, null, 2) + "\n");

console.log(`sealed Holo UX doctrine`);
console.log(`  ns/ux.jsonld         — ${ontology["@graph"].length} terms (${TENETS.length} tenets)`);
console.log(`  doctrine.uor.json    — ${obj.id}`);
console.log(`  platform profiles    — ${PLATFORM_OSES.join(", ")}`);
console.log(`  source links         — ${links.length} (re-derive to verify, Law L5)`);
