# Holo Forge Unified — cut-over checklist (ADR-0114)

The net-new logic of ADR-0114 is built and witnessed (S0 8/8 integration · S1 9/9 · S2 11/11 · S3 7/7, all green). This is the **mechanical** execution list to wire it into the live OS. Everything here is either a behaviour-preserving edit to a sealed/app file (needs a reseal) or a pure addition. Each step states its **byte/κ impact** and its **reseal scope**. Do them in order; re-run the four witnesses after each code step.

Built artifacts (the things being wired):
- `holo-apps/apps/q/forge/holo-forge-seal.mjs` — `sealHolo` (one format-agnostic .holo writer) + `forgeToHolo`/`detectFrontEnd` (the ModelFrontEnd seam). Witness `holo-forge-seal.test.mjs`.
- `holo-os/system/os/usr/lib/holo/q/holo-hf-ingest.mjs` — in-browser HF range ingestion. Witness `tools/holo-hf-ingest-witness.mjs`.
- `holo-os/system/os/usr/lib/holo/q/holo-q-authz.mjs` — the authorization gate. Witness `tools/holo-forge-authz-witness.mjs`.
- `holo-os/system/os/usr/lib/holo/q/holo-q-acquire.mjs` — `acquireSpecialist` (the one sanctioned skill→bound path). Witness `tools/holo-q-acquire-witness.mjs`.

---

## Step 1 — Define the GGUF ModelFrontEnd (pure addition, no reseal of sealed files)

Add to `holo-apps/apps/q/forge/holo-forge-seal.mjs` (it already imports nothing from the GGUF forge; add the import + export):

```js
import { forgeGguf } from "./gguf-forge.mjs";
import { parseGgufHeader } from "../qvac-ingest.mjs";

export const ggufFrontEnd = {
  name: "gguf",
  detect: (h) => h[0] === 0x47 && h[1] === 0x47 && h[2] === 0x55 && h[3] === 0x46, // "GGUF"
  forge: (bytes) => {
    const f = forgeGguf(bytes);
    const headerBytes = bytes.subarray(0, parseGgufHeader(bytes).dataOffset);
    return { arch: f.arch, sourceRoot: f.rootKappa, tensors: f.tensors, blocks: f.blocks, ext: { key: "gguf.header", bytes: headerBytes } };
  },
};
```

(A Whisper front-end is `forgeWhisper` + `parseWhisperHeader` with `ext.key:"ggml.whisper.header"` and `extraMeta:{hparams, mel, vocabCount}`; an ONNX front-end is the deferred S?-ONNX work, gated on P3.7.)
**Impact:** new export only. **Reseal:** the q-forge app (Step 6 matrix) since a forge-app file changed. Witnesses unaffected.

---

## Step 2 — Wire `acquireSpecialist`'s `ctx.forge` (the shell/Q boot that builds the ctx)

