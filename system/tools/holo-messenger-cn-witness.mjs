#!/usr/bin/env node
// holo-messenger-cn-witness.mjs — P0 of the holowhat union: the κ-address bridge to holowhat's
// Content Network, proven in pure Node on the real stack.
//
//   PARITY    — our blake3 == standard blake3 (official KATs) == holowhat kappa(); κ format "blake3:<hex>"
//   DUALAXIS  — a sealed message carries BOTH our sha256 identity (verify) AND a blake3 substrate axis
//   DETERMIN  — cnKappaOf is deterministic + collision-honest (same bytes→same κ everywhere; dedup)
//   IDENTITY  — operator κ == content-address of the public key (== holowhat sign_in identity model)
//   CN-ROUND  — two content peers: publish a PQ-SEALED envelope → announce → fetch → verify-on-receipt
//               (L5) → open (PQ epoch) → original message; the wire carries only ciphertext (content-blind)
//   REFUSE    — a forged frame (bytes don't re-derive to its κ) is refused on receipt (holowhat new_forging)
//
//   node tools/holo-messenger-cn-witness.mjs
//
// Authority: holowhat Console CN (cn_put/announce/discover/fetch, verify_kappa) · holo-blake3 (KAT) ·
//   holo-object (dual-axis) · holo-identity (self-sovereign κ) · holo-messenger-epoch (PQ E2EE) · L1/L3/L5.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { blake3hex, kappaBlake3 } from "../os/usr/lib/holo/holo-blake3.mjs";
import { verify, sealDual, verifyDualAxis, blakeDid } from "../os/usr/lib/holo/holo-object.mjs";
import { addressOf } from "../os/usr/lib/holo/holo-identity.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";
import { mint } from "../os/usr/lib/holo/holo-pluck.mjs";
import { newEpoch, unwrapEpochKey, sealMessage, openMessage } from "../os/usr/lib/holo/holo-messenger-epoch.mjs";
import { kemKeygen } from "../os/usr/lib/holo/holo-pqc.mjs";
import { cnBytesOf, cnKappaOf, verifyReceipt, makeContentPeer } from "../os/usr/lib/holo/holo-messenger-cn.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const te = new TextEncoder();
const unb64 = (s) => Uint8Array.from(atob(String(s)), (c) => c.charCodeAt(0));

// ── 1 · PARITY — our blake3 matches the official BLAKE3 KATs (so it equals holowhat's kappa()) ──
const KAT_EMPTY = "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262";
const KAT_ABC = "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85";
ok("blake3-kat-parity-with-holowhat-kappa",
  blake3hex(te.encode("")) === KAT_EMPTY && blake3hex(te.encode("abc")) === KAT_ABC &&
  /^blake3:[0-9a-f]{64}$/.test(kappaBlake3(te.encode("abc"))),
  kappaBlake3(te.encode("abc")));

// ── 2 · DUALAXIS — a sealed message has our sha256 identity AND a blake3 substrate axis ──
const msg = mint({ text: "unify with holowhat", sender: "Ilya", sentAt: "08:31", chat: "Ilya", source: "web.whatsapp.com" }).object;
const dual = sealDual(msg);
ok("dual-axis-sha256-and-blake3",
  verify(msg) && /^did:holo:sha256:[0-9a-f]{64}$/.test(msg.id) &&
  verifyDualAxis(dual) && /^did:holo:blake3:[0-9a-f]{64}$/.test(blakeDid(msg)),
  blakeDid(msg).slice(0, 28) + "…");

// ── 3 · DETERMIN — cnKappaOf is deterministic + collision-honest (same bytes → same κ everywhere) ──
const other = mint({ text: "unify with holowhat!", sender: "Ilya", sentAt: "08:31", chat: "Ilya", source: "web.whatsapp.com" }).object;
ok("cn-kappa-deterministic-and-honest",
  cnKappaOf(msg) === cnKappaOf(msg) && /^blake3:[0-9a-f]{64}$/.test(cnKappaOf(msg)) &&
  cnKappaOf(msg) !== cnKappaOf(other) &&
  verifyReceipt(cnBytesOf(msg), cnKappaOf(msg)) && !verifyReceipt(cnBytesOf(other), cnKappaOf(msg)),
  cnKappaOf(msg));

