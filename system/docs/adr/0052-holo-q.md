# ADR-0052: Holo Q — inference is a verifiable, re-derivable κ-transform: a real model runs in the browser, the weights are a content-addressed κ-disk, and every answer re-derives byte-for-byte with no server

**Status:** Accepted (app shipped; witness + gate row pending). The in-browser holospace ships at
`Hologram Apps/apps/q/` — buildless and vanilla, the QVAC WebGPU engine vendored unmodified (ADR-006
pattern): `pkg/holospaces_web.js`+`_bg.wasm`, `qvac-gpu.js`, `qvac-kdisk.mjs`, `qvac-kstore.mjs`,
`qvac-ingest.mjs`. Its `holospace.lock.json` re-derives (Law L5, 13 files) and carries the mandatory
conscience gate (`_shared/holo-conscience.js`, ADR-033); root
`did:holo:sha256:bc63c97c7e9958246fb004a83e067064bfed061afb2434b4e8d812c406307060`. Listed in the DCAT
catalog (slug-addressed until the OS build pins its canonical FHS κ). **Deferred:** a required
`#holo-q` conformance row + `holo-q-witness.mjs`, the canonical κ-pin in `os-closure.json`, and the
OS-image gate run (the re-lock cascade). Builds directly on **Holo Forge** (ADR-0051), the engine's
deterministic content-addressed executor (RT2, `run_holo`, ADR-008), the QVAC browser-native LLM
engine, the UOR envelope (ADR-025), PROV-O realizations (ADR-024), and the Constitution (ADR-033).

**Context.** Holo Forge closed the build trust-gap: compilation became a transform on the κ-graph, and
its ADR observed that *the receipt shape is transform-agnostic* — "the same proof that a binary came
from this source extends to proving an output came from a given model." Inference is the last, and
largest, opaque transform. web2 ships an opaque bundle; web3 ships opaque bytecode; AI ships opaque
**weights** and an opaque **output** — a model you cannot re-derive, producing prose you cannot check.
Cloud inference compounds the gap: your prompt leaves the machine, and the answer arrives with no
provenance at all. The substrate was built to dissolve exactly this kind of "trust me" — for files by
Law L5, for builds by ADR-0051. The missing piece is to treat **an inference as a κ-transform**:
`κ(prompt) ⊕ κ(context) ⊕ κ(model) ⊕ κ(params) ⊕ κ(engine) → κ(output)`. Two facts make it real rather
than aspirational. First, a model's weights are just bytes, so they can be a **content-addressed
κ-disk** — resolved by address, every sector re-derived (`sha256==κ`) before use, served from any
mirror without trusting it. Second, **greedy decode is deterministic**: the QVAC GPU path mirrors the
CPU executor op-for-op, so the same prompt + model + params yields identical tokens on every machine.
A deterministic transform over content-addressed inputs is a *re-derivable observation*, not an
authority's say-so. The cognition (a real LLM thinking locally — QVAC, a lineage of sovereign
intelligence) and the verifiability (the substrate) are each insufficient alone; their union is an AI
whose outputs are self-verifying objects rather than unfalsifiable claims.

**Decision.** Ship Holo Q as the in-browser **verifiable-inference** holospace, three pieces over one
vendored engine:

1. **The model as a content-addressed κ-disk.** Holo Q never bundles weights. It resolves a model by
   its `image_kappa` and streams it through the multi-source κ-disk reader (`qvac-kdisk.mjs`): every
   1 MB sector is **verified by re-derivation** (`sha256(bytes)===κ`) before it touches the GPU, pulled
   in parallel from any reachable origin (browser cache → LAN peer → CDN) with failover, and held in a
   content-keyed cache (Law L3). A poisoned mirror cannot wear an honest address; the weights you
   compute on are provably the weights the author published. The app is lean by construction — it boots
   instantly, the engine (≈6.5 MB wasm) and model stream lazily on first ask, and a second visit reuses
   the verified cache. Smallest-first model picker for low latency, up to a 30B-parameter mixture-of-
   experts streamed and verified off the substrate.

2. **The inference receipt as a self-verifying UOR object.** Each completed answer mints a PROV-O
   activity — `prov:used` {model κ, engine κ, prompt κ, context κ, params} → `prov:generated`
   {output-tokens κ} — sealed to its own `did:holo` (RFC 8785 JCS + WebCrypto), exactly mirroring
   `forgeReceipt` one transform over. To verify, a peer holds only the receipt: **integrity** recomputes
   the address from the body (flip one field → it no longer re-derives → refused), and **re-derivation**
   re-runs the greedy decode on the same model and reproduces the output-tokens κ byte-for-byte (Law L5)
   — proof, with no server and no trust. A forged answer cannot wear an honest address.

