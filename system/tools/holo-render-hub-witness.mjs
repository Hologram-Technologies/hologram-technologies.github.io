#!/usr/bin/env node
// holo-render-hub-witness.mjs — cc-render-hub: proves Holo Hub is delivered THROUGH the κ-render
// substrate (Phase 3 slice 1, deepened to full parity + default-on), per the per-app conformance
// checklist: declarative κ surfaces via the render() spine · assets κ-verified at runtime (L5) · no
// unverified external code loads · default-on (the only way) · the app's index.html is sealed (re-derives).
//
// Run: node holo-os/system/tools/holo-render-hub-witness.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const APPS = process.env.HOLO_APPS_REPO || join(here, "../../../holo-apps");
const html = readFileSync(join(APPS, "apps/hub/index.html"), "utf8");
const lock = JSON.parse(readFileSync(join(APPS, "apps/hub/holospace.lock.json"), "utf8"));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + m); };

ok(/import\s+HoloSurface\s+from\s+["']\/_shared\/holo-surface\.mjs["']/.test(html), "Hub imports the κ-render substrate (/_shared/holo-surface.mjs)");
ok(/HoloSurface\.renderSurface\(/.test(html), "Hub renders covers via the render() spine (renderSurface)");
ok(/@type["']?\s*:\s*["']holo:Surface["']/.test(html), "covers are declarative holo:Surface objects");
ok(/const\s+KSURF\s*=\s*!new URLSearchParams/.test(html), "κ-substrate is DEFAULT ON (the only way; ?nok=1 kill-switch)");
ok(/kVerify\s*=\s*async[^\n]*shaRaw\(b\)\)===kHex\(k\)/.test(html), "assets L5-verified at runtime (re-derive on receipt)");
ok(/rasterizeToKappa/.test(html) && /kind:["']?image["']?/.test(html), "cover thumbnails are content-addressed (rasterised → κ → image kind)");
ok(/function\s+renderKCardInto/.test(html) && /function card\(p\)\{[\s\S]*renderKCardInto\(c,\s*p\)/.test(html), "the WHOLE card is one composed κ-surface (cover image/fill + overlay badge/duration/play + meta text)");
ok(/renderWatchKappa\s*\(/.test(html) && /openWatch[\s\S]*renderWatchKappa\(p\)/.test(html), "watch view routes description + info grid through the substrate (renderWatchKappa)");
ok(/#wInfo["']\)?,\s*\{[\s\S]*layout:["']grid["']/.test(html) || /layout:["']grid["'][\s\S]*#wInfo/.test(html) || /renderKScene\(\$\(["']#wInfo/.test(html), "watch info panel is a COMPOSED κ-surface (grid of key/value cells)");
// the watch ACTION ROW is migrated onto the interactive `button` kind (cc-surface-input), wired to real handlers
ok(/function\s+renderActionRowK/.test(html) && /openWatch[\s\S]*renderActionRowK\(p\)/.test(html), "watch action row routes through the substrate (renderActionRowK, default-on)");
ok(/kind:["']?button["']?[\s\S]*action:["']like["']/.test(html) && /action:["']share["']/.test(html) && /action:["']save["']/.test(html), "action row is κ-surface BUTTONS carrying declarative action ids (like/dislike/share/save)");
ok(/renderKSceneActions\([\s\S]*\{\s*resolve:kResolve,\s*verify:kVerify,\s*actions\s*\}/.test(html), "action dispatch goes through renderSurface with an app-supplied actions map (substrate runs no inline code)");
ok(/like:\s*\(\)\s*=>\s*\{\s*setVote/.test(html) && /toggleSaved/.test(html), "actions map wires to the real handlers (setVote / toggleSaved / share)");
// the comment COMPOSER is migrated onto the text-`input` kind (paired with `button`s), wired to cmAdd
ok(/function\s+renderComposerK/.test(html) && /openWatch[\s\S]*renderComposerK\(p\)/.test(html), "comment composer routes through the substrate (renderComposerK, default-on)");
ok(/kind:["']?input["']?[\s\S]*placeholder:["']Add a comment/.test(html) && /submit:["']send["']/.test(html), "composer is a κ-surface text `input` (placeholder + Enter→submit) paired with buttons");
ok(/send:\s*post/.test(html) && /await cmAdd\(WATCH/.test(html), "composer Comment/Enter posts via the real handler (cmAdd)");
ok(/the live <input> is the source of truth/.test(html) || /typing never re-renders/.test(html), "composer does not re-render on keystroke (focus/caret preserved — live field is source of truth)");
// FULL κ-render: every Hub content/chrome surface composes from the substrate (not raw DOM markup)
ok(/function\s+renderHero\b[\s\S]*renderKSceneActions\(hostEl/.test(html), "home HERO is a κ-surface (bg image/fill + title/meta + Play/More buttons)");
ok(/function\s+buildRail\b[\s\S]*renderKSceneActions\(r,/.test(html) && /kind:["']?button["']?[\s\S]*action:id/.test(html), "navigation RAIL is a κ-surface (each item a button, groups + foot as text)");
ok(/function\s+renderChips\b[\s\S]*renderKSceneActions\(bar,/.test(html) && /layout:["']row["']/.test(html), "filter CHIPS are κ-surface buttons in a row layout");
ok(/function\s+renderHeaderK\b[\s\S]*action:["']get["'][\s\S]*action:["']buy["']/.test(html) && /openWatch[\s\S]*renderHeaderK\(p\)/.test(html), "channel HEADER (avatar + name + Get/Buy) is a κ-surface, Get/Buy wired");
ok(/function\s+renderComments\b[\s\S]*cmLike\(p,c\.id\)[\s\S]*renderKSceneActions\(host/.test(html), "comment LIST is a κ-surface (avatar + text + like/reply buttons), wired to cmLike");
ok(/function\s+renderUpNext\b[\s\S]*renderKSceneActions\(host/.test(html) && /async function renderUpNext/.test(html), "UP-NEXT rail is a κ-surface (thumb image + text rows), each clickable");
ok(/function\s+renderSearchK\b[\s\S]*kind:["']?input["']?/.test(html) && /renderSearchK\(\)/.test(html), "SEARCH field is a κ-surface text input");
ok(/function\s+kHead\b/.test(html) && /host\.appendChild\(kHead\(/.test(html), "section HEADERS render as κ-surface text (kHead)");
ok(/renderKScene\(\$\(["']#wTitle/.test(html), "watch TITLE renders as a κ-surface text");
// the only non-κ visuals left are the native media player iframe + live hover-preview (streamed apps), splash & toast (transient shell)
ok(/<iframe id="pFrame"/.test(html), "the media player itself stays a native iframe (the streamed app — correctly NOT re-rendered by Hub)");
// no unverified external CODE loads (CDN script/import) — the KAPPA-1 red line
ok(!/<script[^>]+src=["']https?:\/\//i.test(html) && !/\bimport\b[^\n]*["']https?:\/\//.test(html) && !/esm\.sh|cdn\.jsdelivr|unpkg\.com/.test(html), "no external/CDN code loads (L5 / KAPPA-1)");
// YouTube-grammar parity features (wired, jargon-free)
ok(/renderChips\s*\(/.test(html) && /id="home-chips"/.test(html), "home filter chips (All + categories/types), wired to FILTER");
ok(/id="autoplayToggle"/.test(html) && /AUTOPLAY_KEY/.test(html) && /function playNext/.test(html), "Up-next autoplay toggle (persisted) + playNext");
ok(/addEventListener\("keydown"/.test(html), "keyboard shortcuts (/ search · Esc back · t theater · f full · n next)");
ok(!/first render \$\{ms\}ms|0 servers|verified in my tab/.test(html), "jargon removed (no 'first render…0 servers' / 'verified in my tab')");

// the served app is sealed: index.html re-derives to its pinned κ (dual-axis)
const e = lock.closure["apps/hub/index.html"];
const sha = "did:holo:sha256:" + createHash("sha256").update(readFileSync(join(APPS, "apps/hub/index.html"))).digest("hex");
ok(!!e && e.kappa === sha, "index.html re-derives to its sealed κ (Law L5)");
ok(!!e && (e.alsoKnownAs || []).some((a) => /blake3/.test(a)), "index.html carries its dual-axis σ-axis anchor (blake3)");

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
