// shard-brain.mjs — shard a large .holo into small byte-contiguous parts so each part WHOLE-LOADS safely through the
// holo:// passthrough (the local scheme handler doesn't Range-serve fetch; ≤~96MB loads, 468MB+ crashes the network
// service). The spanning reader (holo-pack-shards.mjs spanReader) stitches the parts back into the identical file above
// the rangeReader — ONE logical .holo, sharding invisible. Same manifest shape as shard-holo.mjs (holo-pack-shards/2).
//   node holo-apps/apps/q/forge/tools/shard-brain.mjs <in.holo> <outDir> [shardMB]
import { openSync, readSync, writeSync, closeSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const IN = process.argv[2], OUTDIR = process.argv[3], SHARD = (parseInt(process.argv[4] || "24", 10)) * 1024 * 1024;
if (!IN || !OUTDIR) { console.error("usage: shard-brain.mjs <in.holo> <outDir> [shardMB]"); process.exit(1); }
const CHUNK = 4 * 1024 * 1024;
const base = IN.split(/[\\/]/).pop();
if (!existsSync(OUTDIR)) mkdirSync(OUTDIR, { recursive: true });

const size = statSync(IN).size;
const wholeKappa = createHash("sha256").update(readFileSync(IN)).digest("hex");   // archive κ of the full file
const fd = openSync(IN, "r");
const parts = [];
let start = 0, idx = 0;
console.log(`sharding ${base} · ${(size / 1e6).toFixed(0)}MB into ${(SHARD / 1e6).toFixed(0)}MB parts → ${OUTDIR}`);
while (start < size) {
  const len = Math.min(SHARD, size - start);
  const name = `${base}.part${String(idx).padStart(3, "0")}`;
  const ofd = openSync(OUTDIR + "/" + name, "w"), hash = createHash("sha256");
  let rem = len, o = start;
  while (rem > 0) { const n = Math.min(CHUNK, rem); const b = Buffer.allocUnsafe(n); readSync(fd, b, 0, n, o); writeSync(ofd, b, 0, n); hash.update(b); rem -= n; o += n; }
  closeSync(ofd);
  parts.push({ name, start, len, sha256: hash.digest("hex") });
  if (idx % 5 === 0) console.log(`  ${name}  @${(start / 1e6).toFixed(0)}MB  ${(len / 1e6).toFixed(0)}MB`);
  start += len; idx++;
}
closeSync(fd);
const manifest = { format: "holo-pack-shards/2", file: base, total: size, shard: SHARD, packKappa: wholeKappa, parts };
writeFileSync(OUTDIR + "/" + base + ".parts.json", JSON.stringify(manifest) + "\n");
console.log(`\nSHARDED ${base} into ${parts.length} parts ≤${SHARD / 1048576}MB · manifest ${base}.parts.json · κ ${wholeKappa.slice(0, 12)}…`);
