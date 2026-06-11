// holo-mui.js — the bridge that makes Material UI conform to Holo Theme. This is the
// anti-drift seam: MUI and Shoelace both consume ONE token source (the --holo-* custom
// properties from holo-theme.css), so a palette/accent/text-size change — or a theme
// applied from the gallery / Holo Hub — re-themes MUI components live, exactly like the
// rest of the OS. Zero React in here: it just reads tokens and hands MUI a theme options
// object (cssVariables mode, per MUI's own theming spec) + a change subscription.
//
// Usage in an MUI holospace:
//   const mk = () => createTheme(HoloMUI.themeOptions());
//   const [theme, set] = React.useState(mk);
//   React.useEffect(() => HoloMUI.onChange(() => set(mk())), []);

(function () {
  "use strict";
  if (window.HoloMUI) return;
  var root = document.documentElement;

  // Turnkey: inject the content-addressed import map for the React+MUI runtime, so an MUI
  // holospace never hand-writes it. Must run BEFORE any module import — this is a classic
  // script in <head>, so it executes before the page's deferred <script type="module">.
  // (Mirrors _shared/mui/importmap.json; regenerated alongside it by make-mui.mjs.)
  (function injectImportMap() {
    try {
      if (document.querySelector('script[type="importmap"]')) return;
      var s = document.createElement("script"); s.type = "importmap";
      s.textContent = JSON.stringify({ imports: {
        "react": "/_shared/mui/react.js",
        "react/jsx-runtime": "/_shared/mui/react-jsx-runtime.js",
        "react-dom": "/_shared/mui/react-dom.js",
        "react-dom/client": "/_shared/mui/react-dom-client.js",
        "@emotion/react": "/_shared/mui/emotion-react.js",
        "@emotion/styled": "/_shared/mui/emotion-styled.js",
        "@mui/system": "/_shared/mui/mui-system.js",
        "@mui/material": "/_shared/mui/mui-material.js"
      } });
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  })();

  // Resolve a color token to a CONCRETE value (MUI does alpha/lighten math at theme build
  // time, which fails on raw var() refs — so we read the computed color, not the var).
  function color(name, fallback) {
    try {
      var el = document.createElement("span");
      el.style.cssText = "position:absolute;left:-9999px;visibility:hidden;color:var(" + name + ")";
      (document.body || root).appendChild(el);
      var c = getComputedStyle(el).color; el.remove();
      return c && c !== "rgba(0, 0, 0, 0)" ? c : (fallback || "#000");
    } catch (e) { return fallback || "#000"; }
  }
  function num(name, def) { var v = getComputedStyle(root).getPropertyValue(name).trim(); var n = parseFloat(v); return isNaN(n) ? def : n; }
  function str(name, def) { return getComputedStyle(root).getPropertyValue(name).trim() || def; }

  // light | dark, matching how holo-theme.js resolves the active scheme.
  function mode() {
    var pal = root.getAttribute("data-holo-palette");
    if (pal === "light" || pal === "dark") return pal;
    return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }

  // An MUI theme-options object derived entirely from Holo Theme tokens (MUI cssVariables mode).
  function themeOptions(extra) {
    var opts = {
      cssVariables: true,
      palette: {
        mode: mode(),
        primary: { main: color("--holo-accent", "#5b8cff"), contrastText: color("--holo-accent-ink", "#fff") },
        background: { default: color("--holo-bg", "#0b0d10"), paper: color("--holo-surface", "#14161b") },
        text: { primary: color("--holo-ink", "#e6edf3"), secondary: color("--holo-ink-dim", "#8b949e") },
        divider: color("--holo-border", "#23272f"),
        success: { main: color("--holo-ok", "#3fb950") },
        warning: { main: color("--holo-warn", "#d29922") },
        error: { main: color("--holo-danger", "#f85149") },
      },
      shape: { borderRadius: num("--holo-radius", 12) },
      typography: { fontFamily: str("--holo-font-sans", "system-ui, sans-serif") },
    };
    if (extra && typeof extra === "object") for (var k in extra) opts[k] = extra[k];
    return opts;
  }

  // Call cb whenever the OS theme changes (engine event + cross-frame messages + system).
  function onChange(cb) {
    var t; function fire() { clearTimeout(t); t = setTimeout(cb, 30); }
    root.addEventListener("holo-theme-change", fire);
    window.addEventListener("message", function (e) { var d = e.data; if (d && (d.type === "holo-theme" || d.type === "holo-theme-tokens")) fire(); });
    if (window.matchMedia) { try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", fire); } catch (e) {} }
    return function off() { root.removeEventListener("holo-theme-change", fire); };
  }

  window.HoloMUI = { themeOptions: themeOptions, onChange: onChange, mode: mode, color: color };
})();
