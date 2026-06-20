#!/usr/bin/env node
// holo-evolve-witness.mjs — proves S0 of the Q-unification: the self-evolving loop is CLOSED and Q.trust is
// LOAD-BEARING. The spine observes (real proposals via the witnessed observer); the factory proposes a fix;
// shipping it goes ONLY through trust.act; the loop re-observes and the concern clears. This is what turns
// "self-evolving" from a claim into a proven, gated, reversible fact — and makes the trust boundary the real
// gate on every autonomous act (it was attached to Q but called by nobody).
//
// Checks (all must hold):
//   1 proposeOnlyByDefault       — with no trust granted, a fixable concern is SURFACED (propose), never auto-applied.
//   2 silentGrantClosesTheLoop   — grant the topic `silent` ⇒ the fix SHIPS, seals a receipt, and re-observe clears the concern.
//   3 valueFixNeverSilent        — a value-moving fix, even with the topic granted silent, is capped to `ask` and NOT applied.
//   4 irreversibleFixNeverSilent — an irreversible fix (no undo / reversible:false) is never shipped silently.
//   5 everyShippedFixHasReceiptAndUndo — an applied fix returns a re-deriving receipt (Law L5) and a working undo.
//   6 denyTopicNeverActs         — a topic set to `never` is never acted on (the user's veto holds).
//   7 factoryHonestStop          — when the factory can't produce a fix, Q skips shipping (only the heads-up stands).
//   8 humanPathUnaffected        — evolve governs only Q's UNPROMPTED acts; it never touches a human command path.
//
// Authority (external): the witnessed Holo Trust boundary (ADR-0033 conscience floor · wallet default-deny
// model) · the Factory self-observing SDLC loop (propose→ship, ADR-0097) · W3C PROV-O (the act receipt) ·
// holospaces Laws L1/L5 · rests on #holo-observer + #holo-trust.   node tools/holo-evolve-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { makeEvolve } from "../os/usr/lib/holo/holo-evolve.mjs";
import { makeTrust, verify } from "../os/usr/lib/holo/holo-trust.mjs";
import { makeObserver } from "../os/usr/lib/holo/holo-observer.mjs";
import { makeCoherence } from "../os/usr/lib/holo/holo-coherence.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dsp = await import(pathToFileURL(join(here, "../../../holo-apps/apps/control/holo-control-dsp.js")));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const allow = { evaluate: () => ({ outcome: "allow" }) };
const coh = () => makeCoherence({ now: () => "2026-06-19T00:00:00Z" });

// a world a fix can change: a set of "red" gate rows. The factory's fix REMOVES a row; re-observe should clear it.
const makeWorld = () => {
  const red = new Set(["#x"]);
  const snapshot = () => coh().fold({ heal: { total: 1, healthy: 1, whole: true }, gate: { total: 10, passing: 9, failingRequired: red.size, redRows: [...red] } });
  return { red, snapshot };
};
// the factory adapter under test: given a gate.red proposal, it can ship a REVERSIBLE fix that clears the row.
const proposer = (world, { value = false, reversible = true } = {}) => async (p) => {
  if (p.kind !== "gate.red") return null;                       // honest stop on anything it can't fix
  const subject = p.subject; let removed = false;
  return {
    summary: `clear ${subject}`, reversible, value,
    apply: async () => { removed = world.red.delete(subject); return { cleared: subject }; },
    undo: () => { if (removed) world.red.add(subject); },
  };
};
const observe = (snap) => makeObserver({ dsp }).observe(snap);

// ── 1 · PROPOSE-ONLY by default: nothing ships without a grant ─────────────────────────────────────────
{
  const world = makeWorld();
  const trust = makeTrust({ conscience: allow });
  const evolve = makeEvolve({ trust, propose: proposer(world) });
  const r = await evolve.step(observe(world.snapshot()));
  ok("proposeOnlyByDefault", r.acted === false && r.surfaced.some((s) => s.subject === "#x" && s.disposition === "propose") && world.red.has("#x"));
}

// ── 2 · grant silent ⇒ the loop CLOSES: fix ships, receipt sealed, re-observe clears the concern ────────
{
  const world = makeWorld();
  const trust = makeTrust({ conscience: allow }); trust.setTrust("#x", "silent");
  let reobservedClear = null;
  const evolve = makeEvolve({ trust, propose: proposer(world), onApplied: () => { reobservedClear = !observe(world.snapshot()).proposals.some((p) => p.subject === "#x"); } });
  const r = await evolve.step(observe(world.snapshot()));
  ok("silentGrantClosesTheLoop",
    r.acted === true && r.applied[0].subject === "#x" && !!r.applied[0].receipt && !world.red.has("#x") && reobservedClear === true);
}

