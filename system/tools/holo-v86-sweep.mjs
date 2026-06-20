#!/usr/bin/env node
// holo-v86-sweep.mjs — substrate test sweep over every precompiled Holo v86 OS.
//
// The half a browser can't tell you: for each ready app, is the κ-integrity sound? Per format:
//   single-file → re-derive a sampled block from the local κ-store vs the manifest κ (full L5)
//   chunked     → fetch a sampled part from the CDN, re-derive vs the manifest κ (full L5)
//   bzImage     → re-derive the whole kernel vs kappa.image.bzimage.sha256 (full L5)
//   9pfs        → re-derive fs.json vs its sealed κ + prefix-verify a sampled file from the CDN
// Plus: index.html + kappa.json present and well-formed. Reports PASS/FAIL per OS so the browser
// boot sweep can skip anything structurally broken. Run with the dev server up is NOT required.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = "C:/Users/pavel/Desktop/HOLOGRAM";
const APPS = REPO + "/holo-apps/apps";
const { sha256hex } = await import(pathToFileURL(join(REPO, "holo-os/system/os/usr/lib/holo/holo-uor.mjs")));
const hexOf = (d) => String(d).split(":").pop();

const catalog = JSON.parse(readFileSync(join(APPS, "holo-v86/catalog.json"), "utf8")).os;
const only = process.argv[2];                          // optional: sweep one id
const targets = only ? catalog.filter((o) => o.id === only) : catalog;

const results = [];
async function check(o) {
  const dir = join(APPS, o.id);
  if (!existsSync(join(dir, "index.html"))) return { id: o.id, fmt: o.format, ok: null, note: "not precompiled" };
  let kappa;
  try { kappa = JSON.parse(readFileSync(join(dir, "kappa.json"), "utf8")); }
  catch { return { id: o.id, fmt: o.format, ok: false, note: "kappa.json missing/invalid" }; }
  const img = kappa.image || {};
  try {
    if (img.bzimage) {
      const p = img.bzimage; const bytes = readFileSync(join(dir, p.url.replace(/^\.\//, "")));
      const got = sha256hex(bytes);
      return { id: o.id, fmt: "bzImage", ok: got === p.sha256, note: got === p.sha256 ? `kernel ${(bytes.length/1048576).toFixed(1)}MB κ✓` : "kernel κ MISMATCH" };
    }
    if (img.ninepfs) {
      const fj = readFileSync(join(dir, "fs.json"));
      const ok1 = sha256hex(fj) === img.ninepfs.fsjson.sha256;
      // prefix-verify one sampled file from the tree
      const j = JSON.parse(fj.toString("utf8")); const files = [];
      (function w(ns) { for (const e of ns) { const m = e[3], pay = e[6];
        if ((m & 0xF000) === 0x8000 && typeof pay === "string") files.push({ id: pay, s: e[1] });
        else if ((m & 0xF000) === 0x4000 && Array.isArray(pay)) w(pay); } })(j.fsroot);
      const f = files.filter((x) => x.s > 0 && x.s < 30000)[0];
      let ok2 = true, note2 = "no sample";
      if (f) { const r = await fetch("https://i.copy.sh/arch/" + f.id); const b = Buffer.from(await r.arrayBuffer());
        ok2 = sha256hex(b).startsWith(f.id.replace(/\.bin$/, "")); note2 = `file ${ok2 ? "prefix✓" : "PREFIX✗"}`; }
      return { id: o.id, fmt: "9pfs", ok: ok1 && ok2, note: `fs.json ${ok1 ? "κ✓" : "κ✗"} · ${note2} · ${files.length} files` };
    }
    if (img.chunked) {
      const m = JSON.parse(readFileSync(join(dir, "images", img.chunked.manifest.replace(/^\.\/images\//, "")), "utf8"));
      const i = Math.floor(m.count / 2);               // sample a middle part
      const off = i * m.chunkSize;
      const url = m.host + m.basename + off + "-" + (off + m.chunkSize) + m.ext;
      const b = Buffer.from(await (await fetch(url)).arrayBuffer());
      const ok = "did:holo:sha256:" + sha256hex(b) === m.parts[i];
      return { id: o.id, fmt: "chunked", ok, note: `${m.count} parts · sample[${i}] ${ok ? "κ✓" : "κ✗"}` };
    }
    if (img.kblocks) {
      const base = readdirSync(join(dir, "images")).find((f) => f.endsWith(".kblocks.json"));
      const m = JSON.parse(readFileSync(join(dir, "images", base), "utf8"));
      const store = join(dir, "images", base.replace(/\.json$/, ""), ".holo", "sha256");
      const i = Math.min(1, m.blocks.length - 1);
      const hex = hexOf(m.blocks[i]);
      const ok = existsSync(join(store, hex)) && sha256hex(readFileSync(join(store, hex))) === hex;
      return { id: o.id, fmt: "single", ok, note: `${m.blockCount} blocks · sample[${i}] ${ok ? "κ✓" : "κ✗"}` };
    }
    return { id: o.id, fmt: o.format, ok: false, note: "no recognized image spec" };
  } catch (e) { return { id: o.id, fmt: o.format, ok: false, note: "ERR " + (e.message || e) }; }
}

// modest concurrency (chunked/9pfs hit the network)
for (let i = 0; i < targets.length; i += 6) {
  const batch = await Promise.all(targets.slice(i, i + 6).map(check));
  for (const r of batch) {
    results.push(r);
    if (r.ok === false) console.log(`  ✗ FAIL  ${r.id.padEnd(18)} ${(r.fmt||"").padEnd(8)} ${r.note}`);
    else if (r.ok === null) { /* not precompiled — skip line */ }
    else console.log(`  ✓ ok    ${r.id.padEnd(18)} ${(r.fmt||"").padEnd(8)} ${r.note}`);
  }
}
const ready = results.filter((r) => r.ok !== null);
const pass = ready.filter((r) => r.ok).length, fail = ready.filter((r) => !r.ok).length;
console.log(`\nSWEEP: ${pass}/${ready.length} precompiled OSes pass substrate integrity · ${fail} fail · ${results.length - ready.length} not precompiled`);
process.exit(fail ? 1 : 0);
