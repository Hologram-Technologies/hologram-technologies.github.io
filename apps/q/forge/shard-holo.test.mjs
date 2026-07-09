#!/usr/bin/env node
// shard-holo.test.mjs — prove the sharder (shard-holo.mjs) splits a .holo into parts the REAL spanning
// reader (gpu/holo-pack-shards.mjs spanReader) stitches back BYTE-IDENTICAL, and that openHoloStream still
// L5-verifies every body across part boundaries. So a 9B .holo can ship as <2 GiB parts with zero loss.
//
// Checks (all must hold):
//   1  manifestShape     — parts contiguous (start_i == start_{i-1}+len_{i-1}), Σlen == size, none > partSize, root = footer.
//   2  perPartSha256     — each part file re-hashes to its manifest sha256.
//   3  stitchByteEqual   — spanReader(parts, readPartFromDisk) reconstructs the original .holo byte-for-byte.
//   4  streamAcrossParts — openHoloStream over the spanning reader: headerBytes + every body L5-OK (boundary-straddling reads).
//   5  tinyPartsStress   — a deliberately tiny partSize (many parts, bodies split across several) still round-trips.
//
// Usage: node holo-apps/apps/q/forge/shard-holo.test.mjs

import { writeFileSync, readFileSync, rmSync, mkdtempSync, openSync, readSync, closeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sealHolo } from "./holo-forge-seal.mjs";
import { shardHolo } from "./shard-holo.mjs";
import { spanReader } from "./gpu/holo-pack-shards.mjs";
import { openHoloStream } from "./holo-archive.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const enc = new TextEncoder();
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const body = (seed, n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (seed * 131 + i * 7) & 0xff; return b; };

// a synthetic .holo big enough to span several parts at a small partSize
const blocks = new Map(), tensors = [];
for (const [name, seed, len] of [["token_embd", 1, 9000], ["blk.0.attn", 2, 6000], ["blk.1.attn", 3, 6000], ["output.weight", 4, 5000]]) {
  const b = body(seed, len), hex = sha256hex(b); blocks.set(hex, b); tensors.push({ name, kappa: "did:holo:sha256:" + hex, nbytes: len });
}
const sealed = sealHolo({ arch: "qwen2", sourceRoot: "did:holo:sha256:" + sha256hex(enc.encode("root")), tensors, blocks, extKey: "gguf.header", extBytes: enc.encode("GGUF-HDR…") });

const dir = mkdtempSync(join(tmpdir(), "holo-shard-"));
const holoPath = join(dir, "thinking.holo");
writeFileSync(holoPath, sealed.holo);

// disk-backed readPart(i, withinOff, n) the spanReader drives
function readPartFromDisk(outDir, parts) {
  return (i, off, n) => {
    const fd = openSync(join(outDir, parts[i].name), "r");
    try { const buf = Buffer.alloc(n); let got = 0; while (got < n) { const r = readSync(fd, buf, got, n - got, off + got); if (!r) break; got += r; } return new Uint8Array(buf.buffer, buf.byteOffset, got); }
    finally { closeSync(fd); }
  };
}

const checks = {};

async function roundTrip(partSize, label) {
  const outDir = join(dir, "out-" + label);
  const { manifest } = await shardHolo({ inPath: holoPath, outDir, partSize, gateway: "https://ipfs.example/" });
  // 1 · manifest shape
  let contiguous = manifest.parts[0].start === 0, sum = 0, withinCap = true;
  for (let i = 0; i < manifest.parts.length; i++) {
    const p = manifest.parts[i]; sum += p.len; if (p.len > manifest.partSize) withinCap = false;
    if (i > 0 && p.start !== manifest.parts[i - 1].start + manifest.parts[i - 1].len) contiguous = false;
  }
  const shapeOk = contiguous && sum === manifest.size && withinCap && manifest.root === sealed.rootHolo;
  // 2 · per-part sha256
  let partsOk = true;
  for (const p of manifest.parts) { const bytes = new Uint8Array(readFileSync(join(outDir, p.name))); if (bytes.length !== p.len || sha256hex(bytes) !== p.sha256) partsOk = false; }
  // 3 · stitch byte-equal via the REAL spanReader
  const read = spanReader(manifest.parts, readPartFromDisk(outDir, manifest.parts));
  const stitched = await read(0, manifest.size);
  const stitchOk = eq(stitched, sealed.holo);
  // 4 · openHoloStream over the spanning reader L5-verifies every body
  const h = await openHoloStream((off, len) => read(off, len));
  let bodiesOk = eq(h.headerBytes, new Uint8Array(enc.encode("GGUF-HDR…")));
  for (const [hex, b] of blocks) { const got = await h.getBody(hex); if (!eq(got, b)) bodiesOk = false; }
  return { shapeOk, partsOk, stitchOk, streamOk: bodiesOk, nParts: manifest.parts.length };
}

// normal-ish part size → a few parts
{
  const r = await roundTrip(8192, "normal");
  checks.manifestShape = r.shapeOk;
  checks.perPartSha256 = r.partsOk;
  checks.stitchByteEqual = r.stitchOk;
  checks.streamAcrossParts = r.streamOk;
}
// tiny part size → many parts, bodies split across several
{
  const r = await roundTrip(512, "tiny");
  checks.tinyPartsStress = r.shapeOk && r.partsOk && r.stitchOk && r.streamOk && r.nParts > 8;
}

try { rmSync(dir, { recursive: true, force: true }); } catch {}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "shard-holo.test.result.json"), JSON.stringify({
  spec: "Sharder (shard-holo.mjs) splits a .holo into <2 GiB delivery parts + a manifest the REAL spanning reader (holo-pack-shards.mjs spanReader/openShardedPack) stitches back byte-identical; openHoloStream still L5-verifies every body across part boundaries. A 9B .holo ships as parts with zero loss and one logical address.",
  authority: "holo-pack-shards.mjs spanReader · holo-archive openHoloStream L5 · GitHub 2 GiB asset cap",
  witnessed, checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ shard → spanReader stitch is byte-identical and L5-verified across boundaries" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
