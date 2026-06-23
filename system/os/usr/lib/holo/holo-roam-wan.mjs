// holo-roam-wan.mjs — make roam EMBEDDED + SEAMLESS: it just works, no toggle. Two transports behind the
// one mirror (holo-roam-ui.makeRoamMirror): BroadcastChannel for your other TABS (same origin, instant) and
// a relay pub/sub topic keyed by your operator κ for your other DEVICES (the WAN leg, over the existing
// holo-pull-rendezvous rung). Verify-before-trust on receipt; content-dedup so it never loops. Auto-started
// at boot; the ⇄ control becomes a quiet on/off, default ON. Fail-soft: no relay → tabs still mirror; no
// BroadcastChannel → relay still mirrors; neither → today's single-device behaviour.
//
// Pure + injectable (relay + transports injected) so it is node-witnessable with a fake hub; the browser
// binding wires BroadcastChannel + window.HoloRelay (the live relay) when present.

import { makeRoamMirror } from "./holo-roam-ui.mjs";
import { topicOf } from "./holo-pull-rendezvous.mjs";

// makeRelayRoam({ relay, kappa, getActiveHost, getOpenApps, applyAdopted, openShared, self }) → a roam leg
// over a relay pub/sub topic. relay := { publish(topic,msg), subscribe(topic,cb) → unsubscribe }.
export function makeRelayRoam({ relay, kappa, getActiveHost, getOpenApps, applyAdopted, openShared, self } = {}) {
  if (!relay || typeof relay.publish !== "function" || typeof relay.subscribe !== "function") return null;
  const topic = topicOf(kappa || "roam");
  const mirror = makeRoamMirror({ self, getActiveHost, getOpenApps, applyAdopted, openShared,
    post: (m) => { try { return relay.publish(topic, m); } catch (e) {} } });
  let unsub = null;
  try { unsub = relay.subscribe(topic, (m) => { mirror.onMessage(m); }); } catch (e) {}
  return { advertiseAll: mirror.advertiseAll, onMessage: mirror.onMessage, topic, close: () => { try { unsub && unsub(); } catch (e) {} } };
}

// startAmbientRoam({ getActiveHost, getOpenApps, applyAdopted, openShared, self, bc, relay, kappa }) → handle.
// Attaches every available transport at once and returns a single { advertiseAll, close, legs }. The shell
// calls advertiseAll() on its save tick; each leg dedups, so advertising to all legs is cheap + loop-free.
//   bc    : a BroadcastChannel instance (same-origin tabs) — optional.
//   relay : the live relay (WAN devices) — optional.
export function startAmbientRoam({ getActiveHost, getOpenApps, applyAdopted, openShared, self, bc = null, relay = null, kappa = null } = {}) {
  const legs = [];
  if (bc && typeof bc.postMessage === "function") {
    const m = makeRoamMirror({ self, getActiveHost, getOpenApps, applyAdopted, openShared, post: (msg) => { try { bc.postMessage(msg); } catch (e) {} } });
    bc.onmessage = (e) => { m.onMessage(e.data); };
    legs.push({ advertiseAll: m.advertiseAll, close: () => { try { bc.close(); } catch (e) {} }, kind: "tabs" });
  }
  if (relay) {
    const r = makeRelayRoam({ relay, kappa, getActiveHost, getOpenApps, applyAdopted, openShared, self });
    if (r) legs.push({ advertiseAll: r.advertiseAll, close: r.close, kind: "devices" });
  }
  return {
    legs: legs.map((l) => l.kind),
    advertiseAll: async () => { for (const l of legs) { try { await l.advertiseAll(); } catch (e) {} } },
    close: () => { for (const l of legs) { try { l.close(); } catch (e) {} } },
  };
}

// attach({ getActiveHost, getOpenApps, applyAdopted, name, kappa }) — auto-start ambient roam: wire
// BroadcastChannel (tabs) + window.HoloRelay (devices/WAN, if a live relay is present) and expose
// window.__holoRoam so the shell's save-tick advertise just works — seamless, default ON. Returns the handle.
// A NAMED export (so `import * as` reaches it); browser-only (references window at call time). Fail-soft.
export function attach({ getActiveHost, getOpenApps, applyAdopted, name = "holo-workspace-roam", kappa = null } = {}) {
  if (typeof window === "undefined") return null;
  const self = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : String((window.performance && window.performance.now && window.performance.now()) || Object.keys({}).length);
  const openShared = async (bundle) => { try { const WS = await import("./holo-workspace-share.mjs"); return WS.openSharedWorkspace(bundle); } catch (e) { return null; } };
  const bc = (typeof BroadcastChannel !== "undefined") ? new BroadcastChannel(name) : null;
  const relay = window.HoloRelay || null;   // the live WAN relay (holo-pull/holo-peers) when present; else just tabs
  const h = startAmbientRoam({ getActiveHost, getOpenApps, applyAdopted, openShared, self, bc, relay, kappa });
  window.__holoRoam = { advertiseAll: () => h.advertiseAll(), enabled: () => true, legs: h.legs, close: h.close };
  return h;
}

if (typeof window !== "undefined") window.HoloRoamWan = { makeRelayRoam, startAmbientRoam, attach };

export default { makeRelayRoam, startAmbientRoam, attach };
