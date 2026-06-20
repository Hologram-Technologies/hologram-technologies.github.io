#!/usr/bin/env node
// holo-v86-meta.mjs — compute the real O(1)/content-addressing story for the Holo v86 god-view.
//
// The catalog is huge nominally (every OS's full image) but tiny on the substrate, because:
//   • the v86 engine + BIOSes are ONE shared κ across all OSes (stored once, not per-app),
//   • chunked + 9pfs OSes are MANIFEST-ONLY (the bytes stream + verify on demand, never pinned),
//   • single-file disks store only their (intra-dedup'd) κ-blocks; bzImage stores just the kernel.
// This writes apps/holo-v86/meta.json with the true figures the gallery reads — no hand-waving.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const APPS = "C:/Users/pavel/Desktop/HOLOGRAM/holo-apps/apps";
const P = JSON.parse(readFileSync(join(APPS, "holo-v86/profiles.json"), "utf8"));
const C = JSON.parse(readFileSync(join(APPS, "holo-v86/catalog.json"), "utf8")).os;
const dirSize = (d) => { let n = 0; if (!existsSync(d)) return 0;
  for (const f of readdirSync(d)) { const p = join(d, f); const s = statSync(p); n += s.isDirectory() ? dirSize(p) : s.size; } return n; };
const fileSize = (p) => existsSync(p) ? statSync(p).size : 0;

// The shared engine set: identical κ in every app → the substrate stores it ONCE.
const engineOnce = ["libv86.js", "v86.wasm", "seabios.bin", "vgabios.bin", "bochs-vgabios.bin"]
  .reduce((n, f) => n + fileSize(join(APPS, "holo-x86/vendor/v86", f)), 0);

let ready = 0, nominal = 0, pinned = engineOnce, streamed = 0, byFmt = {};
for (const o of C) {
  const dir = join(APPS, o.id);
  if (!existsSync(join(dir, "index.html"))) continue;
  ready++; byFmt[o.format] = (byFmt[o.format] || 0) + 1;
  const size = (P[o.id] && P[o.id].size) || 0;
  nominal += size;
  if (o.format === "single") {
    const base = readdirSync(join(dir, "images")).find((f) => f.endsWith(".kblocks.json"));
    pinned += base ? dirSize(join(dir, "images", base.replace(/\.json$/, ""))) : 0;   // the κ-block store
  } else if (o.format === "bzimage") {
    pinned += fileSize(join(dir, "kappa.json")) ? (JSON.parse(readFileSync(join(dir, "kappa.json"), "utf8")).image.bzimage.bytes || 0) : 0;
  } else if (o.format === "9pfs") {
    pinned += fileSize(join(dir, "fs.json")); streamed += size;                       // root streams; only fs.json pinned
  } else if (o.format === "chunked") {
    const mf = readdirSync(join(dir, "images")).find((f) => f.endsWith(".parts.json"));
    pinned += mf ? fileSize(join(dir, "images", mf)) : 0; streamed += size;            // parts stream; only manifest pinned
  }
}

const gb = (n) => (n / 1073741824);
const meta = {
  machines: ready, cataloged: C.length, byFormat: byFmt,
  nominalBytes: nominal, pinnedBytes: pinned, streamedBytes: streamed,
  engineSharedBytes: engineOnce, engineCopiesAvoided: ready - 1,
  leanerFactor: pinned ? +(nominal / pinned).toFixed(1) : 0,
  // human-friendly strings the gallery can show verbatim
  nominal: gb(nominal) >= 1 ? gb(nominal).toFixed(1) + " GB" : (nominal / 1048576).toFixed(0) + " MB",
  pinned: gb(pinned) >= 1 ? gb(pinned).toFixed(2) + " GB" : (pinned / 1048576).toFixed(0) + " MB",
};
const out = join(APPS, "holo-v86/meta.json");
import("node:fs").then(({ writeFileSync }) => {
  writeFileSync(out, JSON.stringify(meta, null, 2) + "\n");
  console.log("holo-v86-meta:");
  console.log(`  ${meta.machines} machines · nominal ${meta.nominal} · pinned ${meta.pinned} · ${meta.leanerFactor}× leaner`);
  console.log(`  engine shared once (${(engineOnce/1048576).toFixed(1)}MB) → ${meta.engineCopiesAvoided} copies avoided`);
  console.log(`  by format: ${JSON.stringify(byFmt)}`);
  console.log(`  wrote ${out}`);
});
