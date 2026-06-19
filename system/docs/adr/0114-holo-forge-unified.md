# ADR-0114 — Holo Forge Unified: any HuggingFace GGUF/ONNX → one κ-addressed `.holo` in-browser, with Q self-acquiring skills on demand — and the honest fusion economics (shared-prefill + self-fusion, **not** free weight-dedup)

Status: **PROPOSED, assessment-grounded.** Nothing here is built yet; the value is that the *measurements* are done, so the design is built on what is true, not what was hoped. Two attractive claims were **disproven by direct measurement** and the design is reshaped around them; one organ was found **~80% already built**. Net-new is narrow and named: in-browser HF ingestion, one authorization gate, a need→skill classifier, and a shared-weight-pool refactor. Everything else is composition of organs that already ship and are witnessed. Ships behind the existing fail-closed κ gates and the conscience (Law L5 + ADR-0033) — a downloaded model is a *latency/capability* source, never a *trust* one, and acquisition gains an explicit authorization step because **L5 proves integrity, not provenance**.

Relates: [[holo-forge]] (ADR-0051, the verifiable-build forge) · [[holo-forge-exec]] (ADR-0074) · [[holo-onnx-forge]] (ADR-0101, the ONNX→κ front-end and its P3.7 parity blocker) · [[holo-qvac]] (ADR-0067, the in-browser WebGPU inference engine) · [[holo-q]] (ADR-0091, the one door `window.Q`) · [[holo-q-mux]] (ADR-0084, the specialist discover/rank/bind fabric this rides) · [[holo-q-model-registry]] (ADR-0096, the Function→Model→κ doctrine) · [[q-fuse]] (ADR-0098, the panel; self-fusion is its cheap-on-substrate case) · [[holo-q-openrouter]] (ADR-0102, the *remote* frontier slot this is the *local* mirror of) · [[holo-import]] (ADR-0092, the governed-fetch pattern HF ingestion must adopt) · [[holo-heal]] (ADR-0076) · [[holo-dial]] (ADR-0113, mesh κ-delivery a forged model rides) · [[holo-boot-root]] (ADR-0111, the signing root the authorization manifest reuses) · [[holo-constitution]] (ADR-0033, the conscience egress/admission gate) · the working notes `holo-gguf-onnx-forge-assessment` (v1/v2) and `holo-forge-fusion-q-router-assessment` (v3, the measurements below).

## Context

The promise asked for: **discover, download, and compile any GGUF or ONNX LLM from HuggingFace into a 100% native, κ-addressed `.holo`, entirely in-browser, serverless, zero exposed complexity — the user picks nothing, Q does the rest.** Then a second ask: a *panel* of small specialists (fusion) that beats one frontier model, made cheap by κ-dedup, with Q self-acquiring the specialists on demand.

The first-principles read, after grounding every claim in code:

**There are two forges, and the split — not the fragmentation — is the problem.**

| Forge | Reality | Evidence |
|---|---|---|
| Browser/JS forge (`holo-apps/apps/q/forge/`) | GGUF → κ → `.holo` → WebGPU run, **end-to-end, witnessed**. Greedy parity bit-identical to llama.cpp ("Paris", token 12095). Whisper proves multi-arch (53/53 chars exact vs `whisper-cli`). | `gguf-forge.mjs`, `holo-archive.mjs` (`openHoloStream`), `gpu/holo-brain-engine.mjs`, `gpu/WITNESS.md` |
| Rust/CLI forge (`holo-ai/crates/`) | Owns ONNX import **and** HF download — but **CPU-only, not in-browser**, and ONNX **fails numerical parity (P3.7)**. | `hologram-ai-onnx`, `real_model_gpt2.rs` (`#[ignore]`), `download/hf_api.rs` |

So unification is **not** "merge three Rust crates." It is: **pull HF ingestion and (eventually) ONNX into the browser forge that already emits `.holo` and runs on WebGPU**, behind one `ModelFrontEnd` seam. GGUF-in-browser is ~80% there; ONNX-in-browser is ~0% there. GGUF covers the bulk of HF's LLM space — so the unified Forge ships **GGUF-first**, ONNX staged behind P3.7 + a browser front-end.

