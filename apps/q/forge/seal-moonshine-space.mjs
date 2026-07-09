// Seal the Moonshine ear as a holospace (L1 closure over the runtime files → root κ) AND produce a
// pin-ready IPFS CID manifest for every κ-body in the .holo models. A CIDv1(raw, sha2-256) IS a sha256 κ
// ("adopt, not bridge") so the CIDs are derived deterministically from the κs — no network needed to
// ADDRESS them. Actually uploading/pinning to a public node needs an IPFS daemon or Pinata JWT (not in
// this env); the manifest + recipe make that a one-command step for the user.
//   node seal-moonshine-space.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { sha256hex, sriOf, mbSha256, didHolo, jcs } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";
import { makeCIDv1, cidToString, fromHex, CODEC, HASH } from "../../../../holo-os/system/os/usr/lib/holo/holo-ipfs.js";

const SEALED = [
  "moonshine-holospace.json",
  "gguf-forge-moonshine.mjs",
  "seal-moonshine-holo.mjs",
  "gpu/holo-whisper-stream.mjs",
  "gpu/holo-moonshine-asr.mjs",
  "gpu/moonshine-gpu.html",
  "gpu/whisper-asr-test.html",
].sort();

const root0 = new URL(".", import.meta.url);
const closure = {};
for (const rel of SEALED) {
  const bytes = new Uint8Array(readFileSync(new URL(rel, root0)));
  closure[rel] = { kappa: didHolo("sha256", sha256hex(bytes)), sri: sriOf(bytes), multibase: mbSha256(bytes), bytes: bytes.length };
}
const root = didHolo("sha256", sha256hex(jcs(closure)));

const toHex = (b) => { let s = ""; for (const x of b) s += x.toString(16).padStart(2, "0"); return s; };
function holoBodies(path) {
  const buf = new Uint8Array(readFileSync(path)), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sc = dv.getUint16(8, true), sections = {};
  for (let i = 0, p = 10; i < sc; i++, p += 17) sections[buf[p]] = { off: Number(dv.getBigUint64(p + 1, true)), len: Number(dv.getBigUint64(p + 9, true)) };
  const w = sections[3], cnt = dv.getUint32(w.off, true), out = [];
  for (let i = 0, p = w.off + 4; i < cnt; i++, p += 48) { const kap = toHex(buf.subarray(p, p + 32)); out.push({ kappa: kap, cid: cidToString(makeCIDv1(CODEC.RAW, HASH.SHA2_256, fromHex(kap))) }); }
  const archiveKappa = toHex(buf.subarray(buf.length - 32));
  return { bytes: buf.length, archiveKappa, archiveCid: cidToString(makeCIDv1(CODEC.RAW, HASH.SHA2_256, fromHex(archiveKappa))), nBodies: out.length, bodies: out };
}
const models = { "moonshine-tiny": holoBodies("./.models/moonshine-tiny.holo"), "moonshine-base": holoBodies("./.models/moonshine-base.holo") };

const lock = { "@context": "https://hologram.os/ns/holospace.jsonld", root, identifier: "org.hologram.MoonshineEar", algo: "sha256", files: SEALED.length, closure };
writeFileSync(new URL("./moonshine-holospace.lock.json", root0), JSON.stringify(lock, null, 2) + "\n");
const ipfs = { algo: "sha256", note: "CIDv1(raw, sha2-256) of each κ-body = the κ itself (adopt-not-bridge). Pin with: ipfs add --raw-leaves --cid-version=1, or upload bodies to Pinata. Per-block L5 still verifies on fetch.", models: Object.fromEntries(Object.entries(models).map(([k, v]) => [k, { bytes: v.bytes, archiveKappa: v.archiveKappa, archiveCid: v.archiveCid, nBodies: v.nBodies, bodies: v.bodies }])) };
writeFileSync(new URL("./moonshine-ipfs-manifest.json", root0), JSON.stringify(ipfs, null, 1) + "\n");

console.log(`HOLOSPACE SEALED → moonshine-holospace.lock.json`);
console.log(`  root κ ${root}`);
console.log(`  ${SEALED.length} runtime files sealed (L1/L2 closure)`);
console.log(`IPFS PIN MANIFEST → moonshine-ipfs-manifest.json`);
for (const [name, v] of Object.entries(models)) console.log(`  ${name}: ${v.nBodies} κ-bodies → CIDs · archive CID ${v.archiveCid} (${(v.bytes / 1e6).toFixed(0)}MB)`);
console.log(`  (pinning to a public node needs an IPFS daemon / Pinata JWT — not present in this env)`);
