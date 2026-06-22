#!/usr/bin/env node
// holo-strand-rules-witness.mjs — proves P4: VALIDATION RULES AS CHAIN-REFERENCED κ. A ruleset is a
// content-addressed, forkable κ-object; adopting it is an ordered `ruleset` entry on the spine; every
// governed entry is provably validated under the ruleset in force; tampering a rule changes/breaks its κ
// (caught, Law L5). "What counts as valid" becomes an explicit, versioned, provable artifact.
//
// Drives the REAL substrate: holo-object seal/verify for the ruleset κ, holo-strand as the spine, a REAL
// enrolled holo-identity principal signing, holo-strand-rules as the seam under test.
//
// Checks (all must hold):
//   1 rulesetIsContentAddressed — same rules → same κ; any rule change → a different κ (deterministic, forkable).
//   2 conformingChainValidates  — adopt R1, append conforming ingest/audit entries → validateChain ok.
//   3 violationCaught           — an entry missing a required field → validateChain ok=false, names the violation.
//   4 forkGovernsFromAdoption   — adopt a stricter fork mid-chain → later entries judged by it, earlier by R1.
//   5 governingBySeq            — governingRuleset(seq) returns the correct ruleset before/after the fork.
//   6 tamperedRulesetCaught     — mutate an adopted ruleset's rules in the chain → its κ no longer re-derives.
//
// Authority: UOR-ADDR (κ=H(canonical_form)) · IETF RFC 8785 (JCS) · Holochain integrity-zome model ·
// holospaces Laws L1/L2/L5 · rests on #holo-object + #holo-strand. node tools/holo-strand-rules-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { defineRuleset, forkRuleset, adoptRuleset, governingRuleset, validate, validateChain } from "../os/usr/lib/holo/holo-strand-rules.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-22T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "rules-tester", passphrase: "correct horse battery rules" });
const backend = arrayBackend();
const strand = makeStrand({ backend, now, signer: op });

// ── 1 · a ruleset is content-addressed + forkable ────────────────────────────────────────────────────
const R1 = defineRuleset({ name: "base", rules: {
  ingest: { require: ["source", "name"] },
  audit: { require: ["act", "stepup", "level"], enum: { level: ["value", "reveal", "authority", "low"] } },
} });
const R1again = defineRuleset({ name: "base", rules: {
  ingest: { require: ["source", "name"] },
  audit: { require: ["act", "stepup", "level"], enum: { level: ["value", "reveal", "authority", "low"] } },
} });
const Rdiff = defineRuleset({ name: "base", rules: { ingest: { require: ["source"] } } });
ok("rulesetIsContentAddressed",
  /^did:holo:sha256:[0-9a-f]{64}$/.test(R1.id) && R1.id === R1again.id && R1.id !== Rdiff.id,
  `R1=${R1.id.slice(0, 20)} same=${R1.id === R1again.id} diff=${R1.id !== Rdiff.id}`);

// ── 2 · adopt R1, append conforming entries → the chain validates ────────────────────────────────────
await adoptRuleset(strand, R1);
await strand.append({ kind: "ingest", payload: { source: "did:holo:sha256:" + "a".repeat(64), name: "acme.txt" } });
await strand.append({ kind: "audit", payload: { act: "wallet.send", stepup: "did:holo:sha256:" + "b".repeat(64), level: "value" } });
const vc1 = validateChain(strand);
ok("conformingChainValidates", vc1.ok && vc1.govKappaOk && vc1.violations.length === 0, JSON.stringify({ ok: vc1.ok, viol: vc1.violations.length }));

// ── 3 · a violating entry is caught (missing required field) ─────────────────────────────────────────
await strand.append({ kind: "ingest", payload: { name: "no-source.txt" } });   // missing `source`
const vc2 = validateChain(strand);
const badRow = vc2.violations.find((r) => r.violations.includes("missing:source"));
ok("violationCaught", vc2.ok === false && !!badRow, JSON.stringify(vc2.violations));

// ── 4 · fork a stricter ruleset mid-chain; it governs from adoption onward ───────────────────────────
const R2 = forkRuleset(R1, { name: "strict", rules: { ingest: { require: ["source", "name", "view"] } } });   // now also requires `view`
await adoptRuleset(strand, R2);
const noView = await strand.append({ kind: "ingest", payload: { source: "did:holo:sha256:" + "c".repeat(64), name: "x.txt" } });   // ok under R1, FAILS R2 (no view)
const vc3 = validateChain(strand);
const noViewRow = vc3.results.find((r) => r.seq === noView["holstr:seq"]);
ok("forkGovernsFromAdoption",
  R2.id !== R1.id && noViewRow && noViewRow.ruleset === R2.id && noViewRow.ok === false && noViewRow.violations.includes("missing:view"),
  JSON.stringify(noViewRow));

// ── 5 · governingRuleset selects by seq (before vs after the fork) ────────────────────────────────────
const firstIngestSeq = strand.replay({ kind: "ingest" })[0]["holstr:seq"];
ok("governingBySeq",
  governingRuleset(strand, firstIngestSeq).id === R1.id && governingRuleset(strand, noView["holstr:seq"]).id === R2.id,
  `before=${governingRuleset(strand, firstIngestSeq).id === R1.id} after=${governingRuleset(strand, noView["holstr:seq"]).id === R2.id}`);

// ── 6 · tampering an adopted ruleset's rules is caught (κ no longer re-derives) ───────────────────────
const bad = clone(backend.dump());
const ri = bad.findIndex((e) => e["holstr:kind"] === "ruleset");
bad[ri]["holstr:payload"].ruleset.rules.audit = { require: [] };   // weaken the rules without changing the recorded κ
const sBad = makeStrand({ backend: arrayBackend(bad) }); await sBad.ready();   // hydrate (the live window.HoloStrand is always hydrated)
const vcBad = validateChain(sBad);
ok("tamperedRulesetCaught", vcBad.govKappaOk === false && vcBad.ok === false, JSON.stringify({ govKappaOk: vcBad.govKappaOk }));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-strand P4 — VALIDATION RULES AS CHAIN-REFERENCED κ: a ruleset is a content-addressed, forkable κ-object; adoption is an ordered `ruleset` entry on the source chain; every governed entry is provably validated under the ruleset in force; a tampered adopted ruleset stops re-deriving to its recorded κ (Law L5). Holochain's integrity-zome model on the spine — 'what counts as valid' is explicit, versioned, provable, and openly forkable. holo-strand is unchanged; rules ride as ordinary entries and validation is a pure read.",
  authority: "UOR-ADDR (κ=H(canonical_form)) · IETF RFC 8785 (JCS) · Holochain integrity-zome model · holospaces Laws L1/L2/L5 · rests on #holo-object + #holo-strand",
  witnessed,
  covers: witnessed ? ["ruleset-content-addressed", "conforming-validates", "violation-caught", "fork-governs", "governing-by-seq", "tamper-caught"] : [],
  sample: { R1: R1.id, R2: R2.id, head: strand.head() },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-strand-rules-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-strand witness — P4 VALIDATION RULES AS CHAIN-REFERENCED κ (forkable, provable 'what counts as valid')\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  R1 ${R1.id.slice(0, 24)}…  →forked→  R2 ${R2.id.slice(0, 24)}…  (different κ = provable fork)`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  what counts as valid is a forkable κ, and every entry proves which ruleset judged it" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