**Two magical-sounding fusion claims do not survive measurement.**

1. **"A panel is nearly free via κ-dedup" — FALSE as built. Measured cross-model overlap: 0.01% of bytes.** Diffing the actual κ-sets of four sealed `.holo` models (Qwen2.5-0.5B + Whisper tiny/base/small): **zero weight tensors shared.** The *only* shared κ across the three same-family Whisper models is one 64,320-byte mel-filter constant (`85818f15…`) that is not even a weight. Root cause is structural and named: the forge chunks **one κ = one whole tensor** (`gguf-forge.mjs:84-86`), so any difference in shape/quant/byte → different κ → no sharing. Same-family-different-size models have differently-shaped tensors *by construction*. The OS-wide 31.6% dedup figure is real but is about **app/file assets** (`holographic-alignment-C-F.md:104`), not weights — applying it to a model panel is a category error.

2. **"Run a 3-model panel + judge in-browser" — not practical today; it runs SEQUENTIALLY.** Each `createHoloBrain()` is an isolated closure that creates **its own `GPUDevice` and uploads its own copy of every weight** (`holo-brain-engine.mjs:116,110`) — no shared weight pool, no batch dimension. `requestDevice()` is called with **no `requiredLimits`** (default 128 MB binding cap; the code already chunks `lm_head` `CH=ceil(lmN/100000)` to cope). Three 0.5B + judge fit VRAM only on a **dGPU**, and only serialized: ~10 tok/s × 4 ≈ **30–60 s** for short answers; on a typical iGPU (1–2 GB) they **don't fit resident at all**. The 1.5B judge doesn't exist yet — `holo-voice-holo-brain.mjs:15` has `kappa: ""`. The lever that makes panels cheap (shared resident pool + batched serving + content-addressed prefix/KV cache) is **design-only, net-new** (`streaming-kappa-inference-assessment.md` §4.C/D).

**The gift: Q's self-acquisition loop is ~80% already built.** `holo-q-mux.js` (ADR-0084) already **discovers** HF models (`/api/models?pipeline_tag=…&sort=downloads`), **ranks** them with a pure deterministic, re-derivable scorer (browser-runnable gate, size-fit, license), **plans**, and **runtime-binds** a specialist (`bindSpecialist`/`routeTask`). `holo-q-embed.js` does on-device cosine search. The forge turns GGUF → κ → `.holo`. ADR-0096 already pins a Function→Model→κ doctrine. The seamless "Q acquires a skill on demand" experience is the **closest** thing to shippable in the whole vision.

**Therefore the strategy inverts.** The near-term magic is **not** heterogeneous fusion. It is **(a) on-demand single-specialist acquisition** (almost built) and **(b) self-fusion** — one resident model, multiple reasoning lenses, one judge. OpenRouter's own DRACO data backs this: *Opus paired with itself scored 65.5% vs 58.8% solo — +6.7% from synthesis alone.* Self-fusion is exactly where this substrate is cheap, because a same-model panel is the one case a shared weight pool fully pays off; and the scaffolding exists (ADR-0096 PERSONA, ADR-0098 `Q.fuse`). Heterogeneous fusion with *real* dedup is the **North Star**, gated on one specific, nameable engine change.

## Decision

Build **Holo Forge Unified**: make the existing browser forge the single in-browser path from a HuggingFace model to a served, κ-addressed `.holo`, drive it from Q's existing specialist fabric, and reframe fusion around the economics that are actually true on this substrate. No new addressing, no new runtime — κ stays the address; `openHoloStream` + `holo-brain-engine` stay the player; the mux stays the router. The work is composition plus four named net-new pieces.

### 1. One seam, one sealer (L1/L3) — kill the three-way duplication

