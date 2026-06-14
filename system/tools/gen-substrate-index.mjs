#!/usr/bin/env node
// gen-substrate-index.mjs — make EVERY first-party file in Hologram OS2 + Hologram Apps a first-class,
// attribute-addressed object native to the unified UOR substrate. Walks both repos and records, for
// every file, its DUAL-AXIS content address — the OS serving key (did:holo:sha256) AND the substrate
// σ-axis κ (did:holo:blake3, BLAKE3 over the bytes ≡ hologram's kappa(), KAT-proven). Identity is the
// content, never the path (Law L1). The result, os/etc/substrate-index.json, is the corpus address
// space (Law L3, the store is the memory): every object discoverable + verifiable by its κ.
//
// Consume-by-reference (ADR-006): external / regenerable trees are NOT re-minted — .git, node_modules,
// Rust target/, and the `holospaces` substrate submodule (its identity is upstream) are excluded.
// Deterministic (sorted, no timestamps): the index re-derives byte-for-byte. App-file κ are reused
// from each app's lock (so q's ~1 GB of vendored models is not re-hashed).
//
//   node tools/gen-substrate-index.mjs

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS2 = "C:/Users/pavel/Desktop/Hologram OS2";
const APPS = "C:/Users/pavel/Desktop/Hologram Apps";
const OUT = join(here, "../os/etc/substrate-index.json");
const { blake3hex } = await import(pathToFileURL(join(here, "../os/usr/lib/holo/holo-blake3.mjs")));

const EXCLUDE = /(^|[\\/])(\.git|node_modules|target|holospaces|\.vscode|\.idea|__pycache__|\.pytest_cache)([\\/]|$)/;
// transient runtime artifacts are NOT canonical forms (deterministic content) — a log/progress/witness
// output is written and rewritten, so it is not a stable first-class object; it is left out of the index.
// Compiled Python bytecode (.pyc) is regenerable build output (like node_modules/target) — not source.
const SKIPFILE = /(\.DS_Store|Thumbs\.db|\.swp|\.log|\.tmp|\.pyc|[\\/]progress\.json|\.result\.json|earl-report\.jsonld|substrate-index\.json)$/i;
const TYPE = { ".html": "schema:WebPage", ".js": "schema:SoftwareSourceCode", ".mjs": "schema:SoftwareSourceCode",
  ".ts": "schema:SoftwareSourceCode", ".rs": "schema:SoftwareSourceCode", ".css": "schema:SoftwareSourceCode",
  ".json": "schema:Dataset", ".jsonld": "schema:Dataset", ".md": "schema:Article", ".txt": "schema:Article",
  ".svg": "schema:ImageObject", ".png": "schema:ImageObject", ".jpg": "schema:ImageObject", ".jpeg": "schema:ImageObject",
  ".wasm": "schema:SoftwareApplication", ".gz": "schema:MediaObject", ".woff2": "schema:MediaObject" };
const typeOf = (p) => TYPE[extname(p).toLowerCase()] || "schema:MediaObject";

const sha256hex = (b) => createHash("sha256").update(b).digest("hex");

// reuse already-computed κ from every app's lock (keyed by ABSOLUTE app-file path) → avoid re-hashing
const reuse = new Map();
for (const id of readdirSync(join(APPS, "apps"))) {
  const lk = join(APPS, "apps", id, "holospace.lock.json");
  if (!existsSync(lk)) continue;
  try { const cl = JSON.parse(readFileSync(lk, "utf8")).closure || {};
    for (const [key, e] of Object.entries(cl)) {
      if (!key.startsWith("apps/") || typeof e !== "object") continue;
      const sha = String(e.kappa || "").split(":").pop();
      const bl = (e.alsoKnownAs || []).map((k) => /^did:holo:blake3:([0-9a-f]{64})$/.exec(String(k))).find(Boolean);
      if (/^[0-9a-f]{64}$/.test(sha) && bl) reuse.set(join(APPS, key), { sha256: sha, blake3: bl[1] });
    }
  } catch {}
}

const walk = (dir, out = []) => { for (const n of readdirSync(dir).sort()) { const p = join(dir, n);
  if (EXCLUDE.test(p)) continue;
  let s; try { s = statSync(p); } catch { continue; }
  if (s.isDirectory()) walk(p, out); else if (!SKIPFILE.test(n)) out.push(p);
} return out; };

const objects = {};
let n = 0, bytes = 0, reused = 0, computed = 0;
for (const [prefix, root] of [["os2", OS2], ["apps", APPS]]) {
  for (const abs of walk(root)) {
    if (abs === OUT) continue;                                 // the index is the address space, not an object in it
    const rel = prefix + "/" + relative(root, abs).split("\\").join("/");
    let sha, bl, sz;
    const hit = reuse.get(abs);
    if (hit) { sha = hit.sha256; bl = hit.blake3; sz = statSync(abs).size; reused++; }
    else { const buf = readFileSync(abs); sha = sha256hex(buf); bl = blake3hex(buf); sz = buf.length; computed++; }
    objects[rel] = { sha256: `did:holo:sha256:${sha}`, blake3: `did:holo:blake3:${bl}`, bytes: sz, type: typeOf(abs) };
    n++; bytes += sz;
  }
}

const sorted = {}; for (const k of Object.keys(objects).sort()) sorted[k] = objects[k];
const doc = {
  "@context": { "schema": "https://schema.org/", "dcterms": "http://purl.org/dc/terms/" },
  "dcterms:title": "Hologram OS — the unified UOR substrate object index",
  "spec": "Every first-party file in Hologram OS2 + Hologram Apps is a first-class, attribute-addressed object on the unified UOR substrate: dual-axis content address — did:holo:sha256 (OS serving) AND did:holo:blake3 (the substrate σ-axis ≡ hologram kappa()). Identity is content, not location (Law L1).",
  "roots": { "os2": OS2, "apps": APPS },
  "excluded": ".git · node_modules · target · holospaces (submodule, consume-by-reference) · .vscode",
  "algo": { "serving": "sha256", "substrate": "blake3" },
  "count": n, "bytes": bytes,
  "objects": sorted,
};
writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n");
console.log(`substrate object index → os/etc/substrate-index.json`);
console.log(`  ${n} first-class objects · ${(bytes / 1048576).toFixed(1)} MB · ${reused} κ reused (app locks) · ${computed} κ computed`);
