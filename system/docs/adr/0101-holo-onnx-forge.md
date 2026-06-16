# ADR-0101 — Holo ONNX Forge: the hologram-native ONNX model compiler — precompile once, stream any model as κ-addressable, demand-paged blocks (ari → substrate, 100% UOR-native)

Status: **Stages 0–2 LANDED + witnessed; Stage 3 streaming transport LANDED + witnessed (the non-resident executor load path is the one named remaining refactor).** Sourced from a first-principles map of the `hologram-ai` ("ari") repository (`C:\Users\pavel\Desktop\hologram-ai-main (ari)`) against the holospaces specification (`Hologram-Technologies/holospaces`, `docs/02-Architecture-Constraints.md`, ADR-002/003), then confirmed against the resolved substrate source (`hologram-archive` @ git `18f553d`). Three subsystem agents read the Rust crates, the `.holo` archive seam, and the wasm/web runtime; claims below carry `crate:file` evidence.

> **Stage 0 landed (2026-06-16).** The κ-store seam (Seam A) is implemented in ari, additive + reversible (no VCS in that tree, so the old path I/O stays as wrappers): a new `KappaStore` trait + native `FsKappaStore` CAS (`crates/hologram-ai/src/kstore.rs`) addresses a `.holo` by its κ (`blake3:<hex>` via the substrate's own `address_bytes`), never a path — `HoloArchive::put`/`label` and `HoloRunner::get` are the new boundary; `save(path)`/`from_path` stay as back-compat wrappers. Witnessed `cargo test -p hologram-ai --lib kstore` **6/6** (round-trip byte-identity · κ re-derives from content [L5] · identical bytes dedup to one object [L3] · distinct bytes → distinct κ · absent κ → `None` · **tampered object refused** [L5]); clippy-clean, fmt-clean. End-to-end (`tests/kstore_archive_roundtrip.rs`, opt-in `HOLO_KSTORE_E2E=1`): the real 352 MB `smollm2-360m-int8.holo` put → addressed `blake3:767a2dd…` → resolved by κ (re-derived) → **loaded into the executor with 67 input ports straight from the κ-store, no path**. **Browser half also landed + browser-verified (2026-06-16).** `system/os/usr/lib/holo/holo-onnx-kstore.mjs` is the JS twin (`makeArchiveStore` over the OS2 κ-store + IndexedDB, L5-re-deriving `get`, `loadHoloByKappa` for the wasm seam, `ingestUrl`/`serveArchiveHex`); the κ is `blake3:<hex>` byte-identical to ari's `address_bytes`; the SW (`holo-fhs-sw.js`) serves a `.holo` by its blake3 κ from the κ-store as an additive `/.holo/blake3/<hex>` fallback (re-derived, L5; [[ADR-0026]]). Witnessed `holo-onnx-kstore-witness.mjs` **16/16** incl. the **cross-substrate proof on the real 352 MB archive — OS2's pure-JS BLAKE3 mints the EXACT κ ari's Rust did** (`blake3:767a2dd…`). Browser-verified live: page-side `loadHoloByKappa` round-trips through real IndexedDB, and `fetch('/.holo/blake3/<κ>')` → 200 · `x-holo-source: archive` · bytes match. **Promotion DONE:** `#holo-onnx-forge-store` row registered in `conformance.jsonld` + wired into `gate.mjs` (row verdict PASS); the edited SW resealed into the os-closure (`reseal-drift.mjs` re-pinned `holo-fhs-sw.js` dual-axis, `--check` → 0 drift). Stage 0 fully closed, nothing owed.

> **Stage 1 landed (2026-06-16) — ari, no substrate change.** New `crates/hologram-ai-common/src/manifest.rs` **lifts the substrate's per-weight identity into ari's IR**: `block_kappa(bytes)` = `address_bytes` is byte-identical to the archive's `WeightFingerprint` (proven), `weight_manifest(graph)` addresses every weight tensor by its κ and composes them into a **weight-set root** = order-independent E₈ product (`compose_blocks`); each block re-derives (L5). The compiler carries it — `ModelMetadata.weight_root` + `weight_block_count`, opt-in (gated on `address_model`, best-effort, never fails a compile). Witnessed **7/7** (`cargo test -p hologram-ai-common --lib manifest`: the lift parity · re-derive · order-independent over the SET · singleton = the block · distinct sets → distinct roots · empty refused); clippy-clean (3 crate clippy errors are PRE-EXISTING in `opt/shape_*`, not mine). The model's weights are now a Merkle set of κ-addressed blocks — the minting half of streaming (Seam B). The `AiParam::Mmap → ::Kappa{label}` variant swap is deferred to Stage 2 (invasive; pairs with the demand-paged loader).

> **Stage 2 landed (2026-06-16) — upstream patch to the substrate.** The streaming loader is an additive, backward-compatible patch to `hologram-archive` + `hologram-exec` (developed against an editable clone `hologram-substrate-patch`, branch `holo-onnx-forge-stage2`; ari builds against it via `[patch]`). **(1)** a new optional `SectionKind::WeightIndex`; **(2)** the writer emits the `Weights` payload (unchanged) AND a `WeightIndex` (`fp→offset,len`) in one pass; **(3)** a `LazyWeightStore` over a `RangeResolver` (`SliceResolver` resident; a custom resolver = κ-store/file fetch → true demand-paging) that re-derives every fetched body against its fingerprint (**L5**); **(4)** `LoadedPlan::section_ref`; **(5)** `exec/session` prefers the lazy path — sizing from the index with no body read, **one weight body resident at a time** — eliminating the all-bodies `HashMap` (a full second copy of the weight set), with an eager fallback for index-less archives. Witnessed: archive `weight_index` 3/3 + exec `weight_index_streaming` 3/3 (a **compiled** archive carries the index; offsets resolve every weight on real compiler output; a session **loads + executes** via the lazy path) + full archive/exec suites + ari manifest/kstore + the real 352 MB model load (fallback) — all green; clippy+fmt clean. PR-ready patch: [`../specs/holo-onnx-forge-stage2-substrate.patch`](../specs/holo-onnx-forge-stage2-substrate.patch). **Honest:** witnessed against a local clone of the pinned rev; the canonical-repo PR + advancing ari off the `[patch]` is the final step outside this tree.

> **Stage 3 landed (2026-06-16) — the range-streaming transport, both sides.** Per-block re-derivation on the page-fault path already holds (Stage-2 `LazyWeightStore`, L5). Stage 3 adds the transport so the archive need not be page-resident: **(native)** ari `stream.rs` `FileRangeResolver` impls the substrate `RangeResolver` over a `.holo` FILE (seek+read one range, never read whole) — witness `pages_each_weight_from_a_file_by_range`; **(browser)** the SW `/.holo/blake3/<κ>` route honors HTTP `Range`→`206` (additive; whole object L5-verified once, sub-ranges served) + `holo-onnx-kstore.mjs` `fetchArchiveRange`/`makeRangeResolver` (non-resident, the JS twin of the substrate trait) + `makeStoreRangeResolver` (resident parity). Witness `holo-onnx-kstore-witness` **19/19** (+4: store range · lossless ranged reassembly · HTTP `206` by κ · `200`-fallback). SW resealed (0 drift). **Named remaining (not faked):** the executor's *default* `load(&[u8])` → a non-resident `load_streaming` (whole archive buffer never resident during load) needs an archive head/weights split + a structural fingerprint — a real format+loader refactor; the transport it consumes is done.

> **Disambiguation.** "Forge" in [[ADR-0051]] is the generic κ-transform / esbuild-wasm bundler. This ADR specialises that idea to **ONNX → `.holo` model archives**: the same "client-side bundler compiled to a κ-transform" pattern, applied to model weights instead of JS. It does not replace ADR-0051; it is the model-archive sibling.

Relates: [[holo-q-model-registry]] (ADR-0096, the on-device brain that consumes these archives) · [[holo-q-engine-vs-hologram-ai]] (hologram-ai is the compiler + CPU floor, never the live brain) · [[hologram-ai-precompiled-onnx-spike]] (the prior cold-start spike: deserialize-only load is real; the unoptimised wasm decode floor is ~0.5–0.8 tok/s) · [[ADR-0026]] (sovereign delivery — the OS serves itself by hash; the multi-source κ Service Worker) · [[ADR-0022]] (W3C content addressing — `did:holo` · multihash · JSON-LD) · [[ADR-0082]] (PROV-O receipts, attached out-of-band) · [[ADR-0051]] (Holo Forge κ-transform) · holospaces ADR-002/003 (canonical forms only; everything through the substrate executor).

---

## Context

### The objective

Make `hologram-ai` ("ari") **100% UOR-substrate-native** and turn it into Hologram's native ONNX
model compiler: **precompile any ONNX model once, then stream it as κ-addressable objects** —
deserialize-only load, no JIT, demand-paged block-by-block from the content-addressed store.

### The load-bearing finding: ari is already on the substrate

This is not a port of a foreign codebase onto UOR. ari's `Cargo.toml` depends directly on the
`Hologram-Technologies/hologram` substrate crates — `hologram-types`, `-ops`, `-graph`, `-compiler`,
`-exec`, `-archive`, `-backend`, `-host` — the comment reading *"hologram 0.5.0 is UOR-native."*
holospaces depends on the **same** crates and its own ADR-003 states it *"runs a tensor `.holo` via
hologram's executor."* **ari already emits the exact artifact the holospaces substrate executes.** ari
and holospaces are siblings on one substrate, both minting κ through the same `uor-addr`.

Concretely, the compile→archive→execute **core is already substrate-native**:

- The `.holo` format, its internal κ-addressing, and per-value content-addressed elision are *owned by*
  `hologram-archive`/`hologram-exec`. ari delegates all hashing — it never invents a parallel store
  (`hologram-ai/src/runner.rs`: `intern_input` / `resolve` / `resident_bytes` all forward to
  `self.session.*`). Identical weight bytes already collapse to one pool buffer by κ-label.
- Re-derivation exists at model granularity: the model-file κ carries a replayable TC-05 witness
  (`hologram-ai/src/address.rs`, canonical form = JCS-RFC8785 + NFC), satisfying **L5** for the whole
  artifact.
- The thin-layer constraint (**L4**) is already met for the hot path: the compile/run/generate core
  builds `default-features = false` (no reqwest / tokio / rayon / Python) and runs in-browser — proven
  by the live `hologram-ai-wasm` build.

So "100% native + streamable κ-objects" is **not a rewrite**. It is closing four specific seams.

### Two things called "substrate" — do not conflate them

1. **The hologram substrate** — the Rust `KappaStore` / `KappaSync` / `ContainerRuntime` + `.holo`
   executor. This is what the Laws govern and what ari compiles to.
2. **The OS2 browser κ-store** — the Service-Worker fabric ([[ADR-0026]]). The wasm runtime already
   takes a `Uint8Array`, so a SW κ-store plugs in at the `fetch` boundary **with zero Rust change**.

Native-ness is measured against (1). OS2 delivery rides (2).

### The Laws (verbatim — holospaces `docs/02-Architecture-Constraints.md`, "The laws (non-negotiable)")

| Law | Text |
|---|---|
| **L1** | "No servers; nothing is identified by host, path, or URL. Identity is the κ-label." |
| **L2** | "Operate on canonical forms; hold κ-labels, not objects; canonicalize at the ingest boundary and never leave canonical form." |
| **L3** | "The hologram content-addressed store is the address space; RAM is a cache; a 'page fault' is a κ-resolve, 'eviction' is garbage collection." |
| **L4** | "No parallel memory, storage, network, or runtime; holospaces is a thin layer of operations over the substrate." |
| **L5** | "Re-derive every received byte against its κ before accepting it." |

(holospaces enumerates **no** W3C/JSON-LD/PROV-O requirement — that is an OS2 *product* layer,
[[ADR-0022]]/0024/0025. Both layers are honored here: engine L1–L5 + the product's `did:holo`/JSON-LD
projection, with PROV-O lineage attached **out-of-band** so it never perturbs the content address.)

### The four seams that block "100% native + streamable"

| # | Seam (evidence) | Law broken | Owner |
|---|---|---|---|
| **A** | `.holo` persisted via `std::fs::write/read` to a host path (`runner.rs`, `compiler.rs`) | **L3** — the store is the address space, not a filesystem | ari (small) |
| **B** | Weights are `path+offset` blobs (`AiParam::Mmap`, materialised by a whole `read_exact` — "Mmap" is a misnomer; `memmap2` is declared but **unused**); model κ is **one coarse κ/model, off by default** | **L2** — hold κ-labels, not paths; coarse identity can't be block-streamed | **upstream hologram** (archive format) + ari |
| **C** | Whole-file load: `std::fs::read` → `InferenceSession::load(&bytes)`; no lazy materialisation; the wasm verbs take `&[u8]` (the whole archive) and the JS glue copies it in one `.set()` (~2× peak RAM) | **L3** — "page-fault = κ-resolve," demand-paged | **upstream hologram** + ari |
| **D** | Ingest: HuggingFace download (reqwest/tokio) + Python/PyTorch `torch.onnx.export` subprocess (`download/convert.rs`) | **L1/L4** — no servers, no parallel runtime | ari (gate it) |

**Seam B is the heart of "stream any ONNX model as κ-addressable objects."** Reading the resolved
substrate source (`hologram-archive` @ git `18f553d`) **downgraded the risk** from the initial "opaque
blob" framing: the `.holo` is already a **section table** (`SectionRef{kind,offset,length}`, zero-copy
`LoadedPlan::section`), is **self-verifying** (a BLAKE3 footer verified at load — L5 already), and
**every weight body already carries its own BLAKE3 fingerprint** (`WeightFingerprint`; the `Weights`
section is `count` then repeated `{fp, len, body}`). So Seam B's hard half — per-tensor content
addressing — **exists in the substrate**; ari simply never lifts those fingerprints into its IR, and
the eager-load culprit is one function (`decode_weights` materialises every body into a RAM HashMap).
Stage 2 is therefore **additive upstream work, not a format rewrite**: a backward-compatible
`WeightIndex` section + a range-resolver `HoloLoader` + a lazy `WeightStore`. ari alone can deliver A,
D, Stage-1 minting, and κ-store byte-delivery; the **only** residual upstream ask is whether hologram
takes that patch or ari carries it. Everything through Stage 1 is verifiable on ari alone. (Full
substrate-internals evidence in the spec, §10.)

