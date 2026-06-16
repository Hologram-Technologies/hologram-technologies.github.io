// holo-playground-games-witness.mjs — proves Holo Playground 3.0, Stage 3: MINI-GAMES on the screen's own objects
// (Whack · Match) behind a pluggable game host, plus the canvas polish that makes the screen a real playground —
// marquee MULTI-SELECT and SCALE / ROTATE handles. The pure game LOGIC is deterministic (seeded, no random / no
// Date / no DOM) and the selection + handle GEOMETRY is pure arithmetic, so both are witnessed with no browser.
// The structural invariant — a game runs in its OWN private session and can NEVER seal — is checked via the
// browser host's inert stub (no document ⇒ no-op) and the absence of any sealer on the pure logic.
//
// Run: node system/tools/holo-playground-games-witness.mjs

import { createWhackLogic, createMatchLogic, GAMES, gameById, objectKey, createGameHost } from "../os/usr/lib/holo/holo-playground-games.mjs";
import { rectsIntersect, scaleFromHandle, rotateFromPointer, angleOf } from "../os/usr/lib/holo/holo-playground-canvas.mjs";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {};
let pass = 0, fail = 0, kn = 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const ok = (n, c, x = "") => { (c ? pass++ : fail++); checks[(slug(n) || "check") + "-" + (++kn)] = !!c; console.log((c ? "  ok  " : " FAIL ") + n + (x ? "  — " + x : "")); };
const approx = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// ── 1) WHACK — a seeded, reproducible pop sequence; tap the one that's up to score, miss otherwise ───────────
{
  const a = createWhackLogic({ count: 4, rounds: 3, seed: 7 });
  const seqA = [a.popNext(), a.popNext(), a.popNext()];
  const overTap = a.popNext();
  const b = createWhackLogic({ count: 4, rounds: 3, seed: 7 });
  const seqB = [b.popNext(), b.popNext(), b.popNext()];
  ok("whack pop sequence is DETERMINISTIC for a seed (reproducible, no Math.random)", JSON.stringify(seqA) === JSON.stringify(seqB) && seqA.every((i) => i >= 0 && i < 4));
  ok("whack ends after its rounds (popNext → -1, over)", overTap === -1 && a.isOver() === true);

  const g = createWhackLogic({ count: 4, rounds: 5, seed: 7 });
  const up = g.popNext();
  const hit = g.tap(up);
  ok("tapping the popped object scores a hit (+1)", hit.hit === true && g.state().score === 1);
  const miss = g.tap((up + 1) % 4);
  ok("tapping any other object is a miss (score unchanged, misses+1)", miss.hit === false && g.state().score === 1 && g.state().misses === 1);
}

// ── 2) MATCH — pick two; equal keys clear the pair and score; win when all pairs are cleared ─────────────────
{
  const m = createMatchLogic({ keys: ["a", "b", "a", "b"] });
  ok("first pick is pending (one card up)", m.pick(0).pending === true);
  const r = m.pick(2);
  ok("a matching second pick clears the pair and scores (not yet won)", r.match && r.score === 1 && r.won === false);
  m.pick(1); const w = m.pick(3);
  ok("clearing the last pair WINS", w.match && w.won === true && m.isWon() === true);

  const m2 = createMatchLogic({ keys: ["a", "b", "a", "b"] });
  m2.pick(0); const miss = m2.pick(1);
  ok("a non-matching pair is a miss (no score, picks reset)", miss.miss && m2.state().score === 0 && m2.state().picks.length === 0);
  m2.pick(0); ok("re-picking an already-up card is ignored", m2.pick(0).ignored === true);
}

// ── 3) the data-driven GAME REGISTRY + the matching key signature ────────────────────────────────────────────
ok("the registry ships Whack and Match as DATA presets; unknown → null", gameById("whack") && gameById("match") && GAMES.length >= 2 && gameById("nope") === null);
ok("objectKey signs an object by tag + first class (so Match pairs look-alikes)", objectKey({ localName: "p", className: "title big" }) === "p.title" && objectKey({ localName: "div", className: "" }) === "div.");

// ── 4) MARQUEE selection geometry — rectsIntersect (pure hit-test) ───────────────────────────────────────────
ok("rectsIntersect: overlapping rects select", rectsIntersect({ left: 0, top: 0, right: 100, bottom: 100 }, { left: 50, top: 50, right: 150, bottom: 150 }) === true);
ok("rectsIntersect: disjoint rects don't select", rectsIntersect({ left: 0, top: 0, right: 40, bottom: 40 }, { left: 50, top: 50, right: 90, bottom: 90 }) === false);

// ── 5) SCALE / ROTATE handle math — pure, clamped ────────────────────────────────────────────────────────────
const C = { x: 0, y: 0 };
ok("scaleFromHandle grows as a corner is pulled away from centre (2× at double distance)", approx(scaleFromHandle({ x: 10, y: 0 }, { x: 20, y: 0 }, C, 1), 2));
ok("scaleFromHandle is clamped (can't invert or explode)", scaleFromHandle({ x: 10, y: 0 }, { x: 0, y: 0 }, C, 1) === 0.2 && scaleFromHandle({ x: 10, y: 0 }, { x: 9999, y: 0 }, C, 1) === 6);
ok("angleOf measures a pointer's angle around the centre", approx(angleOf(C, { x: 0, y: 10 }), 90) && approx(angleOf(C, { x: 10, y: 0 }), 0));
ok("rotateFromPointer gives the RELATIVE turn from the grab angle (+ base)", approx(rotateFromPointer(C, { x: 10, y: 0 }, { x: 0, y: 10 }, 0), 90));

// ── 6) THE INVARIANT — a game can NEVER seal: the browser host is inert without a document, the logic has no sealer ─
const inert = createGameHost({});
ok("createGameHost is a no-op without a document (start → false, never running)", inert.start("whack") === false && inert.isRunning() === false);
ok("the pure game logic exposes NO sealer / publish (games run in a private session, never reach the κ)",
  typeof createWhackLogic({}).seal === "undefined" && typeof createMatchLogic({}).publish === "undefined" && typeof createWhackLogic({}).commit === "undefined");

const result = { "@type": "earl:TestResult", witnessed: fail === 0,
  subject: "Holo Playground 3.0 (Stage 3) — MINI-GAMES on the screen's own objects (Whack · Match) behind a pluggable data-driven game host, plus marquee MULTI-SELECT and SCALE / ROTATE handles. A game is the most ephemeral activity in Playground: it runs in its OWN private play session (separate from the surface's editable session), so it can NEVER seal — quitting restores the screen exactly. The pure game logic is deterministic (seeded LCG, no random/Date/DOM); the selection + handle geometry (rectsIntersect, scaleFromHandle, rotateFromPointer) is pure arithmetic; multi-select / handle / game chrome is [data-holo-ephemeral] + holo-pg-* classes that cleanClass strips, so none of it ever seals (L5)",
  covers: ["whack (deterministic pops + scoring)", "match (pairing + win + miss + ignore)", "data-driven game registry + objectKey", "marquee rectsIntersect", "scale/rotate handle math (clamped)", "a game never seals (inert host + no sealer)"],
  passed: pass, failed: fail, checks };
writeFileSync(join(here, "holo-playground-games-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("\n" + (fail === 0 ? "PASS" : "FAIL") + " — " + pass + " ok, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
