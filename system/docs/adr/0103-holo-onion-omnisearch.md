# ADR-0103 — Holo Onion Omnisearch: resolve Tor v3 `.onion` addresses as a first-class omnibar leg — cryptographically validated, κ-sealed, transport-honest

Status: **Stages 1 + 2 LANDED + witnessed 15/15.** Stage 1 = resolver + cryptographic validation + unified lane. Stage 2 = both transports (onion HTTP gateway · local Tor SOCKS5 proxy, user-selected, default neither) wired end-to-end: the `/web` proxy routes `.onion` through the chosen transport, `browser-sw.js` carries the selection, and the shell's `openOnionSite` browses an onion service natively in the Holo Browser seam. Live end-to-end fetch is exercisable only with a real gateway / running Tor (not available in CI); everything below it — address validation, transport adapters (gateway URL mapping + full SOCKS5 client state machine), the transport-ready envelope, and the proxy 501-when-unset path — is witnessed against fakes. Landed 2026-06-16.

Relates: [[omnisearch-unified-resolver]] (the one omnibar door this extends) · [[ipfs-native-browsing]] (ADR-0026 delivery — the `/ipfs/<cid>/<path>` SW path gateway this mirrors for the eventual onion gateway) · [[holo-browser-web-wiring]] (`browser-sw.js`, the κ-minting web proxy onion fetch will ride) · [[ADR-0022]] (W3C content addressing — `did:holo:sha256` · JSON-LD) · [[ADR-0082]] (PROV-O receipts, attached out-of-band) · holospaces Laws L1 (content not location) / L5 (verify by re-derivation).

---

## Context

The omnibar is one door: paste any URL, IPFS CID, κ-app, κ-file, ENS/SNS name, EVM/Solana account-token-tx, CAIP id, or a free-text question, and it resolves to one sealed, content-addressed κ-object, alive with Q (`resolveUnified` → `holo-omni-unified.mjs`). The ask: make a **Tor v3 `.onion` address** resolve through that same door, as seamlessly as a URL or an IPFS CID.

### The load-bearing tension

A `.onion` address is fundamentally unlike a URL or a CID in one way that we **must not paper over** (Law L5):

- A URL is fetched over the open web; an IPFS CID is fetched from a trustless gateway and **re-derived against the CID** — the gateway is a latency choice, never trusted.
- A `.onion` service is reachable **only over the Tor network**. A browser tab **cannot natively join Tor**. There is no in-tab transport that builds Tor circuits.

So the honest design splits cleanly into two things that are usually conflated:

1. **The address** is self-verifying with *no network at all*. A Tor v3 onion address IS
   `base32(PUBKEY ‖ CHECKSUM ‖ VERSION)` where `PUBKEY` is a 32-byte ed25519 public key,
   `VERSION = 0x03`, and `CHECKSUM = SHA3-256(".onion checksum" ‖ PUBKEY ‖ VERSION)[:2]`. We can
   therefore **prove an address is well-formed and self-consistent** — it re-derives to itself — exactly
   the way every other κ-object in the OS does (Law L5), without touching the network. A corrupt or
   fabricated address fails the checksum and is **refused, not browsed**.
2. **The page bytes** require an explicit **transport**: either a user-configured Tor SOCKS5 proxy, or an
   onion HTTP gateway. This is a real trust decision, and the OS must surface it — never present a
   gateway-fetched onion page as if it were directly, anonymously Tor-routed.

This ADR builds (1) now and designs (2), keeping the two honestly separate.

### Why SHA3-256, not keccak256

Ethereum's `keccak256` (already in `holo-eth.js`, used for `namehash`) and FIPS-202 `SHA3-256` differ **only in one padding byte** (Keccak pads `0x01`, SHA3 pads `0x06`) — but they produce entirely different digests. Tor's v3 checksum is defined over **SHA3-256**. Reusing keccak256 would make *every* address "validate", which is strictly worse than no check. So Stage 1 adds one new primitive: a compact, self-contained FIPS-202 SHA3-256 (BigInt Keccak-f[1600]), anchored in the witness to the FIPS-202 empty-string vector.

---

## Decision

### Stage 1 (landed) — the resolver leg, transport-agnostic

