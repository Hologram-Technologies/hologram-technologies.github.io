# ADR-027: Survive the switch — total-offline boot and a signaling-free local mesh

**Status:** Accepted — implemented (product layer). BOTH tiers are live and GREEN: the
same-browser offline mesh (`holo-lan.mjs`) + total-offline precache (`holo-boot-sw.js`,
`holo-boot-sw-register.mjs`), witnessed Node (`holo-lan-witness.mjs`) + live browser
(`holo-offline-browser-witness.mjs`); AND the cross-device LAN relay (`holo-lan-relay.mjs` +
`holo-lan-relay-client.mjs`), witnessed Node (`holo-lan-relay-witness.mjs`) + live two-context
browser (`holo-lan-cross-device-witness.mjs` — a cold device boots OS blocks from a warm one
through the relay with its origin denied). Builds directly on ADR-026 (gateway-free,
content-addressed self-delivery); consumes the engine unmodified (ADR-006). Rows **`os-offline`**
and **`os-lan-relay`**; bundle `sovereign-delivery`.

**Context.** ADR-026 made the OS one self-verifying content address served from a multi-source
chain (cache → peers → origin), so a *tampered or denied origin* is survivable as long as
*some* source answers. But the monograph's "switch that can be thrown" is stronger than a
denied origin: it is the denial of *the whole upstream* — origin and public IPFS gateways
alike. The remaining gaps were two:

- **Cold blind spots.** The worker cached blocks only as they were fetched, so an offline boot
  that touched a never-visited path would miss — the OS was offline-*tolerant*, not
  offline-*complete*.
- **No peer-to-peer fallback that needs no server.** The IPFS and WebRTC-mesh peers both reach
  for the network (gateways, a signaling relay). With the internet cut, neither forms.

**Decision.** Make the OS run with *zero* network, in two tiers.

- **Total-offline boot (precache).** `holo-boot-sw.js` gains `precache()` — fetch + store EVERY
  closure block into the Cache API — and the register exposes it (`bootSovereign({ precache })`).
  Combined with the worker's existing self-bootstrap (config + blocks persisted, reloaded on
  restart), the OS becomes offline-*complete*: after one warm visit, deny all network and the
  whole image — every page, every app, every asset — still boots and serves from cache,
  re-derived (Law L5). Witnessed live: precache 532/532, then ALL requests 503, then a fresh
  page boots the OS shell and a spread of the OS is served by κ.
- **Signaling-free local mesh.** `holo-lan.mjs` is a server-free κ-block exchange over a W3C
  **BroadcastChannel**: same-origin peers (any tab/window/Service Worker in the same browser)
  announce what they hold and answer each other's `want(κ)` — no relay, no internet. It slots
  into the resolver chain as the `lan` peer, **before** the internet peers (offline-first), and
  returns null instantly when no sibling exists (no solo-tab stall). A cold peer can pull the OS
  from a warm sibling with every upstream denied; the resolver re-derives every reply, so a
  sibling is never trusted. Witnessed in Node (real `BroadcastChannel`, two peers: a cold peer
  boots a spread of the OS from a warm one; a corrupted reply is refused) and live (the worker
  answers a page's BroadcastChannel `want`).

The full peer chain is now **cache → LAN sibling → IPFS / WebRTC mesh → origin**: nearest and
most-sovereign first, the origin last and demoted.

**Consequences.** "Pull the cable and the OS, its apps, and your neighbour's blocks are all
still there" becomes a witnessed property — the visceral form of the whole thesis. The
same-browser BroadcastChannel tier and the **cross-device tier** are both fully live-witnessed.
The cross-device relay (`holo-lan-relay.mjs`) is a tiny, dependency-free **content-blind κ broker**
(node:http long-poll — works in a Service Worker via `fetch`, no WebSocket framing, no EventSource)
that you run on any LAN device with no internet: it stores no bytes and verifies nothing, only
routing a `fetch(κ)` to a peer that announced it and forwarding the opaque block; the fetcher
re-derives, so the relay is never trusted. The worker joins it directly as the `relay` peer
(`holo-lan-relay-client.mjs`); the full chain is **cache → same-browser sibling → LAN relay →
internet peers → origin**. The cost is two relay modules + two witnesses on top of the offline
tier — no new medium, no bespoke vocabulary; BroadcastChannel, Cache API, Service Workers, and
HTTP are all W3C/WHATWG/IETF.

**Share this OS on my LAN (one click).** The OS's own server, `holo-serve.mjs`, mounts the relay
at **`/holo-lan`** — so the served OS *is* the relay (same-origin, zero-config) — and renders the
boot URL `…/?lan=1` as a **Holo QR** code in the terminal (no external `qrencode`). Scanning it (or
opening `?lan=1`) makes `holo-boot-sw-register.mjs` auto-join the same-origin mesh: the device boots
this exact OS *and* starts pulling blocks peer-to-peer. The in-OS Share page **`lan.html`** shows the
join QR for others to scan and scans one to join another OS — both via **Holo QR** (`_shared/holo-qr.js`:
generation over node-qrcode, reading over ZXing/BarcodeDetector, both vendored κ-pinned, Law L5; rows
`holo-qr`/`node-qrcode`/`zxing`). Witnessed live (`holo-lan-share-witness.mjs`): lan.html renders +
reads its own join QR, and a cold device boots from a warm one through the same-origin relay with the
origin denied. Row `holo-lan-share`.

External authorities: **W3C / WHATWG** BroadcastChannel (HTML web-messaging), Service Workers,
Cache API; **IETF** RFC 9110 (HTTP), RFC 8785 (JCS), W3C Subresource Integrity (the re-derivation).
Witnesses: `holo-lan-witness.mjs`, `holo-offline-browser-witness.mjs`, `holo-lan-relay-witness.mjs`,
`holo-lan-cross-device-witness.mjs`; modules: `holo-lan.mjs`, `holo-lan-relay.mjs`,
`holo-lan-relay-client.mjs`.
