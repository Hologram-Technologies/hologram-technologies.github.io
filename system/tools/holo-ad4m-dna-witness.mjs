#!/usr/bin/env node
// holo-ad4m-dna-witness.mjs — AD4M's SOCIAL DNA on κ: the forkable, content-addressed rules that decide what
// counts as a valid Link in a Neighbourhood — Holochain's integrity zome, already on the spine as
// holo-strand-rules. A valid Link is admitted; a rule-violating one is refused at ADD; a non-member's Link is
// refused; an inbound chain with a violating entry is refused at ADOPT; a fork is a new ruleset κ that still
// verifies; governingAt reports which rules were in force at a seq.
//
// Authority: AD4M LinkLanguage validation / Holochain integrity zome · holospaces Laws L1/L3/L5 · reuses
// #holo-strand-rules wholesale. node tools/holo-ad4m-dna-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeAd4m } from "../os/usr/lib/holo/holo-ad4m.mjs";
import { makeDna, LINK_DNA, defineRuleset } from "../os/usr/lib/holo/holo-ad4m-dna.mjs";
import { verify as verifyObj } from "../os/usr/lib/holo/holo-object.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-25T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const alice = await enroll({ label: "dna-alice", passphrase: "rules as data" });
const eve = await enroll({ label: "dna-eve", passphrase: "outsider" });
const ad4m = makeAd4m({ signer: alice, now });

// a closed Neighbourhood: only Alice is a member. Predicate must be one of a small allowed set.
const members = new Set([alice.kappa]);
const ruleset = defineRuleset({
  name: "closed-circle", version: 1,
  rules: { "ad4m:link": { require: ["source", "predicate", "target"], enum: { predicate: ["shares", "replies"] } } },
});
const persp = ad4m.perspective({ backend: arrayBackend() });
const dna = makeDna({ perspective: persp, ruleset, me: alice.kappa, isMember: (a) => members.has(a) });

// ── 1 · a valid Link (member author, allowed predicate, all fields) is admitted ──────────────────────
const r1 = await dna.addLink({ source: alice.kappa, predicate: "shares", target: "expr:photo" });
ok("validLinkAdmitted", r1.ok && persp.links().length === 1, JSON.stringify(r1.ok));

// ── 2 · a rule-violating Link (missing target) is refused at ADD (never reaches the chain) ───────────
const r2 = await dna.addLink({ source: alice.kappa, predicate: "shares" });
ok("missingFieldRefused", r2.ok === false && r2.why === "rule-violation" && persp.links().length === 1, JSON.stringify(r2));

// ── 3 · a disallowed predicate (enum) is refused ─────────────────────────────────────────────────────
const r3 = await dna.addLink({ source: alice.kappa, predicate: "deletes", target: "expr:photo" });
ok("enumViolationRefused", r3.ok === false && r3.violations.some((v) => v.startsWith("enum:predicate")), JSON.stringify(r3.violations));

// ── 4 · a non-member author is refused (authorship gate, not in payload) ─────────────────────────────
const r4 = dna.gate({ source: "x", predicate: "shares", target: "y", author: eve.kappa });
ok("nonMemberRefused", r4.ok === false && r4.why === "not-a-member", JSON.stringify(r4));

// ── 5 · an inbound chain carrying a violating Link is refused at ADOPT ───────────────────────────────
const evilChain = clone(persp.raw.replay({}));                       // a real, verifying chain…
// graft a violating link payload onto a fresh entry shape (kind ad4m:link, bad predicate)
evilChain.push({ ...clone(evilChain[evilChain.length - 1]), "holstr:payload": { source: "a", predicate: "deletes", target: "b" } });
const freshPersp = ad4m.perspective({ backend: arrayBackend() });
const freshDna = makeDna({ perspective: freshPersp, ruleset, me: alice.kappa, isMember: (a) => members.has(a) });
const r5 = await freshDna.adopt(evilChain);
ok("violatingChainRefusedAtAdopt", r5.ok === false && r5.why === "rule-violation", JSON.stringify(r5));

// ── 6 · a fork is a NEW ruleset κ that still re-derives (open, provable divergence) ──────────────────
const forked = dna.fork({ name: "open-circle", rules: { "ad4m:link": { require: ["source", "predicate", "target"], enum: { predicate: ["shares", "replies", "boosts"] } } } });
ok("forkIsNewKappa", forked.ruleset.id !== ruleset.id && verifyObj(forked.ruleset) && forked.ruleset.version === 2, `fork=${String(forked.ruleset.id).slice(-8)}`);

// ── 7 · governingAt reports the ruleset in force, and conformance verifies the whole chain ───────────
const gov = dna.governingAt(persp.links()[0] ? 1 : 0);
const conf = dna.conformance();
ok("governedAndConformant", gov && gov.name === "closed-circle" && conf.ok && conf.govKappaOk, JSON.stringify({ gov: gov && gov.name, conf: conf.ok }));

await forget(alice.kappa); await forget(eve.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-ad4m-dna — AD4M's Social DNA as forkable, content-addressed validation rules (Holochain's integrity zome) on the spine: a ruleset κ adopted onto the Perspective's strand governs every later Link. A valid Link is admitted; rule/enum/membership violations are refused at add AND at adopt (fail-closed); a fork is a new ruleset κ producing a divergent but verifiable Neighbourhood; governingAt + conformance prove which rules validated which act (Law L5).",
  authority: "AD4M LinkLanguage validation / Holochain integrity zome · holospaces Laws L1/L3/L5 · reuses #holo-strand-rules · rests on #holo-ad4m",
  witnessed,
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ad4m-dna-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ad4m SOCIAL DNA witness — forkable, content-addressed rules govern a Neighbourhood\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
