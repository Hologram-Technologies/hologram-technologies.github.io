# Findings — reaching Tor `.onion` from a serverless Holo tab with no local Tor install

Research synthesis for [ADR-0107](../adr/0107-holo-onion-no-local-tor.md). Companion to [ADR-0103](../adr/0103-holo-onion-omnisearch.md) (the onion leg: address self-validation + gateway/SOCKS5 transports already landed). Four parallel research threads (Arti-WASM, browser transports, Tor v3 trust model, peer-relay/commons/Brave), each sourced; caveats flagged inline.

## The headline answer

**A pure browser tab cannot build a real, anonymous Tor circuit today.** Every shipping "Tor from a browser" runs the actual circuit-building client *somewhere else* — a local native daemon (Brave, Tor Browser) or a server (lightnion). The one path that would put a real client in the tab — **Arti compiled to WASM** — is incomplete (an open Tor issue, not a release) and *still* needs a non-browser transport to reach relays.

**But the question has an honest, buildable answer if we relax "live anonymous in-tab" to "render onion content with the trust state pinned truthfully."** The unified κ substrate makes one of these paths unusually strong and shippable now, and turns the hard one (in-tab Arti) from "impossible" into "missing two specific shims the substrate already implies." The irreducible blocker is real and named below; the creative κ angles are real and not decoration.

---

## The crux: how onion bytes reach a TCP-less tab

### 1 · Arti-in-WASM (the only in-tab-anonymity path) — blocked today, viable-with-shims later

