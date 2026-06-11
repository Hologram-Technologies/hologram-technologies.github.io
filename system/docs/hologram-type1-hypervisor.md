# Hologram as a content-addressed Type-1 hypervisor

**Thesis.** Get as close to the metal as a browser allows by **JIT-translating guest
code to WASM** — the browser's WASM engine compiles WASM to the host's real CPU, so
it *is* the hardware-virtualization layer (the VT-x of the web). Hologram is the thin
hypervisor around that fast execution: a content-addressed memory model (UOR), an O(1)
compute cache (κ-memo), and — the keystone — a **κ-addressed translation cache** so the
warm-up cost of "compile guest → native" is paid **once, globally**, never per guest.

Today's emulator is a Type-2 *interpreter* (one riscv instruction at a time → ~50× tax).
It already has the content-addressed memory and the O(1) memo; it is missing the **JIT /
translation layer**. That single layer is the entire performance gap and the whole vision.

---

## 1. Execution engine — the κ-cached binary translator (DBT)

Replace the instruction interpreter with a dynamic binary translator:

1. **Dispatch.** At the current guest PC, look up the translated block by κ.
   - **Hit** → call the JIT'd WASM function for the block (near-native).
   - **Miss** → translate, cache, execute.
2. **Block discovery.** Decode from the PC to a terminator (branch / jump / `ecall` /
   page boundary).
3. **Block identity is the *code*, not the address:** `κ_block = blake3(guest code bytes)`.
   Position-independent code at different addresses, in different guests, on different
   devices → **same κ → same translated block**. Free dedup of translation.
4. **Translate.** Each riscv instruction → a few WASM ops over a guest-state struct
   (register file in a WASM memory region + the page-backed RAM). WASM has no `goto`, so:
   one WASM function per block; inter-block edges go through the dispatch table; intra-block
   control flow is structured (br/if + a relooper/stackifier).
5. **Cache.** `κ_block → WASM module bytes`, stored in the **content-addressed store**.
   Because it's κ-addressed, the cache is **shared across sessions, devices, and peers**:
   the first peer to hit a block translates it; everyone else fetches the JIT'd block by κ
   (content-addressed networking — the set-difference fetch). **Warm-up amortizes to zero.**

Standard DBT speedups apply on top: **block chaining** (direct-branch blocks jump
block→block with no dispatch round-trip), and the browser **JITs the hot WASM to native**,
so loops run at host speed.

## 2. Memory — UOR content-addressed pages (already built)

- Guest RAM + disk = κ-addressed Merkle pages (the existing snapshot/restore/COW path).
- Execution backs the **working set** into a WASM linear-memory "resident set"; cold pages
  fault in from the κ-store on access; dirtied pages get fresh κs at capture.
- **Where the huge memory savings come from:** the kernel, libc, and language-runtime pages
  are *byte-identical* across guests → stored **once**, shared COW. N guests cost
  `base + Σ(per-guest deltas)`, not `N × full machine`. The translation cache dedups the
  same way. A fleet of thousands of guests ≈ one base image + small deltas.

## 3. Privileged ops — the hypervisor trap

`ecall` / MMIO / CSR / page-fault terminate the block and exit to the dispatch loop, handled
in Rust like a hypervisor handles a trap: I/O → `fetch` / WebSocket / OPFS; devices → virtio
models; faults → page-in from the κ-store. The guest runs unprivileged-fast; only the
privileged edge is mediated.

## 4. O(1) compute — κ-memo over the translator

`run_memoized` (exists) keys `(state κ, input) → result-state κ`, served by `restore` with
zero re-execution. It composes with the translator at three grains:
- **block** — translate once (κ-translation cache),
- **trace/state** — a deterministic command's result served whole (κ-memo),
- **page** — identical memory stored once (UOR dedup).
Deterministic work is never done twice, anywhere.

## 5. Why it feels magical (light · low-latency · any browser)

- **Light** — page dedup + shared translation cache ⇒ a guest costs its *delta*, not a VM.
- **Low-latency** — near-native execution (JIT) **+** O(1) state restore (state = a κ) **+**
  O(1) memo **+** a warm, globally-shared κ-translation cache (no per-guest warm-up).
- **Any browser** — pure web standards: WASM, OPFS, `fetch`, WebSocket. No native plugin.
- **General-purpose** — it runs *unmodified* guest binaries (any ISA you translate), so it's
  a real computer (a "virtual internet computer"), not a language sandbox.

---

## 6. Phased plan (honest — a correct fast DBT is serious engineering)

- **Phase 0 — prove near-native in-browser, cheaply.** Run the agent's Python core on
  **Pyodide** (CPython→WASM, JIT'd to host). Snappy Hermes core *today*, no JIT to build —
  validates the thesis and ships a fast path immediately.
- **Phase 1 — translator MVP.** riscv64 *integer subset*, per-block dispatch, κ-cache.
  Benchmark a hot loop vs the interpreter; prove the κ-cache hit (block translated once).
- **Phase 2 — make it fast.** Block chaining + the page-backed resident memory (COW from the
  κ-store); float / atomics / CSRs.
- **Phase 3 — make warm-up free.** Promote the translation cache to a **shared κ-store across
  peers**; boot a warm-cache kernel near-instantly (fetch JIT'd blocks by κ).
- **Phase 4 — unify.** Wire snapshot (state = κ) + κ-memo into the translator → the full
  content-addressed Type-1 hypervisor.

## 7. Reuse & risks

- **Reuse:** the existing emulator's per-instruction semantics become the **translation
  templates** (correctness is already encoded); the UOR page store + snapshot + run_memoized
  already exist as the memory/compute substrate. The DBT slots in as the *execution engine*.
- **Risks:** WASM modules are immutable (instantiation overhead → translate in **regions**,
  not one-block-at-a-time, and reuse instances); structured control flow (relooper);
  self-modifying / JIT'd guest code invalidates blocks by κ (re-derive on write). Start with
  the integer subset + a real benchmark and let the κ-cache + dedup numbers justify each phase.
