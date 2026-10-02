// holo-messenger-keys.mjs — the NATIVE CEF keyboard layer, brought to the web messenger (github.io/Q).
//
// The Hologram native browser (shell.html + shell-main.mjs) has a full keyboard system: a spotlight
// (Ctrl K), a command palette (Ctrl ⇧ P), a `?` cheat sheet, an ambient "hold-Ctrl" hint dot, and Esc
// to dismiss — all driven by the ONE dependency-free engine `/usr/lib/holo/holo-keys.js` (createKeymap).
// The web messenger shipped without any of it. This module ports the SAME system, populated with
// messenger-appropriate commands, and mounts it ONLY in desktop mode (wide viewport + a real pointer).
//
// Design, faithful to the native:
//   · one keymap → every action a content-addressed command, O(1) resolution, the whole map hashable.
//   · the hint dot is a single breathing point of light; HOLD the OS modifier → it blooms a live legend
//     projected from the keymap (every command flagged `hint`); long-press to banish (persisted); tap → cheat.
//   · additive + fail-soft: a missing DOM hook makes a command a quiet no-op, never an error.
//
// It never loads inside the native shell (which already owns these keys) or inside an embedded frame.

import { createKeymap } from "/usr/lib/holo/holo-keys.js";
import { classifyIntent, fuzzyScore } from "../../usr/lib/holo/holo-intent-classify.mjs";   // mount-relative: a root-absolute specifier escapes /Q at the origin root and 404s pre-SW on a cold boot
// holo-names' classify is the ONE naming-universe classifier (κ/did/CID/SRI/ENS/nostr/…); reused, not rebuilt.
// Loaded lazily + fail-soft so a hiccup degrades the resolve lane to a plain web hand-off, never breaks the bar.
let classifyName = null;
import("/usr/lib/holo/holo-names.mjs").then((m) => { classifyName = m.classify || (m.default && m.default.classify) || null; }).catch(() => {});

