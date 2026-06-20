#!/usr/bin/env node
// holo-fix-proposer-witness.mjs — proves C5 of the autonomy spine: a REAL fix proposer. The evolve loop ships
// a fix ONLY through trust.act; this proves the proposer that finally feeds it produces SAFE, REVERSIBLE fixes
// the OS already knows how to do (reload a crashed app, re-attempt recovery) and HONESTLY STOPS on what needs a
// code brain (a red conformance row). Composed with the witnessed evolve + trust, it proves Q goes from
// propose-only to ACTUALLY FIXING — within granted trust, reversibly.
//
// Checks (all must hold):
//   1 appErrorProposesReversibleReload — an app.error → a reversible plan whose apply() reloads that app.
//   2 healProposesReattemptRecovery    — heal.unresolved / heal.flaky → a reversible plan whose apply() re-heals.
//   3 gateRedHonestStop                — a gate.red proposal → null (needs a code brain; Q surfaces it, doesn't fake a fix).
//   4 reloadCappedNoCrashLoop          — after maxReloads, an app.error → null (a persistently-crashing app is surfaced, not looped).
//   5 everyPlanIsReversibleWithUndo    — every produced plan has reversible:true and an undo().
//   6 composesEvolveTrustShipsGranted  — through evolve+trust: default → propose-only; grant silent → the fix SHIPS with a receipt.
//   7 missingSeamDegradesToNull        — with no reloadApp/reHeal seam, the proposer returns null (evolve stays propose-only, safe).
//
// Authority (external): the Holo Trust boundary (ADR-0033 conscience floor) · the heal supervisor recovery
// (Law L5, additive-only) · holospaces Laws L1/L5 · rests on #holo-evolve + #holo-trust + #holo-observer.
//   node tools/holo-fix-proposer-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { makeFixProposer } from "../os/usr/lib/holo/holo-fix-proposer.mjs";
import { makeEvolve } from "../os/usr/lib/holo/holo-evolve.mjs";
import { makeTrust } from "../os/usr/lib/holo/holo-trust.mjs";
import { makeObserver } from "../os/usr/lib/holo/holo-observer.mjs";
import { makeCoherence } from "../os/usr/lib/holo/holo-coherence.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dsp = await import(pathToFileURL(join(here, "../../../holo-apps/apps/control/holo-control-dsp.js")));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const allow = { evaluate: () => ({ outcome: "allow" }) };

// ── 1 · app.error → a reversible reload plan whose apply() reloads that app ─────────────────────────────
{
  let reloaded = null;
  const propose = makeFixProposer({ reloadApp: (n) => { reloaded = n; return true; }, reHeal: async () => "ok" });
  const plan = await propose({ kind: "app.error", subject: "Editor" });
  const r = plan && await plan.apply();
  ok("appErrorProposesReversibleReload", plan && plan.reversible === true && typeof plan.undo === "function" && reloaded === "Editor" && r.reloaded === true);
}

// ── 2 · heal.unresolved / flaky → a reversible re-attempt-recovery plan ────────────────────────────────
{
  let healed = 0;
  const propose = makeFixProposer({ reloadApp: () => true, reHeal: async () => { healed++; return { swept: true }; } });
  const p1 = await propose({ kind: "heal.unresolved", subject: "heal.unresolved" });
  const p2 = await propose({ kind: "heal.flaky", subject: "aa" });
  await p1.apply(); await p2.apply();
  ok("healProposesReattemptRecovery", p1 && p1.reversible === true && p2 && healed === 2);
}

// ── 3 · gate.red → null (honest stop — needs a code brain) ─────────────────────────────────────────────
{
  const propose = makeFixProposer({ reloadApp: () => true, reHeal: async () => "ok" });
  const plan = await propose({ kind: "gate.red", subject: "#share-runtime" });
  ok("gateRedHonestStop", plan === null);
}

// ── 4 · reload capped — a persistently-crashing app is surfaced, not reload-looped ─────────────────────
{
  const propose = makeFixProposer({ reloadApp: () => true, maxReloads: 2 });
  const a = await propose({ kind: "app.error", subject: "Buggy" }); await a.apply();
  const b = await propose({ kind: "app.error", subject: "Buggy" }); await b.apply();
  const c = await propose({ kind: "app.error", subject: "Buggy" });   // 3rd time → capped
  ok("reloadCappedNoCrashLoop", a && b && c === null);
}

// ── 5 · every plan is reversible with an undo ──────────────────────────────────────────────────────────
{
  const propose = makeFixProposer({ reloadApp: () => true, reHeal: async () => "ok" });
  const plans = [await propose({ kind: "app.error", subject: "A" }), await propose({ kind: "heal.unresolved", subject: "1" })];
  ok("everyPlanIsReversibleWithUndo", plans.every((p) => p && p.reversible === true && typeof p.undo === "function" && typeof p.apply === "function"));
}

// ── 6 · composed with evolve + trust: default propose-only; grant silent → the fix SHIPS with a receipt ─
{
  let reloaded = null;
  const propose = makeFixProposer({ reloadApp: (n) => { reloaded = n; return true; } });
  const trust = makeTrust({ conscience: allow });
  const evolve = makeEvolve({ trust, propose });
  // a real observation with an app.error proposal (via the witnessed observer over a coherence snapshot)
  const snap = makeCoherence({ now: () => "2026-06-19T00:00:00Z" }).fold({ heal: { total: 1, healthy: 1, whole: true }, gate: { total: 10, passing: 10, failingRequired: 0, redRows: [] }, apps: [{ app: "Editor", phase: "error" }] });
  const obs = makeObserver({ dsp }).observe(snap);
  const before = await evolve.step(obs);                            // default trust → propose-only (no reload)
  trust.setTrust("Editor", "silent");
  const after = await evolve.step(obs);                             // granted → ships the reload with a receipt
  ok("composesEvolveTrustShipsGranted",
    before.acted === false && before.surfaced.some((s) => s.subject === "Editor")
    && after.acted === true && after.applied[0].subject === "Editor" && !!after.applied[0].receipt && reloaded === "Editor");
}

// ── 7 · missing seams → null (evolve stays propose-only, safe) ─────────────────────────────────────────
{
  const propose = makeFixProposer({});   // no reloadApp / reHeal
  const a = await propose({ kind: "app.error", subject: "X" });
  const b = await propose({ kind: "heal.unresolved", subject: "1" });
  ok("missingSeamDegradesToNull", a === null && b === null);
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "Holo Fix Proposer (C5, a real fix proposer) — feeds the evolve loop SAFE, REVERSIBLE fixes the OS already knows how to do (reload a crashed app, re-attempt recovery) and honestly STOPS on what needs a code brain (a red conformance row); reloads are capped to avoid a crash-loop; every plan is reversible with an undo; composed with the witnessed evolve + trust, Q ships a fix only when granted, with a receipt — propose-only otherwise; missing seams degrade to null (safe)",
  authority: "the Holo Trust boundary (ADR-0033) · the heal supervisor recovery (Law L5, additive-only) · holospaces Laws L1/L5 · rests on #holo-evolve + #holo-trust + #holo-observer",
  witnessed,
  covers: witnessed ? ["real-fix-proposer", "app-reload-fix", "heal-retry-fix", "honest-stop", "reload-capped", "reversible", "ships-only-when-granted"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-fix-proposer-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Fix Proposer witness — C5 a real fix proposer (Q actually fixes, within trust)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  Q ships safe reversible fixes within granted trust — and honestly surfaces the rest" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
