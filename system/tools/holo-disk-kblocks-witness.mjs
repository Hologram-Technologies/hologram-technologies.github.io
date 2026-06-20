#!/usr/bin/env node
// holo-disk-kblocks-witness.mjs — prove the κ-block disk seam reconstructs the real disk.
//
// The browser SW (holo-x86-kblocks-sw.js) answers v86's chunk-aligned Range reads from the
// κ-block DAG. This witness runs that SAME logic in Node — map offset → block index → block κ,
// re-derive the block's sha256 (Law L5), slice to the requested range — and asserts the bytes
// are IDENTICAL to the source image at every offset v86 would ever read. If this passes, the
// guest sees a bit-exact disk; the only thing it can't measure is in-browser fetch latency.
//
//   node tools/holo-disk-kblocks-witness.mjs [imagePath]   (default: holo-x86 linux4.iso)

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHARED = "C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/os/usr/lib/holo";
const DEFAULT_IMAGE = "C:/Users/pavel/Desktop/HOLOGRAM/holo-apps/apps/holo-x86/images/linux4.iso";
const { sha256hex } = await import(pathToFileURL(join(SHARED, "holo-uor.mjs")));
const hexOf = (did) => String(did).split(":").pop();

const imagePath = resolve(process.argv[2] || DEFAULT_IMAGE);
const imgDir = dirname(imagePath), base = basename(imagePath);
const manifestPath = join(imgDir, base + ".kblocks.json");
const storeDir = join(imgDir, base + ".kblocks", ".holo", "sha256");
if (!existsSync(manifestPath)) { console.error("no manifest — run holo-disk-encode.mjs first"); process.exit(1); }

const image = readFileSync(imagePath);
const m = JSON.parse(readFileSync(manifestPath, "utf-8"));
const { blockSize, blocks } = m;
const total = m.image.bytes;

let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) { pass++; } else { fail++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); } };

// 1. Whole-image identity + block-store L5: every block file re-derives to its manifest κ.
check("image bytes match manifest", image.length === total, image.length + " vs " + total);
const store = new Map();
for (const did of [...new Set(blocks.map(hexOf))]) {
  const p = join(storeDir, did);
  if (!existsSync(p)) { check("block present " + did.slice(0, 10), false, "missing file"); continue; }
  const bytes = readFileSync(p);
  check("block L5 " + did.slice(0, 10), sha256hex(bytes) === did, "hash != name");
  store.set(did, bytes);
}

// 2. serveRange — the EXACT SW algorithm — reconstructs bytes [start,end] from κ-blocks.
function serveRange(start, end) {
  end = Math.min(end, total - 1);
  const out = Buffer.alloc(end - start + 1);
  const first = Math.floor(start / blockSize), last = Math.floor(end / blockSize);
  for (let bi = first; bi <= last; bi++) {
    const block = store.get(hexOf(blocks[bi]));
    const blockStart = bi * blockSize;
    const from = Math.max(start, blockStart) - blockStart;
    const to = Math.min(end, blockStart + block.length - 1) - blockStart;
    block.copy(out, (blockStart + from) - start, from, to + 1);
  }
  return out;
}

// 3. The ranges v86 actually issues: the size probe (0-0), each single chunk, a multi-chunk span,
//    an unaligned read inside a block, and the final (short) block.
const ranges = [
  [0, 0],                                   // qa() size probe
  [0, blockSize - 1],                       // first chunk
  [blockSize, 2 * blockSize - 1],           // second chunk
  [3 * blockSize + 17, 3 * blockSize + 600],// unaligned read within a chunk
  [0, 4 * blockSize - 1],                   // 4-chunk span
  [(blocks.length - 1) * blockSize, total - 1], // final short block
  [total - 1, total + blockSize],           // read past EOF (clamps)
];
for (const [s, e] of ranges) {
  const got = serveRange(s, e);
  const want = image.subarray(s, Math.min(e, total - 1) + 1);
  check(`range ${s}-${e}`, Buffer.compare(got, want) === 0, "length " + got.length + " vs " + want.length);
}

// 4. Full sequential reconstruction (every block in order) === the image.
const all = serveRange(0, total - 1);
check("full reconstruction κ", sha256hex(all) === hexOf(m.image.did), "reassembled disk κ != image κ");

console.log(`\nholo-disk-kblocks-witness: ${pass} pass · ${fail} fail`);
console.log(`  ${blocks.length} blocks @ ${blockSize} B · ${m.uniqueBlocks} unique · disk κ ${m.image.did.slice(0,24)}…`);
process.exit(fail ? 1 : 0);
