// shard-holo.mjs — split the single q-models.holo into <2 GiB parts for GitHub release delivery (per-asset cap is
// 2 GiB). This is PURE TRANSPORT: the parts are byte-contiguous slices of the one file, so a spanning reader
// (holo-pack-shards.mjs) stitches them back into the identical pack — ONE packKappa, sharding invisible above the
// rangeReader. Writes q-models.holo.partNN + a parts manifest (q-models.holo.parts.json) with per-part sha256.
//   node holo-apps/apps/q/forge/tools/shard-holo.mjs
import { openSync, readSync, writeSync, closeSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const M = "holo-apps/apps/q/forge/.models", FILE = M + "/q-models.holo";
// deterministic IPFS CIDv1 (raw-leaves) of a file — the content address the CORS gateway serves. --only-hash = no
// datastore write. Empty string if ipfs CLI is unavailable (manifest still valid; CIDs can be filled at pin time).
const cidOf = (path) => { try { return execSync(`ipfs add --only-hash -Q --cid-version=1 --raw-leaves "${path}"`, { encoding: "utf8" }).trim(); } catch { return ""; } };
const SHARD = 1_900_000_000;                 // 1.9 GB < 2 GiB (2,147,483,648) GitHub asset cap
const CHUNK = 16 * 1024 * 1024;

const size = statSync(FILE).size;
const packKappa = readFileSync(FILE + ".kappa", "utf8").trim();
const fd = openSync(FILE, "r");
const parts = [];
let start = 0, idx = 0;
console.log(`sharding ${FILE} · ${(size / 1e6).toFixed(0)}MB into ${(SHARD / 1e6).toFixed(0)}MB parts`);
while (start < size) {
  const len = Math.min(SHARD, size - start);
  const name = `q-models.holo.part${String(idx).padStart(2, "0")}`;
  const ofd = openSync(M + "/" + name, "w"), hash = createHash("sha256");
  let rem = len, o = start;
  while (rem > 0) { const n = Math.min(CHUNK, rem); const b = Buffer.allocUnsafe(n); readSync(fd, b, 0, n, o); writeSync(ofd, b, 0, n); hash.update(b); rem -= n; o += n; }
  closeSync(ofd);
  const sha = hash.digest("hex");
  const cid = cidOf(M + "/" + name);   // IPFS content address for the CORS-gateway delivery (serverless, any-device)
  parts.push({ name, start, len, sha256: sha, cid });
  console.log(`  ${name}  @${(start / 1e6).toFixed(0)}MB  ${(len / 1e6).toFixed(0)}MB  sha ${sha.slice(0, 10)}…  cid ${cid ? cid.slice(0, 14) + "…" : "(no ipfs)"}`);
  start += len; idx++;
}
closeSync(fd);

// gateway = a CDN-backed, CORS+Range IPFS gateway (serverless content delivery). Path form {gateway}/ipfs/{cid}; the
// loader Range-fetches each shard by CID. Default is overridable (window.HOLO_PACK_GATEWAY); pin the shards to any
// IPFS pinning service to make these CIDs reachable worldwide. The manifest itself ships same-origin (tiny, no CORS).
const manifest = { format: "holo-pack-shards/2", file: "q-models.holo", total: size, shard: SHARD, packKappa, gateway: "https://w3s.link", parts };
writeFileSync(FILE + ".parts.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`\nSHARDED into ${parts.length} parts · manifest q-models.holo.parts.json · packKappa ${packKappa.slice(0, 12)}…`);
console.log(`  every part < 2 GiB; spanning reader reconstitutes the identical single file.`);
