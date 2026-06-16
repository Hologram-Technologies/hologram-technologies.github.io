#!/usr/bin/env node
// build-skins-platform.mjs — author + pin the platform/themed Holo Browser skins (the catalogue beyond
// the vintage browsers). Each is a PURE DATA DROP (zero engine change). Like build-skins.mjs it writes
// chrome.html/css/glyphs/throbber PLUS a holo:shellCss stylesheet (the new κ-pinned capability that lets a
// skin fully dress the shell's OWN chrome — tab strip, toolbar, omnibox, left dock, bottom bar — with
// gradients / glass / curves / textures), computes every asset's κ, writes skin.pin.json, and seals the
// manifest @id (Law L5). Exemplars: Windows XP Luna (platform) + Star Trek LCARS (themed).
//
// Fidelity references (studied, RE-AUTHORED as web chrome — NOT copied brand artwork; honest witness
// caveat): Windows XP "Luna" (blue gradient taskbar, cream window chrome, Tahoma, green Go, rounded).
// Star Trek LCARS (black field, curved colour elbow panels, condensed all-caps type, pulsing readouts).

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assetKappa, skinKappa } from "../os/usr/lib/holo/holo-skin.js";

const here = dirname(fileURLToPath(import.meta.url));
const skinsRoot = join(here, "..", "os", "usr", "lib", "holo", "skins");

// ── shared per-window chrome builders (uniform structure; the era look lives in css + shellCss) ─────
const ACT = { back: "nav.back", forward: "nav.forward", home: "nav.home", reload: "nav.reload", stop: "nav.stop", open: "omni.focus", newwin: "tab.new" };
const LBL = { back: "Back", forward: "Forward", home: "Home", reload: "Reload", stop: "Stop", open: "Open", newwin: "New" };
const toolbarBtns = (p, btns, withLabel) => btns.map((b) => b === "|" ? `<span class="${p}-sep"></span>`
  : `<button class="${p}-btn" data-action="${ACT[b]}" title="${LBL[b]}"><span class="ico" data-glyph="${b}"></span>${withLabel ? `<span class="lbl">${LBL[b]}</span>` : ""}</button>`).join("");
