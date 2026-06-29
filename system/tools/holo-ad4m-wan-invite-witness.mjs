#!/usr/bin/env node
// holo-ad4m-wan-invite-witness.mjs — the HUMAN on-ramp to WAN: one shared link, two devices in the same
// Space, serverless. An inviter mints a `space-invite` link (a real WebRTC offer rides inside); the joiner
// opens it and hands back ONE answer string (the single out-of-band step); the inviter mints an operator-
// signed membership grant for the joiner's AGENT κ. Then the two converge — and a peer WITHOUT a valid grant
// is not a member, so its posts never render (an invite-only Space is gated; an open Space is not). The raw
// RTCPeerConnection is stubbed (paired offerer/answerer over a faithful async channel); everything else —
// link packing, the membership delegation, verify-before-adopt — is the real code.
//
// Authority: serverless invite/join over real transport · holo-pair delegation (operator-signed, L5) ·
// composes holo-ad4m-wan + holo-ad4m-boot + holo-webrtc-link(stub) + holo-pair. node tools/holo-ad4m-wan-invite-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeWanTransport } from "../os/usr/lib/holo/holo-ad4m-wan.mjs";
import { makeHoloWeb } from "../os/usr/lib/holo/holo-ad4m-boot.mjs";
import * as pair from "../os/usr/lib/holo/holo-pair.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tk = 0; const now = () => `2026-06-25T03:00:${String(tk++).padStart(2, "0")}.000Z`;
const T0 = Date.parse("2026-06-25T03:00:00.000Z");
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0)); };

// faithful async point-to-point channel pair (an RTCDataChannel stand-in).
function wirePair() {
  const mk = () => ({ peer: null, h: null,
    send(s) { const p = this.peer; if (p && p.h) { const h = p.h; queueMicrotask(() => h({ data: s })); } },
    addEventListener(e, f) { if (e === "message") this.h = f; },
    removeEventListener(e, f) { if (e === "message" && this.h === f) this.h = null; } });
  const a = mk(), b = mk(); a.peer = b; b.peer = a; return [a, b];
}
// an RTC stub: createOfferer/createAnswerer register onChannel callbacks; offerer.accept() opens a real
// (mock) channel pair and fires BOTH onChannels — exactly what a completed ICE/DTLS handshake does.
function rtcStub() {
  let offChan = null, ansChan = null;
  return {
    createOfferer: async ({ onChannel }) => { offChan = onChannel; return { offer: "SDP_OFFER", accept: async () => { const [a, b] = wirePair(); offChan && offChan(a); ansChan && ansChan(b); }, close() {} }; },
    createAnswerer: async (offer, { onChannel }) => { ansChan = onChannel; return { answer: "SDP_ANSWER", close() {} }; },
  };
}

const ana = await enroll({ label: "inv-ana", passphrase: "one link" });   // the inviter (Space owner)
const bob = await enroll({ label: "inv-bob", passphrase: "one link" });   // the joiner
const rog = await enroll({ label: "inv-rog", passphrase: "one link" });   // a rogue peer (no grant)
const names = new Map([[ana.kappa, "Ana"], [bob.kappa, "Bob"], [rog.kappa, "Rogue"]]);

const rtc = rtcStub();
let webA, webB;
const txA = makeWanTransport({ deliver: (s, m) => webA._internal.deliver(s, m), operator: ana, webrtc: rtc, pair, nowMs: T0 });
const txB = makeWanTransport({ deliver: (s, m) => webB._internal.deliver(s, m), operator: bob, webrtc: rtc, pair, nowMs: T0 });
webA = makeHoloWeb({ signer: ana, now, displayName: "Ana", names, transport: txA });
webB = makeHoloWeb({ signer: bob, now, displayName: "Bob", names, transport: txB });

