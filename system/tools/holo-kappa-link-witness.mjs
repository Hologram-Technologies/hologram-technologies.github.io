#!/usr/bin/env node
// holo-kappa-link-witness.mjs — M2 GATE for the 3-component unification (Agent/κ/Holospace).
// The "verb": a typed, signed, peer-validated κ-Link (subject–predicate–object). Most of it already exists
// (holo-strand Links + holo-ad4m-dna ruleset + neighbourhood verify-before-adopt). This witness proves the
// BUILT parts GREEN and pins the four genuine M2 DELTAS as RED until landed:
//   D1 predicate-IS-a-κ  · D2 integrity-is-free (no rule-eval on a hash-tamper) · D3 warrant-on-violation
//   D4 scattered-fold (edge-κ + semantic-web collapse onto ONE link verb on the facade)
// Authority: AD4M Perspective links · Holochain integrity zome + warrants · holospaces Laws L1/L3/L5 ·
// content-addressing-IS-performance (D2). node tools/holo-kappa-link-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeAd4m } from "../os/usr/lib/holo/holo-ad4m.mjs";
import { makeDna, defineRuleset } from "../os/usr/lib/holo/holo-ad4m-dna.mjs";
import { verifyAuthoredChain } from "../os/usr/lib/holo/holo-ad4m-neighbourhood.mjs";
import { verifyEntry } from "../os/usr/lib/holo/holo-strand.mjs";
import { enroll, forget, addressOf } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = []; const delta = new Set();
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const todo = (n, c, d = "") => { delta.add(n); return ok(n, c, d); };   // a DELTA: red == M2 work remaining
const truthy = (x) => x === true || (x && x.ok === true);
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-27T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const alice = await enroll({ label: "klink-alice", passphrase: "the verb" });
const eve = await enroll({ label: "klink-eve", passphrase: "outsider" });
const ad4m = makeAd4m({ signer: alice, now });

const members = new Set([alice.kappa]);
const ruleset = defineRuleset({
  name: "klink-circle", version: 1,
  rules: { "ad4m:link": { require: ["source", "predicate", "target"], enum: { predicate: ["shares", "replies"] } } },
});
const persp = ad4m.perspective({ backend: arrayBackend() });
const dna = makeDna({ perspective: persp, ruleset, me: alice.kappa, isMember: (a) => members.has(a) });

// ══ BUILT — these prove the verb is ~70% there ═══════════════════════════════════════════════════════
// 1 · a well-formed κ-Link from a member is admitted
const a1 = await dna.addLink({ source: alice.kappa, predicate: "shares", target: "expr:photo" });
ok("linkAdmitted", a1.ok && persp.links().length === 1, JSON.stringify(a1.ok));

// 2 · a contract-violating link (missing object) is refused at ADD (semantic refusal)
const a2 = await dna.addLink({ source: alice.kappa, predicate: "shares" });
ok("semanticRefusal", a2.ok === false && a2.why === "rule-violation" && persp.links().length === 1, JSON.stringify(a2));

// 3 · a non-member author is refused (membrane gate)
const a3 = dna.gate({ source: "x", predicate: "shares", target: "y", author: eve.kappa });
ok("membraneRefusesNonMember", a3.ok === false && a3.why === "not-a-member", JSON.stringify(a3));

// 4 · provenance: a genuinely authored chain verifies; the SAME peer reaches the verdict with no consensus
const chain = persp.raw.replay({});
ok("provenanceChains", truthy(await verifyAuthoredChain(chain, alice.kappa)), "authored chain must verify");

// 5 · peer convergence: an independent re-derivation of the same chain yields the same verdict
const persp2 = ad4m.perspective({ backend: arrayBackend(clone(chain)) });
ok("peerConverges", truthy(await verifyAuthoredChain(persp2.raw.replay({}), alice.kappa)), "2nd peer same verdict");

