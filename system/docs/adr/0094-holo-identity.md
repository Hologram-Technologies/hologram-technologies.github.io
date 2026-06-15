# ADR-0094 — Holo Identity: one sovereign, post-quantum κ-rooted identity for humans and agents

Status: Proposed (crypto foundation LANDED + witnessed; surface unification staged)
Date: 2026-06-15

## Context

Login, access and logout are implemented three times across the OS — the **Greeter**
(`frame/login.html`), the **Shell** (`frame/shell.html`: `#ident`, `#operator`, `holo.session`,
guest-by-default share-to-run), and the **Wallet** (`apps/wallet/index.html`: biometric sign-in →
`login.enroll`, unlock, lock, reset). They already converge on a shared substrate —
`holo-identity.mjs` (κ session: `openSession`/`verifySession`, `did:holo:sha256`), `holo-login.mjs`
(seed → wallet → vault → operator), `holo-ceremony.mjs` (first-run sovereign claims + social graph),
`holo-webauthn.mjs` (passkey/PRF), `holo-gov.js`/`holo-terms.js`/`holo-privacy.js` (the capability
gate · consent · disclosure), `holo-mind.mjs`/`Q.agent` (the governed agent door) — but each surface
re-derives identity logic, and the cryptography is classical-only (Ed25519/X25519/AES). The threat
model includes **harvest-now-decrypt-later** against the long-lived seed/vault.

## Decision

Unify all three under **Holo Identity** — one sovereign, self-verifying κ identity for **Player
Characters (humans)** and **Non-Player Characters (agents)** — and root it in a **hybrid,
crypto-agile, post-quantum** floor. 100% serverless, content-addressed, default-deny.

### 1. One κ root, crypto-agile and post-quantum (LANDED, witnessed)

- Identity **is** the content address of a **versioned hybrid public-key object** —
  `did:holo:sha256(canonical{ scheme, ed25519Pub, mldsaPub })` — projected to `did:key`. Because the κ
  commits to the *scheme*, verify-by-re-derivation (Law L5) verifies the **right algorithm**, and a
  scheme can be retired/added without reinterpreting past objects (crypto-agility).
- **Hybrid by default** (a break in either family is not a break of the system):
  - signatures **Ed25519 ‖ ML-DSA-65** (FIPS 204) — valid only if *both* verify; **SLH-DSA** (FIPS 205)
    as a hash-based backup signer;
  - key establishment **X25519 ‖ ML-KEM-1024** (FIPS 203), combined via a SHA-256 KDF;
  - at-rest **AES-256-GCM**, its data-key encapsulated by the hybrid KEM — so today's harvested vault
    ciphertext stays closed to a future quantum adversary.
- Realized in `holo-pqc.mjs` over a vendored, audited, no-CDN bundle (`holo-pqc/holo-pqc.bundle.mjs`,
  `@noble/post-quantum@0.6.1` + `@noble/curves` x25519 — same lineage as `wdk-crypto`). **No custom
  cryptography.** Proven by `system/tools/holo-pqc-witness.mjs` (15 checks).

### 2. One lifecycle, three verbs (STAGED)

`signIn` (biometric enroll → mint/open the κ identity + signed session token) · `access`
(capability-gated, default-deny via the consent gate) · `signOut` (revoke the live session token; the
sovereign vault persists on-device). Greeter, Shell and Wallet call the **same** seam; only chrome
differs. Sessions are signed hybrid (Ed25519 ‖ ML-DSA) and carried in `holo.session`.

### 3. Player vs Non-Player Characters (STAGED)

One root, two faces, recorded explicitly as `subjectType: "pc" | "npc"` in the identity record and the
session token:
- **PC (human)** — a person behind a passkey/biometric; holds the seed; interactive, human-gated.
- **NPC (agent)** — its own κ + keypair, **delegated** capabilities (VC-style), minted *by* a PC with a
  content-addressed lineage to its issuer; routed through the fail-closed `Q.agent` door — reads open,
  every spend/sign through the same human-approval gate a PC sees. An NPC can never escalate past its
  delegated, content-addressed capability set.

### 4. Interop (seams only; honest gaps)

W3C **DID Core / VC Data Model / JSON-LD / PROV-O** are the carriers (κ = DID, Terms/consent = VC
capability, ceremony = trust graph, PROV-O = PC→NPC lineage). External agentic ecosystems
(NANDA-aligned: Hermes, OpenClaw, Virtuals OS, MOCA Proof) are **interop targets via export/import**,
**not** bundled integrations — anything unwired is a stated gap, never an implied verification.

## Laws & standards

holospaces **L1** (identity is content), **L3** (idempotent κ), **L4** (anchor-by-reference, vendored
audited crypto, no server/CDN, no minted pillar), **L5** (re-derive + verify, default-deny). W3C
DID/VC/JSON-LD/PROV-O. NIST **FIPS 203/204/205**; **NSA CNSA 2.0** posture (ML-KEM + ML-DSA, hybrid
during transition).

## Consequences / honesty

- **Done + witnessed:** the serverless hybrid-PQC primitive and the self-verifying identity κ
  (`holo-pqc.mjs` + bundle + `holo-pqc-witness` 15/15).
- **Staged:** the unified facade wiring into Greeter/Shell/Wallet; the PC/NPC record + delegation; the
  migration of the existing Ed25519-only `holo-login` vault/κ onto the hybrid scheme (must preserve
  existing identities — the versioned κ object is designed for exactly this).
- **Classical-only by necessity:** **WebAuthn passkeys are classical** (alg -7/-257) and there is **no
  standardized PQC passkey** yet — the passkey stays the device-binding factor and the PQC secrets are
  wrapped *under* its PRF output (hybrid). We do **not** claim a post-quantum passkey.
- **Not certified:** FIPS-*algorithm*-aligned, **not** CMVP-validated. Production use needs a
  cryptographer review.

## External authorities

NIST FIPS 203 (ML-KEM) · FIPS 204 (ML-DSA) · FIPS 205 (SLH-DSA) · NSA CNSA 2.0 · W3C DID Core ·
VC Data Model · JSON-LD · PROV-O · WebAuthn/FIDO2 · paulmillr `@noble/post-quantum` + `@noble/curves`
(MIT, audited) · the holospaces Laws (https://github.com/Hologram-Technologies/holospaces).
