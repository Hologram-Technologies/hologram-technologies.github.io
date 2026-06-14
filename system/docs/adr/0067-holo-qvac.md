# ADR-0067: QVAC SDK — Tether's local AI SDK, encoded native to Hologram OS (Builders)

**Status:** Accepted — implemented and witnessed (`tools/qvac-witness.mjs`, 24 checks; gate row `#qvac-sdk`).

## Context

QVAC (docs.qvac.tether.io) is Tether's local AI SDK: one npm package, a single unified JS/TS
interface over 13 AI capabilities (text generation, embeddings, RAG, fine-tuning, multimodal, image,
video, transcription, text-to-speech, voice assistant, translation, VLA, OCR), with a model lifecycle,
a runtime (cancellation, lifecycle, logging, profiler), P2P delegation, and an OpenAI-compatible HTTP
server. It runs on Node, Bare and Expo, and is Apache-2.0.

Hologram OS already has the pieces QVAC needs but does not itself ship: a browser-native engine (Holo
Q / QVAC WebGPU, ADR-0052), a content-addressed model store (the κ-disk), a fail-closed conscience
gate (ADR-033), the UOR receipt envelope (ADR-025), and the Holo SDK front door (ADR-0050). What was
missing was the **named QVAC contract** — so a builder who knows QVAC could write QVAC code here and
have it run, beautiful and serverless, with nothing installed.

A package is a location; the substrate addresses by content (Law L1). So importing the npm package is
the wrong move. The right move is to **encode the contract, not vendor the code**.

## Decision

Encode the whole QVAC surface as one self-verifying object on the substrate, and satisfy it with the
OS's own engine. The contract is the binding artifact; the runtime is wiring, not new AI.

- **One source of truth** — `os/usr/lib/holo/holo-qvac.mjs` (pure, isomorphic) declares the 13
  capabilities (each with its verbatim QVAC symbols, model class, an honest `provisioned` flag, and a
  checkable obligation), the runtime + model + P2P + server surface, the PROV-O receipt shape, the
  OpenAI request/response mapping, a deterministic **reference brain** (the always-run floor), and the
  dereferenceable `hosqvac:` ontology.
- **The runtime façade** — `os/usr/lib/holo/holo-qvac.js` (`window.HoloQVAC`) reproduces every QVAC
  public symbol as a real function and routes each through one path: **conscience gate → pluggable
  provider → a re-derivable receipt (Law L5)**. The default provider is the reference brain (runs on
  any device, no download); binding Holo Q (QVAC WebGPU) makes the same calls run a real on-device LLM,
  with the contract and the receipt unchanged (the dormant seam of Holo Code, now first-class).
- **Provable local inference** — every capability call seals a PROV-O inference receipt that commits
  to `model ⊕ input ⊕ params ⊕ engine → output` and a conscience verdict, and re-derives to its
  content address. Identical inputs replay the same κ (the O(1) memo); a tampered output is refused.
- **Serverless OpenAI server** — QVAC's OpenAI-compatible HTTP server becomes `serve(request)`, a
  Service-Worker fetch handler answering `/v1/*` with no process and no port (Law L1/L4), plus a
  drop-in `openai` client namespace.
- **Honest where weights are absent** — text generation, embeddings, RAG, translation and
  classification run on the substrate now; the weight-gated capabilities (image, video, ASR, TTS, VLA,
  OCR, fine-tuning) are present and gated, and report a missing model rather than faking output.
- **Sealed + witnessed** — `tools/seal-qvac.mjs` materializes `os/usr/share/ns/qvac.jsonld` and seals
  `os/etc/holo-qvac/qvac.uor.json` (Merkle-links the source, façade, ontology, the conscience gate, and
  the front doors). `tools/qvac-witness.mjs` RUNS the shipped façade in Node and proves it. Gate row
  `#qvac-sdk` (required) is wired into `tools/gate.mjs`.
- **Operative for any builder** — the Holo SDK exposes `qvac()`; the scaffolder builds QVAC apps on the
  contract (`builtOn: "qvac-sdk"`, `@hologram/qvac`, `conformsTo` the ns), emitting a beautiful,
  always-running on-device chat that shows each answer's verifiable receipt κ.

## Consequences

A QVAC developer's code runs on Hologram OS unchanged in spirit — one import, on-device AI, serverless,
private — and gains what QVAC alone cannot give: every answer is provable by re-derivation, every model
is content-addressed and verified on load, and every call is constitution-bound. The reference brain
guarantees an app always starts; binding a real model is a provider swap, not a rewrite. The cost: the
weight-gated capabilities are surfaced honestly rather than fully live until a model is bound — by
design (Law L5: never fake output). The QVAC SDK joins the substrate as an object, not a dependency.

External authorities: QVAC SDK (docs.qvac.tether.io, Apache-2.0 — encoded not vendored) · holospaces
Laws L1/L2/L4/L5 (github.com/Hologram-Technologies/holospaces) · ADR-033 (conscience gate) · ADR-0052
(Holo Q / QVAC WebGPU) · ADR-0050 (Holo SDK) · OpenAI Chat Completions API (the `/v1` surface) · W3C
PROV-O · W3C DID Core · IETF RFC 8785 (JCS) · W3C OWL 2 / RDFS / SKOS · UOR-ADDR (κ = H(canonical_form)).
