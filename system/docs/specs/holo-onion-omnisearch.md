# Spec — Holo Onion Omnisearch (Tor v3 `.onion` resolution)

Companion to [ADR-0103](../adr/0103-holo-onion-omnisearch.md). Implementation reference for the `.onion` leg of the unified omni resolver.

## Goal

Paste a Tor v3 `.onion` address into the shell omnibar and have it resolve through the same one door as a URL or an IPFS CID — validated, sealed, and **honest about transport**.

## Module map

| File | Role | Status |
|---|---|---|
| `system/os/sbin/holo-omni-onion.mjs` | the onion leg: SHA3-256, parse, validate, resolve, transport-ready | landed |
| `system/os/sbin/holo-omni-onion-transport.mjs` | two adapters (gateway · SOCKS5), config gate, env | landed |
| `system/os/sbin/holo-omni-unified.mjs` | `"onion"` lane in `classifyUnified` + `resolveUnified` | landed |
| `system/tools/holo-onion-witness.mjs` (+ `.result.json`) | 15-check witness | landed |
| `system/os/etc/conformance.jsonld` (`#omni-onion`) + `gate.mjs` LIVE | conformance row | landed |
| `holo-serve-fhs.mjs` `/web` proxy onion routing (+ `node:net` SOCKS5) | live fetch through transport | landed (needs gateway/Tor to exercise) |
| `browser-sw.js` `setonion` + `proxyUrl()` | carries the selection to the proxy for `.onion` hosts | landed |
| `shell.html` `openOnionSite` + transport config + `omniGo` wire | sealed κ-tab, native onion browsing | landed |

## The v3 onion address (the math we verify)

```
onion_address = base32( PUBKEY[32] ‖ CHECKSUM[2] ‖ VERSION[1] )         # 35 bytes → 56 base32 chars
CHECKSUM      = SHA3-256( ".onion checksum" ‖ PUBKEY ‖ VERSION )[:2]
VERSION       = 0x03
base32        = RFC-4648 lowercase, no padding (a–z, 2–7)               # == holo-ipfs.js base32
```

- `PUBKEY` is an ed25519 public key. The address **is** the key — the cryptographic identity of the
  service, no DNS, no CA. Validating the checksum proves the address is internally consistent (Law L5 on
  the address itself), with **no network**.
- v2 addresses are 16 base32 chars; deprecated since Oct 2021, no introduction points remain → refused.
- **SHA3-256 (FIPS-202), not keccak256.** They differ only by the domain pad byte (`0x06` vs `0x01`) but
  produce different digests. Anchored in the witness to `SHA3-256("") = a7ffc6f8…f8434a`.

## API (Stage 1)

```js
import { parseOnionRef, validateOnion, resolveOnion } from "holo-omni-onion.mjs";

parseOnionRef("http://2gzy…wid.onion/about")
// → { kind:"onion", host:"2gzy…wid.onion", addr:"2gzy…wid", path:"/about" }   (null if not .onion)

validateOnion("2gzy…wid.onion")
// → { ok:true, version:3, pubkeyHex:"d1b3…" }                                  (ok:false + reason otherwise)

await resolveOnion("2gzy…wid.onion", cfg)
// cfg.transport absent → honest null:
// { ok:false, kind:"onion", subkind:"v3", reason:"no Tor transport configured…",
//   kappa:"did:holo:sha256:…", card:{…holo:OnionService…}, receipt:{ id, body }, transport:null, ms }
```

`cfg = { transport?: { kind:"socks5"|"gateway", endpoint, label? }, caller? }`

## The descriptor card (κ-sealed)

```json
{
  "@context": { "schema": "https://schema.org/", "holo": "https://hologram.os/ns/onion#",
                "tor": "https://spec.torproject.org/rend-spec-v3#" },
  "@type": "holo:OnionService",
  "holo:host": "<addr>.onion", "holo:version": 3, "holo:pubkey": "<hex>",
  "holo:path": "/", "holo:network": "tor",
  "holo:validated": "v3 ed25519 pubkey · SHA3-256 checksum verified — the address re-derives to itself (Law L5)"
}
```

κ = `did:holo:sha256( jcs(card) )` via `holo-q-receipt.address` — the same sealer every omni card uses.

