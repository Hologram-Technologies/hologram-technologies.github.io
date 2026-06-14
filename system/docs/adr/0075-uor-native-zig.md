# ADR-0075: UOR-native Zig — a deterministic Zig→WASM frontend for Holo Forge, so the substrate authors its own compute objects in a lean, zero-runtime systems language and a build stays a re-derivable κ-transform

**Status:** Proposed — *not yet Accepted, by design*: the keystone property (Zig→WASM byte-determinism
across environments under a pinned compiler + flags) must be **witnessed** before this lands, exactly
as the view-tier `esbuild-wasm` determinism was proven byte-for-byte against the existing registry.
**Keystone validated (2026-06-12):** a spike (pinned Zig 0.13.0, `wasm32-freestanding`, `ReleaseSmall`)
compiled identical source from two *different absolute paths* plus a repeat to byte-identical WASM
(κ `25fc2124…`) — a **198-byte closed module** with **zero host imports** that runs correctly
(`add(2,3)=5`, `fib(10)=55`). So the build is a re-derivable pure function of `source ⊕ compiler ⊕
flags` (Laws L1/L5) and the module is the closed shape Forge-exec admits. A second spike ran a
**no_std/no_alloc** Zig servlet (a 212-byte closed module) through the *real* executor
`holo-forge-run.mjs`: `runScalar` plus a byte→κ `runBuffer` transform, 100% serverless, output κ
**re-derives** (L5) under a sealed PROV-O receipt, at **~2 ns/warm-call** and ~95 µs instantiate —
confirming the lean / low-latency / serverless claims of Decision 3–5. *Still open, and the honest
remainder before Acceptance:* (i) the Zig toolchain itself running **as WASM in the browser**, and
(ii) that `zig`-as-wasm output equals native-`zig` output byte-for-byte (the native==wasm check the
`esbuild-wasm` spike passed) — the heavy cold-start path. A planned `tools/holo-zig-witness.mjs` and a
required `#holo-zig` row in `os/etc/conformance.jsonld` (the gate, ADR-024) gate acceptance — nothing is complete until its conformance row is witnessed against its
external authority (the holospaces `vv/` convention). The frontend is **bundled into the one
`holo-forge.mjs` as `compileZig()`** — *not* a sibling file — so the substrate keeps a single Forge with
two frontends (`compile()` for Holo-C, `compileZig()` for Zig) sharing the same `forgeReceipt`/`jcs`
machinery and the `holo-forge-run.mjs` executor (ADR-0074). To stay pure · isomorphic · zero-dependency,
`compileZig` takes the external toolchain as an **injected runner** (`toolchain(source, flags) → wasm`)
and owns only the re-derivable contract (canonical flags, closed-module guard, receipt); the Node edge
supplies the pinned `zig`, a browser would supply the wasm toolchain. The compiler κ was re-pinned in
`holo-forge-witness.mjs` (2026-06-13, both Forge witnesses green). Extends ADR-0051 (Holo Forge): same
family, same receipt shape, same `hosc:` namespace; composes ADR-0060 (Holo Link) and ADR-0074.

**Context.** ADR-0051 made a *build* a re-derivable κ-transform — with a content-addressed compiler and
a deterministic transform, `κ(source) ⊕ κ(compiler) ⊕ κ(flags) → κ(artifact)` is a pure function, so a
build re-derives byte-for-byte with no server and mints a PROV-O receipt. ADR-0074 made *execution*
re-derivable over closed Wasm modules. ADR-0060 composes those modules by κ. holospaces already fixes
the target: the substrate's general compute form is "a Wasm code module … run by hologram's runtime,"
and WebAssembly Core 2.0 is the one such form every browser runs today. What is missing is not a runtime
— it is a *frontend a human or agent actually wants to write*. Forge's only language today is Holo-C, a
deliberately minimal hand-rolled C subset; growing the substrate's real compute objects — codecs, the
BLAKE3 and sha256 cores, the Φ-Atlas math, image/audio transforms, and Forge's own tooling — by
extending Holo-C or hand-writing WAT does not scale.

