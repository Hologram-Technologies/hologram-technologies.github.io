#!/usr/bin/env node
// holo-messenger-roam-witness.mjs — A CONVERSATION FOLLOWS YOU ACROSS DEVICES — proven in pure Node.
//
// Drives the REAL stack: signed conversation chains (holo-messenger-thread over holo-strand, a real
// enrolled principal), the workspace-roam reconcile brain, and thread.adopt — plus a REAL
// BroadcastChannel for genuine cross-context convergence.
//
//   FORWARD   — a device whose chain extends the peer's fast-forwards it (adopt, verify-before-trust)
//   BOTHWAYS  — after the peer appends, the first device fast-forwards the other way (converges)
//   AHEAD     — a stale remote (peer behind us) is local-ahead: we keep ours, push so it catches up
//   DIVERGED  — concurrent appends after a shared ancestor keep BOTH lineages (no destructive merge)
//   REJECTED  — a tampered remote chain is refused (verify-before-trust); local untouched
//   UNRELATED — a different-conversation chain is ignored
//   CHANNEL   — over a real BroadcastChannel, two peers converge a conversation; epidemic self-terminates
//
//   node tools/holo-messenger-roam-witness.mjs
//
// Authority: holo-workspace-roam (reconcile) · holo-strand-admit · holo-messenger-thread (adopt) · SEC-1 · L5.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { conversationGenesis, makeThread } from "../os/usr/lib/holo/holo-messenger-thread.mjs";
import { makeRoamLink } from "../os/usr/lib/holo/holo-messenger-roam.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-23T15:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "roam-tester", passphrase: "correct horse battery" });
const genesis = conversationGenesis({ platform: "whatsapp", chat: "Ilya" });
const M = (text, sentAt) => ({ text, sender: "Ilya", sentAt, chat: "Ilya", source: "web.whatsapp.com" });

// a shared base chain (2 messages) every device starts from
const baseBackend = arrayBackend();
{ const t = makeThread({ genesis, backend: baseBackend, now, signer: op }); await t.ingest(M("base one", "08:00")); await t.ingest(M("base two", "08:01")); }
const base = baseBackend.dump();
const fromBase = async () => { const t = makeThread({ genesis, backend: arrayBackend(), now, signer: op }); await t.adopt(base); return t; };

// ── 1 · FORWARD — A extends the base; B (at base) fast-forwards to A ──
const A = await fromBase(); await A.ingest(M("A-three", "08:02"));        // A: base + 1  (head H3a)
const B = await fromBase();                                              // B: base
const linkA = makeRoamLink({ thread: A, send: () => {} });
const linkB = makeRoamLink({ thread: B, send: () => {} });
const dFF = await linkB.receive(linkA.bundle());
ok("forward-fast-forwards-peer",
  dFF.outcome === "fast-forward" && B.length() === 3 && B.head() === A.head(),
  `${dFF.outcome} B=${B.length()}`);

// ── 2 · BOTHWAYS — B now appends; A fast-forwards the other way ──
await B.ingest(M("B-four", "08:03"));                                    // B: base + A-three + B-four (4)
const dBack = await linkA.receive(linkB.bundle());
ok("converges-both-directions",
  dBack.outcome === "fast-forward" && A.length() === 4 && A.head() === B.head(),
  `${dBack.outcome} A=${A.length()}`);

// ── 3 · AHEAD — a STALE remote (still at base) is local-ahead; we keep ours ──
const stale = await fromBase();                                          // a peer still at base (2)
const dAhead = await linkA.receive(linkA.bundle === null ? null : { genesis, entries: base });
ok("stale-remote-is-local-ahead", dAhead.outcome === "local-ahead" && A.length() === 4, dAhead.outcome);