// ── 4 · IDENTITY — operator κ == content-address of the public key (holowhat sign_in model) ──
const op = await enroll({ label: "cn-tester", passphrase: "correct horse battery" });
const opAddr = await addressOf(unb64(op.pub));
ok("identity-is-content-address-of-pubkey",
  op.kappa === opAddr && /^did:holo:sha256:[0-9a-f]{64}$/.test(op.kappa),
  op.kappa.slice(-12));

// ── 5 · CN-ROUND — publish a PQ-sealed envelope across two peers; verify-on-receipt; open; content-blind ──
const genesis = "blake3:" + "ab".repeat(32);              // a conversation topic
const kem = kemKeygen(); const member = { kappa: op.kappa, pub: kem.pub, sk: kem.sk };
const epoch = await newEpoch({ genesis, members: [member], seq: 0 });
const epochKey = await unwrapEpochKey(epoch.meta, member);
const PLAIN = "first message over the holowhat content network";
const envelope = await sealMessage(epoch, mint({ text: PLAIN, sender: "Ilya", sentAt: "08:40", chat: "Ilya", source: "web.whatsapp.com" }).object);

const hub = { a: null, b: null };
const wire = []; let received = null;
const peerA = makeContentPeer({ send: (f) => { wire.push(f); hub.b.onFrame(f); } });
const peerB = makeContentPeer({ send: (f) => { hub.a.onFrame(f); }, onObject: (o) => { received = o; } });
hub.a = peerA; hub.b = peerB;

const kpub = peerA.publish(envelope, genesis);            // cn_put + cn_announce → B learns → fetches → verifies → onObject
const opened = received ? await openMessage(epochKey, received) : { ok: false };
const wireText = JSON.stringify(wire);
ok("cn-roundtrip-sealed-and-opened",
  kpub === cnKappaOf(envelope) && peerB.has(kpub) &&
  !!received && opened.ok && opened.object["schema:text"] === PLAIN &&
  !wireText.includes(PLAIN) && !wireText.includes("schema:text"),    // content-blind: only ciphertext on the wire
  opened.ok ? "opened" : "not-opened");

// ── 6 · REFUSE — a forged frame (bytes don't re-derive to its κ) is refused on receipt (holowhat L5) ──
const sizeBefore = peerB.size;
const forged = { op: "OBJ", kappa: cnKappaOf(envelope), bytes: cnBytesOf({ ...envelope, ct: "TAMPERED" }) };
const r = peerB.onFrame(forged);
ok("forged-frame-refused-on-receipt",
  r.ok === false && /verify-on-receipt-refused/.test(r.why) && peerB.size === sizeBefore,
  r.why || "");

await forget(op.kappa).catch(() => {});

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "PARITY — our blake3 matches the official BLAKE3 known-answer tests (empty + 'abc'), so kappaBlake3 == holowhat kappa(); κ format is 'blake3:<64hex>'",
    "DUALAXIS — a sealed message carries both our sha256 identity (verify) and a blake3 substrate axis (verifyDualAxis / blakeDid)",
    "DETERMIN — cnKappaOf is deterministic and collision-honest (same bytes → same κ everywhere = holowhat content-dedup); verifyReceipt accepts matching, refuses mismatching",
    "IDENTITY — the operator κ equals the content address of the public key (== holowhat sign_in identity model)",
    "CN-ROUND — two content peers carry a PQ-sealed envelope: publish (cn_put+announce) → learn → fetch → verify-on-receipt (L5) → open (PQ epoch) → original message; the wire carries only ciphertext (content-blind, SEC-7)",
    "REFUSE — a forged frame whose bytes don't re-derive to its κ is refused on receipt (holowhat verify_kappa / new_forging), nothing stored",
  ],
  sample: { cnKappa: cnKappaOf(envelope), operator: op.kappa },
  checks, failed: fail,
  authority: "holowhat Console CN (cn_put/announce/discover/fetch, verify_kappa) · holo-blake3 (BLAKE3 KAT) · holo-object dual-axis · holo-identity · holo-messenger-epoch (X25519‖ML-KEM-1024) · holospaces L1/L3/L5/SEC-1/SEC-7",
};
writeFileSync(join(here, "holo-messenger-cn-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Messenger CN witness — the bridge to holowhat's content network (P0)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  cn κ ${cnKappaOf(envelope)} · operator ${op.kappa.slice(-12)} · sealed envelope rides the CN content-blind`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