---

## Decision (provisional)

Refactor ari into **Holo ONNX Forge** along four moves, each gated by a witnessed conformance row in
the holospaces V&V style (`earl:passed`, witnessed against an external authority). No parallel store,
no new transport, no second hashing scheme (**L4**) — every move tightens an existing seam onto the
substrate it already half-touches.

### 1. The store is the address space (Seam A — ari-only)

Replace `std::fs` archive persistence with `KappaStore` put/get. A compiled `.holo` is **put** into the
content-addressed store and referenced by its κ; loading is a **get** by κ, never a path. The model's
identity becomes its store address — `did:holo:<axis>:<hex>` ([[ADR-0022]]) — not a filename (**L1/L3**).
The OS2 SW κ-store ([[ADR-0026]]) is the browser-side implementation of the same get.

### 2. Block-granular, re-derivable κ-sectioning (Seam B — needs upstream)

Section the `.holo` so each large constant (per-tensor, or per-shard for tensors above a threshold) is
an **independently κ-addressed block**, minted at lower time and committed by the archive's manifest.
`AiParam::Mmap { path, offset, len }` becomes `AiParam::Kappa { label, len }` — ari holds a **κ-label,
not a path** (**L2**). Each block's κ is re-derivable from its canonical bytes; the model's root κ is
the order-independent E₈ product over its block κ (the `compose_model` idiom ari already has at model
granularity, pushed down to blocks). This is the move that makes a model a *Merkle-DAG of blocks*
rather than one opaque blob — the precondition for streaming.