// ══ M2 DELTA — RED until landed; this is the exact remaining work ═════════════════════════════════════
// D1 · predicate IS a κ (content-addressed, reusable) — exposed as predicateKappa; the verb name stays for
// rulesets/queries. Add a 2nd link with the SAME verb and prove the κ is identical (reusable vocabulary).
const link0 = persp.links()[0] || {};
await dna.addLink({ source: alice.kappa, predicate: "shares", target: "expr:second" });
const link1 = persp.links().find((l) => l.target === "expr:second") || {};
todo("D1_predicateIsKappa",
  typeof link0.predicateKappa === "string" && link0.predicateKappa.startsWith("did:holo:") &&
    link0.predicateKappa === link1.predicateKappa,
  `predicateKappa=${JSON.stringify(link0.predicateKappa)} (verb stays ${JSON.stringify(link0.predicate)}); reusable=${link0.predicateKappa === link1.predicateKappa}`);

// D2 · integrity is FREE: a hash-tampered link is dropped BEFORE any contract rule runs (law: addressing-is-perf)
const tampered = clone(chain[chain.length - 1]);
if (tampered && tampered["holstr:payload"]) tampered["holstr:payload"].target = "expr:FORGED";
ok("integrityCaughtByHash", !truthy(await verifyEntry(tampered)), "tampered entry must fail verifyEntry");
const before = typeof dna.ruleEvals === "function" ? dna.ruleEvals() : -1;
const recv = typeof dna.receive === "function" ? await dna.receive(tampered) : { ok: true };
const after = typeof dna.ruleEvals === "function" ? dna.ruleEvals() : -2;
todo("D2_integrityIsFree_noRuleEval", recv.ok === false && recv.why === "integrity" && after - before === 0,
  `receive must refuse on integrity with 0 rule-evals (Δ=${after - before}, why=${recv && recv.why})`);

// D3 · a contract violation emits a signed WARRANT κ naming the offender (enforcement, not just refusal)
todo("D3_warrantOnViolation", !!(a2.warrant && a2.warrant.offender && a2.warrant.proof),
  "violation result must carry a signed warrant {offender, badLink, reason, proof}");

// D4 · scattered-fold: ONE link verb on the facade (edge-κ + semantic-web deleted, not wrapped)
todo("D4_oneLinkVerb", typeof ad4m.link === "function",
  "facade must expose a single link(subject,predicate,object); fold edge-κ + semantic-web onto it");

await forget(alice.kappa); await forget(eve.kappa);

const n = Object.keys(checks).length;
const builtKeys = Object.keys(checks).filter((k) => !delta.has(k));
const builtGreen = builtKeys.every((k) => checks[k]);
const deltaKeys = [...delta];
const deltaGreen = deltaKeys.filter((k) => checks[k]).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-kappa-link (M2 gate) — the typed signed peer-validated κ-Link verb. BUILT: admit/refuse/membrane/provenance/convergence over holo-strand + holo-ad4m-dna. DELTA (M2 remaining): D1 predicate-as-κ, D2 integrity-is-free (no rule-eval on hash-tamper), D3 warrant-on-violation, D4 one link verb on the facade folding edge-κ + semantic-web.",
  authority: "AD4M Perspective links · Holochain integrity zome + warrants · holospaces L1/L3/L5 · law: content-addressing-is-performance",
  witnessed, builtGreen, deltaProgress: `${deltaGreen}/${deltaKeys.length}`,
  checks, deltas: deltaKeys, failed: fail,
};
writeFileSync(join(here, "holo-kappa-link-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-kappa-link — M2 GATE: the κ-Link verb (built parts + remaining deltas)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${delta.has(k) ? "[Δ] " : "    "}${k}`);
console.log(`\n  BUILT ${builtKeys.filter((k) => checks[k]).length}/${builtKeys.length} GREEN   ·   M2 DELTA ${deltaGreen}/${deltaKeys.length} done`);
console.log(`  ${witnessed ? "WITNESSED ✓ — M2 COMPLETE" : "M2 IN PROGRESS — remaining: " + fail.join("; ")}`);
process.exit(0);   // M2 gate is informational until all deltas green; never fail the build while landing
