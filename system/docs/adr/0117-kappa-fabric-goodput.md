# ADR-0117 — κ-fabric effective goodput: where κ-addressable BLAKE3 streaming beats InfiniBand (and where it doesn't)

Status: **PROVEN (measured, native + live in CEF); GO on the full κ-RDMA build with one named target first.**
The honest de-risking step before building a GPU-cluster fabric: measure whether effective goodput over
κ-addressable BLAKE3 streaming objects exceeds InfiniBand, with no hero numbers.

Relates: ADR-0115 (BLAKE3 canonical κ) · ADR-0116 (verified streaming + native engine) · the findings
`kappa-fabric-goodput-findings.md` · the prompts `…kappa-rdma-infiniband-class…` and `…kappa-fabric-goodput-proof…`.

## Decision (the honest claim)

Hologram does **not** beat IB's wire rate on novel bytes (a NIC is a NIC). It changes **what crosses the
wire**: an unchanged tile is already resident (Law L3), so it never moves. **Effective goodput = useful
bytes ÷ wall time**, and on redundant cluster traffic that is `line/(1-r)` — far above the fabric.

Measured (24 cores, 128 MiB, native release; proven live via `holo:fabric:goodput` cefQuery → `kr_fabric_goodput`):
- **Cold (r=0):** verify-bound at ~5.8 GB/s — loses to IB on throughput, wins only on latency (6.5 µs to
  first verified chunk vs the whole tensor). Stated, not hidden.
- **Redundant:** 90% → ~10×, 99% → ~100× effective goodput vs IB line. Crossover (parallel verify 5.8 GB/s):
  beats HDR above ~77%, NDR above ~88%, XDR above ~94% redundancy.
- **Bottleneck = verify parallelism.** Single-core per-chunk verify (0.30 GB/s) loses even at 99%;
  `verify_chunks_par` (5.8 GB/s) wins at high redundancy; the raw-BLAKE3 ceiling (~60 GB/s) shows closing
  the gap would drop the NDR crossover to ~17% (beat NDR on almost any redundant workload).

## Consequence

GO on the full κ-RDMA build — the win is structural (content-addressing), real where AI gradient-sync lives
(high redundancy), and honestly bounded. **First engineering target:** lift parallel chunk verify ~5.8 →
~60 GB/s (larger verify work-units / SIMD-batched folds / GPU verify), which lowers every crossover and
makes the cold path wire-bound, not verify-bound.

## Integration (100% native CEF)

`kappa-route::{bao,fabric}` (SIMD BLAKE3 + `verify_chunks_par`), FFI `kr_fabric_goodput` /
`kr_bao_encoder_*` / `kr_bao_verify_chunk` in `kappa_route.h`, linked into `holo_cef_host.exe`, wired to the
`holo:fabric:goodput` cefQuery verb. Live-proven (`prove-fabric.ps1`): a `holo://` page runs the bare-metal
proof in the host and gets the IB-class numbers back. Rust 37/37; `fabric_bench` + `prove_bao_stream` green.
