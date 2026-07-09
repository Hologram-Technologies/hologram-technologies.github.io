// holo-fidelity.mjs — the ONE adaptive-fidelity policy for Hologram OS (exploration: hyper-real,
// device-adaptive holospaces). It reads the user's hardware ⊗ connection ⊗ preferences and derives a
// single settings object every surface consumes — so a weak phone on 3G and a workstation on fibre
// both feel right: never janky, never under-using good hardware. Pure web platform (Law L4); the
// decision function is pure (node-testable); browser probes are guarded so it imports anywhere.
//
//   import { current, refresh, subscribe, fidelity, deviceProfile } from "./holo-fidelity.mjs";
//   const f = current();            // { tier, renderScale, effects, motion, textureTier, prefetch, … }
//   subscribe(() => relayout());    // re-fires on resize / network change / reduced-motion change
//   It also publishes CSS vars (--holo-fx-*, --holo-render-scale) + <html data-holo-fidelity> for CSS.

// ── the PURE decision: device+connection profile → settings (no globals; unit-testable) ───────────
export function fidelity(p) {
  p = p || {};
  const cores = p.cores || 4, mem = p.mem || 4, dpr = Math.min(p.dpr || 1, 4);
  const screenPx = p.screenPx || 1920, mobile = !!p.mobile, gpu = !!p.gpu;
  const save = !!p.saveData, rm = !!p.reducedMotion, batt = p.batterySaver === true;
  const eff = p.effectiveType || "4g", down = p.downlink == null ? 10 : p.downlink;

  // hardware tier (mirrors splash.html renderProfile; one source of truth now)
  let tier;
  if (mobile) tier = (cores >= 6 && mem >= 4 && gpu) ? "1080p" : "720p";
  else if (cores >= 12 && mem >= 8 && screenPx >= 7000 && gpu) tier = "8k";
  else if (cores >= 8 && mem >= 8 && gpu) tier = "4k";
  else if (cores <= 4 || mem <= 4 || !gpu) tier = "1080p";
  else tier = "1440p";
  const DIM = { "720p": 1280, "1080p": 1920, "1440p": 2560, "4k": 3840, "8k": 7680 };
  const maxDim = DIM[tier];
  // Internal render resolution. The GPU present layer (holo-gpu.js) Lanczos-reconstructs to maxDim, so we
  // render at the LARGEST dimension that (a) does not exceed the tier's maxDim and (b) fits a per-frame pixel
  // budget. The old flat `min(maxDim,2560)` capped EVERY GPU tier at 2560 — so a 4k tier upscaled from 2560
  // and an 8k tier upscaled 3× (8K was faked). Tier-aware: a 4k device renders truly NATIVE (3840, no
  // upscale), an 8k device renders far sharper than 2560, and a weak/battery GPU is never pushed past what it
  // can sustain (budget floor stays at the old 2560, so no low/mid regression). No upscale when internal===max.
  const frameBudgetPx = mobile ? 3_500_000 : (batt ? 6_000_000 : 16_000_000);   // max internal px/frame (≈dim²)
  const budgetDim = Math.floor(Math.sqrt(frameBudgetPx));                         // ~1870 mobile · ~4000 desktop
  const internalMaxDim = gpu ? Math.min(maxDim, Math.max(budgetDim, 2560)) : maxDim;
  const upscaleTarget = maxDim;   // always reconstruct to the tier dimension (a no-op when internal === maxDim)

  // connection class
  const slowNet = save || eff === "slow-2g" || eff === "2g" || (down > 0 && down < 1.5);
  const fastNet = !slowNet && (eff === "4g" || down >= 5);

  // a single "low tier" predicate gates the expensive niceties
  const low = mobile || cores <= 4 || mem <= 4 || !gpu || batt;

  let renderScale = tier === "720p" ? 0.75 : tier === "1080p" ? 0.9 : 1;
  if (batt) renderScale *= 0.85;

  const effects = {                                   // 0..1 budgets a surface multiplies its effect by
    blur: rm ? 0 : (low ? 0.4 : 1),                   // backdrop/frost blur radius
    shadow: low ? 0.5 : 1,                            // drop-shadow depth
    grain: (low || rm) ? 0 : 1,                       // film grain / dither
    parallax: rm ? 0 : (mobile ? 0 : (low ? 0.35 : 1)),// card tilt / depth parallax
    bloom: (low || rm) ? 0 : 1,
  };

  return {
    tier, maxDim, internalMaxDim, upscaleTarget, dpr,
    renderScale: +renderScale.toFixed(2),
    effects,
    motion: rm ? "reduced" : (low ? "lean" : "full"),  // animation richness
    textureTier: slowNet ? "low" : (fastNet && !mobile ? "high" : "medium"),
    prefetch: slowNet ? "off" : (fastNet ? "eager" : "lazy"),   // κ-prefetch aggressiveness
    targetFps: (mobile || batt) ? 60 : 120,
    gpu, slowNet, fastNet, low,
    coi: !!p.crossOriginIsolated, hdr: !!p.hdr, p3: !!p.p3,
    tiers: tiers(p),                                   // P0: the bare-metal ruler (compute/render/transport)
  };
}

