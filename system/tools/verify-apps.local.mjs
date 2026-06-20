#!/usr/bin/env node
// verify-apps.local.mjs — READ-ONLY proof that every holo-app is a κ-sealed object (Law L5).
// Mirrors relock-app.mjs computeApp EXACTLY, but writes nothing: it re-derives every file's
// κ from its bytes and the app's root κ from its manifest, then diffs against the stored
// holospace.lock.json. PASS = the seal re-derives byte-for-byte.
//
//   node tools/verify-apps.local.mjs

import { readFileSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, extname, basename, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const HOLO = join(here, "../os/usr/lib/holo");
const SHARED = HOLO;
const APPS = join(here, "../../../holo-apps/apps");

const { makeObject, contentLink } = await import(pathToFileURL(join(HOLO, "holo-object.mjs")));
const { atlasCoord } = await import(pathToFileURL(join(SHARED, "holo-atlas-coord.mjs")));

// sha256 via node:crypto — byte-identical to holo-uor.mjs sha256hex (both FIPS 180-4), just faster.
// Streamed in 4 MiB chunks so files > 2 GiB (e.g. q's weight blob) hash without readFileSync's limit.
const sha = (abs) => {
  const h = createHash("sha256"), fd = openSync(abs, "r"), buf = Buffer.allocUnsafe(1 << 22);
  try { let n; while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) h.update(n === buf.length ? buf : buf.subarray(0, n)); }
  finally { closeSync(fd); }
  return h.digest("hex");
};

const TYPE = { ".html": "schema:WebPage", ".js": "schema:SoftwareSourceCode", ".mjs": "schema:SoftwareSourceCode",
  ".css": "schema:SoftwareSourceCode", ".json": "schema:Dataset", ".jsonld": "schema:Dataset", ".hc": "schema:SoftwareSourceCode",
  ".svg": "schema:ImageObject", ".png": "schema:ImageObject", ".wasm": "schema:SoftwareApplication" };
const typeOf = (p) => TYPE[extname(p).toLowerCase()] || "schema:MediaObject";
const walk = (dir, out = []) => { for (const n of readdirSync(dir).sort()) { const p = join(dir, n);
  statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; };

// recompute closure + root for one app, EXACTLY as relock-app.mjs does (minus blake3/sri/multibase,
// which don't affect the κ identity or the root address).
function computeApp(APP) {
  const APP_DIR = join(APPS, APP);
  const def = JSON.parse(readFileSync(join(APP_DIR, "holospace.json"), "utf8"));
  const closure = {}, links = [];
  const add = (abs, rel) => {
    if (closure[rel]) return;
    const hex = sha(abs);
    closure[rel] = `did:holo:sha256:${hex}`;
    links.push({ ...contentLink("schema:hasPart", `sha256:${hex}`, typeOf(rel)), "schema:name": rel });
  };
  for (const p of walk(APP_DIR)) if (basename(p) !== "holospace.lock.json")
    add(p, `apps/${APP}/` + relative(APP_DIR, p).split("\\").join("/"));
  for (const dep of def.shared || []) {
    const d = dep.replace(/\/$/, ""), dp = join(SHARED, d);
    if (existsSync(dp)) {
      if (statSync(dp).isDirectory()) { for (const f of walk(dp)) add(f, "_shared/" + relative(SHARED, f).split("\\").join("/")); }
      else add(dp, `_shared/${d}`);
    } else if (existsSync(join(APP_DIR, d))) { continue; }
    else { throw new Error(`missing shared dep: ${dep}`); }
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
  return { root: root.id, closure, def };
}

const only = process.argv.slice(2);
const ids = readdirSync(APPS).filter((n) => {
  const d = join(APPS, n);
  return statSync(d).isDirectory() && existsSync(join(d, "holospace.json")) && existsSync(join(d, "holospace.lock.json"))
    && (!only.length || only.includes(n));
}).sort();

const catalog = (() => { try { return JSON.parse(readFileSync(join(APPS, "index.jsonld"), "utf8"))["dcat:dataset"] || []; } catch { return []; } })();
const inCatalog = new Set(catalog.map((e) => e["schema:identifier"]).filter(Boolean));

let pass = 0; const rows = [], fails = [];
for (const APP of ids) {
  try {
    const { root, closure, def } = computeApp(APP);
    const lock = JSON.parse(readFileSync(join(APPS, APP, "holospace.lock.json"), "utf8"));
    const stored = lock.closure || {};
    const allKeys = new Set([...Object.keys(stored), ...Object.keys(closure)]);
    let mism = 0, missing = 0, extra = 0; const badKeys = [];
    for (const k of allKeys) {
      const a = stored[k]?.kappa, b = closure[k];
      if (a && !b) { missing++; badKeys.push(`- ${k} (gone from disk)`); }       // in lock, not on disk
      else if (!a && b) { extra++; badKeys.push(`+ ${k} (not in lock)`); }        // on disk, not in lock
      else if (a !== b) { mism++; badKeys.push(`~ ${k} (bytes changed)`); }       // bytes changed since seal
    }
    const rootOk = root === lock.root;
    const entry = def.entry || "index.html";
    const entryOk = existsSync(join(APPS, APP, entry));
    const ok = rootOk && mism === 0 && missing === 0 && extra === 0 && entryOk;
    if (ok) pass++; else fails.push(APP);
    rows.push({ APP, files: Object.keys(stored).length, rootOk, mism, missing, extra,
      entryOk, cat: inCatalog.has(def.id), ok, badKeys });
  } catch (e) {
    fails.push(APP); rows.push({ APP, err: String(e.message || e), ok: false });
  }
}

const P = (b) => (b ? "✓" : "✗");
console.log(`\nκ-SEAL VERIFICATION — ${ids.length} apps with holospace.json+lock\n`);
console.log("app".padEnd(14), "seal", "root", "entry", "cat", " files  detail");
for (const r of rows) {
  if (r.err) { console.log(r.APP.padEnd(14), " ✗  ", "—".padEnd(4), "—".padEnd(5), "—", "  err:", r.err); continue; }
  const sealOk = r.mism === 0 && r.missing === 0 && r.extra === 0;
  const detail = sealOk ? "" : `  Δ mism=${r.mism} missingOnDisk=${r.missing} extraOnDisk=${r.extra}`;
  console.log(r.APP.padEnd(14), ` ${P(sealOk)}  `, ` ${P(r.rootOk)} `, `  ${P(r.entryOk)}  `, ` ${P(r.cat)} `,
    String(r.files).padStart(5), detail);
}
for (const r of rows) if (r.badKeys && r.badKeys.length) {
  console.log(`\n${r.APP}: ${r.badKeys.length} file(s) off-seal`);
  for (const k of r.badKeys.slice(0, 8)) console.log("   " + k);
}
console.log(`\nPASS ${pass}/${ids.length}  (re-derived byte-for-byte: seal+root+entry all ✓)`);
if (fails.length) console.log("NEEDS ATTENTION:", fails.join(", "));