const menubar = (p, labels) => `<div class="${p}-menubar" role="menubar">` + labels.map((l) => `<button class="${p}-menu" data-menu="${l}">${l}</button>`).join("") + `<span class="${p}-throb" data-throbber title="Loading"></span></div>`;
const fieldRow = (p, label) => `<div class="${p}-fields"><label class="${p}-field"><span class="${p}-flabel">${label}</span><input class="${p}-input" data-url data-action="omni.focus" readonly><button class="${p}-go" data-action="omni.focus">Go</button></label></div>`;
const statusBar = (p, extra = "") => `<div class="skin-region-bottom"><div class="${p}-status"><span class="${p}-security" data-security data-state="neutral"></span><span class="${p}-status-text" data-status></span>${extra}<span class="${p}-meter"><span class="${p}-meter-fill"></span></span></div></div>`;
const glyphSet = (c) => ({
  back: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><path d="M11 3 L5 9 L11 15 Z" fill="${c.arrow}"/></svg>`,
  forward: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><path d="M7 3 L13 9 L7 15 Z" fill="${c.arrow}"/></svg>`,
  home: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><path d="M9 2 L16 9 H13 V16 H10 V11 H8 V16 H5 V9 H2 Z" fill="${c.home}"/></svg>`,
  reload: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><path d="M9 3 A6 6 0 1 0 15 9 H13 A4 4 0 1 1 9 5 V8 L14 4 L9 0 Z" fill="${c.reload}"/></svg>`,
  open: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><path d="M2 5 H7 L9 7 H16 V14 H2 Z" fill="none" stroke="${c.open}" stroke-width="1.6"/></svg>`,
  stop: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><path d="M6 2 H12 L16 6 V12 L12 16 H6 L2 12 V6 Z" fill="${c.stop}" stroke="${c.stopEdge}" stroke-width="1"/></svg>`,
  newwin: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><rect x="3" y="4" width="10" height="9" fill="#fff" stroke="${c.arrow}" stroke-width="1.4"/><rect x="6" y="6" width="9" height="8" fill="#fff" stroke="${c.arrow}" stroke-width="1.4"/></svg>`,
});
const M = (label, items) => ({ label, items });
const item = (label, action = "noop") => ({ label, action });

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// WINDOWS XP — "Luna" : blue gradient taskbar, cream window chrome, Tahoma, the green Go, rounded edges.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const XP = {
  id: "winxp", title: "Windows XP",
  fidelitySource: "Windows XP “Luna” desktop + IE6 chrome (re-authored as web chrome)",
  glyphs: glyphSet({ arrow: "#1d5fbf", home: "#1d8a2a", reload: "#1a8a2a", open: "#1d5fbf", stop: "#c01818", stopEdge: "#800" }),
  throbberSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g class="xpdots">${Array.from({ length: 8 }, (_, i) => { const a = i / 8 * Math.PI * 2; const x = 20 + 14 * Math.cos(a), y = 20 + 14 * Math.sin(a); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#245edb" opacity="${(0.25 + 0.75 * i / 8).toFixed(2)}"/>`; }).join("")}</g></svg>`,
  palette: { chrome: "#ece9d8", bevelLight: "#ffffff", bevelDark: "#aca899", linkUnvisited: "#0000ee", linkVisited: "#551a8b", text: "#000000", statusBg: "#ece9d8" },
  font: { ui: "Tahoma, 'Segoe UI', Verdana, sans-serif", doc: "'Times New Roman', Times, serif" },
  html: `<div class="skin-region-top"><div class="xp">` + menubar("xp", ["File", "Edit", "View", "Favorites", "Tools", "Help"]) +
    `<div class="xp-toolbar">` + toolbarBtns("xp", ["back", "forward", "stop", "reload", "home"], true) + `</div>` +
    fieldRow("xp", "Address") + `</div></div>` + statusBar("xp", `<span class="xp-zone">Internet</span>`),
  css: `.skin-chrome{--xp-cream:#ece9d8;--xp-d:#aca899;font-family:Tahoma,'Segoe UI',sans-serif;font-size:11px;color:#000}
.skin-chrome .xp{background:var(--xp-cream)}
.skin-chrome .xp-menubar{display:flex;align-items:center;gap:1px;padding:2px 6px;background:linear-gradient(#fff,#ece9d8)}
.skin-chrome .xp-menu{font:inherit;background:transparent;border:0;padding:3px 9px;border-radius:3px;cursor:default}
.skin-chrome .xp-menu:hover{background:#2f6fdb;color:#fff}
.skin-chrome .xp-throb{margin-left:auto;width:30px;height:30px;display:grid;place-items:center}
.skin-chrome .xp-throb svg{width:26px;height:26px}
.skin-chrome .xp-throb .xpdots{transform-origin:50% 50%}
.skin-chrome .xp-throb.spinning .xpdots{animation:xp-spin .8s steps(8) infinite}
@keyframes xp-spin{to{transform:rotate(360deg)}}
.skin-chrome .xp-toolbar{display:flex;align-items:center;gap:3px;padding:5px 7px;background:linear-gradient(#fbfbf8,#ece9d8)}
.skin-chrome .xp-btn{display:flex;align-items:center;gap:5px;padding:4px 9px;background:transparent;border:1px solid transparent;border-radius:4px;cursor:default}
.skin-chrome .xp-btn:hover{border-color:#2f6fdb;background:#eaf2ff}
.skin-chrome .xp-btn[disabled]{opacity:.4}
.skin-chrome .xp-btn .ico svg{width:18px;height:18px}
.skin-chrome .xp-sep{width:1px;align-self:stretch;margin:3px 3px;background:var(--xp-d)}
.skin-chrome .xp-fields{display:flex;align-items:center;padding:3px 8px 7px;background:#ece9d8}
.skin-chrome .xp-field{display:flex;align-items:center;gap:6px;flex:1}
.skin-chrome .xp-flabel{color:#444}
.skin-chrome .xp-input{flex:1;font:11px Tahoma,sans-serif;background:#fff;border:1px solid #7f9db9;padding:3px 7px;outline:0}
.skin-chrome .xp-go{font:inherit;font-weight:700;color:#1d6f1d;padding:3px 14px;border:1px solid #4a8a4a;border-radius:4px;background:linear-gradient(#dff0d8,#bfe0b0)}
.skin-chrome .xp-status{display:flex;align-items:center;gap:8px;padding:2px 8px;background:#ece9d8;border-top:1px solid #fff}
.skin-chrome .xp-status-text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:inset 1px 1px 0 var(--xp-d);padding:1px 7px}
.skin-chrome .xp-zone{padding:1px 9px;box-shadow:inset 1px 1px 0 var(--xp-d)}
.skin-chrome .xp-security[data-state="secure"]::before{content:"\\1F512"}
.skin-chrome .xp-meter{width:120px;height:12px;background:#fff;box-shadow:inset 1px 1px 0 var(--xp-d)}
.skin-chrome .xp-meter-fill{display:block;height:100%;width:0;background:repeating-linear-gradient(90deg,#3aaf3a 0 7px,#7fd07f 7px 14px)}`,
  // the WHOLE browser → the XP Luna look: blue gradient tab strip + taskbar, cream toolbar, green-blue accents.
  shellCss: [
    "#tabstrip{background:linear-gradient(#4d8ef0,#1f56c7)!important;border-bottom:1px solid #16409a!important;box-shadow:inset 0 1px 0 #7fb0ff!important}",
    "#tabstrip .tab,#tabstrip button,#newtab{color:#fff!important;text-shadow:0 1px 1px #0006!important}",
    "#tabstrip .tab:not(.active){background:transparent!important}",
    "#tabstrip .tab.active{background:linear-gradient(#fbfbf8,#dfe8f7)!important;color:#10316e!important;border-radius:6px 6px 0 0!important;box-shadow:none!important;text-shadow:none!important}",
    "#tabstrip .tab.active::before,#tabstrip .tab.active::after{background:#dfe8f7!important}",
    "#navbar{background:linear-gradient(#fbfbf8,#ece9d8)!important;border-bottom:1px solid #aca899!important;box-shadow:inset 0 1px 0 #fff!important}",
    "#navbar .nav,#navbar button,#verb-build,#verb-run,#share-btn,#navbar .vl{color:#10316e!important;text-shadow:none!important}",
    "#navbar .nav:hover:not(:disabled),#navbar button:hover{background:#eaf2ff!important;border-radius:4px!important}",
    "#omni{background:#fff!important;border:1px solid #7f9db9!important;border-radius:4px!important;box-shadow:inset 1px 1px 1px #0001!important}",
    "#omni input{color:#000!important;font-family:Tahoma,sans-serif!important}",
    "#holo-dock{--hd-opaque-bg:#ece9d8!important;--hd-blur-bg:#ece9d8!important;--hd-acrylic-bg:#ece9d8!important;--hd-clear-bg:#ece9d8!important;--hd-ink:#10316e!important;--hd-ink-dim:#3a3a3a!important;--hd-border:#aca899!important;border-right:1px solid #aca899!important}",
    "#holo-dock .holo-dock-inner{background:linear-gradient(#f4f2ea,#e6e2d4)!important}",
    "#holo-dock .holo-dock-icon,#holo-dock .holo-dock-mini{filter:brightness(0)!important;opacity:.9!important}",
    "#holo-credit{background:linear-gradient(#4d8ef0,#1f56c7)!important;border-top:1px solid #16409a!important;box-shadow:inset 0 1px 0 #7fb0ff!important}",
    "#holo-credit,#holo-credit *{color:#fff!important;text-shadow:0 1px 1px #0006!important}",
    "#holo-credit .cv-pill{background:linear-gradient(#7bc043,#4a9a1e)!important;border:1px solid #2f6e10!important;border-radius:8px!important}",
  ].join(""),
  menus: [
    M("File", [item("New Window", "tab.new"), item("Open…", "omni.focus"), item("Save As…"), item("Print…"), item("Close", "tab.close")]),
    M("Edit", [item("Cut"), item("Copy"), item("Paste"), item("Find on this Page…")]),
    M("View", [item("Refresh", "nav.reload"), item("Stop", "nav.stop"), item("Source"), item("Text Size")]),
    M("Favorites", [item("Add to Favorites…"), item("Organize Favorites…")]),
    M("Tools", [item("Internet Options…"), item("Pop-up Blocker")]),
    M("Help", [item("About Internet Explorer", "about")]),
  ],
};

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// STAR TREK LCARS — black field, curved colour "elbow" panels, condensed all-caps type, pulsing readouts.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const LCARS = {
  id: "lcars", title: "LCARS",
  fidelitySource: "Star Trek LCARS design language (re-authored; no copyrighted assets)",
  glyphs: glyphSet({ arrow: "#000", home: "#000", reload: "#000", open: "#000", stop: "#000", stopEdge: "#000" }),
  throbberSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g class="lcbars">${[0, 1, 2, 3, 4].map((i) => `<rect x="${4 + i * 7}" y="8" width="5" height="24" rx="2" fill="${["#ff9966", "#cc99cc", "#9999ff", "#ffcc66", "#ff9966"][i]}"/>`).join("")}</g></svg>`,
  palette: { chrome: "#000000", bevelLight: "#000000", bevelDark: "#000000", linkUnvisited: "#9bb0ff", linkVisited: "#cc99cc", text: "#ffffff", statusBg: "#000000" },
  font: { ui: "Antonio, 'Oswald', 'Arial Narrow', sans-serif", doc: "Antonio, 'Arial Narrow', sans-serif" },
  html: `<div class="skin-region-top"><div class="lc">` + menubar("lc", ["LCARS", "COMM", "NAV", "LIB", "HELP"]) +
    `<div class="lc-toolbar">` + toolbarBtns("lc", ["back", "forward", "home", "reload", "stop", "|", "newwin"], false) + `</div>` +
    fieldRow("lc", "INPUT") + `</div></div>` + statusBar("lc", `<span class="lc-stardate">STARDATE</span>`),
  css: `.skin-chrome{--lc-orange:#ff9966;--lc-lav:#cc99cc;--lc-blue:#9999ff;--lc-gold:#ffcc66;font-family:Antonio,'Oswald','Arial Narrow',sans-serif;color:#fff;text-transform:uppercase;letter-spacing:.5px}
.skin-chrome .lc{background:#000;padding:4px 6px 6px}
.skin-chrome .lc-menubar{display:flex;align-items:stretch;gap:6px;height:30px}
.skin-chrome .lc-menu{font:inherit;text-transform:uppercase;letter-spacing:1px;border:0;color:#000;font-weight:700;padding:0 16px;cursor:default;border-radius:0 14px 14px 0;background:var(--lc-orange)}
.skin-chrome .lc-menu:nth-child(2){background:var(--lc-lav);border-radius:14px}
.skin-chrome .lc-menu:nth-child(3){background:var(--lc-blue);border-radius:14px}
.skin-chrome .lc-menu:nth-child(4){background:var(--lc-gold);border-radius:14px}
.skin-chrome .lc-menu:nth-child(5){background:var(--lc-orange);border-radius:14px 0 0 14px}
.skin-chrome .lc-menu:hover{filter:brightness(1.15)}
.skin-chrome .lc-throb{margin-left:auto;width:44px;height:30px;display:grid;place-items:center}
.skin-chrome .lc-throb svg{width:40px;height:26px}
.skin-chrome .lc-throb .lcbars rect{opacity:.5}
.skin-chrome .lc-throb.spinning .lcbars rect{animation:lc-pulse .7s ease-in-out infinite}
.skin-chrome .lc-throb.spinning .lcbars rect:nth-child(2){animation-delay:.1s}
.skin-chrome .lc-throb.spinning .lcbars rect:nth-child(3){animation-delay:.2s}
.skin-chrome .lc-throb.spinning .lcbars rect:nth-child(4){animation-delay:.3s}
.skin-chrome .lc-throb.spinning .lcbars rect:nth-child(5){animation-delay:.4s}
@keyframes lc-pulse{0%,100%{opacity:.35}50%{opacity:1}}
.skin-chrome .lc-toolbar{display:flex;align-items:center;gap:6px;padding:6px 6px;background:#000}
.skin-chrome .lc-btn{display:grid;place-items:center;width:34px;height:26px;background:var(--lc-blue);border:0;border-radius:13px;cursor:default}
.skin-chrome .lc-btn:hover{filter:brightness(1.2)}
.skin-chrome .lc-btn[disabled]{opacity:.3}
.skin-chrome .lc-btn .ico svg{width:15px;height:15px}
.skin-chrome .lc-sep{width:18px}
.skin-chrome .lc-fields{display:flex;align-items:center;padding:2px 6px 4px;background:#000}
.skin-chrome .lc-field{display:flex;align-items:center;gap:8px;flex:1}
.skin-chrome .lc-flabel{color:var(--lc-gold);font-weight:700;letter-spacing:1px}
.skin-chrome .lc-input{flex:1;font:13px Antonio,'Arial Narrow',sans-serif;letter-spacing:1px;text-transform:uppercase;color:var(--lc-orange);background:#0a0a0a;border:2px solid var(--lc-orange);border-radius:13px;padding:3px 12px;outline:0}
.skin-chrome .lc-go{font:inherit;font-weight:700;color:#000;padding:3px 16px;border:0;border-radius:13px;background:var(--lc-gold)}
.skin-chrome .lc-status{display:flex;align-items:center;gap:10px;padding:3px 6px;background:#000}
.skin-chrome .lc-status-text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--lc-orange)}
.skin-chrome .lc-stardate{color:var(--lc-lav);font-weight:700}
.skin-chrome .lc-security[data-state="secure"]::before{content:"\\1F512";color:var(--lc-gold)}
.skin-chrome .lc-meter{width:120px;height:12px;background:#1a1a1a;border-radius:6px;overflow:hidden}
.skin-chrome .lc-meter-fill{display:block;height:100%;width:0;background:var(--lc-orange)}`,
  // the WHOLE browser → LCARS: black field, curved colour elbows, condensed all-caps, the orange footer rail.
  shellCss: [
    "#tabstrip{background:#000!important;font-family:Antonio,'Oswald','Arial Narrow',sans-serif!important;padding:4px 8px!important;gap:6px!important}",
    "#tabstrip .tab,#tabstrip button,#newtab{color:#000!important;text-transform:uppercase!important;letter-spacing:1px!important;font-weight:700!important}",
    "#tabstrip .tab:not(.active){background:#cc99cc!important;border-radius:14px!important}",
    "#tabstrip .tab.active{background:#ff9966!important;color:#000!important;border-radius:14px!important;box-shadow:none!important}",
    "#tabstrip .tab.active::before,#tabstrip .tab.active::after{display:none!important}",
    "#newtab{background:#9999ff!important;border-radius:14px!important;color:#000!important}",
    "#navbar{background:#000!important;border-bottom:0!important;box-shadow:none!important;font-family:Antonio,'Oswald','Arial Narrow',sans-serif!important;gap:8px!important;padding:0 10px!important}",
    "#navbar .nav{color:#000!important;background:#9999ff!important;border-radius:14px!important;width:30px!important;height:28px!important}",
    "#navbar button,#verb-build,#verb-run,#share-btn,#navbar .vl{color:#ffcc66!important;text-transform:uppercase!important;letter-spacing:1px!important}",
    "#navbar .nav:hover:not(:disabled){filter:brightness(1.2)!important;background:#9999ff!important}",
    "#omni{background:#0a0a0a!important;border:2px solid #ff9966!important;border-radius:16px!important;box-shadow:none!important}",
    "#omni input{color:#ff9966!important;text-transform:uppercase!important;letter-spacing:1px!important;font-family:Antonio,'Arial Narrow',sans-serif!important}",
    "#omni input::placeholder{color:#a86a4a!important}",
    "#holo-dock{--hd-opaque-bg:#000!important;--hd-blur-bg:#000!important;--hd-acrylic-bg:#000!important;--hd-clear-bg:#000!important;--hd-blur-fx:none!important;--hd-ink:#ffcc66!important;--hd-ink-dim:#cc99cc!important;--hd-border:#000!important;border-right:0!important}",
    "#holo-dock .holo-dock-inner{background:#000!important}",
    "#holo-dock .holo-dock-tile{background:#cc99cc!important;border-radius:0 13px 13px 0!important;margin:2px 0!important}",
    "#holo-dock .holo-dock-icon,#holo-dock .holo-dock-mini{filter:brightness(0)!important;opacity:.9!important}",
    "#holo-credit{background:#ff9966!important;border-top:0!important;border-radius:0 16px 0 0!important;box-shadow:none!important;font-family:Antonio,'Oswald','Arial Narrow',sans-serif!important}",
    "#holo-credit,#holo-credit *{color:#000!important;text-transform:uppercase!important;letter-spacing:1px!important;font-weight:700!important}",
    "#holo-credit .cv-pill{background:#000!important;color:#ff9966!important;border:0!important;border-radius:11px!important}",
  ].join(""),
  menus: [
    M("LCARS", [item("NEW PANEL", "tab.new"), item("ACCESS…", "omni.focus"), item("CLOSE", "tab.close")]),
    M("COMM", [item("HAIL"), item("CHANNELS")]),
    M("NAV", [item("BACK", "nav.back"), item("FORWARD", "nav.forward"), item("HOME", "nav.home"), item("RELOAD", "nav.reload")]),
    M("LIB", [item("COMPUTER"), item("RECORDS")]),
    M("HELP", [item("ABOUT", "about")]),
  ],
};

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// MAC OS X — "Aqua" : glossy white/blue gel, pinstripe field, Lucida Grande, the rainbow beachball.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const beachball = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g class="ball">` +
  ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#007aff", "#5856d6", "#af52de"].map((col, i) => {
    const a0 = i * 45 * Math.PI / 180, a1 = (i + 1) * 45 * Math.PI / 180, cx = 20, cy = 20, r = 16;
    const x0 = (cx + r * Math.cos(a0)).toFixed(2), y0 = (cy + r * Math.sin(a0)).toFixed(2);
    const x1 = (cx + r * Math.cos(a1)).toFixed(2), y1 = (cy + r * Math.sin(a1)).toFixed(2);
    return `<path d="M${cx} ${cy} L${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1} Z" fill="${col}"/>`;
  }).join("") + `</g></svg>`;
const AQUA = {
  id: "aqua", title: "Mac OS X Aqua",
  fidelitySource: "Mac OS X 10.x “Aqua” (pinstripe + gel) — re-authored as web chrome",
  glyphs: glyphSet({ arrow: "#2a6ae0", home: "#2a6ae0", reload: "#2a6ae0", open: "#2a6ae0", stop: "#d23b30", stopEdge: "#900" }),
  throbberSvg: beachball,
  palette: { chrome: "#e8eef6", bevelLight: "#ffffff", bevelDark: "#9bb0c8", linkUnvisited: "#0000ee", linkVisited: "#551a8b", text: "#0a0a0a", statusBg: "#e8eef6" },
  font: { ui: "'Lucida Grande','Helvetica Neue',Helvetica,Arial,sans-serif", doc: "Georgia,'Times New Roman',serif" },
  html: `<div class="skin-region-top"><div class="aq">` + menubar("aq", ["File", "Edit", "View", "History", "Bookmarks", "Window", "Help"]) +
    `<div class="aq-toolbar">` + toolbarBtns("aq", ["back", "forward", "home", "reload", "stop"], false) + `</div>` +
    fieldRow("aq", "Address") + `</div></div>` + statusBar("aq"),
  css: `.skin-chrome{font-family:'Lucida Grande','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;color:#0a0a0a}
.skin-chrome .aq{background:linear-gradient(#fdfefe,#dfe7f1);background-image:repeating-linear-gradient(#ffffff,#ffffff 1px,#eef3fb 1px,#eef3fb 4px)}
.skin-chrome .aq-menubar{display:flex;align-items:center;gap:2px;padding:3px 8px;background:linear-gradient(#ffffff,#e6edf6);border-bottom:1px solid #c2cfdf}
.skin-chrome .aq-menu{font:inherit;background:transparent;border:0;padding:2px 10px;border-radius:5px;cursor:default}
.skin-chrome .aq-menu:hover{background:linear-gradient(#4f9bf0,#1f6fe0);color:#fff}
.skin-chrome .aq-throb{margin-left:auto;width:28px;height:28px;display:grid;place-items:center}
.skin-chrome .aq-throb svg{width:24px;height:24px}
.skin-chrome .aq-throb .ball{transform-origin:50% 50%}
.skin-chrome .aq-throb.spinning .ball{animation:aq-spin 1s linear infinite}
@keyframes aq-spin{to{transform:rotate(360deg)}}
.skin-chrome .aq-toolbar{display:flex;align-items:center;gap:6px;padding:6px 9px}
.skin-chrome .aq-btn{display:grid;place-items:center;width:32px;height:26px;border:1px solid #9bb0c8;border-radius:13px;background:linear-gradient(#ffffff,#dbe5f1);cursor:default}
.skin-chrome .aq-btn:hover{background:linear-gradient(#eef5ff,#cfe0f5)}
.skin-chrome .aq-btn:active{background:linear-gradient(#4f9bf0,#1f6fe0)}
.skin-chrome .aq-btn[disabled]{opacity:.4}
.skin-chrome .aq-btn .ico svg{width:16px;height:16px}
.skin-chrome .aq-fields{display:flex;align-items:center;padding:2px 9px 8px}
.skin-chrome .aq-field{display:flex;align-items:center;gap:7px;flex:1}
.skin-chrome .aq-flabel{color:#566}
.skin-chrome .aq-input{flex:1;font:12px 'Lucida Grande',sans-serif;background:#fff;border:1px solid #9bb0c8;border-radius:11px;padding:3px 11px;outline:0;box-shadow:inset 0 1px 2px #0001}
.skin-chrome .aq-go{font:inherit;color:#fff;padding:3px 15px;border:1px solid #1f6fe0;border-radius:13px;background:linear-gradient(#5fa8f5,#1f6fe0)}
.skin-chrome .aq-status{display:flex;align-items:center;gap:8px;padding:3px 9px;background:linear-gradient(#f2f6fb,#dfe7f1);border-top:1px solid #c2cfdf}
.skin-chrome .aq-status-text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skin-chrome .aq-security[data-state="secure"]::before{content:"\\1F512"}
.skin-chrome .aq-meter{width:130px;height:11px;border:1px solid #9bb0c8;border-radius:6px;overflow:hidden;background:#fff}
.skin-chrome .aq-meter-fill{display:block;height:100%;width:0;background:repeating-linear-gradient(90deg,#1f6fe0 0 8px,#5fa8f5 8px 16px)}`,
  shellCss: [
    "#tabstrip{background:linear-gradient(#fbfdff,#dbe4f1)!important;background-image:repeating-linear-gradient(#ffffff,#ffffff 1px,#eef3fb 1px,#eef3fb 4px)!important;border-bottom:1px solid #b9c8da!important}",
    "#tabstrip .tab,#tabstrip button,#newtab{color:#0a0a0a!important;font-family:'Lucida Grande','Helvetica Neue',sans-serif!important}",
    "#tabstrip .tab.active{background:linear-gradient(#ffffff,#e7eef8)!important;color:#0a2540!important;border-radius:9px 9px 0 0!important;box-shadow:inset 0 1px 0 #fff!important}",
    "#tabstrip .tab.active::before,#tabstrip .tab.active::after{background:#e7eef8!important}",
    "#navbar{background:linear-gradient(#fbfdff,#d7e1ef)!important;border-bottom:1px solid #b9c8da!important;box-shadow:inset 0 1px 0 #fff!important}",
    "#navbar .nav,#navbar button,#verb-build,#verb-run,#share-btn,#navbar .vl{color:#0a2540!important}",
    "#navbar .nav:hover:not(:disabled),#navbar button:hover{background:linear-gradient(#eef5ff,#cfe0f5)!important;border-radius:13px!important}",
    "#omni{background:#fff!important;border:1px solid #9bb0c8!important;border-radius:13px!important;box-shadow:inset 0 1px 3px #0001!important}",
    "#omni input{color:#0a0a0a!important;font-family:'Lucida Grande',sans-serif!important}",
    "#holo-dock{--hd-opaque-bg:#e8eef6!important;--hd-blur-bg:#e8eef6!important;--hd-acrylic-bg:#e8eef6!important;--hd-clear-bg:#e8eef6!important;--hd-ink:#0a2540!important;--hd-ink-dim:#566!important;--hd-border:#b9c8da!important;border-right:1px solid #b9c8da!important}",
    "#holo-dock .holo-dock-inner{background:linear-gradient(#f4f7fc,#dce5f1)!important}",
    "#holo-dock .holo-dock-icon,#holo-dock .holo-dock-mini{filter:brightness(0)!important;opacity:.85!important}",
    "#holo-credit{background:linear-gradient(#eef3fa,#d7e1ef)!important;border-top:1px solid #b9c8da!important;box-shadow:inset 0 1px 0 #fff!important}",
    "#holo-credit,#holo-credit *{color:#0a2540!important}",
    "#holo-credit .cv-pill{background:linear-gradient(#ffffff,#dbe5f1)!important;border:1px solid #9bb0c8!important;border-radius:11px!important}",
  ].join(""),
  menus: [
    M("File", [item("New Window", "tab.new"), item("Open Location…", "omni.focus"), item("Close", "tab.close"), item("Print…")]),
    M("Edit", [item("Cut"), item("Copy"), item("Paste"), item("Find…")]),
    M("View", [item("Reload Page", "nav.reload"), item("Stop", "nav.stop"), item("Make Text Bigger")]),
    M("History", [item("Back", "nav.back"), item("Forward", "nav.forward"), item("Home", "nav.home")]),
    M("Bookmarks", [item("Add Bookmark…"), item("Show All Bookmarks")]),
    M("Window", [item("Minimize"), item("Bring All to Front")]),
    M("Help", [item("About Safari", "about")]),
  ],
};

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// HOLOGRAPHIC — the OS's own signature: translucent glass, prismatic edges, glow over the κ-substrate.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const HOLO = {
  id: "holographic", title: "Holographic",
  fidelitySource: "Hologram OS native aesthetic — translucent prismatic glass",
  glyphs: glyphSet({ arrow: "#7fe6ff", home: "#9b8cff", reload: "#7fe6ff", open: "#7fe6ff", stop: "#ff6ad5", stopEdge: "#a03" }),
  throbberSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="hz" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a5cff"/><stop offset=".5" stop-color="#4fd0ff"/><stop offset="1" stop-color="#ff6ad5"/></linearGradient></defs><g class="hring"><circle cx="20" cy="20" r="14" fill="none" stroke="url(#hz)" stroke-width="4" stroke-linecap="round" stroke-dasharray="52 36"/></g></svg>`,
  palette: { chrome: "#0c1019", bevelLight: "#6cf", bevelDark: "#234", linkUnvisited: "#9bd0ff", linkVisited: "#cc99ff", text: "#eaf6ff", statusBg: "#0c1019" },
  font: { ui: "'Inter','Segoe UI',system-ui,sans-serif", doc: "'Inter',system-ui,sans-serif" },
  html: `<div class="skin-region-top"><div class="hl">` + menubar("hl", ["HOLO", "RESOLVE", "SPACE", "κ-STORE", "HELP"]) +
    `<div class="hl-toolbar">` + toolbarBtns("hl", ["back", "forward", "home", "reload", "stop", "|", "newwin"], false) + `</div>` +
    fieldRow("hl", "RESOLVE") + `</div></div>` + statusBar("hl", `<span class="hl-sub">SUBSTRATE · L5 ✓</span>`),
  css: `.skin-chrome{font-family:'Inter','Segoe UI',system-ui,sans-serif;font-size:12px;color:#eaf6ff;letter-spacing:.3px}
.skin-chrome .hl{background:rgba(12,16,26,.55);backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);border-bottom:1px solid rgba(120,200,255,.28);box-shadow:inset 0 0 24px rgba(90,180,255,.12)}
.skin-chrome .hl-menubar{display:flex;align-items:center;gap:4px;padding:5px 9px}
.skin-chrome .hl-menu{font:inherit;letter-spacing:1px;background:transparent;border:0;padding:3px 11px;border-radius:8px;color:#cfeaff;text-shadow:0 0 6px rgba(90,200,255,.45);cursor:default}
.skin-chrome .hl-menu:hover{background:linear-gradient(90deg,rgba(120,90,255,.35),rgba(80,200,255,.3));color:#fff}
.skin-chrome .hl-throb{margin-left:auto;width:30px;height:30px;display:grid;place-items:center}
.skin-chrome .hl-throb svg{width:26px;height:26px;filter:drop-shadow(0 0 5px #6cf)}
.skin-chrome .hl-throb .hring{transform-origin:50% 50%}
.skin-chrome .hl-throb.spinning .hring{animation:hl-spin .9s linear infinite}
@keyframes hl-spin{to{transform:rotate(360deg)}}
.skin-chrome .hl-toolbar{display:flex;align-items:center;gap:6px;padding:5px 9px}
.skin-chrome .hl-btn{display:grid;place-items:center;width:30px;height:27px;border:1px solid rgba(120,200,255,.35);border-radius:9px;background:rgba(120,180,255,.1);cursor:default}
.skin-chrome .hl-btn:hover{background:rgba(120,180,255,.25);box-shadow:0 0 12px rgba(120,200,255,.4)}
.skin-chrome .hl-btn[disabled]{opacity:.3}
.skin-chrome .hl-btn .ico svg{width:15px;height:15px;filter:drop-shadow(0 0 3px rgba(120,220,255,.7))}
.skin-chrome .hl-sep{width:1px;align-self:stretch;margin:4px 4px;background:rgba(120,200,255,.3)}
.skin-chrome .hl-fields{display:flex;align-items:center;padding:1px 9px 6px}
.skin-chrome .hl-field{display:flex;align-items:center;gap:8px;flex:1}
.skin-chrome .hl-flabel{color:#7fd0ff;letter-spacing:1px;text-shadow:0 0 6px rgba(90,200,255,.5)}
.skin-chrome .hl-input{flex:1;font:12px 'Inter',sans-serif;letter-spacing:1px;color:#eaf6ff;background:rgba(8,12,20,.55);border:1px solid rgba(120,200,255,.45);border-radius:13px;padding:3px 13px;outline:0;text-shadow:0 0 5px rgba(120,220,255,.4);box-shadow:0 0 14px rgba(90,180,255,.2) inset}
.skin-chrome .hl-go{font:inherit;color:#06121f;font-weight:700;padding:3px 15px;border:0;border-radius:13px;background:linear-gradient(90deg,#7fe6ff,#9b8cff);box-shadow:0 0 14px rgba(120,200,255,.5)}
.skin-chrome .hl-status{display:flex;align-items:center;gap:9px;padding:3px 9px;background:rgba(12,16,26,.5);backdrop-filter:blur(10px);border-top:1px solid rgba(120,200,255,.25)}
.skin-chrome .hl-status-text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 0 6px rgba(120,200,255,.4)}
.skin-chrome .hl-sub{color:#7fffc0;letter-spacing:1px;text-shadow:0 0 6px rgba(120,255,180,.5)}
.skin-chrome .hl-security[data-state="secure"]::before{content:"\\1F512"}
.skin-chrome .hl-meter{width:130px;height:10px;border:1px solid rgba(120,200,255,.35);border-radius:6px;overflow:hidden;background:rgba(8,12,20,.6)}
.skin-chrome .hl-meter-fill{display:block;height:100%;width:0;background:linear-gradient(90deg,#7a5cff,#4fd0ff,#ff6ad5);box-shadow:0 0 10px rgba(120,200,255,.6)}`,
  shellCss: [
    "#tabstrip{background:rgba(12,16,26,.55)!important;backdrop-filter:blur(14px) saturate(1.4)!important;-webkit-backdrop-filter:blur(14px) saturate(1.4)!important;border-bottom:1px solid rgba(120,200,255,.28)!important}",
    "#tabstrip .tab,#tabstrip button,#newtab{color:#dff3ff!important;text-shadow:0 0 6px rgba(90,200,255,.5)!important;font-family:'Inter','Segoe UI',sans-serif!important}",
    "#tabstrip .tab.active{background:linear-gradient(90deg,rgba(120,90,255,.45),rgba(80,200,255,.4))!important;color:#fff!important;border-radius:9px 9px 0 0!important;box-shadow:0 0 16px rgba(120,160,255,.55)!important}",
    "#tabstrip .tab.active::before,#tabstrip .tab.active::after{display:none!important}",
    "#navbar{background:rgba(12,16,26,.5)!important;backdrop-filter:blur(14px) saturate(1.4)!important;-webkit-backdrop-filter:blur(14px) saturate(1.4)!important;border-bottom:1px solid rgba(120,200,255,.28)!important;box-shadow:none!important}",
    "#navbar .nav,#navbar button,#verb-build,#verb-run,#share-btn,#navbar .vl{color:#cfe8ff!important;text-shadow:0 0 6px rgba(90,200,255,.45)!important}",
    "#navbar .nav:hover:not(:disabled),#navbar button:hover{background:rgba(120,180,255,.22)!important;border-radius:9px!important;box-shadow:0 0 12px rgba(120,200,255,.4)!important}",
    "#omni{background:rgba(8,12,20,.55)!important;border:1px solid rgba(120,200,255,.45)!important;border-radius:15px!important;box-shadow:0 0 16px rgba(90,180,255,.28),inset 0 0 12px rgba(90,180,255,.12)!important}",
    "#omni input{color:#eaf6ff!important;text-shadow:0 0 5px rgba(120,220,255,.4)!important;font-family:'Inter',sans-serif!important}",
    "#holo-dock{--hd-opaque-bg:rgba(12,16,26,.5)!important;--hd-blur-bg:rgba(12,16,26,.5)!important;--hd-acrylic-bg:rgba(12,16,26,.5)!important;--hd-clear-bg:rgba(12,16,26,.5)!important;--hd-ink:#dff3ff!important;--hd-ink-dim:#7fb8e0!important;--hd-border:rgba(120,200,255,.25)!important;border-right:1px solid rgba(120,200,255,.25)!important}",
    "#holo-dock .holo-dock-inner{background:rgba(12,16,26,.5)!important;backdrop-filter:blur(14px)!important}",
    "#holo-dock .holo-dock-icon,#holo-dock .holo-dock-mini{filter:brightness(0) invert(1) drop-shadow(0 0 4px rgba(120,200,255,.7))!important;opacity:.95!important}",
    "#holo-credit{background:linear-gradient(90deg,rgba(120,90,255,.32),rgba(80,200,255,.28))!important;backdrop-filter:blur(14px)!important;border-top:1px solid rgba(120,200,255,.3)!important}",
    "#holo-credit,#holo-credit *{color:#eaf6ff!important;text-shadow:0 0 6px rgba(120,200,255,.55)!important}",
    "#holo-credit .cv-pill{background:rgba(120,180,255,.18)!important;border:1px solid rgba(120,200,255,.4)!important;border-radius:11px!important}",
  ].join(""),
  menus: [
    M("HOLO", [item("New Surface", "tab.new"), item("Resolve…", "omni.focus"), item("Close", "tab.close")]),
    M("RESOLVE", [item("Reload", "nav.reload"), item("Stop", "nav.stop"), item("Re-derive (L5)")]),
    M("SPACE", [item("Back", "nav.back"), item("Forward", "nav.forward"), item("Home", "nav.home")]),
    M("κ-STORE", [item("Pin Object"), item("Verify by κ")]),
    M("HELP", [item("About Hologram", "about")]),
  ],
};

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// WINDOWS 98 — grey 3D chrome, navy→blue gradient title bars, MS Sans Serif, the hourglass, Start green.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const WIN98 = {
  id: "win98", title: "Windows 98",
  fidelitySource: "Windows 98 desktop + classic chrome (re-authored as web chrome)",
  glyphs: glyphSet({ arrow: "#000080", home: "#000080", reload: "#000080", open: "#000080", stop: "#b00000", stopEdge: "#700" }),
  throbberSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g class="hg"><path d="M13 8 H27 L20 20 L27 32 H13 L20 20 Z" fill="#dfe6f0" stroke="#0a1a3a" stroke-width="1.4"/><path d="M12 8 H28 M12 32 H28" stroke="#0a1a3a" stroke-width="2.2"/><path d="M16.5 30 H23.5 L20 22.5 Z" fill="#1084d0"/></g></svg>`,
  palette: { chrome: "#c0c0c0", bevelLight: "#ffffff", bevelDark: "#808080", linkUnvisited: "#0000ee", linkVisited: "#551a8b", text: "#000000", statusBg: "#c0c0c0" },
  font: { ui: "'MS Sans Serif', Tahoma, 'Segoe UI', sans-serif", doc: "'Times New Roman', Times, serif" },
  html: `<div class="skin-region-top"><div class="w9">` + menubar("w9", ["File", "Edit", "View", "Go", "Favorites", "Help"]) +
    `<div class="w9-toolbar">` + toolbarBtns("w9", ["back", "forward", "|", "stop", "reload", "home"], true) + `</div>` +
    fieldRow("w9", "Address") + `</div></div>` + statusBar("w9", `<span class="w9-zone">Internet zone</span>`),
  css: `.skin-chrome{--w9-face:#c0c0c0;--w9-l:#fff;--w9-d:#808080;--w9-dd:#404040;font-family:'MS Sans Serif',Tahoma,sans-serif;font-size:11px;color:#000}
.skin-chrome .w9{background:var(--w9-face);border-bottom:2px solid var(--w9-d);box-shadow:inset 1px 1px 0 var(--w9-l),inset -1px -1px 0 var(--w9-dd)}
.skin-chrome .w9-menubar{display:flex;align-items:center;gap:1px;padding:3px 5px}
.skin-chrome .w9-menu{font:inherit;background:transparent;border:0;padding:2px 9px;cursor:default}
.skin-chrome .w9-menu:hover{background:#000080;color:#fff}
.skin-chrome .w9-throb{margin-left:auto;width:32px;height:30px;display:grid;place-items:center;box-shadow:inset 1px 1px 0 var(--w9-dd),inset -1px -1px 0 var(--w9-l)}
.skin-chrome .w9-throb svg{width:26px;height:26px}
.skin-chrome .w9-throb .hg{transform-origin:50% 50%}
.skin-chrome .w9-throb.spinning .hg{animation:w9-flip 1.1s steps(2) infinite}
@keyframes w9-flip{to{transform:rotate(360deg)}}
.skin-chrome .w9-toolbar{display:flex;align-items:flex-end;gap:3px;padding:4px 6px;border-top:1px solid var(--w9-l)}
.skin-chrome .w9-btn{display:flex;flex-direction:column;align-items:center;gap:1px;min-width:42px;padding:3px 6px;background:var(--w9-face);border:0;cursor:default;box-shadow:inset 1px 1px 0 var(--w9-l),inset -1px -1px 0 var(--w9-dd)}
.skin-chrome .w9-btn:active{box-shadow:inset -1px -1px 0 var(--w9-l),inset 1px 1px 0 var(--w9-dd)}
.skin-chrome .w9-btn[disabled]{opacity:.45}
.skin-chrome .w9-btn .ico svg{width:18px;height:18px}
.skin-chrome .w9-btn .lbl{font-size:10px}
.skin-chrome .w9-sep{width:2px;align-self:stretch;margin:2px 3px;box-shadow:inset 1px 0 0 var(--w9-d),inset -1px 0 0 var(--w9-l)}
.skin-chrome .w9-fields{display:flex;align-items:center;padding:2px 6px 6px}
.skin-chrome .w9-field{display:flex;align-items:center;gap:6px;flex:1}
.skin-chrome .w9-flabel{font-weight:700}
.skin-chrome .w9-input{flex:1;font:11px 'MS Sans Serif',Tahoma,sans-serif;background:#fff;border:0;padding:2px 5px;box-shadow:inset 1px 1px 0 var(--w9-d),inset -1px -1px 0 var(--w9-l);outline:0}
.skin-chrome .w9-go{font:inherit;padding:2px 11px;background:var(--w9-face);border:0;box-shadow:inset 1px 1px 0 var(--w9-l),inset -1px -1px 0 var(--w9-dd)}
.skin-chrome .w9-status{display:flex;align-items:center;gap:8px;padding:3px 8px;background:var(--w9-face);box-shadow:inset 1px 1px 0 var(--w9-l),inset -1px -1px 0 var(--w9-d)}
.skin-chrome .w9-status-text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:inset 1px 1px 0 var(--w9-d);padding:1px 6px}
.skin-chrome .w9-zone{padding:1px 8px;box-shadow:inset 1px 1px 0 var(--w9-d)}
.skin-chrome .w9-security[data-state="secure"]::before{content:"\\1F512"}
.skin-chrome .w9-meter{width:120px;height:12px;background:#fff;box-shadow:inset 1px 1px 0 var(--w9-d)}
.skin-chrome .w9-meter-fill{display:block;height:100%;width:0;background:repeating-linear-gradient(90deg,#000080 0 6px,#1084d0 6px 12px)}`,
  shellCss: [
    "#tabstrip{background:#c0c0c0!important;border-bottom:1px solid #808080!important;box-shadow:inset 0 1px 0 #fff!important;font-family:'MS Sans Serif',Tahoma,sans-serif!important}",
    "#tabstrip .tab,#tabstrip button,#newtab{color:#000!important}",
    "#tabstrip .tab:not(.active){background:#c0c0c0!important;box-shadow:inset 1px 1px 0 #fff,inset -1px -1px 0 #808080!important}",
    "#tabstrip .tab.active{background:linear-gradient(90deg,#000080,#1084d0)!important;color:#fff!important;border-radius:0!important;box-shadow:inset 1px 1px 0 #5a9fe0!important}",
    "#tabstrip .tab.active::before,#tabstrip .tab.active::after{background:#1084d0!important}",
    "#navbar{background:#c0c0c0!important;border-bottom:2px solid #808080!important;box-shadow:inset 0 1px 0 #fff!important;font-family:'MS Sans Serif',Tahoma,sans-serif!important}",
    "#navbar .nav,#navbar button,#verb-build,#verb-run,#share-btn,#navbar .vl{color:#000!important}",
    "#navbar .nav:hover:not(:disabled),#navbar button:hover{background:#00000016!important}",
    "#omni{background:#fff!important;border:0!important;border-radius:0!important;box-shadow:inset 1px 1px 0 #808080,inset -1px -1px 0 #fff!important}",
    "#omni input{color:#000!important;font-family:'MS Sans Serif',Tahoma,sans-serif!important}",
    "#holo-dock{--hd-opaque-bg:#c0c0c0!important;--hd-blur-bg:#c0c0c0!important;--hd-acrylic-bg:#c0c0c0!important;--hd-clear-bg:#c0c0c0!important;--hd-ink:#000!important;--hd-ink-dim:#333!important;--hd-border:#808080!important;border-right:2px solid #808080!important;box-shadow:inset -1px 0 0 #fff!important}",
    "#holo-dock .holo-dock-inner{background:#c0c0c0!important}",
    "#holo-dock .holo-dock-icon,#holo-dock .holo-dock-mini{filter:brightness(0)!important;opacity:.9!important}",
    "#holo-credit{background:#c0c0c0!important;border-top:2px solid #fff!important;box-shadow:inset 0 1px 0 #fff!important;font-family:'MS Sans Serif',Tahoma,sans-serif!important}",
    "#holo-credit,#holo-credit *{color:#000!important}",
    "#holo-credit .cv-pill{background:linear-gradient(#3aa93a,#1d6f1d)!important;color:#fff!important;border:1px solid #145214!important;border-radius:0!important}",
  ].join(""),
  menus: [
    M("File", [item("New", "tab.new"), item("Open…", "omni.focus"), item("Close", "tab.close"), item("Print…")]),
    M("Edit", [item("Cut"), item("Copy"), item("Paste"), item("Find (on this page)…")]),
    M("View", [item("Refresh", "nav.reload"), item("Stop", "nav.stop"), item("Source")]),
    M("Go", [item("Back", "nav.back"), item("Forward", "nav.forward"), item("Home Page", "nav.home")]),
    M("Favorites", [item("Add to Favorites…"), item("Organize Favorites…")]),
    M("Help", [item("About Windows 98", "about")]),
  ],
};

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// HITCHHIKER'S GUIDE TO THE GALAXY — DON'T PANIC: friendly green terminal, glowing, Sirius Cybernetics.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const HHGTTG = {
  id: "hhgttg", title: "The Hitchhiker's Guide",
  fidelitySource: "Hitchhiker's Guide to the Galaxy (Douglas Adams) — re-authored homage, no copyrighted assets",
  glyphs: glyphSet({ arrow: "#33ff66", home: "#33ff66", reload: "#33ff66", open: "#33ff66", stop: "#ff5555", stopEdge: "#0a0" }),
  throbberSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g class="hgr"><circle cx="20" cy="20" r="14" fill="none" stroke="#33ff66" stroke-width="3" stroke-dasharray="7 7" stroke-linecap="round"/></g><text x="20" y="24" text-anchor="middle" font-family="monospace" font-size="11" font-weight="bold" fill="#9fffb0">42</text></svg>`,
  palette: { chrome: "#031206", bevelLight: "#33ff66", bevelDark: "#063", linkUnvisited: "#7fffa0", linkVisited: "#33cc88", text: "#5fffa0", statusBg: "#031206" },
  font: { ui: "'Courier New', 'DejaVu Sans Mono', monospace", doc: "'Courier New', monospace" },
  html: `<div class="skin-region-top"><div class="hg">` + menubar("hg", ["GUIDE", "ENTRY", "HITCHHIKE", "BABEL FISH", "DON'T PANIC"]) +
    `<div class="hg-toolbar">` + toolbarBtns("hg", ["back", "forward", "home", "reload", "stop", "|", "newwin"], false) + `</div>` +
    fieldRow("hg", "LOOK UP") + `</div></div>` + statusBar("hg", `<span class="hg-slogan">SHARE AND ENJOY</span>`),
  css: `.skin-chrome{font-family:'Courier New','DejaVu Sans Mono',monospace;font-size:12px;color:#5fffa0;text-transform:uppercase;letter-spacing:.6px}
.skin-chrome .hg{background:#020803;background-image:repeating-linear-gradient(0deg,transparent 0 2px,rgba(0,0,0,.35) 2px 3px);border-bottom:1px solid #0f6;box-shadow:inset 0 0 22px rgba(0,255,100,.12)}
.skin-chrome .hg-menubar{display:flex;align-items:center;gap:4px;padding:5px 8px}
.skin-chrome .hg-menu{font:inherit;text-transform:uppercase;letter-spacing:1px;background:transparent;border:1px solid #084;color:#3f6;text-shadow:0 0 6px rgba(0,255,100,.5);padding:2px 9px;border-radius:9px;cursor:default}
.skin-chrome .hg-menu:last-child{background:#0a4;color:#001;font-weight:700;border-color:#0f6;text-shadow:none}
.skin-chrome .hg-menu:hover{background:#063;color:#9fffb0}
.skin-chrome .hg-throb{margin-left:auto;width:32px;height:30px;display:grid;place-items:center}
.skin-chrome .hg-throb svg{width:28px;height:28px;filter:drop-shadow(0 0 4px #0f6)}
.skin-chrome .hg-throb .hgr{transform-origin:50% 50%}
.skin-chrome .hg-throb.spinning .hgr{animation:hg-spin 1.1s linear infinite}
@keyframes hg-spin{to{transform:rotate(360deg)}}
.skin-chrome .hg-toolbar{display:flex;align-items:center;gap:6px;padding:5px 8px}
.skin-chrome .hg-btn{display:grid;place-items:center;width:30px;height:26px;background:#031206;border:1px solid #0a4;border-radius:9px;cursor:default}
.skin-chrome .hg-btn:hover{background:#063;box-shadow:0 0 10px rgba(0,255,100,.4)}
.skin-chrome .hg-btn[disabled]{opacity:.3}
.skin-chrome .hg-btn .ico svg{width:15px;height:15px;filter:drop-shadow(0 0 3px #0f6)}
.skin-chrome .hg-sep{width:1px;align-self:stretch;margin:4px 4px;background:#0a4}
.skin-chrome .hg-fields{display:flex;align-items:center;padding:1px 8px 6px}
.skin-chrome .hg-field{display:flex;align-items:center;gap:8px;flex:1}
.skin-chrome .hg-flabel{color:#9fffb0;letter-spacing:1px;text-shadow:0 0 6px rgba(0,255,100,.5)}
.skin-chrome .hg-input{flex:1;font:13px 'Courier New',monospace;letter-spacing:1px;text-transform:uppercase;color:#5fffa0;background:#031206;border:2px solid #0f6;border-radius:11px;padding:3px 12px;outline:0;text-shadow:0 0 5px rgba(0,255,100,.4);box-shadow:0 0 12px rgba(0,255,100,.2) inset}
.skin-chrome .hg-go{font:inherit;font-weight:700;color:#001;padding:3px 15px;border:0;border-radius:11px;background:#0f6}
.skin-chrome .hg-status{display:flex;align-items:center;gap:9px;padding:3px 8px;background:#041a08;border-top:1px solid #0f6}
.skin-chrome .hg-status-text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#5fffa0;text-shadow:0 0 6px rgba(0,255,100,.4)}
.skin-chrome .hg-slogan{color:#9fffb0;font-weight:700;letter-spacing:1px;text-shadow:0 0 6px rgba(0,255,100,.5)}
.skin-chrome .hg-security[data-state="secure"]::before{content:"\\1F512";color:#0f6}
.skin-chrome .hg-meter{width:120px;height:11px;background:#020803;border:1px solid #0a4;border-radius:6px;overflow:hidden}
.skin-chrome .hg-meter-fill{display:block;height:100%;width:0;background:#0f6;box-shadow:0 0 8px #0f6}`,
  shellCss: [
    "#tabstrip{background:#020803!important;background-image:repeating-linear-gradient(0deg,transparent 0 2px,rgba(0,0,0,.3) 2px 3px)!important;border-bottom:1px solid #0f6!important;font-family:'Courier New',monospace!important}",
    "#tabstrip .tab,#tabstrip button,#newtab{color:#3f6!important;text-shadow:0 0 6px rgba(0,255,100,.5)!important;text-transform:uppercase!important;letter-spacing:1px!important}",
    "#tabstrip .tab.active{background:#063!important;color:#9fffb0!important;border-radius:10px 10px 0 0!important;box-shadow:0 0 12px rgba(0,255,100,.4)!important}",
    "#tabstrip .tab.active::before,#tabstrip .tab.active::after{display:none!important}",
    "#navbar{background:#020803!important;background-image:repeating-linear-gradient(0deg,transparent 0 2px,rgba(0,0,0,.3) 2px 3px)!important;border-bottom:1px solid #0a4!important;box-shadow:none!important;font-family:'Courier New',monospace!important}",
    "#navbar .nav,#navbar button,#verb-build,#verb-run,#share-btn,#navbar .vl{color:#3f6!important;text-shadow:0 0 6px rgba(0,255,100,.5)!important;text-transform:uppercase!important}",
    "#navbar .nav:hover:not(:disabled),#navbar button:hover{background:#063!important;border-radius:8px!important;box-shadow:0 0 10px rgba(0,255,100,.4)!important}",
    "#omni{background:#031206!important;border:2px solid #0f6!important;border-radius:13px!important;box-shadow:0 0 14px rgba(0,255,100,.3),inset 0 0 10px rgba(0,255,100,.15)!important}",
    "#omni input{color:#5fffa0!important;text-shadow:0 0 5px rgba(0,255,100,.4)!important;font-family:'Courier New',monospace!important;text-transform:uppercase!important;letter-spacing:1px!important}",
    "#omni input::placeholder{color:#2a7!important}",
    "#holo-dock{--hd-opaque-bg:#020803!important;--hd-blur-bg:#020803!important;--hd-acrylic-bg:#020803!important;--hd-clear-bg:#020803!important;--hd-ink:#3f6!important;--hd-ink-dim:#0c7!important;--hd-border:#0a4!important;border-right:1px solid #0f6!important}",
    "#holo-dock .holo-dock-inner{background:#020803!important}",
    "#holo-dock .holo-dock-icon,#holo-dock .holo-dock-mini{filter:brightness(0) invert(1) sepia(1) saturate(8) hue-rotate(75deg) drop-shadow(0 0 3px #0f6)!important;opacity:.95!important}",
    "#holo-credit{background:#041a08!important;border-top:1px solid #0f6!important;font-family:'Courier New',monospace!important}",
    "#holo-credit,#holo-credit *{color:#7fffa0!important;text-shadow:0 0 6px rgba(0,255,100,.5)!important;text-transform:uppercase!important;letter-spacing:1px!important}",
    "#holo-credit .cv-pill{background:#031206!important;color:#9fffb0!important;border:1px solid #0f6!important;border-radius:9px!important}",
  ].join(""),
  menus: [
    M("GUIDE", [item("New Entry", "tab.new"), item("Look Up…", "omni.focus"), item("Close", "tab.close")]),
    M("ENTRY", [item("Reload", "nav.reload"), item("Stop", "nav.stop"), item("Mostly Harmless")]),
    M("HITCHHIKE", [item("Back", "nav.back"), item("Forward", "nav.forward"), item("Home", "nav.home")]),
    M("BABEL FISH", [item("Translate"), item("Improbability Drive")]),
    M("DON'T PANIC", [item("About the Guide", "about"), item("The Answer is 42")]),
  ],
};

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// WINDOWS 11 — "Mica" : light flat rounded Fluent, Segoe UI, soft acrylic, the spinning ring of dots.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const win11dots = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g class="w11d">` +
  Array.from({ length: 8 }, (_, i) => { const a = i / 8 * 2 * Math.PI, x = 20 + 13 * Math.cos(a), y = 20 + 13 * Math.sin(a); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#0067c0" opacity="${(0.2 + 0.8 * i / 8).toFixed(2)}"/>`; }).join("") + `</g></svg>`;
const WIN11 = {
  id: "win11", title: "Windows 11",
  fidelitySource: "Windows 11 “Mica”/Fluent (re-authored as web chrome)",
  glyphs: glyphSet({ arrow: "#0067c0", home: "#0067c0", reload: "#0067c0", open: "#0067c0", stop: "#c42b1c", stopEdge: "#822" }),
  throbberSvg: win11dots,
  palette: { chrome: "#f3f3f3", bevelLight: "#ffffff", bevelDark: "#d6d6d6", linkUnvisited: "#0067c0", linkVisited: "#7a3fb0", text: "#1b1b1b", statusBg: "#f3f3f3" },
  font: { ui: "'Segoe UI Variable','Segoe UI',system-ui,sans-serif", doc: "Georgia,serif" },
  html: `<div class="skin-region-top"><div class="w11">` + menubar("w11", ["File", "Edit", "View", "Favorites", "Settings", "Help"]) +
    `<div class="w11-toolbar">` + toolbarBtns("w11", ["back", "forward", "reload", "home", "|", "newwin"], false) + `</div>` +
    fieldRow("w11", "Address") + `</div></div>` + statusBar("w11"),
  css: `.skin-chrome{font-family:'Segoe UI Variable','Segoe UI',system-ui,sans-serif;font-size:12px;color:#1b1b1b}
.skin-chrome .w11{background:#f9f9f9}
.skin-chrome .w11-menubar{display:flex;align-items:center;gap:2px;padding:4px 9px}
.skin-chrome .w11-menu{font:inherit;background:transparent;border:0;padding:4px 11px;border-radius:6px;cursor:default}
.skin-chrome .w11-menu:hover{background:#0000000d}
.skin-chrome .w11-throb{margin-left:auto;width:28px;height:28px;display:grid;place-items:center}
.skin-chrome .w11-throb svg{width:24px;height:24px}
.skin-chrome .w11-throb .w11d{transform-origin:50% 50%}
.skin-chrome .w11-throb.spinning .w11d{animation:w11-spin 1s steps(8) infinite}
@keyframes w11-spin{to{transform:rotate(360deg)}}
.skin-chrome .w11-toolbar{display:flex;align-items:center;gap:4px;padding:5px 9px}
.skin-chrome .w11-btn{display:grid;place-items:center;width:34px;height:30px;background:transparent;border:0;border-radius:7px;cursor:default}
.skin-chrome .w11-btn:hover{background:#0000000d}
.skin-chrome .w11-btn[disabled]{opacity:.35}
.skin-chrome .w11-btn .ico svg{width:17px;height:17px}
.skin-chrome .w11-sep{width:1px;align-self:stretch;margin:6px 4px;background:#0000001a}
.skin-chrome .w11-fields{display:flex;align-items:center;padding:1px 9px 8px}
.skin-chrome .w11-field{display:flex;align-items:center;gap:8px;flex:1}
.skin-chrome .w11-flabel{color:#555}
.skin-chrome .w11-input{flex:1;font:12px 'Segoe UI',sans-serif;background:#fff;border:1px solid #d0d0d0;border-radius:16px;padding:5px 14px;outline:0}
.skin-chrome .w11-input:focus{border-color:#0067c0;box-shadow:0 0 0 1px #0067c0}
.skin-chrome .w11-go{font:inherit;color:#fff;padding:5px 16px;border:0;border-radius:16px;background:#0067c0}
.skin-chrome .w11-status{display:flex;align-items:center;gap:8px;padding:4px 10px;background:#f3f3f3;border-top:1px solid #e2e2e2}
.skin-chrome .w11-status-text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skin-chrome .w11-security[data-state="secure"]::before{content:"\\1F512"}
.skin-chrome .w11-meter{width:130px;height:6px;border-radius:3px;overflow:hidden;background:#e2e2e2}
.skin-chrome .w11-meter-fill{display:block;height:100%;width:0;background:#0067c0}`,
  shellCss: [
    "#tabstrip{background:#f3f3f3!important;border-bottom:1px solid #e4e4e4!important}",
    "#tabstrip .tab,#tabstrip button,#newtab{color:#1b1b1b!important;font-family:'Segoe UI Variable','Segoe UI',sans-serif!important}",
    "#tabstrip .tab:not(.active){background:transparent!important}",
    "#tabstrip .tab.active{background:#fbfbfb!important;color:#0a0a0a!important;border-radius:9px 9px 0 0!important;box-shadow:0 -1px 0 #e0e0e0!important}",
    "#tabstrip .tab.active::before,#tabstrip .tab.active::after{background:#fbfbfb!important}",
    "#navbar{background:#fbfbfb!important;border-bottom:1px solid #ececec!important;box-shadow:none!important}",
    "#navbar .nav,#navbar button,#verb-build,#verb-run,#share-btn,#navbar .vl{color:#1b1b1b!important}",
    "#navbar .nav:hover:not(:disabled),#navbar button:hover{background:#0000000d!important;border-radius:7px!important}",
    "#omni{background:#fff!important;border:1px solid #d4d4d4!important;border-radius:18px!important;box-shadow:none!important}",
    "#omni input{color:#1b1b1b!important;font-family:'Segoe UI',sans-serif!important}",
    "#holo-dock{--hd-opaque-bg:#f3f3f3!important;--hd-blur-bg:#f3f3f3!important;--hd-acrylic-bg:#f3f3f3!important;--hd-clear-bg:#f3f3f3!important;--hd-ink:#1b1b1b!important;--hd-ink-dim:#666!important;--hd-border:#e4e4e4!important;border-right:1px solid #e4e4e4!important}",
    "#holo-dock .holo-dock-inner{background:#f3f3f3!important}",
    "#holo-dock .holo-dock-icon,#holo-dock .holo-dock-mini{filter:brightness(0)!important;opacity:.8!important}",
    "#holo-credit{background:#f3f3f3!important;border-top:1px solid #e4e4e4!important;box-shadow:none!important}",
    "#holo-credit,#holo-credit *{color:#1b1b1b!important}",
    "#holo-credit .cv-pill{background:#fff!important;border:1px solid #d4d4d4!important;border-radius:14px!important}",
  ].join(""),
  menus: [
    M("File", [item("New Tab", "tab.new"), item("Open…", "omni.focus"), item("Close Tab", "tab.close"), item("Print…")]),
    M("Edit", [item("Cut"), item("Copy"), item("Paste"), item("Find…")]),
    M("View", [item("Refresh", "nav.reload"), item("Stop", "nav.stop"), item("Zoom")]),
    M("Favorites", [item("Add to Favorites…"), item("Manage Favorites…")]),
    M("Settings", [item("Settings"), item("Appearance")]),
    M("Help", [item("About", "about")]),
  ],
};

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// macOS BIG SUR / SONOMA — frosted translucent, large rounded, SF Pro, traffic lights, spoke spinner.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const bsspokes = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g class="bss">` +
  Array.from({ length: 12 }, (_, i) => `<rect x="19" y="4" width="2" height="7" rx="1" fill="#8a8a8e" opacity="${(0.22 + 0.78 * i / 12).toFixed(2)}" transform="rotate(${i * 30} 20 20)"/>`).join("") + `</g></svg>`;
const BIGSUR = {
  id: "bigsur", title: "macOS Big Sur",
  fidelitySource: "macOS Big Sur / Sonoma (frosted glass + SF Pro) — re-authored as web chrome",
  glyphs: glyphSet({ arrow: "#0a84ff", home: "#0a84ff", reload: "#0a84ff", open: "#0a84ff", stop: "#ff453a", stopEdge: "#900" }),
  throbberSvg: bsspokes,
  palette: { chrome: "#f4f5f7", bevelLight: "#ffffff", bevelDark: "#d0d2d6", linkUnvisited: "#0a84ff", linkVisited: "#7a3fb0", text: "#1d1d1f", statusBg: "#f4f5f7" },
  font: { ui: "'SF Pro Text','Helvetica Neue',system-ui,sans-serif", doc: "'New York',Georgia,serif" },
  html: `<div class="skin-region-top"><div class="bs">` + menubar("bs", ["File", "Edit", "View", "History", "Bookmarks", "Window", "Help"]) +
    `<div class="bs-toolbar">` + toolbarBtns("bs", ["back", "forward", "home", "reload", "stop"], false) + `</div>` +
    fieldRow("bs", "Search or enter address") + `</div></div>` + statusBar("bs"),
  css: `.skin-chrome{font-family:'SF Pro Text','Helvetica Neue',system-ui,sans-serif;font-size:12px;color:#1d1d1f}
.skin-chrome .bs{background:rgba(248,249,251,.82);backdrop-filter:blur(20px) saturate(1.6);-webkit-backdrop-filter:blur(20px) saturate(1.6);border-bottom:1px solid #d6d8dc}
.skin-chrome .bs-menubar{display:flex;align-items:center;gap:2px;padding:5px 10px}
.skin-chrome .bs-menu{font:inherit;font-weight:500;background:transparent;border:0;padding:3px 10px;border-radius:6px;cursor:default}
.skin-chrome .bs-menu:hover{background:#0a84ff;color:#fff}
.skin-chrome .bs-throb{margin-left:auto;width:26px;height:26px;display:grid;place-items:center}
.skin-chrome .bs-throb svg{width:22px;height:22px}
.skin-chrome .bs-throb .bss{transform-origin:50% 50%}
.skin-chrome .bs-throb.spinning .bss{animation:bs-spin 1s steps(12) infinite}
@keyframes bs-spin{to{transform:rotate(360deg)}}
.skin-chrome .bs-toolbar{display:flex;align-items:center;gap:7px;padding:5px 11px}
.skin-chrome .bs-btn{display:grid;place-items:center;width:30px;height:26px;background:transparent;border:0;border-radius:7px;cursor:default}
.skin-chrome .bs-btn:hover{background:#00000010}
.skin-chrome .bs-btn[disabled]{opacity:.3}
.skin-chrome .bs-btn .ico svg{width:17px;height:17px}
.skin-chrome .bs-fields{display:flex;align-items:center;padding:0 11px 9px}
.skin-chrome .bs-field{display:flex;align-items:center;gap:8px;flex:1}
.skin-chrome .bs-flabel{display:none}
.skin-chrome .bs-input{flex:1;text-align:center;font:12px 'SF Pro Text',sans-serif;background:#ffffffcc;border:1px solid #d0d2d6;border-radius:9px;padding:5px 14px;outline:0}
.skin-chrome .bs-input:focus{border-color:#0a84ff;box-shadow:0 0 0 3px #0a84ff33}
.skin-chrome .bs-go{font:inherit;color:#fff;padding:5px 14px;border:0;border-radius:9px;background:#0a84ff}
.skin-chrome .bs-status{display:flex;align-items:center;gap:8px;padding:4px 11px;background:rgba(244,245,247,.8);backdrop-filter:blur(10px);border-top:1px solid #d6d8dc}
.skin-chrome .bs-status-text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skin-chrome .bs-security[data-state="secure"]::before{content:"\\1F512"}
.skin-chrome .bs-meter{width:130px;height:6px;border-radius:3px;overflow:hidden;background:#e0e2e6}
.skin-chrome .bs-meter-fill{display:block;height:100%;width:0;background:#0a84ff}`,
  shellCss: [
    "#tabstrip{background:rgba(246,247,249,.82)!important;backdrop-filter:blur(20px) saturate(1.6)!important;-webkit-backdrop-filter:blur(20px) saturate(1.6)!important;border-bottom:1px solid #d6d8dc!important}",
    "#tabstrip .tab,#tabstrip button,#newtab{color:#1d1d1f!important;font-family:'SF Pro Text','Helvetica Neue',sans-serif!important}",
    "#tabstrip .tab.active{background:rgba(255,255,255,.9)!important;color:#0a0a0a!important;border-radius:8px 8px 0 0!important;box-shadow:0 1px 4px #00000014!important}",
    "#tabstrip .tab.active::before,#tabstrip .tab.active::after{background:rgba(255,255,255,.9)!important}",
    "#navbar{background:rgba(248,249,251,.8)!important;backdrop-filter:blur(20px) saturate(1.6)!important;-webkit-backdrop-filter:blur(20px) saturate(1.6)!important;border-bottom:1px solid #d6d8dc!important;box-shadow:none!important}",
    "#navbar .nav,#navbar button,#verb-build,#verb-run,#share-btn,#navbar .vl{color:#1d1d1f!important}",
    "#navbar .nav:hover:not(:disabled),#navbar button:hover{background:#00000010!important;border-radius:7px!important}",
    "#omni{background:rgba(255,255,255,.85)!important;border:1px solid #d0d2d6!important;border-radius:10px!important;box-shadow:none!important}",
    "#omni input{color:#1d1d1f!important;font-family:'SF Pro Text',sans-serif!important}",
    "#holo-dock{--hd-opaque-bg:rgba(244,245,247,.8)!important;--hd-blur-bg:rgba(244,245,247,.8)!important;--hd-acrylic-bg:rgba(244,245,247,.8)!important;--hd-clear-bg:rgba(244,245,247,.8)!important;--hd-ink:#1d1d1f!important;--hd-ink-dim:#666!important;--hd-border:#d6d8dc!important;border-right:1px solid #d6d8dc!important}",
    "#holo-dock .holo-dock-inner{background:rgba(244,245,247,.8)!important;backdrop-filter:blur(20px)!important}",
    "#holo-dock .holo-dock-icon,#holo-dock .holo-dock-mini{filter:brightness(0)!important;opacity:.78!important}",
    "#holo-credit{background:rgba(244,245,247,.8)!important;backdrop-filter:blur(20px)!important;border-top:1px solid #d6d8dc!important}",
    "#holo-credit,#holo-credit *{color:#1d1d1f!important}",
    "#holo-credit .cv-pill{background:rgba(255,255,255,.85)!important;border:1px solid #d0d2d6!important;border-radius:9px!important}",
  ].join(""),
  menus: [
    M("File", [item("New Tab", "tab.new"), item("Open Location…", "omni.focus"), item("Close Tab", "tab.close")]),
    M("Edit", [item("Cut"), item("Copy"), item("Paste"), item("Find…")]),
    M("View", [item("Reload Page", "nav.reload"), item("Stop", "nav.stop")]),
    M("History", [item("Back", "nav.back"), item("Forward", "nav.forward"), item("Home", "nav.home")]),
    M("Bookmarks", [item("Add Bookmark…"), item("Show Bookmarks")]),
    M("Window", [item("Minimize"), item("Zoom")]),
    M("Help", [item("About Safari", "about")]),
  ],
};

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CRT TERMINAL (amber) — black field, amber phosphor glow, scanlines, monospace, the blinking cursor.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const CRT = {
  id: "crt", title: "CRT Terminal (Amber)",
  fidelitySource: "Amber phosphor CRT terminal (VT-era) — re-authored homage",
  glyphs: glyphSet({ arrow: "#ffb000", home: "#ffb000", reload: "#ffb000", open: "#ffb000", stop: "#ff5500", stopEdge: "#922" }),
  throbberSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect class="crtcur" x="11" y="11" width="18" height="18" fill="#ffb000"/></svg>`,
  palette: { chrome: "#0a0700", bevelLight: "#ffb000", bevelDark: "#3a2600", linkUnvisited: "#ffcf6a", linkVisited: "#cc8a00", text: "#ffb000", statusBg: "#0a0700" },
  font: { ui: "'Consolas','DejaVu Sans Mono',monospace", doc: "'Consolas',monospace" },
  html: `<div class="skin-region-top"><div class="crt">` + menubar("crt", ["SYS", "EDIT", "VIEW", "NET", "MAN"]) +
    `<div class="crt-toolbar">` + toolbarBtns("crt", ["back", "forward", "home", "reload", "stop", "|", "newwin"], false) + `</div>` +
    fieldRow("crt", "C:\\>") + `</div></div>` + statusBar("crt", `<span class="crt-rdy">READY.</span>`),
  css: `.skin-chrome{font-family:'Consolas','DejaVu Sans Mono',monospace;font-size:12px;color:#ffb000;text-transform:uppercase;letter-spacing:.5px}
.skin-chrome .crt{background:#0a0700;background-image:repeating-linear-gradient(0deg,transparent 0 2px,rgba(0,0,0,.4) 2px 3px);border-bottom:1px solid #ffb000;box-shadow:inset 0 0 26px rgba(255,176,0,.12)}
.skin-chrome .crt-menubar{display:flex;align-items:center;gap:10px;padding:5px 9px}
.skin-chrome .crt-menu{font:inherit;text-transform:uppercase;letter-spacing:1px;background:transparent;border:0;color:#ffb000;text-shadow:0 0 6px rgba(255,176,0,.6);padding:1px 4px;cursor:default}
.skin-chrome .crt-menu:hover{background:#ffb000;color:#0a0700;text-shadow:none}
.skin-chrome .crt-throb{margin-left:auto;width:26px;height:26px;display:grid;place-items:center}
.skin-chrome .crt-throb .crtcur{filter:drop-shadow(0 0 4px #ffb000)}
.skin-chrome .crt-throb.spinning .crtcur{animation:crt-blink .55s steps(1) infinite}
@keyframes crt-blink{50%{opacity:0}}
.skin-chrome .crt-toolbar{display:flex;align-items:center;gap:8px;padding:5px 9px}
.skin-chrome .crt-btn{display:grid;place-items:center;width:28px;height:24px;background:transparent;border:1px solid #6a4a00;cursor:default}
.skin-chrome .crt-btn:hover{border-color:#ffb000;box-shadow:0 0 8px rgba(255,176,0,.4)}
.skin-chrome .crt-btn[disabled]{opacity:.3}
.skin-chrome .crt-btn .ico svg{width:14px;height:14px;filter:drop-shadow(0 0 3px #ffb000)}
.skin-chrome .crt-sep{width:1px;align-self:stretch;margin:4px 3px;background:#6a4a00}
.skin-chrome .crt-fields{display:flex;align-items:center;padding:1px 9px 6px}
.skin-chrome .crt-field{display:flex;align-items:center;gap:8px;flex:1}
.skin-chrome .crt-flabel{color:#ffcf6a;text-shadow:0 0 6px rgba(255,176,0,.6)}
.skin-chrome .crt-input{flex:1;font:13px 'Consolas',monospace;letter-spacing:1px;text-transform:uppercase;color:#ffb000;background:#0a0700;border:1px solid #ffb000;padding:3px 10px;outline:0;text-shadow:0 0 5px rgba(255,176,0,.5);box-shadow:0 0 10px rgba(255,176,0,.15) inset}
.skin-chrome .crt-go{font:inherit;font-weight:700;color:#0a0700;padding:3px 13px;border:0;background:#ffb000}
.skin-chrome .crt-status{display:flex;align-items:center;gap:9px;padding:3px 9px;background:#0a0700;border-top:1px solid #ffb000}
.skin-chrome .crt-status-text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#ffb000;text-shadow:0 0 6px rgba(255,176,0,.5)}
.skin-chrome .crt-rdy{color:#ffcf6a;text-shadow:0 0 6px rgba(255,176,0,.6)}
.skin-chrome .crt-security[data-state="secure"]::before{content:"\\1F512";color:#ffb000}
.skin-chrome .crt-meter{width:120px;height:11px;background:#1a1000;border:1px solid #6a4a00}
.skin-chrome .crt-meter-fill{display:block;height:100%;width:0;background:#ffb000;box-shadow:0 0 8px #ffb000}`,
  shellCss: [
    "#tabstrip{background:#0a0700!important;background-image:repeating-linear-gradient(0deg,transparent 0 2px,rgba(0,0,0,.35) 2px 3px)!important;border-bottom:1px solid #ffb000!important;font-family:'Consolas',monospace!important}",
    "#tabstrip .tab,#tabstrip button,#newtab{color:#ffb000!important;text-shadow:0 0 6px rgba(255,176,0,.6)!important;text-transform:uppercase!important;letter-spacing:1px!important}",
    "#tabstrip .tab.active{background:#1a1000!important;color:#ffcf6a!important;border-radius:0!important;box-shadow:0 0 10px rgba(255,176,0,.4),inset 0 -2px 0 #ffb000!important}",
    "#tabstrip .tab.active::before,#tabstrip .tab.active::after{display:none!important}",
    "#navbar{background:#0a0700!important;background-image:repeating-linear-gradient(0deg,transparent 0 2px,rgba(0,0,0,.35) 2px 3px)!important;border-bottom:1px solid #6a4a00!important;box-shadow:none!important;font-family:'Consolas',monospace!important}",
    "#navbar .nav,#navbar button,#verb-build,#verb-run,#share-btn,#navbar .vl{color:#ffb000!important;text-shadow:0 0 6px rgba(255,176,0,.6)!important;text-transform:uppercase!important}",
    "#navbar .nav:hover:not(:disabled),#navbar button:hover{background:#2a1c00!important;box-shadow:0 0 10px rgba(255,176,0,.3)!important}",
    "#omni{background:#0a0700!important;border:1px solid #ffb000!important;border-radius:0!important;box-shadow:0 0 12px rgba(255,176,0,.25),inset 0 0 10px rgba(255,176,0,.1)!important}",
    "#omni input{color:#ffb000!important;text-shadow:0 0 5px rgba(255,176,0,.5)!important;font-family:'Consolas',monospace!important;text-transform:uppercase!important;letter-spacing:1px!important}",
    "#omni input::placeholder{color:#9a6a00!important}",
    "#holo-dock{--hd-opaque-bg:#0a0700!important;--hd-blur-bg:#0a0700!important;--hd-acrylic-bg:#0a0700!important;--hd-clear-bg:#0a0700!important;--hd-ink:#ffb000!important;--hd-ink-dim:#cc8a00!important;--hd-border:#6a4a00!important;border-right:1px solid #ffb000!important}",
    "#holo-dock .holo-dock-inner{background:#0a0700!important}",
    "#holo-dock .holo-dock-icon,#holo-dock .holo-dock-mini{filter:brightness(0) invert(1) sepia(1) saturate(8) hue-rotate(5deg) drop-shadow(0 0 3px #ffb000)!important;opacity:.95!important}",
    "#holo-credit{background:#0a0700!important;border-top:1px solid #ffb000!important;font-family:'Consolas',monospace!important}",
    "#holo-credit,#holo-credit *{color:#ffb000!important;text-shadow:0 0 6px rgba(255,176,0,.5)!important;text-transform:uppercase!important;letter-spacing:1px!important}",
    "#holo-credit .cv-pill{background:#0a0700!important;color:#ffcf6a!important;border:1px solid #ffb000!important;border-radius:0!important}",
  ].join(""),
  menus: [
    M("SYS", [item("NEW SESSION", "tab.new"), item("OPEN…", "omni.focus"), item("LOGOUT", "tab.close")]),
    M("EDIT", [item("COPY"), item("PASTE"), item("FIND")]),
    M("VIEW", [item("REFRESH", "nav.reload"), item("HALT", "nav.stop")]),
    M("NET", [item("BACK", "nav.back"), item("FORWARD", "nav.forward"), item("HOME", "nav.home")]),
    M("MAN", [item("ABOUT", "about"), item("HELP PAGES")]),
  ],
};

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// LORD OF THE RINGS — parchment + gold, serif, the One Ring throbber (gold ring, fiery inscription glow).
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const LOTR = {
  id: "lotr", title: "Lord of the Rings",
  fidelitySource: "Lord of the Rings (Tolkien) — re-authored homage, no copyrighted assets",
  glyphs: glyphSet({ arrow: "#5a3d18", home: "#5a3d18", reload: "#5a3d18", open: "#5a3d18", stop: "#9a2a10", stopEdge: "#511" }),
  throbberSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="lz" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd98a"/><stop offset=".5" stop-color="#c9912b"/><stop offset="1" stop-color="#ff7a18"/></linearGradient></defs><g class="lring"><circle cx="20" cy="20" r="13" fill="none" stroke="url(#lz)" stroke-width="4"/></g></svg>`,
  palette: { chrome: "#e7d7ad", bevelLight: "#fff6e0", bevelDark: "#b89a5e", linkUnvisited: "#7a4a12", linkVisited: "#9a6a2a", text: "#3a2a12", statusBg: "#e7d7ad" },
  font: { ui: "'Cinzel','Trajan Pro',Georgia,'Times New Roman',serif", doc: "Georgia,'Times New Roman',serif" },
  html: `<div class="skin-region-top"><div class="lr">` + menubar("lr", ["THE RING", "FELLOWSHIP", "MAP", "LORE", "HELP"]) +
    `<div class="lr-toolbar">` + toolbarBtns("lr", ["back", "forward", "home", "reload", "stop", "|", "newwin"], false) + `</div>` +
    fieldRow("lr", "SEEK") + `</div></div>` + statusBar("lr", `<span class="lr-motto">NOT ALL THOSE WHO WANDER ARE LOST</span>`),
  css: `.skin-chrome{font-family:'Cinzel','Trajan Pro',Georgia,serif;font-size:12px;color:#3a2a12;letter-spacing:.5px}
.skin-chrome .lr{background:#e7d7ad;background-image:radial-gradient(rgba(120,90,40,.08) 1px,transparent 1px);background-size:5px 5px;border-bottom:2px solid #b89a5e;box-shadow:inset 0 0 26px rgba(120,80,20,.12)}
.skin-chrome .lr-menubar{display:flex;align-items:center;gap:6px;padding:5px 9px}
.skin-chrome .lr-menu{font:inherit;letter-spacing:1px;background:transparent;border:0;color:#5a3d18;padding:2px 8px;cursor:default}
.skin-chrome .lr-menu:hover{color:#9a6a18;text-shadow:0 0 8px rgba(255,150,20,.5)}
.skin-chrome .lr-throb{margin-left:auto;width:30px;height:30px;display:grid;place-items:center}
.skin-chrome .lr-throb svg{width:26px;height:26px;filter:drop-shadow(0 0 5px rgba(255,140,20,.7))}
.skin-chrome .lr-throb .lring{transform-origin:50% 50%}
.skin-chrome .lr-throb.spinning .lring{animation:lr-spin 1.4s linear infinite}
@keyframes lr-spin{to{transform:rotate(360deg)}}
.skin-chrome .lr-toolbar{display:flex;align-items:center;gap:6px;padding:5px 9px}
.skin-chrome .lr-btn{display:grid;place-items:center;width:30px;height:26px;background:#efe2bf;border:1px solid #b89a5e;border-radius:5px;cursor:default}
.skin-chrome .lr-btn:hover{border-color:#c9912b;box-shadow:0 0 10px rgba(201,145,43,.5)}
.skin-chrome .lr-btn[disabled]{opacity:.4}
.skin-chrome .lr-btn .ico svg{width:15px;height:15px}
.skin-chrome .lr-sep{width:1px;align-self:stretch;margin:4px 4px;background:#b89a5e}
.skin-chrome .lr-fields{display:flex;align-items:center;padding:1px 9px 6px}
.skin-chrome .lr-field{display:flex;align-items:center;gap:8px;flex:1}
.skin-chrome .lr-flabel{color:#7a4a12;letter-spacing:1px}
.skin-chrome .lr-input{flex:1;font:13px Georgia,serif;letter-spacing:.5px;color:#3a2a12;background:#fbf3dc;border:1px solid #b89a5e;border-radius:5px;padding:3px 11px;outline:0}
.skin-chrome .lr-input:focus{border-color:#c9912b;box-shadow:0 0 0 2px rgba(201,145,43,.3)}
.skin-chrome .lr-go{font:inherit;font-weight:700;color:#2a1c08;padding:3px 14px;border:1px solid #8a6a1e;border-radius:5px;background:linear-gradient(#ffd98a,#c9912b)}
.skin-chrome .lr-status{display:flex;align-items:center;gap:9px;padding:3px 9px;background:#e7d7ad;border-top:1px solid #fff6e0}
.skin-chrome .lr-status-text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skin-chrome .lr-motto{color:#7a4a12;font-style:italic;letter-spacing:1px}
.skin-chrome .lr-security[data-state="secure"]::before{content:"\\1F512"}
.skin-chrome .lr-meter{width:120px;height:11px;background:#fbf3dc;border:1px solid #b89a5e;border-radius:5px;overflow:hidden}
.skin-chrome .lr-meter-fill{display:block;height:100%;width:0;background:linear-gradient(90deg,#c9912b,#ff7a18)}`,
  shellCss: [
    "#tabstrip{background:#e7d7ad!important;background-image:radial-gradient(rgba(120,90,40,.08) 1px,transparent 1px)!important;background-size:5px 5px!important;border-bottom:2px solid #b89a5e!important;font-family:'Cinzel','Trajan Pro',Georgia,serif!important}",
    "#tabstrip .tab,#tabstrip button,#newtab{color:#3a2a12!important;letter-spacing:1px!important}",
    "#tabstrip .tab:not(.active){background:#e0cf9f!important}",
    "#tabstrip .tab.active{background:#241a0c!important;color:#ffcf6a!important;border-radius:7px 7px 0 0!important;box-shadow:0 0 14px rgba(255,140,20,.45)!important;text-shadow:0 0 8px rgba(255,150,20,.6)!important}",
    "#tabstrip .tab.active::before,#tabstrip .tab.active::after{background:#241a0c!important}",
    "#navbar{background:#e7d7ad!important;border-bottom:2px solid #b89a5e!important;box-shadow:inset 0 1px 0 #fff6e0!important;font-family:'Cinzel','Trajan Pro',Georgia,serif!important}",
    "#navbar .nav,#navbar button,#verb-build,#verb-run,#share-btn,#navbar .vl{color:#5a3d18!important;letter-spacing:1px!important}",
    "#navbar .nav:hover:not(:disabled),#navbar button:hover{background:#00000010!important;color:#9a6a18!important}",
    "#omni{background:#fbf3dc!important;border:1px solid #b89a5e!important;border-radius:6px!important;box-shadow:inset 0 1px 2px rgba(120,80,20,.15)!important}",
    "#omni input{color:#3a2a12!important;font-family:Georgia,serif!important}",
    "#holo-dock{--hd-opaque-bg:#e7d7ad!important;--hd-blur-bg:#e7d7ad!important;--hd-acrylic-bg:#e7d7ad!important;--hd-clear-bg:#e7d7ad!important;--hd-ink:#5a3d18!important;--hd-ink-dim:#7a5a2a!important;--hd-border:#b89a5e!important;border-right:2px solid #b89a5e!important}",
    "#holo-dock .holo-dock-inner{background:#e7d7ad!important}",
    "#holo-dock .holo-dock-icon,#holo-dock .holo-dock-mini{filter:brightness(0) sepia(1) saturate(3) hue-rotate(-15deg)!important;opacity:.78!important}",
    "#holo-credit{background:#e7d7ad!important;border-top:1px solid #fff6e0!important;box-shadow:inset 0 1px 0 #fff6e0!important;font-family:'Cinzel',Georgia,serif!important}",
    "#holo-credit,#holo-credit *{color:#5a3d18!important;letter-spacing:1px!important}",
    "#holo-credit .cv-pill{background:linear-gradient(#ffd98a,#c9912b)!important;color:#2a1c08!important;border:1px solid #8a6a1e!important;border-radius:5px!important}",
  ].join(""),
  menus: [
    M("THE RING", [item("New Quest", "tab.new"), item("Seek…", "omni.focus"), item("Close", "tab.close")]),
    M("FELLOWSHIP", [item("Back", "nav.back"), item("Forward", "nav.forward"), item("The Shire", "nav.home")]),
    M("MAP", [item("Reload", "nav.reload"), item("Halt", "nav.stop"), item("Middle-earth")]),
    M("LORE", [item("Histories"), item("Tongues of Elves")]),
    M("HELP", [item("About", "about"), item("The One Ring")]),
  ],
};

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// FOUNDATION (Asimov) — Encyclopedia Galactica / Trantor: dark + gold, scholarly serif, Prime Radiant.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const FOUNDATION = {
  id: "foundation", title: "Foundation",
  fidelitySource: "Asimov's Foundation (Encyclopedia Galactica / Prime Radiant) — re-authored homage",
  glyphs: glyphSet({ arrow: "#d4af37", home: "#d4af37", reload: "#d4af37", open: "#d4af37", stop: "#c0392b", stopEdge: "#700" }),
  throbberSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g class="prad" fill="none" stroke="#d4af37"><circle cx="20" cy="20" r="14" stroke-width="1" opacity=".5"/><circle cx="20" cy="20" r="9" stroke-width="1.4"/><ellipse cx="20" cy="20" rx="14" ry="6" stroke-width="1"/><ellipse cx="20" cy="20" rx="6" ry="14" stroke-width="1"/></g></svg>`,
  palette: { chrome: "#0b0f17", bevelLight: "#d4af37", bevelDark: "#1a2230", linkUnvisited: "#e0c050", linkVisited: "#b89020", text: "#e8d9a8", statusBg: "#0b0f17" },
  font: { ui: "'Spectral','EB Garamond',Georgia,serif", doc: "'Spectral',Georgia,serif" },
  html: `<div class="skin-region-top"><div class="fn">` + menubar("fn", ["ENCYCLOPEDIA", "PSYCHOHISTORY", "TRANTOR", "TERMINUS", "HELP"]) +
    `<div class="fn-toolbar">` + toolbarBtns("fn", ["back", "forward", "home", "reload", "stop", "|", "newwin"], false) + `</div>` +
    fieldRow("fn", "QUERY") + `</div></div>` + statusBar("fn", `<span class="fn-sub">FOUNDATION · TERMINUS</span>`),
  css: `.skin-chrome{font-family:'Spectral','EB Garamond',Georgia,serif;font-size:12px;color:#e8d9a8;letter-spacing:.4px}
.skin-chrome .fn{background:#0b0f17;background-image:linear-gradient(rgba(212,175,55,.05),transparent);border-bottom:1px solid #d4af37;box-shadow:inset 0 0 30px rgba(212,175,55,.08)}
.skin-chrome .fn-menubar{display:flex;align-items:center;gap:8px;padding:5px 10px}
.skin-chrome .fn-menu{font:inherit;letter-spacing:1.5px;font-size:11px;background:transparent;border:0;color:#d4af37;padding:2px 6px;cursor:default}
.skin-chrome .fn-menu:hover{color:#ffe9a8;text-shadow:0 0 8px rgba(212,175,55,.6)}
.skin-chrome .fn-throb{margin-left:auto;width:30px;height:30px;display:grid;place-items:center}
.skin-chrome .fn-throb svg{width:27px;height:27px;filter:drop-shadow(0 0 4px rgba(212,175,55,.6))}
.skin-chrome .fn-throb .prad{transform-origin:50% 50%}
.skin-chrome .fn-throb.spinning .prad{animation:fn-spin 2.4s linear infinite}
@keyframes fn-spin{to{transform:rotate(360deg)}}
.skin-chrome .fn-toolbar{display:flex;align-items:center;gap:7px;padding:5px 10px}
.skin-chrome .fn-btn{display:grid;place-items:center;width:30px;height:26px;background:#10151f;border:1px solid #2a3344;border-radius:3px;cursor:default}
.skin-chrome .fn-btn:hover{border-color:#d4af37;box-shadow:0 0 10px rgba(212,175,55,.4)}
.skin-chrome .fn-btn[disabled]{opacity:.3}
.skin-chrome .fn-btn .ico svg{width:15px;height:15px}
.skin-chrome .fn-sep{width:1px;align-self:stretch;margin:4px 4px;background:#2a3344}
.skin-chrome .fn-fields{display:flex;align-items:center;padding:1px 10px 6px}
.skin-chrome .fn-field{display:flex;align-items:center;gap:8px;flex:1}
.skin-chrome .fn-flabel{color:#d4af37;letter-spacing:2px;font-size:11px}
.skin-chrome .fn-input{flex:1;font:13px 'Spectral',Georgia,serif;letter-spacing:.5px;color:#e8d9a8;background:#10151f;border:1px solid #2a3344;border-radius:3px;padding:3px 12px;outline:0}
.skin-chrome .fn-input:focus{border-color:#d4af37;box-shadow:0 0 0 2px rgba(212,175,55,.25)}
.skin-chrome .fn-go{font:inherit;letter-spacing:1px;color:#0b0f17;font-weight:700;padding:3px 14px;border:0;border-radius:3px;background:#d4af37}
.skin-chrome .fn-status{display:flex;align-items:center;gap:9px;padding:3px 10px;background:#0b0f17;border-top:1px solid #2a3344}
.skin-chrome .fn-status-text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e8d9a8}
.skin-chrome .fn-sub{color:#d4af37;letter-spacing:2px;font-size:11px}
.skin-chrome .fn-security[data-state="secure"]::before{content:"\\1F512";color:#d4af37}
.skin-chrome .fn-meter{width:130px;height:9px;background:#10151f;border:1px solid #2a3344;border-radius:4px;overflow:hidden}
.skin-chrome .fn-meter-fill{display:block;height:100%;width:0;background:linear-gradient(90deg,#b89020,#ffe9a8)}`,
  shellCss: [
    "#tabstrip{background:#0b0f17!important;border-bottom:1px solid #d4af37!important;font-family:'Spectral','EB Garamond',Georgia,serif!important}",
    "#tabstrip .tab,#tabstrip button,#newtab{color:#e8d9a8!important;letter-spacing:1px!important}",
    "#tabstrip .tab:not(.active){background:#10151f!important}",
    "#tabstrip .tab.active{background:#161d2a!important;color:#ffe9a8!important;border-radius:4px 4px 0 0!important;box-shadow:0 0 12px rgba(212,175,55,.35),inset 0 -2px 0 #d4af37!important;text-shadow:0 0 8px rgba(212,175,55,.5)!important}",
    "#tabstrip .tab.active::before,#tabstrip .tab.active::after{background:#161d2a!important}",
    "#navbar{background:#0b0f17!important;border-bottom:1px solid #2a3344!important;box-shadow:none!important;font-family:'Spectral','EB Garamond',Georgia,serif!important}",
    "#navbar .nav,#navbar button,#verb-build,#verb-run,#share-btn,#navbar .vl{color:#d4af37!important;letter-spacing:1px!important}",
    "#navbar .nav:hover:not(:disabled),#navbar button:hover{background:#161d2a!important;box-shadow:0 0 10px rgba(212,175,55,.3)!important}",
    "#omni{background:#10151f!important;border:1px solid #d4af37!important;border-radius:4px!important;box-shadow:0 0 12px rgba(212,175,55,.2),inset 0 0 10px rgba(212,175,55,.06)!important}",
    "#omni input{color:#e8d9a8!important;font-family:'Spectral',Georgia,serif!important;letter-spacing:.5px!important}",
    "#omni input::placeholder{color:#8a7a4a!important}",
    "#holo-dock{--hd-opaque-bg:#0b0f17!important;--hd-blur-bg:#0b0f17!important;--hd-acrylic-bg:#0b0f17!important;--hd-clear-bg:#0b0f17!important;--hd-ink:#d4af37!important;--hd-ink-dim:#9a8030!important;--hd-border:#2a3344!important;border-right:1px solid #d4af37!important}",
    "#holo-dock .holo-dock-inner{background:#0b0f17!important}",
    "#holo-dock .holo-dock-icon,#holo-dock .holo-dock-mini{filter:brightness(0) invert(1) sepia(1) saturate(4) hue-rotate(0deg) drop-shadow(0 0 3px rgba(212,175,55,.6))!important;opacity:.9!important}",
    "#holo-credit{background:#0b0f17!important;border-top:1px solid #d4af37!important;font-family:'Spectral',Georgia,serif!important}",
    "#holo-credit,#holo-credit *{color:#d4af37!important;letter-spacing:1.5px!important}",
    "#holo-credit .cv-pill{background:#10151f!important;color:#e8d9a8!important;border:1px solid #d4af37!important;border-radius:3px!important}",
  ].join(""),
  menus: [
    M("ENCYCLOPEDIA", [item("New Entry", "tab.new"), item("Query…", "omni.focus"), item("Close", "tab.close")]),
    M("PSYCHOHISTORY", [item("Reload", "nav.reload"), item("Halt", "nav.stop"), item("The Prime Radiant")]),
    M("TRANTOR", [item("Back", "nav.back"), item("Forward", "nav.forward"), item("Terminus", "nav.home")]),
    M("TERMINUS", [item("The Vault"), item("Seldon Crisis")]),
    M("HELP", [item("About the Foundation", "about")]),
  ],
};

// ── build each: write files, pin, seal ──────────────────────────────────────────────────────────────
const SKINS = [XP, LCARS, AQUA, HOLO, WIN98, HHGTTG, WIN11, BIGSUR, CRT, LOTR, FOUNDATION];
for (const s of SKINS) {
  const dir = join(skinsRoot, s.id);
  mkdirSync(join(dir, "glyphs"), { recursive: true });
  mkdirSync(join(dir, "throbber"), { recursive: true });
  const put = (rel, text) => writeFileSync(join(dir, rel), text.endsWith("\n") ? text : text + "\n");
  put("chrome.html", s.html); put("chrome.css", s.css); put("shell.css", s.shellCss);
  for (const [name, svg] of Object.entries(s.glyphs)) put("glyphs/" + name + ".svg", svg);
  put("throbber/throb.svg", s.throbberSvg);
  const rels = ["chrome.html", "chrome.css", "shell.css", ...Object.keys(s.glyphs).map((n) => "glyphs/" + n + ".svg"), "throbber/throb.svg"];
  const files = {};
  for (const rel of rels) files[rel] = await assetKappa(new Uint8Array(readFileSync(join(dir, rel))));
  writeFileSync(join(dir, "skin.pin.json"), JSON.stringify({ "@type": "holo:VendoredSkin", skinId: s.id, fidelitySource: s.fidelitySource, files }, null, 2) + "\n");
  const k = (rel) => files[rel];
  const manifest = {
    "@context": "/usr/share/ns/browser-skin.jsonld", "@type": "holo:BrowserSkin",
    "holo:skinId": s.id, "holo:title": s.title, "holo:fidelitySource": s.fidelitySource, "holo:appliesTo": "browser",
    "holo:chrome": { html: k("chrome.html"), css: k("chrome.css") },
    "holo:shellCss": k("shell.css"),
    "holo:glyphs": Object.fromEntries(Object.keys(s.glyphs).map((n) => [n, k("glyphs/" + n + ".svg")])),
    "holo:throbber": { kind: "svg", fps: 24, svg: k("throbber/throb.svg") },
    "holo:palette": s.palette, "holo:font": s.font,
    "holo:behavior": { throbberSource: "loading", statusSource: "nav.current.url", backEnabled: "nav.canGoBack", forwardEnabled: "nav.canGoForward", securityChip: "securityState", menus: s.menus },
  };
  manifest["@id"] = await skinKappa(manifest);
  writeFileSync(join(dir, "skin.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(s.id + " sealed: " + manifest["@id"].slice(0, 30) + "…  (" + rels.length + " assets, +shellCss)");
}