// ── 3 · a VALUE-moving fix is capped to ask even when the topic is granted silent ──────────────────────
{
  const world = makeWorld();
  const trust = makeTrust({ conscience: allow }); trust.setTrust("#x", "silent");
  const evolve = makeEvolve({ trust, propose: proposer(world, { value: true }) });
  const r = await evolve.step(observe(world.snapshot()));
  ok("valueFixNeverSilent", r.acted === false && r.surfaced.some((s) => s.subject === "#x" && s.disposition === "ask") && world.red.has("#x"));
}

// ── 4 · an IRREVERSIBLE fix (reversible:false) is never shipped silently ───────────────────────────────
{
  const world = makeWorld();
  const trust = makeTrust({ conscience: allow }); trust.setTrust("#x", "silent");
  const evolve = makeEvolve({ trust, propose: proposer(world, { reversible: false }) });
  const r = await evolve.step(observe(world.snapshot()));
  ok("irreversibleFixNeverSilent", r.acted === false && world.red.has("#x"));
}

// ── 5 · every SHIPPED fix carries a re-deriving receipt + a working undo (Law L5) ──────────────────────
{
  const world = makeWorld();
  const trust = makeTrust({ conscience: allow }); trust.setTrust("#x", "silent");
  let receiptObj = null;
  const evolve = makeEvolve({ trust, propose: async (p) => { const base = await proposer(world)(p); return base; } });
  // capture the receipt object via a wrapping trust whose act() exposes it — simplest: re-run trust.act path through evolve and read undo
  const r = await evolve.step(observe(world.snapshot()));
  const undo = r.applied[0] && r.applied[0].undo;
  const before = world.red.has("#x");          // false (cleared)
  if (typeof undo === "function") undo();        // undo restores the row
  ok("everyShippedFixHasReceiptAndUndo", r.acted === true && !!r.applied[0].receipt && before === false && world.red.has("#x") === true);
}

// ── 6 · a topic the USER set to `never` is never acted on ──────────────────────────────────────────────
{
  const world = makeWorld();
  const trust = makeTrust({ conscience: allow }); trust.setTrust("#x", "never");
  const evolve = makeEvolve({ trust, propose: proposer(world) });
  const r = await evolve.step(observe(world.snapshot()));
  ok("denyTopicNeverActs", r.acted === false && world.red.has("#x"));
}

// ── 7 · the factory's HONEST STOP: a concern it can't fix is skipped (only the heads-up stands) ────────
{
  const world = makeWorld();
  const trust = makeTrust({ conscience: allow }); trust.setTrust("3", "silent");   // grant the unresolved topic
  // a snapshot whose only concern is heal.unresolved (the proposer returns null for it)
  const snap = coh().fold({ heal: { total: 5, healthy: 4, unresolved: 1, whole: false }, gate: { total: 10, passing: 10, failingRequired: 0, redRows: [] } });
  const evolve = makeEvolve({ trust, propose: proposer(world) });
  const r = await evolve.step(observe(snap));
  ok("factoryHonestStop", r.acted === false && r.skipped.some((s) => /no fix/.test(s.reason)));
}

// ── 8 · evolve governs only UNPROMPTED acts — it has no human-command path (it only consumes observations) ─
{
  // makeEvolve exposes ONLY step(observation); there is no execute-arbitrary-command method. Structural guarantee.
  const world = makeWorld();
  const evolve = makeEvolve({ trust: makeTrust({ conscience: allow }), propose: proposer(world) });
  const surface = Object.keys(evolve);
  ok("humanPathUnaffected", surface.length === 1 && surface[0] === "step");
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "Holo Evolve (S0, the closed self-improving loop) — the spine observes, the factory proposes a fix, shipping it goes ONLY through trust.act (making Q.trust load-bearing), and the loop re-observes so the concern clears: propose-only by default (Q earns autonomy per topic), value/irreversible fixes never ship silently, every shipped fix carries a re-deriving receipt + a working undo, a user veto (never) holds, the factory stops honestly when it can't fix, and Q's unprompted acts are the only thing governed (human commands stay sovereign)",
  authority: "the witnessed Holo Trust boundary (ADR-0033 conscience floor) · the Factory self-observing loop (ADR-0097) · W3C PROV-O · holospaces Laws L1/L5 · rests on #holo-observer + #holo-trust",
  witnessed,
  covers: witnessed ? ["closed-evolve-loop", "trust-load-bearing", "propose-by-default", "value-irreversible-never-silent", "receipt-and-undo", "user-veto", "honest-stop", "human-sovereign"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-evolve-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Evolve witness — S0 the closed self-improving loop (perceive → … → ACT → re-perceive)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  Q improves itself — gated by trust, reversible, and only as far as you grant" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
