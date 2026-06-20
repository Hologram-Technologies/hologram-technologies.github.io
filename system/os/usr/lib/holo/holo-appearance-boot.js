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
    if (v === "immersive" || v === "full" || v === "theme") return { palette: "dark", immersive: true, wallpaper: "/usr/share/wallpapers/galaxy.jpg" };
    if (v === "dark") return { palette: "dark", immersive: false };
    return null;
  }

  function wallUrl(w) {
    if (!w) return "";
    var m = String(w).match(/^(sha256|blake3|sha512):([0-9a-f]+)$/i);
    return m ? "/.holo/" + m[1].toLowerCase() + "/" + m[2] : String(w);
  }

  // First-run default — a brand-new operator (no saved choice, no legacy key) lands on the immersive
  // galaxy backdrop (the curated Milky Way, attributed Unsplash). Seeded ONCE into the canonical state
  // so the async engine (holo-theme.js) reads it as the saved choice and never overrides this frame.
  var FIRST_RUN = { palette: "dark", immersive: true, wallpaper: "/usr/share/wallpapers/galaxy.jpg" };

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
  if (s.wallpaper) root.style.setProperty("--holo-wallpaper", 'url("' + wallUrl(s.wallpaper) + '")');
})();
