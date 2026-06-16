# ADR-0108 — Seamless onion: managed Tor (the Brave model) + onion-web discovery, when anonymity is not the goal

Status: **LANDED (host logic + discovery + wiring) + witnessed; live byte-render proven against a real SOCKS5 socket.** The one thing not exercisable in CI is provisioning the *real* Tor binary (needs the published release κ + a host that can spawn a process). 2026-06-16.

Relates: [[holo-onion-omnisearch-adr]] (ADR-0103 — the onion leg + SOCKS5 transport this completes) · [[holo-onion-no-local-tor-adr]] (ADR-0107 — the exploration that concluded "managed Tor is the answer once anonymity is dropped") · [[holo-onnx-forge-adr]] (κ-addressed binaries, re-derived before use) · holospaces Laws L1/L5. Evidence: [`docs/specs/holo-onion-no-local-tor.md`](../specs/holo-onion-no-local-tor.md).

---

## Context

The operator's clarified goal: **discover and browse the onion web seamlessly in the native Holo browser, without manually installing Tor — anonymity is *not* required.** ADR-0107 established that a sandboxed tab cannot build an anonymous circuit, but that blocker only bites if anonymity is the goal. Drop it, and the answer is the one Brave ships: **the host runs a real `tor` for you, transparently** — Brave bundles a `tor` binary and points Chromium at a localhost SOCKS5 port; the user installs nothing. ADR-0103 already built the SOCKS5 adapter + auto-detect + the κ-minting `/web` seam; the only missing piece was *provisioning Tor when none is running*, and *finding* onion sites (they aren't in DNS).

## Decision

### 1 · Managed Tor in the host — `holo-tor-host.mjs`

`ensureTor()` resolves a SOCKS proxy in priority order, then the existing transport auto-detects it:
1. **Reuse** an already-listening Tor (`9050`/`9150`) — cheapest, most respectful.
2. Else **provision a managed Tor** — but only a **κ-verified** binary may run.

**Holo-native twist (Law L5 on an executable):** the Tor binary is a κ-addressed substrate object. Before it is *ever launched* it is **re-derived against its pinned κ**; a tampered or wrong binary is **refused, never executed**. If no κ is pinned, provisioning **refuses** (fail honest, not fail open) — you never run an unverified Tor. A vendored on-disk binary is verified identically. Launch is CLI-only (`--SocksPort`/`--ControlPort 0`/`--ClientOnly`), and we wait for Tor's `Bootstrapped 100%` line before declaring ready — never a faked "up".

Wired into `holo-serve-fhs.mjs`: `managedTor()` (memoized) runs before transport resolution; a pure static deploy that can't spawn a process refuses honestly. Real deps injected (`spawn`, `net`, `fetch`, `fs`, sha256/blake3) — so the witness drives the whole verify+launch state machine with **no real download and no real process**.

### 2 · Honest trust state — the receipt never overstates

Anonymity is explicitly *not* claimed. The browsing response pins it plainly: `x-holo-onion-trust` ∈ `{user-tor, managed-tor, gateway}`, `x-holo-anonymity-grade: best-effort` (a real Tor circuit, but no Tor-Browser fingerprinting defenses), and `x-holo-direct-tor: false` (the **tab** isn't carrying Tor — the host proxy is). A real circuit is real; we say exactly what it is and isn't.

### 3 · Discover the onion web — `holo-onion-discover.mjs`

Onion services aren't in DNS, so "browse" needs "find". A thin, honest adapter over **Ahmia** (`ahmia.fi` — a long-running, abuse-filtering clearnet onion index): `searchOnionWeb(query)` fetches Ahmia **through the `/web` proxy** (no CORS, κ-minted), `parseAhmia()` extracts v3 `.onion` results, and the shell renders them; clicking one re-enters the omnibar → opens through the **validated** onion path (every byte re-derived, L5). We index nothing ourselves — we read a public index and re-present it. Omnibar trigger: `onion <terms>`.

## What is and isn't proven

- **Proven:** address validation (ADR-0103, 19/19); the managed-Tor decision/verify/launch/bootstrap state machine (`holo-tor-host-witness`, 7/7 — reuse · refuse-unpinned · refuse-tampered-L5 · launch-verified · bootstrap-gate · static-no-spawn-honest · honest-grade); discovery parse+search (in the onion witness); and **end-to-end render against a real SOCKS5 socket** — paste an onion with zero config → auto-detected Tor → page rendered, honest headers.
- **Not exercisable in CI:** provisioning the *real* Tor binary, which needs (a) the published Tor Expert Bundle κ pinned (or a vendored binary), and (b) a host that can spawn a process. The mechanism refuses safely until a κ is provided. Recommended ship: **vendor the Tor binary as a κ-pinned substrate object** with the native (Tauri) host, so first-run is offline and instant.

### Provisioning the real binary — `tools/holo-tor-fetch.mjs`

A one-shot host provisioner that does the download+pin honestly: resolves the latest version, downloads the official **Tor Expert Bundle**, **verifies it against Tor's published `sha256sums-unsigned-build.txt`** (refusing on mismatch — never pins an unverified bundle; GPG-sig check documented as the stronger manual step), extracts, computes the κ of the actual `tor.exe`, and writes `.holo-tor/tor-pin.json`. `holo-serve` consumes that pin and `ensureTor` re-derives the binary against it before every launch (L5). `.holo-tor/` is git-ignored (the binary is provisioned per-host, never committed). Run: `node tools/holo-tor-fetch.mjs`.

> **Sandbox note (2026-06-16):** the dev sandbox **hard-blocks `*.torproject.org`** (all `000`; GitHub/Cloudflare fine) while raw connections to Tor relays succeed — so the provisioner could not be executed *here*. It is built + wired + syntax-clean; it runs on a host where `dist.torproject.org` is reachable. No κ was fabricated and no binary was pulled from an unofficial mirror — that would violate the L5 anchor this design depends on.

## Consequences

- Seamless, zero-user-install onion browsing on the native/dev host, reaching *all* onion services (a real circuit), with the trust state stated honestly — and the executable itself protected by L5 (never run an unverified Tor).
- The honest limits are pinned, not hidden: best-effort anonymity (not Tor-Browser-grade), and a pure static deploy can't provision (it falls back to an honest "start Tor / no transport" page or a hosted proxy).
- Next concrete step: pin the real Tor Expert Bundle κ per platform (or vendor it) in `TOR_DIST`, and add a "starting Tor…" interstitial in the onion tab while the first bootstrap completes.
