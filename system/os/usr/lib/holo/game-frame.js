// game-frame.js — the presentation discipline EVERY hologram-native game adopts.
//
// Guarantees the game fills the host screen WITHOUT overflowing, at the device's
// real pixels, and exposes fullscreen — so a remaster is "fit to the device" by
// construction, not by hand-tuned CSS that drifts. It sizes the <canvas> in JS
// (immune to flex quirks and to engines like SDL that resize their own backing),
// CONTAINing it in its parent and re-fitting on resize / fullscreen / backing
// change. game-profile-witness.mjs checks every game page adopts this.
//
// Standards it realizes: CSSOM-View devicePixelRatio (host resolution),
// W3C Fullscreen API (max screen), WHATWG requestAnimationFrame (vsync pacing).
(function () {
  "use strict";

  function fit(canvas, displayAspect) {
    const stage = canvas.parentElement;
    if (!stage) return;
    const sw = stage.clientWidth, sh = stage.clientHeight;
    if (!sw || !sh) return;
    // aspect to PRESENT at: explicit (e.g. 4:3 CRT correction) or the backing's
    const aspect = displayAspect || ((canvas.width || 4) / (canvas.height || 3));
    let w = sw, h = Math.round(sw / aspect);
    if (h > sh) { h = sh; w = Math.round(sh * aspect); }   // CONTAIN: never exceed either axis
    canvas.style.position = "absolute";
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    canvas.style.left = Math.round((sw - w) / 2) + "px";
    canvas.style.top = Math.round((sh - h) / 2) + "px";
  }

  const GameFrame = {
    // attach(canvas, { aspect }) → keeps `canvas` fitted to its parent forever.
    attach(canvas, opts) {
      const aspect = opts && opts.aspect;
      const refit = () => fit(canvas, aspect);
      addEventListener("resize", refit, { passive: true });
      addEventListener("orientationchange", refit, { passive: true });
      document.addEventListener("fullscreenchange", refit);
      if (window.ResizeObserver) { try { new ResizeObserver(refit).observe(canvas.parentElement); } catch (e) {} }
      // engines (SDL/emscripten) can resize their own backing store — catch it.
      let lw = -1, lh = -1;
      setInterval(() => { if (canvas.width !== lw || canvas.height !== lh) { lw = canvas.width; lh = canvas.height; refit(); } }, 200);
      refit();
      return refit;
    },
    async fullscreen(el) {
      const t = el || document.documentElement;
      try { document.fullscreenElement ? await document.exitFullscreen() : await t.requestFullscreen(); } catch (e) {}
      try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock("landscape"); } catch (e) {}
    },
  };
  window.GameFrame = GameFrame;
})();
