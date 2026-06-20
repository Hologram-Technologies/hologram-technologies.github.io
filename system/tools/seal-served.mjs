#!/usr/bin/env node
// seal-served.mjs — pin the WHOLE served first-party OS, not just the boot closure. os-closure.json is
// the curated network-free BOOT set (~500 κ); but the Service Worker serves the entire os/ tree, and
// today every file OUTSIDE the boot closure is passed through UNVERIFIED (holo-fhs-sw.js: the unpinned
// branch) — so ~93% of served bytes skip Law L5 on a static, untrusted GitHub-Pages origin. This tool
// closes that: it walks the deployed os/ tree and records a serve-rel → did:holo:sha256 pin for EVERY
// file, in the SAME shape as os-closure.json so the SW folds it with the existing foldClosure() (no new
// code path). The SW loads it lazily and re-derives every served byte against its κ (Law L5), refusing a
// tampered one — coverage goes from the boot closure to the whole OS.
//
// Scope = exactly what the static host serves: the working os/ tree minus .git/node_modules. Gitignored,
// undeployed heavy blobs (e.g. the voice vendor, app VM images) are NOT on disk here and heal by κ via
// their own manifests (ensureVoiceManifest / per-app holospace.lock.json) — so they are out of scope by
// construction, never silently dropped. Deterministic (sorted, no timestamps): the manifest re-derives
// byte-for-byte. Re-run after any os/ edit, before sealing the SW.
//
//   node tools/seal-served.mjs

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { OS_DIR } from "./holo-paths.mjs";

const OUT = join(OS_DIR, "etc/os-served.json");
const EXCLUDE = /(^|[\\/])(\.git|node_modules)([\\/]|$)/;
// The manifest is the pin SOURCE, not a served object; transient/per-run outputs are not canonical forms.
const SKIP = /(os-served\.json|\.result\.json|earl-report\.jsonld|[\\/]progress\.json|\.DS_Store|Thumbs\.db|\.swp|\.tmp|\.log)$/i;

const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const walk = (dir, out = []) => {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (EXCLUDE.test(p)) continue;
    let s; try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p, out);
    else if (!SKIP.test(n)) out.push(p);
  }
  return out;
};

const closure = {};
let n = 0, bytes = 0;
for (const abs of walk(OS_DIR)) {
  if (abs === OUT) continue;
  const rel = relative(OS_DIR, abs).split("\\").join("/");   // serve-rel path = exactly the SW's `rel`
  const buf = readFileSync(abs);
  closure[rel] = `did:holo:sha256:${sha256hex(buf)}`;
  n++; bytes += buf.length;
}

const sorted = {}; for (const k of Object.keys(closure).sort()) sorted[k] = closure[k];
const doc = {
  "@context": { "dcterms": "http://purl.org/dc/terms/" },
  "dcterms:title": "Hologram OS — the SERVED-set closure (every served first-party byte, Law L5)",
  "spec": "A serve-rel → did:holo:sha256 pin for EVERY file the Service Worker serves from the os/ tree, so re-derivation (Law L5) covers the whole OS — not only the boot closure (os-closure.json). Folded by holo-fhs-sw.js with the same foldClosure() as os-closure; identity is content, not location (Law L1). Gitignored/undeployed heavy blobs heal by κ via their own manifests and are out of scope here.",
  "count": n, "bytes": bytes,
  "closure": sorted,
};
writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n");
console.log(`served-set closure → os/etc/os-served.json`);
console.log(`  ${n} served files pinned · ${(bytes / 1048576).toFixed(1)} MB · serve-rel keys, foldClosure-shaped (Law L5 coverage = whole OS)`);
