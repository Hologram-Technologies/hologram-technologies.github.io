# Holo ONNX Forge — feasibility map + staged plan

Companion to [ADR-0101](../adr/0101-holo-onnx-forge.md). This is the evidence behind the verdict:
**can `hologram-ai` ("ari") be refactored 100% UOR-substrate-native, as a compiler that precompiles
and streams any ONNX model as κ-addressable objects?** Verdict: **yes, and most of the core already
is** — the work is closing four named seams, two of which reach into the upstream `hologram` crates.

Evidence was gathered by mapping the ari Rust workspace (`hologram-ai-main`, the "ari" tree) and the
holospaces specification (`Hologram-Technologies/holospaces`, `docs/`) from first principles. Claims
carry `crate:file` pointers; this doc is the durable record so the next engineer does not re-derive it.

---

## 1. The constraint: the Laws (verbatim)

holospaces `docs/02-Architecture-Constraints.md`, "The laws (non-negotiable)":

- **L1** — "No servers; nothing is identified by host, path, or URL. Identity is the κ-label."
- **L2** — "Operate on canonical forms; hold κ-labels, not objects; canonicalize at the ingest boundary and never leave canonical form."
- **L3** — "The hologram content-addressed store is the address space; RAM is a cache; a 'page fault' is a κ-resolve, 'eviction' is garbage collection."
- **L4** — "No parallel memory, storage, network, or runtime; holospaces is a thin layer of operations over the substrate."
- **L5** — "Re-derive every received byte against its κ before accepting it."

