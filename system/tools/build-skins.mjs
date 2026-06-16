#!/usr/bin/env node
// build-skins.mjs — author + pin the additional Holo Browser skins (holo:BrowserSkin): Netscape
// Navigator, Internet Explorer, and early Opera. Each is a PURE DATA DROP — zero engine change (the
// witness's open-model check proves this). This script writes each skin's chrome (html/css/glyphs/
// throbber) to os/usr/lib/holo/skins/<id>/, computes every asset's κ (did:holo:sha256), writes the
// committed skin.pin.json, assembles the skin.json manifest referencing those κ, and seals it to its
// own @id (Law L5). Re-run after editing any template here. Usage: node tools/build-skins.mjs
//
// Fidelity references (studied, RE-AUTHORED as web chrome — not byte-copied brand artwork; honest
// caveat recorded by the witness): Netscape Navigator 3 / Communicator (File·Edit·View·Go·Bookmarks·
// Options·Directory·Window·Help; icon-over-text toolbar; the "N" meteor-shower throbber; Location bar).
// Internet Explorer 5/6 (File·Edit·View·Favorites·Tools·Help; colourful Back/Forward/Stop/Refresh;
// Address bar + Go; the spinning "e" with a gold orbit). Opera 6 classic / pre-Presto (File·Edit·View·
// Navigation·Bookmarks·Mail·Window·Help; the signature page-zoom control; the red "O" throbber).

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assetKappa, skinKappa } from "../os/usr/lib/holo/holo-skin.js";

const here = dirname(fileURLToPath(import.meta.url));
const skinsRoot = join(here, "..", "os", "usr", "lib", "holo", "skins");

// ── shared chrome builders (the structure is common; era styling lives in each skin's css) ──────────
const ACT = { back: "nav.back", forward: "nav.forward", home: "nav.home", reload: "nav.reload", stop: "nav.stop", open: "omni.focus", newwin: "tab.new" };
const toolbarBtns = (prefix, btns, withLabel) => btns.map((b) => b === "|" ? `<span class="${prefix}-sep"></span>`
  : `<button class="${prefix}-btn" data-action="${ACT[b]}" title="${b[0].toUpperCase() + b.slice(1)}"><span class="ico" data-glyph="${b}"></span>${withLabel ? `<span class="lbl">${LBL[b]}</span>` : ""}</button>`).join("");
const LBL = { back: "Back", forward: "Forward", home: "Home", reload: "Reload", stop: "Stop", open: "Open", newwin: "New" };
const menubar = (prefix, labels) => `<div class="${prefix}-menubar" role="menubar">` + labels.map((l) => `<button class="${prefix}-menu" data-menu="${l}">${l}</button>`).join("") + `<span class="${prefix}-throb" data-throbber title="Loading"></span></div>`;

