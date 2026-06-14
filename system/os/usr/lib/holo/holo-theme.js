// Holo Theme (holo-theme.js) — the Hologram OS theme runtime. Zero dependencies,
// content-addressable. A self-contained module: call it once and it brings its own
// stylesheet — <script src="…/holo-theme.js"></script> is the whole adoption.
// The lean OS service the brief calls a "unified runtime theme engine": it resolves the
// initial theme, applies it, persists the user's choice, and propagates live changes
// across the whole nested-holospace tree — instantly, no rebuild, no restart.
//
// W3C-native end to end: state is expressed only as CSS custom properties + the
// color-scheme/light-dark() palette attribute (holo-theme.css); transport is the HTML
// Standard's postMessage; the theme's identity is a κ artifact (ADR-022).
//
// Precedence model (see THEMING-W3C-ADR.md):
//   • USER accessibility (font scale, density, motion) — always wins. Applied here as
//     INLINE custom properties on :root, so it beats app stylesheets. enforce-os adds
//     !important so it beats app !important too.
//   • App vs OS aesthetics — negotiated. An app declares <meta name="holo-theme-policy"
//     content="own"> to keep its colors; default "adopt" lets it follow the OS palette
//     (apps that use the --holo-* tokens follow automatically; apps with private vars
//     resist until migrated — an honest limit, like canvas/VM surfaces).
//
// API (window.HoloTheme):
//   .get()                         → current state
//   .setPalette("auto"|"light"|"dark")
//   .setPresentation("standard"|"immersive")
//   .setFontScale(n)               → 0.85 … 1.4   (Settings › Display › Text size)
//   .setFontFamily(css-font-list)  → UI typeface  (Settings › Display › Typeface)
//   .setDensity(n) / .setAccent(c) / .reset()
//   .openSettings()                → the built-in Display settings panel (any surface)

