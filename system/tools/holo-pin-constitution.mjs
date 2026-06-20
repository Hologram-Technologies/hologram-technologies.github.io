#!/usr/bin/env node
// holo-pin-constitution.mjs — make the Hologram boot location-agnostic. Regenerate the EXACT canonical
// bytes whose sha-256 is the pinned Constitution root κ (Law L5), prove they re-derive to the pin, emit
// the CIDv1 those bytes carry on IPFS (a sha-256 κ IS a CIDv1(raw)), write the raw block to disk, and
// print the ready-to-run publish command for each pinning route + a post-pin gateway verify.
//
// Nothing here trusts a host: the bytes are content. Pin them ANYWHERE — Storacha/w3, Pinata, a Kubo
// daemon, a friend's node — and the same CID resolves + re-derives from any IPFS trustless gateway.
//
//   node tools/holo-pin-constitution.mjs            # reproduce + verify + write block + print how-to
//   node tools/holo-pin-constitution.mjs --verify <CID?>   # after pinning: fetch from gateways, sha256==pin
//
// The artifact is os/etc/constitution/constitution.uor.json @graph[0] (minus @id), canonicalized by the
// OS's own JCS (holo-conscience.js) — identical bytes the gate re-derives at boot. Deterministic.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS2 = join(here, "../os");
const PIN = "3ff288d0c06a0fd22da898301cb6c8c11fc62e3b2b7ab58a53c7cb0cb385f00c";   // holo-conscience PINNED.root
const OUT = join(here, "constitution.kappa.block");

// the OS's canonical form — byte-identical to holo-conscience.js `jcs` (sorted keys, compact).
const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
  : JSON.stringify(v);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

const { kappaToCid } = await import(pathToFileURL(join(OS2, "usr/lib/holo/holo-cid.mjs")));

// ── CARv1 with a single RAW block, so the root CID == the raw-block CID == the pinned κ ──────────────
// (A pinning service that wraps the file in UnixFS would mint a different root; a CAR preserves it.)
const varint = (n) => { const o = []; while (n >= 0x80) { o.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } o.push(n); return Buffer.from(o); };
function rawCarV1(digestHex, data) {
  const digest = Buffer.from(digestHex, "hex");                                  // 32-byte sha2-256
  const cidBytes = Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]); // CIDv1 · raw(0x55) · sha2-256(0x12,0x20)
  // dag-cbor header: { "roots":[<cid>], "version":1 }
  const header = Buffer.concat([
    Buffer.from([0xA2, 0x65]), Buffer.from("roots"),                             // map(2) · text(5) "roots"
    Buffer.from([0x81, 0xD8, 0x2A, 0x58, 0x25, 0x00]), cidBytes,                 // [ tag42 bytes(37)= 0x00||cid ]
    Buffer.from([0x67]), Buffer.from("version"), Buffer.from([0x01]),            // text(7) "version" · 1
  ]);
  const block = Buffer.concat([cidBytes, data]);                                 // CARv1 block = CID || data
  return Buffer.concat([varint(header.length), header, varint(block.length), block]);
}

function canonicalBytes() {
  const doc = JSON.parse(readFileSync(join(OS2, "etc/constitution/constitution.uor.json"), "utf8"));
  const root = { ...doc["@graph"][0] }; delete root["@id"]; delete root.id;   // the sealed root, address is over content-minus-id
  return Buffer.from(jcs(root), "utf8");
}

const GATEWAYS = ["https://trustless-gateway.link", "https://ipfs.io", "https://dweb.link", "https://w3s.link"];

async function verifyFromGateways(cid) {
  console.log(`\nverifying ${cid} resolves + re-derives from public trustless gateways…`);
  let any = false;
  for (const g of GATEWAYS) {
    try {
      const r = await fetch(`${g}/ipfs/${cid}?format=raw`, { headers: { accept: "application/vnd.ipld.raw" }, signal: AbortSignal.timeout(9000) });
      if (!r.ok) { console.log(`  ${g} → HTTP ${r.status}`); continue; }
      const b = Buffer.from(await r.arrayBuffer());
      const ok = sha(b) === PIN;
      console.log(`  ${g} → ${b.length}B · sha256 ${ok ? "✓ == PIN (verified)" : "✗ ≠ pin (REFUSE)"}`);
      any = any || ok;
    } catch (e) { console.log(`  ${g} → ${e.name || e.message}`); }
  }
  console.log(any ? "\nLIVE ✓ — the boot CID is decentrally resolvable + self-verifying." : "\nnot yet resolvable — pin the block (below), then re-run --verify.");
  return any;
}

const bytes = canonicalBytes();
const got = sha(bytes);
const cid = kappaToCid("did:holo:sha256:" + got);

if (process.argv.includes("--verify")) {
  const arg = process.argv[process.argv.indexOf("--verify") + 1];
  await verifyFromGateways(arg && arg.startsWith("baf") ? arg : cid);
  process.exit(0);
}

if (process.argv.includes("--car")) {
  if (got !== PIN) { console.error("drift — bytes do not match the pin; refusing to build CAR"); process.exit(1); }
  const carPath = join(here, "constitution.kappa.car");
  writeFileSync(carPath, rawCarV1(got, bytes));
  console.log(cid + "  " + carPath);   // machine-readable: "<root-cid> <car-path>"
  process.exit(0);
}

console.log("Hologram — pin the Constitution for location-agnostic boot\n");
console.log(`  bytes      : ${bytes.length} B (JCS-canonical constitution root, minus @id)`);
console.log(`  sha256     : ${got}`);
console.log(`  pinned κ   : ${PIN}`);
console.log(`  re-derive  : ${got === PIN ? "✓ PASS — bytes ARE the pinned root" : "✗ FAIL — drift! do not pin"}`);
if (got !== PIN) process.exit(1);
console.log(`  CIDv1(raw) : ${cid}`);
writeFileSync(OUT, bytes);
console.log(`  wrote      : ${OUT}\n`);

console.log("pin it via any route (the bytes are content — host them anywhere):\n");
console.log("  Storacha/w3 :  npm i -g @web3-storage/w3cli && w3 login <email> && w3 up --no-wrap " + OUT);
console.log("  Pinata      :  curl -H \"Authorization: Bearer $PINATA_JWT\" -F file=@" + OUT + " https://api.pinata.cloud/pinning/pinFileToIPFS");
console.log("  Kubo (self) :  ipfs add --raw-leaves --cid-version 1 " + OUT + "   # then: ipfs pin add <cid>");
console.log(`\nthen confirm:  node tools/holo-pin-constitution.mjs --verify ${cid}`);
console.log("\nIMPORTANT: a pinning tool may wrap the file in a UnixFS dir and report a DIFFERENT root CID.");
console.log(`Only the RAW-block CID ${cid} re-derives to the pin. Use --raw-leaves / raw codec, or pin the`);
console.log("block directly, so the boot CID == the pinned κ. The --verify step proves it before you ship.");