Wherever Q constructs the acquire context (the shell's Q boot, e.g. alongside `holo-voice.js`/the mux wiring), provide `forge` as the S1→S0 composition. In-browser these modules load by their served route, not a fs path:

```js
import { ingest } from "/usr/lib/holo/q/holo-hf-ingest.mjs";
import { forgeToHolo, ggufFrontEnd } from "<forge-app>/holo-forge-seal.mjs";
import { pinGuard } from "/usr/lib/holo/q/holo-q-authz.mjs";

const acquireCtx = {
  pickSpecialist,                                   // ADR-0084 mux
  authCtx: { manifest, conscience, detail, consent, crypto },   // Steps 4/5
  cache: warmModelCache,                            // Map repo→holo (OPFS-backed → instant warm)
  async forge(model, { pinKappa, onProgress }) {
    const man = await ingest(model.id, { fetch, token, sha256hex, kput, onProgress });  // S1: HF → κ bytes
    if (pinKappa) pinGuard(pinKappa, man.kappa);                                          // S2: provenance BEFORE compute
    const bytes = await kget(man.kappa);                                                 // assembled file
    const { holo, rootHolo } = await forgeToHolo(bytes, [ggufFrontEnd]);                  // S0: forge + one sealer
    return { kappa: rootHolo, bytes: holo, sourceKappa: man.kappa };
  },
  async makeProvider(holo) {                        // S0→runtime: openHoloStream → holo-brain-engine
    const session = await openHoloStream(rangeReaderOver(holo.bytes));   // or stream from the κ-store
    return createHoloBrain({ session });
  },
  bindSpecialist,                                   // ADR-0084 mux
};
```

**Note on what `manifest.allow[].kappa` pins:** the **source file κ** (`man.kappa` = sha256 of the GGUF), checked right after ingest, before spending forge compute. The forged `.holo` root (`rootHolo`) is the resulting model identity. Manifest authors compute `man.kappa` from the HF file (stable, forge-version-independent).
**Impact:** wiring only. **Reseal:** whatever app owns the boot file edited.

---

## Step 3 — Cut `writeHolo` over to `sealHolo` (BYTE-IDENTICAL, app reseal)

`holo-apps/apps/q/forge/holo-archive.mjs` — replace the body of `writeHolo` (lines 25–85) with the 3-line delegation:

```js
import { sealHolo } from "./holo-forge-seal.mjs";
export function writeHolo(ggufBytes) {
  const f = forgeGguf(ggufBytes);
  const headerBytes = ggufBytes.subarray(0, parseGgufHeader(ggufBytes).dataOffset);
  return sealHolo({ arch: f.arch, sourceRoot: f.rootKappa, tensors: f.tensors, blocks: f.blocks, extKey: "gguf.header", extBytes: headerBytes });
}
```

`sealHolo` was extracted verbatim from this function → **output is byte-identical** → existing GGUF `.holo` κs DO NOT change. Keep `readHolo`/`openHoloStream` untouched.
**Verify:** the `holo-forge-seal.test.mjs` integration witness already proves `sealHolo`↔real-reader; optionally seal one real GGUF both ways and `cmp` the bytes. **Reseal:** q-forge app.

---

## Step 4 — Cut Whisper sealing over to `sealHolo` (BYTE-IDENTICAL via `extraMeta`, app reseal)

`holo-apps/apps/q/forge/seal-whisper-holo.mjs` — replace the hand-rolled archive (lines 44–77) with:

```js
import { sealHolo } from "./holo-forge-seal.mjs";
const { holo, rootHolo } = sealHolo({
  arch: "whisper", sourceRoot: f.rootKappa,
  tensors: [...f.tensors, { name: "__mel__", kappa: f.plan.mel.kappa, nbytes: f.plan.mel.nbytes }],  // mel body appended last, as today
  blocks: f.blocks,                                  // ensure f.blocks has the mel κ→bytes (it does via plan.mel)
  extKey: "ggml.whisper.header", extBytes: headerBytes,
  extraMeta: { hparams: f.hparams, mel: { n_mel: f.plan.mel.n_mel, n_fft: f.plan.mel.n_fft, kappa: f.plan.mel.kappa.split(":").pop() }, vocabCount: f.vocabCount },
});
writeFileSync(OUT, holo);
```

`extraMeta` is spliced between `sourceRoot` and `nTensors`, reproducing Whisper's exact meta field order — **byte-identical**, Whisper `.holo` κ unchanged. (One subtlety: today the mel body is pushed AFTER the tensor loop as a separate body; modeling it as a trailing pseudo-tensor `__mel__` preserves first-use order. Confirm the `order[]` entry shape matches — today the mel is NOT in `order`, only in `meta.mel`. If byte-identity must be exact, instead pass `tensors: f.tensors` and add the mel body via a small `extraBodies` param to `sealHolo`; the `extraMeta` already carries `mel.kappa`. **This is the one place to diff bytes before trusting identity.**)
**Reseal:** q-forge app.

---

## Step 5 — Register conformance rows (3 rows + gate wiring)

The three OS-side witnesses (in `tools/`, exit 0/1) become gate rows. **S0's seal witness stays app-local** (it lives in `holo-apps/`, like `gguf-forge.test.mjs`), not an OS gate row.

Add to `holo-os/system/os/etc/conformance.jsonld` `conforms` array:

```jsonc
{ "@id": "https://hologram.os/conformance/os2#forge-hf-ingest", "@type": "hosc:ConformanceAssertion",
  "name": "In-browser HuggingFace ingestion range-streams (resume-able) and is honest about the range/CORS fallback; maps auth/gated/404; registers κ-blocks.",
  "hosc:authority": "holospaces Laws L1/L5 · ADR-0114 · ADR-0092 · HF Hub API · HTTP Range/206 (RFC 7233)",
  "hosc:witness": "tools/holo-hf-ingest-witness.mjs", "hosc:required": true, "hosc:category": "Compute & verifiable builds" },

{ "@id": "https://hologram.os/conformance/os2#forge-acquire-authz", "@type": "hosc:ConformanceAssertion",
  "name": "A model is auto-acquirable only on a signed, κ-addressed skill→model manifest within hard caps, or off-manifest only with explicit consent; refuses unsigned/tampered/oversized/off-manifest and fails closed.",
  "hosc:authority": "holospaces Laws L1/L5 · ADR-0114 · ADR-0033 · ADR-0111 (secp256k1 M-of-N) · RFC 8785 JCS",
  "hosc:witness": "tools/holo-forge-authz-witness.mjs", "hosc:required": true, "hosc:category": "Compute & verifiable builds" },

{ "@id": "https://hologram.os/conformance/os2#q-acquire", "@type": "hosc:ConformanceAssertion",
  "name": "Q self-acquires a skill end-to-end with the authorization gate structurally on the critical path (forge never runs on a refusal), pinned-κ guarded before bind, honest fallback, warm reload network-free.",
  "hosc:authority": "holospaces Laws L1/L5 · ADR-0114 · ADR-0084 · ADR-0033",
  "hosc:witness": "tools/holo-q-acquire-witness.mjs", "hosc:required": true, "hosc:category": "Compute & verifiable builds" }
```

Add the three witness paths to the `LIVE_EXIT` set in `holo-os/system/tools/gate.mjs` (line ~25; they gate on exit code, no committed `.result.json`):

```js
"tools/holo-hf-ingest-witness.mjs", "tools/holo-forge-authz-witness.mjs", "tools/holo-q-acquire-witness.mjs",
```

Run `node tools/gate.mjs` → expect the three new rows green; the required-row count rises by 3.
**Reseal:** OS closure (conformance.jsonld + gate.mjs are OS files) — re-lock + re-pin per the OS process.

---

## Step 6 — Production crypto + consent (replace the witness stand-ins)

- `authCtx.crypto.verify` → the real `secp256k1.verify` (the same import `holo-anchor.mjs` uses), and `crypto.sha256hex` → the OS `sha256hex` (already used everywhere). The witness used a labelled test scheme; the gate logic is verify-fn-agnostic, so this is a drop-in.
- `authCtx.consent` → the **host-asserted** shell consent resolver (NOT an app's — the ADR-0090 host-asserted-identity rule). A one-time per-acquisition prompt: "Q wants to acquire `<repo>` (`<params>`, `<license>`) for skill `<skill>`. Allow once?"
- `authCtx.manifest` → the signed skill→model manifest, resolved by its pinned κ and cached. Sign it M-of-N with the **same operator keys** that sign the OS-closure anchor (ADR-0111) — one trust root.

---

## Step 7 — (Deferred, GOVERNED) the P9 acquisition red-line is a constitutional AMENDMENT, not an edit

`holo-conscience.js` `PRINCIPLES` (lines 39–64) is **cryptographically pinned** — `constitution-enforce-witness`/`boot-constitution-witness` re-derive each principle's κ against committed pins, and the constitution root commits to the array. Adding a P9 "Model acquisition" red-line therefore requires **re-sealing `constitution/constitution.uor.json` + re-pinning + the governed succession process (ADR-0033)** — it is NOT a mechanical edit, and **v1 does not need it**: admission is already decided in `authorize()` (manifest + caps + explicit consent), with the conscience consulted as defense-in-depth (and it still fails closed when unsealed). Treat P9 as the long-term constitutional form, to be proposed through governance — not part of this cut-over.

---

## Step 8 — (Browser session) the one genuinely-unsettled empirical: live HF CORS

In a real browser tab, run `ingest()` against a real public GGUF (e.g. `Qwen2.5-Coder-0.5B-Instruct-GGUF`) and observe:
- if `huggingface.co/.../resolve/main/<file>` answers cross-origin **Range with 206** → fully serverless ingestion holds;
- if it returns **200 whole** (`servedWhole:true`) → range streaming degrades to whole-file (memory risk for multi-GB);
- if it **throws** (no CORS) → route through the host-proxy `/sc/*` precedent (a relay in the path — honest "not literally serverless").

This decides only the *transport*, not the design. Document the observed behavior in ADR-0114's honest-boundaries.

---

## Reseal / re-pin matrix

| Edited file | Closure | Action |
|---|---|---|
| `holo-apps/apps/q/forge/holo-forge-seal.mjs` (Step 1), `holo-archive.mjs` (Step 3), `seal-whisper-holo.mjs` (Step 4) | q-forge app | `node tools/relock-app.local.mjs <forge-app-id>` → new root κ → re-pin |
| `holo-os/.../q/holo-hf-ingest.mjs`, `holo-q-authz.mjs`, `holo-q-acquire.mjs` (already created) | OS closure | re-lock OS closure + re-pin (new served modules) |
| `os/etc/conformance.jsonld`, `tools/gate.mjs` (Step 5) | OS closure | re-lock + re-pin; run `node tools/gate.mjs` |
| shell Q-boot wiring (Step 2) | shell app | reseal the shell |
| `constitution.uor.json` (Step 7) | constitution | **governed amendment — out of scope for v1** |

## Acceptance

- The four witnesses stay green (`node` each).
- `node tools/gate.mjs` shows `#forge-hf-ingest`, `#forge-acquire-authz`, `#q-acquire` green; required count +3.
- A real browser run: Q detects a coding gap → acquires `Qwen2.5-Coder-0.5B GGUF` (authorized) → forges → binds → answers; **reload is network-free**; an unsigned/oversized model is refused with a fallback to main.