// ── 1 · the invite link round-trips: inviter → link, joiner → answer, the channel attaches both sides ───
const inv = await webA.invite("Club");
ok("inviteLinkMinted", inv.ok && /space-invite\.html#i=/.test(inv.link) && typeof inv.complete === "function", inv.link && inv.link.slice(0, 40));
const joined = await webB.open(inv.link);
ok("joinerAnswers", joined.ok && joined.opened === "invite" && joined.space.name === "Club" && typeof joined.answer === "string" && typeof joined.accept === "function", JSON.stringify({ opened: joined.opened, space: joined.space }));
const completed = await inv.complete(joined.answerBlob);     // accept the SDP answer → channel opens → mint the grant
await settle();
ok("channelAttached", txA.peerCount() === 1 && txB.peerCount() === 1 && completed.joiner === bob.kappa && !!completed.grant, `peersA=${txA.peerCount()} peersB=${txB.peerCount()}`);

// ── 2 · the answer carries NO secret (only an SDP answer + the joiner's public agent κ) ────────────────
const answerStr = JSON.stringify(joined.answerBlob);
ok("answerNoSecret", !/Pkcs8|privateKey|secret|devicePkcs8/i.test(answerStr) && joined.answerBlob.joinerKappa === bob.kappa && !!joined.answerBlob.answer, answerStr.slice(0, 80));

// ── 3 · the grant ADMITS the joiner: Bob verifies it, then a real post converges + renders both ways ───
const admitted = await joined.accept(completed.grant);
ok("grantAdmits", admitted.operator === ana.kappa && Array.isArray(admitted.can) && admitted.can.includes("space/member"), JSON.stringify(admitted));
await webA.post("Club", "welcome to the club"); await settle();
await webB.post("Club", "glad to be here"); await settle();
const bobSees = (await webB.open("Club")).posts.map((p) => p.text);
const anaSees = (await webA.open("Club")).posts.map((p) => p.text);
ok("membersConverge",
  bobSees.includes("welcome to the club") && anaSees.includes("glad to be here"),
  JSON.stringify({ bobSees, anaSees }));

// ── 4 · a TAMPERED grant is refused (any mutated field breaks the operator signature / the audience) ───
let tamperRefused = false;
try { const g = JSON.parse(JSON.stringify(completed.grant)); g.aud = rog.kappa; await joined.accept(g); } catch (e) { tamperRefused = /rejected/.test(e.message); }
ok("tamperedGrantRefused", tamperRefused);

// ── 5 · a FORGED grant (signed by a non-operator) is refused: issuer κ won't re-derive to its pubkey ──
let forgeRefused = false;
const forged = JSON.parse(JSON.stringify(completed.grant));
forged.issPub = rog.pub; forged.issAlg = rog.alg;          // claim a different signer while keeping iss=ana
try { await joined.accept(forged); } catch (e) { forgeRefused = /rejected/.test(e.message); }
ok("forgedGrantRefused", forgeRefused);

// ── 6 · an EXPIRED grant is refused (the time window is enforced, L5) ───────────────────────────────────
const vExpired = await pair.verifyDelegation(completed.grant, { expectAud: bob.kappa, allowedCaps: ["space/member"], nowMs: T0 + 40 * 24 * 3600e3 });
ok("expiredGrantRefused", vExpired.ok === false && /expired/.test(vExpired.reason), JSON.stringify(vExpired));

// ── 7 · a NON-MEMBER (rogue, no grant) connects and posts — its posts DO NOT render in the gated Space ─
let webR;
const txR = makeWanTransport({ deliver: (s, m) => webR._internal.deliver(s, m), operator: rog, webrtc: rtcStub(), pair, nowMs: T0 });
webR = makeHoloWeb({ signer: rog, now, displayName: "Rogue", names, transport: txR });
await webR.open("Club");                                     // rogue opens the same Space name (its own, ungated locally)
const [rc1, rc2] = wirePair(); txA.attach(rc1); txR.attach(rc2);  // rogue wires a raw channel straight to Ana
await webR.post("Club", "i am not invited"); await settle();
const anaAfterRogue = (await webA.open("Club")).posts.map((p) => p.text);
ok("nonMemberFiltered", !anaAfterRogue.includes("i am not invited") && anaAfterRogue.includes("glad to be here"), JSON.stringify(anaAfterRogue));

// ── 8 · an OPEN (non-invited) Space is still open — gating is opt-in, P12 convergence intact ───────────
await webA.open("Lobby"); await webR.open("Lobby");          // Lobby created by plain open() ⇒ not gated
const [lc1, lc2] = wirePair(); txA.attach(lc1); txR.attach(lc2);
await webR.post("Lobby", "anyone can speak here"); await settle();
const lobby = (await webA.open("Lobby")).posts.map((p) => p.text);
ok("openSpaceStaysOpen", lobby.includes("anyone can speak here"), JSON.stringify(lobby));

await Promise.all([forget(ana.kappa), forget(bob.kappa), forget(rog.kappa)]);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-ad4m-wan-invite — the human on-ramp to WAN: one shared link opens a real WebRTC channel into a Space, serverless. The inviter mints a link (a WebRTC offer inside); the joiner hands back ONE answer + its agent κ; the inviter mints an operator-signed membership grant. Members converge both ways; the answer leaks no secret; a tampered, forged, or expired grant is refused; a non-member peer's posts never render in the invite-only (gated) Space; an open Space stays open (gating is opt-in). No signaling server, no relay, no TURN.",
  authority: "Serverless invite/join over real transport · holo-pair delegation (operator-signed, L5) · composes holo-ad4m-wan + holo-ad4m-boot + holo-webrtc-link + holo-pair",
  witnessed,
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ad4m-wan-invite-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ad4m WAN-INVITE witness — one link, two devices, membership-gated, serverless\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — two strangers share one link and stand in the same sovereign Space` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
