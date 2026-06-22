#!/usr/bin/env node
// holo-strand-signer-witness.mjs — proves the signer-at-unlock seam (holo-session.unlockOperatorKey):
// unlocking the operator attaches their principal as the strand signer, so spine entries gain AUTHORSHIP
// (a real Ed25519/ECDSA signature over the entry κ, bound to the operator), and locking detaches it.
// Drives the REAL holo-identity unlock (enroll → unlock → setSigner) — the exact path the hook runs.
//
// Checks:
//   1 beforeUnlockUnsigned — with no signer, appends are content-linked but unsigned (signed:false).
//   2 unlockAttachesSigner  — id.unlock(operator, passphrase) → setSigner → next append is operator-signed.
//   3 signatureBindsOperator— the signed entry verifies and its op κ == the unlocked operator.
//   4 lockDetaches          — setSigner(null) → later appends are unsigned again; chain still verifies.
//
// Authority: UOR-ADDR · holospaces Laws L1/L5 · rests on #holo-identity + #holo-strand. node tools/holo-strand-signer-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand, verifyEntry } from "../os/usr/lib/holo/holo-strand.mjs";
import { enroll, unlock, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tick = 0; const now = () => `2026-06-22T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const PASS = "correct horse battery signer";
const op = await enroll({ label: "signer-tester", passphrase: PASS });

const strand = makeStrand({ now });                       // no signer yet (like a guest/locked boot)

// 1 · before unlock: unsigned but content-linked
const e0 = await strand.append({ kind: "ingest", payload: { name: "pre.txt", source: "did:holo:sha256:" + "a".repeat(64) } });
const v0 = await verifyEntry(e0);
ok("beforeUnlockUnsigned", !e0["holstr:sig"] && v0.ok && v0.signed === false, JSON.stringify(v0));

// 2 · unlock attaches the signer (the exact hook path: id.unlock → setSigner)
const principal = await unlock(op.kappa, PASS);          // holo-identity.unlock — same call unlockOperatorKey makes
strand.setSigner(principal);
const e1 = await strand.append({ kind: "audit", payload: { act: "wallet.send", level: "value", reason: "Send 0.1 ETH" } });
const v1 = await verifyEntry(e1);
ok("unlockAttachesSigner", !!e1["holstr:sig"] && v1.ok && v1.signed === true, JSON.stringify(v1));

// 3 · the signature binds the operator
ok("signatureBindsOperator", e1["holstr:op"] === op.kappa && e1["holstr:pub"] === op.pub, `op=${e1["holstr:op"] === op.kappa}`);

// 4 · lock detaches; later entries unsigned; whole chain still verifies
strand.setSigner(null);
const e2 = await strand.append({ kind: "ingest", payload: { name: "post.txt", source: "did:holo:sha256:" + "b".repeat(64) } });
const vchain = await strand.verify();
ok("lockDetaches", !e2["holstr:sig"] && vchain.ok && vchain.length === 3, JSON.stringify({ unsigned: !e2["holstr:sig"], chain: vchain.ok }));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-strand signer-at-unlock — holo-session.unlockOperatorKey attaches the unlocked operator principal as the strand signer (id.unlock → setSigner), so spine entries gain authorship (Ed25519/ECDSA over the entry κ, op κ == operator); lock detaches it. Fail-soft: without a signer, entries stay content-linked (still tamper-evident). The chain verifies whether or not individual entries are signed.",
  authority: "UOR-ADDR · holospaces Laws L1/L5 · rests on #holo-identity + #holo-strand",
  witnessed,
  covers: witnessed ? ["before-unsigned", "unlock-attaches", "binds-operator", "lock-detaches"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-strand-signer-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-strand witness — SIGNER AT UNLOCK (operator authorship on the spine)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  unlock signs the spine; lock detaches; unsigned stays content-linked" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