κ-label (Glossary): a content address `<axis>:<hex> = H(canonical_form)`, supplied by
[UOR-ADDR](https://github.com/UOR-Foundation/uor-addr). "UOR-native" = from the κ inward, everything
is content-addressed; no host/path/URL identity. holospaces enumerates **no** W3C/JSON-LD/PROV-O
requirement — that is the OS2 *product* layer (ADR-0022/0024/0025), honored beside the engine Laws.

## 2. The load-bearing finding: ari is already on the substrate

ari's `Cargo.toml` depends directly on the `Hologram-Technologies/hologram` substrate crates —
`hologram-types`, `-ops`, `-graph`, `-compiler`, `-exec`, `-archive`, `-backend`, `-host` — with the
comment *"hologram 0.5.0 is UOR-native."* holospaces depends on the **same** crates; its ADR-003 says
it *"runs a tensor `.holo` via hologram's executor."* **ari and holospaces are siblings on one
substrate, both minting κ through the same `uor-addr`. ari already emits the artifact holospaces
executes.**

Two distinct "substrates" — do not conflate:

1. **The hologram substrate** — Rust `KappaStore` / `KappaSync` / `ContainerRuntime` + `.holo`
   executor. What the Laws govern; what ari compiles to.
2. **The OS2 browser κ-store** — the Service-Worker fabric (ADR-0026). The wasm runtime already takes
   a `Uint8Array`, so a SW κ-store plugs in at the `fetch` boundary with **zero Rust change**.

Native-ness is measured against (1); OS2 delivery rides (2).

## 3. What already obeys the Laws

| Property | Evidence | Law |
|---|---|---|
| `.holo` format + internal κ-addressing are substrate-owned; ari never invents a store | `hologram-ai/src/runner.rs` `intern_input`/`resolve`/`resident_bytes` all forward to `self.session.*`; identical weights collapse to one pool buffer by κ | L2/L3 |
| Re-derivation at model granularity | `hologram-ai/src/address.rs` mints a model κ via `uor-addr` with a replayable TC-05 witness; canonical form = JCS-RFC8785 + NFC | L5 |
| Thin layer; no parallel runtime in the hot path | the compile/run/generate core builds `default-features=false` (no reqwest/tokio/rayon/Python) and runs in-browser via `hologram-ai-wasm` | L4 |
| ONNX import + ~20 opt passes + lowering | `hologram-ai-onnx` (pure `prost`→`AiGraph`), `hologram-ai-common` (IR + passes + `lower/`) | — |

## 4. The four seams (the whole gap)

| # | Seam | Evidence | Law | Owner |
|---|---|---|---|---|
| **A** | `.holo` persisted to a host filesystem path | `std::fs::write/read` in `compiler.rs`, `runner.rs` | **L3** — store is the address space, not a path | ari (small) |
| **B** | Weights are `path+offset` blobs; coarse model κ | `AiParam::Mmap` materialised by a whole `read_exact` (`hologram-ai-common/src/lower/builder.rs`); `memmap2` declared but **unused**; one κ/model, off by default | **L2** — hold κ, not paths; coarse identity can't stream | **upstream** hologram-archive + ari |
| **C** | Whole-file load, no lazy materialisation | `runner.rs` `std::fs::read`→`InferenceSession::load(&bytes)`; wasm verbs take the whole `&[u8]`; JS glue copies in one `.set()` (~2× peak RAM); 32-bit-tab ceiling | **L3** — page-fault = κ-resolve | **upstream** hologram-exec + ari |
| **D** | Ingest touches servers + Python | HF download (reqwest/tokio) + `torch.onnx.export` subprocess in `hologram-ai/src/download/convert.rs` | **L1/L4** — no servers, no parallel runtime | ari (gate it) |

**Seam B is the heart of "stream any ONNX model as κ-addressable objects" and the riskiest
assumption:** ari treats the `.holo` archive as opaque bytes (the format lives in `hologram-archive`,
a git dependency not vendored in ari), so block-granular κ-sectioning (B) and a demand-paged loader (C)
most likely require changes **inside the substrate crates**. Confirm that boundary before Stage 2.

## 5. Substrate-native scorecard (full subsystem map)

| Subsystem | Rating | Reason |
|---|---|---|
| `.holo` format + internal κ-addressing | already-native | substrate-owned; ari delegates |
| Runtime execution / content-addressed elision | already-native | `runner.rs` forwards to `session.*` |
| Lowering `AiGraph`→canonical `OpKind`/`Graph` | already-native | emits the closed substrate op catalog |
| Model-file κ (class MA) + TC-05 witness | already-native | `address.rs` wraps `uor-addr`; coarse, opt-in |
| `hologram-ai-quant` (dequant) | already-native | `#![no_std]`, zero substrate deps |
| `hologram-ai-tokenizer` (encode/decode) | already-native | `#![no_std]` core |
| AI IR + optimisation passes | mechanically-portable | pure graph rewrites over ari's own IR |
| ONNX importer | mechanically-portable | pure `prost`→AiGraph, touches no hologram crate |
| Generation/sampling loop | mechanically-portable | pure logic over `HoloRunner`; runs in wasm |
| rayon parallel passes | mechanically-portable | `parallel` feature already toggles off for wasm |
| Archive load path (whole-file read) | **needs-redesign** | no streaming/mmap/lazy; whole archive resident before `load` |
| `AiParam::Mmap` weight handling | **needs-redesign** | a whole `read_exact`, not a map; large-model memory story unimplemented |
| HF downloader (reqwest+tokio+sha2) | **needs-redesign** | host HTTP + async runtime; `native`-gated |
| Desktop Tauri app | incompatible | GUI shell spawning the native CLI; GTK + on-disk binary |
| Python/PyTorch ONNX conversion | incompatible | spawns venv/pip/`torch.onnx.export` |

## 6. The runtime reality (wasm path, today)

- `hologram-ai-wasm` exports four verbs over byte buffers: `compile(&[u8])→.holo`, `describe`, `run`,
  `generate` — **compile AND execute both run in-browser** (proven by in-wasm tests).
- The spike loads a model as **one `fetch().arrayBuffer()`** of a `.holo` (`spike-web/index.html`),
  not streamed; `serve.mjs` has **no range-request support**.
- The shipped wasm is **single-threaded, scalar (no SIMD128), CPU-only** (`CpuBackend` hard-coded in
  `runner.rs`; WebGPU is not wired in the wasm path, nor in the live native runner). 32-bit address
  space → a real ~2 GB tab ceiling; the bundled 1.31 GB float `.holo` likely OOMs.
- Honest perf: ~0.5–0.8 tok/s order on the wasm floor (the operator's prior spike note); no committed
  benchmark in-repo. **Streaming fixes memory/load, not throughput.**

**The integration seam (no Rust change for byte-delivery):** every verb takes a `Uint8Array`; the app
adapter is `apps/web/src/holo.ts`. A SW κ-store (ADR-0026) intercepts the `fetch` and serves
content-addressed bytes — works today at the byte-delivery level. True *streaming* (chunked, to dodge
the 2× peak and the ceiling) needs new work on both sides (a reader-based wasm API + a lazy
`InferenceSession::load` + a range-capable κ transport) — i.e. Stages 2–3.

## 7. Staged plan (each stage = one witnessed conformance row, holospaces V&V style)

- **Stage 0 — `#holo-onnx-forge-store` — LANDED + witnessed (native half).** Implemented in ari: a
  `KappaStore` trait + native `FsKappaStore` CAS (`crates/hologram-ai/src/kstore.rs`) keyed at
  `<root>/<axis>/<hex>`; `.holo` is addressed by κ (`blake3:<hex>` via the substrate's `address_bytes`),
  not a path. `HoloArchive::put`/`label` + `HoloRunner::get` are the new boundary (old `save`/`from_path`
  kept as wrappers — additive, reversible). Unit witness **6/6** (`cargo test -p hologram-ai --lib
  kstore`): round-trip byte-identity · κ re-derives from content (L5) · dedup to one object (L3) ·
  distinct→distinct · absent→`None` · **tampered object refused** (L5). E2E (opt-in `HOLO_KSTORE_E2E=1`,
  `tests/kstore_archive_roundtrip.rs`): the real 352 MB `smollm2-360m-int8.holo` put → `blake3:767a2dd…`
  → resolved by κ → **loaded into the executor (67 input ports) straight from the κ-store, no path**.
  clippy-clean, fmt-clean.
  **Browser half — LANDED + browser-verified.** `system/os/usr/lib/holo/holo-onnx-kstore.mjs` is the JS
  twin of `kstore.rs`: `makeArchiveStore` (over the OS2 κ-store, `holo-store.makeStore` + IndexedDB) with
  the same contract and L5-re-deriving `get`; `archiveLabel`/`ingestHolo`/`loadHoloByKappa`/`ingestUrl`/
  `serveArchiveHex`. The κ is `blake3:<hex>` via `holo-blake3` — **byte-identical to ari's `address_bytes`**.
  The SW (`holo-fhs-sw.js`) serves a `.holo` by its blake3 κ from the κ-store as an additive fallback on
  its `/.holo/blake3/<hex>` route (re-derived, L5; ADR-0026). Node witness `holo-onnx-kstore-witness.mjs`
  **16/16** (mirrors the six ari tests + the wasm seam + `serveArchiveHex` + κ-parity), including the
  **cross-substrate proof on the real 352 MB archive: OS2's pure-JS BLAKE3 mints the exact κ ari's Rust
  did** (`blake3:767a2dd…`, opt-in `HOLO_KSTORE_PARITY=1`). Browser-verified live (gateway :8123): page-side
  `loadHoloByKappa` round-trips a blob through real IndexedDB (κ-parity, absent→throw), and
  `fetch('/.holo/blake3/<κ>')` returns **200 · `x-holo-source: archive` · bytes match**.
  **Promotion DONE:** `#holo-onnx-forge-store` conformance row registered in `conformance.jsonld` + wired
  into `gate.mjs` `LIVE` (gate verdict on the row = PASS); the edited SW resealed into the os-closure
  (`reseal-drift.mjs` re-pinned `holo-fhs-sw.js`, dual-axis preserved, `--check` → 0 drift). Nothing owed.
- **Stage 1 — `#holo-onnx-forge-blocks` — LANDED + witnessed (ari).** New
  `crates/hologram-ai-common/src/manifest.rs`: `block_kappa(bytes)` = `address_bytes` = **the substrate's
  `WeightFingerprint`, lifted into ari's IR** (proven byte-identical); `weight_manifest(graph)` addresses
  every weight tensor by its κ and composes them into a **weight-set root** = order-independent E₈ product
  (`compose_blocks`, the `compose_model` idiom pushed down to blocks); each block re-derivable (L5). The
  compiler carries it: `ModelMetadata` gains `weight_root` + `weight_block_count`, populated opt-in (gated
  on the existing `address_model`, best-effort — reading every weight has a cost, never fails a compile).
  Witness `cargo test -p hologram-ai-common --lib manifest` **7/7** (the lift parity · re-derive · order-
  independent over the set · singleton = the block · distinct sets → distinct roots · empty refused);
  clippy-clean (the 3 crate clippy errors are pre-existing in `opt/shape_*`, not mine). The model's weights
  are now a **Merkle set of κ-addressed blocks** — the minting half of streaming. **Deferred to Stage 2
  (rightly):** the `AiParam::Mmap → AiParam::Kappa{label,len}` variant swap is invasive (it changes how
  lowering references weights) and pairs with the demand-paged loader that resolves a block by κ — so it
  lands with Stage 2, not here.
- **Stage 2 — `#holo-onnx-forge-stream` — LANDED + witnessed (upstream patch).** Implemented as an
  additive, backward-compatible patch to the hologram substrate (`hologram-archive` + `hologram-exec`),
  developed against an editable clone of the pinned rev (`hologram-substrate-patch`, branch
  `holo-onnx-forge-stage2`; ari builds against it via `[patch]`). The patch:
  **(1) format** — new optional `SectionKind::WeightIndex`;
  **(2) writer** — emits the `Weights` payload (unchanged) AND a `WeightIndex` (`fp→offset,len`) in one
  pass, so each entry locates a body within `Weights`;
  **(3) `weight_index`** — `WeightIndex::decode` + `LazyWeightStore` over a `RangeResolver`
  (`SliceResolver` for a resident archive; a custom resolver = κ-store/file fetch → true demand-paging);
  every fetched body is **re-derived against its fingerprint before return (L5)**;
  **(4) loader** — `LoadedPlan::section_ref` anchors index offsets to absolute positions;
  **(5) exec/session** — prefers the lazy path (sizing from the index with no body read; **one weight
  body resident at a time**, L5-verified), falling back to the eager `WeightStore` for index-less
  archives. This **eliminates the all-bodies `HashMap` at load** (a full second copy of the weight set).
  Witnessed: `hologram-archive` `weight_index` 3/3 (lazy resolves by κ matching eager · tamper-refuse L5
  · unindexed→None) + a new `hologram-exec` `weight_index_streaming` 3/3 (a **compiled** archive carries
  a `WeightIndex` · the index offsets resolve every weight on real compiler output · a session **loads +
  executes** via the lazy path) + the full archive/exec suites green + ari's manifest/kstore + the real
  352 MB model load (backward-compat fallback) all green against the patched substrate; clippy+fmt clean.
  PR-ready patch at [`holo-onnx-forge-stage2-substrate.patch`](holo-onnx-forge-stage2-substrate.patch).
  **Honest remaining:** the patch is witnessed against a local clone; merging it into canonical
  `Hologram-Technologies/hologram` (the PR) + advancing ari off the `[patch]` is the final step, outside
  this tree. The wasm streaming reader (a `RangeResolver` over the OS2 SW κ-store, so the archive itself
  need not be resident) is the natural Stage 3 companion.
- **Stage 3 — `#holo-onnx-forge-rederive` — streaming transport LANDED + witnessed; the non-resident
  executor load path is the named remaining refactor.** Per-block re-derivation on the page-fault path
  already holds (the Stage-2 `LazyWeightStore` re-derives every fetched body against its fingerprint, L5
  at block granularity). Stage 3 adds the **range-streaming transport on both sides**:
  **(native)** ari `crates/hologram-ai/src/stream.rs` `FileRangeResolver` implements the substrate's
  `RangeResolver` over a `.holo` FILE — each `fetch` seeks + reads one range, the file is never read
  whole; witness `pages_each_weight_from_a_file_by_range` pages every weight from disk by range,
  re-derived (L5), matching eager.
  **(browser)** the SW `/.holo/blake3/<κ>` route honors HTTP `Range` → `206` partial content (additive;
  the whole object is L5-verified once on `get`, then sub-ranges served); `holo-onnx-kstore.mjs` gains
  `fetchArchiveRange` + `makeRangeResolver` (HTTP, **non-resident** — the archive stays in the κ-store)
  + `makeStoreRangeResolver` (resident parity). Witness `holo-onnx-kstore-witness` **19/19** (+4 Stage 3:
  store paging an exact range · lossless ranged reassembly · HTTP `206` sub-range by κ · `200`-fallback
  slice). SW resealed (pin matches, 0 drift).
  **Honest remaining (named, not faked):** wiring these resolvers as the executor's *default* load —
  `InferenceSession::load_streaming` so the whole archive buffer is never resident during load (only the
  small structural sections + index + one weight body at a time) — needs an archive **head/weights split**
  + a structural fingerprint (so L5 holds without footer-hashing the weight bytes). That is a real
  format+loader refactor; the transport it consumes is done. PROV-O lineage (ADR-0082) stays out-of-band.

A run seals one re-derivable `holoq:ForgeReceipt` κ; PROV-O is a sibling leaf, never folded into the
address.

## 8. Honest limits (stated, not hidden)

- Streaming (Stages 2–3) is the **only** upstream-touching work; everything through Stage 1 is
  verifiable on ari alone.
- PyTorch/ONNX conversion **cannot** be substrate-native — declared incompatible, never faked (the
  ADR-0100 precedent, L5). The native path is κ-in/κ-out; raw-model ingest is an explicit off-substrate
  pre-step that emits a κ-object.
- This work changes **memory and load**, not throughput. The wasm decode floor stays single-threaded
  scalar; WebGPU and threads are out of scope here.
- Coarse model κ is off by default today for canonicalisation cost; Stage 1 makes block κ the default
  by amortising the cost — but that cost must be witnessed, not assumed.
- One stale-doc caveat in ari: `specs/docs/runtime-model.md` still describes a `KvExecutor` + mutable
  KV-cache + `HoloLoader` lazy-mmap model the code has **abandoned** (no `HoloLoader`/`ConstantData::
  Deferred` in `src`). Trust the code, not that doc.

## 10. Substrate archive internals — verified (de-risks Seams B/C)

Reading the resolved substrate source (`hologram-archive` @ git `18f553d`, checked out under cargo)
sharpens the risk picture materially. The `.holo` format is **not** the opaque blob ari treats it as:

- **Sectioned, random-access by construction.** `format::HoloHeader` is a section table of
  `SectionRef { kind, offset: u64, length: u64 }` (`format.rs`); `loader::LoadedPlan::section(kind)`
  returns a **zero-copy** sub-slice by `(offset, length)` (`loader.rs`). Sections include `Weights`,
  `Constants`, `WarmStart`, repeatable `Extension`, etc. The access pattern is already addressed —
  only the *backing buffer* is whole-resident.
- **Self-verifying at load.** `HoloLoader::from_bytes` verifies a **32-byte BLAKE3 footer over all
  preceding bytes** before yielding a plan (`loader.rs`) — L5 already holds at archive granularity,
  and that footer is a ready-made archive κ for Stage 0.
- **Weights are ALREADY individually content-addressed.** `weight::WeightFingerprint` is a BLAKE3 hash
  of a weight body; `WeightStore` dedups bodies by it. The `Weights` section wire format
  (`writer.rs::encode_weights`) is `count:u32` then repeated `{ fp:[u8;32], len:u64, body }` — i.e.
  **every weight body carries its own κ and length, laid out sequentially.** Seam B's hard half (per-
  tensor content addressing) **exists in the substrate**; ari just never lifts those fingerprints up
  into its IR (`AiParam::Mmap{path,offset}` instead of `AiParam::Kappa{fp}`), and the model κ stays
  coarse.
- **The eager-load culprit is located precisely.** `writer.rs::decode_weights` materialises **every**
  body into an in-RAM `HashMap` at session load. That — not the format — is what forces the whole
  archive resident.

**So Stage 2 is smaller and lower-risk than first stated.** It is not "reverse-engineer an opaque
format." It is three well-scoped pieces: (1) a **weight index** (`fp → offset,len`) so a body is range-
fetchable by κ without a full scan — a small, backward-compatible format addition (a new
`SectionKind::WeightIndex`, or a length-prefixed index header on the `Weights` section; bodies are
already κ'd); (2) generalise `LoadedPlan`/`HoloLoader` to accept a **byte-range resolver**
(`Fn(offset,len) -> bytes`) instead of one `&'a [u8]`, so `section()`/weight access becomes a κ-resolve
(L3) rather than a slice; (3) a **lazy `WeightStore`** that resolves a body by fingerprint on demand
instead of `decode_weights`-all-up-front. ari-side: expose `WeightFingerprint` upward so `AiParam`
holds a κ, not a path. All three are additive and backward-compatible (a v2 archive still loads whole;
the index is optional metadata).

## 9. Open questions (resolve before committing scope)

1. **Mostly answered (§10):** the `.holo` is already sectioned with per-section `(offset,length)` and
   per-weight BLAKE3 fingerprints, so Stage 2 needs a small additive weight-index + a range-resolver
   loader + a lazy weight store — not a format rewrite or an ari-side container. Remaining upstream
   ask: will the hologram maintainers take the `WeightIndex` section + the resolver-shaped
   `HoloLoader`/`decode_weights` (vs. ari carrying a fork)?
2. Which κ axis for block labels — SHA-256 (ari's current model-κ default) or BLAKE3-σ (the runtime
   pool axis)? Pick one and keep it consistent (L2: never leave canonical form).
3. What is the block granularity threshold — per-tensor always, or per-shard above N bytes? (Trades
   manifest size against streaming smoothness.)
4. Does `InferenceSession::load` already mmap the passed slice? (Bounds how much Stage 3 actually
   buys; not determinable from the ari tree alone.)

## 11. Throughput & O(1) — what the κ-substrate actually buys (the decisive analysis)

A real end-to-end perf test (SmolLM2-135M-Instruct, downloaded from HuggingFace, native x86
release, the patched substrate) grounds this:

| Phase | Result |
|---|---|
| precompile (fp32 ONNX → `.holo`) | **3 s** |
| load (deserialize-only, no JIT) | **~0.9 s** |
| generation (greedy, coherent: "…Paris is the largest city in France…") | **~2.34 tok/s** (CPU scalar) |

Levers probed and **rejected**: `target-cpu=native` SIMD moved nothing (≈noise/worse — the matmul
kernels don't meaningfully vectorize). The pre-quantized int8 ONNX (`MatMulInteger`) **fails to
forward-pass** ("Backend" error) and its `logits` port is U8 not F32; ari's own `--quantize int8`
**doesn't compress** (488 MB ≈ fp32, so the "working" run was effectively fp32). Decode is **~20× off
the memory-bandwidth limit → compute-bound on scalar CPU**, so int8 (a *bandwidth* lever) wouldn't help
CPU throughput even if it worked.

### What is O(1) — precisely (witnessed in `hologram-exec/tests/content_addressed_o1.rs`, 3/3)

| Property | O(1)? | Mechanism |
|---|---|---|
| Load | ✅ | κ-precompiled deserialize-only (ADR-0101) |
| **Identical request** | ✅ | `graph_memo` → 0 kernels dispatched (measured) |
| **Shared sub-computation / prefix** | ✅ | content-addressed elision → computed once (measured) |
| Per token *in sequence length* | ✅ | KV-elision (κ-addressed prefix K/V), flat per-token cost |
| **Novel-token forward pass over weights** | ❌ | O(active params) by information theory — content-addressing replays/elides repeated work; it cannot fabricate a computation never done |

**The load-bearing conclusion:** κ-O(1) is a **serving / caching multiplier — not single-stream token
speed.** Where it wins: exact-repeat replay, shared-prefix reuse across requests (a content-addressed
prefix cache, the substrate-native analogue of vLLM prefix caching), and O(1) load. With many requests
sharing context, shared work is computed once and served O(1) to all — real *aggregate* throughput.
**Single-stream 100 tok/s is a different problem**, gated entirely on the per-token forward pass.

### The path to single-stream 100 tok/s in-browser (small model), by leverage

| # | Lever | Gain | Status |
|---|---|---|---|
| A | **Resident-GPU WebGPU decode engine** (weights+activations stay on GPU; matmul **and** attention/RMSNorm/sampling in WGSL; async/wasm) | **10–50×** | substrate has a `matmul_f32` **prototype** with per-op CPU fallback + `pollster::block_on` (native-only) — **not** a resident pipeline. The dominant build. |
| B | **int4/int8 GPU kernels** (+ fix the int8 logits-dequant; implement int4) | 2–8× (decode is bandwidth-bound on GPU) | no int GPU kernels; int8 forward-pass broken; int4 unimplemented |
| C | **κ-KV-cache on GPU** + the cross-request prefix cache | sustains flat tok/s + aggregate serving win | works on CPU (witnessed); must carry to GPU |

The math says the target is real for a 135M–360M model (int4 ≈ 67 MB/token; a browser GPU at ~200 GB/s
→ a ~3000 tok/s bandwidth ceiling → 100–300 tok/s realistic) **once A+B+C land**. 1B+ in-browser at
100 tok/s is much harder. **κ-precompilation + the content-addressed KV-cache are the right, necessary
foundation; throughput is A+B, made sustainable + cache-multiplied by C.** "Inference served at O(1)"
is true for load/repeat/shared-prefix — not for novel tokens; that compute must be made *fast* (GPU +
quant), leveraged by the O(1) elision, not eliminated by it.

### Decision

Single-stream throughput is **gated on a deliberate, scoped resident-GPU WebGPU decode engine** (a
multi-week build), not a wire-up of the matmul-f32 prototype. The highest-ROI near-term κ-work is the
**content-addressed serving cache** (exact-repeat + shared-prefix), where the substrate's O(1) is
genuinely differentiated and browser-reachable today — the foundation is witnessed
(`content_addressed_o1.rs`).

### 12. Empirical GPU result + the resident-GPU engine roadmap (the path to 100 tok/s)

Measured on this box's GPU — an **AMD Radeon 8050S** integrated RDNA 3.5 iGPU (shares system
LPDDR5x, ~100–130 GB/s) — via `hologram-exec/tests/gpu_matmul_bench.rs` (`--features wgpu`):

```
MatMul [256×576]·[576×4608] = 1.36 GFLOP/op
  CPU : 1334 ms/op   (1.0 GFLOP/s)
  GPU :   46 ms/op   (29.4 GFLOP/s)   →  28.9× over CPU
```

The 46 ms is **upload + sync overhead** — the substrate's `WgpuBackend` re-uploads operands per
dispatch (a per-op prototype). The matmul *compute* is ~0.09 ms (1.36 GFLOP ÷ ~15 TFLOP/s the iGPU can
do), so **compute headroom is ~500×, not 29×.** Bandwidth ceiling for SmolLM2-135M (memory-bound
decode): ~220 tok/s fp32, ~890 int8, ~1800 int4. **100 tok/s is comfortably reachable on this iGPU.**

**Two hard conclusions:** (a) the GPU gets us there; (b) you **cannot** get it by wiring the prototype —
~210 matmuls/token × per-op CPU round-trip would make the *full* model slower than CPU. The win needs a
**resident-GPU decode engine**. Staged:

| Stage | What | Captures |
|---|---|---|
| **G1** | **Resident weights** — upload all model weights to GPU **once** at load (κ-block → GPU buffer); keep resident across tokens | removes the per-op upload (the 46 ms → 0.09 ms killer) |
| **G2** | **On-GPU kernel chaining** — the executor dispatches the decode step's kernels back-to-back; activations stay in GPU buffers; **one** CPU↔GPU sync per token (final logits) | captures the ~500× compute headroom |
| **G3** | **Full-op WGSL coverage** — attention (+ the κ-KV-cache on GPU), RMSNorm, SwiGLU, RoPE, sampling — no CPU fallback on the hot path | removes per-op stalls |
| **G4** | **Quantized GPU kernels** — int8/int4 matmul in WGSL (+ fix the int8 logits-dequant) | the 2–8× bandwidth multiplier → 100s tok/s |
| **G5** | **async/wasm WebGPU** — replace `pollster::block_on` with async; wasm bindings drive WebGPU; the SW κ-store streams weight blocks to GPU (Stage-3 transport) | **the browser** |

G1+G2 alone likely clear 100 tok/s for a 135M model at fp32 on this iGPU; G4 widens the margin and
enables larger models; G5 ports it to the browser. This is the deliberate multi-week build that the
throughput aim actually requires — and the 28.9× measurement (overhead-bound) is the empirical proof
the ceiling is there. **`hologram-exec` is the right home** (the engine is a new `Backend`/session mode,
not an ari concern); ADR-0101's κ-precompilation + streaming + the content-addressed KV-cache remain the
foundation it sits on.

### 13. The resident-GPU decode engine (the path to 100 tok/s)

G1–G3 empirically proved the throughput regime is **architecture-bound, not kernel-bound** (per-op
readback collapse 1.01×, tiled vs naive matmul 1.02× — see commits on `holo-onnx-forge-stage2`). The
fix is a new execution model, not kernel tweaks: a **GPU-resident, one-submission-per-token decode
engine** (weights resident for the session as int4 κ-blocks · the whole forward pass in one command
buffer · all ops on GPU · KV-cache resident · one sync per token). Full design + staged plan (GE-1…GE-6,
each a measurable gate) + the honest discrete-vs-integrated-GPU ceiling:
**[`holo-gpu-decode-engine.md`](holo-gpu-decode-engine.md)**. GE-1/GE-2 (resident load + one-submission
decode step) is the go/no-go architecture proof; validate on a discrete GPU.
