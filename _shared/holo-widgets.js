// holo-widgets.js — Holo Widgets: a tiny runtime for editable, holo-native desktop objects.
// Every widget is a small live object that FLOATS on the shell's top plane (so it survives app
// frames, exactly like Holo Vinyl): drag to move · grip to resize · right-click to edit/share/remove.
// At rest a widget is just calm text/graphics over the wallpaper (Momentum-clean); on HOVER it
// reveals itself as a holo object — a soft glass frame, a resize grip, an edit pencil, and a κ badge
// that re-derives its content address (Law L5). Its config IS its source — editing happens in place.
//
//   HoloWidgets.define(type, spec)   register a widget TYPE (render + fields + providers)
//   HoloWidgets.add(type, cfg, pos)  drop one onto the desktop
//   HoloWidgets.provider(name, fac)  register a substrate data source widgets subscribe to
//
// The runtime owns the FRAME (float · drag · resize · persist · menu · share-by-κ · inline edit).
// A widget type owns only its BODY (render + an optional field schema). Pure DOM + Web APIs, no
// framework, no CDN (ADR-0029). Self-contained and offline-first.
// Drop-in: <script src="_shared/holo-widgets.js" defer></script>   (exposes window.HoloWidgets)
(function () {
  "use strict";
  var W = window, DOC = document;
  if (W.HoloWidgets) return;
  try { if (W.top !== W.self) return; } catch (e) { return; }     // top shell only — survive app frames

  var LS = "holo-widgets.v6";          // v6: every intent mode (Learn·Work·Play) reseats onto the shared centre-hero + four-corner golden grammar (reseeds cleanly)
  var SEED_LS = "holo-widgets.seeded.v6";
  var TYPES = {};                                                 // type id → spec
  var PROVIDERS = {};                                            // provider name → factory()
  var live = [];                                                 // mounted instances {id,type,x,y,w,h,config,el,body,_subs}
  var SCENES = {};                                              // named preset arrangements (e.g. the Momentum "focus" scene)
  var onChangeFns = [];                                         // board-mutation subscribers — the shell saves each holospace's board here
  var persistScope = true;                                     // does THIS board persist to localStorage? Home/standalone: yes; a shell-driven app holospace: no — it rides that holospace's κ instead

  // ── persistence ─────────────────────────────────────────────────────────────────────────
  function load() { try { return JSON.parse(W.localStorage.getItem(LS) || "[]"); } catch (e) { return []; } }
  function serialize() { return live.map(function (w) { var r = { id: w.id, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h, hidden: w.hidden, config: w.config }; if (w._userMoved) r.moved = true; return r; }); }
  function save() { try { if (persistScope) W.localStorage.setItem(LS, JSON.stringify(serialize())); } catch (e) {} fireChange(); }
  function fireChange() { var snap; try { snap = serialize(); } catch (e) { return; } onChangeFns.forEach(function (fn) { try { fn(snap); } catch (e) {} }); }
  function uid() { try { return "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); } catch (e) { return "w" + (uid._n = (uid._n || 0) + 1); } }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function toast(m) { try { (W.HoloDesk && W.HoloDesk.toast || W.toast || function () {})(m); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  // ── keep every floating object INSIDE the desktop — clear of the dock rail (shared with vinyl/desk) ──
  var EDGE = 8;
  // cached ~120ms + keyed to viewport size: deskBounds reads getComputedStyle, which forces a style
  // recalc — calling it on EVERY pointer-move (clampPos · snap targets · guides) is the main drag-jank.
  var _db = null, _dbT = 0;
  function deskBounds() {
    var t = Date.now();
    // IMMERSIVE (data-holo-expanded): the canvas is the WHOLE viewport — the rail has slid to a hidden bottom
    // strip, so it is no longer a left inset. Zero the dock/aside insets so the composition centres on the true
    // viewport centre (otherwise a stale --holo-dock-w drifts the greeting + ring right by half the rail width).
    var exp = false; try { exp = DOC.documentElement.hasAttribute("data-holo-expanded"); } catch (e) {}
    if (_db && (t - _dbT) < 120 && _db._vw === innerWidth && _db._vh === innerHeight && _db._exp === exp) return _db;
    var gs = getComputedStyle(DOC.documentElement);
    var dW = exp ? 0 : (parseFloat(gs.getPropertyValue("--holo-dock-w")) || 0);
    var dH = exp ? 0 : (parseFloat(gs.getPropertyValue("--holo-dock-h")) || 0);
    var aW = exp ? 0 : (parseFloat(gs.getPropertyValue("--holo-aside-w")) || 0);   // a right-edge aside carrier (Wallet) squeezes the canvas
    var top = parseFloat(gs.getPropertyValue("--holo-top-inset")) || 0;   // shells with top chrome set this so widgets clear it
    _db = { minX: EDGE + dW, minY: EDGE + top, maxX: innerWidth - EDGE - aW, maxY: innerHeight - EDGE - dH, _vw: innerWidth, _vh: innerHeight, _exp: exp };
    _dbT = t; return _db;
  }
  function clampPos(w, x, y) {
    var b = deskBounds(), ww = w.el.offsetWidth, hh = w.el.offsetHeight;
    return { x: Math.max(b.minX, Math.min(x, Math.max(b.minX, b.maxX - ww))), y: Math.max(b.minY, Math.min(y, Math.max(b.minY, b.maxY - hh))) };
  }
  // A scene tile can never be wider than the canvas it lives in. A desktop-tuned preset declares 340–640px
  // tiles; on a phone the usable canvas (dock/aside/edge-aware) is far narrower, so a fixed tile would run off
  // the right edge and clip (the "greeting cut off on mobile" bug). fitTile caps the width to the canvas and
  // re-seats the tile fully in-bounds. Applied at BOTH seed (addScene) and every re-layout (repositionToMode),
  // so a tile shrinks to fit AND re-grows as the canvas widens — the same motion that keeps the home in
  // proportion when the left nav expands/collapses. On a wide desktop Wu ≥ the tile, so this is a no-op.
  function fitTile(w, x, b) {
    var Wu = Math.max(120, b.maxX - b.minX);
    if (w != null && w > Wu) w = Wu;
    if (w != null && x != null) x = Math.max(b.minX, Math.min(x, b.maxX - w));
    return { w: w, x: x };
  }
  function clampInto(el, left, top) {
    var b = deskBounds(), ww = el.offsetWidth, hh = el.offsetHeight;
    left = Math.max(b.minX, Math.min(left, Math.max(b.minX, b.maxX - ww)));
    top = Math.max(b.minY, Math.min(top, Math.max(b.minY, b.maxY - hh)));
    el.style.left = left + "px"; el.style.top = top + "px"; return { left: left, top: top };
  }

  // ── content address (the holo-native magic): seal a widget — or the whole set — to one κ ───────
  // Uses the substrate's HoloObject sealer when present; falls back to a pure SHA-256 of canonical
  // JSON so the address is real and derivable OFFLINE. Returns a bare hex digest.
  function stableJson(o) {
    if (o === null || typeof o !== "object") return JSON.stringify(o);
    if (Array.isArray(o)) return "[" + o.map(stableJson).join(",") + "]";
    return "{" + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ":" + stableJson(o[k]); }).join(",") + "}";
  }
  function kappaOf(obj) {
    try { if (W.HoloObject && W.HoloObject.address) return Promise.resolve(W.HoloObject.address(obj)).then(hexOf); } catch (e) {}
    try {
      var bytes = new TextEncoder().encode(stableJson(obj));
      return crypto.subtle.digest("SHA-256", bytes).then(function (buf) {
        return [].map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      });
    } catch (e) { return Promise.resolve(""); }
  }
  function hexOf(k) { return String(k || "").replace(/^holo:\/\//i, "").split(":").pop().replace(/^sha256\//i, ""); }
  function clip(text, label) { try { (navigator.clipboard && navigator.clipboard.writeText) ? navigator.clipboard.writeText(text).then(function () { toast(label); }, function () { toast(text); }) : toast(text); } catch (e) { toast(text); } }
  function sealOne(w) { return kappaOf({ "@type": "hosc:Widget", widget: w.type, config: w.config }); }
  function sealAll() { return kappaOf({ "@type": "hosc:WidgetBoard", widgets: live.filter(function (w) { return !w.hidden; }).map(function (w) { return { widget: w.type, x: w.x, y: w.y, w: w.w, h: w.h, config: w.config }; }) }); }

  // ── providers — tiny lazy pub/sub the substrate exposes to widgets (time, weather, stats…) ──────
  function provider(name, factory) { PROVIDERS[name] = factory; }
  function getProvider(name) {
    var f = PROVIDERS[name]; if (!f) return null;
    if (!f._inst) f._inst = f();                                 // lazy singleton — one clock for every clock widget
    return f._inst;
  }
  // built-in: a single shared 1s tick. Subscribers get a Date; the interval only runs while subscribed.
  provider("time", function () {
    var subs = [], timer = 0;
    function fire() { var d = new Date(); subs.forEach(function (fn) { try { fn(d); } catch (e) {} }); }
    function ensure() { if (!timer && subs.length) { fire(); timer = setInterval(fire, 1000); } if (timer && !subs.length) { clearInterval(timer); timer = 0; } }
    return { get: function () { return new Date(); }, subscribe: function (fn) { subs.push(fn); ensure(); try { fn(new Date()); } catch (e) {} return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); ensure(); }; } };
  });

  // ── styles (self-contained) ─────────────────────────────────────────────────────────────
  function injectCss() {
    if (DOC.getElementById("holo-widgets-css")) return;
    var s = DOC.createElement("style"); s.id = "holo-widgets-css";
    s.textContent = [
      ".hw-widget{position:fixed;z-index:62;width:var(--hw-w,260px);touch-action:none;user-select:none;cursor:grab;",
        "color:var(--holo-ink,#f4f6fa);-webkit-tap-highlight-color:transparent;",
        // ONE typeface (the OS face) + the OS readability floor (--holo-font-min, 16px) — every widget inherits both
        "font:var(--holo-weight-light,300) max(var(--holo-font-min,16px),16px)/1.4 var(--holo-font-sans,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif);",
        "text-shadow:0 1px 18px rgba(0,0,0,.5),0 1px 3px rgba(0,0,0,.55);transition:filter .2s}",
      ".hw-widget[hidden]{display:none}",
      ".hw-widget.dragging{cursor:grabbing}",
      // glide — applied only while the canvas reflows (a side panel opening/closing), so every object
      // slides to its new centre-anchored home together. Never on during drag (that sets left/top live).
      ".hw-widget.hw-gliding{transition:left .34s cubic-bezier(.2,.8,.2,1),top .34s cubic-bezier(.2,.8,.2,1)}",
      // the holo-object reveal — invisible at rest (clean text on the wallpaper), a soft glass frame on hover
      ".hw-frame{position:absolute;inset:-12px -16px;border-radius:18px;pointer-events:none;opacity:0;",
        "background:color-mix(in srgb,var(--holo-surface,#11141a) 34%,transparent);",
        "border:1px solid color-mix(in srgb,var(--holo-border,#2a2f3a) 55%,transparent);",
        "backdrop-filter:blur(9px) saturate(1.15);box-shadow:0 20px 54px rgba(0,0,0,.4);transition:opacity .18s ease}",
      ".hw-widget:hover .hw-frame,.hw-widget.resizing .hw-frame,.hw-widget.editing .hw-frame{opacity:1}",
      ".hw-body{position:relative;z-index:1;text-shadow:inherit}",
      ".hw-widget.editing .hw-body{filter:blur(1.5px) brightness(.7);pointer-events:none}",
      // resize grip — bottom-right, revealed on hover, scales the whole object (persists)
      ".hw-grip{position:absolute;right:-8px;bottom:-8px;width:17px;height:17px;border-radius:50%;cursor:nwse-resize;z-index:4;opacity:0;transition:opacity .15s;",
        "background:rgba(10,12,16,.68);box-shadow:inset 0 0 0 1px rgba(255,255,255,.5),0 2px 7px rgba(0,0,0,.55);backdrop-filter:blur(3px)}",
      ".hw-grip::after{content:'';position:absolute;left:50%;top:50%;width:38%;height:38%;transform:translate(-50%,-50%) rotate(45deg);border-right:2px solid #fff;border-bottom:2px solid #fff}",
      ".hw-widget:hover .hw-grip,.hw-widget.resizing .hw-grip{opacity:1}",
      // hover toolbar — edit pencil + a verify badge that re-derives the widget's κ on hover (Law L5)
      ".hw-tools{position:absolute;top:-13px;right:-10px;z-index:5;display:flex;gap:5px;opacity:0;transform:translateY(-2px);transition:opacity .16s,transform .16s}",
      ".hw-widget:hover .hw-tools{opacity:1;transform:none}",
      ".hw-tools button{display:grid;place-items:center;width:24px;height:24px;border:0;border-radius:50%;cursor:pointer;color:#fff;font-size: var(--holo-text-sm, 0.75rem);",
        "background:rgba(10,12,16,.66);box-shadow:inset 0 0 0 1px rgba(255,255,255,.32),0 3px 9px rgba(0,0,0,.5);backdrop-filter:blur(4px);transition:background .14s}",
      ".hw-tools button:hover{background:var(--holo-accent,#3b82f6)}",
      ".hw-tools .ok{background:rgba(16,120,80,.8);box-shadow:inset 0 0 0 1px rgba(120,255,200,.5),0 3px 9px rgba(0,0,0,.5)}",
      // context menu (matches the shell's menu language)
      ".hw-menu{position:fixed;z-index:66;min-width:180px;background:var(--holo-surface,#14161b);border:1px solid var(--holo-border,#23272f);",
        "border-radius:11px;box-shadow:0 16px 44px rgba(0,0,0,.5);padding:5px;font:var(--holo-text-sm, 0.875rem) ui-sans-serif,system-ui,sans-serif;color:var(--holo-ink,#eef2f6)}",
      ".hw-menu button{display:flex;width:100%;align-items:center;gap:9px;background:0;border:0;color:inherit;text-align:left;padding:8px 10px;border-radius:8px;cursor:pointer;font:inherit}",
      ".hw-menu button:hover{background:rgba(255,255,255,.08)} .hw-menu hr{border:0;border-top:1px solid var(--holo-border,#23272f);margin:4px 2px}",
      // inline editor — fields generated from the type's declared schema ("its config is its source")
      ".hw-edit{position:absolute;z-index:6;left:50%;top:50%;transform:translate(-50%,-50%);min-width:230px;max-width:300px;padding:13px 14px 12px;border-radius:14px;",
        "background:color-mix(in srgb,var(--holo-surface,#161922) 94%,transparent);border:1px solid var(--holo-border,#2a2f3a);backdrop-filter:blur(20px) saturate(1.2);",
        "box-shadow:0 24px 60px rgba(0,0,0,.55);color:var(--holo-ink,#eef2f6);font:var(--holo-text-sm, 0.875rem) ui-sans-serif,system-ui,sans-serif;text-shadow:none}",
      ".hw-edit h4{margin:0 0 10px;font-size: var(--holo-text-sm, 0.75rem);letter-spacing:.4px;text-transform:uppercase;color:var(--holo-ink-dim,#9aa3ad);font-weight:700}",
      ".hw-edit label{display:block;margin:0 0 9px;font-size: var(--holo-text-sm, 0.75rem);color:var(--holo-ink-dim,#aeb6c2)}",
      ".hw-edit label>span{display:block;margin-bottom:3px}",
      ".hw-edit input[type=text],.hw-edit textarea,.hw-edit select{width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid var(--holo-border,#2a2f3a);",
        "color:var(--holo-ink,#eef2f6);border-radius:8px;padding:7px 9px;font:var(--holo-text-sm, 0.875rem) inherit}",
      ".hw-edit textarea{resize:vertical;min-height:46px}",
      ".hw-edit input[type=color]{width:34px;height:26px;padding:0;border:1px solid var(--holo-border,#2a2f3a);border-radius:7px;background:none;vertical-align:middle}",
      ".hw-edit .row{display:flex;align-items:center;gap:9px} .hw-edit .row label{flex:1 1 auto;margin-bottom:0}",
      ".hw-edit .ft{display:flex;gap:8px;margin-top:6px}",
      ".hw-edit .ft button{flex:1 1 auto;border:0;border-radius:8px;padding:8px;cursor:pointer;font:600 var(--holo-text-sm, 0.813rem) inherit}",
      ".hw-edit .ft .save{background:var(--holo-accent,#3b82f6);color:#fff} .hw-edit .ft .cancel{background:rgba(255,255,255,.08);color:var(--holo-ink,#eef2f6)}",
      // ── the widget gallery — a beautiful right-click "Add a widget" catalog ─────────────────
      ".hw-gallery-scrim{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:24px;",
        "background:rgba(6,8,12,.5);backdrop-filter:blur(7px);animation:hw-fade .16s ease}",
      "@keyframes hw-fade{from{opacity:0}to{opacity:1}}",
      ".hw-gallery{width:min(640px,94vw);max-height:82vh;display:flex;flex-direction:column;border-radius:20px;overflow:hidden;",
        "background:color-mix(in srgb,var(--holo-surface,#14161b) 94%,transparent);border:1px solid var(--holo-border,#23272f);",
        "box-shadow:0 36px 90px rgba(0,0,0,.6);color:var(--holo-ink,#eef2f6);font:var(--holo-text-sm, 0.875rem) ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;",
        "animation:hw-pop .2s cubic-bezier(.34,1.4,.5,1)}",
      "@keyframes hw-pop{from{transform:scale(.94);opacity:.4}to{transform:scale(1);opacity:1}}",
      ".hw-gal-hd{display:flex;align-items:center;gap:10px;padding:16px 18px 4px}",
      ".hw-gal-hd b{font-size:17px;font-weight:700;flex:1 1 auto} .hw-gal-hd .sub{color:var(--holo-ink-dim,#9aa3ad);font-size: var(--holo-text-sm, 0.781rem);font-weight:400}",
      ".hw-gal-x{background:rgba(255,255,255,.06);border:0;color:var(--holo-ink,#eef2f6);width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:18px;line-height:1;flex:0 0 auto}",
      ".hw-gal-x:hover{background:rgba(255,255,255,.14)}",
      ".hw-gal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:11px;padding:14px 18px 20px;overflow-y:auto}",
      ".hw-gal-card{display:flex;flex-direction:column;align-items:flex-start;gap:7px;text-align:left;padding:15px 14px;border-radius:14px;cursor:pointer;",
        "background:rgba(255,255,255,.035);border:1px solid var(--holo-border,#23272f);color:inherit;font:inherit;transition:transform .14s,background .14s,border-color .14s}",
      ".hw-gal-card:hover{transform:translateY(-3px);background:color-mix(in srgb,var(--holo-accent,#3b82f6) 14%,transparent);border-color:color-mix(in srgb,var(--holo-accent,#3b82f6) 55%,transparent)}",
      ".hw-gal-card holo-icon{font-size:26px;width:1em;height:1em;color:var(--holo-accent,#7aa2ff)}",
      ".hw-gal-card .nm{font-weight:650;font-size: var(--holo-text-sm, 0.906rem)}",
      ".hw-gal-card .bl{font-size: var(--holo-text-sm, 0.75rem);line-height:1.35;color:var(--holo-ink-dim,#9aa3ad)}",
      // selection (shift-click) — a glowing accent frame marks objects chosen for bundling
      ".hw-widget.hw-sel .hw-frame{opacity:1;border-color:var(--holo-accent,#3b82f6);box-shadow:0 0 0 2px color-mix(in srgb,var(--holo-accent,#3b82f6) 65%,transparent),0 20px 54px rgba(0,0,0,.4)}",
      // the floating Bundle bar — appears when ≥2 objects are shift-selected
      ".hw-bundlebar{position:fixed;left:50%;bottom:max(22px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:130;display:flex;align-items:center;gap:6px;padding:6px;border-radius:999px;",
        "background:color-mix(in srgb,var(--holo-surface,#14161b) 88%,transparent);border:1px solid var(--holo-border,#23272f);box-shadow:0 16px 44px rgba(0,0,0,.5);backdrop-filter:blur(10px);animation:hw-pop .18s cubic-bezier(.34,1.4,.5,1)}",
      ".hw-bundlebar .b-go{background:var(--holo-accent,#3b82f6);color:#fff;border:0;border-radius:999px;padding:9px 17px;cursor:pointer;font:600 var(--holo-text-sm, 0.875rem) ui-sans-serif,system-ui,sans-serif}",
      ".hw-bundlebar .b-go:hover{filter:brightness(1.08)}",
      ".hw-bundlebar .b-x{background:rgba(255,255,255,.08);color:var(--holo-ink,#eef2f6);border:0;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;line-height:1}",
      ".hw-bundlebar .b-x:hover{background:rgba(255,255,255,.16)}",
      "@media (prefers-reduced-motion: reduce){.hw-widget *{animation:none!important;transition:none!important} .hw-gallery,.hw-gallery-scrim,.hw-bundlebar{animation:none!important}}",
    ].join("");
    (DOC.head || DOC.documentElement).appendChild(s);
  }

  // ── mount / render ────────────────────────────────────────────────────────────────────────
  function spec(type) { return TYPES[type] || null; }
  function mount(w) {
    injectCss();
    var sp = spec(w.type); if (!sp) return null;
    var root = DOC.createElement("div"); root.className = "hw-widget hw-" + w.type;
    root.style.left = w.x + "px"; root.style.top = w.y + "px";
    if (w.w) root.style.setProperty("--hw-w", w.w + "px");
    if (w.config && w.config.accent) root.style.setProperty("--holo-accent", w.config.accent);
    if (w.hidden) root.setAttribute("hidden", "");
    root.innerHTML =
      '<div class="hw-frame"></div>' +
      '<div class="hw-body"></div>' +
      '<div class="hw-tools"><button class="edit" title="Edit">✎</button><button class="kap" title="Verify — derive this widget’s κ">⛎</button></div>' +
      '<div class="hw-grip" title="drag to resize"></div>';
    DOC.body.appendChild(root);
    w.el = root; w.body = root.querySelector(".hw-body"); w._subs = [];
    render(w);
    wireResize(w); wireInteract(w); wireTools(w);
    root.addEventListener("click", function (e) { if (e.shiftKey) { e.preventDefault(); e.stopPropagation(); selToggle(w); } }, true);   // shift-click selects for bundling
    if (W.interact) wireSnapEngine(w);                                   // interact already loaded → snap from the first frame
    return w;
  }
  function render(w) {
    var sp = spec(w.type); if (!sp || !w.body) return;
    teardown(w);                                                  // drop old provider subscriptions before re-render
    w.body.innerHTML = "";
    try { sp.render(host(w)); } catch (e) { try { console.warn("HoloWidgets render", w.type, e); } catch (x) {} }
  }
  function teardown(w) { (w._subs || []).forEach(function (u) { try { u(); } catch (e) {} }); w._subs = []; }

  // the HOST handle handed to a widget's render() — its whole contract with the runtime
  function host(w) {
    return {
      id: w.id, type: w.type, config: w.config, el: w.el, body: w.body,
      subscribe: function (name, fn) { var p = getProvider(name); if (!p) return function () {}; var u = p.subscribe(fn); w._subs.push(u); return u; },
      get: function (name) { var p = getProvider(name); return p ? p.get() : null; },
      setConfig: function (patch) { for (var k in patch) w.config[k] = patch[k]; applyAccent(w); save(); render(w); },
      save: save, refresh: function () { render(w); },
      state: (w._state || (w._state = {})),                      // transient runtime state (NOT persisted)
      cleanup: function (fn) { if (typeof fn === "function") w._subs.push(fn); },   // run on teardown (re-render/hide/remove) — for rAF loops, timers, watchers
      kappa: function () { return sealOne(w); },
    };
  }
  function applyAccent(w) { if (w.config && w.config.accent) w.el.style.setProperty("--holo-accent", w.config.accent); }

  // ── resize ──────────────────────────────────────────────────────────────────────────────
  function wireResize(w) {
    var grip = w.el.querySelector(".hw-grip"); if (!grip) return;
    var sp = spec(w.type), min = (sp && sp.minW) || 90, max = (sp && sp.maxW) || 760, rz = null;
    grip.addEventListener("pointerdown", function (e) { if (w._snap) return; e.stopPropagation(); e.preventDefault(); rz = { x: e.clientX, w: w.w || w.el.offsetWidth }; w.el.classList.add("resizing"); try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
    grip.addEventListener("pointermove", function (e) { if (!rz) return; w.w = clamp(Math.round(rz.w + (e.clientX - rz.x)), min, max); w.el.style.setProperty("--hw-w", w.w + "px"); });
    grip.addEventListener("pointerup", function (e) { if (!rz) return; rz = null; w.el.classList.remove("resizing"); try { grip.releasePointerCapture(e.pointerId); } catch (x) {} var p = clampPos(w, w.x, w.y); w.x = p.x; w.y = p.y; w.el.style.left = w.x + "px"; w.el.style.top = w.y + "px"; save(); });
  }

  // ── pointer: drag vs single-tap vs double-tap(=edit) · right-click(=menu) ───────────────────
  function wireInteract(w) {
    var down = null, moved = false, lastTap = 0, tapTimer = 0;
    w.el.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      if (w._snap) return;                                                          // interact.js owns drag/tap when the snap engine is active
      if (e.target.closest(".hw-tools,.hw-grip,.hw-edit,.hw-interactive")) return;  // chrome + opted-in widget controls handle their own pointers
      down = { x: e.clientX, y: e.clientY, ox: w.x, oy: w.y }; moved = false;
      try { w.el.setPointerCapture(e.pointerId); } catch (x) {}
    });
    w.el.addEventListener("pointermove", function (e) {
      if (!down) return; var dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!moved && dx * dx + dy * dy > 25) { moved = true; w.el.classList.add("dragging"); showGrid(); }
      if (moved) { var p = clampPos(w, down.ox + dx, down.oy + dy); w.x = p.x; w.y = p.y; w.el.style.left = w.x + "px"; w.el.style.top = w.y + "px"; var gg = guidesFor({ left: w.x, top: w.y, width: w.el.offsetWidth, height: w.el.offsetHeight }, w.el); showGuides(gg.v, gg.h); }
    });
    w.el.addEventListener("pointerup", function (e) {
      if (!down) return; var wasMoved = moved; w.el.classList.remove("dragging"); down = null; if (wasMoved) clearGuides();
      if (wasMoved) { if (w.type === "q") w._userMoved = true; save(); return; }   // dragging the orb opts it out of corner auto-pin
      var sp = spec(w.type), now = Date.now();
      if (now - lastTap < 280) { lastTap = 0; if (tapTimer) { clearTimeout(tapTimer); tapTimer = 0; }   // double → type override, else edit
        if (sp && sp.onDouble) { try { sp.onDouble(host(w)); } catch (x) {} } else openEdit(w); return; }
      lastTap = now; tapTimer = setTimeout(function () { tapTimer = 0; if (sp && sp.onTap) try { sp.onTap(host(w)); } catch (x) {} }, 280);
    });
    w.el.addEventListener("contextmenu", function (e) { e.preventDefault(); openMenu(w, e.clientX, e.clientY); });
  }
  // ── the SNAP ENGINE (interact.js, MIT — vendored at /_shared/interactjs, SW-content-verified) ─────────
  // Seamless, delightful position anchoring for every object on a holospace tab: drag/resize MAGNETICALLY
  // snap to (1) sibling edges + centres (Figma-style alignment), (2) the canvas golden anchors — the φ
  // gridlines 0.382/0.618, the margins, the centre — and (3) a fine pixel grid. Graceful: absent interact
  // (no vendor / offline) → the hand-rolled drag above stays (gated by w._snap), so it always works.
  var SNAP_RANGE = 9, SNAP_GRID = 8;                                     // magnetic radius (px) · fine grid step
  // ── shared snap LINES, scanned from EVERY object on the tab (widgets + app windows + icons) in VIEWPORT
  //    coords + the canvas golden anchors. Cached ~80ms so a 60fps drag does not thrash layout. ──
  var _lc = null, _lcT = 0;
  function objRects() {
    var t = Date.now(); if (_lc && (t - _lcT) < 80) return _lc;
    var rects = [];
    try {
      var els = DOC.querySelectorAll(".hw-widget, holo-window");
      for (var i = 0; i < els.length; i++) { var el = els[i]; if (el.hasAttribute && el.hasAttribute("hidden")) continue; var r = el.getBoundingClientRect(); if (!r.width || !r.height) continue; rects.push({ el: el, l: r.left, cx: r.left + r.width / 2, r: r.right, t: r.top, cy: r.top + r.height / 2, b: r.bottom }); }
    } catch (e) {}
    _lc = rects; _lcT = t; return rects;
  }
  function collectLines(excludeEl) {
    var b = deskBounds(), m = MARGIN(innerWidth, innerHeight), Wu = b.maxX - b.minX, Hu = b.maxY - b.minY;
    var v = [b.minX + m, b.maxX - m, (b.minX + b.maxX) / 2, b.minX + Wu * 0.382, b.minX + Wu * 0.618];   // margins · centre · golden lines
    var h = [b.minY + m, b.maxY - m, (b.minY + b.maxY) / 2, b.minY + Hu * 0.382, b.minY + Hu * 0.618];
    var rs = objRects(); for (var i = 0; i < rs.length; i++) { var o = rs[i]; if (o.el === excludeEl) continue; v.push(o.l, o.cx, o.r); h.push(o.t, o.cy, o.b); }
    return { v: v, h: h };
  }
  function nearestLine(lines, c) { var best = null, bd = SNAP_RANGE + 1; for (var i = 0; i < lines.length; i++) { var d = Math.abs(c - lines[i]); if (d < bd) { bd = d; best = Math.round(lines[i]); } } return best; }

  // ── visual SNAP GUIDE LINES (Figma-style) — drawn while a drag aligns to a line; cleared on drop. ──
  var guideEl = null;
  function guideLayer() { if (guideEl && guideEl.isConnected) return guideEl; guideEl = DOC.createElement("div"); guideEl.id = "hw-guides"; guideEl.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147481000"; DOC.body.appendChild(guideEl); return guideEl; }
  // ── the SNAPPABLE GRID — a faint dot field + the golden anchor lines, shown while ANY object is being
  //    dragged so you SEE where it will land. Fades in on drag-start, out on drop. Shared by every
  //    draggable object (widgets · app windows · icons) since it rides the same show/clear guide calls. ──
  var gridEl = null;
  function gridLayer() { if (gridEl && gridEl.isConnected) return gridEl; gridEl = DOC.createElement("div"); gridEl.id = "hw-grid"; gridEl.style.cssText = "position:fixed;pointer-events:none;z-index:2147480999;opacity:0;transition:opacity .2s ease"; DOC.body.appendChild(gridEl); return gridEl; }
  function showGrid() {
    var g = gridLayer(); if (g._on) return; g._on = true;
    var b = deskBounds(), Wu = b.maxX - b.minX, Hu = b.maxY - b.minY, m = MARGIN(innerWidth, innerHeight), step = SNAP_GRID * 3;   // 24px — a finer, more precise lattice
    g.style.left = b.minX + "px"; g.style.top = b.minY + "px"; g.style.width = Wu + "px"; g.style.height = Hu + "px"; g.style.willChange = "opacity";
    // an ENCLOSED lattice (the holo dot-mark language): thin lines forming cells, with a hollow RING node
    // at every intersection. One static CSS-painted layer → its OWN compositor layer, so it costs nothing
    // per move (the lag was never the grid; it was the per-frame getComputedStyle + guide DOM rebuild).
    var line = "color-mix(in srgb,var(--holo-accent,#5b8cff) 15%,transparent)";
    var node = "color-mix(in srgb,var(--holo-accent,#5b8cff) 52%,transparent)";
    g.style.backgroundImage =
      "radial-gradient(circle at 0 0, transparent 0 1.7px, " + node + " 1.7px 2.6px, transparent 2.7px)," +
      "linear-gradient(0deg, " + line + " 1px, transparent 1px)," +
      "linear-gradient(90deg, " + line + " 1px, transparent 1px)";
    g.style.backgroundSize = step + "px " + step + "px"; g.style.backgroundPosition = "0 0";
    var ln = "", vs = [m, Wu - m, Wu / 2, Wu * 0.382, Wu * 0.618], hs = [m, Hu - m, Hu / 2, Hu * 0.382, Hu * 0.618];
    vs.forEach(function (x) { ln += '<div style="position:absolute;top:0;bottom:0;width:1px;left:' + Math.round(x) + 'px;background:color-mix(in srgb,var(--holo-accent,#3b82f6) 28%,transparent)"></div>'; });
    hs.forEach(function (y) { ln += '<div style="position:absolute;left:0;right:0;height:1px;top:' + Math.round(y) + 'px;background:color-mix(in srgb,var(--holo-accent,#3b82f6) 28%,transparent)"></div>'; });
    g.innerHTML = ln; g.style.opacity = "1";   // set directly (no rAF/timeout — those throttle in a backgrounded tab); the .2s transition still eases on subsequent shows
  }
  function hideGrid() { if (gridEl) { gridEl._on = false; gridEl.style.opacity = "0"; } }
  var _gk = null;   // last drawn guide-line signature — skip the rebuild when nothing changed this frame
  function clearGuides() { if (guideEl) guideEl.innerHTML = ""; _gk = null; hideGrid(); }
  function showGuides(vx, hy) {
    showGrid();
    var key = (vx || []).join(",") + "|" + (hy || []).join(",");
    if (key === _gk) return;            // unchanged since last frame → no DOM work (kills the guide-rebuild jank)
    _gk = key;
    var g = guideLayer(); g.innerHTML = ""; var b = deskBounds();
    var line = "position:absolute;background:var(--holo-accent,#3b82f6);box-shadow:0 0 6px var(--holo-accent,#3b82f6);opacity:.85;border-radius:1px";
    (vx || []).forEach(function (x) { var d = DOC.createElement("div"); d.style.cssText = line + ";top:" + Math.round(b.minY) + "px;height:" + Math.round(b.maxY - b.minY) + "px;left:" + Math.round(x) + "px;width:1px"; g.appendChild(d); });
    (hy || []).forEach(function (y) { var d = DOC.createElement("div"); d.style.cssText = line + ";left:" + Math.round(b.minX) + "px;width:" + Math.round(b.maxX - b.minX) + "px;top:" + Math.round(y) + "px;height:1px"; g.appendChild(d); });
  }
  // which lines a rect's edges/centre sit ON (post-snap) — what to draw as guides.
  function guidesFor(rect, excludeEl) {
    var L = collectLines(excludeEl), TOL = 1.5, vg = [], hg = [];
    var vs = [rect.left, rect.left + rect.width / 2, rect.left + rect.width], hs = [rect.top, rect.top + rect.height / 2, rect.top + rect.height];
    L.v.forEach(function (x) { for (var i = 0; i < vs.length; i++) if (Math.abs(vs[i] - x) <= TOL) { if (vg.indexOf(x) < 0) vg.push(x); break; } });
    L.h.forEach(function (y) { for (var i = 0; i < hs.length; i++) if (Math.abs(hs[i] - y) <= TOL) { if (hg.indexOf(y) < 0) hg.push(y); break; } });
    return { v: vg, h: hg };
  }
  // snap a VIEWPORT rect to the nearest lines (for hand-rolled draggers: app windows + desktop icons).
  // Returns snapped {left,top} + the guide lines it landed on. Pure + defensive — never throws on the caller.
  function snapRect(rect, excludeEl) {
    var L = collectLines(excludeEl);
    var va = [rect.left, rect.left + rect.width / 2, rect.left + rect.width], bestV = null;
    va.forEach(function (c) { var s = nearestLine(L.v, c); if (s != null) { var d = Math.abs(c - s); if (!bestV || d < bestV.d) bestV = { d: d, off: s - c, line: s }; } });
    var ha = [rect.top, rect.top + rect.height / 2, rect.top + rect.height], bestH = null;
    ha.forEach(function (c) { var s = nearestLine(L.h, c); if (s != null) { var d = Math.abs(c - s); if (!bestH || d < bestH.d) bestH = { d: d, off: s - c, line: s }; } });
    return { left: Math.round(rect.left + (bestV ? bestV.off : 0)), top: Math.round(rect.top + (bestH ? bestH.off : 0)), v: bestV ? [bestV.line] : [], h: bestH ? [bestH.line] : [] };
  }
  // the SHARED engine — app windows + desktop icons (shell) snap to the SAME lines + show the SAME guides.
  if (typeof window !== "undefined") W.HoloSnap = { collectLines: collectLines, snapRect: snapRect, guidesFor: guidesFor, showGuides: showGuides, clearGuides: clearGuides, showGrid: showGrid, hideGrid: hideGrid, RANGE: SNAP_RANGE };

  function wireSnapEngine(w) {
    var I = W.interact; if (!I || w._snap || !w.el) return; w._snap = true;
    var sp = spec(w.type), min = (sp && sp.minW) || 90, max = (sp && sp.maxW) || 760;
    var vT = function (x) { var s = nearestLine(collectLines(w.el).v, x); return s == null ? {} : { x: s, range: SNAP_RANGE }; };   // x-only target (vertical line)
    var hT = function (x, y) { var s = nearestLine(collectLines(w.el).h, y); return s == null ? {} : { y: s, range: SNAP_RANGE }; }; // y-only target (horizontal line)
    I(w.el).draggable({
      ignoreFrom: ".hw-tools,.hw-grip,.hw-edit,.hw-interactive",
      listeners: {
        start: function () { w.el.classList.add("dragging"); w._dw = w.el.offsetWidth; w._dh = w.el.offsetHeight; showGrid(); },   // measure ONCE; grid up immediately
        move: function (ev) {
          w.x = Math.round(w.x + ev.dx); w.y = Math.round(w.y + ev.dy);
          var b = deskBounds();   // cached → no getComputedStyle per move; size cached → no offsetWidth read
          w.x = Math.max(b.minX, Math.min(w.x, Math.max(b.minX, b.maxX - w._dw)));
          w.y = Math.max(b.minY, Math.min(w.y, Math.max(b.minY, b.maxY - w._dh)));
          w.el.style.left = w.x + "px"; w.el.style.top = w.y + "px";
          var g = guidesFor({ left: w.x, top: w.y, width: w._dw, height: w._dh }, w.el); showGuides(g.v, g.h);
        },
        end: function () { w.el.classList.remove("dragging"); if (w.type === "q") w._userMoved = true; clearGuides(); save(); },
      },
      modifiers: [
        I.modifiers.snap({ targets: [vT, hT, I.snappers.grid({ x: SNAP_GRID, y: SNAP_GRID })], range: SNAP_RANGE, relativePoints: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }] }),
      ],
      inertia: false,
    });
    I(w.el).resizable({
      edges: { right: ".hw-grip", bottom: ".hw-grip" },
      listeners: {
        start: function () { w.el.classList.add("resizing"); },
        move: function (ev) { w.w = clamp(Math.round(ev.rect.width), min, max); w.el.style.setProperty("--hw-w", w.w + "px"); },
        end: function () { w.el.classList.remove("resizing"); var p = clampPos(w, w.x, w.y); w.x = p.x; w.y = p.y; w.el.style.left = w.x + "px"; w.el.style.top = w.y + "px"; save(); },
      },
      modifiers: [
        I.modifiers.restrictSize({ min: { width: min, height: 1 }, max: { width: max, height: 1e6 } }),
        I.modifiers.snapSize({ targets: [I.snappers.grid({ width: SNAP_GRID, height: SNAP_GRID })], range: SNAP_RANGE }),
      ],
    });
    // tap / double-tap preserved (interact distinguishes tap from drag) — single defers, double cancels it.
    var tapT = 0;
    I(w.el).on("tap", function () { if (tapT) { clearTimeout(tapT); tapT = 0; } tapT = setTimeout(function () { tapT = 0; var s = spec(w.type); if (s && s.onTap) try { s.onTap(host(w)); } catch (x) {} }, 260); });
    I(w.el).on("doubletap", function () { if (tapT) { clearTimeout(tapT); tapT = 0; } var s = spec(w.type); if (s && s.onDouble) { try { s.onDouble(host(w)); } catch (x) {} } else openEdit(w); });
  }
  // load interact.js once (same-origin, SW-verified); on load upgrade every live widget to the snap engine.
  function ensureInteract() {
    if (W.interact) { live.forEach(wireSnapEngine); return; }
    if (DOC.getElementById("holo-interactjs")) return;
    var s = DOC.createElement("script"); s.id = "holo-interactjs"; s.src = "/_shared/interactjs/interact.min.js";
    s.onload = function () { try { live.forEach(wireSnapEngine); } catch (e) {} };
    s.onerror = function () { /* no vendor / offline → the hand-rolled drag stays active (graceful) */ };
    (DOC.head || DOC.documentElement).appendChild(s);
  }

  function wireTools(w) {
    var tools = w.el.querySelector(".hw-tools"); if (!tools) return;
    tools.querySelector(".edit").addEventListener("click", function (e) { e.stopPropagation(); openEdit(w); });
    var kb = tools.querySelector(".kap");
    kb.addEventListener("click", function (e) { e.stopPropagation(); sealOne(w).then(function (k) { clip("holo://" + k, "Copied this widget’s κ"); }); });
    kb.addEventListener("mouseenter", function () { if (kb._v) return; kb._v = 1; sealOne(w).then(function (k) { kb.classList.add("ok"); kb.title = "Verified ✓ · holo://" + k.slice(0, 12) + "…"; }); });
  }

  // ── inline edit — a field panel generated from the type's declared schema ────────────────────
  function openEdit(w) {
    closeEdit(); closeMenu();
    var sp = spec(w.type);
    if (sp && sp.onEdit) { try { sp.onEdit(host(w)); } catch (e) {} return; }   // a type may own its editor (e.g. vinyl → change set)
    var fields = (sp && sp.fields) || [];
    if (!fields.length) { toast("This widget has nothing to edit"); return; }
    w.el.classList.add("editing");
    var panel = DOC.createElement("div"); panel.className = "hw-edit"; panel.id = "hw-edit";
    var draft = {}; for (var k in w.config) draft[k] = w.config[k];
    var rows = ['<h4>' + esc((sp && sp.name) || w.type) + '</h4>'];
    fields.forEach(function (f, i) {
      var v = draft[f.key], id = "hwf" + i;
      if (f.type === "toggle") rows.push('<label class="row"><span style="margin:0">' + esc(f.label) + '</span><input type="checkbox" data-k="' + f.key + '"' + (v ? " checked" : "") + '></label>');
      else if (f.type === "color") rows.push('<label class="row"><span style="margin:0">' + esc(f.label) + '</span><input type="color" data-k="' + f.key + '" value="' + esc(v || "#3b82f6") + '"></label>');
      else if (f.type === "select") rows.push('<label><span>' + esc(f.label) + '</span><select data-k="' + f.key + '">' + (f.options || []).map(function (o) { return '<option value="' + esc(o.value) + '"' + (String(v) === String(o.value) ? " selected" : "") + '>' + esc(o.label) + '</option>'; }).join("") + '</select></label>');
      else if (f.type === "textarea") rows.push('<label><span>' + esc(f.label) + '</span><textarea data-k="' + f.key + '">' + esc(v || "") + '</textarea></label>');
      else rows.push('<label><span>' + esc(f.label) + '</span><input type="text" data-k="' + f.key + '" value="' + esc(v || "") + '"></label>');
    });
    rows.push('<div class="ft"><button class="save">Save</button><button class="cancel">Cancel</button></div>');
    panel.innerHTML = rows.join("");
    w.el.appendChild(panel);
    panel.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    function collect() { panel.querySelectorAll("[data-k]").forEach(function (inp) { var k = inp.getAttribute("data-k"); w.config[k] = inp.type === "checkbox" ? inp.checked : inp.value; }); }
    panel.querySelector(".save").addEventListener("click", function () { collect(); applyAccent(w); save(); render(w); closeEdit(); toast("Widget updated"); });
    panel.querySelector(".cancel").addEventListener("click", closeEdit);
    var first = panel.querySelector("input[type=text],textarea,select"); if (first) setTimeout(function () { try { first.focus(); } catch (e) {} }, 30);
    setTimeout(function () { DOC.addEventListener("pointerdown", outsideEdit, true); }, 0);
  }
  function outsideEdit(e) { var p = DOC.getElementById("hw-edit"); if (p && !p.contains(e.target)) closeEdit(); }
  function closeEdit() { var p = DOC.getElementById("hw-edit"); if (p) { var w = instById(p.closest(".hw-widget")); if (w) w.el.classList.remove("editing"); p.remove(); } DOC.removeEventListener("pointerdown", outsideEdit, true); }
  function instById(el) { for (var i = 0; i < live.length; i++) if (live[i].el === el) return live[i]; return null; }

  // ── context menu ────────────────────────────────────────────────────────────────────────
  function openMenu(w, x, y) {
    closeMenu(); closeEdit();
    var sp = spec(w.type), menu = DOC.createElement("div"); menu.className = "hw-menu"; menu.id = "hw-menu";
    var items = [];
    // a type may contribute its own verbs at the top (e.g. Start/Pause/Reset) — then a separator.
    try { if (sp && sp.menuItems) { sp.menuItems(host(w)).forEach(function (it) { items.push([it.label, it.fn]); }); if (items.length) items.push(["—"]); } } catch (e) {}
    if (w.type === "q" && w._userMoved) { items.push(["⌖  Reset orb to corner", function () { w._userMoved = false; anchorOrb(); scheduleUnglide(); save(); }]); items.push(["—"]); }
    if (SEL.length >= 2) { items.push(["⛓  Bundle " + SEL.length + " selected", groupSelected]); items.push(["—"]); }   // ≥2 shift-selected → fuse into one κ
    items = items.concat([
      ["✎  Edit…", function () { openEdit(w); }],
      ["⛎  Copy widget κ", function () { sealOne(w).then(function (k) { clip("holo://" + k, "Copied this widget’s κ"); }); }],
      ["⌗  Copy whole board κ", function () { sealAll().then(function (k) { clip("holo://" + k, "Copied a link to your whole widget board"); }); }],
      ["⎘  Duplicate", function () { duplicate(w); }],
      ["—"],
      ["⊖  Hide", function () { hide(w); }],
      ["⌫  Remove", function () { remove(w); }],
    ]);
    items.forEach(function (it) {
      if (it[0] === "—") { menu.appendChild(DOC.createElement("hr")); return; }
      var b = DOC.createElement("button"); b.textContent = it[0]; b.onclick = function () { closeMenu(); it[1](); }; menu.appendChild(b);
    });
    DOC.body.appendChild(menu); clampInto(menu, x, y);
    setTimeout(function () { DOC.addEventListener("pointerdown", outsideMenu, true); }, 0);
  }
  function outsideMenu(e) { var m = DOC.getElementById("hw-menu"); if (m && !m.contains(e.target)) closeMenu(); }
  function closeMenu() { var m = DOC.getElementById("hw-menu"); if (m) m.remove(); DOC.removeEventListener("pointerdown", outsideMenu, true); }

  // ── the widget gallery — seamless discovery + one-click add (opened from the desktop right-click) ──
  function closeGallery() { var g = DOC.getElementById("hw-gallery"); if (g) { DOC.removeEventListener("keydown", galleryKey, true); g.remove(); } }
  function galleryKey(e) { if (e.key === "Escape") closeGallery(); }
  function openGallery() {
    injectCss(); closeGallery(); closeMenu();
    var types = Object.keys(TYPES); if (!types.length) { toast("No widgets registered"); return; }
    var scrim = DOC.createElement("div"); scrim.className = "hw-gallery-scrim"; scrim.id = "hw-gallery";
    var panel = DOC.createElement("div"); panel.className = "hw-gallery";
    panel.innerHTML = '<div class="hw-gal-hd"><b>Add a widget</b><span class="sub">' + types.length + ' available</span><button class="hw-gal-x" title="Close (Esc)">×</button></div><div class="hw-gal-grid"></div>';
    var grid = panel.querySelector(".hw-gal-grid");
    types.forEach(function (t) {
      var sp = TYPES[t];
      var card = DOC.createElement("button"); card.className = "hw-gal-card"; card.type = "button"; card.title = "Add " + (sp.name || t);
      card.innerHTML = '<holo-icon set="tabler" name="' + esc(sp.icon || "box") + '"></holo-icon><div class="nm">' + esc(sp.name || t) + '</div><div class="bl">' + esc(sp.blurb || "") + '</div>';
      card.addEventListener("click", function () { closeGallery(); add(t); });
      grid.appendChild(card);
    });
    panel.querySelector(".hw-gal-x").addEventListener("click", closeGallery);
    scrim.addEventListener("pointerdown", function (e) { if (e.target === scrim) closeGallery(); });
    scrim.appendChild(panel); DOC.body.appendChild(scrim);
    DOC.addEventListener("keydown", galleryKey, true);
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────────────────
  function hide(w) { w.hidden = true; if (w.el) w.el.setAttribute("hidden", ""); teardown(w); save(); toast("Widget hidden · add it again from the desktop’s New menu"); }
  function showW(w) { w.hidden = false; if (w.el) { w.el.removeAttribute("hidden"); render(w); try { w.el.animate([{ transform: "scale(.7)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 260, easing: "cubic-bezier(.34,1.4,.5,1)" }); } catch (e) {} } save(); }
  function remove(w) { teardown(w); if (w.el) w.el.remove(); var i = live.indexOf(w); if (i >= 0) live.splice(i, 1); selDrop(w.id); save(); toast("Widget removed"); }
  function duplicate(w) { add(w.type, JSON.parse(JSON.stringify(w.config)), { x: w.x + 24, y: w.y + 24 }); }

  function add(type, config, pos) {
    var sp = spec(type); if (!sp) { toast("Unknown widget: " + type); return null; }
    var hiddenOnes = live.filter(function (w) { return w.hidden && w.type === type; });
    if (!config && !pos && hiddenOnes.length) { hiddenOnes.forEach(showW); return hiddenOnes[0]; }   // restore before spawning
    var w = { id: uid(), type: type, x: 0, y: 0, w: (pos && pos.w) || sp.defaultW || 260, h: 0, hidden: false, config: config || JSON.parse(JSON.stringify(sp.defaultConfig || {})) };
    var n = live.length;
    w.x = (pos && pos.x != null) ? pos.x : Math.max(40, Math.round(innerWidth / 2 - (w.w / 2) + ((n % 3) - 1) * 40));
    w.y = (pos && pos.y != null) ? pos.y : Math.max(40, Math.round(innerHeight * 0.3 + (n % 4) * 30));
    if (!mount(w)) return null;
    live.push(w);
    var p = clampPos(w, w.x, w.y); w.x = p.x; w.y = p.y;
    if (w.type !== "q") { var cp = clearPlace(w.x, w.y, w.el.offsetWidth, w.el.offsetHeight); w.x = cp.x; w.y = cp.y; }   // land clear of any open window (the orb keeps its corner)
    w.el.style.left = w.x + "px"; w.el.style.top = w.y + "px";
    save();
    try { w.el.animate([{ transform: "scale(.7)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 300, easing: "cubic-bezier(.34,1.4,.5,1)" }); } catch (e) {}
    return w;
  }

  // ── bundle / unbundle — fuse ANY on-screen objects into ONE κ object, and split them back ──────────
  function byId(id) { for (var i = 0; i < live.length; i++) if (live[i].id === id) return live[i]; return null; }
  // a lightweight host for a CHILD rendered inside a bundle: its OWN config + transient state, but its
  // provider subscriptions + cleanup ride the GROUP (so they tear down with it). No own drag / edit frame.
  function childHost(groupHost, item, cell) {
    var sp = TYPES[item.type] || {}, cfg = {}, dc = sp.defaultConfig || {}, ic = item.config || {};
    for (var k in dc) cfg[k] = dc[k]; for (var k2 in ic) cfg[k2] = ic[k2];
    item._state = item._state || {};
    return { id: groupHost.id + ":" + item.type, type: item.type, config: cfg, el: groupHost.el, body: cell,
      subscribe: groupHost.subscribe, get: groupHost.get, setConfig: function (p) { for (var k in p) cfg[k] = p[k]; },
      save: groupHost.save, refresh: function () {}, state: item._state, cleanup: groupHost.cleanup, kappa: groupHost.kappa };
  }
  // SELECTION (shift-click) — the on-screen "what to bundle" set; a floating bar offers the action.
  var SEL = [];
  function selToggle(w) { var i = SEL.indexOf(w.id); if (i >= 0) { SEL.splice(i, 1); if (w.el) w.el.classList.remove("hw-sel"); } else { SEL.push(w.id); if (w.el) w.el.classList.add("hw-sel"); } bundleBar(); }
  function selDrop(id) { var i = SEL.indexOf(id); if (i >= 0) { SEL.splice(i, 1); bundleBar(); } }
  function selClear() { SEL.forEach(function (id) { var w = byId(id); if (w && w.el) w.el.classList.remove("hw-sel"); }); SEL = []; bundleBar(); }
  function bundleBar() {
    var bar = DOC.getElementById("hw-bundlebar");
    if (SEL.length < 2) { if (bar) bar.remove(); return; }
    if (!bar) { bar = DOC.createElement("div"); bar.id = "hw-bundlebar"; bar.className = "hw-bundlebar"; DOC.body.appendChild(bar); }
    bar.innerHTML = '<button class="b-go" title="Fuse the selected objects into one κ">⛓ Bundle ' + SEL.length + '</button><button class="b-x" title="Clear selection">×</button>';
    bar.querySelector(".b-go").onclick = groupSelected;
    bar.querySelector(".b-x").onclick = selClear;
  }
  function groupSelected() {
    var ws = SEL.map(byId).filter(Boolean); if (ws.length < 2) { selClear(); return; }
    ws.sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });                 // natural top→bottom stack order
    var minX = Math.min.apply(null, ws.map(function (w) { return w.x; }));
    var minY = Math.min.apply(null, ws.map(function (w) { return w.y; }));
    var gw = Math.max.apply(null, ws.map(function (w) { return w.w || 260; }));
    var items = ws.map(function (w) { return { type: w.type, config: JSON.parse(JSON.stringify(w.config || {})) }; });
    ws.forEach(function (w) { teardown(w); if (w.el) w.el.remove(); var i = live.indexOf(w); if (i >= 0) live.splice(i, 1); });
    SEL = []; bundleBar();
    var g = add("group", { items: items }, { x: minX, y: minY, w: gw });
    if (g) toast("Bundled " + items.length + " objects into one");
  }
  function ungroup(w) {
    var items = (w.config && w.config.items) || [], x = w.x, y = w.y, gw = w.w || 360;
    teardown(w); if (w.el) w.el.remove(); var i = live.indexOf(w); if (i >= 0) live.splice(i, 1);
    var cy = y;
    items.forEach(function (it) {
      var sp = TYPES[it.type] || {}, iw = sp.defaultW || 260;
      var nw = add(it.type, JSON.parse(JSON.stringify(it.config || {})), { x: Math.round(x + (gw - iw) / 2), y: cy });
      cy += ((nw && nw.el && nw.el.offsetHeight) || 140) + 26;
    });
    save(); toast("Unbundled");
  }

  function reflowAll() { live.forEach(function (w) { if (w.el && !w.hidden) { var p = clampPos(w, w.x, w.y); w.x = p.x; w.y = p.y; w.el.style.left = w.x + "px"; w.el.style.top = w.y + "px"; } }); }

  // ── keep widgets clear of app/preview windows (the tiling layer below the widget plane) ────────────
  // A widget should never sit UNDER an open window. We avoid only PERSISTENT windows (holo-window), never
  // transient previews, and never a window that covers the whole canvas (nothing to clear to). Cheap: it
  // reads rects only when asked, and only nudges a widget that is actually overlapped.
  function windowRects() {
    var out = [];
    try { var els = DOC.querySelectorAll("holo-window");
      for (var i = 0; i < els.length; i++) { var el = els[i]; if (el.hasAttribute && el.hasAttribute("hidden")) continue; var r = el.getBoundingClientRect(); if (!r.width || !r.height) continue; out.push(r); }
    } catch (e) {}
    return out;
  }
  function hits(rect, r, pad) { pad = pad || 0; return rect.left < r.right + pad && rect.left + rect.width > r.left - pad && rect.top < r.bottom + pad && rect.top + rect.height > r.top - pad; }
  function hitsAny(rect, rects, pad) { for (var i = 0; i < rects.length; i++) if (hits(rect, rects[i], pad)) return rects[i]; return null; }
  function coversCanvas(r) { var b = deskBounds(); return r.left <= b.minX + 6 && r.top <= b.minY + 6 && r.right >= b.maxX - 6 && r.bottom >= b.maxY - 6; }
  // the nearest CLEAR resting spot for a widget of ww×hh near (x,y): keep it if clear, else walk the golden
  // anchors (φ columns × thirds + margins) and return the first that clears every window. Falls back to (x,y).
  function clearPlace(x, y, ww, hh) {
    var wins = windowRects().filter(function (r) { return !coversCanvas(r); });
    if (!wins.length || !hitsAny({ left: x, top: y, width: ww, height: hh }, wins, 10)) return { x: x, y: y };
    var b = deskBounds(), Wu = b.maxX - b.minX, Hu = b.maxY - b.minY;
    var xs = [b.minX + Wu * 0.382 - ww / 2, (b.minX + b.maxX) / 2 - ww / 2, b.minX + Wu * 0.618 - ww / 2, b.minX + EDGE, b.maxX - ww - EDGE];
    var ys = [b.minY + Hu * 0.30, b.minY + Hu * 0.5 - hh / 2, b.minY + Hu * 0.70 - hh / 2, b.minY + EDGE, b.maxY - hh - EDGE];
    for (var j = 0; j < ys.length; j++) for (var i = 0; i < xs.length; i++) {
      var cx = Math.max(b.minX, Math.min(xs[i], b.maxX - ww)), cy = Math.max(b.minY, Math.min(ys[j], b.maxY - hh));
      if (!hitsAny({ left: cx, top: cy, width: ww, height: hh }, wins, 8)) return { x: Math.round(cx), y: Math.round(cy) };
    }
    return { x: x, y: y };                                          // nowhere clear (windows fill the canvas) — keep, never thrash
  }
  function avoidWindows() {
    var wins = windowRects().filter(function (r) { return !coversCanvas(r); });
    if (!wins.length) return;
    live.forEach(function (w) {
      if (!w.el || w.hidden || w.type === "q") return;              // the orb owns its corner; widgets clear the windows
      var ww = w.el.offsetWidth, hh = w.el.offsetHeight;
      if (!hitsAny({ left: w.x, top: w.y, width: ww, height: hh }, wins, 0)) return;
      var cp = clearPlace(w.x, w.y, ww, hh); if (cp.x === w.x && cp.y === w.y) return;
      w.x = cp.x; w.y = cp.y; w.el.classList.add("hw-gliding"); w.el.style.left = w.x + "px"; w.el.style.top = w.y + "px";
    });
  }

  // ── centre-anchored reflow — keep every floating object fixed RELATIVE TO THE HOLOSPACE CENTRE as the
  //    canvas resizes (a side panel opening narrows the usable width). Shift each by HALF the viewport
  //    delta: the centre moves by exactly that, so the composition tracks it instead of hiding under the
  //    panel — and GLIDES there, so the whole desktop reflows as one. Deltas sum, so it is exact and
  //    reversible across open ⇄ close, and the constant left-rail offset cancels (we shift by Δ, not abs). ──
  var lastVW = W.innerWidth, lastVH = W.innerHeight, glideT = null;
  function scheduleUnglide() { clearTimeout(glideT); glideT = setTimeout(function () { live.forEach(function (w) { w.el && w.el.classList.remove("hw-gliding"); }); }, 360); }
  // pin the Q orb to the bottom-right corner of the desktop (clear of the dock + screen edge), on every reflow.
  function anchorOrb() {
    for (var i = 0; i < live.length; i++) {
      var w = live[i]; if (w.type !== "q" || w.hidden || !w.el) continue;
      if (w._userMoved) continue;                                  // the user placed the orb — leave it (recenter still clamps it into bounds)
      var b = deskBounds(), ww = w.el.offsetWidth || 120, hh = w.el.offsetHeight || 120, gap = 30;
      var gb = parseFloat(getComputedStyle(DOC.documentElement).getPropertyValue("--gap-b")) || 0;   // clear the bottom "Powered by" credit gutter
      w.x = Math.round(b.maxX - ww - gap); w.y = Math.round(b.maxY - hh - gap - gb);
      w.el.classList.add("hw-gliding"); w.el.style.left = w.x + "px"; w.el.style.top = w.y + "px";
    }
  }
  // re-derive the ACTIVE preset mode's golden layout for the CURRENT viewport, and snap each widget to it.
  // This is what makes every mode self-correcting: seeded narrow then shown wide, or any resize, re-lays-out
  // tidily instead of leaving widgets stranded off-centre. Matches scene items to live widgets by type/order.
  function repositionToMode() {
    if (!persistScope) return false;                                // only the home/persisting board carries modes
    var name = currentModeName(), sc = name && SCENES[name];
    if (!sc || !sc.layout) return false;
    var b = deskBounds();
    var items; try { items = sc.layout(W.innerWidth, W.innerHeight, b) || []; } catch (e) { return false; }
    if (!items.length) return false;
    var pools = {};
    live.forEach(function (w) { if (!w.hidden && w.el && w.type !== "q") (pools[w.type] = pools[w.type] || []).push(w); });
    items.forEach(function (it) {
      var pool = pools[it.type]; if (!pool || !pool.length) return;
      var w = pool.shift();
      var f = fitTile(it.w, it.x, b);                                 // same phone-safe cap as seed → tiles never re-widen past the canvas
      if (f.w) { w.w = f.w; w.el.style.setProperty("--hw-w", f.w + "px"); }
      w.x = f.x; w.y = it.y; var p = clampPos(w, w.x, w.y);
      w.el.classList.add("hw-gliding"); w.el.style.left = p.x + "px"; w.el.style.top = p.y + "px";
    });
    return true;
  }
  // re-apply the layout a few times over the first ~1.2s so a board seeded/restored during the shell's boot
  // (when the viewport is briefly narrower) settles to the FINAL size — the cause of off-centre home widgets.
  function settleMode() { var n = 0; (function tick() { var did = repositionToMode(); if (did) { anchorOrb(); save(); } if (++n < 8) setTimeout(tick, 320); })(); }   // ~2.4s window — re-fits as the shell's boot layout settles to its final width
  // the holospace CENTRE accounts for the dock (left) AND an aside carrier (right) — NOT just innerWidth.
  // An in-shell side panel (Wallet/Identity) narrows the canvas via --holo-aside-w WITHOUT changing
  // innerWidth, so we must measure the real usable bounds, else the centre shift is computed as zero and
  // widgets drift relative to the re-centred content. deskBounds() already subtracts dock + aside + top.
  var lastCx = null, lastCy = null;
  function centreOf() { var b = deskBounds(); return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 }; }
  function recenter() {
    var c = centreOf();
    if (lastCx == null) { lastCx = c.cx; lastCy = c.cy; }
    var dx = c.cx - lastCx, dy = c.cy - lastCy;                      // how far the holospace centre moved (dock/aside-aware)
    lastCx = c.cx; lastCy = c.cy; lastVW = W.innerWidth; lastVH = W.innerHeight;
    if (repositionToMode()) { anchorOrb(); avoidWindows(); scheduleUnglide(); save(); return; }   // a preset mode → re-derive its golden layout for the new size
    if (!dx && !dy) { reflowAll(); anchorOrb(); avoidWindows(); return; }   // no centre shift → keep in bounds + re-pin the orb to the corner
    live.forEach(function (w) {
      if (!w.el || w.hidden) return;
      if (w.type === "q" && !w._userMoved) return;                  // an un-moved orb is corner-pinned by anchorOrb, not centre-shifted (the corner moves by the full aside, not half)
      w.x += dx; w.y += dy;                                          // logical, unclamped → open ⇄ close is exactly reversible
      var p = clampPos(w, w.x, w.y);                                 // clamp only the DISPLAY so it never hides under the panel
      w.el.classList.add("hw-gliding"); w.el.style.left = p.x + "px"; w.el.style.top = p.y + "px";
    });
    anchorOrb();                                                    // re-pin the un-moved orb to the (aside-aware) corner; a user-moved orb was shifted + clamped above
    avoidWindows();                                                 // keep widgets clear of any open window after the shift
    scheduleUnglide();                                              // drop the glide once settled (transient VIEW transform, not persisted)
  }

  // ── board swap — the shell hands a DIFFERENT widget set per holospace tab (per-holospace scope) ──
  // Tears down the current live board and mounts `records` in its place (the inverse of snapshot()).
  // opts.persist === false ⇒ this board does NOT touch localStorage: it belongs to a non-home holospace
  // and rides that holospace's κ instead. A pure restore — no save(), no onChange (it isn't a mutation).
  function mountRecord(s) {
    if (!spec(s.type)) return null;                               // type not registered here — skip, keep the record on the shell side
    var w = { id: s.id || uid(), type: s.type, x: s.x, y: s.y, w: s.w, h: s.h, hidden: !!s.hidden, config: s.config || {} };
    w._userMoved = !!s.moved;
    if (!mount(w)) return null;
    live.push(w);
    if (!w.hidden) { var p = clampPos(w, w.x, w.y); w.x = p.x; w.y = p.y; w.el.style.left = w.x + "px"; w.el.style.top = w.y + "px"; }
    return w;
  }
  function setBoard(records, opts) {
    opts = opts || {};
    closeEdit(); closeMenu();
    // KEEP sticky system widgets (the Q orb) mounted across the swap — it is a per-OS affordance that must
    // ride EVERY holospace tab bottom-right, not vanish when the board changes. Only the board widgets swap.
    live.slice().forEach(function (w) { if (isStickyType(w.type)) return; teardown(w); if (w.el) w.el.remove(); });
    live = live.filter(function (w) { return isStickyType(w.type); });
    persistScope = opts.persist !== false;
    (records || []).filter(function (s) { return !isStickyType(s.type); }).forEach(mountRecord);   // never double-mount the preserved orb
    if (persistScope) settleMode();                              // home board (the shell's restore path) → re-fit to the CURRENT viewport so a board saved at a narrower boot size doesn't render off-centre
    anchorOrb();                                                 // re-pin the preserved orb to this tab's corner (unless the user moved it)
    return live.length;
  }
  // A "sticky" widget type (e.g. the Holo Q voice orb) is a SYSTEM affordance: it survives mode switches
  // and is never folded into a mode's saved board, so it isn't duplicated or lost when you change modes.
  function isStickyType(t) { if (t === "q") return true; var sp = spec(t); return !!(sp && sp.sticky); }   // the Q orb is always a system affordance, even before holo-voice registers its spec
  function modeSnapshot() { return serialize().filter(function (s) { return !isStickyType(s.type); }); }

  // ── scenes — a one-click composed arrangement of widgets (the Momentum-style "Focus space") ──────
  // A scene declares only a responsive layout() → [{type,config?,x,y,w}]; each item becomes an ordinary
  // κ-widget, so the whole "enclosed experience" is just widgets you can then move, resize, edit or share.
  var MODE_ORDER = [];                                          // scenes flagged {mode:true}, in registration order — the desktop modes
  function defineScene(name, sp) { SCENES[name] = sp; if (sp && sp.mode && MODE_ORDER.indexOf(name) < 0) MODE_ORDER.push(name); return W.HoloWidgets; }
  function addScene(name, opts) {
    var sc = SCENES[name]; if (!sc) { toast("Unknown scene: " + name); return null; }
    opts = opts || {};
    if (opts.replace) live.slice().forEach(function (w) { remove(w); });
    var b = deskBounds();
    var items = (sc.layout && sc.layout(innerWidth, innerHeight, b)) || [];
    var made = items.map(function (it) {
      var f = fitTile(it.w, it.x, b);                                                      // phone-safe: never wider than the canvas
      return add(it.type, it.config ? JSON.parse(JSON.stringify(it.config)) : null, { x: f.x, y: it.y, w: f.w });
    }).filter(Boolean);
    if (!opts.quiet) toast((sc.name || name) + " · " + made.length + " widgets — drag, resize or edit any of them");
    return made;
  }

  // ── desktop modes — switch the whole board between curated presets (Welcome · Focused · Learn · Work · Play · Clarity). ──
  // A mode is just a scene flagged {mode:true}. Switching REPLACES the board, but each mode REMEMBERS its
  // own layout (per-mode localStorage), so flipping between them is non-destructive — your customised Work
  // board is still there when you come back from Play. Active only on a persisting board (the Home desktop).
  var MODE_LS = "holo-widgets.mode.v6", MODES_LS = "holo-widgets.modeboards.v6", currentMode = null;
  function modeBoardsLoad() { try { return JSON.parse(W.localStorage.getItem(MODES_LS) || "{}"); } catch (e) { return {}; } }
  function modeBoardsSave(m) { try { W.localStorage.setItem(MODES_LS, JSON.stringify(m)); } catch (e) {} }
  function currentModeName() { if (currentMode) return currentMode; try { return W.localStorage.getItem(MODE_LS) || null; } catch (e) { return null; } }
  function modeList() { return MODE_ORDER.map(function (n) { var s = SCENES[n] || {}; return { name: n, label: s.name || n, icon: s.icon || "layout-grid", blurb: s.blurb || "" }; }); }
  function setMode(name) {
    if (!SCENES[name]) { toast("Unknown mode: " + name); return; }
    var prev = currentModeName(), boards = modeBoardsLoad();
    if (persistScope && prev && prev !== name) { boards[prev] = modeSnapshot(); modeBoardsSave(boards); }   // remember the mode we're leaving (minus sticky system widgets)
    if (prev && prev !== name && SCENES[prev] && typeof SCENES[prev].onLeave === "function") { try { SCENES[prev].onLeave(); } catch (e) {} }   // let a special mode (e.g. Clarity) undo its chrome treatment
    currentMode = name;
    try { if (persistScope) W.localStorage.setItem(MODE_LS, name); } catch (e) {}
    try { DOC.documentElement.setAttribute("data-holo-mode", name); } catch (e) {}   // expose the active mode to the shell so its chrome can dress itself (e.g. Clarity glass)
    if (typeof SCENES[name].onEnter === "function") { try { SCENES[name].onEnter(); } catch (e) {} }   // a special mode hook — runs inside this user-gesture call stack (Clarity asks for fullscreen here)
    closeEdit(); closeMenu();
    for (var i = live.length - 1; i >= 0; i--) { if (!isStickyType(live[i].type)) { teardown(live[i]); if (live[i].el) live[i].el.remove(); live.splice(i, 1); } }   // drop the mode widgets, keep system orbs (sticky)
    var saved = persistScope ? boards[name] : null;
    if (saved && saved.length) saved.filter(function (s) { return !isStickyType(s.type); }).forEach(mountRecord);   // restore your customised version of this mode
    else addScene(name, { quiet: true });                                       // first visit → seed the curated preset (on top of the kept sticky widgets)
    if (persistScope) { boards[name] = modeSnapshot(); modeBoardsSave(boards); save(); }
    toast((SCENES[name].name || name) + " mode");
    settleMode();                                                                 // re-lay-out once the viewport settles (boot/transient sizes)
    return name;
  }

  // ── reflow on ANY change to the usable canvas — not just window resize ──────────────────────────
  // A right side-carriage (Wallet · Share · Play · Create · Notify) or the left dock squeezes the canvas
  // via --holo-aside-w / --holo-dock-w WITHOUT firing a window `resize`, so the aside-aware recenter() was
  // never being triggered on open/close — that was the drift. Observe the real #world element instead, and
  // catch the .34s glide's settled end too, so the last frame is exact. ResizeObserver-absent → resize stays.
  // leading-immediate + trailing recenter, coalesced. Deliberately NOT rAF: a side carriage can open while
  // the tab is backgrounded (rAF is throttled then — the shell avoids it for the same reason), and recenter
  // is delta-based so the leading + trailing calls each glide by their share of the centre shift.
  var _reoT = 0;
  function reflowSoon() { if (_reoT) return; recenter(); _reoT = setTimeout(function () { _reoT = 0; recenter(); }, 90); }
  function wireCanvasObserver() {
    var world = DOC.getElementById("world");
    if (!world && (wireCanvasObserver._n = (wireCanvasObserver._n || 0) + 1) < 80) { setTimeout(wireCanvasObserver, 120); return; }   // shell mounts #world async — wait for it
    var target = world || DOC.getElementById("holo-desk") || DOC.documentElement;
    try { if (W.ResizeObserver) new W.ResizeObserver(reflowSoon).observe(target); } catch (e) {}
    try { (world || DOC.documentElement).addEventListener("transitionend", function (ev) { var p = ev.propertyName; if (p === "left" || p === "right" || p === "width") recenter(); }); } catch (e) {}
    // IMMERSIVE toggle (data-holo-expanded) flips the usable canvas from rail-inset to full-bleed WITHOUT a
    // resize or a left/width transition on our target — so recenter never fired and the composition kept the old
    // (off-centre) inset. Watch the attribute directly and re-centre on it. Self-contained here so it holds
    // regardless of which shell hosts the widgets.
    try { if (W.MutationObserver) new W.MutationObserver(reflowSoon).observe(DOC.documentElement, { attributes: true, attributeFilter: ["data-holo-expanded"] }); } catch (e) {}
  }

  // ── boot ────────────────────────────────────────────────────────────────────────────────
  function boot() {
    W.addEventListener("resize", recenter);
    wireCanvasObserver();
    DOC.addEventListener("keydown", function (e) { if (e.key === "Escape" && SEL.length) selClear(); });   // Escape clears a bundling selection
    ensureInteract();                                                    // load the interact.js snap engine (graceful if absent)
    var saved = load();
    saved.forEach(function (s) {
      if (!spec(s.type)) return;                                  // type not registered (yet) — skip, keep the record
      var w = { id: s.id || uid(), type: s.type, x: s.x, y: s.y, w: s.w, h: s.h, hidden: !!s.hidden, config: s.config || {} };
      w._userMoved = !!s.moved;
      if (mount(w)) { live.push(w); if (!w.hidden) { var p = clampPos(w, w.x, w.y); w.x = p.x; w.y = p.y; w.el.style.left = w.x + "px"; w.el.style.top = w.y + "px"; } }
    });
    seedFirstRun(saved);
    try { var cm = currentModeName(); if (cm) DOC.documentElement.setAttribute("data-holo-mode", cm); } catch (e) {}   // reflect the restored mode so the shell re-dresses its chrome after reload (Clarity glass persists; fullscreen needs a fresh gesture)
    if (saved.length) settleMode();                               // a restored board → re-fit it to the CURRENT viewport (heals positions saved at a narrower boot size)
  }
  // first run (no prior board): seed the "Welcome" scene so every NEW user lands on a warm, time-aware
  // greeting over the day-progress ring — the first face of the desktop — rather than an empty surface.
  // (Existing users keep their own board: the guard returns once anything is saved or the seed flag is set.)
  // The desk mounts asynchronously (after its deps load), so wait briefly for it before seeding; never on apps.
  function seedFirstRun(saved) {
    try { if (saved.length || W.localStorage.getItem(SEED_LS) || !SCENES.welcome) return; } catch (e) { return; }
    var tries = 0;
    (function attempt() {
      if (++tries > 60) return;                                    // gave up — no desktop surface present here
      if (!DOC.getElementById("holo-desk") && !DOC.getElementById("world")) { setTimeout(attempt, 120); return; }   // wait for the desktop (holo-desk) OR the shell holospace card (#world)
      try { W.localStorage.setItem(SEED_LS, "1"); setMode("welcome"); } catch (e) {}
    })();
  }

  // ── public API ──────────────────────────────────────────────────────────────────────────
  W.HoloWidgets = {
    define: function (type, sp) { TYPES[type] = sp; return W.HoloWidgets; },
    provider: provider,
    add: add,
    remove: function (id) { var w = live.filter(function (x) { return x.id === id; })[0]; if (w) remove(w); },
    show: function (id) { (id ? live.filter(function (x) { return x.id === id; }) : live.filter(function (x) { return x.hidden; })).forEach(showW); },
    hide: function (id) { var w = live.filter(function (x) { return x.id === id; })[0]; if (w) hide(w); },
    list: function () { return live; }, types: function () { return Object.keys(TYPES); },
    snapshot: serialize,                                         // the persistable board — folded into the holospace κ
    reflow: recenter,                                            // re-centre + re-pin everything to the CURRENT usable canvas (the shell may call this after a carriage opens/closes)
    setBoard: setBoard,                                         // swap the whole board (the shell calls this per holospace tab)
    onChange: function (fn) { if (typeof fn === "function") onChangeFns.push(fn); return W.HoloWidgets; },   // notified after any board mutation — the shell mirrors it into the active tab
    addScene: addScene,                                        // drop a composed arrangement
    defineScene: defineScene,                                  // register a scene preset
    scenes: function () { return Object.keys(SCENES); },
    setMode: setMode,                                          // switch the desktop to a curated mode (remembers each mode's board)
    mode: currentModeName,                                     // the active mode name (or null)
    modes: modeList,                                           // the ordered modes [{name,label,icon,blurb}]
    openGallery: openGallery,                                   // the right-click "Add a widget / space" catalog
    kappa: sealAll,
    // for the desktop "New" menu — one entry per registered type
    menuItems: function () { return Object.keys(TYPES).filter(function (t) { return !TYPES[t].menuHidden; }).map(function (t) { var sp = TYPES[t]; return { icon: sp.icon || "box", label: sp.name || t, fn: function () { add(t); } }; }); },
  };

  // ════ built-in widgets ════════════════════════════════════════════════════════════════════
  // Each is a TYPE registered through the runtime — proof the host generalizes. New widgets live in
  // their own files and call HoloWidgets.define(); these two ship in-box.

  // ── Clock + greeting (provider-driven) ──────────────────────────────────────────────────────
  function greetWord(h) { return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }
  // whoAmI — the operator's chosen name, from the ONE identity chain: the shell's verified HoloIdentity
  // (native desktop), else the session presentation the sovereign sign-in gate persists (serverless — κ +
  // label only, guests excluded), else the non-secret greeting hint from the last ceremony. A default
  // placeholder ("You"/"operator") reads as unnamed → the widget's own "Explorer" fallback applies.
  function whoAmI() {
    var named = function (s) { s = String(s || "").trim(); var l = s.toLowerCase(); return (l && l !== "you" && l !== "operator" && l !== "guest") ? s : ""; };
    try { var h = named(W.HoloIdentity && (W.HoloIdentity.displayName || (W.HoloIdentity.profile && W.HoloIdentity.profile.name))); if (h) return h; } catch (e) {}
    // a live session is AUTHORITATIVE: an explicit guest is never dressed in the device operator's name.
    try { var p = JSON.parse(sessionStorage.getItem("holo.identity") || "null"); if (p) return p.guest ? "" : named(p.label); } catch (e) {}
    try { var o = JSON.parse(localStorage.getItem("holo.lastOperator") || "null"); if (o && named(o.label)) return named(o.label); } catch (e) {}
    return "";
  }
  W.HoloWidgets.define("clock", {
    name: "Clock", icon: "clock", blurb: "The time, with a greeting.", defaultW: 300, minW: 150, maxW: 620,
    defaultConfig: { h24: false, seconds: false, greet: true, name: "" },
    fields: [
      { key: "h24", label: "24-hour time", type: "toggle" },
      { key: "seconds", label: "Show seconds", type: "toggle" },
      { key: "greet", label: "Show greeting", type: "toggle" },
      { key: "name", label: "My name", type: "text" },
    ],
    render: function (host) {
      var c = host.config;
      var wrap = DOC.createElement("div"); wrap.style.cssText = "text-align:center;line-height:1";
      var time = DOC.createElement("div"); time.style.cssText = "font-weight:200;letter-spacing:-.01em;font-size:clamp(40px," + "calc(var(--hw-w,300px)*.30),200px);font-variant-numeric:tabular-nums";
      var hi = DOC.createElement("div"); hi.style.cssText = "margin-top:.38em;font-weight:300;font-size:clamp(16px,calc(var(--hw-w,300px)*.078),36px);opacity:.96";
      wrap.appendChild(time); wrap.appendChild(hi); host.body.appendChild(wrap);
      host.subscribe("time", function (d) {
        var H = d.getHours(), m = String(d.getMinutes()).padStart(2, "0");
        var hh = c.h24 ? String(H).padStart(2, "0") : String(((H % 12) || 12));
        var s = c.seconds ? ":" + String(d.getSeconds()).padStart(2, "0") : "";
        time.textContent = hh + ":" + m + s + (c.h24 ? "" : (H < 12 ? "" : ""));
        if (c.greet) { var nm = (c.name || whoAmI() || "").trim(); hi.style.display = ""; hi.textContent = greetWord(H) + (nm ? ", " + nm : "") + "."; }
        else hi.style.display = "none";
      });
    },
  });

  // ── Day ring — a calm circle that FILLS as the day passes (local time = your time zone). Tap it to
  //    flip the centre between "% of the day" and the local time + date. A standalone, movable object. ──
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function monthDay(d) { return MON[d.getMonth()] + " " + d.getDate(); }
  function hourOpts(a, b) { var o = []; for (var h = a; h <= b; h++) o.push({ value: String(h), label: ((h % 12) || 12) + (h < 12 ? " AM" : " PM") }); return o; }
  W.HoloWidgets.define("dayring", {
    name: "Day ring", icon: "circle-dashed", blurb: "How much of your day has passed by day, how much rest is left by night — tap for the time & date.",
    defaultW: 190, minW: 120, maxW: 460,
    defaultConfig: { h24: true, wake: "7", sleep: "19" },
    fields: [
      { key: "h24", label: "24-hour time", type: "toggle" },
      { key: "wake", label: "Day starts", type: "select", options: hourOpts(4, 11) },
      { key: "sleep", label: "Day ends", type: "select", options: hourOpts(16, 23) },
    ],
    // tap flips %↔time/date via the RUNTIME's tap-vs-drag (NOT an .hw-interactive button) — so grabbing
    // the ring anywhere DRAGS the widget, and a clean tap flips it. (Inside a bundle it just shows %.)
    onTap: function (host) { host.state.showTime = !host.state.showTime; if (host.state._paint) host.state._paint(); },
    render: function (host) {
      var c = host.config, st = host.state;
      if (st.showTime == null) st.showTime = false;                    // default face: % of the day; tap → time + date
      var R = 46, CIRC = 2 * Math.PI * R;
      var ring = DOC.createElement("div");
      ring.style.cssText = "position:relative;width:100%;aspect-ratio:1;display:grid;place-items:center;margin:0 auto;color:inherit";
      ring.innerHTML =
        '<svg viewBox="0 0 100 100" style="width:100%;height:100%;display:block;overflow:visible">' +
          '<circle cx="50" cy="50" r="' + R + '" fill="none" stroke="currentColor" stroke-opacity=".13" stroke-width="3"></circle>' +
          '<circle class="prog" cx="50" cy="50" r="' + R + '" fill="none" stroke="currentColor" stroke-opacity=".55" stroke-width="3" stroke-linecap="round" transform="rotate(-90 50 50)" stroke-dasharray="' + CIRC.toFixed(1) + '" stroke-dashoffset="' + CIRC.toFixed(1) + '" style="transition:stroke-dashoffset .5s ease,stroke-opacity .8s ease"></circle>' +
          '<circle class="orb" cx="50" cy="' + (50 - R) + '" r="3.4" fill="currentColor" style="transition:cx .5s ease,cy .5s ease,r .8s ease,opacity .8s ease"></circle>' +
        '</svg>' +
        '<div class="lab" style="position:absolute;text-align:center;line-height:1.05;pointer-events:none">' +
          '<div class="big" style="font-weight:200;font-variant-numeric:tabular-nums;letter-spacing:-.01em;font-size:clamp(22px,calc(var(--hw-w,190px)*.2),60px)"></div>' +
          '<div class="sub" style="margin-top:.5em;font-size:clamp(12px,calc(var(--hw-w,190px)*.074),18px);letter-spacing:.06em;opacity:.6"></div>' +
        '</div>';
      host.body.appendChild(ring);
      var prog = ring.querySelector(".prog"), orb = ring.querySelector(".orb"), big = ring.querySelector(".big"), sub = ring.querySelector(".sub");
      function hr(v, def) { v = parseInt(v, 10); return isNaN(v) ? def : Math.max(0, Math.min(23, v)); }
      function paint(d) {
        d = d || new Date();                                           // local → the user's own time zone
        var H = d.getHours(), mins = H * 60 + d.getMinutes() + d.getSeconds() / 60;
        var wM = hr(c.wake, 7) * 60, sM = hr(c.sleep, 19) * 60; if (sM <= wM) sM = wM + 60;   // guard a positive day
        var isDay = mins >= wM && mins < sM, frac;                     // "your day" = the waking window; the rest is night
        if (isDay) frac = (mins - wM) / (sM - wM);                     // 7am→7pm fills toward dusk
        else { var into = mins >= sM ? mins - sM : mins + (1440 - sM); frac = into / (1440 - (sM - wM)); } // dusk→dawn fills toward sunrise
        frac = Math.max(0, Math.min(1, frac));
        prog.setAttribute("stroke-dashoffset", (CIRC * (1 - frac)).toFixed(1));
        prog.setAttribute("stroke-opacity", isDay ? ".55" : ".3");     // the night ring rests a shade dimmer
        var a = (-90 + frac * 360) * Math.PI / 180;                    // an orb rides the leading edge — sun by day, moon by night
        orb.setAttribute("cx", (50 + R * Math.cos(a)).toFixed(2)); orb.setAttribute("cy", (50 + R * Math.sin(a)).toFixed(2));
        orb.setAttribute("r", isDay ? "3.6" : "2.8"); orb.style.opacity = isDay ? "1" : ".7";
        ring.style.color = isDay ? "" : "#9db4d6";                     // a cool, calm tint settles over the night face
        if (st.showTime) { var hh = c.h24 ? String(H).padStart(2, "0") : String(((H % 12) || 12)); big.textContent = hh + ":" + String(d.getMinutes()).padStart(2, "0"); sub.textContent = monthDay(d); }
        else { big.textContent = Math.round(frac * 100) + "%"; sub.textContent = isDay ? "of your day" : "of the night"; }
      }
      st._paint = paint; host.subscribe("time", paint); paint();
    },
  });

  // ── Greeting — a warm, time-aware line ("Good evening, Explorer.") in the user's local time zone; the
  //    name is yours (HoloIdentity), or "Explorer" for a guest. A standalone, movable, resizable object. ──
  W.HoloWidgets.define("greeting", {
    name: "Greeting", icon: "message", blurb: "A time-aware greeting, by name (or “Explorer” as a guest).",
    defaultW: 560, minW: 240, maxW: 920,
    defaultConfig: { name: "" },
    fields: [{ key: "name", label: "My name", type: "text" }],
    render: function (host) {
      var c = host.config;
      var hi = DOC.createElement("div");
      hi.style.cssText = "text-align:center;font-weight:300;letter-spacing:-.012em;font-size:clamp(26px,calc(var(--hw-w,560px)*.092),64px);line-height:1.1;opacity:.97";
      host.body.appendChild(hi);
      host.subscribe("time", function (d) {
        d = d || new Date();
        var nm = (c.name || whoAmI() || "Explorer").trim();
        hi.textContent = greetWord(d.getHours()) + ", " + nm + ".";
      });
    },
  });

  // ── Bundle (group) — two or more on-screen objects fused into ONE κ-addressed object you move, resize
  //    and share TOGETHER. Shift-click objects to select, then "Bundle"; right-click a bundle → "Unbundle"
  //    to split them back into independent widgets. Children stack, centred, on a golden-ratio rhythm. ──
  W.HoloWidgets.define("group", {
    name: "Bundle", icon: "stack-2", blurb: "Several objects bundled into one — move, resize and share as one κ.",
    defaultW: 380, minW: 160, maxW: 900,
    defaultConfig: { items: [] },
    menuItems: function (h) { return [{ label: "⛓  Unbundle", fn: function () { var w = byId(h.id); if (w) ungroup(w); } }]; },
    render: function (host) {
      var items = (host.config && host.config.items) || [];
      var col = DOC.createElement("div");
      col.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:clamp(16px,calc(var(--hw-w,380px)*.075),48px);text-align:center";
      items.forEach(function (it) {
        var sp = TYPES[it.type]; if (!sp || !sp.render) return;
        var cell = DOC.createElement("div"); cell.style.cssText = "width:100%"; col.appendChild(cell);
        try { sp.render(childHost(host, it, cell)); } catch (e) {}
      });
      host.body.appendChild(col);
    },
  });

  // ── Note / intention (static, editable in place) ──────────────────────────────────────────────
  W.HoloWidgets.define("note", {
    name: "Note", icon: "note", blurb: "A line of text or a daily intention.", defaultW: 360, minW: 160, maxW: 640,
    defaultConfig: { text: "What matters most today?", accent: "#ffffff", rule: true },
    fields: [
      { key: "text", label: "Text", type: "textarea" },
      { key: "rule", label: "Underline", type: "toggle" },
      { key: "accent", label: "Colour", type: "color" },
    ],
    render: function (host) {
      var c = host.config;
      var p = DOC.createElement("div");
      p.style.cssText = "text-align:center;font-weight:300;font-size:clamp(17px,calc(var(--hw-w,360px)*.075),32px);color:" + (c.accent || "#fff");
      p.textContent = c.text || "";
      host.body.appendChild(p);
      if (c.rule) { var r = DOC.createElement("div"); r.style.cssText = "height:1px;margin:.9em auto 0;width:min(70%,420px);background:linear-gradient(90deg,transparent,rgba(255,255,255,.6),transparent)"; host.body.appendChild(r); }
    },
  });

  // ── Focus timer (interactive + stateful) — tap to start/pause, a draining ring counts you down ──
  // The first widget that proves the host's interactive surface: a type-owned tap (start/pause), a
  // type-owned double-tap (reset), type-contributed menu verbs, and transient runtime state in
  // host.state (the countdown never touches localStorage — only the chosen length persists).
  function fmtMMSS(s) { s = Math.max(0, Math.round(s)); var m = Math.floor(s / 60); return m + ":" + String(s % 60).padStart(2, "0"); }
  W.HoloWidgets.define("focus", {
    name: "Focus", icon: "timer", blurb: "A tap-to-start focus countdown.", defaultW: 240, minW: 160, maxW: 460,
    defaultConfig: { minutes: 25 },   // no accent ⇒ inherits the ONE theme accent (--holo-accent)
    fields: [
      { key: "minutes", label: "Length (minutes)", type: "select", options: [{ value: "5", label: "5 min" }, { value: "10", label: "10 min" }, { value: "15", label: "15 min" }, { value: "25", label: "25 min" }, { value: "45", label: "45 min" }, { value: "60", label: "60 min" }] },
      { key: "accent", label: "Colour", type: "color" },
    ],
    render: function (host) {
      var c = host.config, st = host.state, total = (parseInt(c.minutes, 10) || 25) * 60;
      if (st.remaining == null || !st.running) { st.remaining = total; }          // edits/mounts reset a stopped timer
      st.total = total;
      var R = 46, CIRC = 2 * Math.PI * R;
      var wrap = DOC.createElement("div"); wrap.style.cssText = "position:relative;width:100%;aspect-ratio:1;display:grid;place-items:center";
      wrap.innerHTML =
        '<svg viewBox="0 0 100 100" style="width:100%;height:100%;display:block;filter:drop-shadow(0 4px 14px rgba(0,0,0,.4))">' +
          '<circle cx="50" cy="50" r="' + R + '" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="5"></circle>' +
          '<circle class="prog" cx="50" cy="50" r="' + R + '" fill="none" stroke="var(--holo-accent,#3b82f6)" stroke-width="5" stroke-linecap="round" transform="rotate(-90 50 50)" stroke-dasharray="' + CIRC.toFixed(1) + '" stroke-dashoffset="0" style="transition:stroke-dashoffset .35s linear"></circle>' +
        '</svg>' +
        '<div class="lab" style="position:absolute;text-align:center;line-height:1.1">' +
          '<div class="t" style="font-weight:250;font-variant-numeric:tabular-nums;font-size:clamp(24px,calc(var(--hw-w,240px)*.17),64px)"></div>' +
          '<div class="s" style="margin-top:.42em;font-size:clamp(13px,calc(var(--hw-w,240px)*.062),16px);letter-spacing:.1em;text-transform:uppercase;opacity:.8"></div>' +
        '</div>';
      host.body.appendChild(wrap);
      var prog = wrap.querySelector(".prog"), tEl = wrap.querySelector(".t"), sEl = wrap.querySelector(".s");
      function paint() {
        var rem = st.remaining, frac = st.total ? rem / st.total : 0;
        prog.setAttribute("stroke-dashoffset", (CIRC * (1 - frac)).toFixed(1));
        tEl.textContent = fmtMMSS(rem);
        sEl.textContent = rem <= 0 ? "done" : st.running ? "focusing" : "tap to focus";
        host.el.classList.toggle("hw-focus-run", !!st.running);
      }
      st._paint = paint; paint();
      host.subscribe("time", function () {
        if (!st.running) return;
        st.remaining = Math.max(0, Math.round((st.endAt - Date.now()) / 1000));
        if (st.remaining <= 0) { st.running = false; try { host.el.animate([{ filter: "brightness(1.6)" }, { filter: "brightness(1)" }], { duration: 700 }); } catch (e) {} }
        paint();
      });
    },
    onTap: function (host) {
      var st = host.state;
      if (st.running) { st.running = false; }                                     // pause — keep remaining
      else { if (st.remaining <= 0) st.remaining = st.total; st.endAt = Date.now() + st.remaining * 1000; st.running = true; }
      if (st._paint) st._paint();
    },
    onDouble: function (host) { var st = host.state; st.running = false; st.remaining = st.total; if (st._paint) st._paint(); },
    menuItems: function (host) {
      var st = host.state;
      return [
        [st.running ? "❚❚  Pause" : "▶  Start", function () { W.HoloWidgets && void 0; (TYPES.focus.onTap)(host); }],
        ["↺  Reset", function () { (TYPES.focus.onDouble)(host); }],
      ].map(function (p) { return { label: p[0], fn: p[1] }; });
    },
  });

  // ── Weather (host-proxied) — a user-typed city, current temperature + sky glyph (Momentum-style) ──
  // The first widget backed by a host PROXY: it asks the shell host's /weather route (which talks to
  // open-meteo server-side from a USER-TYPED city — never device GPS). On static hosting the route is
  // absent, so it degrades to "offline". Result is cached 15 min per place; a coarse tick refreshes it.
  var wxCache = {};
  function fetchWeather(place, unit) {
    var key = place + "|" + (unit || "C"), hit = wxCache[key], now = Date.now();
    if (hit && (now - hit.t) < 9e5) return Promise.resolve(hit.v);
    return fetch("/weather?q=" + encodeURIComponent(place) + "&unit=" + (unit || "C").toLowerCase(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.ok) wxCache[key] = { t: now, v: j }; return j; });
  }
  // WMO weather codes → a Tabler icon name (the shell's native icon set, offline + themed)
  function wmoIcon(code, day) {
    if (code <= 1) return day ? "sun" : "moon";                  // clear / mainly clear
    if (code === 2) return day ? "cloud" : "moon";               // partly cloudy
    if (code === 3) return "cloud";                              // overcast
    if (code === 45 || code === 48) return "cloud-fog";
    if (code >= 51 && code <= 57) return "cloud-drizzle";
    if (code >= 61 && code <= 67) return "cloud-rain";
    if (code >= 71 && code <= 77) return "cloud-snow";
    if (code >= 80 && code <= 82) return "cloud-rain";
    if (code >= 85 && code <= 86) return "cloud-snow";
    if (code >= 95) return "cloud-storm";
    return "cloud";
  }
  W.HoloWidgets.define("weather", {
    name: "Weather", icon: "cloud", blurb: "Current weather for a city you set.", defaultW: 260, minW: 150, maxW: 460,
    defaultConfig: { place: "", unit: "C" },
    fields: [
      { key: "place", label: "City", type: "text" },
      { key: "unit", label: "Units", type: "select", options: [{ value: "C", label: "Celsius" }, { value: "F", label: "Fahrenheit" }] },
    ],
    render: function (host) {
      var c = host.config;
      var wrap = DOC.createElement("div"); wrap.style.cssText = "text-align:center;line-height:1.05";
      var row = DOC.createElement("div"); row.style.cssText = "display:flex;align-items:center;justify-content:center;gap:.28em";
      var ic = DOC.createElement("holo-icon"); ic.setAttribute("set", "tabler"); ic.setAttribute("name", c.place ? "cloud" : "map-pin");
      ic.style.cssText = "width:.9em;height:.9em;font-size:clamp(22px,calc(var(--hw-w,260px)*.17),54px);opacity:.95";
      var temp = DOC.createElement("div"); temp.style.cssText = "font-weight:250;font-variant-numeric:tabular-nums;font-size:clamp(28px,calc(var(--hw-w,260px)*.21),66px)";
      temp.textContent = c.place ? "·" : "";
      row.appendChild(ic); row.appendChild(temp);
      var place = DOC.createElement("div"); place.style.cssText = "margin-top:.34em;font-size:clamp(14px,calc(var(--hw-w,260px)*.062),22px);opacity:.86";
      place.textContent = c.place || "Double-tap to set a city";
      wrap.appendChild(row); wrap.appendChild(place); host.body.appendChild(wrap);
      if (!c.place) { temp.textContent = ""; return; }
      fetchWeather(c.place, c.unit).then(function (w) {
        if (!w || !w.ok) { temp.textContent = "—"; place.textContent = c.place + " · offline"; return; }
        temp.textContent = w.temp + "°"; place.textContent = w.place || c.place;
        ic.setAttribute("name", wmoIcon(w.code, w.day !== false));
      }).catch(function () { temp.textContent = "—"; place.textContent = c.place + " · offline"; });
      host.subscribe("time", function (d) { if (d.getSeconds() === 0 && d.getMinutes() % 15 === 0) host.refresh(); });   // coarse refresh
    },
  });

  // ── Tasks — an interactive checklist (tick · type to add · × to remove); the title is the drag handle ──
  // Proves an INTERACTIVE in-body widget: its list + input carry .hw-interactive so the host's drag
  // ignores them, while their native clicks/typing drive the list. Items persist in config (so they
  // also fold into the widget κ); edits mutate config in place + host.save() — no full re-render churn.
  // Tasks share a single OPFS file in the user's Home, so the list is NOT siloed — a Tasks app or any
  // other surface reads/writes the same /home/user/.tasks.json. Falls back to config (localStorage) when
  // the filesystem isn't available (static host / no HoloFiles), and always mirrors to config for the κ.
  var TASKS_PATH = "/home/user/.tasks.json";
  function tasksLoad() {
    var F = W.HoloFiles; if (!F || !F.read) return Promise.resolve(null);
    return Promise.resolve(F.read({ source: "opfs", path: TASKS_PATH, name: ".tasks.json", mime: "application/json" }))
      .then(function (r) { try { var o = JSON.parse(new TextDecoder().decode(r.bytes)); return Array.isArray(o.items) ? o.items : []; } catch (e) { return []; } })
      .catch(function () { return null; });                       // missing file ⇒ first run, keep config
  }
  function tasksSave(items) {
    var F = W.HoloFiles; if (!F || !F.writeFile) return Promise.resolve(false);
    return Promise.resolve(F.writeFile(TASKS_PATH, JSON.stringify({ "@type": "hosc:TaskList", items: items }, null, 2))).then(function () { return true; }).catch(function () { return false; });
  }
  W.HoloWidgets.define("tasks", {
    name: "Tasks", icon: "checklist", blurb: "A shared checklist over your Home.", defaultW: 300, minW: 180, maxW: 520,
    defaultConfig: { title: "Tasks", items: [] },
    fields: [{ key: "title", label: "Title", type: "text" }],
    render: function (host) {
      var c = host.config; if (!Array.isArray(c.items)) c.items = [];
      function persistTasks() { host.save(); tasksSave(c.items); }   // OPFS (shared) + config mirror (κ / offline)
      var wrap = DOC.createElement("div"); wrap.style.cssText = "min-width:180px";
      var h = DOC.createElement("div"); h.textContent = c.title || "Tasks";
      h.style.cssText = "font-weight:550;font-size:clamp(14px,calc(var(--hw-w,300px)*.058),22px);margin-bottom:.55em;opacity:.96";
      var list = DOC.createElement("div"); list.className = "hw-interactive"; list.style.cssText = "display:flex;flex-direction:column";
      function rebuildList() { list.innerHTML = ""; c.items.forEach(function (it) { list.appendChild(row(it)); }); }
      function row(item) {
        var r = DOC.createElement("div"); r.style.cssText = "display:flex;align-items:center;gap:.55em;padding:.24em 0;cursor:pointer;font-size:clamp(15px,calc(var(--hw-w,300px)*.052),19px)";
        var box = DOC.createElement("span"); box.style.cssText = "flex:0 0 auto;width:1.05em;height:1.05em;border-radius:50%;border:1.5px solid currentColor;display:grid;place-items:center;transition:.15s";
        var t = DOC.createElement("span"); t.textContent = item.t; t.style.cssText = "flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        var x = DOC.createElement("button"); x.textContent = "×"; x.title = "remove"; x.style.cssText = "flex:0 0 auto;background:none;border:0;color:inherit;opacity:0;cursor:pointer;font-size:1.15em;line-height:1;padding:0 2px";
        function paint() {
          if (item.done) { box.style.background = "var(--holo-accent,#3b82f6)"; box.style.borderColor = "var(--holo-accent,#3b82f6)"; box.innerHTML = '<svg viewBox="0 0 24 24" width="70%" height="70%" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4.5 4.5L19 7"/></svg>'; t.style.textDecoration = "line-through"; t.style.opacity = ".5"; }
          else { box.style.background = "none"; box.style.borderColor = "currentColor"; box.innerHTML = ""; t.style.textDecoration = "none"; t.style.opacity = "1"; }
        }
        paint();
        r.addEventListener("click", function () { item.done = !item.done; paint(); persistTasks(); });
        r.addEventListener("mouseenter", function () { x.style.opacity = ".6"; });
        r.addEventListener("mouseleave", function () { x.style.opacity = "0"; });
        x.addEventListener("click", function (e) { e.stopPropagation(); var i = c.items.indexOf(item); if (i >= 0) c.items.splice(i, 1); persistTasks(); r.remove(); });
        r.appendChild(box); r.appendChild(t); r.appendChild(x); return r;
      }
      rebuildList();
      var add = DOC.createElement("input"); add.className = "hw-interactive"; add.type = "text"; add.placeholder = "+ add a task";
      add.style.cssText = "margin-top:.6em;width:100%;box-sizing:border-box;background:rgba(255,255,255,.08);border:0;border-radius:8px;padding:.5em .7em;color:inherit;font:inherit;font-size:clamp(14px,calc(var(--hw-w,300px)*.048),17px)";
      add.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      add.addEventListener("keydown", function (e) { if (e.key === "Enter") { var v = (add.value || "").trim(); if (v) { var it = { t: v, done: false }; c.items.push(it); add.value = ""; persistTasks(); list.appendChild(row(it)); } } });
      wrap.appendChild(h); wrap.appendChild(list); wrap.appendChild(add); host.body.appendChild(wrap);
      tasksLoad().then(function (items) { if (items) { c.items = items; rebuildList(); host.save(); } });   // shared Home file is the source of truth when present
    },
  });

  // ── System — a live monitor: FPS (rAF) + JS heap + cores/RAM + GPU adapter. Uses host.cleanup ──────
  W.HoloWidgets.define("system", {
    name: "System", icon: "cpu", blurb: "Live FPS, memory & device.", defaultW: 280, minW: 180, maxW: 480,
    defaultConfig: {},
    render: function (host) {
      var wrap = DOC.createElement("div"); wrap.style.cssText = "min-width:170px;font-variant-numeric:tabular-nums";
      var top = DOC.createElement("div"); top.style.cssText = "display:flex;align-items:baseline;gap:.4em";
      var fpsN = DOC.createElement("div"); fpsN.style.cssText = "font-weight:300;font-size:clamp(28px,calc(var(--hw-w,280px)*.16),52px)"; fpsN.textContent = "—";
      var fpsL = DOC.createElement("div"); fpsL.style.cssText = "opacity:.65;font-size:clamp(13px,calc(var(--hw-w,280px)*.05),15px);letter-spacing:.1em;text-transform:uppercase"; fpsL.textContent = "fps";
      top.appendChild(fpsN); top.appendChild(fpsL);
      var NS = "http://www.w3.org/2000/svg";
      var spark = DOC.createElementNS(NS, "svg"); spark.setAttribute("viewBox", "0 0 100 26"); spark.setAttribute("preserveAspectRatio", "none"); spark.style.cssText = "width:100%;height:26px;display:block;margin:.25em 0 .55em";
      var poly = DOC.createElementNS(NS, "polyline"); poly.setAttribute("fill", "none"); poly.setAttribute("stroke", "var(--holo-accent,#3b82f6)"); poly.setAttribute("stroke-width", "1.6"); poly.setAttribute("stroke-linejoin", "round"); poly.setAttribute("stroke-linecap", "round"); spark.appendChild(poly);
      function statRow(label) { var r = DOC.createElement("div"); r.style.cssText = "display:flex;justify-content:space-between;gap:.6em;font-size:clamp(14px,calc(var(--hw-w,280px)*.048),16px);padding:.16em 0"; var a = DOC.createElement("span"); a.style.opacity = ".7"; a.textContent = label; var b = DOC.createElement("span"); b.style.cssText = "font-weight:600;text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"; r.appendChild(a); r.appendChild(b); return { row: r, val: b }; }
      var heap = statRow("Memory"), cores = statRow("Cores"), gpu = statRow("GPU");
      wrap.appendChild(top); wrap.appendChild(spark); wrap.appendChild(heap.row); wrap.appendChild(cores.row); wrap.appendChild(gpu.row); host.body.appendChild(wrap);
      cores.val.textContent = (navigator.hardwareConcurrency || "?") + (navigator.deviceMemory ? " · " + navigator.deviceMemory + " GB" : "");
      try {
        if (navigator.gpu && navigator.gpu.requestAdapter) navigator.gpu.requestAdapter().then(function (a) { if (!a) { gpu.val.textContent = "—"; return; } var info = a.info || {}; gpu.val.textContent = info.description || info.architecture || info.vendor || "WebGPU"; }).catch(function () { gpu.val.textContent = "—"; });
        else gpu.val.textContent = "no WebGPU";
      } catch (e) { gpu.val.textContent = "—"; }
      var raf = 0, frames = 0, last = performance.now(), hist = [];
      function paint() {
        poly.setAttribute("points", hist.map(function (v, i) { return (i * (100 / Math.max(1, hist.length - 1))).toFixed(1) + "," + (26 - Math.min(26, v / 60 * 26)).toFixed(1); }).join(" "));
        if (performance.memory) heap.val.textContent = Math.round(performance.memory.usedJSHeapSize / 1048576) + " / " + Math.round(performance.memory.jsHeapSizeLimit / 1048576) + " MB"; else heap.val.textContent = "—";
      }
      function loop(t) { frames++; var dt = t - last; if (dt >= 500) { var fps = Math.round(frames * 1000 / dt); frames = 0; last = t; fpsN.textContent = fps; hist.push(fps); if (hist.length > 50) hist.shift(); paint(); } raf = requestAnimationFrame(loop); }
      raf = requestAnimationFrame(loop);
      host.cleanup(function () { if (raf) cancelAnimationFrame(raf); });
    },
  });

  // ── Calendar — the current month, today marked; ‹ › to flip months ───────────────────────────────
  W.HoloWidgets.define("calendar", {
    name: "Calendar", icon: "calendar", blurb: "The month, with today marked.", defaultW: 300, minW: 200, maxW: 520,
    defaultConfig: {},
    render: function (host) {
      var st = host.state; if (st.offset == null) st.offset = 0;
      var now = new Date(), base = new Date(now.getFullYear(), now.getMonth() + st.offset, 1);
      var wrap = DOC.createElement("div"); wrap.style.cssText = "min-width:200px";
      var hd = DOC.createElement("div"); hd.style.cssText = "display:flex;align-items:center;gap:.4em;margin-bottom:.5em";
      var title = DOC.createElement("div"); title.style.cssText = "flex:1 1 auto;font-weight:600;font-size:clamp(14px,calc(var(--hw-w,300px)*.058),21px)";
      title.textContent = base.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      function navBtn(txt, d) { var b = DOC.createElement("button"); b.className = "hw-interactive"; b.textContent = txt; b.style.cssText = "background:rgba(255,255,255,.08);border:0;color:inherit;width:1.7em;height:1.7em;border-radius:7px;cursor:pointer;font:inherit;line-height:1"; b.addEventListener("pointerdown", function (e) { e.stopPropagation(); }); b.addEventListener("click", function () { st.offset += d; host.refresh(); }); return b; }
      hd.appendChild(navBtn("‹", -1)); hd.appendChild(title); hd.appendChild(navBtn("›", 1));
      var grid = DOC.createElement("div"); grid.style.cssText = "display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center;font-size:clamp(13px,calc(var(--hw-w,300px)*.044),15px)";
      ["S", "M", "T", "W", "T", "F", "S"].forEach(function (d) { var c = DOC.createElement("div"); c.textContent = d; c.style.cssText = "opacity:.5;font-weight:600;padding:.25em 0"; grid.appendChild(c); });
      var firstDow = base.getDay(), dim = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate(), isThisMonth = st.offset === 0;
      for (var i = 0; i < firstDow; i++) grid.appendChild(DOC.createElement("div"));
      for (var day = 1; day <= dim; day++) {
        var cell = DOC.createElement("div"); cell.textContent = day; cell.style.cssText = "padding:.3em 0;border-radius:50%;aspect-ratio:1;display:grid;place-items:center";
        if (isThisMonth && day === now.getDate()) { cell.style.background = "var(--holo-accent,#3b82f6)"; cell.style.color = "#fff"; cell.style.fontWeight = "700"; }
        grid.appendChild(cell);
      }
      wrap.appendChild(hd); wrap.appendChild(grid); host.body.appendChild(wrap);
      host.subscribe("time", function (d) { if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) host.refresh(); });
    },
  });

  // ── Links — quick-launch tiles (favicon + label) from a 'Name | URL' list; click opens in a new tab ──
  W.HoloWidgets.define("links", {
    name: "Links", icon: "link", blurb: "Quick-launch tiles for your sites.", defaultW: 320, minW: 180, maxW: 560,
    defaultConfig: { title: "Links", raw: "" },
    fields: [{ key: "title", label: "Title", type: "text" }, { key: "raw", label: "Links — one 'Name | https://url' per line", type: "textarea" }],
    render: function (host) {
      var c = host.config, wrap = DOC.createElement("div"); wrap.style.cssText = "min-width:170px";
      if (c.title) { var hh = DOC.createElement("div"); hh.textContent = c.title; hh.style.cssText = "font-weight:550;font-size:clamp(15px,calc(var(--hw-w,320px)*.05),20px);margin-bottom:.55em;opacity:.96"; wrap.appendChild(hh); }
      var items = (c.raw || "").split("\n").map(function (l) {
        l = l.trim(); if (!l) return null; var i = l.indexOf("|"), name, url;
        if (i >= 0) { name = l.slice(0, i).trim(); url = l.slice(i + 1).trim(); } else { url = l; name = l.replace(/^https?:\/\//, "").split("/")[0]; }
        if (!/^https?:\/\//.test(url)) url = "https://" + url; return { name: name || url, url: url };
      }).filter(Boolean);
      if (!items.length) { var hint = DOC.createElement("div"); hint.style.cssText = "opacity:.65;font-size:clamp(14px,calc(var(--hw-w,320px)*.046),16px)"; hint.textContent = "Double-tap to add links"; wrap.appendChild(hint); host.body.appendChild(wrap); return; }
      var grid = DOC.createElement("div"); grid.className = "hw-interactive"; grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(66px,1fr));gap:.5em";
      items.forEach(function (it) {
        var a = DOC.createElement("button"); a.type = "button"; a.title = it.url; a.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:.35em;background:rgba(255,255,255,.05);border:1px solid var(--holo-border,#2a2f3a);border-radius:11px;padding:.6em .3em;cursor:pointer;color:inherit;font:inherit;transition:background .14s";
        var ico = DOC.createElement("img"); ico.alt = ""; var origin = ""; try { origin = new URL(it.url).origin; } catch (e) {}
        ico.src = origin ? origin + "/favicon.ico" : ""; ico.style.cssText = "width:22px;height:22px;border-radius:5px;object-fit:contain";
        ico.addEventListener("error", function () { var f = DOC.createElement("holo-icon"); f.setAttribute("set", "tabler"); f.setAttribute("name", "world"); f.style.cssText = "font-size:22px;width:1em;height:1em;opacity:.8"; if (ico.parentNode) ico.replaceWith(f); });
        var nm = DOC.createElement("div"); nm.textContent = it.name; nm.style.cssText = "font-size:clamp(12px,calc(var(--hw-w,320px)*.038),14px);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        a.appendChild(ico); a.appendChild(nm);
        a.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
        a.addEventListener("mouseenter", function () { a.style.background = "color-mix(in srgb,var(--holo-accent,#3b82f6) 18%,transparent)"; });
        a.addEventListener("mouseleave", function () { a.style.background = "rgba(255,255,255,.05)"; });
        a.addEventListener("click", function () { try { W.open(it.url, "_blank", "noopener"); } catch (e) {} });
        grid.appendChild(a);
      });
      wrap.appendChild(grid); host.body.appendChild(wrap);
    },
  });

  // ── Quote — a daily line to think on (offline, deterministic by day; editable in place) ──────────
  // Like the Momentum quote: a calm italic line over the wallpaper. Rotates once per day from a bundled
  // set (no network), or you can pin your own. The very heart of the "enclosed" focus experience.
  var QUOTES = [
    { t: "Remember that wherever your heart is, there you will find your treasure.", a: "Paulo Coelho" },
    { t: "We suffer more often in imagination than in reality.", a: "Seneca" },
    { t: "You have power over your mind — not outside events. Realize this, and you will find strength.", a: "Marcus Aurelius" },
    { t: "The first principle is that you must not fool yourself — and you are the easiest person to fool.", a: "Richard Feynman" },
    { t: "Simplicity is the ultimate sophistication.", a: "Leonardo da Vinci" },
    { t: "Less, but better.", a: "Dieter Rams" },
    { t: "It is not that we have a short time to live, but that we waste a lot of it.", a: "Seneca" },
    { t: "Knowing yourself is the beginning of all wisdom.", a: "Aristotle" },
    { t: "What we do now echoes in eternity.", a: "Marcus Aurelius" },
    { t: "The obstacle is the way.", a: "Marcus Aurelius" },
    { t: "Quality is not an act, it is a habit.", a: "Aristotle" },
    { t: "He who has a why to live can bear almost any how.", a: "Friedrich Nietzsche" },
    { t: "Waste no more time arguing about what a good person should be. Be one.", a: "Marcus Aurelius" },
    { t: "The unexamined life is not worth living.", a: "Socrates" },
  ];
  function quoteOfDay() { var day; try { day = Math.floor(Date.now() / 864e5); } catch (e) { day = 0; } return QUOTES[((day % QUOTES.length) + QUOTES.length) % QUOTES.length]; }
  W.HoloWidgets.define("quote", {
    name: "Quote", icon: "quote", blurb: "A daily line to think on.", defaultW: 440, minW: 200, maxW: 700,
    defaultConfig: { text: "", author: "" },                      // empty text ⇒ the daily rotation
    fields: [
      { key: "text", label: "Your own quote (blank = a daily one)", type: "textarea" },
      { key: "author", label: "Author", type: "text" },
    ],
    render: function (host) {
      var c = host.config, own = (c.text || "").trim();
      var q = own ? { t: own, a: c.author || "" } : quoteOfDay();
      var wrap = DOC.createElement("div"); wrap.style.cssText = "text-align:center";
      var p = DOC.createElement("div"); p.style.cssText = "font-style:italic;font-weight:300;font-size:clamp(17px,calc(var(--hw-w,440px)*.056),28px);line-height:1.45";
      p.textContent = "“" + (q.t || "") + "”";
      wrap.appendChild(p);
      if (q.a) { var a = DOC.createElement("div"); a.style.cssText = "margin-top:.7em;font-size:clamp(13px,calc(var(--hw-w,440px)*.034),15px);letter-spacing:.12em;text-transform:uppercase;opacity:.72"; a.textContent = "— " + q.a; wrap.appendChild(a); }
      host.body.appendChild(wrap);
      host.subscribe("time", function (d) { if (!own && d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) host.refresh(); });   // roll at midnight
    },
  });

  // ── Desktop modes — five curated presets the whole board switches between, one right-click away. ─────
  // Welcome · Learn · Work · Play · Focus — that exact order. Each is a Momentum-style "enclosed experience"
  // tuned to an intent; every piece stays an independent,
  // editable, movable κ-widget. Switching a mode REPLACES the board but each mode remembers its own layout.
  // ── ONE golden-ratio margin system for every scene — a single, consistent, sufficient edge gap, and a
  //    φ-stepped vertical rhythm, so every composition is evenly inset and proportioned (no ad-hoc offsets).
  var PHI = 1.618;
  function MARGIN(W_, H_) { return Math.round(clamp(Math.min(W_, H_) * (1 / (PHI * PHI * PHI)) * 0.62, 32, 80)); }   // ≈ a φ-scaled, clamped breathing margin
  function HX(b, m) { return Math.round((b.minX || 0) + (m != null ? m : 44)); }   // left column x (clear of the dock), one margin in
  function RX(W_, w, m) { return Math.round(W_ - (m != null ? m : 44) - w); }      // right-aligned x, same margin from the right
  function CX(W_, w) { var b = deskBounds(); return Math.round((b.minX + b.maxX) / 2 - w / 2); }   // centred on the CANVAS centre (dock + aside aware), not the raw viewport
  // golden vertical placement inside the usable height [top..bottom]: f∈[0,1] eased onto the φ rhythm.
  // The two GOLDEN BANDS (a tile's TOP) are GY(.,0.382)=upper golden line and GY(.,0.618)=lower — the real
  // golden cuts that replace the former ad-hoc fractions; the header band sits at the margin (GY 0).
  function GY(top, H_, m, f) { var a = top + m, b = H_ - m; return Math.round(a + (b - a) * f); }
  var PHI_INV = 0.618;                                                              // 1/φ — the golden cut
  // golden HORIZONTAL focal placement: centre a tile of width w on the golden gridline f∈{0.382,0.618} of
  // the usable width (dock + aside aware) — the focal point, never dead-centre.
  function GPX(b, w, f) { var a = (b.minX || 0), z = (b.maxX || innerWidth); return Math.round(a + (z - a) * f - w / 2); }
  // φ width ladder from ONE hero width: hero : secondary : header = φ² : φ¹ : φ⁰ (each the prior ÷ φ), so
  // every tile shares one golden progression and the primary:secondary split is φ:1 (≈1.618:1).
  function LAD(hero) { var sec = Math.round(hero / PHI), head = Math.round(sec / PHI); return { hero: hero, sec: sec, head: head }; }

  // ── ONE balanced composition shared by the three intent modes (Learn · Work · Play): a φ-scaled HERO
  //    held at the CENTRE, and one calm widget in each CORNER. The sticky Q orb always rides the
  //    bottom-right corner (anchorOrb), so a mode fills only three corners (top-left, top-right,
  //    bottom-left) + the centre — and the orb completes the fourth. Switching modes swaps only WHICH
  //    widgets fill this same frame, so every mode reads as the same well-ordered, symmetric space.
  //    Sizes ride the golden ladder: each corner = secondary width, the centre hero = secondary × φ
  //    (≈ φ:1), so the focal piece is exactly one golden step larger than its four satellites.
  function GRID5(W_, H_, b, heroW) {
    var m = MARGIN(W_, H_), top = (b.minY || 0), cw = LAD(heroW).sec;
    return {
      m: m, cw: cw, heroW: heroW,
      tl:  { w: cw,    x: HX(b, m),       y: GY(top, H_, m, 0) },       // top-left corner
      tr:  { w: cw,    x: RX(W_, cw, m),  y: GY(top, H_, m, 0) },       // top-right corner
      bl:  { w: cw,    x: HX(b, m),       y: GY(top, H_, m, 0.70) },    // bottom-left corner
      mid: { w: heroW, x: CX(W_, heroW),  y: GY(top, H_, m, 0.40) },    // centre hero (top set so its mass centres)
    };                                                                   // bottom-right corner is held by the sticky Q orb
  }

  // ── launch — a crisp, φ-proportioned APP tile (Files · Code · Wallet · Ask Q): one tap opens the real
  //    holospace through the shell's own launcher (window.HoloShell) or summons Q. The only "app" surface
  //    on the calm board — no iframe, no mockup, it just opens the live app. ──
  function openTarget(c) {
    try {
      var S = W.HoloShell;
      if (c.app === "q") { if (W.Q && W.Q.summon) return W.Q.summon(); if (S && S.q) return S.q(); }
      if (S) {
        var map = { files: "files", forge: "tools", code: "tools", control: "settings", settings: "settings", docs: "resources", apps: "apps", home: "home", search: "search" };
        if (c.app && map[c.app] && typeof S[map[c.app]] === "function") return S[map[c.app]]();
        if (c.appId && typeof S.openApp === "function") return S.openApp(c.appId, c.label);
      }
      if (c.url) W.open(c.url, "_blank", "noopener");
    } catch (e) {}
  }
  W.HoloWidgets.define("launch", {
    name: "Launcher", icon: "rocket", blurb: "Open a holospace app in one tap.",
    defaultW: 128, minW: 96, maxW: 240,
    defaultConfig: { label: "Open", icon: "rocket", appId: "", app: "" },
    fields: [{ key: "label", label: "Label", type: "text" }, { key: "icon", label: "Icon (tabler name)", type: "text" }, { key: "appId", label: "App id (org.hologram.…)", type: "text" }],
    render: function (host) {
      var c = host.config, btn = DOC.createElement("button"); btn.type = "button"; btn.className = "hw-interactive";
      btn.title = "Open " + (c.label || "app");
      btn.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:.5em;width:100%;background:rgba(255,255,255,.05);border:1px solid var(--holo-border,#2a2f3a);border-radius:14px;padding:.95em .6em;cursor:pointer;color:inherit;font:inherit;transition:background .14s,transform .14s";
      var ic = DOC.createElement("holo-icon"); ic.setAttribute("set", "tabler"); ic.setAttribute("name", c.icon || "rocket"); ic.style.cssText = "font-size:clamp(24px,calc(var(--hw-w,128px)*.22),36px);width:1em;height:1em;opacity:.95";
      var nm = DOC.createElement("div"); nm.textContent = c.label || "Open"; nm.style.cssText = "font-size:max(var(--holo-font-min,16px),clamp(16px,calc(var(--hw-w,128px)*.12),18px));font-weight:550;letter-spacing:.01em";
      btn.appendChild(ic); btn.appendChild(nm);
      btn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      btn.addEventListener("mouseenter", function () { btn.style.background = "color-mix(in srgb,var(--holo-accent,#3b82f6) 20%,transparent)"; btn.style.transform = "translateY(-1px)"; });
      btn.addEventListener("mouseleave", function () { btn.style.background = "rgba(255,255,255,.05)"; btn.style.transform = "none"; });
      btn.addEventListener("click", function () { openTarget(c); });
      host.body.appendChild(btn);
    },
  });

  // Welcome — the first face of the desktop: a calm, time-aware greeting centred over a ring that fills
  // as the day passes. Tap the ring to flip to the local time and date. Defined FIRST so it leads the
  // desktop-modes list. One centred pair; the Q orb stays (sticky).
  W.HoloWidgets.defineScene("welcome", {
    name: "Welcome", icon: "sparkles", mode: true,
    blurb: "A warm welcome: a greeting in your time zone, over a ring that shows how much of the day has passed.",
    layout: function (W_, H_, b) {
      var m = MARGIN(W_, H_), top = (b.minY || 0);
      var Wu = Math.max(120, b.maxX - b.minX);                                 // the REAL usable canvas width (rail/aside-aware)
      var Hu = Math.max(120, (b.maxY || H_) - top);
      var ringW, greetW;
      if (Wu < 520) {
        // NARROW / SQUEEZED canvas (phone, or a pane squeezed by the rail/an aside): ONE ratio-locked composition.
        // The greeting spans the usable canvas and the ring is ALWAYS 46% of it — so squeezing the canvas scales the
        // WHOLE pair uniformly and keeps it centred, instead of the two clamping independently and drifting apart.
        greetW = Math.round(clamp(Math.min(Wu * 0.92, Hu * 0.72), 200, 500));
        ringW  = Math.round(greetW * 0.46);
      } else {
        // WIDE canvas (desktop): the original golden composition, unchanged.
        ringW  = Math.round(clamp(Math.min(W_, H_) * 0.22, 150, 250));
        greetW = Math.round(clamp(Math.min(W_, H_) * 0.62, 340, 640));
      }
      var gap = Math.round(ringW * 0.3);                                       // a tighter gap → greeting sits a little higher
      // greeting height for CENTERING: the name line can wrap to two lines on a phone, so estimate ~1.5 lines of
      // its width-derived type (font ≈ greetW*0.092, line-height 1.1). Under-counting here let the pair drift low.
      var total = ringW + gap + Math.round(greetW * 0.15);                     // ring (≈square) + gap + greeting block
      var lift = Math.round((H_ - top) * 0.06);                                // nudge the pair slightly above true centre
      var startY = Math.round(top + Math.max(m, ((H_ - top) - total) / 2 - lift)); // centre the pair, lifted a touch higher
      return [
        { type: "dayring",  config: {}, w: ringW,  x: CX(W_, ringW),  y: startY },
        { type: "greeting", config: {}, w: greetW, x: CX(W_, greetW), y: startY + ringW + gap },
      ];
    },
  });

  // Learn — a study space on the shared centre+corners grammar: the reading/notes surface is the HERO at
  // the centre; the clock anchors the top-left, your resources the top-right, a sprint timer the
  // bottom-left. The sticky Q orb sits bottom-right as your copilot — so there's no separate "Ask Q" tile
  // to duplicate it. Reading + thinking, distinct from Work's productivity set.
  W.HoloWidgets.defineScene("learn", {
    name: "Learn", icon: "school", mode: true,
    blurb: "Study: a reading/notes surface at the centre, the time, your resources, a sprint timer — Q as copilot.",
    layout: function (W_, H_, b) {
      var g = GRID5(W_, H_, b, 420);
      return [
        { type: "note",  config: { text: "What are you learning today?", rule: true }, w: g.mid.w, x: g.mid.x, y: g.mid.y },
        { type: "clock", config: { greet: false }, w: g.tl.w, x: g.tl.x, y: g.tl.y },
        { type: "links", config: { title: "Resources" }, w: g.tr.w, x: g.tr.x, y: g.tr.y },
        { type: "focus", config: { minutes: 25 }, w: g.bl.w, x: g.bl.x, y: g.bl.y },
      ];
    },
  });

  // Work — your day on the shared centre+corners grammar: the to-do is the HERO at the centre; the clock
  // (with greeting) anchors the top-left, the month's schedule the top-right, the weather the bottom-left.
  // The sticky Q orb holds the bottom-right. A focused productivity board — the live apps stay one tap
  // away in the dock, so they no longer crowd the surface as a row of tiles.
  W.HoloWidgets.defineScene("work", {
    name: "Work", icon: "briefcase", mode: true,
    blurb: "Your day: the to-do at the centre, the time, the month, the weather — Q a tap away.",
    layout: function (W_, H_, b) {
      var g = GRID5(W_, H_, b, 420);
      return [
        { type: "tasks",    config: { title: "To-do" }, w: g.mid.w, x: g.mid.x, y: g.mid.y },
        { type: "clock",    config: { greet: true }, w: g.tl.w, x: g.tl.x, y: g.tl.y },
        { type: "calendar", config: {}, w: g.tr.w, x: g.tr.x, y: g.tr.y },
        { type: "weather",  config: { place: "" }, w: g.bl.w, x: g.bl.x, y: g.bl.y },
      ];
    },
  });

  // Play — wind down on the shared centre+corners grammar: the disc is the HERO UP FRONT at the centre;
  // the clock anchors the top-left, a thought (quote) the top-right, what's playing the bottom-left. The
  // sticky Q orb holds the bottom-right. The disc, what's playing, the time, a thought — relaxed and roomy.
  W.HoloWidgets.defineScene("play", {
    name: "Play", icon: "player-play", mode: true,
    blurb: "Wind down: the disc up front at the centre, the time, a thought, what's playing.",
    layout: function (W_, H_, b) {
      var g = GRID5(W_, H_, b, 372);                                     // a touch smaller hero so the square disc breathes
      return [
        { type: "vinyl",       w: g.mid.w, x: g.mid.x, y: g.mid.y },
        { type: "clock",       config: { greet: true }, w: g.tl.w, x: g.tl.x, y: g.tl.y },
        { type: "quote",       config: { text: "" }, w: g.tr.w, x: g.tr.x, y: g.tr.y },
        { type: "now-playing", config: {}, w: g.bl.w, x: g.bl.x, y: g.bl.y },
      ];
    },
  });

  // Focus — deep work, on the SAME centre+corners grammar as Learn · Work · Play, so the whole set reads as
  // one family: the tap-to-start countdown is the HERO at the centre; the clock anchors the top-left, your
  // single intention the top-right, a grounding thought the bottom-left. The sticky Q orb holds the
  // bottom-right. A touch smaller hero so the square ring breathes (like Play's disc). Entering focus also
  // stamps :root[data-holo-mode="focus"], and the shell dresses its OWN chrome down to faint glass — the
  // bars recede, the dock dims, a soft vignette and a slow breath bring the calm alive — so nothing competes
  // with the one thing in front of you. The chrome styling lives with the chrome (shell.html); here we own
  // only the board. (No forced fullscreen: the mode stays a predictable, one-tap board you can leave freely.)
  W.HoloWidgets.defineScene("focus", {
    name: "Focus", icon: "target", mode: true,
    blurb: "Deep work: a tap-to-start countdown at the centre, the time, your one intention, a grounding thought — the chrome recedes to glass.",
    layout: function (W_, H_, b) {
      var g = GRID5(W_, H_, b, 380);                                    // a touch smaller hero so the square ring breathes
      return [
        { type: "focus", config: { minutes: 25 }, w: g.mid.w, x: g.mid.x, y: g.mid.y },
        { type: "clock", config: { greet: false }, w: g.tl.w, x: g.tl.x, y: g.tl.y },
        { type: "note",  config: { text: "One thing. Nothing else.", rule: true }, w: g.tr.w, x: g.tr.x, y: g.tr.y },
        { type: "quote", config: { text: "" }, w: g.bl.w, x: g.bl.x, y: g.bl.y },
      ];
    },
  });

  if (DOC.readyState === "loading") DOC.addEventListener("DOMContentLoaded", boot); else boot();
})();
