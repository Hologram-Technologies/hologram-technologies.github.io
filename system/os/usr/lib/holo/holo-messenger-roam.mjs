// holo-messenger-roam.mjs — A CONVERSATION FOLLOWS YOU ACROSS DEVICES. Cross-device roam for a thread.
//
// A conversation is a signed source chain (holo-messenger-thread / holo-strand); "following you to
// another device" is carrying that chain's entries over a peer channel and re-mounting them there
// verify-before-trust. The decision brain is the existing workspace-roam reconcile
// (holo-workspace-roam.reconcileRemote): a broken/forged remote is ignored (fail-closed); a remote
// that strictly EXTENDS this device's chain fast-forwards (we adopt it); when both devices appended
// concurrently after a shared ancestor it DIVERGES and BOTH lineages are kept (append-only, never a
// destructive merge). Re-advertising only on a real change makes it epidemic and self-terminating.
//
// "Following, not syncing": identity is your κ, not a device — there is no mutable blob to merge, only
// hash-linked histories to compare. Transport is injected (Node-witnessable with a hub; the browser
// wires BroadcastChannel for same-origin tabs / a WAN leg — WebRTC, IPFS pubsub — out-of-band, same shape).
//
// Pure composition over holo-messenger-thread.adopt + holo-workspace-roam.reconcileRemote — no new crypto.
//
// Authority: holo-workspace-roam (reconcile) · holo-strand-admit (verify-before-trust) · holo-messenger-
//   thread (adopt) · holospaces SEC-1 (verify-on-receipt) · Law L5 (over the sequence).

import { reconcileRemote } from "./holo-workspace-roam.mjs";

// makeRoamLink({ thread, send, onUpdate, ruleset })
//   thread  : the local conversation (holo-messenger-thread)
//   send    : (bundle) → broadcast to peers (BroadcastChannel.postMessage / a hub)
//   onUpdate: (decision) → fired after this device fast-forwards to a peer's chain
//   ruleset : optional validation ruleset passed to reconcile (admitChain)
export function makeRoamLink({ thread, send = () => {}, onUpdate = () => {}, ruleset = null } = {}) {
  const bundle = () => ({ genesis: thread.genesis, entries: thread.replay() });   // full hash-linked chain

  function advertise() { try { return send(bundle()); } catch (e) {} }

  // receive(remoteBundle) → the reconcile decision. Fast-forward ⇒ adopt (verify-before-trust) + re-advertise;
  // local-ahead ⇒ re-advertise so the peer catches up; diverged/unrelated/rejected ⇒ keep local untouched.
  async function receive(remoteBundle) {
    if (!remoteBundle || remoteBundle.genesis !== thread.genesis) return { outcome: "unrelated", adopt: null };
    const local = thread.replay();
    const decision = await reconcileRemote(local, remoteBundle, ruleset ? { ruleset } : {});
    if (decision.outcome === "fast-forward" && decision.adopt) {
      const a = await thread.adopt(decision.adopt);                 // adopt re-verifies end-to-end (fail-closed)
      if (a.ok) { onUpdate(decision); advertise(); }                // moved forward → push so others converge
      else return { outcome: "rejected", why: a.why, adopt: null };
    } else if (decision.outcome === "local-ahead") {
      advertise();                                                  // we're newer → peer fast-forwards (epidemic)
    }
    return decision;
  }

  return { advertise, receive, bundle };
}

if (typeof window !== "undefined" && !window.HoloMessengerRoam) {
  window.HoloMessengerRoam = { makeRoamLink };
}
