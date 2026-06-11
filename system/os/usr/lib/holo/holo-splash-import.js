// holo-splash-import.js — bring real community Plymouth themes into Holo Splash.
//
// adi1090x/plymouth-themes (https://github.com/adi1090x/plymouth-themes) is a large
// gallery of genuine `.plymouth` + `.script` boot-splash themes (4 packs, ~80+). This
// module lets Holo Splash browse that catalog and import any theme as a first-class,
// content-addressed holospace artifact:
//
//   • loadCatalog()  — ONE GitHub git-tree request yields the whole repo; we group its
//                      paths into packs → themes → files (no per-theme network).
//   • fetchTheme()   — fetch a theme's bytes (the .plymouth, the .script, every PNG),
//                      sha256 each, parse the .plymouth, and *validate it by actually
//                      running it headlessly through the real Plymouth engine* — a theme
//                      the interpreter cannot run is refused, so the gallery never offers
//                      something broken. The theme's identity is then its own content
//                      address: κ = sha256(canonical map of {path → byte-hash}). This is
//                      the hologram-native Law-L5 model — an imported theme is
//                      self-certifying and re-verifies on every load, no central manifest.
//
// The module is isomorphic and DOM-free: every side-effecting dependency (the network
// `transport`, the `sha256`) is injected, so the Node witness exercises the exact same
// code with a mocked GitHub and the browser wires a direct-fetch → /gh-proxy transport.
//
// Exports: REPO, CATALOG_URL, rawUrl, loadCatalog, parseCatalog, fetchTheme,
//          computeKappa, validateScriptTheme, defaultTransport, sha256hex.

import { parsePlymouth, Lexer, Parser, HeadlessBackend, ScriptPlugin, pngSize } from "./holo-plymouth.js";

// ── the upstream repository ──────────────────────────────────────────────────────
export const REPO = { owner: "adi1090x", repo: "plymouth-themes", branch: "master" };
export const CATALOG_URL =
  `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/git/trees/${REPO.branch}?recursive=1`;
export const rawUrl = (path) =>
  `https://raw.githubusercontent.com/${REPO.owner}/${REPO.repo}/${REPO.branch}/${path}`;

// asset kinds we carry into an imported theme (skip LICENSE/README/etc.)
const KEEP = /\.(plymouth|script|png|ttf|otf)$/i;
const isPng = (p) => /\.png$/i.test(p);