### 3. Demand-paged loader: a page-fault is a κ-resolve (Seam C — needs upstream)

Replace whole-file load with a lazy loader that resolves blocks **on demand** by κ. A weight that the
current decode step does not touch is never resident; touching it is a κ-resolve (**L3**, verbatim:
"a 'page fault' is a κ-resolve"). On the wasm side this is a streaming reader that pulls blocks from
the SW κ-store as the schedule references them, dissolving both the ~2× load-time RAM spike and the
32-bit-tab ceiling that today bounds ari to small models. Each block is **re-derived against its κ
before acceptance** (**L5**) — the existing TC-05 witness, applied per block.

### 4. Confine ingest to the substrate boundary (Seam D — ari-only)

Ingest ONNX **bytes that are already κ-objects** in the store; the importer's only job is canonicalize-
at-the-boundary (**L2**). The HuggingFace downloader and the Python/PyTorch `torch.onnx.export`
subprocess are **declared honestly as out-of-substrate ingest tools** (the precedent: [[ADR-0100]]'s
six terminal backends — incompatible in-tab, never faked, **L5**). PyTorch conversion is genuinely
incompatible with the tab; it stays an explicit, gated, off-substrate pre-step that emits a κ-object the
native pipeline then consumes. The native compile→stream→execute path takes only κ in, κ out.

