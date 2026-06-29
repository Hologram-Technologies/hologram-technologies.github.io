#!/usr/bin/env node
// holo-ens-witness.mjs — proves WEB3 NAMES INTO THE κ SUBSTRATE (holo-ens, P6). ENS maps a name to content
// via an on-chain registry; we don't reimplement the chain — we VERIFY the linkage with REAL crypto and re-
// anchor it, so only the on-chain read is trusted and everything downstream is verify-before-trust:
// namehash(name) re-derives the on-chain node (real keccak); the EIP-1577 contenthash decodes to an IPFS CID;
// the CID IS a κ (sha2-256 ≡ CIDv1); the CONTENT re-derives to that κ (Law L5). mirrorEns() binds the name
// into a zone so it resolves through the SAME one door + holo-root, offline thereafter. The existing live
// web3 lane is untouched (the mirror is the offline, verify-before-trust complement).
//
// Drives the REAL substrate: holo-eth namehash (keccak), holo-ipfs decodeContenthash (EIP-1577), holo-cid
// (CID↔κ), holo-object seal, holo-uor sha256, a real holo-strand zone owner. The on-chain proof + content
// are byte-pinned fixtures (no network). node tools/holo-ens-witness.mjs
//
// Checks: 1 namehashVerified · 2 bridgeEndToEnd · 3 namehashMismatchRefused · 4 contentMismatchRefused ·
//         5 noContenthashRefused · 6 mirrorBindsZone · 7 throughRootOffline · 8 secondNameNoCrossTalk ·
//         9 liveWeb3LaneIntact · 10 provenanceSealed
// Authority: ENS namehash · EIP-1577 · multiformats CIDv1 · UOR-ADDR · holospaces Laws L1/L2/L3/L5

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bridgeEns, mirrorEns } from "../os/sbin/holo-ens.mjs";
import { makeZone } from "../os/usr/lib/holo/holo-zone.mjs";
import { makeRoot } from "../os/sbin/holo-root.mjs";
import { classifyUnified } from "../os/sbin/holo-omni-unified.mjs";
import { namehash } from "../os/usr/lib/holo/holo-eth.js";
import { kappaToCid } from "../os/usr/lib/holo/holo-cid.mjs";
import { verify as verifyObj } from "../os/usr/lib/holo/holo-object.mjs";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tick = 0; const now = () => `2026-06-23T00:03:${String(tick++).padStart(2, "0")}.000Z`;
const arrayBackend = () => { let s = []; return { load: async () => JSON.parse(JSON.stringify(s)), save: async (r) => { s = JSON.parse(JSON.stringify(r)); } }; };
const hexOf = (k) => k.split(":").pop();

// content I control, so its CID/contenthash are self-consistent and the content leg is provable (L5)
const content = "<!doctype html><title>vitalik.eth — hello from κ</title>";
const khex = sha256hex(content);
const kappa = "did:holo:sha256:" + khex;
const cid = kappaToCid(kappa);                                   // bafkrei… (raw sha2-256 CIDv1)
const contenthash = "0xe3010155" + "1220" + khex;               // EIP-1577 ipfs contenthash for that CID
const VNODE = namehash("vitalik.eth");                          // the REAL on-chain node
const proof = { node: VNODE, contenthash, chainId: 1, block: 19000000, resolver: "0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41" };

// ── 1 · the namehash is the canonical ENS value (real keccak) ────────────────────────────────────────
ok("namehashVerified", VNODE.toLowerCase() === "0xee6c4522aab0003e8d14cd40a6af439055fd2577951148c14b6cea9a53475835", VNODE);

// ── 2 · the full bridge: name → node → contenthash → CID → κ → content re-derives ────────────────────
const b = bridgeEns("vitalik.eth", proof, { content });
ok("bridgeEndToEnd", b.ok && b.kappa === kappa && b.cid === cid && b.target === "ipfs://" + cid && b.contentVerified === true, JSON.stringify({ ok: b.ok, kappa: b.kappa === kappa, content: b.contentVerified }));

// ── 3 · a wrong on-chain node is refused (can't claim a name maps to a node it doesn't) ──────────────
const bWrong = bridgeEns("vitalik.eth", { ...proof, node: namehash("eth") }, { content });
ok("namehashMismatchRefused", bWrong.ok === false && bWrong.why === "namehash-mismatch", JSON.stringify(bWrong));