// ── glyph sets (re-authored, era-coloured). Geometry shared; colour per skin via fill. ──────────────
const glyphSet = (c) => ({
  back: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><path d="M11 3 L5 9 L11 15 Z" fill="${c.arrow}"/></svg>`,
  forward: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><path d="M7 3 L13 9 L7 15 Z" fill="${c.arrow}"/></svg>`,
  home: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><path d="M9 2 L16 9 H13 V16 H10 V11 H8 V16 H5 V9 H2 Z" fill="${c.home}"/></svg>`,
  reload: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><path d="M9 3 A6 6 0 1 0 15 9 H13 A4 4 0 1 1 9 5 V8 L14 4 L9 0 Z" fill="${c.reload}"/></svg>`,
  open: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><path d="M2 5 H7 L9 7 H16 V14 H2 Z" fill="none" stroke="${c.open}" stroke-width="1.6"/></svg>`,
  stop: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><path d="M6 2 H12 L16 6 V12 L12 16 H6 L2 12 V6 Z" fill="${c.stop}" stroke="${c.stopEdge}" stroke-width="1"/></svg>`,
  newwin: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><rect x="3" y="4" width="10" height="9" fill="#fff" stroke="${c.arrow}" stroke-width="1.4"/><rect x="6" y="6" width="9" height="8" fill="#fff" stroke="${c.arrow}" stroke-width="1.4"/></svg>`,
});

// ── the status bar (common shape; styled per era) ───────────────────────────────────────────────────
const statusBar = (prefix, extra = "") => `<div class="skin-region-bottom"><div class="${prefix}-status">` +
  `<span class="${prefix}-security" data-security data-state="neutral"></span>` +
  `<span class="${prefix}-status-text" data-status></span>` + extra +
  `<span class="${prefix}-meter"><span class="${prefix}-meter-fill"></span></span></div></div>`;

// ── the field row (Location/Address) ────────────────────────────────────────────────────────────────
const fieldRow = (prefix, label) => `<div class="${prefix}-fields"><label class="${prefix}-field"><span class="${prefix}-flabel">${label}</span><input class="${prefix}-input" data-url data-action="omni.focus" readonly><button class="${prefix}-go" data-action="omni.focus">Go</button></label></div>`;

// the default Motif/closed-vocab menu mapping helper for a manifest (most items honest "noop").
const M = (label, items) => ({ label, items });
const item = (label, action = "noop") => ({ label, action });

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// NETSCAPE NAVIGATOR (3 / gold) — grey Win95 chrome, icon-over-text toolbar, the "N" meteor throbber.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const NETSCAPE = {
  id: "netscape", title: "Netscape Navigator",
  fidelitySource: "Netscape Navigator 3 / Communicator (re-authored as web chrome)",
  glyphs: glyphSet({ arrow: "#000080", home: "#000080", reload: "#000080", open: "#000080", stop: "#a00000", stopEdge: "#600" }),
  throbberSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#1a2a6c"/><g class="meteors" stroke="#7fb0ff" stroke-width="1.4" fill="none"><line x1="2" y1="6" x2="10" y2="14"/><line x1="14" y1="2" x2="22" y2="10"/><line x1="26" y1="6" x2="34" y2="14"/></g><text x="20" y="29" font-family="Times,serif" font-size="26" font-style="italic" font-weight="bold" text-anchor="middle" fill="#dfe8ff">N</text></svg>`,
  palette: { chrome: "#c0c0c0", bevelLight: "#ffffff", bevelDark: "#808080", linkUnvisited: "#0000ee", linkVisited: "#551a8b", text: "#000000", statusBg: "#c0c0c0" },
  font: { ui: "Helvetica, 'Nimbus Sans', Arial, sans-serif", doc: "'Times New Roman', Times, serif" },
  html: `<div class="skin-region-top"><div class="ns">` +
    menubar("ns", ["File", "Edit", "View", "Go", "Bookmarks", "Options", "Directory", "Window", "Help"]) +
    `<div class="ns-toolbar">` + toolbarBtns("ns", ["back", "forward", "home", "reload", "|", "open", "stop", "|", "newwin"], true) + `</div>` +
    fieldRow("ns", "Location:") +
    `</div></div>` + statusBar("ns"),
  css: `.skin-chrome{--ns-face:#c0c0c0;--ns-l:#fff;--ns-d:#808080;--ns-dd:#404040;font-family:Helvetica,'Nimbus Sans',Arial,sans-serif;font-size:12px;color:#000}
.skin-chrome .ns{background:var(--ns-face);border-bottom:2px solid var(--ns-d);box-shadow:inset 1px 1px 0 var(--ns-l),inset -1px -1px 0 var(--ns-dd)}
.skin-chrome .ns-menubar{display:flex;align-items:center;gap:2px;padding:3px 5px}
.skin-chrome .ns-menu{font:inherit;background:transparent;border:0;padding:2px 8px;cursor:default}
.skin-chrome .ns-menu:hover{background:#000080;color:#fff}
.skin-chrome .ns-throb{margin-left:auto;width:36px;height:36px;display:grid;place-items:center;overflow:hidden;border:2px solid var(--ns-d);box-shadow:inset 1px 1px 0 var(--ns-dd)}
.skin-chrome .ns-throb svg{width:32px;height:32px;display:block}
.skin-chrome .ns-throb .meteors{opacity:.25;transition:opacity .2s}
.skin-chrome .ns-throb.spinning .meteors{opacity:1;animation:ns-meteor .5s linear infinite}
@keyframes ns-meteor{0%{transform:translate(-6px,-6px);opacity:.2}50%{opacity:1}100%{transform:translate(6px,6px);opacity:.2}}
.skin-chrome .ns-toolbar{display:flex;align-items:flex-end;gap:3px;padding:4px 6px;border-top:1px solid var(--ns-l)}
.skin-chrome .ns-btn{display:flex;flex-direction:column;align-items:center;gap:1px;min-width:46px;padding:3px 5px;background:var(--ns-face);border:0;cursor:default;box-shadow:inset 1px 1px 0 var(--ns-l),inset -1px -1px 0 var(--ns-dd)}
.skin-chrome .ns-btn:active{box-shadow:inset -1px -1px 0 var(--ns-l),inset 1px 1px 0 var(--ns-dd)}
.skin-chrome .ns-btn[disabled]{opacity:.45}
.skin-chrome .ns-btn .ico svg{width:20px;height:20px;display:block}
.skin-chrome .ns-btn .lbl{font-size:10px}
.skin-chrome .ns-sep{width:2px;align-self:stretch;margin:2px 3px;box-shadow:inset 1px 0 0 var(--ns-d),inset -1px 0 0 var(--ns-l)}
.skin-chrome .ns-fields{display:flex;padding:2px 6px 6px}
.skin-chrome .ns-field{display:flex;align-items:center;gap:6px;flex:1}
.skin-chrome .ns-flabel{font-weight:700}
.skin-chrome .ns-input{flex:1;font:12px 'Courier New',monospace;background:#fff;border:0;padding:2px 5px;box-shadow:inset 1px 1px 0 var(--ns-d),inset -1px -1px 0 var(--ns-l);outline:0}
.skin-chrome .ns-go{font:inherit;padding:2px 10px;background:var(--ns-face);border:0;box-shadow:inset 1px 1px 0 var(--ns-l),inset -1px -1px 0 var(--ns-dd)}
.skin-chrome .ns-status{display:flex;align-items:center;gap:8px;padding:3px 8px;background:var(--ns-face);box-shadow:inset 1px 1px 0 var(--ns-l),inset -1px -1px 0 var(--ns-d)}
.skin-chrome .ns-status-text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skin-chrome .ns-security::before{content:"\\1F513";font-size:11px}
.skin-chrome .ns-security[data-state="secure"]::before{content:"\\1F512"}
.skin-chrome .ns-meter{width:110px;height:11px;background:#000;box-shadow:inset 1px 1px 0 var(--ns-d)}
.skin-chrome .ns-meter-fill{display:block;height:100%;width:0;background:repeating-linear-gradient(90deg,#00a 0 4px,#22c 4px 8px)}`,
  menus: [
    M("File", [item("New Web Browser", "tab.new"), item("Open Location…", "omni.focus"), item("Open File…", "omni.focus"), item("Reload", "nav.reload"), item("Print…"), item("Close", "tab.close"), item("Exit")]),
    M("Edit", [item("Cut"), item("Copy"), item("Paste"), item("Find in Object…")]),
    M("View", [item("Reload", "nav.reload"), item("Load Images"), item("Document Source"), item("Document Info")]),
    M("Go", [item("Back", "nav.back"), item("Forward", "nav.forward"), item("Home", "nav.home")]),
    M("Bookmarks", [item("Add Bookmark"), item("Go to Bookmarks…")]),
    M("Options", [item("General Preferences…"), item("Auto Load Images"), item("Show Toolbar")]),
    M("Directory", [item("Netscape's Home", "nav.home"), item("What's New?"), item("What's Cool?")]),
    M("Window", [item("Netscape Mail"), item("Address Book"), item("History…")]),
    M("Help", [item("About Netscape", "about"), item("Release Notes")]),
  ],
};

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// INTERNET EXPLORER (5 / 6) — Win98/2000 silver chrome, colourful toolbar, the spinning "e" + gold orbit.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const IE = {
  id: "ie", title: "Internet Explorer",
  fidelitySource: "Microsoft Internet Explorer 5/6 (re-authored as web chrome)",
  glyphs: glyphSet({ arrow: "#1d5fbf", home: "#d08020", reload: "#1a8a2a", open: "#1d5fbf", stop: "#c01818", stopEdge: "#800" }),
  throbberSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#eef3fb"/><g class="orbit"><ellipse cx="20" cy="22" rx="17" ry="6" fill="none" stroke="#e0a83a" stroke-width="2.4"/></g><path d="M9 22 a11 9 0 1 1 4 7 M9 22 h15" fill="none" stroke="#1d5fbf" stroke-width="3.4" stroke-linecap="round"/></svg>`,
  palette: { chrome: "#d4d0c8", bevelLight: "#ffffff", bevelDark: "#808080", linkUnvisited: "#0000ee", linkVisited: "#551a8b", text: "#000000", statusBg: "#d4d0c8" },
  font: { ui: "Tahoma, 'Segoe UI', Arial, sans-serif", doc: "'Times New Roman', Times, serif" },
  html: `<div class="skin-region-top"><div class="ie">` +
    menubar("ie", ["File", "Edit", "View", "Favorites", "Tools", "Help"]) +
    `<div class="ie-toolbar">` + toolbarBtns("ie", ["back", "forward", "stop", "reload", "home"], true) + `</div>` +
    fieldRow("ie", "Address") +
    `</div></div>` + statusBar("ie", `<span class="ie-zone">Internet</span>`),
  css: `.skin-chrome{--ie-face:#d4d0c8;--ie-l:#fff;--ie-d:#808080;--ie-dd:#404040;font-family:Tahoma,'Segoe UI',Arial,sans-serif;font-size:11px;color:#000}
.skin-chrome .ie{background:var(--ie-face);border-bottom:1px solid var(--ie-d)}
.skin-chrome .ie-menubar{display:flex;align-items:center;gap:1px;padding:2px 6px;background:linear-gradient(#fff,#ece9e0)}
.skin-chrome .ie-menu{font:inherit;background:transparent;border:0;padding:2px 8px;cursor:default}
.skin-chrome .ie-menu:hover{background:#316ac5;color:#fff}
.skin-chrome .ie-throb{margin-left:auto;width:34px;height:34px;display:grid;place-items:center}
.skin-chrome .ie-throb svg{width:30px;height:30px;display:block}
.skin-chrome .ie-throb .orbit{transform-origin:50% 55%;transition:opacity .2s}
.skin-chrome .ie-throb.spinning .orbit{animation:ie-orbit 1s linear infinite}
@keyframes ie-orbit{to{transform:rotate(360deg)}}
.skin-chrome .ie-toolbar{display:flex;align-items:center;gap:2px;padding:4px 6px}
.skin-chrome .ie-btn{display:flex;align-items:center;gap:5px;padding:4px 8px;background:transparent;border:1px solid transparent;border-radius:3px;cursor:default}
.skin-chrome .ie-btn:hover{border-color:#316ac5;background:#e8f0ff}
.skin-chrome .ie-btn:active{box-shadow:inset 1px 1px 2px #0003}
.skin-chrome .ie-btn[disabled]{opacity:.4}
.skin-chrome .ie-btn .ico svg{width:20px;height:20px;display:block}
.skin-chrome .ie-btn .lbl{font-size:11px}
.skin-chrome .ie-sep{width:1px;align-self:stretch;margin:3px 4px;background:var(--ie-d)}
.skin-chrome .ie-fields{display:flex;align-items:center;gap:6px;padding:2px 8px 6px}
.skin-chrome .ie-field{display:flex;align-items:center;gap:6px;flex:1}
.skin-chrome .ie-flabel{color:#444}
.skin-chrome .ie-input{flex:1;font:11px Tahoma,sans-serif;background:#fff;border:1px solid var(--ie-d);box-shadow:inset 1px 1px 1px #0001;padding:3px 6px;outline:0}
.skin-chrome .ie-go{font:inherit;padding:3px 12px;border:1px solid var(--ie-d);background:linear-gradient(#fff,#e4e0d8);border-radius:2px}
.skin-chrome .ie-status{display:flex;align-items:center;gap:8px;padding:2px 8px;background:var(--ie-face);border-top:1px solid var(--ie-l)}
.skin-chrome .ie-status-text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:inset 1px 1px 0 var(--ie-d);padding:1px 6px}
.skin-chrome .ie-zone{padding:1px 8px;box-shadow:inset 1px 1px 0 var(--ie-d)}
.skin-chrome .ie-security::before{content:"";display:inline-block;width:12px}
.skin-chrome .ie-security[data-state="secure"]::before{content:"\\1F512"}
.skin-chrome .ie-meter{width:120px;height:12px;background:#fff;box-shadow:inset 1px 1px 0 var(--ie-d)}
.skin-chrome .ie-meter-fill{display:block;height:100%;width:0;background:repeating-linear-gradient(90deg,#316ac5 0 6px,#5a8de0 6px 12px)}`,
  menus: [
    M("File", [item("New Window", "tab.new"), item("Open…", "omni.focus"), item("Save As…"), item("Print…"), item("Close", "tab.close")]),
    M("Edit", [item("Cut"), item("Copy"), item("Paste"), item("Find on this Page…")]),
    M("View", [item("Refresh", "nav.reload"), item("Stop", "nav.stop"), item("Source"), item("Text Size")]),
    M("Favorites", [item("Add to Favorites…"), item("Organize Favorites…")]),
    M("Tools", [item("Internet Options…"), item("Pop-up Blocker")]),
    M("Help", [item("About Internet Explorer", "about"), item("Contents and Index")]),
  ],
};

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// OPERA 6 (classic, pre-Presto) — light chrome, the signature page-zoom control, the red "O" throbber.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const OPERA = {
  id: "opera", title: "Opera",
  fidelitySource: "Opera 6 classic / pre-Presto (re-authored as web chrome)",
  glyphs: glyphSet({ arrow: "#333", home: "#cc0000", reload: "#cc0000", open: "#333", stop: "#cc0000", stopEdge: "#800" }),
  throbberSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="none" stroke="#cc0000" stroke-width="6"/><g class="osweep"><path d="M20 4 a16 16 0 0 1 14 8" fill="none" stroke="#ff6a6a" stroke-width="6" stroke-linecap="round"/></g></svg>`,
  palette: { chrome: "#ece9d8", bevelLight: "#ffffff", bevelDark: "#9a9a86", linkUnvisited: "#0000ee", linkVisited: "#551a8b", text: "#000000", statusBg: "#ece9d8" },
  font: { ui: "'Segoe UI', Tahoma, Arial, sans-serif", doc: "'Times New Roman', Times, serif" },
  html: `<div class="skin-region-top"><div class="op">` +
    menubar("op", ["File", "Edit", "View", "Navigation", "Bookmarks", "Mail", "Window", "Help"]) +
    `<div class="op-toolbar">` + toolbarBtns("op", ["back", "forward", "home", "reload", "stop", "|", "newwin"], false) +
    `<span class="op-zoom" title="Page zoom">100% &#x25BE;</span>` + `</div>` +
    fieldRow("op", "Address") +
    `</div></div>` + statusBar("op", `<span class="op-zoom2">100%</span>`),
  css: `.skin-chrome{--op-face:#ece9d8;--op-l:#fff;--op-d:#9a9a86;--op-red:#cc0000;font-family:'Segoe UI',Tahoma,Arial,sans-serif;font-size:11px;color:#000}
.skin-chrome .op{background:var(--op-face);border-bottom:1px solid var(--op-d)}
.skin-chrome .op-menubar{display:flex;align-items:center;gap:1px;padding:2px 6px}
.skin-chrome .op-menu{font:inherit;background:transparent;border:0;padding:2px 8px;cursor:default}
.skin-chrome .op-menu:hover{background:var(--op-red);color:#fff}
.skin-chrome .op-throb{margin-left:auto;width:32px;height:32px;display:grid;place-items:center}
.skin-chrome .op-throb svg{width:28px;height:28px;display:block}
.skin-chrome .op-throb .osweep{transform-origin:50% 50%;opacity:0;transition:opacity .2s}
.skin-chrome .op-throb.spinning .osweep{opacity:1;animation:op-spin .8s linear infinite}
@keyframes op-spin{to{transform:rotate(360deg)}}
.skin-chrome .op-toolbar{display:flex;align-items:center;gap:3px;padding:4px 6px}
.skin-chrome .op-btn{display:grid;place-items:center;width:28px;height:26px;background:#f6f4ec;border:1px solid var(--op-d);border-radius:3px;cursor:default}
.skin-chrome .op-btn:hover{border-color:var(--op-red);background:#fff}
.skin-chrome .op-btn:active{background:#e6e3d4}
.skin-chrome .op-btn[disabled]{opacity:.4}
.skin-chrome .op-btn .ico svg{width:17px;height:17px;display:block}
.skin-chrome .op-sep{width:1px;align-self:stretch;margin:3px 3px;background:var(--op-d)}
.skin-chrome .op-zoom{margin-left:6px;padding:3px 8px;background:#fff;border:1px solid var(--op-d);border-radius:3px;font-size:11px;cursor:default}
.skin-chrome .op-fields{display:flex;align-items:center;gap:6px;padding:2px 8px 6px}
.skin-chrome .op-field{display:flex;align-items:center;gap:6px;flex:1}
.skin-chrome .op-flabel{color:#555}
.skin-chrome .op-input{flex:1;font:11px 'Segoe UI',sans-serif;background:#fff;border:1px solid var(--op-d);padding:3px 6px;outline:0}
.skin-chrome .op-input:focus{border-color:var(--op-red)}
.skin-chrome .op-go{font:inherit;padding:3px 12px;border:1px solid var(--op-d);background:var(--op-red);color:#fff;border-radius:3px}
.skin-chrome .op-status{display:flex;align-items:center;gap:8px;padding:2px 8px;background:var(--op-face);border-top:1px solid var(--op-l)}
.skin-chrome .op-status-text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skin-chrome .op-zoom2{padding:1px 6px;border:1px solid var(--op-d);border-radius:3px;background:#fff}
.skin-chrome .op-security::before{content:"";display:inline-block;width:10px}
.skin-chrome .op-security[data-state="secure"]::before{content:"\\1F512"}
.skin-chrome .op-meter{width:110px;height:11px;background:#fff;border:1px solid var(--op-d)}
.skin-chrome .op-meter-fill{display:block;height:100%;width:0;background:var(--op-red)}`,
  menus: [
    M("File", [item("New Window", "tab.new"), item("Open…", "omni.focus"), item("Save As…"), item("Print…"), item("Close", "tab.close")]),
    M("Edit", [item("Cut"), item("Copy"), item("Paste"), item("Find…")]),
    M("View", [item("Reload", "nav.reload"), item("Stop", "nav.stop"), item("Zoom"), item("Full Screen")]),
    M("Navigation", [item("Back", "nav.back"), item("Forward", "nav.forward"), item("Home", "nav.home"), item("Fast Forward")]),
    M("Bookmarks", [item("Add Bookmark…"), item("Manage Bookmarks…")]),
    M("Mail", [item("New Message"), item("Check Mail")]),
    M("Window", [item("Cascade"), item("Tile"), item("Panels")]),
    M("Help", [item("About Opera", "about"), item("Help Contents")]),
  ],
};

