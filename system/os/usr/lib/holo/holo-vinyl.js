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
  var DOCK_LS = "holo-vinyl.dock.v1";
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

  // default set — Ben Böhmer “Begin Again”. (An optional curated showcase.json may override it.)
  function getDefaults() {
    if (defaults) return Promise.resolve(defaults);
    if (defaultsP) return defaultsP;
    defaultsP = fetch(SHOWCASE, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var sets = (j && j.sets) || [], set = null;
      for (var i = 0; i < sets.length; i++) { if (sets[i] && !sets[i].drm && sets[i].tracks && sets[i].tracks.length) { set = sets[i]; break; } }
      defaults = set ? configFromSet(set) : JSON.parse(JSON.stringify(BENBOHMER));
      if (/begin again/i.test(defaults.title || "")) defaults.cover = COVER_LOCAL;   // preload the bundled art — instant, offline
      return defaults;
    }).catch(function () { defaults = JSON.parse(JSON.stringify(BENBOHMER)); return defaults; });
    return defaultsP;
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

  // ── playback ────────────────────────────────────────────────────────────────────────────
  function playTrack(w, i) {
    var tracks = (w.config && w.config.tracks) || []; if (!tracks.length) { editArtist(w); return; }
    w.idx = ((i % tracks.length) + tracks.length) % tracks.length;
    var t = tracks[w.idx]; if (!t || !t.url) return;
    w.audio.src = streamSrc(t.url);
    w.audio.play().then(function () { setPlaying(w, true); }).catch(function () { setPlaying(w, true); });
    if (w.art && t.art) { w.art.src = t.art; w.art.style.display = ""; }
    refreshMini(w); npEmit();
  }
  function setPlaying(w, on) {
    w.playing = on; if (w.el) { w.el.classList.toggle("playing", on); if (w.disc) w.disc.classList.toggle("spin", on); }
    if (on) npCurrent = w;                                        // this is now the "now playing" source
    if (w === DOCKP) { var li = w.el && w.el.closest && w.el.closest(".holo-dock-item"); if (li) { if (on) li.setAttribute("data-running", ""); else li.removeAttribute("data-running"); } saveDock(); }
    else persist(w);
    refreshMini(w); updateScope(w); npEmit();
  }
  // Live audio EQ as braille (Holo FX micro-display): a real Web Audio analyser → a streaming
  // braille spectrum in the preview footer while a track plays. The signal IS the sound.
  var _vscope = null;
  function updateScope(w) {
    if (_vscope) { try { _vscope.stop(); } catch (e) {} _vscope = null; }
    var m = w && w._mini; if (!m || !DOC.body.contains(m) || !w.playing) return;
    if (!W.HoloFX || !W.HoloFX.audioScope || !w.audio) return;
    var sp = m.querySelector(".sp"); if (sp) _vscope = W.HoloFX.audioScope(sp, w.audio, { kind: "bars", width: 9 });
  }
  function play(w) { if (!w.audio.src) playTrack(w, w.idx || 0); else { w.audio.play().catch(function () {}); setPlaying(w, true); } }
  function stop(w) { try { w.audio.pause(); } catch (e) {} setPlaying(w, false); }       // pause — keeps position
  function toggle(w) { w.playing ? stop(w) : play(w); }
  function next(w) { playTrack(w, (w.idx || 0) + 1); }
  function prev(w) { if (w.audio.currentTime > 3) { w.audio.currentTime = 0; return; } playTrack(w, (w.idx || 0) - 1); }

  // lazily resolve the album set → full tracklist + crisp cover (keeps “Begin Again” first)
  function enrich(w) {
    var url = w.config && w.config.resolve; if (!url || w._enriched) return; w._enriched = true;
    resolveSet(url).then(function (cfg) {
      if (!cfg || !cfg.tracks.length) return;
      var wasPlaying = w.playing, curUrl = (w.config.tracks[w.idx] || {}).url;
      if (cfg.cover && !w.config.cover) { w.config.cover = cfg.cover; if (w.art) { w.art.src = cfg.cover; w.art.style.display = ""; } }   // keep the bundled cover → no boot flash
      w.config.artist = cfg.artist || w.config.artist; w.config.tracks = cfg.tracks;
      var j = -1; for (var k = 0; k < cfg.tracks.length; k++) if (cfg.tracks[k].url === curUrl) { j = k; break; }
      w.idx = j >= 0 ? j : (wasPlaying ? w.idx : 0);
      refreshMini(w); persist(w);
    }).catch(function () {});
  }
  function resolveSet(url) {
    return fetch("/sc/resolve?url=" + encodeURIComponent(url), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || j.error) throw new Error(j && j.error || "resolve failed");
      var entries = (j.entries || []).filter(function (e) { return e && (e.webpage_url || e.url); });
      var list = entries.length ? entries : [j];
      var tracks = list.map(function (e) { return { title: e.title || "(track)", artist: (e.artists && e.artists[0]) || e.uploader || j.uploader || "", art: artOf(e), url: e.webpage_url || e.url }; }).filter(function (t) { return t.url; });
      if (!tracks.length) throw new Error("no tracks");
      var cover = (tracks.find(function (t) { return t.art; }) || {}).art || "";
      return { artist: j.uploader || (tracks[0] && tracks[0].artist) || "SoundCloud", title: j.title || "", cover: cover, resolve: url, tracks: tracks };
    });
  }
  function artOf(e) { var ts = (e && e.thumbnails) || [], best = (e && e.thumbnail) || "", w = -1; for (var i = 0; i < ts.length; i++) if ((ts[i].width || 0) >= w) { w = ts[i].width || 0; best = ts[i].url; } return best || ""; }

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

  function dockTile() {
    injectCss();
    if (!DOCKP) {
      var saved = loadDock();
      DOCKP = { id: "dock", idx: (saved && saved.idx) || 0, playing: false, config: (saved && saved.config) || JSON.parse(JSON.stringify(BENBOHMER)) };
      DOCKP._touched = !!saved;
      DOCKP.audio = new Audio(); DOCKP.audio.preload = "none";
      DOCKP.audio.addEventListener("ended", function () { next(DOCKP); });
      DOCKP.audio.addEventListener("error", function () { if (DOCKP.playing) { toast("Couldn’t stream that track"); stop(DOCKP); } });
      if (!DOCKP._touched) getDefaults().then(function (d) { if (DOCKP && !DOCKP._touched) { DOCKP.config = JSON.parse(JSON.stringify(d)); DOCKP.idx = 0; syncDisc(DOCKP); refreshMini(DOCKP); } enrich(DOCKP); });
      else enrich(DOCKP);
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
      if (now - lastTap < 300) { lastTap = 0; if (tapTimer) { clearTimeout(tapTimer); tapTimer = 0; } openMini(w); return; }   // double → preview
      lastTap = now; tapTimer = setTimeout(function () { tapTimer = 0; toggle(w); }, 230);                                     // single → play/pause
    });
  }
  // scriptable controls for the dock tile (used by the dock's right-click menu)
  function dockToggle() { if (DOCKP) toggle(DOCKP); }
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
    // dock tile — the live enclosed disc for the left nav rail (built/owned by holo-dock.js)
    dockTile: dockTile, dockToggle: dockToggle, dockPreview: dockPreview, dockOpenFull: dockOpenFull, dockEdit: dockEdit, dockPlaying: dockPlaying, dockId: VINYL_ID
  };

  defineType();                                                  // register the type at eval time, BEFORE HoloWidgets.boot restores saved discs
  if (DOC.readyState === "loading") DOC.addEventListener("DOMContentLoaded", boot); else boot();
})();
