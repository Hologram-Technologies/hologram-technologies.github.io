// holo-ux.js — the Holo UX runtime (ADR-0062, formerly ADR-028). One module per page: it
// AUTODETECTS the host OS and adapts the experience to its native feel (modifier key, window-
// control side, font, accent — so Hologram OS feels familiar and effortless on Windows / macOS /
// iOS / iPadOS / Android / ChromeOS / Linux), resolves the device capability TIER from a live
// probe, applies both to :root, and PROPAGATES the resolved state down the nested-holospace tree
// (HTML-Standard postMessage, the same pattern as Holo Theme, ADR-023) so every surface ingests
// the same UX by binding ONE source — apps inherit a consistent, native, beautiful experience
// without re-implementing it. This is the experience analogue of the Holo UI token contract; the
// canonical parameters are sealed as a self-verifying κ-object (etc/holo-ux/doctrine.uor.json).
//
// Load once: <script type="module" src="_shared/holo-ux.js"></script>. The tier resolution and the
// native-OS profile are pure + witnessed in Node (holo-ux-witness.mjs); this file is the browser
// wiring of that resolution, and it never overrides an explicit user choice (it only SEEDS native
// defaults). It degrades honestly headless.

import { probe, resolveTier, tierSettings, deriveDescriptor } from "./holo-capability.mjs";
import { profileFor } from "./holo-platform.js";

const MSG = "holo-ux", HELLO = "holo-ux-hello";

// Self-inject the canonical proportion tokens (holo-phi.css), resolved relative to THIS
// module — so "wire to Holo UX" is one line: <script type="module" src="…/holo-ux.js">.
// Idempotent and FOUC-safe enough for the runtime; pages may still pre-link holo-phi.css
// to paint proportion before the module evaluates. Mirrors Holo Theme's self-inject (ADR-023).
(function injectProportion() {
  try {
    const href = new URL("./holo-phi.css", import.meta.url).href;
    if (document.querySelector('link[href$="holo-phi.css"]')) return;
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href;
    document.head.appendChild(l);
  } catch { /* non-DOM context (e.g. a witness importing the resolver) */ }
})();

// Adapt the document root to the host OS's NATIVE FEEL (the autodetect → adjust dynamically of
// ADR-0062). Stamps the platform data-attributes the chrome reskins off (data-holo-platform, the
// modifier key, the window-control side, touch), and SEEDS the native accent + font through Holo
// Theme — but never overrides an explicit user choice (seed, don't dictate). Same on every surface
// in the tree: the host is one fact, propagated, not re-detected per app.
function applyPlatform(root, p) {
  if (!p || !p.os) return;
  root.setAttribute("data-holo-platform", p.os);
  root.setAttribute("data-holo-mod", p.modKey);            // "meta" (⌘) | "control" (Ctrl)
  root.setAttribute("data-holo-controls", p.controlsSide); // window controls: "left" (macOS) | "right"
  p.touch ? root.setAttribute("data-holo-touch", "") : root.removeAttribute("data-holo-touch");
  if (globalThis.HoloTheme && typeof HoloTheme.get === "function") {
    try {
      const st = HoloTheme.get() || {};
      if (!st.accent && p.accent && HoloTheme.setAccent) HoloTheme.setAccent(p.accent);
      if (!st.fontFamily && p.font && HoloTheme.setFontFamily) HoloTheme.setFontFamily(p.font);
    } catch { /* theme optional */ }
  } else {
    if (p.accent) root.style.setProperty("--holo-accent", p.accent);
    root.style.setProperty("--holo-platform-font", p.font || "system-ui");
  }
}

// Apply the resolved state to the document root: the native-OS feel + the capability knobs. Density
// rides the Holo Theme lever when present (ADR-023); motion and max-DPR are exposed as data + a
// custom property.
function apply(state) {
  const root = document.documentElement;
  applyPlatform(root, state.platform);
  root.setAttribute("data-holo-tier", state.tier);
  root.setAttribute("data-holo-motion", state.settings.motion);
  root.style.setProperty("--holo-max-dpr", String(state.settings.maxDpr));
  if (globalThis.HoloTheme && typeof HoloTheme.setDensity === "function") {
    try { HoloTheme.setDensity(state.settings.density === "immersive" ? 0.82 : 1); } catch { /* theme optional */ }
  } else {
    root.setAttribute("data-holo-presentation", state.settings.density === "immersive" ? "immersive" : "standard");
  }
  root.dispatchEvent(new CustomEvent("holo-ux-change", { detail: state }));
}

// Broadcast the resolved state to every child holospace iframe (transitive via their own
// runtimes). A late-mounting child announces HELLO and we reply — no rebuild, no restart.
function broadcast(state) {
  for (const f of document.querySelectorAll("iframe")) {
    try { f.contentWindow?.postMessage({ type: MSG, state }, "*"); } catch { /* cross-origin child */ }
  }
}

function resolve() {
  const p = probe();
  const tier = resolveTier(p);
  const platform = (() => { try { return profileFor(typeof navigator !== "undefined" ? navigator : undefined); } catch { return null; } })();
  return { tier, settings: tierSettings(tier), platform, descriptor: deriveDescriptor(null, p) };
}

let current = resolve();
const HoloUX = {
  get: () => current,
  refresh: () => { current = resolve(); apply(current); broadcast(current); return current; },
};
globalThis.HoloUX = HoloUX;

// A parent pushes state down; a child applies what it receives and re-broadcasts to its own
// children. A mounting child says HELLO; the parent replies with the current state.
addEventListener("message", (e) => {
  const d = e.data;
  if (!d || typeof d !== "object") return;
  if (d.type === MSG && d.state) { current = d.state; apply(current); broadcast(current); }
  else if (d.type === HELLO) { try { e.source?.postMessage({ type: MSG, state: current }, "*"); } catch { /* ignore */ } }
});

apply(current);
broadcast(current);
try { parent !== window && parent.postMessage({ type: HELLO }, "*"); } catch { /* top frame */ }
