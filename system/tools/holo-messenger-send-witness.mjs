#!/usr/bin/env node
// holo-messenger-send-witness.mjs — THE SEND PATH, GATED BY THE TEE, proven in pure Node.
//
// Drives the REAL holo-stepup build/verify (sovereign axis) with a REAL enrolled holo-identity
// principal as both the conversation's author AND the step-up subject, and a fake platform
// deliver. Proves every outbound message is consent-bound to its own κ, fail-closed on denial,
// seamless within the trust window, and never claimed unless it actually landed.
//
//   GATED    — a send runs a step-up bound to the message κ, delivers, and chains ONE verified κ
//   BIND     — the step-up token re-derives (L5) and its payload commits to THIS message's κ
//   CONSENT  — the attestation is bound to the send as a sibling provenance note (not in content)
//   DENY     — a cancelled/denied step-up → not delivered, not chained (fail-closed)
//   UNBOUND  — a valid-but-mis-bound step-up token is refused (must commit to this exact κ)
//   WINDOW   — first send asks; a send within the trust window rides it; a stale one asks again
//   HONEST   — a delivery that doesn't land returns sent:false — never a phantom send
//   PURE     — the message content κ carries NO consent (cross-platform dedup preserved, SEC-3)
//   L5       — after a gated send the whole conversation chain still verifies
//
//   node tools/holo-messenger-send-witness.mjs
//
// Authority: holo-stepup (payload-bound TEE step-up) · holo-apps explicit-consent · SEC-2 · Law L5.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { conversationGenesis, makeThread } from "../os/usr/lib/holo/holo-messenger-thread.mjs";
import { makeSender } from "../os/usr/lib/holo/holo-messenger-send.mjs";
import { buildStepUp, verifyStepUp } from "../os/usr/lib/holo/holo-stepup.mjs";
import { mint } from "../os/usr/lib/holo/holo-pluck.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = () => { let s = []; return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-23T12:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "send-tester", passphrase: "correct horse battery" });
const META = { platform: "whatsapp", chat: "Ilya" };
const genesis = conversationGenesis(META);

// the gate: the REAL step-up build (sovereign axis) over the action κ; captures issued tokens.
const issued = [];
const gate = async (action) => { const t = await buildStepUp(action, op); issued.push(t); return t; };
const denyGate = async () => { throw new Error("user cancelled at the TEE"); };
const unboundGate = async (action) => buildStepUp({ ...action, payload: { ...action.payload, "holo:message": "did:holo:sha256:" + "0".repeat(64) } }, op); // valid token, wrong κ
const okDeliver = async () => ({ ok: true, note: "platform compose+send (stub)" });
const failDeliver = async () => ({ ok: false, why: "no compose box found in tab" });

// ── 1 · GATED — a send steps up, delivers, and chains one verified κ ──
const thread = makeThread({ genesis, backend: arrayBackend(), now, signer: op });
const sender = makeSender({ thread, operator: op.kappa, stepUp: gate, deliver: okDeliver, now });
const r1 = await sender.send({ text: "hello from holo — gated send", chat: "Ilya", platform: "whatsapp" }, { nowMs: 1000 });
const v1 = thread.view();
ok("gated-send-attests-and-chains",
  r1.sent && r1.gated && /^did:holo:sha256:/.test(r1.kappa) && /^did:holo:sha256:/.test(r1.consent) &&
  v1.length === 1 && v1[0].text === "hello from holo — gated send" && v1[0].kappa === r1.kappa,
  JSON.stringify({ sent: r1.sent, gated: r1.gated }));

// ── 2 · BIND — the step-up token re-derives and commits to THIS message's κ ──
const tok = issued[issued.length - 1];
const body = await verifyStepUp(tok);
ok("step-up-binds-the-message-kappa",
  !!body && /^did:holo:sha256:[0-9a-f]{64}$/.test(tok.id) && body.payload["holo:message"] === r1.kappa && tok.challenge && body.kind === "message.send",
  body ? body.payload["holo:message"].slice(-8) : "no body");

// ── 3 · CONSENT — the attestation is bound as a sibling provenance note (not message content) ──
const notes = thread.replay({ kind: "message.consent" });
ok("consent-recorded-as-provenance-note",
  notes.length === 1 && notes[0]["holstr:payload"]["holo:message"] === r1.kappa && notes[0]["holstr:payload"]["holo:stepup"] === r1.consent,
  `notes=${notes.length}`);

// ── 4 · DENY — a denied step-up is fail-closed: nothing delivered, nothing chained ──
const t2 = makeThread({ genesis, backend: arrayBackend(), now, signer: op });
const s2 = makeSender({ thread: t2, operator: op.kappa, stepUp: denyGate, deliver: okDeliver, now });
const rDeny = await s2.send({ text: "should never send", chat: "Ilya", platform: "whatsapp" }, { nowMs: 2000 });
ok("denied-step-up-fails-closed", rDeny.sent === false && /step-up-denied/.test(rDeny.why) && t2.view().length === 0 && t2.length() === 0, rDeny.why);

