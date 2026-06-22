// holo-dock.js — Holo Dock (ADR-0059): a native-feel dock for Hologram OS — and a live BUNDLE of objects.
//
// Drop-in:  <script src="_shared/holo-dock.js" defer></script>   (exposes window.HoloDock)
//
// The bar is a grouping of objects: each tile is an app/object reference, and any objects can be
// BUNDLED into a group (drag one onto another) that reads as a single stacked tile and opens into a
// flyout of its members; ungroup spreads them back out. Everything is an object — a group carries a
// content fingerprint over its members. It is OS chrome, built from existing engines, not a foreign
// runtime (ADR-0029): SHAPE = a zebar zpack placement; GLASS = TranslucentTB's accent model as the
// --holo-glass-* tokens; PROPORTION = the golden ratio (holo-phi); FEEL = the host OS (HoloPlatform);
// LAUNCHERS = the content-addressed app catalog. The editable content (pins/groups, glass, …) is a
// κ-object (holo-dock-config.json, /usr read-only) with a writable OPFS override (/home). Pure DOM +
// Web APIs, no framework, no CDN (Law L4) — every byte editable in the Holo Workspace IDE.

(function () {
  "use strict";
  var W = typeof window !== "undefined" ? window : globalThis;
  if (W.HoloDock) return;
  if (typeof document === "undefined") return;
  try { if (W.top !== W.self) return; } catch (e) { return; }   // top-level desktop chrome only

  var DOC = document, root = DOC.documentElement;
  var VINYL_ID = "holo.vinyl";                                    // a live tile: the Holo Vinyl disc (shared with holo-vinyl.js)
  var VIDEO_ID = "holo.video";                                    // a live tile: the Holo Video player window (shared with holo-video.js)

  // ── resolve our own location → siblings (css · config · platform · catalog · logo) ──
  var SELF = (DOC.currentScript && DOC.currentScript.src) ||
    (DOC.querySelector('script[src*="holo-dock.js"]') || {}).src ||
    new URL("_shared/holo-dock.js", location.href).href;
  var base = SELF.replace(/holo-dock\.js.*$/, "");                 // .../_shared/
  var ROOT = new URL("../", base).href;                           // the OS root (one level up from _shared/)
  var LOGO_URL = new URL("usr/share/icons/hologram-light.svg", ROOT).href;  // the Hologram mark (dark ink — reads on the light frosted dock)
  var CSS_URL = base + "holo-dock.css";
  var CONFIG_URL = base + "holo-dock-config.json";
  var PLATFORM_URL = base + "holo-platform.js";
  var CATALOG_URL = new URL("apps/index.jsonld", ROOT).href;
  var OPFS_NAME = "holo.dock.config.json";

  // ── helpers ──────────────────────────────────────────────────────────────────────────────────
  function el(tag, attrs, kids) {
    var n = DOC.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function actionBtn(label, svg, fn) {
    var b = el("button", { "class": "holo-dock-action", title: label, "aria-label": label, html: svg });
    b.addEventListener("click", fn);
    return b;
  }
  var HOME_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="currentColor"><path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z"/></svg>';
  var LIB_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5h7v14H4zM13 5h7v6h-7zM13 13h7v6h-7z"/></svg>';
  var NEW_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  var KBD_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>';
  var SHARE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 16V3M8 7l4-4 4 4"/></svg>';
  var EXPAND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>';   // panel-toggle glyph (the expand/collapse navigator control)
  var SEARCH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
  // one coherent monochrome glyph set for the native categories (uniform 24·stroke 2) — file explorer,
  // apps, tools, settings, etc. — so the navigator reads like a desktop OS sidebar.
  var G = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>',
    search: SEARCH_SVG,
    resources: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM8 7h8M8 11h8"/></svg>',
    files: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    apps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    tools: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.6-.6-2.5z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.81 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 7.5 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.18 14H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.5a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 10 3.18V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 2.4 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.82 10H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    create: NEW_SVG,
    q: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.4"/><ellipse cx="12" cy="12" rx="10" ry="4.2"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)"/></svg>',
  };
  // ── app glyphs ──────────────────────────────────────────────────────────────────────────────────
  // Every dock tile reads as the SAME monochrome line glyph (uniform 24·stroke 2) as the navigator
  // categories above — so the left rail looks like one coherent desktop-OS sidebar instead of a mix of
  // each app's own coloured icon. A curated pictogram per app where one is obvious, else a keyword
  // match on the name, else a clean stroked letter tile (so a freshly pinned/added app matches too).
  var IG = {
    browser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/></svg>',
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/></svg>',
    q: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.4"/><ellipse cx="12" cy="12" rx="10" ry="4.2"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)"/></svg>',
    files: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m10 9 5 3-5 3z"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/></svg>',
    git: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7M18 11.5c0 3-4 2-8 4"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.3A3.5 3.5 0 0 1 17 18z"/></svg>',
    cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 3v18M4 7.5l8 4.5 8-4.5"/></svg>',
    hub: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="4" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M12 6.5v3M10.3 13.5 6.3 16.4M13.7 13.5l4 2.9"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h9M4 17h6"/><circle cx="17" cy="7" r="2.5"/><circle cx="14" cy="17" r="2.5"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/></svg>',
    terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="m7 9 3 3-3 3M13 15h4"/></svg>',
    tools: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.6-.6-2.5z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5"/><circle cx="12" cy="12.5" r="3.5"/><path d="M9 6l1.5-2h3L15 6"/></svg>',
    compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5M4 19h16M8 15l3-4 3 3 4-6"/></svg>',
    coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 8h4.5a2 2 0 0 1 0 4H9h5a2 2 0 0 1 0 4H9M11 6v12"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 5h11l-1.5 3L16 11H5"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h9a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5z"/><path d="M16 6h3v14h-5"/></svg>',
    layout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></svg>',
    apps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  };
  // app id → glyph (exact match wins)
  var APP_GLYPHS = {
    "org.hologram.HoloBrowser": IG.browser,
    "org.hologram.HoloWorkspace": IG.code,
    "org.hologram.HoloCode": IG.terminal,
    "org.hologram.HoloQ": IG.q,
    "org.hologram.HoloFiles": IG.files,
    "org.hologram.HoloSearch": IG.search,
    "org.hologram.HoloMusic": IG.music, "org.hologram.HoloAmp": IG.music, "org.hologram.HoloPlayer": IG.music,
    "org.hologram.HoloVideo": IG.video, "org.hologram.HoloStream": IG.video,
    "org.hologram.HoloDocs": IG.doc, "org.hologram.HoloNotepad": IG.doc, "org.hologram.HoloNotepadPP": IG.doc, "org.hologram.HoloTerms": IG.doc,
    "org.hologram.HoloGit": IG.git,
    "org.hologram.HoloCloud": IG.cloud,
    "org.hologram.HoloIpfs": IG.cube,
    "org.hologram.HoloHub": IG.hub,
    "org.hologram.HoloControl": IG.sliders,
    "org.hologram.HoloPrivacy": IG.shield,
    "org.hologram.HoloForge": IG.tools,
    "org.hologram.HoloCapture": IG.camera, "org.hologram.HologramMeet": IG.camera,
    "org.hologram.HoloAtlas": IG.compass, "org.hologram.HoloAtlas96": IG.compass, "org.hologram.HoloCosmos": IG.compass,
    "org.hologram.HoloTrade": IG.chart,
    "org.hologram.HoloBtc": IG.coin, "org.hologram.HoloBrc": IG.coin, "org.hologram.HoloEVM": IG.coin, "org.hologram.HoloEtherscan": IG.coin,
    "org.hologram.HoloF1": IG.flag,
    "org.hologram.HoloGuide": IG.book,
    "org.hologram.HoloUI": IG.layout,
    "org.hologram.HoloOS": IG.apps,
    "org.hologram.QvacSdk": IG.q,
  };
  // keyword → glyph (substring of the lowercased app name, when no exact id match)
  var NAME_GLYPHS = [
    ["browser", IG.browser], ["workspace", IG.code], ["code", IG.terminal], ["terminal", IG.terminal],
    ["search", IG.search], ["music", IG.music], ["amp", IG.music], ["player", IG.music],
    ["video", IG.video], ["stream", IG.video], ["meet", IG.camera], ["capture", IG.camera],
    ["doc", IG.doc], ["note", IG.doc], ["terms", IG.doc], ["book", IG.book], ["guide", IG.book],
    ["git", IG.git], ["cloud", IG.cloud], ["ipfs", IG.cube], ["hub", IG.hub], ["files", IG.files],
    ["control", IG.sliders], ["privacy", IG.shield], ["forge", IG.tools], ["atlas", IG.compass],
    ["cosmos", IG.compass], ["trade", IG.chart], ["scan", IG.coin], ["btc", IG.coin], ["brc", IG.coin],
    ["evm", IG.coin], ["miner", IG.coin], ["f1", IG.flag], ["ui", IG.layout], ["os", IG.apps],
  ];
  function lineLetter(name) {
    var ch = (name || "?").trim().charAt(0).toUpperCase() || "?";
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><text x="12" y="16.4" font-size="11" font-family="system-ui,sans-serif" font-weight="600" text-anchor="middle" fill="currentColor" stroke="none">' + ch + "</text></svg>";
  }
  function appGlyph(id) {
    if (id === VIDEO_ID) return IG.video;                        // the Holo Video tile carries the clean play-in-frame glyph
    if (APP_GLYPHS[id]) return APP_GLYPHS[id];
    var name = (appInfo(id).name || "").toLowerCase();
    for (var i = 0; i < NAME_GLYPHS.length; i++) if (name.indexOf(NAME_GLYPHS[i][0]) >= 0) return NAME_GLYPHS[i][1];
    return lineLetter(appInfo(id).name);
  }
  function glyphIcon(id, cls) { return el("span", { "class": cls || "holo-dock-icon", html: appGlyph(id) }); }
  function dirOf(s) { var m = String(s || "").match(/([^\/]+)\/[^\/]*$/); return m ? m[1] : ""; }

  // ── the bundle model — a pin entry is an app id (string) OR a group {id,name,items:[id…]} ──
  function isGroup(e) { return e && typeof e === "object" && Array.isArray(e.items); }
  function entryKey(e) { return isGroup(e) ? e.id : e; }
  function gid() { return "g" + Math.random().toString(36).slice(2, 8); }
  function fnv(str) { var h = 0x811c9dc5; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; } return ("0000000" + h.toString(16)).slice(-8); }
  function groupFp(g) { return fnv((g.items || []).slice().sort().join(",")); }   // content fingerprint of the bundle

  // ── platform (the native feel) ─────────────────────────────────────────────────────────────
  function fallbackProfile() {
    var ua = String(navigator.userAgent || ""), os = "linux";
    if (/Windows/i.test(ua)) os = "windows";
    else if (/Android/i.test(ua)) os = "android";
    else if (/iPhone|iPod/i.test(ua)) os = "ios";
    else if (/iPad/i.test(ua)) os = "ipados";
    else if (/CrOS/i.test(ua)) os = "chromeos";
    else if (/Mac OS X|Macintosh/i.test(ua)) os = (navigator.maxTouchPoints || 0) > 1 ? "ipados" : "macos";
    var apple = os === "macos" || os === "ios" || os === "ipados";
    return { os: os, apple: apple, touch: (apple && os !== "macos") || /Mobi|Android/i.test(ua), mobile: /Mobi|Android|iPhone|iPad|iPod/i.test(ua) };
  }
  function detectPlatform() {
    if (W.HoloPlatform && W.HoloPlatform.profileFor) return Promise.resolve(W.HoloPlatform.profileFor(navigator));
    return import(PLATFORM_URL).then(function (m) {
      var fn = (m && (m.profileFor || (m.default && m.default.profileFor))) || (W.HoloPlatform && W.HoloPlatform.profileFor);
      return fn ? fn(navigator) : fallbackProfile();
    }).catch(function () { return fallbackProfile(); });
  }

  // ── config (default κ-object ⊕ OPFS user override) ───────────────────────────────────────────
  function loadDefault() { return fetch(CONFIG_URL, { cache: "no-store" }).then(function (r) { return r.json(); }).catch(function () { return null; }); }
  function loadOverride() {
    if (!(navigator.storage && navigator.storage.getDirectory)) return Promise.resolve({});
    return navigator.storage.getDirectory()
      .then(function (d) { return d.getFileHandle(OPFS_NAME); })
      .then(function (h) { return h.getFile(); })
      .then(function (f) { return f.text(); })
      .then(function (t) { return JSON.parse(t) || {}; })
      .catch(function () { return {}; });
  }
  function saveOverride(holo) {
    if (!(navigator.storage && navigator.storage.getDirectory)) return Promise.resolve();
    return navigator.storage.getDirectory()
      .then(function (d) { return d.getFileHandle(OPFS_NAME, { create: true }); })
      .then(function (h) { return h.createWritable(); })
      .then(function (w) { return Promise.resolve(w.write(JSON.stringify(holo, null, 2))).then(function () { return w.close(); }); })
      .catch(function () {});
  }

  // ── catalog (the launchers) ──────────────────────────────────────────────────────────────────
  function loadCatalog() {
    return fetch(CATALOG_URL, { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      var apps = (j && j["dcat:dataset"]) || [], map = {};
      apps.forEach(function (a) {
        var id = a["schema:identifier"]; if (!id) return;
        var landing = a["dcat:landingPage"] || "";
        map[id] = {
          id: id, name: a["schema:name"] || id,
          icon: a["schema:image"] ? new URL(a["schema:image"], ROOT).href : null,
          landing: landing ? new URL(landing, ROOT).href : null,
          dir: dirOf(landing),
          kappa: String(a["@id"] || "").split(":").pop(),   // the app's content κ (sha256 hex) = its holospace origin
        };
      });
      return map;
    }).catch(function () { return {}; });
  }
  function appInfo(id) {
    if (id === VIDEO_ID) return { id: id, name: "Video", icon: null };
    return STATE.catalog[id] || { id: id, name: String(id).split(".").pop(), icon: null };
  }

  // ── shell adaptation (World/SDK vs Platform Manager) ───────────────────────────────────────────
  function inSdk() { return !!(W.__world && W.__world.launchById); }
  function isFullscreen() {
    try {
      if (DOC.fullscreenElement || DOC.webkitFullscreenElement) return true;
      if (W.matchMedia && W.matchMedia("(display-mode: fullscreen)").matches) return true;
    } catch (e) {}
    return false;
  }
  function orientNow() {
    var side = STATE.holo && STATE.holo.dockSide;             // a user-chosen pin overrides the auto placement
    if (side === "left" || side === "right" || side === "top" || side === "bottom" || side === "free") return side;
    return isFullscreen() ? "bottom" : "left";
  }
  function clampN(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function frame() { return DOC.getElementById("holoframe"); }
  function hf() { return DOC.getElementById("hf-frame"); }
  function isFramed() { var f = frame(); return !!(f && f.classList.contains("open")); }
  function clickEl(id) { var e = DOC.getElementById(id); if (e) e.click(); }
  function sdkOpenSrcs() { try { return (W.__world.desktop.doc().world || []).filter(function (n) { return n.kind === "app"; }).map(function (n) { return n.src || ""; }); } catch (e) { return []; } }
  function currentAppId() {
    var i = hf(); if (!i || !isFramed()) return null;
    try { return new URL(i.src, location.href).searchParams.get("app"); } catch (e) { return null; }
  }
  function launch(id) {
    closeFlyout();
    // The Holo Video tile is a LIVE object: it opens its own beautiful floating glass player window
    // (movable · resizable · immersive full screen) on the top shell plane — never a holospace tab.
    if (id === VIDEO_ID && W.HoloVideo && W.HoloVideo.open) { try { W.HoloVideo.open(); return; } catch (e) {} }
    // NATIVE κ-tab: in the native Chromium host the desktop is served over the holo:// substrate as the
    // top-level document — so opening an app = navigating THIS tab to the app's own κ-origin
    // (holo://<κ>/), which Chromium isolates and the κ-route verifies. No shell, no iframe. In the web
    // build (https, or embedded in shell) this is skipped → the existing openTab/iframe path runs.
    if (location.protocol === "holo:" && W.top === W.self) {
      var kap = (appInfo(id) || {}).kappa;
      if (kap && /^[0-9a-f]{64}$/.test(kap)) { location.href = "holo://" + kap + "/"; return; }
    }
    // The NAV opens every app as its OWN focused holospace tab (never hijacks the current surface).
    if (W.HoloShell && W.HoloShell.openTab) { try { W.HoloShell.openTab(id, appInfo(id).name); setTimeout(updateRunning, 60); return; } catch (e) {} }
    // Holo Browser is the universal navigator: a dock tap opens that object in a browser tab.
    if (W.HoloBrowser && W.HoloBrowser.openApp) { var bi = appInfo(id); try { W.HoloBrowser.openApp(bi.landing, bi.name, "holo://" + id); } catch (e) {} return; }
    if (inSdk()) { try { W.__world.launchById(id); } catch (e) {} setTimeout(updateRunning, 60); return; }
    var i = hf(), f = frame(); if (!i || !f) return;
    i.src = "holospace.html?app=" + encodeURIComponent(id);
    f.classList.add("open"); f.setAttribute("aria-hidden", "false");
    root.classList.add("framed");
    updateRunning();
  }
  function revealDesktop() {
    var i = hf(), f = frame(); if (!f) return;
    f.classList.remove("open"); f.setAttribute("aria-hidden", "true");
    root.classList.remove("framed");
    if (i) i.src = "about:blank";
    updateRunning();
  }
  function startAction() {
    if (W.HoloBrowser && W.HoloBrowser.newTab) { try { W.HoloBrowser.newTab(); return; } catch (e) {} }
    if (inSdk()) { if (W.__world.openSpot) { try { W.__world.openSpot(); return; } catch (e) {} } clickEl("open"); return; }
    if (isFramed()) revealDesktop();
  }

  // ── state ────────────────────────────────────────────────────────────────────────────────────
  var STATE = { def: null, holo: null, catalog: {}, profile: null, orient: "left", renderedSdk: false };

  function effectiveHolo() {
    var base0 = (STATE.def && STATE.def.holo) || {};
    var ov = STATE.holo || {};
    var holo = Object.assign({}, base0, ov);
    holo.pins = (ov.pins || base0.pins || []).slice();
    // Holo Vinyl (music) + Holo Video — the live media tiles are ALWAYS present in the rail for EVERY user,
    // even if a saved layout never had them or dropped them. Each renders as its live tile (item() →
    // vinylTile / videoTile), so we pin each only once its provider is loaded — never a placeholder. Both
    // load before the dock, so the first render already carries them; this just makes "always shown" true
    // regardless of the persisted pins. Music first, then video (the media pair, in order).
    try {
      if (W.HoloVinyl && W.HoloVinyl.dockTile && indexOfKey(holo.pins, VINYL_ID) < 0) holo.pins.push(VINYL_ID);
      if (W.HoloVideo && W.HoloVideo.dockTile && indexOfKey(holo.pins, VIDEO_ID) < 0) holo.pins.push(VIDEO_ID);
    } catch (e) {}
    if (!ov.glass && base0.glassByPlatform && STATE.profile && base0.glassByPlatform[STATE.profile.os]) holo.glass = base0.glassByPlatform[STATE.profile.os];
    return holo;
  }
  function persist() {
    STATE.holo = STATE.holo || {};
    var h = effectiveHolo();
    STATE.holo.pins = h.pins; STATE.holo.glass = h.glass; STATE.holo.magnify = h.magnify; STATE.holo.showClock = h.showClock; STATE.holo.showHome = h.showHome;
    STATE.holo.dockSide = h.dockSide || null; STATE.holo.collapsed = !!h.collapsed; STATE.holo.expanded = !!h.expanded; STATE.holo.dockX = h.dockX != null ? h.dockX : null; STATE.holo.dockY = h.dockY != null ? h.dockY : null;
    return saveOverride(STATE.holo);
  }
  function setPins(pins) { STATE.holo = STATE.holo || {}; STATE.holo.pins = pins.slice(); render(); persist(); }
  function setGlass(g) { STATE.holo = STATE.holo || {}; STATE.holo.glass = g; if (dockEl) dockEl.setAttribute("data-glass", g); persist(); }

  // ── bundle / unbundle operations (the magic) ───────────────────────────────────────────────────
  function pins() { return effectiveHolo().pins; }
  function indexOfKey(arr, key) { for (var i = 0; i < arr.length; i++) if (entryKey(arr[i]) === key) return i; return -1; }
  function reorder(srcKey, dstKey, after) {
    var arr = pins(), si = indexOfKey(arr, srcKey); if (si < 0) return;
    var moved = arr.splice(si, 1)[0];
    var di = indexOfKey(arr, dstKey); if (di < 0) { arr.push(moved); return setPins(arr); }
    arr.splice(after ? di + 1 : di, 0, moved);
    setPins(arr);
  }
  // membersOf(entry) → flat list of app ids the entry contributes.
  function membersOf(e) { return isGroup(e) ? e.items.slice() : [e]; }
  function bundle(srcKey, dstKey) {
    if (srcKey === dstKey) return;
    var arr = pins(), si = indexOfKey(arr, srcKey), di = indexOfKey(arr, dstKey);
    if (si < 0 || di < 0) return;
    var src = arr[si], dst = arr[di];
    var items = membersOf(dst).concat(membersOf(src)).filter(function (v, i, a) { return a.indexOf(v) === i; });
    var group = isGroup(dst) ? Object.assign({}, dst, { items: items }) : { id: gid(), name: "Group", items: items };
    arr[di] = group;
    arr.splice(si, 1);                                   // remove the source (di shifts only if si<di; recompute via key)
    setPins(arr);
    // a little delight: pop the new group tile
    setTimeout(function () { var li = dockEl && dockEl.querySelector('[data-key="' + group.id + '"]'); if (li) { li.classList.add("just-bundled"); setTimeout(function () { li.classList.remove("just-bundled"); }, 420); } }, 20);
  }
  function ungroup(groupId) {
    var arr = pins(), i = indexOfKey(arr, groupId); if (i < 0 || !isGroup(arr[i])) return;
    var items = arr[i].items.slice();
    arr.splice.apply(arr, [i, 1].concat(items));         // spread members in place
    closeFlyout(); setPins(arr);
  }
  function addToGroup(groupId, appId) {
    var arr = pins(), gi = indexOfKey(arr, groupId); if (gi < 0 || !isGroup(arr[gi])) return;
    if (arr[gi].items.indexOf(appId) < 0) arr[gi] = Object.assign({}, arr[gi], { items: arr[gi].items.concat([appId]) });
    var ai = indexOfKey(arr, appId); if (ai >= 0) arr.splice(ai, 1);   // remove from top level if it was a sibling
    setPins(arr);
  }
  function removeFromGroup(groupId, appId) {
    var arr = pins(), gi = indexOfKey(arr, groupId); if (gi < 0 || !isGroup(arr[gi])) return;
    var rest = arr[gi].items.filter(function (x) { return x !== appId; });
    if (rest.length <= 1) { arr.splice.apply(arr, [gi, 1].concat(rest)); closeFlyout(); }   // dissolve to a single pin / nothing
    else arr[gi] = Object.assign({}, arr[gi], { items: rest });
    setPins(arr);
    if (openGroupId && openGroupId !== groupId) {} else if (rest.length > 1) reopenGroup(groupId);
  }
  function renameGroup(groupId, name) {
    var arr = pins(), i = indexOfKey(arr, groupId); if (i < 0 || !isGroup(arr[i])) return;
    arr[i] = Object.assign({}, arr[i], { name: name || "Group" }); setPins(arr);
  }
  function groupById(id) { var arr = pins(), i = indexOfKey(arr, id); return i >= 0 && isGroup(arr[i]) ? arr[i] : null; }

  // ── magnify + glass policy ─────────────────────────────────────────────────────────────────────
  function wantsMagnify(holo) {
    if (holo.magnify === false) return false;
    var p = STATE.profile || {};
    if (!p.apple || p.touch) return false;
    if (root.getAttribute("data-holo-tier") === "lean") return false;
    if (root.getAttribute("data-holo-motion") === "reduced") return false;
    try { if (W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches) return false; } catch (e) {}
    return true;
  }

  // ── render ────────────────────────────────────────────────────────────────────────────────────
  var dockEl = null, ro = null;
  function render() {
    closeFlyout();                                      // a flyout is anchored to the old dock — rebuild fresh
    var holo = effectiveHolo();
    var prev = DOC.getElementById("holo-dock");
    var wasReady = prev && prev.classList.contains("ready");
    var dock = el("nav", { id: "holo-dock", "class": "holo-dense" + (wasReady ? " ready" : ""), "aria-label": "Dock", "data-glass": holo.glass || "blur" });
    STATE.orient = orientNow();
    dock.setAttribute("data-orient", STATE.orient);
    if (STATE.orient === "free") { dock.style.left = clampN(holo.dockX != null ? holo.dockX : 60, 0, W.innerWidth - 64) + "px"; dock.style.top = clampN(holo.dockY != null ? holo.dockY : 80, 0, W.innerHeight - 120) + "px"; }
    if (holo.collapsed) dock.classList.add("holo-dock--collapsed");
    if (holo.expanded) dock.classList.add("holo-dock--expanded");   // wide navigator (Lovable-style): labels + sections + κ-holospace recents
    if (wantsMagnify(holo)) dock.classList.add("holo-dock--magnify");
    var inner = el("div", { "class": "holo-dock-inner" });

    var sdk = inSdk();
    STATE.renderedSdk = sdk;
    var homeBtn = null;
    if (holo.showHome !== false) {
      // The header: the Hologram brand mark. In the icon rail it MORPHS to a panel-expand glyph on hover
      // and a click expands the navigator (Perplexity-style); when expanded it sits beside the wordmark
      // with a collapse control pinned to the right. Drag the mark to move the dock; right-click /
      // long-press folds it to a single chip.
      var expandHint = holo.expanded ? "Collapse navigator" : "Expand navigator";
      var head = el("div", { "class": "holo-dock-head" });
      var logoImg = el("img", { "class": "holo-dock-icon holo-dock-logo", src: LOGO_URL, alt: "Hologram", draggable: "false" });
      logoImg.addEventListener("error", function () { var s = el("span", { "class": "holo-dock-icon holo-dock-logo", html: HOME_SVG }); if (this.parentNode) this.parentNode.replaceChild(s, this); });
      var morph = el("span", { "class": "holo-dock-icon holo-dock-logo-morph", html: EXPAND_SVG, "aria-hidden": "true" });
      homeBtn = el("button", { "class": "holo-dock-tile holo-dock-home", title: expandHint, "aria-label": expandHint }, [logoImg, morph]);
      homeBtn.addEventListener("contextmenu", function (e) { e.preventDefault(); toggleCollapse(); });   // fold to a chip
      bindLongPress(homeBtn, function () { toggleCollapse(); });
      head.appendChild(homeBtn);                               // click → expand/collapse navigator (wireDockMove); drag → move the dock
      // the collapse control — only meaningful in the expanded navigator; pins to the header's right edge
      var exBtn = el("button", { "class": "holo-dock-tile holo-dock-collapse", title: "Collapse navigator", "aria-label": "Collapse navigator" }, [el("span", { "class": "holo-dock-icon", html: EXPAND_SVG })]);
      exBtn.addEventListener("click", function (e) { e.stopPropagation(); toggleExpand(); });
      head.appendChild(exBtn);
      inner.appendChild(head);
    }

    // core categories ALWAYS render — a glyph stack in the icon rail, left-aligned labelled rows when
    // expanded. No section headers, no Recents: a tight, no-scroll list. Pinned apps follow a hairline.
    fixedNav(inner);
    var horizontal = STATE.orient === "bottom" || STATE.orient === "top";
    // A horizontal dock keeps New inline with the other categories (the vertical rail anchors it to the
    // very bottom instead — see below).
    if (horizontal) { var topNew = el("ol", { "class": "holo-dock-items holo-dock-nav-list" }); topNew.appendChild(navRow(NEW_ROW)); inner.appendChild(topNew); }
    if ((holo.pins || []).length) inner.appendChild(el("span", { "class": "holo-dock-rule" }));
    var list = el("ol", { "class": "holo-dock-items" });
    (holo.pins || []).forEach(function (entry) { list.appendChild(isGroup(entry) ? groupTile(entry) : item(entry)); });
    inner.appendChild(list);
    // New (+) pinned to the VERY BOTTOM of the vertical rail — below the pinned apps and the live
    // music/video tiles. (.holo-dock-nav-bottom { margin-top: auto } pushes it to the bottom edge.)
    if (!horizontal) { var bottomNew = el("ol", { "class": "holo-dock-items holo-dock-nav-list holo-dock-nav-bottom" }); bottomNew.appendChild(navRow(NEW_ROW)); inner.appendChild(bottomNew); }

    // The left NAV stays a clean, scroll-free sidebar: NO bottom tray (Create · Share · Library ·
    // Keyboard · Add · clock). Those verbs belong to the floating / bottom dock, not the navigator.
    if (STATE.orient === "bottom" || STATE.orient === "top") {
      inner.appendChild(el("span", { "class": "holo-dock-sep" }));
      var tray = el("div", { "class": "holo-dock-tray" });
      if (sdk) {
        // Build · (Run = the home/start button) · Share — the three native holospace verbs, ubiquitous.
        var actions = el("div", { "class": "holo-dock-actions" });
        actions.appendChild(actionBtn("Create — author a component", NEW_SVG, function () { clickEl("author"); }));
        actions.appendChild(actionBtn("Share — a link anyone can open instantly (no sign-in)", SHARE_SVG, function () { clickEl("share-btn"); }));
        actions.appendChild(actionBtn("Component library", LIB_SVG, function () { clickEl("library"); }));
        actions.appendChild(actionBtn("Virtual keyboard", KBD_SVG, function () { clickEl("keyboard-btn"); }));
        tray.appendChild(actions);
      }
      var add = el("button", { "class": "holo-dock-add", title: "Add an app", "aria-label": "Add an app", text: "+" });
      add.addEventListener("click", function (e) { openAddMenu(e); });
      tray.appendChild(add);
      if (holo.showClock !== false) { var clock = el("time", { "class": "holo-dock-clock" }); tray.appendChild(clock); }
      inner.appendChild(tray);
    }

    dock.appendChild(inner);
    if (prev) prev.replaceWith(dock); else DOC.body.appendChild(dock);
    dockEl = dock;
    wireDrag(list);
    wireDockMove(dock, inner, homeBtn);
    tick();
    updateRunning();
    measure();
    requestAnimationFrame(measure);
    if (W.ResizeObserver) { try { if (ro) ro.disconnect(); ro = new ResizeObserver(measure); ro.observe(inner); } catch (e) {} }
    // self-reveal safety: the dock starts at opacity 0 and only fades in once it carries `.ready`. If
    // reveal()'s rAF is throttled (backgrounded tab) or its call is ever skipped, the dock would stay
    // invisible forever — so every fresh render also schedules the reveal via a timer (which still fires).
    if (!wasReady) setTimeout(function () { var n = DOC.getElementById("holo-dock"); if (n) n.classList.add("ready"); }, 100);
  }

  // a live tile: the Holo Vinyl disc — shows artwork, spins clockwise while playing, tap = play/pause
  function vinylTile(id) {
    var li = el("li", { "class": "holo-dock-item holo-dock-vinyl", "data-app": id, "data-key": id, draggable: "true" });
    var disc = W.HoloVinyl.dockTile();                            // the live disc element, bound to the persistent player
    var tile = el("button", { "class": "holo-dock-tile", title: "Music — tap to play/pause", "aria-label": "Music — tap to play or pause" }, [disc]);
    tile.appendChild(el("span", { "class": "holo-dock-label", text: "Music" }));
    li.appendChild(tile);
    li.appendChild(el("span", { "class": "holo-dock-dot" }));
    li.addEventListener("contextmenu", function (e) { e.preventDefault(); openItemMenu(e, id); });
    bindLongPress(li, function (e) { openItemMenu(e, id); });
    return li;
  }

  // a live tile: the Holo Video glass play-orb — lights + breathes while a video plays, tap = open player
  function videoTile(id) {
    var li = el("li", { "class": "holo-dock-item holo-dock-video", "data-app": id, "data-key": id, draggable: "true" });
    var orb = W.HoloVideo.dockTile();                             // the live glass orb, bound to the singleton player
    var tile = el("button", { "class": "holo-dock-tile", title: "Video — tap to open the player", "aria-label": "Video — tap to open the player" }, [orb]);
    tile.appendChild(el("span", { "class": "holo-dock-label", text: "Video" }));
    tile.addEventListener("click", function (e) { if (ctrlMenu(e, function () { openItemMenu(e, id); })) return; launch(id); });
    li.appendChild(tile);
    li.appendChild(el("span", { "class": "holo-dock-dot" }));
    li.addEventListener("contextmenu", function (e) { e.preventDefault(); openItemMenu(e, id); });
    bindLongPress(li, function (e) { openItemMenu(e, id); });
    return li;
  }

  // single object tile
  function item(id) {
    if (id === VINYL_ID && W.HoloVinyl && W.HoloVinyl.dockTile) return vinylTile(id);
    if (id === VIDEO_ID && W.HoloVideo && W.HoloVideo.dockTile) return videoTile(id);
    var info = appInfo(id);
    var li = el("li", { "class": "holo-dock-item", "data-app": id, "data-key": id, draggable: "true" });
    var icon = glyphIcon(id);
    var tile = el("button", { "class": "holo-dock-tile", title: info.name, "aria-label": info.name }, [icon, el("span", { "class": "holo-dock-label", text: info.name })]);
    tile.addEventListener("click", function (e) { if (ctrlMenu(e, function () { openItemMenu(e, id); })) return; launch(id); });
    li.appendChild(tile);
    li.appendChild(el("span", { "class": "holo-dock-dot" }));
    li.addEventListener("contextmenu", function (e) { e.preventDefault(); openItemMenu(e, id); });
    bindLongPress(li, function (e) { openItemMenu(e, id); });
    return li;
  }

  // group (bundle) tile — a 2×2 stack of the first members; opens a flyout
  function groupTile(group) {
    var li = el("li", { "class": "holo-dock-item holo-dock-group", "data-key": group.id, "data-group": group.id, draggable: "true" });
    var grid = el("span", { "class": "holo-dock-stack" });
    group.items.slice(0, 4).forEach(function (mid) { grid.appendChild(glyphIcon(mid, "holo-dock-mini")); });
    var n = group.items.length;
    var tile = el("button", { "class": "holo-dock-tile holo-dock-stack-tile", title: group.name + " · " + n + " items", "aria-label": group.name }, [grid]);
    if (n > 4) tile.appendChild(el("span", { "class": "holo-dock-stack-more", text: "+" + (n - 4) }));
    tile.appendChild(el("span", { "class": "holo-dock-label", text: group.name }));
    tile.addEventListener("click", function (e) { if (ctrlMenu(e, function () { openGroupMenu(e, group.id); })) return; toggleGroup(group.id, li); });
    li.appendChild(tile);
    li.appendChild(el("span", { "class": "holo-dock-dot" }));
    li.addEventListener("contextmenu", function (e) { e.preventDefault(); openGroupMenu(e, group.id); });
    bindLongPress(li, function (e) { openGroupMenu(e, group.id); });
    return li;
  }
  function ctrlMenu(e, openFn) { if (STATE.profile && STATE.profile.apple && e.ctrlKey) { e.preventDefault(); e.stopImmediatePropagation(); openFn(); return true; } return false; }

  // ── expanded navigator: section headers + the live, κ-addressed Recents list ──────────────────────
  function toggleExpand() { STATE.holo = STATE.holo || {}; STATE.holo.expanded = !STATE.holo.expanded; render(); persist(); reveal(); }
  // a plain click on the brand mark: a folded chip unfolds to the rail; on the left edge it toggles the
  // wide navigator (Perplexity); on the other edges (no wide layout there) it folds to a chip instead.
  function onHomeClick() {
    if (effectiveHolo().collapsed) { toggleCollapse(); return; }
    if (STATE.orient === "left") { toggleExpand(); return; }
    toggleCollapse();
  }
  function sectionHeader(text) { return el("div", { "class": "holo-dock-section", text: text }); }
  // the shell publishes its open + recent holospaces on W.__holoNav (each {k,name,kind,fav}) and the
  // opener on W.HoloShell.open(k) — so the navigator is 100% anchored in κ-addressed objects, rendered
  // from in-memory state (instant) and re-rendered on the 'holo-nav' event. Absent → no Recents section.
  function navFeed() { try { return (W.__holoNav && W.__holoNav.slice()) || []; } catch (e) { return []; } }
  function openHolospace(k) { try { if (W.HoloShell && W.HoloShell.open) { W.HoloShell.open(k); return; } } catch (e) {} }
  function copyK(k) { try { if (navigator.clipboard) navigator.clipboard.writeText(k); } catch (e) {} }
  function recentRow(o) {
    var name = o.name || (String(o.k || "").split(":").pop() || "holospace").slice(0, 18);
    var li = el("li", { "class": "holo-dock-item holo-dock-recent", "data-k": o.k, "data-key": o.k, draggable: "true" });
    var glyph = el("span", { "class": "holo-dock-icon", html: o.fav ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.6 5.6 6.1.7-4.5 4.1 1.2 6L12 16.9 6.6 19.4l1.2-6L3.3 9.3l6.1-.7z"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M3 12h18"/></svg>' });
    var tile = el("button", { "class": "holo-dock-tile", title: (o.name || "") + "  ·  " + (o.k || ""), "aria-label": name }, [glyph, el("span", { "class": "holo-dock-label", text: name })]);
    tile.addEventListener("click", function (e) { if (ctrlMenu(e, function () { openItemMenu(e, o.k); })) return; openHolospace(o.k); });
    li.appendChild(tile); li.appendChild(el("span", { "class": "holo-dock-dot" }));
    li.addEventListener("contextmenu", function (e) { e.preventDefault(); openRecentMenu(e, o); });
    bindLongPress(li, function (e) { openRecentMenu(e, o); });
    return li;
  }
  function recentsList() {
    var feed = navFeed(); if (!feed.length) return null;
    var ol = el("ol", { "class": "holo-dock-items holo-dock-recents" });
    feed.slice(0, 24).forEach(function (o) { if (o && o.k) ol.appendChild(recentRow(o)); });
    return ol.childNodes.length ? ol : null;
  }
  function openRecentMenu(e, o) {
    closeMenu();
    var name = o.name || (String(o.k || "").split(":").pop() || "holospace").slice(0, 18);
    var menu = el("div", { "class": "holo-dock-menu", role: "menu" }, [el("div", { "class": "holo-dock-menu-head", text: name })]);
    menu.appendChild(mbtn("Open", function () { openHolospace(o.k); }));
    menu.appendChild(mbtn("Copy κ address", function () { copyK(o.k); }));
    placeMenu(menu, e.clientX, e.clientY);
  }

  // ── fixed native categories — a desktop-OS sidebar (Home · Search · Files · Apps · Tools · Settings),
  //    each opening its real κ-addressed holospace/app via window.HoloShell. Only shown when expanded. ──
  // a Perplexity-style sidebar mapped to Hologram's REAL κ-addressed surfaces via window.HoloShell —
  // every row opens a live holospace/app; "New" fires the dock's start action (a fresh holospace tab).
  // CORE only — one flat, header-less list that fits the rail without scrolling. Every row opens its
  // target as a NEW, focused holospace tab via the shell's new-tab openers (graceful no-op off-shell).
  function shellCall(method) { var s = W.HoloShell; if (s && typeof s[method] === "function") { try { s[method](); return true; } catch (e) {} } return false; }
  function shellTab(appId, title) { var s = W.HoloShell; if (s && typeof s.openTab === "function") { try { s.openTab(appId, title); return true; } catch (e) {} } return false; }
  var NAV = [
    { h: null, rows: [
      // Home — the permanent Home tab (a holospace singleton; a duplicate Home would just be "New").
      { id: "home", t: "Home", g: G.home, act: function () { shellCall("home"); } },
      // Search — a fresh tab ready to search (omnibar focused); falls back to focusing the current bar.
      { id: "search", t: "Search", g: G.search, kbd: true, act: function () { if (!shellCall("searchTab")) shellCall("search"); } },
      // Spaces — the holospace switcher (the native "all your spaces" surface; an overlay, not a tab).
      { id: "apps", t: "Spaces", g: G.apps, act: function () { shellCall("apps"); } },
      // Files — Holo Files, in a new tab.
      { id: "files", t: "Files", g: G.files, act: function () { shellTab("org.hologram.HoloFiles", "Holo Files"); } },
      // Settings — Holo Control, in a new tab.
      { id: "settings", t: "Settings", g: G.settings, act: function () { shellTab("org.hologram.HoloControl", "Settings"); } },
    ] },
  ];
  // New — a fresh empty holospace tab (omnibar focused). On the vertical rail it is pinned to the VERY
  // BOTTOM (below the categories, pinned apps and the live music/video tiles); on a horizontal dock it
  // stays inline with the other categories. Off-shell, falls back to the dock start action.
  var NEW_ROW = { id: "new", t: "New", g: G.create, primary: true, act: function () { if (!shellCall("newTab")) startAction(); } };
  var activeNav = "home";
  function navGo(r) {
    if (r && r.act) { try { r.act(); } catch (e) {} return; }   // an action row (New) — fires, never latches active
    var id = r && r.id ? r.id : r;
    activeNav = id;
    if (dockEl) dockEl.querySelectorAll(".holo-dock-nav").forEach(function (n) { if (n.getAttribute("data-nav") === id) n.setAttribute("data-active", ""); else n.removeAttribute("data-active"); });
    try { var s = W.HoloShell; if (s && typeof s[id] === "function") s[id](); } catch (e) {}
  }
  function navRow(r) {
    var li = el("li", { "class": "holo-dock-item holo-dock-nav" + (r.primary ? " holo-dock-nav-primary" : ""), "data-nav": r.id });
    if (r.id === activeNav) li.setAttribute("data-active", "");
    var kids = [el("span", { "class": "holo-dock-icon", html: r.g }), el("span", { "class": "holo-dock-label", text: r.t })];
    if (r.kbd) kids.push(el("kbd", { "class": "holo-dock-kbd", text: (STATE.profile && STATE.profile.apple) ? "⌘ K" : "Ctrl K" }));
    var tile = el("button", { "class": "holo-dock-tile", title: r.t, "aria-label": r.t }, kids);
    tile.addEventListener("click", function () { navGo(r); });
    li.appendChild(tile);
    return li;
  }
  function fixedNav(inner) {
    NAV.forEach(function (sec) {
      if (sec.h) inner.appendChild(sectionHeader(sec.h));
      var ol = el("ol", { "class": "holo-dock-items holo-dock-nav-list" });
      sec.rows.forEach(function (r) { ol.appendChild(navRow(r)); });
      inner.appendChild(ol);
    });
  }

  function updateRunning() {
    if (!dockEl) return;
    if (inSdk() !== STATE.renderedSdk) { render(); return; }
    var run = {};
    if (inSdk()) { var dirs = sdkOpenSrcs().map(dirOf); Object.keys(STATE.catalog).forEach(function (id) { var i = STATE.catalog[id]; if (i.dir && dirs.indexOf(i.dir) >= 0) run[id] = 1; }); }
    else { var cur = currentAppId(); if (cur) run[cur] = 1; }
    dockEl.querySelectorAll(".holo-dock-item").forEach(function (li) {
      if (li.classList.contains("holo-dock-vinyl")) return;      // the music disc owns its own running/playing state
      var running = false;
      if (li.getAttribute("data-app")) running = !!run[li.getAttribute("data-app")];
      else if (li.getAttribute("data-group")) { var g = groupById(li.getAttribute("data-group")); running = !!(g && g.items.some(function (m) { return run[m]; })); }
      if (running) li.setAttribute("data-running", ""); else li.removeAttribute("data-running");
    });
    var fly = DOC.querySelector(".holo-dock-flyout");
    if (fly) fly.querySelectorAll(".holo-dock-item[data-app]").forEach(function (li) { if (run[li.getAttribute("data-app")]) li.setAttribute("data-running", ""); else li.removeAttribute("data-running"); });
  }

  // ── clock ────────────────────────────────────────────────────────────────────────────────────
  var clockFmt = null;
  function tick() {
    var c = dockEl && dockEl.querySelector(".holo-dock-clock"); if (!c) return;
    try { clockFmt = clockFmt || new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }); c.textContent = clockFmt.format(new Date()); }
    catch (e) { c.textContent = ""; }
  }

  // ── measure (publish --holo-dock-h/w so other chrome clears the bar) ───────────────────────────
  function measure() {
    var inner = dockEl && dockEl.querySelector(".holo-dock-inner");
    var rect = inner ? inner.getBoundingClientRect() : { width: 0, height: 0 };
    if (STATE.orient === "left") {
      root.style.setProperty("--holo-dock-w", Math.round(rect.width) + "px");
      root.style.setProperty("--holo-dock-h", "0px");
    } else if (STATE.orient === "bottom") {
      var p = STATE.profile || {}, floating = p.os === "macos" || p.os === "ipados";
      root.style.setProperty("--holo-dock-h", Math.round(floating ? 0 : rect.height) + "px");
      root.style.setProperty("--holo-dock-w", "0px");
    } else {                                                   // right / top / free → float over the content (reserve nothing)
      root.style.setProperty("--holo-dock-w", "0px");
      root.style.setProperty("--holo-dock-h", "0px");
    }
  }
  function reorient() { if (!dockEl) return; var o = orientNow(); if (o !== STATE.orient) { STATE.orient = o; dockEl.setAttribute("data-orient", o); } measure(); }
  function reveal() {
    if (!dockEl) return;
    measure();
    // target the LIVE dock by id (render() may replace the node between scheduling and firing — a
    // captured ref would go stale and never reveal). rAF is the fast path; setTimeout is the fallback
    // since rAF is PAUSED in a backgrounded/throttled tab, which would otherwise pin the dock at opacity 0.
    var go = function () { var n = DOC.getElementById("holo-dock"); if (n) n.classList.add("ready"); };
    requestAnimationFrame(go);
    setTimeout(go, 100);
  }

  // ── drag: reorder at the edges, BUNDLE at the center (the iOS-home gesture) ─────────────────────
  function wireDrag(list) {
    var dragKey = null;
    function clear() { list.querySelectorAll(".holo-dock-item").forEach(function (n) { n.classList.remove("drop-before", "drop-after", "merge-target"); }); }
    list.addEventListener("dragstart", function (e) {
      var li = e.target.closest(".holo-dock-item"); if (!li) return;
      dragKey = li.getAttribute("data-key"); li.classList.add("dragging");
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragKey); } catch (x) {}
    });
    list.addEventListener("dragend", function () { dragKey = null; list.querySelectorAll(".holo-dock-item").forEach(function (n) { n.classList.remove("dragging"); }); clear(); });
    list.addEventListener("dragover", function (e) {
      e.preventDefault();
      var li = e.target.closest(".holo-dock-item"); if (!li || li.getAttribute("data-key") === dragKey) { clear(); return; }
      clear();
      var r = li.getBoundingClientRect();
      var vertical = STATE.orient === "left";
      var frac = vertical ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
      if (frac > 0.32 && frac < 0.68) li.classList.add("merge-target");        // center → bundle
      else li.classList.add((frac >= 0.68) ? "drop-after" : "drop-before");    // edge → reorder
    });
    list.addEventListener("drop", function (e) {
      e.preventDefault();
      var li = e.target.closest(".holo-dock-item"); if (!li || !dragKey) { clear(); return; }
      var dstKey = li.getAttribute("data-key"); if (dstKey === dragKey) { clear(); return; }
      if (li.classList.contains("merge-target")) bundle(dragKey, dstKey);
      else { var r = li.getBoundingClientRect(), vertical = STATE.orient === "left"; var frac = vertical ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width; reorder(dragKey, dstKey, frac >= 0.5); }
      clear();
    });
  }

  // ── move the WHOLE dock: drag its empty area (or the H logo) to pin it to ANY edge — or drop it in
  //    the open to float free — and press the H logo (no drag) to fold / unfold. Pointer-based, so it
  //    composes with the HTML5 tile reorder above (which only fires on the draggable tiles). ──────────
  function snapSide(x, y) {
    var EDGE = 96, w = W.innerWidth, h = W.innerHeight;
    var dl = x, dr = w - x, dt = y, db = h - y, m = Math.min(dl, dr, dt, db);
    if (m > EDGE) return null;                                  // dropped in the open → float free
    return m === dl ? "left" : m === dr ? "right" : m === dt ? "top" : "bottom";
  }
  function toggleCollapse() { STATE.holo = STATE.holo || {}; STATE.holo.collapsed = !STATE.holo.collapsed; render(); persist(); reveal(); }
  function placeFree(dock, x, y) {
    dock.setAttribute("data-orient", "free");
    dock.style.right = "auto"; dock.style.bottom = "auto";
    dock.style.left = clampN(x - 26, 0, W.innerWidth - 64) + "px";
    dock.style.top = clampN(y - 26, 0, W.innerHeight - 120) + "px";
  }
  function wireDockMove(dock, inner, homeBtn) {
    var moving = false, did = false, sx = 0, sy = 0, onHome = false;
    function move(e) {
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moving && (dx * dx + dy * dy) < 36) return;          // ~6px threshold → tell a click from a drag
      if (!moving) { moving = true; did = true; dock.classList.add("holo-dock--moving"); DOC.body.style.userSelect = "none"; }
      placeFree(dock, e.clientX, e.clientY);
    }
    function up(e) {
      DOC.removeEventListener("pointermove", move, true);
      DOC.removeEventListener("pointerup", up, true);
      DOC.body.style.userSelect = "";
      if (!did) { if (onHome) onHomeClick(); return; }          // a plain click on the brand mark → expand / collapse navigator (folded → unfold)
      moving = false; dock.classList.remove("holo-dock--moving");
      STATE.holo = STATE.holo || {};
      var side = snapSide(e.clientX, e.clientY);
      if (side) { STATE.holo.dockSide = side; STATE.holo.dockX = null; STATE.holo.dockY = null; }
      else { STATE.holo.dockSide = "free"; STATE.holo.dockX = clampN(e.clientX - 26, 0, W.innerWidth - 64); STATE.holo.dockY = clampN(e.clientY - 26, 0, W.innerHeight - 120); }
      render(); persist(); reveal();
    }
    inner.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      var t = e.target;
      onHome = !!(homeBtn && (t === homeBtn || homeBtn.contains(t)));
      if (!onHome && t.closest && t.closest(".holo-dock-item, .holo-dock-action, .holo-dock-add, .holo-dock-clock, .holo-dock-collapse")) return;  // tiles / actions keep their own behavior
      did = false; moving = false; sx = e.clientX; sy = e.clientY;
      DOC.addEventListener("pointermove", move, true);
      DOC.addEventListener("pointerup", up, true);
    });
  }

  // ── long-press (touch menus) ───────────────────────────────────────────────────────────────────
  function bindLongPress(node, cb) {
    var t = null, sx = 0, sy = 0;
    node.addEventListener("touchstart", function (e) { var p = e.touches[0]; sx = p.clientX; sy = p.clientY; t = setTimeout(function () { cb({ clientX: sx, clientY: sy, preventDefault: function () {} }); }, 480); }, { passive: true });
    function cancel() { if (t) { clearTimeout(t); t = null; } }
    node.addEventListener("touchend", cancel); node.addEventListener("touchcancel", cancel);
    node.addEventListener("touchmove", function (e) { var p = e.touches[0]; if (Math.abs(p.clientX - sx) > 10 || Math.abs(p.clientY - sy) > 10) cancel(); }, { passive: true });
  }

  // ── group flyout (open a bundle into its members) ──────────────────────────────────────────────
  var openGroupId = null;
  function closeFlyout() { var f = DOC.querySelector(".holo-dock-flyout"); if (f) f.remove(); openGroupId = null; DOC.removeEventListener("pointerdown", onFlyDown, true); if (dockEl) dockEl.querySelectorAll(".holo-dock-group.open").forEach(function (n) { n.classList.remove("open"); }); }
  function onFlyDown(e) { if (!e.target.closest(".holo-dock-flyout") && !e.target.closest(".holo-dock-group")) closeFlyout(); }
  function toggleGroup(id, li) { if (openGroupId === id) { closeFlyout(); return; } openGroup(id, li); }
  function reopenGroup(id) { var li = dockEl && dockEl.querySelector('[data-group="' + id + '"]'); if (li) openGroup(id, li); }
  function openGroup(id, li) {
    closeMenu(); closeFlyout();
    var g = groupById(id); if (!g) return;
    openGroupId = id; if (li) li.classList.add("open");
    var fly = el("div", { "class": "holo-dock-flyout", role: "menu" });
    var head = el("div", { "class": "holo-dock-fly-head" });
    var title = el("input", { "class": "holo-dock-fly-name", value: g.name, "aria-label": "Group name", spellcheck: "false" });
    title.addEventListener("change", function () { renameGroup(id, title.value.trim() || "Group"); });
    title.addEventListener("keydown", function (e) { if (e.key === "Enter") this.blur(); });
    head.appendChild(title);
    head.appendChild(el("span", { "class": "holo-dock-fly-k", title: "A verifiable id for this group", text: "holo://" + groupFp(g) }));
    fly.appendChild(head);
    var grid = el("div", { "class": "holo-dock-fly-grid" });
    g.items.forEach(function (mid) {
      var info = appInfo(mid);
      var m = el("div", { "class": "holo-dock-item", "data-app": mid, title: info.name });
      var t = el("button", { "class": "holo-dock-tile", "aria-label": info.name }, [glyphIcon(mid)]);
      t.addEventListener("click", function () { launch(mid); });
      m.appendChild(t); m.appendChild(el("span", { "class": "holo-dock-dot" }));
      m.appendChild(el("span", { "class": "holo-dock-fly-label", text: info.name }));
      m.addEventListener("contextmenu", function (e) { e.preventDefault(); memberMenu(e, id, mid); });
      grid.appendChild(m);
    });
    // an "add" cell to bundle more into the group
    var addCell = el("button", { "class": "holo-dock-tile holo-dock-fly-add", title: "Add to group", text: "+" });
    addCell.addEventListener("click", function (e) { openAddMenu(e, id); });
    grid.appendChild(addCell);
    fly.appendChild(grid);
    var foot = el("div", { "class": "holo-dock-fly-foot" });
    foot.appendChild(mbtnPlain("Ungroup", function () { ungroup(id); }));
    fly.appendChild(foot);

    DOC.body.appendChild(fly);
    positionFly(fly, li);
    updateRunning();
    setTimeout(function () { DOC.addEventListener("pointerdown", onFlyDown, true); }, 0);
  }
  function positionFly(fly, li) {
    var r = li ? li.getBoundingClientRect() : { left: 60, top: 80, right: 60, bottom: 120, width: 0, height: 40 };
    var fr = fly.getBoundingClientRect();
    var b = deskBoundsD();
    var vertical = STATE.orient === "left";
    var x, y;
    if (vertical) { x = r.right + 10; if (x + fr.width > b.maxX) { var lf = r.left - fr.width - 10; if (lf >= b.minX) x = lf; } y = r.top + r.height / 2 - fr.height / 2; }
    else { y = r.top - fr.height - 10; if (y < b.minY) y = r.bottom + 10; x = r.left + r.width / 2 - fr.width / 2; }
    x = Math.max(b.minX, Math.min(x, Math.max(b.minX, b.maxX - fr.width)));
    y = Math.max(b.minY, Math.min(y, Math.max(b.minY, b.maxY - fr.height)));
    fly.style.left = x + "px"; fly.style.top = y + "px";
  }
  function mbtnPlain(label, fn) { var b = el("button", { type: "button", text: label }); b.addEventListener("click", function () { fn(); }); return b; }

  // ── menus ────────────────────────────────────────────────────────────────────────────────────
  function closeMenu() { var m = DOC.querySelector(".holo-dock-menu"); if (m) m.remove(); DOC.removeEventListener("pointerdown", onDocDown, true); }
  function onDocDown(e) { if (!e.target.closest(".holo-dock-menu")) closeMenu(); }
  // keep menus/flyouts fully inside the desktop, clear of the dock rail (its reserved --holo-dock-w/-h)
  function deskBoundsD() {
    var gs = getComputedStyle(root);
    var dW = parseFloat(gs.getPropertyValue("--holo-dock-w")) || 0;
    var dH = parseFloat(gs.getPropertyValue("--holo-dock-h")) || 0;
    return { minX: 8 + dW, minY: 8, maxX: W.innerWidth - 8, maxY: W.innerHeight - 8 - dH };
  }
  function placeMenu(menu, x, y) {
    DOC.body.appendChild(menu);
    var b = deskBoundsD(), r = menu.getBoundingClientRect();
    menu.style.left = Math.max(b.minX, Math.min(x, Math.max(b.minX, b.maxX - r.width))) + "px";
    menu.style.top = Math.max(b.minY, Math.min(y, Math.max(b.minY, b.maxY - r.height))) + "px";
    setTimeout(function () { DOC.addEventListener("pointerdown", onDocDown, true); }, 0);
  }
  function mbtn(label, fn, opts) { var b = el("button", Object.assign({ type: "button", text: label }, opts || {})); b.addEventListener("click", function () { closeMenu(); fn(); }); return b; }
  function openItemMenu(e, id) {
    closeMenu();
    if (id === VINYL_ID && W.HoloVinyl) {                         // the live music disc — music actions, not app-launch ones
      var vmenu = el("div", { "class": "holo-dock-menu", role: "menu" }, [el("div", { "class": "holo-dock-menu-head", text: "Music" })]);
      var playing = W.HoloVinyl.dockPlaying && W.HoloVinyl.dockPlaying();
      vmenu.appendChild(mbtn(playing ? "Pause" : "Play", function () { W.HoloVinyl.dockToggle(); }));
      if (W.HoloVinyl.dockOpenWindow) vmenu.appendChild(mbtn("Pop out player", function () { W.HoloVinyl.dockOpenWindow(); }));
      vmenu.appendChild(mbtn("Quick preview", function () { W.HoloVinyl.dockPreview(); }));
      vmenu.appendChild(mbtn("Open full player", function () { W.HoloVinyl.dockOpenFull(); }));
      vmenu.appendChild(mbtn("Change set…", function () { W.HoloVinyl.dockEdit(); }));
      vmenu.appendChild(el("hr"));
      vmenu.appendChild(mbtn("Remove from dock", function () { setPins(pins().filter(function (x) { return entryKey(x) !== id; })); }));
      placeMenu(vmenu, e.clientX, e.clientY);
      return;
    }
    var info = appInfo(id), arr = pins(), isPinned = indexOfKey(arr, id) >= 0;
    var menu = el("div", { "class": "holo-dock-menu", role: "menu" }, [el("div", { "class": "holo-dock-menu-head", text: info.name })]);
    menu.appendChild(mbtn("Open", function () { launch(id); }));
    // bundle this with another pinned object
    var others = arr.filter(function (en) { return entryKey(en) !== id; });
    if (others.length) {
      menu.appendChild(el("hr"));
      menu.appendChild(el("div", { "class": "holo-dock-menu-head", text: "Bundle with…" }));
      others.slice(0, 8).forEach(function (en) {
        var label = isGroup(en) ? (en.name + " ▸") : appInfo(en).name;
        menu.appendChild(mbtn(label, function () { isGroup(en) ? addToGroup(en.id, id) : bundle(id, en); }));
      });
    }
    menu.appendChild(el("hr"));
    if (isPinned) menu.appendChild(mbtn("Remove from dock", function () { setPins(arr.filter(function (x) { return entryKey(x) !== id; })); }));
    else menu.appendChild(mbtn("Pin to dock", function () { setPins(arr.concat([id])); }));
    menu.appendChild(el("hr"));
    menu.appendChild(el("div", { "class": "holo-dock-menu-head", text: "Glass" }));
    ["opaque", "clear", "blur", "acrylic"].forEach(function (gl) { menu.appendChild(mbtn((effectiveHolo().glass === gl ? "● " : "○ ") + gl, function () { setGlass(gl); })); });
    placeMenu(menu, e.clientX, e.clientY);
  }
  function openGroupMenu(e, id) {
    closeMenu(); var g = groupById(id); if (!g) return;
    var menu = el("div", { "class": "holo-dock-menu", role: "menu" }, [el("div", { "class": "holo-dock-menu-head", text: g.name + " · holo://" + groupFp(g) })]);
    menu.appendChild(mbtn("Open group", function () { reopenGroup(id); }));
    menu.appendChild(mbtn("Add to group…", function () { openAddMenu(e, id); }));
    menu.appendChild(mbtn("Ungroup", function () { ungroup(id); }));
    menu.appendChild(el("hr"));
    menu.appendChild(mbtn("Remove from dock", function () { setPins(pins().filter(function (x) { return entryKey(x) !== id; })); }));
    placeMenu(menu, e.clientX, e.clientY);
  }
  function memberMenu(e, groupId, appId) {
    closeMenu(); var info = appInfo(appId);
    var menu = el("div", { "class": "holo-dock-menu", role: "menu" }, [el("div", { "class": "holo-dock-menu-head", text: info.name })]);
    menu.appendChild(mbtn("Open", function () { launch(appId); }));
    menu.appendChild(mbtn("Take out of group", function () { removeFromGroup(groupId, appId); }));
    placeMenu(menu, e.clientX, e.clientY);
  }
  // openAddMenu(e[, groupId]) — pick an app to pin, or to add into a group.
  function openAddMenu(e, groupId) {
    closeMenu();
    var arr = pins();
    var pinned = {}; arr.forEach(function (en) { membersOf(en).forEach(function (m) { pinned[m] = 1; }); });
    var ids = Object.keys(STATE.catalog).filter(function (id) { return !pinned[id]; }).sort(function (a, b) { return (STATE.catalog[a].name || "").localeCompare(STATE.catalog[b].name || ""); });
    var menu = el("div", { "class": "holo-dock-menu", role: "menu" }, [el("div", { "class": "holo-dock-menu-head", text: groupId ? "Add to group" : (ids.length ? "Add an app" : "All apps are pinned") })]);
    ids.slice(0, 28).forEach(function (id) {
      var info = STATE.catalog[id];
      var b = mbtn(info.name, function () { groupId ? addToGroup(groupId, id) : setPins(pins().concat([id])); if (groupId) reopenGroup(groupId); });
      b.insertBefore(glyphIcon(id, "holo-dock-menu-glyph"), b.firstChild);
      menu.appendChild(b);
    });
    var r = e && e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : { left: (e && e.clientX) || 60, top: (e && e.clientY) || 60 };
    placeMenu(menu, r.left, r.top);
  }

  // ── boot ──────────────────────────────────────────────────────────────────────────────────────
  function ensureCss() { if (!DOC.querySelector('link[href*="holo-dock.css"]')) { var l = DOC.createElement("link"); l.rel = "stylesheet"; l.href = CSS_URL; (DOC.head || root).appendChild(l); } }
  function waitForShell(ms) {
    // On the World/SDK desktop, wait briefly for window.__world so the FIRST render already includes
    // the SDK actions — no visible re-render/resize jerk on load. Elsewhere, resolve immediately.
    var likelySdk = /\/apps\/sdk\b/.test(location.pathname) || !!W.__world;
    if (!likelySdk || W.__worldReady) return Promise.resolve();
    return new Promise(function (res) { var t0 = Date.now(); var iv = setInterval(function () { if (W.__worldReady || inSdk() || Date.now() - t0 > ms) { clearInterval(iv); res(); } }, 40); });
  }

  var clockTimer = null, runTimer = null;
  function start() {
    ensureCss();
    Promise.all([loadDefault(), loadOverride(), loadCatalog(), detectPlatform()]).then(function (res) {
      STATE.def = res[0] || { holo: { pins: [], glass: "acrylic", magnify: true, showClock: true, showHome: true } };
      STATE.holo = res[1] || {};
      STATE.catalog = res[2] || {};
      STATE.profile = res[3] || fallbackProfile();
      root.setAttribute("data-holo-platform", STATE.profile.os);
      if (STATE.profile.apple) root.setAttribute("data-holo-apple", "");
      if (STATE.profile.touch) root.setAttribute("data-holo-touch", "");
      return waitForShell(900);
    }).then(function () {
      render();          // hidden (no .ready) — fades in once stable to avoid any load reflow being seen
      reveal();
      clockTimer = setInterval(tick, 15000);
      runTimer = setInterval(updateRunning, 700);
      W.addEventListener("resize", reorient);
      DOC.addEventListener("fullscreenchange", reorient);
      DOC.addEventListener("webkitfullscreenchange", reorient);
      try { var mq = W.matchMedia("(display-mode: fullscreen)"); mq.addEventListener ? mq.addEventListener("change", reorient) : mq.addListener(reorient); } catch (e) {}
      W.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeMenu(); closeFlyout(); } });
      // the shell publishes holospace open/close on this event → refresh the live Recents (only when expanded)
      W.addEventListener("holo-nav", function () { if (effectiveHolo().expanded) render(); });
    });
  }
  if (DOC.readyState === "loading") DOC.addEventListener("DOMContentLoaded", start); else start();

  // ── public API (scriptable + IDE-inspectable) ────────────────────────────────────────────────
  W.HoloDock = {
    version: "0.3",
    pin: function (id) { if (indexOfKey(pins(), id) < 0) setPins(pins().concat([id])); },
    unpin: function (id) { setPins(pins().filter(function (x) { return entryKey(x) !== id; })); },
    remove: function (id) { setPins(pins().filter(function (x) { return entryKey(x) !== id; })); },
    setPins: setPins, setGlass: setGlass,
    setSide: function (s) { STATE.holo = STATE.holo || {}; STATE.holo.dockSide = (s === "left" || s === "right" || s === "top" || s === "bottom" || s === "free") ? s : null; STATE.holo.dockX = null; STATE.holo.dockY = null; render(); persist(); reveal(); },
    collapse: function (b) { STATE.holo = STATE.holo || {}; STATE.holo.collapsed = (b == null ? !STATE.holo.collapsed : !!b); render(); persist(); reveal(); },
    expand: function (b) { STATE.holo = STATE.holo || {}; STATE.holo.expanded = (b == null ? !STATE.holo.expanded : !!b); render(); persist(); reveal(); },
    bundle: bundle, ungroup: ungroup, addToGroup: addToGroup, removeFromGroup: removeFromGroup,
    launch: launch, revealDesktop: revealDesktop,
    catalog: function () { return STATE.catalog || {}; },
    config: function () { return { default: STATE.def, override: STATE.holo, effective: effectiveHolo(), profile: STATE.profile }; },
    refresh: render,
  };
})();
