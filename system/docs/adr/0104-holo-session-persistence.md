# ADR-0104 — Holo Session: per-operator, device-local experience continuity

Status: **LANDED + Node-witnessed 23/23** at `system/tools/holo-session-witness.mjs` (in-memory adapters + a fetch spy). The orchestrator (`os/usr/lib/holo/holo-session.mjs`), the shell restore-on-boot + autosave + flush wiring (`os/usr/share/frame/shell.html`), and the signed-in-only reset escape hatch all land + are witnessed. A `#holo-session` conformance row is added (`os/etc/conformance.jsonld`) and registered in the gate's live set. **Deferred** (the same staged step the recent ADR rows defer): the `os-closure.json` κ-pin for the new served module.

Relates: [[holo-home-desktop-holospace]] (ADR-0088, the desktop-as-holospace scene model whose `{world,layout}` snapshot is the open-surfaces axis) · [[holo-widgets]] (the per-holospace boards already keyed in localStorage) · ADR-0026 (the local κ-store `holo-kstore`, IndexedDB) · `holo-login.mjs` (the sovereign operator κ this keys on) · ADR-0084 (the κ-memo property the content-addressed manifest inherits) · ADR-0082 (PROV-O) · `holo-zk.js` (the selective-disclosure egress envelope — the named *future* axis for cross-device).

## Context

The ask: for **every signed-in user**, persist their **entire** Hologram OS experience between sessions — every widget on every holospace tab, every setting, every open surface — **provided they're on the same machine**. Make it feel like the machine remembered them: continuity, not a feature.

A first-principles look at the running shell found the experience is **half-persisted and not user-scoped**:

- Widget boards, board modes, wallpaper, voice prefs, and the playground flag already write to `localStorage` — which is inherently device-local and survives reload.
- But `localStorage` is shared across every operator on the machine (no per-user isolation), and the **holospace structure itself** — the `tabs[]` array (identity · title · κ-address · pinned/group · **order**), the active tab, and each tab's `{world,layout,focusedId}` snapshot (the **open surfaces**) — lives only in memory and is lost on reload.

Two facts shaped the design. (1) **There is no device identifier** in the system — identity (`holo-login.mjs`) is deliberately device-*agnostic* (a seed unlockable anywhere), so the `(user, device)` keying the ask implies needs a device-κ invented. (2) The local κ-store (`holo-kstore.mjs`: `kput`/`kget`/`kverify`/`kappaOf`) is exactly the right backing store — local IndexedDB, content-addressed, L5-verifying — so "same machine only" is satisfied by *staying in it* and never fetching.

## Decision

Capture the whole experience as **one PROV-O `holo:SessionManifest`, κ-sealed into the local κ-store**, captured on every meaningful mutation and rehydrated on authenticated boot — keyed to `(operator-κ, device-κ)`.

1. **The manifest is the single source.** `holo:experience` = the `tabs` (each a lean `{id,title,addr,home,pinned?,group?,snap:{world,layout,focusedId}}`), the `activeTab`, and a `settings` map captured from an **auditable localStorage allowlist** (`holo-widgets.*` · `holo.voice.*` · `holo:wall*` · `holo-vinyl.*` · `holo.q.*` · `holo.playground`). One PROV-O entity, sealed in `os/usr/lib/holo/holo-session.mjs`'s `createSession` core.

2. **κ = SHA-256 of its own canonical (RFC 8785 JCS) bytes (L1, L3).** An identical experience seals to an identical κ, so `store.put` is idempotent — the κ-memo / O(1) property every content-addressed object has, here for free. Same primitive (`jcs` from `holo-uor.mjs`) the receipts use.

3. **Keyed to `(operator-κ, device-κ)`.** The operator κ is the signed-in session's operator (`holo.session.operator`, non-guest — `signedInOperator()`); a **guest or the device's fallback primary gets the clean default**, which is also what enforces per-operator isolation on a shared machine. The device κ is a random 16-byte κ minted once per browser profile (`holo.device.id`) that **never travels in a snapshot**. The operator's head pointer (`holo.session.head.<opHex>` → manifest κ) lives in localStorage.

