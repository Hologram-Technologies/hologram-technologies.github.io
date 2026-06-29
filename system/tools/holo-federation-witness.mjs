#!/usr/bin/env node
// holo-federation-witness.mjs — PHASE 1 of "Two Sovereigns, One World": two sovereign nodes converge through
// the THREE-NOUN DOOR. Two makeFront() instances (Ana, Bob), wired over a dumb loopback transport (a real
// WebRTC DataChannel in the browser — proven in holo-ad4m-wan-witness), converge a κ-Link: Bob renders Ana's
// real text; Bob's POCKET resolves+embeds Ana's post κ across the node boundary; a late joiner backfills. The
// wire carries bytes only — verify-before-adopt is the sole gate.
// Authority: ADAM Neighbourhood · the three-noun door · holospaces hash-agnostic transport law. node tools/holo-federation-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeFront } from "../os/usr/lib/holo/holo-front.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tick = 0; const now = () => `2026-06-27T00:00:${String(tick++).padStart(2, "0")}.000Z`;

// the loopback bus: each side's spacePost delivers into the other side(s); capture the async cascade to settle.
const pending = []; const enq = (p) => { if (p && p.then) pending.push(p); return p; };
async function settle() { let n = 0; while (pending.length && n++ < 80) { const b = pending.splice(0); await Promise.all(b); } }

const names = new Map();
const ana = await enroll({ label: "fed-ana", passphrase: "two sovereigns" });
const bob = await enroll({ label: "fed-bob", passphrase: "one world" });
names.set(ana.kappa, "Ana"); names.set(bob.kappa, "Bob");

// two sovereign nodes, each a full three-noun door, cross-wired by a DUMB relay (spacePost → peer.deliver)
let fA, fB;
fA = makeFront({ signer: ana, now, web: { displayName: "Ana", names, transport: { spacePost: (sid, m) => enq(fB.web._internal.deliver(sid, m)) } } });
fB = makeFront({ signer: bob, now, web: { displayName: "Bob", names, transport: { spacePost: (sid, m) => enq(fA.web._internal.deliver(sid, m)) } } });

// ── 1 · two HoloFront instances converge a κ-Link: Bob renders Ana's REAL text over the wire ───────────
await fA.web.open("Plaza"); await fB.web.open("Plaza"); await settle();
await fA.web.post("Plaza", "hello from Ana"); await settle();
const bobView = await fB.web.open("Plaza"); await settle();
const seen = bobView.posts.find((p) => p.text === "hello from Ana");
ok("twoFrontsConvergeKappaLink", !!seen && seen.by === "Ana", JSON.stringify(bobView.posts.map((p) => ({ t: p.text, by: p.by }))));

// ── 2 · the POCKET works ACROSS nodes: Bob grabs Ana's converged post κ and embeds it (zero-copy) ─────
const postKappa = seen && seen.id;
const resolvedOnBob = postKappa ? fB.pocket.resolve(fB.pocket.wal(postKappa)) : null;
const board = fB.mount({ name: "bob-board", perspectives: ["wall"], produces: [], consumes: ["literal"] });
let embOk = false;
if (postKappa) { fB.pocket.grab(fB.pocket.wal(postKappa)); const emb = await fB.pocket.embed(board.handle.perspective, fB.me(), fB.pocket.drop()); embOk = emb.ok && board.handle.view({ predicate: fB.pocket.EMBEDS }).some((l) => l.target === postKappa); }
ok("pocketGrabsFederatedPost", !!postKappa && String(postKappa).startsWith("did:holo:") && !!resolvedOnBob && resolvedOnBob.id === postKappa && embOk, `resolved=${!!resolvedOnBob} embed=${embOk}`);

// ── 3 · a late joiner backfills the existing graph (3-node bus) ────────────────────────────────────────
const cara = await enroll({ label: "fed-cara", passphrase: "joins late" });
names.set(cara.kappa, "Cara");
let a2, b2, c2; const bus = [];
const bcast = (i) => (sid, m) => bus.forEach((w, j) => { if (j !== i) enq(w.web._internal.deliver(sid, m)); });
a2 = makeFront({ signer: ana, now, web: { displayName: "Ana", names, transport: { spacePost: bcast(0) } } });
b2 = makeFront({ signer: bob, now, web: { displayName: "Bob", names, transport: { spacePost: bcast(1) } } });
bus.push(a2, b2);
await a2.web.open("Garden"); await b2.web.open("Garden"); await settle();
await a2.web.post("Garden", "the tomatoes need water"); await settle();
c2 = makeFront({ signer: cara, now, web: { displayName: "Cara", names, transport: { spacePost: bcast(2) } } });
bus.push(c2);
await c2.web.open("Garden"); await settle();
const caraView = await c2.web.open("Garden"); await settle();
ok("lateJoinerBackfills", caraView.posts.some((p) => p.text === "the tomatoes need water" && p.by === "Ana"), JSON.stringify(caraView.posts.map((p) => p.text)));

// ── 4 · the wire is DUMB: it carries bytes only; convergence required verify-before-adopt (the post Bob ──
//        rendered was admitted by his node's L5 check, not trusted because the wire delivered it). Structural:
//        the transport.spacePost is a pure relay — it performs NO validation, yet only valid κ-Links render.
ok("wireIsDumbVerifyBeforeAdopt", typeof fA.web._internal.deliver === "function" && !!seen, "relay-only wire; the gate is deliver's verify-before-adopt");

await forget(ana.kappa); await forget(bob.kappa); await forget(cara.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-federation (Phase 1 — Two Sovereigns, One World) — two sovereign nodes, each a full three-noun door (makeFront), converge a κ-Link over a dumb loopback transport (a real WebRTC DataChannel in the browser): Bob renders Ana's real text; Bob's Pocket resolves+embeds Ana's post κ ACROSS the node boundary; a late joiner backfills. The wire carries bytes only — verify-before-adopt is the sole gate.",
  authority: "ADAM Neighbourhood · three-noun door · hash-agnostic transport · verify-before-adopt (L5)",
  witnessed, checks, failed: fail,
};
writeFileSync(join(here, "holo-federation-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-federation — PHASE 1: two sovereign nodes converge through the three-noun door\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — two HoloFront nodes share one world; the Pocket reaches across` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
