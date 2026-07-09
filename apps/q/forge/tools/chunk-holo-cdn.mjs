// chunk-holo-cdn.mjs — split the single q-models.holo into <50 MB chunks for GitHub-repo distribution served by
// jsDelivr (CORS:* + Range/206 + global immutable CDN cache → serverless, any-device, fast first load). The chunks are
// byte-contiguous slices the spanning reader stitches back into the one pack. The manifest (tiny) ships SAME-ORIGIN in
// dist and carries the CDN base; the loader Range-fetches each chunk by path. Pinning = `git push` a public repo.
//   node holo-apps/apps/q/forge/tools/chunk-holo-cdn.mjs  [owner] [repo] [ref] [dir]
import { openSync, readSync, writeSync, closeSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const M = "holo-apps/apps/q/forge/.models", FILE = M + "/q-models.holo";
const OUT = M + "/q-pack-cdn";                       // the chunk dir = what you commit to the repo
const CHUNK = 48 * 1024 * 1024;  // matches deployed repo commit 1640fd4a (raw.githubusercontent serves 48MB; jsDelivr caps at 20MB)
const CHUNKIO = 16 * 1024 * 1024;
const [owner = "OWNER", repo = "REPO", ref = "main", dir = "q-pack"] = process.argv.slice(2);

const size = statSync(FILE).size;
const packKappa = readFileSync(FILE + ".kappa", "utf8").trim();
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const fd = openSync(FILE, "r");
const parts = [];
let start = 0, idx = 0;
console.log(`chunking ${FILE} · ${(size / 1e6).toFixed(0)}MB into ${(CHUNK / 1e6).toFixed(0)}MB chunks → ${OUT}`);
while (start < size) {
  const len = Math.min(CHUNK, size - start);
  const name = `c${String(idx).padStart(3, "0")}`;
  const ofd = openSync(OUT + "/" + name, "w"), hash = createHash("sha256");
  let rem = len, o = start;
  while (rem > 0) { const n = Math.min(CHUNKIO, rem); const b = Buffer.allocUnsafe(n); readSync(fd, b, 0, n, o); writeSync(ofd, b, 0, n); hash.update(b); rem -= n; o += n; }
  closeSync(ofd);
  parts.push({ name, start, len, sha256: hash.digest("hex") });
  start += len; idx++;
  if (idx % 20 === 0) console.log(`  ${idx} chunks…`);
}
closeSync(fd);

const manifest = {
  format: "holo-pack-shards/3", file: "q-models.holo", total: size, chunkSize: CHUNK, packKappa,
  // delivery: jsDelivr CDN over a GitHub repo (CORS + Range + immutable cache). rawBase = same-repo fallback. Both
  // CORS-enabled; override via window.HOLO_PACK_CDN. Fill owner/repo/ref/dir at distribution time.
  cdnBase: `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${dir}/`,
  rawBase: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${dir}/`,
  parts,
};
writeFileSync(FILE + ".parts.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`\nCHUNKED into ${parts.length} files · manifest q-models.holo.parts.json · packKappa ${packKappa.slice(0, 12)}…`);
console.log(`  cdnBase ${manifest.cdnBase}`);
console.log(`  commit ${OUT}/* to ${owner}/${repo}@${ref}:${dir}/ → jsDelivr serves them worldwide (CORS + Range).`);
