#!/usr/bin/env node
// holo-pin-closure.mjs — pin the WHOLE Hologram OS boot closure to IPFS so it boots location-agnostic.
// Every object in os/etc/os-closure.json is uploaded as a RAW block to Pinata; for a single block the
// returned CID is bafkrei(sha256(bytes)) — exactly kappaToCid(κ) — so each OS object becomes resolvable
// from any IPFS trustless gateway BY ITS CONTENT (Law L1) and re-derives to its κ (Law L5). Objects over
// one block (a few large vendor bundles) are reported: their κ is a plain sha256, not a chunked-DAG root,
// so they resolve via the SW recovery chain (cache → peers → origin), not a single-block gateway fetch.
//
//   node tools/holo-pin-closure.mjs            # pin all (resumable — skips entries already in the result)
//   node tools/holo-pin-closure.mjs --verify   # re-derive a sample from public gateways
//   node tools/holo-pin-closure.mjs --dry      # resolve + hash every object locally, no upload
//
// Token: C:\Users\pavel\.pinata.jwt (read here, never printed). Result: tools/holo-closure-pin.result.json.

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS2 = join(here, "../os");
const APPS = process.env.HOLO_APPS_REPO || join(here, "../../../holo-apps");
const JWT_FILE = process.env.PINATA_JWT_FILE || "C:/Users/pavel/.pinata.jwt";
const RESULT = join(here, "holo-closure-pin.result.json");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { fhsMap } = await import(pathToFileURL(join(OS2, "lib/holo-fhs-map.mjs")));
const { kappaToCid } = await import(pathToFileURL(join(OS2, "usr/lib/holo/holo-cid.mjs")));

// resolve a closure key (serve-rel path) to its physical bytes — same order the κ-route server uses.
const bytesOf = (key) => {
  if (key.startsWith("apps/")) { const a = join(APPS, key); if (existsSync(a) && statSync(a).isFile()) return readFileSync(a); }
  const p = fhsMap(key); if (p) { const f = join(OS2, p); if (existsSync(f) && statSync(f).isFile()) return readFileSync(f); }
  const d = join(OS2, key); if (existsSync(d) && statSync(d).isFile()) return readFileSync(d);
  const m = key.match(/^_shared\/(.+)$/); if (m) { const l = join(OS2, "lib", m[1]); if (existsSync(l) && statSync(l).isFile()) return readFileSync(l); }
  return null;
};

const doc = JSON.parse(readFileSync(join(OS2, "etc/os-closure.json"), "utf8"));
const closure = doc.closure;
const entries = Object.entries(closure).map(([key, e]) => ({ key, kappa: (e.kappa || "").replace(/^did:holo:sha256:/, "") }));

const results = existsSync(RESULT) ? JSON.parse(readFileSync(RESULT, "utf8")) : { pinned: {}, mismatch: {}, missing: [], chunked: {} };
const save = () => writeFileSync(RESULT, JSON.stringify(results, null, 2) + "\n");

if (process.argv.includes("--verify")) {
  // Pinata's own gateway LEADS the DHT — public gateways lag minutes/hours behind a fresh pin, so a ✗ on a
  // public gateway means "not propagated yet", not "bad pin". Compare the fetched bytes to the object's TRUE
  // κ (from the closure), not to the CID (the old stub did sha===cid, which can never match → false ✗).
  const GW = ["https://gateway.pinata.cloud", "https://trustless-gateway.link", "https://ipfs.io", "https://dweb.link"];
  const kappaHexOf = new Map(entries.map((e) => [e.key, e.kappa]));
  const sample = Object.entries(results.pinned).slice(0, 6);
  console.log(`verifying ${sample.length} pinned objects re-derive to their κ from gateways…`);
  for (const [key, cid] of sample) {
    const want = kappaHexOf.get(key); let okGw = null;
    for (const g of GW) {
      try { const r = await fetch(`${g}/ipfs/${cid}?format=raw`, { headers: { accept: "application/vnd.ipld.raw" }, signal: AbortSignal.timeout(12000) });
        if (r.ok) { const b = new Uint8Array(await r.arrayBuffer()); if (sha(b) === want) { okGw = g.replace("https://", ""); break; } } } catch {}
    }
    console.log(`  ${okGw ? "✓" : "✗"} ${key} · ${cid.slice(0, 18)}… ${okGw ? "re-derives @ " + okGw : "(not yet on tried gateways — DHT lag)"}`);
  }
  process.exit(0);
}

// dry run / resolve check
let missing = 0;
for (const e of entries) { if (!bytesOf(e.key)) { missing++; if (!results.missing.includes(e.key)) results.missing.push(e.key); } }
console.log(`closure: ${entries.length} objects · ${missing} unresolved locally`);
if (process.argv.includes("--dry")) { save(); console.log("dry run — no uploads"); process.exit(missing ? 1 : 0); }

const jwt = readFileSync(JWT_FILE, "utf8").trim();
const todo = entries.filter((e) => !results.pinned[e.key] && bytesOf(e.key));
console.log(`${Object.keys(results.pinned).length} already pinned · ${todo.length} to pin\n`);

async function pinOne(e) {
  const bytes = bytesOf(e.key);
  const wantCid = kappaToCid("did:holo:sha256:" + e.kappa);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = new FormData();
      fd.append("file", new Blob([bytes]), e.key.split("/").pop());
      fd.append("network", "public");
      fd.append("name", "holo-os/" + e.key);
      const r = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: fd, signal: AbortSignal.timeout(60000) });
      if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      const j = await r.json();
      const cid = j && j.data && j.data.cid;
      if (!cid) throw new Error("no cid: " + JSON.stringify(j).slice(0, 120));
      if (cid === wantCid) { results.pinned[e.key] = cid; }
      else { results.chunked[e.key] = { cid, wantCid, bytes: bytes.length }; }   // >1 block — κ ≠ chunked root
      return cid === wantCid ? "ok" : "chunked";
    } catch (err) { if (attempt === 2) { results.mismatch[e.key] = String(err.message || err).slice(0, 140); return "err"; } await sleep(1500); }
  }
}

// concurrency pool
const CONC = 6;
let done = 0, ok = 0, chunked = 0, err = 0;
const queue = todo.slice();
async function worker() {
  while (queue.length) {
    const e = queue.shift();
    const res = await pinOne(e);
    done++; if (res === "ok") ok++; else if (res === "chunked") chunked++; else err++;
    if (done % 20 === 0 || queue.length === 0) { save(); console.log(`  ${done}/${todo.length} · ok ${ok} · chunked ${chunked} · err ${err}`); }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
save();
console.log(`\npinned ${Object.keys(results.pinned).length}/${entries.length} as raw blocks (CID == κ)`);
if (Object.keys(results.chunked).length) console.log(`chunked (>1 block, κ≠root, serve via SW recovery): ${Object.keys(results.chunked).length} — ${Object.keys(results.chunked).join(", ")}`);
if (Object.keys(results.mismatch).length) console.log(`errors: ${Object.keys(results.mismatch).length}`);
console.log(`result → ${RESULT}`);
