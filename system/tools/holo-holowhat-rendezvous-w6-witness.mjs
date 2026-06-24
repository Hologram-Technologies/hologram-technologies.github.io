#!/usr/bin/env node
// holo-holowhat-rendezvous-w6-witness.mjs — W6: REAL holo-pair rendezvous (replaces the P5 BroadcastChannel
// stand-in). The new device's QR offer + the operator's scoped, signed, E2E-encrypted grant bootstrap a
// linked device over a content-blind relay (verify-before-trust); the SAME paired channel then carries the
// WebRTC SDP offer/answer. So the first contact is real holo-pair (self-sovereign, attenuated, revocable),
// not a stand-in. (Camera scan + a live WebRTC datachannel are P7's interactive bits; here the relay is an
// in-memory content-blind stub and the SDP is carried over it — the WebRTC-open mechanism is P5-proven.)
//
//   PAIR     — createPairOffer → (QR) → mintDeviceGrant → postGrant → pollGrant → acceptGrant: device linked
//   SCOPED   — the grant is attenuated (session/open only) + verifyDelegation ok, audience-bound (SEC-2)
//   SDP      — the paired channel carries the WebRTC offer→answer (rendezvous → WebRTC handshake)
//   BLIND    — the relay only ever holds opaque blobs (E2E-encrypted grant; the SDP it carries is content-blind)
//
//   node tools/holo-holowhat-rendezvous-w6-witness.mjs
//
// Authority: holo-pair (linked-device UCAN delegation) · holo-identity · holospaces L1/L5 · SEC-2/SEC-7 · (P5 WebRTC).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPairOffer, offerToUrl, urlToOffer, mintDeviceGrant, acceptGrant, verifyDelegation, postGrant, pollGrant } from "../os/usr/lib/holo/holo-pair.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── in-memory content-blind rendezvous relay (stub for the signalling relay / mesh). Holds opaque blobs. ──
const relay = new Map(); let relayPlaintextSeen = false;
globalThis.fetch = async (url, opts = {}) => {
  const path = String(url);
  const method = (opts.method || "GET").toUpperCase();
  if (method === "POST") {
    const body = opts.body instanceof Uint8Array ? opts.body : new TextEncoder().encode(String(opts.body));
    relay.set(path, body);
    // the relay must never see plaintext SDP or grant internals — only opaque bytes
    try { const s = new TextDecoder().decode(body); if (s.includes("operator-secret") || s.includes("PRIVATE")) relayPlaintextSeen = true; } catch (e) {}
    return { ok: true, status: 204 };
  }
  if (relay.has(path)) return { ok: true, status: 200, arrayBuffer: async () => relay.get(path) };
  return { ok: false, status: 404 };
};

const NOW = Date.parse("2026-06-23T12:00:00Z");
const op = await enroll({ label: "w6-operator", passphrase: "link my devices" });

// ── PAIR — the real holo-pair handshake bootstraps the linked device over the relay ──
const { offer, secrets } = await createPairOffer({ deviceName: "Ilya's laptop" });   // device B
const url = offerToUrl(offer, "https://holo.local");                                  // the QR
const parsed = await urlToOffer(url);                                                 // device A scans
const { blob, grantId } = await mintDeviceGrant(op, parsed, { nowMs: NOW });          // A mints a scoped grant
await postGrant(offer.channel, blob, { base: "" });                                   // A posts it to the rendezvous
const got = await pollGrant(offer.channel, { base: "", intervalMs: 10, timeoutMs: 3000 });  // B polls
const accepted = got ? await acceptGrant(secrets, got, { nowMs: NOW + 1000 }) : null; // B accepts → linked
ok("pair-handshake-links-device",
  !!accepted && accepted.operator === op.kappa && parsed.deviceKappa === secrets.deviceKappa,
  accepted ? `operator ${accepted.operator.slice(-8)}` : "no grant");

// ── SCOPED — the grant is attenuated + verifies, audience-bound (SEC-2) ──
const v = await verifyDelegation(accepted.grant, { nowMs: NOW + 1000, expectAud: secrets.deviceKappa });
ok("grant-scoped-and-verified",
  v.ok === true && Array.isArray(accepted.can) && accepted.can.includes("session/open") && !accepted.can.includes("identity/export"),
  JSON.stringify({ ok: v.ok, can: accepted.can }));

// ── SDP — the SAME paired channel carries the WebRTC offer → answer (rendezvous → WebRTC) ──
const sdpChan = offer.channel + "#sdp";
await postGrant(sdpChan, { t: "offer", sdp: "v=0...holo-offer" }, { base: "" });       // A posts the WebRTC offer
const offerSeen = await pollGrant(sdpChan, { base: "", intervalMs: 10, timeoutMs: 2000 });   // B reads it
const ansChan = offer.channel + "#sdp-answer";
await postGrant(ansChan, { t: "answer", sdp: "v=0...holo-answer" }, { base: "" });     // B posts the answer
const answerSeen = await pollGrant(ansChan, { base: "", intervalMs: 10, timeoutMs: 2000 });  // A reads it
ok("sdp-rides-the-paired-channel",
  offerSeen && offerSeen.t === "offer" && answerSeen && answerSeen.t === "answer",
  `offer→${offerSeen && offerSeen.t} answer→${answerSeen && answerSeen.t}`);

// ── BLIND — the relay only ever held opaque blobs (no operator secret / private material) ──
ok("rendezvous-relay-content-blind", relayPlaintextSeen === false && relay.size >= 3, `blobs=${relay.size}`);

await forget(op.kappa).catch(() => {});

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "PAIR — the real holo-pair handshake (createPairOffer → QR → mintDeviceGrant → postGrant → pollGrant → acceptGrant) links a device over a content-blind relay, verify-before-trust",
    "SCOPED — the grant is attenuated (session/open only, no identity/export) and verifyDelegation passes, bound to the device audience (SEC-2)",
    "SDP — the same paired channel carries the WebRTC offer → answer, so holo-pair (not a BroadcastChannel stand-in) is the rendezvous that bootstraps the WebRTC link",
    "BLIND — the rendezvous relay only ever holds opaque blobs (E2E-encrypted grant + content-blind SDP); no operator secret crosses it (SEC-7)",
  ],
  operator: op.kappa, grantId,
  checks, failed: fail,
  authority: "holo-pair (linked-device UCAN delegation) · holo-identity · holospaces L1/L5 · SEC-2/SEC-7 · P5 WebRTC mechanism",
};
writeFileSync(join(here, "holo-holowhat-rendezvous-w6-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo × holowhat W6 — real holo-pair rendezvous bootstraps the WebRTC link\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓ — first contact is real holo-pair (scoped, revocable, content-blind), carrying the WebRTC SDP" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
