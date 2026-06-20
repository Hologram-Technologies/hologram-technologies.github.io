#!/usr/bin/env node
// holo-courier-witness.mjs — proves S3 of the autonomy spine: Q SPEAKS, with discipline. S2 raised ranked
// proposals; this proves the courier is the ONLY path from a proposal to a message in the user's inbox, and
// that the path is gated so Q is high-signal, never spam. The whole spine is exercised end to end here:
// a REAL heal sweep → S1 snapshot → S2 proposals → S3 inbox notes (sense → reason → SPEAK).
//
// The send filter is the contract. A proposal becomes a message only if it derives from a real S2 proposal
// (the body is the proposal's OWN words — a handed note, never generated), it has not already been said,
// and it fits the noise budget. NO-NOISE and COHERENCE-TRIGGERED (not timer-driven) are inherited from S2.
//
// Checks (all must hold):
//   1 composesRealPipelineToHandedNote — real heal sweep → S1 → S2 → S3 hands exactly one Q note; body == the proposal's suggestedAction.
//   2 silentWhenNothingRaised          — an observation with no proposals ⇒ zero notes, spoke:false (NO-NOISE end to end).
//   3 handedNeverGenerated             — every sent note is sender "Q" and its body is verbatim a proposal's suggestedAction (Q delivers, never authors).
//   4 dedupeNoResend                   — delivering the same observation twice ⇒ the second sends nothing (already said), it is suppressed.
//   5 resendAfterReleaseThenReraise    — a spoken subject that is RELEASED (no longer raised) and later RE-RAISED is sent again — recurrence speaks, nagging doesn't.
//   6 noiseBudgetCapsAndDrains         — more proposals than the budget ⇒ only `budget` sent, the rest HELD, then sent on a later delivery (held, not dropped).
//   7 budgetGoesToHighestSalience      — under budget, the highest-salience proposals are the ones sent (an unrecoverable object before a red row).
//   8 provenanceOnEverySend            — every sent note carries derivedFrom (the proposal-set κ) + its subject — auditable, nothing fabricated.
//
// Authority (external): the witnessed HoloNotify inbox (Q delivers a handed note, never generates) · the
// witnessed Holo Control DSP (salience ranking) · W3C PROV-O · UOR-ADDR · holospaces Laws L2/L5 · rests on
// #holo-observer (S2) + #holo-notify (the inbox).   node tools/holo-courier-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { makeCourier } from "../os/usr/lib/holo/holo-courier.mjs";
import { makeObserver } from "../os/usr/lib/holo/holo-observer.mjs";
import { makeCoherence } from "../os/usr/lib/holo/holo-coherence.mjs";
import { makeHealer } from "../os/sbin/holo-heal.mjs";
import { makeSupervisor } from "../os/sbin/holo-heal-supervisor.mjs";
import { reDerive, hexOf } from "../os/sbin/holo-resolver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dsp = await import(pathToFileURL(join(here, "../../../holo-apps/apps/control/holo-control-dsp.js")));

const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);
const kOf = async (bytes) => "did:holo:sha256:" + (await reDerive(bytes));
const source = (label, pairs) => { const m = new Map(pairs.map(([k, b]) => [hexOf(k), b])); const s = async (k) => m.get(hexOf(k)) || null; s.peer = label; return s; };
const coh = () => makeCoherence({ now: () => "2026-06-19T00:00:00Z" });
// a recording inbox sink — exactly the q(opts) shape HoloNotify exposes (Q delivers a handed note).
const makeSink = () => { const sent = []; return { sent, q: (opts) => { sent.push(opts); return { id: opts.id }; } }; };

