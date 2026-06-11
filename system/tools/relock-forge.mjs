#!/usr/bin/env node
// relock-forge.mjs — re-seal apps/forge/holospace.lock.json after the canonical Holo Forge compiler
// gained operators (κ d3c784cd → 38b4e2d4). Mirrors build-app.mjs computeApp EXACTLY (same links,
// same root fields, same order) so only the genuinely-changed files move; resolves _shared from the
// OS2 runtime (os/usr/lib/holo) — the location the serve layer maps /_shared/ to. Reports the diff.
//
//   node tools/relock-forge.mjs

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { pathToFileURL } from "node:url";

const HOLOGRAM_OS = "C:/Users/pavel/Desktop/hologram-os/os";
const APP_DIR = "C:/Users/pavel/Desktop/Hologram Apps/apps/forge";
const SHARED = "C:/Users/pavel/Desktop/Hologram OS2/system/os/usr/lib/holo";   // /_shared/ resolves here
const REPO = "C:/Users/pavel/Desktop/Hologram Apps";

const { sha256hex, sriOf, mbSha256 } = await import(pathToFileURL(join(HOLOGRAM_OS, "holo-uor.mjs")));
const { makeObject, contentLink } = await import(pathToFileURL(join(HOLOGRAM_OS, "holo-object.mjs")));

const TYPE = { ".html": "schema:WebPage", ".js": "schema:SoftwareSourceCode", ".mjs": "schema:SoftwareSourceCode",
  ".css": "schema:SoftwareSourceCode", ".json": "schema:Dataset", ".jsonld": "schema:Dataset",
  ".svg": "schema:ImageObject", ".png": "schema:ImageObject", ".wasm": "schema:SoftwareApplication" };
const typeOf = (p) => TYPE[extname(p).toLowerCase()] || "schema:MediaObject";
const walk = (dir, out = []) => { for (const n of readdirSync(dir).sort()) { const p = join(dir, n);
  statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; };

const def = JSON.parse(readFileSync(join(APP_DIR, "holospace.json"), "utf8"));
const prev = JSON.parse(readFileSync(join(APP_DIR, "holospace.lock.json"), "utf8"));
const closure = {}, links = [];
const add = (abs, rel) => {
  if (closure[rel]) return;
  const bytes = readFileSync(abs), hex = sha256hex(bytes);
  closure[rel] = { kappa: `did:holo:sha256:${hex}`, sri: sriOf(bytes), multibase: mbSha256(bytes), bytes: bytes.length };
  links.push({ ...contentLink("schema:hasPart", `sha256:${hex}`, typeOf(rel)), "schema:name": rel });
};

// own files → apps/forge/<rel>
for (const p of walk(APP_DIR)) if (basename(p) !== "holospace.lock.json")
  add(p, "apps/forge/" + relative(APP_DIR, p).split("\\").join("/"));
// declared shared deps → _shared/<dep>, resolved from the OS2 runtime
for (const dep of def.shared || []) {
  const d = dep.replace(/\/$/, ""), dp = join(SHARED, d);
  if (!existsSync(dp)) throw new Error(`missing shared dep at ${dp}`);
  if (statSync(dp).isDirectory()) { for (const f of walk(dp)) add(f, "_shared/" + relative(SHARED, f).split("\\").join("/")); }
  else add(dp, `_shared/${d}`);
}
// constitutional baseline (build-app auto-adds it)
const gate = join(SHARED, "holo-conscience.js");
if (existsSync(gate)) add(gate, "_shared/holo-conscience.js");
links.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const root = makeObject(new Map(), {
  type: [...(def.type || ["schema:SoftwareApplication"]), "prov:Entity"],
  context: [{ hosc: "https://hologram.os/ns/conformance#" }],
  "schema:name": def.name,
  ...(def.summary ? { "schema:description": def.summary } : {}),
  ...(def.applicationCategory ? { "schema:applicationCategory": def.applicationCategory } : {}),
  "schema:identifier": def.id,
  ...(def.conforms?.specs ? { "schema:featureList": def.conforms.specs } : {}),
  ...(def.capabilities ? { "hosc:capabilities": def.capabilities } : {}),
  "prov:wasGeneratedBy": { "@id": "https://hologram.os/tools/build-app" },
  links,
});

// diff vs previous lock
const changed = [];
for (const rel of new Set([...Object.keys(prev.closure || {}), ...Object.keys(closure)])) {
  const a = prev.closure?.[rel]?.kappa, b = closure[rel]?.kappa;
  if (a !== b) changed.push(`${a ? (b ? "~" : "-") : "+"} ${rel}`);
}
console.log(`root ${prev.root} → ${root.id}`);
console.log(`files ${Object.keys(prev.closure || {}).length} → ${Object.keys(closure).length}`);
console.log("changed:\n  " + (changed.length ? changed.join("\n  ") : "(none)"));

const lock = { "@context": { dcterms: "http://purl.org/dc/terms/" },
  root: root.id, identifier: def.id, algo: "sha256", files: Object.keys(closure).length, closure };
writeFileSync(join(APP_DIR, "holospace.lock.json"), JSON.stringify(lock, null, 2) + "\n");
console.log("✓ wrote apps/forge/holospace.lock.json");
