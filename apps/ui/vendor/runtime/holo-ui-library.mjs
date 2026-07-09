// holo-ui-library.mjs — the one entry point any holo app or holospace tab uses to discover and stream
// native Hologram UI components by their κ address. Zero per-app vendoring: it installs the global import
// map (holo://ui/<name> + runtime bare → the OS content route /.holo/sha256/<hex>), so a plain dynamic
// `import("holo://ui/button")` streams that component by κ from cache → IPFS → origin, re-derived (L5).
//
//   import { installImportmap, loadComponent, listComponents } from ".../holo-ui-library.mjs";
//   installImportmap();                               // once, before importing any holo://ui/* module
//   const { Button } = await loadComponent("button"); // streamed by κ, byte-verified
//
// LIB_BASE points at the canonical library app (apps/ui). Override for a different mount.
let LIB_BASE = new URL("../../", import.meta.url).href.replace(/\/$/, "");   // → …/apps/ui
export function setBase(href) { LIB_BASE = href.replace(/\/$/, ""); }

let _lib = null, _map = null, _installed = false;

// the catalog — the single source of truth for "what components exist". Cached.
export async function getLibrary() {
  if (_lib) return _lib;
  _lib = await fetch(`${LIB_BASE}/ui-library.json`).then((r) => r.json());
  return _lib;
}

// queryable discovery: filter by library/tier/category and/or a free-text query over name+category.
export async function listComponents({ library, tier, category, q } = {}) {
  const lib = await getLibrary();
  const needle = (q || "").trim().toLowerCase();
  return lib.components.filter((c) =>
    (!library || c.library === library) && (!tier || c.tier === tier) && (!category || c.category === category) &&
    (!needle || c.name.toLowerCase().includes(needle) || (c.category || "").toLowerCase().includes(needle)));
}

// the κ address + content route for a named component (the unique address it streams from).
export async function componentKappa(name) { return (await find(name))?.kappa || null; }
export async function componentRoute(name) { return (await find(name))?.route || null; }
async function find(name) { return (await getLibrary()).components.find((c) => c.name === name) || null; }

// install the global import map into a document so `import("holo://ui/<name>")` resolves OS-wide. Must
// run before the first module import in that document; returns false (with a warning) if it's too late.
export async function installImportmap(doc = (typeof document !== "undefined" ? document : null)) {
  if (_installed) return true;
  if (!doc) throw new Error("installImportmap needs a document");
  if (!_map) _map = await fetch(`${LIB_BASE}/vendor/ui-importmap.json`).then((r) => r.json());
  // a parsed import map can't be added once any module graph has loaded — merge into an existing,
  // not-yet-applied one if present, else append a fresh one.
  const existing = doc.querySelector('script[type="importmap"]');
  if (existing && !existing.dataset.holoApplied) {
    try { const cur = JSON.parse(existing.textContent || "{}"); cur.imports = { ...(cur.imports || {}), ..._map.imports }; existing.textContent = JSON.stringify(cur); _installed = true; return true; }
    catch { /* fall through to append */ }
  }
  if (doc.querySelector("script[type=module]") && !existing) { console.warn("[holo-ui-library] modules already loaded — install earlier, or use loadComponent() (direct route)"); }
  const s = doc.createElement("script"); s.type = "importmap"; s.dataset.holoApplied = "1"; s.textContent = JSON.stringify(_map);
  (doc.head || doc.documentElement).appendChild(s); _installed = true; return true;
}

// stream + import a component module by name. Prefers the installed specifier; falls back to importing
// the absolute κ-route directly (robust even if the import map wasn't installed in time).
export async function loadComponent(name) {
  const c = await find(name);
  if (!c) throw new Error(`unknown component: ${name}`);
  if (c.format === "css") throw new Error(`${name} is a css layer — use adoptDaisy()`);
  try { if (_installed && c.specifier) return await import(/* @vite-ignore */ c.specifier); } catch (e) { /* fall back to route */ }
  return await import(/* @vite-ignore */ new URL(c.route, (typeof location !== "undefined" ? location.origin : LIB_BASE)).href);
}

// stream a daisyUI css layer (or the whole library) by κ and adopt it into a (shadow) root or document.
export async function adoptDaisy(root, name = "daisyui") {
  const c = await find(name.startsWith("daisyui") ? name : `daisyui-${name}`);
  if (!c) throw new Error(`unknown daisyui layer: ${name}`);
  const css = await fetch(new URL(c.route, (typeof location !== "undefined" ? location.origin : LIB_BASE)).href).then((r) => r.text());
  const sheet = new CSSStyleSheet(); sheet.replaceSync(css);
  const target = root || (typeof document !== "undefined" ? document : null);
  if (target && "adoptedStyleSheets" in target) target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
  return sheet;
}

// resolve a legacy os/ui κ to the canonical one (for migrating old consumers to the single library).
export async function canonicalOf(legacyKappa) {
  const a = (await getLibrary()).aliases[String(legacyKappa).replace(/^did:holo:sha256:|^sha256:/, "")];
  return a ? a.canonical : null;
}
