// holo-theme-toggle.mjs — the Appearance toggle. ONE beautiful control, top-right, sitting just LEFT of
// the Immersive (fill-the-screen) button, matched to it pixel-for-pixel: same 38px glass tile, same hover
// bloom, same brand-teal accent. One tap cycles the canonical appearance trio — Immersive → Dark → Light —
// exactly the choice HoloTheme.setMode() models OS-wide:
//   • Immersive — the κ-sealed wallpaper backdrop on (keeps the current palette)
//   • Dark      — dark palette, backdrop off
//   • Light     — light palette, backdrop off
//
// Why this is the Hologram-native answer: appearance is two orthogonal axes of ONE canonical state
// (holo.theme.v1) — palette (light/dark) and immersive (backdrop on/off) — read pre-paint by the bootstrap
// and live by holo-theme.js's engine. This control writes that SAME state and sets the SAME attributes
// (data-holo-palette · data-holo-immersive · --holo-wallpaper · color-scheme) the engine sets, so the
// choice flows down the whole boot chain (login → desktop) with no flash and no second source of truth. If
// the full theme engine (window.HoloTheme) is present it defers to it; otherwise it persists directly.

(function () {
  if (window.__holoThemeToggle) return;
  window.__holoThemeToggle = true;

  const root = document.documentElement;
  const TEAL = "#34d3a6";
  const KEY = "holo.theme.v1";
  const DEFAULT_WALL = "/usr/share/wallpapers/galaxy.jpg";   // the curated immersive backdrop (first-run default)

  // ── styles (mirror holo-immersive.mjs exactly, only the position is shifted one tile left) ─────────
  // The Immersive button sits at right:10px, width:38px. We sit one tile (38px) + an 8px gap to its left.
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
  .holo-theme-toggle:focus-visible{outline:none;border-color:${TEAL};box-shadow:0 0 0 4px rgba(52,211,166,.28)}
  .holo-theme-toggle svg{width:19px;height:19px;display:block;transition:transform .35s cubic-bezier(.4,0,.2,1)}
  .holo-theme-toggle:active svg{transform:rotate(40deg) scale(.9)}
  :root:fullscreen .holo-theme-toggle,:root:-webkit-full-screen .holo-theme-toggle{opacity:.32}
  :root:fullscreen .holo-theme-toggle:hover{opacity:1}
  /* light surfaces: tint the glass to dark ink so the tile reads (≥3:1 UI contrast) on a bright lock screen */
  :root[data-holo-palette="light"] .holo-theme-toggle{color:#1a1d24;background:rgba(0,0,0,.05);border-color:rgba(0,0,0,.14)}
  :root[data-holo-palette="light"] .holo-theme-toggle:hover{background:rgba(0,0,0,.09);border-color:rgba(52,211,166,.55)}
  @media (max-width:600px),(pointer:coarse){.holo-theme-toggle{width:44px;height:44px;right:62px}}`;
  const style = document.createElement("style"); style.textContent = css;

  // ── icons: one per mode (stroked, brand line weight, matched to the Immersive glyphs) ──────────────
  const ICON = {
    // immersive — a sparkle pair: the κ-sealed aurora/wallpaper backdrop
    immersive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2l1.7 4.6 4.6 1.7-4.6 1.7L12 15.8l-1.7-4.6L5.7 9.5l4.6-1.7z"/><path d="M18.5 14.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/></svg>',
    // dark — moon
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z"/></svg>',
    // light — sun
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"/></svg>'
  };
  const NEXT = { immersive: "dark", dark: "light", light: "immersive" };   // tap order: Immersive → Dark → Light → …
  const LABEL = { immersive: "Immersive", dark: "Dark", light: "Light" };

  const btn = document.createElement("button");
  btn.className = "holo-theme-toggle";
  btn.type = "button";

  function readState() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
  // Resolve a wallpaper reference (κ or path) to a URL — same rule as holo-theme.js / the bootstrap.
  function wallUrl(w) {
    if (!w) return "";
    const m = String(w).match(/^(sha256|blake3|sha512):([0-9a-f]+)$/i);
    return m ? "/.holo/" + m[1].toLowerCase() + "/" + m[2] : String(w);
  }

  // The mode in effect right now: immersive (backdrop on) wins; else the pinned palette; else the system
  // preference (= "auto"), resolved exactly as the engine resolves it, so the icon never lies.
  function currentMode() {
    if (root.getAttribute("data-holo-immersive") === "on") return "immersive";
    const p = root.getAttribute("data-holo-palette");
    if (p === "light" || p === "dark") return p;
    return (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }

  // Apply a state object to THIS document with only W3C primitives — mirrors holo-theme.js's apply().
  function applyState(s) {
    const pinned = s.palette === "light" || s.palette === "dark";
    if (pinned) { root.setAttribute("data-holo-palette", s.palette); root.style.setProperty("color-scheme", s.palette); }
    else { root.removeAttribute("data-holo-palette"); root.style.removeProperty("color-scheme"); }
    root.setAttribute("data-holo-immersive", s.immersive ? "on" : "off");
    if (s.wallpaper) root.style.setProperty("--holo-wallpaper", 'url("' + wallUrl(s.wallpaper) + '")');
    root.dispatchEvent(new CustomEvent("holo-theme-change", { detail: s, bubbles: false }));
  }

  // Set the chosen mode through the ONE canonical path. Prefer the live engine (keeps every surface and
  // the nested-holospace tree in sync); else write holo.theme.v1 and apply locally, identically.
  function setMode(mode) {
    if (window.HoloTheme && window.HoloTheme.setMode) { window.HoloTheme.setMode(mode); sync(); return; }
    const s = readState();
    if (mode === "light") { s.palette = "light"; s.immersive = false; }
    else if (mode === "dark") { s.palette = "dark"; s.immersive = false; }
    else { s.immersive = true; if (!s.wallpaper) s.wallpaper = DEFAULT_WALL; }   // immersive keeps the current palette
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    applyState(s);
    sync();
  }

  function sync() {
    const m = currentMode();
    btn.innerHTML = ICON[m] || ICON.dark;
    btn.title = "Appearance: " + LABEL[m] + " · tap for " + LABEL[NEXT[m]];
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("data-mode", m);
  }

  btn.addEventListener("click", () => setMode(NEXT[currentMode()]));
  // Keep the icon honest if appearance changes elsewhere (engine, system "auto", another surface).
  root.addEventListener("holo-theme-change", sync);
  if (window.matchMedia) {
    try {
      const mq = matchMedia("(prefers-color-scheme: dark)");
      const onSys = () => { if (currentMode() !== "immersive" && !["light", "dark"].includes(root.getAttribute("data-holo-palette"))) sync(); };
      mq.addEventListener ? mq.addEventListener("change", onSys) : mq.addListener && mq.addListener(onSys);
    } catch (e) {}
  }

  function mount() {
    if (!document.body) return void addEventListener("DOMContentLoaded", mount, { once: true });
    document.head.appendChild(style);
    document.body.appendChild(btn);
    sync();
  }
  mount();
})();