// ── P0: the tier RULER — one probe → { compute, render, transport } (bare-metal initiative) ────────
// The single source of truth the initiative flips subsystems against and Q.health() reads to name a fallback.
// CAPABILITY, not activity: this says what the device CAN do; the ACTUAL active tier is reported at runtime by
// the subsystem itself (window.__holoMachine.tier for compute, window.__holoTransport.tier for transport). We
// only report what is observable and name host-side unknowns "unknown" — never a guess (Law L5).
export function tiers(p) {
  p = p || {};
  // RENDER — fully observable in the renderer: WebGPU (zero-copy, real) → WebGL (GPU, fallback) → software.
  const render = p.gpu ? "webgpu" : p.webgl2 ? "webgl" : "software";
  // TRANSPORT — observable capability: a peer connection is constructible ⇒ direct P2P is possible.
  const transport = p.webrtc ? "p2p-capable" : "loopback";
  // COMPUTE — the host hypervisor (WHPX/KVM/HVF) is NOT visible to a page. "unknown" unless the host injects it
  // (window.__holoHost.hypervisor); the running machine names its real tier at runtime.
  const compute = p.hypervisor ? ("native-" + p.hypervisor) : "unknown";
  return { compute, render, transport };
}

// ── browser probe: read the live device/connection/preferences (guarded for node) ─────────────────
export function deviceProfile() {
  const hasWin = typeof window !== "undefined";
  const n = typeof navigator !== "undefined" ? navigator : {};
  const c = n.connection || n.mozConnection || n.webkitConnection || {};
  const mm = (q) => { try { return typeof matchMedia === "function" && matchMedia(q).matches; } catch (e) { return false; } };
  const dpr = (hasWin && window.devicePixelRatio) || 1;
  const scr = typeof screen !== "undefined" ? Math.max(screen.width || 0, screen.height || 0) : 0;
  const mobile = mm("(pointer:coarse)") || /Mobi|Android|iPhone|iPad/i.test(n.userAgent || "");
  // P0 tier inputs (observable capability probes; each guarded so the module still imports under node)
  let webgl2 = false;
  try { if (typeof document !== "undefined") { const cv = document.createElement("canvas"); webgl2 = !!(cv.getContext("webgl2") || cv.getContext("webgl")); } } catch (e) {}
  let webrtc = false;
  try { webrtc = (typeof RTCPeerConnection !== "undefined") || (hasWin && (!!window.RTCPeerConnection || !!window.webkitRTCPeerConnection)); } catch (e) {}
  let hypervisor;
  try { hypervisor = (hasWin && window.__holoHost && window.__holoHost.hypervisor) || undefined; } catch (e) {}
  return {
    cores: n.hardwareConcurrency || 4, mem: n.deviceMemory || 4, dpr, screenPx: scr * dpr, mobile,
    gpu: typeof navigator !== "undefined" && !!navigator.gpu,
    effectiveType: c.effectiveType || "4g", downlink: c.downlink, saveData: !!c.saveData,
    reducedMotion: mm("(prefers-reduced-motion: reduce)"),
    crossOriginIsolated: hasWin && !!window.crossOriginIsolated,
    hdr: mm("(dynamic-range: high)"), p3: mm("(color-gamut: p3)"),
    webgl2, webrtc, hypervisor,                       // P0: bare-metal ruler inputs
  };
}

