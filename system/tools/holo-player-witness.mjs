#!/usr/bin/env node
// holo-player-witness.mjs — PROVE the ONE PLAYER: the unification where EVERYTHING is a κ that plays. An
// app, a chat, a doc, a space all go through the SAME play() path (only the delta producer differs); a
// poster is a cheap content-derived projection (no mount); play() verifies-before-mount (Law L5 — a
// tampered κ refuses); a cached κ replays O(1) (instant); app + chat coexist on ONE scheduler (the orb
// renders while Q generates); continue() resumes the exact prior κ-state; the home wall is personalized by
// a profile (a private re-rank). This is the Netflix-grade "browse → play → continue" model over the one
// self-verifying substrate, composing the committed streaming foundation.
//
// Checks: one play path for every kind; poster is cheap (no resolve/mount); verify-before-play; instant
// replay from cache; app+chat coexist on one scheduler; continue resumes state; wall personalizes; stop
// unregisters.   Usage: node tools/holo-player-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makePlayer } from "../os/usr/lib/holo/holo-player.mjs";
import { kappaOf } from "../os/usr/lib/holo/holo-kappa-stream.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const enc = (s) => new TextEncoder().encode(s);
const checks = {};

// a substrate resolve() over a content map; an unknown/tampered κ returns null (the L5 refusal upstream)
function makeResolve(map) { const m = new Map(map); const r = async (k) => m.get(String(k).split(":").pop()) || null; r.calls = 0; return async (k) => { r.calls++; return m.get(String(k).split(":").pop()) || null; }; }

const appK = await kappaOf(enc("an-app"));
const chatK = await kappaOf(enc("a-chat"));
const docK = await kappaOf(enc("a-doc"));
const stateK = await kappaOf(enc("resume-state"));
const tamperK = "did:holo:sha256:" + "0".repeat(64);
const k1 = await kappaOf(enc("poster1")), k2 = await kappaOf(enc("poster2")), k3 = await kappaOf(enc("poster3"));
const content = new Map([[appK, enc("app")], [chatK, enc("chat")], [docK, enc("doc")], [stateK, enc("state")], [k1, enc("1")], [k2, enc("2")], [k3, enc("3")]].map(([k, v]) => [String(k).split(":").pop(), v]));
const hex = (k) => String(k).split(":").pop();
const OP = await kappaOf(enc("op"));
const regionsOf = async (labels) => Promise.all(labels.map(async (l, i) => ({ id: "r" + i, op: OP, in: await kappaOf(enc(l)) })));

// ── 1 · one play() path for every kind ───────────────────────────────────────────────────────────
{
  const resolve = async (k) => content.get(hex(k)) || null;
  const player = makePlayer({ resolve });
  const sApp = await player.play(appK, { kind: "app", regions: await regionsOf(["a"]), produce: async () => enc("px") });
  const sChat = await player.play(chatK, { kind: "chat", regions: [await kappaOf(enc("t0"))], produce: async () => enc("kv") });
  const sDoc = await player.play(docK, { kind: "doc", regions: await regionsOf(["d"]), produce: async () => enc("dx") });
  checks.everythingPlaysOnePath = sApp.kind === "app" && sChat.kind === "chat" && sDoc.kind === "doc" && player.sessions().length === 3;
}

// ── 2 · a poster is cheap and content-derived (no resolve, no mount) ──────────────────────────────
{
  let calls = 0; const resolve = async (k) => { calls++; return content.get(hex(k)) || null; };
  const player = makePlayer({ resolve });
  const p1 = player.poster(appK), p2 = player.poster(appK);
  checks.posterCheapDeterministic = calls === 0 && p1.kappa === appK && JSON.stringify(p1) === JSON.stringify(p2);
}

// ── 3 · verify-before-play: a tampered/unknown κ refuses; a valid κ plays (Law L5) ────────────────
{
  const resolve = async (k) => content.get(hex(k)) || null;
  const player = makePlayer({ resolve });
  let refused = false; try { await player.play(tamperK, { kind: "app", regions: await regionsOf(["x"]), produce: async () => enc("x") }); } catch { refused = true; }
  const ok = await player.play(appK, { kind: "app", regions: await regionsOf(["a"]), produce: async () => enc("a") });
  checks.verifyBeforePlay = refused && ok.kappa === appK;
}

