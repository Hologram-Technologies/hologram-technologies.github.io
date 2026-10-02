// holo-net.mjs — ONE content-network interface; two implementations behind it.
//
// The messenger's transport/secure/roam seams target THIS interface so the carrier is swappable with no
// app rewrite (the whole point of P0 modelling makeContentPeer on holowhat's real CN). Two impls:
//   • LOCAL  (makeLocalNet)     — in-process over holo-messenger-cn.makeContentPeer; tests + the honest
//                                  fallback when no WASM peer is present (NOT the P2P CN — labelled local).
//   • HOLOWHAT (makeHolowhatNet)— the REAL serverless content network: a holowhat `Console` carried by a
//                                  `WebRtcLink` via `cn_pump`. This becomes window.HoloNet in the browser.
//
// Interface (carrier-agnostic):
//   { ready, kappa(bytes)->"blake3:hex", cnPut(bytes)->κ, cnAnnounce(κ,topic), cnDiscover()->[κ],
//     cnFetch(κ)->Promise<bytes|null>, receive(bytes,κ), resolve(κ)->bytes|null, signIn(key)->idκ,
//     attach(link)->{detach} }
//
// Authority: holowhat Console CN (cn_put/announce/discover/fetch_start/fetch_poll/pump) · holo-messenger-cn
//   (local model) · holo-blake3 (κ parity) · holospaces CC-38/CC-49 · Law L1/L5 · SEC-1/SEC-7.

import { makeContentPeer } from "./holo-messenger-cn.mjs";
import { kappaBlake3 } from "./holo-blake3.mjs";

const tick = () => new Promise((r) => setTimeout(r, 0));

// ── LOCAL impl ──────────────────────────────────────────────────────────────────────────
// In-process peer. Link two with linkLocal(a,b) (a hub the carrier provides in the browser would be
// BroadcastChannel; here it's a direct frame shuttle). Verify-on-receipt is enforced by makeContentPeer.
export function makeLocalNet() {
  const holder = { send: () => {} };
  const peer = makeContentPeer({ send: (f) => holder.send(f) });
  return {
    impl: "local",
    ready: Promise.resolve(true),
    kappa: (bytes) => kappaBlake3(bytes),
    cnPut: (bytes) => peer.put(bytes),
    cnAnnounce: (k, topic) => peer.announce(k, topic),
    cnDiscover: () => peer.discover(),
    cnFetch: (k) => peer.fetch(k),
    onFrame: (f) => peer.onFrame(f),
    attach: () => ({ detach: () => {} }),
    _holder: holder,
  };
}
export function linkLocal(a, b) { a._holder.send = (f) => b.onFrame(f); b._holder.send = (f) => a.onFrame(f); }

// ── HOLOWHAT impl ───────────────────────────────────────────────────────────────────────
// Wrap a real holowhat `Console`. `kappaFn` is the WASM `kappa` (== our kappaBlake3, KAT-proven). The
// carrier drives cn_pump: in the browser, attach(WebRtcLink) starts the pump loop; in Node tests, the
// witness supplies a pump via _setPump (shuttling cn_outbound↔cn_inbound between two Consoles).
export function makeHolowhatNet(Console, kappaFn, { fetchPumpBudget = 240 } = {}) {
  const c = new Console();
  let pump = null;                                  // () => void  (carrier-driven frame movement)
  return {
    impl: "holowhat",
    ready: Promise.resolve(true),
    console: c,
    kappa: (bytes) => kappaFn(bytes),
    cnPut: (bytes) => c.cn_put(bytes),
    cnAnnounce: (k) => c.cn_announce(k),
    cnDiscover: () => { try { return JSON.parse(c.cn_discover()); } catch (e) { return []; } },
    async cnFetch(k) {
      for (let i = 0; i < 60; i++) { if (pump) pump(); if (this.cnDiscover().includes(k)) break; await tick(); }  // discover before fetch
      c.cn_fetch_start(k);
      for (let i = 0; i < fetchPumpBudget; i++) { if (pump) pump(); const p = c.cn_fetch_poll(); if (p !== undefined) return p || null; await tick(); }
      return null;
    },
    receive: (bytes, k) => c.receive(bytes, k),
    resolve: (k) => { const r = c.resolve(k); return r === undefined ? null : r; },
    signIn: (key) => c.sign_in(key),
    attach: (link) => { const id = setInterval(() => { try { c.cn_pump(link); } catch (e) {} }, 20); return { detach: () => clearInterval(id) }; },
    _setPump: (fn) => { pump = fn; },
  };
}

