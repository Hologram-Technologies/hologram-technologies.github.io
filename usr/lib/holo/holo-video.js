// holo-video.js — Holo Video: a small, beautiful EMBEDDED video player window for the Hologram OS
// desktop. A clean glass pane that floats on the top shell plane (so playback survives any app frame),
// drags anywhere, resizes from its corner, and blooms into a fully immersive full-screen on a tap.
//
//   • opens       → ALWAYS a golden picture-in-picture in the bottom-left (φ proportions, φ corner gap)
//   • the look    → a frosted glass frame on the Hologram theme; the picture fills it edge-to-edge
//   • controls    → only the essentials, shown on hover and faded once the mouse leaves: play · scrub
//                   · time · mute+volume · expand. Audio is ON by default.
//   • move        → drag the top glass bar anywhere on the desktop (clamped clear of the dock rail)
//   • resize      → the corner grip (free above the φ minimum)
//   • hide        → minimize folds it into a corner peek (still playing); tap to pop back
//   • immerse     → ⤢ (or F / double-tap) → native full screen; ⤢ again / Esc returns to the window
//   • the dock    → a "Video" tile lives in the left rail (pinned right after the music disc)
//
// Pure DOM + the platform <video> element — no framework, no CDN (Law L4). Drop-in (AFTER holo-dock.js
// is fine; the dock retries its pin): <script src="_shared/holo-video.js" defer></script>
(function () {
  "use strict";
  var W = window, DOC = document;
  if (W.HoloVideo) return;
  try { if (W.top !== W.self) return; } catch (e) { return; }     // top shell only — so video survives app frames

  var VIDEO_ID = "holo.video";                                    // the dock pin id (shared with holo-dock.js)
  var PIN_LS = "holo-video.dockpin.v1";                           // one-time pin guard (respects a later removal)
  // The pinned demo reel is a YouTube video, played through YouTube's OWN HTML5 IFrame player. This is the
  // ONE path that works EVERYWHERE — the static Holo bundle (github.io, no /sc backend), a mounted mirror,
  // and the desktop — instantly, for first-time users, at full adaptive quality (up to the display: 1080p/4K
  // where available, with real audio). No yt-dlp, no server mux. The player lives INSIDE our glass frame:
  // drag · resize · immerse · minimise · close stay ours; YouTube supplies the picture, transport, and the
  // quality ladder. open(src) overrides it — a YouTube URL/id → this path; any other URL → the <video> path.
  var YT_DEFAULT_ID = "AOCQp6lAfEE";
  var DEFAULT_SRC = "https://www.youtube.com/watch?v=" + YT_DEFAULT_ID;
  // Offline / network-failure fallback — a complete progressive MP4 served same-origin (has audio). Used for
  // the native <video> path, and if YouTube itself can't load (blocked / offline) the reel folds to it.
  var FALLBACK_SRC = "/apps/video/video/big-buck-bunny-360p.mp4";
  var MIN_W = 240, MIN_H = 150, EDGE = 8;
  var PHI = 1.618;                                                 // φ — the whole window obeys the golden ratio (size · shape · corner gap)
  var GAP = Math.round(13 * PHI);                                  // ~21px — a golden margin off the desktop corner

  // ── one shared MEDIA STAGE ────────────────────────────────────────────────────────────────
  // Music and Video are two CONTENTS of a SINGLE on-screen window slot: opening one suspends the
  // other (pausing its audio → never a clash) and reuses its geometry so they swap in place. The
  // first of holo-video / holo-vinyl to load creates it; both share it. (Mirrored in holo-vinyl.js.)
  function mediaStage() {
    if (W.HoloMediaStage) return W.HoloMediaStage;
    var S = { active: null, geom: null, _h: {} };
    S.register = function (kind, suspendFn) { S._h[kind] = suspendFn; };
    S.getGeom = function () { return S.geom; };
    S.setGeom = function (g) { if (g && g.width > 0 && g.height > 0) S.geom = { left: g.left, top: g.top, width: g.width, height: g.height }; };
    S.claim = function (kind) {                                    // take the slot → suspend every OTHER medium
      for (var k in S._h) { if (k !== kind && typeof S._h[k] === "function") { try { S._h[k](); } catch (e) {} } }
      S.active = kind;
    };
    return (W.HoloMediaStage = S);
  }

  // ── glyphs (uniform stroked line icons, on theme with the rail) ───────────────────────────
  var I = {
    play:  '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none"/></svg>',
    vol:   '<svg viewBox="0 0 24 24"><path d="M5 9h3l5-4v14l-5-4H5z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>',
    mute:  '<svg viewBox="0 0 24 24"><path d="M5 9h3l5-4v14l-5-4H5z"/><path d="m17 9 4 6M21 9l-4 6"/></svg>',
    enter: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    exit:  '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
    min:   '<svg viewBox="0 0 24 24"><path d="M20 9V5h-4M16 5l-6 6M5 14l4 4M9 18v-4M9 14H5"/></svg>',
    pop:   '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>'
  };

  // ── styles (self-contained, theme-aware) ──────────────────────────────────────────────────
  function injectCss() {
    if (DOC.getElementById("holo-video-css")) return;
    var s = DOC.createElement("style"); s.id = "holo-video-css";
    s.textContent = [
      // the glass frame — translucent, blurred, on the Hologram surface; a soft lift off the desktop
      ".hvid{position:fixed;z-index:63;display:flex;flex-direction:column;overflow:hidden;",
        "border-radius:calc(var(--holo-radius,16px) + 4px);background:color-mix(in srgb,var(--holo-surface,#14161b) 58%, transparent);",
        "backdrop-filter:blur(28px) saturate(1.3);-webkit-backdrop-filter:blur(28px) saturate(1.3);",
        "border:1px solid color-mix(in srgb,var(--holo-ink,#eef2f6) 16%, var(--holo-border,#23272f));",
        "box-shadow:0 34px 90px rgba(0,0,0,.62), inset 0 1px 0 rgba(255,255,255,.14), inset 0 0 0 1px rgba(255,255,255,.04);",
        "color:var(--holo-ink,#eef2f6);font:var(--holo-text-sm,14px)/1.4 var(--holo-font-sans,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif);",
        "touch-action:none;user-select:none;-webkit-tap-highlight-color:transparent;animation:hvid-in .3s cubic-bezier(.22,1,.36,1)}",
      "@keyframes hvid-in{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}",
      ".hvid.dragging,.hvid.sizing{transition:none!important}",
      // the picture stage — the video fills it edge to edge over a near-black bezel
      ".hvid-stage{position:relative;flex:1 1 auto;min-height:0;background:#04050a;cursor:default}",
      // the picture FILLS the golden box edge-to-edge (cover) — no letterbox bars, clean and immersive;
      // in full screen it switches to contain so the whole frame is shown, nothing cropped.
      ".hvid-video{width:100%;height:100%;object-fit:cover;display:block;background:#04050a}",
      ".hvid.fs .hvid-video{object-fit:contain}",
      // YouTube surface — the IFrame fills the stage; in YT mode the native <video> and OUR transport hide,
      // because YouTube brings its own picture, controls and quality ladder (one set of controls, not two).
      ".hvid-yt{position:absolute;inset:0;z-index:2;display:none;background:#04050a}",
      ".hvid-yt iframe{width:100%;height:100%;border:0;display:block}",
      ".hvid.yt .hvid-yt{display:block}",
      ".hvid.yt .hvid-video{display:none}",
      ".hvid.yt .hvid-center,.hvid.yt .hvid-ctl{display:none}",
      // top glass bar — the drag handle + the two corner verbs (immerse · close). Fades with the UI.
      ".hvid-top{position:absolute;left:0;right:0;top:0;height:46px;z-index:4;display:flex;align-items:center;",
        "justify-content:flex-end;gap:7px;padding:0 9px;cursor:grab;",
        "background:linear-gradient(180deg,rgba(4,5,10,.6),rgba(4,5,10,0));",
        "opacity:0;transition:opacity .22s ease}",
      ".hvid.ui .hvid-top{opacity:1}",
      ".hvid.dragging .hvid-top{cursor:grabbing}",
      ".hvid.fs .hvid-top{cursor:default}",
      // round glass buttons (shared by the top bar + the control row)
      ".hvid-btn{appearance:none;border:0;cursor:pointer;color:#fff;background:rgba(8,10,15,.46);",
        "width:32px;height:32px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto;",
        "backdrop-filter:blur(6px);transition:background .14s,transform .12s}",
      ".hvid-btn:hover{background:rgba(8,10,15,.78)}",
      ".hvid-btn:active{transform:scale(.9)}",
      ".hvid-btn svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}",
      // the big centre play — only while paused; a soft accent pulse that invites the first tap
      ".hvid-center{position:absolute;inset:0;z-index:3;display:grid;place-items:center;pointer-events:none;",
        "opacity:1;transition:opacity .24s ease}",
      ".hvid.playing .hvid-center{opacity:0}",
      ".hvid-center button{pointer-events:auto;width:78px;height:78px;border-radius:50%;border:0;cursor:pointer;color:#fff;",
        "background:color-mix(in srgb,var(--holo-accent,#5b8cff) 88%, transparent);display:grid;place-items:center;",
        "box-shadow:0 12px 34px rgba(0,0,0,.5), 0 0 0 10px color-mix(in srgb,var(--holo-accent,#5b8cff) 16%, transparent);",
        "transition:transform .16s,box-shadow .2s}",
      ".hvid.playing .hvid-center button{pointer-events:none}",
      ".hvid-center button:hover{transform:scale(1.07);box-shadow:0 14px 40px rgba(0,0,0,.55), 0 0 0 14px color-mix(in srgb,var(--holo-accent,#5b8cff) 20%, transparent)}",
      ".hvid-center button svg{width:34px;height:34px;fill:currentColor;stroke:none;margin-left:4px}",
      // the control row — only the essentials, auto-hidden while playing
      ".hvid-ctl{position:absolute;left:0;right:0;bottom:0;z-index:4;display:flex;flex-direction:column;gap:9px;",
        "padding:12px 14px 13px;background:linear-gradient(0deg,rgba(4,5,10,.66),rgba(4,5,10,0));",
        "opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .22s,transform .22s}",
      ".hvid.ui .hvid-ctl{opacity:1;transform:none;pointer-events:auto}",
      // the scrubber — buffered + played + a knob that surfaces on hover/scrub
      ".hvid-seek{position:relative;height:6px;border-radius:4px;cursor:pointer;background:rgba(255,255,255,.18)}",
      ".hvid-seek:hover,.hvid-seek.scrub{height:7px}",
      ".hvid-buf{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:rgba(255,255,255,.26);width:0}",
      ".hvid-prog{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:var(--holo-accent,#5b8cff);width:0}",
      ".hvid-knob{position:absolute;top:50%;left:0;width:13px;height:13px;border-radius:50%;background:#fff;",
        "transform:translate(-50%,-50%);box-shadow:0 2px 7px rgba(0,0,0,.55);opacity:0;transition:opacity .14s}",
      ".hvid-seek:hover .hvid-knob,.hvid-seek.scrub .hvid-knob{opacity:1}",
      ".hvid-row{display:flex;align-items:center;gap:11px}",
      ".hvid-time{font:600 12px/1 ui-monospace,Menlo,Consolas,monospace;color:#fff;opacity:.85;letter-spacing:.02em;white-space:nowrap}",
      ".hvid-sp{flex:1 1 auto}",
      // volume — a slim slider that grows in beside the mute toggle on hover (clutter-free at rest)
      ".hvid-vol{display:flex;align-items:center;gap:8px}",
      ".hvid-vol input{-webkit-appearance:none;appearance:none;height:4px;border-radius:3px;cursor:pointer;outline:0;",
        "width:0;opacity:0;transition:width .2s,opacity .2s;background:rgba(255,255,255,.3)}",
      ".hvid-vol:hover input,.hvid-vol input:focus-visible{width:74px;opacity:1}",
      ".hvid-vol input::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.5)}",
      ".hvid-vol input::-moz-range-thumb{width:12px;height:12px;border:0;border-radius:50%;background:#fff}",
      // the resize grip — bottom-right, on theme; hidden in full screen
      ".hvid-grip{position:absolute;right:3px;bottom:3px;width:20px;height:20px;z-index:5;cursor:nwse-resize;opacity:0;transition:opacity .15s}",
      ".hvid.ui .hvid-grip{opacity:.5}",
      ".hvid-grip:hover{opacity:.95}",
      ".hvid-grip::after{content:'';position:absolute;right:4px;bottom:4px;width:9px;height:9px;",
        "border-right:2px solid #fff;border-bottom:2px solid #fff;border-bottom-right-radius:3px}",
      // immersive full screen — the frame dissolves; only the picture + overlays remain
      ".hvid.fs{border-radius:0;border:0;box-shadow:none;background:#000;width:100vw!important;height:100vh!important;left:0!important;top:0!important}",
      ".hvid.fs .hvid-grip{display:none}",
      // morph — a buttery golden glide used only when minimizing / restoring (never during a drag/resize)
      ".hvid.morph{transition:left .42s cubic-bezier(.34,1.2,.36,1),top .42s cubic-bezier(.34,1.2,.36,1),width .42s cubic-bezier(.34,1.2,.36,1),height .42s cubic-bezier(.34,1.2,.36,1)}",
      // minimized → a tidy corner PEEK: the glass frame stays, controls fold away, the picture keeps playing,
      // and a tap on the picture pops it back. Non-intrusive — small enough to work behind, big enough to watch.
      ".hvid.min .hvid-ctl,.hvid.min .hvid-grip,.hvid.min .hvid-center{display:none}",
      ".hvid.min .hvid-stage{cursor:pointer}",
      ".hvid.min .hvid-top{height:34px;background:linear-gradient(180deg,rgba(4,5,10,.5),rgba(4,5,10,0))}",
      ".hvid.min .hvid-btn{width:26px;height:26px}",
      ".hvid.min .hvid-btn svg{width:14px;height:14px}",
      "@media (prefers-reduced-motion: reduce){.hvid.morph{transition:none}}",
      ".hvid.loading .hvid-center button{animation:hvid-pulse 1.4s ease-in-out infinite}",
      "@keyframes hvid-pulse{0%,100%{box-shadow:0 12px 34px rgba(0,0,0,.5),0 0 0 10px color-mix(in srgb,var(--holo-accent,#5b8cff) 16%,transparent)}50%{box-shadow:0 12px 34px rgba(0,0,0,.5),0 0 0 18px color-mix(in srgb,var(--holo-accent,#5b8cff) 4%,transparent)}}",
      "@media (prefers-reduced-motion: reduce){.hvid{animation:none}.hvid.loading .hvid-center button{animation:none}}",
      // ── the DOCK TILE: a small, immersive glass play-orb — the video sibling of the music disc ──
      // A frosted sphere on the Hologram accent, with a glossy CD-style sheen and an enclosing rim that
      // lights + breathes while a video is playing. Built by dockTile(); sized to the rail's --hd-icon.
      ".hvt{position:relative;width:var(--hd-icon,22px);height:var(--hd-icon,22px);border-radius:50%;",
        "container-type:size;cursor:pointer;filter:drop-shadow(0 1px 3px rgba(0,0,0,.5));",
        "transition:transform .24s cubic-bezier(.34,1.35,.45,1)}",
      ".holo-dock-tile:hover .hvt{transform:scale(1.06)}",
      ".holo-dock-tile:active .hvt{transform:scale(.94);transition-duration:.06s}",
      // the screen face — a deep accent-tinted glass, edge-to-edge like a lens
      ".hvt-face{position:absolute;inset:0;border-radius:50%;overflow:hidden;z-index:1;",
        "background:radial-gradient(120% 120% at 30% 24%, color-mix(in srgb,var(--holo-accent,#5b8cff) 62%, #11141b), #0a0d14 78%);",
        "transition:filter .4s ease}",
      ".hvt.playing .hvt-face{filter:brightness(1.12) saturate(1.12)}",
      // a faint horizontal film-sweep that drifts while playing (reads as 'video'/light through the lens)
      ".hvt-scan{position:absolute;inset:0;border-radius:50%;pointer-events:none;z-index:2;opacity:.5;mix-blend-mode:screen;",
        "background:linear-gradient(180deg,transparent 38%,rgba(255,255,255,.18) 50%,transparent 62%);background-size:100% 220%;background-position:0 -60%}",
      ".hvt.playing .hvt-scan{animation:hvt-scan 2.4s linear infinite}",
      "@keyframes hvt-scan{from{background-position:0 -60%}to{background-position:0 160%}}",
      // glossy top-left light + a faint mirrored arc (does not move) — the same CD sheen as the disc
      ".hvt-sheen{position:absolute;inset:0;border-radius:50%;pointer-events:none;z-index:3;mix-blend-mode:screen;opacity:.9;",
        "background:radial-gradient(60% 44% at 32% 22%, rgba(255,255,255,.5), rgba(255,255,255,.05) 54%, transparent 70%)}",
      // the play triangle — switches to twin pause bars while playing; sized in container units so it
      // scales perfectly from the 22px rail tile up to any size
      ".hvt-glyph{position:absolute;inset:0;z-index:4;display:grid;place-items:center;pointer-events:none}",
      ".hvt-glyph::before{content:'';width:0;height:0;border-style:solid;border-width:26cqmin 0 26cqmin 40cqmin;",
        "border-color:transparent transparent transparent #fff;margin-left:8cqmin;filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))}",
      ".hvt.playing .hvt-glyph::before{width:38cqmin;height:46cqmin;border:0;border-left:13cqmin solid #fff;border-right:13cqmin solid #fff;margin:0;box-sizing:border-box;filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))}",
      // enclosing rim — a thin polished bezel that turns to the accent + glows while playing
      ".hvt-rim{position:absolute;inset:0;border-radius:50%;pointer-events:none;z-index:5;",
        "box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.24), inset 0 2px 3px rgba(255,255,255,.3), inset 0 -3px 9px rgba(0,0,0,.55), 0 1px 2px rgba(0,0,0,.4);transition:box-shadow .35s}",
      ".hvt.playing .hvt-rim{box-shadow:inset 0 0 0 1.5px var(--holo-accent,#5b8cff), inset 0 2px 3px rgba(255,255,255,.3), inset 0 -3px 9px rgba(0,0,0,.5), 0 0 15px 1px color-mix(in srgb,var(--holo-accent,#5b8cff) 70%, transparent)}",
      "@media (prefers-reduced-motion: reduce){.hvt-scan{animation:none!important}}"
    ].join("");
    (DOC.head || DOC.documentElement).appendChild(s);
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────
  function fmt(s) { if (!isFinite(s)) s = 0; s = Math.max(0, Math.floor(s || 0)); var m = Math.floor(s / 60), x = s % 60; return m + ":" + (x < 10 ? "0" : "") + x; }
  function clampN(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  // The play area = the live holospace tab CANVAS (#world), so the window opens and stays INSIDE the
  // canvas — never overflowing into the top chrome (tabs · omnibar) or the bottom status bar. The left
  // dock rail floats OVER the canvas (it doesn't inset #world), so we additionally carve it out by its
  // own rect, on whichever edge it's pinned. Fall back to the desktop when there's no canvas (off-shell).
  function deskBounds() {
    // the play area = the live holospace canvas (#world) OR, in the messenger, the immersive home wall — so the
    // window always opens INSIDE the visible canvas (never over the rail or off the bottom edge).
    var b, world = DOC.getElementById("world") || DOC.querySelector(".holo-home-wall");
    if (world) { var r = world.getBoundingClientRect(); if (r.width > 200 && r.height > 200) b = { minX: r.left + EDGE, minY: r.top + EDGE, maxX: r.right - EDGE, maxY: r.bottom - EDGE }; }
    // messenger, off-home (chat/social view): the home wall is hidden, but the SAME island frame lives on
    // as CSS vars (rail width + envelope gap) — rebuild the canvas frame from them, so the window still
    // opens and moves only INSIDE the canvas, never over the left rail or the outer gutter.
    if (!b && DOC.querySelector(".holo-wa-root")) {
      var ev = getComputedStyle(DOC.documentElement);
      var railW = parseFloat(ev.getPropertyValue("--holo-rail-w")) || 0;
      var gap = parseFloat(ev.getPropertyValue("--holo-env-gap")) || 0;
      b = { minX: railW + gap + EDGE, minY: gap + EDGE, maxX: W.innerWidth - gap - EDGE, maxY: W.innerHeight - gap - EDGE };
    }
    if (!b) {
      var gs = getComputedStyle(DOC.documentElement);
      var dW = parseFloat(gs.getPropertyValue("--holo-dock-w")) || 0;
      var dH = parseFloat(gs.getPropertyValue("--holo-dock-h")) || 0;
      b = { minX: EDGE + dW, minY: EDGE, maxX: W.innerWidth - EDGE, maxY: W.innerHeight - EDGE - dH };
    }
    var dock = DOC.getElementById("holo-dock");
    if (dock) {
      var o = dock.getAttribute("data-orient"), dr = dock.getBoundingClientRect();
      if (dr.width && dr.height) {
        if (o === "left") b.minX = Math.max(b.minX, dr.right + EDGE);
        else if (o === "right") b.maxX = Math.min(b.maxX, dr.left - EDGE);
        else if (o === "bottom") b.maxY = Math.min(b.maxY, dr.top - EDGE);
        else if (o === "top") b.minY = Math.max(b.minY, dr.bottom + EDGE);
      }
    }
    return b;
  }
  // ── YouTube engine (the pinned reel plays through YouTube's own IFrame player) ───────────────
  function ytIdOf(src) {
    if (!src) return null;
    var s = String(src);
    if (/^[\w-]{11}$/.test(s)) return s;                           // a bare 11-char video id
    var m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/)|youtu\.be\/|music\.youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/i);
    return m ? m[1] : null;
  }
  var _ytApiP = null;
  function loadYtApi() {
    if (W.YT && W.YT.Player) return Promise.resolve(W.YT);
    if (_ytApiP) return _ytApiP;
    _ytApiP = new Promise(function (res) {
      var prev = W.onYouTubeIframeAPIReady;
      W.onYouTubeIframeAPIReady = function () { try { prev && prev(); } catch (e) {} res(W.YT); };
      var s = DOC.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true;
      s.onerror = function () { res(null); };
      (DOC.head || DOC.documentElement).appendChild(s);
    });
    return _ytApiP;
  }
  // Mount (or re-cue) the YouTube player for `id`. autoplay is only ever true inside a user gesture (a tap),
  // so the browser lets it play WITH sound; the prewarm cues it silently so the first tap is instant.
  function mountYt(id, autoplay) {
    if (!VID) return;
    VID.ytId = id;
    loadYtApi().then(function (YT) {
      if (!VID || VID.ytId !== id) return;                         // superseded by a newer open()
      if (!YT || !YT.Player) { ytFail(); return; }
      if (VID.yt && VID.yt.loadVideoById) {                        // reuse the live player → instant swap
        try { autoplay ? VID.yt.loadVideoById(id) : VID.yt.cueVideoById(id); } catch (e) {}
        return;
      }
      // YT.Player REPLACES the element it's given with the <iframe>. Give it a throwaway INNER host so our
      // styled .hvid-yt container survives (the iframe lands inside it, filling the stage).
      var host = DOC.createElement("div"); host.style.cssText = "width:100%;height:100%";
      try { VID.ytHost.innerHTML = ""; VID.ytHost.appendChild(host); } catch (e) {}
      try {
        VID.yt = new YT.Player(host, {
          videoId: id, width: "100%", height: "100%",
          playerVars: { autoplay: autoplay ? 1 : 0, modestbranding: 1, rel: 0, playsinline: 1, fs: 1, iv_load_policy: 3 },
          events: {
            onReady: function (e) {
              VID.win.classList.remove("loading");
              try { e.target.setPlaybackQuality("hd1080"); } catch (x) {}     // hint the ladder high; YouTube caps to the connection
              try { e.target.unMute(); e.target.setVolume(100); } catch (x) {}
              if (VID.ytWantPlay) { VID.ytWantPlay = false; try { e.target.playVideo(); } catch (x) {} }
            },
            onStateChange: function (e) {
              if (e.data === 3) VID.win.classList.add("loading");            // buffering
              else if (e.data === 1 || e.data === 2 || e.data === 0) VID.win.classList.remove("loading");
              VID.ytPlaying = (e.data === 1);
              VID.win.classList.toggle("playing", VID.ytPlaying);
              reflectTile();
              if (e.data === 0) showUi();                                     // ended → surface the chrome
            },
            onError: function () { ytFail(); }
          }
        });
      } catch (e) { ytFail(); }
    });
  }
  // YouTube couldn't load (blocked / offline / removed video) → fold to the local progressive clip so the
  // window is never blank, and it still has audio.
  function ytFail() {
    if (!VID) return;
    VID.ytId = null; VID.ytPlaying = false;
    try { if (VID.yt && VID.yt.destroy) VID.yt.destroy(); } catch (e) {}
    VID.yt = null;
    VID.win.classList.remove("yt", "loading");
    if (VID.ytHost) VID.ytHost.innerHTML = "";
    var v = VID.video;
    v.removeAttribute("data-fellback"); v.setAttribute("src", FALLBACK_SRC);
    try { v.load(); v.play().catch(function () {}); } catch (e) {}
  }

  // ── the singleton player window ───────────────────────────────────────────────────────────
  var VID = null;                                                 // { win, video, yt, ytHost, els…, hover, hideT }
  function isFs(win) { var fe = DOC.fullscreenElement || DOC.webkitFullscreenElement; return fe === win; }

  function build() {
    injectCss();
    var win = DOC.createElement("div"); win.className = "hvid ui loading"; win.setAttribute("role", "dialog"); win.setAttribute("aria-label", "Video");
    win.innerHTML =
      '<div class="hvid-stage">' +
        '<video class="hvid-video" playsinline preload="metadata"></video>' +
        '<div class="hvid-yt"></div>' +
        '<div class="hvid-center"><button class="hvid-play-big" aria-label="Play">' + I.play + '</button></div>' +
        '<div class="hvid-top">' +
          '<button class="hvid-btn hvid-min" aria-label="Minimize">' + I.min + '</button>' +
          '<button class="hvid-btn hvid-close" aria-label="Close">' + I.close + '</button>' +
        '</div>' +
        '<div class="hvid-ctl">' +
          '<div class="hvid-seek"><div class="hvid-buf"></div><div class="hvid-prog"></div><div class="hvid-knob"></div></div>' +
          '<div class="hvid-row">' +
            '<button class="hvid-btn hvid-play" aria-label="Play">' + I.play + '</button>' +
            '<span class="hvid-time">0:00 / 0:00</span>' +
            '<span class="hvid-sp"></span>' +
            '<span class="hvid-vol"><button class="hvid-btn hvid-mute" aria-label="Mute">' + I.vol + '</button>' +
              '<input type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume"></span>' +
            '<button class="hvid-btn hvid-fs2" aria-label="Full screen">' + I.enter + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="hvid-grip" aria-label="Resize"></div>' +
      '</div>';
    DOC.body.appendChild(win);

    var q = function (s) { return win.querySelector(s); };
    var v = q(".hvid-video");
    var els = {
      win: win, video: v, stage: q(".hvid-stage"), top: q(".hvid-top"), ctl: q(".hvid-ctl"),
      seek: q(".hvid-seek"), buf: q(".hvid-buf"), prog: q(".hvid-prog"), knob: q(".hvid-knob"),
      time: q(".hvid-time"), grip: q(".hvid-grip"), vol: q("input"),
      playBig: q(".hvid-play-big"), play: q(".hvid-play"), mute: q(".hvid-mute")
    };
    VID = { win: win, video: v, ytHost: q(".hvid-yt"), yt: null, ytId: null, ytPlaying: false, els: els, hover: false, hideT: 0 };

    // place + size: ALWAYS a compact GOLDEN picture-in-picture tucked into the canvas' bottom-left —
    // ~30% of the canvas width (small enough to work behind, big enough to watch), the frame a golden
    // rectangle (height = width / φ), a φ corner gap. Bounds = the holospace canvas, so it never spills
    // out. It opens here every time.
    var b = deskBounds();
    var freeW = b.maxX - b.minX, freeH = b.maxY - b.minY;
    var wpx = Math.round(clampN(freeW * 0.30, 300, 460));
    var hpx = Math.round(wpx / PHI);
    wpx = clampN(wpx, MIN_W, freeW); hpx = clampN(hpx, MIN_H, freeH);
    var left = b.minX + GAP;
    var top = b.maxY - hpx - GAP;
    // align the window's vertical CENTRE to the living Q orb's centre (desktop `.hw-q` OR the messenger home orb)
    // so the window on the left and the orb on the right sit at one impeccable height.
    try { var _orb = document.querySelector(".hw-q, .holo-home-orb"); if (_orb) { var _r = _orb.getBoundingClientRect(); if (_r.height) top = clampN(Math.round(_r.top + _r.height / 2 - hpx / 2), b.minY, Math.max(b.minY, b.maxY - hpx)); } } catch (e) {}
    var sg = mediaStage().getGeom();                               // open where the last media window sat (music ⇄ video share one slot)
    if (sg) { wpx = clampN(sg.width, MIN_W, freeW); hpx = clampN(sg.height, MIN_H, freeH); left = sg.left; top = sg.top; }
    win.style.width = wpx + "px"; win.style.height = hpx + "px";
    win.style.left = clampN(left, b.minX, Math.max(b.minX, b.maxX - wpx)) + "px";
    win.style.top = clampN(top, b.minY, Math.max(b.minY, b.maxY - hpx)) + "px";

    wireVideo(els); wireControls(els); wireDrag(els); wireResize(els); wireKeys(els);
    // controls live ONLY while the pointer is over the glass: appear on hover, fade once it leaves.
    win.addEventListener("pointerenter", function () { VID.hover = true; showUi(); });
    win.addEventListener("pointerleave", function () { VID.hover = false; hideSoon(); });
    win.addEventListener("pointermove", showUi);
    return VID;
  }

  // ── controls: show on hover, fade after the mouse moves away ─────────────────────────────────
  function showUi() {
    if (!VID) return;
    VID.win.classList.add("ui");
    if (VID.hideT) { clearTimeout(VID.hideT); VID.hideT = 0; }     // hovering → stay; no idle auto-hide
  }
  function hideSoon(delay) {
    if (!VID) return;
    if (VID.hideT) { clearTimeout(VID.hideT); VID.hideT = 0; }
    if (VID.video.paused) return;                                  // paused → controls stay (you're deciding)
    VID.hideT = setTimeout(function () { if (VID && !VID.video.paused && !VID.hover) VID.win.classList.remove("ui"); }, delay || 650);
  }

  // ── video wiring ──────────────────────────────────────────────────────────────────────────
  function wireVideo(els) {
    var v = els.video;
    function syncPlay() {
      var p = v.paused; els.win.classList.toggle("playing", !p);
      var g = p ? I.play : I.pause;
      els.play.innerHTML = g; els.play.setAttribute("aria-label", p ? "Play" : "Pause");
      reflectTile();                                               // mirror play state onto the live dock orb
      if (p) showUi(); else hideSoon();
    }
    v.addEventListener("play", function () { els.win.classList.remove("loading"); syncPlay(); });
    v.addEventListener("pause", syncPlay);
    v.addEventListener("playing", function () { els.win.classList.remove("loading"); });
    v.addEventListener("waiting", function () { els.win.classList.add("loading"); });
    // if the streamed reel can't load (offline / source down), fall back to the same-origin clip (has audio)
    v.addEventListener("error", function () {
      if (v.getAttribute("data-fellback") || !FALLBACK_SRC) return;
      v.setAttribute("data-fellback", "1"); v.setAttribute("src", FALLBACK_SRC);
      try { v.load(); v.play().catch(function () {}); } catch (e) {}
    });
    v.addEventListener("loadedmetadata", function () { els.win.classList.remove("loading"); paint(); });
    v.addEventListener("timeupdate", paint);
    v.addEventListener("progress", paintBuf);
    v.addEventListener("ended", function () { showUi(); });
    v.addEventListener("volumechange", function () {
      els.vol.value = v.muted ? 0 : v.volume;
      els.mute.innerHTML = (v.muted || v.volume === 0) ? I.mute : I.vol;
    });
    function paint() {
      var d = v.duration, c = v.currentTime || 0;
      var known = isFinite(d) && d > 0;                       // a live/streamed mux may report no duration
      var pct = known ? (c / d * 100) : 0;
      els.prog.style.width = pct + "%"; els.knob.style.left = pct + "%";
      // metadata: "0:21 / 1:46" when the length is known, else just the running time (never "Infinity:NaN")
      els.time.textContent = known ? (fmt(c) + " / " + fmt(d)) : fmt(c);
    }
    function paintBuf() {
      try { var d = v.duration; if (isFinite(d) && d > 0 && v.buffered.length) { els.buf.style.width = (v.buffered.end(v.buffered.length - 1) / d * 100) + "%"; } } catch (e) {}
    }
    els._paint = paint;
  }

  function wireControls(els) {
    var v = els.video;
    function toggle() { if (v.paused) { v.play().catch(function () {}); } else { v.pause(); } }
    els.play.addEventListener("click", toggle);
    els.playBig.addEventListener("click", toggle);
    els.stage.addEventListener("click", function (e) {                // tap the picture → play/pause (but not the chrome)
      if (e.target.closest(".hvid-top,.hvid-ctl,.hvid-grip,.hvid-center")) return;
      if (VID && VID.min) { restore(); return; }                      // a peek is a one-tap pop-back
      if (VID && VID.win.classList.contains("yt")) return;            // YouTube owns its own picture taps
      toggle();
    });
    els.win.querySelector(".hvid-min").addEventListener("click", toggleMin);
    els.stage.addEventListener("dblclick", function (e) {              // double-tap the picture → immerse
      if (e.target.closest(".hvid-top,.hvid-ctl,.hvid-grip")) return;
      toggleFs(els.win);
    });
    els.mute.addEventListener("click", function () { v.muted = !v.muted; });
    els.vol.addEventListener("input", function () { v.muted = false; v.volume = parseFloat(els.vol.value); });
    els.win.querySelector(".hvid-fs2").addEventListener("click", function () { toggleFs(els.win); });
    els.win.querySelector(".hvid-close").addEventListener("click", close);
    wireSeek(els);
  }

  function wireSeek(els) {
    var v = els.video, seek = els.seek, dragging = false;
    function at(clientX) {
      var r = seek.getBoundingClientRect();
      var f = clampN((clientX - r.left) / r.width, 0, 1);
      if (v.duration) { v.currentTime = f * v.duration; if (els._paint) els._paint(); }
    }
    seek.addEventListener("pointerdown", function (e) {
      dragging = true; seek.classList.add("scrub"); seek.setPointerCapture(e.pointerId); at(e.clientX); e.stopPropagation();
    });
    seek.addEventListener("pointermove", function (e) { if (dragging) at(e.clientX); });
    seek.addEventListener("pointerup", function (e) { dragging = false; seek.classList.remove("scrub"); try { seek.releasePointerCapture(e.pointerId); } catch (x) {} });
  }

  // ── drag the whole window by its top glass bar ─────────────────────────────────────────────
  function wireDrag(els) {
    var win = els.win, sx = 0, sy = 0, ox = 0, oy = 0, on = false;
    els.top.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      if (e.target.closest(".hvid-btn")) return;                     // the corner verbs keep their own click
      if (win.classList.contains("fs")) return;
      on = true; sx = e.clientX; sy = e.clientY; ox = win.offsetLeft; oy = win.offsetTop;
      win.classList.add("dragging"); els.top.setPointerCapture(e.pointerId); e.preventDefault();
    });
    els.top.addEventListener("pointermove", function (e) {
      if (!on) return;
      var b = deskBounds();
      win.style.left = clampN(ox + (e.clientX - sx), b.minX, Math.max(b.minX, b.maxX - win.offsetWidth)) + "px";
      win.style.top = clampN(oy + (e.clientY - sy), b.minY, Math.max(b.minY, b.maxY - win.offsetHeight)) + "px";
    });
    els.top.addEventListener("pointerup", function (e) { if (!on) return; on = false; win.classList.remove("dragging"); publishGeom(); try { els.top.releasePointerCapture(e.pointerId); } catch (x) {} });
  }

  // ── resize from the corner grip ────────────────────────────────────────────────────────────
  function wireResize(els) {
    var win = els.win, sx = 0, sy = 0, ow = 0, oh = 0, on = false;
    els.grip.addEventListener("pointerdown", function (e) {
      if (win.classList.contains("fs")) return;
      on = true; sx = e.clientX; sy = e.clientY; ow = win.offsetWidth; oh = win.offsetHeight;
      win.classList.add("sizing"); els.grip.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
    });
    els.grip.addEventListener("pointermove", function (e) {
      if (!on) return;
      var b = deskBounds();
      win.style.width = clampN(ow + (e.clientX - sx), MIN_W, b.maxX - win.offsetLeft) + "px";
      win.style.height = clampN(oh + (e.clientY - sy), MIN_H, b.maxY - win.offsetTop) + "px";
    });
    els.grip.addEventListener("pointerup", function (e) { if (!on) return; on = false; win.classList.remove("sizing"); publishGeom(); try { els.grip.releasePointerCapture(e.pointerId); } catch (x) {} });
  }

  // ── keyboard (only while the window is hovered or immersive — never hijacks the OS) ─────────
  function wireKeys(els) {
    DOC.addEventListener("keydown", function (e) {
      if (!VID || VID.win !== els.win) return;
      var active = VID.hover || isFs(els.win);
      if (!active) return;
      var t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      var v = els.video, yt = VID.win.classList.contains("yt");
      if (e.key.toLowerCase() === "f") { e.preventDefault(); toggleFs(els.win); }
      else if (e.key === "Escape" && !isFs(els.win)) { close(); }
      else if (yt) {                                                   // YouTube's own player handles space/seek/mute when focused
        if (e.key === " " || e.key.toLowerCase() === "k") { e.preventDefault(); try { VID.ytPlaying ? VID.yt.pauseVideo() : VID.yt.playVideo(); } catch (x) {} }
      }
      else if (e.key === " " || e.key.toLowerCase() === "k") { e.preventDefault(); v.paused ? v.play().catch(function () {}) : v.pause(); }
      else if (e.key.toLowerCase() === "m") { v.muted = !v.muted; }
      else if (e.key === "ArrowRight") { v.currentTime = Math.min((v.duration || 0), v.currentTime + 5); showUi(); }
      else if (e.key === "ArrowLeft") { v.currentTime = Math.max(0, v.currentTime - 5); showUi(); }
    });
  }

  // ── minimize ↔ restore: fold into a corner PEEK (still playing) and pop back ────────────────
  // The hide gesture. A φ-smaller golden rectangle in the bottom-left corner — out of the way of work,
  // yet live. We morph (animate) the geometry once, then drop the transition so drag/resize stay snappy.
  function morph(win, fn) {
    win.classList.add("morph"); fn();
    setTimeout(function () { win.classList.remove("morph"); }, 460);
  }
  function minimize() {
    if (!VID || VID.min) return;
    var win = VID.win; if (win.classList.contains("fs")) { toggleFs(win); }
    VID.prevGeom = { left: win.offsetLeft, top: win.offsetTop, width: win.offsetWidth, height: win.offsetHeight };
    var b = deskBounds();
    var pw = Math.round(clampN(win.offsetWidth / PHI, 220, 340));    // a golden step smaller than the watch size
    var ph = Math.round(pw / PHI);
    pw = clampN(pw, MIN_W, b.maxX - b.minX); ph = clampN(ph, MIN_H, b.maxY - b.minY);
    VID.min = true; win.classList.add("min");
    var mb = win.querySelector(".hvid-min"); mb.innerHTML = I.pop; mb.setAttribute("aria-label", "Expand");
    morph(win, function () {
      win.style.width = pw + "px"; win.style.height = ph + "px";
      win.style.left = (b.minX + GAP) + "px"; win.style.top = (b.maxY - ph - GAP) + "px";
    });
    showUi();
  }
  function restore() {
    if (!VID || !VID.min) return;
    var win = VID.win, g = VID.prevGeom || {}, b = deskBounds();
    VID.min = false; win.classList.remove("min");
    var mb = win.querySelector(".hvid-min"); mb.innerHTML = I.min; mb.setAttribute("aria-label", "Minimize");
    morph(win, function () {
      if (g.width) {
        win.style.width = g.width + "px"; win.style.height = g.height + "px";
        win.style.left = clampN(g.left, b.minX, Math.max(b.minX, b.maxX - g.width)) + "px";
        win.style.top = clampN(g.top, b.minY, Math.max(b.minY, b.maxY - g.height)) + "px";
      }
    });
    setTimeout(publishGeom, 470);                                  // after the morph settles, share the watch-size slot
    showUi();
  }
  function toggleMin() { if (!VID) return; VID.min ? restore() : minimize(); }

  // ── immersive full screen ──────────────────────────────────────────────────────────────────
  function toggleFs(win) {
    try {
      if (isFs(win)) { (DOC.exitFullscreen || DOC.webkitExitFullscreen).call(DOC); }
      else { (win.requestFullscreen || win.webkitRequestFullscreen).call(win); }
    } catch (e) {}
  }
  function onFsChange() {
    if (!VID) return;
    var on = isFs(VID.win);
    VID.win.classList.toggle("fs", on);
    var fsb = VID.win.querySelector(".hvid-fs2"); if (fsb) fsb.innerHTML = on ? I.exit : I.enter;
    showUi();
  }
  DOC.addEventListener("fullscreenchange", onFsChange);
  DOC.addEventListener("webkitfullscreenchange", onFsChange);

  // the canvas frame can move/shrink (viewport resize, expanded mode) — keep the window inside it
  W.addEventListener("resize", function () {
    if (!VID || !VID.win || VID.suspended) return;
    clampIntoFrame();
  });

  // ── shared-stage geometry + suspend (music ⇄ video swap in one slot) ─────────────────────────
  function publishGeom() {
    if (!VID || !VID.win || VID.suspended || VID.min || VID.win.classList.contains("fs")) return;
    mediaStage().setGeom({ left: VID.win.offsetLeft, top: VID.win.offsetTop, width: VID.win.offsetWidth, height: VID.win.offsetHeight });
  }
  function applySharedGeom() {
    if (!VID || !VID.win) return;
    var g = mediaStage().getGeom(); if (!g) return;
    var b = deskBounds();
    var wpx = clampN(g.width, MIN_W, b.maxX - b.minX), hpx = clampN(g.height, MIN_H, b.maxY - b.minY);
    VID.win.style.width = wpx + "px"; VID.win.style.height = hpx + "px";
    VID.win.style.left = clampN(g.left, b.minX, Math.max(b.minX, b.maxX - wpx)) + "px";
    VID.win.style.top = clampN(g.top, b.minY, Math.max(b.minY, b.maxY - hpx)) + "px";
  }
  // land the window inside the CURRENT canvas frame — its geometry may predate a frame change (built at
  // prewarm against a boot-time frame, or the frame moved/shrank while the window sat suspended/hidden).
  function clampIntoFrame() {
    if (!VID || !VID.win || VID.win.classList.contains("fs")) return;
    var b = deskBounds(), win = VID.win;
    var wpx = clampN(win.offsetWidth, MIN_W, Math.max(MIN_W, b.maxX - b.minX));
    var hpx = clampN(win.offsetHeight, MIN_H, Math.max(MIN_H, b.maxY - b.minY));
    win.style.width = wpx + "px"; win.style.height = hpx + "px";
    win.style.left = clampN(win.offsetLeft, b.minX, Math.max(b.minX, b.maxX - wpx)) + "px";
    win.style.top = clampN(win.offsetTop, b.minY, Math.max(b.minY, b.maxY - hpx)) + "px";
  }
  // suspend = the music window took the slot: pause + hide (keep state so a dock tap pops it back)
  function suspend() {
    if (!VID || !VID.win) return;
    try { if (isFs(VID.win)) (DOC.exitFullscreen || DOC.webkitExitFullscreen).call(DOC); } catch (e) {}
    try { VID.video.pause(); } catch (e) {}
    try { if (VID.yt && VID.yt.pauseVideo) VID.yt.pauseVideo(); } catch (e) {}
    VID.ytPlaying = false;
    VID.win.style.display = "none"; VID.suspended = true; reflectTile();
  }

  // ── open / close ────────────────────────────────────────────────────────────────────────
  function open(src, opts) {
    opts = opts || {};
    var S = mediaStage();
    if (!VID || !DOC.body.contains(VID.win)) build();
    var win = VID.win, v = VID.video;
    win.style.display = ""; VID.suspended = false;                 // un-hide if a previous suspend folded it away
    win.style.zIndex = 63;                                          // bring to the front of its plane
    S.register("video", suspend);
    applySharedGeom();                                             // land in the shared media slot (where music last sat)
    clampIntoFrame();                                              // …and ALWAYS inside the current canvas frame
    S.claim("video");                                              // take the slot → the music window suspends (no audio clash)
    var url = src || (VID.ytId ? DEFAULT_SRC : v.getAttribute("src")) || DEFAULT_SRC;
    var autoplay = opts.autoplay !== false;
    var ytId = ytIdOf(url);
    if (ytId) {                                                     // ── YouTube reel: our frame, YouTube's picture + quality ──
      win.classList.add("yt");
      try { v.pause(); } catch (e) {}                              // the native element steps aside
      VID.ytWantPlay = autoplay;                                   // if the player is still mounting, play the moment it's ready
      if (VID.ytId === ytId && VID.yt) {                           // already the live reel → just resume (instant)
        win.classList.remove("loading");
        if (autoplay) { VID.ytWantPlay = false; try { VID.yt.playVideo(); } catch (e) {} }
      } else {
        win.classList.add("loading");
        mountYt(ytId, autoplay);
      }
      showUi(); reflectTile(); publishGeom();
      return VID;
    }
    // ── native <video> path (local / direct MP4) ──
    win.classList.remove("yt");
    try { if (VID.yt && VID.yt.pauseVideo) VID.yt.pauseVideo(); } catch (e) {}
    VID.ytPlaying = false;
    if (opts.poster) v.setAttribute("poster", opts.poster);
    if (url !== v.getAttribute("src")) { v.removeAttribute("data-fellback"); v.setAttribute("src", url); try { v.load(); } catch (e) {} }
    v.muted = false; v.volume = (opts.volume != null ? opts.volume : 1);   // audio ON by default — a tap means "watch + listen"
    showUi();
    if (autoplay) { v.play().catch(function () {}); }              // a gesture (the dock tap) carried us here → play
    reflectTile(); publishGeom();
    return VID;
  }
  function close() {
    if (!VID) return;
    try { if (isFs(VID.win)) (DOC.exitFullscreen || DOC.webkitExitFullscreen).call(DOC); } catch (e) {}
    try { VID.video.pause(); } catch (e) {}
    try { if (VID.yt && VID.yt.destroy) VID.yt.destroy(); } catch (e) {}
    VID.yt = null; VID.ytId = null; VID.ytPlaying = false;
    if (VID.win.parentNode) VID.win.remove();
    VID = null; reflectTile();
  }
  function toggle(src, opts) { if (VID && DOC.body.contains(VID.win) && !VID.suspended) close(); else open(src, opts); }

  // ── the live DOCK TILE: a glass play-orb, the video sibling of the spinning music disc ───────
  var vidTileEl = null;
  function reflectTile() {
    var on;
    if (VID && VID.win && VID.win.classList.contains("yt")) on = !!(DOC.body.contains(VID.win) && !VID.suspended && VID.ytPlaying);
    else on = !!(VID && VID.video && DOC.body.contains(VID.win) && !VID.suspended && !VID.video.paused);
    if (vidTileEl) vidTileEl.classList.toggle("playing", on);
  }
  function dockTile() {
    injectCss();
    var t = DOC.createElement("div"); t.className = "hvt";
    t.innerHTML = '<div class="hvt-face"></div><div class="hvt-scan"></div><div class="hvt-sheen"></div>' +
                  '<div class="hvt-glyph"></div><div class="hvt-rim"></div>';
    vidTileEl = t; reflectTile();
    return t;
  }

  // ── dock pin — drop the "Video" tile into the left rail, right AFTER the music disc ─────────
  function ensureDockPin() {
    var tries = 0, sawVinyl = false;
    (function attempt() {
      if (++tries > 60) return;
      try {
        if (W.localStorage.getItem(PIN_LS)) return;                  // the user has already seen / decided
        if (W.HoloDock && W.HoloDock.config && W.HoloDock.setPins) {
          var pins = ((W.HoloDock.config().effective || {}).pins || []).slice();
          var keyOf = function (p) { return p && typeof p === "object" ? p.id : p; };
          if (pins.some(function (p) { return keyOf(p) === VIDEO_ID; })) { W.localStorage.setItem(PIN_LS, "1"); return; }
          var vi = -1; for (var i = 0; i < pins.length; i++) if (keyOf(pins[i]) === "holo.vinyl") { vi = i; break; }
          // wait briefly for the music disc to pin itself first, so Video lands right after it
          if (vi < 0 && tries < 24) { sawVinyl = sawVinyl; setTimeout(attempt, 130); return; }
          if (vi >= 0) pins.splice(vi + 1, 0, VIDEO_ID); else pins.push(VIDEO_ID);
          W.HoloDock.setPins(pins);
          W.localStorage.setItem(PIN_LS, "1");
          return;
        }
      } catch (e) {}
      setTimeout(attempt, 130);
    })();
  }

  // ── low-latency prewarm: the slow part of the FIRST video tap is the cold path — building the player
  //    DOM, then the host resolving + ffmpeg-muxing the YouTube reel (yt-dlp + copy-mux) before a single
  //    byte arrives. Do all of it at idle, ONCE, so the first tap is just "un-hide + play" on an already-
  //    built, already-buffering element. We build the window hidden+suspended (no stage claim → the music
  //    disc keeps playing) and let the element warm-buffer the default reel (preload="auto"). Cost: one
  //    background stream warm per boot; the payoff is an instant first play, which is the whole ask. ──
  var prewarmed = false;
  function prewarm() {
    if (prewarmed || VID) return; prewarmed = true;
    try {
      build();                                                     // create the player DOM now (off the click path)
      VID.win.style.display = "none"; VID.suspended = true;        // hidden + not claiming the media slot → music plays on
      var ytId = ytIdOf(DEFAULT_SRC);
      if (ytId) {                                                  // pre-mount the YouTube reel CUED (no autoplay) → the first tap is instant
        VID.win.classList.add("yt"); VID.ytWantPlay = false; mountYt(ytId, false);
      } else {
        var v = VID.video;
        v.preload = "auto";                                        // warm the buffer ahead of the tap
        if (!v.getAttribute("src")) { v.setAttribute("src", DEFAULT_SRC); try { v.load(); } catch (e) {} }
      }
    } catch (e) { prewarmed = false; }
  }

  // ── public API ─────────────────────────────────────────────────────────────────────────────
  W.HoloVideo = {
    open: open, close: close, toggle: toggle,
    isOpen: function () { return !!(VID && DOC.body.contains(VID.win) && !VID.suspended); },
    fullscreen: function () { if (VID) toggleFs(VID.win); },
    dockTile: dockTile,                                            // the live glass play-orb for the left nav rail
    dockId: VIDEO_ID, defaultSrc: DEFAULT_SRC
  };

  // boot: pin the tile, then prewarm the player AFTER the boot critical path. Gate on `load`, then idle —
  // bare requestIdleCallback fires in ANY idle gap (including one mid-boot), so an 8K default reel would
  // warm-buffer while the shell is still loading. Waiting for `load` keeps that heavy stream off the boot
  // window; a tap before then still builds+plays on demand (open()), so only the prewarm moves later.
  function boot() {
    ensureDockPin();
    var warm = function () { try { (W.requestIdleCallback || function (f) { return setTimeout(f, 400); })(function () { prewarm(); }, { timeout: 3000 }); } catch (e) { setTimeout(prewarm, 400); } };
    if (DOC.readyState === "complete") warm(); else W.addEventListener("load", warm, { once: true });
  }
  if (DOC.readyState === "loading") DOC.addEventListener("DOMContentLoaded", boot); else boot();
})();
