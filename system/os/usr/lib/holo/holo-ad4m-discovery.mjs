// holo-ad4m-discovery.mjs — find peers for a Space with NO invite link, still serverless. The WAN invite
// (holo-ad4m-wan) needs someone to hand you a link out-of-band. This closes that: once you are connected to
// ANY peer (the mesh), you DISCOVER the rest. Two parts, both in holo-gossip's spirit (carry, never confer):
//
//   1 · DIRECTORY GOSSIP — each peer advertises which Space κ's it is in; receivers reconcile toward the
//       union. So a newcomer connected to one peer learns who is in which Space across the whole mesh.
//       A pointer only: knowing a peer is "in" a Space confers NOTHING — membership is still the operator
//       grant, and every post still re-derives (L5). Idempotent ⇒ converges regardless of order.
//
//   2 · MESH-RELAYED RENDEZVOUS — to actually connect to a discovered peer with no direct link, the invite
//       handshake (holo-ad4m-wan createSpaceInvite/joinSpaceInvite) runs with the offer/answer/grant RELAYED
//       as signaling messages over the already-connected mesh (an intermediary peer forwards them — it is a
//       peer, not a server). The result is a NEW direct WebRTC channel + a verified membership grant, opened
//       without anyone pasting a link. The relay sees only opaque signaling; trust stays in verifyDelegation.
//
// The cold first contact (a peer connected to NOBODY) still needs ONE out-of-band link or a bootstrap peer —
// that is the honest edge of "serverless"; everything after the first connection is automatic. Composes
// holo-ad4m-wan + holo-gossip; invents no transport and no new crypto. Node-testable over an injected router.