### What is reused vs new

| Capability | Status | Where |
|---|---|---|
| ONNX → `AiGraph` import; ~20 optimisation passes; lowering to canonical `OpKind`/`Graph` | **reuse (already substrate-native)** | `hologram-ai-onnx`, `hologram-ai-common` |
| `.holo` archive encode + execute + per-value κ-elision | **reuse (substrate-owned)** | `hologram_compiler::compile`, `hologram_exec::InferenceSession` |
| Model-file κ + TC-05 re-derivation witness | **reuse, push down to blocks** | `hologram-ai/src/address.rs` (`uor-addr`) |
| `no_std` dequant + tokenizer | **reuse** | `hologram-ai-quant`, `hologram-ai-tokenizer` |
| wasm verbs over a `Uint8Array` byte buffer | **reuse (the κ-store seam)** | `hologram-ai-wasm`, `apps/web/src/holo.ts` |
| **`.holo` persistence as KappaStore put/get (not `std::fs`)** | **new (Seam A)** | ari runner/compiler I/O boundary |
| **Per-block κ-sectioning of the archive + `AiParam::Kappa`** | **new (Seam B — upstream-touching)** | `hologram-archive` manifest + ari lower |
| **Demand-paged κ-resolve loader + streaming wasm reader** | **new (Seam C — upstream-touching)** | `hologram-exec` load path + ari wasm reader; OS2 SW κ-store delivery |
| **Gated, declared-honest off-substrate ingest (HF/PyTorch)** | **new (Seam D)** | `hologram-ai/src/download/*` (feature-gated, receipt-stamped) |

