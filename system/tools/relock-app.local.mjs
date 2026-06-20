#!/usr/bin/env node
// relock-app.local.mjs — IDENTICAL to relock-app.mjs (same closure/links/root logic, byte-for-byte),
// with ONLY the three path constants repointed at THIS consolidated mirror tree. The shipped
// relock-app.mjs hardcodes sibling folders (hologram-os/os · Hologram Apps · Hologram OS2) that exist
// on the canonical authoring machine but not on this checkout; the primitives + _shared runtime they
// need all live here under holo-os/system/os/usr/lib/holo and holo-apps/apps. No logic is changed.
//
//   node tools/relock-app.local.mjs <app-id>        e.g. code-desktop

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { pathToFileURL } from "node:url";

const APP = process.argv[2];
if (!APP) { console.error("usage: node tools/relock-app.local.mjs <app-id>"); process.exit(2); }
// repointed for this mirror: all four primitive modules + _shared runtime live under os/usr/lib/holo.
const HOLOGRAM_OS = "C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/os/usr/lib/holo";
const APP_DIR = `C:/Users/pavel/Desktop/HOLOGRAM/holo-apps/apps/${APP}`;
const SHARED = "C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/os/usr/lib/holo";   // /_shared/ resolves here

const { sha256hex, sriOf, mbSha256 } = await import(pathToFileURL(join(HOLOGRAM_OS, "holo-uor.mjs")));
const { makeObject, contentLink } = await import(pathToFileURL(join(HOLOGRAM_OS, "holo-object.mjs")));
// the substrate σ-axis: BLAKE3 over the raw bytes, byte-identical to hologram's kappa() (KAT-proven,
// holo-blake3-witness). Every closure entry is DUAL-AXIS: did:holo:sha256 (the OS serving key) AND a
// did:holo:blake3 alsoKnownAs (the unified UOR substrate anchor) — so the app resolves on the substrate.
const { blake3hex } = await import(pathToFileURL(join(SHARED, "holo-blake3.mjs")));
// the holospace's own self-verifying coordinate in the finite Φ-Atlas-12288 torus, derived purely from
// its root identity — so the lock IS the single self-describing object: identity ⊕ substrate axis ⊕
// atlas position ⊕ sub-objects. Each app is a point in — and itself an — atlas (finite, acyclic, nestable).
const { atlasCoord, ATLAS } = await import(pathToFileURL(join(SHARED, "holo-atlas-coord.mjs")));

const TYPE = { ".html": "schema:WebPage", ".js": "schema:SoftwareSourceCode", ".mjs": "schema:SoftwareSourceCode",
  ".css": "schema:SoftwareSourceCode", ".json": "schema:Dataset", ".jsonld": "schema:Dataset", ".hc": "schema:SoftwareSourceCode",
  ".svg": "schema:ImageObject", ".png": "schema:ImageObject", ".wasm": "schema:SoftwareApplication" };
const typeOf = (p) => TYPE[extname(p).toLowerCase()] || "schema:MediaObject";
// Skip DOT-DIRECTORIES: local dev caches (forge/.models model blobs, .kvxproc KV cache, .git) that are
// not app content — they exceed static-host file limits and the app loads models at runtime via the
// IndexedDB κ-store, not the holospace closure. Dotfiles are still included; only dot-dirs are pruned.
const walk = (dir, out = []) => { for (const n of readdirSync(dir).sort()) { const p = join(dir, n);
  if (statSync(p).isDirectory()) { if (n.startsWith(".")) continue; walk(p, out); } else out.push(p); } return out; };

const def = JSON.parse(readFileSync(join(APP_DIR, "holospace.json"), "utf8"));
const prev = existsSync(join(APP_DIR, "holospace.lock.json")) ? JSON.parse(readFileSync(join(APP_DIR, "holospace.lock.json"), "utf8")) : { closure: {} };
const closure = {}, links = [];
const add = (abs, rel) => {
  if (closure[rel]) return;
  const bytes = readFileSync(abs), hex = sha256hex(bytes);
  closure[rel] = { kappa: `did:holo:sha256:${hex}`, sri: sriOf(bytes), multibase: mbSha256(bytes), bytes: bytes.length, alsoKnownAs: [`did:holo:blake3:${blake3hex(bytes)}`] };
  links.push({ ...contentLink("schema:hasPart", `sha256:${hex}`, typeOf(rel)), "schema:name": rel });
};

for (const p of walk(APP_DIR)) if (basename(p) !== "holospace.lock.json")
  add(p, `apps/${APP}/` + relative(APP_DIR, p).split("\\").join("/"));
for (const dep of def.shared || []) {
  const d = dep.replace(/\/$/, ""), dp = join(SHARED, d);
  if (existsSync(dp)) {                                          // an OS-runtime shared lib → vendor under _shared/
    if (statSync(dp).isDirectory()) { for (const f of walk(dp)) add(f, "_shared/" + relative(SHARED, f).split("\\").join("/")); }
    else add(dp, `_shared/${d}`);
  } else if (existsSync(join(APP_DIR, d))) {
    continue;                                                    // an APP-VENDORED bundle (webamp/ · holo-evm/ · videojs/) — already walked + dual-axis-hashed as apps/<id>/<dep> above
  } else {
    throw new Error(`missing shared dep (neither OS _shared nor app-local): ${dep}`);
  }
}
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

const changed = [];
for (const rel of new Set([...Object.keys(prev.closure || {}), ...Object.keys(closure)])) {
  const a = prev.closure?.[rel]?.kappa, b = closure[rel]?.kappa;
  if (a !== b) changed.push(`${a ? (b ? "~" : "-") : "+"} ${rel}`);
}
console.log(`root ${prev.root} → ${root.id}`);
console.log(`files ${Object.keys(prev.closure || {}).length} → ${Object.keys(closure).length}`);
console.log("changed:\n  " + (changed.length ? changed.join("\n  ") : "(none)"));

const lock = { "@context": { dcterms: "http://purl.org/dc/terms/", holo: "https://hologram.os/ns#" },
  root: root.id, identifier: def.id, algo: "sha256",
  "holo:within": ATLAS.object, "holo:atlasCoordinate": atlasCoord(root.id),   // self-coordinate (a point in — and itself an — atlas)
  files: Object.keys(closure).length, closure };
writeFileSync(join(APP_DIR, "holospace.lock.json"), JSON.stringify(lock, null, 2) + "\n");
console.log(`✓ wrote apps/${APP}/holospace.lock.json`);
