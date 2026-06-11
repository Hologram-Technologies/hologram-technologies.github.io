# ADR-026: The OS serves itself by hash — gateway-free, content-addressed delivery

**Status:** Accepted — implemented (product layer). The OS-root builder
(`tools/build-os-root.mjs`), the OS-wide closure (`os-root.jsonld` + `os-closure.json`),
the OS-wide κ Service Worker (`holo-boot-sw.js`, self-bootstrapping + restart-resilient, +
`holo-sources.mjs` + `holo-peers.mjs` + `holo-boot-sw-register.mjs`), and the witnesses are
all live and GREEN: the Node anchor/serving proof (`os-root-witness.mjs`), the determinism +
hermeticity gate (`os-root-determinism-witness.mjs` — built twice the root κ is byte-identical,
zero apps silently drop, POSIX paths, nothing machine-specific leaks), the live-adapter proof
(`holo-peers-witness.mjs`), and the live browser proof
(`holo-boot-sw-browser-witness.mjs`, witnessed on Playwright Chromium — the OS boots
gateway-free, survives origin denial, and resolves blocks live from an IPFS Trustless
Gateway by CID; it auto-runs where a browser is launchable and SKIPs cleanly otherwise).
Builds on ADR-022 (W3C content addressing),
ADR-024 (the enforced regime), ADR-025 (everything is a UOR object); consumes the engine
unmodified (ADR-006). Bundle: **`sovereign-delivery`**.

**Context.** ADR-022/025 made each holospace — and every object inside it — a
content-addressed, self-verifying UOR node. But the *delivery* of the OS was still
location-bound: the image and every holospace were **fetched from a single origin gateway**
(GitHub Pages). The bytes were verifiable, but getting them was not sovereign — an origin
that can be denied, throttled, or compelled is exactly the chokepoint the architecture
exists to dissolve. Verify-by-re-derivation already lived at the *app* level
(`holo-sw.js` + `holo-resolver.mjs`, witnessed A29), but with a single `sources: [origin]`
and a per-mounted-holospace scope. Three things were missing to make the *whole OS*
sovereign:

- **One anchor.** No single content address committed to the entire image, so "boot the OS
  from a content address" was true of the loader page but not of every byte beneath it.
- **Many sources.** The resolver's `sources` chain was origin-only — so even though a byte
  was verified, it could only come from the one gateway. Not gateway-free.
- **OS scope.** The κ Service Worker served one mounted app's closure, not the OS image.

**Decision.** Compose the whole OS into one self-verifying UOR root and serve every byte of
it by content from a multi-source chain — origin demoted to one CDN among peers.

- **The OS root (anchor).** `build-os-root.mjs` unions every content-addressed app's closure
  (its own files + declared `_shared` deps) with the **delivery shell** (the bytes that
  bootstrap the OS before any per-app worker) and builds a single UOR object
  (`os-root.jsonld`) whose `did:holo:sha256` **commits (Merkle, leaf links) to every file**
  and to every app's root. That id *is* the content address of the entire OS. The companion
  `os-closure.json` is the flat `path → κ` map the Service Worker serves. Deterministic (no
  timestamps/randomness): the OS root κ re-derives byte-for-byte on any machine.
- **Multi-source serving (gateway-free).** `holo-sources.mjs` assembles the resolver's
  `sources` as an ordered preference chain — **local cache (Cache API/OPFS, offline-first) →
  peers (IPFS / WebRTC mesh / a Hypercore-κ-store seam) → origin (last)**. The live adapters are
  `holo-peers.mjs`: **IPFS** maps a sha-256 κ to its CIDv1 (sha2-256, raw) and races the IETF
  Trustless Gateways for the raw block (IPFS adopted, not bridged — ADR-025); the **WebRTC mesh**
  reaches holo-rtc's content-blind κ pub/sub (`sync.fetch(kappa)`) from the Service Worker through
  a SW↔page bridge; **Hypercore** is a ready seam (`getByKappa`) — no holepunch log ships today
  (`holo-hypercore.js` is the Hyperliquid source). The first κ-**verified** copy wins; a wrong byte
  from any source, including the origin, is refused (Law L5). The origin is no longer an authority —
  deny it and the byte-identical OS still boots from cache, the IPFS network, or a neighbour.
  Witnessed in Node against holo-ipfs ground truth (`holo-peers-witness.mjs`, row `os-peers`).
- **OS scope.** `holo-boot-sw.js` (a faithful superset of `holo-sw.js`, same response
  contract) is registered at root scope by `holo-boot-sw-register.mjs`, which first
  re-derives the OS root (Law L5) and checks the closure is committed by it, then hands the
  OS-wide closure to the worker. Verified bytes are persisted to the Cache API, so the second
  boot — and an offline boot — is served entirely from the local κ-store (Law L3).

Witnessed (`os-root-witness.mjs`, pure Node, green) by re-deriving the OS root and proving
the full contract: the persisted root re-derives **and** equals an independent recomputation
(drift guard); `verifyDeep` walks root→every leaf so a tampered byte anywhere is refused; the
closure is exactly what the root commits to; every delivery-shell file is covered (an
unlisted bootstrap file fails the gate); and over the **whole** OS closure a file resolves
from a `[hostile, honest]` pair to its verified bytes (origin demoted, any peer works,
tamper refused, re-resolve served from cache). The live browser proof
(`holo-boot-sw-browser-witness.mjs`) registers the worker and shows the OS surviving origin
denial; report-only until its oracle is wired. Rows **`os-root`** (anchor, green) and
**`os-delivery`** (live, ramping) in the catalog; the strict gate enforces them; bundle
`sovereign-delivery`.

**Consequences.** "Boot the whole OS from one content address, served from anywhere,
verified on arrival" becomes a witnessed property, not a slogan — the magical, previously
hard-in-any-browser experience: close the tab on one network, reopen offline or on a LAN, and
the byte-identical, verified OS boots. It is the keystone that turns "no server to *trust*"
into "no server to *deny* you." The split keeps it honest: the anchor + multi-source
resolution logic is proven in Node now; live root-scope registration and live P2P sourcing
(and their coexistence with the cross-origin-isolation shim) ramp behind the browser oracle,
and broadening the guarded registration from opt-in (`?sovereign=1`) to every frame is the
strict-ramp step. Pushing sub-κ composition below the holospace remains engine work upstream
(ADR-006). The cost is two derived artifacts (`os-root.jsonld`, `os-closure.json`), one
builder, three small browser modules, and one witness — no new medium, no bespoke vocabulary.
`build-os-root.mjs` must be re-run after changing any shell or app file; the witness fails the
gate if it is stale.

External authorities: **W3C** Subresource Integrity, Service Workers, DID Core, Controlled
Identifiers, VC Data Integrity (`digestSRI`/`digestMultibase`), JSON-LD 1.1; **IETF** RFC 8785
(JCS), the Trustless Gateway contract; **IPLD / multiformats** (CID, multihash) — a sha-256 κ
is a CIDv1. Witness: `os-root-witness.mjs` (+ `holo-boot-sw-browser-witness.mjs`); builder:
`tools/build-os-root.mjs`; modules: `holo-boot-sw.js`, `holo-sources.mjs`,
`holo-boot-sw-register.mjs`.
