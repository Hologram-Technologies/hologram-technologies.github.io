#!/usr/bin/env node
// holo-messenger-epoch-witness.mjs — POST-QUANTUM CONFIDENTIALITY (§2.8), proven in pure Node.
//
// Drives the REAL holo-pqc hybrid KEM (X25519 ‖ ML-KEM-1024) + AES-256-GCM and the REAL holo-pluck
// content κ. Proves a conversation's epoch seals every message body under a key wrapped to each
// member's hybrid public key, that a content-blind relay learns nothing, that recovery re-verifies
// the plaintext κ (so encryption never changes content identity / dedup), and that rotation gives
// forward secrecy.
//
//   WRAP     — an epoch key is wrapped to each member via X25519‖ML-KEM-1024; a member unwraps it,
//              a non-member cannot (fail-closed)
//   HYBRID   — every wrap carries BOTH a classical (x25519) and a post-quantum (ML-KEM-1024) ct
//   SEAL     — the message body is AEAD-sealed; the envelope is its own κ and leaks no plaintext
//   OPEN     — a member opens the body and the recovered content κ re-verifies AND equals the
//              plaintext mint κ (encryption preserved content identity / dedup, SEC-3)
//   REFUSE   — a tampered envelope, a flipped ciphertext byte, and a wrong key are each refused
//   FORWARD  — rotating the epoch (membership change) locks a removed member out of new messages
//              while old messages stay readable with the retained old key
//
//   node tools/holo-messenger-epoch-witness.mjs
//
// Authority: holo-apps §2.8 · holo-pqc (hybrid KEM + AEAD) · holospaces SEC-5/SEC-7 · Law L1/L5.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { newEpoch, rotateEpoch, unwrapEpochKey, sealMessage, openMessage } from "../os/usr/lib/holo/holo-messenger-epoch.mjs";
import { kemKeygen } from "../os/usr/lib/holo/holo-pqc.mjs";
import { conversationGenesis } from "../os/usr/lib/holo/holo-messenger-thread.mjs";
import { mint } from "../os/usr/lib/holo/holo-pluck.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// three member devices, each with a hybrid KEM keypair (the conversation's participants)
const mk = (label) => { const kp = kemKeygen(); return { kappa: "did:holo:member:" + label, pub: kp.pub, sk: kp.sk }; };
const alice = mk("alice"), bob = mk("bob"), carol = mk("carol");
const genesis = conversationGenesis({ platform: "whatsapp", chat: "Ilya" });

// ── 1 · WRAP — an epoch key wraps to each member; a member unwraps, a non-member cannot ──
const epoch = await newEpoch({ genesis, members: [alice, bob], seq: 0 });
const kA = await unwrapEpochKey(epoch.meta, alice);
const kB = await unwrapEpochKey(epoch.meta, bob);
let nonMemberRefused = false; try { await unwrapEpochKey(epoch.meta, carol); } catch { nonMemberRefused = true; }
ok("epoch-key-wrapped-to-members",
  /^did:holo:sha256:[0-9a-f]{64}$/.test(epoch.id) &&
  kA.length === 32 && Buffer.from(kA).equals(Buffer.from(epoch.key)) && Buffer.from(kB).equals(Buffer.from(epoch.key)) &&
  nonMemberRefused,
  epoch.id.slice(-8));

// ── 2 · HYBRID — every wrap carries BOTH a classical and a post-quantum ciphertext ──
const w = epoch.meta.wraps[0];
ok("wrap-is-pq-hybrid",
  !!w.kem.x && !!w.kem.pq && w.kem.x.length > 20 && w.kem.pq.length > 1000 &&   // ML-KEM-1024 ct is ~1.5KB b64
  /hybrid-kem-x25519-mlkem1024/.test(epoch.meta.scheme),
  `x=${w.kem.x.length}b64 pq=${w.kem.pq.length}b64`);

// ── 3 · SEAL — the body is AEAD-sealed; the envelope is its own κ and leaks no plaintext ──
const PLAINTEXT = "The future is light photonics. HOLOGRAM.";
const msg = mint({ text: PLAINTEXT, sender: "Ilya", sentAt: "08:31", chat: "Ilya", source: "web.whatsapp.com" }).object;
const envelope = await sealMessage(epoch, msg);
const wireBytes = JSON.stringify(envelope);
ok("body-aead-sealed-content-blind",
  /^did:holo:sha256:/.test(envelope.id) && envelope["holo:epoch"] === epoch.id &&
  !!envelope.ct && !!envelope.ct.iv && !!envelope.ct.ct &&
  !wireBytes.includes(PLAINTEXT) && !wireBytes.includes("schema:text"),     // a relay/storage sees no plaintext
  `envelope ${envelope.id.slice(-8)} · ${wireBytes.length}B opaque`);