4. **Restore re-derives, then checks the device (L5, "same machine only").** `restore` resolves the head → the κ-store → **re-derives the bytes** (a poisoned byte does not match its κ → refused → clean default) → checks `manifest["holo:device"]` against *this* device (a store copied to another machine does not match → clean default). `applyExperience` writes the saved settings back into localStorage **before the subsystems read them** — the shell resolves the manifest before `initWall()`, the playground flag, and the deferred `holo-widgets`/`holo-voice` scripts run — so every subsystem rehydrates naturally in **one deterministic reflow**, no "restore previous session?" modal.

5. **Autosave is debounced + flushed on the way out (the magic, seamless).** `scheduleSave` (≈800 ms debounce) fires on every meaningful mutation — tab open/close/switch/reorder/address, widget-board change, wallpaper + playground toggles — and a `visibilitychange→hidden` / `pagehide` flush captures **every** axis on the way out. So **sign-out** (which navigates to the greeter) **preserves** the snapshot rather than wiping it, and the next sign-in as the same operator restores it. No save button, no dialogs.

6. **A quiet, signed-in-only escape hatch.** A desktop-menu item (*Reset Saved Experience*) forgets this device's snapshot for the operator — reversible, off the normal flow.

## Same-machine-only, and the honest cross-device boundary

**Nothing leaves the device.** The κ-store is local IndexedDB and there is **no fetch on any path** (Law L4) — the witness asserts this with a fetch spy. localStorage *is* the machine boundary; the device-κ makes the binding explicit and witnessable, and defends against a snapshot whose IndexedDB was copied to another machine.

**Cross-device continuity is a different, future axis — NOT this ADR.** Carrying the experience to another machine would mean egressing it under the sovereign identity; that is the `holo-zk` selective-disclosure envelope's job (the ADR-0090 egress door), a separate opt-in with its own conscience gate. This ADR is deliberately local-only.

## Honest boundary on "every setting"

The settings allowlist captures the experience axes that persist via `localStorage`. **Tier capabilities held in the κ-store / conscience** (e.g. an OpenRouter grant, ADR-0102) are *not* in the allowlist: they are already device-local + operator-agnostic, and a capability is **never faked** as restored (L5). If a referenced surface or model can't be rehydrated, everything else restores and the gap is honest — we don't pretend a capability is back.

## Witness

`tools/holo-session-witness.mjs` drives the adapter-injectable `createSession` core with in-memory `kv` + κ-store fakes and a fetch spy (23/23): a full round-trip of tabs + order + active tab + open surfaces + **every** settings axis byte-for-byte (canonical equality); an identical experience → identical κ + idempotent re-store (κ-memo); a tampered manifest byte refused on re-derivation → clean default (L5); per-operator isolation on a shared machine; same-machine-only device-binding (a foreign device κ → clean default); the reset escape hatch; the allowlist captures every axis and excludes identity/session/device keys; and **no network egress** on any path.

## Files

- `os/usr/lib/holo/holo-session.mjs` — the orchestrator (adapter-injectable `createSession` core + browser bindings `deviceId`/`signedInOperator`/`saveSnapshot`/`restoreSnapshot`/`applyExperience`/`resetDevice`).
- `os/usr/share/frame/shell.html` — restore-on-boot (before the subsystems read state), debounced autosave at the tab/widget/wallpaper/playground mutation points, the `visibilitychange`/`pagehide` flush, and the signed-in-only *Reset Saved Experience* menu item.
- `tools/holo-session-witness.mjs` (+ `.result.json`), `os/etc/conformance.jsonld` (`#holo-session`), `tools/gate.mjs` (LIVE set).

Composes ADR-0088/0089 (the scene snapshot) · ADR-0026 (the local κ-store) · `holo-login.mjs` (the operator κ) · ADR-0084 (κ-memo) · ADR-0082 (PROV-O); grounded in Laws L1/L4/L5; mints only `holo:SessionManifest`. Spec at [`../specs/holo-session-persistence.md`](../specs/holo-session-persistence.md).

Pending: the `os-closure.json` κ-pin for the new served module (the deferred re-lock cascade, the same step ADR-0098/0099/0102 defer).
