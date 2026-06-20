# ADR-0113 — Holo Dial: dial peers by key, fetch objects by κ (a native Iroh)

Status: **S0 LANDED (6/6); S1 + S2 CODE+WITNESS LANDED (6/6 each), live wiring pending a browser session; S3–S5 PROPOSED.** S0 proved the existing spine composes into one dial-by-κ resolver source with no new trust (`tools/holo-dial-witness.mjs`, no runtime change). S1 added the orchestrator `os/sbin/holo-dial.mjs` (`tools/holo-dial-mesh-witness.mjs`) — null with zero peers, so its pinned-boot-loader edit is behaviour-preserving. S2 added the SW↔page bridge `os/sbin/holo-dial-bridge.mjs` (`tools/holo-dial-bridge-witness.mjs`) — null on absent/silent/empty page, never blocks the SW. Both stages' remaining work is the same: add the wiring lines to pinned files, reseal + re-pin + real-browser proof (one browser session covers S1+S2). S1–S2 are the load-bearing wiring (mesh → resolver → Service Worker), browser-verified; S3–S5 are the automation + identity + honest-ceiling deltas. Ships behind the existing fail-closed κ gates — a peer is a *latency* source, never a *trust* one (Law L5).

Relates: ADR-0026 (sovereign delivery — the OS serves itself by hash; one root κ · multi-source κ SW) · ADR-0027 (survive the switch — same-origin mesh + total-offline precache) · ADR-0076 (holo-heal — the autonomous recovery loop the mesh source feeds) · ADR-0111 (holo-boot-root — the tiered root of trust this rides under) · the working note `holo-dial-iroh-assessment`.

## Context

The prompt: n0.computer's **Iroh** dials peers by public key (not IP), hole-punches with relay fallback, and transfers **content-addressed** blobs (`iroh-blobs`, BLAKE3) verified on receipt. Question asked and answered: can Hologram do the same idea **100% natively**?

The honest first-principles read is that **Iroh is three layers, and Hologram already holds two of them**:

| Iroh layer | Hologram today |
|---|---|
| Content-addressed blob transfer (`iroh-blobs`) | **Built + witnessed** — `holo-mesh-blocks.mjs`: bitswap-lite `want`/`block`/`dont`, L5 verify-on-receipt, `pairWires` Node witness, `dataChannelWire` real-transport adapter. |
| Encrypted multiplexed transport + hole-punch (QUIC + ICE) | **Built** — `holo-webrtc-link.mjs` (`RTCPeerConnection`, ordered DataChannel, non-trickle ICE, public STUN) and `holo-rtc.js` (full serverless mesh: DTLS-SRTP media + content-blind κ pub/sub signaling, AES-256-GCM room seal, W3C perfect negotiation). |
| Dial-by-**key** identity + relay fallback | **Partial** — `holo-rtc.js` dials by *room secret* (`#k=…` → HKDF topic+key), not a persistent peer **EndpointId**. STUN only, **no TURN** (deliberate: a relay would carry media, breaking serverless+private). Symmetric NAT with no relay is the stated honest limit. |

The browser is the binding constraint, and it cuts the same way for everyone: a browser tab cannot open a raw UDP socket, so native QUIC hole-punching is unavailable. The browser-native equivalent is **WebRTC DataChannels** — ICE is the hole-punch, DTLS the encryption, SCTP the multiplexed streams. Hologram already uses exactly this. So "100% native in the browser" is achievable for the *transfer and transport* layers, and the one piece nobody can make zero-infrastructure — a relay for the ~10% of peers behind symmetric/CGNAT — is the **identical ceiling Iroh hits** (its public relays carried 200M endpoints last month *because* hole-punching fails ~1 time in 10).

The real gap is not capability; it is **wiring**. The autonomous heal/boot loop already lists a mesh peer as recovery source #5, but it is stubbed:

```js
// holo-heal-boot.mjs
const askMesh = async () => null;                 // ← the mesh transport is NOT connected
const sources = [ cacheSource(...), originSource(...), webSource(...), ipfsPeer({ ipfs }),
                  bridgePeer("mesh", askMesh) ];  // ← so this source always returns null
```