A new pure-ESM leg, `system/os/sbin/holo-omni-onion.mjs`, beside the existing `holo-omni-web3.mjs`:

- `sha3_256(bytes)` — compact FIPS-202 SHA3-256 (the only new primitive; isomorphic, browser+Node).
- `parseOnionRef(s)` — classify (no network): strip `onion://`/`tor://`/`http(s)://`, match `<16–56 base32>.onion`, preserve the path. Returns `null` for anything that is not a `.onion` host, so it never hijacks a normal URL.
- `validateOnion(addr)` — the cryptographic check: base32-decode → 35 bytes → `pubkey(32) ‖ checksum(2) ‖ version(1)`; recompute the SHA3-256 checksum; assert `version === 3`. Rejects v2 (16-char) with an honest "deprecated since Oct 2021, unsupported" reason. Reuses the OS base32 (`holo-ipfs.js`, RFC-4648 lowercase, no padding — exactly the onion alphabet).
- `onionAddressFromPubkey(pub32)` — the inverse (mint a canonical host from a key); used by the witness to generate a guaranteed-valid address with no fixtures.
- `resolveOnion(ref, cfg)` — the uniform envelope. Validates, then seals a κ-addressed JSON-LD **descriptor card** (`@type: holo:OnionService`, with host, version, pubkey, path; κ = `did:holo:sha256(jcs(card))`, Law L5). If `cfg.transport` is absent → **honest null**: `ok:false`, the sealed card, and a `hosc:Egress` receipt with `outcome:"refused"`, `grant:"none"`, `transport:null`, `directTor:false`. If a transport IS configured → still `ok:false` in Stage 1 (`outcome:"deferred"`, `reason:"fetch-not-wired"`), with the receipt **pinning** the transport — no faked success.

Wired into `holo-omni-unified.mjs`: a new `"onion"` lane in `classifyUnified` (checked first — `.onion` is unambiguous) and `resolveUnified`. The lane returns the same envelope shape as every other leg.

**Reused, not reinvented:** OS base32 (`holo-ipfs.js`), the κ-sealer (`holo-q-receipt.mjs` `address`/`jcs`), and the `hosc:Egress` receipt pattern from the web3 leg. The only net-new code is one thin resolver file + the unified-lane wire.

Witnessed by `tools/holo-onion-witness.mjs` (9/9): SHA3 FIPS vector · v3 accepts (minted + real Tor Project address) · corrupt rejected · v2 rejected · non-onion not hijacked · transport-absent honest null · egress-receipt shape + re-derivation · card re-derives · unified onion lane. Conformance row `#omni-onion` registered in `conformance.jsonld` + `gate.mjs` LIVE set.

### Stage 2 (landed) — two transports, user-selected, native browsing

An onion service is a live HTTP site, so — unlike immutable IPFS — it rides the **existing live-web seam** rather than a new path gateway. Onion becomes "a web fetch whose transport is Tor":

- **`system/os/sbin/holo-omni-onion-transport.mjs`** — the whole transport decision, behind one config (`normalizeTransport`, `transportFromEnv`), default **neither**:
  - **gateway** — `gatewayUrl(onionUrl, endpoint)` maps `http://<addr>.onion/<path>` to an HTTPS gateway (suffix-domain *or* `{host}/{path}` template styles); `fetchViaGateway` fetches it. Isomorphic.
  - **socks5** — `socks5ConnectByDomain` issues a SOCKS5 CONNECT that names the host **by domain (atyp 0x03)** so **Tor resolves the `.onion`** — we never resolve it ourselves (it has no DNS/IP; only Tor knows the rendezvous). `fetchViaSocks5` drives the full client state machine over `node:net` (greeting → CONNECT → HTTP/1.1 → parse).
