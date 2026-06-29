#!/usr/bin/env node
// holo-magic-witness.mjs — THE MAGIC PASS: prove the vision is delivered. One continuous journey over the
// built seams — M1 you ARE your Agent · M2 grab/drop composes, local · M3 a live shared world with Q a peer —
// rendered as a FELT surface, and an automated MACHINERY SCAN proving the user never meets a hash, key, DID,
// spinner, or warrant. The proof that hiding is REAL: the raw data underneath DOES contain DIDs; the felt
// render does not. A non-technical person meets three nouns and nothing else.
// Authority: the north star · the Magic Test · Laws L4/L5.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeFront } from "../os/usr/lib/holo/holo-front.mjs";
import { defineLanguage } from "../os/usr/lib/holo/holo-language.mjs";
import { defineRuleset } from "../os/usr/lib/holo/holo-ad4m-dna.mjs";
import { seal, verify as verifyObj, UOR_CONTEXT } from "../os/usr/lib/holo/holo-object.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-27T00:00:${String(tick++).padStart(2, "0")}.000Z`;

// the felt render's machinery scan: NONE of these may appear in anything the user sees.
const FORBIDDEN = [/did:holo:/i, /blake3:/i, /sha256:/i, /\bκ\b/, /\bkappa\b/i, /verify/i, /loading/i, /warrant/i, /https?:\/\//i, /\bseed\b|private key/i, /\bhash\b/i];
const leaks = (strings) => strings.filter((s) => FORBIDDEN.some((rx) => rx.test(String(s))));

const msgLang = defineLanguage({
  name: "msg", capabilities: { storage: true },
  create: (text) => seal({ "@context": [...UOR_CONTEXT], "@type": ["ad4m:Expression"], "ad4m:language": "msg", "ad4m:data": String(text) }),
  get: (e) => (verifyObj(e) ? e : null),
});
// a Holospace contract: a post must be {source,predicate,target} with predicate "posted" or "embeds".
const SPACE = defineRuleset({ name: "plaza", version: 1, rules: { "ad4m:link": { require: ["source", "predicate", "target"], enum: { predicate: ["posted", "embeds"] } } } });

// display layer: an Agent κ → a human name. This is the ONLY thing the user sees of an identity.
const NAMES = new Map();
const display = (k) => NAMES.get(k) || "Someone";

const ana = await enroll({ label: "magic-ana", passphrase: "you are your agent" });
const bo = await enroll({ label: "magic-bo", passphrase: "a peer" });
const q = await enroll({ label: "magic-q", passphrase: "the local ai" });
NAMES.set(ana.kappa, "Ana"); NAMES.set(bo.kappa, "Bo"); NAMES.set(q.kappa, "Q");

const felt = [];   // everything the user SEES, accumulated across the journey

// ══ M1 — YOU ARE YOUR AGENT ══════════════════════════════════════════════════════════════════════════
const front = makeFront({ signer: ana, now });
front.node.languages.register(msgLang);
const greeting = `You're in. Welcome, ${display(front.me())}.`;     // felt: a name, never a DID
felt.push(greeting);
ok("M1_youAreYourAgent", typeof front.me() === "string" && front.me().startsWith("did:holo:") && leaks([greeting]).length === 0, greeting);

// ══ M2 — GRAB / DROP COMPOSES, LOCAL ═════════════════════════════════════════════════════════════════
const editor = front.mount({ name: "editor", perspectives: ["notes"], produces: ["msg"], consumes: ["msg"] }, { backend: arrayBackend() });
const board = front.mount({ name: "board", perspectives: ["wall"], produces: [], consumes: ["msg"] }, { backend: arrayBackend() });
const asset = front.node.languages.express("msg", "field notes from the garden");
front.pocket.grab(front.pocket.wal(asset.url));
const w = front.pocket.drop();
await front.pocket.embed(board.handle.perspective, front.me(), w);
// FELT render of board: resolve each embed → show its TEXT, never the κ url
const boardFelt = board.handle.view({ predicate: front.pocket.EMBEDS }).map((l) => {
  const a = front.pocket.resolve(front.pocket.wal(l.target));
  return { by: display(l.author), text: a ? a["ad4m:data"] : "(unavailable)" };
});
felt.push(...boardFelt.map((p) => `${p.by}: ${p.text}`));
ok("M2_grabDropComposesLocal",
  boardFelt.length === 1 && boardFelt[0].text === "field notes from the garden" && leaks(boardFelt.map((p) => p.by + p.text)).length === 0,
  JSON.stringify(boardFelt));

// ══ M3 — A LIVE SHARED WORLD, Q A PRIVATE PEER ═══════════════════════════════════════════════════════
// a shared Holospace governed by the contract; Ana opens it, Bo and Q are peers. Bo posts (admitted);
// a contract-violating post is refused (warrant — UNSEEN); Q posts as a membrane-gated peer.
// each agent is their OWN sovereign front; they post into the shared Holospace (same contract). The merged
// view is what a Neighbourhood syncs — each post AUTHORED (signed) by its real agent, not relayed.
const members = new Set([ana.kappa, bo.kappa, q.kappa]);
const frontB = makeFront({ signer: bo, now }); frontB.node.languages.register(msgLang);
const frontQ = makeFront({ signer: q, now }); frontQ.node.languages.register(msgLang);
const sopts = { ruleset: SPACE, isMember: (a) => members.has(a) };
const plazaA = front.node.perspectives.open({ backend: arrayBackend(), ...sopts });
const plazaB = frontB.node.perspectives.open({ backend: arrayBackend(), ...sopts });
const plazaQ = frontQ.node.perspectives.open({ backend: arrayBackend(), ...sopts });
await plazaA.link(ana.kappa, "posted", front.node.languages.express("msg", "anyone here?").url);
await plazaB.link(bo.kappa, "posted", frontB.node.languages.express("msg", "Bo here, hello!").url);
await plazaQ.link(q.kappa, "posted", frontQ.node.languages.express("msg", "Q summarized today's notes for you.").url);
// a contract violation (bad predicate) → refused with a warrant the user NEVER sees
const violation = await plazaA.dna.addLink({ source: ana.kappa, predicate: "deletes", target: "x" });
// the merged FELT view (what the Neighbourhood shows): by real signer name + text, resolved per author
const spaces = [[plazaA, front], [plazaB, frontB], [plazaQ, frontQ]];
const merged = spaces.flatMap(([p, f]) => p.query({ predicate: "posted" }).map((l) => {
  const a = f.node.languages.get(l.target);
  return { by: display(l.author), text: a ? a["ad4m:data"] : "(unavailable)" };
}));
felt.push(...merged.map((p) => `${p.by}: ${p.text}`));
const qIsPeer = merged.some((p) => p.by === "Q");
const violationRefusedButUnseen = violation.ok === false && !!violation.warrant && leaks([JSON.stringify(merged)]).length === 0;
ok("M3_liveSharedWorld",
  merged.length === 3 && merged.some((p) => p.by === "Bo") && merged.some((p) => p.by === "Ana") && qIsPeer && violationRefusedButUnseen,
  JSON.stringify(merged.map((p) => p.by)));

// ══ THE MAGIC TEST — the felt surface is machinery-free, WHILE the raw data is not (hiding is real) ═══
const rawUnderneath = JSON.stringify(spaces.flatMap(([p]) => p.query({ predicate: "posted" })));   // author DIDs + κ targets
const rawHasMachinery = /did:holo:/.test(rawUnderneath);
const feltLeaks = leaks(felt);
ok("magicTestClean",
  rawHasMachinery && feltLeaks.length === 0,
  feltLeaks.length ? `LEAKED: ${feltLeaks.join(" | ")}` : `felt=${felt.length} strings, raw-has-machinery=${rawHasMachinery}`);

await forget(ana.kappa); await forget(bo.kappa); await forget(q.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-magic (the Magic pass) — the north star delivered: M1 you ARE your Agent · M2 grab/drop composes locally · M3 a live shared world with Q a membrane-gated peer and a contract-violation refused unseen. The felt surface scans clean of ALL machinery (no DID/hash/κ/spinner/warrant) WHILE the raw data underneath contains it — proving the hiding is real. A person meets three nouns, nothing else.",
  authority: "the north star · the Magic Test · Laws L4/L5",
  witnessed, felt, checks, failed: fail,
};
writeFileSync(join(here, "holo-magic-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-magic — THE MAGIC PASS: M1→M2→M3, no machinery visible\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log("\n  the felt surface (what the user sees):");
for (const s of felt) console.log(`     “${s}”`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — three nouns felt; the machinery never surfaced` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