- WASM has been an explicit Arti **goal since 2021** but remains aspirational. Tracking issue: [arti#103 "Port Arti to WASM"](https://gitlab.torproject.org/tpo/core/arti/-/issues/103) (+ work-item #20 "build in wasm; identify blockers"). No official browser build, no demo, no `arti-client` WASM support ([docs.rs/arti-client](https://docs.rs/arti-client/latest/arti_client/) lists only Tokio/async-std/smol).
- **The right seam exists.** `tor-rtcompat` exposes `NetStreamProvider` (the TCP backend), `TlsProvider`, and `CompoundRuntime`; the docs explicitly invite embedders to "proxy TCP connections over your own custom transport" (`examples/hook-tcp.rs`). So Arti *can* be backed by a browser transport — but **no WASM `Runtime` ships**, so you'd write it.
- **Two hard blockers, not one.** (a) **TCP:** a tab has no raw sockets, so Arti's cell stream must ride WebSocket/WebRTC to a bridge. (b) **Storage:** Arti persists the directory cache + state via `FsStateMgr` (`tor-persist`) and **`rusqlite`** (`tor-dirmgr`) — neither works in a tab; #103 calls out the SQLite entanglement specifically. Plus WASM friction: `ring` fails on `wasm32` ([ring#657](https://github.com/briansmith/ring/issues/657)) → swap to RustCrypto; `std::time` panics ([rust#48564](https://github.com/rust-lang/rust/issues/48564)) → `web-time` shims; `getrandom` needs the `js` feature. Expect a multi-MB module; cold start dominated by **Tor bootstrap** (fetch + validate the consensus).
- **Prior art is only adjacent.** Snowflake's *proxy* compiled to WASM ([snowflake#28942](https://gitlab.torproject.org/tpo/anti-censorship/pluggable-transports/snowflake/-/issues/28942)) — but a Snowflake browser is a **proxy donating bandwidth to others**, it builds no circuits and reaches no onion. **Nothing real reaches a v3 onion from in-browser WASM.**
- **Verdict:** *viable-with-transport-shim*, months of work. **Spike #1 (riskiest unknown):** prove a custom `NetStreamProvider` can carry Tor cells over WebSocket to a guard relay and complete **one circuit handshake**.

### 2 · TCP-less transports — none make a plain tab a real client

The structural fact governs everything: **a tab cannot open raw TCP**, and Tor's relay protocol is TLS-over-TCP to guards. So a bridge/proxy must translate, and the only question that matters is *where the circuit logic lives.*

| Transport | Where the real Tor client runs | What the tab actually is |
|---|---|---|
| **Snowflake** (WebRTC) | local **Go** `snowflake-client` + local **tor** | a **proxy for others** — carries an opaque KCP/smux stream, **not** raw cells, builds **no** circuits ([bamsoftware paper](https://www.bamsoftware.com/papers/snowflake/), [keroserene overview](https://keroserene.net/snowflake/technical/)) |
| **WebTunnel / obfs4-over-WS** | client-side native PT + native **tor**; bridge runs tor | a carrier into native tor ([Tor blog, WebTunnel, Mar 2024](https://blog.torproject.org/introducing-webtunnel-evading-censorship-by-hiding-in-plain-sight/)) |
| **lightnion** (WS→TCP gateway) | **server-side** — the circuit is built on the server | a **remote proxy in a Tor costume — not anonymous**; authors warn "do not use… for anything that really requires anonymity"; alpha ~2018 ([spring-epfl/lightnion](https://github.com/spring-epfl/lightnion)) |
| **arti-wasm over WS/WebTransport→bridge** | *would be the tab* — incomplete | the only honest in-tab-client path; **not shipping** |

**Verdict:** the #1 candidate is **arti-wasm over a WebSocket/WebTransport carrier to a bridge** — the only design where the tab builds the real circuit. Snowflake-style WebRTC is a viable *carrier* but only paired with arti-wasm. Anything that terminates the circuit server-side (lightnion, "WS→TCP→tor" gateways) **must not be labelled direct Tor** — pin `directTor:false` and name the trusted terminator.

### 3 · Borrow-a-peer relay — real, but it's trust, not anonymity

- A browser libp2p node **cannot** open raw TCP/QUIC/SOCKS ("not possible… from within the browser" — [libp2p browser-connectivity](https://libp2p.io/docs/browser-connectivity/)), but it **can** dial another peer over **WebRTC / WebTransport / circuit-relay-v2** and open a generic application stream. So the tab asks a peer that runs real Tor to do the SOCKS dial.
- **Prior art:** the "libp2p-rides-on-Tor-SOCKS5" pattern is proven **natively** (COMIT's [rust-libp2p over Tor PoC](https://comit.network/blog/2020/07/02/tor-poc/)); [libp2p onion-routing (specs#200)](https://github.com/libp2p/specs/issues/200) is exploratory/never-standardized; [node-Tor](https://github.com/Ayms/node-Tor) is a browser-JS Tor client but **stalled/unfunded** — a reference, not a dependency.
- **Honest trust note (must be shown):** if the peer runs the Tor client, **the peer is the Tor user, not the tab.** The peer sees the tab's plaintext at the SOCKS boundary (even the HS stream terminates inside the peer's Tor client), and the tab reveals its IP to the peer over WebRTC. **You trust the relay completely.** Connectivity hack, not anonymity.

### 4 · Snapshot / commons replay — the path the κ substrate is *built* for

- One peer, once, uses a real Tor circuit to fetch a **public** onion page; the bytes are sealed into a content-addressed (IPFS/κ) DAG and re-derived to peers who never touch Tor. This is web archiving with a content-addressed backing store.
- **Prior art:** the [Dark Web Archival Framework (arXiv 2107.04070)](https://ar5iv.labs.arxiv.org/html/2107.04070) crawls onion through a Tor proxy → stores **WARC** → replays with **pywb** (no Tor at replay); [archive.today](https://en.wikipedia.org/wiki/List_of_Tor_onion_services) snapshots pages; [ipfs-site-mirror](https://github.com/Permissionless-Software-Foundation/ipfs-site-mirror) is the content-addressed-serving half. **No single system composes Tor-fetch → IPFS/κ-seal → serverless replay** — that composition is net-new but assembled from proven parts.
- **Honest limits (must be shown):** **public, cacheable content only** (no auth/dynamic/per-user); a **mirror, not a live connection**; **stale** from the instant of capture; content-addressing gives **integrity** (re-derives to its hash, tamper-evident) but **not provenance** ("this is the blob the fetcher sealed," not "this is what the onion serves now"). Mitigation is social/crypto attestation — multiple independent fetchers sealing the **same** hash, signed capture receipts — not inherent to content-addressing.

### Reference point — how Brave does "onion in a normal browser"

Brave **bundles and launches a real `tor` binary** (Tor Expert Bundle), runs it on a local SOCKS5 port, and points Chromium's proxy at `socks5://127.0.0.1:<port>` ([brave-browser#649](https://github.com/brave/brave-browser/issues/649), [#650](https://github.com/brave/brave-browser/issues/650), [Tor-tabs beta](https://brave.com/blog/tor-tabs-beta/)). Its seamlessness is **entirely** because it can spawn a native process — the one thing a pure web tab cannot do. **Brave is the counterexample, not a template.**

---

## The trust spine: why an untrusted transport is safe (the κ-gateway property, proven)

The most important finding — the onion `address → descriptor → rendezvous` chain is **ed25519/curve25519-signed end-to-end and rooted entirely in the address**, so an untrusted relay/bridge/mirror **cannot forge the service or read the stream**. This is a genuinely content-addressed, trustless model — the same property that makes a κ gateway a latency choice, never a trust one.

- **The address IS the key:** `base32(KP_hs_id ‖ checksum ‖ 0x03)` where `KP_hs_id` is the 32-byte ed25519 master identity key (rend-spec-v3 [ONIONADDRESS]; checksum is SHA3-256 — *not* keccak256, the same gotcha ADR-0103 hit).
- **Descriptor is self-verifying from the address alone:** the client recomputes the **blinded key** + subcredential from the address ([SUBCRED]/[KEYBLIND]), fetches the descriptor from *any* HSDir, and verifies the cert ladder identity → blinded → descriptor-signing → signature. **Authenticated-by-content; the source is irrelevant.** A tampered descriptor fails verification (bodies are double-encrypted, so the HSDir can't even read the intro points).
- **Connection-time auth:** **hs-ntor** (curve25519) mixes the service's `AUTH_KEY`/`B` (from the signed descriptor) + subcredential → completing the handshake **proves the peer is the real service** and yields forward-secret keys the intro/rendezvous points never hold.
- **Directory is mirror-safe:** the consensus is **majority-signed** by the directory authorities; microdescriptors are referenced **by SHA-256 hash** inside it → self-verifying objects any untrusted cache can serve. The **one** non-address root: the directory-authority key set (hardcoded, majority-signed) — pin it yourself, don't trust the mirror that hands you the consensus.
- **What an untrusted transport CAN do:** deny/delay/drop; observe you're using Tor + your IP at the guard hop + traffic timing; serve stale-but-validly-signed docs. **CANNOT:** forge/impersonate the service, tamper descriptor/consensus undetected, or decrypt/modify the stream. The blinded key even hides *which* onion you're asking for from the HSDir.

Sources: [address-spec](https://spec.torproject.org/address-spec) · [rend-spec-v3](https://github.com/torproject/torspec/blob/main/rend-spec-v3.txt) · [deriving-keys](https://spec.torproject.org/rend-spec/deriving-keys.html) · [rendezvous-protocol](https://spec.torproject.org/rend-spec/rendezvous-protocol.html) · [computing-consensus](https://spec.torproject.org/dir-spec/computing-consensus.html). (Caveat: three spec.torproject.org pages refused WebFetch; cert-chain section numbers come from the GitHub rend-spec-v3.txt + corroborating snippets, not a direct HTML read — the cryptographic claims are consistent across all sources.)

---

## What the κ substrate uniquely contributes (not decoration)

1. **Tor's metadata becomes first-class κ objects.** Consensus, microdescriptors, and HS descriptors are authority/service-signed and (for microdescs) already hash-referenced → they are *exactly* the kind of self-verifying object the κ-store exists to serve, re-derived (L5). Two payoffs: (a) the κ-store over IndexedDB/OPFS **is the directory-cache / `StateMgr` backend arti#103 needs** — it directly attacks Arti's storage blocker; (b) descriptor *resolution* can ride the κ layer (content-addressed, mirror-safe) as a fast path beside the HSDir DHT. The directory-authority key set is the one anchor we pin in the closure, not fetch.
2. **The Arti-WASM engine ships as a demand-paged κ object.** Reuse ONNX Forge (ADR-0101) range-streaming: "install" becomes "κ-verify a downloaded, demand-paged module," no system install, L5 on every block.
3. **The commons turns "needs a circuit" into "needs a circuit once, anywhere."** `holo-web-snapshot.mjs` already seals a page into an IPFS κ-DAG the existing gateway serves serverlessly, re-derived. Point it at an onion page fetched once (by any peer with Tor) → every subsequent render is **pure κ replay, zero Tor in the serving path.** This is the substrate's killer contribution and it is buildable now.
4. **The egress receipt is the honest trust-state ledger.** ADR-0103 already pins the transport + `directTor:false`. Extend the vocabulary so each render declares its true trust state: `commons-replay` (mirror, integrity-not-provenance), `peer-relay` (trusted relay), `arti-circuit` (the only `directTor:true`). L5 re-derivation + the receipt make the trust boundary auditable instead of fudged.

---

## Staged recommendation (riskiest unknown first within each stage)

- **Stage 0 — κ-commons onion replay (buildable now, no new infra).** Reuse `holo-web-snapshot.mjs` + the IPFS gateway + the existing SOCKS5/Tor adapter. Any peer that *does* have Tor seals a **public** onion page into a κ-DAG; everyone else renders it serverlessly, re-derived. Receipt: `hosc:onionTrust = "commons-replay"`, `directTor:false`, snapshot timestamp + sealer. **Honest UX:** "cached snapshot taken once over Tor; integrity-verified, not live, public pages only." Add multi-sealer attestation (≥2 independent sealers agreeing on the κ) for provenance. This gets a no-install OS to "read public onion content" **soonest**, and degrades gracefully rather than failing closed.
- **Stage 1 — borrow-a-peer relay.** A κ-mesh peer running real Tor exposes a libp2p stream protocol (WebRTC / circuit-relay-v2); the tab dials it and asks it to SOCKS-dial the onion. Receipt: `hosc:onionTrust = "peer-relay"`, names the relay, `directTor:false`. **Honest UX:** "relayed by a peer running Tor; you're anonymous to the onion site but fully exposed to the relay." Riskiest unknown: a maintained peer-side libp2p↔Tor-SOCKS bridge protocol + browser dialer.
- **Stage 2 — Arti-WASM north star (only path to `directTor:true`).** Spike the riskiest unknown **first**: a custom `NetStreamProvider` carrying Tor cells over WebSocket to a guard/bridge, completing one circuit handshake. Then let the κ-store be the directory cache (`StateMgr`/dir-cache backend) and κ-stream the arti module (Stage from ONNX Forge). Months out; only this earns honest in-tab anonymity.

## The irreducible blocker, stated plainly

A pure browser tab cannot build a Tor circuit without **both** (a) an in-tab WASM Tor client (Arti — not yet shippable; storage + transport shims unwritten) **and** (b) a browser-reachable bridge transport (WebSocket/WebRTC to a guard or bridge that accepts it). Until both exist, **"live, anonymous, interactive in-tab onion" is not achievable.** Everything shippable today is either a **mirror** (commons — public, stale, integrity-not-provenance) or a **trusted relay** (peer — full trust in the relay). Both are honest and useful; **neither is anonymous-in-tab**, and the receipt must say so. The address self-verifies offline regardless — it is always the *bytes* that need a client we do not yet have in-browser.
