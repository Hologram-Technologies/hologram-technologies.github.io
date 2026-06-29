// holo-block-fallback.mjs — THE FACULTY the native host delegates to when an ISP filter blocks a page and no
// peer holds that exact URL's κ. The native seam (handler.cc OnResourceRedirect) detects the WebSafe bounce
// and, on a peer-has-URL miss, asks this faculty to resolve the wanted HOST to a content κ WITHOUT a plaintext
// DNS query (κ-roots math / encrypted DoH bridge). The host then mesh-pulls that κ and serves it. So this is
// the single seam between the C++ redirect-intercept (fast, byte-transport) and the JS name-resolve (κ-roots/
// DoH, the part that must stay in the substrate's own naming layer). One verb the host calls: resolveForBlock.
//
// Pure assembly over holo-block-detect + holo-deliver; no new logic. node-testable (inject root/doh) and live
// in the shell (binds window.HoloBlockFallback over window.HoloRoot once κ-roots is up). Law L1/L5.

import { detectBlock } from "./holo-block-detect.mjs";
import { resolveNameless } from "./holo-deliver.mjs";

// makeBlockFallback({ root, doh }) → { resolveForBlock, classify }.
//   root : an opened holo-root (makeRoot) — resolves a host to a κ with zero DNS. Optional.
//   doh  : { fetch(host) } — an ENCRYPTED DoH transport (the ISP resolver is never queried). Optional.
export function makeBlockFallback({ root = null, doh = null } = {}) {
  // resolveForBlock(url) → { ok, kappa, via } | { ok:false, why } : the host calls this with the WANTED url
  // (the one the filter hid). We strip it to a host and resolve nameless. Empty/none ⇒ leave the block page.
  async function resolveForBlock(url) {
    let host;
    try { host = new URL(String(url)).host; } catch { return { ok: false, why: "bad-url" }; }
    if (!host) return { ok: false, why: "no-host" };
    const r = await resolveNameless(host, { root, doh });
    return r.ok ? { ok: true, kappa: r.kappa, via: r.via, host } : { ok: false, why: r.why, host };
  }

  // classify(obs) → the block verdict (re-export so a caller has one import for detect + resolve).
  const classify = (obs, opts) => detectBlock(obs, opts);

  return { resolveForBlock, classify };
}

// ── browser binding: window.HoloBlockFallback, wired by the shell once κ-roots (window.HoloRoot) is live. The
// host posts window.__holoBlockResolve(id, url); we resolve and answer over the cefQuery bridge
// ("holo:blockresolved:<id>:<κ-or-empty>"), exactly mirroring the governance/omnibox delegation pattern.
if (typeof window !== "undefined") {
  const wire = () => {
    try {
      if (window.HoloBlockFallback) return;
      const root = window.HoloRoot || null;       // the live κ-roots resolver (holo-roots shell)
      const doh = window.HoloDoH || null;          // an optional encrypted-DoH transport, if the shell provides one
      const fb = makeBlockFallback({ root, doh });
      window.HoloBlockFallback = fb;
      // the host's delegation entry point: resolve, then answer the host over cefQuery (fail-soft to empty).
      window.__holoBlockResolve = async (id, url) => {
        let kappa = "";
        try { const r = await fb.resolveForBlock(url); if (r.ok) kappa = String(r.kappa); } catch (e) {}
        try { if (window.cefQuery) window.cefQuery({ request: "holo:blockresolved:" + id + ":" + kappa, onSuccess() {}, onFailure() {} }); } catch (e) {}
      };
    } catch (e) { /* leave unset; the host's peer-has-κ path still works without the faculty */ }
  };
  if (window.HoloRoot) wire();
  else if (document.documentElement) document.documentElement.addEventListener("holo-roots-ready", wire, { once: true });
}

export default { makeBlockFallback };
