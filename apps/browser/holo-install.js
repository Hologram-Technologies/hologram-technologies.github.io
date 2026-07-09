// holo-install.js — make Hologram a ONE-TAP, Chrome-less install on any device, and claim
// web+hologram:// links so a single link opens the installed app. The OS becomes its own window:
// the manifest (display:fullscreen) drops all browser chrome and Hologram's own chrome takes over.
//
// Drop-in:  <script src="./holo-install.js" defer></script>   (exposes window.HoloInstall)
//
// Effortless by design: a subtle glass pill appears once when the device CAN install (the browser's
// beforeinstallprompt) — one tap fires the native install dialog; after that it lives in the dock /
// home screen and every web+hologram://κ link opens it directly. Pure DOM + Web APIs, no deps (L4).

(function () {
  "use strict";
  var W = window; if (W.HoloInstall) return;
  if (typeof document === "undefined") return;
  try { if (W.top !== W.self) return; } catch (e) { return; }       // top-level only

  var DOC = document, root = DOC.documentElement;
  var SELF = (DOC.currentScript && DOC.currentScript.src) || (DOC.querySelector('script[src*="holo-install.js"]') || {}).src || new URL("./holo-install.js", location.href).href;
  var base = SELF.replace(/holo-install\.js.*$/, "");
  var ROOT = new URL("../", base).href;
  var LOGO = new URL("usr/share/icons/hologram-light.svg", ROOT).href;

  function isInstalled() {
    try {
      if (W.navigator && W.navigator.standalone === true) return true;
      if (W.matchMedia) for (var m of ["standalone", "fullscreen", "window-controls-overlay"]) if (W.matchMedia("(display-mode: " + m + ")").matches) return true;
    } catch (e) {}
    return false;
  }
  // iOS / iPadOS Safari is the ONE platform that can install a PWA but never fires beforeinstallprompt
  // — the only route is Share → "Add to Home Screen", so we surface that explicitly. (iPadOS 13+
  // masquerades as MacIntel, caught by the touch-point check.)
  function isIOS() {
    try {
      var ua = navigator.userAgent || "";
      return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    } catch (e) { return false; }
  }
  function dismissed() { try { return localStorage.getItem("holo.install.dismissed") === "1"; } catch (e) { return false; } }
  function setDismissed() { try { localStorage.setItem("holo.install.dismissed", "1"); } catch (e) {} }

  // claim web+hologram:// + web+holo:// links (best-effort; the manifest also declares them on install).
  try {
    if (navigator.registerProtocolHandler) {
      var h = ROOT + "shell.html?open=%s";   // the canonical shell resolves holo:// · did · web from its omnibar
      navigator.registerProtocolHandler("web+hologram", h);
      navigator.registerProtocolHandler("web+holo", h);
    }
  } catch (e) {}

  function css() {
    if (DOC.getElementById("holo-install-css")) return;
    var s = DOC.createElement("style"); s.id = "holo-install-css";
    s.textContent =
      "#holo-install{position:fixed;left:50%;bottom:calc(1.1rem + var(--holo-dock-h,0px));transform:translateX(-50%) translateY(1.2rem);z-index:2147483000;" +
      "display:flex;align-items:center;gap:.7rem;padding:.55rem .65rem .55rem .85rem;border-radius:999px;opacity:0;pointer-events:none;" +
      "background:var(--holo-glass-acrylic-bg,color-mix(in srgb,rgba(22,26,34,.82) 86%,var(--holo-accent,#5b8cff) 14%));" +
      "-webkit-backdrop-filter:var(--holo-glass-acrylic-fx,blur(22px) saturate(1.8) brightness(1.06));backdrop-filter:var(--holo-glass-acrylic-fx,blur(22px) saturate(1.8) brightness(1.06));" +
      "border:1px solid var(--holo-glass-border,rgba(255,255,255,.5));box-shadow:0 .6rem 2.4rem rgba(0,0,0,.5),inset 0 1px 0 0 rgba(255,255,255,.28);" +
      "color:var(--holo-ink,#e9eef7);font:var(--holo-text-sm,1rem)/1.2 var(--holo-font-sans,system-ui,-apple-system,'Segoe UI',sans-serif);transition:opacity .28s ease,transform .28s cubic-bezier(.2,.8,.2,1)}" +
      "#holo-install.in{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}" +
      "#holo-install .hi-logo{width:1.6rem;height:1.6rem;flex:0 0 auto;filter:drop-shadow(0 1px 3px rgba(0,0,0,.5))}" +
      "#holo-install .hi-txt{display:flex;flex-direction:column;line-height:1.15;white-space:nowrap}" +
      "#holo-install .hi-txt b{font-weight:600}#holo-install .hi-txt span{font-size:.82em;opacity:.7}" +
      "#holo-install .hi-go{appearance:none;border:0;cursor:pointer;border-radius:999px;padding:.42rem .95rem;margin-left:.3rem;font:inherit;font-weight:600;" +
      "color:#fff;background:linear-gradient(180deg,color-mix(in srgb,var(--holo-accent,#5b8cff) 78%,#fff),var(--holo-accent,#5b8cff));box-shadow:0 2px 8px color-mix(in srgb,var(--holo-accent,#5b8cff) 50%,transparent)}" +
      "#holo-install .hi-go:hover{filter:brightness(1.08)}#holo-install .hi-go:active{transform:scale(.96)}" +
      "#holo-install .hi-x{appearance:none;border:0;background:transparent;color:var(--holo-ink-dim,#9aa6b6);cursor:pointer;width:1.6rem;height:1.6rem;border-radius:999px;display:grid;place-items:center;font-size:1.1em;line-height:1}" +
      "#holo-install .hi-x:hover{background:rgba(255,255,255,.12);color:var(--holo-ink,#e9eef7)}" +
      "@media (prefers-reduced-motion:reduce){#holo-install{transition:opacity .2s ease}}" +
      "#holo-install-toast{position:fixed;left:50%;bottom:calc(1.1rem + var(--holo-dock-h,0px));transform:translateX(-50%);z-index:2147483001;max-width:90vw;" +
      "background:var(--holo-surface,#14161b);color:var(--holo-ink,#e9eef7);border:1px solid var(--holo-border,#2b3440);border-radius:999px;padding:.6rem 1.1rem;" +
      "font:var(--holo-text-sm,1rem) var(--holo-font-sans,system-ui,sans-serif);box-shadow:0 .6rem 2rem rgba(0,0,0,.5);opacity:0;transition:opacity .2s;pointer-events:none}" +
      "#holo-install-toast.in{opacity:1}";
    (DOC.head || root).appendChild(s);
  }

  var pill = null, deferred = null;
  function showPill(mode) {
    if (isInstalled() || dismissed() || pill) return;
    if (mode === "ios" && !isIOS()) return;
    css();
    pill = DOC.createElement("div"); pill.id = "holo-install"; pill.setAttribute("role", "dialog"); pill.setAttribute("aria-label", "Install Hologram");
    var img = DOC.createElement("img"); img.className = "hi-logo"; img.src = LOGO; img.alt = ""; img.draggable = false;
    var txt = DOC.createElement("div"); txt.className = "hi-txt";
    pill.appendChild(img); pill.appendChild(txt);
    if (mode === "ios") {
      // iOS can't auto-prompt — guide the one gesture that installs it, then let them dismiss.
      txt.innerHTML = "<b>Add to Home Screen</b><span>Tap Share, then “Add to Home Screen”</span>";
      var ok = DOC.createElement("button"); ok.className = "hi-go"; ok.type = "button"; ok.textContent = "Got it";
      ok.addEventListener("click", function () { setDismissed(); hidePill(); });
      pill.appendChild(ok);
    } else {
      txt.innerHTML = "<b>Install Hologram</b><span>one tap — opens like an app</span>";
      var go = DOC.createElement("button"); go.className = "hi-go"; go.type = "button"; go.textContent = "Install";
      go.addEventListener("click", doInstall);
      pill.appendChild(go);
    }
    var x = DOC.createElement("button"); x.className = "hi-x"; x.type = "button"; x.setAttribute("aria-label", "Not now"); x.textContent = "✕";
    x.addEventListener("click", function () { setDismissed(); hidePill(); });
    pill.appendChild(x);
    DOC.body.appendChild(pill);
    requestAnimationFrame(function () { if (pill) pill.classList.add("in"); });
  }
  function hidePill() { if (!pill) return; pill.classList.remove("in"); var p = pill; pill = null; setTimeout(function () { if (p && p.parentNode) p.remove(); }, 320); }
  function toast(msg) {
    css(); var t = DOC.getElementById("holo-install-toast"); if (!t) { t = DOC.createElement("div"); t.id = "holo-install-toast"; DOC.body.appendChild(t); }
    t.textContent = msg; t.classList.add("in"); clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove("in"); }, 4200);
  }
  function doInstall() {
    if (!deferred) { toast("Use your browser menu → “Install Hologram / Add to Home Screen”."); return; }
    deferred.prompt();
    Promise.resolve(deferred.userChoice).then(function (c) { if (c && c.outcome === "accepted") hidePill(); deferred = null; }).catch(function () {});
  }

  W.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; showPill(); });
  W.addEventListener("appinstalled", function () { deferred = null; hidePill(); toast("Hologram installed — it lives in your dock now. Open it anytime, no browser needed."); });

  // iOS Safari emits no event, so offer the Home-Screen path proactively (the only install route there).
  function init() { if (isIOS() && !isInstalled() && !dismissed()) setTimeout(function () { showPill("ios"); }, 1200); }
  if (DOC.readyState === "loading") DOC.addEventListener("DOMContentLoaded", init); else init();

  // public API (scriptable + agent-usable). offer() = the universal "install the app" entry: fire the
  // native dialog if the device staged one, else surface the right affordance / instruction.
  function offer() {
    if (isInstalled()) { toast("Hologram is already installed."); return; }
    try { localStorage.removeItem("holo.install.dismissed"); } catch (e) {}
    if (deferred) return doInstall();
    if (isIOS()) return showPill("ios");
    showPill();
    if (!deferred) toast("Install from your browser menu → “Install Hologram / Add to Home Screen”.");
  }
  W.HoloInstall = {
    version: "0.2",
    prompt: doInstall,
    offer: offer,
    available: function () { return !!deferred; },
    installed: isInstalled,
    show: showPill, hide: hidePill,
  };
})();