// ── 4 · a gateway that serves the wrong bytes is refused (content must re-derive to the κ) ────────────
const bTamper = bridgeEns("vitalik.eth", proof, { content: content + "<!-- evil -->" });
ok("contentMismatchRefused", bTamper.ok === false && bTamper.why === "content-mismatch", JSON.stringify(bTamper));

// ── 5 · no contenthash → nothing to bridge ───────────────────────────────────────────────────────────
const bNo = bridgeEns("vitalik.eth", { node: VNODE }, {});
ok("noContenthashRefused", bNo.ok === false && bNo.why === "no-contenthash", JSON.stringify(bNo));

// ── 6 · mirror the verified name into a zone ─────────────────────────────────────────────────────────
const owner = await enroll({ label: "ens-mirror", passphrase: "ens keeper 1 2 3" });
const zone = makeZone({ owner, backend: arrayBackend(), now });
const m = await mirrorEns(zone, "vitalik.eth", proof, { content });
const zr = await zone.resolve("vitalik.eth");
ok("mirrorBindsZone", m.ok && m.bound && zr.ok && zr.target === kappa, JSON.stringify({ bound: m.bound, resolves: zr.target === kappa }));

// ── 7 · resolve the web3 name through holo-root, OFFLINE, verify-before-trust ────────────────────────
const openZone = async (hex) => (hex === hexOf(owner.kappa) ? zone : null);
const root = makeRoot({ anchors: [zone], openZone });
const rr = await root.resolveName("vitalik.eth");
ok("throughRootOffline", rr.ok && rr.kappa === kappa && rr.via === owner.kappa, JSON.stringify({ ok: rr.ok, kappa: rr.kappa === kappa }));

// ── 8 · a second ENS name on the same mirror — no cross-talk ─────────────────────────────────────────
const content2 = "<!doctype html><title>app.eth</title>";
const khex2 = sha256hex(content2), kappa2 = "did:holo:sha256:" + khex2;
const proof2 = { node: namehash("app.eth"), contenthash: "0xe3010155" + "1220" + khex2 };
await mirrorEns(zone, "app.eth", proof2, { content: content2 });
const ra = await zone.resolve("app.eth"), rv = await zone.resolve("vitalik.eth");
ok("secondNameNoCrossTalk", ra.ok && ra.target === kappa2 && rv.ok && rv.target === kappa, JSON.stringify({ app: ra.target === kappa2, vitalik: rv.target === kappa }));

// ── 9 · the LIVE web3 lane is untouched (mirror complements, never replaces) ─────────────────────────
const cls = classifyUnified("vitalik.eth");
ok("liveWeb3LaneIntact", cls.lane === "web3" && cls.kind === "ens-name", JSON.stringify(cls));

// ── 10 · the mirror record carries on-chain provenance and re-derives ────────────────────────────────
ok("provenanceSealed", verifyObj(b.record) && b.record["prov:wasDerivedFrom"].chainId === 1 && b.record["prov:wasDerivedFrom"].resolver === proof.resolver, JSON.stringify({ rederives: verifyObj(b.record) }));

await forget(owner.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-ens — WEB3 NAMES INTO THE κ SUBSTRATE: ENS/IPNS verified (real keccak namehash) and re-anchored. namehash re-derives the on-chain node; EIP-1577 contenthash decodes to an IPFS CID; the CID is a κ (sha2-256 ≡ CIDv1); the content re-derives to that κ (Law L5). Only the on-chain read is trusted; everything downstream is verify-before-trust, and a gateway that serves wrong bytes is refused. mirrorEns binds the name into a zone so it resolves through the one door + holo-root, offline thereafter. The existing live web3 lane is untouched.",
  authority: "ENS namehash · EIP-1577 contenthash · multiformats CIDv1 · UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L1/L2/L3/L5 · rests on #holo-eth + #holo-ipfs + #holo-cid + #holo-zone",
  witnessed,
  covers: witnessed ? ["namehash-real-keccak", "bridge-end-to-end", "namehash-mismatch-refused", "content-mismatch-refused", "no-contenthash-refused", "mirror-binds-zone", "through-root-offline", "multi-name", "live-lane-intact", "provenance-sealed"] : [],
  sample: { name: "vitalik.eth", node: VNODE, cid, kappa },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ens-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ens witness — web3 names into the κ substrate (real namehash · CID≡κ · content re-derives)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  vitalik.eth  node ${VNODE.slice(0, 14)}…  → ipfs://${cid.slice(0, 14)}…  → ${kappa.slice(0, 22)}…`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  a web3 name verified by re-derivation and resolvable through the one door, offline" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