// makeDiscovery({ self, transport, signal, invite }) → the discovery engine for one peer.
//   self      : this peer's agent κ.
//   transport : this peer's WAN transport (createInvite/joinInvite live here; new channels attach here).
//   signal    : (destKappa, msg) → route a signaling message toward a peer over the mesh (relayed). The
//               caller wires this to the mesh; with no path the message is simply dropped (fail-soft).
//   invite    : optional override of the handshake fns { createInvite(space), joinInvite(link) }
//               (defaults to transport.createInvite/joinInvite). Lets the witness inject a stub.
export function makeDiscovery({ self = null, transport = null, signal = () => {}, invite = null } = {}) {
  const directory = new Map();                       // spaceKappa → Set(peer κ) — who is (claimed) in which Space
  const mySpaces = new Set();                        // Space κ's I advertise membership of
  const pending = new Map();                         // a peer I am mid-rendezvous with → its in-flight invite handle
  const channels = new Map();                        // peer κ → true once a direct channel is established (dedupe)
  const grantsOut = new Map();                       // peer κ → the membership grant I minted for them (inviter side)
  const inv = invite || (transport ? { createInvite: (s) => transport.createInvite(s), joinInvite: (l) => transport.joinInvite(l) } : null);
  const listeners = new Set();
  const emit = (e) => { for (const fn of listeners) { try { fn(e); } catch (_) {} } };

  const note = (spaceK, peerK) => { if (!spaceK || !peerK) return; if (!directory.has(spaceK)) directory.set(spaceK, new Set()); directory.get(spaceK).add(peerK); };

  // ── directory gossip ───────────────────────────────────────────────────────────────────────────────
  function announce(spaceKappa) { if (spaceKappa) { mySpaces.add(spaceKappa); note(spaceKappa, self); } }
  // advertise the WHOLE known directory (not just my own Spaces) so membership propagates TRANSITIVELY: a peer
  // connected only to B learns about A (in B's directory) without ever meeting A. A pointer set, never trust.
  function advertise() {
    const dir = {}; for (const [s, set] of directory) dir[s] = [...set];
    return { "@type": "HoloDiscovery", from: self, dir };
  }
  function onAdvert(advert = {}) {
    let learned = 0;
    for (const [s, peers] of Object.entries(advert.dir || {})) for (const p of peers || []) { const had = directory.get(s)?.has(p); note(s, p); if (!had) learned++; }
    return learned;
  }
  // who do I know is in this Space (other than me)? — the lookup a newcomer runs after one gossip round.
  function membersOf(spaceKappa) { return [...(directory.get(spaceKappa) || [])].filter((k) => k !== self); }

  // ── mesh-relayed rendezvous: the invite handshake driven by signaling messages, not a pasted link ────
  // discoverAndJoin(spaceKappa, peerKappa?) — pick a known member (or the given one) and ask it to connect.
  // Returns a promise that resolves { peer, grant } once the channel is open and the grant verified.
  function discoverAndJoin(spaceKappa, peerKappa = null) {
    const target = peerKappa || membersOf(spaceKappa)[0];
    if (!target) return Promise.resolve({ ok: false, reason: "no known peer in that Space" });
    if (channels.has(target)) return Promise.resolve({ ok: true, peer: target, already: true });
    return new Promise((resolve) => {
      pending.set(target, { resolve, spaceKappa });
      signal(target, { t: "disc:want", from: self, space: spaceKappa });   // ask the target to open an invite to me
    });
  }

  // handleSignal(msg) — the relayed signaling state machine. Every branch is one hop over the mesh:
  //   disc:want  (→ inviter) : mint an invite for the Space, relay the link back
  //   disc:offer (→ joiner)  : answer the link, relay the answer back
  //   disc:answer(→ inviter) : complete the handshake, mint the grant, relay it back
  //   disc:grant (→ joiner)  : verify the grant — rendezvous complete, a direct channel is now open
  async function handleSignal(msg = {}) {
    if (!msg || !inv) return;
    const peer = msg.from;
    try {
      const prior = pending.get(peer) || {};                                  // keep any resolver from discoverAndJoin
      if (msg.t === "disc:want") {
        const handle = await inv.createInvite({ id: msg.space, name: msg.spaceName || msg.space });
        pending.set(peer, { ...prior, handle, spaceKappa: msg.space, inviter: true });
        signal(peer, { t: "disc:offer", from: self, space: msg.space, link: handle.link });
      } else if (msg.t === "disc:offer") {
        const j = await inv.joinInvite(msg.link);
        pending.set(peer, { ...prior, join: j, spaceKappa: msg.space });
        signal(peer, { t: "disc:answer", from: self, space: msg.space, answer: j.answerBlob });
      } else if (msg.t === "disc:answer") {
        const p = pending.get(peer); if (!p || !p.handle) return;
        const out = await p.handle.complete(msg.answer);
        if (out && out.grant) { grantsOut.set(peer, out.grant); note(p.spaceKappa, peer); channels.set(peer, true); }
        signal(peer, { t: "disc:grant", from: self, space: p.spaceKappa, grant: out && out.grant });
        emit({ kind: "connected", peer, space: p.spaceKappa, role: "inviter" });
      } else if (msg.t === "disc:grant") {
        const p = pending.get(peer); if (!p || !p.join) return;
        let admitted = null; try { admitted = await p.join.accept(msg.grant); } catch (_) {}
        channels.set(peer, true); note(p.spaceKappa, self); mySpaces.add(p.spaceKappa);
        pending.delete(peer);
        emit({ kind: "connected", peer, space: p.spaceKappa, role: "joiner", admitted });
        if (p.resolve) p.resolve({ ok: !!admitted, peer, grant: msg.grant, admitted });
      }
    } catch (e) { const p = pending.get(peer); if (p && p.resolve) p.resolve({ ok: false, reason: (e && e.message) || "rendezvous failed" }); }
  }

  function onConnect(fn) { if (typeof fn === "function") listeners.add(fn); return () => listeners.delete(fn); }

  return { self, announce, advertise, onAdvert, membersOf, directory: () => directory, discoverAndJoin, handleSignal, onConnect, connectedPeers: () => [...channels.keys()] };
}

// browser binding: discovery rides the same BroadcastChannel/WAN mesh the transport already uses. The host
// wires `signal` to route over live peers; until then it is dormant (no peers ⇒ no-op), safe to load.
if (typeof window !== "undefined") {
  window.HoloDiscovery = { makeDiscovery };
}

export default { makeDiscovery };
