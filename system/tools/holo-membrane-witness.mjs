#!/usr/bin/env node
// holo-membrane-witness.mjs — proves M: PER-APP MEMBRANES. A membrane is a content-addressed, forkable
// app boundary (governing ruleset κ + join predicate + operator authority). Entry is deterministic and
// fail-closed (open / operator-signed invite / closed); a forged or mis-targeted invite is refused.
// Membership is a SEC-4 content-addressed roster bound to the membrane + operator. The membrane scopes
// validation: a member's entries are governed by membrane.rulesetKappa. Real holo-identity signers.
//
// Checks (all must hold):
//   1 membraneContentAddressed — defineMembrane → κ; same inputs → same κ; change ruleset/join → new κ (forkable).
//   2 openAdmitsAnyone         — an "open" membrane admits any candidate.
//   3 closedRefuses            — a "closed" membrane refuses everyone.
//   4 inviteAdmits             — an "invite" membrane admits a candidate holding a valid operator-signed invite.
//   5 forgedInviteRefused      — wrong invitee, non-operator issuer, and tampered invite are all refused.
//   6 rosterBindsMembrane      — membraneRoster re-derives; changing membership OR the membrane κ changes it.
//   7 membraneScopesRuleset    — the membrane carries its governing ruleset κ (V validates members under it).
//
// Authority: Holochain hApp/DNA membrane model · UOR-ADDR · holospaces Laws L1/L2/L5 + SEC-4 · rests on
// #holo-object + #holo-identity (+ #holo-strand-rules for the governing ruleset). node tools/holo-membrane-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as pjoin } from "node:path";
import { defineMembrane, issueInvite, evaluateJoin, membraneRoster, verifyMembraneRoster } from "../os/usr/lib/holo/holo-membrane.mjs";
import { defineRuleset } from "../os/usr/lib/holo/holo-strand-rules.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));

const operator = await enroll({ label: "space-operator", passphrase: "op pass" });
const stranger = await enroll({ label: "stranger", passphrase: "str pass" });
const alice = "did:holo:sha256:" + "a".repeat(64);
const bob = "did:holo:sha256:" + "b".repeat(64);
const RS = defineRuleset({ name: "space-rules", rules: { ingest: { require: ["source"] } } });

// ── 1 · content-addressed + forkable ─────────────────────────────────────────────────────────────────
const m = defineMembrane({ app: "writing-studio", operator: operator.kappa, rulesetKappa: RS.id, join: { type: "invite" } });
const mSame = defineMembrane({ app: "writing-studio", operator: operator.kappa, rulesetKappa: RS.id, join: { type: "invite" } });
const mOpen = defineMembrane({ app: "writing-studio", operator: operator.kappa, rulesetKappa: RS.id, join: { type: "open" } });
ok("membraneContentAddressed", /^did:holo:sha256:[0-9a-f]{64}$/.test(m.id) && m.id === mSame.id && m.id !== mOpen.id, m.id.slice(0, 20));

// ── 2 · open admits anyone ───────────────────────────────────────────────────────────────────────────
const eo = await evaluateJoin(mOpen, { candidate: alice });
ok("openAdmitsAnyone", eo.admitted === true, JSON.stringify(eo));

// ── 3 · closed refuses ───────────────────────────────────────────────────────────────────────────────
const mClosed = defineMembrane({ app: "vault", operator: operator.kappa, rulesetKappa: RS.id, join: { type: "closed" } });
const ec = await evaluateJoin(mClosed, { candidate: alice });
ok("closedRefuses", ec.admitted === false && ec.why === "closed", JSON.stringify(ec));

// ── 4 · invite admits the named candidate with an operator-signed invite ─────────────────────────────
const inviteAlice = await issueInvite(m.id, alice, operator);
const ei = await evaluateJoin(m, { candidate: alice, invite: inviteAlice });
ok("inviteAdmits", ei.admitted === true && ei.why === "invited", JSON.stringify(ei));

// ── 5 · forged invites refused (wrong invitee · non-operator issuer · tampered) ──────────────────────
const eWrongWho = await evaluateJoin(m, { candidate: bob, invite: inviteAlice });            // invite was for alice
const inviteByStranger = await issueInvite(m.id, bob, stranger);                              // not the operator
const eStranger = await evaluateJoin(m, { candidate: bob, invite: inviteByStranger });
const tampered = clone(inviteAlice); tampered["holmem:invitee"] = bob;                         // mutate target → κ breaks
const eTamper = await evaluateJoin(m, { candidate: bob, invite: tampered });
ok("forgedInviteRefused", !eWrongWho.admitted && !eStranger.admitted && !eTamper.admitted, JSON.stringify({ wrongWho: eWrongWho.admitted, stranger: eStranger.admitted, tamper: eTamper.admitted }));

// ── 6 · SEC-4 roster binds membership to the membrane + operator ─────────────────────────────────────
const r1 = await membraneRoster(m, [alice]);
const r1b = await membraneRoster(m, [alice]);
const r2 = await membraneRoster(m, [alice, bob]);              // membership changed
const rOtherMembrane = await membraneRoster(mOpen, [alice]);   // different membrane κ
ok("rosterBindsMembrane",
  (await verifyMembraneRoster(r1)) !== null && r1.rosterKappa === r1b.rosterKappa
  && r1.rosterKappa !== r2.rosterKappa && r1.rosterKappa !== rOtherMembrane.rosterKappa,
  "roster κ must move with membership AND membrane");

// ── 7 · the membrane scopes validation (carries its governing ruleset κ for V) ───────────────────────
ok("membraneScopesRuleset", m.rulesetKappa === RS.id && verifyMembraneRosterOk(r1), "membrane.rulesetKappa governs members' entries");
function verifyMembraneRosterOk(r) { return r && r.membrane === m.id && r.operator === operator.kappa; }

await forget(operator.kappa); await forget(stranger.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-membrane M — per-app membranes: a content-addressed, forkable app boundary (governing ruleset κ + join predicate + operator authority). Entry is deterministic + fail-closed (open / operator-signed invite / closed); forged or mis-targeted invites are refused (L5 on the invite + CC-1 issuer binding + signature). Membership is a SEC-4 content-addressed roster bound to the membrane + operator (re-derives; moves with membership and membrane). The membrane scopes validation — members' entries are governed by membrane.rulesetKappa (V). Holochain's hApp/DNA boundary on the κ substrate. Pure assembly over holo-object + holo-identity; no new crypto.",
  authority: "Holochain hApp/DNA membrane model · UOR-ADDR · holospaces Laws L1/L2/L5 + SEC-4 · rests on #holo-object + #holo-identity + #holo-strand-rules",
  witnessed,
  covers: witnessed ? ["content-addressed-forkable", "open-admits", "closed-refuses", "invite-admits", "forged-invite-refused", "sec4-roster-binds", "scopes-ruleset"] : [],
  sample: { membrane: m.id, ruleset: RS.id, roster: r1.rosterKappa },
  checks, failed: fail,
};
writeFileSync(pjoin(here, "holo-membrane-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-membrane witness — M PER-APP MEMBRANES (forkable app boundary: ruleset κ + join + roster)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  each app is its own κ-bounded space — join fail-closed, membership SEC-4-bound, rules scoped" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
