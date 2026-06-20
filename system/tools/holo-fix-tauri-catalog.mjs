// holo-fix-tauri-catalog.mjs — G6/SEC-6: the Tauri desktop mirror catalog
// (holo-apps/apps/tauri/dist/apps/index.jsonld) carried 13 placeholder did:holo:slug: @ids — location/name
// identity, the exact thing identity-is-content (L1) forbids. Re-key each to the app's TRUE content κ: the
// app's own holospace.lock.json root, else the authoritative source catalog's @id for the same folder. Same
// app SET, correct identities. The GitHub-Pages deploy is already clean; this fixes the local desktop mirror.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");   // tools → system → holo-os → repo root (HOLOGRAM)
const MIRROR = join(REPO, "holo-apps/apps/tauri/dist/apps/index.jsonld");
const SOURCE = join(REPO, "holo-apps/apps/index.jsonld");
const distLock = (folder) => join(REPO, "holo-apps/apps/tauri/dist/apps", folder, "holospace.lock.json");

const cat = JSON.parse(readFileSync(MIRROR, "utf8"));
const ds = cat.dataset || cat["dcat:dataset"] || cat.datasets || [];
const src = JSON.parse(readFileSync(SOURCE, "utf8"));
const srcDs = src.dataset || src["dcat:dataset"] || src.datasets || [];
// source index keyed by landing-folder for fallback
const srcByFolder = new Map();
for (const d of srcDs) { const f = (String(d["dcat:landingPage"] || d.landingPage || "").match(/apps\/([^/]+)\//) || [])[1]; if (f && /sha256/.test(d["@id"] || "")) srcByFolder.set(f, d["@id"]); }

let fixed = 0, unresolved = [];
for (const d of ds) {
  if (!/did:holo:slug/.test(d["@id"] || "")) continue;
  const folder = (String(d["dcat:landingPage"] || d.landingPage || "").match(/apps\/([^/]+)\//) || [])[1];
  let root = null;
  if (folder && existsSync(distLock(folder))) { try { root = JSON.parse(readFileSync(distLock(folder), "utf8")).root; } catch {} }
  if (!root || !/sha256/.test(root)) root = srcByFolder.get(folder) || null;   // fallback to the source catalog κ
  if (root && /sha256/.test(root)) { d["@id"] = root; fixed++; }
  else unresolved.push(`${d["schema:identifier"] || d["@id"]} (folder=${folder})`);
}

if (fixed) writeFileSync(MIRROR, JSON.stringify(cat, null, 2) + "\n");
console.log(`Tauri mirror: re-keyed ${fixed} slug @id(s) to content κ.`);
if (unresolved.length) { console.log("UNRESOLVED (no dist lock + not in source catalog):"); unresolved.forEach((u) => console.log("  · " + u)); }
const remaining = ds.filter((d) => /did:holo:slug/.test(d["@id"] || "")).length;
console.log(remaining ? `\n${remaining} slug @id(s) REMAIN.` : "\nMirror is slug-free.");