(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const W = window, D = document;

  // ── activation gate ───────────────────────────────────────────────────────────────────────────
  // "Desktop only, no mobile" — gate on the USER-AGENT (is this a phone/tablet?), NOT on viewport width or
  // pointer media queries. Those are fragile: a docked DevTools narrows innerWidth below any width floor, and
  // DevTools touch-emulation makes every pointer query (`any-pointer:fine`, `hover:hover`, `pointer:fine`)
  // report coarse/none — so on a real desktop with DevTools open the width+pointer gate wrongly bailed and the
  // layer never mounted. A mobile UA is the reliable "no physical keyboard" signal; everything else is a
  // desktop and gets the command bar. Skip inside the native shell (it owns the keys) and when embedded.
  try {
    if (W.__holoKeysMounted) return;
    if (W.top !== W.self) return;                                              // embedded → host owns keys
    if (W.cefQuery || W.__world || D.documentElement.classList.contains("native-chrome")) return; // native shell
    const ua = navigator.userAgent || "";
    if (/Android|iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini|Mobile|Silk|Kindle|iPad/i.test(ua)) return; // phones/tablets — no keyboard
    W.__holoKeysMounted = true;
  } catch (e) { return; }

  const apple = (() => { try { return /mac|iphone|ipad|ipod/i.test(navigator.platform || "") || /mac os/i.test(navigator.userAgent || ""); } catch { return false; } })();
  const modSymbol = apple ? "⌘" : "Ctrl";
  const altSym = apple ? "⌥" : "Alt";   // the reveal + the chips' modifier (Alt+S/C/H)
  const $ = (s, r) => (r || D).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ── styles — the messenger's dark-glass vocabulary (teal accent), matching the shell's shapes ────
  const ACCENT = "#7defc9";
  const style = D.createElement("style");
  style.id = "hk-css";
  style.textContent = `
  :root{ --hk-accent:${ACCENT}; }
  #hk-scrim,#hk-cheat{ position:fixed; inset:0; z-index:2147482000; display:none; background:rgba(4,7,12,.52);
    backdrop-filter:blur(3px); align-items:flex-start; justify-content:center; font-family:"Segoe UI",system-ui,-apple-system,sans-serif; }
  #hk-scrim.open,#hk-cheat.open{ display:flex; }
  #hk-scrim .hk-sheet{ width:min(40rem,94vw); margin-top:14vh; background:#0d1117; border:1px solid #30363d;
    border-radius:14px; box-shadow:0 24px 80px rgba(0,0,0,.6); overflow:hidden; animation:hk-rise .16s cubic-bezier(.4,0,.2,1); }
  @keyframes hk-rise{ from{ opacity:0; transform:translateY(-6px) scale(.99); } to{ opacity:1; transform:none; } }
  #hk-scrim .hk-title{ padding:9px 16px 0; font-size:12px; letter-spacing:.04em; text-transform:uppercase; color:#6e7681; }
  #hk-scrim input{ width:100%; box-sizing:border-box; background:transparent; border:0; outline:0; color:#e6edf3;
    font-size:18px; padding:14px 16px; font-family:inherit; }
  #hk-scrim .hk-results{ max-height:52vh; overflow:auto; overflow-x:hidden; border-top:1px solid #21262d;
    contain:content; overscroll-behavior:contain; }   /* contain = isolate list layout/paint from the page → cheap scroll + repaint */
  #hk-scrim .hk-row{ display:flex; align-items:center; gap:12px; padding:10px 16px; cursor:pointer; color:#c9d1d9; font-size:15px; }
  #hk-scrim .hk-row .hk-ic{ width:26px; height:26px; display:inline-flex; align-items:center; justify-content:center; text-align:center; opacity:.9; flex:0 0 auto; font-size:16px; }
  #hk-scrim .hk-ic-img{ width:26px; height:26px; border-radius:7px; object-fit:cover; opacity:1; }
  #hk-scrim .hk-row .hk-lbl{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
  #hk-scrim .hk-grp.hk-words{ font-family:ui-monospace,monospace; color:#6e7681; letter-spacing:0; }
  #hk-scrim .hk-row .hk-grp{ margin-left:auto; color:#6e7681; font-size:12px; flex:0 0 auto; padding-left:8px; }
  #hk-scrim .hk-lane{ padding:9px 16px 4px; font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:#565f6b; }
  #hk-scrim .hk-lane:first-child{ padding-top:6px; }
  #hk-scrim .hk-row kbd,#hk-cheat kbd{ background:#21262d; border:1px solid #30363d; border-radius:6px; padding:2px 8px;
    font:600 12px ui-monospace,monospace; color:#e6edf3; white-space:nowrap; }
  #hk-scrim .hk-row.sel{ background:color-mix(in srgb,var(--hk-accent) 16%,transparent); color:#fff; }
  #hk-scrim .hk-row.sel .hk-grp{ color:#b9c2cf; }
  #hk-scrim .hk-empty{ padding:16px; color:#6e7681; font-size:14px; }
  #hk-scrim .hk-preview:not(:empty){ border-top:1px solid #21262d; max-height:48vh; overflow:auto; padding:12px 16px 16px; }
  /* cheat sheet */
  #hk-cheat .hk-sheet{ width:min(56rem,94vw); margin-top:8vh; background:#0d1117; border:1px solid #30363d;
    border-radius:14px; box-shadow:0 24px 80px rgba(0,0,0,.6); overflow:hidden; animation:hk-rise .16s cubic-bezier(.4,0,.2,1); }
  #hk-cheat .cheat-h{ padding:14px 18px; border-bottom:1px solid #21262d; font:600 16px inherit; color:#e6edf3; }
  #hk-cheat .cheat-h .muted{ color:#8b949e; font-weight:400; }
  #hk-cheat .cheat-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(15rem,1fr)); gap:16px; padding:16px; max-height:60vh; overflow:auto; }
  #hk-cheat .cheat-col h4{ margin:0 0 8px; font:600 12px inherit; color:var(--hk-accent); text-transform:uppercase; letter-spacing:.05em; }
  #hk-cheat .cheat-row{ display:flex; justify-content:space-between; align-items:center; gap:12px; padding:5px 0; font-size:14px; color:#c9d1d9; }
  #hk-cheat .cheat-f{ padding:12px 18px; border-top:1px solid #21262d; font-size:13px; color:#8b949e; }
  #hk-cheat .cheat-f .k{ color:#58a6ff; font-family:ui-monospace,monospace; }
  #hk-cheat .cheat-link{ background:0; border:0; padding:0; cursor:pointer; font:inherit; color:#58a6ff; text-decoration:underline; text-underline-offset:2px; }

  /* ambient which-key dot — one breathing point of light; hold the modifier → it blooms a legend. */
  /* bottom lines the dot up with the Q orb's vertical centre (orb: bottom clamp(48,7.5vh,88) + height clamp(70,8.6vh,104)/2) */
  #hk-dot{ position:fixed; left:50%; bottom:calc(clamp(48px,7.5vh,88px) + clamp(70px,8.6vh,104px)/2 - 12px); transform:translateX(-50%); z-index:2147481900; display:none;
    align-items:center; gap:9px; pointer-events:none; }
  #hk-dot.show{ display:inline-flex; }
  #hk-dot .hk-core{ display:block; width:8px; height:8px; padding:0; border:0; border-radius:50%; cursor:pointer; pointer-events:auto;
    background:var(--hk-accent); box-shadow:0 0 10px 0 color-mix(in srgb,var(--hk-accent) 70%,transparent); animation:hk-breathe 3.6s ease-in-out infinite; }
  @keyframes hk-breathe{ 0%,100%{ opacity:.5; transform:scale(1); } 50%{ opacity:1; transform:scale(1.25); } }
  #hk-dot .hk-core.arming{ animation:none; transform:scale(.55); opacity:.85; transition:transform .6s ease,opacity .6s ease; }
  #hk-dot .hk-tag{ white-space:nowrap; pointer-events:auto; cursor:pointer; opacity:.82; color:#9aa4b2; font:13px "Segoe UI",system-ui,sans-serif;
    transition:opacity .2s ease,transform .2s ease; }
  #hk-dot .hk-tag kbd{ background:#21262d; border:1px solid #30363d; border-radius:5px; margin:0 1px; padding:1px 6px; font:600 12px ui-monospace,monospace; color:#e6edf3; }
  #hk-dot.bloom .hk-tag{ opacity:0; transform:translateX(4px); pointer-events:none; }
  #hk-dot .hk-legend{ position:absolute; left:50%; bottom:calc(100% + 10px); transform:translate(-50%,6px) scale(.96); transform-origin:50% 100%;
    display:flex; gap:6px; flex-wrap:wrap; justify-content:center; width:max-content; max-width:min(92vw,58rem);
    background:#0d1117; border:1px solid #30363d; border-radius:12px; padding:8px 10px; box-shadow:0 16px 50px rgba(0,0,0,.55);
    opacity:0; pointer-events:none; transition:opacity .16s ease,transform .16s ease; }
  #hk-dot.bloom .hk-legend{ opacity:1; transform:translate(-50%,0) scale(1); pointer-events:auto; }
  #hk-dot.bloom .hk-core{ opacity:.35; }
  #hk-dot .hk-chip{ display:inline-flex; align-items:center; gap:7px; background:0; border:0; cursor:pointer; color:#9aa4b2; font:13px inherit;
    padding:3px 6px; border-radius:8px; opacity:.0; transform:translateY(3px); transition:opacity .18s ease,transform .18s ease,color .15s ease; }
  #hk-dot.bloom .hk-chip{ opacity:1; transform:translateY(0); }
  #hk-dot .hk-chip:hover{ color:#e8edf6; }
  #hk-dot .hk-chip kbd{ background:#21262d; border:1px solid #30363d; border-radius:6px; padding:2px 7px; font:600 12px ui-monospace,monospace; color:#e6edf3; white-space:nowrap; }
  @media (prefers-reduced-motion:reduce){ #hk-dot .hk-core{ animation:none; } #hk-dot .hk-legend,#hk-dot .hk-chip{ transition:opacity .16s ease; transform:none; } }
  @media (max-width:480px){ #hk-dot{ display:none !important; } }   /* only genuinely tiny viewports; the UA gate already excludes mobile */
  `;
  (D.head || D.documentElement).appendChild(style);

  // ── overlay DOM ──────────────────────────────────────────────────────────────────────────────
  const mk = (html) => { const d = D.createElement("div"); d.innerHTML = html; return d.firstElementChild; };
  const scrim = mk(`<div id="hk-scrim"><div class="hk-sheet"><div class="hk-title"></div><input autocomplete="off" spellcheck="false"/><div class="hk-results"></div><div class="hk-preview"></div></div></div>`);
  const cheat = mk(`<div id="hk-cheat"><div class="hk-sheet"></div></div>`);
  const dot = mk(`<div id="hk-dot"><button class="hk-core" type="button" aria-label="Keyboard shortcuts" title="Shortcuts"></button><span class="hk-tag"></span><div class="hk-legend"></div></div>`);
  D.body.appendChild(scrim); D.body.appendChild(cheat); D.body.appendChild(dot);
  const sTitle = $(".hk-title", scrim), sInput = $("input", scrim), sResults = $(".hk-results", scrim), sPreview = $(".hk-preview", scrim);

  // ── the holospace stage — Enter STREAMS the selected app into its OWN isolated canvas frame, behind a
  //    sharp boot splash that is IDENTICAL for every app. A same-origin iframe = the app runs exactly as it
  //    does standalone; the splash makes the load feel instant and the frame fades in the moment it paints.
  //    Esc exits · Ctrl+K jumps straight back to the launcher (app-switch), even from inside a running app. ──
  const stageStyle = D.createElement("style");
  stageStyle.textContent = `
  #hk-stage{ position:fixed; inset:0; z-index:2147482400; display:none; background:#080b10; }
  #hk-stage.open{ display:block; animation:hk-stage-in .2s cubic-bezier(.4,0,.2,1); }
  @keyframes hk-stage-in{ from{ opacity:0; } to{ opacity:1; } }
  #hk-stage .hk-frame{ position:absolute; inset:0; width:100%; height:100%; border:0; background:transparent; opacity:0; transition:opacity .4s ease; }
  #hk-stage.ready .hk-frame{ opacity:1; }
  #hk-stage .hk-boot{ position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:15px; text-align:center;
    background:radial-gradient(130% 120% at 50% 40%, #10171f 0%, #080b10 68%); transition:opacity .45s ease; }
  #hk-stage.ready .hk-boot{ opacity:0; pointer-events:none; }
  #hk-stage .hk-boot-ic{ width:78px; height:78px; border-radius:19px; object-fit:cover; box-shadow:0 14px 44px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.06); animation:hk-bpulse 1.8s ease-in-out infinite; }
  @keyframes hk-bpulse{ 0%,100%{ transform:scale(1); filter:brightness(1); } 50%{ transform:scale(1.05); filter:brightness(1.08); } }
  #hk-stage .hk-boot-nm{ font:600 21px "Segoe UI",system-ui,sans-serif; color:#eef2f8; letter-spacing:-.01em; }
  #hk-stage .hk-boot-wd{ font:12px ui-monospace,monospace; color:#6e7681; margin-top:-6px; }
  #hk-stage .hk-boot-bar{ width:190px; height:2px; border-radius:2px; overflow:hidden; background:rgba(255,255,255,.08); margin-top:6px; position:relative; }
  #hk-stage .hk-boot-bar::before{ content:""; position:absolute; top:0; bottom:0; width:38%; border-radius:2px; background:linear-gradient(90deg,transparent,var(--hk-accent),transparent); animation:hk-bslide 1.05s ease-in-out infinite; }
  @keyframes hk-bslide{ 0%{ transform:translateX(-130%); } 100%{ transform:translateX(360%); } }
  #hk-stage.gone .hk-boot-bar{ display:none; }
  #hk-stage .hk-boot-msg{ opacity:0; margin-top:2px; font:13px "Segoe UI",system-ui,sans-serif; color:#8b949e; transition:opacity .3s ease; }
  #hk-stage .hk-boot-msg.show{ opacity:1; }
  #hk-stage .hk-stage-close{ position:absolute; top:14px; right:16px; z-index:2; display:inline-flex; align-items:center; gap:7px; background:rgba(13,17,23,.62);
    -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px); border:1px solid rgba(255,255,255,.1); color:#c9d1d9; border-radius:9px; padding:6px 10px;
    font:600 12px "Segoe UI",system-ui,sans-serif; cursor:pointer; opacity:0; transition:opacity .3s ease .15s; }
  #hk-stage.ready .hk-stage-close,#hk-stage.gone .hk-stage-close{ opacity:.85; }
  #hk-stage .hk-stage-close:hover{ opacity:1; color:#fff; }
  #hk-stage .hk-stage-close kbd{ background:#21262d; border:1px solid #30363d; border-radius:5px; padding:1px 5px; font:600 11px ui-monospace,monospace; }
  @media (prefers-reduced-motion:reduce){ #hk-stage .hk-boot-ic{ animation:none; } #hk-stage .hk-boot-bar::before{ animation:none; width:100%; } }
  `;
  (D.head || D.documentElement).appendChild(stageStyle);
  const stage = mk(`<div id="hk-stage"><div class="hk-boot"><img class="hk-boot-ic" alt=""/><div class="hk-boot-nm"></div><div class="hk-boot-wd"></div><div class="hk-boot-bar"></div><div class="hk-boot-msg"></div></div><button class="hk-stage-close" type="button">Close <kbd>Esc</kbd></button></div>`);
  D.body.appendChild(stage);
  const stBootIc = $(".hk-boot-ic", stage), stBootNm = $(".hk-boot-nm", stage), stBootWd = $(".hk-boot-wd", stage), stMsg = $(".hk-boot-msg", stage);
  $(".hk-stage-close", stage).addEventListener("click", () => closeStage());

  // deploy-status of each app (probed lazily so the launcher lists only what actually streams) + prefetch cache
  const appStatus = new Map();
  // Sibling apps live UNDER a different base depending on the mount: inside /apps/holo-messenger/* the
  // parent dir holds them; mounted AS the shell document (the live /Q/) apps/ is a child. Resolve once,
  // deterministically — a parent-relative "../" from /Q/ escapes to the origin root and 404s every boot.
  const appsRoot = /\/apps\/holo-messenger\//.test(location.pathname) ? new URL("../", location.href) : new URL("apps/", location.href);
  const appUrl = (app) => app.url || (app.dir ? new URL(app.dir + "/", appsRoot).href : "");
  function prefetchApp(app) {   // warm the app's bytes AND learn if it's deployed — so Enter is instant + honest
    const url = appUrl(app); if (!url || appStatus.has(url)) return;
    appStatus.set(url, "probing");
    fetch(url, { method: "GET", cache: "force-cache" }).then((r) => appStatus.set(url, r && r.ok ? "ok" : "gone")).catch(() => appStatus.set(url, "gone"));
  }

  let stFrame = null, stageOpen = false;
  function openStage(app) {
    if (!app) return; const url = appUrl(app);
    stageOpen = true;
    stBootIc.src = app.img || ""; stBootIc.style.display = app.img ? "" : "none";
    stBootNm.textContent = app.name || "Holo"; stBootWd.textContent = app.words || "";
    stMsg.textContent = ""; stMsg.classList.remove("show");
    stage.classList.remove("ready", "gone"); stage.classList.add("open");
    if (stFrame) { try { stFrame.remove(); } catch {} stFrame = null; }
    if (appStatus.get(url) === "gone") { stage.classList.add("gone"); stMsg.textContent = "Not deployed to this space yet"; stMsg.classList.add("show"); return; }
    const f = D.createElement("iframe"); f.className = "hk-frame"; f.setAttribute("title", app.name || "Holo app");
    f.setAttribute("allow", "accelerometer; autoplay; camera; clipboard-read; clipboard-write; encrypted-media; fullscreen; gamepad; geolocation; gyroscope; microphone; midi; payment; usb; xr-spatial-tracking");
    let done = false; const reveal = () => { if (done) return; done = true; clearTimeout(to); stage.classList.add("ready"); bindFrameKeys(f); };
    const to = setTimeout(reveal, 5000); f.addEventListener("load", reveal);
    f.src = url; stage.appendChild(f); stFrame = f;
    setTimeout(() => { try { f.focus(); } catch {} }, 60);
  }
  function closeStage() {
    if (!stageOpen) return; stageOpen = false;
    stage.classList.remove("open", "ready", "gone");
    if (stFrame) { try { stFrame.remove(); } catch {} stFrame = null; }
  }
  // Esc / Ctrl+K reach us even while a same-origin app has focus — so switching apps stays one keystroke.
  function bindFrameKeys(f) {
    try { f.contentWindow.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeStage(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); closeStage(); setTimeout(() => openSpot(), 0); }
    }, true); } catch {}
  }
  addEventListener("keydown", (e) => { if (e.key === "Escape" && stageOpen) { e.preventDefault(); closeStage(); } }, true);
  // click the backdrop to dismiss
  [scrim, cheat].forEach((s) => s.addEventListener("click", (e) => { if (e.target === s) closeAll(); }));

  // ── messenger actions — every one fail-soft (a missing hook is a quiet no-op) ────────────────────
  const clickFirst = (sels) => { for (const sel of sels) { const el = $(sel); if (el) { el.click(); return true; } } return false; };
  const focusSearch = () => {
    const el = $('.cs-search input, input[type="search"], input[placeholder*="search" i], input[aria-label*="search" i]');
    if (el) { el.focus(); try { el.select(); } catch {} return true; } return false;
  };
  const newChat = () => clickFirst(['[data-hk="new-chat"]', '[title*="new chat" i]', '[aria-label*="new chat" i]', '[title*="new message" i]', '.cs-button--new']);
  const summonQ = () => {
    if (clickFirst([".holo-home-orb", ".holo-global-orb", ".holo-hero-orb"])) return true;
    try { if (W.HoloQ && W.HoloQ.summon) { W.HoloQ.summon(); return true; } } catch {}
    return false;
  };
  const convRows = () => [...D.querySelectorAll(".cs-conversation, [role='listitem'].cs-conversation, .holo-conv, [data-conversation]")];
  const cycleChat = (dir) => {
    const rows = convRows(); if (!rows.length) return false;
    let i = rows.findIndex((r) => /(--active|\bactive\b|selected)/.test(r.className) || r.getAttribute("aria-selected") === "true");
    if (i < 0) i = dir > 0 ? -1 : 0;
    const next = rows[((i + dir) % rows.length + rows.length) % rows.length];
    if (next) { next.click(); try { next.scrollIntoView({ block: "nearest" }); } catch {} return true; }
    return false;
  };
  const signOut = () => { try { if (W.holo && W.holo.signOut) { W.holo.signOut(); return true; } } catch {} return false; };
  // open a sibling Hologram app — "../<dir>/" from /apps/holo-messenger/app.html resolves to /apps/<dir>/,
  // correct whether the bundle is served at the origin root or a subpath (e.g. /Q/).
  const openApp = (dir) => { try { W.open(new URL(dir + "/", appsRoot).href, "_blank", "noopener"); return true; } catch { return false; } };
  // resolve ANY name through the proven /apps/resolve surface — it classifies + VERIFIES bytes (Law L5) and
  // renders the shared <holo-card>. Resolution is UNIFIED at the root now (github.io/Q/#<name>) — the root
  // door mounts the resolver inline — so a full-view hand-off opens the root, not a sub-app.
  const openResolve = (s) => { try { W.open(new URL("../../#" + encodeURIComponent(s), location.href).href, "_blank", "noopener"); return true; } catch { return false; } };
  const openWebSearch = (q) => { try { W.open(new URL("../browser/#q=" + encodeURIComponent(q), location.href).href, "_blank", "noopener"); return true; } catch { return false; } };
  // ask Q: summon the drawer, then seed the hero input + send once it has mounted (retry a few frames).
  const askQ = (text) => {
    summonQ();
    let n = 10; const fill = () => {
      const inp = $("#holo-hero-input");
      if (inp) { inp.value = text; inp.dispatchEvent(new Event("input", { bubbles: true })); const send = $(".holo-hero-send"); if (send) send.click(); return; }
      if (n-- > 0) setTimeout(fill, 120);
    };
    setTimeout(fill, 140); return true;
  };

  // ── the keymap — messenger-appropriate commands (mirrors the shell's binding style) ──────────────
  const km = createKeymap({ apple, seqMs: 900 });
  km.bind("mod+k", () => openSpot(), { id: "spotlight", title: "Search & open…", group: "Go", hint: "Search" });
  km.bind("mod+shift+p", () => openPalette(), { id: "palette", title: "Command palette", group: "Go" });
  km.bind("mod+f", () => focusSearch(), { id: "find", title: "Search messages", group: "Go", hint: "Find" });
  // Help: Ctrl+/ is the universal "keyboard shortcuts" key (Slack/Linear) and — being Ctrl-based — fires even
  // when a text field is focused, unlike a bare "?". Keep "?" and Ctrl+? (mod+shift+?) as aliases so every
  // instinct opens it.
  km.bind(["mod+/", "?", "mod+shift+?"], () => openCheat(), { id: "help", title: "Keyboard shortcuts", group: "Help", hint: "Shortcuts" });
  km.bind("esc", () => closeAll(), { id: "escape", title: "Close / dismiss", group: "Help", global: true });
  km.bind("mod+]", () => cycleChat(1), { id: "chat-next", title: "Next conversation", group: "Chats", hint: "Chats" });
  km.bind("mod+[", () => cycleChat(-1), { id: "chat-prev", title: "Previous conversation", group: "Chats" });
  km.bind(["mod+shift+m", "g c"], () => newChat(), { id: "new-chat", title: "New chat", group: "Chats" });
  km.bind(["mod+shift+q", "g q"], () => summonQ(), { id: "ask-q", title: "Ask Q", group: "Q", hint: "Ask Q" });
  // ── the app catalog — the SAME apps the native "Open an app…" spotlight lists, each with its icon and
  //    3-word κ name (holo:words). Loaded from apps/index.jsonld (the signed catalog; launch = resolve), so
  //    the web launcher mirrors the native one exactly. A small static list is the fail-soft fallback. ──
  const staticApps = [
    { name: "Holo Q", dir: "q", ic: "◍" }, { name: "Holo Browser", dir: "browser", ic: "🌐" },
    { name: "Holo Tube", dir: "video", ic: "▶" }, { name: "Holo Music", dir: "music", ic: "♪" },
    { name: "Holo Hub", dir: "hub", ic: "⬡" }, { name: "Holo Games", dir: "holo-games", ic: "🎮" },
    { name: "Holo Wallet", dir: "holo-money", ic: "💳" }, { name: "Holo Spaces", dir: "spaces", ic: "▦" },
  ];
  let catalog = staticApps.slice();                                          // replaced by the real catalog once loaded
  (async () => {
    try {
      const root = new URL("../", appsRoot);                                  // the dir that CONTAINS apps/ — the bundle root
      const j = await (await fetch(new URL("index.jsonld", appsRoot), { cache: "no-store" })).json();
      const ds = j["dcat:dataset"] || j["@graph"] || [];
      const apps = ds.map((d) => {
        const entry = String(d["dcat:landingPage"] || ""), dir = entry.split("/")[1] || "";
        const img = d["schema:image"] ? new URL(String(d["schema:image"]), root).href : "";
        return { name: String(d["schema:name"] || dir), dir, words: String(d["holo:words"] || d["schema:alternateName"] || ""), img,
          url: entry ? new URL(entry, root).href : (dir ? new URL(dir + "/", appsRoot).href : "") };
      }).filter((a) => a.dir && a.name).sort((a, b) => a.name.localeCompare(b.name));
      if (apps.length) { catalog = apps; try { if (scrim.classList.contains("open")) render(sInput.value); } catch {} }
    } catch {}
  })();
  const openAppRow = (a) => { try { W.open(a.url || new URL(a.dir + "/", appsRoot).href, "_blank", "noopener"); return true; } catch { return false; } };
  // also expose each app as a command (palette + cheat legend), like the native shell
  for (const a of staticApps) km.bind([], () => openApp(a.dir), { id: "app:" + a.dir, title: "Open " + a.name, group: "Open", icon: a.ic });
  km.bind([], () => signOut(), { id: "sign-out", title: "Lock & sign out", group: "Session" });

  km.attach(W);

  // Standalone/PWA: the browser's own Ctrl+Tab is free → honour it too (km can't express a non-mod Ctrl).
  const standalone = (() => { try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch { return false; } })();
  if (standalone) addEventListener("keydown", (e) => { if (e.ctrlKey && e.key === "Tab") { e.preventDefault(); cycleChat(e.shiftKey ? -1 : 1); } }, true);

  // ── the content address of the whole keymap (share the link → a peer re-derives your shortcuts) ──
  let keymapDid = "";
  (async () => { try {
    const buf = new TextEncoder().encode(km.canonical());
    const h = await crypto.subtle.digest("SHA-256", buf);
    keymapDid = "holo://" + [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 30) + "…";
  } catch {} })();

  // ── THE COMMAND BAR — one input, intent classified per keystroke into lanes (chats · commands · apps ·
  //    Q · resolve · web). Ctrl+K = the full bar; Ctrl+Shift+P = commands only. Every row is {ic,label,sub?,
  //    kbd?,group,run}; the flat `list` drives ↑/↓/Enter, group headers render when `group` changes. ──────
  const KINDW = { kappa: "a content address", did: "a sovereign object id", holo: "a holospace member",
    ipfs: "an IPFS name", ipns: "an IPNS name", sri: "a Subresource Integrity hash", ens: "an Ethereum name",
    "eth-tx": "an Ethereum transaction", "eth-address": "an Ethereum account", nostr: "a Nostr name",
    payment: "a payment request", account: "an on-chain account", torrent: "a BitTorrent v2 name",
    data: "inline content", model: "a weights pointer", truename: "a truename", onion: "an onion address",
    refused: "refused — weak / malformed", web: "the open web" };

  let mode = "spot", list = [], sel = 0;
  const cmdRows = (q) => km.registry.filter((c) => c.title && c.group !== "Session")
    .map((c) => ({ sc: fuzzyScore(q, c.title + " " + c.group), c }))
    .filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, q ? 6 : 7)
    .map((x) => ({ ic: x.c.icon || "›", label: x.c.title, kbd: (km.label(x.c.spec) && !/^app:/.test(x.c.id)) ? km.label(x.c.spec) : "", group: "Commands", run: () => { try { x.c.run(); } catch {} } }));
  // apps — icon + name + the 3-word κ name on the right, exactly like the native "Open an app…" spotlight.
  // Enter STREAMS the app into the holospace stage (openStage). `_app` lets nav prefetch/probe the highlight.
  const appRow = (a) => ({ img: a.img || "", ic: a.ic || "▦", label: a.name, sub: a.words || "", group: "Apps", _app: a, run: () => openStage(a) });
  // only list apps that actually stream — an app probed "gone" (not deployed to this space) is dropped so
  // every Enter lands. Un-probed apps show optimistically; once probed they filter on the next render.
  const appRows = (q, cap) => catalog.filter((a) => appStatus.get(appUrl(a)) !== "gone")
    .map((a) => ({ sc: Math.max(fuzzyScore(q, a.name), fuzzyScore(q, a.words || "") * 0.9), a }))
    .filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, cap || (q ? 6 : catalog.length))
    .map((x) => appRow(x.a));
  const chatRows = (q, cap) => {
    const seen = new Set(), out = [];
    for (const r of convRows()) {
      const el = r.querySelector(".cs-conversation__name") || r.querySelector("[class*='name']");
      const name = el ? el.textContent.trim() : ""; if (!name || seen.has(name)) continue; seen.add(name);
      const sc = fuzzyScore(q, name); if (sc > 0) out.push({ sc, name, r });
    }
    return out.sort((a, b) => b.sc - a.sc).slice(0, cap).map((x) => ({ ic: "💬", label: x.name, sub: "Chat", group: q ? "Chats" : "Recent chats", run: () => { try { x.r.click(); } catch {} } }));
  };
  const appHit = (s) => { const t = s.toLowerCase(); const a = catalog.find((x) => x.dir === t || (x.words || "").toLowerCase() === t || x.name.toLowerCase() === t); return a ? appRow(a) : null; };

  function buildList(term) {
    const it = classifyIntent(term, classifyName), q = it.q;
    if (it.lane === "command") return cmdRows(q);
    if (it.lane === "ask") return [{ ic: "◍", label: q || "Ask Q…", sub: "Ask Q", group: "Q", run: () => askQ(q) }, ...chatRows(q, 3)];
    if (it.lane === "resolve") {
      const what = KINDW[(it.name && it.name.kind) || "web"] || "open it";
      const rows = [{ ic: "◆", label: q, sub: "Resolve · " + what + (it.name && it.name.kappa ? " · " + String(it.name.kappa).slice(0, 22) + "…" : ""), group: "Resolve", run: () => openResolve(q) }];
      const a = appHit(q); if (a) rows.push(a);
      return rows;
    }
    if (it.lane === "empty") return [...appRows(""), ...chatRows("", 3)];   // lead with the app catalog, like native "Open an app…"
    // term: search everything, then a web fall-through so the bar is never a dead end
    const rows = [...chatRows(q, 5), ...appRows(q), ...cmdRows(q)];
    rows.push({ ic: "🌐", label: `Search the web for “${q}”`, sub: "Web", group: "Web", run: () => openWebSearch(q) });
    return rows;
  }
  function render(term) { list = (mode === "pal") ? cmdRows((term || "").trim()) : buildList(term || ""); sel = 0; paint(); updatePreview(mode === "pal" ? "" : (term || "")); }

  // ── INLINE RESOLUTION — the shell itself resolves anything. When the query is an addressable name, mount
  //    the ONE shared <holo-card> right in the bar and let it VERIFY + render inline (Enter still opens the
  //    full inspector). The card self-resolves against the bundle root, so it is correct on any mount.
  //    Fail-soft: if the card module hiccups, the bar silently keeps the hand-off row it already shows. ───
  let _cardReady = false, _prevQ = "", _prevT = 0;
  import("/usr/lib/holo/holo-card.mjs").then(() => { _cardReady = true; if (scrim.classList.contains("open")) updatePreview(sInput.value); }).catch(() => {});
  function updatePreview(term) {
    const it = classifyIntent(term || "", classifyName), q = it.q;
    const show = _cardReady && it.lane === "resolve" && q.length > 1;
    clearTimeout(_prevT);
    if (!show) { if (_prevQ) { _prevQ = ""; sPreview.textContent = ""; } return; }
    if (q === _prevQ) return;                                   // already showing this exact name
    _prevT = setTimeout(() => {                                 // debounce — resolve on a pause, not every keystroke
      _prevQ = q; sPreview.textContent = "";
      try { const c = D.createElement("holo-card"); c.setAttribute("name", q); sPreview.appendChild(c); } catch {}
    }, 240);
  }
  // ── low-latency render + nav. paint() builds the list in ONE innerHTML write and caches the row nodes;
  //    it does NOT wire per-row listeners (delegation does that once). Moving the selection touches only the
  //    two affected rows — no DOM re-query, no re-render — so every keystroke lands the same frame. ────────
  let rowEls = [], selEl = null, _pfT = 0;
  function paint() {
    let html = "", lastG = null;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it.group !== lastG) { html += `<div class="hk-lane">${esc(it.group)}</div>`; lastG = it.group; }
      const icon = it.img ? `<img class="hk-ic hk-ic-img" src="${esc(it.img)}" alt="" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'hk-ic',textContent:'▦'}))">` : `<span class="hk-ic">${it.ic || "›"}</span>`;
      const right = it.kbd ? `<kbd class="hk-grp">${esc(it.kbd)}</kbd>` : it.sub ? `<span class="hk-grp${it.words || it.group === "Apps" ? " hk-words" : ""}">${esc(it.sub)}</span>` : "";
      html += `<div class="hk-row${i === sel ? " sel" : ""}" data-i="${i}">${icon}<span class="hk-lbl">${esc(it.label)}</span>${right}</div>`;
    }
    sResults.innerHTML = html || `<div class="hk-empty">${mode === "pal" ? "No commands" : "Type to search — Enter to search the web"}</div>`;
    rowEls = sResults.querySelectorAll(".hk-row[data-i]");   // cache once per paint; nav reads this, never the DOM
    selEl = rowEls[sel] || null; if (selEl) selEl.scrollIntoView({ block: "nearest" }); schedulePrefetch();
  }
  function setSel(i, scroll) {
    const n = rowEls.length; if (!n) return;
    i = i < 0 ? 0 : (i >= n ? n - 1 : i);
    if (i === sel) { if (scroll && selEl) selEl.scrollIntoView({ block: "nearest" }); return; }
    if (selEl) selEl.classList.remove("sel");
    sel = i; selEl = rowEls[i];
    if (selEl) { selEl.classList.add("sel"); if (scroll) selEl.scrollIntoView({ block: "nearest" }); }
    schedulePrefetch();
  }
  const moveSel = (d) => setSel(sel + d, true);
  // prefetch the highlight, but only once you PAUSE on it (not for every row you fly past) — keeps nav free
  // of network churn while still making Enter instant.
  function schedulePrefetch() { clearTimeout(_pfT); const it = list[sel]; if (it && it._app) _pfT = setTimeout(() => prefetchApp(it._app), 110); }
  function runSel(i) {
    const it = list[i != null ? i : sel];
    if (!it && mode !== "pal") { const q = (sInput.value || "").trim(); closeAll(); if (q) openWebSearch(q); return; }  // Enter on empty → web
    closeAll(); if (it) try { it.run(); } catch {}
  }
  // ONE delegated listener each (attached once) — replaces the per-row handlers paint() used to re-wire every
  // keystroke. mouseover only fires when the pointer crosses into a new row; setSel no-ops if it's the same.
  sResults.addEventListener("click", (e) => { const r = e.target.closest(".hk-row[data-i]"); if (r) runSel(+r.dataset.i); });
  sResults.addEventListener("mouseover", (e) => { const r = e.target.closest(".hk-row[data-i]"); if (r) setSel(+r.dataset.i, false); });
  // probe every catalog app ONCE (on first launcher open) so undeployed apps drop out of the list
  let _probed = false;
  const probeCatalog = () => { if (_probed) return; _probed = true; try { Promise.all(catalog.map((a) => { const u = appUrl(a); if (appStatus.has(u)) return null; appStatus.set(u, "probing"); return fetch(u, { method: "HEAD" }).then((r) => appStatus.set(u, r && r.ok ? "ok" : "gone")).catch(() => appStatus.set(u, "gone")); })).then(() => { if (scrim.classList.contains("open")) render(sInput.value); }); } catch {} };
  function openOverlay(m) {
    mode = m; scrim.classList.add("open");
    sTitle.textContent = m === "pal" ? "Command palette" : "Open an app…";
    sInput.value = ""; sInput.placeholder = m === "pal" ? "Run a command…" : "Open an app · search chats · ask Q · run a command (>) · paste a κ / link";
    if (m !== "pal") probeCatalog();
    render(""); sInput.focus();
  }
  const openSpot = () => openOverlay("spot");
  const openPalette = () => openOverlay("pal");
  sInput.addEventListener("input", () => render(sInput.value));
  // fast keyboard nav — arrows repeat, Tab/⇧Tab step, Home/End jump, PageUp/Down leap; the selection always
  // scrolls into view (mark) and the highlighted app prefetches so Enter streams with no wait.
  sInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveSel(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSel(-1); }
    else if (e.key === "Tab") { e.preventDefault(); moveSel(e.shiftKey ? -1 : 1); }
    else if (e.key === "Home") { e.preventDefault(); setSel(0, true); }
    else if (e.key === "End") { e.preventDefault(); setSel(rowEls.length - 1, true); }
    else if (e.key === "PageDown") { e.preventDefault(); moveSel(6); }
    else if (e.key === "PageUp") { e.preventDefault(); moveSel(-6); }
    else if (e.key === "Enter") { e.preventDefault(); runSel(); }
    else if (e.key === "Escape") { e.preventDefault(); closeAll(); }
  });

  // ── the cheat sheet (press ?), OS-adapted, with the keymap's content address ─────────────────────
  function openCheat() {
    const groups = {};
    for (const c of km.registry) { if (!c.title) continue; (groups[c.group] = groups[c.group] || []).push(c); }
    const hidden = dotHidden();
    $(".hk-sheet", cheat).innerHTML =
      `<div class="cheat-h">Keyboard shortcuts <span class="muted">· ${apple ? "macOS" : "Windows"}</span></div><div class="cheat-grid">`
      + Object.entries(groups).map(([g, cs]) => `<div class="cheat-col"><h4>${esc(g)}</h4>`
        + cs.map((c) => `<div class="cheat-row"><span>${esc(c.title)}</span>${km.label(c.spec) && !/^app:/.test(c.id) && c.id !== "sign-out" ? `<kbd>${esc(km.label(c.spec))}</kbd>` : ""}</div>`).join("")
        + `</div>`).join("")
      + `</div><div class="cheat-f">your keymap is content-addressed <span class="k">${esc(keymapDid || "…")}</span>`
      + ` · <button type="button" class="cheat-link" data-hint-toggle>${hidden ? "show the hint dot" : "hide the hint dot"}</button></div>`;
    cheat.classList.add("open");
  }
  cheat.addEventListener("click", (e) => { if (!e.target.closest("[data-hint-toggle]")) return; setDotHidden(!dotHidden()); openCheat(); });

  function closeAll() { scrim.classList.remove("open"); cheat.classList.remove("open"); bloom(false); if (sPreview) { sPreview.textContent = ""; _prevQ = ""; } }

  // ── the ambient hint dot — hold the modifier → bloom the live legend (projected from the keymap) ──
  const legend = $(".hk-legend", dot), core = $(".hk-core", dot), tag = $(".hk-tag", dot);
  // exactly three chips — Search · Commands · Hide. Their keys are Alt+S / Alt+C / Alt+H (bound below): Alt+
  // <letter> is NOT a native browser command (unlike Ctrl+S=Save, Ctrl+C=Copy, Ctrl+H=History), so nothing
  // overlaps and preventDefault sticks in every browser. "Hide" banishes the dot (restore from the ? sheet).
  const CHIPS = [
    { label: "Search",   kbd: "Alt+S", run: () => openSpot() },
    { label: "Commands", kbd: "Alt+C", run: () => openPalette() },
    { label: "Hide",     kbd: "Alt+H", run: () => setDotHidden(!dotHidden()) },   // Alt+H toggles — same key brings it back
  ];
  legend.innerHTML = CHIPS.map((c, i) =>
    `<button class="hk-chip" type="button" tabindex="-1" data-i="${i}" title="${esc(c.label)}">${c.kbd ? `<kbd>${esc(c.kbd)}</kbd>` : ""}<span>${esc(c.label)}</span></button>`).join("");
  core.title = "Shortcuts, hold " + altSym;
  tag.innerHTML = `<kbd>${altSym}</kbd> for shortcuts`;

  const DKEY = "holo.hints.dismissed.v1";
  const dotHidden = () => { try { return localStorage.getItem(DKEY) === "1"; } catch { return false; } };
  const setDotHidden = (on) => { try { localStorage.setItem(DKEY, on ? "1" : "0"); } catch {} syncDot(); };
  // the toggle belongs to the HOME canvas only. The messenger's home widget-runtime sets data-holo-home="on"
  // on <html> while the home VIEW is mounted and removes it when you navigate into a chat/other view — so it
  // tracks the visible surface exactly. (Do NOT also gate on holo-chat-open: that reflects a REMEMBERED active
  // conversation and is true even while the home is showing — it made the dot vanish right after boot.)
  // The keyboard shortcuts themselves stay global; only the visible dot is home-scoped.
  const onHome = () => { try { return D.documentElement.getAttribute("data-holo-home") === "on"; } catch { return true; } };
  const syncDot = () => dot.classList.toggle("show", !dotHidden() && onHome());
  try { new MutationObserver(syncDot).observe(D.documentElement, { attributes: true, attributeFilter: ["data-holo-home", "class"] }); } catch {}
  // ── the three quick keys — Alt+S Search · Alt+C Commands · Alt+H Hide. Bound HERE (not via km) on the
  //    PHYSICAL key (e.code), so they fire identically in every browser AND on macOS, where Option+<letter>
  //    would otherwise emit a special character (ß/ç/…) and defeat a key-name match. Alt+<letter> is not a
  //    native browser accelerator, so there is no overlap with Copy/Save/History and preventDefault holds.
  //    Global (work from anywhere); we ignore the combo when Ctrl/Meta/Shift are also down. ──────────────
  addEventListener("keydown", (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.code === "KeyS") { e.preventDefault(); openSpot(); }
    else if (e.code === "KeyC") { e.preventDefault(); openPalette(); }
    else if (e.code === "KeyH") { e.preventDefault(); setDotHidden(!dotHidden()); }   // Alt+H TOGGLES: hides, and the same key un-hides (the listener is global, so it fires even while the dot is hidden)
  }, true);
  // keep a keyboard route to the shortcuts reference + a hide alias in the ? cheat sheet (chords, not chips)
  km.bind("mod+shift+h", () => setDotHidden(!dotHidden()), { id: "hide-hints", title: "Show / hide the shortcuts dot", group: "Help" });

  let bloomed = false;
  const bloom = (on) => { if (on === bloomed) return; bloomed = on; dot.classList.toggle("bloom", on); };
  const isMod = (e) => e.key === "Alt";   // hold Alt (⌥ on Mac) → bloom the Alt+S / Alt+C / Alt+H legend
  addEventListener("keydown", (e) => { if (!e.repeat && isMod(e) && dot.classList.contains("show") && !scrim.classList.contains("open") && !cheat.classList.contains("open")) { bloom(true); try { e.preventDefault(); } catch {} } }, true);
  addEventListener("keyup", (e) => { if (isMod(e)) bloom(false); }, true);
  addEventListener("blur", () => bloom(false));
  D.addEventListener("visibilitychange", () => { if (D.hidden) bloom(false); });

  // long-press the dot to banish it (persisted); a short tap opens the cheat sheet; a chip runs its command.
  let pressT = null, didLong = false;
  const disarm = () => { clearTimeout(pressT); pressT = null; core.classList.remove("arming"); };
  core.addEventListener("pointerdown", (e) => {
    if (e.button) return; didLong = false; core.classList.add("arming");
    pressT = setTimeout(() => { didLong = true; disarm(); bloom(false); setDotHidden(true); }, 600);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((t) => core.addEventListener(t, disarm));
  dot.addEventListener("click", (e) => {
    if (didLong) { didLong = false; e.preventDefault(); e.stopPropagation(); return; }
    const chip = e.target.closest(".hk-chip");
    if (chip) { const i = +chip.dataset.i; if (CHIPS[i]) try { CHIPS[i].run(); } catch {} return; }
    openCheat();
  });
  syncDot();

  // ── test surface (a headless witness / the console can drive the layer) ──────────────────────────
  W.HoloKeys = { km, openSpot, openPalette, openCheat, closeAll, openStage, closeStage, get keymapDid() { return keymapDid; },
    classify: (s) => classifyIntent(s, classifyName), get list() { return list; }, get catalog() { return catalog; }, get appStatus() { return appStatus; }, render, _build: buildList,
    actions: { focusSearch, newChat, summonQ, cycleChat, openApp, openStage, openResolve, openWebSearch, askQ, signOut } };
  try { console.info("[holo-keys] command bar live ·", km.registry.filter((c) => c.title).length, "commands · Alt+S search · Alt+C commands · Alt+H hide · " + modSymbol + "K launcher · ? shortcuts"); } catch {}
})();