`bridgePeer("mesh", ask)` is the exact seam: connect `ask(κ)` to the live `holo-mesh-blocks` running over a real `RTCDataChannel`, and the whole substrate — boot, heal, app streaming — gains peer-to-peer κ delivery with **no new trust** (the resolver re-derives every byte; a hostile peer is refused identically to a hostile origin).

## Decision

Build **Holo Dial**: a native dial-by-κ peer transport that plugs into the existing source chain. No new verification model, no new addressing — κ stays the address; WebRTC becomes one more *re-derived* source. The work is to compose what exists, wire the mesh into the resolver (page **and** Service Worker), automate the rendezvous, then add persistent peer identity and the honest relay ceiling.

### S0 (inventory + compose-witness) — prove the spine is one transport **[LANDED]**

No new runtime code. A single Node witness (`tools/holo-dial-witness.mjs`) drives both transports — the in-memory `pairWires` **and** the real binary adapter `dataChannelWire` over a mock `RTCDataChannel` pair (the leg prior witnesses left untouched) — through `createMeshBlocks` → `bridgePeer` → the resolver, and asserts: a κ held only by peer A is fetched by peer B and **accepted only after re-derivation**; a tampered byte from A is **refused** twice (mesh `verifyBlock` drops it, the resolver re-derive backs it up) with nothing laundered; a lying raw source proves the **resolver is the final gate**; an absent κ settles by `dont` with **no timeout hang**; a resolved κ then serves from the **local store with no peer** (the device seeds). Witnessed **6/6** (`composesInMemory · composesDataChannel · refusesTampered · resolverIsFinalGate · declinesUnheld · seedsThenServesLocal`).

### S1 (page-realm wiring) — un-stub the mesh, two-tab proof **[CODE + WITNESS LANDED; live wiring PENDING a browser session]**

Built `os/sbin/holo-dial.mjs` — the dial-by-κ **orchestrator**: hold a set of live channels, run a `createMeshBlocks` over each, and `askMesh(κ)` fans the `want` across all peers, returning the first re-derived block. `getLocalBlock` is backed by the durable κ-store, so a device that healed a κ **serves** it to others ("can recover" → "will"). The load-bearing safety property: **with zero peers `askMesh(κ)` returns `null` without touching `ipfs` — byte-for-byte the old stub** — so wiring it into the pinned heal/boot loop changes nothing until a channel is actually attached. Channels arrive via `addChannel(dc)` (a real `RTCDataChannel` from `holo-webrtc-link` / `holo-rtc` / S3) or `addWire(wire)` (the SW bridge in S2).

Witnessed **6/6** (`tools/holo-dial-mesh-witness.mjs`): `fansAcrossPeers · honestAmongLiars` (a tampered peer never delays the honest one) `· noPeersReturnsNull · servesLocalToPeers · integratesResolver · detachStopsServing`.

The **one remaining edit** is in the pinned boot loader `lib/holo-heal-boot.mjs` — replace the stub with the orchestrator, built once at boot and fed `getLocalBlock` from `kget`:

```js
import { makeDial } from "/sbin/holo-dial.mjs";
const dial = makeDial({ ipfs, getLocalBlock: async (cid) => { try { return await kget("cid:" + cid); } catch { return null; } } });
self.__holoDial = dial;                                   // S3 rendezvous / a Meet room / manual link → dial.addChannel(dc)
const askMesh = (kappa) => dial.askMesh(kappa);           // ← replaces `const askMesh = async () => null;` (null until a channel exists)
```

