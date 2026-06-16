# ADR-0107 — Onion without local Tor: a κ-substrate path to render `.onion` from a serverless tab, honestly

Status: **EXPLORATION / DESIGN ONLY — no code.** Research-backed (four sourced threads: Arti-WASM, browser transports, Tor v3 trust model, peer-relay/commons/Brave). Decides a *direction* and a staged spike plan; commits nothing to the closure. 2026-06-16.

Relates: [[holo-onion-omnisearch-adr]] (ADR-0103 — the onion leg already landed: address self-validation + gateway/SOCKS5 transports + the egress receipt) · [[web-commons-snapshot]] (`holo-web-snapshot.mjs` — seal a page into an IPFS κ-DAG served serverlessly) · [[holo-onnx-forge-adr]] (ADR-0101 — demand-paged, range-streamed κ binaries; the precedent for κ-streaming a WASM engine) · [[ipfs-native-browsing]] (the κ gateway: a source is a latency choice, never trust) · holospaces Laws L1 (content not location) / L5 (verify by re-derivation). Full evidence: [`docs/specs/holo-onion-no-local-tor.md`](../specs/holo-onion-no-local-tor.md).

---

## Context

ADR-0103 made `.onion` a first-class omnibar leg: the address self-validates offline (ed25519 pubkey + SHA3-256 checksum, L5 on the address), and the bytes render through a configured transport (local Tor SOCKS5, auto-detected; or a gateway), pinned in a `hosc:Egress` receipt with `directTor:false`. The honest gap that remained: **reaching the bytes still needs Tor running locally**, and the public Tor2web HTTP gateways are extinct (DNS-resolve, refuse connections). So "browse onion with zero install" was unmet.

This ADR asks whether the **unified κ substrate** can close that gap without lying about the trust model.

### The finding that bounds everything

**A pure browser tab cannot build a real, anonymous Tor circuit today.** A tab has no raw TCP; Tor's relay protocol is TLS-over-TCP to guards. Every shipping "Tor from a browser" runs the circuit-building client elsewhere: Brave/Tor Browser **bundle a native `tor` process** (Brave points Chromium at `socks5://127.0.0.1:<port>` — [brave#649](https://github.com/brave/brave-browser/issues/649)/[#650](https://github.com/brave/brave-browser/issues/650)); lightnion builds the circuit **server-side** (its authors warn it is not for anonymity). The only design that puts a real client *in the tab* — **Arti compiled to WASM** — is an open Tor issue ([arti#103](https://gitlab.torproject.org/tpo/core/arti/-/issues/103)), not a release, and even then needs a WebSocket/WebRTC carrier to reach relays. Snowflake's browser role is a **proxy for others**, not a client; it builds no circuits.

### The finding that makes an honest path possible

The onion **`address → descriptor → rendezvous` chain is ed25519/curve25519-signed end-to-end, rooted in the address.** A client recomputes the blinded key from the address, fetches the descriptor from *any* (untrusted) source, and verifies the cert ladder; hs-ntor proves the peer is the real service and yields forward-secret keys. An untrusted relay/bridge/mirror can **deny or observe**, but **cannot forge the service, tamper with descriptor/consensus, or decrypt the stream.** The consensus is majority-signed by the directory authorities and microdescriptors are SHA-256-referenced — i.e. **Tor's metadata is already a content-addressed, self-verifying object graph.** This is exactly the κ trustless-gateway property: a source is a latency choice, never a trust one.

So the path is not "fake a circuit." It is: **move the one-time need for a circuit off the user's machine, and let the κ substrate serve the self-verifying result** — while the receipt states the true trust state.

---

## Decision

**Pursue the κ substrate's genuine strengths in three honest stages; do not pretend a tab is an anonymous Tor client.** Each render declares its true trust state in the `hosc:Egress` receipt (extend ADR-0103's vocabulary): `commons-replay`, `peer-relay`, or `arti-circuit` (the only `directTor:true`).

### What the κ substrate uniquely adds (load-bearing, not decoration)