3. **O(1) reuse, conscience, and the in-tab experience.** A κ-memo keys answers by
   `κ(context ⊕ prompt ⊕ model ⊕ params)`: an identical ask returns the cached output in O(1) with no
   decode — the app-layer realization of the substrate's content-addressed compute idiom (compute once,
   address it, replay). The mandatory conscience gate (ADR-033) self-verifies on load (re-deriving each
   principle's κ — fail-closed) and judges every answer, surfacing the verdict on the receipt. And the
   experience makes it visceral: a real chat that runs entirely on your GPU; a live view of the exact
   engine calls; a resource monitor of what your machine has to think locally; and "teleport the mind"
   — share a whole conversation as one link the receiver continues, verified genuine by its κ, tamper
   refused.

**Holo Forge, assessed, and the combination with O(1) content-addressed compute.** Holo Forge is a
genuine, deterministic, zero-dependency Holo-C → WebAssembly Core 2.0 compiler whose verifiability
model is sound and complete: the compiler is a pinned κ-object, a build is a re-derivable transform,
the receipt seals to a `did:holo`, dependencies resolve by content address (Law L3 dedup), and tamper
is refused structurally. Its only real limit is **language scope** — Holo-C is an int-only C subset, by
design; the receipt + registry architecture is fully general, and the path to real C/C++ is "the same
shape with a heavier, deliberately-pinned factory." Crucially, Forge is the *product* realization of the
engine's deterministic content-addressed executor (RT2 / `run_holo`, ADR-008) — the same primitive the
**hologram** content-addressed compute runtime generalizes to tensors (every value carries a UOR-ADDR
κ-label; identical computation is addressed once and memoized; finite-domain functions are O(1) LUT
dispatch — ~28× faster, *bit-identical*; a forward pass compiles to a `.holo` graph that re-derives).
Forge, RT2/hologram, and Holo Q are therefore three realizations of one primitive: **the verifiable
transform `κ(inputs) ⊕ κ(transform) → κ(output)`** — compile, compute, infer. Combining them, applied to
Holo Q, is the natural composition, in three layers:

- **Layer 1 — verifiable engine provenance (Forge's idiom, over the engine).** Today the receipt pins
  `κ(engine)` = the wasm bytes that ran. Forge's build-receipt idiom closes the remaining link: give the
  QVAC engine (`qvac-layer` Rust → wasm) a build receipt — `κ(engine-source) ⊕ κ(toolchain) → κ(engine-
  wasm)` — and link it from the inference receipt's `κ(engine)`. The chain then re-derives end-to-end:
  source → engine → output. (Honest scope: Forge compiles Holo-C, not Rust, so this is the *idiom*
  extended — a reproducible Rust→wasm factory vendored as a pinned κ-object emitting into the same
  receipt pipeline — exactly the "heavier deliberately-pinned factory" ADR-0051 anticipates, not
  Forge-the-Holo-C-compiler literally building the engine.)

- **Layer 2 — O(1) value-level content-addressed execution (hologram, inside the engine).** Holo Q's
  re-derivation and κ-memo are *whole-transform* determinism. hologram pushes content addressing down to
  *every value*: (a) **activation LUTs** — GELU/SiLU/softmax over the quantized domain precomputed as
  `[u16;65536]` tables, dispatched in O(1), bit-identical (a speed win that *strengthens*
  re-derivability); (b) **value-level memo** — a shared prompt prefix (system prompt, common context)
  computes its KV-cache once, addressed by κ, and every later inference over that prefix is an O(1) memo
  hit — and because κ is global, the memo is shareable over the OS mesh (cache → LAN → CDN) exactly like
  the model κ-disk; (c) **the forward pass as a `.holo` κ-graph**, so "re-derive" becomes *replay*, and
  identical sub-graphs are hits — turning re-derivation from O(tokens) re-execution into O(novel-compute).
  (Honest scope: this is the deepest integration — re-targeting QVAC's WebGPU kernels onto hologram's
  content-addressed runtime. The activation-LUT step is the tractable first move; the full κ-graph is the
  north star. The app-layer κ-memo already shipped is the coarse, working first realization.)

- **Layer 3 — the composed verifiable-transform DAG.** Engine build receipt (L1) + inference receipt
  (Holo Q) + value-level κ-graph (L2) compose into one PROV-O DAG in which every node — source, toolchain,
  engine, model, prompt, every intermediate value, output — is a κ that re-derives, and identical nodes
  are computed once. This is Law L5 over the *entire* computation, end to end, with content-addressed
  reuse. Like a Forge compile, a Holo Q inference then slots into a work receipt (ADR-045) and is payable
  (ADR-048) as any other proven activity.

**Consequences.** AI's two opaque surfaces — the weights and the output — dissolve into re-derivation:
the model is a verified κ-disk, and the answer is a re-derivable receipt. Generation becomes
*verification*; "no server saw your prompt" stops being a promise and becomes a property of where the
computation ran. Holo Forge made compilation verifiable, hologram makes execution verifiable and O(1),
and Holo Q applies both to inference — together a complete verifiable-AI stack on one serverless,
self-verifying substrate, and the cognition layer the gap analysis found missing from the OS. The costs
are honest: re-derivation requires **deterministic decode** (greedy/seeded) — creative sampling is, by
definition, non-reproducible and is therefore an explicitly separate, non-verifiable mode; model size
makes the first load heavy (the κ-disk mesh and a smallest-first default are the mitigation); and the
deepest hologram integration (Layer 2c) is real engineering, not a wire-up. A changed model, engine, or
params changes the pinned addresses by construction — re-derivation *is* the guarantee.

**External authorities.** W3C WebGPU (the local inference device) · W3C WebAssembly Core Specification
2.0 (the engine binary) · GGUF / block-quantized weights (the κ-disk payload) · IETF RFC 8785 (JCS, the
canonical form) · W3C Subresource Integrity + DID Core (`did:holo`) · W3C PROV-O (the inference receipt)
· UOR-ADDR (κ-label = H(canonical_form)) · holospaces specification (Laws L1/L3/L5; RT2, the
deterministic content-addressed executor) · the hologram content-addressed compute runtime (UOR-ADDR
κ-labels, O(1) LUT dispatch + graph-level memoization). Mints nothing beyond the existing `hosc:` and a
small `holo:` (`https://hologram.os/ns/q#`) namespace over schema.org / PROV-O + the UOR envelope.
