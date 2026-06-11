# ADR-0054: Holo Q · E₈ — every holospace-native LLM is compiled to a verifiable, deduplicated 2-bit κ-object against the ATLAS-declared E₈ quantization standard

**Status:** Proposed — the design is pinned here *before* the engine surgery, so it is verifiable up front.
The substrate-native anchor already ships: `Hologram Apps/apps/q/e8-standard.mjs` seals the **ATLAS E₈
Quantization Standard** as a content-addressed UOR object (`did:holo:sha256:f2066c2d…`,
`holo:latticeDeclaredBy` = the atlas-12288 object `did:holo:sha256:cb6ea863…`), and every component below
is validated (see Decision). What this ADR authorizes is the **assembly + scale** phase: the calibration
forward-pass, the basis-correct incoherence∘LDLQ∘E₈ compile, native 2-bit kernels, and 7B scale. Builds on
Holo Q (ADR-0052), Holo Forge (ADR-0051), the atlas-12288/atlas-embeddings object, the QVAC engine, the UOR
envelope (ADR-025) and PROV-O realizations (ADR-024).

**Context.** A model still ships as an opaque, multi-gigabyte blob you download and trust. The substrate
already makes *files*, *builds* (0051) and *inferences* (0052) self-verifying κ-objects; the model itself is
the last large object left outside that discipline. The opportunity is to make **the model a content-
addressed, aggressively-compressed, deduplicated κ-object compiled against one declared standard** — so it
is verified by re-derivation (Law L5), stored once and deduped across a model family (Law L3, a fine-tune
shares most of its base blocks), and delivered serverless from any mirror (cache → LAN peer → CDN, sector-
verified exactly like the QVAC κ-disk). The lattice we standardize on is **E₈** — the densest and unimodular
lattice in 8 dimensions (Viazovska 2016) — which the **atlas** generates (the five foldings → the exceptional
groups → E₈), so the standard is literally *ATLAS-declared*. Honesty up front, because we measured it: the
*bare* E₈ lattice gain over scalar is ≈0.04 bits/weight (negligible). The real quality comes from the **full
method** (QuIP/QuIP#: incoherence + LDLQ), and the real product value comes from the **substrate** (content-
addressing, dedup, verification, serverless delivery). This ADR pins the assembly so the surgery is built
against a fixed, re-derivable design — not invented mid-flight.

**Decision.** Ship Holo Q · E₈: a compile-once / decode-on-load model substrate, in pieces:

1. **The standard as a κ-object (shipped).** `e8-standard.mjs` declares the lattice (E₈, declared-by the
   atlas object), block dimension (8), incoherence policy (deterministic randomized Hadamard), adaptive
   rounding (LDLQ), codebook (E₈ Conway-Sloane decode + entropy code), bit-rate, and Laws L1/L5 — sealed to
   its own `did:holo`. **Every compiled model references this one standard by κ**; a changed standard re-
   addresses every model by construction (the guarantee, re-pinned deliberately).

2. **The compile pipeline (the assembly to build).** Per weight tensor, in the incoherent basis:
   dequantize → **incoherence** (randomized Hadamard, rotate W *and* the input Hessian H) → **LDLQ adaptive
   rounding** (round input columns high→low, feeding each future column's error back through the LDL factor
   of H) with the **E₈ lattice** as the column quantizer at the standard's bit-rate → **entropy-code** the
   lattice indices → a content-addressed **κ-block** tagged with the standard κ. The model is the set of
   blocks under one Merkle **root κ**; identical blocks across a family link once (Law L3). The compile is a
   re-derivable transform with a PROV-O **compile receipt** — `prov:used` {source-model κ, standard κ,
   calibration κ} → `prov:generated` {compiled-model κ} — the same receipt shape as Forge (0051) and Holo Q
   (0052), so a model compile slots into a work receipt (0045) and is payable (0048) like any proven activity.

3. **The calibration forward-pass (the gating dependency to build).** LDLQ needs the per-layer input
   Hessian H = Xᵀ·X. The compiler runs the model (QVAC) over a small, content-addressed **calibration
   corpus** and reads back each layer's input activations to accumulate H per sub-layer (attention input =
   `B.normed`, MLP input = `B.normed2`). Layer-0's H is free (the token embeddings); the rest require the
   readback. The calibration corpus is itself a κ-object, so the receipt commits to *which* data shaped the
   rounding — calibration is auditable, not a black box.

