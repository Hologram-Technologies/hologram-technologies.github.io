#!/usr/bin/env node
// holo-grammar-gate.mjs — THE CI GATE that ENFORCES the grammar (M0). Reads the canonical map
// (os/etc/holo-grammar.map.json — the single reviewed source of truth) and the LIVE module directory, and
// FAILS the build if: any live module is missing from the map (a new, uncategorized module), any map entry is
// stale (points at a deleted module), or any category is outside the 12 / is UNCATEGORIZED. This is what stops
// 391→12 from rotting back to chaos: every module MUST declare its category (by appearing in the map), forever.
// node tools/holo-grammar-gate.mjs   ·   exit 0 = grammar intact, exit 1 = drift.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const libDir = join(here, "../os/usr/lib/holo");
const mapPath = join(here, "../os/etc/holo-grammar.map.json");

const NOUNS = ["AGENT", "κ", "HOLOSPACE"];
const VERBS = ["MINT", "NAME", "WRAP", "MOVE", "COMPILE", "PROJECT", "LINK", "GOVERN", "SHARE"];
const VALID = new Set([...NOUNS, ...VERBS]);

const doc = JSON.parse(readFileSync(mapPath, "utf8"));
const map = doc.map || {};
const live = new Set(readdirSync(libDir).filter((f) => f.endsWith(".mjs") || f.endsWith(".js")).map((f) => f.replace(/\.(mjs|js)$/, "")));

const untagged = [...live].filter((m) => !(m in map));                 // a live module not in the map = new/uncategorized
const stale = Object.keys(map).filter((m) => !live.has(m));            // a map entry with no file = stale
const badCat = Object.entries(map).filter(([, c]) => !VALID.has(c)).map(([m, c]) => `${m}:${c}`);  // outside the 12 / UNCATEGORIZED

const checks = {
  everyModuleDeclared: untagged.length === 0,
  noStaleEntries: stale.length === 0,
  everyCategoryValid: badCat.length === 0,
};
const witnessed = Object.values(checks).every(Boolean);

console.log("holo-grammar-gate — enforce the grammar (every module declares its category)\n");
console.log(`  live modules: ${live.size}  ·  map entries: ${Object.keys(map).length}`);
console.log(`  ${checks.everyModuleDeclared ? "✓" : "✗"}  everyModuleDeclared${untagged.length ? `  → UNCATEGORIZED: ${untagged.slice(0, 20).join(", ")}` : ""}`);
console.log(`  ${checks.noStaleEntries ? "✓" : "✗"}  noStaleEntries${stale.length ? `  → STALE: ${stale.slice(0, 20).join(", ")}` : ""}`);
console.log(`  ${checks.everyCategoryValid ? "✓" : "✗"}  everyCategoryValid${badCat.length ? `  → BAD: ${badCat.slice(0, 20).join(", ")}` : ""}`);
console.log(`\n  ${witnessed ? "GATE OPEN ✓ — the grammar holds: every module is one of 3 nouns + 9 verbs" : "GATE CLOSED ✗ — grammar drift; add the module to os/etc/holo-grammar.map.json or fix its category"}`);
process.exit(witnessed ? 0 : 1);
