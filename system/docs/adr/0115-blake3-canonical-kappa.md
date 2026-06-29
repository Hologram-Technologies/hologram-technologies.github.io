# ADR-0115 — BLAKE3 is the canonical κ; SHA-256 / keccak / blake2b are external bridges

Status: **P0–P7 CODE + WITNESS LANDED (additive); production reseal + native :9333 prove-boot are the user's host/seal step.** The dual-axis machinery already spanned the whole serve path (SW, Rust `kappa-route`, CEF host, sealer); this resolves the split-brain by making BLAKE3 the one canonical axis and demoting SHA-256 to a clearly-labeled bridge. Witness-gated, one phase at a time, never half-flipping the trust root.

Relates: ADR-052 (the substrate's `blake3:<hex>` σ-axis) · the working note `blake3-cutover-census.md` (the call-site work-list) · the implementation prompt `hologram-blake3-canonical-kappa-IMPLEMENTATION-prompt.md`.

## Context

A κ-addressable substrate has exactly ONE native hash: `kappo()`, the function that turns bytes into their address. In Hologram that function is BLAKE3 — proven byte-identical across the pure-JS `holo-blake3.mjs`, the Rust `blake3` crate, and the CEF host, including streaming input. Yet the serve/seal/anchor layer historically treated **SHA-256 as the κ** and carried BLAKE3 as a tag-along "σ-axis," only because `crypto.subtle` has no BLAKE3 and SHA was the path of least resistance. The fast path (CEF, Rust, the open-web κ-cache) already addressed and verified with BLAKE3. The substrate spoke two hashes and was canonical about neither.

## Decision

**BLAKE3 is the one canonical κ.** Any address the substrate mints for its own bytes is `did:holo:blake3:<hex>` = `kappo(bytes)`. **SHA-256 is NOT a κ** — it is a re-derivable *bridge alias* kept only where a foreign protocol fixes the hash. The cutover is a **promotion, not a rip-and-replace**: every layer carries blake3 as the primary axis *alongside* the sha alias, proves equivalence, and demotes — never deletes — sha.

### The line (the correctness hinge)

- **Internal κ → BLAKE3.** os-closure / os-served pins, the closure anchor, app `holospace.lock`, `.holo/<axis>/` CAS routes, the seal layer's content addresses, the κ-cache keys.
- **External-protocol bridge → stays SHA/keccak/blake2b, marked `// BRIDGE: <spec>`.** IPFS CIDv1 (sha2-256 multihash), ENS namehash (keccak-256), WebAuthn/passkeys (FIDO2/CTAP/COSE), SRI + CSP source-hashes (browser-mandated), GitHub Release asset names (the name *is* its sha256), PoW (argon2id/blake2b), git/TLS. Demoting one of these silently breaks interop — so an unclassified SHA is **bridge-until-proven-internal**.

### How each layer flipped (all additive, sha kept re-derivable)

| Layer | Change |
|---|---|
| Sealer | `reseal-drift` / `seal-served` / `relock-app` emit a top-level canonical `blake3` κ on every entry; sha256 demoted to `kappa`/`sri`/`multibase` bridge aliases. `reseal --check` re-derives BOTH axes. |
| SW (`holo-fhs-sw.js`) | `foldClosure` indexes the canonical blake3 (top-level field or `alsoKnownAs`) into `BYPATH_B3`; path requests verify blake3 FIRST, sha256 as legacy fallback. |
| Rust (`kappa-route`) | `Pin { blake3: Option, sha256: Option }` (inverted); `resolve` checks the canonical blake3 axis first, sha alias also when present; cache keyed by the canonical κ. |
| Anchor (P4, the sharp edge) | The trust root is `blake3(os-closure.json)`. SW + Rust `load_store` + CEF `HotStore::AnchorOf` all match blake3 first and accept the legacy sha value as fallback, so the flip is **atomic-safe**: a tampered manifest matches NEITHER axis → fail closed; a stale sha-baked anchor still validates its own manifest. The manifest is stamped `anchorAxis: "blake3"` for legibility. |
| Seal layer (P5) | `holo-identity` gains the canonical `kappaOf()` (= `kappo`) beside the sha256 CC-1 axis. The sha identity is the **persistence/interop bridge** — flipping it in place is a data migration (every persisted operator id / vault chain / strand head), out of scope here (invariant: additive then cut over). |
| App-CAS (P6) | `holospace.lock` carries blake3 alongside sha; large v86/ISO blobs fill their canonical axis **lazily** (serve via the sha alias until re-sealed) — never a flag-day multi-GB re-hash. |

### Guardrail

`holo-bridge-witness.mjs` freezes the sanctioned sha256 footprint: a NEW `did:holo:sha256` κ-mint that is not on the baseline and not `// BRIDGE:`-marked fails the build — so a future grep for "sha" reads "these are bridges," not "incomplete migration." New code mints canonical κ through `kappo()` or declares a bridge.

## Consequences

- One canonical address; the substrate is honest about what `kappo()` is.
- Nothing breaks on the way: sha aliases keep legacy `.holo/sha256` links, IPFS interop, and GitHub asset-name healing resolving.
- The remaining cut-over (retiring the sha CC-1 identity axis, re-hashing baked sha strings in `*.kblocks.json` / ISO manifests) is a deliberate, migration-gated follow-up — carried dual-axis and re-sealed lazily, never a release-blocking flag day.

## Witnesses (the gate)

`holo-blake3-parity-witness` (JS≡streaming≡KAT, 12 vectors) + `cargo test -p kappa-route parity_vectors_match_js` (JS≡Rust≡CEF) · `holo-kappo-seam-witness` (P1) · `holo-blake3-seal-witness` (P2) · `holo-blake3-serve-witness` + `cargo test -p kappa-route` (P3) · `holo-blake3-anchor-witness` + `closure_anchor_blake3_is_canonical` (P4) · `holo-blake3-seal-layer-witness` (P5) · `holo-blake3-appcas-witness` (P6) · `holo-bridge-witness` (P7). All GREEN. The native :9333 prove-boot is the user's host relink (the running exe blocks the link).
