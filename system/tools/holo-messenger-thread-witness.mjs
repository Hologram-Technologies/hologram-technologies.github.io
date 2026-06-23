#!/usr/bin/env node
// holo-messenger-thread-witness.mjs — A CONVERSATION IS A COLLECTION; A MESSAGE IS AN EVENT.
//
// Proves the unified-inbox substrate in pure Node, on the REAL stack: a per-conversation
// holo-strand (signed by a REAL enrolled holo-identity principal), message events minted by
// the REAL holo-pluck spine, reduced to the ordered bubble list a WhatsApp-style surface paints.
//
//   GENESIS   — a conversation's genesis κ is content-addressed (L2): same chat → same κ
//   EVENTS    — each ingested message is a signed, hash-linked event (author = identity κ)
//   SCHEMA    — each event carries the holo-apps §2.6 header via reuse (Lamport seq, parent
//               prev, author op, collection genesis) + signature axis; the chain verifies
//   REDUCE    — view() reduces the chain to ordered, faithful, verify-before-trust bubbles
//   DEDUP     — re-ingesting the same rendered message is idempotent (SEC-3) — no double-append
//   L5        — tamper / reorder / drop ANY message ⇒ verify refuses (Law L5 over the sequence)
//   DURABLE   — a fresh thread over the same store recovers the conversation; verify holds
//   ROAM      — a peer's longer chain fast-forwards via adopt (verify-before-adopt); tamper refused
//   INBOX     — summarize() yields a faithful unified-inbox row (last message, count)
//
//   node tools/holo-messenger-thread-witness.mjs
//
// Authority: holo-apps §2.6/§2.7/§2.8 · holospaces SEC-1/SEC-3 · Law L1/L2/L5 · RFC 8785 JCS.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { conversationGenesis, makeThread } from "../os/usr/lib/holo/holo-messenger-thread.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let store = clone(init); return { load: async () => clone(store), save: async (r) => { store = clone(r); }, dump: () => clone(store) }; };
let tick = 0;
const now = () => `2026-06-23T10:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "messenger-tester", passphrase: "correct horse battery" });

// ── the conversation: "Ilya" on WhatsApp — three captured messages (as a bridge adapter would) ──
const META = { platform: "whatsapp", chat: "Ilya" };
const genesis = conversationGenesis(META);
const MSGS = [
  { text: "The future is light photonics. HOLOGRAM.", sender: "Ilya", sentAt: "08:31", chat: "Ilya", source: "web.whatsapp.com" },
  { text: "ship it 🚀", sender: "Me", sentAt: "08:32", chat: "Ilya", source: "web.whatsapp.com" },
  { text: "on it", sender: "Ilya", sentAt: "08:33", chat: "Ilya", source: "web.whatsapp.com" },
];

// ── 1 · GENESIS — content-addressed; deterministic; collision-honest; order-independent ──
const g2 = conversationGenesis({ platform: "whatsapp", chat: "Ilya" });
const gOther = conversationGenesis({ platform: "telegram", chat: "Ilya" });
const gP1 = conversationGenesis({ platform: "wa", chat: "grp", participants: ["bob", "amy"] });
const gP2 = conversationGenesis({ platform: "wa", chat: "grp", participants: ["amy", "bob"] });
ok("genesis-content-addressed",
  /^did:holo:sha256:[0-9a-f]{64}$/.test(genesis) && genesis === g2 && genesis !== gOther && gP1 === gP2,
  genesis.slice(-8));

// ── 2 · EVENTS — each ingested message is a signed, hash-linked event ──
const backendA = arrayBackend();
const thread = makeThread({ genesis, backend: backendA, now, signer: op });
const ing = [];
for (const m of MSGS) ing.push(await thread.ingest(m));
ok("ingest-appends-signed-events",
  thread.length() === 3 && ing.every((r, i) => r.appended && r.seq === i && r.author === op.kappa),
  `len=${thread.length()} author=${String(op.kappa).slice(-8)}`);

// ── 3 · SCHEMA — §2.6 header present via reuse + the chain verifies (signature axis) ──
const recs = backendA.dump();
const e1 = recs[1];
const v = await thread.verify();
ok("event-schema-2.6-conformant",
  v.ok && v.length === 3 &&
  e1["holstr:seq"] === 1 &&                                    // Lamport clock
  e1["holstr:prev"] === recs[0].id &&                          // parent frontier (linear: one parent)
  e1["holstr:op"] === op.kappa &&                              // author identity κ
  e1["holstr:payload"]["holo:collection"] === genesis &&       // collection genesis κ
  /^did:holo:sha256:/.test(e1["holstr:payload"]["holo:message"]) && // body κ (content address)
  !!e1["holstr:sig"] && e1["holstr:alg"] && e1["holstr:pub"],  // signature axis
  JSON.stringify(v));

// ── 4 · REDUCE — view() is ordered, faithful, verify-before-trust ──
const msgs = thread.view();
ok("view-reduces-ordered-faithful",
  msgs.length === 3 &&
  msgs.map((m) => m.text).join("|") === MSGS.map((m) => m.text).join("|") &&
  msgs[0].sender === "Ilya" && msgs[0].sentAt === "08:31" && msgs[1].sender === "Me" &&
  msgs.every((m) => /^did:holo:sha256:/.test(m.kappa)) &&
  msgs.every((m, i) => m.seq === i),
  msgs.map((m) => m.text).join(" · "));

// ── 5 · DEDUP — re-ingesting the same rendered message is idempotent (SEC-3) ──
const again = await thread.ingest(MSGS[0]);
ok("idempotent-dedup-no-double-append", again.appended === false && thread.length() === 3, `len=${thread.length()}`);

// ── 6 · L5 — tamper / reorder / drop any message ⇒ verify refuses ──
const tamper = clone(recs); tamper[1]["holstr:payload"].object["schema:text"] = "ship it!"; // one byte
const reorder = clone(recs);[reorder[0], reorder[1]] = [reorder[1], reorder[0]];
const drop = clone(recs); drop.splice(1, 1);
const vT = await makeThread({ genesis, backend: arrayBackend(tamper), now }).verify();
const vR = await makeThread({ genesis, backend: arrayBackend(reorder), now }).verify();
const vD = await makeThread({ genesis, backend: arrayBackend(drop), now }).verify();
ok("history-tamper-reorder-drop-refused",
  vT.ok === false && vR.ok === false && vD.ok === false,
  `tamper@${vT.brokeAt}(${vT.why}) reorder@${vR.brokeAt} drop@${vD.brokeAt}`);

// ── 7 · DURABLE — a fresh thread over the same store recovers the conversation ──
const reopened = makeThread({ genesis, backend: arrayBackend(recs), now });
await reopened.ready();
const vRe = await reopened.verify();
ok("durable-reload-recovers-conversation",
  vRe.ok && reopened.length() === 3 && reopened.view().length === 3 && reopened.head() === recs[2].id,
  `len=${reopened.length()}`);

// ── 8 · ROAM — a peer's longer chain fast-forwards via adopt; tamper refused ──
const backendB = arrayBackend();
const peer = makeThread({ genesis, backend: backendB, now, signer: op });
await peer.adopt(recs);                                   // peer continues OUR chain (shared prefix)
await peer.ingest({ text: "merged from another device", sender: "Me", sentAt: "08:34", chat: "Ilya", source: "web.whatsapp.com" });
const chainB = backendB.dump();
const ff = await thread.adopt(chainB);                    // fast-forward our thread to the peer's head
const tamperedB = clone(chainB); tamperedB[2]["holstr:payload"].object["schema:text"] = "forged";
const refuse = await makeThread({ genesis, backend: arrayBackend(recs), now }).adopt(tamperedB);
ok("roam-fast-forward-adopt-verify-before-trust",
  ff.ok && thread.length() === 4 && thread.head() === chainB[chainB.length - 1].id && refuse.ok === false,
  `ff.len=${thread.length()} refuse=${refuse.why}`);

// ── 9 · INBOX — summarize() yields a faithful unified-inbox row ──
const row = reopened.summarize(META);
ok("inbox-row-faithful",
  row.genesis === genesis && row.platform === "whatsapp" && row.chat === "Ilya" &&
  row.count === 3 && row.lastText === "on it" && row.lastSentAt === "08:33" && row.lastSender === "Ilya" &&
  /^did:holo:sha256:/.test(row.lastKappa),
  JSON.stringify({ count: row.count, last: row.lastText }));

await forget(op.kappa).catch(() => {});

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "GENESIS — a conversation's genesis κ is content-addressed (L2): same platform+chat → same κ, different → different, participant order irrelevant",
    "EVENTS — each captured message becomes a signed, hash-linked event on a per-conversation strand; author = the operator's identity κ; seq 0..n",
    "SCHEMA — each event carries the holo-apps §2.6 header by reuse (Lamport seq, parent prev, author op, collection genesis) + a verifiable signature axis",
    "REDUCE — view() reduces the chain to the ordered bubble list a surface paints; each row re-derives verify-before-trust (drops any that don't)",
    "DEDUP — re-ingesting the same rendered message is idempotent (SEC-3 one κ network-wide); a re-scan never double-appends",
    "L5 — tampering, reordering, or dropping any message makes the whole-history verify() refuse at the break (Law L5 over the sequence)",
    "DURABLE — a fresh thread over the same encrypted store recovers the conversation; length, view, head and verify all hold",
    "ROAM — a peer device's longer chain fast-forwards via adopt under verify-before-adopt; a tampered candidate is refused, local kept",
    "INBOX — summarize() yields a faithful unified-inbox row (platform, chat, last message text/time/sender, count) — the WhatsApp-style list entry",
  ],
  conversation: { genesis, platform: META.platform, chat: META.chat },
  head: thread.head(), length: thread.length(),
  checks, failed: fail,
  authority: "holo-apps §2.6/§2.7/§2.8 · holospaces SEC-1/SEC-3 · Law L1/L2/L5 · RFC 8785 (JCS) · schema.org Conversation/Message",
};
writeFileSync(join(here, "holo-messenger-thread-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Messenger thread witness — a conversation is a collection, a message is an event\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  conversation "${META.chat}" (${META.platform})  genesis ${genesis.slice(-12)}  head ${String(thread.head()).slice(-12)}  events ${thread.length()}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
