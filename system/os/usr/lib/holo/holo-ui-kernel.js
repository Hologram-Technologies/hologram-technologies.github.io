// holo-ui-kernel.js — Holo UI: the ONE runtime namespace for every Hologram OS UI parameter.
//
// Holo UI replaces the "Holo Theme" brand as the single place to manage the look & feel — theme,
// typography, density, shape, golden-ratio proportion, window layout, icons, window decoration,
// platform feel and keyboard — but it is a FAÇADE, not a rewrite (ADR-0030). It aggregates the
// engines that already exist (HoloTheme · HoloPlatform · HoloZones) and adds the few parameters
// they lack, each reusing existing plumbing so there is ZERO new transport and ZERO breakage:
//   • the --holo-* CSS token contract, holo-theme.css, the postMessage protocol and the
//     localStorage holo.theme.* keys are untouched (every theme-* witness keeps passing);
//   • window.HoloTheme stays live as a back-compat alias; window.HoloUI is the unified API.
//
// The whole UI serialises to ONE object — a W3C Design-Tokens theme plus $extensions — that
// content-addresses to a holo://κ (Law L5): export/share your entire look as a link a peer
// re-derives. Pure DOM + Web Crypto, no framework, no CDN (Law L4).

(function () {
  "use strict";
  var W = window;
  if (W.HoloUI) return;
  var root = document.documentElement;
  var UIKEY = "holo.ui.v1";                  // the Holo-UI-only params (layout/icons/decoration/proportion)
  var ui = {};
  try { ui = JSON.parse(localStorage.getItem(UIKEY) || "{}") || {}; } catch (e) { ui = {}; }
  var saveUI = function () { try { localStorage.setItem(UIKEY, JSON.stringify(ui)); } catch (e) {} };
  var emit = function () { try { root.dispatchEvent(new CustomEvent("holo-ui-change", { detail: snapshot(), bubbles: false })); } catch (e) {} };

  // The engine. holo-theme.js is a classic script that registers synchronously; if a page loads
  // the kernel first, lazily inject it (the same self-bootstrap trick the engine itself uses).
  function ensureTheme() {
    if (W.HoloTheme) return Promise.resolve(W.HoloTheme);
    return new Promise(function (res) {
      var me = document.currentScript || document.querySelector('script[src*="holo-ui-kernel.js"]');
      var base = me ? me.src.replace(/holo-ui-kernel\.js.*$/, "") : "_shared/";
      var s = document.createElement("script"); s.src = base + "holo-theme.js";
      s.onload = function () { res(W.HoloTheme); };
      (document.head || root).appendChild(s);
    });
  }
  var T = function () { return W.HoloTheme; };
  var d = function (name) { return function () { var t = T(); return t && t[name] && t[name].apply(t, arguments); }; };

  // ── new parameters HoloTheme lacks — each reuses existing plumbing ────────────────
  // Shape: the DTCG radius group HoloThemeFormat already compiles to --holo-radius-*.
  function setRadius(px) {
    px = Math.max(0, parseInt(px, 10) || 0);
    return T().exportTheme().then(function (t) {
      t.radius = Object.assign({ $type: "dimension" }, t.radius,
        { sm: { $value: Math.max(2, px - 4) + "px" }, md: { $value: px + "px" }, lg: { $value: (px + 4) + "px" } });
      ui.radius = px; saveUI();
      return T().importTheme(t).then(function (r) { emit(); return r; });
    });
  }
  function getRadius() { return ui.radius != null ? ui.radius : (parseInt(getComputedStyle(root).getPropertyValue("--holo-radius"), 10) || 12); }

  // Window layout: bridge HoloZones; surface as data-holo-layout (the shell reads it, as applyLookAndFeel does).
  function setLayout(idOrTree) { ui.layout = idOrTree; root.setAttribute("data-holo-layout", typeof idOrTree === "string" ? idOrTree : "custom"); saveUI(); emit(); }
  function getLayout() { return ui.layout != null ? ui.layout : (root.getAttribute("data-holo-layout") || "floating"); }

  // Icons / window decoration: the same data-attributes applyLookAndFeel already sets.
  function setIcons(name) { ui.icons = name || ""; name ? root.setAttribute("data-holo-icons", name) : root.removeAttribute("data-holo-icons"); saveUI(); emit(); }
  function setDecoration(theme) { ui.decoration = theme || ""; theme ? root.setAttribute("data-holo-decoration", theme) : root.removeAttribute("data-holo-decoration"); saveUI(); emit(); }

  // Proportion tier (the φ system lives in holo-phi.css; the tier is a hint surfaced for the shell).
  var PHI = 1.618;
  function setProportionTier(tier) { ui.proportion = tier || "standard"; root.setAttribute("data-holo-proportion", ui.proportion); saveUI(); emit(); }

  // Platform feel (read-only profile; opt-in seeding never overrides an explicit user choice).
  function platform() { return (W.HoloPlatform && W.HoloPlatform.profileFor) ? W.HoloPlatform.profileFor(navigator) : null; }
  function applyPlatformDefaults() {
    var p = platform(); if (!p) return; var st = T().get();
    if (!st.accent && p.accent) T().setAccent(p.accent);
    if (!st.fontFamily && p.font) T().setFontFamily(p.font);
    emit();
  }

  // ── one content-addressed config object ───────────────────────────────────────────
  function snapshot() { var st = (T() && T().get()) ? T().get() : {}; return { theme: st, ui: { layout: getLayout(), icons: ui.icons || "", decoration: ui.decoration || "", proportion: ui.proportion || "standard", radius: getRadius() } }; }
  // The whole UI as a DTCG theme + the Holo-UI extension (a valid DTCG file; $extensions is ignored by the format).
  function exportProfile() {
    return T().exportTheme().then(function (t) {
      var st = T().get();
      t.$extensions = t.$extensions || {};
      t.$extensions["org.hologram.ui"] = {
        palette: st.palette, presentation: st.presentation, enforce: !!st.enforce,
        fontScale: st.fontScale, fontMin: st.fontMin, density: st.density,
        layout: getLayout(), icons: ui.icons || "", decoration: ui.decoration || "", proportion: ui.proportion || "standard",
      };
      return t;
    });
  }
  // Apply a whole Holo UI profile: theme + look-and-feel flow through the engine; then the UI block.
  function importProfile(obj) {
    if (typeof obj === "string") { try { obj = JSON.parse(obj); } catch (e) { return Promise.resolve({ ok: false, errors: ["invalid JSON: " + e.message] }); } }
    var u = (obj && obj.$extensions && obj.$extensions["org.hologram.ui"]) || null;
    return T().applyGlobalTheme(obj).then(function (res) {
      if (!res || !res.ok) return res;
      if (u) {
        if (u.palette) T().setPalette(u.palette);
        if (u.presentation) T().setPresentation(u.presentation);
        if (typeof u.enforce === "boolean") T().set({ enforce: u.enforce });
        if (typeof u.fontMin === "number") T().setFontMin(u.fontMin);
        if (u.layout) setLayout(u.layout);
        if (u.icons) setIcons(u.icons);
        if (u.decoration) setDecoration(u.decoration);
        if (u.proportion) setProportionTier(u.proportion);
      }
      emit();
      return { ok: true };
    });
  }
  // JCS-ish stable stringify → sha256 → holo://<hex>. The link is the verifiable NAME; the bytes
  // are the exported .tokens.json. (Resolving a pasted link via the omnibox is Phase 3.)
  function stable(x) {
    if (Array.isArray(x)) return "[" + x.map(stable).join(",") + "]";
    if (x && typeof x === "object") return "{" + Object.keys(x).sort().map(function (k) { return JSON.stringify(k) + ":" + stable(x[k]); }).join(",") + "}";
    return JSON.stringify(x);
  }
  function profileLink() {
    return exportProfile().then(function (t) {
      var bytes = new TextEncoder().encode(stable(t));
      if (!(W.crypto && W.crypto.subtle)) return null;
      return W.crypto.subtle.digest("SHA-256", bytes).then(function (buf) {
        var hex = Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
        return "holo://" + hex;
      });
    });
  }

  // ── the single control surface ──────────────────────────────────────────────────
  function centerUrl() {
    var me = document.currentScript || document.querySelector('script[src*="holo-ui-kernel.js"]');
    var base = me ? me.src.replace(/_shared\/holo-ui-kernel\.js.*$/, "") : "";
    return base + "holo-ui.html";
  }
  function openCenter() { var t = T(); if (t && t.openSettings && !W.HoloUILaunch) return t.openSettings(); if (W.HoloUILaunch) return W.HoloUILaunch.open(); location.href = centerUrl(); }
  function closeCenter() { var t = T(); if (t && t.closeSettings) t.closeSettings(); if (W.HoloUILaunch) W.HoloUILaunch.close(); }

  // Restore the Holo-UI params (icons/decoration/layout/proportion) on boot, like the engine restores the theme.
  function restore() {
    if (ui.icons) root.setAttribute("data-holo-icons", ui.icons);
    if (ui.decoration) root.setAttribute("data-holo-decoration", ui.decoration);
    if (ui.layout) root.setAttribute("data-holo-layout", typeof ui.layout === "string" ? ui.layout : "custom");
    if (ui.proportion) root.setAttribute("data-holo-proportion", ui.proportion);
  }

  W.HoloUI = {
    version: "0.1", PHI: PHI,
    ready: function () { return ensureTheme(); },
    get: snapshot,
    on: function (ev, fn) { root.addEventListener(ev, fn); }, off: function (ev, fn) { root.removeEventListener(ev, fn); },
    // color / palette / mode / accent (delegate)
    setPalette: d("setPalette"), setPresentation: d("setPresentation"), setAccent: d("setAccent"),
    importTheme: d("importTheme"), exportTheme: d("exportTheme"), clearTheme: d("clearTheme"),
    applyGlobalTheme: d("applyGlobalTheme"), getLookAndFeel: d("getLookAndFeel"), getThemeJson: d("getThemeJson"),
    // typography + fonts (delegate)
    setFontScale: d("setFontScale"), setFontMin: d("setFontMin"), setFontFamily: d("setFontFamily"),
    importFontFile: d("importFontFile"), addFont: d("addFont"), removeFont: d("removeFont"),
    loadFontCatalog: d("loadFontCatalog"), getFonts: d("getFonts"),
    // density + shape
    setDensity: d("setDensity"), setRadius: setRadius, getRadius: getRadius,
    // proportion · layout · icons · decoration · platform
    setProportionTier: setProportionTier, setLayout: setLayout, getLayout: getLayout,
    setIcons: setIcons, setDecoration: setDecoration, platform: platform, applyPlatformDefaults: applyPlatformDefaults,
    // enforcement + reset (delegate)
    set: d("set"), reset: d("reset"),
    get FONTS() { return T() ? T().FONTS : {}; }, get policy() { return T() ? T().policy : "adopt"; },
    // one content-addressed profile + the single surface
    exportProfile: exportProfile, importProfile: importProfile, profileLink: profileLink,
    openCenter: openCenter, closeCenter: closeCenter, centerUrl: centerUrl,
  };

  // ── route the one control surface through the constitutional conscience gate (ADR-033) ──────────
  // Every UI surface can call HoloUI.evaluate(decision) / HoloUI.evaluateText(text) and it delegates
  // to the FAIL-CLOSED, self-verifying conscience gate — the same constitution the build proved
  // consistent, enforced at the UI edge. It refuses until the gate re-derives the constitution to its
  // pinned κ (Law L5); a tampered rule keeps it sealed shut.
  W.HoloUI.evaluate = function () { return { outcome: "block", blocked: ["*"], caveats: [], sealed: false, reason: "conscience not yet loaded — fail closed" }; };
  W.HoloUI.evaluateText = W.HoloUI.evaluate;
  (function () {
    var me = document.currentScript || document.querySelector('script[src*="holo-ui-kernel.js"]');
    var base = me ? me.src.replace(/holo-ui-kernel\.js.*$/, "") : "_shared/";
    import(base + "holo-conscience.js")
      .then(function (C) { return C.installToSurface(W.HoloUI); })
      .then(function (ok) { try { root.dispatchEvent(new CustomEvent("holo-ui-conscience", { detail: { sealed: ok } })); } catch (e) {} })
      .catch(function () { /* gate unavailable ⇒ HoloUI.evaluate stays fail-closed */ });
  })();

  ensureTheme().then(function (t) { if (t) { t.openCenter = openCenter; restore(); emit(); } });
})();
