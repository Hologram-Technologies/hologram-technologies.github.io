#!/usr/bin/env node
// holo-holowhat-reducer-p4-witness.mjs — P4: merge holowhat's RICHER reducer onto OUR signed events.
// Our conversation events (each message minted to a self-verifying κ, authored by the operator κ, ordered
// by the strand's Lamport clock) are fed through holowhat's REAL messengerReducer (vendored, run verbatim).
// It folds them into a projection with reactions, edits (author-gated), replies and thread hierarchy — the
// affordances our WhatsApp-familiar surface needs, on top of our signed + epoch-sealed substrate.
//
//   MESSAGES — our message κ + operator author + Lamport clock project as messages with bodies
//   REACTION — a reaction event aggregates {symbol,count,authors} onto the target message
//   EDIT     — an edit by the ORIGINAL author updates the body + records edit history (others refused)
//   REPLY    — a reply (parentId) is threaded under its parent; roots exclude replies
//
//   node tools/holo-holowhat-reducer-p4-witness.mjs
//
// Authority: holowhat messengerReducer (real, vendored) · holo-messenger-thread (signed events) ·
//   holo-identity (operator author κ) · holospaces §2.6 (events) · Law L1.

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { conversationGenesis, makeThread } from "../os/usr/lib/holo/holo-messenger-thread.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REDUCER = join(here, "..", "..", "..", "_vendor/holowhat/crates/holospaces-web/web/assets/scripts/holo-messenger.js");
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// import holowhat's REAL reducer (verbatim, vendored)
const { messengerReducer } = await import(pathToFileURL(REDUCER).href);

// our signed conversation → events in holowhat's {id, author, clock, kind, payload} shape
let tick = 0; const now = () => `2026-06-23T17:00:${String(tick++).padStart(2, "0")}.000Z`;
const arrayBackend = () => { let s = []; return { load: async () => JSON.parse(JSON.stringify(s)), save: async (r) => { s = JSON.parse(JSON.stringify(r)); } }; };
const op = await enroll({ label: "p4-tester", passphrase: "correct horse battery" });
const other = await enroll({ label: "p4-other", passphrase: "different secret entirely" });
const thread = makeThread({ genesis: conversationGenesis({ platform: "whatsapp", chat: "Ilya" }), backend: arrayBackend(), now, signer: op });
const m1 = await thread.ingest({ text: "the future is light", sender: "Ilya", sentAt: "08:00", chat: "Ilya", source: "web.whatsapp.com" });
const m2 = await thread.ingest({ text: "ship it", sender: "Ilya", sentAt: "08:01", chat: "Ilya", source: "web.whatsapp.com" });

const events = [
  { id: m1.kappa, author: op.kappa, clock: 0, kind: "message", payload: { body: "the future is light", timestamp: 1 } },
  { id: m2.kappa, author: op.kappa, clock: 1, kind: "message", payload: { body: "ship it", timestamp: 2 } },
  { id: "evt:react:1", author: other.kappa, clock: 2, kind: "reaction", payload: { target: m1.kappa, symbol: "🚀" } },
  { id: "evt:edit:1", author: op.kappa, clock: 3, kind: "edit", payload: { target: m1.kappa, body: "the future is light — photonics" } },
  { id: "evt:edit:forged", author: other.kappa, clock: 4, kind: "edit", payload: { target: m1.kappa, body: "hijacked" } }, // NOT the author → ignored
  { id: "evt:reply:1", author: other.kappa, clock: 5, kind: "message", payload: { body: "on it", parentId: m1.kappa } },
];

const proj = messengerReducer(events);
const byId = new Map(proj.messages.map((m) => [m.id, m]));
const M1 = byId.get(m1.kappa), reply = byId.get("evt:reply:1");

// ── 1 · MESSAGES — our κ + author + clock project as messages ──
ok("our-events-project-as-messages",
  byId.has(m1.kappa) && byId.has(m2.kappa) && M1.author === op.kappa && M1.clock === 0 && byId.get(m2.kappa).body === "ship it",
  `${proj.messages.length} messages`);

// ── 2 · REACTION — aggregated {symbol,count,authors} on the target ──
const rx = (M1.reactions || []).find((r) => r.symbol === "🚀");
ok("reaction-aggregates-on-target", !!rx && rx.count === 1 && rx.authors.includes(other.kappa), JSON.stringify(M1.reactions));

// ── 3 · EDIT — original author edits body + history; a non-author edit is refused ──
ok("edit-by-author-only",
  M1.body === "the future is light — photonics" && M1.edits.length === 1 && M1.edits[0].id === "evt:edit:1" &&
  M1.body !== "hijacked",
  `body="${M1.body}" edits=${M1.edits.length}`);

// ── 4 · REPLY — threaded under its parent; roots exclude replies ──
ok("reply-threaded-under-parent",
  reply && reply.parentId === m1.kappa && M1.replies.includes("evt:reply:1") &&
  proj.rootMessages.includes(m1.kappa) && proj.rootMessages.includes(m2.kappa) && !proj.rootMessages.includes("evt:reply:1"),
  `roots=${proj.rootMessages.length}`);

await forget(op.kappa).catch(() => {}); await forget(other.kappa).catch(() => {});

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "MESSAGES — our self-verifying message κ, authored by the operator κ and ordered by the strand Lamport clock, project as messages with bodies through holowhat's real messengerReducer",
    "REACTION — a reaction event aggregates {symbol,count,authors} onto the target message",
    "EDIT — an edit by the original author updates the visible body and records edit history; a non-author edit is refused (author-gated)",
    "REPLY — a reply (parentId) is threaded under its parent; root messages exclude replies",
  ],
  messages: proj.messages.length, roots: proj.rootMessages.length,
  checks, failed: fail,
  authority: "holowhat messengerReducer (real, vendored) · holo-messenger-thread (signed §2.6 events) · holo-identity · Law L1",
};
writeFileSync(join(here, "holo-holowhat-reducer-p4-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo × holowhat P4 — our signed events through holowhat's real reducer (reactions/edits/replies)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${proj.messages.length} messages · ${proj.rootMessages.length} roots · reactions/edits/replies projected from OUR signed events`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