// ── browser binding: window.HoloNet — the REAL net if the WASM is served, else the local fallback ──────
// The WASM is vendored at ./holowhat/ (W2). If absent (guest/preview), window.HoloNet is the local model
// (honestly NOT the P2P CN). The surface imports window.HoloNet and is identical against either.
if (typeof window !== "undefined" && !window.HoloNet) {
  window.HoloNet = makeLocalNet();                  // safe default until the WASM loads
  const _holoNetUpgrade = async () => {
    try {
      // holowhat/ is an EVICTED tree on lean mounts — only the root-sw rescue serves it. On a slow cold
      // boot this import can BEAT the SW's first controller and 404, silently downgrading the whole
      // session to the local net. Wait (bounded) for control before importing; contexts without a SW
      // (native/dev serve the path directly) proceed immediately.
      if (typeof navigator !== "undefined" && navigator.serviceWorker && !navigator.serviceWorker.controller) {
        await Promise.race([
          new Promise((res) => { navigator.serviceWorker.addEventListener("controllerchange", res, { once: true }); navigator.serviceWorker.ready.then(() => setTimeout(res, 250)); }),
          new Promise((res) => setTimeout(res, 10000)),
        ]).catch(() => {});
      }
      const hw = await import("./holowhat/holospaces_web.js");
      // wasm-bindgen ≥0.2.93 wants a single options object ({module_or_path}); older builds took the URL positionally.
      // Pass the object and fall back to positional so it's correct on both without the deprecation warning.
      if (hw.default) { const wasm = new URL("./holowhat/holospaces_web_bg.wasm", import.meta.url); try { await hw.default({ module_or_path: wasm }); } catch { await hw.default(wasm); } }
      window.HoloNet = makeHolowhatNet(hw.Console, hw.kappa);
      window.HoloNet.WebRtcLink = hw.WebRtcLink;     // for the rendezvous layer
      if (document.documentElement) document.documentElement.setAttribute("data-holo-net", "holowhat");
    } catch (e) { if (typeof document !== "undefined" && document.documentElement) document.documentElement.setAttribute("data-holo-net", "local"); }
  };
  // MOBILE-LEAN (2026-07): the holowhat spine is a ~2.8 MB WASM compile that NOTHING at boot needs
  // synchronously — window.HoloNet stays the functional local net until it lands (the only reader,
  // holo-mirror.mjs, fail-softs to local), and Holo Direct P2P uses its OWN lazy spine
  // (apps/holo-messenger/holo-net.mjs::makeSpine). So on phones we keep this heavy compile entirely off
  // the first-paint critical path: warm it only once the main thread is idle AFTER load, and never under
  // Save-Data (P2P CN mirror then arms on first real Holo Direct use). Desktop upgrades immediately, as before.
  const _holoLeanMobile = (() => { try { return (matchMedia("(pointer:coarse)").matches && Math.min(innerWidth, innerHeight) <= 700) || navigator.connection?.saveData === true; } catch { return false; } })();
  if (!_holoLeanMobile) { _holoNetUpgrade(); }
  else if (navigator.connection?.saveData !== true) {
    const _kick = () => (("requestIdleCallback" in window) ? requestIdleCallback(() => _holoNetUpgrade(), { timeout: 15000 }) : setTimeout(_holoNetUpgrade, 4000));
    if (document.readyState === "complete") _kick(); else addEventListener("load", _kick, { once: true });
  }
}
