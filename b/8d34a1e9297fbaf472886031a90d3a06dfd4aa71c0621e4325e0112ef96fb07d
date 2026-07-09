// messenger-skin.mjs — bakes the SLACK re-tone as the messenger default (aubergine chrome + a floating,
// inset content pane; see the data-skin="slack" block in messenger-skins) and applies the hi-DPI /
// high-FPS perf layer. No picker / no toggle. Additive + guarded. Escape hatch: set localStorage
// "holo.skin" to graphite | warm | contrast | light (or "" to remove) to override the default.

(function () {
  if (!document.querySelector("link[data-holo-skins]")) {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = new URL("./messenger-skins.css?v=7d883ae6cf3e", import.meta.url); l.setAttribute("data-holo-skins", "1"); document.head.appendChild(l);
  }
  let skin = "slack";
  try { const s = localStorage.getItem("holo.skin"); if (s) skin = s; } catch {}
  if (skin) document.documentElement.setAttribute("data-skin", skin); else document.documentElement.removeAttribute("data-skin");
  // remove any lingering picker + its persisted flag from earlier ?skins=1 sessions
  try { localStorage.removeItem("holo.skins"); } catch {}
  try { const p = document.querySelector(".holo-skin-pick"); if (p) p.remove(); } catch {}
})();
