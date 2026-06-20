// holo-vinyl.js — Holo Vinyl: a small, beautiful ENCLOSED music disc for the Hologram OS desktop.
// A polished circular puck filled with the cover art that plays music SEAMLESSLY across the whole
// shell (it lives in the top page, so the sound keeps flowing while you work inside any app frame).
//
//   • single tap   → play; the disc spins clockwise under a fixed glass dome + spindle, like a turntable
//   • single tap   → (again) pause; spinning stops where it was
//   • double tap   → a small, beautiful quick-access preview (pick a track · open the full player)
//   • drag         → move it anywhere · grip → resize · right-click → menu (Play · preview · change set)
//   • the look     → collapsed, it is one small ENCLOSED circle: cover art in a bezel, glass dome, pearl spindle
//
// ARCHITECTURE (ADR-0029): the FLOATING disc is now a Holo Widget TYPE — it registers with the
// HoloWidgets runtime, which owns the frame (float · drag · resize · persist · menu · share-by-κ).
// Vinyl owns only the BODY (the disc) and the music (audio · preview · enrich). The persistent DOCK
// tile is independent of the floating host and lives here as before. Pure DOM + Web Audio element,
// no framework, no CDN. Drop-in (AFTER holo-widgets.js): <script src="_shared/holo-vinyl.js" defer>
(function () {
  "use strict";
  var W = window, DOC = document;
  if (W.HoloVinyl) return;
  try { if (W.top !== W.self) return; } catch (e) { return; }     // top shell only — so audio survives app frames

  var LS = "holo-vinyl.v1";                                        // legacy floating store (migrated to HoloWidgets, then dropped)
  var DOCK_LS = "holo-vinyl.dock.v3";                             // v3: first-boot default is the Ben Böhmer “Begin Again” SoundCloud set
  var MIGRATED_LS = "holo-vinyl.migrated.v1";
  var VINYL_ID = "holo.vinyl";                                     // the dock pin id (shared with holo-dock.js)
  var SHOWCASE = "/apps/music/feed/showcase.json";
  var SIZE_MIN = 44, SIZE_MAX = 380;
  var players = {};                                               // widgetId → music player {id,host,config,audio,idx,playing,el,disc,art,_mini}
  var DOCKP = null;                                                // the single persistent player behind the dock tile
  var npCurrent = null, npSubs = [];                              // "now playing" — the active player + its subscribers (a HoloWidgets provider)
  var defaults = null, defaultsP = null;

  // resolve our own dir → the bundled cover (served next to this script), so the disc is PRELOADED with
  // the album art on boot — instantly and offline. A remote copy is the only fallback.
  var SELF = (DOC.currentScript && DOC.currentScript.src) || (DOC.querySelector('script[src*="holo-vinyl.js"]') || {}).src || "";
  var BASE = SELF ? SELF.replace(/holo-vinyl\.js.*$/, "") : new URL("_shared/", location.href).href;
  var COVER_LOCAL = BASE + "holo-vinyl-cover.jpg";
  var COVER_REMOTE = "https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/85/1e/cb/851ecbdf-84e9-80ac-95c5-4cd8edbfc128/5039060664698.png/600x600bb.jpg";
  function artFallback(img) { if (!img) return; img.addEventListener("error", function () { if (img.dataset.fb !== "1" && COVER_REMOTE) { img.dataset.fb = "1"; img.src = COVER_REMOTE; } else { img.style.display = "none"; } }); }

  // The wired default — Ben Böhmer, “Begin Again”. Seed tracks are individually streamable; `resolve`
  // (the album set) lazily fills the full tracklist + crisp cover at runtime. Seed cover from a stable
  // CDN so the enclosed disc shows real artwork immediately, before the backend resolve returns.
  var BENBOHMER = {
    artist: "Ben Böhmer", title: "Begin Again", album: "Begin Again",
    cover: COVER_LOCAL,
    accent: "#e8743b",
    resolve: "https://soundcloud.com/ben-bohmer/sets/begin-again",
    tracks: [
      { title: "Begin Again",     artist: "Ben Böhmer", url: "https://soundcloud.com/ben-bohmer/begin-again" },
      { title: "Beyond Beliefs",  artist: "Ben Böhmer", url: "https://soundcloud.com/ben-bohmer/beyond-beliefs" },
      { title: "Home feat. JONAH", artist: "Ben Böhmer", url: "https://soundcloud.com/ben-bohmer/ben-bohmer-feat-jonah-home" }
    ]
  };

  // The DEFAULT set — the OS's own LOSSLESS album, delivered as κ-audio: each track is a content-addressed
  // chunk-DAG, every chunk re-derived against its κ (Law L5) BEFORE it decodes, cached in the κ-store
  // (dedup + serverless). A track carries `kappa` (its manifest) instead of a `url`; the player streams the
  // verified bit-exact bytes through the same Hi-Fi chain. No `resolve` → no network enrichment.
  var KAPPA_BASE = "/apps/music/feed/kappa/kappa-sessions/";
  var KAPPA_COVER = "/apps/music/music/Hologram%20Collective/Kappa%20Sessions/cover.svg";
  var KAPPA_SESSIONS = {
    artist: "Hologram Collective", title: "Kappa Sessions", album: "Kappa Sessions",
    cover: KAPPA_COVER, accent: "#5b8cff", lossless: true,
    tracks: [
      { title: "Boot Chime",      artist: "Hologram Collective", art: KAPPA_COVER, kappa: KAPPA_BASE + "01/manifest.json" },
      { title: "Kappa Groove",    artist: "Hologram Collective", art: KAPPA_COVER, kappa: KAPPA_BASE + "02/manifest.json" },
      { title: "Content Address", artist: "Hologram Collective", art: KAPPA_COVER, kappa: KAPPA_BASE + "03/manifest.json" },
      { title: "Merkle Dance",    artist: "Hologram Collective", art: KAPPA_COVER, kappa: KAPPA_BASE + "04/manifest.json" }
    ]
  };

  // ── styles (self-contained) ─────────────────────────────────────────────────────────────
  function injectCss() {
    if (DOC.getElementById("holo-vinyl-css")) return;
    var s = DOC.createElement("style"); s.id = "holo-vinyl-css";
    s.textContent = [
      // The disc face. As a floating widget it is EMBEDDED inside the HoloWidgets frame (.hv-embed),
      // which neutralises the legacy fixed-position frame styling; as a dock tile it stays .hv-dock.
      ".hv-widget{position:fixed;z-index:62;width:var(--hv-d,64px);touch-action:none;user-select:none;cursor:grab;",
        "filter:drop-shadow(0 8px 20px rgba(0,0,0,.55));-webkit-tap-highlight-color:transparent;transition:filter .2s}",
      ".hv-widget[hidden]{display:none}",
      ".hv-widget.dragging{cursor:grabbing}",
      // embedded-in-host: drop the frame role (the HoloWidgets frame provides position/drag/resize)
      ".hv-embed{position:static!important;z-index:auto!important;left:auto!important;top:auto!important;",
        "width:100%!important;height:100%!important;filter:none!important;cursor:inherit!important;touch-action:auto}",
      ".hv-embed .hv-stage{width:100%!important;height:auto!important;aspect-ratio:1/1!important}",
      ".hv-stage{position:relative;width:var(--hv-d,64px);height:var(--hv-d,64px);container-type:size;",
        "transition:transform .24s cubic-bezier(.34,1.35,.45,1)}",
      ".hv-widget:hover .hv-stage{transform:scale(1.06)}",
      ".hv-widget:active .hv-stage{transform:scale(.95);transition-duration:.06s}",
      // the spinning disc face — the album art IS the disc, enclosed edge-to-edge like a real CD
      ".hv-disc{position:absolute;inset:0;border-radius:50%;overflow:hidden;z-index:1;",
        "background:radial-gradient(120% 120% at 30% 22%, #e8a36b, #b5532a 46%, #2b1d3a 100%);",
        "animation:hv-spin 5.2s linear infinite;animation-play-state:paused;",
        "filter:saturate(.92) brightness(.95) contrast(1.02);transition:filter .45s ease}",
      ".hv-widget.playing .hv-disc{filter:saturate(1.06) brightness(1) contrast(1.02)}",
      ".hv-disc.spin{animation-play-state:running}",
      ".hv-art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}",
      // enclosing bezel — a thin polished rim that seals the disc edge (turns to the accent while playing)
      ".hv-rim{position:absolute;inset:0;border-radius:50%;pointer-events:none;z-index:5;",
        "box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.22), inset 0 2px 3px rgba(255,255,255,.32),",
        "inset 0 -3px 10px rgba(0,0,0,.55), inset 0 0 0 4px rgba(0,0,0,.14), 0 1px 2px rgba(0,0,0,.4);transition:box-shadow .35s}",
      ".hv-widget.playing .hv-rim{box-shadow:inset 0 0 0 1.5px var(--holo-accent,#e8743b), inset 0 2px 3px rgba(255,255,255,.32),",
        "inset 0 -3px 10px rgba(0,0,0,.5), 0 0 16px 1px color-mix(in srgb, var(--holo-accent,#e8743b) 70%, transparent)}",
      // glossy CD reflection — a fixed top-left light sweep + a faint mirrored arc (does NOT spin)
      ".hv-sheen{position:absolute;inset:0;border-radius:50%;pointer-events:none;z-index:3;mix-blend-mode:screen;opacity:.9;",
        "background:radial-gradient(62% 46% at 32% 20%, rgba(255,255,255,.5), rgba(255,255,255,.06) 52%, transparent 70%),",
        "conic-gradient(from 210deg at 50% 50%, transparent 0 17%, rgba(255,255,255,.10) 25%, transparent 33% 100%)}",
      // CD centre hub — a light clamp ring with a small spindle hole, exactly like the reference disc
      ".hv-hub{position:absolute;top:50%;left:50%;width:34%;height:34%;transform:translate(-50%,-50%);border-radius:50%;pointer-events:none;z-index:4;",
        "background:radial-gradient(circle at 44% 38%, rgba(255,255,255,.64), rgba(223,227,233,.42) 46%, rgba(150,158,170,.18) 72%, transparent 82%);",
        "box-shadow:inset 0 0 0 1px rgba(255,255,255,.36), 0 0 0 1px rgba(0,0,0,.10);transition:box-shadow .3s}",
      ".hv-hub::after{content:'';position:absolute;top:50%;left:50%;width:30%;height:30%;transform:translate(-50%,-50%);border-radius:50%;",
        "background:radial-gradient(circle at 50% 42%, #14161d, #05060a);box-shadow:inset 0 1px 2px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.22)}",
      ".hv-widget.playing .hv-hub{box-shadow:inset 0 0 0 1px rgba(255,255,255,.42), 0 0 8px 1px color-mix(in srgb, var(--holo-accent,#e8743b) 60%, transparent)}",
      // tap affordance — a play/pause glyph over a soft vignette, revealed on hover (clean disc at rest);
      // sized in container units so it scales perfectly from the 22px rail tile to a big desktop puck
      ".hv-tap{position:absolute;inset:0;z-index:6;display:grid;place-items:center;pointer-events:none;border-radius:50%;",
        "font-size:26cqmin;opacity:0;transition:opacity .16s ease;",
        "background:radial-gradient(circle at 50% 50%, rgba(5,7,10,0) 30%, rgba(5,7,10,.46) 100%)}",
      ".hv-widget:hover .hv-tap{opacity:1}",
      "@media (hover:none){.hv-widget:not(.playing) .hv-tap{opacity:.82}}",   // touch: a steady hint (no hover)
      ".hv-glyph{width:0;height:0;border-style:solid;border-width:.34em 0 .34em .56em;border-color:transparent transparent transparent #fff;",
        "margin-left:.12em;filter:drop-shadow(0 1px 2px rgba(0,0,0,.75))}",
      ".hv-widget.playing .hv-glyph{width:.5em;height:.62em;border:0;border-left:.18em solid #fff;border-right:.18em solid #fff;margin:0;box-sizing:border-box}",
      "@keyframes hv-spin{to{transform:rotate(360deg)}}",
      "@media (prefers-reduced-motion: reduce){.hv-disc{animation:none!important}}",
      // ── dock mode: the SAME enclosed CD, sized to live as a tile in the left nav rail ────────────
      ".hv-widget.hv-dock{position:static;left:auto;top:auto;width:var(--hd-icon,22px);height:var(--hd-icon,22px);",
        "filter:drop-shadow(0 1px 3px rgba(0,0,0,.5));cursor:pointer;z-index:auto}",
      ".hv-widget.hv-dock .hv-stage{width:100%;height:100%}",
      ".hv-widget.hv-dock:hover .hv-stage{transform:none}",        // the dock tile does the hover-scale itself
      // ── quick-access preview ──────────────────────────────────────────────────────────────
      ".hv-mini{position:fixed;z-index:64;width:280px;max-height:64vh;display:flex;flex-direction:column;border-radius:18px;overflow:hidden;",
        "background:color-mix(in srgb, var(--holo-surface,#14161b) 90%, transparent);backdrop-filter:blur(22px) saturate(1.25);",
        "border:1px solid var(--holo-border,#23272f);box-shadow:0 28px 70px rgba(0,0,0,.62);color:var(--holo-ink,#eef2f6);",
        "font:var(--holo-text-sm,1rem)/1.4 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}",
      ".hv-mini-hero{position:relative;height:108px;background:#0a0c10 center/cover no-repeat}",
      ".hv-mini-hero::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,12,16,.05),rgba(10,12,16,.92))}",
      ".hv-mini-hd{position:absolute;left:0;right:0;bottom:0;z-index:2;display:flex;align-items:flex-end;gap:11px;padding:12px}",
      ".hv-mini-hd img{width:52px;height:52px;border-radius:9px;object-fit:cover;flex:0 0 auto;box-shadow:0 6px 16px rgba(0,0,0,.6)}",
      ".hv-mini-hd .mt{min-width:0;flex:1 1 auto}",
      ".hv-mini-hd .mt b{display:block;font-weight:800;font-size:var(--holo-text-sm,1rem);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 6px rgba(0,0,0,.6)}",
      ".hv-mini-hd .mt span{color:var(--holo-ink-dim,#c2c9d2);font-size:var(--holo-text-sm,1rem);text-shadow:0 1px 4px rgba(0,0,0,.6)}",
      ".hv-mini .x{position:absolute;top:8px;right:8px;z-index:3;background:rgba(7,9,12,.5);border:0;color:#fff;cursor:pointer;font-size:16px;line-height:1;width:26px;height:26px;border-radius:50%;backdrop-filter:blur(4px)}",
      ".hv-mini .x:hover{background:rgba(7,9,12,.8)}",
      ".hv-list{overflow-y:auto;padding:4px 6px 6px}",
      ".hv-tr{display:flex;align-items:center;gap:9px;padding:7px;border-radius:10px;cursor:pointer;transition:background .12s}",
      ".hv-tr:hover{background:rgba(255,255,255,.06)} .hv-tr.on{background:color-mix(in srgb,var(--holo-accent,#1db954) 22%, transparent)}",
      ".hv-tr img{width:34px;height:34px;border-radius:6px;object-fit:cover;flex:0 0 auto}",
      ".hv-tr .tn{min-width:0;flex:1 1 auto}",
      ".hv-tr .tn b{display:block;font-weight:600;font-size:var(--holo-text-sm,1rem);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".hv-tr .tn span{color:var(--holo-ink-dim,#9aa3ad);font-size:var(--holo-text-sm,1rem);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}",
      ".hv-tr .eq{flex:0 0 auto;color:var(--holo-accent,#1db954);font:700 var(--holo-text-sm,1rem)/1 ui-monospace,monospace}",
      ".hv-mini-ft{display:flex;align-items:center;gap:8px;padding:9px 11px;border-top:1px solid var(--holo-border,#23272f)}",
      ".hv-mini-ft button{background:rgba(255,255,255,.06);border:0;color:var(--holo-ink,#eef2f6);border-radius:999px;height:31px;min-width:31px;padding:0 11px;cursor:pointer;font:600 var(--holo-text-sm,1rem)/1 inherit;transition:background .12s}",
      ".hv-mini-ft button:hover{background:rgba(255,255,255,.14)} .hv-mini-ft .play{background:var(--holo-accent,#1db954);color:#04201d}",
      ".hv-mini-ft .full{margin-left:auto;background:rgba(255,255,255,.08);font-weight:700;display:flex;align-items:center;gap:5px} .hv-mini-ft .full:hover{background:var(--holo-accent,#1db954);color:#04201d}",
      ".hv-mini-ft .sp{flex:1 1 auto;text-align:center;font:600 var(--holo-text-sm,.9rem)/1 ui-monospace,Menlo,Consolas,monospace;color:var(--holo-accent,#1db954);letter-spacing:1px;overflow:hidden;white-space:nowrap;opacity:.92}",
      // ── Now Playing widget: a cover thumb with a live equalizer that dances while a track plays ──
      ".np-cov{position:relative;flex:0 0 auto;width:clamp(40px,calc(var(--hw-w,280px)*.22),88px);aspect-ratio:1;border-radius:12px;",
        "background:radial-gradient(120% 120% at 30% 22%,#e8a36b,#b5532a 46%,#2b1d3a 100%) center/cover no-repeat;box-shadow:0 6px 18px rgba(0,0,0,.5)}",
      ".np-eq{position:absolute;right:5px;bottom:5px;display:flex;gap:2px;align-items:flex-end;height:15px;padding:2px;border-radius:5px;background:rgba(7,9,12,.5);opacity:0;transition:opacity .2s}",
      ".np-playing .np-eq{opacity:1}",
      ".np-eq i{width:3px;background:var(--holo-accent,#1db954);border-radius:2px;height:40%;animation:np-bounce .9s ease-in-out infinite}",
      ".np-eq i:nth-child(2){animation-delay:.15s} .np-eq i:nth-child(3){animation-delay:.3s} .np-eq i:nth-child(4){animation-delay:.45s}",
      "@keyframes np-bounce{0%,100%{height:28%}50%{height:100%}}",
      "@media (prefers-reduced-motion: reduce){.np-eq i{animation:none;height:60%}}",
      // ── the MUSIC PLAYER PILL: the persistent, draggable pop-out player (the now-playing card grown up) ──
      // Proportioned on the golden ratio: artwork is a φ-square (55px ≈ 34×φ), the inner scale is the
      // Fibonacci sequence (8·13·21·34·55), title:subtitle font sizes are 16:10 ≈ φ, and the overall pill
      // is a long golden bar. It shows artwork · song · artist · a Lossless badge, the minimum transport
      // (prev · play/pause · next), and a button to open the full Holo Music app in a new tab.
      ".hv-pill{--phi:1.618;position:fixed;z-index:64;display:flex;align-items:center;gap:13px;",
        "width:max-content;max-width:min(360px,calc(100vw - 28px));padding:13px;border-radius:21px;",
        "cursor:grab;touch-action:none;user-select:none;-webkit-tap-highlight-color:transparent;overflow:hidden;",
        "background:var(--holo-surface,#141417);",
        "border:1px solid color-mix(in srgb,var(--holo-accent,#5b8cff) 38%, var(--holo-border,#26262c));",
        "box-shadow:0 22px 60px rgba(0,0,0,.5), 0 0 30px -10px color-mix(in srgb,var(--holo-accent,#5b8cff) 60%, transparent);",
        "color:var(--holo-ink,#e7e7ea);font:var(--holo-text-sm,14px)/1.35 var(--holo-font-sans,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif);",
        "opacity:0;transform:translateY(10px) scale(.98);transition:opacity .26s cubic-bezier(.22,1,.36,1),transform .26s cubic-bezier(.22,1,.36,1)}",
      ".hv-pill.in{opacity:1;transform:none}",
      ".hv-pill.out{opacity:0;transform:translateY(8px) scale(.98);pointer-events:none}",
      ".hv-pill.dragging{cursor:grabbing;transition:none}",
      // artwork — a golden square; a soft accent ring; it breathes while playing (delight, not motion-sick spin)
      ".hv-pill-art{position:relative;flex:0 0 auto;width:55px;height:55px;border-radius:13px;overflow:hidden;",
        "box-shadow:0 6px 16px rgba(0,0,0,.5), inset 0 0 0 1px color-mix(in srgb,var(--holo-accent,#5b8cff) 50%, rgba(255,255,255,.16));transition:box-shadow .4s}",
      ".hv-pill-art img{width:100%;height:100%;object-fit:cover;display:block}",
      ".hv-pill.playing .hv-pill-art{box-shadow:0 6px 18px rgba(0,0,0,.5), inset 0 0 0 1px var(--holo-accent,#5b8cff), 0 0 18px -3px color-mix(in srgb,var(--holo-accent,#5b8cff) 75%, transparent);animation:hv-pill-breathe 3.2s ease-in-out infinite}",
      "@keyframes hv-pill-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.035)}}",
      // text column
      ".hv-pill-tx{min-width:0;flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;gap:1px}",
      ".hv-pill-kicker{display:flex;align-items:center;gap:6px;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;",
        "color:color-mix(in srgb,var(--holo-accent,#5b8cff) 78%, var(--holo-ink,#e7e7ea));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".hv-pill-eq{display:inline-flex;gap:2px;align-items:flex-end;height:9px;color:var(--holo-accent,#5b8cff);flex:0 0 auto}",
      ".hv-pill-eq i{width:2px;background:currentColor;border-radius:1px;height:40%;animation:np-bounce .9s ease-in-out infinite;animation-play-state:paused}",
      ".hv-pill.playing .hv-pill-eq i{animation-play-state:running}",
      ".hv-pill-eq i:nth-child(2){animation-delay:.15s}.hv-pill-eq i:nth-child(3){animation-delay:.3s}.hv-pill-eq i:nth-child(4){animation-delay:.45s}",
      ".hv-pill-ttl{font-weight:700;font-size:16px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",   // 16 : 10 ≈ φ
      ".hv-pill-sub{color:var(--holo-ink-dim,#c8c8cf);font-size:10px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      // transport — the minimum controls; the play CTA is an accent disc (34 = 21×φ); + open-full
      ".hv-pill-ctl{display:flex;align-items:center;gap:1px;flex:0 0 auto}",
      ".hv-pill-btn{appearance:none;border:0;background:transparent;color:var(--holo-ink,#e7e7ea);cursor:pointer;width:30px;height:30px;",
        "border-radius:50%;display:grid;place-items:center;flex:0 0 auto;transition:background .14s,transform .12s}",
      ".hv-pill-btn:hover{background:color-mix(in srgb,var(--holo-ink,#e7e7ea) 13%, transparent)}",
      ".hv-pill-btn:active{transform:scale(.88)}",
      ".hv-pill-btn svg{width:16px;height:16px}",
      ".hv-pill-play{width:34px;height:34px;background:var(--holo-accent,#5b8cff);color:#06121f;margin:0 1px}",
      ".hv-pill-play:hover{background:var(--holo-accent,#5b8cff);filter:brightness(1.1)}",
      ".hv-pill-play svg{width:18px;height:18px}",
      ".hv-pill-full svg{stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}",
      // a thin progress + scrub line along the bottom edge (minimum scrub, max calm)
      ".hv-pill-seek{position:absolute;left:0;right:0;bottom:0;height:4px;cursor:pointer;background:color-mix(in srgb,var(--holo-ink,#e7e7ea) 14%, transparent)}",
      ".hv-pill-seek:hover{height:6px}",
      ".hv-pill-prog{position:absolute;left:0;top:0;bottom:0;width:0;background:var(--holo-accent,#5b8cff)}",
      // close — a tiny corner dot, on hover only
      ".hv-pill-x{position:absolute;top:5px;right:6px;width:18px;height:18px;border-radius:50%;background:rgba(7,9,12,.45);color:#fff;",
        "border:0;cursor:pointer;display:grid;place-items:center;font-size:13px;line-height:1;opacity:0;transition:opacity .15s,background .14s;z-index:2}",
      ".hv-pill:hover .hv-pill-x,.hv-pill:focus-within .hv-pill-x{opacity:.9}",
      ".hv-pill-x:hover{background:rgba(7,9,12,.8)}",
      "@media (prefers-reduced-motion: reduce){.hv-pill{transition:opacity .14s}.hv-pill.in{transform:none}.hv-pill.playing .hv-pill-art{animation:none}.hv-pill-eq i{animation:none;height:60%}}",
    ].join("");
    (DOC.head || DOC.documentElement).appendChild(s);
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────
  function fmt(s) { s = Math.max(0, Math.round(s || 0)); var m = Math.floor(s / 60); return m + ":" + String(s % 60).padStart(2, "0"); }
  function streamSrc(url) { return "/sc/stream?url=" + encodeURIComponent(url); }
  function toast(m) { try { (W.HoloDesk && W.HoloDesk.toast || W.toast || function () {})(m); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
  function escTxt(s) { var d = DOC.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }

  // keep the quick-preview INSIDE the desktop — clear of the dock rail (shared geometry with the shell)
  var EDGE = 8;
  function deskBounds() {
    var gs = getComputedStyle(DOC.documentElement);
    var dW = parseFloat(gs.getPropertyValue("--holo-dock-w")) || 0;
    var dH = parseFloat(gs.getPropertyValue("--holo-dock-h")) || 0;
    return { minX: EDGE + dW, minY: EDGE, maxX: innerWidth - EDGE, maxY: innerHeight - EDGE - dH };
  }
  function clampInto(el, left, top) {
    var b = deskBounds(), w = el.offsetWidth, h = el.offsetHeight;
    left = Math.max(b.minX, Math.min(left, Math.max(b.minX, b.maxX - w)));
    top = Math.max(b.minY, Math.min(top, Math.max(b.minY, b.maxY - h)));
    el.style.left = left + "px"; el.style.top = top + "px"; return { left: left, top: top };
  }

  // ── one shared MEDIA STAGE ────────────────────────────────────────────────────────────────
  // Music and Video are two CONTENTS of a SINGLE on-screen window slot: opening one suspends the
  // other (pausing its audio → never a clash) and reuses its geometry so they swap in place. The
  // first of holo-vinyl / holo-video to load creates it; both share it. (Mirrored in holo-video.js.)
  function mediaStage() {
    if (W.HoloMediaStage) return W.HoloMediaStage;
    var S = { active: null, geom: null, _h: {} };
    S.register = function (kind, suspendFn) { S._h[kind] = suspendFn; };
    S.getGeom = function () { return S.geom; };
    S.setGeom = function (g) { if (g && g.width > 0 && g.height > 0) S.geom = { left: g.left, top: g.top, width: g.width, height: g.height }; };
    S.claim = function (kind) {
      for (var k in S._h) { if (k !== kind && typeof S._h[k] === "function") { try { S._h[k](); } catch (e) {} } }
      S.active = kind;
    };
    return (W.HoloMediaStage = S);
  }
  // The play area for the music WINDOW = the live holospace canvas (#world), carved clear of the dock
  // rail — IDENTICAL geometry to the video player, so the two windows open in exactly the same place.
  var MEDGE = 8;
  function mediaBounds() {
    var b, world = DOC.getElementById("world");
    if (world) { var r = world.getBoundingClientRect(); if (r.width > 200 && r.height > 200) b = { minX: r.left + MEDGE, minY: r.top + MEDGE, maxX: r.right - MEDGE, maxY: r.bottom - MEDGE }; }
    if (!b) {
      var gs = getComputedStyle(DOC.documentElement);
      var dW = parseFloat(gs.getPropertyValue("--holo-dock-w")) || 0;
      var dH = parseFloat(gs.getPropertyValue("--holo-dock-h")) || 0;
      b = { minX: MEDGE + dW, minY: MEDGE, maxX: innerWidth - MEDGE, maxY: innerHeight - MEDGE - dH };
    }
    var dock = DOC.getElementById("holo-dock");
    if (dock) {
      var o = dock.getAttribute("data-orient"), dr = dock.getBoundingClientRect();
      if (dr.width && dr.height) {
        if (o === "left") b.minX = Math.max(b.minX, dr.right + MEDGE);
        else if (o === "right") b.maxX = Math.min(b.maxX, dr.left - MEDGE);
        else if (o === "bottom") b.maxY = Math.min(b.maxY, dr.top - MEDGE);
        else if (o === "top") b.minY = Math.max(b.minY, dr.bottom + MEDGE);
      }
    }
    return b;
  }
  function mClamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  var MWIN_GAP = Math.round(13 * 1.618);                            // ~21px — a golden margin off the canvas edge

  // default set — on first boot the disc opens on Ben Böhmer's “Begin Again” set, streamed from SoundCloud
  // (the opener is the title track “Begin Again”). It plays at the highest bitrate SoundCloud serves and is
  // shaped by the OS-wide Hi-Fi chain; the opener is pre-buffered at boot for a low-latency first tap. The
  // native LOSSLESS κ-album (KAPPA_SESSIONS) stays one paste away by editing the disc.
  function getDefaults() { return Promise.resolve(defaults || (defaults = JSON.parse(JSON.stringify(BENBOHMER)))); }
  function configFromSet(set) {
    return { artist: set.artist || set.title || "", title: set.title || "", cover: set.cover || (set.tracks[0] && set.tracks[0].art) || "", resolve: set.resolve || "",
      tracks: (set.tracks || []).map(function (t) { return { title: t.title, artist: t.artist || set.artist, art: t.art, url: t.url, kappa: t.kappa }; }) };
  }
  function configFromSet(set) {
    return { artist: set.artist || set.title || "", title: set.title || "", cover: set.cover || (set.tracks[0] && set.tracks[0].art) || "", resolve: set.resolve || "",
      tracks: (set.tracks || []).map(function (t) { return { title: t.title, artist: t.artist || set.artist, art: t.art, url: t.url }; }) };
  }

  // ── player binding ────────────────────────────────────────────────────────────────────────
  // A floating disc's frame is the HoloWidgets host; we keep only the music state here and (re)bind
  // it to the freshly-rendered disc DOM on every render. One Audio per widget id, reused across renders.
  function discHtml(cover) {
    return '<div class="hv-widget hv-embed">' +
        '<div class="hv-stage">' +
          '<div class="hv-disc"><img class="hv-art" alt="" src="' + esc(cover) + '"></div>' +
          '<div class="hv-sheen"></div><div class="hv-hub"></div><div class="hv-rim"></div>' +
          '<div class="hv-tap"><span class="hv-glyph"></span></div>' +
        '</div>' +
      '</div>';
  }
  function playerOf(hostObj) {
    var p = players[hostObj.id];
    if (!p) {
      p = { id: hostObj.id, idx: 0, playing: false };
      p.audio = new Audio(); p.audio.preload = "none";
      p.audio.addEventListener("ended", function () { next(p); });
      p.audio.addEventListener("error", function () { if (p.playing) { toast("Couldn’t stream that track"); stop(p); } });
      players[hostObj.id] = p;
    }
    p.host = hostObj; p.config = hostObj.config;                  // host.config is the single source of truth
    p.el = hostObj.body.querySelector(".hv-embed");
    p.disc = hostObj.body.querySelector(".hv-disc");
    p.art = hostObj.body.querySelector(".hv-art");
    if (p.el) { p.el.classList.toggle("playing", p.playing); if (p.disc) p.disc.classList.toggle("spin", p.playing); }
    return p;
  }
  function persist(w) { try { if (w === DOCKP) saveDock(); else if (w && w.host) w.host.save(); } catch (e) {} }

  // ── "now playing" — a live snapshot of the active player, published as a HoloWidgets provider so any
  //    widget (e.g. the Now Playing tile) reflects whatever the disc/dock is playing across the shell ──
  function npState() {
    var w = npCurrent || DOCKP;
    if (!w || !w.config) return { playing: false };
    var c = w.config, t = (c.tracks && c.tracks[w.idx]) || {};
    return { playing: !!w.playing, title: t.title || c.title || c.album || "", artist: t.artist || c.artist || "", cover: t.art || c.cover || "", accent: c.accent || "", audio: w.audio || null };
  }
  function npEmit() { var s = npState(); for (var i = 0; i < npSubs.length; i++) { try { npSubs[i](s); } catch (e) {} } }
  function npToggle() { var w = npCurrent || DOCKP; if (w) toggle(w); }

  // ── high-fidelity output ────────────────────────────────────────────────────────────────
  // Route the disc's SAME-ORIGIN stream (/sc/stream) through the OS-wide Holo Audio engine — a
  // device-native, transparent DSP chain (5-band EQ + air + loudness-safe limiter), "Hi-Fi" preset.
  // One MediaElementSource per element: we claim it on first play, BEFORE the preview scope ever taps
  // it (the scope then reads our analyser instead — see updateScope). Honest: this can't add detail the
  // bytes never had; it plays at full device fidelity and shapes for clarity without ever clipping.
  // The Holo Audio engine is a tiny shared lib the shell doesn't load at boot (perf). Pull it once,
  // lazily — preloaded on vinyl boot so it's ready before the first tap; engaged within the gesture.
  var _audioLibP = null;
  function loadAudioLib() {
    if (W.HoloAudio) return Promise.resolve(W.HoloAudio);
    if (_audioLibP) return _audioLibP;
    _audioLibP = new Promise(function (resolve) {
      try {
        var s = DOC.createElement("script"); s.src = BASE + "holo-audio.js"; s.defer = true;
        s.onload = function () { resolve(W.HoloAudio || null); };
        s.onerror = function () { resolve(null); };
        (DOC.head || DOC.documentElement).appendChild(s);
      } catch (e) { resolve(null); }
    });
    return _audioLibP;
  }
  function ensureFx(w) {
    if (w.fx) return w.fx;                                              // already engaged — the Hi-Fi chain is live
    if (w._fxGaveUp) return null;                                       // create() threw (may have tapped) → never double-tap
    if (!w.audio || !W.HoloAudio || !W.HoloAudio.create) return null;   // lib not ready — element NOT tapped, retry on a later play
    if (w.audio.__holoSrc) { w._fxGaveUp = true; return null; }         // Holo Sound owns this element — don't fight for the node
    var fx;
    // create() returns {ok:false} WITHOUT tapping (it closes the ctx) when the context or the MediaElementSource
    // can't be made — so {ok:false} is safe to retry next play. Only a THROW might have tapped first → give up then.
    try { fx = W.HoloAudio.create(w.audio); }
    catch (e) { w._fxGaveUp = true; return null; }
    if (fx && fx.ok) { try { fx.setPreset("Hi-Fi"); } catch (e) {} try { if (fx.canSpatial) fx.setSpatial(spatialPref()); } catch (e) {} try { if (fx.setNormalize) fx.setNormalize(w._normalizeDb || 0); } catch (e) {} w.fx = fx; return fx; }
    return null;                                                        // {ok:false} → not tapped → retry on the next play
  }
  // spatial audio (HRTF virtual speakers) — a persisted, shell-wide disc preference (headphones); default on
  var SPATIAL_LS = "holo.sound.spatial.v1";                       // shared with Holo Sound — one spatial toggle for the whole OS
  function spatialPref() { try { var v = W.localStorage.getItem(SPATIAL_LS); return v === null ? true : v === "1"; } catch (e) { return true; } }
  function setSpatialPref(on) { on = !!on; try { W.localStorage.setItem(SPATIAL_LS, on ? "1" : "0"); } catch (e) {} allPlayers().forEach(function (w) { if (w.fx && w.fx.canSpatial) { try { w.fx.setSpatial(on); } catch (e) {} } }); toast(on ? "Spatial audio on — best on headphones" : "Spatial audio off"); }
  // EBU-R128: apply the track's pre-measured normalization gain (carried in its manifest) to the engine.
  function applyNormalize(w) { if (w && w.fx && w.fx.setNormalize) { try { w.fx.setNormalize(w._normalizeDb || 0); } catch (e) {} } }
  function fxResume(w) {
    if (W.HoloAudio) { var fx = ensureFx(w); if (fx) { try { fx.resume(); } catch (e) {} } return; }
    loadAudioLib().then(function () { var fx = ensureFx(w); if (fx && w.playing) { try { fx.resume(); } catch (e) {} } });
  }

  // (The transient "now playing" call-out was removed — the persistent player pill IS the now-playing
  //  surface now, so there is exactly one music object on screen, never a duplicate notification.)

  // ── playback ────────────────────────────────────────────────────────────────────────────
  function playTrack(w, i) {
    var tracks = (w.config && w.config.tracks) || []; if (!tracks.length) { editArtist(w); return; }
    w.idx = ((i % tracks.length) + tracks.length) % tracks.length;
    var t = tracks[w.idx]; if (!t || (!t.url && !t.kappa)) return;
    fxResume(w);                                                  // claim the element for Hi-Fi + wake the audio graph
    if (w.art && t.art) { w.art.src = t.art; w.art.style.display = ""; }
    if (t.kappa) playKappa(w, t);                                 // native LOSSLESS κ-audio (verify-before-decode)
    else { w._verified = null; w._normalizeDb = 0; applyNormalize(w); w.audio.src = streamSrc(t.url); w.audio.play().then(function () { setPlaying(w, true); }).catch(function () { setPlaying(w, true); }); }
    refreshMini(w); refreshWindow(w); npEmit();
  }
  // κ-audio playback: load + L5-verify the chunk-DAG, then feed the SAME element a Blob of the verified
  // lossless bytes — so the whole transport (pause/seek/next/ended) and the Hi-Fi chain work unchanged,
  // and the decoder only ever sees content-verified bytes. SoundCloud `url`, if present, is the fallback.
  var _kmodP = null;
  function loadKappaModule() {
    if (W.HoloKappaAudio) return Promise.resolve(W.HoloKappaAudio);
    if (_kmodP) return _kmodP;
    _kmodP = import(BASE + "holo-kappa-audio.mjs").then(function (m) { return W.HoloKappaAudio || m; }).catch(function () { return null; });
    return _kmodP;
  }
  function fallbackSC(w, t) { if (!t.url) { stop(w); return; } w._verified = null; w.audio.src = streamSrc(t.url); w.audio.play().then(function () { setPlaying(w, true); }).catch(function () { setPlaying(w, true); }); }
  function playKappa(w, t) {
    var token = (w._ktoken = (w._ktoken || 0) + 1);              // guard overlapping resolves (rapid next/prev/ended)
    loadKappaModule().then(function (mod) {
      if (token !== w._ktoken) return;
      if (!mod || !mod.resolveKappaTrack) { fallbackSC(w, t); return; }
      mod.resolveKappaTrack(t.kappa).then(function (res) {
        if (token !== w._ktoken) { try { res.dispose && res.dispose(); } catch (e) {} return; }
        if (w._kdispose) { try { w._kdispose(); } catch (e) {} }
        w._kdispose = res.dispose; w._verified = { lossless: true, total: res.total, fromStore: res.fromStore };
        w._normalizeDb = (res.meta && res.meta.normalizeDb) || 0; applyNormalize(w);   // EBU-R128 loudness (measured at ingest)
        w.audio.src = res.blobUrl;
        w.audio.play().then(function () { setPlaying(w, true); }).catch(function () { setPlaying(w, true); });
        refreshMini(w); npEmit();
      }).catch(function () { if (token !== w._ktoken) return; toast(t.url ? "Couldn’t verify — using stream" : "Couldn’t verify that track"); fallbackSC(w, t); });
    });
  }
  function setPlaying(w, on) {
    var was = w.playing;
    w.playing = on; if (w.el) { w.el.classList.toggle("playing", on); if (w.disc) w.disc.classList.toggle("spin", on); }
    if (on && !w.fx) fxResume(w);                                  // guarantee the Hi-Fi chain is engaged once playback confirms
    if (on) { npCurrent = w; }                                    // this is now the "now playing" source (the pill reflects it)
    if (w === DOCKP) { var li = w.el && w.el.closest && w.el.closest(".holo-dock-item"); if (li) { if (on) li.setAttribute("data-running", ""); else li.removeAttribute("data-running"); } saveDock(); }
    else persist(w);
    refreshMini(w); refreshWindow(w); updateScope(w); npEmit();
  }
  // Live audio EQ as braille (Holo FX micro-display): a real Web Audio analyser → a streaming
  // braille spectrum in the preview footer while a track plays. The signal IS the sound.
  var _vscope = null;
  function updateScope(w) {
    if (_vscope) { try { _vscope.stop(); } catch (e) {} _vscope = null; }
    var m = w && w._mini; if (!m || !DOC.body.contains(m) || !w.playing) return;
    if (!W.HoloFX) return;
    var sp = m.querySelector(".sp"); if (!sp) return;
    // when the Hi-Fi engine owns the element, read ITS analyser (one tap per element) — never re-source.
    if (w.fx && w.fx.analyser && W.HoloFX.scope) {
      var an = w.fx.analyser, fd = new Uint8Array(an.frequencyBinCount), width = 9, n = width * 2;
      _vscope = W.HoloFX.scope(sp, function () {
        try { if (w.fx.resume) w.fx.resume(); } catch (e) {}
        an.getByteFrequencyData(fd); var a = []; for (var c = 0; c < n; c++) a.push(fd[Math.floor(c * fd.length / n)] / 255); return a;
      }, { kind: "bars", width: width, fill: true, min: 0, max: 1, fps: 30 });
    } else if (W.HoloFX.audioScope && w.audio) {
      _vscope = W.HoloFX.audioScope(sp, w.audio, { kind: "bars", width: 9 });
    }
  }
  function play(w) { fxResume(w); if (!w.audio.src) playTrack(w, w.idx || 0); else { w.audio.play().catch(function () {}); setPlaying(w, true); } }
  function stop(w) { try { w.audio.pause(); } catch (e) {} setPlaying(w, false); }       // pause — keeps position
  function toggle(w) { w.playing ? stop(w) : play(w); }
  function next(w) { playTrack(w, (w.idx || 0) + 1); }
  function prev(w) { if (w.audio.currentTime > 3) { w.audio.currentTime = 0; return; } playTrack(w, (w.idx || 0) - 1); }

  // lazily resolve the album set → full tracklist + crisp cover (keeps the seeded opener, e.g. “Begin Again”, first)
  function enrich(w) {
    var url = w.config && w.config.resolve; if (!url || w._enriched) return; w._enriched = true;
    var openerTitle = (((w.config.tracks || [])[0]) || {}).title || "";   // the seeded opener (the title track)
    var seedTitles = {}; (w.config.tracks || []).forEach(function (t) { if (t.url && t.title) seedTitles[t.url] = t.title; });   // hand-curated names by url
    resolveSet(url).then(function (cfg) {
      if (!cfg || !cfg.tracks.length) return;
      var wasPlaying = w.playing, curUrl = (w.config.tracks[w.idx] || {}).url;
      cfg.tracks.forEach(function (t) { if (seedTitles[t.url]) t.title = seedTitles[t.url]; });   // keep the exact seeded titles (e.g. “Home feat. JONAH”)
      // pin the seeded opener to the front, so the boot playlist always starts on the title track
      if (openerTitle) { for (var o = 1; o < cfg.tracks.length; o++) { if ((cfg.tracks[o].title || "").toLowerCase() === openerTitle.toLowerCase()) { cfg.tracks.unshift(cfg.tracks.splice(o, 1)[0]); break; } } }
      if (cfg.cover && !w.config.cover) { w.config.cover = cfg.cover; if (w.art) { w.art.src = cfg.cover; w.art.style.display = ""; } }   // keep the bundled cover → no boot flash
      w.config.artist = cfg.artist || w.config.artist; w.config.tracks = cfg.tracks;
      var j = -1; for (var k = 0; k < cfg.tracks.length; k++) if (cfg.tracks[k].url === curUrl) { j = k; break; }
      w.idx = j >= 0 ? j : (wasPlaying ? w.idx : 0);
      refreshMini(w); refreshWindow(w); persist(w);
    }).catch(function () {});
  }
  function resolveSet(url) {
    return fetch("/sc/resolve?url=" + encodeURIComponent(url), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || j.error) throw new Error(j && j.error || "resolve failed");
      var entries = (j.entries || []).filter(function (e) { return e && (e.webpage_url || e.url); });
      var list = entries.length ? entries : [j];
      var tracks = list.map(function (e) { var u = e.webpage_url || e.url; return { title: e.title || slugTitle(u) || "(track)", artist: (e.artists && e.artists[0]) || e.uploader || j.uploader || "", art: artOf(e), url: u }; }).filter(function (t) { return t.url; });
      if (!tracks.length) throw new Error("no tracks");
      var cover = (tracks.find(function (t) { return t.art; }) || {}).art || "";
      return { artist: j.uploader || (tracks[0] && tracks[0].artist) || "SoundCloud", title: j.title || "", cover: cover, resolve: url, tracks: tracks };
    });
  }
  function artOf(e) { var ts = (e && e.thumbnails) || [], best = (e && e.thumbnail) || "", w = -1; for (var i = 0; i < ts.length; i++) if ((ts[i].width || 0) >= w) { w = ts[i].width || 0; best = ts[i].url; } return best || ""; }
  // a flat-playlist resolve gives URLs but no titles — derive a readable title from the SoundCloud slug
  // (".../begin-again" → "Begin Again"); numeric/api URLs have no slug, so the seed title or "(track)" stands.
  function slugTitle(url) {
    try {
      var seg = String(url || "").split("?")[0].replace(/\/+$/, "").split("/").pop() || "";
      if (!seg || /^\d+$/.test(seg) || /api-v2|api\.soundcloud/.test(url)) return "";
      return seg.replace(/[-_]+/g, " ").trim().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    } catch (e) { return ""; }
  }

  // ── quick-access preview ──────────────────────────────────────────────────────────────────
  function openMini(w) {
    closeMini();
    var m = DOC.createElement("div"); m.className = "hv-mini"; m.id = "hv-mini";
    var c = w.config, tracks = c.tracks || [];
    m.innerHTML =
      '<div class="hv-mini-hero" style="background-image:url(&quot;' + esc(c.cover) + '&quot;)">' +
        '<button class="x" title="close">×</button>' +
        '<div class="hv-mini-hd"><img alt="" src="' + esc(c.cover) + '"><div class="mt"><b>' + escTxt(c.title || c.album || c.artist) + '</b><span>' + escTxt(c.artist) + ' · ' + tracks.length + ' tracks</span></div></div>' +
      '</div>' +
      '<div class="hv-list"></div>' +
      '<div class="hv-mini-ft"><button class="prev" title="previous">⏮</button><button class="play" title="play/pause">▶</button><button class="next" title="next">⏭</button><span class="sp"></span><button class="full" title="open the full Holo Music player">⤢ Open player</button></div>';
    DOC.body.appendChild(m);
    var hero = m.querySelector(".hv-mini-hd img"); if (hero) hero.addEventListener("error", function () { hero.style.visibility = "hidden"; });
    var list = m.querySelector(".hv-list");
    tracks.forEach(function (t, i) {
      var row = DOC.createElement("div"); row.className = "hv-tr" + (i === w.idx && w.playing ? " on" : ""); row.dataset.i = i;
      row.innerHTML = '<img alt="" src="' + esc(t.art || c.cover) + '"><div class="tn"><b>' + escTxt(t.title) + '</b><span>' + escTxt(t.artist || c.artist) + '</span></div><span class="eq">' + (i === w.idx && w.playing ? "♪" : (t.dur ? fmt(t.dur) : "")) + '</span>';
      row.addEventListener("click", function () { playTrack(w, i); });
      list.appendChild(row);
    });
    m.querySelector(".x").onclick = closeMini;
    m.querySelector(".play").onclick = function () { toggle(w); };
    m.querySelector(".prev").onclick = function () { prev(w); };
    m.querySelector(".next").onclick = function () { next(w); };
    m.querySelector(".full").onclick = function () { openFull(w); };
    placeNear(m, w);
    w._mini = m; refreshMini(w); updateScope(w);
    setTimeout(function () { DOC.addEventListener("pointerdown", outsideMini, true); }, 0);
  }
  function refreshMini(w) {
    var m = (w && w._mini); if (!m || !DOC.body.contains(m)) return;
    var pb = m.querySelector(".play"); if (pb) pb.textContent = w.playing ? "❚❚" : "▶";
    [].forEach.call(m.querySelectorAll(".hv-tr"), function (r) { var on = +r.dataset.i === w.idx && w.playing; r.classList.toggle("on", on); var eq = r.querySelector(".eq"); if (eq && on) eq.textContent = "♪"; });
  }
  function placeNear(m, w) {
    var b = deskBounds(), r = w.el.getBoundingClientRect();
    var mw = m.offsetWidth || 280;
    var left = r.right + 12;
    if (left + mw > b.maxX) { var lf = r.left - mw - 12; if (lf >= b.minX) left = lf; }
    clampInto(m, left, r.top);
  }
  function outsideMini(e) { var m = DOC.getElementById("hv-mini"); if (m && !m.contains(e.target) && !insideAnyWidget(e.target)) closeMini(); }
  function allPlayers() { var a = []; for (var k in players) a.push(players[k]); if (DOCKP) a.push(DOCKP); return a; }
  function insideAnyWidget(node) { var a = allPlayers(); for (var i = 0; i < a.length; i++) if (a[i].el && a[i].el.contains(node)) return true; return false; }
  function closeMini() { if (_vscope) { try { _vscope.stop(); } catch (e) {} _vscope = null; } var m = DOC.getElementById("hv-mini"); if (m) m.remove(); DOC.removeEventListener("pointerdown", outsideMini, true); allPlayers().forEach(function (w) { w._mini = null; }); }

  // ── the MUSIC PLAYER PILL: the persistent, draggable pop-out player ──────────────────────────
  // The now-playing card grown into the player itself — one object, no duplicate notification. Shows
  // artwork · song · artist · a Lossless badge, the minimum transport (prev · play/pause · next), and a
  // button that opens the full Holo Music app in a new tab. Opening it suspends the video (and vice
  // versa) so the two never sound at once. Proportions are golden (see the CSS). Drives the dock player.
  var MWIN = null;                                                  // the pill: { el, els, w, _audio, _onTime, suspended }
  var MGLY = {
    play:  '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none"/></svg>',
    prev:  '<svg viewBox="0 0 24 24"><path d="M7 6v12M19 6l-9 6 9 6z" fill="currentColor" stroke="none"/></svg>',
    next:  '<svg viewBox="0 0 24 24"><path d="M17 6v12M5 6l9 6-9 6z" fill="currentColor" stroke="none"/></svg>',
    full:  '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-8 8M10 20H4v-6M4 20l8-8"/></svg>'   // open full app (↗ in a new tab)
  };

  function buildPill() {
    injectCss();
    var el = DOC.createElement("div"); el.className = "hv-pill"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Music player");
    el.innerHTML =
      '<div class="hv-pill-art"><img alt=""></div>' +
      '<div class="hv-pill-tx">' +
        '<div class="hv-pill-kicker"><span class="hv-pill-eq"><i></i><i></i><i></i><i></i></span><span class="hv-pill-badge">Now playing</span></div>' +
        '<div class="hv-pill-ttl">—</div>' +
        '<div class="hv-pill-sub"></div>' +
      '</div>' +
      '<div class="hv-pill-ctl">' +
        '<button class="hv-pill-btn hv-pill-prev" aria-label="Previous">' + MGLY.prev + '</button>' +
        '<button class="hv-pill-btn hv-pill-play" aria-label="Play">' + MGLY.play + '</button>' +
        '<button class="hv-pill-btn hv-pill-next" aria-label="Next">' + MGLY.next + '</button>' +
        '<button class="hv-pill-btn hv-pill-full" aria-label="Open full Holo Music" title="Open Holo Music in a new tab">' + MGLY.full + '</button>' +
      '</div>' +
      '<div class="hv-pill-seek"><div class="hv-pill-prog"></div></div>' +
      '<button class="hv-pill-x" aria-label="Close">×</button>';
    DOC.body.appendChild(el);
    var q = function (s) { return el.querySelector(s); };
    var els = {
      el: el, art: q(".hv-pill-art img"), badge: q(".hv-pill-badge"), ttl: q(".hv-pill-ttl"), sub: q(".hv-pill-sub"),
      prev: q(".hv-pill-prev"), play: q(".hv-pill-play"), next: q(".hv-pill-next"), full: q(".hv-pill-full"),
      x: q(".hv-pill-x"), seek: q(".hv-pill-seek"), prog: q(".hv-pill-prog")
    };
    MWIN = { el: el, els: els, w: null, suspended: false };
    artFallback(els.art);
    placePill();

    var stop2 = function (e) { e.stopPropagation(); };
    els.play.addEventListener("click", function (e) { stop2(e); if (MWIN.w) toggle(MWIN.w); });
    els.prev.addEventListener("click", function (e) { stop2(e); if (MWIN.w) prev(MWIN.w); });
    els.next.addEventListener("click", function (e) { stop2(e); if (MWIN.w) next(MWIN.w); });
    els.full.addEventListener("click", function (e) { stop2(e); openFull(MWIN.w || DOCKP); });   // → full Holo Music, new tab
    els.x.addEventListener("click", function (e) { stop2(e); closeWindow(); });
    wirePillSeek(els); wirePillDrag(el, els);
    return MWIN;
  }
  // bottom-LEFT of the canvas, vertically aligned with the Q orb on the right (a balanced pair of corners)
  function placePill() {
    var el = MWIN.el, b = mediaBounds();
    var w = el.offsetWidth || 320, h = el.offsetHeight || 84;
    var left = b.minX + MWIN_GAP, top = b.maxY - h - MWIN_GAP;
    try { var orb = DOC.querySelector(".hw-q"); if (orb) { var r = orb.getBoundingClientRect(); if (r.height) top = Math.round(r.top + r.height / 2 - h / 2); } } catch (e) {}   // match the orb's vertical centre
    el.style.left = mClamp(Math.round(left), b.minX, Math.max(b.minX, b.maxX - w)) + "px";
    el.style.top = mClamp(Math.round(top), b.minY, Math.max(b.minY, b.maxY - h)) + "px";
  }
  function wirePillSeek(els) {
    var seek = els.seek, dragging = false;
    function at(clientX) { var w = MWIN && MWIN.w; if (!w || !w.audio || !w.audio.duration) return; var r = seek.getBoundingClientRect(); w.audio.currentTime = mClamp((clientX - r.left) / r.width, 0, 1) * w.audio.duration; paintWindow(); }
    seek.addEventListener("pointerdown", function (e) { dragging = true; try { seek.setPointerCapture(e.pointerId); } catch (x) {} at(e.clientX); e.stopPropagation(); });
    seek.addEventListener("pointermove", function (e) { if (dragging) { at(e.clientX); e.stopPropagation(); } });
    seek.addEventListener("pointerup", function (e) { dragging = false; try { seek.releasePointerCapture(e.pointerId); } catch (x) {} });
  }
  // drag the whole pill (anywhere but a button or the seek line) — a real pop-out object, clamped in
  function wirePillDrag(el, els) {
    var sx = 0, sy = 0, ox = 0, oy = 0, on = false, moved = false;
    el.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      if (e.target.closest(".hv-pill-btn,.hv-pill-x,.hv-pill-seek")) return;
      on = true; moved = false; sx = e.clientX; sy = e.clientY; ox = el.offsetLeft; oy = el.offsetTop;
      try { el.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault();
    });
    el.addEventListener("pointermove", function (e) {
      if (!on) return; if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 3) { moved = true; el.classList.add("dragging"); }
      var b = mediaBounds();
      el.style.left = mClamp(ox + (e.clientX - sx), b.minX, Math.max(b.minX, b.maxX - el.offsetWidth)) + "px";
      el.style.top = mClamp(oy + (e.clientY - sy), b.minY, Math.max(b.minY, b.maxY - el.offsetHeight)) + "px";
    });
    el.addEventListener("pointerup", function (e) { if (!on) return; on = false; el.classList.remove("dragging"); try { el.releasePointerCapture(e.pointerId); } catch (x) {} });
  }
  function bindWindowAudio(w) {
    if (!MWIN || !w || !w.audio) return;
    if (MWIN._audio === w.audio) return;
    if (MWIN._audio && MWIN._onTime) { MWIN._audio.removeEventListener("timeupdate", MWIN._onTime); MWIN._audio.removeEventListener("durationchange", MWIN._onTime); }
    MWIN._audio = w.audio; MWIN._onTime = function () { paintWindow(); };
    w.audio.addEventListener("timeupdate", MWIN._onTime); w.audio.addEventListener("durationchange", MWIN._onTime);
  }
  function paintWindow() {
    var m = MWIN, w = m && m.w; if (!m || !w || !w.audio || m.suspended) return;
    var d = w.audio.duration || 0, c = w.audio.currentTime || 0;
    m.els.prog.style.width = (d ? (c / d * 100) : 0) + "%";
  }
  // keep the pill in sync with the active track + play state (called wherever refreshMini is)
  function refreshWindow(w) {
    var m = MWIN; if (!m || !w || m.w !== w || !DOC.body.contains(m.el) || m.suspended) return;
    var c = (w.config) || {}, t = (c.tracks && c.tracks[w.idx]) || {};
    var cover = t.art || c.cover || "";
    if (cover && m.els.art.getAttribute("src") !== cover) { m.els.art.src = cover; m.els.art.style.display = ""; }
    m.els.ttl.textContent = t.title || c.title || c.album || "—";
    m.els.sub.textContent = t.artist || c.artist || "";
    var lossless = !!(t.kappa || (w._verified && w._verified.lossless));      // a κ-track plays bit-exact, verified
    m.els.badge.textContent = lossless ? "Lossless · L5 ✓" : (w.playing ? "Now playing" : "Paused");
    m.el.classList.toggle("playing", !!w.playing);
    m.els.play.innerHTML = w.playing ? MGLY.pause : MGLY.play;
    m.els.play.setAttribute("aria-label", w.playing ? "Pause" : "Play");
    paintWindow();
  }
  // OPEN the pill player: claim the slot (suspends the video → no clash), show it, and play.
  function openWindow(w) {
    if (!w) w = DOCKP; if (!w) return;
    closeMini();
    var S = mediaStage();
    if (!MWIN || !DOC.body.contains(MWIN.el)) buildPill();
    MWIN.el.style.display = ""; MWIN.suspended = false; MWIN.w = w;
    S.register("music", suspendMusic);
    S.claim("music");                                              // take the audio → the video player suspends
    bindWindowAudio(w);
    if (!w.playing) play(w);                                       // a dock tap means "play + pop out the player"
    refreshWindow(w);
    void MWIN.el.offsetWidth; MWIN.el.classList.add("in");         // reflow → bloom in
  }
  // suspend = the video player took over the audio: pause the music + fold the pill away (keep state).
  function suspendMusic() {
    if (DOCKP && DOCKP.playing) stop(DOCKP);
    if (npCurrent && npCurrent !== DOCKP && npCurrent.playing) stop(npCurrent);   // silence any floating disc too
    if (MWIN && MWIN.el) { MWIN.el.classList.remove("in"); MWIN.el.style.display = "none"; MWIN.suspended = true; }
  }
  function closeWindow() {
    if (!MWIN) return;
    if (MWIN._audio && MWIN._onTime) { MWIN._audio.removeEventListener("timeupdate", MWIN._onTime); MWIN._audio.removeEventListener("durationchange", MWIN._onTime); MWIN._audio = null; }
    var el = MWIN.el; MWIN = null;
    if (el) { el.classList.add("out"); setTimeout(function () { if (el.parentNode) el.remove(); }, 260); }
  }

  // open the full Holo Music player (the “music” holospace) — dock launch, else the shell app frame
  function openFull(w) {
    closeMini();
    try { if (W.HoloDock && W.HoloDock.launch) { W.HoloDock.launch("music"); return; } } catch (e) {}
    try {
      var f = DOC.getElementById("holoframe"), hf = DOC.getElementById("hf-frame");
      if (f && hf) { hf.src = "holospace.html?app=music"; f.classList.add("open"); f.setAttribute("aria-hidden", "false"); DOC.documentElement.classList.add("framed"); return; }
    } catch (e) {}
    try { W.open("holospace.html?app=music", "_blank"); } catch (e) {}
  }

  // edit = paste a SoundCloud artist/playlist link → resolve via the host → new artwork + tracks
  function editArtist(w) {
    var url = W.prompt("Paste a SoundCloud artist or playlist link (or leave blank to keep the current one):", "");
    if (url == null) return; url = url.trim(); if (!url) return;
    if (!/^https?:\/\/(?:[\w-]+\.)?(?:soundcloud\.com|snd\.sc|on\.soundcloud\.com)\//i.test(url)) { toast("Not a SoundCloud link"); return; }
    toast("Loading set…");
    resolveSet(url).then(function (cfg) {
      var c = w.config; c.artist = cfg.artist; c.title = cfg.title; c.cover = cfg.cover; c.resolve = cfg.resolve; c.tracks = cfg.tracks;   // mutate in place (host.config ref)
      w._enriched = true; w.idx = 0; if (w.art) { w.art.src = cfg.cover; w.art.style.display = ""; } persist(w);
      if (w._mini) openMini(w);
      toast("✓ " + (c.title || c.artist) + " — " + cfg.tracks.length + " tracks");
    }).catch(function (e) { toast("Couldn’t load that link" + (/rate|429/i.test(e.message || "") ? " (rate-limited)" : "")); });
  }

  // ── the HoloWidgets type: the floating disc rides the runtime's frame ────────────────────────
  function defineType() {
    if (!W.HoloWidgets || !W.HoloWidgets.define) return false;
    W.HoloWidgets.define("vinyl", {
      name: "Vinyl Player", icon: "disc", blurb: "A music disc that plays across the shell.",
      defaultW: 84, minW: SIZE_MIN, maxW: SIZE_MAX,
      defaultConfig: JSON.parse(JSON.stringify(BENBOHMER)),
      render: function (hostObj) {
        injectCss();
        hostObj.body.style.cssText = "width:100%;aspect-ratio:1/1";
        if (hostObj.config && hostObj.config.accent) hostObj.el.style.setProperty("--holo-accent", hostObj.config.accent);
        hostObj.body.innerHTML = discHtml((hostObj.config && hostObj.config.cover) || "");
        var p = playerOf(hostObj);
        artFallback(p.art);
        enrich(p);                                                     // lazily pull the full album + crisp cover
      },
      onTap: function (hostObj) { toggle(playerOf(hostObj)); },         // single tap → play/pause
      onDouble: function (hostObj) { openMini(playerOf(hostObj)); },    // double tap → quick preview
      onEdit: function (hostObj) { editArtist(playerOf(hostObj)); },    // ✎ / Edit… → change set
      menuItems: function (hostObj) {
        var p = playerOf(hostObj);
        return [
          { label: p.playing ? "❚❚  Pause" : "▶  Play", fn: function () { toggle(p); } },
          { label: "≡  Quick preview", fn: function () { openMini(p); } },
          { label: (spatialPref() ? "✓ " : "") + "⊹  Spatial audio", fn: function () { setSpatialPref(!spatialPref()); } },
          { label: "⤢  Open full player", fn: function () { openFull(p); } },
        ];
      },
    });

    // A second PROVIDER, fed by vinyl: any widget can subscribe to what's playing across the shell.
    if (W.HoloWidgets.provider) W.HoloWidgets.provider("now-playing", function () {
      return { get: npState, subscribe: function (fn) { npSubs.push(fn); try { fn(npState()); } catch (e) {} return function () { var i = npSubs.indexOf(fn); if (i >= 0) npSubs.splice(i, 1); }; } };
    });
    // The Now Playing tile — reflects the active disc/dock and taps to play/pause it.
    W.HoloWidgets.define("now-playing", {
      name: "Now Playing", icon: "music", blurb: "What's playing across the shell.",
      defaultW: 280, minW: 170, maxW: 520, defaultConfig: {},
      render: function (hostObj) {
        injectCss(); hostObj.body.style.cssText = "";
        var card = DOC.createElement("div"); card.style.cssText = "display:flex;align-items:center;gap:.75em;text-align:left";
        var cov = DOC.createElement("div"); cov.className = "np-cov"; cov.innerHTML = '<div class="np-eq"><i></i><i></i><i></i><i></i></div>';
        var meta = DOC.createElement("div"); meta.style.cssText = "flex:1 1 auto;min-width:0";
        var lab = DOC.createElement("div"); lab.style.cssText = "font-size:clamp(9px,calc(var(--hw-w,280px)*.038),13px);letter-spacing:.12em;text-transform:uppercase;opacity:.6;margin-bottom:.25em"; lab.textContent = "Now Playing";
        var ttl = DOC.createElement("div"); ttl.style.cssText = "font-weight:650;font-size:clamp(13px,calc(var(--hw-w,280px)*.06),21px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
        var who = DOC.createElement("div"); who.style.cssText = "opacity:.8;font-size:clamp(11px,calc(var(--hw-w,280px)*.047),16px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:.1em";
        meta.appendChild(lab); meta.appendChild(ttl); meta.appendChild(who);
        card.appendChild(cov); card.appendChild(meta); hostObj.body.appendChild(card);
        hostObj.subscribe("now-playing", function (s) {
          if (s && (s.title || s.playing)) {
            ttl.textContent = s.title || "—"; who.textContent = s.artist || "";
            if (s.cover) cov.style.backgroundImage = 'url("' + esc(s.cover) + '")';
            if (s.accent) hostObj.el.style.setProperty("--holo-accent", s.accent);
            hostObj.el.classList.toggle("np-playing", !!s.playing);
            lab.textContent = s.playing ? "Now Playing" : "Paused";
          } else {
            ttl.textContent = "Nothing playing"; who.textContent = "tap a disc to start"; cov.style.backgroundImage = ""; hostObj.el.classList.remove("np-playing"); lab.textContent = "Now Playing";
          }
        });
      },
      onTap: function () { npToggle(); },
    });
    return true;
  }

  // ── dock tile: the SAME enclosed disc, pinned into the left nav rail (independent of the host) ──
  // One persistent player (DOCKP) survives the dock's frequent re-renders (it lives here, not in the
  // DOM). dockTile() builds a fresh disc element each render and rebinds it to that player, re-syncing
  // artwork + spin so playback is seamless. Tap → play/pause · double-tap → the quick preview.
  function loadDock() { try { return JSON.parse(W.localStorage.getItem(DOCK_LS) || "null"); } catch (e) { return null; } }
  function saveDock() { try { if (DOCKP) W.localStorage.setItem(DOCK_LS, JSON.stringify({ config: DOCKP.config, idx: DOCKP.idx })); } catch (e) {} }
  function syncDisc(w) { if (w.art) { var c = (w.config && w.config.cover) || ""; if (c) { w.art.src = c; w.art.style.display = ""; } } }
  // low-latency boot: pre-buffer the opening track's stream so the very first tap plays instantly.
  // Only direct (SoundCloud) tracks preload as raw audio — κ-tracks resolve+verify on play instead.
  function prefetchOpener(w) {
    try {
      var t = (w.config && w.config.tracks && w.config.tracks[w.idx || 0]) || null;
      if (!t || !t.url || t.kappa || w.audio.src) return;
      w.audio.preload = "auto"; w.audio.src = streamSrc(t.url); try { w.audio.load(); } catch (e) {}
    } catch (e) {}
  }

  function dockTile() {
    injectCss();
    if (!DOCKP) {
      var saved = loadDock();
      DOCKP = { id: "dock", idx: (saved && saved.idx) || 0, playing: false, config: (saved && saved.config) || JSON.parse(JSON.stringify(BENBOHMER)) };
      DOCKP._touched = !!saved;
      DOCKP.audio = new Audio(); DOCKP.audio.preload = "auto";       // warm-buffer the stream → low-latency first play
      DOCKP.audio.addEventListener("ended", function () { next(DOCKP); });
      DOCKP.audio.addEventListener("error", function () { if (DOCKP.playing) { toast("Couldn’t stream that track"); stop(DOCKP); } });
      if (!DOCKP._touched) getDefaults().then(function (d) { if (DOCKP && !DOCKP._touched) { DOCKP.config = JSON.parse(JSON.stringify(d)); DOCKP.idx = 0; syncDisc(DOCKP); refreshMini(DOCKP); prefetchOpener(DOCKP); } enrich(DOCKP); });
      else { prefetchOpener(DOCKP); enrich(DOCKP); }
    }
    var box = DOC.createElement("div"); box.className = "hv-widget hv-dock";
    if (DOCKP.config && DOCKP.config.accent) box.style.setProperty("--holo-accent", DOCKP.config.accent);
    var cover = (DOCKP.config && DOCKP.config.cover) || "";
    box.innerHTML =
      '<div class="hv-stage">' +
        '<div class="hv-disc"><img class="hv-art" alt="" src="' + esc(cover) + '"></div>' +
        '<div class="hv-sheen"></div><div class="hv-hub"></div><div class="hv-rim"></div>' +
        '<div class="hv-tap"><span class="hv-glyph"></span></div>' +
      '</div>';
    DOCKP.el = box; DOCKP.disc = box.querySelector(".hv-disc"); DOCKP.art = box.querySelector(".hv-art");
    artFallback(DOCKP.art);
    box.classList.toggle("playing", DOCKP.playing); DOCKP.disc.classList.toggle("spin", DOCKP.playing);
    wireDockTap(DOCKP);
    return box;
  }
  function wireDockTap(w) {
    var lastTap = 0, tapTimer = 0;
    w.el.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var now = Date.now();
      if (now - lastTap < 300) { lastTap = 0; if (tapTimer) { clearTimeout(tapTimer); tapTimer = 0; } openMini(w); return; }   // double → quick preview
      // Start the SOUND on this very tap — synchronously, inside the gesture (the opener is pre-buffered at
      // boot, so audio begins with no wait and no autoplay block). The window decision still waits the
      // double-tap window: openWindow's play() is idempotent (src is already set → just resumes), so a
      // not-yet-playing disc sounds instantly while the pill blooms in ~230ms later.
      if (!w.playing) play(w);
      // single → open the movable music player. If it is already up, toggle play/pause.
      lastTap = now; tapTimer = setTimeout(function () { tapTimer = 0; if (MWIN && !MWIN.suspended && DOC.body.contains(MWIN.win) && MWIN.w === w) toggle(w); else openWindow(w); }, 230);
    });
  }
  // scriptable controls for the dock tile (used by the dock's right-click menu)
  function dockToggle() { if (DOCKP) toggle(DOCKP); }
  function dockOpenWindow() { openWindow(DOCKP); }
  function dockPreview() { if (DOCKP) openMini(DOCKP); }
  function dockOpenFull() { if (DOCKP) openFull(DOCKP); else openFull({}); }
  function dockEdit() { if (DOCKP) editArtist(DOCKP); }
  function dockPlaying() { return !!(DOCKP && DOCKP.playing); }

  // ── public API + boot ─────────────────────────────────────────────────────────────────────
  // add(): drop a floating disc — now a HoloWidgets instance. Restores hidden ones first (host policy).
  function add(config, pos) {
    if (!W.HoloWidgets || !W.HoloWidgets.add) { toast("Holo Widgets unavailable"); return Promise.resolve(null); }
    return getDefaults().then(function (d) {
      return W.HoloWidgets.add("vinyl", config || JSON.parse(JSON.stringify(d)), pos);
    });
  }
  // one-time: lift any legacy floating discs (holo-vinyl.v1) into the HoloWidgets board, then drop the key.
  function migrateLegacy() {
    try {
      if (W.localStorage.getItem(MIGRATED_LS)) return;
      var raw = W.localStorage.getItem(LS);
      if (raw && W.HoloWidgets && W.HoloWidgets.add) {
        var arr = []; try { arr = JSON.parse(raw) || []; } catch (e) { arr = []; }
        arr.forEach(function (s) { if (s && !s.hidden) W.HoloWidgets.add("vinyl", s.config || JSON.parse(JSON.stringify(BENBOHMER)), { x: s.x, y: s.y }); });
      }
      if (raw) W.localStorage.removeItem(LS);
      W.localStorage.setItem(MIGRATED_LS, "1");
    } catch (e) {}
  }
  function boot() {
    ensureDockPin();                                             // put the live disc into the left nav rail (once)
    migrateLegacy();                                            // lift legacy floating discs onto the widget board
    try { loadAudioLib(); } catch (e) {}                         // warm the tiny Hi-Fi engine so it's ready on first tap
  }
  // Pin the disc into the Holo Dock's left rail — once. Guarded so a user who later removes it keeps it
  // removed. Retries briefly because the dock loads asynchronously alongside this script.
  function ensureDockPin() {
    var tries = 0;
    (function attempt() {
      if (++tries > 40) return;
      try {
        if (W.localStorage.getItem("holo-vinyl.dockpin.v1")) return;     // user has already seen/decided
        if (W.HoloDock && W.HoloDock.config && W.HoloDock.pin) {
          var pins = (W.HoloDock.config().effective || {}).pins || [];
          var has = pins.some(function (p) { return p === VINYL_ID || (p && p.id === VINYL_ID); });
          if (!has) W.HoloDock.pin(VINYL_ID);
          W.localStorage.setItem("holo-vinyl.dockpin.v1", "1");
          return;
        }
      } catch (e) {}
      setTimeout(attempt, 120);
    })();
  }
  W.HoloVinyl = {
    add: add,
    remove: function (id) { try { if (W.HoloWidgets && W.HoloWidgets.remove) W.HoloWidgets.remove(id); } catch (e) {} },
    show: function (id) { try { if (W.HoloWidgets && W.HoloWidgets.show) W.HoloWidgets.show(id); } catch (e) {} },
    hide: function (id) { try { if (W.HoloWidgets && W.HoloWidgets.hide) W.HoloWidgets.hide(id); } catch (e) {} },
    list: function () { try { return (W.HoloWidgets ? W.HoloWidgets.list() : []).filter(function (w) { return w.type === "vinyl"; }); } catch (e) { return []; } },
    count: function () { try { return W.HoloVinyl.list().length; } catch (e) { return 0; } },
    // "now playing" — the live shell-wide playback snapshot (consumed by the Now Playing widget)
    nowPlaying: npState, npToggle: npToggle,
    // spatial audio (HRTF virtual speakers) — read or set the shell-wide disc preference
    spatial: function (on) { if (on === undefined) return spatialPref(); setSpatialPref(!!on); return !!on; },
    // the movable · resizable music player window (shares one on-screen slot with Holo Video)
    openWindow: function () { openWindow(DOCKP); }, closeWindow: closeWindow,
    // dock tile — the live enclosed disc for the left nav rail (built/owned by holo-dock.js)
    dockTile: dockTile, dockToggle: dockToggle, dockOpenWindow: dockOpenWindow, dockPreview: dockPreview, dockOpenFull: dockOpenFull, dockEdit: dockEdit, dockPlaying: dockPlaying, dockId: VINYL_ID
  };

  defineType();                                                  // register the type at eval time, BEFORE HoloWidgets.boot restores saved discs
  if (DOC.readyState === "loading") DOC.addEventListener("DOMContentLoaded", boot); else boot();
})();