A model enters through one `ModelFrontEnd` interface — `detect(headBytes) → bool`, `readHeader(reader) → Meta`, `forge(reader) → {kBlocks, graph}` — and leaves through **one** `sealHolo({kBlocks, graph, meta}) → .holo`. Today GGUF and Whisper each hand-roll the `.holo` archive write (`seal-forge.mjs` and `seal-whisper-holo.mjs` re-encode the same MAGIC/section protocol); collapse them onto one extracted sealer. GGUF and Whisper front-ends refactor onto the interface (reuse); ONNX becomes a pluggable front-end (net-new, staged). Everything downstream — `.holo`, `openHoloStream` (`holo-archive.mjs:118`, per-block L5 "holo L5 REFUSE"), the WebGPU engine, OPFS, IPFS/heal/mesh (ADR-0076/0113) — is format-agnostic and already witnessed.

### 2. In-browser HF ingestion (L4) — the model arrives through the substrate, not an app `fetch`

Port the logic of `holo-ai/.../download/hf_api.rs` (Hub `/api/models` search, `/resolve/<rev>/<file>`, bearer auth, SHA-256, retry) to a **browser** module using `fetch` with **HTTP range** (multi-GB streams, never whole-file) and the **governed-fetch envelope** of ADR-0092 (`makeGovernedFetch`), so the download is a conscience-gated egress that mints provenance, not a raw app call. CORS is the one empirical risk (HF LFS resolve URLs must answer cross-origin range reads); the fallback is the existing host-proxy precedent (`holo-serve-fhs /sc/*`), at the honest cost of a relay in the path. Fetched blocks register into the κ-store the SW already serves.

### 3. The authorization gate (ADR-0033) — the one serious gap, because **L5 ≠ provenance**