// ── 1 · the LIVE pipeline: real heal sweep → S1 → S2 → S3 hands one Q note whose body is the handed action ─
const A = enc("courier-witness · A (healthy)"), B = enc("courier-witness · B (healable)");
const kA = await kOf(A), kB = await kOf(B);
const realTick = await (async () => {
  const durable = new Map([[hexOf(kA), A]]);
  const intact = async (hex) => durable.has(hex) && (await reDerive(durable.get(hex))) === hex;
  const healer = makeHealer({ sources: [source("ipfs", [[kA, A], [kB, B]])], store: new Map(), persist: async (hex, b) => durable.set(hex, b), now: () => "2026-06-19T00:00:00Z" });
  const sup = makeSupervisor({ loadClosure: async () => ({ "a.js": kA, "b.js": kB }), healer, intact, now: () => "2026-06-19T00:00:00Z" });
  return sup.tick("boot");
})();
const healState = { total: realTick.summary.total, healthy: realTick.summary.healthy, healed: realTick.summary.healed, unresolved: realTick.summary.unresolved, flaky: realTick.flaky };
const degradedSnap = coh().fold({ heal: healState, gate: { total: 143, passing: 131, failingRequired: 1, redRows: ["#share-runtime"] } });
{
  const obs = makeObserver({ dsp });
  const observation = obs.observe(degradedSnap);
  const sink = makeSink();
  const courier = makeCourier({ notify: sink });
  const r = courier.deliver(observation);
  const proposal = observation.proposals.find((p) => p.subject === "#share-runtime");
  ok("composesRealPipelineToHandedNote",
    sink.sent.length === 1 && sink.sent[0].sender === "Q" && proposal && sink.sent[0].body === proposal.suggestedAction && r.spoke === true,
    `${sink.sent.length} notes`);
}

// ── 2 · NO-NOISE: an observation with nothing raised sends nothing ──────────────────────────────────────
{
  const obs = makeObserver({ dsp });
  const observation = obs.observe(coh().fold({ heal: { total: 2, healthy: 2, whole: true }, gate: { total: 10, passing: 10, failingRequired: 0, redRows: [] } }));
  const sink = makeSink(); const courier = makeCourier({ notify: sink });
  const r = courier.deliver(observation);
  ok("silentWhenNothingRaised", sink.sent.length === 0 && r.spoke === false && observation.quiet === true);
}

// ── 3 · HANDED, NEVER GENERATED: every note is from Q and its body is verbatim a proposal's suggestedAction ─
{
  const obs = makeObserver({ dsp });
  const observation = obs.observe(coh().fold({ heal: { total: 3, healthy: 2, unresolved: 1, whole: false }, gate: { total: 10, passing: 9, failingRequired: 1, redRows: ["#x"] } }));
  const bodies = new Set(observation.proposals.map((p) => p.suggestedAction));
  const sink = makeSink(); makeCourier({ notify: sink }).deliver(observation);
  ok("handedNeverGenerated", sink.sent.length > 0 && sink.sent.every((n) => n.sender === "Q" && bodies.has(n.body)));
}

// ── 4 · DEDUPE: delivering the same observation twice — the second says nothing ─────────────────────────
{
  const obs = makeObserver({ dsp });
  const observation = obs.observe(coh().fold({ heal: { total: 1, healthy: 1, whole: true }, gate: { total: 10, passing: 9, failingRequired: 1, redRows: ["#x"] } }));
  const sink = makeSink(); const courier = makeCourier({ notify: sink });
  const r1 = courier.deliver(observation);
  const r2 = courier.deliver(observation);
  ok("dedupeNoResend", r1.sent.length === 1 && r2.sent.length === 0 && r2.suppressed.includes("#x") && sink.sent.length === 1);
}

// ── 5 · RELEASE then RE-RAISE: a recurrence speaks again; a steady concern does not nag ─────────────────
{
  const obs = makeObserver({ dsp });
  const red = () => coh().fold({ heal: { total: 1, healthy: 1, whole: true }, gate: { total: 10, passing: 9, failingRequired: 1, redRows: ["#x"] } });
  const green = () => coh().fold({ heal: { total: 1, healthy: 1, whole: true }, gate: { total: 10, passing: 10, failingRequired: 0, redRows: [] } });
  const sink = makeSink(); const courier = makeCourier({ notify: sink });
  const a = courier.deliver(obs.observe(red()));    // raised → sent
  const b = courier.deliver(obs.observe(green()));  // released → forgotten
  const c = courier.deliver(obs.observe(red()));    // re-raised → sent again
  ok("resendAfterReleaseThenReraise", a.sent.length === 1 && b.sent.length === 0 && c.sent.length === 1 && sink.sent.length === 2);
}

