/* holo-appearance-boot.js — the pre-paint appearance resolver.
 *
 * A tiny SYNCHRONOUS classic script (no module, no await) that publishes the canonical
 * appearance onto <html> BEFORE the first frame paints, so every boot screen (splash · login ·
 * shell) and every app opens already wearing the chosen look — no flash of the wrong theme.
 *
 * It is the pre-paint twin of holo-theme.js's apply(): it reads the SAME state (holo.theme.v1)
 * and sets the SAME attributes/vars (data-holo-palette · data-holo-presentation ·
 * data-holo-immersive · color-scheme · --holo-wallpaper). The async engine re-applies identically
 * on load, so the first frame and the engine never disagree.
 *
 * index.html is never edited (the homepage stays as-is). Its upstream choice — stored as the
 * legacy key holo.gateway.mode (and splash's holo-splash:bg) — is migrated here ONCE into the
 * canonical holo.theme.v1, so the homepage's appearance flows down the boot chain for free.
 *
 * 100% W3C primitives: light-dark() is pinned via inline color-scheme (CSS Color Adjustment L1);
 * the palette/immersive hooks are plain data-attributes; the wallpaper is a custom property.
 */
(function () {
  "use strict";
  var KEY = "holo.theme.v1";
  var root = document.documentElement;

  function readState() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; }
  }

  // One-time migration from the upstream gateway / splash keys so the homepage's choice flows
  // down without editing index.html. Maps the three legacy values onto (palette, immersive):
  //   light → light palette · dark → dark palette · immersive|full → immersive backdrop on.
  function fromLegacy() {
    var v = null;
    try { v = localStorage.getItem("holo.gateway.mode") || localStorage.getItem("holo-splash:bg"); } catch (e) {}
    if (!v) return null;
    if (v === "light") return { palette: "light", immersive: false };
    if (v === "immersive" || v === "full" || v === "theme") return { palette: "dark", immersive: true, wallpaper: galaxyDefault() };
    if (v === "dark") return { palette: "dark", immersive: false };
    return null;
  }

  function wallUrl(w) {
    if (!w) return "";
    var m = String(w).match(/^(sha256|blake3|sha512):([0-9a-f]+)$/i);
    return m ? "/.holo/" + m[1].toLowerCase() + "/" + m[2] : String(w);
  }

  // The curated default is the Milky Way (Tiago Ferreira, Unsplash — a genuine 24MP master). It is
  // device-tiered exactly like the OS's own `uor` default (shell-main WALL_SEED): a 1080p/1440p/phone
  // panel seeds the 2560 rendition (≈1MB — instant first paint, offline-safe via the same-origin κ
  // store) at identical apparent crispness; only a 4K+/retina panel seeds the 24MP master. The
  // super-resolution lens (holo-immersive-backdrop) then projects whichever is pinned onto the TRUE
  // device-pixel grid (devicePixelRatio, up to ~8K), CAS-sharpened — retina-sharp on any screen.
  function galaxyDefault() {
    var big = false;
    try { big = (Math.max(screen.width || 0, screen.height || 0) * (window.devicePixelRatio || 1)) > 2560; } catch (e) {}
    return "/usr/share/wallpapers/" + (big ? "galaxy-8k.jpg" : "galaxy-2560.jpg");
  }

  // First-run default — a brand-new operator (no saved choice, no legacy key) lands on the immersive
  // Milky Way backdrop (the shared product default the messenger also wears via the same holo.theme.v1
  // key, so login · home · messenger match out of the box). Seeded ONCE into the canonical state so the
  // async engine (holo-theme.js) reads it as the saved choice and never overrides this frame. It is a
  // real path image, so we set --holo-wallpaper and every boot screen (splash · login · shell) opens
  // already wearing the photo.
  var FIRST_RUN = { palette: "dark", immersive: true, wallpaper: galaxyDefault() };

  var s = readState();
  if (!s) {
    var mig = fromLegacy();
    s = mig || FIRST_RUN;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  } else if (s.wallpaper == null && !("immersive" in s)) {
    // The gateway handoff pins only the palette into holo.theme.v1 ({palette:"dark"}), which leaves
    // the key non-null but never decides the wallpaper/immersive axis — so a brand-new operator who
    // came through the homepage would otherwise land on a blank backdrop. A real saved theme (written
    // by holo-theme.js) always carries an `immersive` key, so its absence uniquely marks this
    // palette-only seed: fill the wallpaper/immersive axis from the upstream gateway choice (or the
    // first-run default) so every new user still lands on the curated galaxy backdrop.
    var seed = fromLegacy() || FIRST_RUN;
    s.wallpaper = seed.wallpaper;
    s.immersive = seed.immersive;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }
  s = s || {};

  var palette = s.palette || "auto";
  var pinned = palette && palette !== "auto";
  if (pinned) {
    root.setAttribute("data-holo-palette", palette);
    root.style.setProperty("color-scheme", palette);   // pin light-dark() before paint
  }
  root.setAttribute("data-holo-presentation", s.presentation || "standard");
  root.setAttribute("data-holo-immersive", s.immersive ? "on" : "off");
  // A "live:<scene>" sentinel is a live backdrop (e.g. the Fluid sim), not an image: mark data-holo-live
  // (drives the pure-black baseline) and skip --holo-wallpaper. A real κ/path wallpaper sets the var.
  var liveM = String(s.wallpaper || "").match(/^live:([a-z0-9-]+)/i);
  if (liveM) { root.setAttribute("data-holo-live", liveM[1].toLowerCase()); }
  else if (s.wallpaper) { root.removeAttribute("data-holo-live"); root.style.setProperty("--holo-wallpaper", 'url("' + wallUrl(s.wallpaper) + '")'); }
})();
