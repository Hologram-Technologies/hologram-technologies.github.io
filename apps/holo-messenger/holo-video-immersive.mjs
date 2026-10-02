// holo-video-immersive.mjs — the messenger's shared-video player, made clean.
//
// The YouTube IFrame embed used by the link-card hero (and the native-video reel fallback) is switched to a
// CHROMELESS surface (controls=0 → no title, no channel, no avatar, no CC, no YouTube logo, no control bar):
// just the moving image, edge to edge. This module gives that bare surface ONE quiet Holo control bar —
// play/pause · seek · time · fullscreen — revealed ONLY on hover (and whenever paused), so the video stays
// immersive until you reach for it. It drives the cross-origin iframe purely over the YouTube postMessage
// protocol (enablejsapi=1), so there is no extra script and nothing to load; COEP-safe.
//
// Two things YouTube does NOT let a URL param settle, so we settle them over the API instead:
//   • Captions. cc_load_policy=0 only means "don't force them on" — a viewer's account default (or a track
//     that loads mid-play) can still paint a caption band over the picture. We unloadModule('captions') on
//     ready and re-assert it whenever a new track could appear, so the surface stays a bare moving image.
//   • The preview's pre-roll. The link-card preview mounts on HOVER — no user gesture — so an UNMUTED
//     autoplay is blocked by the browser, and YouTube falls back to its own full-chrome poster (title bar,
//     big ▶, control bar, logo). We mute + playVideo the preview over the API: a muted autoplay is always
//     allowed, so it plays chromeless from the first frame. (The click-opened viewer keeps its sound.)
//
// Additive + fail-soft: if no video embed is ever present it does nothing; if the postMessage time feed never
// answers, play/pause + fullscreen + drag-to-seek still work (only the live progress readout degrades).
(function () {
  if (typeof window === "undefined" || window.__holoVideoImmersive) return;
  window.__holoVideoImmersive = true;

  // ── one stylesheet, injected once ─────────────────────────────────────────────────────────────────
  const CSS = `
  .holo-lc-stage, .holo-video-stage { --hvi-accent: var(--holo-accent, #7b68ee); }
  .hvi-host { position: relative; }
  .hvi-bar { position:absolute; left:0; right:0; bottom:0; z-index:4; display:flex; align-items:center; gap:10px;
    padding:14px 12px 11px; box-sizing:border-box;
    background:linear-gradient(to top, rgba(0,0,0,.60), rgba(0,0,0,.14) 62%, transparent);
    opacity:0; transform:translateY(6px); transition:opacity .18s ease, transform .18s ease; pointer-events:none;
    font:500 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:#fff; }
  .hvi-host:hover .hvi-bar, .hvi-host.hvi-paused .hvi-bar, .hvi-bar:focus-within { opacity:1; transform:none; pointer-events:auto; }
  .hvi-btn { flex:0 0 auto; width:30px; height:30px; display:grid; place-items:center; border:0; border-radius:50%;
    background:transparent; color:#fff; cursor:pointer; padding:0; transition:background .12s ease; }
  .hvi-btn:hover { background:rgba(255,255,255,.18); }
  .hvi-btn svg { width:18px; height:18px; display:block; }
  .hvi-time { flex:0 0 auto; font-variant-numeric:tabular-nums; letter-spacing:.2px; opacity:.92; }
  .hvi-seek { flex:1 1 auto; min-width:40px; -webkit-appearance:none; appearance:none; height:4px; border-radius:3px; cursor:pointer;
    background:linear-gradient(to right, var(--hvi-accent) 0%, var(--hvi-accent) var(--hvi-p,0%), rgba(255,255,255,.30) var(--hvi-p,0%)); }
  .hvi-seek::-webkit-slider-thumb { -webkit-appearance:none; width:12px; height:12px; border-radius:50%; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.55); }
  .hvi-seek::-moz-range-thumb { width:12px; height:12px; border:0; border-radius:50%; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.55); }
  /* we own the controls now — hide the card's static ▶ hint once a stage is live */
  .hvi-host .holo-lc-play { display:none !important; }
  `;
  try { const s = document.createElement("style"); s.id = "hvi-style"; s.textContent = CSS; document.head.appendChild(s); } catch (e) {}

  const ICON = {
    play:  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.2v13.6L19 12 8 5.2Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.1"/><rect x="13.5" y="5" width="4" height="14" rx="1.1"/></svg>',
    full:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/></svg>',
  };
  const fmt = (t) => { t = Math.max(0, Math.floor(t || 0)); const m = Math.floor(t / 60), s = t % 60; return m + ":" + (s < 10 ? "0" : "") + s; };

  // ── attach a hover control bar to a chromeless YouTube iframe ──────────────────────────────────────
  function attach(iframe) {
    if (!iframe || iframe.__hvi) return; iframe.__hvi = true;
    const host = (iframe.closest && iframe.closest(".holo-lc-stage, .holo-video-stage")) || iframe.parentElement;
    if (!host) return;
    host.classList.add("hvi-host");
    const cmd = (func, args) => { try { iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func, args: args || [] }), "*"); } catch (e) {} };

    // The stage persists while the link-card remounts its iframe on each hover — reuse one bar, just
    // re-point it at the current iframe (and re-open the time feed) rather than stacking bars.
    let els = host.__hviEls;
    if (!els) {
      const bar = document.createElement("div"); bar.className = "hvi-bar";
      const play = document.createElement("button"); play.type = "button"; play.className = "hvi-btn hvi-play"; play.title = "Play / pause"; play.setAttribute("aria-label", "Play / pause"); play.innerHTML = ICON.pause;
      const time = document.createElement("span"); time.className = "hvi-time"; time.textContent = "0:00 / 0:00";
      const seek = document.createElement("input"); seek.className = "hvi-seek"; seek.type = "range"; seek.min = "0"; seek.max = "1000"; seek.step = "1"; seek.value = "0"; seek.setAttribute("aria-label", "Seek");
      const full = document.createElement("button"); full.type = "button"; full.className = "hvi-btn hvi-full"; full.title = "Fullscreen"; full.setAttribute("aria-label", "Fullscreen"); full.innerHTML = ICON.full;
      bar.append(play, time, seek, full);
      host.appendChild(bar);
      els = host.__hviEls = { bar, play, time, seek, full };
      const st = host.__hviState = { playing: true, dur: 0, cur: 0, dragging: false };

      bar.addEventListener("click", (e) => e.stopPropagation());          // never let a control click reach the card
      play.addEventListener("click", (e) => {
        e.stopPropagation(); st.playing = !st.playing;
        host.__hviCmd && host.__hviCmd(st.playing ? "playVideo" : "pauseVideo");
        play.innerHTML = st.playing ? ICON.pause : ICON.play;
        host.classList.toggle("hvi-paused", !st.playing);
      });
      seek.addEventListener("input", () => {
        st.dragging = true;
        const t = (seek.value / 1000) * (st.dur || 0);
        time.textContent = fmt(t) + " / " + fmt(st.dur);
        seek.style.setProperty("--hvi-p", (seek.value / 10) + "%");
      });
      const commitSeek = () => { const t = (seek.value / 1000) * (st.dur || 0); host.__hviCmd && host.__hviCmd("seekTo", [t, true]); st.dragging = false; };
      seek.addEventListener("change", commitSeek);
      full.addEventListener("click", (e) => {
        e.stopPropagation();
        try { if (document.fullscreenElement) document.exitFullscreen(); else (host.requestFullscreen ? host : iframe).requestFullscreen(); } catch (err) {}
      });
    }
    // (re)bind this bar to the current iframe
    host.__hviIframe = iframe;
    host.__hviCmd = cmd;

    // Keep the picture bare: drop YouTube's caption renderer (a URL param can't guarantee this), and — for the
    // hover PREVIEW, which mounts without a user gesture — mute + kick playback so a muted autoplay carries it
    // past YouTube's own full-chrome pre-roll poster. The click-opened viewer is left audible on purpose.
    const isPreview = iframe.classList.contains("holo-lc-embed");
    host.__hviClean = () => {
      cmd("unloadModule", ["captions"]);
      cmd("unloadModule", ["cc"]);
      try { cmd("setOption", ["captions", "track", {}]); } catch (e) {}
      if (isPreview) { cmd("mute"); cmd("playVideo"); }
    };

    // handshake: ask YouTube to stream infoDelivery back to us; retry until it answers or the iframe goes away
    let got = false, tries = 0;
    const ping = () => { try { iframe.contentWindow.postMessage(JSON.stringify({ event: "listening", id: iframe.id || "hvi", channel: "widget" }), "*"); } catch (e) {} };
    const iv = setInterval(() => { if (got || tries++ > 40 || !iframe.isConnected) { clearInterval(iv); return; } ping(); }, 250);
    host.__hviGot = () => { got = true; };
    ping();

    // The caption module + any default track can load a beat AFTER the player is ready, so re-assert the clean
    // surface a handful of times over the first few seconds rather than once. Fail-soft; stops with the iframe.
    let cleans = 0;
    const cv = setInterval(() => { if (cleans++ > 12 || !iframe.isConnected) { clearInterval(cv); return; } host.__hviClean(); }, 400);
    host.__hviClean();
  }

  // ── ONE message listener — route YouTube's infoDelivery to the matching host ────────────────────────
  window.addEventListener("message", (e) => {
    if (!e || typeof e.data !== "string" || e.data.indexOf("infoDelivery") < 0) return;
    let msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (!msg || msg.event !== "infoDelivery" || !msg.info) return;
    const hosts = document.querySelectorAll(".hvi-host");
    for (const host of hosts) {
      const ifr = host.__hviIframe;
      if (!ifr || ifr.contentWindow !== e.source) continue;
      host.__hviGot && host.__hviGot();
      const info = msg.info, st = host.__hviState, els = host.__hviEls;
      if (!st || !els) return;
      if (typeof info.duration === "number" && info.duration > 0) st.dur = info.duration;
      if (typeof info.currentTime === "number") st.cur = info.currentTime;
      if (typeof info.playerState === "number") {
        const playing = info.playerState === 1 || info.playerState === 3;   // playing or buffering
        st.playing = playing;
        els.play.innerHTML = playing ? ICON.pause : ICON.play;
        host.classList.toggle("hvi-paused", info.playerState === 2);        // only PAUSED pins the bar open
        if (playing && host.__hviClean) host.__hviClean();                  // a fresh track can re-arm captions
      }
      if (!st.dragging) {
        els.time.textContent = fmt(st.cur) + " / " + fmt(st.dur);
        const p = st.dur ? Math.min(1000, (st.cur / st.dur) * 1000) : 0;
        els.seek.value = String(p);
        els.seek.style.setProperty("--hvi-p", (p / 10) + "%");
      }
      return;
    }
  });

  // ── watch for chromeless embeds appearing (link-card mounts on hover; reel overlay on open) ─────────
  const scan = (root) => {
    try {
      if (root.matches && root.matches("iframe.holo-lc-embed, iframe.holo-video-frame")) attach(root);
      root.querySelectorAll && root.querySelectorAll("iframe.holo-lc-embed, iframe.holo-video-frame").forEach(attach);
    } catch (e) {}
  };
  try {
    const mo = new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) scan(n); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  scan(document);
})();