This is the *compute* tier, and it is orthogonal to the *view* tier. The view tier (TSX→ESM for UI
components, ADR-…/apps/ui) is a text→text transform that runs in the webview's JavaScript engine and is
served by a deterministic in-browser `esbuild-wasm`; nothing in this ADR touches it. This ADR is about
source → the **WASM IR**. The candidate languages were weighed against one constraint above all —
**zero added runtime** (Law L4): Rust→WASM drags a larger toolchain and `std`/panic machinery and is
harder to ship lean *and* ship the toolchain itself as a κ-object; AssemblyScript carries a GC runtime,
so it is not zero-dependency; raw WAT is unmaintainable. **Zig** has a first-class
`wasm32-freestanding` target with no GC, no runtime, and no libc required, so it emits modules that
**import nothing** — which is precisely the *closed module* ADR-0074 admits for verified, serverless
execution. It is deterministic given a pinned version and flags, it is small and fast under
`ReleaseSmall`, and `zig cc` is a full Clang toolchain, so the *same* frontend compiles C/C++ → WASM for
free. Bun — written in Zig — is the existence proof that Zig produces world-class, low-latency systems
tooling. (Bun itself is a *native* runtime, not a browser/WASM artifact; its relevance here is the
language, not the binary.)

**Decision.** Add Zig to Holo Forge as a frontend over the existing WASM compute pillar — a new language
into the substrate, **not** a new substrate:

