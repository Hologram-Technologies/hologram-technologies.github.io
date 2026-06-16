# ADR-0106 — Holo Session v2: sovereign at rest, seamless for every user (guests included)

Status: **LANDED + Node-witnessed 33/33** at `system/tools/holo-session-witness.mjs` (in-memory adapters + a REAL AES-GCM cipher + a fetch spy). Amends [ADR-0104](0104-holo-session-persistence.md). The encrypted realm core, the guest realm + one-sign-in claim, the seq guard, v1→v2 migration, quota-graceful saves, and the opt-in app-state handshake all land + are witnessed. The `#holo-session` conformance row is updated to v2 (same witness, gate LIVE). **Deferred** (the established pattern): the `os-closure.json` κ-pin for the new served modules, and whole-catalog adoption of the per-app handshake (one import per app).

Relates: [[holo-session-persistence-adr]] (ADR-0104, v1 — this is its v2) · ADR-0105 (the portable cross-device IPFS leg — orthogonal: it seals a PLAINTEXT manifest by explicit user export) · ADR-0026 (the local κ-store) · `holo-login.mjs` (the operator secret the vault key derives from) · ADR-0084 (κ-memo) · `holo-privacy.js` (the PBKDF2→AES-GCM pattern reused).

## Context

ADR-0104 persists a signed-in operator's experience device-locally (witnessed 23/23). The raised bar: seamless + automatic for **every** user; cover every κ-object / tab / **application's** state; **guests persist too** and a single sign-in *claims* their work; and **100% sovereign** — no egress, and on a shared browser profile **not readable by another operator**.

A Pass-1 audit of the running code (grounded, not optimistic) produced this gap table:

| Experience axis | Captured (v1)? | Isolated per operator? | Private at rest? | Verdict (v1) |
|---|---|---|---|---|
| Holospace tabs (order, active, addr, pin/group) | ✅ | ✅ (per-op head) | ❌ plaintext | covered, not confidential |
| Per-tab world snapshot (open windows/apps) | ✅ | ✅ | ❌ | covered, not confidential |
| Shell settings + widget boards (allowlist) | ✅ | ⚠️ live localStorage shared | ❌ | drift + shared-LS risk |
| App-internal state (sandboxed iframes) | ❌ | ❌ per-origin, shared | ❌ | **gap + privacy hole** |
| User's durable κ-objects (`holoStore`) | ❌ | ❌ device-wide store | ❌ | **coverage + privacy gap** |
| Guest work | ❌ clean default | n/a | n/a | **gap (the headline ask)** |
| Multi-tab concurrency | last-writer, no guard | — | — | **race risk** |
| At-rest confidentiality | — | — | ❌ plaintext IndexedDB | **gap** |

Three findings forced the design: apps are sandboxed iframes with per-origin storage the shell can't read (no save protocol existed); the κ-store is one device-wide content store (never operator-scoped); and after sign-in the seed is **discarded** (no key in memory). The load-bearing tension: at-rest confidentiality against a co-profile attacker requires a key only the operator can produce (their secret) — but any key derivable at boot (for silent reload-restore) is, by definition, also readable by a co-user with devtools. **User decisions:** at-rest = **Max sovereign** (encrypt under the sign-in secret; restore post-unlock); app coverage = **opt-in handshake**.

## Decision

**Realms.** One mechanism for a guest and an operator. `activeRealm()` is the operator κ when **unlocked**, else a per-device **guest realm** (`"guest:"+deviceHex`). A guest (or a signed-in-but-locked session) autosaves to the device-key realm; an unlocked operator to their vault realm. So no work is ever lost while locked, and a guest gets persistence with zero action.

