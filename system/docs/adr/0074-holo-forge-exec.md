# ADR-0074: Holo Forge — verified execution: a computation is a re-derivable κ-transform, so "verified bytes" become "verified computation", trustlessly and 100% serverless in any browser

**Status:** Accepted — witnessed: `tools/holo-forge-exec-witness.mjs` is green (node 22/22) and
`#holo-forge-exec` is a required row in `os/etc/conformance.jsonld` (the gate, ADR-024), re-run live
by `tools/gate.mjs`. The executor ships at `os/usr/lib/holo/holo-forge/holo-forge-run.mjs` — a pure,
isomorphic, zero-dependency sibling of the compiler that does NOT move the compiler's κ. Extends
ADR-0051 (Holo Forge): same family, same receipt shape, same `hosc:` namespace.

**Context.** ADR-0051 closed the trust gap for *builds*: with a content-addressed compiler and a
deterministic transform, `κ(source) ⊕ κ(compiler) ⊕ κ(flags) → κ(artifact)` is a pure function, so a
build re-derives byte-for-byte with no server. But the act that *consumes* an artifact — **running
it** — was still an off-substrate event you had to trust. The web's entire model for "did this code
actually compute that result?" is *trust the operator*. Content addressing proves *what a thing is*
(Law L5); it says nothing about *what happened* when that thing ran. That is the missing half of a
substrate whose whole purpose is replacing trust with re-derivation.

The investigated path was an attested microVM (tinylabscom/mvm — Firecracker / Cloud Hypervisor /
libkrun). It is a real tool, but it cannot satisfy the constraint that decided this design: **100% in
any browser, serverless.** A microVM needs `/dev/kvm` or a hypervisor; it is headless; it is heavy. So
the browser-native verified-computation engine cannot be a VM. It must be the **re-derivable** strength,
not the **attested** one: a computation is a deterministic κ-transform over a κ-addressed Wasm code
module, and verification is *re-running the module and re-deriving the output κ* — no host, no VM, no
server. holospaces already names this exact surface: the substrate's general compute form is "a Wasm
code module … run by hologram's runtime" and "booting realizes the holospace as a **computation over
content**: a κ-addressed execution codemodule reads the environment by κ, runs it, and writes new
canonical state." Verified execution is that pattern, generalized to any closed module — and it is the
one that runs in every browser today, because WebAssembly Core 2.0 already does.

**Decision.** Ship verified execution as one buildless, vanilla, zero-dependency module bundled into
Holo Forge:

1. **Execution as a κ-transform.** `holo-forge-run.mjs` runs a Wasm module on input bytes via the
   platform's own spec-conformant `WebAssembly` engine (Law L4 — we add no runtime; we run the
   existing compute form). WebAssembly Core 2.0 is **deterministic**, so identical module bytes on
   identical input bytes yield identical output bytes on every conformant engine, in Node and the
   browser alike: `κ(module) ⊕ κ(input) → κ(output)` is a pure function. Two modes, one guarantee:
   `runScalar` (verified pure-function evaluation, a Wasm call is nanoseconds — lean and low-latency)
   and `runBuffer` (general-purpose byte→byte transforms over the Holo Link memory ABI — the shape
   verifiable inference / "develop-to-κ" rides on). It computes no hashes — it is the pure transform;
   the κ layer addresses its byte-stable output (`holo-uor.mjs` in Node, WebCrypto in the browser).

2. **The closed-module guard (the honesty boundary).** Nondeterminism enters Wasm only through host
   imports (and a few float-NaN / SIMD details). So verified execution admits exactly **closed**
   modules — no imports, run under an empty import object — and **refuses** any module that needs a
   host, because its run is by definition not re-derivable. A Forge / Holo-C artifact is closed: it
   defines and exports its own linear memory and imports nothing. Imports that are themselves κ-pinned
   deterministic modules are the Holo Link path (ADR-0060); the linker pre-resolves them into one
   closed module before it reaches the executor.

3. **The execution receipt as a self-verifying UOR object.** A run mints a PROV-O activity —
   `prov:used` [module κ, input κ] → `prov:generated` <output κ>, via the deterministic Wasm engine —
   sealed to its own `did:holo` (ADR-025). To verify a computation, a peer holds only the receipt and
   the κ-verified module + input bytes, re-runs, and reproduces the output κ (Law L5). Flip one module
   byte → a different module κ (and the engine rejects it); flip one output byte → a different output
   κ. A forged computation cannot wear an honest address. The receipt **composes with the build
   receipt by content**: a run's module κ *is* a Forge build receipt's generated artifact κ — build
   proves the bytes, execution proves the computation, one chain.

A required `#holo-forge-exec` row and `holo-forge-exec-witness.mjs` prove all of this offline: a run is
deterministic; scalar and byte-buffer computations are correct in-engine (Law L5, semantic); an
importing module is refused; tamper is refused; the receipt seals, verifies, and re-derives from its
inputs with no server; and the run's module κ equals the build receipt's artifact κ.

**Consequences.** A computation stops being something an operator did and you trust, and becomes a
self-verifying object like every other node in the graph. This unlocks the capabilities the agent
stack was missing: results (not just files) become portable with their own correctness, so an agent
economy can trade *outputs*; **Holo Settle (ADR-048)** can release a voucher only against a run that
re-derives — no proof, no pay; a weak device can delegate an expensive transform and verify the result
cheaply instead of trusting it; a function becomes a κ-object `f: input κ → output κ` that the
substrate memoizes by content, extending O(1) memoization from data to compute; and an execution receipt
slots straight into a work receipt (**ADR-045**) as a proven, conscience-gated step. The receipt shape
is transform-agnostic: the same proof that this output came from this module extends to proving an
inference came from a given model — the on-ramp to verifiable AI, now over *execution*, not just
compilation.

The honest ceiling, stated plainly: re-derivability requires **determinism** (closed module, no host
nondeterminism), so impure or host-dependent work is out of scope for the browser path — by design.
Where replay is impractical (very expensive runs) or the input must stay private, the complementary
**attested tier** is the right tool: a vendored, sealed `mvm` microVM (dm-verity rootfs + vsock guest)
that attests a run on a host. That tier is faithful to its upstream source and is **never on the
browser path**; it trades trustless re-derivation for a hardware-rooted attestation, and is documented
here only as the deliberate boundary of what a serverless, in-browser engine can prove.

**External authorities.** W3C WebAssembly Core Specification 2.0 (deterministic execution) · IETF RFC
8785 (JCS, the canonical form) · W3C DID Core (`did:holo`) + W3C PROV-O (the execution receipt) ·
UOR-ADDR (κ-label = H(canonical_form)) · holospaces specification (Laws L1/L4/L5, Q4/Q6; the
κ-addressed Wasm execution surface). Mints nothing beyond the existing `hosc:` namespace.