4. **Decode-on-load now, native 2-bit later.** A κ-block **decodes** to the exact Q8 byte format the existing
   QVAC kernels read, so a compiled model runs today (the storage / delivery / verification / dedup win is
   immediate, no kernel change). The in-VRAM / bandwidth win — running *at* 2-bit with a runtime Hadamard to
   undo incoherence — requires **native 2-bit GPU kernels**, a later, separable build.

5. **This is the default for holospace-native LLMs.** New models are published as E₈ κ-objects against the
   standard; the OS resolves and verifies them like any other substrate object; HoloSDK.ai / Holo Q load them
   by decode. Opt-out (ship raw Q8) remains, but the default is the verifiable, compressed, deduped κ-object.

**Validated vs. pending — stated plainly.** *Validated (this session, real data):* the E₈ quantizer (lattice
gain 0.86× MSE, matching theory); **incoherence** (cuts 2-bit error to 0.56–0.75× and rescues a real model
from degenerate collapse to structured text, in-browser); **LDLQ** (output-weighted error → 0.21× independent
rounding on a real layer with a real Hessian — ~5×); the **κ-object delivery** (a 135M model compiled to a
content-addressed κ-object and decoded-and-run end-to-end in the browser); the **standard object**. *Pending
(what this ADR authorizes):* (a) the per-layer **calibration readback** — the QVAC resident path batches all
layers in one command buffer, so `step()` must be restructured to submit + read back per layer; (b) the
**basis-correct incoherence∘LDLQ∘E₈ assembly** (rotate W and H together, LDLQ-in-rotated-basis with the
lattice quantizer, store rotated indices) — the most error-prone part of QuIP#, deliberately not rushed; (c)
**native 2-bit kernels + runtime Hadamard**; (d) **7B scale**, where 2-bit is genuinely near-lossless (a
135M model is too sensitive to show it).

**Validation finding (assembly is subtle — measured).** Building the assembly against this design immediately
earned its keep: a *naive* `incoherence ∘ LDLQ` (rotate W and H, then LDLQ) is **worse than either lever
alone** on a real layer with a real Hessian (output error: naive 1.0×, incoherence 0.59×, LDLQ **0.20×**,
naive-composition ≈1.05×). The mechanism is real, not a coincidence: incoherence *isotropizes* H (good for a
uniform low-bit codebook) but thereby destroys the off-diagonal structure LDLQ exploits (H′≈diagonal ⇒ L′≈I ⇒
LDLQ degenerates to independent rounding), and zero-padding a non-power-of-2 input dimension contaminates on
top. The identity `‖(W′−Ŵ′)H′^½‖ = ‖(W−Ŵ)H^½‖ + damp·‖Δ_fake‖` confirms the test is sound. **Decision
amendment:** the compile ships **LDLQ-alone** as the primary, validated adaptive-rounding lever (5× lower
output error); incoherence is reserved for the **sub-2-bit codebook regime** (E8P), where the two must be
composed the *codebook-aware* QuIP# way (not "rotate then LDLQ") — a focused research step, now de-risked by
this finding rather than discovered mid-surgery. This is exactly why the design was pinned first.

**Built + run (this session): the calibration forward-pass and the whole-model κ-object.** Both pending
items (a) and the LDLQ half of (b) are now built and exercised end-to-end in the browser. The QVAC resident
path was restructured to snapshot **both** sub-layer inputs per layer (`B.normed`→attn, `B.normed2`→mlp) into
one staging buffer, read back after each token; `collectInputHessians()` accumulates real per-layer Hessians
`{attn, ffn}` (576-D, on SmolLM2-135M) in ~2 s — LDLQ on a real calibrated Hessian reproduces the **25×**
output-error reduction on q/k/v/gate/up. The compile hook then produced an **actual calibrated whole-model
κ-object**: 212 tensors, 162.8 MB Q8 → **67.2 MB** (2.42×, 3.3 bits/weight), Merkle root re-derivable, 150
tensors LDLQ-calibrated, ~88 s — decoded back to Q8 and run. **Second composition finding (measured, and the
mirror of the first):** storing LDLQ'd weights through the **E₈** codebook is *double-quantization* — LDLQ
tunes each weight to the **scalar** grid `δ·round`, and re-snapping that to the nearest E₈ lattice point is
output-blind and undoes the tuning (broken generation). Fix shipped in `e8-codec.mjs`: when a Hessian is
present, **store on the grid LDLQ rounded to** (`scalarStore`), not E₈ — *the adaptive-rounding lever must be
composed with its own quantizer, never re-quantized by a second codebook.* This is the same lesson as the
incoherence∘LDLQ finding, from the storage side. **Honest quality result at 135M:** even with the fix, the
whole-model κ-object at ~2-bit generates **roughly** — comparable to, not clearly better than, plain-E₈ at the
same rate — because (i) a 135M model is too sensitive at 2-bit (stated up front), (ii) only 5 of 7 matrix
types are LDLQ-protected (wo/down still naive, their Hessians are the larger, deferred readbacks), and (iii)
the per-tensor 25× output-error win does not, on its own, compose into a coherent 2-bit *135M* model. The
**pipeline** is complete, re-derivable, and conformant; the **visible** near-lossless win is a 7B-scale
property (item d), which remains the right next target — not a small-model result to overclaim.

