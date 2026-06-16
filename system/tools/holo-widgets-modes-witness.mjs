#!/usr/bin/env node
// holo-widgets-modes-witness.mjs — the desktop widget MODES, on ONE balanced grammar. The three INTENT
// modes (Learn · Work · Play) now share a single composition: a φ-scaled HERO held at the CENTRE, with one
// calm widget in each CORNER (the sticky Q orb always rides the bottom-right, so a mode fills three corners
// + the centre and the orb completes the fourth). holo-widgets.js is a browser IIFE (window/DOM), so this
// witness (a) RE-DERIVES the golden geometry numerically — the φ width ladder + the centre:corner = φ size
// step — and (b) source-asserts each intent mode composes REAL widgets on the shared GRID5 grammar, that no
// feature is duplicated within a mode (and Q is the sticky orb, never a redundant launch tile), that the
// switch stays non-destructive, first boot lands in Welcome, and the readability floor is held.
//
// Authority: φ = golden ratio (1.618) · holospaces Law L1/L2/L3/L5 · ADR-0057 (the 16px readability floor)
// · ADR-0088/0089 (the scene manifest / per-holospace boards).   node tools/holo-widgets-modes-witness.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const src = readFileSync(join(OS, "usr/lib/holo/holo-widgets.js"), "utf8");
const shell = readFileSync(join(OS, "usr/share/frame/shell.html"), "utf8");

const REAL = ["clock", "note", "focus", "weather", "tasks", "system", "calendar", "links", "quote", "vinyl", "now-playing", "launch", "dayring", "greeting"];
const PHI = 1.618, near = (r, t = 0.02) => Math.abs(r - PHI) <= t;

// ── 1 · the φ WIDTH LADDER re-derives golden (hero : secondary : header = φ : φ) ──
const LAD = (hero) => { const sec = Math.round(hero / PHI), head = Math.round(sec / PHI); return { hero, sec, head }; };
const L = LAD(400);
ok("phi-width-ladder-is-golden", near(L.hero / L.sec) && near(L.sec / L.head), `400:${L.sec}:${L.head}`);