- **`holo-serve-fhs.mjs`** `/web` proxy — detects a `.onion` target and routes it through `onionFetch` (per-request `&onion=` override from the shell, else `HOLO_ONION_*` env). No transport → an honest **501** page ("pick a transport"), never a fake render. Pins `x-holo-onion-transport` and always `x-holo-direct-tor: false`.
- **`browser-sw.js`** — holds the user's selection (`setonion` message), and `proxyUrl()` appends it to the `/web` URL for `.onion` hosts only — so navigations **and** subresources mint + re-derive (Law L5) through Tor, exactly like any live page.
- **`shell.html`** `openOnionSite(input)` — validates the v3 address (refuses corrupt/v2), seals the descriptor κ-card, prompts once for a transport if unset (gateway / SOCKS5 presets, stored locally), pushes it to `browser-sw`, and opens an `onion://…` tab in the Holo Browser seam. Wired into `omniGo` beside `openIpfsSite`/`openHoloBrowser`. The toast names the transport and states plainly "not direct Tor".

Every fetch's receipt pins the transport + kind and keeps `hosc:directTor: false`.

### Paste-and-go: auto-detect local Tor (the seamless path)

To be **as seamless as a URL or IPFS CID**, onion browsing must not demand configuration before the first paste. So `resolveActiveTransport` (in the transport module) resolves the transport in priority order — explicit user override → `HOLO_ONION_*` env → **auto-detected local Tor** (probe `127.0.0.1:9050` for a `tor`/Arti daemon, then `:9150` for Tor Browser). `openOnionSite` no longer prompts: it validates and opens the tab; the proxy finds Tor on its own. A user who has Tor running gets zero-config onion browsing — exactly how Tor Browser / Brave reach a hidden service. If nothing is reachable, the **served page** explains how to start Tor (honest, never a fake render). This was verified end-to-end against a real socket: an onion paste with **no transport configured** auto-detected a local SOCKS5 listener, performed a real SOCKS5 handshake + CONNECT-by-domain, and rendered the bytes (`x-holo-onion-transport: socks5:127.0.0.1:9050`, `directTor:false`).

### The honest reality of "no-Tor" gateways

Investigated live (2026-06): the **public onion HTTP gateways are extinct** — `onion.ws`, `onion.ly`, `onion.to`, `onion.pet`, `tor2web.org` and the rest resolve in DNS but refuse all connections (Tor2web was abandoned years ago over abuse). Unlike IPFS, which has dozens of live public gateways, there is **no reliable free public onion gateway to default to**. So the gateway adapter remains supported (point it at any *working* endpoint — self-hosted or otherwise), but the **reliable, recommended path is local Tor** (SOCKS5), which the build now auto-detects. "Seamless as URL/IPFS" therefore means *paste-and-go once Tor is running locally* — the same one-time precondition every onion-capable browser has; we do not and cannot fabricate Tor connectivity from a tab. **Caveat:** a real Tor *circuit* needs a real `tor` daemon (not in CI); the witness verifies the adapters, the config gate, auto-detect, the transport-ready envelope, and the honest-null/501 paths against fakes + a real local SOCKS5 socket.

---

## The trust / transport reality (explicit)

This is the part the OS must state plainly, not bury:

- **Hologram does not carry native Tor circuits.** Every onion receipt records `hosc:directTor: false`.
- A **Tor SOCKS5 proxy** (the user runs Tor / Tor Browser / Arti locally, e.g. `127.0.0.1:9050`) gives
  real Tor anonymity, but requires the user to run Tor and is not reachable from a sandboxed page without
  a local bridge. Best privacy, highest setup cost.
- An **onion HTTP gateway** (a `.onion.to`-style or self-hosted Tor2web egress) needs no local Tor, but
  the gateway sees the plaintext request and the user's IP — it is a trusted hop, and historically these
  have been deprecated/insecure. Lowest setup cost, weakest privacy.
- The OS will **default to neither silently**. No transport configured → honest null with an explanation.
  Whichever transport is set is **pinned in the egress receipt**, so the trust story is always auditable.

The address validation in Stage 1 is independent of this choice and is already correct and complete.

---

## Consequences

- The omnibar gains a `.onion` leg that is honest by construction: it proves what it can prove offline
  (the address), and refuses to fake what it cannot do natively (anonymous routing).
- One new cryptographic primitive (SHA3-256) enters the OS, anchored to FIPS-202.
- Stage 2 is a small, well-precedented addition (the IPFS gateway shape) once the transport is chosen.
- Risk: the transport choice is a genuine privacy trade-off; surfacing it (not defaulting it) is the
  mitigation. Until Stage 2, a valid onion address resolves to a clear, sealed "valid but unfetched" card.