// ── build each skin: write files, pin, seal the manifest ────────────────────────────────────────────
const SKINS = [NETSCAPE, IE, OPERA];
for (const s of SKINS) {
  const dir = join(skinsRoot, s.id);
  mkdirSync(join(dir, "glyphs"), { recursive: true });
  mkdirSync(join(dir, "throbber"), { recursive: true });
  // write the chrome + assets
  const files = {};
  const put = (rel, text) => { writeFileSync(join(dir, rel), text.endsWith("\n") ? text : text + "\n"); };
  put("chrome.html", s.html); put("chrome.css", s.css);
  for (const [name, svg] of Object.entries(s.glyphs)) put("glyphs/" + name + ".svg", svg);
  put("throbber/throb.svg", s.throbberSvg);
  // pin every asset to its κ — re-read the just-written bytes so κ matches exactly what is served.
  const rels = ["chrome.html", "chrome.css", ...Object.keys(s.glyphs).map((n) => "glyphs/" + n + ".svg"), "throbber/throb.svg"];
  const { readFileSync } = await import("node:fs");
  for (const rel of rels) files[rel] = await assetKappa(new Uint8Array(readFileSync(join(dir, rel))));
  writeFileSync(join(dir, "skin.pin.json"), JSON.stringify({ "@type": "holo:VendoredSkin", skinId: s.id, fidelitySource: s.fidelitySource, files }, null, 2) + "\n");
  // assemble + seal the manifest
  const k = (rel) => files[rel];
  const manifest = {
    "@context": "/usr/share/ns/browser-skin.jsonld", "@type": "holo:BrowserSkin",
    "holo:skinId": s.id, "holo:title": s.title, "holo:fidelitySource": s.fidelitySource, "holo:appliesTo": "browser",
    "holo:chrome": { html: k("chrome.html"), css: k("chrome.css") },
    "holo:glyphs": Object.fromEntries(Object.keys(s.glyphs).map((n) => [n, k("glyphs/" + n + ".svg")])),
    "holo:throbber": { kind: "svg", fps: 24, svg: k("throbber/throb.svg") },
    "holo:palette": s.palette, "holo:font": s.font,
    "holo:behavior": { throbberSource: "loading", statusSource: "nav.current.url", backEnabled: "nav.canGoBack", forwardEnabled: "nav.canGoForward", securityChip: "securityState", menus: s.menus },
  };
  manifest["@id"] = await skinKappa(manifest);
  writeFileSync(join(dir, "skin.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(s.id + " sealed: " + manifest["@id"].slice(0, 30) + "…  (" + rels.length + " assets)");
}