// ── default injected dependencies (the browser/Node real implementations) ─────────
export const defaultTransport = {
  async json(url) { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`); return r.json(); },
  async bytes(url) { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`); return new Uint8Array(await r.arrayBuffer()); },
};
export async function sha256hex(u8) {
  const d = await crypto.subtle.digest("SHA-256", u8 instanceof Uint8Array ? u8 : new Uint8Array(u8));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── catalog ───────────────────────────────────────────────────────────────────────
// Turn a GitHub git-tree (`{ tree: [{ path, type }] }`) into a sorted theme catalog.
export function parseCatalog(tree) {
  const entries = (tree && tree.tree) || [];
  const map = new Map();   // "pack_N/theme" → entry
  for (const e of entries) {
    if (e.type !== "blob") continue;
    const m = /^(pack_\d+)\/([^/]+)\/(.+)$/.exec(e.path);
    if (!m) continue;
    const [, pack, name, rel] = m;
    const key = pack + "/" + name;
    let t = map.get(key);
    if (!t) { t = { id: name, name, pack, dir: pack + "/" + name, files: [] }; map.set(key, t); }
    if (KEEP.test(rel)) t.files.push(rel);
  }
  const themes = [];
  for (const t of map.values()) {
    t.files.sort();
    t.hasPlymouth = t.files.some((f) => /\.plymouth$/i.test(f));
    t.hasScript = t.files.some((f) => /\.script$/i.test(f));
    t.pngCount = t.files.filter(isPng).length;
    if (t.hasPlymouth) themes.push(t);   // a theme without a .plymouth isn't bootable
  }
  // pack number, then name — stable, scannable order
  themes.sort((a, b) => a.pack.localeCompare(b.pack, "en", { numeric: true }) || a.name.localeCompare(b.name));
  const packs = [...new Set(themes.map((t) => t.pack))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return { repo: `${REPO.owner}/${REPO.repo}`, packs, themes, truncated: !!(tree && tree.truncated) };
}

export async function loadCatalog(transport = defaultTransport) {
  return parseCatalog(await transport.json(CATALOG_URL));
}

// ── a tiny bounded-concurrency pool (keeps imports snappy without hammering) ───────
async function pool(items, n, worker) {
  const out = new Array(items.length);
  let i = 0;
  const run = async () => { while (i < items.length) { const k = i++; out[k] = await worker(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) || 0 }, run));
  return out;
}

// ── import one theme ───────────────────────────────────────────────────────────────
// Fetch every kept file, hash it, parse the .plymouth, validate a `script` theme by
// running it, then content-address the whole bundle. Returns a ready-to-store theme.
export async function fetchTheme(entry, { transport = defaultTransport, sha256 = sha256hex, onProgress = null } = {}) {
  const rels = entry.files.filter((f) => KEEP.test(f));
  if (!rels.some((f) => /\.plymouth$/i.test(f))) throw new Error("no .plymouth in theme");
  let done = 0;
  const fetched = await pool(rels, 10, async (rel) => {
    const bytes = await transport.bytes(rawUrl(entry.dir + "/" + rel));
    const hex = await sha256(bytes);
    if (onProgress) onProgress(++done, rels.length, rel);
    return { path: rel, bytes, sha256: "sha256:" + hex, size: bytes.length };
  });

  const byName = new Map(fetched.map((f) => [f.path, f]));
  const plyFile = fetched.find((f) => /\.plymouth$/i.test(f.path));
  const conf = parsePlymouth(new TextDecoder().decode(plyFile.bytes));
  const moduleName = conf.moduleName || "script";

  // PNG dimensions (basename + rel) so the headless engine can size sprites truthfully.
  const sizes = {};
  for (const f of fetched) if (isPng(f.path)) { const s = pngSize(f.bytes); if (s) { sizes[f.path] = s; sizes[f.path.split("/").pop()] = s; } }

  if (moduleName === "script") {
    const sf = (conf.module.ScriptFile || "").split("/").pop();
    const scriptFile = (sf && byName.get(sf)) || fetched.find((f) => /\.script$/i.test(f.path));
    if (!scriptFile) throw new Error("script theme has no .script file");
    validateScriptTheme(new TextDecoder().decode(scriptFile.bytes), sizes);
  }

  const fileHashes = {};
  for (const f of fetched) fileHashes[f.path] = f.sha256;
  const kappa = await computeKappa(fileHashes, sha256);

  return {
    id: entry.id, name: conf.name || entry.name, description: conf.description || "",
    module: moduleName, pack: entry.pack, source: `${REPO.owner}/${REPO.repo}/${entry.dir}`,
    kappa, files: fetched,
  };
}

// Run a `script` theme to completion headlessly; throw a clean error if it cannot run.
// Building the plugin executes the theme's top level (sprites + callback registration);
// we then drive the documented callbacks to surface runtime errors in them too.
export function validateScriptTheme(source, sizes = {}) {
  try {
    // surface lex/parse errors with precise location first
    new Parser(new Lexer(source).tokenize()).parse();
    const be = new HeadlessBackend(1280, 800, sizes);
    const plugin = new ScriptPlugin(be, source).start();
    plugin.bootProgress(0.5, 0.5);
    plugin.refresh();
    plugin.updateStatus("Probing hardware");
    plugin.displayPassword("Enter passphrase:", 3);
    plugin.displayNormal();
    plugin.displayMessage("ok");
    return true;
  } catch (e) {
    throw new Error("theme could not run: " + (e && e.message ? e.message : String(e)));
  }
}

// κ over the bundle: sha256 of a canonical, order-independent map of path → byte-hash.
export async function computeKappa(fileHashes, sha256 = sha256hex) {
  const canon = Object.keys(fileHashes).sort().map((k) => k + "\0" + fileHashes[k]).join("\n");
  return "sha256:" + (await sha256(new TextEncoder().encode(canon)));
}
