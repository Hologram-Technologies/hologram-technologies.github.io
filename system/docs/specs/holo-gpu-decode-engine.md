# Holo GPU Decode Engine — design (ADR-0101 throughput half)

The path to single-stream **100 tok/s in-browser**. Companion to [ADR-0101](../adr/0101-holo-onnx-forge.md)
and [`holo-onnx-forge.md`](holo-onnx-forge.md) §11–12. This is the design the empirical
work converged on — every choice here is forced by a measurement, not a preference.

> **Status: GE-1/GE-2 LANDED — the go/no-go architecture proof PASSES (substrate commit `fd514ef`).**
> `GpuChainSession` (weights uploaded once at load, resident; the whole chain in one command buffer with
> resident activations; one readback per step) measures **~8× faster than the per-op path on the iGPU**
> (7.4 ms/step vs 60 ms/step), output verified to match. This **corrects the earlier G2 null (1.01×)**:
> that benchmark's `matmul_chain` re-uploaded all weights every call, masking the win — with weights AND
> activations resident, the per-op CPU round-trip per kernel (the cost the design indicts) is eliminated
> and the architecture wins ~8× *even on this integrated GPU*. The engine is validated; GE-3 (full-op
> decode) and GE-4 (quant) are the path to 100 tok/s, with far more headroom on a discrete GPU.
>
> **GE-3a LANDED (substrate commit `ec6b6df`):** `GpuFfnBlock` runs a real transformer **FFN block** —
> `out = x + SwiGLU(RMSNorm(x))`, five distinct op types (rmsnorm/matmul/silu/elementwise-mul/residual-add)
> — in **one** command buffer over GPU-resident weights *and* activations, matching a scalar CPU FFN oracle
> **exactly** (max_err 0.0). New WGSL `rmsnorm_f32`/`silu_f32`. This proves the resident, one-submission
> architecture generalizes past pure matmul to the mixed-op regime a decode step needs. Remaining GE-3: the
> **attention block** (RoPE + resident KV-cache + softmax + sampling), then assemble blocks into a whole step.
>
> **GE-3b LANDED (substrate commit `d7632d5`):** `GpuAttnBlock` runs a real multi-head self-attention
> **decode step** — RMSNorm → Q/K/V → RoPE → **KV-cache append** → causal online-softmax attention →
> out-proj → residual — in **one** command buffer/step, with the **KV-cache resident on the GPU and
> appended in place across steps** (a GPU→GPU copy, never a CPU round-trip; the substrate's
> content-addressed elision as mutable GPU buffers). New WGSL `rope_f32` (Llama rotate-half) and
> `attn_f32` (flash-style online softmax — O(head_dim) registers, scores never materialized) on a
> dedicated 5-binding layout. Matches a CPU oracle **exactly across 4 decode steps** (max_err 0.0),
> proving the cache carries correct state forward. With GE-3a this is a **whole transformer layer**
> running GPU-resident. Remaining: assemble attention+FFN into a full N-layer step over the real
> `.holo` schedule + on-GPU sampling (GE-3c), then GE-4 quant.
>
> **GE-3c LANDED — GE-3 COMPLETE (substrate commit `c50ac5a`).** `GpuDecoder` assembles the blocks
> into a whole **N-layer decode step** — embed lookup → `N×[attention, FFN]` → final RMSNorm → LM head
> → **on-GPU argmax** — encoded into **one** command buffer per token, with every weight and every
> per-layer KV-cache resident on the GPU and only the 4-byte sampled token id read back. The caches
> persist across calls, so generation is a loop of `decode_token` with **no per-op CPU boundary on the
> hot path**. New WGSL `argmax_f32` (winning index bit-cast into 4 bytes, so the vocab never reads
> back). Validated by a **real fed-back generation loop** (each sampled token fed back in) on a 2-layer
> model producing **identical token ids to a scalar CPU decoder, every step** — the whole engine, end
> to end, correct on the iGPU. What's left for 100 tok/s is purely throughput: GE-4 (int4/int8
> dequant-matmul, the bandwidth multiplier) and GE-5 (browser: async WebGPU + SW κ-store streaming).
>
> **GE-4 LANDED (substrate commit `2b8bbb3`).** Fused **dequant-matmul** kernels: `matmul_q8` (symmetric
> per-column int8, 4 packed per u32) and `matmul_q4` (symmetric group-wise int4, 8 per u32), each
> unpacking + sign-extending via `bitcast` and dequantizing **in-kernel** — so a weight is read at 1/4
> (int8) or **1/8 (int4)** the bandwidth of fp32, the lever in the memory-bound GEMV regime. Plus the
> loader-side quantizers (`quantize_q8_per_col`/`quantize_q4_grouped`) and the resident `GpuQuantMatmul`
> primitive. Both kernels reproduce the CPU dequant-matmul **exactly** (max_err 0.0), with quantization
> fidelity int8 **0.20%** / int4 **2.99%** vs true fp32 — faithful at 8× smaller. (The wall-clock win
> shows at scale on a discrete GPU; at this iGPU GEMV size launch overhead dominates, same lesson as
> G2/G3 — the byte ratio is the structural proof.) Folding quantized weights into `GpuDecoder`'s matmuls
> is the integration follow-on; then GE-5 (browser).
>
> **GE-4 int4-decoder integration LANDED (substrate commit `8ddb156`).** `GpuDecoder` now runs **every
> matmul weight in int4** — the four attention projections, the three FFN matmuls, and the LM head —
> through `matmul_q4`, read at 1/8 the bandwidth of fp32; RMSNorm scales and the embedding table stay
> fp32 (tiny, not matmuls). `GpuDecoder::new` int4-quantizes each weight at load into a packed/scales
> pair, `DecoderDims` gains `group`, and `decode_token` binds the quant kernels on the 5-binding layout.
> The int4 generation loop **matches a CPU int4 oracle exactly, every step** (the ids shift from the fp32
> run — int4 changes the model's outputs slightly; GPU==CPU is the gate). **The whole transformer now runs
> GPU-resident AND int4 — the throughput configuration the 100 tok/s target needs**, correct against the
> CPU oracle. Only GE-5 (browser: async WebGPU + SW κ-store streaming) remains.
>
> **GE-5 core LANDED (substrate commit `93e097c`).** The browser cannot block (`pollster::block_on` and
> `Maintain::Wait` don't work in a tab), so the decode path is now **async**: `GpuDecoder::new_async` /
> `decode_token_async` are the real entry points, with a dependency-free async buffer readback (`map_read`
> — a hand-rolled oneshot future the `map_async` callback wakes; native polls `Wait` and resolves
> immediately, wasm polls `Poll` and the browser's GPU promise drives it — **no blocking**). The blocking
> `new`/`decode_token` are thin `block_on` wrappers cfg-gated to non-wasm, so the wasm build never
> references a blocking call. **Verified: the whole engine compiles to `wasm32-unknown-unknown`** (pulling
> wgpu's WebGPU backend + `wasm-bindgen-futures`); clippy clean native *and* wasm; native suite still 9/9.
> The engine is browser-capable. **Remaining GE-5 glue (needs a browser to verify):** a `wasm-bindgen`
> wrapper exposing `decode_token_async` to JS, and the SW κ-store streaming weight κ-blocks to the GPU via
> the Stage-3 Range transport (`/.holo/blake3/<κ>` → HTTP `Range` → 206 → upload to the resident weight
> buffers), so a `.holo` model demand-pages onto the GPU in the tab.
>
> **GE-5 glue + measurement (substrate commits `2c021f2`/`4b63d29`).** The wasm-bindgen wrapper
> `hologram-decode-wasm` (`WasmDecoder.create(dims, blob, offsets)` / `decode(token, pos) → Promise<number>`)
> **wasm-pack-builds** to a 117 KB `.wasm` + JS/TS bindings, and the JS streaming glue
> [`holo-onnx-decode.mjs`](holo-onnx-decode.mjs) builds the `blob`/`offsets` by streaming each weight
> κ-block from the SW κ-store and drives the generation loop. **Honest single-stream throughput, measured
> on this box's AMD Radeon 8050S iGPU: ~34 tok/s** (73M-param int4 model, 16 layers, h=576, release build,
> one submission/token, ~29 ms/token). That is **not** the discrete-GPU target — this machine has no
> discrete GPU, so the **100 tok/s figure cannot be measured here**; it remains the bandwidth-headroom
> projection of §7 (a discrete GPU has ~3–30× this box's memory bandwidth + occupancy). The remaining
> verification — running the wasm module in a real WebGPU tab and measuring in-browser tok/s — needs a
> browser this environment can't drive. The per-token cost is dominated by CPU-side dispatch encoding
> (~208 dispatches/token), the natural next optimization (cache bind groups / fuse dispatches).
>
> **GE-6 LANDED (substrate commit `1c18837`).** The first half of that optimization: the ~210 decode
> bind groups were rebuilt every token, yet each references only resident buffers whose handles are
> token-stable — so `GpuDecoder` now builds them **once** (lazily, on the first decode) and replays the
> schedule. Correctness unchanged (bit-exact vs the CPU int4 oracle); **~34 → ~37 tok/s** on the iGPU.
> A clean but modest win — the dominant remaining cost is the raw **dispatch count** (~210/token of
> driver overhead), whose reduction needs **kernel fusion** (rmsnorm+matmul, fused attention), a larger
> effort that also matters less on a discrete GPU where GPU compute is a larger fraction of per-token time.
>
> **GE-6 fusion LANDED — and it corrects the diagnosis (substrate commit `0123408`).** Fused SwiGLU
> (`swiglu_f32`, silu+mul→1) and the two residual adds into the projections (`matmul_q4_res`, a 6-binding
> int4 matmul that adds a residual operand — the device storage-buffer limit was raised from downlevel's
> 4 to the WebGPU baseline 8). 16→13 dispatches/layer, 3 fewer buffers, correctness unchanged. **But it
> was ~neutral on the iGPU (~37 tok/s).** Bind-group caching gave +8%, fusion +0% → at release speed this
> iGPU is **not encode/dispatch-bound; it is GPU-execution-bound.** The decode matmuls are **M=1 GEMV** run
> by a 16×16 GEMM kernel (~15/16 of threads idle on a single-row output), and the one-sync-per-token is
> irreducible (decode is sequential) — both **bandwidth/occupancy limits a discrete GPU relieves and an
> iGPU cannot.** The fusion is still the right architecture (real engines fuse these; the saved fixed
> overhead matters *more* on a fast GPU), but the next real throughput lever is a **dedicated GEMV kernel**,
> and it pays off on the **discrete target**, not on this box. This is the honest ceiling of iGPU tuning.
>
> **GEMV LANDED + the floor located (substrate commit `faea747`).** Added M=1-specialized `gemv_q4`/
> `gemv_q4_res` (1D, one thread per output column — no idle threads, coalesced int4 reads) replacing the
> 2D GEMM in the decoder. Correctness unchanged; **also ~neutral on the iGPU.** A **depth sweep** (4 vs 16
> layers) finally locates the floor: time is **~linear in layers (~2 ms/layer) with ~zero fixed per-token**
> — so it is **neither** the one-sync-per-token round-trip (fixed ≈ 0, refuting the prior hypothesis)
> **nor** the int4 GEMV compute (~µs/layer at this size). It is **per-layer driver/dispatch overhead**.
> That is precisely why kernel speed (GEMV) and dispatch count (fusion) were ~neutral: on this iGPU the
> **per-dispatch cost is the binding constraint, not kernel work.** A discrete GPU's per-dispatch overhead
> is far lower — which is where GEMV, fusion, and the 100 tok/s target pay off. **This is the honest floor
> of iGPU tuning; the engine is correct and complete, and further throughput gains require the target GPU.**
>
> **IN-BROWSER WebGPU VALIDATED — the deployment target runs (2026-06-16).** The `wasm-pack` engine + the
> JS streaming glue were loaded in a real WebGPU browser (Chrome 148 / Dawn; the adapter reports
> "amd rdna-3" — this box's 8050S iGPU). `WasmDecoder.create(dims, blob, offsets)` built the model on the
> GPU and `decode(token, pos)` generated through a real loop. **Measured in-browser, same iGPU:** h=576/ff=1536
> 16-layer → **28.5 tok/s** (~2.18 ms/layer, ~0.2 ms fixed); a smaller h=384 model → **52.8 tok/s**. That is
> within noise of the **native ~32 tok/s** — the browser's WebGPU (Dawn) imposes **no meaningful penalty**,
> and shows the **same per-layer/per-dispatch-overhead profile** as native (fixed ≈ 0 in-browser too). So
> for a 100%-browser deployment the engine works *today* at iGPU-class speeds, and the discrete-GPU headroom
> (§7) applies equally to the browser path. The remaining 100 tok/s claim is purely a faster-GPU question.

## 1. What the measurements proved (the design is downstream of these)

On an AMD Radeon 8050S iGPU, against the substrate's per-op `WgpuBackend`:

| Probe | Result | What it forces |
|---|---|---|
| CPU scalar matmul | ~1 GFLOP/s, 2.34 tok/s (SmolLM2-135M) | CPU is a dead end |
| GPU vs CPU matmul | **28–45×** | the GPU is the lever |
| G1 resident weights | correct, modest | upload-once is necessary, not sufficient |
| G2 readback collapse (N→1) | **1.01×** | the synchronous readback is **not** the bottleneck |
| G3 tiled vs naive matmul | **1.02×** | shared-memory reuse is **not** the bottleneck (iGPU LDS ≈ cache) |

**Conclusion: the regime is architecture-bound, not kernel-bound.** The per-op `Backend::dispatch(call,
ws)` model with a CPU-byte `Workspace` forces, *per kernel*: a host read, an operand upload, a dispatch,
and a synchronous readback — and that overhead, multiplied over ~200 ops/token, dominates. No kernel
tweak fixes an architecture cost. **The engine must change the execution model, not the kernels.**

A second hard truth: single-token decode is **GEMV** (`[1,H]·[H,N]`) — memory-bandwidth-bound, low GPU
occupancy. So the engine is bandwidth-engineered (quantized weights, coalesced reads), and on an
*integrated* GPU (system-RAM bandwidth, no dedicated VRAM) 100 tok/s is marginal; **the target hardware
is a discrete GPU**, with the iGPU as a correctness/dev target.

## 2. The core idea

Replace the per-op dispatch with a **GPU-resident, whole-decode-step executor**:

1. **Weights resident for the session** — uploaded to the GPU **once** at model load (not per call), as
   κ-keyed device buffers, **quantized** (int4/int8). Generalizes ADR-0101 G1 from a per-backend cache
   to session-load residency, fed by the Stage-2 `WeightIndex` (stream κ-blocks → GPU).
2. **One submission per token** — the entire forward pass (all kernels) is encoded into **one** command
   buffer; activations live in GPU buffers and never round-trip to the CPU; **one** readback per token
   (the final logits). This is the fix for the G2 finding: not "fewer readbacks of a per-op walk" but
   "no per-op CPU boundary at all".
3. **All decode ops on GPU** — matmul (dequant-fused), attention (KV-cache resident on GPU), RMSNorm,
   SwiGLU, RoPE, softmax, sampling. **No CPU fallback on the hot path** — a single fallback reintroduces
   a readback and a CPU round-trip, which the measurements show is the whole cost.
4. **The κ-substrate carries through** — weights are κ-addressed blocks (Stage 2); the KV-cache is the
   substrate's content-addressed elision realized as GPU buffers; one re-derivable `holoq:ForgeReceipt`
   per session (PROV-O out-of-band, ADR-0082).

This is a **new execution path**, not a `Backend` impl — the per-op `Backend`/`Workspace` interface is
the thing being bypassed. That is a deliberate architectural divergence (see §6) and the load-bearing
decision of this design.

## 3. Components

```
GpuModel (load-time, immutable)
  ├─ device/queue (WebGPU; async in browser, blocking native)
  ├─ weights:  HashMap<κ, GpuTensor{ buffer, dtype, shape, quant }>   ← resident, quantized, uploaded once
  ├─ schedule: Vec<GpuOp>   ← the graph lowered to a GPU kernel plan (matmul/attn/norm/… + buffer bindings)
  └─ kernels:  the WGSL pipeline set (§4)

GpuSession (per-inference, mutable)
  ├─ act_arena:  ring/ping-pong GPU buffers for activations (never read back mid-step)
  ├─ kv_cache:   per-layer K/V GPU buffers, content-addressed (append per token)  ← the substrate's
  │              KV-elision, GPU-resident
  ├─ io:         input-id upload (tiny), logits readback (one per token)
  └─ decode_step(token_ids) -> logits:
        encode the whole forward pass into ONE command buffer (embed → N×[norm,attn,norm,mlp] → final
        norm → lm_head), submit, read back logits only.  ← one GPU↔CPU sync per token
```

`GpuModel` is built from the **same compiled `.holo`** the CPU path uses — the importer/lowering/Stage-2
WeightIndex are unchanged. The engine reinterprets the archive's schedule as a GPU kernel plan.

## 4. Kernel library (WGSL)

The decode-critical set, all reading/writing resident GPU buffers (binding-driven, no per-op upload):

- **dequant-matmul (GEMV/GEMM)** — int4/int8 weight dequantized **in-kernel** fused into the matmul, so a
  weight is read at its quantized size (int4 = 8× less bandwidth than fp32). This is the throughput
  kernel; the fp32 tiled matmul (G3) is the correctness reference.
- **fused attention** — flash-attention-style: Q·Kᵀ → softmax → ·V in one pass over the KV-cache GPU
  buffers, never materializing the full score matrix; causal mask; RoPE applied to Q/K.
- **RMSNorm**, **SwiGLU**, **RoPE**, **softmax**, **elementwise** (add/mul/residual).
- **sampling** — argmax / top-k / temperature on GPU, so only the chosen token id (4 bytes) reads back,
  not the whole vocab logits, when greedy. (Logits read back only when the host needs them.)

Each kernel is validated against the CPU backend (the existing `compile_and_execute` conformance path),
exactly as G1/G3 were (bit-identical where deterministic; relative tol for fp reduction order).

## 5. Staged plan (each stage one measurable gate)

| Stage | Deliverable | Gate (measured) |
|---|---|---|
| **GE-1** ✅ | `GpuChainSession::new`: upload all weights once (fp32), resident for the session | weights never re-uploaded — **landed** |
| **GE-2** ✅ | `GpuChainSession::decode_step`: whole chain in one command buffer, activations resident, **one** readback/step | **~8× vs the per-op path on the iGPU** (7.4 vs 60 ms/step), output verified — **landed** (synthetic matmul-chain model; GE-3 generalizes to a real decode step) |
| **GE-3a** ✅ | `GpuFfnBlock`: a real FFN block `x + SwiGLU(RMSNorm(x))` — 5 op types (rmsnorm/matmul/silu/mul/add) in **one** submission over resident weights+activations | **exact match** vs a CPU FFN oracle (max_err 0.0 @ peak 0.70), ~2 ms/block iGPU — **landed** (new `rmsnorm_f32`/`silu_f32` WGSL) |
| **GE-3b** ✅ | `GpuAttnBlock`: a multi-head self-attention **decode step** — RMSNorm → QKV → RoPE → **resident KV-cache append** → online-softmax causal attention → out-proj → residual, one submission/step, cache mutated on-GPU across steps | **exact match** vs a CPU oracle across 4 decode steps (max_err 0.0) — **landed** (new `rope_f32`/`attn_f32` WGSL + 5-binding attn layout). With GE-3a = a whole transformer layer GPU-resident |
| **GE-3c** ✅ | `GpuDecoder`: a whole N-layer decode step — embed → `N×[attn, FFN]` → final norm → LM head → **on-GPU argmax** — one submission/token, all weights + per-layer KV-caches resident, only the 4-byte token id reads back | a real fed-back **generation loop matches a CPU decoder exactly**, step for step — **landed** (new `argmax_f32`). The whole engine, end to end, on the iGPU |
| **GE-4** ✅ | int8 + int4 fused **dequant-matmul** kernels (`matmul_q8`/`matmul_q4`) + loader quantizers + resident `GpuQuantMatmul` | both reproduce the CPU dequant-matmul **exactly** (max_err 0.0); fidelity vs fp32 int8 0.20% / int4 2.99%; **int4 = 8× less weight bandwidth** — **landed** |
| **GE-4·int4 decoder** ✅ | `GpuDecoder` runs **every matmul weight int4** (4 attn proj + 3 FFN + LM head; norms/embed fp32) via `matmul_q4` | int4 generation loop **matches a CPU int4 oracle exactly**, step for step — **landed** (the real throughput config) |
| **GE-5 core** ✅ | **async, browser-safe** decode path (`new_async`/`decode_token_async` + dependency-free async readback; blocking wrappers cfg-gated to native) | engine **compiles to `wasm32-unknown-unknown`** (wgpu WebGPU backend + wasm-bindgen-futures); clippy clean native+wasm; native suite 9/9 — **landed** |
| **GE-5 glue** ✅ | wasm-bindgen wrapper (`hologram-decode-wasm`) + JS streaming (`holo-onnx-decode.mjs`) | **ran end-to-end in a real WebGPU browser** (Chrome 148 / Dawn, adapter "amd rdna-3") — the wasm engine builds the model on the GPU and generates |
| **GE-5 measure** ✅ | single-stream tok/s, native **and in-browser** | **in-browser WebGPU ≈ native** on this iGPU: ~28.5 tok/s (h=576) / ~53 tok/s (h=384), vs native ~32 tok/s — the browser imposes **no meaningful penalty**. 100 tok/s remains a discrete-GPU claim (no discrete GPU on this box) |
| **GE-6 (cache)** ✅ | cache the ~210 decode bind groups (token-stable handles), built once not per token | **~34 → ~37 tok/s** on the iGPU, correctness unchanged — **landed** |
| **GE-6 (fusion)** ✅ | fuse SwiGLU (silu+mul→1) + the two residual adds into the matmuls (`matmul_q4_res`), 16→13 dispatch/layer | correctness unchanged; **~neutral on this iGPU** |
| **GE-6 (GEMV)** ✅ | M=1-specialized `gemv_q4`/`gemv_q4_res` (1D, no idle threads, coalesced) replace the 2D GEMM for decode | correctness unchanged; **~neutral on this iGPU** — a depth sweep (4 vs 16 layers) shows **~2 ms/layer, ~0 fixed**: NOT sync-bound, NOT compute-bound (~µs/layer), it's **per-dispatch driver overhead**. GEMV/fusion pay off on a **discrete** GPU (lower per-dispatch cost) |
| **GE-6** | (if needed) occupancy — batch tokens / speculative decode for small-model GEMV occupancy | tok/s at batch>1 |

GE-1→GE-2 is the make-or-break: it proves the resident, one-sync-per-token architecture beats the per-op
model (the thing the prototype's interface structurally cannot do). GE-4 is the multiplier to 100 tok/s.
GE-5 lands it in the browser. **Validate GE-2+ on a discrete GPU**; the iGPU is the correctness target.

## 6. The architectural decision (and the honest tension)

The engine **bypasses** the substrate's per-op `Backend`/`Workspace` abstraction — those exist so kernels
are backend-agnostic over a byte workspace, which is exactly the per-op CPU-boundary the measurements
indict. So the engine is a **parallel GPU execution path** that consumes the compiled `.holo` directly
and owns its own GPU-resident state. Honest consequences:

- Two execution paths to keep correct (CPU per-op via `Backend`; GPU-resident via `GpuSession`). The CPU
  path stays the reference oracle for every kernel.
- It is **upstream** work in `hologram-exec` (`GpuSession`) + `hologram-backend` (the WGSL set). ari
  selects it via backend choice; OS2 supplies the browser SW κ-store streaming (ADR-0026).
- The κ-substrate properties are preserved by construction: weights are κ-blocks (re-derivable, L5),
  the KV-cache is content-addressed, the session seals a re-derivable receipt. **The engine is a
  *placement* of κ-addressed tensors on the GPU, not a parallel store** (Law L4 honored).

## 7. Honest ceiling

- **Bandwidth math (discrete GPU, ~300–800 GB/s, int4 135M ≈ 67 MB/token):** 4000–12000 tok/s ceiling →
  100 tok/s is comfortable with headroom for larger models.
- **This iGPU (~100–130 GB/s, shared):** int4 ceiling ~1800 tok/s, but GEMV occupancy + overhead make
  100 tok/s *marginal* in practice — GE-6 (batching) may be required, and it's honestly the wrong
  hardware for the target. Correctness and the architecture win are provable here; the *number* should
  be claimed on a discrete GPU.
- **Decode is inherently sequential** (token N needs N−1): the per-token sync cannot be hidden, only
  minimized to one-per-token (vs the prototype's per-op). That one sync's latency is the hard floor.
- This is **memory + throughput** engineering; it does not change model quality. It also does not make
  novel-token inference O(1) (information theory) — the κ-O(1) serving cache (witnessed,
  `content_addressed_o1.rs`) remains the orthogonal win for *repeated/shared* work.

## 8. Definition of done

A small model (135M–360M) decoding **coherent text at ≥100 tok/s single-stream in a browser tab on a
discrete-GPU machine**, via a GPU-resident `GpuSession` (weights uploaded once as int4 κ-blocks, the whole
decode step in one submission per token, all ops on GPU, KV-cache resident), with every kernel witnessed
against the CPU reference and the session sealing a re-derivable receipt. On the iGPU: the same engine,
proven correct, with the honestly-stated lower number.

## 9. Effort

Multi-week, GPU-engineering-heavy. GE-1/GE-2 (the architecture proof) is the first real milestone and the
go/no-go: if a resident one-submission decode step doesn't beat the per-op path by a wide margin on a
discrete GPU, the design is wrong and we stop. Everything after (GE-3 op coverage, GE-4 quant, GE-5
browser) is additive and individually measurable. The eight committed ADR-0101 substrate commits
(κ-store, per-tensor κ, WeightIndex/streaming, G1 resident weights, the WGSL kernels, the benches) are
the foundation this sits on.