**At-rest encryption (Max sovereign).** The manifest is **AES-GCM sealed before it touches the κ-store** (`holo-session.mjs` `makeCipher`, reusing the `holo-privacy.js` PBKDF2→AES-GCM pattern). The IV is **synthetic** — `HMAC-SHA256(macSubkey, plaintext)[:12]` — so an identical experience seals to an identical κ (κ-memo preserved) while distinct plaintext gets a distinct IV (the AES-GCM-SIV safety property; we don't claim RFC 8452). Two subkeys are split from the raw key so AES and the IV-MAC never share a key. The **operator key** is `PBKDF2(secret, salt=SHA-256(operator‖deviceSalt), 210k)` from the secret entered at sign-in/unlock — **never persisted**. The **device key** (guest/locked) is a random 32-byte key in localStorage: integrity + copied-store protection, honestly **not** confidential vs this profile's own devtools (documented). Stored bytes are ciphertext; restore re-derives `sha256(ct)==κ` (L5) then decrypts (wrong key / tamper → null → clean default) then checks device binding.

**Guest → one-sign-in claim (the headline).** `claim({fromRealm, toRealm, ...})` reads the guest manifest (device key), re-seals it under the operator key, writes the operator head, then consumes the guest head — write-new-then-delete-old, so a crash leaves the guest re-claimable. Precedence (shell): a **returning** operator (existing realm) restores their saved world; a **new** operator (no realm) keeps the guest work they just built. The live desktop never blinks to empty.

**Battle-hardening.** A per-realm `seq` (in the head pointer, **out of the canonical body** so cross-device dedup, ADR-0105, is untouched) + writing-tab id → a stale second tab does not clobber a newer save; the shell also only autosaves the **visible** tab (hidden tabs flush on `pagehide`). A `holo:v` schema version + a v1→v2 migration (a v1 plaintext manifest, with a legacy bare-κ head, restores forward, never dropped). Quota-graceful saves: a `store.put` error returns an honest `{ok:false, why:"quota"}` and leaves the last good snapshot + head untouched.

**App-state opt-in handshake.** A new shell↔app protocol (sibling to `holo-files`/`holo-live-edit`): shell→app `{t:"holo-session:save"}`, app→shell `{t:"holo-session:state", state}`, shell→app `{t:"holo-session:restore", state}`, plus `holo-session:ready`. On flush the shell collects each open app's state (best-effort, timed) into that app's **world node** (`node.appState`) — so it rides the world snapshot and inherits the realm's encryption. An app participates with ONE import (`holo-session-client.mjs` → `holoSession({save, restore})`). A non-adopting app keeps its per-origin storage — an honest, documented boundary, never faked.

## Sovereignty & honest boundaries (named, not faked)

- **Nothing leaves the device** — no fetch on any path (Law L4), witnessed by a fetch spy across seal/save/restore/claim/key-derive. Cross-device is ADR-0105's axis (a plaintext IPFS export by explicit user action), orthogonal to this local encryption.
- **A bare reload cannot silently restore an operator** — the Max-sovereign trade. Restore is post-unlock (one biometric/passphrase). A guest/locked session still restores its device-realm seamlessly, so nothing is lost; the sovereign world materializes on unlock.
- **A non-adopting app's internal state is not operator-scoped** (per-origin storage) — the handshake closes it per-app; whole-catalog adoption is staged.
- **The user's durable κ-objects** are captured where referenced by the world snapshot; a blanket operator-partition of the device-wide content store is out of scope (documented).
- **The device key** (guests) is integrity + copied-store protection, **not** secrecy against this profile's devtools — a guest who wants confidentiality signs in (one tap), which claims + re-keys their work.

## Witness

`tools/holo-session-witness.mjs` (33/33) drives the core with in-memory `kv`/store + a real `makeCipher` + a fetch spy: encrypted round-trip of every axis incl. per-app state byte-for-byte; ciphertext-at-rest + wrong-key/tamper → clean default; κ-memo determinism; guest→claim zero-loss + consumed head + zero-bleed to another operator + claimed data not device-readable; per-operator + same-machine-only isolation; the seq concurrency guard; v1→v2 migration; quota-graceful; and no egress on any path.

## Files

- `os/usr/lib/holo/holo-session.mjs` — encrypted realm core (SIV `makeCipher`, `deriveOperatorKeyBytes`, `guestRealm`, `save`/`restore`/`claim` with cipher + seq + migration + quota, browser bindings `unlockOperatorKey`/`claimGuestRealm`/`restoreOperator`/`activeRealm`). Preserves the ADR-0105 hooks.
- `os/usr/lib/holo/holo-session-client.mjs` — **new** — the ~20-line app-side handshake helper.
- `os/usr/share/frame/shell.html` — every-user autosave (active realm) + guest boot restore + `onSignIn` claim wired into the greeter's `go()` + app-state collect/dispatch + visibility-gated autosave + reset on the active realm.
- `tools/holo-session-witness.mjs` (+ result), `os/etc/conformance.jsonld` (`#holo-session` → v2), spec `docs/specs/holo-session-persistence.md`.

Composes ADR-0104/0105/0026/0084 + `holo-login.mjs` + `holo-privacy.js`; grounded in Laws L1/L4/L5; mints only `holo:SessionManifest` (now encrypted at rest). Spec at [`../specs/holo-session-persistence.md`](../specs/holo-session-persistence.md).

To adopt the handshake in an app (the one-import recipe):
```js
import { holoSession } from "/_shared/holo-session-client.mjs";
holoSession({ save: () => editor.getValue(), restore: (s) => { if (s != null) editor.setValue(s); } });
```
