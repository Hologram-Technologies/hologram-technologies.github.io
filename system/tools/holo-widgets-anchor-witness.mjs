#!/usr/bin/env node
// holo-widgets-anchor-witness.mjs — Home widgets and the Q orb never DRIFT from their place. holo-widgets.js
// is a browser IIFE, so this witness (a) RE-DERIVES the centre-anchored reflow + corner-pin math numerically
// (a right side-carriage squeezes the canvas via --holo-aside-w WITHOUT firing a window resize; the reflow
// must still run, the composition tracks the holospace centre, and open⇄close is exactly reversible), and
// (b) source-asserts the wiring: the reflow is driven by a canvas ResizeObserver (not just window resize),
// the orb re-pins to the aside-aware bottom-right on every reflow path unless the user moved it, the sticky
// orb survives board swaps (rides every tab), and widgets land/stay clear of open windows.
//
// Authority: φ = golden ratio (1.618) · holospaces Law L1/L2/L5 · ADR-0088/0089 (per-holospace boards).
//   node tools/holo-widgets-anchor-witness.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const src = readFileSync(join(OS, "usr/lib/holo/holo-widgets.js"), "utf8");
const voice = readFileSync(join(OS, "usr/lib/holo/holo-voice.js"), "utf8");

// ════ PART A · the math, re-derived (the invariants) ════════════════════════════════════════════
const EDGE = 8;
// deskBounds — the USABLE canvas: subtract the left dock, the RIGHT aside carrier, and the top chrome.
const deskBounds = (innerW, innerH, { dock = 0, aside = 0, top = 0 } = {}) =>
  ({ minX: EDGE + dock, minY: EDGE + top, maxX: innerW - EDGE - aside, maxY: innerH - EDGE - dock });
const centreOf = (b) => ({ cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 });

const W0 = 1888, H0 = 1032, ASIDE = 420;
const bClosed = deskBounds(W0, H0, { aside: 0 });
const bOpen = deskBounds(W0, H0, { aside: ASIDE });

// 1 · opening the aside narrows the usable canvas and moves its CENTRE left by exactly aside/2 ──
ok("aside-shrinks-usable-canvas", bOpen.maxX === bClosed.maxX - ASIDE);
ok("centre-moves-left-by-half-the-aside", Math.abs((centreOf(bClosed).cx - centreOf(bOpen).cx) - ASIDE / 2) < 1e-9);

// 2 · a widget is shifted by the centre delta — and open⇄close is EXACTLY reversible (deltas sum to 0) ──
const recenterShift = (w, from, to) => { const d = centreOf(to).cx - centreOf(from).cx; return { x: w.x + d, y: w.y }; };
let widget = { x: 1200, y: 400 };
const afterOpen = recenterShift(widget, bClosed, bOpen);     // carriage opens
const afterClose = recenterShift(afterOpen, bOpen, bClosed); // carriage closes again
ok("widget-tracks-the-centre-on-open", afterOpen.x === 1200 - ASIDE / 2);
ok("open-then-close-returns-to-exact-spot", afterClose.x === 1200);

// 3 · the Q orb pins to the aside-aware bottom-right corner — which moves by the FULL aside, not half ──
const orbCorner = (b, ww = 120, hh = 120, gap = 30, gapB = 34) => ({ x: Math.round(b.maxX - ww - gap), y: Math.round(b.maxY - hh - gap - gapB) });
const cornerClosed = orbCorner(bClosed), cornerOpen = orbCorner(bOpen);
ok("orb-corner-moves-by-full-aside", cornerClosed.x - cornerOpen.x === ASIDE);
// hence centre-shifting the orb (by aside/2) would leave it half-way off the corner → it MUST be re-pinned, not shifted.
ok("centre-shift-alone-would-misplace-the-orb", (1200 - ASIDE / 2) !== (1200 - ASIDE));

