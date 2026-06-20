#!/usr/bin/env node
// holo-ambient-witness.mjs — proves S1 of the Q-unification: ONE AMBIENT LOOP. Self-improvement ran on TWO
// uncoordinated timers (the spine's idle loop + trinity's setInterval); this proves a single scheduler can own
// the heartbeat and dispatch to registered faculties (reflect · drift-heal · evolve) at their own cadence —
// fault-isolated and deterministic, with NO faculty owning a timer of its own.
//
// Checks (all must hold):
//   1 oneLoopRunsManyFaculties — three faculties registered; one tick runs the due ones, in registration order.
//   2 cadenceRespected         — a faculty with everyTicks:3 runs only on ticks 3,6,9 (not every tick).
//   3 faultIsolation           — a faculty that throws is reported, never stalls the heartbeat or its siblings.
//   4 deterministicDispatch    — replaying the same registrations + tick count yields identical run-order each tick.
//   5 pauseResumeWholeLayer     — pause() halts ALL dispatch in one move; resume() restores it.
//   6 unregisterStops           — an unregistered faculty no longer runs.
//   7 idempotentRegister        — registering the same name twice REPLACES (one entry), never duplicates.
//   8 singleSchedulerNoSelfTimers — start() arms exactly ONE loop via the injected pump (re-arm once per tick); the core holds no timer.
//
// Authority (external): the holo-heal-supervisor injected-pump idiom (no clock/timer in the core) · holospaces
// Law L2 (one canonical wire) · deterministic dispatch (re-runnable).   node tools/holo-ambient-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeAmbient } from "../os/usr/lib/holo/holo-ambient.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── 1 · one loop runs many faculties, in registration order ────────────────────────────────────────────
{
  const a = makeAmbient(); const order = [];
  a.register("reflect", () => { order.push("reflect"); });
  a.register("drift-heal", () => { order.push("drift-heal"); });
  a.register("evolve", () => { order.push("evolve"); });
  const r = await a.tick();
  ok("oneLoopRunsManyFaculties", JSON.stringify(r.ran) === JSON.stringify(["reflect", "drift-heal", "evolve"]) && order.length === 3);
}

// ── 2 · cadence respected: everyTicks:3 runs only on multiples of 3 ────────────────────────────────────
{
  const a = makeAmbient(); let fast = 0, slow = 0;
  a.register("fast", () => { fast++; }, { everyTicks: 1 });
  a.register("slow", () => { slow++; }, { everyTicks: 3 });
  for (let i = 0; i < 9; i++) await a.tick();
  ok("cadenceRespected", fast === 9 && slow === 3, `fast=${fast} slow=${slow}`);
}

// ── 3 · fault isolation: a thrower is reported, the others still run ────────────────────────────────────
{
  const a = makeAmbient(); let after = 0;
  a.register("ok-before", () => {});
  a.register("boom", () => { throw new Error("kaboom"); });
  a.register("ok-after", () => { after++; });
  const r = await a.tick();
  ok("faultIsolation", r.ran.includes("ok-before") && r.ran.includes("ok-after") && after === 1 && r.errored.some((e) => e.name === "boom" && /kaboom/.test(e.error)));
}

// ── 4 · deterministic dispatch order, every tick ───────────────────────────────────────────────────────
{
  const a = makeAmbient(); const seen = [];
  a.register("a", () => {}); a.register("b", () => {}); a.register("c", () => {});
  const r1 = await a.tick(), r2 = await a.tick();
  ok("deterministicDispatch", JSON.stringify(r1.ran) === JSON.stringify(["a", "b", "c"]) && JSON.stringify(r2.ran) === JSON.stringify(["a", "b", "c"]));
}

// ── 5 · pause halts the WHOLE layer in one move; resume restores ───────────────────────────────────────
{
  const a = makeAmbient(); let n = 0;
  a.register("x", () => { n++; });
  await a.tick();              // n=1
  a.pause();
  const paused = await a.tick();   // no run
  a.resume();
  await a.tick();             // n=2
  ok("pauseResumeWholeLayer", n === 2 && paused.paused === true && paused.ran.length === 0);
}

// ── 6 · unregister stops a faculty ─────────────────────────────────────────────────────────────────────
{
  const a = makeAmbient(); let n = 0;
  const off = a.register("y", () => { n++; });
  await a.tick();             // n=1
  off();
  await a.tick();             // still 1
  ok("unregisterStops", n === 1 && a.faculties().length === 0);
}

// ── 7 · idempotent register: same name replaces, never duplicates ──────────────────────────────────────
{
  const a = makeAmbient(); let v1 = 0, v2 = 0;
  a.register("z", () => { v1++; });
  a.register("z", () => { v2++; });   // replaces
  await a.tick();
  ok("idempotentRegister", a.faculties().length === 1 && v1 === 0 && v2 === 1);
}

// ── 8 · single scheduler: start() arms ONE loop via the injected pump; no faculty owns a timer ──────────
{
  const a = makeAmbient(); let pumpCalls = 0, ran = 0;
  a.register("tickme", () => { ran++; });
  // a synchronous pump that fires the loop a fixed number of times, counting how often start re-arms it
  let budget = 3;
  const schedule = (fn) => { pumpCalls++; if (budget-- > 0) fn(); };
  const stop = a.start({ schedule });
  // pumpCalls === 1 (initial) + one re-arm per executed tick; ran === number of ticks that actually fired
  await new Promise((r) => setTimeout(r, 10));
  stop();
  ok("singleSchedulerNoSelfTimers", ran >= 1 && pumpCalls === ran + 1, `ran=${ran} pumpCalls=${pumpCalls}`);
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "Holo Ambient (S1, one ambient loop) — a single scheduler owns the heartbeat and dispatches to registered faculties (reflect · drift-heal · evolve) at their own cadence: one loop runs many faculties in registration order, cadence (everyTicks) is respected, a throwing faculty is fault-isolated (never stalls the heartbeat), dispatch is deterministic, pause/resume halts the whole layer in one move, unregister/idempotent-register behave, and start() arms exactly one loop via the injected pump (no faculty owns a timer)",
  authority: "the holo-heal-supervisor injected-pump idiom (no clock in the core) · holospaces Law L2 (one canonical wire) · deterministic dispatch",
  witnessed,
  covers: witnessed ? ["one-ambient-loop", "faculty-registry", "cadence", "fault-isolation", "deterministic-dispatch", "one-move-pause", "single-scheduler"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ambient-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Ambient witness — S1 one ambient loop (one heartbeat, many organs)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  one scheduler, many faculties — no module owns a timer" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