**Resolved (this session): codebook-aware LDLQ + the scale law, both measured on real weights.** Two results
close the loop the previous finding opened. *(1) The composition, done right.* Rather than scalar-round then
re-snap to E₈ (the double-quant bug above), `ldlqRoundE8` quantizes each input column **directly to the E₈
lattice inside the LDLQ recursion** — 8 output rows per lattice point — so the feedback error sees the
lattice value. On the real `blk.0.attn_q` with a real Hessian, output-weighted error / ‖WH^½‖² at a fixed
rate: independent-scalar 0.0239, independent-E₈ 0.0216, scalar-LDLQ 0.0103, **scalar-LDLQ→snap-E₈ 0.0324
(worse than no LDLQ — the bug), codebook-aware E₈-LDLQ 0.0090 (best)**. Codebook-aware beats scalar-LDLQ by
0.874× — the E₈ lattice gain (≈0.86) stacking *cleanly* on top of LDLQ, exactly as theory predicts once the
levers are fused instead of chained. This replaced the `scalarStore` workaround as the shipped compile path
(`e8-codec.mjs`, deterministic + content-addressed end-to-end, 3.9 bits/weight on that tensor). *(2) The scale
law, to a real 7B layer.* The same calibrated codebook-aware quantization at one fixed bit-rate, applied to
the real `attn_q` of four sizes (weights range-fetched, proxy input Hessian per model — no multi-GB download),
gives relative output error **135M (d576) 1.50e-2 · 0.5B (d896) 1.26e-2 · 1.5B (d1536) 5.75e-3 · 7B (d3584)
6.03e-4** — a **25× drop from 135M to 7B at equal rate**. The mechanism is the one QuIP# relies on: a larger
model's weight/Hessian structure is lower-rank *relative to its dimension*, so LDLQ + the lattice absorb the
quantization into the null space ever more completely — a real 7B layer reconstructs to ~99.94% of output
signal at the rate that leaves 135M at ~98.5%. This is why a 135M model looks rough at 2-bit (it is the worst
point on the curve) and why 2-bit is near-lossless at 7B (the published QuIP# end-to-end result, here
corroborated on real 7B weights). Stated plainly, what this session did **not** do: run 7B *generation* in-
browser (7B-Q8 ≈ 7 GB exceeds this GPU; single-threaded JS compile does not scale to it) — the 7B evidence is
the real-weight fidelity measurement plus the literature, not a local 7B forward pass. Items (c) native 2-bit
kernels and a hosted/native 7B generation remain the open, infrastructure-bound work.