1. **A Forge frontend, never a new runtime (Law L4).** `compileZig()` lives in `holo-forge.mjs` beside
   the Holo-C `compile()` — one Forge, two frontends — and targets `wasm32-freestanding`. The Zig
   toolchain is shipped as a **content-addressed κ-object** (the compiler is itself addressed and pinned, like Forge's Holo-C compiler), so "compile
   Zig" is a substrate-internal act resolved from the κ-store — there is no external `zig` on `PATH`, no
   npm, no system dependency. The freestanding target means the produced module imports nothing beyond
   externs it explicitly declares (and those are κ-linked via ADR-0060) — a **closed, zero-external-
   dependency servlet** that Forge-exec runs with no host, no VM, no server.

2. **A build is a re-derivable κ-transform (Law L5, extends ADR-0051).** `κ(source.zig) ⊕ κ(zig-toolchain)
   ⊕ κ(flags) → κ(module.wasm)` is a pure function; the build re-derives byte-for-byte offline, and mints
   a PROV-O activity — `prov:used` [source κ, compiler κ] → `prov:generated` <module κ>,
   `prov:wasGeneratedBy` the Zig frontend — sealed to its own `did:holo` (ADR-025). Two κ per object, each
   in its native layer (Law L1): the **source κ** over the verbatim `.zig` is the editable identity and
   provenance; the **module κ** over the `.wasm` is the artifact address Forge-exec consumes and Holo Link
   composes. Flip one compiler byte or one source byte → a different κ → refused. The build receipt
   composes by content with an execution receipt (ADR-0074) and slots into a work receipt (ADR-045): the
   same module κ that a build *generated* is the one an execution *ran*.

3. **Lean, zero-runtime servlets.** `wasm32-freestanding` + `ReleaseSmall` yields tiny modules with no
   GC, no allocator unless the source brings its own, and no wasi/libc by default. The module defines and
   exports its own linear memory and imports nothing — by construction a **closed** module, the exact
   class ADR-0074 admits for trustless, serverless execution. Multiple Zig modules (or C/C++ via `zig cc`,
   or Holo-C) are combined the Holo Link way: `extern from "κ"`, pre-resolved into one closed module
   before it reaches the executor. The honesty boundary of ADR-0074 is inherited unchanged: anything that
   needs a host import (wasi, threads, the wall clock) is not re-derivable and is out of scope for the
   browser-verified path.

4. **Super low latency, via Holo Runtime and the κ-store (Law L3).** The Zig toolchain κ-object loads
   **once** into the single canonical Holo Runtime (`os/usr/lib/holo`, under the no-duplicates invariant;
   apps bind, never copy) — RAM is a cache over the content-addressed store. A repeat build is **O(1)**:
   identical `source ⊕ compiler ⊕ flags` resolves to an already-known module κ, so the cached artifact is
   **rebound, not recompiled** (Forge's rebind-not-recompile). Execution is an in-process `WebAssembly`
   call — nanoseconds for `runScalar`, no IPC, no network — and the page-side arena plus the service-
   worker content-cache keep compiler and module bytes resident. Net path: one cold compile, then sub-
   millisecond warm rebind and nanosecond execution, entirely on-device.

5. **Addressable by agents and humans alike (W3C open semantic web).** The frontend is a UOR object with a
   `ns/*.jsonld` projection in the `hosc:` namespace; the build receipt is a JSON-LD **PROV-O** graph; all
   ids are `did:holo` (**W3C DID Core**); the artifact is **WebAssembly Core 2.0**. The right to "compile
   Zig in this holospace" is a κ-addressed, attenuable, revocable capability — a **UCAN/Verifiable
   Credential** (compose with Holo Delegate, ADR-0042) — so an agent is *granted* the compile authority
   verifiably rather than trusted with it. The same act is exposed as an **MCP tool** in the Forge surface
   (`forge_compile` with `lang: "zig" | "c"`), so an agent invokes the frontend through the identical verb
   a human does — one content-addressed transform, two audiences, no second code path.

A required `#holo-zig` row and `holo-zig-witness.mjs` will prove all of this offline before acceptance:
two independent environments compile the same `.zig` to **byte-identical** module bytes (the determinism
keystone); the module κ re-derives from `source ⊕ compiler ⊕ flags`; the module is **closed** (zero host
imports); Forge-exec runs it and reproduces the output κ (Law L5, semantic); a tampered compiler or
module is refused; the PROV-O receipt seals, verifies, and re-derives from its inputs with no server; and
`zig cc` compiles a C source to the same closed shape (the versatility claim).

**Consequences.** The substrate gains a real, lean, fast systems language to author its *own* verified
compute κ-objects — builds re-derive trustlessly, modules run serverless and low-latency, and C/C++ come
free through `zig cc` on the one canonical toolchain in the Runtime. This completes the compute tier the
way the in-browser `esbuild-wasm` transform completes the view tier: source you actually want to write,
compiled by a content-addressed compiler, into an object whose correctness any peer re-derives rather
than trusts. Because the frontend reuses Forge's receipt and Forge-exec's execution proof, a Zig module
is, from birth, a node in the same graph as every Holo-C artifact, every linked composition, every work
receipt, and every Settle voucher — agents can trade its *outputs*, not just its bytes.

The honest ceiling, stated plainly. First, **determinism is assumed until witnessed** — this ADR is
*Proposed*, and if Zig's WASM output proves non-reproducible under any pinned version+flags, the verified
path is falsified and the build degrades to ADR-0074's *attested* tier (still useful, no longer
trustless); the determinism spike is the gate, not a formality. Second, the Zig self-hosted toolchain
compiled to WASM is **heavy** — a genuine cold-start cost, paid once and amortized only by κ-caching the
compiler across the whole OS; if that cold cost is unacceptable for a target, the scoped fallback is
`zig cc` for C-only modules or a pinned smaller frontend. Third, host-dependent Zig (wasi, threads,
clocks, randomness) is **out of scope** for the browser-verified path by design — the same boundary
ADR-0074 draws. Alternatives weighed and set aside: extending Holo-C (too limited to grow into the
substrate's compute language); Rust→WASM (heavier runtime and toolchain, harder to ship lean and as a
κ-object); AssemblyScript (a GC runtime is not zero-dependency); hand-written WAT (unmaintainable).

**External authorities.** W3C WebAssembly Core Specification 2.0 (the deterministic compute form and
artifact) · IETF RFC 8785 (JCS, the canonical form) · W3C DID Core (`did:holo`) + W3C PROV-O + JSON-LD
(the build receipt as a provenance graph for agents and humans) · W3C Verifiable Credentials / UCAN (the
compile capability, via ADR-0042) · UOR-ADDR (κ-label = H(canonical_form)) · the holospaces specification
(Laws L1/L3/L4/L5; canonical forms & κ-labels; the κ-addressed Wasm compute form; capabilities as
κ-addressed authority; projections) · the Zig language and toolchain, vendored and pinned as the
content-addressed frontend. Mints nothing beyond the existing `hosc:` namespace.
