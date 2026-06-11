# ADR-0051: Holo Forge — a build is a verifiable, re-derivable κ-transform: the compiler is a content-addressed object and every compilation re-derives byte-for-byte with no server

**Status:** Accepted — witnessed: `tools/holo-forge-witness.mjs` is green (node 18/18) and
`#holo-forge` is a required row in `os/etc/conformance.jsonld` (the gate, ADR-024); re-run live by
`tools/gate.mjs`. The compiler ships at `os/usr/lib/holo/holo-forge/holo-forge.mjs` (with
`PROVENANCE.txt`), the in-browser app at `Hologram Apps/apps/forge/` (κ-pinned in `os-closure.json`
and the DCAT catalog, boots 0-fallbacks in the OS frame). Builds on the UOR envelope (ADR-025), the
κ-addressing primitive (`holo-uor.mjs`), the deterministic content-addressed executor (engine RT2,
`run_holo`), and PROV-O realizations (ADR-024).

**Context.** Content addressing gave the OS a self-verifying graph of *files*. But the act that
*produces* those files — the **build** — was still an unverified, off-substrate event you had to
trust. Every `PROVENANCE.txt` in the tree (prism-btc, the icons, the engine wasm) *asserts* "built
with tool X"; a reader cannot re-derive that claim, only believe it. This is the one trust gap web2
(ship an opaque bundle), web3 (ship opaque bytecode) and AI (ship opaque weights) all still punt on,
and it is exactly the gap the substrate was built to close — for files, by Law L5. The missing piece
is to treat **compilation itself as a transform on the κ-graph**: if the compiler is content-addressed
and the transform is deterministic, then `κ(source) ⊕ κ(compiler) ⊕ κ(flags) → κ(artifact)` is a pure
function, and a build becomes a re-derivable observation, not an authority's say-so. The engine already
proves this property for `.holo` compute (RT2: "because the executor is deterministic and content-
addressed, this κ equals the one the native executor produces for the same input"); Holo Forge realizes
it as a general, browser-native compiler and a user-facing experience. The reference adopted (cpp.js /
Emscripten and the wider C→WASM world) is taken as **pattern, not runtime** (ADR-0029): the unlock is
not any one toolchain but "source → WASM as a content-addressed κ-transform." We author a small, fully
deterministic compiler so the *whole* transform — compiler included — re-derives, with no foreign
toolchain to trust.

**Decision.** Ship Holo Forge as three buildless, vanilla, zero-dependency pieces:

1. **The compiler as a κ-object.** `holo-forge.mjs` is a real Holo-C → WebAssembly compiler (a C
   subset: int functions, arithmetic, relational/logical operators with C precedence and short-circuit
   `&&`/`||`, `if`/`while`/`return`, mutual recursion) emitting spec-valid WebAssembly Core 2.0. It is
   **reproducible by construction** — identical source bytes ⇒ identical wasm bytes on every machine,
   forever (no timestamps, host paths, or hash-order nondeterminism) — and runs **identically in the
   browser and in Node**. It computes no hashes: it is the pure transform; the κ layer (`holo-uor.mjs`
   in Node, WebCrypto in the browser) addresses its byte-stable output. The compiler's own κ is pinned.

2. **The build receipt as a self-verifying UOR object.** A compilation mints a PROV-O activity —
   `prov:used` <source κ> → `prov:generated` <artifact κ>, via `hosc:tool` <compiler κ> — sealed to its
   own `did:holo` (ADR-025). The receipt *is* the build's portable, content-addressed identity. To
   verify a build, a peer holds only the receipt and the κ-verified source + compiler bytes, re-runs the
   compile, and reproduces the artifact κ (Law L5). Flip one source byte → a different artifact κ; flip
   one wasm byte → WebAssembly validation rejects it. A forged build cannot wear an honest address.

3. **The in-browser experience.** `apps/forge` compiles Holo-C → WebAssembly entirely in the tab,
   instantiates and *runs* the result, shows the four κ's + the sealed receipt, re-derives the build
   byte-for-byte ("no server trusted"), and lets a build be shared as a link the receiver re-derives —
   with a tamper toggle that demonstrates refusal viscerally. No install, no toolchain, no backend.

A required `#holo-forge` conformance row and `holo-forge-witness.mjs` prove all of this offline: the
compiler re-derives to its pin; the transform is reproducible; the emitted module instantiates and
**computes correctly** (fib/gcd/factorial/mutual recursion — Law L5, semantic); tamper is refused; the
receipt seals, verifies, and re-derives from its inputs with no server.

**Consequences.** A build stops being something a server did and you trust, and becomes a self-verifying
object like every other node in the graph — the supply-chain trust problem (which compiler, which
source, was it tampered) dissolves into re-derivation. The receipt composes with the rest of the stack:
it is a PROV-O realization (ADR-024), so a compile slots into a work receipt (ADR-045) and can be paid
against (ADR-048) like any other proven activity. The receipt shape is **transform-agnostic**: the same
proof that a binary came from this source extends to proving an output came from a given model — Holo
Forge is the on-ramp to verifiable inference, the substrate's answer to opaque AI. The cost is honest:
reproducibility requires pinning the *whole* toolchain (here trivial — one dependency-free file; a full
Emscripten/clang sysroot would be a larger, deliberately-pinned κ-object), and a changed compiler or
source changes the pinned addresses by construction (re-pin deliberately — that *is* the guarantee).
Holo Forge unifies web2 (it just runs, in a tab), web3 (content-addressed, trustless, no server) and AI
(verifiable transforms) on one serverless, self-verifying substrate.

The same primitive scales into a **verifiable package universe** (shipped: `holo-forge/std/*.hc`, the sealed
`registry.uor.json`, the resolver `holo-forge-resolve.mjs`, and a second required row `#holo-forge-registry`
witnessed by `holo-forge-registry-witness.mjs`). A library is a content-addressed κ-object; dependencies
are resolved **by content address, not name+version**; a library shared by two dependents links **exactly
once** (Law L3 dedup); and the whole dependency closure links deterministically to one artifact whose κ
re-derives byte-for-byte (Law L5). This makes the supply-chain attack structurally impossible to hide:
poison one byte of a dependency and it no longer hashes to its pinned κ, so the linked artifact changes and
the build is refused — there is no "trusted registry" to compromise. The escalation to the real C/C++
universe is the same shape with a heavier, deliberately-pinned factory: a reproducible Emscripten/clang
sysroot vendored as a κ-object that emits artifacts into this exact receipt + registry pipeline.

**External authorities.** W3C WebAssembly Core Specification 2.0 (the binary format emitted) · IETF
RFC 8785 (JCS, the canonical form) · W3C Subresource Integrity + DID Core (`did:holo`) · W3C PROV-O
(the build receipt) · UOR-ADDR (κ-label = H(canonical_form)) · holospaces specification (Laws
L1/L4/L5; the deterministic content-addressed executor, RT2). Mints nothing beyond the existing
`hosc:` namespace — schema.org / PROV-O + the UOR envelope, as the rest of the catalog.
