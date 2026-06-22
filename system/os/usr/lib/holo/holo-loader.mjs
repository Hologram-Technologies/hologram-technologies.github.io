// holo-loader.mjs — κ-Open loader: the Google-Earth-class veil (Phase 2).
//
// While the projection resolves a κ → admits it → mounts the app BEHIND the veil, the guest sees only
// beauty: a full-screen, true-black cosmos with the app's name centered and one quiet spinner. When the
// app is ready the veil CROSS-FADES (never cuts) into the mounted frame, so receiving a shared app feels
// like one continuous motion — a living object forming, not a file loading.
//
// The render path is chosen by holo-device-tier — detect the device, deliver its ceiling:
//   • ultra / high   → WebGPU cosmos (holo-cosmos-gpu.js), full-DPR up to the tier cap
//   • balanced       → WebGL2 cosmos (holo-cosmos.js)
//   • lite / reduced-motion → the static deep-space gradient already painted by inline CSS (zero GPU)
//
// HONEST + SAFE: this NEVER blocks boot. The markup + critical CSS are inlined in holospace.html so the
// name + spinner paint on first frame with zero fetch; this module only HYDRATES the backdrop after, and
// every step is guarded — on any doubt the static gradient remains and the app still mounts.

import { HoloDeviceTier } from "./holo-device-tier.mjs";

const $ = (id) => document.getElementById(id);

// hydrate(rootId) — upgrade the inlined static veil with a tier-appropriate live backdrop. Returns a
// controller { setName, done, fail, profile } that holospace.html drives as the app resolves/mounts.
export function hydrate({ root = "holo-loader", canvas = "holo-loader-sky", nameEl = "holo-loader-name", seed = "" } = {}) {
  const rootEl = $(root), nameNode = $(nameEl);
  let cosmos = null, finished = false;

  // pick a render path: sync guess paints immediately; probe() refines (adapter/refresh) and we upgrade.
  const startBackdrop = async () => {
    let p; try { p = HoloDeviceTier.get(); } catch (e) { return; }
    const animate = p && p.effects && p.effects.animate;
    const path = p && p.renderPath;
    if (!rootEl || !animate || path === "static") return;            // lite / reduced-motion → inline gradient
    const cv = $(canvas); if (!cv) return;
    // refine asynchronously so a real (non-fallback) adapter decision is made before we commit to WebGPU
    try { p = await HoloDeviceTier.probe(); } catch (e) {}
    if (finished) return;
    const reduced = !(p.effects && p.effects.animate);
    const maxScale = (p && p.dprCap) || 2;
    try {
      if (p.renderPath === "webgpu") {
        const G = await import("./holo-cosmos-gpu.js");
        try { await G.ready; } catch (e) {}
        if (!finished && G.gpuAvailable && G.gpuAvailable()) { cosmos = G.start(cv, { seed, reduced, maxScale }); }
      }
      if (!cosmos && !finished && (p.renderPath === "webgpu" || p.renderPath === "webgl2")) {
        const C = await import("./holo-cosmos.js");                  // WebGL2 fallback, same start() contract
        const start = (C.default && C.default.start) || C.start;
        if (start) cosmos = start(cv, { seed, reduced, maxScale });
      }
    } catch (e) { /* backdrop is decorative — the inline gradient already covers us */ }
    if (finished && cosmos) { try { cosmos.stop(); } catch (e) {} cosmos = null; }
  };
  startBackdrop();

  const setName = (name) => {
    if (!nameNode || !name) return;
    nameNode.textContent = name;
    nameNode.classList.add("is-named");                              // CSS cross-fades the name in
  };

  // done() — cross-fade the veil away and remove it. The app's own holo-materialize plays underneath, so
  // the two motions read as one. Resolves after the fade so the caller can sequence cleanly.
  const done = () => new Promise((resolve) => {
    finished = true;
    if (cosmos) { try { cosmos.stop(); } catch (e) {} cosmos = null; }
    if (!rootEl) return resolve();
    rootEl.classList.add("is-done");
    let settled = false;
    const fin = () => { if (settled) return; settled = true; try { rootEl.remove(); } catch (e) {} resolve(); };
    rootEl.addEventListener("transitionend", fin, { once: true });
    setTimeout(fin, 700);                                            // fallback if transitionend never fires
  });

  // fail(html) — resolution failed; stop the backdrop and let holospace.html reveal its error host.
  const fail = () => { finished = true; if (cosmos) { try { cosmos.stop(); } catch (e) {} cosmos = null; } if (rootEl) rootEl.classList.add("is-error"); };

  const api = { setName, done, fail, get profile() { try { return HoloDeviceTier.get(); } catch (e) { return null; } } };
  try { if (!window.HoloLoader) window.HoloLoader = api; } catch (e) {}
  return api;
}

export default { hydrate };
