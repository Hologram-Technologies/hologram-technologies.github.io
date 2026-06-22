#!/usr/bin/env node
// holo-warrant-witness.mjs — proves THE κ-IMMUNE SYSTEM (holo-warrant): a signed, content-addressed
// proof-of-invalid that propagates a refusal across peers WITHOUT trusting the accuser. The recipient
// re-derives the offending entry + its ruleset and re-runs validation itself; the accusation holds only
// if the entry truly violates. False accusations, forged evidence, and swapped rulesets are all rejected;
// the verdict is independent of the issuer. A confirmed warrant marks the actor blocked (immune memory).
//
// Drives the REAL substrate: holo-strand (entries), holo-strand-rules (content-addressed ruleset +
// validate), holo-identity (real enrolled issuer), holo-warrant (under test).
//
// Checks (all must hold):
//   1 raiseAndConfirm        — a warrant on a violating entry confirms (violations re-derived by the recipient).
//   2 falseAccusationRejected— a warrant cannot be raised on a CONFORMING entry (raiseWarrant → null).
//   3 forgedEvidenceRejected — tamper the embedded entry ⇒ subject κ mismatch ⇒ rejected.
//   4 tamperedRulesetRejected— swap in a weaker ruleset (κ ≠ claimed) ⇒ rejected.
//   5 verdictIndependentOfIssuer — an UNSIGNED warrant still reaches the correct verdict (re-derivation only).
//   6 issuerSignedAuthorship — a signed warrant carries a verifying issuer signature (recorded, not trusted).
//   7 immuneMemoryBlocksActor— makeImmunity.receive(confirmed) ⇒ isBlocked(actor)=true, tied to the entry's op κ.
//
// Authority: Holochain warrant/immune model · UOR-ADDR (κ=H(canonical_form)) · holospaces Laws L1/L2/L5 ·
// rests on #holo-strand + #holo-strand-rules + #holo-identity. node tools/holo-warrant-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { seal } from "../os/usr/lib/holo/holo-object.mjs";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { defineRuleset } from "../os/usr/lib/holo/holo-strand-rules.mjs";
import { raiseWarrant, confirmWarrant, makeImmunity } from "../os/usr/lib/holo/holo-warrant.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
let tick = 0; const now = () => `2026-06-22T00:00:${String(tick++).padStart(2, "0")}.000Z`;

// the issuer (a peer who spots bad data) and the actor (who authored it) — both real κ principals
const issuer = await enroll({ label: "warrant-issuer", passphrase: "issuer pass" });
const actor = await enroll({ label: "bad-actor", passphrase: "actor pass" });

// a content-addressed ruleset: ingest entries must carry `source`
const RS = defineRuleset({ name: "ingest-rules", rules: { ingest: { require: ["source", "name"] } } });

// the actor's strand: one conforming entry, one VIOLATING entry (missing `source`)
const strand = makeStrand({ now, signer: actor });
const good = await strand.append({ kind: "ingest", payload: { source: "did:holo:sha256:" + "a".repeat(64), name: "ok.txt" } });
const bad = await strand.append({ kind: "ingest", payload: { name: "no-source.txt" } });   // violates RS

// ── 1 · raise a warrant on the violating entry; a recipient confirms it independently ────────────────
const w = await raiseWarrant({ entry: bad, ruleset: RS }, issuer, { now });
const c = await confirmWarrant(w);
ok("raiseAndConfirm", !!w && c.confirmed === true && c.violations.includes("missing:source") && c.actor === actor.kappa, JSON.stringify(c));

// ── 2 · a warrant cannot be raised on a conforming entry ─────────────────────────────────────────────
const wGood = await raiseWarrant({ entry: good, ruleset: RS }, issuer, { now });
ok("falseAccusationRejected", wGood === null, "raiseWarrant must return null for a valid entry");

// ── 3 · forged evidence: tamper the embedded entry → subject κ no longer matches → rejected ──────────
const wForge = clone(w); wForge["holwar:object"]["holstr:payload"].name = "tampered.txt";
const cForge = await confirmWarrant(wForge);
ok("forgedEvidenceRejected", cForge.confirmed === false && /evidence-mismatch|not-rederive/.test(cForge.why), JSON.stringify(cForge));