## The egress receipt (transport honesty)

```json
{
  "@context": { "prov": "http://www.w3.org/ns/prov#", "hosc": "https://hologram.os/ns/conscience#" },
  "@type": ["prov:Activity", "hosc:Egress"],
  "hosc:caller": "omni", "hosc:verb": "onion.resolve", "hosc:network": "tor",
  "hosc:host": "<addr>.onion",
  "hosc:transport": null,            // or { hosc:kind, hosc:endpoint, hosc:label } when configured
  "hosc:grant": "none",             // "onion-transport" when configured
  "hosc:directTor": false,           // INVARIANT — this OS never carries native Tor circuits
  "hosc:outcome": "refused",         // "deferred" (Stage 1 w/ transport) → "accept" (Stage 2 fetch)
  "hosc:reason": "no-transport",
  "prov:generated": { "@id": "did:holo:sha256:<card κ>" }
}
```

`receipt.id = address(receipt.body)` — the receipt re-derives (Law L5). The `directTor:false` field is the
load-bearing honesty: a gateway/proxy hop is recorded, never disguised as anonymous direct routing.

## Transport options (Stage 2 — both landed, user-selected)

| Transport | Setup | Privacy | Trust |
|---|---|---|---|
| **Tor SOCKS5 proxy** (local Tor/Arti at e.g. `127.0.0.1:9050`) | user runs Tor + a local bridge to the page | real Tor anonymity | trustless circuit; local only |
| **Onion HTTP gateway** (Tor2web-style egress) | none (just a URL) | weak — gateway sees plaintext + IP | trusted hop; historically deprecated/insecure |

**Paste-and-go (seamless path):** `resolveActiveTransport` resolves transport by priority — explicit override
→ `HOLO_ONION_*` env → **auto-detected local Tor** (`127.0.0.1:9050` daemon/Arti, then `:9150` Tor Browser).
`openOnionSite` does NOT prompt; it opens the tab and the proxy finds Tor itself. Verified end-to-end against
a real SOCKS5 socket (no config → auto-detect → real handshake + CONNECT-by-domain → rendered bytes).

**Reality check (2026-06):** public onion HTTP gateways (`onion.ws`/`onion.ly`/`onion.to`/`tor2web.org`…) are
**extinct** — they DNS-resolve but refuse connections. There is no reliable free public onion gateway to default
to (unlike IPFS). So local Tor (SOCKS5) is the recommended, auto-detected path; the gateway adapter works the
instant it's pointed at a *live* endpoint. "Seamless as URL/IPFS" = paste-and-go once Tor runs locally.

When no transport resolves: honest null (`resolveOnion`) / a 501 page explaining how to start Tor (`/web` proxy).
The chosen transport is pinned in every receipt + the `x-holo-onion-transport` header, and `directTor` is
always false. Onion rides the **live-web seam** (`browser-sw.js` → `/web?url=…&onion=…`), not a new path
gateway: each resource is minted to the κ-store and re-derived (L5) exactly like any live page — so an
onion site browses natively, with the transport shown plainly in the open toast.

Selection flow: `shell.html` stores `{kind,endpoint}` in `localStorage["holo.onion.transport"]`, pushes a
b64url of it to `browser-sw` via `{type:"setonion"}`; `browser-sw`'s `proxyUrl()` appends `&onion=<b64>`
to the `/web` URL for `.onion` hosts; `holo-serve-fhs.mjs` decodes the override (else `HOLO_ONION_*` env)
and routes through `onionFetch`.

## Witness checks (`holo-onion-witness.mjs`, 15/15)

Stage 1: `sha3Vector` · `validV3Accepts` (minted + real Tor Project address) · `corruptRejected` ·
`v2Rejected` · `notOnionNull` · `transportAbsent` · `egressReceipt` (shape + re-derive) · `cardReDerives` ·
`unifiedOnionLane`.
Stage 2: `transportNormalize` (config gate) · `gatewayUrlMaps` (suffix + template) · `gatewayFetch` ·
`socks5ByDomain` (CONNECT by domain, atyp 0x03) · `socks5Fetch` (full client state machine vs fake
socket) · `transportReady` (browsable envelope, transport pinned, `directTor:false`, card re-derives).
