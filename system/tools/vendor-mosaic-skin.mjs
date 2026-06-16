#!/usr/bin/env node
// vendor-mosaic-skin.mjs — pin the NCSA Mosaic skin (the holo:BrowserSkin "vendored toolchain" step,
// exact analog of vendor-esbuild-wasm.mjs). Reads the authored chrome assets from disk, computes each
// asset's κ (did:holo:sha256 over its bytes), writes the committed skin.pin.json, then assembles the
// skin.json manifest referencing those κ and seals it to its own @id (Law L5). Re-run after editing any
// asset so the pins (and the manifest κ) track the bytes. Usage: node tools/vendor-mosaic-skin.mjs
//
// Fidelity reference (study only, not run): github.com/alandipert/ncsa-mosaic — the X11/Motif client;
// menus from src/gui.c, the spinning globe + toolbar pixmaps from src/bitmaps. The chrome here is
// RE-AUTHORED as web SVG/HTML (honest caveat recorded by the witness), not byte-derived from pixmaps.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assetKappa, skinKappa } from "../os/usr/lib/holo/holo-skin.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "os", "usr", "lib", "holo", "skins", "mosaic");
const read = (rel) => new Uint8Array(readFileSync(join(dir, rel)));

const ASSETS = [
  "chrome.html", "chrome.css",
  "glyphs/back.svg", "glyphs/forward.svg", "glyphs/home.svg", "glyphs/reload.svg",
  "glyphs/open.svg", "glyphs/stop.svg", "glyphs/newwin.svg",
  "throbber/globe.svg",
];

// 1 · pin every asset to its content address.
const files = {};
for (const rel of ASSETS) files[rel] = await assetKappa(read(rel));
const pin = { "@type": "holo:VendoredSkin", skinId: "mosaic",
  fidelitySource: "github.com/alandipert/ncsa-mosaic (X11/Motif client) — re-authored as web chrome",
  files };
writeFileSync(join(dir, "skin.pin.json"), JSON.stringify(pin, null, 2) + "\n");

// 2 · assemble the manifest referencing those κ (chrome by role, glyphs by name, the globe throbber).
const k = (rel) => files[rel];
const manifest = {
  "@context": "/usr/share/ns/browser-skin.jsonld",
  "@type": "holo:BrowserSkin",
  "holo:skinId": "mosaic",
  "holo:title": "NCSA Mosaic",
  "holo:fidelitySource": "github.com/alandipert/ncsa-mosaic (X11/Motif client)",
  "holo:appliesTo": "browser",
  "holo:chrome": { "html": k("chrome.html"), "css": k("chrome.css") },
  "holo:glyphs": { "back": k("glyphs/back.svg"), "forward": k("glyphs/forward.svg"), "home": k("glyphs/home.svg"),
    "reload": k("glyphs/reload.svg"), "open": k("glyphs/open.svg"), "stop": k("glyphs/stop.svg"), "newwin": k("glyphs/newwin.svg") },
  "holo:throbber": { "kind": "svg", "fps": 24, "svg": k("throbber/globe.svg") },
  "holo:palette": { "chrome": "#c0c0c0", "bevelLight": "#ffffff", "bevelDark": "#808080",
    "linkUnvisited": "#0000ee", "linkVisited": "#551a8b", "text": "#000000", "statusBg": "#c0c0c0" },
  "holo:font": { "ui": "Helvetica, 'Nimbus Sans', Arial, sans-serif", "doc": "'Times New Roman', Times, serif" },
  "holo:behavior": {
    "throbberSource": "loading",
    "statusSource": "nav.current.url",
    "backEnabled": "nav.canGoBack",
    "forwardEnabled": "nav.canGoForward",
    "securityChip": "securityState",
    "menus": [
      { "label": "File", "items": [
        { "label": "Open URL…", "action": "omni.focus" }, { "label": "Open Local…", "action": "omni.focus" },
        { "label": "New Window", "action": "tab.new" }, { "label": "Reload Current", "action": "nav.reload" },
        { "label": "Close Window", "action": "tab.close" } ] },
      { "label": "Options", "items": [
        { "label": "Load Images Automatically", "action": "noop" }, { "label": "Anchor Underlines", "action": "noop" },
        { "label": "Flush Cache", "action": "noop" } ] },
      { "label": "Navigate", "items": [
        { "label": "Back", "action": "nav.back" }, { "label": "Forward", "action": "nav.forward" },
        { "label": "Home Document", "action": "nav.home" }, { "label": "Reload", "action": "nav.reload" },
        { "label": "Window History…", "action": "noop" } ] },
      { "label": "Annotate", "items": [ { "label": "Annotate…", "action": "noop" }, { "label": "Delete This Annotation", "action": "noop" } ] },
      { "label": "Help", "items": [ { "label": "About Mosaic…", "action": "about" }, { "label": "Manual Pages", "action": "noop" } ] }
    ]
  },
};

// 3 · seal the manifest to its own @id (the address excludes @id from what it names).
manifest["@id"] = await skinKappa(manifest);
writeFileSync(join(dir, "skin.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log("vendored mosaic skin:");
for (const [rel, did] of Object.entries(files)) console.log("  " + did.slice(0, 26) + "…  " + rel);
console.log("manifest κ (@id): " + manifest["@id"]);
