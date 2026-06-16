# Serverless signaling + relay for the Hologram commons mesh

Status: design. The shared crux for **commons-publish** (a peer fetches your sealed snapshot) and **borrow-a-peer** (a fresh tab fetches the live web via a peer). Grounded in holospaces-web's existing transport.

## What already exists (reuse, don't rebuild)

- **Transport — `holospaces-web/src/webrtc.rs` (`WebRtcLink`)**: a real browser↔browser `RtcDataChannel` with **no server**. It owns the `RtcPeerConnection` + one ordered/reliable channel, exposes gathered **local ICE** + accepts the **remote SDP/ICE**, and does **L5 verify-on-receipt** in the content peer (a forged block is rejected on re-derivation; a κ no peer holds resolves to nothing). The module's own doc states signaling is **out of band** — "pasted between tabs, carried over an existing peer, or relayed by any content-blind channel — never by a bespoke server."
- **Block exchange — `Console` content-net (`cn_pump`)**: already does κ-block want/serve over `WebRtcLink`. OS2's [holo-mesh-blocks.mjs](system/os/sbin/holo-mesh-blocks.mjs) is the verified JS twin (drop-in `getBlock` for the gateway; L5; tampering rejected — Node-proven).
- **Data plane (OS2)**: seal → [holo-web-snapshot.mjs](system/os/sbin/holo-web-snapshot.mjs) (κ-DAG + CAR) → resolve via the gateway. All re-derived, all verified.

**So the only thing missing is the rendezvous: how two browsers find each other and exchange the first SDP offer/answer/ICE with no signaling server.**

## The honest constraints (WebRTC physics)

1. **WebRTC needs *some* rendezvous** — the offer/answer/ICE must cross between peers before the channel exists. "Serverless" means *no operator server*, not *no infra* — it can ride public commons (a circuit relay, pubsub) or a human channel (paste/QR/share-link).
2. **NAT**: candidate gathering needs **STUN** (lightweight, public — e.g. a public STUN server; commons). Symmetric-NAT peers need a **relay** (TURN, or a **libp2p Circuit Relay V2** — prefer the latter, it's the sovereign commons form). A browser node **can't be dialed in** without a relay (the same finding that ruled out a self-serving Helia node).

## The key idea: **content-addressing IS the rendezvous key**

A peer doesn't want "a connection to Bob" — it wants **the providers of `rootCid`**. So the rendezvous topic = the CID. Anyone holding `rootCid` and anyone wanting it meet at a point keyed by `rootCid` (exactly IPFS "find providers", but P2P + serverless). The signaling payload (offer/answer/ICE) is just small bytes — itself content-addressable + sealable.

## The rendezvous ladder (try the most automatic reachable; fall back)

`holo-egress-connect` / the mesh layer walks this with **zero user choice**:

1. **Peer-assisted gossip** — already in the mesh? Signal new peers *over an existing `WebRtcLink`* (offer/answer for peer C ride your link to B, who relays). Zero infra after bootstrap; the network bootstraps itself.
2. **Public Circuit Relay V2 rendezvous** — connect to a public libp2p circuit relay (commons infra), register/discover by `rootCid`, relay-assisted connect, then **upgrade to direct WebRTC**. Automatic; depends on relay availability (a known public relay multiaddr, or a small rotating set).
3. **Content-addressed dead-drop** — a mutable rendezvous keyed by `hash(rootCid)` (an IPFS-pubsub topic, or an IPNS pointer): A publishes its offer, B fetches + replies an answer. Semi-automatic; depends on a public pubsub/IPNS commons (which itself needs a relay connection — so usually #2 first).
4. **Manual / QR / share-link (the sovereign floor)** — A's offer is a short string; share it by ANY channel the user already has (a chat, a QR, a "Share" link), B pastes back the answer. **Zero infra, fully sovereign, always works** — a human step. This is also the natural UX: **sharing a sealed page carries the rendezvous** (the share link = `ipfs://rootCid` + a peer hint), so "share this page with a friend" *is* "offer them a peer connection to fetch it from me."

Signaling messages are small JSON `{type:offer|answer|ice, sdp|candidate, rootCid}`; optionally **κ-sealed** (the offer is content-addressed; a `hosc:Egress`-style receipt records who relayed for whom). The mesh stays governed (default-deny: you only serve/relay for peers you've accepted; rate-limited; receipted) on every rung.

## Reuse map

| Layer | Provided by | Status |
|---|---|---|
| WebRTC transport (no server) | `holospaces-web webrtc.rs WebRtcLink` | exists |
| κ-block want/serve + L5 | `Console cn_pump` / OS2 `holo-mesh-blocks.mjs` | exists / Node-proven |
| Data plane (seal/CAR/resolve) | OS2 snapshot + gateway | built + proven |
| **Rendezvous ladder** (gossip · circuit-relay · dead-drop · manual/share) | **net-new (this design)** | to build |
| STUN / Circuit-Relay-V2 | public commons | external dependency (honest) |

## First build (smallest real proof, live)

The **manual/share-link rung** — it's the only truly *zero-infra* rung and proves the whole stack end-to-end without depending on a relay: A creates an offer (button → a share string/QR), B pastes it, the `WebRtcLink` opens, `holo-mesh-blocks` runs over it, and **B fetches A's sealed snapshot `rootCid` over the channel, re-derived, via the gateway**. That validates transport + protocol + data plane with two real browsers and *nothing else*. Then layer the **circuit-relay rung** for automatic rendezvous (the scalable path), and **gossip** for the network effect.

## Honest boundaries

- Truly automatic + sovereign rendezvous depends on **public commons infra** (circuit relay / pubsub) — no operator server, but not *no* infra. The manual/share rung is the only fully-self-contained one.
- **STUN** (public, light) is fine; **TURN/relay** is needed for symmetric NAT — prefer Circuit-Relay-V2 (sovereign commons) over a TURN server.
- A peer only serves while online; persistence comes from the **collective re-cache** (the gateway already caches fetched blocks) — the commons self-sustains as it's used.
- The live transport (real WebRTC + relay) is **not verifiable in a headless harness** — it needs two real browsers + a relay.
