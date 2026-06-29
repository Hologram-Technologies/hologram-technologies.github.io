// holo-projection-hud.mjs — THE ONE projection HUD.
//
// Every projected surface — web tab, holo app, streamed video — shows the SAME readout in the SAME visual
// language: what engine is projecting, the policy treatment, how much the κ-substrate moved vs every-pixel, the
// present rate, and that each tile was L5-verified. One component, mounted by each surface with its own stats
// provider, so the user never sees "two different HUDs" — projection is one concept.
//
// mountProjectionHUD(getStats, opts?) → { el, toggle, show, hide, destroy }
//   getStats(): () => {
//     kind, treatment,            // from the policy (doc·app·3d·video / pixel-native·super-res)
//     engine,                     // 'canvas2d' | 'webgpu' | 'webgl2' | 'screencast'
//     refs?,                      // tiles referenced so far (cheap — resident κ never re-cross)
//     novelBytes?,                // bytes that ACTUALLY crossed (∝ novelty — the κ win)
//     tileBytes?,                 // raw bytes one tile would cost (for the %-moved figure)
//     internalScale?, ssaa?,      // super-res render-cheap factor + supersample
//     l5?,                        // tiles verified before paint (default true)
//     label?,                     // surface label (the url / app name)
//   }
// The HUD measures present fps itself (its own rAF) so the number is honest + identical across surfaces.
// Toggle with 'h'. Minimal, essence-only — a quiet corner badge, not chrome.

const KB = 1024, MB = 1024 * 1024;
const fmtBytes = (b) => b >= MB ? (b / MB).toFixed(b >= 10 * MB ? 0 : 1) + " MB"
                     : b >= KB ? (b / KB).toFixed(b >= 10 * KB ? 0 : 1) + " KB" : (b | 0) + " B";
const fmtCount = (n) => n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n | 0);

export function mountProjectionHUD(getStats, opts = {}) {
  if (typeof document === "undefined") return { el: null, toggle() {}, show() {}, hide() {}, destroy() {} };
  const el = document.createElement("div");
  el.setAttribute("data-holo-projection-hud", "1");
  Object.assign(el.style, {
    position: "fixed", left: (opts.left ?? 12) + "px", bottom: (opts.bottom ?? 12) + "px", zIndex: 2147483646,
    font: "11px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace", color: "#dfe7ff",
    background: "rgba(8,10,20,0.62)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
    border: "1px solid rgba(140,170,255,0.18)", borderRadius: "9px", padding: "8px 11px",
    pointerEvents: "none", whiteSpace: "pre", letterSpacing: "0.2px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.35)", opacity: "0", transition: "opacity .18s ease",
    display: opts.startHidden === false ? "block" : "none",
  });
  (opts.parent || document.body).appendChild(el);

  // present-fps: the HUD's own rAF cadence = the panel refresh the surface presents at (vsync-capped).
  let frames = 0, fps = 0, lastT = 0, raf = 0, alive = true, visible = opts.startHidden === false;
  const tick = (t) => {
    if (!alive) return;
    frames++;
    if (!lastT) lastT = t;
    if (t - lastT >= 500) { fps = Math.round((frames * 1000) / (t - lastT)); frames = 0; lastT = t; if (visible) render(); }
    raf = requestAnimationFrame(tick);
  };

  function render() {
    let s; try { s = getStats() || {}; } catch (e) { s = {}; }
    const treat = s.treatment === "super-res" ? "super-res" : "pixel-native";
    const kind = s.kind || "doc";
    const eng = s.engine || "canvas2d";
    const refs = s.refs || 0;
    const novel = s.novelBytes || 0;
    // %-moved: of the bytes every referenced tile WOULD cost if resent each frame, how few actually crossed.
    const wouldCost = refs * (s.tileBytes || 256 * 256 * 4);
    const movedPct = wouldCost > 0 ? Math.max(0, Math.min(100, (100 * novel) / wouldCost)) : 0;
    const sr = treat === "super-res" && s.internalScale
      ? `  cheap ${Math.round(s.internalScale * 100)}%${s.ssaa ? " · " + (+s.ssaa).toFixed(2) + "× SSAA" : ""}` : "";
    const l5 = s.l5 === false ? "—" : "✓";
    const lines = [
      `✦ PROJECTION · ${kind}`,
      `${treat} · ${eng}${sr}`,
    ];
    // the κ line only when tiles actually cross (a κ-streamed web tab, or an app while sharing). A local app
    // super-res has nothing on the wire, so it shows the super-res line instead — same component, honest readout.
    if (refs > 0) lines.push(`κ refs ${fmtCount(refs)} · moved ${fmtBytes(novel)}${wouldCost > 0 ? ` (${movedPct.toFixed(movedPct < 1 ? 1 : 0)}%)` : ""}`);
    lines.push(`${fps || "—"} fps (vsync) · L5 ${l5}`);
    if (s.label) lines.push(String(s.label).slice(0, 48));
    el.textContent = lines.join("\n");
  }

  const show = () => { visible = true; el.style.display = "block"; requestAnimationFrame(() => { el.style.opacity = "1"; }); render(); };
  const hide = () => { visible = false; el.style.opacity = "0"; setTimeout(() => { if (!visible) el.style.display = "none"; }, 200); };
  const toggle = () => (visible ? hide() : show());
  // Toggle = Alt+H — a chord, not a bare letter: a projected web tab forwards every keystroke to the page, so a
  // plain 'h' would type into the page. Captured (capture:true) + stopped so the toggle never reaches the surface.
  const onKey = (e) => {
    if (e.altKey && (e.key === "h" || e.key === "H") && !e.metaKey && !e.ctrlKey) {
      e.preventDefault(); e.stopImmediatePropagation(); toggle();
    }
  };
  window.addEventListener("keydown", onKey, true);
  raf = requestAnimationFrame(tick);
  if (visible) show();

  const api = {
    el, toggle, show, hide,
    destroy() { alive = false; cancelAnimationFrame(raf); window.removeEventListener("keydown", onKey, true); el.remove(); },
  };
  window.__holoProjHUD = api;   // exposed for the host / verification
  return api;
}

export default { mountProjectionHUD };
