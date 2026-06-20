#!/usr/bin/env node
// holo-disk-encode.mjs — encode a v86 disk image as a native κ-BLOCK DAG.
//
// A disk is not one blob. v86 already reads it lazily: in the browser its async backend
// (libv86.js `ya`) fetches the image one `fixed_chunk_size`-aligned range at a time over an
// XHR `Range` request. That access pattern IS a content-addressable DAG waiting to happen —
// the disk analog of the holo-tube MediaGraph (an init + ordered media segments, each a κ).
//
// This tool splits the image into fixed-size blocks, seals EACH block as a κ-object
// (sha256 → /.holo/sha256/<hex>, the OS serving axis), and writes a manifest: the ordered
// block-κ list + a single closure root κ over the whole set (Law L2·L5). Identical blocks
// collapse to one object (a zero-filled disk tail is one κ reused N times) — dedup for free.
// Block bytes are preserved BIT-EXACT; the image is never rewritten on the identity path.
//
// What this buys, vs today's monolithic `cdrom: { buffer: iso }`:
//   - any image size streams lazily — only the blocks the guest touches ever resolve;
//   - each block is independently κ-addressed, L5-verifiable, IPFS-pinnable, healable;
//   - writes become NEW κ-blocks over a read-only base (the CoW δ-chain falls out for free).
//
//   node tools/holo-disk-encode.mjs [imagePath] [--block <KiB>] [--out <dir>]
//       Default imagePath = holo-x86's Buildroot linux4.iso. Default --block 256 (KiB) — this
//       MUST equal the `fixed_chunk_size` the runtime hands v86, so block boundaries line up
//       with v86's range alignment. Default --out = <imageDir>/<base>.kblocks/ (holds the
//       .holo/sha256/<hex> store); the manifest lands at <imageDir>/<base>.kblocks.json.
//
// After encoding, the tool self-verifies: reassemble every block in order, sha256 the result,
// assert it equals the whole-image κ. A faithful κ-DAG re-derives the original disk exactly.

import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SHARED = "C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/os/usr/lib/holo";
const DEFAULT_IMAGE = "C:/Users/pavel/Desktop/HOLOGRAM/holo-apps/apps/holo-x86/images/linux4.iso";

const { sha256hex } = await import(pathToFileURL(join(SHARED, "holo-uor.mjs")));

const SHA = "did:holo:sha256:";
const kappaOf = (bytes) => SHA + sha256hex(bytes);
const hexOf = (did) => did.slice(SHA.length);

// jcs — minimal RFC 8785 canonical JSON over a sorted string array, so the closure κ is
// reproducible byte-for-byte (the disk analog of mediaGraphClosureKappa). Strings only.
const jcs = (arr) => JSON.stringify(arr);

function parseArgs(argv) {
  const a = { image: null, blockKiB: 256, out: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--block") a.blockKiB = Number(argv[++i]);
    else if (t === "--out") a.out = argv[++i];
    else if (!t.startsWith("--")) a.image = t;
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const imagePath = resolve(args.image || DEFAULT_IMAGE);
if (!existsSync(imagePath)) { console.error("image not found: " + imagePath); process.exit(1); }
const blockSize = args.blockKiB * 1024;
if (!Number.isInteger(blockSize) || blockSize <= 0) { console.error("--block must be a positive integer (KiB)"); process.exit(1); }

const imgDir = dirname(imagePath);
const base = basename(imagePath);
const outDir = resolve(args.out || join(imgDir, base + ".kblocks"));
const storeDir = join(outDir, ".holo", "sha256");
const manifestPath = join(imgDir, base + ".kblocks.json");

console.log("holo-disk-encode");
console.log("  image      " + imagePath);
console.log("  block size " + blockSize + " bytes (" + args.blockKiB + " KiB)");
console.log("  store      " + storeDir);

const image = readFileSync(imagePath);
const wholeKappa = kappaOf(image);
const blockCount = Math.ceil(image.length / blockSize);

mkdirSync(storeDir, { recursive: true });

// Seal each block. Dedup: an identical block (e.g. a run of zero-fill) is written once and its
// κ reused at every index. The store is content-addressed, so writing the same hex is a no-op.
const blocks = [];           // did per index, in disk order
const seen = new Set();      // unique hexes actually written
let bytesWritten = 0;

for (let i = 0; i < blockCount; i++) {
  const start = i * blockSize;
  const block = image.subarray(start, Math.min(start + blockSize, image.length)); // final block may be short
  const hex = sha256hex(block);
  const did = SHA + hex;
  blocks.push(did);
  if (!seen.has(hex)) {
    seen.add(hex);
    const dest = join(storeDir, hex);
    if (!existsSync(dest)) { writeFileSync(dest, block); bytesWritten += block.length; }
  }
}

// Closure root κ — a single κ over the sorted, deduped block-κ set. Non-circular (never includes
// itself), so it re-derives from the blocks alone: prove the root and you've pinned every byte the
// disk can hold (Law L2·L5). Same construction as mediaGraphClosureKappa, blocks instead of segments.
const uniqueSorted = [...seen].sort();
const rootKappa = SHA + sha256hex(Buffer.from(jcs(uniqueSorted), "utf-8"));

const manifest = {
  $comment:
    "κ-block DAG for a v86 disk image. Each block is a content-addressed object at " +
    ".holo/sha256/<hex>; the runtime resolves blocks by κ on demand and re-derives each " +
    "before it reaches the guest (Law L5). blockSize MUST equal v86's fixed_chunk_size.",
  algo: "sha256",
  image: { name: base, bytes: image.length, did: wholeKappa },
  blockSize,
  blockCount,
  uniqueBlocks: seen.size,
  dedup: ((1 - seen.size / blockCount) * 100).toFixed(1) + "%",
  root: rootKappa,
  blocks,
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log("  blocks     " + blockCount + " (" + seen.size + " unique, " + manifest.dedup + " dedup)");
console.log("  written    " + bytesWritten + " bytes of block objects");
console.log("  whole κ    " + wholeKappa);
console.log("  root κ     " + rootKappa);
console.log("  manifest   " + manifestPath);

// Self-verify: reassemble blocks in order from the κ-store and re-derive the whole-image κ. A
// faithful DAG reproduces the original disk byte-for-byte. This is the Stage-1 proof.
const parts = [];
for (const did of blocks) parts.push(readFileSync(join(storeDir, hexOf(did))));
const reassembled = Buffer.concat(parts);
const roundTripKappa = kappaOf(reassembled);
const ok = roundTripKappa === wholeKappa && reassembled.length === image.length;

console.log(ok
  ? "  verify     PASS — reassembled κ-DAG re-derives the image exactly (" + reassembled.length + " bytes)"
  : "  verify     FAIL — round-trip κ " + roundTripKappa + " != image κ " + wholeKappa);
process.exit(ok ? 0 : 1);
