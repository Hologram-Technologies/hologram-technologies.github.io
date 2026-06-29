// holo-theme-toggle.mjs — the Appearance control. ONE beautiful glass tile, top-right, sitting just LEFT of
// the Immersive (fill-the-screen) button and matched to it pixel-for-pixel (same 38px tile, hover bloom,
// brand-teal accent). It used to CYCLE the appearance trio on each tap; it now OPENS a small, exquisitely
// clean popover — a one-glance way to discover and switch the look:
//
//   • Dark      — dark palette, backdrop off. On the lock screen Dark wears 100% pure black.
//   • Light     — light palette, backdrop off. A clean, day-bright surface.
//   • Immersive — a κ-sealed photographic backdrop on (curated Unsplash), behind the frosted glass.
//
// Picking Immersive reveals a strip of the curated wallpapers (each a self-verifying κ object on disk),
// with the photographer credited inline (Unsplash License). Every choice applies LIVE and is persisted to
// the ONE canonical state (holo.theme.v1) — so it is remembered for the same person on the same device, and
// flows down the whole boot chain (login → desktop) with no flash and no second source of truth.
//
// Why this is the Hologram-native answer: appearance is two orthogonal axes of ONE canonical state —
// palette (light/dark) and immersive (backdrop on/off + which wallpaper) — read pre-paint by
// holo-appearance-boot.js and live by holo-theme.js's engine. This control writes that SAME state and sets
// the SAME attributes (data-holo-palette · data-holo-immersive · --holo-wallpaper · color-scheme). If the
// full engine (window.HoloTheme) is present it defers to it (keeps every nested holospace in sync);
// otherwise it persists + applies directly, identically. The panel re-themes itself live off the same
// data-holo-palette hook, so its text and surfaces stay legible on any background it just set.

