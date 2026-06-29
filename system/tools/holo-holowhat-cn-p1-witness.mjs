#!/usr/bin/env node
// holo-holowhat-cn-p1-witness.mjs — P1: our PQ-sealed message carried over the REAL holowhat Content
// Network. Two genuine `Console` WASM peers, connected by shuttling cn_outbound()→cn_inbound() (exactly
// what cn_pump does over a WebRtcLink, minus the browser carrier). Proves holowhat's actual serverless
// networking (announce / discover / fetch + verify-on-receipt) carries our messenger end-to-end.
//
//   PUT      — peer A cn_put(envelope bytes) → κ, identical to our cnKappaOf (P0 parity)
//   DISCOVER — A announces κ; after pumping frames both ways, B's cn_discover() lists it (CC-38)
//   FETCH    — B cn_fetch_start(κ) + pump + cn_fetch_poll → the exact bytes (holowhat verify-on-receipt, L5)
//   OPEN     — B opens the fetched envelope with the PQ epoch key → the original message (our E2EE)
//   BLIND    — the fetched payload is ciphertext: no plaintext crosses the content network (SEC-7)
//   IDENTITY — Console.sign_in(key) returns a content-addressed identity κ (holowhat self-sovereign)
//
//   node tools/holo-holowhat-cn-p1-witness.mjs
//
// Authority: holowhat Console CN (cn_put/announce/discover/fetch_start/fetch_poll/outbound/inbound) ·
//   holo-messenger-epoch (X25519‖ML-KEM-1024 E2EE) · holospaces CC-38/CC-49 · Law L1/L5 · SEC-1/SEC-7.

import { writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { cnBytesOf, cnKappaOf } from "../os/usr/lib/holo/holo-messenger-cn.mjs";
import { mint } from "../os/usr/lib/holo/holo-pluck.mjs";
import { newEpoch, unwrapEpochKey, sealMessage, openMessage } from "../os/usr/lib/holo/holo-messenger-epoch.mjs";
import { kemKeygen } from "../os/usr/lib/holo/holo-pqc.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PKG = join(here, "..", "..", "..", "_vendor/holowhat/crates/holospaces-web/web/pkg");
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const eqBytes = (a, b) => a && b && a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// load the REAL holowhat WASM
const mjs = join(PKG, "holospaces_web.mjs");
if (!existsSync(mjs)) copyFileSync(join(PKG, "holospaces_web.js"), mjs);
const hw = await import(pathToFileURL(mjs).href);
hw.initSync({ module: await WebAssembly.compile(readFileSync(join(PKG, "holospaces_web_bg.wasm"))) });

// two genuine content peers + a manual pump (the carrier a WebRtcLink/cn_pump provides in the browser)
const A = new hw.Console();
const B = new hw.Console();
const pump = (from, to) => { let n = 0, f; while ((f = from.cn_outbound()) !== undefined) { to.cn_inbound(f); n++; } return n; };
const pumpBoth = () => { let n = 0; for (let i = 0; i < 4; i++) n += pump(A, B) + pump(B, A); return n; };

// our PQ-sealed envelope (the wire payload)
const genesis = "blake3:" + "cd".repeat(32);
const kem = kemKeygen(); const member = { kappa: "did:holo:member:me", pub: kem.pub, sk: kem.sk };
const epoch = await newEpoch({ genesis, members: [member], seq: 0 });
const epochKey = await unwrapEpochKey(epoch.meta, member);
const PLAIN = "carried over the real holowhat content network";
const envelope = await sealMessage(epoch, mint({ text: PLAIN, sender: "Ilya", sentAt: "08:31", chat: "Ilya", source: "web.whatsapp.com" }).object);
const envBytes = cnBytesOf(envelope);

// ── 1 · PUT — A publishes; holowhat's κ equals our cnKappaOf (P0 parity holds on real bytes) ──
const kappa = A.cn_put(envBytes);
ok("cn-put-kappa-matches-ours", kappa === cnKappaOf(envelope) && /^blake3:[0-9a-f]{64}$/.test(kappa), kappa);

// ── 2 · DISCOVER — A announces; pump; B discovers the κ (CC-38 round-trip) ──
A.cn_announce(kappa);
let discovered = false;
for (let i = 0; i < 40 && !discovered; i++) { pumpBoth(); try { discovered = JSON.parse(B.cn_discover()).includes(kappa); } catch (e) {} }
ok("cn-discover-finds-announced-kappa", discovered, discovered ? "found" : "not-found");

// ── 3 · FETCH — B fetches the κ over the CN; holowhat verifies on receipt; bytes are exact ──
B.cn_fetch_start(kappa);
let fetched = undefined;
for (let i = 0; i < 80; i++) { pumpBoth(); const p = B.cn_fetch_poll(); if (p === undefined) continue; fetched = p; break; }
ok("cn-fetch-returns-exact-bytes", fetched && fetched !== null && eqBytes(fetched, envBytes), fetched == null ? "none" : `${fetched.length}B`);

// ── 4 · OPEN — B opens the fetched envelope with the PQ epoch key → the original message ──
let opened = { ok: false };
if (fetched && fetched.length) { try { const env = JSON.parse(Buffer.from(fetched).toString("utf8")); opened = await openMessage(epochKey, env); } catch (e) {} }
ok("fetched-envelope-opens-to-message", opened.ok && opened.object && opened.object["schema:text"] === PLAIN, opened.ok ? "opened" : "closed");

// ── 5 · BLIND — the bytes on the content network are ciphertext (no plaintext) ──
ok("content-network-is-content-blind", !Buffer.from(envBytes).toString("utf8").includes(PLAIN) && !Buffer.from(envBytes).toString("utf8").includes("schema:text"), "ciphertext");

// ── 6 · IDENTITY — Console.sign_in returns a content-addressed self-sovereign identity κ ──
let idKappa = ""; try { idKappa = A.sign_in(new Uint8Array(32).fill(7)); } catch (e) {}
ok("signin-returns-identity-kappa", typeof idKappa === "string" && idKappa.length > 0, idKappa.slice(0, 32));

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "PUT — peer A cn_put(envelope bytes) returns a κ byte-identical to our cnKappaOf (P0 parity on real wire bytes)",
    "DISCOVER — A cn_announce(κ); after pumping CC-49 frames both ways, B's cn_discover() lists the κ (CC-38 round-trip)",
    "FETCH — B cn_fetch_start(κ) + pump + cn_fetch_poll returns the exact bytes; holowhat verifies on receipt (Law L5)",
    "OPEN — B opens the fetched envelope with the per-conversation PQ epoch key (X25519‖ML-KEM-1024) → the original message",
    "BLIND — only ciphertext crosses the content network; no plaintext (SEC-7 content-blind carrier)",
    "IDENTITY — the real Console.sign_in(key) returns a content-addressed self-sovereign identity κ",
  ],
  kappa, plaintextRecovered: opened.ok,
  checks, failed: fail,
  authority: "holowhat Console CN (real WASM) · holo-messenger-epoch (PQ E2EE) · holospaces CC-38/CC-49 · Law L1/L5 · SEC-1/SEC-7",
};
writeFileSync(join(here, "holo-holowhat-cn-p1-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo × holowhat P1 — our PQ-sealed message over the REAL holowhat content network\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  two real Console peers · κ ${kappa} · fetched+opened over CC-49 pump · content-blind`);
console.log(`\n  ${witnessed ? "WITNESSED ✓ — holowhat's real networking carries our E2EE messenger" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