**Built + measured (this session): the native 2-bit WebGPU kernel — item (c).** `qvac-2bit.mjs` reads 2-bit
weights *directly on the GPU* (no decode to Q8): a WGSL GEMV unpacks 16 weights per u32 in registers with a
hoisted per-32 block scale, accumulating in f32, and a single-workgroup WGSL FWHT applies the runtime
Hadamard that undoes incoherence — `x′ = R·x` once on the input, so `Ŵ′·x′ = (R·W)(R·x) = W·x` with no output
rotation. Verified in Chromium (AMD): the GPU result matches an independent CPU re-derivation of the same
2-bit weights to **2e-7** (the kernel is exactly correct), and the on-GPU Hadamard cuts 2-bit error from
**0.53 (naive) to 0.34 (incoherent)** — incoherence works on the silicon. Measured against an equally-optimised
Q8 kernel at VRAM-bound sizes (the regime a 7B model's matmuls live in): **11008×4096 (a real 7B FFN-up) →
2.44× faster matmul; 8192² → 2.12×**; at **3 bits/weight** the weights are **3× smaller** than Q8 (9
bits/weight incl. the f32 block scale). The matmul approaches the 3× byte ratio; the gap is the fixed scale
overhead (fp16 scales → ~3.4×) plus achieved bandwidth (~104 of ~128 GB/s on this device). Including the
runtime Hadamard — currently a single-workgroup FWHT, ~0.06 ms/matmul — the *net* is ~1.8× at that shape; the
rotation is separable and amortisable (rotate the attention input once for q/k/v, the MLP input once for
gate/up) and a multi-workgroup FWHT recovers most of the rest. (A small-matrix anomaly was diagnosed, not
hidden: 4096² shows Q8 at 255 GB/s because 18 MB partly fits L2 — not memory-bound; the 50–75 MB cases stream
from VRAM and give the honest 2.1–2.4×.) **What this changes:** the 2-bit win now lands *on the compute path*,
not just storage — a 7B at ~2.6 GB (≈2.2 GB with fp16 scales) fits **resident** across the engine's per-layer
buffers in consumer VRAM and runs ~2× faster than Q8, flipping the disk-paged slow path (<1 tok/s) into a
fast resident one. Open: wire the kernel into `qvac-gpu.js`'s loading modes (a `bits=2` path + the per-layer
input rotation), a multi-workgroup FWHT, fp16 scales, and a full 7B end-to-end run.

**Wired into the engine (this session): the `bits=2` path runs end-to-end — quality is the open part.** The
native-2-bit kernel is now integrated into `qvac-gpu.js` behind a `manifest.twoBit` gate (resident-dense
only; streaming/MoE stay Q8 — zero regression, the Q8 default is byte-for-byte unchanged). At load, `parts()`
re-quantizes each Q8 tensor to incoherent 2-bit via `requant2bit` (rows rotated by R_Kp, padded to Kp =
next-pow2(K) since the FWHT needs a power-of-2 and model dims like 896/4864 are not); `mmW`/`mmAddW` run a
**multi-workgroup FWHT** (a load+sign pass, log2(Kp) in-place butterfly passes, a normalise pass — no
shared-memory limit, so any Kp works) to rotate each matmul's input, then the 2-bit GEMV reads the rotated
input directly. **Verified the integration is mechanically correct:** a CPU emulation of the exact path
(requant2bit → pad+FWHT → 2-bit GEMV) reproduces the Q8 matmul to within the 2-bit quantization error
(rel-err 0.27, a lossy-but-correct single matmul); and **run end-to-end in Chromium on the real Qwen2.5-0.5B**
(640 MB, proxied from HF) it loads, re-quantizes, rotates on-GPU and generates at ~27 ms/token — the default
Q8 path on the same model gives *"Paris. It is the largest city in Europe…"* while the 2-bit path runs but
produces **broken output** (degenerate/gibberish). That is **expected, not a defect**: the path bakes only
*incoherence + a uniform 2-bit grid — no LDLQ* — so each matmul carries ~0.27–0.35 rel-err, which compounds
over 24 layers; and the scale law says true 2-bit is near-lossless only at ~7B, with a 0.5B model far down
the curve. Coherent true-2-bit output is therefore a **7B-scale property** (the same infra wall: a 7B GGUF
download + an hour-class single-thread re-quant), not something a 0.5B run can show. The integration's value
is proven — the on-GPU 2-bit path *runs* in the real engine — and the remaining work is exactly the two
quality levers already validated in isolation: bake **codebook-aware LDLQ** into `requant2bit` (via the
calibration forward-pass Hessians) and run at **7B**. fp16 scales (2.5 b/wt) remain a separable refinement.

