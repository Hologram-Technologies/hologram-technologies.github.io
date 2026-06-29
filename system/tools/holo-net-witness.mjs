#!/usr/bin/env node
// holo-net-witness.mjs — W1: ONE HoloNet interface, two implementations, same outcome.
// The identical operation (publish a PQ-sealed envelope on peer A → fetch + open on peer B) passes over
//   • the LOCAL impl (in-process makeContentPeer), and
//   • the HOLOWHAT impl (two REAL `Console` WASM peers, frames shuttled = what cn_pump does over WebRTC).
// So the messenger seams can target HoloNet and swap carriers with no code change.
//
//   node tools/holo-net-witness.mjs
//
// Authority: holo-net (the interface) · holowhat Console CN (real WASM) · holo-messenger-cn (local) ·
//   holo-messenger-epoch (PQ E2EE) · Law L1/L5 · SEC-1/SEC-7.

import { writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { makeLocalNet, linkLocal, makeHolowhatNet } from "../os/usr/lib/holo/holo-net.mjs";
import { mint } from "../os/usr/lib/holo/holo-pluck.mjs";
import { newEpoch, unwrapEpochKey, sealMessage, openMessage } from "../os/usr/lib/holo/holo-messenger-epoch.mjs";
import { kemKeygen } from "../os/usr/lib/holo/holo-pqc.mjs";
import { cnBytesOf } from "../os/usr/lib/holo/holo-messenger-cn.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PKG = join(here, "..", "..", "..", "_vendor/holowhat/crates/holospaces-web/web/pkg");
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const eq = (a, b) => a && b && a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// a PQ-sealed envelope to carry over each impl
const genesis = "blake3:" + "12".repeat(32);
const kem = kemKeygen(); const member = { kappa: "did:holo:member:w1", pub: kem.pub, sk: kem.sk };
const epoch = await newEpoch({ genesis, members: [member], seq: 0 });
const epochKey = await unwrapEpochKey(epoch.meta, member);
async function freshEnvelope(text) { return cnBytesOf(await sealMessage(epoch, mint({ text, sender: "Ilya", sentAt: "08:31", chat: "Ilya", source: "web.whatsapp.com" }).object)); }

// ── impl LOCAL ──
async function runLocal() {
  const A = makeLocalNet(), B = makeLocalNet(); linkLocal(A, B);
  const env = await freshEnvelope("over the LOCAL net");
  const k = A.cnPut(env); A.cnAnnounce(k, genesis);                  // ANN→B→auto-GET→OBJ→B stores
  const bytes = await B.cnFetch(k);
  const opened = bytes ? await openMessage(epochKey, JSON.parse(Buffer.from(bytes).toString("utf8"))) : { ok: false };
  return { kMatchesKappa: k === A.kappa(env), fetched: eq(bytes, env), opened: opened.ok && opened.object["schema:text"] === "over the LOCAL net" };
}

// ── impl HOLOWHAT (real WASM Console peers, frames shuttled) ──
async function runHolowhat() {
  const mjs = join(PKG, "holospaces_web.mjs");
  if (!existsSync(mjs)) copyFileSync(join(PKG, "holospaces_web.js"), mjs);
  const hw = await import(pathToFileURL(mjs).href);
  hw.initSync({ module: await WebAssembly.compile(readFileSync(join(PKG, "holospaces_web_bg.wasm"))) });
  const A = makeHolowhatNet(hw.Console, hw.kappa), B = makeHolowhatNet(hw.Console, hw.kappa);
  const shuttle = (from, to) => { let f; while ((f = from.cn_outbound()) !== undefined) to.cn_inbound(f); };
  const pumpBoth = () => { for (let i = 0; i < 8; i++) { shuttle(A.console, B.console); shuttle(B.console, A.console); } };
  A._setPump(pumpBoth); B._setPump(pumpBoth);
  const env = await freshEnvelope("over the REAL holowhat net");
  const k = A.cnPut(env); A.cnAnnounce(k); pumpBoth();
  const bytes = await B.cnFetch(k);
  const opened = bytes ? await openMessage(epochKey, JSON.parse(Buffer.from(bytes).toString("utf8"))) : { ok: false };
  return { kMatchesKappa: k === A.kappa(env), fetched: eq(bytes, env), opened: opened.ok && opened.object["schema:text"] === "over the REAL holowhat net" };
}

const L = await runLocal();
ok("local-impl-publish-fetch-open", L.kMatchesKappa && L.fetched && L.opened, JSON.stringify(L));
const H = await runHolowhat();
ok("holowhat-impl-publish-fetch-open", H.kMatchesKappa && H.fetched && H.opened, JSON.stringify(H));
ok("both-impls-same-uniform-interface", L.opened && H.opened, "publish→cnFetch→open identical over local + holowhat");

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "LOCAL — the HoloNet interface over the in-process makeContentPeer: cnPut+cnAnnounce → cnFetch → open a PQ-sealed envelope; κ == kappa(bytes)",
    "HOLOWHAT — the SAME interface over two REAL Console WASM peers (frames shuttled = cn_pump over WebRTC): cnPut+cnAnnounce → cnFetch (discover→fetch_start→poll) → open",
    "PARITY — the identical publish→cnFetch→open sequence yields the original message over both implementations; the surface targets one interface and swaps carriers with no code change",
  ],
  checks, failed: fail,
  authority: "holo-net · holowhat Console CN (real WASM) · holo-messenger-cn (local) · holo-messenger-epoch (X25519‖ML-KEM-1024) · Law L1/L5",
};
writeFileSync(join(here, "holo-net-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Net witness — one interface, two implementations (W1)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓ — the surface can target HoloNet and swap local ↔ real holowhat CN with no rewrite" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
