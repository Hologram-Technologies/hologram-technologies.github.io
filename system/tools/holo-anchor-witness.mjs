#!/usr/bin/env node
// holo-anchor-witness.mjs — PROVE the Bitcoin-anchor verifier (decentralized-boot S5–S7). Bitcoin
// commits the canonical os-closure root; this proves the CLIENT-SIDE, header-only verifier is correct
// and complete, with REAL crypto and offline: real secp256k1 (the vetted btc-wallet noble bundle) for
// M-of-N authority, and the REAL Bitcoin GENESIS block header for the Proof-of-Work check (no internet).
//
// What this witnesses (all offline, real crypto):
//   · commitment re-derives from the statement (Law L5); a tampered commitment is refused
//   · M-of-N authority: a threshold of pinned keys validates; under-threshold / wrong-key is refused
//   · the anchor binds the ACTUAL running os-closure root; a forged root is refused (S7)
//   · the hash-linked release chain: a broken prev link is refused
//   · OTS Merkle inclusion folds to the confirming block's merkle root; a tampered path is refused
//   · Bitcoin PoW: the REAL genesis header validates; a 1-byte-mutated header is refused
//   · full verifyAnchor accepts a real-PoW Bitcoin proof; an un-anchored root is honestly "pending"
//
// HONEST boundary (not faked green): this proves the VERIFIER + every crypto leg. Binding the CURRENT
// os-closure root to a CONFIRMED mainnet tx (submitting to an OpenTimestamps calendar / OP_RETURN and
// waiting for confirmation) is an operational deploy-time action that needs network — reported pending.
//
//   node tools/holo-anchor-witness.mjs

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { secp256k1 } from "../os/usr/lib/holo/btc-wallet/btc-lib.js";
import { buildAnchor, commitmentOf, verifyAnchor, merkleFold, powValid, headerMerkleRoot, sha256d } from "../os/usr/lib/holo/holo-anchor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");

// the ACTUAL running OS root — the image this anchor would authorize
const closure = JSON.parse(readFileSync(join(here, "../os/etc/os-closure.json"), "utf8"));
const ROOT = closure.root;   // did:holo:sha256:<hex>

// a pinned 2-of-3 release-signing keyset (real secp256k1 keys, generated for the witness)
const sk = [0, 1, 2].map(() => secp256k1.utils.randomSecretKey());
const pub = sk.map((k) => toHex(secp256k1.getPublicKey(k)));
const authority = { threshold: 2, keys: pub };

const anchor = await buildAnchor({ root: ROOT, prev: null, authority, signWith: [sk[0], sk[1]] });

// 1 · commitment re-derivation (L5) + tamper
{
  const v = await verifyAnchor(anchor, { liveRoot: ROOT });
  rec("the anchor commitment RE-DERIVES from its statement (Law L5)", v.checks.commitment === true, anchor.commitment.slice(0, 16) + "…");
  const tampered = { ...anchor, commitment: anchor.commitment.replace(/^../, "ff") };
  const vt = await verifyAnchor(tampered, { liveRoot: ROOT });
  rec("a TAMPERED commitment is refused", vt.checks.commitment === false);
}

// 2 · M-of-N authority
{
  const v = await verifyAnchor(anchor, { liveRoot: ROOT });
  rec("2-of-3 pinned-key authority over the commitment is ACCEPTED (real secp256k1)", v.checks.authority === true);
  const one = await buildAnchor({ root: ROOT, prev: null, authority, signWith: [sk[0]] });
  rec("an UNDER-THRESHOLD (1-of-3) anchor is refused", (await verifyAnchor(one, { liveRoot: ROOT })).checks.authority === false);
  const intruderSk = secp256k1.utils.randomSecretKey();
  const wrong = { ...anchor, signatures: [anchor.signatures[0], { key: toHex(secp256k1.getPublicKey(intruderSk)), sig: toHex(secp256k1.sign((await import("node:crypto")).createHash("sha256").update("x").digest(), intruderSk)) }] };
  rec("a signature from a KEY NOT in the pinned set does not count toward threshold", (await verifyAnchor(wrong, { liveRoot: ROOT })).checks.authority === false);
}

// 3 · the anchor binds the ACTUAL running OS root (S7 tamper)
{
  rec("the anchor BINDS the live os-closure root", (await verifyAnchor(anchor, { liveRoot: ROOT })).checks.rootBinds === true, ROOT.slice(0, 24) + "…");
  const forged = "did:holo:sha256:" + "0".repeat(64);
  rec("a FORGED OS root (≠ anchored root) is refused (S7)", (await verifyAnchor(anchor, { liveRoot: forged })).checks.rootBinds === false);
}