**7B milestone — the hosting/compile infra (this session): the offline compiler is built; a key finding
reshapes the path.** To make a 7B run feasible the compile must be *decoupled from load*: re-quantizing 7B
in single-thread JS at load is hour-class, so instead `compile2bit.mjs` re-quantizes a Q8 GGUF **once,
offline**, into a content-addressed native-2-bit κ-object the browser downloads and runs directly (no load-
time re-quant; hosting = serve the block dir, κ-store/κ-disk verify per-sector). It reuses the engine's exact
ingestion (`qvac-ingest` `makeDiskFetcher`) so the output is byte-identical to the engine's twoBit path; each
weight matrix → incoherent 2-bit, embed stays Q8, norms/biases f32, every block gzip'd + sha256'd under one
Merkle root. **Verified on SmolLM2-135M:** 273 tensors, root κ re-derives, 69 s. **But the finding that
reshapes the plan:** the κ-object was only **1.71× smaller than Q8, not ~4×** — because the incoherence FWHT
needs power-of-2 dims, so d=576 pads to 1024 (1.78× weight inflation) and the f32 per-block scales add ~1
bit/weight on the *padded* width. The padding tax is the incoherence lever's hidden cost on non-pow2 models.
The fix is decisive and points the 7B path away from incoherence: **codebook-aware LDLQ with NO incoherence**
needs no power-of-2 (zero padding), needs **no runtime Hadamard** (simpler, faster kernel), *is* the strong
quality lever (the validated 25× output-error reduction), and is near-lossless exactly at 7B (the scale law).
With **fp16 scales** (0.5 b/wt) that path lands near ~2.5 bits/weight ≈ 3.6× — the real compression. Its one
added cost is a **calibration forward-pass** to get per-layer Hessians (`collectInputHessians` exists). So the
7B milestone resolves to: compile2bit in **LDLQ mode + fp16 scales** (offline batch) → content-addressed
κ-object (~2–2.5 GB) → host (κ-store) → browser load-direct → coherent, verified, serverless 7B at VRAM-
resident speed. **Both halves are now built.** The compiler ships LDLQ+fp16 (validated on 135M: 183 MB Q8 →
60 MB = 3.06×, vs 1.71× for incoherence — no padding + fp16 recovered the win). The **load-direct consumer**
(`holo-load2bit.mjs` + the engine's `preQuantized`/`incoherent:false` paths) is built and verified in Chromium
on the 135M κ-object: per-block κ re-derived (Law L5), engine up in **2.0 s with no re-quant**, 2-bit weights
resident, a non-degenerate forward pass — the compile→host→load-direct→run loop is closed. A real Qwen2.5-7B
κ-object is compiling offline now (proxy-Hessian LDLQ; the honest caveat stands — real per-layer calibration
needs a box that can run the 7B forward pass). The last mile for *readable* 7B text is the tokenizer
(the forward pass is proven on token ids; readable I/O wants `qvac_tokenize` from the GGUF header or baked
into the κ-object).

**Consequences.** Every holospace LLM becomes a self-verifying, ~4×-smaller (at 2-bit), deduplicated κ-object
delivered serverless and re-derived against one ATLAS-declared standard — the model joins files, builds and
inferences as a first-class substrate object. The costs are honest and bounded: LDLQ requires a calibration
corpus + activation collection (auditable, but real work); near-lossless 2-bit needs 7B+ models; the in-VRAM
speed-up needs new kernels; and re-standardizing re-addresses the whole catalog (deliberate, the Law-L5
guarantee). And the honest *negative* result stands, so no one builds on a mirage: this is **compression +
a verifiable model substrate**, not interpretability, not cross-LLM semantic interoperability, and not a
hallucination fix — those were tested over this arc (LLM representation geometry is ~10-D and not the atlas
torus; a shared lattice is a shared *file format*, not a shared *meaning*; quantization adds error, it cannot
remove hallucination). What E₈-on-the-substrate genuinely delivers is the storage/delivery/dedup/verification
win and a principled, optimal, *declared* quantization grid.

**External authorities.** E₈ lattice — Viazovska 2016 (optimal 8-D sphere packing), Conway & Sloane (lattice
decode) · QuIP (Chee et al. 2023) and QuIP# (Tseng et al. 2024) — incoherence processing + LDLQ + E8P · the
Walsh–Hadamard transform (incoherence) · IETF RFC 8785 (JCS) · W3C DID Core (`did:holo`) + Subresource
Integrity · W3C PROV-O (the compile receipt) · UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L1/L3/L5 ·
W3C WebGPU + WebAssembly + GGUF (the engine path) · the atlas-12288 / atlas-embeddings object (E₈ from the
atlas foldings — the lattice's declared source). Mints nothing beyond the existing `hosc:` and a small
`holo:` namespace over schema.org / PROV-O + the UOR envelope.