// ── 4 · OPEN — a member opens the body; the recovered content κ re-verifies AND equals the mint κ ──
const opened = await openMessage(kB, envelope);
ok("open-recovers-and-verifies-content-kappa",
  opened.ok && opened.kappa === msg.id && opened.object["schema:text"] === PLAINTEXT,
  opened.ok ? opened.kappa.slice(-8) : opened.why);

// encryption did not change content identity — the same message still dedups (SEC-3)
ok("encryption-preserves-dedup",
  opened.ok && opened.kappa === mint({ text: PLAINTEXT, sender: "Ilya", sentAt: "08:31", chat: "Ilya", source: "web.whatsapp.com" }).object.id);

// ── 5 · REFUSE — tampered envelope, flipped ciphertext byte, and wrong key are each refused ──
const tamperedEnv = JSON.parse(JSON.stringify(envelope)); tamperedEnv["holo:epoch"] = "did:holo:sha256:" + "0".repeat(64);
const r1 = await openMessage(kB, tamperedEnv);                                   // envelope no longer re-derives (L5)
const flipped = JSON.parse(JSON.stringify(envelope));
flipped.ct.ct = flipped.ct.ct.slice(0, -2) + (flipped.ct.ct.slice(-2) === "AA" ? "BB" : "AA"); // mutate ciphertext
const r2 = await openMessage(kB, flipped);
const wrongKey = (await newEpoch({ genesis, members: [bob], seq: 9 })).key;
const r3 = await openMessage(wrongKey, envelope);                                // right bytes, wrong key
ok("tamper-and-wrong-key-refused",
  r1.ok === false && r2.ok === false && r3.ok === false,
  `${r1.why} | ${r2.why} | ${r3.why}`);

// ── 6 · FORWARD — rotate on membership change: removed member locked out of new epoch; old still opens ──
const epoch2 = await rotateEpoch(epoch, [alice, carol]);                         // bob removed, carol added
let bobLockedOut = false; try { await unwrapEpochKey(epoch2.meta, bob); } catch { bobLockedOut = true; }
const kA2 = await unwrapEpochKey(epoch2.meta, alice);
const msg2 = mint({ text: "after rotation — bob can't read this", sender: "Ilya", sentAt: "09:00", chat: "Ilya", source: "web.whatsapp.com" }).object;
const env2 = await sealMessage(epoch2, msg2);
const aliceReadsNew = await openMessage(kA2, env2);
const bobReadsOld = await openMessage(kB, envelope);                             // bob retained the OLD epoch key
ok("rotation-gives-forward-secrecy",
  epoch2.seq === 1 && epoch2.id !== epoch.id && bobLockedOut &&
  aliceReadsNew.ok && aliceReadsNew.kappa === msg2.id &&
  bobReadsOld.ok && bobReadsOld.kappa === msg.id,
  `bobLockedOut=${bobLockedOut} aliceNew=${aliceReadsNew.ok} bobOld=${bobReadsOld.ok}`);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "WRAP — a per-conversation epoch key is wrapped to each member via the hybrid KEM; a member unwraps it with its hybrid secret, a non-member is refused (fail-closed)",
    "HYBRID — every wrap carries BOTH an X25519 and an ML-KEM-1024 ciphertext (a break in either family is not a break — harvest-now-decrypt-later resistant)",
    "SEAL — the message body is AES-256-GCM-sealed under the epoch key (AAD = epoch κ); the envelope is its own content κ and leaks no plaintext to a relay or at-rest storage (SEC-5/SEC-7)",
    "OPEN — a member opens the body and the recovered content κ re-verifies (Law L5) AND equals the plaintext mint κ — encryption never changed content identity, so dedup is preserved (SEC-3)",
    "REFUSE — a tampered envelope (fails L5), a flipped ciphertext byte (AEAD), and a wrong epoch key are each refused fail-closed",
    "FORWARD — rotating the epoch on membership change locks a removed member out of new-epoch messages while members keep old keys to read history (§2.8 forward secrecy)",
  ],
  genesis, epoch: { id: epoch.id, seq: epoch.seq }, envelope: envelope.id,
  checks, failed: fail,
  authority: "holo-apps §2.8 · holo-pqc (X25519‖ML-KEM-1024 hybrid KEM + AES-256-GCM) · holospaces SEC-5/SEC-7 · Law L1/L5",
};
writeFileSync(join(here, "holo-messenger-epoch-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Messenger epoch witness — post-quantum conversation confidentiality (§2.8)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  epoch ${epoch.id.slice(-12)} (seq 0) → rotated ${(await rotateEpoch(epoch, [alice])).id.slice(-12)} · hybrid X25519‖ML-KEM-1024 · AES-256-GCM body`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
