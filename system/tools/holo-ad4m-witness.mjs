#!/usr/bin/env node
// holo-ad4m-witness.mjs — the FACADE (holo-ad4m.mjs): Coasys/AD4M's meta-ontology as thin views over the
// substrate. makeAd4m({signer, store, now}) gives an Agent (me), Expressions (createExpression/getExpression
// over a content-addressed store, re-verified on read), Languages (registerLanguage — swappable resolvers),
// and Perspectives (a holo-strand of signed Link entries). No new primitive: every guarantee is the module
// it rests on. This drives the REAL substrate with a REAL enrolled principal as the Agent.
//
// Authority: AD4M core ontology (docs.ad4m.dev) · holospaces Laws L1 (κ=H(content)) · L2 (one wire) · L3
// (composition) · L4 (one hasher — a Language never re-hashes) · L5 (re-derive, fail-closed).
// node tools/holo-ad4m-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeAd4m, expressionBody } from "../os/usr/lib/holo/holo-ad4m.mjs";
import { verify as verifyObj } from "../os/usr/lib/holo/holo-object.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-25T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "ad4m-agent", passphrase: "sovereign by content address" });
const store = new Map();
const ad4m = makeAd4m({ signer: op, store, now });

// ── 1 · Agent: me() is the operator DID ──────────────────────────────────────────────────────────────
ok("agentMe", ad4m.me() === op.kappa && /^did:holo:sha256:/.test(ad4m.me()), `me=${String(ad4m.me()).slice(0, 24)}…`);

// ── 2 · Expression: createExpression round-trips via getExpression (resolve + verify) ────────────────
const { url, expr } = ad4m.createExpression("literal", { title: "Wise Web", body: "cohere without a server" });
const got = ad4m.getExpression(url);
ok("expressionRoundTrip", got && got.id === url && got["ad4m:data"].title === "Wise Web" && verifyObj(got), `url=${String(url).slice(0, 24)}…`);

// ── 3 · L5: a tampered stored Expression fails closed on read ────────────────────────────────────────
const evil = new Map([[url.split(":").pop(), { ...clone(expr), "ad4m:data": { title: "Hijacked" } }]]);
const evilAd4m = makeAd4m({ signer: op, store: evil, now });
ok("tamperedExpressionRefused", evilAd4m.getExpression(url) === null, "mutated value must not re-derive to its url");

// ── 4 · Perspective: addLink then links() returns it, authored by the Agent ──────────────────────────
const persp = ad4m.perspective({ backend: arrayBackend() });
const l1 = await persp.addLink({ source: ad4m.me(), predicate: "authored", target: url });
const l2 = await persp.addLink({ source: ad4m.me(), predicate: "likes", target: url });
const all = persp.links();
ok("addAndListLinks", all.length === 2 && all.some((l) => l.kappa === l1.kappa) && l1.author === op.kappa, JSON.stringify(all.map((l) => l.predicate)));

// ── 5 · query by predicate filters the graph ─────────────────────────────────────────────────────────
const liked = persp.links({ predicate: "likes" });
ok("queryByPredicate", liked.length === 1 && liked[0].kappa === l2.kappa, JSON.stringify(liked.map((l) => l.predicate)));

// ── 6 · removeLink tombstones it (drops from links) but the chain still verifies (append-only) ───────
await persp.removeLink(l2.kappa);
const afterRemove = persp.links();
const vAfter = await persp.verify();
ok("removeLinkTombstone", afterRemove.length === 1 && afterRemove[0].kappa === l1.kappa && vAfter.ok, JSON.stringify({ n: afterRemove.length, v: vAfter.ok }));

// ── 7 · reorder the Perspective's entries ⇒ verify refuses (L5 over the sequence) ────────────────────
const dumped = arrayBackend(); await persp.raw.verify(); // ensure persisted
const persp2backend = arrayBackend();
const persp2 = ad4m.perspective({ backend: persp2backend });
await persp2.addLink({ source: "a", predicate: "p", target: "b" });
await persp2.addLink({ source: "b", predicate: "p", target: "c" });
const reordered = clone(persp2backend.dump()); [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
const persp3 = ad4m.perspective({ backend: arrayBackend(reordered) });
await persp3.ready();
const vReorder = await persp3.verify();
ok("reorderRefused", vReorder.ok === false, JSON.stringify(vReorder));

// ── 8 · L4 — a Language never re-hashes: a SECOND Language producing byte-identical content yields the
//        SAME κ. The address comes from CONTENT (one hasher), not from which code path sealed it. ──────
ad4m.registerLanguage({ name: "literal-clone", create: (data) => expressionBody({ language: "literal", data }), get: (e) => (verifyObj(e) ? e : null) });
const a = ad4m.createExpression("literal", { x: 1 });
const b = ad4m.createExpression("literal-clone", { x: 1 });
ok("languageSwapZeroDiff", a.url === b.url, `a=${String(a.url).slice(-8)} b=${String(b.url).slice(-8)}`);

// ── 9 · idempotent content-addressing: the same (language, data) always yields the same url ──────────
const c1 = ad4m.createExpression("literal", { same: true });
const c2 = ad4m.createExpression("literal", { same: true });
ok("idempotentExpression", c1.url === c2.url, `${String(c1.url).slice(-8)} == ${String(c2.url).slice(-8)}`);

// ── 10 · Perspective head advances per append (the strand's hash-linked spine) ───────────────────────
const hb = arrayBackend(); const hp = ad4m.perspective({ backend: hb });
const before = hp.head();
const hl = await hp.addLink({ source: "s", predicate: "p", target: "t" });
ok("headAdvances", before === null && hp.head() === hl.kappa, `head=${String(hp.head()).slice(-8)}`);

// ── 11 · an unknown Language fails closed ────────────────────────────────────────────────────────────
let threw = false; try { ad4m.createExpression("no-such-lang", {}); } catch (e) { threw = true; }
ok("unknownLanguageRefused", threw, "createExpression must throw on an unregistered Language");

// ── 12 · durable reload: a fresh Perspective over the same backend recovers the graph ────────────────
const durBackend = arrayBackend();
const dp = ad4m.perspective({ backend: durBackend });
await dp.addLink({ source: "x", predicate: "knows", target: "y" });
const dp2 = ad4m.perspective({ backend: durBackend });
await dp2.ready();
const recovered = dp2.links();
const vRec = await dp2.verify();
ok("durableReload", recovered.length === 1 && recovered[0].predicate === "knows" && vRec.ok, JSON.stringify({ n: recovered.length, v: vRec.ok }));

await forget(op.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-ad4m — Coasys/AD4M's agent-centric meta-ontology as a thin facade over the κ substrate: Agent (operator κ), Expression (sealed UOR value resolved + re-verified from a content store), Language (swappable {create,get} resolver that never re-hashes — Law L4), Perspective (a holo-strand of signed Link triples whose head κ attests the whole graph — Law L5). No daemon, no conductor: the substrate is the executor.",
  authority: "AD4M core ontology (docs.ad4m.dev) · holospaces Laws L1/L2/L3/L4/L5 · rests on #holo-object + #holo-identity + #holo-strand",
  witnessed,
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ad4m-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ad4m FACADE witness — Agent · Expression · Language · Perspective on the κ substrate\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