This is held back deliberately: `holo-heal-boot.mjs` is a **κ-pinned boot loader**, so editing it in place creates drift unless followed by reseal (`relock-app.local.mjs`) + re-pin (`repin-boot-loaders`) + a real-browser boot check — none of which this build harness can perform (cf. ADR-0111's harness caveat). The edit is behaviour-preserving (null with no peers, proven above), so it is safe to land *together with* the reseal in a browser-capable session, not before.

Browser proof (the S1 acceptance gate, runs in that session): two tabs, same `#k=…`; deny the origin for a specific κ; tab B resolves it **over WebRTC from tab A**, L5-verified, rendered. Strong variant: two devices on one Wi-Fi in airplane-mode-to-the-internet. This is the moment apps-stream-by-κ stops being gateway-dependent on the LAN.

### S2 (the Service-Worker backend-swap) — peers satisfy SW navigations **[CODE + WITNESS LANDED; live wiring PENDING a browser session]**

The resolver that serves byte-0 runs in the **Service Worker**; `RTCPeerConnection` does **not** exist there. So the mesh lives in the page and the SW reaches it over the SW↔client bridge — exactly what `bridgePeer` was built for. Built `os/sbin/holo-dial-bridge.mjs` — the two halves of that bridge, factored out of the inline sketch so both realms share one tested protocol:

- `swAskMesh({ clients, timeoutMs })` — the SW side: post the κ to the first controlled window client over a fresh `MessageChannel`, resolve the reply bytes, or **null on no-client / silent page / timeout / empty reply** (a slow or absent page can never wedge the SW). Drop into the SW source chain as `bridgePeer("mesh", swAskMesh({ clients }))`.
- `servePageMesh(dial, …)` — the page side: on a `holo-dial/want`, fetch the κ from the live `dial` (S1) and reply over the message port; ignore any non-WANT message.

Witnessed **6/6** (`tools/holo-dial-bridge-witness.mjs`, Node's native `MessageChannel` probed faithful — `onmessage` auto-starts, `Uint8Array` clones): `bridgesPageToSW · refusesTamperedReply` (the resolver re-derive is the final gate even over the bridge) `· noClientReturnsNull · silentPageTimesOut · emptyReplyNull · ignoresForeignMsgs`.

Remaining (browser session): add the one `sources.push(bridgePeer("mesh", swAskMesh({ clients })))` line to `holo-fhs-sw.js`'s resolver assembly, and `servePageMesh(self.__holoDial, …)` in the page companion. Both touch **pinned** files → reseal + re-pin + real-browser boot check, same caveat as S1. Once live, **one bridge lights three paths** — boot, heal, app-stream — because all three resolve through the same SW source chain. The sealed anchor (constitution · conscience gate · closure root) stays excluded: a peer can restore content, never rewrite the law.

### S3 (serverless rendezvous) — connect two cold devices from one link

`holo-webrtc-link` is **manual** (copy/paste SDP); `holo-mesh-blocks` notes the "live-only layer above" — automatic FIND+connect — as not-yet-built. Close it: derive the signaling topic from the shared `#k=…` secret (HKDF, the `holo-rtc` idiom), publish the sealed offer/answer as **content-addressed κ objects on a content-blind topic**, and let two browsers complete ICE with no manual step. The rendezvous sees only ciphertext on a random topic; sealing also authenticates, closing the unauthenticated-DTLS-fingerprint MITM. Keep the rendezvous **swappable and κ-addressed** so it is a commodity, never an authority.

### S4 (dial-by-key proper) — a peer is a key, across sessions

Today a peer is addressable only *within a room secret*. Iroh's actual headline is a persistent **EndpointId = public key**. Mint a per-device keypair (WebCrypto Ed25519/ECDSA, stored in the durable arena), let `EndpointId = κ(pubkey)`, and make the rendezvous resolve `EndpointId → current paths`. Now a peer is dialable by its key across rooms and sessions — the literal "dial keys, not IPs," native and content-addressed. Signaling stays sealed; the EndpointId is itself a κ, so it composes with everything.

### S5 (the honest ceiling) — optional relay for symmetric NAT

State plainly what cannot be zero-infrastructure: peers behind symmetric/CGNAT cannot hole-punch, and a relay must carry their bytes. Add an **optional, κ-addressed, content-blind relay** as the last source — bytes are sealed and re-derived end-to-end, so the relay is a dumb pipe that learns nothing, and it is swappable like any gateway. This mirrors Iroh's relay exactly and is the single thing that prevents a literal "100% serverless" claim. Never claim more than this (cf. ADR-0111's cold-byte honesty).

## Witness plan

Each stage lands with a witness; browser rows are Node-simulated first, then real-browser-confirmed before any boot byte changes (the harness caveat from ADR-0111 applies — the shell renderer is unresponsive to preview tools).

- **S0 [LANDED]** `tools/holo-dial-witness.mjs` — peer-A-only κ fetched by peer-B via the full chain over **both** `pairWires` and the real `dataChannelWire` frame; **tampered byte refused** (unresolved, nothing laundered); resolver-is-final-gate; absent-κ no-hang; resolved-κ serves local. Pure Node, **6/6**.
- **S1 [witness LANDED]** `tools/holo-dial-mesh-witness.mjs` (6/6) — orchestrator fan-out, honest-beats-liar, device-seeds, resolver-source, null-with-no-peers. Then (browser session) two-tab script: origin denied for κ X → tab B renders X over WebRTC, footer `verified ✓`; offline-LAN variant as the strong proof.
- **S2 [witness LANDED]** `tools/holo-dial-bridge-witness.mjs` (6/6) — `MessageChannel` round-trip returns re-derived bytes; tampered reply refused; no-client/silent/empty all resolve null without blocking; foreign messages ignored. Then real-browser: kill the gateway, navigate, peer serves the page.
- **S3** rendezvous witness — two `RTCPeerConnection`s complete ICE using only sealed κ-signaling objects on a shared secret; no manual SDP; MITM with a swapped DTLS fingerprint is rejected by the seal.
- **S4** identity witness — `EndpointId = κ(pubkey)` is stable across reloads; dial-by-EndpointId resolves to a live channel; rotating the rendezvous does not change the EndpointId.
- **S5** relay witness — symmetric-NAT-simulated pair connects only via relay; relay sees ciphertext only; bytes still re-derive end-to-end; relay swap is transparent.

Conformance rows (turn green per stage): `#dial-compose` `#dial-mesh-page` `#dial-sw-bridge` `#dial-rendezvous` `#dial-by-key` `#dial-relay-ceiling`.

## Honest boundaries

- **A browser tab cannot do native UDP/QUIC hole-punching.** WebRTC is the native equivalent and is what ships here; this is a platform fact, not a substrate limit, and it is the same constraint any in-browser P2P system has.
- **Literal "100% serverless" is impossible — for Hologram and for Iroh.** Symmetric/CGNAT peers need a relay (S5) and any first connection needs a rendezvous (S3). The native win is making both **content-blind, sealed, κ-addressed, and swappable** so they are commodities, not authorities — never that they vanish.
- **No new trust is added by any peer.** The resolver re-derives every byte (Law L5), so a hostile peer is refused exactly like a hostile origin. The sealed anchor is never peer-healed.
- **S1–S5 cannot be fully browser-verified in this harness.** They are validated by `node --check`, the witnesses, and Node simulation of the SW/RTC logic, then must pass a real two-tab/two-device browser check before the heal/boot path's mesh source goes live.

## Staged plan

- **S0 [LANDED].** Compose-witness the existing spine as one transport. No runtime change. (`tools/holo-dial-witness.mjs`, 6/6)
- **S1 [code+witness LANDED].** `os/sbin/holo-dial.mjs` orchestrator + `tools/holo-dial-mesh-witness.mjs` (6/6). Remaining: replace the `askMesh` stub in `lib/holo-heal-boot.mjs` with `dial.askMesh` + reseal + re-pin + two-tab/offline-LAN browser proof (browser session).
- **S2 [code+witness LANDED].** `os/sbin/holo-dial-bridge.mjs` (`swAskMesh` + `servePageMesh`) + `tools/holo-dial-bridge-witness.mjs` (6/6). Remaining: add the `bridgePeer("mesh", swAskMesh(...))` line to `holo-fhs-sw.js` + `servePageMesh` in the page; reseal + re-pin + browser proof (same session as S1). Lights boot · heal · app-stream from peers.
- **S3.** Serverless automatic rendezvous from `#k=…`; retire manual SDP for the auto path.
- **S4.** Persistent `EndpointId = κ(pubkey)`; dial-by-key across rooms/sessions.
- **S5.** Optional κ-addressed content-blind relay; document the ceiling, never overclaim.
