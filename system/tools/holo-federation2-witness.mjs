#!/usr/bin/env node
// holo-federation2-witness.mjs — PHASES 2+3 of "Two Sovereigns, One World". Phase 3: Q is a THIRD sovereign
// node (its own makeFront, its own DID) that joins the SAME shared Holospace and participates through the SAME
// verbs as the humans — visible as an Agent "Q", not an ambient service. Phase 2 (live): a contract-violating
// link in the shared space yields a signed WARRANT (M2), and a tampered post does not render across nodes (L5).
// Authority: ADAM Neighbourhood + Social-DNA + warrant · sovereign AI-as-peer · verify-before-adopt. node tools/holo-federation2-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeFront } from "../os/usr/lib/holo/holo-front.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tick = 0; const now = () => `2026-06-27T00:00:${String(tick++).padStart(2, "0")}.000Z`;
const pending = []; const enq = (p) => { if (p && p.then) pending.push(p); return p; };
async function settle() { let n = 0; while (pending.length && n++ < 80) { const b = pending.splice(0); await Promise.all(b); } }

const names = new Map();
const ana = await enroll({ label: "fed2-ana", passphrase: "human one" });
const bob = await enroll({ label: "fed2-bob", passphrase: "human two" });
const q = await enroll({ label: "fed2-q", passphrase: "the local ai" });
names.set(ana.kappa, "Ana"); names.set(bob.kappa, "Bob"); names.set(q.kappa, "Q");

// THREE sovereign nodes on one bus — two humans + Q. Each a full three-noun door (makeFront).
let fA, fB, fQ; const bus = [];
const bcast = (i) => (sid, m) => bus.forEach((w, j) => { if (j !== i) enq(w.web._internal.deliver(sid, m)); });
fA = makeFront({ signer: ana, now, web: { displayName: "Ana", names, transport: { spacePost: bcast(0) } } });
fB = makeFront({ signer: bob, now, web: { displayName: "Bob", names, transport: { spacePost: bcast(1) } } });
fQ = makeFront({ signer: q,   now, web: { displayName: "Q",   names, transport: { spacePost: bcast(2) } } });
bus.push(fA, fB, fQ);

// ── PHASE 3 · Q is a sovereign peer: it joins the shared space and posts; both humans see it AS "Q" ────
await fA.web.open("Plaza"); await fB.web.open("Plaza"); await fQ.web.open("Plaza"); await settle();
await fQ.web.post("Plaza", "Q summarized today's notes for you."); await settle();
const anaView = await fA.web.open("Plaza"); const bobView = await fB.web.open("Plaza"); await settle();
const qPostA = anaView.posts.find((p) => p.text === "Q summarized today's notes for you.");
const qPostB = bobView.posts.find((p) => p.text === "Q summarized today's notes for you.");
ok("qIsSovereignPeer", !!qPostA && qPostA.by === "Q" && !!qPostB && qPostB.by === "Q" && fQ.me() === q.kappa && fQ.me() !== fA.me() && fQ.me() !== fB.me(), JSON.stringify({ ana: qPostA && qPostA.by, bob: qPostB && qPostB.by }));

// ── PHASE 3 · Q participates through the SAME verbs (it reads the shared space and a human reads Q's link) ─
await fA.web.post("Plaza", "thanks Q!"); await settle();
const qView = await fQ.web.open("Plaza"); await settle();
ok("qReadsAndWritesSameVerbs", qView.posts.some((p) => p.text === "thanks Q!" && p.by === "Ana") && typeof fQ.web.post === "function" && typeof fQ.web.open === "function", JSON.stringify(qView.posts.map((p) => p.by)));

// ── PHASE 2 · a contract-violating link in the shared space yields a signed WARRANT κ (M2, live) ───────
const sid = (await fA.web.open("Plaza")).space.id;
const space = fA.web._internal.spacesById.get(sid);
const violation = await space.dna.addLink({ source: ana.kappa, predicate: "posted" });   // missing target → rule-violation
ok("liveWarrantOnViolation", violation.ok === false && violation.why === "rule-violation" && !!violation.warrant && !!violation.warrant.offender && String(violation.warrant.proof).startsWith("did:holo:"), JSON.stringify({ ok: violation.ok, warrant: !!violation.warrant }));

// ── PHASE 2 · a TAMPERED post body does not render across nodes (verify-before-render, L5) ─────────────
const hex = String(qPostB.id).split(":").pop();
const body = fB.web._internal.ad4m.store.get(hex);
if (body) { const t = JSON.parse(JSON.stringify(body)); t["ad4m:data"] = { kind: "note", text: "TAMPERED" }; fB.web._internal.ad4m.store.set(hex, t); }
const afterTamper = await fB.web.open("Plaza"); await settle();
ok("tamperDoesNotRenderAcrossNodes", !afterTamper.posts.some((p) => /TAMPERED/.test(p.text)) && !afterTamper.posts.some((p) => p.id === qPostB.id && p.text === "Q summarized today's notes for you."), JSON.stringify(afterTamper.posts.map((p) => p.text)));

await forget(ana.kappa); await forget(bob.kappa); await forget(q.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-federation2 (Phases 2+3) — Q is a THIRD sovereign node (own DID, own makeFront) that joins the shared Holospace and participates through the same verbs as the humans, visible as Agent 'Q' to both; a contract-violating link yields a signed warrant κ (M2, live); a tampered post does not render across nodes (L5). Sovereign AI-as-peer + live peer-validation, over the three-noun door.",
  authority: "ADAM Neighbourhood + Social-DNA + warrant · sovereign AI-as-peer · verify-before-adopt (L5)",
  witnessed, checks, failed: fail,
};
writeFileSync(join(here, "holo-federation2-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-federation2 — PHASES 2+3: Q a sovereign peer + live warrant + cross-node tamper-refusal\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — three sovereigns, one world; Q is a peer, not a service` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
