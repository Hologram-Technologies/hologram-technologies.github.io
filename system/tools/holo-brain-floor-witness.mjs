#!/usr/bin/env node
// holo-brain-floor-witness.mjs — proves S3 of the Q-unification: Q ALWAYS HAS A BRAIN. The audit found Q's
// brains are bind-or-die — the mux falls through to a "main" that may not exist, so Q.create/Q.ask can fatally
// throw "no specialist bound". This proves a deterministic, zero-download FLOOR is bound to every core task so
// routing always resolves to something usable, a real brain silently UPGRADES over it, and a governed
// self-acquire fills a gap when possible — the floor never breaks, never hallucinates, never throws.
//
// Checks (all must hold):
//   1 floorGeneratesNeverThrows  — the floor provider produces a deterministic final value with no model and no throw.
//   2 ensureFillsUncoveredTasks  — before: route('create') is the fatal {fallback}; after ensureBrainFloor it's a usable floor.
//   3 routeAlwaysUsableAfter     — for EVERY core task, route returns a provider with a generate() (never the fatal fallback).
//   4 neverClobbersARealBrain    — ensure does NOT replace a real specialist already bound (floor fills gaps only).
//   5 silentUpgradeOverFloor     — upgrade(task, realBrain) swaps the floor for the real brain; route now returns it.
//   6 acquireOnlyWhenOnFloor     — acquireMissing binds an acquired brain only when on the floor; a refused acquire keeps the floor (no throw).
//   7 floorIsDeterministic       — same input ⇒ same floor output (re-derivable, Law L5).
//   8 floorIsHonest              — the `ask` floor does NOT fabricate an answer; it states plainly no model is loaded.
//
// Authority (external): the holo-q-mux bind/route routing contract (ADR-0084/0085) · the dormant skill-acquire
// path (discover → authorize → forge → bind) · holospaces Law L2 (one canonical wire) / L5 (deterministic
// re-derivation).   node tools/holo-brain-floor-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeBrainFloor, ensureBrainFloor } from "../os/usr/lib/holo/holo-brain-floor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
// a fresh in-memory mux (the real holo-q-mux uses the same bind/route contract over a Map).
const freshMux = () => { const bound = new Map(); return { bound, bind: (t, p) => (p ? bound.set(t, p) : bound.delete(t)), route: (t) => bound.get(t) || { id: "main", fallback: true } }; };
const drain = async (gen, input) => { let last = null; for await (const x of gen.generate(input)) last = x; return last; };

// ── 1 · the floor generates, deterministically, never throws ───────────────────────────────────────────
{
  const floor = makeBrainFloor("create");
  let threw = false, out = null;
  try { out = await drain(floor, "a todo app"); } catch (e) { threw = true; }
  ok("floorGeneratesNeverThrows", !threw && out && out.phase === "final" && typeof out.value === "string" && out.value.includes("todo app") && out.floor === true);
}

// ── 2 · ensure fills an uncovered task: fatal fallback → usable floor ───────────────────────────────────
{
  const mux = freshMux();
  const before = mux.route("create");
  const e = ensureBrainFloor({ route: mux.route, bind: mux.bind, tasks: ["create", "ask"] });
  const after = mux.route("create");
  ok("ensureFillsUncoveredTasks", before.fallback === true && e.ensured.includes("create") && after.fallback !== true && typeof after.generate === "function" && after.floor === true);
}

// ── 3 · after ensure, EVERY core task routes to a usable provider (no fatal fallback anywhere) ─────────
{
  const mux = freshMux();
  ensureBrainFloor({ route: mux.route, bind: mux.bind, tasks: ["create", "ask", "title-gen"] });
  const usable = ["create", "ask", "title-gen"].every((t) => { const p = mux.route(t); return p && p.fallback !== true && typeof p.generate === "function"; });
  ok("routeAlwaysUsableAfter", usable);
}

// ── 4 · ensure NEVER clobbers a real brain already bound ───────────────────────────────────────────────
{
  const mux = freshMux();
  const realBrain = { id: "qwen-coder", generate: async function* () { yield { phase: "final", value: "REAL" }; } };
  mux.bind("create", realBrain);
  const e = ensureBrainFloor({ route: mux.route, bind: mux.bind, tasks: ["create", "ask"] });
  ok("neverClobbersARealBrain", mux.route("create").id === "qwen-coder" && !e.ensured.includes("create") && e.ensured.includes("ask"));
}

// ── 5 · silent UPGRADE: swap the floor for a real brain ────────────────────────────────────────────────
{
  const mux = freshMux();
  const e = ensureBrainFloor({ route: mux.route, bind: mux.bind, tasks: ["ask"] });
  const onFloor = mux.route("ask").floor === true;
  const realBrain = { id: "boost-llm", generate: async function* () { yield { phase: "final", value: "REAL ANSWER" }; } };
  e.upgrade("ask", realBrain);
  ok("silentUpgradeOverFloor", onFloor && mux.route("ask").id === "boost-llm" && mux.route("ask").floor !== true);
}

// ── 6 · governed self-acquire: binds only when on the floor; a refused acquire keeps the floor (no throw) ─
{
  const mux = freshMux();
  const e = ensureBrainFloor({ route: mux.route, bind: mux.bind, tasks: ["create"] });
  // a refused acquire (authorization denied) → returns null → the floor must stay, no throw
  const refused = await e.acquireMissing("create", async () => null);
  const floorStays = mux.route("create").floor === true && refused.acquired === false;
  // an authorized acquire → binds the acquired specialist
  const acquired = await e.acquireMissing("create", async () => ({ id: "acquired:coder", generate: async function* () { yield { phase: "final", value: "x" }; } }));
  const upgraded = mux.route("create").id === "acquired:coder";
  // and once a real brain is bound, acquireMissing is a no-op (won't re-acquire)
  const noop = await e.acquireMissing("create", async () => { throw new Error("should not be called"); });
  ok("acquireOnlyWhenOnFloor", floorStays && acquired.acquired === true && upgraded && noop.acquired === false);
}

// ── 7 · the floor is DETERMINISTIC (same input ⇒ same output) ──────────────────────────────────────────
{
  const a = makeBrainFloor("create").respond("a pricing page");
  const b = makeBrainFloor("create").respond("a pricing page");
  ok("floorIsDeterministic", a === b && a.length > 0);
}

// ── 8 · the floor is HONEST: `ask` does not fabricate; it says no model is loaded ─────────────────────
{
  const ans = makeBrainFloor("ask").respond("what is the capital of France?");
  ok("floorIsHonest", /no.*model|don't have a (language )?model/i.test(ans) && !/paris/i.test(ans));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "Holo Brain Floor (S3, guarantee a brain) — a deterministic zero-download floor specialist is bound to every core task so the mux ALWAYS resolves to something usable (Q.create/Q.ask never throw 'no specialist bound'); a real brain silently upgrades over the floor; a governed self-acquire fills a gap when possible and keeps the floor when refused; the floor never downloads, never hallucinates (honest 'no model loaded'), never throws, and is deterministic (Law L5)",
  authority: "the holo-q-mux bind/route routing contract (ADR-0084/0085) · the skill-acquire path (discover → authorize → forge → bind) · holospaces Laws L2/L5",
  witnessed,
  covers: witnessed ? ["brain-floor", "never-no-specialist-throw", "always-usable-route", "silent-upgrade", "governed-acquire", "honest-floor", "deterministic"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-brain-floor-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Brain Floor witness — S3 guarantee a brain (Q always answers)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  Q always has a brain — floor underneath, real brains upgrade over it, never a throw" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