// ── 4 · DIVERGED — concurrent appends after the shared ancestor keep BOTH lineages ──
const C = await fromBase(); await C.ingest(M("C-three", "09:00"));        // base + C-three
const D = await fromBase(); await D.ingest(M("D-three", "09:00"));        // base + D-three (different)
const linkC = makeRoamLink({ thread: C, send: () => {} });
const cHeadBefore = C.head();
const dDiv = await linkC.receive({ genesis, entries: D.replay() });
ok("concurrent-edits-keep-both-lineages",
  dDiv.outcome === "diverged" && C.head() === cHeadBefore && C.length() === 3 &&
  Array.isArray(dDiv.lineages) && dDiv.lineages.length === 2,
  `${dDiv.outcome} ancestorAt=${dDiv.ancestorAt}`);

// ── 5 · REJECTED — a tampered remote chain is refused; local untouched ──
const tampered = clone(A.replay()); tampered[2]["holstr:payload"].object["schema:text"] = "forged";
const E = await fromBase(); const linkE = makeRoamLink({ thread: E, send: () => {} });
const eHeadBefore = E.head();
const dRej = await linkE.receive({ genesis, entries: tampered });
ok("tampered-remote-refused", dRej.outcome === "rejected" && E.head() === eHeadBefore && E.length() === 2, `${dRej.outcome}: ${dRej.why || ""}`);

// ── 6 · UNRELATED — a different conversation's chain is ignored ──
const otherGenesis = conversationGenesis({ platform: "telegram", chat: "Bob" });
const dUn = await linkE.receive({ genesis: otherGenesis, entries: A.replay() });
ok("unrelated-conversation-ignored", dUn.outcome === "unrelated" && E.length() === 2, dUn.outcome);

// ── 7 · CHANNEL — over a real BroadcastChannel, two peers converge; epidemic self-terminates ──
const NAME = "holo-messenger-roam-witness";
const bcA = new BroadcastChannel(NAME);
const bcB = new BroadcastChannel(NAME);
const P = await fromBase(); await P.ingest(M("P-three", "10:00")); await P.ingest(M("P-four", "10:01"));  // ahead (4)
const Q = await fromBase();                                                                              // base (2)
let adopts = 0;
const converged = new Promise((resolve) => {
  const lQ = makeRoamLink({ thread: Q, onUpdate: () => { adopts++; if (Q.head() === P.head()) resolve(true); }, send: (b) => bcB.postMessage(b) });
  bcB.onmessage = (e) => lQ.receive(e.data);
});
const lP = makeRoamLink({ thread: P, send: (b) => bcA.postMessage(b) });
bcA.onmessage = (e) => lP.receive(e.data);
lP.advertise();                                                          // P announces its chain over the real channel
const arrived = await Promise.race([converged, new Promise((r) => setTimeout(() => r(false), 1500))]);
const adoptsAfter = adopts;
lP.advertise();                                                          // re-advertise after convergence → must be a no-op (in-sync)
await new Promise((r) => setTimeout(r, 100));
bcA.close(); bcB.close();
ok("real-channel-converges-and-terminates",
  arrived === true && Q.length() === 4 && Q.head() === P.head() && adopts === adoptsAfter,
  `Q=${Q.length()} adopts=${adopts}`);

await forget(op.kappa).catch(() => {});

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "FORWARD — a device whose chain strictly extends the peer's fast-forwards it (adopt, verify-before-trust)",
    "BOTHWAYS — after the peer appends, the first device fast-forwards the other way; the conversation converges",
    "AHEAD — a stale remote (behind us) is local-ahead: we keep ours and push so it catches up",
    "DIVERGED — concurrent appends after a shared ancestor keep BOTH lineages (append-only, never a destructive merge)",
    "REJECTED — a tampered remote chain is refused verify-before-trust; the local chain is untouched",
    "UNRELATED — a different conversation's chain is ignored",
    "CHANNEL — over a real BroadcastChannel two peers converge a conversation, and re-advertising after convergence is a no-op (epidemic self-terminates)",
  ],
  genesis, base: base.length,
  checks, failed: fail,
  authority: "holo-workspace-roam (reconcile) · holo-strand-admit · holo-messenger-thread (adopt) · holospaces SEC-1 · Law L5",
};
writeFileSync(join(here, "holo-messenger-roam-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Messenger roam witness — a conversation follows you across devices\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  genesis ${genesis.slice(-12)} · fast-forward · diverged-keeps-both · real BroadcastChannel · self-terminating`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