(function () {
  "use strict";
  if (window.HoloTheme) return;

  // Bundled: bring our own stylesheet so adopting Holo Theme is a single <script> call.
  // A page may still pre-link holo-theme.css in <head> to avoid any flash — we skip
  // injection if it is already present.
  (function injectCss() {
    try {
      if (document.querySelector('link[href*="holo-theme.css"]')) return;
      var src = (document.currentScript && document.currentScript.src) || "";
      var href = /\/\.holo\/sha256\//.test(src) ? "/_shared/holo-theme.css" : src ? src.replace(/holo-theme\.js(\?.*)?$/, "holo-theme.css") : "_shared/holo-theme.css";
      var l = document.createElement("link"); l.rel = "stylesheet"; l.href = href;
      (document.head || document.documentElement).appendChild(l);
    } catch (e) {}
  })();

  // Resolve sibling shared files (to lazy-load the DTCG format module on demand).
  var SELF = (document.currentScript && document.currentScript.src) || "";
  // κ-routed (src is /.holo/sha256/<hex>.js): siblings can't be path-resolved → use the canonical _shared mount.
  var SHARED = /\/\.holo\/sha256\//.test(SELF) ? "/_shared/" : SELF ? SELF.replace(/holo-theme\.js(\?.*)?$/, "") : "_shared/";

  // Bootstrap the Holo UX experience layer (ADR-028): device-tier resolution, golden-ratio
  // proportion (holo-ux.js self-injects holo-phi.css), and propagation down the holospace tree.
  // Loading it from the theme runtime — which every Holo Theme / Holo UI citizen already loads
  // (the kernel injects it too) — makes every citizen a Holo UX citizen with NO per-app script
  // tag: one canonical wire (Law L2). Idempotent + additive (holo-ux.js guards its own effects).
  (function bootHoloUx() {
    try {
      if (window.HoloUX || document.querySelector('script[src*="holo-ux.js"]')) return;
      var s = document.createElement("script"); s.type = "module"; s.src = SHARED + "holo-ux.js";
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  })();

  // Bootstrap the Holo FX motion engine (the OS's faithful adoption of unicode-animations):
  // window.HoloFX — one sharp, content-addressed loading vocabulary (braille · scan · dna ·
  // cascade) for every surface. Same canonical wire as Holo UX (Law L2): every Holo Theme
  // citizen gets it with NO per-app script tag. Classic script (sets window.HoloFX), idempotent.
  (function bootHoloFx() {
    try {
      if (window.HoloFX || document.querySelector('script[src*="holo-fx.js"]')) return;
      var s = document.createElement("script"); s.src = SHARED + "holo-fx.js";
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  })();

  // Bootstrap the canonical κ→render path (window.HoloRender): the ONE lean, low-latency way every app
  // displays a content-addressed UOR object — resolve by κ (arena-cached), verify by re-derivation, mount
  // its ORIGINAL bytes (no compiler on the hot path). Same canonical wire as Holo UX / FX / Telemetry (Law
  // L2): every Holo Theme citizen gets it with NO per-app script tag. The renderer rides the substrate's
  // SINGLE resolver (resolveByKappa) + κ-route when present, else its own re-derive fallback (same L5 law).
  (function bootHoloRender() {
    try {
      if (window.HoloRender || window.__holoRenderBoot) return;
      window.__holoRenderBoot = 1;
      var code =
        'import HoloRender from "' + SHARED + 'holo-render.js";\n' +
        'const route = (h) => "/.holo/sha256/" + h;\n' +
        'let resolver;\n' +
        'try { const m = await import("/holo-resolver.mjs"); const store = new Map();\n' +
        '  const src = async (k) => { try { const r = await fetch(route(String(k).split(":").pop())); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch (e) { return null; } };\n' +
        '  resolver = (k) => m.resolveByKappa(k, [src], store); } catch (e) {}\n' +
        'try { await HoloRender.configure({ base: "/", route, resolver }); window.HoloRender = HoloRender;\n' +
        '  (document.documentElement || document).dispatchEvent(new Event("holo-render-ready")); } catch (e) { console.warn("holo-render boot:", e); }\n';
      var s = document.createElement("script"); s.type = "module"; s.textContent = code;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  })();

  // Clean chrome (Law L2, one universal wire): the OS injects a row of per-app floating "chrome" tiles
  // (Open Holo UI · capture-a-thought · go-live · capture-screen · manage). They clutter every app's
  // surface; remove them OS-wide for the cleanest UX. One CSS rule applies in every app that loads the
  // engine — no per-app edit. These actions remain reachable from the shell/dock, not over each app.
  (function bootCleanChrome() {
    try {
      if (document.getElementById("holo-clean-chrome")) return;
      var s = document.createElement("style"); s.id = "holo-clean-chrome";
      s.textContent = "#holo-themedash-btn,#holo-notepad-btn,#holo-stream-btn,#holo-capture-btn,#holo-manage-btn{display:none!important}";
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  })();

  // Bootstrap the Remix layer (window.HoloEdit): right-click any κ-object → Inspect · Edit · Share · Move ·
  // Hide · Delete; an edit forks a NEW κ (auto-persisted, re-derivable, shareable). Same canonical wire as
  // UX / FX / Render (Law L2): the shell — the container for every app — and every app inherit it with NO
  // per-app tag, and agents get the identical powers via window.HoloEdit.api. Idempotent (it self-guards).
  (function bootHoloEdit() {
    try {
      if (window.HoloEdit || document.querySelector('script[src*="holo-edit.js"]')) return;
      var s = document.createElement("script"); s.defer = true; s.src = SHARED + "holo-edit.js";
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  })();

  // Bootstrap Holo Telemetry (ADR-0073): system-wide observability native to the substrate — the
  // OpenTelemetry data model + W3C Trace Context as content-addressed UOR objects (window.HoloTelemetry).
  // Same canonical wire as Holo UX / FX (Law L2): every Holo Theme citizen gets it with NO per-app script
  // tag. The module self-registers on holo-app-ready; once ready, a tiny PerformanceObserver BRIDGE turns
  // the existing perf marks/measures every app already emits into local spans — instrumentation with no
  // per-app code. Telemetry stays LOCAL by default (Law L1); nothing is exported without an explicit,
  // conscience-gated consent. Idempotent + additive (the module guards its own effects).
  (function bootHoloTelemetry() {
    try {
      if (window.HoloTelemetry || document.querySelector('script[src*="holo-telemetry.mjs"]')) return;
      var s = document.createElement("script"); s.type = "module"; s.src = SHARED + "holo-telemetry.mjs";
      (document.head || document.documentElement).appendChild(s);
      // the one canonical bridge: existing PerformanceObserver "measure" entries → local spans. Best-effort,
      // gated by reduced-data-cost intent and never exporting — pure local self-observation.
      var bridge = function () {
        try {
          if (!window.HoloTelemetry || window.__holoTelemetryBridge) return;
          window.__holoTelemetryBridge = true;
          if (typeof PerformanceObserver === "undefined") return;
          var tr = window.HoloTelemetry.tracer("perf", "1.0");
          var po = new PerformanceObserver(function (list) {
            for (var i = 0; i < list.getEntries().length; i++) {
              var e = list.getEntries()[i];
              try { tr.startSpan(e.name, { kind: "internal", attributes: { entryType: e.entryType }, start: e.startTime })
                .end({ end: e.startTime + (e.duration || 0) }); } catch (x) {}
            }
          });
          po.observe({ entryTypes: ["measure"] });
        } catch (x) {}
      };
      if (window.HoloTelemetry) bridge();
      else if (document.documentElement) document.documentElement.addEventListener("holo-telemetry-ready", bridge, { once: true });
    } catch (e) {}
  })();

  var KEY = "holo.theme.v1";            // one OS-wide choice, shared same-origin
  var TKEY = "holo.theme.tokens.v1";    // imported DTCG theme (JSON)
  var CKEY = "holo.theme.tokens.css.v1";// its compiled CSS (fast init, no format module)
  var FKEY = "holo.theme.fonts.v1";     // the live font registry (catalog + imported), JSON
  var FCKEY = "holo.theme.fonts.css.v1";// its compiled @font-face CSS (fast init)
  var LKEY = "holo.theme.lookandfeel.v1";// the active Global Theme's look-and-feel block (JSON)
  var themeJson = null;                 // the active custom theme (DTCG), if any
  var lookAndFeel = null;               // the active Global Theme's look-and-feel (icons/decoration/layout…)
  var userFonts = [];                   // registered fonts: [{family, category, stack, faces, origin}]
  var _catalog = null;                  // the κ-pinned font library (fonts/index.json), lazy

  // ── Portable themes (DTCG ⇄ CSS via holo-theme-format.js) ────────────────────────
  // A theme is injected as a <style id="holo-theme-tokens"> block (unlayered → it beats
  // holo-theme.css's layered defaults; the engine's inline user overrides still win).
  function injectTokens(cssText) {
    var s = document.getElementById("holo-theme-tokens");
    if (cssText == null || cssText === "") { if (s) s.remove(); return; }
    if (!s) { s = document.createElement("style"); s.id = "holo-theme-tokens"; (document.head || document.documentElement).appendChild(s); }
    s.textContent = cssText;
  }
  function loadFormat() {
    return new Promise(function (res, rej) {
      if (globalThis.HoloThemeFormat) return res(globalThis.HoloThemeFormat);
      var s = document.createElement("script");
      s.src = SHARED + "holo-theme-format.js";
      s.onload = function () { res(globalThis.HoloThemeFormat); };
      s.onerror = function () { rej(new Error("could not load holo-theme-format.js")); };
      (document.head || document.documentElement).appendChild(s);
    });
  }
  function broadcastTokens(css, json) {
    var msg = { type: "holo-theme-tokens", css: css, json: json };
    childFrames().forEach(function (w) { try { w.postMessage(msg, "*"); } catch (e) {} });
  }
  // Import a DTCG theme (object or JSON string): validate → compile → apply → persist → broadcast.
  function importTheme(json, opts) {
    opts = opts || {};
    return loadFormat().then(function (F) {
      if (!F) return { ok: false, errors: ["format module unavailable"] };
      if (typeof json === "string") { try { json = JSON.parse(json); } catch (e) { return { ok: false, errors: ["invalid JSON: " + e.message] }; } }
      var v = F.validate(json); if (!v.ok) return v;
      var css; try { css = F.toCss(json); } catch (e) { return { ok: false, errors: [String(e.message || e)] }; }
      themeJson = json; injectTokens(css);
      if (opts.persist !== false) { try { localStorage.setItem(TKEY, JSON.stringify(json)); localStorage.setItem(CKEY, css); } catch (e) {} }
      apply();
      if (opts.broadcast !== false) broadcastTokens(css, json);
      root.dispatchEvent(new CustomEvent("holo-theme-change", { detail: state, bubbles: false }));
      return { ok: true };
    });
  }
  // Apply a Holo GLOBAL THEME (a KDE Look-and-Feel package adopted as one κ-object): it IS a
  // DTCG theme (color + font + radius), so its visual layer flows through importTheme unchanged —
  // Holo Theme stays the single source of truth (ADR-023). The package's $extensions
  // "org.hologram.lookandfeel" block (icons · window decoration · layout · splash · cursor) is
  // surfaced for the shell as data-attributes + a holo-lookandfeel-change event, and persisted.
  function applyGlobalTheme(gt, opts) {
    opts = opts || {};
    if (typeof gt === "string") { try { gt = JSON.parse(gt); } catch (e) { return Promise.resolve({ ok: false, errors: ["invalid JSON: " + e.message] }); } }
    var laf = (gt && gt.$extensions && gt.$extensions["org.hologram.lookandfeel"]) || null;
    return importTheme(gt, opts).then(function (res) {
      if (!res.ok) return res;
      applyLookAndFeel(laf, opts);
      return { ok: true, lookAndFeel: laf };
    });
  }
  function applyLookAndFeel(laf, opts) {
    opts = opts || {};
    lookAndFeel = laf;
    if (laf && laf.icons) root.setAttribute("data-holo-icons", laf.icons); else root.removeAttribute("data-holo-icons");
    var deco = laf && laf.decoration && (laf.decoration.theme || laf.decoration);
    if (deco) root.setAttribute("data-holo-decoration", deco); else root.removeAttribute("data-holo-decoration");
    if (laf && laf.layout) root.setAttribute("data-holo-layout", laf.layout); else root.removeAttribute("data-holo-layout");
    if (opts.persist !== false) { try { if (laf) localStorage.setItem(LKEY, JSON.stringify(laf)); else localStorage.removeItem(LKEY); } catch (e) {} }
    root.dispatchEvent(new CustomEvent("holo-lookandfeel-change", { detail: laf, bubbles: false }));
  }
  function readVars() {
    var cs = getComputedStyle(root), out = {};
    ["--holo-bg", "--holo-surface", "--holo-surface-2", "--holo-border", "--holo-ink", "--holo-ink-dim",
     "--holo-accent", "--holo-accent-ink", "--holo-ok", "--holo-warn", "--holo-danger",
     "--holo-font-sans", "--holo-font-serif", "--holo-font-mono", "--holo-font-scale",
     "--holo-radius-sm", "--holo-radius", "--holo-radius-lg", "--holo-density"
    ].forEach(function (n) { out[n] = cs.getPropertyValue(n).trim(); });
    return out;
  }
  // Export the current theme as a DTCG token object (the shareable artifact). WYSIWYG:
  // reads the LIVE custom properties (base theme + any user tweaks), and carries over the
  // imported theme's metadata + web fonts so nothing is lost.
  function exportTheme(meta) {
    return loadFormat().then(function (F) {
      if (!F) return null;
      var ext = themeJson && themeJson.$extensions && themeJson.$extensions["org.hologram.theme"];
      var t = F.fromVars(readVars(), meta || (ext ? { name: ext.name, author: ext.author } : { name: "My Hologram theme" }));
      if (themeJson) {
        if (themeJson.$description) t.$description = themeJson.$description;
        if (themeJson.font && themeJson.font.face) t.font.face = themeJson.font.face;
        if (themeJson.font && themeJson.font.variation) t.font.variation = themeJson.font.variation;
      }
      return t;
    });
  }
  function clearTheme() { themeJson = null; injectTokens(""); try { localStorage.removeItem(TKEY); localStorage.removeItem(CKEY); localStorage.removeItem(KKEY); } catch (e) {} applyLookAndFeel(null, {}); broadcastTokens("", null); apply(); }

  // ── κ-addressed theme catalog — themes as content-addressed, self-verifying UOR objects ─────────
  // A theme is a DTCG object served at /_shared/themes/<file>; its identity is κ = sha256 of its bytes.
  // setThemeByKappa fetches it, RE-DERIVES sha256, refuses on mismatch (Law L5), then applies it live.
  var _themes = null;             // cached themes/index.json entries
  var KKEY = "holo.theme.kappa.v1";  // the active κ-theme (so the studio can highlight it)
  function listThemes() {
    if (_themes) return Promise.resolve(_themes);
    return fetch(SHARED + "themes/index.json").then(function (r) { return r.ok ? r.json() : { themes: [] }; })
      .then(function (j) { _themes = (j && j.themes) || []; return _themes; })
      .catch(function () { _themes = []; return _themes; });
  }
  function sha256Hex(buf) {
    if (!(globalThis.crypto && crypto.subtle)) return Promise.resolve(null);
    return crypto.subtle.digest("SHA-256", buf).then(function (d) {
      var b = new Uint8Array(d), s = ""; for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0"); return s;
    });
  }
  function setThemeByKappa(kappa) {
    var want = String(kappa).replace(/^sha256:/, "");
    return listThemes().then(function (themes) {
      var t = themes.filter(function (x) { return x.kappa === "sha256:" + want || x.kappa === kappa || x.name === kappa; })[0];
      if (!t) return { ok: false, errors: ["unknown theme " + kappa] };
      return fetch(SHARED + "themes/" + t.file).then(function (r) { return r.ok ? r.arrayBuffer() : Promise.reject(new Error("theme fetch failed")); })
        .then(function (buf) {
          return sha256Hex(buf).then(function (hex) {
            // self-verify: the bytes must re-derive the claimed κ (Law L5). null = no SubtleCrypto (file://) → skip.
            var hexWant = t.kappa.replace(/^sha256:/, "");
            if (hex && hex !== hexWant) return { ok: false, errors: ["κ mismatch — theme bytes do not re-derive (Law L5)"] };
            var json; try { json = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { return { ok: false, errors: ["invalid theme JSON"] }; }
            // Applying a theme hands AESTHETIC governance to it: clear any ad-hoc accent/typeface
            // override so the theme's own tokens win (accessibility — font scale/min/density — is kept).
            if (state.accent || state.fontFamily) set({ accent: "", fontFamily: "" });
            return importTheme(json).then(function (res) { if (res.ok) { try { localStorage.setItem(KKEY, t.kappa); } catch (e) {} } return res; });
          });
        });
    }).catch(function (e) { return { ok: false, errors: [String(e.message || e)] }; });
  }
  function setTheme(nameOrKappa) {
    return listThemes().then(function (themes) {
      var t = themes.filter(function (x) { return x.kappa === nameOrKappa || x.name === nameOrKappa || x.file === nameOrKappa; })[0];
      return t ? setThemeByKappa(t.kappa) : { ok: false, errors: ["unknown theme " + nameOrKappa] };
    });
  }
  function activeThemeKappa() { try { return localStorage.getItem(KKEY) || null; } catch (e) { return null; } }

  var root = document.documentElement;
  var isTop = (window.parent === window);
  var policy = (document.querySelector('meta[name="holo-theme-policy"]') || {}).content || "adopt";

  // Built-in typeface presets the Settings panel offers (all standards-only font lists).
  var FONTS = {
    "Helvetica Neue": '"Helvetica Neue", Helvetica, Arial, "Segoe UI", Roboto, system-ui, sans-serif',
    System: 'system-ui, -apple-system, "Segoe UI", Roboto, Inter, "Helvetica Neue", Arial, sans-serif',
    Humanist: 'Inter, "Segoe UI", Roboto, system-ui, sans-serif',
    Serif: 'ui-serif, Georgia, "Times New Roman", serif',
    Mono: 'ui-monospace, "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace',
    Readable: 'Atkinson Hyperlegible, "Comic Neue", Verdana, system-ui, sans-serif' // dyslexia-friendly fallbacks
  };

  var DEFAULTS = {
    palette: "auto",            // auto = follow prefers-color-scheme (Media Queries L5)
    presentation: "standard",
    fontScale: 1,
    fontMin: 16,                // readability FLOOR in px (0 = off). The whole rem ramp clamps up to it.
    fontFamily: "",             // "" = OS default (--holo-font-sans from holo-theme.css)
    density: 1,
    accent: "",                 // "" = OS default
    enforce: false              // user "enforce OS theme on every app" switch
  };

  function read() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || "{}")); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }

  var state = read();

  function clamp(n, lo, hi) { n = parseFloat(n); return isNaN(n) ? lo : Math.min(hi, Math.max(lo, n)); }

  // Apply the current state to THIS document using only W3C primitives.
  function apply() {
    var prio = state.enforce ? "important" : "";       // enforce-os = user beats app !important
    var pushAesthetic = (policy !== "own") || state.enforce;
    var pinned = state.palette && state.palette !== "auto";

    // Palette: data attribute (for CSS hooks / app reaction) + INLINE color-scheme.
    // Inline is required — a layered @layer rule would lose to an app's UNLAYERED
    // `color-scheme` (e.g. the shell's `:root{color-scheme:dark}`). For "own" apps we
    // leave their own scheme untouched (unless the user chose enforce-os).
    if (pinned) root.setAttribute("data-holo-palette", state.palette);
    else root.removeAttribute("data-holo-palette");
    root.setAttribute("data-holo-presentation", state.presentation || "standard");
    if (pushAesthetic) root.style.setProperty("color-scheme", pinned ? state.palette : "light dark", prio);
    else root.style.removeProperty("color-scheme");

    // Shoelace (Web Awesome) activates dark tokens via a class — follow the resolved palette.
    if (pushAesthetic) {
      var dark = pinned ? (state.palette === "dark")
        : !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("sl-theme-dark", dark);
    }

    // Accessibility (always applied, even to "own" apps) — inline custom props win.
    setVar("--holo-font-scale", clamp(state.fontScale, 0.7, 2), prio);
    setVar("--holo-density", clamp(state.density, 0.7, 1.4), prio);
    // Readability floor: the type ramp + root font-size clamp UP to this (holo-theme.css /
    // holo-mobile.css use max(--holo-font-min, …)). 0 = off → no floor. px units required.
    setVar("--holo-font-min", clamp(state.fontMin, 0, 28) + "px", prio);

    // Aesthetics — applied unless this surface owns its theme (then only enforce-os pushes).
    if (pushAesthetic && state.fontFamily) setVar("--holo-font-sans", state.fontFamily, prio);
    else if (!state.fontFamily) root.style.removeProperty("--holo-font-sans");
    if (pushAesthetic && state.accent) setVar("--holo-accent", state.accent, prio);
    else if (!state.accent) root.style.removeProperty("--holo-accent");
  }
  function setVar(name, val, prio) { root.style.setProperty(name, val, prio || ""); }

  // ── Propagation across the nested-holospace tree (postMessage) ───────────────────
  function childFrames() {
    var out = [];
    var ifr = document.getElementsByTagName("iframe");
    for (var i = 0; i < ifr.length; i++) if (ifr[i].contentWindow) out.push(ifr[i].contentWindow);
    return out;
  }
  function broadcastDown() {
    var msg = { type: "holo-theme", state: state };
    childFrames().forEach(function (w) { try { w.postMessage(msg, "*"); } catch (e) {} });
  }

  // ── Font registry — fonts as first-class, content-addressed citizens ─────────────
  // Imported and catalog fonts are injected as a <style id="holo-user-fonts"> block of
  // @font-face rules (separate from a DTCG theme, so fonts and palettes are independent).
  // An IMPORTED font's bytes ride inline as a data: URL, so the SAME CSS string propagates
  // to every isolated holospace and each document loads it locally — no server route, no
  // cross-origin fetch. A CATALOG font uses its κ path URL (smaller). Identical transport
  // to themes: postMessage down the nested tree (HTML Standard).
  function injectFonts(cssText) {
    var s = document.getElementById("holo-user-fonts");
    if (cssText == null || cssText === "") { if (s) s.remove(); return; }
    if (!s) { s = document.createElement("style"); s.id = "holo-user-fonts"; (document.head || document.documentElement).appendChild(s); }
    s.textContent = cssText;
  }
  function buildFontsCss(list) {
    var F = globalThis.HoloThemeFormat; if (!F) return "";
    return (list || []).map(function (d) { return F.faceCss(d.faces); }).filter(Boolean).join("\n");
  }
  function broadcastFonts(css, list) {
    var msg = { type: "holo-fonts", css: css, list: list };
    childFrames().forEach(function (w) { try { w.postMessage(msg, "*"); } catch (e) {} });
  }
  function quoteFamily(f) { return (/\s/.test(f) && !/^["']/.test(f)) ? '"' + f + '"' : f; }
  function fontStack(desc) {
    if (desc.stack && desc.stack.length) return desc.stack.map(quoteFamily).join(", ");
    var fb = desc.category === "mono" ? 'ui-monospace, "Cascadia Code", Menlo, monospace'
      : desc.category === "serif" ? 'ui-serif, Georgia, "Times New Roman", serif'
      : 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    return quoteFamily(desc.family) + ", " + fb;
  }
  // Preload the ACTIVE registered font's primary path src (a data: URL is already inline,
  // so it needs none). For local κ fonts this removes the font-display:swap flash — the
  // "magical, instant" feel comes from preload, not swap.
  function preloadActive() {
    try {
      var ex = document.getElementById("holo-font-preload"); if (ex) ex.remove();
      var fam = (state.fontFamily || "").split(",")[0].replace(/^\s*["']?|["']?\s*$/g, "");
      if (!fam) return;
      var d = userFonts.filter(function (x) { return x.family === fam; })[0]; if (!d) return;
      var face = (d.faces || [])[0]; if (!face || !face.src) return;
      var m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(face.src); var url = m && m[1];
      if (!url || /^data:/.test(url)) return;
      var l = document.createElement("link");
      l.id = "holo-font-preload"; l.rel = "preload"; l.as = "font"; l.type = "font/woff2";
      l.crossOrigin = "anonymous"; l.href = url;
      (document.head || document.documentElement).appendChild(l);
    } catch (e) {}
  }
  // Register a font {family, faces:[…], category?, stack?, origin?}. Dedupes by family.
  function addFont(desc, opts) {
    opts = opts || {};
    return loadFormat().then(function (F) {
      if (!F) return { ok: false, errors: ["format module unavailable"] };
      if (!desc || !desc.family || !Array.isArray(desc.faces) || !desc.faces.length) return { ok: false, errors: ["a font needs a family and at least one face"] };
      userFonts = userFonts.filter(function (x) { return x.family !== desc.family; }).concat([desc]);
      var css = buildFontsCss(userFonts); injectFonts(css);
      if (opts.persist !== false) { try { localStorage.setItem(FKEY, JSON.stringify(userFonts)); localStorage.setItem(FCKEY, css); } catch (e) {} }
      if (opts.broadcast !== false) broadcastFonts(css, userFonts);
      if (opts.activate !== false) setFontFamily(fontStack(desc));   // setFontFamily also broadcasts state
      preloadActive();
      root.dispatchEvent(new CustomEvent("holo-theme-change", { detail: state, bubbles: false }));
      return { ok: true, family: desc.family };
    });
  }
  function removeFont(family) {
    userFonts = userFonts.filter(function (x) { return x.family !== family; });
    var css = buildFontsCss(userFonts); injectFonts(css);
    try { localStorage.setItem(FKEY, JSON.stringify(userFonts)); localStorage.setItem(FCKEY, css); } catch (e) {}
    broadcastFonts(css, userFonts);
    preloadActive();
  }
  // Import a raw font File → registry descriptor (bytes inline as data: URL) → register + activate.
  function importFontFile(file) {
    return new Promise(function (resolve) {
      if (!file) return resolve({ ok: false, errors: ["no file"] });
      file.arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf), bin = "", CH = 0x8000;
        for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        var base64 = btoa(bin);
        loadFormat().then(function (F) {
          if (!F) return resolve({ ok: false, errors: ["format module unavailable"] });
          var desc; try { desc = F.importDescriptor({ filename: file.name, base64: base64, mime: file.type }); }
          catch (e) { return resolve({ ok: false, errors: [String(e.message || e)] }); }
          addFont(desc, { activate: true }).then(resolve);
        });
      }, function (e) { resolve({ ok: false, errors: [String(e)] }); });
    });
  }
  // The κ-pinned font library (fonts/index.json) — one-click add. Lazy + cached.
  function loadCatalog() {
    if (_catalog) return Promise.resolve(_catalog);
    return fetch(SHARED + "fonts/index.json").then(function (r) { return r.ok ? r.json() : { fonts: [] }; })
      .then(function (j) { _catalog = j || { fonts: [] }; return _catalog; })
      .catch(function () { _catalog = { fonts: [] }; return _catalog; });
  }
  function catalogToDesc(e) {
    return {
      family: e.family, category: e.category || "sans", stack: e.stack, origin: "catalog",
      faces: (e.faces || []).map(function (f) {
        return { family: e.family, src: f.src, weight: f.weight || "100 900", style: f.style || "normal", display: f.display || "swap", unicodeRange: f.unicodeRange };
      })
    };
  }

  function set(patch, opts) {
    opts = opts || {};
    Object.assign(state, patch);
    apply();
    if (opts.persist !== false) write(state);
    if (opts.broadcast !== false) broadcastDown();
    root.dispatchEvent(new CustomEvent("holo-theme-change", { detail: state, bubbles: false }));
  }

  // Receive from parent; re-broadcast to our own children (transitive nesting).
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "holo-theme" && d.state) {
      state = Object.assign({}, DEFAULTS, d.state);
      apply(); write(state); broadcastDown();
    } else if (d.type === "holo-theme-tokens") {
      // A custom DTCG theme arrived from the parent — inject + persist + propagate down.
      themeJson = d.json || null; injectTokens(d.css);
      try { if (d.json) { localStorage.setItem(TKEY, JSON.stringify(d.json)); localStorage.setItem(CKEY, d.css || ""); } else { localStorage.removeItem(TKEY); localStorage.removeItem(CKEY); } } catch (err) {}
      apply(); broadcastTokens(d.css, d.json);
    } else if (d.type === "holo-fonts") {
      // Registered fonts arrived from the parent — inject the @font-face block (bytes ride
      // inline for imports) + persist + propagate down. No format module needed: css is compiled.
      userFonts = Array.isArray(d.list) ? d.list : [];
      injectFonts(d.css || "");
      try { if (userFonts.length) { localStorage.setItem(FKEY, JSON.stringify(userFonts)); localStorage.setItem(FCKEY, d.css || ""); } else { localStorage.removeItem(FKEY); localStorage.removeItem(FCKEY); } } catch (err) {}
      preloadActive(); broadcastFonts(d.css, userFonts);
    } else if (d.type === "holo-theme-hello" && e.source) {
      // A freshly-mounted child asks for the current theme; answer state + custom tokens + fonts.
      try { e.source.postMessage({ type: "holo-theme", state: state }, "*"); } catch (err) {}
      var sEl = document.getElementById("holo-theme-tokens");
      if (sEl && themeJson) { try { e.source.postMessage({ type: "holo-theme-tokens", css: sEl.textContent, json: themeJson }, "*"); } catch (err) {} }
      var fEl = document.getElementById("holo-user-fonts");
      if (fEl && userFonts.length) { try { e.source.postMessage({ type: "holo-fonts", css: fEl.textContent, list: userFonts }, "*"); } catch (err) {} }
    }
  });

  // ── Initial theme: saved choice → (else) system preference → (else) OS default ───
  // Restore a previously imported custom theme first (fast path: compiled CSS, no format module).
  try {
    var savedCss = localStorage.getItem(CKEY);
    if (savedCss) { injectTokens(savedCss); themeJson = JSON.parse(localStorage.getItem(TKEY) || "null"); }
    var savedLaf = localStorage.getItem(LKEY);
    if (savedLaf) applyLookAndFeel(JSON.parse(savedLaf), { persist: false });
  } catch (e) {}
  // Restore registered fonts (fast path: compiled @font-face CSS, no format module).
  try {
    var savedFonts = localStorage.getItem(FCKEY);
    if (savedFonts) { injectFonts(savedFonts); userFonts = JSON.parse(localStorage.getItem(FKEY) || "[]"); }
  } catch (e) {}
  apply();
  preloadActive();
  // Re-resolve when the system appearance changes while we're in "auto".
  if (window.matchMedia) {
    try {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      var onSys = function () { if (state.palette === "auto") apply(); };
      if (mq.addEventListener) mq.addEventListener("change", onSys);
      else if (mq.addListener) mq.addListener(onSys);
    } catch (e) {}
  }
  // Ask the parent holospace for the OS-wide theme (covers mount-timing for nested apps).
  if (!isTop) { try { window.parent.postMessage({ type: "holo-theme-hello" }, "*"); } catch (e) {} }
  // When new child frames load, push the current theme + custom tokens + fonts to them.
  document.addEventListener("load", function (e) {
    if (e.target && e.target.tagName === "IFRAME" && e.target.contentWindow) {
      var w = e.target.contentWindow;
      try { w.postMessage({ type: "holo-theme", state: state }, "*"); } catch (err) {}
      var sEl = document.getElementById("holo-theme-tokens");
      if (sEl && themeJson) { try { w.postMessage({ type: "holo-theme-tokens", css: sEl.textContent, json: themeJson }, "*"); } catch (err) {} }
      var fEl = document.getElementById("holo-user-fonts");
      if (fEl && userFonts.length) { try { w.postMessage({ type: "holo-fonts", css: fEl.textContent, list: userFonts }, "*"); } catch (err) {} }
    }
  }, true);

  // ── Built-in Display settings panel — usable from any surface (the OS shell wires a
  //    button to it). Pure DOM, themed by the very tokens it edits. ────────────────
  function openSettings() {
    if (document.getElementById("holo-theme-panel")) { closeSettings(); return; }
    var css = document.createElement("style");
    css.id = "holo-theme-panel-css";
    css.textContent =
      '#holo-theme-scrim{position:fixed;inset:0;z-index:2147482500;background:#0008;backdrop-filter:blur(2px)}' +
      '#holo-theme-panel{position:fixed;z-index:2147482600;top:0;right:0;height:100%;width:min(360px,92vw);' +
      'background:var(--holo-surface,#14161b);color:var(--holo-ink,#e6edf3);border-left:1px solid var(--holo-border,#23272f);' +
      'box-shadow:-12px 0 40px #0006;display:flex;flex-direction:column;font-family:var(--holo-font-sans);overflow:auto;container-type:inline-size;container-name:holopanel}' +
      '@container holopanel (max-width:300px){#holo-theme-panel .seg button{flex:1 1 100%}}' +
      '#holo-theme-panel h2{font-size:var(--holo-text-lg,1.15rem);margin:0;padding:18px 20px;border-bottom:1px solid var(--holo-border,#23272f);display:flex;justify-content:space-between;align-items:center}' +
      '#holo-theme-panel .grp{padding:16px 20px;border-bottom:1px solid var(--holo-border,#23272f);display:flex;flex-direction:column;gap:10px}' +
      '#holo-theme-panel label{font-size:var(--holo-text-sm,.85rem);color:var(--holo-ink-dim,#8b949e)}' +
      '#holo-theme-panel .seg{display:flex;gap:6px;flex-wrap:wrap}' +
      '#holo-theme-panel .seg button{flex:1 1 auto;min-height:40px;border:1px solid var(--holo-border,#23272f);background:transparent;color:inherit;border-radius:10px;cursor:pointer;font:inherit;font-size:var(--holo-text-sm,.85rem)}' +
      '#holo-theme-panel .seg button[aria-pressed="true"]{background:var(--holo-accent,#5b8cff);color:var(--holo-accent-ink,#fff);border-color:transparent}' +
      '#holo-theme-panel input[type=range]{width:100%}' +
      '#holo-theme-panel select,#holo-theme-panel input[type=color]{width:100%;min-height:40px;background:var(--holo-surface-2,#181b21);color:inherit;border:1px solid var(--holo-border,#23272f);border-radius:10px;padding:0 10px;font:inherit}' +
      '#holo-theme-panel .x{min-width:40px;min-height:40px;border:0;background:transparent;color:inherit;font-size:1.3rem;cursor:pointer}' +
      '#holo-theme-panel .sample{font-size:var(--holo-text,1rem);line-height:1.5}' +
      '#holo-theme-panel .reset{margin:16px 20px;min-height:44px;border:1px solid var(--holo-border,#23272f);background:transparent;color:inherit;border-radius:10px;cursor:pointer;font:inherit}';
    document.head.appendChild(css);

    var scrim = el("div", { id: "holo-theme-scrim" });
    scrim.onclick = closeSettings;
    var lastFocus = document.activeElement;   // restored on close (WCAG 2.4.3)
    var p = el("aside", { id: "holo-theme-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "holo-theme-title", tabindex: "-1" });

    var seg = function (label, opts, cur, on) {
      var g = el("div", { class: "grp" }); g.appendChild(el("label", {}, label));
      var s = el("div", { class: "seg" });
      opts.forEach(function (o) {
        var b = el("button", { "aria-pressed": String(o[1] === cur) }, o[0]);
        b.onclick = function () { on(o[1]); refresh(); };
        s.appendChild(b);
      });
      g.appendChild(s); return g;
    };

    function refresh() {
      // re-render by closing + reopening keeps it tiny; state already applied live.
      var sc = p.scrollTop; p.innerHTML = ""; build(); p.scrollTop = sc; p.focus();
    }
    function build() {
      var head = el("h2", { id: "holo-theme-title" }, "Holo UI");
      var x = el("button", { class: "x", "aria-label": "Close" }, "×"); x.onclick = closeSettings;
      head.appendChild(x); p.appendChild(head);

      p.appendChild(seg("Appearance", [["Auto", "auto"], ["Light", "light"], ["Dark", "dark"]], state.palette, function (v) { setPalette(v); }));
      p.appendChild(seg("Mode", [["Standard", "standard"], ["Immersive", "immersive"]], state.presentation, function (v) { setPresentation(v); }));

      // Text size
      var gT = el("div", { class: "grp" });
      gT.appendChild(el("label", {}, "Text size — " + Math.round(state.fontScale * 100) + "%"));
      var rng = el("input", { type: "range", min: "0.85", max: "1.4", step: "0.05", value: String(state.fontScale) });
      rng.oninput = function () { setFontScale(this.value); gT.firstChild.textContent = "Text size — " + Math.round(state.fontScale * 100) + "%"; };
      gT.appendChild(rng);
      gT.appendChild(el("div", { class: "sample" }, "The quick brown fox jumps over the lazy dog."));
      p.appendChild(gT);

      // Minimum text size — the readability FLOOR. No text rendered through the OS tokens
      // (the type ramp, form controls, base text) can fall below this. "Off" restores the raw ramp.
      p.appendChild(seg("Minimum text size", [["Off", 0], ["14", 14], ["16", 16], ["18", 18], ["20", 20]],
        state.fontMin, function (v) { setFontMin(v); }));

      // Typeface — built-in presets + every registered (imported / library) font.
      var gF = el("div", { class: "grp" });
      gF.appendChild(el("label", {}, "Typeface"));
      var sel = el("select", {});
      sel.appendChild(el("option", { value: "" }, "OS default"));
      Object.keys(FONTS).forEach(function (name) {
        var o = el("option", { value: FONTS[name] }, name);
        if (FONTS[name] === state.fontFamily) o.selected = true;
        sel.appendChild(o);
      });
      userFonts.forEach(function (d) {
        var val = fontStack(d);
        var o = el("option", { value: val }, d.family + (d.origin === "import" ? " · imported" : ""));
        if (val === state.fontFamily) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = function () { setFontFamily(this.value); };
      gF.appendChild(sel);
      gF.appendChild(el("div", { class: "sample" }, "The quick brown fox jumps over the lazy dog. 0123456789"));

      // Add a font — import ANY WOFF2/WOFF/TTF/OTF; it’s content-addressed and applied
      // across every holospace instantly (bytes ride inline, so isolation is no barrier).
      var addRow = el("div", { class: "seg" });
      var addBtn = el("button", {}, "＋ Add font…");
      var ffile = el("input", { type: "file", accept: ".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf" }); ffile.style.display = "none";
      ffile.onchange = function () {
        var f = ffile.files && ffile.files[0]; if (!f) { return; }
        addBtn.disabled = true; addBtn.textContent = "Adding…";
        importFontFile(f).then(function (r) {
          if (!r.ok) { var b = el("div", {}, "Font import failed: " + ((r.errors || []).join("; ") || "invalid")); b.style.cssText = "color:var(--holo-danger);font-size:var(--holo-text-sm);margin-top:6px"; gF.appendChild(b); addBtn.disabled = false; addBtn.textContent = "＋ Add font…"; }
          else refresh();
        });
        ffile.value = "";
      };
      addBtn.onclick = function () { ffile.click(); };
      addRow.appendChild(addBtn); gF.appendChild(addRow); gF.appendChild(ffile);

      // Remove imported fonts (catalog fonts are κ-pinned; leave them).
      var imported = userFonts.filter(function (d) { return d.origin === "import"; });
      if (imported.length) {
        var rm = el("div", { class: "seg" });
        imported.forEach(function (d) {
          var b = el("button", { title: "Remove " + d.family }, "✕ " + d.family);
          b.onclick = function () { removeFont(d.family); if (state.fontFamily === fontStack(d)) setFontFamily(""); refresh(); };
          rm.appendChild(b);
        });
        gF.appendChild(rm);
      }
      var fhint = el("div", {}, "Drop in any WOFF2/TTF — it’s applied uniformly across the whole OS, instantly.");
      fhint.style.cssText = "font-size:var(--holo-text-sm,.8rem);color:var(--holo-ink-dim);margin-top:2px"; gF.appendChild(fhint);
      p.appendChild(gF);

      // Font library — the κ-pinned catalog (fonts/index.json). One click = add + activate.
      var gL = el("div", { class: "grp" });
      gL.appendChild(el("label", {}, "Font library · κ-pinned"));
      var lib = el("div", { class: "seg" }); gL.appendChild(lib); p.appendChild(gL);
      lib.appendChild(el("div", {}, "Loading…"));
      loadCatalog().then(function (cat) {
        lib.innerHTML = "";
        var fonts = (cat && cat.fonts) || [];
        if (!fonts.length) { lib.appendChild(el("div", {}, "—")); return; }
        fonts.forEach(function (entry) {
          var have = userFonts.some(function (x) { return x.family === entry.family; });
          var b = el("button", { "aria-pressed": String(have) }, (have ? "✓ " : "＋ ") + entry.family);
          b.onclick = function () { addFont(catalogToDesc(entry), { activate: true }).then(function () { refresh(); }); };
          lib.appendChild(b);
        });
      });

      // Accent
      var gA = el("div", { class: "grp" });
      gA.appendChild(el("label", {}, "Accent colour"));
      var col = el("input", { type: "color", value: toHex(state.accent) || "#5b8cff" });
      col.oninput = function () { setAccent(this.value); };
      gA.appendChild(col);
      p.appendChild(gA);

      // Enforce on apps
      p.appendChild(seg("Apply to apps", [["Respect apps", "respect"], ["Enforce OS theme", "enforce"]],
        state.enforce ? "enforce" : "respect", function (v) { set({ enforce: v === "enforce" }); }));

      // Theme — create / save / load as a W3C Design Tokens (DTCG) file (shareable).
      var gM = el("div", { class: "grp" });
      gM.appendChild(el("label", {}, "Theme · W3C Design Tokens (.json)"));
      var row = el("div", { class: "seg" });
      var expBtn = el("button", {}, "⤓ Export");
      expBtn.onclick = function () {
        exportTheme().then(function (t) {
          if (!t) return;
          var ext = t.$extensions && t.$extensions["org.hologram.theme"];
          var name = (ext && ext.name) || "hologram";
          var a = el("a", {});
          a.href = URL.createObjectURL(new Blob([JSON.stringify(t, null, 2)], { type: "application/json" }));
          a.download = String(name).toLowerCase().replace(/\s+/g, "-") + ".tokens.json";
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        });
      };
      var impBtn = el("button", {}, "⤒ Import");
      var file = el("input", { type: "file", accept: ".json,application/json" }); file.style.display = "none";
      file.onchange = function () {
        var f = file.files && file.files[0]; if (!f) return;
        f.text().then(function (txt) {
          importTheme(txt).then(function (r) {
            if (!r.ok) { var b = el("div", { class: "themeerr" }, "Import failed: " + ((r.errors || []).join("; ") || "invalid")); b.style.cssText = "color:var(--holo-danger);font-size:var(--holo-text-sm);margin-top:6px"; gM.appendChild(b); }
            else refresh();
          });
        });
        file.value = "";
      };
      impBtn.onclick = function () { file.click(); };
      var defBtn = el("button", {}, "OS default");
      defBtn.onclick = function () { clearTheme(); refresh(); };
      row.appendChild(expBtn); row.appendChild(impBtn); row.appendChild(defBtn);
      gM.appendChild(row); gM.appendChild(file);
      var hint = el("div", {}, "Adjust the controls above, then Export to save & share your theme — or Import one.");
      hint.style.cssText = "font-size:var(--holo-text-sm,.8rem);color:var(--holo-ink-dim);margin-top:2px"; gM.appendChild(hint);
      // The canonical, full appearance surface is Holo Control (the Holo UI app's Appearance panel):
      // themes + accent + typography + accessibility + import/fork, all live. This quick panel stays for
      // fast in-place tweaks; the button below opens the complete control panel (ADR-0079).
      var browse = el("button", {}, "🎚 Open Holo Control — full appearance settings");
      browse.style.cssText = "margin-top:8px;min-height:40px;border:1px solid var(--holo-border);background:transparent;color:inherit;border-radius:10px;cursor:pointer;font:inherit;font-size:var(--holo-text-sm)";
      browse.onclick = function () { try { window.open(SHARED + "../apps/ui/index.html#appearance", "_blank"); } catch (e) {} };
      gM.appendChild(browse);
      p.appendChild(gM);

      var reset = el("button", { class: "reset" }, "Reset to defaults"); reset.onclick = function () { resetAll(); clearTheme(); refresh(); };
      p.appendChild(reset);
    }
    build();
    document.body.appendChild(scrim);
    document.body.appendChild(p);

    // ARIA modal behaviour (WCAG 2.1.2 / 2.4.3 / 4.1.2): focus in, trap Tab, Escape closes.
    var focusables = function () { return p.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'); };
    (focusables()[0] || p).focus();
    p.__lastFocus = lastFocus;
    p.__onkey = function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeSettings(); return; }
      if (e.key !== "Tab") return;
      var f = focusables(); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", p.__onkey, true);
  }
  function closeSettings() {
    var p = document.getElementById("holo-theme-panel");
    if (p && p.__onkey) document.removeEventListener("keydown", p.__onkey, true);
    ["holo-theme-panel", "holo-theme-scrim", "holo-theme-panel-css"].forEach(function (id) {
      var n = document.getElementById(id); if (n) n.remove();
    });
    if (p && p.__lastFocus && p.__lastFocus.focus) { try { p.__lastFocus.focus(); } catch (e) {} }
  }
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function toHex(c) { return /^#[0-9a-f]{6}$/i.test(c || "") ? c : ""; }

  // ── Public API ───────────────────────────────────────────────────────────────
  function setPalette(v) { set({ palette: v }); }
  function setPresentation(v) { set({ presentation: v }); }
  function setFontScale(n) { set({ fontScale: clamp(n, 0.7, 2) }); }
  function setFontMin(n) { set({ fontMin: clamp(n, 0, 28) }); }     // readability floor in px (0 = off)
  function setFontFamily(f) { set({ fontFamily: f || "" }); }
  function setDensity(n) { set({ density: clamp(n, 0.7, 1.4) }); }
  function setAccent(c) { set({ accent: c || "" }); }
  function resetAll() { state = Object.assign({}, DEFAULTS); apply(); write(state); broadcastDown(); }

  window.HoloTheme = {
    get: function () { return Object.assign({}, state); },
    set: set, setPalette: setPalette, setPresentation: setPresentation,
    setFontScale: setFontScale, setFontMin: setFontMin, setFontFamily: setFontFamily, setDensity: setDensity,
    setAccent: setAccent, reset: resetAll, openSettings: openSettings, closeSettings: closeSettings,
    // Portable themes (DTCG): import a token file/object, export the current theme, clear back to OS default.
    importTheme: importTheme, exportTheme: exportTheme, clearTheme: clearTheme,
    getThemeJson: function () { return themeJson ? JSON.parse(JSON.stringify(themeJson)) : null; },
    // κ-addressed theme catalog: list the content-addressed DTCG themes, and swap to one by κ (or name).
    // setThemeByKappa re-derives sha256 and refuses on mismatch (Law L5) before applying — live, OS-wide.
    listThemes: listThemes, setTheme: setTheme, setThemeByKappa: setThemeByKappa, activeThemeKappa: activeThemeKappa,
    setVar: function (name, val) { setVar(name, val); root.dispatchEvent(new CustomEvent("holo-theme-change", { detail: state, bubbles: false })); },
    // Global Theme (KDE Look-and-Feel package adopted as one κ-object): import flows through
    // importTheme, then surfaces the look-and-feel block (icons/decoration/layout/splash) to the shell.
    applyGlobalTheme: applyGlobalTheme,
    getLookAndFeel: function () { return lookAndFeel ? JSON.parse(JSON.stringify(lookAndFeel)) : null; },
    // Fonts as first-class citizens: import a file (data: URL), add a descriptor, or pull from
    // the κ-pinned library — each propagates @font-face across every isolated holospace.
    importFontFile: importFontFile, addFont: addFont, removeFont: removeFont,
    loadFontCatalog: loadCatalog, getFonts: function () { return JSON.parse(JSON.stringify(userFonts)); },
    FONTS: FONTS, policy: policy
  };
})();
