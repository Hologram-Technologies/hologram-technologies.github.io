#!/usr/bin/env node
// build-ui-library.mjs — consolidate every native Hologram UI component into ONE library surface:
// a single catalog (ui-library.json) + a single GLOBAL import map (vendor/ui-importmap.json) that any
// holo app or holospace tab can use to discover and stream any component by its unique κ address.
//
// Design (nothing new in the streaming layer — it already exists):
//   • discovery   → ui-library.json lists all components (name · library · tier · category · κ · format).
//   • addressing  → a stable specifier  holo://ui/<name>  resolves to the component's module κ.
//   • streaming   → the global import map maps every specifier to the OS-wide content route
//                   /.holo/sha256/<hex>, which serves any sealed κ from cache → IPFS peers → origin and
//                   re-derives-or-refuses (Law L5). So an app loads this map, then `import("holo://ui/x")`
//                   streams x by κ from anywhere — no per-app vendored paths.
//   • legacy      → the older holo-os/system/os/ui set encodes the same 56 shadcn names to DIFFERENT κ
//                   (bare-linked Radix runtime). We record legacy-κ → canonical-κ aliases so those
//                   consumers can migrate to the one library without a flag day.
//
//   node tools/build-ui-library.mjs        (re-runnable; idempotent)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const UI = "C:/Users/pavel/Desktop/HOLOGRAM/holo-apps/apps/ui";
const OSUI = "C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/os/ui";
const hex = (k) => String(k).replace(/^did:holo:sha256:/, "").replace(/^holo:\/\/sha256:/, "").replace(/^sha256:/, "");
const route = (k) => `/.holo/sha256/${hex(k)}`;            // the OS-wide, location-agnostic content route

const idx = JSON.parse(readFileSync(join(UI, "registry", "index.json"), "utf8"));
const im = JSON.parse(readFileSync(join(UI, "vendor", "importmap.json"), "utf8")).imports;

// ── runtime bare specifiers (react, motion, …) → their κ, by matching each bare target to the
//    holo://sha256 key that serves the same runtime file. These travel WITH the library so a component
//    loaded in a foreign app can still resolve its `import "react"` to the one shared React κ. ──
const targetToKappa = {};
for (const [k, v] of Object.entries(im)) if (k.startsWith("holo://sha256:") && v.includes("/runtime/")) targetToKappa[v] = hex(k);
const runtime = {};
for (const [bare, v] of Object.entries(im)) if (!bare.startsWith("holo://") && targetToKappa[v]) runtime[bare] = route(targetToKappa[v]);

// ── the canonical catalog: every component, content-addressed. JS modules get a holo://ui/<name>
//    specifier; daisyUI css layers are addressed by κ (consumed as a stylesheet, not import()). ──
const components = idx.components.map((c) => ({
  name: c.name,
  specifier: c.library === "daisyui" ? null : `holo://ui/${c.name}`,
  library: c.library,
  tier: c.tier,
  category: c.category,
  format: c.format || "esm",
  kappa: `sha256:${hex(c.moduleKappa || c.holo || c.kappa)}`,
  route: route(c.moduleKappa || c.holo || c.kappa),
  integrity: c.integrity,
  renderExport: c.renderExport ?? null,
  exports: c.exports || [],
}));

// ── legacy aliases: holo-os/system/os/ui/vendor/registry.json (name → legacy κ) → canonical κ ──
const aliases = {};
const legacyPath = join(OSUI, "vendor", "registry.json");
if (existsSync(legacyPath)) {
  const legacy = JSON.parse(readFileSync(legacyPath, "utf8"));
  const canonByName = Object.fromEntries(idx.components.filter((c) => c.library !== "daisyui").map((c) => [c.name, hex(c.moduleKappa || c.holo)]));
  for (const [name, k] of Object.entries(legacy)) {
    const canon = canonByName[name];
    if (canon && hex(k) !== canon) aliases[hex(k)] = { name, canonical: canon, route: route(canon) };
  }
}

const counts = components.reduce((a, c) => ((a[c.library] = (a[c.library] || 0) + 1), a), {});
const library = {
  "@context": { holo: "https://hologram.os/ns#", schema: "https://schema.org/" },
  "@type": "holo:ComponentLibrary",
  "schema:name": "Hologram UI",
  version: "1.0",
  spec: "The single native Hologram UI library: every component is a content-addressed κ-object, discoverable here and streamable by any holo app or holospace tab from its κ via the OS content route /.holo/sha256/<hex> (cache → IPFS → origin, re-derive-or-refuse / Law L5). Import a module component by its stable specifier holo://ui/<name> after installing ui-importmap.json; consume a daisyUI css layer as a stylesheet by its κ.",
  route: "/.holo/sha256/<hex>",
  specifier: "holo://ui/<name>",
  importmap: "./vendor/ui-importmap.json",
  source: "holo-apps/apps/ui (canonical) — supersets the legacy holo-os/system/os/ui set",
  count: components.length,
  libraries: counts,
  runtime,                                   // shared runtime κ (react, motion, …) on the same route
  components,
  aliases,                                   // legacy os/ui κ → canonical κ (same logical component)
};
writeFileSync(join(UI, "ui-library.json"), JSON.stringify(library, null, 2) + "\n");

// ── the GLOBAL import map: portable (absolute /.holo route, not app-relative). Drop it into any
//    document and `import("holo://ui/<name>")` streams that component by κ from anywhere. ──
const imports = { ...runtime };
for (const c of components) if (c.specifier) imports[c.specifier] = c.route;
writeFileSync(join(UI, "vendor", "ui-importmap.json"), JSON.stringify({ imports }, null, 2) + "\n");

console.log(`Hologram UI library: ${components.length} components  (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")})`);
console.log(`global specifiers: ${Object.keys(imports).length - Object.keys(runtime).length} holo://ui/*  +  ${Object.keys(runtime).length} runtime bare`);
console.log(`legacy aliases (os/ui → canonical): ${Object.keys(aliases).length}`);
console.log(`wrote: apps/ui/ui-library.json + apps/ui/vendor/ui-importmap.json`);
