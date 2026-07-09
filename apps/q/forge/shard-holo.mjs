// shard-holo.mjs — split a (multi-GB) .holo into <2 GiB delivery parts + a manifest the spanning reader
// (gpu/holo-pack-shards.mjs openShardedPack) consumes UNCHANGED. Sharding is pure transport: above the
// rangeReader the OS sees one contiguous file at one address (the archive κ). This is S3 of the thinking-
// brain plan — a 9B .holo exceeds GitHub's 2 GiB per-asset cap, so it ships as parts streamed by HTTP Range
// from a CORS+Range source (CDN over the repo, or an IPFS gateway by CID), every block still L5-verified.
//
//   node shard-holo.mjs <in.holo> <outDir> [--part-size=1900000000] [--gateway=https://ipfs.io]
//                                          [--cdn=<jsDelivr base>] [--raw=<raw.githubusercontent base>]
//
// Emits  <base>.part00, <base>.part01, …  and  <base>.parts.json:
//   { algo, file, size, root, partSize, count, gateway, cdnBase, rawBase,
//     parts:[ { name, start, len, sha256, cid } ] }     // start/len/name = what spanReader needs; cid filled at pin time
// Streams part-by-part (peak memory = one 8 MB copy buffer), never holds the whole archive.

import { open, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";

const PART_MAX = 1_900_000_000;          // < 2 GiB (2147483648) GitHub per-asset cap, with margin
const COPY = 8 * 1024 * 1024;

export async function shardHolo({ inPath, outDir, partSize = PART_MAX, gateway = "", cdnBase = "", rawBase = "" }) {
  await mkdir(outDir, { recursive: true });
  const base = basename(inPath);
  const fh = await open(inPath, "r");
  try {
    const { size } = await fh.stat();
    if (size < 32) throw new Error("shard-holo: input too small to be a .holo");
    const foot = Buffer.alloc(32); await fh.read(foot, 0, 32, size - 32);   // footer = sha256(everything-before) = archive κ
    const root = "did:holo:sha256:" + foot.toString("hex");

    const count = Math.max(1, Math.ceil(size / partSize));
    const width = Math.max(2, String(count - 1).length);
    const parts = [];
    for (let i = 0; i < count; i++) {
      const start = i * partSize, len = Math.min(partSize, size - start);
      const name = `${base}.part${String(i).padStart(width, "0")}`;
      const out = await open(join(outDir, name), "w");
      const hash = createHash("sha256");
      try {
        for (let o = 0; o < len; o += COPY) {
          const n = Math.min(COPY, len - o);
          const buf = Buffer.allocUnsafe(n);
          let got = 0; while (got < n) { const { bytesRead } = await fh.read(buf, got, n - got, start + o + got); if (!bytesRead) break; got += bytesRead; }
          if (got !== n) throw new Error(`shard-holo: short read @${start + o}`);
          await out.write(buf); hash.update(buf);
        }
      } finally { await out.close(); }
      parts.push({ name, start, len, sha256: hash.digest("hex"), cid: null });
    }

    const manifest = { algo: "sha256", file: base, size, root, partSize, count, gateway, cdnBase, rawBase, parts };
    const manifestName = `${base}.parts.json`;
    await writeFile(join(outDir, manifestName), JSON.stringify(manifest) + "\n");
    return { manifest, manifestName, outDir };
  } finally {
    await fh.close();
  }
}

// ── CLI ──
const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("shard-holo.mjs");
if (invokedDirect) {
  const args = process.argv.slice(2);
  const pos = args.filter((a) => !a.startsWith("--"));
  const flag = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : d; };
  const IN = pos[0], OUTDIR = pos[1];
  if (!IN || !OUTDIR) { console.error("usage: node shard-holo.mjs <in.holo> <outDir> [--part-size=N] [--gateway=URL] [--cdn=URL] [--raw=URL]"); process.exit(1); }
  const { manifest, manifestName } = await shardHolo({
    inPath: IN, outDir: OUTDIR,
    partSize: Number(flag("part-size", PART_MAX)),
    gateway: flag("gateway", ""), cdnBase: flag("cdn", ""), rawBase: flag("raw", ""),
  });
  console.log(`sharded ${manifest.file} (${(manifest.size / 1e6).toFixed(1)} MB) → ${manifest.count} part(s) ≤ ${(manifest.partSize / 1e6).toFixed(0)} MB`);
  for (const p of manifest.parts) console.log(`  ${p.name}  ${(p.len / 1e6).toFixed(1)} MB  sha256:${p.sha256.slice(0, 12)}…`);
  console.log(`  manifest   ${manifestName}`);
  console.log(`  archive κ  ${manifest.root}`);
  if (!manifest.gateway && !manifest.cdnBase) console.log("  note: no gateway/cdn set and cid=null — fill per-part cid + gateway at IPFS-pin time for browser delivery.");
}