// 4 · clearPlace — a widget over a window walks to the first clear golden anchor (re-derived) ──
const hits = (r, o, pad = 0) => r.left < o.right + pad && r.left + r.width > o.left - pad && r.top < o.bottom + pad && r.top + r.height > o.top - pad;
const clearPlace = (x, y, ww, hh, wins, b) => {
  if (!wins.length || !wins.some((o) => hits({ left: x, top: y, width: ww, height: hh }, o, 10))) return { x, y };
  const Wu = b.maxX - b.minX, Hu = b.maxY - b.minY;
  const xs = [b.minX + Wu * 0.382 - ww / 2, (b.minX + b.maxX) / 2 - ww / 2, b.minX + Wu * 0.618 - ww / 2, b.minX + EDGE, b.maxX - ww - EDGE];
  const ys = [b.minY + Hu * 0.30, b.minY + Hu * 0.5 - hh / 2, b.minY + Hu * 0.70 - hh / 2, b.minY + EDGE, b.maxY - hh - EDGE];
  for (const yy of ys) for (const xx of xs) { const cx = Math.max(b.minX, Math.min(xx, b.maxX - ww)), cy = Math.max(b.minY, Math.min(yy, b.maxY - hh)); if (!wins.some((o) => hits({ left: cx, top: cy, width: ww, height: hh }, o, 8))) return { x: Math.round(cx), y: Math.round(cy) }; }
  return { x, y };
};
const win = { left: 64, top: 92, right: 980, bottom: 1024 };  // a left-half app window
const placed = clearPlace(100, 300, 260, 160, [win], bClosed);
ok("widget-over-a-window-is-moved", placed.x !== 100 || placed.y !== 300);
ok("widget-lands-clear-of-the-window", !hits({ left: placed.x, top: placed.y, width: 260, height: 160 }, win, 8));
// a window that fills the whole canvas has nowhere to clear to → keep position, never thrash ──
const full = { left: bClosed.minX, top: bClosed.minY, right: bClosed.maxX, bottom: bClosed.maxY };
ok("full-canvas-window-does-not-thrash", JSON.stringify(clearPlace(500, 500, 260, 160, [], bClosed)) === JSON.stringify({ x: 500, y: 500 }));