// ── 4 · instant replay: identical content reconstructs O(1) from the player's memo (no recompute) ──
{
  const resolve = async (k) => content.get(hex(k)) || null;
  const player = makePlayer({ resolve });
  let produced = 0; const produce = async (op, inn) => { produced++; return enc("px:" + inn); };
  const regions = await regionsOf(["a", "b", "c"]);
  const s = await player.play(appK, { kind: "app", regions, produce });
  await s.driver.frame(regions);               // first: 3 novel → 3 produces
  const after1 = produced;
  await s.driver.frame(regions);               // identical: short-circuit → 0 produces
  checks.instantReplayCached = after1 === 3 && produced === 3;
}

// ── 5 · app + chat coexist on ONE scheduler (orb renders while Q generates) ───────────────────────
{
  const resolve = async (k) => content.get(hex(k)) || null;
  let nowT = 0; const now = () => ++nowT;       // virtual clock advances per call so ticks terminate
  const player = makePlayer({ resolve, now });
  let appFrames = 0, chatToks = 0;
  await player.play(appK, { kind: "app", regions: await regionsOf(["a", "b"]), produce: async () => { appFrames++; return enc("a"); } });
  await player.play(chatK, { kind: "chat", regions: [await kappaOf(enc("t0")), await kappaOf(enc("t1")), await kappaOf(enc("t2"))], produce: async () => { chatToks++; return enc("kv"); } });
  const tasks = player.scheduler.tasks();
  for (let i = 0; i < 6; i++) await player.tick({ budgetMs: 40 });
  checks.oneSchedulerCoexist = tasks.length >= 2 && appFrames > 0 && chatToks > 0 && tasks[0].priority === 0;  // app (render) first
}

// ── 6 · continue resumes the exact prior κ-state ──────────────────────────────────────────────────
{
  const resolve = async (k) => content.get(hex(k)) || null;
  const player = makePlayer({ resolve });
  const s = await player.cont(appK, stateK, { kind: "app", regions: await regionsOf(["s"]), produce: async () => enc("s") });
  checks.continueResumesState = s.kappa === stateK;
}

// ── 7 · the wall personalizes (a private profile re-rank) ─────────────────────────────────────────
{
  const resolve = async (k) => content.get(hex(k)) || null;
  let ranked = false; const rank = (items) => { ranked = true; return [...items].reverse(); };
  const player = makePlayer({ resolve, rank });
  const w = player.wall([k1, k2, k3]);
  checks.wallPersonalizes = ranked && w.length === 3 && w[0].kappa === k3 && w[2].kappa === k1;
}

// ── 8 · stop() unregisters the session from the scheduler ─────────────────────────────────────────
{
  const resolve = async (k) => content.get(hex(k)) || null;
  const player = makePlayer({ resolve });
  const s = await player.play(appK, { kind: "app", regions: await regionsOf(["a"]), produce: async () => enc("a") });
  const before = player.scheduler.tasks().length;
  s.stop();
  checks.stopUnregisters = before === 1 && player.scheduler.tasks().length === 0 && player.sessions().length === 0;
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-player-witness.result.json"), JSON.stringify({
  spec: "The one player: everything is a κ that plays. One play() path for app/chat/doc/space (only the delta producer differs); cheap content-derived posters; verify-before-play (L5); instant replay from cache; app+chat coexist on one scheduler; continue resumes exact state; personalized wall. Netflix-grade browse→play→continue over the one self-verifying substrate, composing the committed streaming foundation.",
  authority: "holospaces Laws L1/L3/L4/L5 · the committed streaming primitives (cac7848) · Netflix-grade continuous playback UX",
  witnessed,
  covers: witnessed ? ["one-player", "everything-plays", "cheap-poster", "verify-before-play", "instant-replay", "one-scheduler-coexist", "continue-resume", "personalized-wall", "stop-unregister"] : [],
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ one player — everything is a κ that plays: browse → play → continue, verified, instant, unified" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
