#!/usr/bin/env node
// holo-govern-witness.mjs — the GOVERN verb as ONE registry, tested THOROUGHLY. GOVERN is the CONJUNCTION of
// validators (integrity ∧ rules ∧ membership ∧ …), run cheapest-first so integrity is FREE: a tampered subject
// is dropped before any semantic rule runs. Proves: one interface, all-pass, each refusal path, warrants,
// integrity-is-free ordering, determinism (consensus-free), monotonic conjunction, capability resolution.
// Authority: Holochain validation / ADAM Social-DNA · integrity-is-free law · the grammar's GOVERN verb.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeGovernors, defineValidator, warrantFor, GOVERN_CAPS } from "../os/usr/lib/holo/holo-govern.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// the three standard validators (the real GOVERN dimensions): integrity (free), rules (Social-DNA), membership.
const members = new Set(["did:holo:sha256:ana", "did:holo:sha256:bo"]);
const ALLOWED = ["posted", "embeds"];
const integrity = defineValidator({ name: "integrity", capabilities: { integrity: true }, validate: (s) => (s && s.integrityOk !== false ? { ok: true } : { ok: false, why: "integrity" }) });
const rules = defineValidator({ name: "rules", capabilities: { rules: true }, validate: async (s) => (ALLOWED.includes(s.predicate) ? { ok: true } : { ok: false, why: "rule-violation", warrant: await warrantFor(s, "rule-violation", "rules") }) });
const membership = defineValidator({ name: "membership", capabilities: { membership: true }, validate: (s) => (members.has(s.author) ? { ok: true } : { ok: false, why: "not-a-member" }) });

const good = { author: "did:holo:sha256:ana", predicate: "posted", integrityOk: true };
const tampered = { author: "did:holo:sha256:ana", predicate: "posted", integrityOk: false };
const badRule = { author: "did:holo:sha256:ana", predicate: "deletes", integrityOk: true };
const nonMember = { author: "did:holo:sha256:eve", predicate: "posted", integrityOk: true };

const gov = makeGovernors();
gov.register(rules); gov.register(membership); gov.register(integrity);   // registered out of cost order on purpose

// ── 1 · many validators, ONE interface ────────────────────────────────────────────────────────────────
ok("manyValidatorsOneInterface", gov.size() === 3 && gov.names().every((n) => typeof gov.byName(n).validate === "function"), gov.names().join(","));

// ── 2 · a legal subject passes the CONJUNCTION (all validators) ───────────────────────────────────────
const vGood = await gov.validateAll(good);
ok("conjunctionAllPass", vGood.ok && vGood.ran.length === 3, JSON.stringify(vGood.ran));

// ── 3 · cheapest-first ordering: integrity runs FIRST regardless of registration order ────────────────
ok("cheapestFirstOrdering", vGood.ran[0] === "integrity", `ran=${vGood.ran.join(">")}`);

// ── 4 · integrity is FREE: a tampered subject is refused by integrity with ZERO semantic rule-evals ───
const vTamper = await gov.validateAll(tampered);
ok("integrityIsFree", vTamper.ok === false && vTamper.by === "integrity" && vTamper.ruleEvals === 0 && vTamper.ran.length === 1, JSON.stringify({ by: vTamper.by, ruleEvals: vTamper.ruleEvals, ran: vTamper.ran }));

// ── 5 · a Social-DNA rule violation is refused, with a signed warrant ─────────────────────────────────
const vRule = await gov.validateAll(badRule);
ok("rulesRefusedWithWarrant", vRule.ok === false && vRule.by === "rules" && !!vRule.warrant && vRule.warrant.proof.startsWith("did:holo:") && vRule.warrant.offender === badRule.author, JSON.stringify({ by: vRule.by, proof: !!vRule.warrant }));

// ── 6 · a non-member is refused by membership ─────────────────────────────────────────────────────────
const vMember = await gov.validateAll(nonMember);
ok("membershipRefused", vMember.ok === false && vMember.by === "membership" && !!vMember.warrant, JSON.stringify({ by: vMember.by }));

// ── 7 · DETERMINISM (consensus-free): the same subject yields the SAME verdict every time ─────────────
const r1 = await gov.validateAll(badRule), r2 = await gov.validateAll(badRule);
ok("deterministicVerdict", r1.ok === r2.ok && r1.by === r2.by && r1.warrant.proof === r2.warrant.proof, "same input ⇒ same verdict + same warrant κ");

// ── 8 · MONOTONIC conjunction: adding a stricter validator can only REJECT more, never accept more ────
// embedsSubj is ACCEPTED by the base 3 (embeds is allowed, ana is a member); a stricter validator that bans
// "embeds" must then REJECT it — proving a new validator only ever subtracts from the accepted set.
const embedsSubj = { author: "did:holo:sha256:ana", predicate: "embeds", integrityOk: true };
const baseAccepts = await gov.validateAll(embedsSubj);
const gov2 = makeGovernors(); gov2.register(integrity); gov2.register(rules); gov2.register(membership);
gov2.register(defineValidator({ name: "noEmbeds", capabilities: { rules: true }, validate: (s) => (s.predicate === "embeds" ? { ok: false, why: "embeds-banned" } : { ok: true }) }));
const stillGood = await gov2.validateAll(good);          // good (predicate "posted") still passes
const nowRejected = await gov2.validateAll(embedsSubj);   // base accepted it; the stricter validator rejects it
ok("monotonicConjunction", baseAccepts.ok === true && stillGood.ok === true && nowRejected.ok === false && nowRejected.by === "noEmbeds", JSON.stringify({ baseAccepts: baseAccepts.ok, stillGood: stillGood.ok, nowRejected: nowRejected.by }));

// ── 9 · the registry resolves by capability ───────────────────────────────────────────────────────────
const cap = (c) => gov.byCapability(c).map((V) => V.name);
ok("resolvesByCapability", cap("integrity").includes("integrity") && cap("rules").includes("rules") && cap("membership").includes("membership") && GOVERN_CAPS.every((c) => gov.coveredCapabilities().includes(c) || c === "provenance"), JSON.stringify(gov.coveredCapabilities()));

// ── 10 · a Validator with no validate() is refused (contract enforced) ────────────────────────────────
let contractHeld = false;
try { defineValidator({ name: "broken", capabilities: { rules: true } }); } catch { contractHeld = true; }
ok("validatorContractEnforced", contractHeld, "a Validator without validate() must throw");

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-govern (the GOVERN verb) — the many checks (integrity/rules/membership/provenance) as ONE registry behind validate(subject)->verdict. GOVERN is their CONJUNCTION, run cheapest-first so integrity is free (a tampered subject is dropped with zero semantic rule-evals); violations carry a content-addressed warrant; verdicts are deterministic (consensus-free); the conjunction is monotonic (a stricter validator only rejects more). The GOVERN sibling of holo-language (WRAP) and holo-transport (MOVE).",
  authority: "Holochain validation / ADAM Social-DNA · integrity-is-free law · the grammar's GOVERN verb",
  witnessed, checks, failed: fail,
};
writeFileSync(join(here, "holo-govern-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-govern — the GOVERN verb as ONE registry (conjunction, integrity-free, thorough)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — validators unified behind validate()->verdict` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
