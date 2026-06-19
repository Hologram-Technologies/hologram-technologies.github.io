# Holo Forge — model-acquisition authorization gate (ADR-0114 S2)

The implementable spec for the one item ADR-0114 names as gating: **before Q forges and runs a HuggingFace model it acquired on its own, an `authorize()` step must accept the acquisition.** Without it, Q downloading and executing arbitrary HF weights is a liability, because **L5 re-derivation proves integrity (the exact bytes), never provenance (whether those bytes should run).** A correct-but-hostile model hashes to its κ and passes every existing gate. This spec adds the missing *admission* step. No new addressing, no new transport — one signed manifest, one gate function, one conscience rule, one witness.

Status: **SPEC — design only, ready to build.** Grounded in the real signatures below; nothing landed. Relates: ADR-0114 (the decision), ADR-0084 (`holo-q-mux.js`, the discover/pick spine), ADR-0096 (the Function→Model→κ doctrine this manifest realizes), ADR-0033 (`holo-conscience.js`, the fail-closed gate), ADR-0111 (`holo-anchor.mjs`, the secp256k1 M-of-N machinery reused for signing).

## Threat model — what this defends, what it does not

- **Defends:** Q auto-acquiring a model that is malicious *as a model* (jailbroken, backdoored, prompt-injecting, license-violating) or *as a resource* (oversized, draining device/network). L5 cannot see any of this — it only sees that the bytes match the κ that was asked for.
- **Defends:** a swapped manifest (an attacker substituting the allowlist). The manifest is **signed M-of-N and κ-addressed**; an unsigned or under-threshold manifest fails the gate closed.
- **Does NOT defend:** a model that is on the signed allowlist but later found bad — that is a manifest-revocation/rotation event (re-sign a new manifest κ), not a runtime check. State this honestly; the manifest is only as good as its signers (the same trust root as ADR-0111's boot authority).
- **Does NOT claim** to inspect weights for hidden behavior — no one can, at scale. The gate is *provenance + bounds + consent*, not model analysis.

## The grounded touch-points (real signatures)

- `pickSpecialist(taskId, opts)` (`os/usr/lib/holo/q/holo-q-mux.js:103`) returns a **plan**: `{ task, specialist: { id, score, runnable, paramsEstimate, pipeline, downloads, likes } | null, alternatives, fallback, reason }`. It is a *pure discovery* function and must stay pure + witnessed.
- `bindSpecialist(taskId, provider)` (`:125`) registers a built provider. Pick and bind are **separate** — the gate lives in the orchestration *between* them, not inside either.
- `evaluate(decision, { posture, principles })` (`os/usr/lib/holo/holo-conscience.js:117`) reads only `WORLD_VARS` (`:34`), **fails closed when the constitution is unsealed**, and returns `{ outcome: "accept"|"block"|"caveat", blocked, caveats, verdicts, sealed }`. It **does not read an `action` field** — confirmed; today `holo-qvac.js` passes `action:"qvac:"+cap` and the gate ignores it, so acquisition is currently ungoverned.
- `PRINCIPLES` (`holo-conscience.js:39`) is an array of `{ id, title, odrl, redLine, statement, governs, relaxedBy }` — extensible.
- M-of-N verify (`holo-anchor.mjs:108`): over a pinned key set, `secp256k1.verify(fromHex(s.sig), msg, fromHex(key))`, accept when `signers.size >= authority.threshold`. Reused verbatim in shape.
- `registry.uor.json` (`os/usr/lib/holo/holo-forge/registry.uor.json`) is the κ-addressed JSON-LD registry shape (`@context` DID + security/data-integrity, `@type: [schema:DataCatalog, …]`, an entries array, root `id` = manifest κ). The manifest models on this.

## 1. The signed skill→model manifest

One κ-addressed, M-of-N-signed JSON-LD object — the concrete, signed realization of ADR-0096's Function→Model→κ table. It is the **authorization unit**: a model is auto-acquirable iff it matches an entry here.

```jsonc
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/data-integrity/v2",
    { "schema": "https://schema.org/", "hosc": "https://hologram.os/ns/conformance#" }
  ],
  "@type": ["schema:DataCatalog", "hosc:SkillModelManifest"],
  "schema:name": "Holo Forge — authorized skill→model manifest",
  "algo": "sha256",
  "v": 1,

  "policy": {
    "maxParams": "1.5B",           // hard ceiling for ANY auto-acquire (resource bound)
    "maxBytes": 1200000000,        // hard download/compile size cap
    "licenses": ["apache-2.0", "mit", "llama3", "qwen", "gemma"],  // open-license allowlist
    "offManifest": "consent"       // "deny" | "consent" — what to do for a not-listed pick
  },

  "skills": [
    {
      "skill": "code",
      "pipeline": "text-generation",
      "tags": ["code"],
      "maxParams": "1.5B",
      "allow": [
        { "repo": "onnx-community/Qwen2.5-Coder-0.5B-Instruct", "kappa": "did:holo:sha256:…" },
        { "repo": "onnx-community/Qwen2.5-Coder-1.5B-Instruct", "kappa": "did:holo:sha256:…" }
      ]
    },
    { "skill": "translate", "pipeline": "translation", "tags": ["translation"], "maxParams": "1B",
      "allow": [ { "repo": "Xenova/nllb-200-distilled-600M", "kappa": "did:holo:sha256:…" } ] }
  ],

  "authority": { "threshold": 2, "keys": ["<33B compressed pubkey hex>", "…"] },
  "commitment": "<32B hex = sha256(JCS(body-without-signatures))>",
  "signatures": [ { "key": "<hex>", "sig": "<64B compact hex>" }, "…" ],
  "id": "did:holo:sha256:<manifest root κ>"
}
```

- `kappa` per entry is **optional but preferred**: when present, the gate pins the *exact* model bytes (provenance + integrity); when absent, the gate authorizes the *repo id* and relies on L5 over whatever that repo currently resolves to (provenance of source, integrity of bytes, but the repo owner can change contents — note this weaker tier explicitly).
- `commitment` is `sha256(JCS(body))` with `signatures` excluded, exactly the `holo-anchor` idiom (RFC 8785 JCS). The manifest is itself a κ-object, healed/streamed like any other (ADR-0026/0076).

## 2. `authorize(plan, ctx)` — the gate

A new pure-ish function (deps injected) in a new module `os/usr/lib/holo/q/holo-q-authz.mjs`. It is the *only* sanctioned path from a discovery plan to a bind.

```js
// authorize(plan, ctx) -> { accept: boolean, tier: "pinned"|"repo"|"consent", reason, model? }
export async function authorize(plan, {
  manifest,                 // the parsed manifest object (resolved by κ + cached)
  verifyManifest,           // (manifest) => Promise<{ok}>  — §3, reuses holo-anchor M-of-N
  conscience,               // { evaluate }  — holo-conscience.js
  detail,                   // (repo) => Promise<{ params, bytes, license }>  — one HF detail fetch
  consent,                  // (req) => Promise<boolean>    — host-asserted one-time user consent
} = {}) {
  if (!plan?.specialist) return { accept: false, tier: "consent", reason: "no specialist in plan" };

  // (a) manifest must verify, or fail CLOSED
  const mv = await verifyManifest(manifest);
  if (!mv.ok) return { accept: false, tier: "consent", reason: "manifest signature invalid/absent" };

  const sk = (manifest.skills || []).find(s => s.skill === plan.task);
  const pick = plan.specialist;
  const d = await detail(pick.id);                       // real params, bytes, license

  // (b) hard resource + license bounds ALWAYS apply (manifest policy)
  const cap = numParams(sk?.maxParams || manifest.policy.maxParams);
  if (d.params > cap)            return { accept: false, tier: "consent", reason: `over param cap (${d.params}>${cap})` };
  if (d.bytes  > manifest.policy.maxBytes) return { accept: false, tier: "consent", reason: "over byte cap" };
  if (!manifest.policy.licenses.includes(d.license))     return { accept: false, tier: "consent", reason: `license ${d.license} not allowed` };

  // (c) on the allowlist? -> auto-accept (pinned if κ matches, else repo tier)
  const entry = sk?.allow?.find(a => a.repo === pick.id);
  if (entry) {
    const tier = entry.kappa ? "pinned" : "repo";        // pinned binds exact bytes downstream
    return { accept: true, tier, reason: "on signed allowlist", model: { ...pick, ...entry, ...d } };
  }

  // (d) off-manifest -> policy decides: deny, or conscience + explicit one-time consent
  if (manifest.policy.offManifest === "deny")
    return { accept: false, tier: "consent", reason: "not on allowlist; policy=deny" };

  const granted = await consent({ skill: plan.task, repo: pick.id, params: d.params, bytes: d.bytes, license: d.license });
  const verdict = conscience.evaluate({
    acquiresUnauthorizedModel: !granted,                 // red-line world-var (§4)
    authorizedAcquire: granted,                          // relaxes it
  });
  if (verdict.outcome === "block")
    return { accept: false, tier: "consent", reason: `conscience blocked: ${verdict.blocked.join(",")}` };
  return { accept: true, tier: "consent", reason: "off-manifest, user-consented", model: { ...pick, ...d } };
}
```

Acquisition orchestration (a new `acquireSpecialist` in `holo-q-acquire.mjs`, the only skill→bound path; keeps the witnessed `pickSpecialist`/`bindSpecialist` untouched):

```
plan      = await pickSpecialist(taskId, opts)          // pure discovery (ADR-0084, unchanged)
if !plan.specialist: return fallback (main model)        // never blocks (ADR-0084 honest-pending)
auth      = await authorize(plan, ctx)                   // ← THE GATE
if !auth.accept: return { fallback: "main", reason: auth.reason }   // refuse, fall back, never fake
holo      = await forgeToHolo(auth.model, { pinKappa: auth.tier === "pinned" ? auth.model.kappa : null })
provider  = openHoloStream(holo) -> holoBrainEngine
bindSpecialist(taskId, provider)                         // bind only AFTER authorize accepts
```

The `pinned` tier passes the manifest κ down to the forge so the streamed `.holo` is checked against the *signed-expected* κ, not just self-consistency — provenance enforced end-to-end.

## 3. `verifyManifest` — reuse the M-of-N verifier

No new crypto. Mirror `holo-anchor.mjs:108-118`:

```js
import { secp256k1 } from "…/btc-wallet…";   // same import holo-anchor uses
export async function verifyManifest(m) {
  if (!m?.authority?.keys?.length || !m.signatures?.length) return { ok: false };
  const body = { ...m }; delete body.signatures; delete body.id;
  const commit = sha256hex(jcs(body));
  if (commit !== m.commitment) return { ok: false, reason: "commitment mismatch" };
  const pinned = new Set(m.authority.keys.map(k => k.toLowerCase()));
  const msg = fromHex(m.commitment), signers = new Set();
  for (const s of m.signatures) {
    const key = String(s.key).toLowerCase();
    if (!pinned.has(key) || signers.has(key)) continue;
    try { if (secp256k1.verify(fromHex(s.sig), msg, fromHex(key))) signers.add(key); } catch {}
  }
  return { ok: signers.size >= m.authority.threshold };
}
```

The manifest's `authority.keys` SHOULD be the same operator key set that signs the OS-closure anchor (ADR-0111) — one trust root, not a new one.

## 4. Conscience extension (the off-manifest path)

Two new `WORLD_VARS` and one red-line principle in `holo-conscience.js` — additive, the gate stays fail-closed:

```js
// WORLD_VARS (:34) += "acquiresUnauthorizedModel", "authorizedAcquire"
{ id: "P9", title: "Model acquisition",
  odrl: "prohibition", redLine: true,
  statement: "Shall not auto-acquire and run a model that is neither on the signed manifest nor explicitly user-authorized.",
  governs: "acquiresUnauthorizedModel",
  relaxedBy: ["authorizedAcquire"] }
```

Because `evaluate` already fails closed when unsealed and treats `redLine` as a hard block, an off-manifest acquire with no consent is blocked structurally — same machinery as the PII red line. This is the first time the conscience actually *sees* an acquisition (closing the `action:"qvac:"` blindness noted in ADR-0114).

## 5. Witness + gate row

`tools/holo-forge-authz-witness.mjs` (Node, mock fetch + the REAL sealed conscience + REAL secp256k1, the ADR-0102 precedent). Assertions:

- `allowsListedModel` — a manifest-listed repo within caps → accept, tier `pinned` when κ present.
- `refusesUnlistedModel` — off-manifest + `policy.offManifest:"deny"` → refuse (falls back to main, never fakes).
- `refusesUnsignedManifest` — stripped/under-threshold signatures → fail closed, nothing acquires.
- `refusesTamperedManifest` — one flipped allow-entry byte → commitment mismatch → fail closed.
- `refusesOversizedModel` / `refusesBadLicense` — caps + license enforced even for a *listed* repo whose live detail exceeds them.
- `consentGrantsOffManifest` — off-manifest + `policy:"consent"` + granted consent + conscience accept → accept tier `consent`; **denied consent → block**.
- `failsClosedWhenConscienceUnsealed` — unsealed constitution → block regardless.
- `pinnedTierBindsExactKappa` — `pinned` acquisition forges against the signed κ; a substituted-byte stream is refused downstream (L5 + provenance).

Conformance row `#forge-acquire-authz` in `os/etc/conformance.jsonld` (`hosc:required: true`, category "Compute & verifiable builds"), registered in `gate.mjs`'s live set. **The `#q-acquire` row (ADR-0114 S3) must depend on this row being green** — Q's self-acquisition demo asserts `refusesUnsignedModel`, so the seamless loop cannot go green while acquisition is unsafe.

## Honest boundaries

- **The manifest is a curated central allowlist.** That is a deliberate trade: it is *signed, κ-addressed, and swappable* (a commodity, not an authority — the ADR-0113/0111 idiom), but someone must curate and sign it. The off-manifest consent path exists precisely so the allowlist need not be exhaustive; it degrades to "ask the user once," never to "silently run anything."
- **`repo` tier is weaker than `pinned` tier.** Authorizing a repo id trusts the repo owner not to swap contents; authorizing a κ pins the exact bytes. Prefer κ. The witness proves only the `pinned` tier binds exact bytes.
- **Consent is host-asserted.** The `consent()` resolver must be the shell's, not an app's — an iframe app cannot self-grant (the ADR-0090 host-asserted-identity rule).
- **This gates acquisition, not inference.** A bound model still runs under the normal conscience/receipt path for its *outputs*; this spec only governs *whether it may be acquired and bound at all*.
