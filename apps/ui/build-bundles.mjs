// build-bundles.mjs — encode a few composition objects ("bundles") as content-addressed UOR objects.
// A bundle references child component κ's; its own identity is κ(canonical bytes). Bundles nest, so
// objects bundle/unbundle into new objects infinitely — all rendered from one κ by holo-render.js.
//
//   node build-bundles.mjs
import { canonicalize, kappaOfBytes } from "./vendor/runtime/holo-render.js";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APP = dirname(fileURLToPath(import.meta.url));
const reg = JSON.parse(readFileSync(join(APP, "registry", "index.json"), "utf8"));
const K = Object.fromEntries(reg.components.map((c) => [c.name, c.holo]));   // name → holo://moduleκ
const sri = (buf) => "sha256-" + createHash("sha256").update(buf).digest("base64");
const norm = (k) => k.replace(/^did:holo:sha256:/, "").replace(/^holo:\/\/sha256:/, "").replace(/^sha256:/, "");

// the bundles. children specs are exactly what holo-render.element() consumes.
const BUNDLES = {
  "button-row": {
    "@type": "holo:Bundle", name: "button-row", spec: "a row of every Button variant", layout: "row",
    children: ["default", "secondary", "outline", "destructive", "ghost"].map((v) => ({
      kappa: K.button, export: "Button", props: { variant: v }, children: v[0].toUpperCase() + v.slice(1),
    })),
  },
  "status-badges": {
    "@type": "holo:Bundle", name: "status-badges", spec: "a row of Badge variants", layout: "row",
    children: [["Stable", "default"], ["Beta", "secondary"], ["Draft", "outline"], ["Down", "destructive"]].map(
      ([t, v]) => ({ kappa: K.badge, export: "Badge", props: { variant: v }, children: t })),
  },
};

// a NESTED bundle: a Card composing a title, a description, the status badges, AND the button-row
// bundle — proving a bundle is just another κ child (infinite bundling). Built after the leaves so
// their κ's are known.
function build(name, obj) {
  const bytes = Buffer.from(canonicalize(obj), "utf8");        // canonical bytes == the object's identity
  return { name, obj, bytes };
}
const leaves = Object.entries(BUNDLES).map(([n, o]) => build(n, o));
const leafK = {};
for (const l of leaves) leafK[l.name] = norm(await kappaOfBytes(l.bytes));

const panel = build("panel", {
  "@type": "holo:Bundle", name: "panel", spec: "a Card that nests the badges + the button-row bundle", layout: "stack",
  children: [{
    kappa: K.card, export: "Card", props: { style: { width: "24rem", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" } },
    children: [
      { kappa: K.card, export: "CardTitle", children: "Atomic universe" },
      { kappa: K.card, export: "CardDescription", children: "every part is a κ-addressed object, composed and re-derivable" },
      { bundle: "holo://sha256:" + leafK["status-badges"] },
      { bundle: "holo://sha256:" + leafK["button-row"] },
    ],
  }],
});

const all = [...leaves, panel];
mkdirSync(join(APP, "registry", "bundles"), { recursive: true });
const importmap = JSON.parse(readFileSync(join(APP, "vendor", "importmap.json"), "utf8"));
const index = [];
for (const b of all) {
  const k = norm(await kappaOfBytes(b.bytes));
  const path = `registry/bundles/${b.name}.json`;
  writeFileSync(join(APP, path), b.bytes);                     // serve the EXACT canonical bytes (κ verifies)
  importmap.imports[`holo://sha256:${k}`] = `./${path}`;
  importmap.integrity[`./${path}`] = sri(b.bytes);
  index.push({ name: b.name, holo: `holo://sha256:${k}`, kappa: `sha256:${k}`, bytes: b.bytes.length, children: b.obj.children });
}
writeFileSync(join(APP, "vendor", "importmap.json"), JSON.stringify(importmap, null, 2) + "\n");
writeFileSync(join(APP, "registry", "bundles", "index.json"),
  JSON.stringify({ spec: "Composition objects — each references child component κ's; rendered from one κ by holo-render.js.", count: index.length, bundles: index.map(({ children, ...m }) => m) }, null, 2) + "\n");

console.log(`✓ ${all.length} bundles encoded → registry/bundles + importmap`);
for (const b of index) console.log(`  ${b.name.padEnd(14)} ${b.holo}  (${b.bytes} B)`);