(function () {
  if (window.__holoThemeToggle) return;
  window.__holoThemeToggle = true;

  const root = document.documentElement;
  const reduce = (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } })();
  const TEAL = "#34d3a6";
  const KEY = "holo.theme.v1";

  // ── The curated immersive backdrops — already vendored on disk as self-verifying κ objects and
  //    attributed (see /usr/share/wallpapers/curated.receipt.jsonld, Unsplash License). The first entry
  //    is the brand default (the Milky Way the splash hands off on). To add more, drop the image in
  //    /usr/share/wallpapers and append a row here with its photographer credit. ─────────────────────────
  const WALL_BASE = "/usr/share/wallpapers/";
  const WALLS = [
    { file: "galaxy.jpg",        name: "Galaxy",        by: "Tiago Ferreira" },
    { file: "aurora.jpg",        name: "Aurora",        by: "Lightscape" },
    { file: "mountain-lake.jpg", name: "Mountain Lake", by: "Luca Bravo" },
    { file: "earth-nasa.jpg",    name: "Crescent Earth",by: "NASA" },
    { file: "lioness.jpg",       name: "Lioness",       by: "Jaliya Rasaputra" },
  ];
  const DEFAULT_WALL = WALL_BASE + WALLS[0].file;

  // ── styles ───────────────────────────────────────────────────────────────────────────────────────
  // The trigger mirrors holo-immersive.mjs exactly, shifted one tile (38px) + an 8px gap to its left.
  // The popover is its own self-themed glass card; high-DPI sharp (vector chrome + full-res photo cover).
  const css = `
  .holo-theme-toggle{position:fixed;top:8px;right:56px;z-index:2147483600;width:38px;height:38px;display:grid;
    place-items:center;border-radius:11px;cursor:pointer;color:#e8eaf0;
    background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
    -webkit-backdrop-filter:blur(14px) saturate(1.1);backdrop-filter:blur(14px) saturate(1.1);
    opacity:.55;transition:opacity .22s ease,transform .22s cubic-bezier(.4,0,.2,1),
      background .22s ease,border-color .22s ease,box-shadow .28s ease;-webkit-app-region:no-drag;
    box-shadow:0 4px 16px rgba(0,0,0,.25)}
  .holo-theme-toggle:hover{opacity:1;transform:translateY(1px) scale(1.06);background:rgba(255,255,255,.10);
    border-color:rgba(52,211,166,.55);box-shadow:0 6px 22px rgba(0,0,0,.32),0 0 0 4px rgba(52,211,166,.10)}
  .holo-theme-toggle:active{transform:scale(.96)}
  .holo-theme-toggle[aria-expanded="true"]{opacity:1;background:rgba(255,255,255,.12);border-color:rgba(52,211,166,.6)}
  .holo-theme-toggle:focus-visible{outline:none;border-color:${TEAL};box-shadow:0 0 0 4px rgba(52,211,166,.28)}
  .holo-theme-toggle svg{width:19px;height:19px;display:block;transition:transform .35s cubic-bezier(.4,0,.2,1)}
  :root:fullscreen .holo-theme-toggle,:root:-webkit-full-screen .holo-theme-toggle{opacity:.32}
  :root:fullscreen .holo-theme-toggle:hover{opacity:1}
  :root[data-holo-palette="light"] .holo-theme-toggle{color:#1a1d24;background:rgba(0,0,0,.05);border-color:rgba(0,0,0,.14)}
  :root[data-holo-palette="light"] .holo-theme-toggle:hover{background:rgba(0,0,0,.09);border-color:rgba(52,211,166,.55)}

  /* a faint scrim so an outside-click target exists without dimming the lock screen the panel sits on */
  .holo-appear-scrim{position:fixed;inset:0;z-index:2147483595;background:transparent}

  /* the popover — a frosted glass card anchored under the trigle, scaling open from its top-right corner */
  .holo-appear{position:fixed;top:54px;right:10px;z-index:2147483601;width:min(360px,calc(100vw - 20px));
    color:#eef1f7;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;
    background:rgba(18,22,33,.72);border:1px solid rgba(255,255,255,.14);border-radius:18px;
    -webkit-backdrop-filter:blur(34px) saturate(1.4);backdrop-filter:blur(34px) saturate(1.4);
    box-shadow:0 26px 70px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08);
    padding:16px;transform-origin:100% 0;-webkit-app-region:no-drag;
    animation:holoAppearIn .2s cubic-bezier(.22,.61,.36,1) both}
  @keyframes holoAppearIn{from{opacity:0;transform:translateY(-8px) scale(.94)}to{opacity:1;transform:none}}
  .holo-appear.closing{animation:holoAppearOut .14s ease forwards}
  @keyframes holoAppearOut{to{opacity:0;transform:translateY(-6px) scale(.96)}}
  .holo-appear h3{margin:2px 2px 12px;font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
    color:rgba(238,241,247,.62)}

  /* the three preset cards — each a LIVE preview of the result, not a swatch */
  .holo-appear .presets{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .holo-appear .pre{position:relative;display:flex;flex-direction:column;gap:7px;border:0;background:none;padding:0;cursor:pointer;font:inherit;color:inherit}
  .holo-appear .prev{position:relative;aspect-ratio:4/3;border-radius:12px;overflow:hidden;
    border:1px solid rgba(255,255,255,.14);box-shadow:0 6px 18px rgba(0,0,0,.3);
    transition:transform .16s cubic-bezier(.4,0,.2,1),box-shadow .2s,border-color .2s}
  .holo-appear .pre:hover .prev{transform:translateY(-2px) scale(1.02);box-shadow:0 10px 26px rgba(0,0,0,.4)}
  .holo-appear .pre:focus-visible{outline:none}
  .holo-appear .pre:focus-visible .prev{border-color:${TEAL};box-shadow:0 0 0 3px rgba(52,211,166,.35)}
  .holo-appear .pre[aria-pressed="true"] .prev{border-color:${TEAL};box-shadow:0 0 0 2px ${TEAL},0 10px 26px rgba(0,0,0,.45)}
  .holo-appear .cap{display:flex;align-items:center;justify-content:center;gap:5px;font-size:12.5px;font-weight:500;color:rgba(238,241,247,.82)}
  .holo-appear .cap svg{width:15px;height:15px;flex:0 0 auto;opacity:.9}
  .holo-appear .pre[aria-pressed="true"] .cap{color:#fff}
  /* the selected check badge */
  .holo-appear .tick{position:absolute;top:6px;right:6px;width:18px;height:18px;border-radius:50%;display:none;place-items:center;
    background:${TEAL};color:#06140f;box-shadow:0 2px 6px rgba(0,0,0,.4)}
  .holo-appear .pre[aria-pressed="true"] .tick{display:grid}
  .holo-appear .tick svg{width:11px;height:11px}

  /* mini mock chrome inside the Dark / Light previews (avatar dot · name bar · sign-in pill) */
  .holo-appear .mock{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
  .holo-appear .mock .av{width:26%;aspect-ratio:1;border-radius:50%}
  .holo-appear .mock .nm{width:42%;height:5px;border-radius:3px}
  .holo-appear .mock .bt{width:60%;height:11px;border-radius:6px;background:linear-gradient(135deg,#7defc9,#34d3a6)}
  .prev.dk{background:#000}
  .prev.dk .av{background:linear-gradient(140deg,#5b6b86,#3a455c);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.5)}
  .prev.dk .nm{background:rgba(244,247,252,.85)}
  .prev.lt{background:#eceae4}
  .prev.lt .av{background:linear-gradient(140deg,#7f8da6,#5a6680)}
  .prev.lt .nm{background:rgba(26,29,36,.72)}
  .prev.im{background-size:cover;background-position:center;background-repeat:no-repeat}
  .prev.im .mock{background:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.42))}
  .prev.im .av{background:rgba(255,255,255,.22);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.6)}
  .prev.im .nm{background:rgba(255,255,255,.9)}

  /* the wallpaper strip — revealed when Immersive is active */
  .holo-appear .walls{margin-top:14px;overflow:hidden;max-height:0;opacity:0;
    transition:max-height .28s cubic-bezier(.4,0,.2,1),opacity .24s ease,margin-top .28s}
  .holo-appear .walls.show{max-height:180px;opacity:1}
  .holo-appear .wlabel{font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;color:rgba(238,241,247,.55);margin:0 2px 8px}
  .holo-appear .wrow{display:flex;gap:9px;overflow-x:auto;padding:2px 2px 8px;scrollbar-width:thin;scroll-snap-type:x mandatory}
  .holo-appear .wrow::-webkit-scrollbar{height:5px}
  .holo-appear .wrow::-webkit-scrollbar-thumb{background:rgba(255,255,255,.22);border-radius:3px}
  .holo-appear .w{position:relative;flex:0 0 84px;height:56px;border-radius:10px;overflow:hidden;cursor:pointer;border:0;padding:0;scroll-snap-align:start;
    background-size:cover;background-position:center;box-shadow:0 4px 12px rgba(0,0,0,.34);
    transition:transform .16s cubic-bezier(.4,0,.2,1),box-shadow .2s}
  .holo-appear .w:hover{transform:translateY(-2px) scale(1.04)}
  .holo-appear .w:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(52,211,166,.4)}
  .holo-appear .w[aria-pressed="true"]{box-shadow:0 0 0 2px ${TEAL},0 6px 16px rgba(0,0,0,.45)}
  .holo-appear .w .wtick{position:absolute;top:4px;right:4px;width:15px;height:15px;border-radius:50%;display:none;place-items:center;background:${TEAL};color:#06140f}
  .holo-appear .w[aria-pressed="true"] .wtick{display:grid}
  .holo-appear .w .wtick svg{width:9px;height:9px}
  /* the live FLUID tile — a painted fluid swatch (no image) with a pulsing "live" badge */
  .holo-appear .w.wfluid{background:
    radial-gradient(58% 80% at 24% 30%, rgba(52,211,166,.95), transparent 60%),
    radial-gradient(72% 82% at 82% 72%, rgba(196,58,176,.9), transparent 60%),
    radial-gradient(52% 62% at 62% 18%, rgba(86,124,255,.85), transparent 60%), #04060a}
  .holo-appear .w .wlive{position:absolute;left:6px;bottom:5px;font-size:8.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#fff;opacity:.9;text-shadow:0 1px 3px rgba(0,0,0,.7)}
  .holo-appear .w .wlive::before{content:"";display:inline-block;width:5px;height:5px;border-radius:50%;background:${TEAL};margin-right:4px;vertical-align:middle;box-shadow:0 0 6px ${TEAL};animation:holoLivePulse 1.6s ease-in-out infinite}
  @keyframes holoLivePulse{0%,100%{opacity:1}50%{opacity:.35}}
  @media (prefers-reduced-motion:reduce){.holo-appear .w .wlive::before{animation:none}}
  .holo-appear .credit{margin:8px 2px 0;font-size:11.5px;color:rgba(238,241,247,.55);min-height:14px}
  .holo-appear .credit a{color:rgba(238,241,247,.78);text-decoration:none;border-bottom:1px solid rgba(255,255,255,.2)}
  .holo-appear .credit a:hover{color:#fff}

  /* light palette — re-ink the glass + text so the panel stays legible on a bright lock screen */
  :root[data-holo-palette="light"] .holo-appear{background:rgba(250,249,246,.82);border-color:rgba(0,0,0,.12);color:#1a1d24;
    box-shadow:0 26px 70px rgba(20,24,33,.22),inset 0 1px 0 rgba(255,255,255,.6)}
  :root[data-holo-palette="light"] .holo-appear h3{color:rgba(26,29,36,.55)}
  :root[data-holo-palette="light"] .holo-appear .cap{color:rgba(26,29,36,.78)}
  :root[data-holo-palette="light"] .holo-appear .pre[aria-pressed="true"] .cap{color:#000}
  :root[data-holo-palette="light"] .holo-appear .prev{border-color:rgba(0,0,0,.14)}
  :root[data-holo-palette="light"] .holo-appear .wlabel,:root[data-holo-palette="light"] .holo-appear .credit{color:rgba(26,29,36,.55)}
  :root[data-holo-palette="light"] .holo-appear .credit a{color:rgba(26,29,36,.8);border-bottom-color:rgba(0,0,0,.2)}

  @media (max-width:600px),(pointer:coarse){
    .holo-theme-toggle{width:44px;height:44px;right:62px}
    .holo-appear{top:62px;right:max(10px,env(safe-area-inset-right,0px));width:min(380px,calc(100vw - 20px))}
    .holo-appear .w{flex-basis:96px;height:64px}
  }
  @media (prefers-reduced-motion:reduce){
    .holo-appear,.holo-appear.closing{animation:none}
    .holo-appear .walls{transition:opacity .15s ease}
    .holo-theme-toggle svg,.holo-appear .prev,.holo-appear .w,.holo-appear .pre:hover .prev{transition:none}
  }`;
  const style = document.createElement("style"); style.textContent = css;

  // ── icons ──────────────────────────────────────────────────────────────────────────────────────────
  const ICON = {
    immersive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2l1.7 4.6 4.6 1.7-4.6 1.7L12 15.8l-1.7-4.6L5.7 9.5l4.6-1.7z"/><path d="M18.5 14.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5 11-11"/></svg>'
  };
  const LABEL = { immersive: "Immersive", dark: "Dark", light: "Light" };

  // ── canonical state plumbing (mirrors holo-theme.js / holo-appearance-boot.js) ──────────────────────
  function readState() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
  function wallUrl(w) {
    if (!w) return "";
    const m = String(w).match(/^(sha256|blake3|sha512):([0-9a-f]+)$/i);
    return m ? "/.holo/" + m[1].toLowerCase() + "/" + m[2] : String(w);
  }
  // The mode in effect right now: immersive (backdrop on) wins; else the pinned palette; else system pref.
  function currentMode() {
    if (root.getAttribute("data-holo-immersive") === "on") return "immersive";
    const p = root.getAttribute("data-holo-palette");
    if (p === "light" || p === "dark") return p;
    return (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }
  function currentWall() {
    const w = readState().wallpaper || "";
    if (/^live:/.test(w)) return WALLS[0].file;   // a live backdrop → use the brand image as the mode emblem
    const base = String(w).split("/").pop();
    return base || WALLS[0].file;
  }
  // is the live "Fluid" backdrop the active immersive choice?
  const isFluidSel = () => /^live:fluid\b/.test(readState().wallpaper || "") && currentMode() === "immersive";
  // Apply a state object to THIS document with only W3C primitives — mirrors holo-theme.js's apply().
  function applyState(s) {
    const pinned = s.palette === "light" || s.palette === "dark";
    if (pinned) { root.setAttribute("data-holo-palette", s.palette); root.style.setProperty("color-scheme", s.palette); }
    else { root.removeAttribute("data-holo-palette"); root.style.removeProperty("color-scheme"); }
    root.setAttribute("data-holo-immersive", s.immersive ? "on" : "off");
    if (s.wallpaper) root.style.setProperty("--holo-wallpaper", 'url("' + wallUrl(s.wallpaper) + '")');
    root.dispatchEvent(new CustomEvent("holo-theme-change", { detail: s, bubbles: false }));
  }
  // Prefer the live engine (keeps every surface + the nested-holospace tree in sync); else persist + apply.
  function setMode(mode) {
    if (window.HoloTheme && window.HoloTheme.setMode) {
      if (mode === "immersive" && !readState().wallpaper && window.HoloTheme.setWallpaper) window.HoloTheme.setWallpaper(DEFAULT_WALL);
      window.HoloTheme.setMode(mode); return;
    }
    const s = readState();
    if (mode === "light") { s.palette = "light"; s.immersive = false; }
    else if (mode === "dark") { s.palette = "dark"; s.immersive = false; }
    else { s.immersive = true; if (!s.wallpaper) s.wallpaper = DEFAULT_WALL; }
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    applyState(s);
  }
  function setWallpaper(file) {
    const path = WALL_BASE + file;
    if (window.HoloTheme && window.HoloTheme.setWallpaper) { window.HoloTheme.setWallpaper(path); if (window.HoloTheme.setImmersive) window.HoloTheme.setImmersive(true); return; }
    const s = readState(); s.wallpaper = path; s.immersive = true;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    applyState(s);
  }
  // Select a LIVE backdrop (e.g. the interactive fluid sim) — stored as the sentinel wallpaper "live:<kind>",
  // immersive on. The backdrop projector (holo-immersive-backdrop.mjs) sees the sentinel and mounts the sim.
  function setLive(kind) {
    const wp = "live:" + kind;
    if (window.HoloTheme) {
      if (window.HoloTheme.setImmersive) window.HoloTheme.setImmersive(true);
      if (window.HoloTheme.setWallpaper) window.HoloTheme.setWallpaper(wp);
      else if (window.HoloTheme.set) window.HoloTheme.set({ immersive: true, wallpaper: wp });
      return;
    }
    const s = readState(); s.immersive = true; s.wallpaper = wp;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    applyState(s);
  }

  // ── the trigger ──────────────────────────────────────────────────────────────────────────────────
  const btn = document.createElement("button");
  btn.className = "holo-theme-toggle";
  btn.type = "button";
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");

  let pop = null, scrim = null, lastFocus = null;

  function syncIcon() {
    const m = currentMode();
    btn.innerHTML = ICON[m] || ICON.dark;
    btn.title = "Appearance — " + LABEL[m];
    btn.setAttribute("aria-label", "Appearance — currently " + LABEL[m] + ". Open to change.");
  }

  // ── the popover ─────────────────────────────────────────────────────────────────────────────────
  function presetCard(mode, prevClass, bgFile) {
    const on = currentMode() === mode;
    const bg = bgFile ? ` style="background-image:url('${WALL_BASE + bgFile}')"` : "";
    return `<button class="pre" type="button" data-mode="${mode}" role="radio" aria-pressed="${on}" aria-checked="${on}">
      <span class="prev ${prevClass}"${bg}>
        <span class="mock"><span class="av"></span><span class="nm"></span><span class="bt"></span></span>
        <span class="tick">${ICON.check}</span>
      </span>
      <span class="cap">${ICON[mode === "immersive" ? "immersive" : mode]}<span>${LABEL[mode]}</span></span>
    </button>`;
  }
  function wallThumb(w) {
    const on = !isFluidSel() && currentWall() === w.file && currentMode() === "immersive";
    return `<button class="w" type="button" data-wall="${w.file}" aria-pressed="${on}" title="${w.name} — ${w.by} · Unsplash" aria-label="${w.name} by ${w.by}, from Unsplash"
      style="background-image:url('${WALL_BASE + w.file}')"><span class="wtick">${ICON.check}</span></button>`;
  }
  // the live "Fluid" tile — first in the strip, ahead of the photographs
  function fluidThumb() {
    const on = isFluidSel();
    return `<button class="w wfluid" type="button" data-live="fluid" aria-pressed="${on}" title="Fluid — a live, interactive simulation" aria-label="Fluid, a live interactive backdrop"><span class="wlive">live</span><span class="wtick">${ICON.check}</span></button>`;
  }
  function creditFor(file) {
    const w = WALLS.find((x) => x.file === file) || WALLS[0];
    return `Photo · <strong>${w.name}</strong> by ${w.by} on <a href="https://unsplash.com/?utm_source=Hologram_OS&utm_medium=referral" target="_blank" rel="noopener">Unsplash</a>`;
  }
  function creditLive() {
    return `Live · <strong>Fluid</strong> — move your cursor to stir it. WebGL Fluid Simulation by Pavel Dobryakov (MIT).`;
  }

  function render() {
    const immersive = currentMode() === "immersive";
    pop.innerHTML =
      `<h3>Appearance</h3>
      <div class="presets" role="radiogroup" aria-label="Theme">
        ${presetCard("dark", "dk")}
        ${presetCard("light", "lt")}
        ${presetCard("immersive", "im", currentWall())}
      </div>
      <div class="walls${immersive ? " show" : ""}">
        <div class="wlabel">Immersive backdrop</div>
        <div class="wrow">${fluidThumb()}${WALLS.map(wallThumb).join("")}</div>
        <div class="credit">${immersive ? (isFluidSel() ? creditLive() : creditFor(currentWall())) : ""}</div>
      </div>`;

    pop.querySelectorAll(".pre").forEach((b) => b.addEventListener("click", () => { setMode(b.dataset.mode); render(); syncIcon(); }));
    pop.querySelectorAll(".w[data-wall]").forEach((b) => b.addEventListener("click", () => { setWallpaper(b.dataset.wall); render(); syncIcon(); }));
    pop.querySelectorAll(".w[data-live]").forEach((b) => b.addEventListener("click", () => { setLive(b.dataset.live); render(); syncIcon(); }));
  }

  function open() {
    if (pop) return;
    scrim = document.createElement("div"); scrim.className = "holo-appear-scrim"; scrim.addEventListener("click", close);
    pop = document.createElement("div"); pop.className = "holo-appear";
    pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Appearance");
    document.body.appendChild(scrim); document.body.appendChild(pop);
    render();
    btn.setAttribute("aria-expanded", "true");
    lastFocus = document.activeElement;
    const first = pop.querySelector(".pre"); if (first) setTimeout(() => first.focus(), 30);
    document.addEventListener("keydown", onKey, true);
  }
  function close() {
    if (!pop) return;
    document.removeEventListener("keydown", onKey, true);
    const p = pop, s = scrim; pop = null; scrim = null;
    btn.setAttribute("aria-expanded", "false");
    if (reduce) { p.remove(); } else { p.classList.add("closing"); setTimeout(() => p.remove(), 150); }
    s.remove();
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab" || !pop) return;
    const f = pop.querySelectorAll("button, a[href]"); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  btn.addEventListener("click", () => (pop ? close() : open()));
  // Keep the trigger icon honest if appearance changes elsewhere (engine, system "auto", another surface).
  root.addEventListener("holo-theme-change", () => { syncIcon(); if (pop) render(); });
  if (window.matchMedia) {
    try {
      const mq = matchMedia("(prefers-color-scheme: dark)");
      const onSys = () => { if (currentMode() !== "immersive" && !["light", "dark"].includes(root.getAttribute("data-holo-palette"))) { syncIcon(); if (pop) render(); } };
      mq.addEventListener ? mq.addEventListener("change", onSys) : mq.addListener && mq.addListener(onSys);
    } catch (e) {}
  }

  function mount() {
    if (!document.body) return void addEventListener("DOMContentLoaded", mount, { once: true });
    document.head.appendChild(style);
    document.body.appendChild(btn);
    syncIcon();
  }
  mount();
})();