1. **Tor's metadata as first-class κ objects.** Consensus / microdescriptors / HS descriptors are signed + (partly) hash-referenced → self-verifying κ citizens. The κ-store over IndexedDB/OPFS **is the directory-cache backend Arti-WASM needs** (directly attacks arti#103's storage blocker), and descriptor *resolution* can ride the κ layer as a mirror-safe fast path beside the HSDir DHT. We pin the directory-authority key set in the closure (the one non-address anchor); everything else is fetched-and-re-derived.
2. **κ-stream the Arti-WASM engine** as a demand-paged, range-streamed κ object (ADR-0101). "Install" becomes "κ-verify a downloaded module," L5 per block.
3. **The commons turns "needs a circuit" into "needs a circuit once, anywhere."** `holo-web-snapshot.mjs` already seals a page into an IPFS κ-DAG the gateway serves serverlessly, re-derived. Point it at an onion page fetched once (by any peer with Tor) → every later render is pure κ replay, **zero Tor in the serving path.**
4. **The egress receipt is the honest trust ledger.** L5 re-derivation + a truthful `hosc:onionTrust` makes the boundary auditable instead of fudged.

### Staged spike plan (riskiest unknown first)

- **Stage 0 — κ-commons onion replay (buildable now, no new infra).** Seal a **public** onion page (fetched once by a peer that has Tor) into a κ-DAG; everyone else renders it serverlessly, re-derived. Receipt `onionTrust:"commons-replay"`, `directTor:false`, sealer + timestamp; require ≥2 independent sealers agreeing on the κ for provenance. UX states plainly: cached snapshot, integrity-verified, not live, public only. **Soonest path to "read public onion content" with no install.**
- **Stage 1 — borrow-a-peer relay.** A κ-mesh peer running real Tor exposes a libp2p stream (WebRTC / circuit-relay-v2); the tab dials it to SOCKS-dial the onion. Receipt `onionTrust:"peer-relay"`, names the relay, `directTor:false`. UX: "anonymous to the onion, fully exposed to the relay." Riskiest unknown: a maintained peer-side libp2p↔Tor-SOCKS bridge + browser dialer.
- **Stage 2 — Arti-WASM north star (only honest `directTor:true`).** Spike the existential unknown **first**: a custom `NetStreamProvider` (`tor-rtcompat`) carrying Tor cells over WebSocket to a guard, completing **one circuit handshake**. Then κ-store as the directory cache + κ-streamed arti module. Months out.

---

## What is NOT achievable in-tab (state plainly, do not paper over)

A pure browser tab cannot build a Tor circuit without **both** (a) an in-tab WASM Tor client (Arti — storage + transport shims unwritten; `ring`/`std::time`/`rusqlite` all need replacing) **and** (b) a browser-reachable bridge transport (WS/WebRTC to a guard/bridge that accepts it). Until both exist, **live, anonymous, interactive in-tab onion is impossible.** Everything shippable today is either a **mirror** (commons: public, stale, integrity-not-provenance) or a **trusted relay** (peer: full trust in the relay). Both are honest and useful; neither is anonymous-in-tab, and the receipt must say so. Do **not** default to public Tor2web gateways (extinct) and do **not** label a server-side or relay-side circuit "direct Tor."

## Consequences

- A clear, honest north star (Arti-WASM) with the κ substrate solving two of its named blockers (storage + module delivery) — and a shippable near-term win (commons replay) that needs no new infrastructure.
- The trust model is auditable by construction: `hosc:onionTrust` + L5 re-derivation, never a faked circuit.
- Risk: the commons path is integrity-not-provenance; mitigated by multi-sealer attestation, never by pretending content-addressing proves "what the onion serves now."
- Next concrete step if accepted: a Stage-0 spike — `holo-web-snapshot` an onion page through the existing SOCKS5 adapter on a Tor-bearing peer, serve it serverlessly to a peer with no Tor, witness the κ re-derivation + the `commons-replay` receipt.