---

## Conformance + witness plan (staged; the upstream boundary is isolated to Stage 2)

Each stage lands one `earl:passed` row, witnessed against an external authority, holospaces-style.

- **Stage 0 — `#holo-onnx-forge-store` (ari-only, no upstream).** Route `.holo` persistence and the
  wasm byte-delivery through a κ-store: compile a small model, **put** the archive by κ, **get** it by
  κ, execute — zero `std::fs` path in the hot path; the OS2 SW κ-store serves the bytes. Proves Seam A
  + the OS2 seam. Authority: the round-tripped archive re-derives to its κ (**L5**).
- **Stage 1 — `#holo-onnx-forge-blocks`.** Per-tensor κ minted at lower time; `AiParam::Kappa`
  replaces `AiParam::Mmap`; the model root κ = E₈ product over block κ; every block re-derivable.
  Proves Seam B's *minting* half + Seam D, without yet touching the executor.
- **Stage 2 — `#holo-onnx-forge-stream` (the upstream decision point).** Sectioned `.holo` + a
  demand-paged loader where an untouched weight is never resident and touching it is a κ-resolve.
  This stage **decides** whether block-streaming lands in `hologram-archive`/`-exec` upstream or as an
  ari-side container; confirm the boundary before committing. Authority: a model larger than the
  resident budget loads and decodes (the 32-bit-tab ceiling lifts).
- **Stage 3 — `#holo-onnx-forge-rederive`.** Retire whole-file load entirely; verify-by-re-derivation
  **per block** on the page-fault path (**L5** at block granularity); PROV-O lineage ([[ADR-0082]])
  attached out-of-band. Gate exit 0.

A run's receipt seals as one re-derivable κ; PROV-O is a sibling leaf, never folded into the content
address (folding lineage into the κ breaks κ-memo — the standing [[holo-playground-adr]] rule).

---

## Consequences (provisional)

- **What Hologram gains:** a native ONNX compiler that precompiles once and **streams any model as a
  Merkle-DAG of κ-addressed, demand-paged blocks** — deserialize-only, no JIT, re-derived per block
  (**L5**), served by the OS2 SW κ-store ([[ADR-0026]]). Large models stop being bounded by the
  whole-archive RAM spike and the 32-bit-tab ceiling. ari becomes the supply side of the model
  registry ([[holo-q-model-registry]]); Holo Q stays the live brain ([[holo-q-engine-vs-hologram-ai]]).
- **The honest limits (stated, not hidden):**
  - **Streaming (Stages 2–3) is the only upstream-touching work.** If `hologram-archive`/`-exec` will
    not take block-sectioning, Stage 2 becomes an ari-side archive container — heavier, and a divergence
    from the canonical `.holo` to be weighed explicitly. Everything through Stage 1 is verifiable on
    ari alone.
  - **PyTorch/ONNX conversion cannot be substrate-native** and is declared incompatible, not faked
    ([[ADR-0100]] precedent, **L5**). The native path is κ-in/κ-out; raw-model ingest is an explicit
    off-substrate pre-step.
  - **Performance is unchanged by this ADR.** Streaming fixes *memory and load*, not throughput; the
    wasm decode floor stays single-threaded scalar (~0.5–0.8 tok/s order, [[hologram-ai-precompiled-onnx-spike]]).
    WebGPU/threads are out of scope here.
  - Coarse model κ is **off by default today** for canonicalisation cost; Stage 1 makes block κ the
    default by amortising the cost across blocks, but the cost must be witnessed, not assumed.
- **Reversible:** Stages 0/1 are additive (a new persistence boundary + a new `AiParam` variant);
  reverting restores `std::fs` + `AiParam::Mmap`. Stages 2/3 are the load-bearing, upstream-gated change.
