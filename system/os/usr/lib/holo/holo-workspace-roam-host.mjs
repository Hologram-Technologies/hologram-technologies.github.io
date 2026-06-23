// holo-workspace-roam-host.mjs — DEVICE-SIDE ROAM over a pluggable transport (Phase E). A window follows
// you across devices: each device advertises its per-app chain head; a peer reconciles the incoming chain
// against its own (holo-workspace-roam.reconcileRemote, verify-before-trust) and FAST-FORWARDS when the
// remote is newer — so reopening on another device shows your latest window. Concurrent edits KEEP BOTH
// lineages (monotonic; the other is a rewind point); tampered/unrelated/older → ignored (fail-closed).
//
// Mirrors holo-gossip-channel exactly: a transport-injected core (node-testable with a fake hub) + a
// BroadcastChannel browser binding for the SAME-ORIGIN leg (separate tabs = separate peers, real, no
// server). Cross-DEVICE transport (WebRTC κ-rendezvous / libp2p / IPFS pubsub) is the SAME shape behind the
// SAME seam — out-of-band here. Pure assembly over holo-workspace-roam + the per-app host; no new crypto.

import { reconcileRemote } from "./holo-workspace-roam.mjs";

// makeRoamNet({ host, post, self, applyAdopted }) → { advertise, want, onMessage }.
//   host         : the per-app capture host (active-workspace scoped) — host.workspace(appκ).bundle()/adopt().
//   post(msg)    : send a message to peers. msg = { from, app, bundle } | { from, app, want:true }.
//   self         : this device's id (own messages are ignored).
//   applyAdopted : (appκ, state) => void — re-render the app with the adopted state (the shell wires this to
//                  holo-session:restore). Optional.
export function makeRoamNet({ host, post = () => {}, self = null, applyAdopted = null } = {}) {
  if (!host || !host.workspace) throw new Error("makeRoamNet needs a per-app host");

  // advertise(appκ) — broadcast this device's current chain for one app so peers can converge.
  async function advertise(app) {
    if (!app) return null;
    let bundle = null; try { bundle = await host.workspace(app).bundle(); } catch (e) { return null; }
    if (!bundle || !bundle.entries.length) return null;                 // nothing to advertise (lazy)
    try { await post({ from: self, app, bundle }); } catch (e) {}       // await so a sync transport (tests) settles before callers read
    return bundle.head;
  }

  // want(appκ) — ask peers to advertise an app (pull). Peers reply by advertising it.
  async function want(app) { if (app) { try { await post({ from: self, app, want: true }); } catch (e) {} } }

  // onMessage(msg) — apply an incoming advert: reconcile, fast-forward when newer, keep both on divergence,
  // re-advertise when WE are newer (epidemic, self-terminating via idempotent reconcile). Returns the decision.
  async function onMessage(msg) {
    if (!msg || (msg.from != null && msg.from === self)) return null;   // ignore own / empty
    if (msg.want && msg.app) { await advertise(msg.app); return { outcome: "served-want" }; }
    if (!msg.app || !msg.bundle) return null;
    let local = []; try { local = (await host.workspace(msg.app).bundle()).entries; } catch (e) {}
    const r = await reconcileRemote(local, msg.bundle);                 // verify-before-trust inside
    if (r.outcome === "fast-forward") {
      let ad = null; try { ad = await host.workspace(msg.app).adopt(r.adopt); } catch (e) {}
      if (ad && ad.ok && applyAdopted) { let st = null; try { st = await host.workspace(msg.app).resume(); } catch (e) {} try { applyAdopted(msg.app, st); } catch (e) {} }
    } else if (r.outcome === "local-ahead") {
      await advertise(msg.app);                                         // we're newer → push so the peer catches up
    }
    // "diverged" keeps both lineages (no adopt); "in-sync"/"unrelated"/"rejected" → no-op
    return r;
  }

  return { advertise, want, onMessage };
}

// ── browser binding: a live roam peer over a BroadcastChannel (real cross-tab/window transport, no server).
// window.HoloWorkspaceRoamNet.attach(host, { applyAdopted, name }) → { advertise, want, close }. Cross-device
// (WebRTC/IPFS) implements the same { post, onmessage } shape behind this seam — out-of-band. Fail-soft.
if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
  window.HoloWorkspaceRoamNet = {
    attach(host, { applyAdopted = null, name = "holo-workspace-roam" } = {}) {
      const self = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : String(window.performance && window.performance.now ? window.performance.now() : Object.keys({}).length);
      const bc = new BroadcastChannel(name);
      const net = makeRoamNet({ host, self, applyAdopted, post: (m) => { try { bc.postMessage(m); } catch (e) {} } });
      bc.onmessage = (e) => { net.onMessage(e.data); };
      return { advertise: net.advertise, want: net.want, channel: bc, close: () => { try { bc.close(); } catch (e) {} } };
    },
    makeRoamNet,
  };
}