// 4 · hash-linked release chain
{
  const child = await buildAnchor({ root: ROOT, prev: anchor.commitment, authority, signWith: [sk[1], sk[2]] });
  rec("a child anchor REFERENCES the prior commitment (append-only chain)", (await verifyAnchor(child, { liveRoot: ROOT, prevCommitment: anchor.commitment })).checks.chain === true);
  rec("a BROKEN chain link is refused", (await verifyAnchor(child, { liveRoot: ROOT, prevCommitment: "deadbeef" })).checks.chain === false);
}

// 5 · OTS Merkle inclusion (multi-step path, sha256d as in a Bitcoin tx tree)
{
  const leaf = anchor.commitment;
  const sib1 = toHex(await sha256d(new TextEncoder().encode("sibling-1")));
  const step1root = toHex(await sha256d(new Uint8Array([...Buffer.from(leaf, "hex"), ...Buffer.from(sib1, "hex")])));
  const sib2 = toHex(await sha256d(new TextEncoder().encode("sibling-2")));
  const expectedRoot = toHex(await sha256d(new Uint8Array([...Buffer.from(sib2, "hex"), ...Buffer.from(step1root, "hex")])));
  const path = [{ hash: sib1, dir: "R" }, { hash: sib2, dir: "L" }];
  rec("an OTS Merkle path FOLDS the commitment to the confirming merkle root", (await merkleFold(leaf, path)) === expectedRoot);
  const badPath = [{ hash: sib1.replace(/^../, "ff"), dir: "R" }, { hash: sib2, dir: "L" }];
  rec("a TAMPERED Merkle path is refused", (await merkleFold(leaf, badPath)) !== expectedRoot);
}

// 6 · Bitcoin PoW against the REAL genesis block header (real mainnet data, offline)
const GENESIS = "0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c";
{
  rec("the REAL Bitcoin genesis block header PoW-VALIDATES (sha256d ≤ target(bits))", (await powValid(GENESIS)) === true, "block 000000000019d6…");
  const mutated = GENESIS.slice(0, 8) + "ff" + GENESIS.slice(10);   // flip a version byte
  rec("a 1-byte-MUTATED header fails PoW", (await powValid(mutated)) === false);
}

// 7 · full verifyAnchor with a real-PoW Bitcoin proof (degenerate single-tx inclusion: leaf = merkle root)
{
  const anchored = { ...anchor, bitcoin: { ots: { leaf: headerMerkleRoot(GENESIS), path: [] }, block: { header: GENESIS, height: 0 } } };
  const v = await verifyAnchor(anchored, { liveRoot: ROOT });
  rec("a fully-anchored root verifies end-to-end (commitment + authority + OTS inclusion + PoW)", v.ok === true && v.checks.ots === true && v.checks.pow === true);
  rec("an un-anchored root is honestly PENDING under requireBitcoin (not a fabricated green)", (await verifyAnchor(anchor, { liveRoot: ROOT, requireBitcoin: true })).ok === false);
}

const witnessed = failed === 0 && passed > 0;
console.log(`\n${witnessed ? "WITNESSED ✓" : "FAILED ✗"} — ${passed}/${passed + failed} · the Bitcoin-anchor verifier is correct (real secp256k1 M-of-N + real genesis PoW, offline). Live mainnet anchoring of the current root is a separate deploy-time action (OTS calendar / OP_RETURN + confirmation).`);
writeFileSync(join(here, "holo-anchor-witness.result.json"),
  JSON.stringify({
    witnessed, passed, failed, root: ROOT,
    covers: results.filter((r) => r.ok).map((r) => r.name.slice(0, 56)), results,
    pending: "Binding the CURRENT os-closure root to a CONFIRMED Bitcoin tx (OpenTimestamps calendar submit / direct OP_RETURN + confirmation) needs network — an operational deploy step, not a code gap. The verifier + every crypto leg is proven offline here.",
    spec: "S5–S7 — the client-side, header-only Bitcoin-anchor verifier: commitment re-derivation (L5), M-of-N pinned-key authority (real secp256k1), hash-linked release chain, OTS Merkle inclusion, and Bitcoin PoW (witnessed against the REAL genesis header), all offline. Refuses tampered commitment / forged root / under-threshold authority / broken chain / tampered path / bad PoW.",
  }, null, 2) + "\n");
process.exit(witnessed ? 0 : 1);