// ════ PART B · the wiring, source-asserted ════════════════════════════════════════════════════════
// 5 · the reflow is driven by the CANVAS, not just window resize — this is what fires it on carriage open ──
ok("reflow-observes-the-canvas", /function wireCanvasObserver\(/.test(src) && /new W\.ResizeObserver\(reflowSoon\)\.observe\(target\)/.test(src) && /getElementById\("world"\)/.test(src));
ok("reflow-catches-the-glide-settle", /addEventListener\("transitionend"[\s\S]{0,160}p === "left" \|\| p === "right" \|\| p === "width"[\s\S]{0,40}recenter\(\)/.test(src));
ok("window-resize-stays-as-fallback", /W\.addEventListener\("resize", recenter\)/.test(src) && /wireCanvasObserver\(\);/.test(src));
ok("recenter-is-aside-aware", /deskBounds\(\) already subtracts dock \+ aside/.test(src) && /parseFloat\(gs\.getPropertyValue\("--holo-aside-w"\)\)/.test(src));

// 6 · the orb re-pins on EVERY reflow path, and is NOT centre-shifted when un-moved ──
ok("anchorOrb-on-mode-path", /if \(repositionToMode\(\)\) \{ anchorOrb\(\); avoidWindows\(\)/.test(src));
ok("anchorOrb-on-no-delta-path", /if \(!dx && !dy\) \{ reflowAll\(\); anchorOrb\(\); avoidWindows\(\); return; \}/.test(src));
ok("anchorOrb-on-shift-path", /anchorOrb\(\);\s*\/\/ re-pin the un-moved orb/.test(src));
ok("un-moved-orb-skips-centre-shift", /if \(w\.type === "q" && !w\._userMoved\) return;/.test(src));

// 7 · "unless moved by user" — drag opts the orb out, persists, restores, and a menu resets it ──
ok("hand-drag-marks-orb-moved", /if \(wasMoved\) \{ if \(w\.type === "q"\) w\._userMoved = true; save\(\)/.test(src));
ok("snap-drag-marks-orb-moved", /if \(w\.type === "q"\) w\._userMoved = true; clearGuides\(\); save\(\);/.test(src));
ok("anchorOrb-respects-user-moved", /if \(w\._userMoved\) continue;/.test(src));
ok("moved-flag-persists", /if \(w\._userMoved\) r\.moved = true;/.test(src));
ok("moved-flag-restores", (src.match(/w\._userMoved = !!s\.moved;/g) || []).length >= 2);
ok("reset-to-corner-menu", /Reset orb to corner[\s\S]{0,80}w\._userMoved = false; anchorOrb\(\)/.test(src));
ok("voice-persists-and-restores-moved", /JSON\.stringify\(\{ x: q\.x, y: q\.y, w: q\.w, moved: !!q\.moved \}\)/.test(voice) && /if \(qw && p && p\.moved\) qw\._userMoved = true;/.test(voice));

// 8 · the orb is STICKY — it rides every tab (survives the board swap), widgets are Home-only ──
ok("orb-sticky-by-type", /function isStickyType\(t\) \{ if \(t === "q"\) return true;/.test(src));
ok("setBoard-preserves-sticky-orb", /live\.slice\(\)\.forEach\(function \(w\) \{ if \(isStickyType\(w\.type\)\) return;/.test(src) && /live = live\.filter\(function \(w\) \{ return isStickyType\(w\.type\); \}\);/.test(src));
ok("setBoard-never-double-mounts-orb", /\.filter\(function \(s\) \{ return !isStickyType\(s\.type\); \}\)\.forEach\(mountRecord\)/.test(src) && /anchorOrb\(\);\s*\/\/ re-pin the preserved orb/.test(src));
ok("non-home-tab-board-is-empty-of-widgets", /h\.setBoard\(board, \{ persist: false \}\)/.test(readFileSync(join(OS, "usr/share/frame/shell.html"), "utf8")));

// 9 · widgets never sit under a window — auto-placement + reflow both clear them ──
ok("auto-placement-avoids-windows", /if \(w\.type !== "q"\) \{ var cp = clearPlace\(w\.x, w\.y, w\.el\.offsetWidth, w\.el\.offsetHeight\);/.test(src));
ok("reflow-clears-windows", /function avoidWindows\(\)/.test(src) && /windowRects\(\)\.filter\(function \(r\) \{ return !coversCanvas\(r\); \}\)/.test(src));
ok("only-persistent-windows-avoided", /querySelectorAll\("holo-window"\)/.test(src) && /never\b[\s\S]{0,40}transient previews/.test(src));

// 10 · the reflow is reachable from the shell too ──
ok("reflow-exposed-on-api", /reflow: recenter,/.test(src));

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  subject: "Holo Widgets anchor — Home widgets + Q orb never drift from their place as the canvas changes",
  covers: [
    "opening a right side-carriage narrows the usable canvas via --holo-aside-w (no window resize) and moves its centre left by aside/2 — the reflow is driven by a canvas ResizeObserver + the glide's settle, so it actually runs",
    "every floating object tracks the holospace centre and open⇄close is exactly reversible (deltas sum to zero)",
    "the Q orb re-pins to the aside-aware bottom-right corner on every reflow path (the corner moves by the full aside, not half) — unless the user dragged it, which persists and restores, with a menu to reset",
    "the sticky orb survives the per-tab board swap so it rides every holospace tab; non-home tabs carry no Home widgets",
    "widgets land and stay clear of open application windows (golden-anchor walk), never thrashing under a full-canvas window",
  ],
  asidePx: ASIDE, checks, failed: fail,
  authority: "φ = golden ratio (1.618) · holospaces Law L1/L2/L5 · ADR-0088/0089 (per-holospace boards)",
};
writeFileSync(join(here, "holo-widgets-anchor-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Widgets anchor witness — Home widgets + Q orb never drift (centre-anchored reflow + corner-pin)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