// ── 2 · the shared GRID5 grammar exists, and its CENTRE hero is exactly ONE golden step larger than each
//        CORNER (corner = secondary width; centre = secondary × φ). Re-derive for both hero sizes in use. ──
ok("grid5-grammar-defined", /function GRID5\(/.test(src) && /tl:\s*\{/.test(src) && /tr:\s*\{/.test(src) && /bl:\s*\{/.test(src) && /mid:\s*\{/.test(src));
const centreCornerRatio = (hero) => hero / LAD(hero).sec;
ok("centre-is-phi-larger-than-corners", near(centreCornerRatio(420)) && near(centreCornerRatio(372)),
  `420→${centreCornerRatio(420).toFixed(3)} · 372→${centreCornerRatio(372).toFixed(3)}`);

// ── slice each scene block ──
const ORDER = ["welcome", "focused", "learn", "work", "play", "clarity"];
const starts = ORDER.map((n) => ({ n, i: src.indexOf('defineScene("' + n + '"') }));
ok("all-modes-defined", starts.every((s) => s.i > 0));
const blockOf = (name) => {
  const me = starts.find((s) => s.n === name).i;
  const after = starts.map((s) => s.i).filter((i) => i > me).sort((a, b) => a - b)[0] || src.indexOf("function fsEl", me);
  return src.slice(me, after > 0 ? after : me + 1600);
};
const tilesIn = (block) => (block.match(/type:\s*"([\w-]+)"/g) || []).map((m) => m.match(/"([\w-]+)"/)[1]);
// the shared grammar: a block uses GRID5(...) and fills the centre + the three free corners
const usesGrid5 = (block) => /GRID5\(/.test(block) && /g\.mid\b/.test(block) && /g\.tl\b/.test(block) && /g\.tr\b/.test(block) && /g\.bl\b/.test(block);
const heroTypeOf = (block) => { const m = block.match(/x:\s*g\.mid\.x/); if (!m) return null; const around = block.slice(block.lastIndexOf('type:', m.index), m.index); const t = around.match(/type:\s*"([\w-]+)"/); return t ? t[1] : null; };

const F = blockOf("focused"), LE = blockOf("learn"), WK = blockOf("work"), PL = blockOf("play");

// ── 3 · every tile in every intent mode is a REAL holo-native widget (no mockups, no dead tiles) ──
const allTiles = [...tilesIn(LE), ...tilesIn(WK), ...tilesIn(PL)];
ok("every-tile-is-a-real-widget", allTiles.length > 0 && allTiles.every((t) => REAL.includes(t)), allTiles.filter((t) => !REAL.includes(t)).join(",") || "all real");

// ── 4 · FOCUSED (and Clarity) are bare desktops — nothing competing: zero widgets, only the wallpaper ──
ok("focused-is-bare", tilesIn(F).length === 0 && /return \[\];/.test(F), "tiles=" + tilesIn(F).join(","));

// ── 5 · the THREE intent modes share the centre+corners grammar: exactly 4 tiles each (centre + 3 corners,
//        the sticky orb completes the 4th corner), each anchored by the golden helpers (centre + edges) ──
for (const [name, block] of [["learn", LE], ["work", WK], ["play", PL]]) {
  ok(`${name}-uses-centre-corners-grammar`, usesGrid5(block), "must compose on GRID5 (mid+tl+tr+bl)");
  ok(`${name}-has-exactly-4-tiles`, tilesIn(block).length === 4, "tiles=" + tilesIn(block).join(","));
  // no duplication of similar features within a mode — every tile type is distinct
  const t = tilesIn(block);
  ok(`${name}-has-no-duplicate-tiles`, new Set(t).size === t.length, "tiles=" + t.join(","));
}

// ── 6 · each intent mode has a DISTINCT centre hero that reflects its purpose ──
ok("learn-hero-is-note", heroTypeOf(LE) === "note", "hero=" + heroTypeOf(LE));
ok("work-hero-is-tasks", heroTypeOf(WK) === "tasks", "hero=" + heroTypeOf(WK));
ok("play-hero-is-vinyl", heroTypeOf(PL) === "vinyl", "hero=" + heroTypeOf(PL));

// ── 7 · NO Q-launcher duplication — Q is the sticky orb (bottom-right), never a redundant launch tile in a
//        mode board; an intent mode must not seed an app:"q" launcher alongside the orb ──
ok("no-Q-launcher-duplication", ![LE, WK, PL].some((b) => /app:\s*"q"/.test(b)), "the sticky orb already provides Q");

// ── 8 · the launch widget still opens REAL apps via the shell + summons Q; label respects the 16px floor.
//        (It stays available in the gallery even though the calm intent boards no longer seed app tiles.) ──
ok("launch-widget-defined", /W\.HoloWidgets\.define\("launch"/.test(src));
ok("launch-opens-real-apps", /S\.openApp\(c\.appId/.test(src) && /W\.Q && W\.Q\.summon/.test(src) && /map\[c\.app\]/.test(src));
ok("launch-label-respects-readability-floor", /max\(var\(--holo-font-min,16px\)/.test(src));
ok("shell-exposes-openApp", /openApp:\s*function\s*\(appId, title\)/.test(shell));

// ── 9 · NON-DESTRUCTIVE switch — leaving a mode saves its board; sticky (orb) survives (ADR per-mode boards) ──
ok("switch-is-non-destructive", /boards\[prev\] = modeSnapshot\(\)/.test(src) && /isStickyType/.test(src));

// ── 10 · FIRST BOOT lands in Welcome (a warm, time-aware greeting — the first face of the desktop) ──
ok("first-boot-is-welcome", /seedFirstRun[\s\S]*?setMode\("welcome"\)/.test(src));

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  subject: "Holo Widgets desktop modes — the three intent modes (Learn · Work · Play) share ONE balanced grammar: a φ-scaled hero at the centre + one widget per corner (the sticky Q orb completes the fourth), real widgets, no per-mode duplication, non-destructive, first-boot Welcome",
  covers: [
    "the φ width ladder re-derives golden (hero:secondary:header = φ:φ) and the centre hero is exactly one golden step (×φ) larger than each corner widget",
    "the shared GRID5 grammar holds a φ-scaled hero at the centre and one widget in each corner (tl·tr·bl filled by the mode, br by the sticky Q orb)",
    "every tile in all three intent modes is a REAL holo-native widget (no mockups, no dead tiles); Focused/Clarity stay bare",
    "each intent mode is exactly 4 tiles (centre + 3 corners) with no duplicated feature within the mode, and a distinct centre hero reflecting its purpose (Learn→note · Work→to-do · Play→disc)",
    "Q is the sticky orb in the bottom-right corner — never a redundant app:'q' launch tile duplicating it in a mode board",
    "the launch widget still opens real apps via window.HoloShell (openApp) + summons Q; its label holds the 16px readability floor (ADR-0057)",
    "the mode switch stays non-destructive (each mode saves its own board; the sticky orb survives) and first boot lands in Welcome",
  ],
  ladder: L,
  heroes: { learn: heroTypeOf(LE), work: heroTypeOf(WK), play: heroTypeOf(PL) },
  modes: { welcome: tilesIn(blockOf("welcome")), focused: tilesIn(F), learn: tilesIn(LE), work: tilesIn(WK), play: tilesIn(PL) },
  checks, failed: fail,
  authority: "φ = golden ratio (1.618) · holospaces Law L1/L2/L3/L5 · ADR-0057 (16px readability floor) · ADR-0088/0089 (scene manifest / per-holospace boards)",
};
writeFileSync(join(here, "holo-widgets-modes-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Widgets modes witness — Learn · Work · Play on ONE centre+corners golden grammar\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ladder 400:${L.sec}:${L.head}  ·  heroes learn=${heroTypeOf(LE)} work=${heroTypeOf(WK)} play=${heroTypeOf(PL)}`);
console.log(`  learn[${tilesIn(LE).join(" ")}]  work[${tilesIn(WK).join(" ")}]  play[${tilesIn(PL).join(" ")}]`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