// ── 6 · NOISE BUDGET caps then drains: 5 raised, budget 2 ⇒ 2 + 2 + 1 across deliveries (held, not dropped) ─
{
  const obs = makeObserver({ dsp });
  const observation = obs.observe(coh().fold({ heal: { total: 1, healthy: 1, whole: true }, gate: { total: 20, passing: 15, failingRequired: 5, redRows: ["#a", "#b", "#c", "#d", "#e"] } }));
  const sink = makeSink(); const courier = makeCourier({ notify: sink, budget: 2 });
  const d1 = courier.deliver(observation), d2 = courier.deliver(observation), d3 = courier.deliver(observation);
  ok("noiseBudgetCapsAndDrains",
    observation.proposals.length === 5 && d1.sent.length === 2 && d1.held.length === 3 && d2.sent.length === 2 && d3.sent.length === 1 && sink.sent.length === 5,
    `${d1.sent.length}+${d2.sent.length}+${d3.sent.length}`);
}

// ── 7 · the budget goes to the HIGHEST salience: an unrecoverable object (risk .9) before a red row (.8) ─
{
  const obs = makeObserver({ dsp });
  const observation = obs.observe(coh().fold({ heal: { total: 5, healthy: 4, unresolved: 1, whole: false }, gate: { total: 10, passing: 9, failingRequired: 1, redRows: ["#x"] } }));
  const sink = makeSink(); const courier = makeCourier({ notify: sink, budget: 1 });
  const r = courier.deliver(observation);
  ok("budgetGoesToHighestSalience", r.sent.length === 1 && r.sent[0].subject !== "#x" && r.held.some((h) => h.subject === "#x"),
    `sent ${r.sent[0] && r.sent[0].subject}`);
}

// ── 8 · PROVENANCE on every send: derivedFrom (the proposal-set κ) + the subject ────────────────────────
{
  const obs = makeObserver({ dsp });
  const observation = obs.observe(coh().fold({ heal: { total: 2, healthy: 1, unresolved: 1, whole: false }, gate: { total: 10, passing: 9, failingRequired: 1, redRows: ["#x"] } }));
  const sink = makeSink(); const r = makeCourier({ notify: sink }).deliver(observation);
  ok("provenanceOnEverySend", r.sent.length > 0 && r.sent.every((s) => s.derivedFrom === observation.kappa && typeof s.subject === "string" && s.subject.length > 0));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "Holo Courier (S3, Q speaks with discipline) — the only path from an S2 proposal to an inbox message, gated so Q is high-signal not spam: PROVENANCE (the body is the proposal's own words, a handed note never generated), CHANGES-WHAT-YOU'D-DO (only raised proposals), NOT-ALREADY-SAID (dedupe + update-in-place; release then re-raise speaks again), and a NOISE BUDGET (caps per delivery, holds the rest, never drops). NO-NOISE and coherence-triggered (not timer-driven) inherited from S2. Composition proven from a real heal sweep through S1 + S2 to the inbox note.",
  authority: "the witnessed HoloNotify inbox (Q delivers a handed note, never generates) · the witnessed Holo Control DSP (salience ranking) · W3C PROV-O · UOR-ADDR · holospaces Laws L2/L5 · rests on #holo-observer + #holo-notify",
  witnessed,
  covers: witnessed ? ["q-voice", "send-discipline", "handed-not-generated", "no-noise", "dedupe", "noise-budget", "provenanced", "s0-s1-s2-s3-composition"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-courier-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Courier witness — S3 Q speaks with discipline (sense → reason → SPEAK)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  Q speaks only what's worth saying — handed, deduped, budgeted, provenanced" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
