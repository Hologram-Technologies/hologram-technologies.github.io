// holo-immersive.mjs — the Immersive toggle. ONE beautiful control, top-right (left of the window close),
// that projects Hologram across the ENTIRE screen: requestFullscreen on the document root so the κ-rendered
// surface fills the display at native resolution and the GPU's frame rate, with no browser chrome. Toggle
// again (or Esc) to return. Self-contained, GPU-composited (transform/opacity only — no per-frame blur on the
// hot path), responsive to any screen size, reduced-motion aware. Drop-in: import it from any holo:// surface.
//
// Why this is the Hologram-native answer: the shell/login are already content-addressed, GPU-composited κ
// projections. "Immersive" simply hands that projection the whole viewport — same pixels, more of them, no
// chrome in the way. Fullscreen is intrinsically resolution- and DPI-correct, so it adapts to ANY screen with
// zero layout math; the compositor keeps it at display refresh.

(function () {
  if (window.__holoImmersive) return;
  window.__holoImmersive = true;

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  const TEAL = "#34d3a6";

  // ── styles (injected once; glassmorphic, subtle until hover, brand-teal accent) ───────────────────
  const css = `
  .holo-immersive{position:fixed;top:8px;right:10px;z-index:2147483600;width:38px;height:38px;display:grid;
    place-items:center;border-radius:11px;cursor:pointer;color:#e8eaf0;
    background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
    -webkit-backdrop-filter:blur(14px) saturate(1.1);backdrop-filter:blur(14px) saturate(1.1);
    opacity:.55;transition:opacity .22s ease,transform .22s cubic-bezier(.4,0,.2,1),
      background .22s ease,border-color .22s ease,box-shadow .28s ease;-webkit-app-region:no-drag;
    box-shadow:0 4px 16px rgba(0,0,0,.25)}
  .holo-immersive:hover{opacity:1;transform:translateY(1px) scale(1.06);background:rgba(255,255,255,.10);
    border-color:rgba(52,211,166,.55);box-shadow:0 6px 22px rgba(0,0,0,.32),0 0 0 4px rgba(52,211,166,.10)}
  .holo-immersive:active{transform:scale(.96)}
  .holo-immersive:focus-visible{outline:none;border-color:${TEAL};box-shadow:0 0 0 4px rgba(52,211,166,.28)}
  .holo-immersive svg{width:19px;height:19px;display:block;transition:transform .3s cubic-bezier(.4,0,.2,1)}
  :root:fullscreen .holo-immersive,:root:-webkit-full-screen .holo-immersive{opacity:.32}
  :root:fullscreen .holo-immersive:hover{opacity:1}
  /* light surfaces: tint the glass to dark ink so the tile reads (≥3:1 UI contrast) on a bright surface */
  :root[data-holo-palette="light"] .holo-immersive{color:#1a1d24;background:rgba(0,0,0,.05);border-color:rgba(0,0,0,.14)}
  :root[data-holo-palette="light"] .holo-immersive:hover{background:rgba(0,0,0,.09);border-color:rgba(52,211,166,.55)}
  /* the projection-expand flourish: a teal aurora that blooms from the control then clears (GPU scale/opacity) */
  .holo-immersive-bloom{position:fixed;inset:0;z-index:2147483599;pointer-events:none;opacity:0;
    background:radial-gradient(120% 90% at 100% 0%,rgba(52,211,166,.20),rgba(64,99,214,.10) 40%,transparent 70%)}
  .holo-immersive-bloom.on{animation:holoBloom .62s cubic-bezier(.22,.61,.36,1) forwards}
  @keyframes holoBloom{0%{opacity:0;transform:scale(1.04)}30%{opacity:1}100%{opacity:0;transform:scale(1)}}
  @media (prefers-reduced-motion:reduce){.holo-immersive,.holo-immersive svg{transition:opacity .15s ease}
    .holo-immersive-bloom.on{animation:none}}`;
  const style = document.createElement("style"); style.textContent = css;

  // ── icons: expand (enter) ↔ compress (exit) — four corner glyphs, stroked, brand line weight ──────
  const EXPAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  const COMPRESS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h3a2 2 0 0 0 2-2V3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/></svg>';

  const btn = document.createElement("button");
  btn.className = "holo-immersive";
  btn.type = "button";
  btn.setAttribute("aria-label", "Immersive — fill the whole screen");
  btn.title = "Immersive (fill the whole screen)";
  btn.innerHTML = EXPAND;

  const bloom = document.createElement("div");
  bloom.className = "holo-immersive-bloom";

  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function enter() {
    const el = root;
    const p = (el.requestFullscreen ? el.requestFullscreen({ navigationUI: "hide" }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen());
    if (!reduce) { bloom.classList.remove("on"); void bloom.offsetWidth; bloom.classList.add("on"); }
    return p;
  }
  function exit() { return document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen && document.webkitExitFullscreen(); }
  function toggle() { try { isFs() ? exit() : enter(); } catch (e) {} }

  function sync() {
    const fs = isFs();
    btn.innerHTML = fs ? COMPRESS : EXPAND;
    btn.title = fs ? "Exit immersive" : "Immersive (fill the whole screen)";
    btn.setAttribute("aria-pressed", String(fs));
    document.documentElement.toggleAttribute("data-holo-immersive-on", fs);
  }

  btn.addEventListener("click", toggle);
  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("webkitfullscreenchange", sync);
  // F is a friendly accelerator when nothing is focused on an input (F11 still works natively too).
  addEventListener("keydown", (e) => {
    if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = e.target; const tag = t && t.tagName; const editing = t && (t.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT");
      if (!editing) { e.preventDefault(); toggle(); }
    }
  });

  function mount() {
    if (!document.body) return void addEventListener("DOMContentLoaded", mount, { once: true });
    document.head.appendChild(style);
    document.body.appendChild(bloom);
    document.body.appendChild(btn);
    sync();
  }
  mount();
})();
