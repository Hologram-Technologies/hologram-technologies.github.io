#!/usr/bin/env node
// holo-nav-witness.mjs — PROVE the ONE navigation model that fixes wall #4 (three surfaces — mobile home,
// desktop shell, app frame — each navigate differently; the app frame is a dead end with no back/home). The
// simplification: a single nav state machine over the player, so EVERY surface shares one model —
// home(wall) ⇄ open(play) with a back-history, continue resumes, and home() ALWAYS returns to the wall (a
// guaranteed escape — she can never get stuck). The three surfaces become skins of this one model: each
// just wires a back button, a home button, and a render to onChange. Abstract complexity → one seam.
//
// Checks: starts at home; open plays + pushes history; back returns then to home; canBack reflects depth;
// continue resumes; home always escapes (no dead end); onChange fires; deterministic.
//   node tools/holo-nav-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeNav } from "../os/usr/lib/holo/holo-nav.mjs";
import { makePlayer } from "../os/usr/lib/holo/holo-player.mjs";
import { kappaOf } from "../os/usr/lib/holo/holo-kappa-stream.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const enc = (s) => new TextEncoder().encode(s);
const checks = {};

const A = await kappaOf(enc("app-A")), B = await kappaOf(enc("app-B")), C = await kappaOf(enc("app-C"));
const STATE = await kappaOf(enc("resume-state"));
const W = [await kappaOf(enc("w1")), await kappaOf(enc("w2")), await kappaOf(enc("w3"))];
const content = new Map([[A, enc("a")], [B, enc("b")], [C, enc("c")], [STATE, enc("s")], ...W.map((k) => [k, enc("w")])].map(([k, v]) => [String(k).split(":").pop(), v]));
const resolve = async (k) => content.get(String(k).split(":").pop()) || null;
const newNav = () => makeNav({ player: makePlayer({ resolve }), wallKappas: W });

// ── 1 · starts at home (the wall) ────────────────────────────────────────────────────────────────
{
  const nav = newNav();
  const v = nav.current();
  checks.startsAtHome = v.kind === "home" && Array.isArray(v.wall) && v.wall.length === 3 && nav.canBack() === false;
}

// ── 2 · open plays and pushes history ─────────────────────────────────────────────────────────────
{
  const nav = newNav();
  const v = await nav.open(A, { kind: "app" });
  checks.openPlays = v.kappa === A && v.kind === "app" && nav.history().length === 1 && nav.canBack() === true;
}

// ── 3 · back returns to the previous view, then to home ──────────────────────────────────────────
{
  const nav = newNav();
  await nav.open(A, { kind: "app" });
  await nav.open(B, { kind: "app" });
  const back1 = nav.back();
  const back2 = nav.back();
  checks.backReturns = back1.kappa === A && back2.kind === "home";
}

// ── 4 · canBack reflects whether there is anywhere to go back to ──────────────────────────────────
{
  const nav = newNav();
  const atHome = nav.canBack();
  await nav.open(A, {});
  const afterOpen = nav.canBack();
  nav.back();
  checks.canBackReflects = atHome === false && afterOpen === true && nav.canBack() === false;
}

// ── 5 · continue resumes the exact prior state ───────────────────────────────────────────────────
{
  const nav = newNav();
  const v = await nav.cont(A, STATE, { kind: "app" });
  checks.continueResumes = v.kappa === STATE && v.resumed === true;
}

// ── 6 · home ALWAYS escapes — from anywhere, back to the wall, no dead end ─────────────────────────
{
  const nav = newNav();
  await nav.open(A, {}); await nav.open(B, {}); await nav.open(C, {});
  const v = nav.home();
  checks.homeAlwaysEscapes = v.kind === "home" && nav.history().length === 0 && nav.canBack() === false;
}

// ── 7 · onChange fires on every navigation ───────────────────────────────────────────────────────
{
  const nav = newNav();
  let n = 0; const off = nav.onChange(() => n++);
  await nav.open(A, {}); await nav.open(B, {}); nav.back(); nav.home();
  off();
  checks.onChangeFires = n === 4;
}

// ── 8 · deterministic: same sequence ⇒ same current + history depth ───────────────────────────────
{
  const run = async () => { const nav = newNav(); await nav.open(A, {}); await nav.open(B, {}); nav.back(); return nav.current().kappa + ":" + nav.history().length; };
  checks.deterministic = (await run()) === (await run());
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-nav-witness.result.json"), JSON.stringify({
  spec: "One navigation model over the player: home(wall) ⇄ open(play) with back-history, continue resumes, home() always returns to the wall (guaranteed escape, no dead end). The three surfaces (mobile home, shell, app frame) become skins of this one model — each wires a back button, a home button, and a render to onChange. Fixes wall #4 (fragmented, dead-end navigation).",
  authority: "the friction audit (this session, wall #5/#4) · holo-player (committed) · consistent back/home UX",
  witnessed,
  covers: witnessed ? ["one-nav-model", "starts-home", "open-plays", "back-history", "can-back", "continue-resume", "home-always-escapes", "onchange", "deterministic"] : [],
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ one nav model, every surface a skin — open, back, and always home; no dead ends" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