Q auto-downloading and *executing* arbitrary HF models is a real liability. L5 re-derivation proves you got **the exact bytes you asked for**; it says nothing about **whether you should run them** — a correct-but-hostile model passes every existing gate, and the conscience gate is structurally blind to acquisition (`holo-qvac.js:28-32` passes `action:"qvac:"+cap` which `holo-conscience.js` never reads). There is no allowlist, no signature, no size cap on the acquire path. **Make the skill→model manifest the authorization unit**: a κ-pinned, **signed** curated list (reuse the secp256k1 M-of-N machinery of ADR-0111's `holo-anchor.mjs`). Insert an `authorize(plan)` step in the mux's `pickSpecialist` *before* bind, requiring chosen repo/κ ∈ signed manifest **or** size-cap + license-gate + **explicit one-time user consent** (extend the conscience `evaluate` with an `acquire` world-var). Until this lands, auto-acquire requires per-acquisition confirmation. **This is the gating item for the entire vision.**

### 4. Q self-acquires a skill (L4, mostly reuse) — the seamless core

The loop is ~80% built; wire the missing 20%. Q detects a skill gap → `holo-q-mux.discover(skill)` → `rankCandidates` → **`authorize`** (§3) → governed range-download (§2) → `ModelFrontEnd.forge` → `sealHolo` (§1) → `openHoloStream` → WebGPU → `bindSpecialist(skill, provider)`; thereafter an instant κ-cache hit, shared and deduped with everything Q already holds. Net-new is small and concentrated: a **need→skill classifier** (reuse `holo-q-embed.js` cosine over a fixed skill-label set — deterministic, re-derivable; *not* embedding over scraped HF cards), a **skill manifest** that extends the mux `TASKS` array with HF tag/`filter` constraints, and a **gap-detector** branch in the converse path. The "Streaming a new skill: <skill>" moment is rendered by the existing splash (`apps/forge/holo-splash.js`, manual `.progress()`) **fed by the real per-block L5 verify count** (`holo-brain-engine.mjs load()`), so it physically cannot hang — every verified block advances the bar (the `holo-linux/index.html:505` precedent).

### 5. Fusion, reframed to what is true (L3) — self-fusion now, the real saving is shared-prefill

Drop "free via weight-dedup." Sell the two economics that are real:

- **Shared-prefill.** Same prompt → same κ → the prefill (system prompt / RAG context) is computed **once** and its KV reused across every panel member and the judge. This is the genuine fusion saving and the content-addressing physics is sound — but it is the **design-only centerpiece** of `streaming-kappa-inference-assessment.md` §4.C (a radix tree of κ-addressed, block-granular KV), net-new.
- **Self-fusion.** One model resident, **N inference contexts over one weight set**, one judge pass — the case OpenRouter showed gives +6.7% from synthesis alone, and the one case a shared pool pays off maximally. It needs only a **small** engine refactor: one `dev` + one `Wt` map + N `{SB, Kc, Vc, _pidx}` contexts inside `holo-brain-engine.mjs` (today's closure forbids it). KV per context ≈ 48 MB (Qwen 0.5B, MAX_CTX 2048) — fits an iGPU. The judge is the same pinned 0.5B (`cda0b3da…`) until a 1.5B is forged.

Heterogeneous, *fast* multi-model fusion is the North Star (§S5), explicitly gated, never promised near-term. A forged model and a saved panel are each **one root κ** (`seal-forge.mjs` → `did:holo:sha256:…`), pinnable to IPFS and served by mesh — so a panel someone else assembled, you pull by κ.

## Staged plan

- **S0 — One seam, one sealer [PROPOSED, refactor].** Extract `sealHolo()`; define `ModelFrontEnd`; refactor GGUF + Whisper front-ends onto it. Witness: a GGUF and a Whisper model both seal through the one path to byte-identical `.holo` as today. Row `#forge-unified-seal`.
- **S1 — In-browser HF ingestion [PROPOSED, net-new, CORS risk].** Governed range-download of a GGUF from the Hub; **empirically resolve HF CORS** before committing serverless (else host-proxy fallback, documented). Row `#forge-hf-ingest`.
- **S2 — Authorization gate [PROPOSED, net-new, GATING].** Signed skill→model manifest + `authorize()` in `pickSpecialist`; conscience `acquire` world-var. Witness *includes* `refusesUnsignedModel`. Row `#forge-acquire-authz`. **Nothing auto-acquires before this is green.**
- **S3 — Q self-acquisition [PROPOSED, ~80% reuse].** need→skill classifier + manifest + gap-detector over the existing mux; splash on real L5 progress. End-to-end: Q detects a gap → acquires + authorizes + forges + binds a small specialist → answers; warm reload network-free. Row `#q-acquire`.
- **S4 — Self-fusion [PROPOSED, small net-new].** Shared-weight-pool refactor (one device, N contexts) + judge pass over `Q.fuse`/PERSONA. Witness: a persona-panel + judge over one resident 0.5B fits an iGPU and beats solo on a fixed task. Row `#forge-self-fusion`.
- **S5 — North Star [PROPOSED, net-new, large].** The keystone enabling change: port models from per-whole-tensor chunking to **fixed-size sub-tensor block chunking** (the v86 `.kblocks` 256 KB pattern that already measures 50% intra-image dedup and is SW-served + L5-verified). It unlocks, together: genuine sub-tensor weight dedup, lazy block-granular multi-GB streaming, and the **content-addressed prefix/KV cache** (§4.C) and **batched multi-request serving** (§4.D) that make heterogeneous panels fast. Rows `#forge-block-dedup` `#forge-prefix-kv` `#forge-panel-batched`.
- **Deferred (from ADR-0101 + v2):** ONNX P3.7 numerical fix + an ONNX-in-browser front-end; forge + pin the 1.5B judge `.holo`; GGUF K-quant/IQ/MoE coverage.

## Witness plan

Each stage lands a Node/CDP witness first; browser rows are simulated then real-browser-confirmed before any pinned byte changes (the ADR-0111 harness caveat: the shell renderer is unresponsive to preview tools).

- **S0** `tools/holo-forge-seal-witness.mjs` — GGUF + Whisper through one `sealHolo`; `.holo` footer κ unchanged vs current seal; one sealer, zero duplicated archive code.
- **S1** `tools/holo-forge-hf-witness.mjs` — range-download a small GGUF over governed-fetch; SHA-256 matches HF LFS; CORS path proven or proxy fallback logged (no silent whole-file fallback).
- **S2** `tools/holo-forge-authz-witness.mjs` — signed-manifest model binds; **unsigned/oversized model refused**; conscience `acquire` verdict honored; consent path exercised.
- **S3** `tools/holo-q-acquire-witness.mjs` — `{gapDetected, discovered, authorized, downloadedByRange, forgedKappa, sealedHolo, boundIntoMux, ranInWebGPU, warmReloadNetworkFree, refusesUnsignedModel}`; warm path 0-network, re-verified (the witnessed Whisper 0-bytes/250-OPFS/250-L5 profile is the target).
- **S4** `tools/holo-forge-self-fusion-witness.mjs` — N contexts over one resident weight set; one judge synthesis; iGPU-budget VRAM; beats-solo on a fixed task.
- **S5** `tools/holo-forge-block-dedup-witness.mjs` — re-forge under block chunking; measured sub-tensor dedup > 0 on a same-family pair; prefix-KV cache hit on a shared system prompt; batched two-stream pass amortizes one weight read.

Conformance rows (turn green per stage, registered in `os/etc/conformance.jsonld`, `gate.mjs` live set): `#forge-unified-seal` `#forge-hf-ingest` `#forge-acquire-authz` `#q-acquire` `#forge-self-fusion` `#forge-block-dedup` `#forge-prefix-kv` `#forge-panel-batched`.

## Honest boundaries

- **Weight-level κ-dedup across models is ~0 and fundamentally limited.** Measured 0.01% on real artifacts; per-whole-tensor chunking is the cause (`gguf-forge.mjs:84-86`). Even with S5 block chunking, *arbitrary different* models share little — different weights are different bytes. The real fusion saving is **shared-prefill + self-fusion**, not shared weights. Never sell weight-dedup as the fusion economic.
- **Heterogeneous panels are not fast today.** The engine runs them sequentially with duplicated VRAM (`holo-brain-engine.mjs:116,110`); iGPUs won't fit three 0.5B resident. Practical fast fusion depends on S5 (shared pool + batched serving + prefix-KV), which is net-new and large. Self-fusion (S4) is correct and shippable but **bounded by single-stream ~10 tok/s** until the batch dimension exists.
- **L5 is integrity, not provenance.** Auto-acquisition is unsafe until S2; a correct-but-hostile model passes every current gate. S2 is the gate for the whole vision, not an optional hardening.
- **"100% serverless" is contingent on HF CORS.** If the Hub refuses cross-origin range reads, ingestion routes through a host-proxy (the `/sc/*` precedent) — a relay in the path, sealed and re-derived end-to-end, but not literally serverless. State the trade; never overclaim (cf. ADR-0111, ADR-0113 ceilings).
- **ONNX-in-browser does not exist.** The Rust ONNX path neither runs in-browser nor passes parity (P3.7, `real_model_gpt2.rs` `#[ignore]`). The unified Forge is GGUF-first; ONNX is staged behind a numerical fix + a browser front-end, not assumed.
- **The 1.5B judge is unforged** (`holo-voice-holo-brain.mjs:15`, `kappa: ""`). Fusion judges run on the pinned 0.5B until a larger judge is forged + pinned.

## Composition

Built on ADR-0051/0074 (the forge + exec receipt), ADR-0101 (ONNX front-end + its honest blocker), ADR-0067 (the WebGPU engine), ADR-0084/0091/0096 (the mux, the one door, the Function→Model→κ registry — the self-acquisition spine), ADR-0098/0102 (the fusion panel and its remote mirror — this is the *local self-acquired* member), ADR-0092 (governed fetch), ADR-0076/0113 (heal + mesh κ-delivery), ADR-0111 (the signing root the authorization manifest reuses), ADR-0033 (the conscience admission gate); grounded in Laws L1/L3/L4/L5. Mints only existing object types — a `.holo` (one root κ) and the forge/acquire PROV-O receipts. No new addressing, no new transport, no new trust model — one new *admission* step (authorization) because integrity was never provenance.
