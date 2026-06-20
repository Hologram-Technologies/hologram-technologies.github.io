#!/usr/bin/env node
// encode-daisyui.mjs — encode the daisyUI distribution (vendored byte-exact under apps/ui/vendor/daisyui)
// as content-addressed κ-objects in the Holo UI registry. daisyUI components are CSS class layers, not
// React modules: the source CSS file IS the deliverable, so source κ == module κ == sha256(bytes). No
// component bytes are authored or transformed here — only the registry manifests + resolution surface
// (registry/index.json, registry/daisyui-*.json, vendor/importmap.json) are generated from the raw bytes.
//
//   node tools/encode-daisyui.mjs        (re-runnable; idempotent — replaces any prior daisyui entries)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";

const HOLO = "C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/os/usr/lib/holo";
const UI = "C:/Users/pavel/Desktop/HOLOGRAM/holo-apps/apps/ui";
const { sha256hex, sriOf } = await import(pathToFileURL(join(HOLO, "holo-uor.mjs")));

const DAISY = join(UI, "vendor", "daisyui");
const pkg = JSON.parse(readFileSync(join(DAISY, "package.json"), "utf8"));
const VERSION = pkg.version;
// the npm tarball integrity that this vendored tree was verified against (whole-package provenance).
const PKG_INTEGRITY = "sha512-xuheNUSL4T6ZVtWXoioqcNkjoyGX85QTDz4HTw2aBPfqk4fuMjax5HDo8qCmpV6M1YN8bGvfx5BpYCoDeRlt+A==";

// sensible category placement so daisyUI slots into the gallery's existing category rail.
const CAT = {
  "Buttons & Actions": ["button", "dropdown", "modal", "swap", "fab"],
  "Forms & Inputs": ["checkbox", "fieldset", "fileinput", "filter", "input", "label", "radio", "range", "rating", "select", "textarea", "toggle", "validator", "calendar"],
  "Navigation": ["breadcrumbs", "dock", "link", "menu", "navbar", "steps", "tab"],
  "Overlays": ["drawer", "tooltip"],
  "Feedback": ["alert", "loading", "progress", "radialprogress", "skeleton", "toast", "status"],
  "Data Display": ["avatar", "badge", "card", "carousel", "chat", "collapse", "countdown", "diff", "indicator", "kbd", "list", "stat", "table", "timeline"],
  "Layout": ["divider", "footer", "hero", "stack", "mask"],
  "Device Mocks": ["mockup"],
  "Special Effects": ["hover3d", "hovergallery", "textrotate"],
};
const catOf = (name) => Object.keys(CAT).find((c) => CAT[c].includes(name)) || "Components";

// seal one CSS file → its κ-object descriptor (source κ == module κ == sha256 of the raw bytes).
function seal({ name, relFile, displayName, category }) {
  const bytes = readFileSync(join(UI, relFile));
  const hex = sha256hex(bytes);
  const k = `sha256:${hex}`;
  const holo = `holo://${k}`;
  const reg = {
    id: `org.hologram.ui.daisyui.${name}`,
    name: displayName,
    tier: "component",
    library: "daisyui",
    category,
    upstream: `https://cdn.jsdelivr.net/npm/daisyui@${VERSION}/${relFile.replace(/^vendor\/daisyui\//, "")}`,
    docs: name === "daisyui" ? "https://daisyui.com/components/" : `https://daisyui.com/components/${name}/`,
    did: `did:holo:sha256:${hex}`,
    import: holo,
    integrity: sriOf(bytes),
    kappa: k,
    moduleKappa: k,
    renderExport: null,
    format: "css",
    source: relFile.replace(/^vendor\/daisyui\//, ""),
    module: relFile,
    exports: [],
    bytes: bytes.length,
    provenance: { package: "daisyui", version: VERSION, integrity: PKG_INTEGRITY, file: relFile.replace(/^vendor\/daisyui\//, "") },
    license: "MIT",
  };
  writeFileSync(join(UI, "registry", `daisyui-${name}.json`), JSON.stringify(reg, null, 2) + "\n");
  const idxEntry = {
    name: displayName, tier: "component", library: "daisyui", category,
    did: reg.did, holo, integrity: reg.integrity, kappa: k, moduleKappa: k,
    renderExport: null, format: "css", exports: [],
  };
  return { holo, module: relFile, idxEntry };
}

// the 58 per-component CSS layers + the full bundle.
const comps = readdirSync(join(DAISY, "components")).filter((f) => f.endsWith(".css")).map((f) => basename(f, ".css")).sort();
const sealed = [];
for (const name of comps)
  sealed.push(seal({ name, relFile: `vendor/daisyui/components/${name}.css`, displayName: `daisyui-${name}`, category: catOf(name) }));
sealed.push(seal({ name: "daisyui", relFile: `vendor/daisyui/daisyui.css`, displayName: "daisyui", category: "Components" }));

// ── patch registry/index.json (idempotent: drop any prior daisyui rows, re-add, fix count + tiers) ──
const idxPath = join(UI, "registry", "index.json");
const idx = JSON.parse(readFileSync(idxPath, "utf8"));
idx.components = idx.components.filter((c) => c.library !== "daisyui");
const baseComponentTier = idx.components.filter((c) => c.tier === "component").length;
for (const s of sealed) idx.components.push(s.idxEntry);
idx.tiers.component = baseComponentTier + sealed.length;
idx.count = idx.components.length;
writeFileSync(idxPath, JSON.stringify(idx, null, 2) + "\n");

// ── patch vendor/importmap.json (idempotent: drop prior daisyui mappings, re-add holo://κ → file) ──
const imPath = join(UI, "vendor", "importmap.json");
const im = JSON.parse(readFileSync(imPath, "utf8"));
for (const key of Object.keys(im.imports))
  if (typeof im.imports[key] === "string" && im.imports[key].includes("/vendor/daisyui/")) delete im.imports[key];
for (const s of sealed) im.imports[s.holo] = "./" + s.module;
writeFileSync(imPath, JSON.stringify(im, null, 2) + "\n");

console.log(`daisyUI ${VERSION}: sealed ${sealed.length} css κ-objects (${comps.length} components + 1 full bundle)`);
console.log(`registry/index.json → count ${idx.count}, tiers.component ${idx.tiers.component}`);
console.log(`importmap entries added: ${sealed.length}`);
