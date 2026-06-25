# ADR-0116 — Verified streaming (Bao): the realized BLAKE3 dividend; the SHA-256 stream island retired

Status: **S0–S5 CODE + WITNESS LANDED; S6 reseal + live host range-serve wiring remain.** The canonical-κ
cutover (ADR-0115) made BLAKE3 the substrate's κ. This collects the dividend that motivated it: because
BLAKE3 is a Merkle tree (and SHA-256 is linear), any 1024-byte chunk of a κ-object verifies against its
SINGLE root κ in O(log n), holding nothing else — so a surface renders chunk 0 the instant it arrives,
each chunk proven, the whole object never resident. The verifier (`holo-bao.mjs`) existed but was wired
into nothing; the one stream primitive was still SHA-256.

Relates: ADR-0115 (BLAKE3 is the canonical κ) · the census `bao-streaming-census.md` · the prompt
`hologram-verified-streaming-bao-IMPLEMENTATION-prompt.md`.

## Context

The streaming/render subsystem (`holo-kappa-stream` + projector, OSR lens, run-ahead, super-res,
raster-ingest, fidelity-stream, stream-kit, and a second island `holo-compute-memo`) minted
`did:holo:sha256:…` and verified WHOLE objects — the exact linear-hash behavior the cutover was meant to
retire. It was the last SHA-256 island, and the island where streaming actually happens.

A foundation bug was also latent: `holo-bao.encode` stored the `proofFor` wrapper `{proof, chunkStart,
chunkLen, counter}` as each chunk's `.proof`, while `verifyChunk` expects the sibling ARRAY — so every
`verifyChunk` returned false and the verifier the whole experience depends on was broken. S0 caught and
fixed it.

## Decision

**Verified streaming on the canonical κ.** A stream object's κ IS its Bao root, so small objects stream
whole-verified and large objects stream the SAME κ's chunks per-chunk-verified — one axis end to end.

| Step | Change |
|---|---|
| S0 | Fixed `holo-bao.encode` (sibling array, not the wrapper); locked soundness — `holo-bao-witness` (88): tampered chunk, wrong index, swapped sibling side, truncated/extended/forged proof all refused, across empty…98-chunk objects. |
| S1 | `holo-kappa-stream` (the one primitive) + `holo-compute-memo` (the second island) mint through `kappo()` → `did:holo:blake3`. A stream object's κ == its Bao root (`holo-bao-stream-witness`, 11). Fixed a latent osr-lens bug (it *declared* blake3 in its manifest but minted sha). |
| S2 | `outboard()` (proof tree, cached by root κ) + `sliceFromOutboard()` serve any chunk proven against the root, bytes paged on demand. `holo-bao-serve-witness` (8): a 3 MB object streams with peak residency ONE 1024-byte chunk (>3000× smaller than the object), render-on-chunk-0, tamper-at-2000 refused after 0..1999 served. |
| S3 | `holo-stream-kit` exposes `bao` + `streamObject` (render-on-chunk-0 with per-chunk verify) + publishes them on `window.HoloStream`. `holo-bao-consumer-witness` (9): a renderer paints chunk 0 before the object is whole; a bad chunk halts the render while earlier paints stand; all 8 consumers stay GREEN (non-breaking). |
| S4 | Native parity: ported `verifyChunk` to Rust (`kappa-route::bao`) using the `blake3` crate's `hazmat` tree primitives — **no new dependency**. `cargo test bao_slice_parity` re-verifies holo-bao's EXACT proofs (6 objects) and refuses tamper/reorder → slice-verify JS == Rust == CEF. |
| S5 | `kr_bao_verify_chunk` FFI (proof = `proof_count` × 33 bytes: side + 32-byte CV) so the CEF host can serve verified ranges; `ffi_bao_verify_chunk_round_trip` ABI test green; declared in `kappa_route.h`; release staticlib rebuilt. |

## Consequences

- The dividend is real and measured the honest way: **time-to-first-rendered-chunk** (chunk 0, not the
  whole object) and **peak residency** (one chunk + its O(log n) proof, not the object size) — what a
  linear hash structurally cannot deliver.
- The streaming subsystem joins the blake3 substrate; the P7 lint's sanctioned sha set shrank (94, two
  islands retired) — migration progress, not regression.
- Cross-impl verified slices (JS == Rust == CEF) with no new crypto, so the same proof streams in the
  browser SW and the native host.

## Native streaming engine (N1–N5): the host PRODUCES streamable BLAKE3 κ-objects

The dividend made native — the host is now a verified-streaming **producer**, not just a verifier, so a
large κ-object (a 4K frame, a model layer, a media segment) is served as BLAKE3-verified chunks at very low
latency and very high throughput, the whole object never re-hashed per request.

| Step | Change |
|---|---|
| N1 | Ported the proof **builder** to Rust (`kappa-route::bao`: `proof_for`, `outboard`, `subtree_cv`) via `blake3` hazmat — Rust-built proofs are **byte-identical** to JS (`bao_outboard_parity`), so the host produces what any browser/SW/peer verifies, and vice versa. |
| N2 | `outboard()` builds in **one O(n·log n) pass** (each chunk hashed once, each node merged once) — the naïve per-chunk build was O(n²) and hung on 64 MiB. |
| N3 | `BaoEncoder` (build-once / serve-O(1)) + `kr_bao_encoder_*` FFI (root, chunk_count, chunk → bytes + proof in the 33-byte/sibling wire format `kr_bao_verify_chunk` consumes). Declared in `kappa_route.h`. |
| N4 | Full native loop tested: `ffi_bao_encoder_stream_round_trip` (producer → consumer, O(1)/chunk, tamper refused). Rust 36/36. |
| N5 | Performance prove (`examples/prove_bao_stream`, 64 MiB): **442 MB/s** one-pass SIMD outboard build · **time-to-first-verified-chunk 6.5 µs** · **325 MB/s** verified-stream throughput (3.0 µs/chunk) · **peak residency 1552 B vs 64 MiB = 43,240× smaller** · tamper refused. |

This is the engine that powers a native experience: press play / open the model, and it starts rendering
microseconds after the first chunk, integrity guaranteed per chunk, the object never resident.

## Remaining (honest ceiling)

- **Live host range-serve wiring.** `kr_bao_verify_chunk` is the seam; wiring it into a host path that
  receives chunks from a PEER (mesh/sharedcache) and serves a verified range is the next host integration —
  the dist/origin case already serves whole-verified objects (ADR-0115 prove_dist), so per-slice verify is
  specifically for the not-yet-whole (peer-streamed) object.
- **Reseal.** The modified modules (`holo-bao`, `holo-kappa-stream`, `holo-compute-memo`, `holo-stream-kit`)
  re-pin blake3-primary via the existing flow (S6).

## Witnesses

`holo-bao-witness` (88) · `holo-bao-stream-witness` (11) · `holo-bao-serve-witness` (8) ·
`holo-bao-consumer-witness` (9) · `holo-bao-parity-witness` + `cargo test bao_slice_parity` /
`ffi_bao_verify_chunk_round_trip` (Rust 34) · `holo-kappa-bridge-witness` (lint, sha islands retired). All GREEN.
