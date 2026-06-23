#!/usr/bin/env node
// holo-holowhat-cn-p3-witness.mjs — P3: cross-device conversation ROAM over the REAL holowhat CN.
// Two genuine Console peers replicate a signed conversation chain (holo-strand) as an epoch-SEALED
// bundle over the content network; each side fetches (verify-on-receipt), opens (PQ epoch), and adopts
// (verify-before-trust over the sequence). The conversation converges both directions — serverless,
// content-blind, fail-closed — on the actual holowhat networking.
//
//   A→B      — A ingests, publishes the sealed chain; B fetches + opens + adopts → converges to A's head
//   B→A      — B appends, republishes; A fast-forwards to B's head → both converge (count + head equal)
//   BLIND    — the chain crosses the CN as ciphertext (no message plaintext on the wire, SEC-7)
//   L5       — adopt re-verifies every entry's signature + linkage before replacing the local chain
//
//   node tools/holo-holowhat-cn-p3-witness.mjs
//
// Authority: holowhat Console CN (real WASM) · holo-messenger-thread (adopt) · holo-messenger-epoch
//   (PQ E2EE) · holo-strand (signed chain) · holospaces CC-38/CC-49 · Law L1/L5 · SEC-7.

import { writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { conversationGenesis, makeThread } from "../os/usr/lib/holo/holo-messenger-thread.mjs";
import { newEpoch, unwrapEpochKey } from "../os/usr/lib/holo/holo-messenger-epoch.mjs";
import { kemKeygen, aeadSeal, aeadOpen } from "../os/usr/lib/holo/holo-pqc.mjs";
import { cnBytesOf } from "../os/usr/lib/holo/holo-messenger-cn.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PKG = join(here, "..", "..", "..", "_vendor/holowhat/crates/holospaces-web/web/pkg");
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tick = 0; const now = () => `2026-06-23T16:00:${String(tick++).padStart(2, "0")}.000Z`;
const arrayBackend = () => { let s = []; return { load: async () => JSON.parse(JSON.stringify(s)), save: async (r) => { s = JSON.parse(JSON.stringify(r)); } }; };

const mjs = join(PKG, "holospaces_web.mjs");
if (!existsSync(mjs)) copyFileSync(join(PKG, "holospaces_web.js"), mjs);
const hw = await import(pathToFileURL(mjs).href);
hw.initSync({ module: await WebAssembly.compile(readFileSync(join(PKG, "holospaces_web_bg.wasm"))) });

const A = new hw.Console(), B = new hw.Console();
const pump = (from, to) => { let f; while ((f = from.cn_outbound()) !== undefined) to.cn_inbound(f); };
const pumpBoth = () => { for (let i = 0; i < 8; i++) { pump(A, B); pump(B, A); } };

const op = await enroll({ label: "p3-tester", passphrase: "correct horse battery" });
const META = { platform: "whatsapp", chat: "Ilya" };
const genesis = conversationGenesis(META);
const kem = kemKeygen(); const member = { kappa: op.kappa, pub: kem.pub, sk: kem.sk };
const epoch = await newEpoch({ genesis, members: [member], seq: 0 });
const epochKey = await unwrapEpochKey(epoch.meta, member);
const tA = makeThread({ genesis, backend: arrayBackend(), now, signer: op });
const tB = makeThread({ genesis, backend: arrayBackend(), now, signer: op });
const M = (text, sentAt) => ({ text, sender: "Ilya", sentAt, chat: "Ilya", source: "web.whatsapp.com" });

const te = new TextEncoder();
const AAD = te.encode("holo-messenger/roam/chain/v1");
let lastWire = "";
async function publishChain(peer, thread) {
  const bundle = te.encode(JSON.stringify({ genesis: thread.genesis, entries: thread.replay() }));
  const sealed = await aeadSeal(epochKey, bundle, AAD); // epoch AEAD → CN carries ciphertext
  const bytes = cnBytesOf(sealed); lastWire = Buffer.from(bytes).toString("utf8");
  const k = peer.cn_put(bytes); peer.cn_announce(k); return k;
}
async function fetchAdopt(peer, k, thread) {
  for (let i = 0; i < 120; i++) { pumpBoth(); try { if (JSON.parse(peer.cn_discover()).includes(k)) break; } catch (e) {} }  // learn the holder (P1-proven)
  peer.cn_fetch_start(k);
  let bytes = undefined;
  for (let i = 0; i < 240; i++) { pumpBoth(); const p = peer.cn_fetch_poll(); if (p === undefined) continue; bytes = p; break; }
  if (!bytes || bytes === null) return { ok: false, why: "no-bytes" };
  let pt; try { pt = await aeadOpen(epochKey, JSON.parse(Buffer.from(bytes).toString("utf8")), AAD); } catch (e) { return { ok: false, why: "open:" + (e && e.message) }; }
  const bundle = JSON.parse(Buffer.from(pt).toString("utf8"));
  return thread.adopt(bundle.entries);                 // verify-before-trust over the sequence (L5)
}

// ── A→B ──
await tA.ingest(M("first", "08:00"));
await tA.ingest(M("second", "08:01"));
const k1 = await publishChain(A, tA); pumpBoth();
const r1 = await fetchAdopt(B, k1, tB);
ok("roam-A-to-B-over-real-cn", r1.ok && tB.length() === 2 && tB.head() === tA.head(), `B len=${tB.length()} ${r1.why || ""}`);
ok("chain-crosses-cn-content-blind", !lastWire.includes("first") && !lastWire.includes("second") && !lastWire.includes("schema:text"), "ciphertext");

// ── B→A ──
await tB.ingest(M("third from B", "08:02"));
const k2 = await publishChain(B, tB); pumpBoth();
const r2 = await fetchAdopt(A, k2, tA);
ok("roam-B-to-A-converges", r2.ok && tA.length() === 3 && tA.head() === tB.head(), `A len=${tA.length()}`);

// ── final convergence + L5 ──
const vA = await tA.verify(); const vB = await tB.verify();
ok("both-peers-converged-and-verify", tA.head() === tB.head() && tA.length() === 3 && vA.ok && vB.ok && tA.view().length === 3, `heads ${tA.head() === tB.head()}`);

await forget(op.kappa).catch(() => {});

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "A→B — peer A publishes its signed conversation chain as an epoch-sealed bundle over the real holowhat CN; peer B fetches (verify-on-receipt), opens (PQ epoch), and adopts → converges to A's head",
    "BLIND — the chain crosses the content network as ciphertext; no message plaintext on the wire (SEC-7)",
    "B→A — B appends a message and republishes; A fast-forwards to B's head over the CN; the conversation converges both directions",
    "L5 — adopt re-verifies every entry's signature + hash-linkage before replacing the local chain; both peers' chains verify after convergence",
  ],
  genesis, head: tA.head(), length: tA.length(),
  checks, failed: fail,
  authority: "holowhat Console CN (real WASM) · holo-messenger-thread/adopt · holo-messenger-epoch (X25519‖ML-KEM-1024) · holo-strand · CC-38/CC-49 · Law L1/L5 · SEC-7",
};
writeFileSync(join(here, "holo-holowhat-cn-p3-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo × holowhat P3 — cross-device conversation roam over the REAL content network\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  two real Console peers · converged at ${String(tA.head()).slice(-12)} · ${tA.length()} events · content-blind`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