// ── live policy + CSS publication + reactivity ────────────────────────────────────────────────────
let _cur = null;
const _subs = new Set();
export function current() { return _cur || (_cur = fidelity(deviceProfile())); }

export function applyVars(f) {
  if (typeof document === "undefined") return;
  const r = document.documentElement, S = (k, v) => r.style.setProperty(k, v);
  r.setAttribute("data-holo-fidelity", f.tier);
  r.setAttribute("data-holo-motion", f.motion);
  if (f.tiers) {                                      // P0: expose the ruler for CSS / debug / Q.health
    r.setAttribute("data-holo-render-tier", f.tiers.render);
    r.setAttribute("data-holo-compute-tier", f.tiers.compute);
    r.setAttribute("data-holo-transport-tier", f.tiers.transport);
  }
  r.toggleAttribute("data-holo-hdr", !!f.hdr);     // display can show beyond-SDR highlights
  r.toggleAttribute("data-holo-p3", !!f.p3);       // wide-gamut display → richer accent/color
  S("--holo-fx-blur", String(f.effects.blur));
  S("--holo-fx-shadow", String(f.effects.shadow));
  S("--holo-fx-parallax", String(f.effects.parallax));
  S("--holo-render-scale", String(f.renderScale));
}
export function refresh() { _cur = fidelity(deviceProfile()); applyVars(_cur); _subs.forEach((cb) => { try { cb(_cur); } catch (e) {} }); return _cur; }
export function subscribe(cb) { _subs.add(cb); return () => _subs.delete(cb); }

// wire the live re-evaluation triggers (resize / network change / reduced-motion change) — debounced.
if (typeof window !== "undefined") {
  let t = 0; const ping = () => { clearTimeout(t); t = setTimeout(refresh, 200); };
  try {
    applyVars(current());
    // P0: publish the ruler + record it into the lifecycle strand ONCE, so `holo verify/self/status` (which read
    // the strand) attest the tiers this boot actually ran on. cefQuery-backed beacon survives a wedge; no-ops on web.
    window.__holoTiers = current().tiers;
    try {
      const T = window.__holoTiers;
      if (window.HoloLife && typeof window.HoloLife.mark === "function")
        window.HoloLife.mark("tiers compute=" + T.compute + " render=" + T.render + " transport=" + T.transport);
    } catch (e) {}
    // Bare-metal ruler RACE fix: window.__holoHost (the host's hypervisor advert) is injected by the browser
    // process in OnLoadStart and can land AFTER this module first runs → the initial beacon above records
    // compute="unknown" and current() caches it. If we're in the native host (cefQuery present) and compute is
    // unknown, poll briefly for __holoHost, then refresh() (recompute from the now-present advert) and RE-EMIT a
    // corrected tiers beacon so the LAST beacon the strand/`holo verify` reads names the real compute tier.
    try {
      if (window.__holoTiers && window.__holoTiers.compute === "unknown" && window.cefQuery) {
        let tries = 0;
        const iv = setInterval(() => {
          let hv; try { hv = window.__holoHost && window.__holoHost.hypervisor; } catch (e) {}
          if (hv || ++tries > 40) {                    // ~10s ceiling (40 × 250ms), then give up
            clearInterval(iv);
            if (hv) {
              const T2 = refresh().tiers;               // recompute + re-publish CSS vars now that __holoHost is set
              window.__holoTiers = T2;
              try {
                if (window.HoloLife && typeof window.HoloLife.mark === "function")
                  window.HoloLife.mark("tiers compute=" + T2.compute + " render=" + T2.render + " transport=" + T2.transport);
              } catch (e) {}
            }
          }
        }, 250);
      }
    } catch (e) {}
    window.addEventListener("resize", ping, { passive: true });
    const c = navigator.connection; if (c && c.addEventListener) c.addEventListener("change", ping);
    const mq = matchMedia("(prefers-reduced-motion: reduce)"); (mq.addEventListener ? mq.addEventListener("change", ping) : mq.addListener && mq.addListener(ping));
    window.HoloFidelity = { current, refresh, subscribe, fidelity, deviceProfile, tiers };
  } catch (e) {}
}