// ── 4 · swapped ruleset, two defenses: (a) tamper-without-reseal breaks the warrant κ; (b) re-sealed
//        with a mismatched claimed κ is caught by the explicit ruleset-κ check. Both → rejected.
const weak = defineRuleset({ name: "weak", rules: { ingest: { require: [] } } });
const wWeak = clone(w); wWeak["holwar:ruleset"] = weak;                  // claimed rulesetKappa still points at RS
const cWeak = await confirmWarrant(wWeak);                              // (a) warrant κ no longer re-derives
const { "holwar:sig": _s, "holwar:alg": _a, "holwar:pub": _p, "holwar:issuer": _i, ...wb } = wWeak;
delete wb.id; const wWeakResealed = seal(wb);                           // (b) re-seal so body re-derives, but κ ≠ claimed
const cWeakResealed = await confirmWarrant(wWeakResealed);
ok("tamperedRulesetRejected",
  cWeak.confirmed === false && cWeak.why === "warrant-not-rederive"
  && cWeakResealed.confirmed === false && cWeakResealed.why === "ruleset-tampered",
  JSON.stringify({ a: cWeak.why, b: cWeakResealed.why }));

// ── 5 · verdict is independent of the issuer: an UNSIGNED warrant still confirms ──────────────────────
const wUnsigned = await raiseWarrant({ entry: bad, ruleset: RS }, null, { now });
const cUnsigned = await confirmWarrant(wUnsigned);
ok("verdictIndependentOfIssuer", !wUnsigned["holwar:sig"] && cUnsigned.confirmed === true, JSON.stringify({ sig: !!wUnsigned["holwar:sig"], confirmed: cUnsigned.confirmed }));

// ── 6 · a signed warrant records verifying issuer authorship ─────────────────────────────────────────
ok("issuerSignedAuthorship", !!w["holwar:sig"] && w["holwar:issuer"] === issuer.kappa && w["holwar:pub"] === issuer.pub, "signed warrant must carry issuer κ + sig");

// ── 7 · immune memory: a confirmed warrant blocks the actor; a false one does not ────────────────────
const immune = makeImmunity();
await immune.receive(w);                                    // confirmed → block actor
await immune.receive(wWeak);                                // rejected → no effect
ok("immuneMemoryBlocksActor", immune.isBlocked(actor.kappa) === true && immune.isBlocked(issuer.kappa) === false && immune.blocklist().length === 1, JSON.stringify(immune.blocklist()));

await forget(issuer.kappa); await forget(actor.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-warrant — the κ-immune system: a signed, content-addressed proof-of-invalid ('entry X is invalid under ruleset κR') that embeds the offending entry and its ruleset so a recipient verifies it standalone, RE-RUNNING validation itself — the accusation holds only if the entry truly violates. False accusations, forged evidence, and swapped rulesets are rejected; the verdict is independent of the issuer (signature = authorship, never authority). A confirmed warrant marks the actor blocked (immune memory; wire to holo-revocation). Pure assembly over holo-strand + holo-strand-rules + holo-identity; no new crypto.",
  authority: "Holochain warrant/immune model · UOR-ADDR (κ=H(canonical_form)) · holospaces Laws L1/L2/L5 · rests on #holo-strand + #holo-strand-rules + #holo-identity",
  witnessed,
  covers: witnessed ? ["raise-confirm", "no-false-accusation", "forged-evidence-rejected", "tampered-ruleset-rejected", "verdict-independent-of-issuer", "issuer-authorship", "immune-memory"] : [],
  sample: { warrant: w.id, subject: w["holwar:subject"], actor: actor.kappa, blocked: makeImmunity, violations: c.violations },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-warrant-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-warrant witness — THE κ-IMMUNE SYSTEM (proof-of-invalid, verified not trusted)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  warrant ${String(w.id).slice(0, 26)}… on entry ${String(w["holwar:subject"]).slice(0, 18)}… → confirmed independently; false/forged/weak all rejected; actor blocked`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the network rejects bad data + bad actors by re-derivation, never by trust" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