// ── 5 · UNBOUND — a valid token that commits to a DIFFERENT κ is refused ──
const t3 = makeThread({ genesis, backend: arrayBackend(), now, signer: op });
const s3 = makeSender({ thread: t3, operator: op.kappa, stepUp: unboundGate, deliver: okDeliver, now });
const rUnbound = await s3.send({ text: "mis-bound consent", chat: "Ilya", platform: "whatsapp" }, { nowMs: 3000 });
ok("mis-bound-consent-refused", rUnbound.sent === false && /unbound|unverified/.test(rUnbound.why) && t3.view().length === 0, rUnbound.why);

// ── 6 · WINDOW — first send asks; within-window rides; stale asks again (seamless + secure) ──
const t4 = makeThread({ genesis, backend: arrayBackend(), now, signer: op });
const s4 = makeSender({ thread: t4, operator: op.kappa, stepUp: gate, deliver: okDeliver, now, trustWindowMs: 120000 });
const a = await s4.send({ text: "first", chat: "Ilya", platform: "whatsapp" }, { nowMs: 10000 });
const b = await s4.send({ text: "second (rides window)", chat: "Ilya", platform: "whatsapp" }, { nowMs: 11000 });
const c = await s4.send({ text: "third (stale → asks)", chat: "Ilya", platform: "whatsapp" }, { nowMs: 10000 + 200000 });
ok("trust-window-gates-once-then-rides",
  a.sent && a.gated === true && b.sent && b.gated === false && c.sent && c.gated === true && t4.view().length === 3,
  `gated: ${a.gated}/${b.gated}/${c.gated}`);

// ── 7 · HONEST — a delivery that doesn't land is never claimed as sent (ungated path) ──
const t5 = makeThread({ genesis, backend: arrayBackend(), now, signer: op });
const s5 = makeSender({ thread: t5, operator: null, stepUp: null, deliver: failDeliver, now });   // operator:null ⇒ ungated
const rFail = await s5.send({ text: "platform offline", chat: "Ilya", platform: "whatsapp" }, { nowMs: 4000 });
ok("undelivered-never-claimed-sent", rFail.sent === false && /deliver-failed/.test(rFail.why) && t5.view().length === 0, rFail.why);

// ── 8 · PURE — the message content κ carries no consent (dedup preserved, SEC-3) ──
const msgEntry = thread.replay({ kind: "message" })[0];
const contentObj = msgEntry["holstr:payload"].object;
const hasConsentInContent = JSON.stringify(contentObj).includes("stepup") || JSON.stringify(contentObj).includes("consent");
ok("content-kappa-pure-no-consent",
  !hasConsentInContent && contentObj.id === r1.kappa,
  `pure=${!hasConsentInContent}`);

// ── 9 · L5 — after a gated send + consent note, the whole chain still verifies ──
const vAll = await thread.verify();
ok("chain-verifies-after-gated-send", vAll.ok === true && vAll.length === 2, JSON.stringify(vAll)); // 1 message + 1 consent note

await forget(op.kappa).catch(() => {});

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "GATED — an outbound message runs a TEE step-up bound to its own κ, delivers, then chains one verified κ",
    "BIND — the step-up token re-derives (L5) and its payload commits to THIS message's κ (the human approved this exact send)",
    "CONSENT — the step-up attestation is bound to the send as a sibling provenance note, not in the content κ",
    "DENY — a denied/cancelled step-up is fail-closed: the message is neither delivered nor chained",
    "UNBOUND — a valid step-up token that commits to a different κ is refused (binding is enforced at send)",
    "WINDOW — the first send asks; a send within the trust window rides it; a stale one asks again (seamless yet secure)",
    "HONEST — a platform delivery that doesn't land is never claimed as sent (no phantom sends)",
    "PURE — the message content κ carries no consent data, so the same message still dedups across platforms (SEC-3)",
    "L5 — after a gated send plus its consent note, the whole conversation chain still verifies",
  ],
  operator: op.kappa, genesis, sample: { kappa: r1.kappa, consent: r1.consent },
  checks, failed: fail,
  authority: "holo-stepup (payload-bound TEE step-up) · holo-apps explicit-consent · holospaces SEC-2 · Law L5",
};
writeFileSync(join(here, "holo-messenger-send-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Messenger send witness — the send path, gated by the TEE\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  gated send κ ${String(r1.kappa).slice(-12)} · consent ${String(r1.consent).slice(-12)} · operator ${String(op.kappa).slice(-12)}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
