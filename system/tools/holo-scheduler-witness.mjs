#!/usr/bin/env node
// holo-scheduler-witness.mjs — PROVE the ONE unified scheduler (Law L4: one runtime, no parallel loops).
// A single budgeted tick drives EVERY stream — the render-delta loop AND the LLM token stream — by
// priority, holding a per-tick time budget so the frame rate is protected while the LLM fills the rest:
// the orb renders WHILE Q generates, neither starves. (rAF/idle in the browser; an injected clock here.)
//
// Checks: budget honored; priority order (render before LLM); render pumps EVERY tick (frame rate held);
// LLM still progresses (not starved); both advance over time; a finished task drops; deterministic; a
// tight budget still serves the highest priority first.   Usage: node tools/holo-scheduler-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeScheduler } from "../os/usr/lib/holo/holo-scheduler.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// a virtual clock: each pump advances it by the task's cost — so budgets are deterministic (no wall clock)
function rig() { let clock = 0; const now = () => clock; const adv = (ms) => { clock += ms; }; return { now, adv }; }
const checks = {};

// ── 1 · budget honored: a tick does as many pumps as fit, no more ────────────────────────────────
{
  const { now, adv } = rig();
  const sch = makeScheduler({ now, budgetMs: 6 });
  let n = 0; sch.register({ id: "w", priority: 0, pump: async () => { adv(2); n++; } });   // each pump costs 2 ms
  const r = await sch.tick();
  checks.budgetHonored = n === 3 && r.spent <= 6;                                            // 3 × 2 ms = 6 ms
}

// ── 2 · priority order: render (0) pumps before LLM (1) ───────────────────────────────────────────
{
  const { now, adv } = rig();
  const sch = makeScheduler({ now, budgetMs: 4 });
  const order = [];
  sch.register({ id: "llm", priority: 1, pump: async () => { adv(2); order.push("llm"); } });
  sch.register({ id: "render", priority: 0, pump: async () => { adv(2); order.push("render"); } });
  await sch.tick();
  checks.priorityOrder = order[0] === "render";
}

// ── 3 · render pumps EVERY tick even under a heavy LLM (frame rate held) ───────────────────────────
{
  const { now, adv } = rig();
  const sch = makeScheduler({ now, budgetMs: 4 });
  let renderTicks = 0;
  sch.register({ id: "render", priority: 0, pump: async () => { adv(1); renderTicks++; } });
  sch.register({ id: "llm", priority: 1, pump: async () => { adv(3); } });                  // heavy
  for (let t = 0; t < 5; t++) { const r = await sch.tick(); if (!r.ran.includes("render")) { renderTicks = -999; break; } }
  checks.renderEveryTick = renderTicks === 5;
}

// ── 4 · LLM still progresses (not starved) when budget allows a full round ────────────────────────
{
  const { now, adv } = rig();
  const sch = makeScheduler({ now, budgetMs: 8 });
  let llm = 0;
  sch.register({ id: "render", priority: 0, pump: async () => { adv(2); } });
  sch.register({ id: "llm", priority: 1, pump: async () => { adv(2); llm++; } });
  for (let t = 0; t < 3; t++) await sch.tick();
  checks.llmNotStarved = llm >= 3;                                                           // ≥ once per tick
}

// ── 5 · both advance over time ────────────────────────────────────────────────────────────────────
{
  const { now, adv } = rig();
  const sch = makeScheduler({ now, budgetMs: 6 });
  let r = 0, l = 0;
  sch.register({ id: "render", priority: 0, pump: async () => { adv(2); r++; } });
  sch.register({ id: "llm", priority: 1, pump: async () => { adv(2); l++; } });
  for (let t = 0; t < 4; t++) await sch.tick();
  checks.bothProgress = r > 0 && l > 0 && r >= l;                                            // render runs at least as often
}

// ── 6 · a finished task drops out ─────────────────────────────────────────────────────────────────
{
  const { now, adv } = rig();
  const sch = makeScheduler({ now, budgetMs: 10 });
  let pumps = 0;
  sch.register({ id: "gen", priority: 0, pump: async () => { adv(2); pumps++; return pumps >= 2 ? { done: true } : undefined; } });
  await sch.tick();                                                                          // pumps twice → done → dropped
  checks.doneDrops = sch.tasks().length === 0 && pumps === 2;
}

// ── 7 · deterministic: same setup ⇒ same pump sequence ───────────────────────────────────────────
{
  const run = async () => { const { now, adv } = rig(); const sch = makeScheduler({ now, budgetMs: 6 }); const seq = [];
    sch.register({ id: "a", priority: 1, pump: async () => { adv(2); seq.push("a"); } });
    sch.register({ id: "b", priority: 0, pump: async () => { adv(2); seq.push("b"); } });
    await sch.tick(); return seq.join(","); };
  checks.deterministic = (await run()) === (await run());
}

// ── 8 · a tight budget still serves the highest priority first ────────────────────────────────────
{
  const { now, adv } = rig();
  const sch = makeScheduler({ now, budgetMs: 2 });                                           // room for ONE pump
  const order = [];
  sch.register({ id: "llm", priority: 1, pump: async () => { adv(2); order.push("llm"); } });
  sch.register({ id: "render", priority: 0, pump: async () => { adv(2); order.push("render"); } });
  await sch.tick();
  checks.tightBudgetRenderFirst = order.length === 1 && order[0] === "render";
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-scheduler-witness.result.json"), JSON.stringify({
  spec: "One unified scheduler (Law L4): a single budgeted tick drives the render-delta loop AND the LLM token stream by priority — frame rate protected (render pumps every tick), LLM fills the remaining budget (not starved), finished tasks drop. The orb renders while Q generates, one runtime.",
  authority: "holospaces Law L4 (everything through one substrate/runtime) · frame-budget scheduling · priority scheduling with fairness",
  witnessed,
  covers: witnessed ? ["unified-scheduler", "budget-honored", "priority-order", "render-every-tick", "llm-not-starved", "both-progress", "task-done-drops", "deterministic"] : [],
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ one loop drives render + LLM under one budget — frame rate held, neither starves" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
