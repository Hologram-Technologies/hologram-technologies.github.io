# Holo Session — persistence spec (ADR-0104)

The implementation contract for per-operator, device-local experience continuity: the
settings registry, the manifest shape, and the boot restore ordering. See
[`../adr/0104-holo-session-persistence.md`](../adr/0104-holo-session-persistence.md) for
the decision and rationale.

## Identity & keys

| Thing | Value | Where |
|---|---|---|
| Operator κ | the signed-in session's `operator` (non-guest) | `holo.session` (sessionStorage) → `signedInOperator()` |
| Device κ | `did:holo:sha256:` of 16 random bytes, minted once | `localStorage["holo.device.id"]` → `deviceId()` |
| Head pointer | manifest κ for an operator | `localStorage["holo.session.head." + opHex]` |
| Manifest | the sealed experience bytes | the local κ-store (`holo-kstore`, IndexedDB) |

A guest, or the device's fallback primary operator with no session, gets the **clean
default** (no restore, no autosave) — which also enforces per-operator isolation.

## Settings registry (the experience allowlist)

A localStorage key is part of the experience iff it is an exact `SETTINGS_KEYS` entry or
carries a `SETTINGS_PREFIXES` prefix, and is not excluded. Defined in `holo-session.mjs`;
the witness asserts coverage.

- **Prefixes:** `holo-widgets.` (home board `holo-widgets.v5` · per-holospace boards
  `holo-widgets.spaces.v1` · board mode `holo-widgets.mode.v5` · mode boards
  `holo-widgets.modeboards.v5` · the seed flag) · `holo.voice.` (wake on/off · wake word ·
  WebGPU/GPU-brain · voice · profile · scope · welcomed) · `holo:wall` (gallery + current ·
  live · parallax) · `holo-vinyl.` (the music widget's dock pin) · `holo.q.` (model/tier
  toggles surfaced via localStorage).
- **Exact keys:** `holo.playground` (the global edit-mode armed flag).
- **Excluded:** `holo.session.*` (our own head pointers) · `holo.device.id` (the machine
  anchor — never travels) · `holo.install.dismissed` (a one-shot nag). Tier capabilities in
  the κ-store / conscience are out of scope (operator-agnostic, never faked as restored).

To add a new experience axis, extend the registry — that is the only edit needed; capture,
restore, and the witness coverage check follow automatically.

## Manifest shape (PROV-O, JCS-canonical)

```json
{
  "@context": ["https://www.w3.org/ns/did/v1", { "holo": "https://hologram.os/ns#", "prov": "http://www.w3.org/ns/prov#" }],
  "@type": ["prov:Entity", "holo:SessionManifest"],
  "holo:operator": { "@id": "did:holo:sha256:<op>" },
  "holo:device": "did:holo:sha256:<dev>",
  "prov:generatedAtTime": "<iso>",
  "holo:experience": {
    "tabs": [ { "id", "title", "addr", "home", "pinned?", "group?", "snap": { "world", "layout", "focusedId" } } ],
    "activeTab": 0,
    "settings": { "<allowlisted key>": "<string value>" }
  }
}
```

κ = `did:holo:sha256:` + SHA-256 of `jcs(manifest)`. The exact JCS bytes are what the
κ-store holds, so a re-read re-derives byte-for-byte (L5).

## Boot restore ordering (shell.html)

The restore runs in the main module **before** any subsystem reads its state, so writing
the saved settings back to localStorage is sufficient — each subsystem rehydrates at its
own init. Ordering, top to bottom in the module:

1. `tabs[]` / `selectTab` / `restoreWorld` / `applyWidgets` defined.
2. **Restore block** (this feature): `restoreSnapshot()` → if a body returns,
   `applyExperience(body)` writes settings to localStorage, then rebuild `tabs[]`,
   clamp `activeTab`, `restoreWorld(active.snap)`, and `applyWidgets(active)` **only for a
   non-home active tab** (the home board auto-loads from the restored `holo-widgets.v5`;
   calling `setBoard` for home would clobber it). `_ssReady = signedInOperator()`.
3. `renderTabs(); recordNav();` paints the restored tabs.
4. `initWall()` reads the restored `holo:wall*`.
5. The playground flag reads the restored `holo.playground`.
6. The deferred `holo-widgets.js` / `holo-voice.js` scripts load and read their restored keys.

## Autosave & flush

- `scheduleSave()` (≈800 ms debounce) is called from `selectTab` · `newTab` · `closeTab` ·
  `setActiveTabAddr` · `setActiveTabTitle` · the `HoloWidgets.onChange` mirror · the
  wallpaper live/parallax toggles · `setPlaygroundMode`.
- `flushSession()` snapshots the active tab's world into `tabs[activeTab].snap` then
  `saveSnapshot({ tabs, activeTab })`. Bound to `visibilitychange→hidden` and `pagehide`
  (the catch-all that captures every axis, including settings changed elsewhere, and makes
  sign-out preserve the snapshot).
- Both no-op unless `_ssReady` (a real signed-in operator).

## Escape hatch

`window.HoloSession.reset()` → `resetDevice()` removes the active realm's head pointer and the
allowlisted localStorage keys. Surfaced as the desktop-menu item *Reset Saved Experience…* (with
a confirm). Reversible: the next session simply starts fresh and re-captures.

---

# v2 — sovereign + every user (ADR-0106)

v2 keeps every v1 contract above and adds realms, at-rest encryption, the guest claim, the per-app
handshake, and battle-hardening. See [`../adr/0106-holo-session-sovereign-guest.md`](../adr/0106-holo-session-sovereign-guest.md).

## Realms & keys

| Realm | When active | Cipher key | Head key |
|---|---|---|---|
| Operator (`<op-κ>`) | signed in AND unlocked (vault key in memory) | `deriveOperatorKeyBytes(op, secret, deviceId)` — PBKDF2 210k, never persisted | `holo.session.head.<opHex>` |
| Guest (`guest:<deviceHex>`) | guest, OR signed-in-but-locked | `holo.session.devkey` — random 32B in localStorage | `holo.session.head.guest:<deviceHex>` |

`activeRealm()` returns the operator realm only when the in-memory vault key matches the signed-in
operator; otherwise the device/guest realm. So work is never lost while locked, and a sign-in claims it.

## At-rest sealing

`pt = jcs(body)` → `iv = HMAC-SHA256(macSubkey, pt)[:12]` (synthetic, deterministic) →
`blob = iv ‖ AES-GCM(aesSubkey, iv, pt)` → `κ = sha256(blob)` → `store.put(κ, blob)`. The aes/mac
subkeys are `sha256(rawKey‖"|holo-session/enc")` and `…/iv`. Restore: `sha256(blob)==head.k` (L5) →
try plaintext-parse (v1 migration) → else `cipher.open(blob)` → parse → device-binding check. Wrong
key, tamper, or foreign device all return `null` (clean default).

## Head pointer (v2)

JSON `{ k: κ, seq, tab }` (a legacy bare-κ string reads as `seq 0`). `seq` is a per-realm monotonic
counter kept **out of the manifest body** (so ADR-0105 cross-device dedup is untouched). `save` skips
when another `tab` has advanced `seq` past the caller's `expectSeq` (no cross-tab clobber). The shell
also gates autosave on `document.visibilityState === "visible"`.

## Manifest (v2)

Adds `"holo:v": 2`. Body stays plaintext + deterministic (no seq, no nonce) so it remains
content-addressable + cross-device-dedupable. A world node may carry `appState` (the per-app blob).

## Guest claim

On sign-in (`window.HoloSession.onSignIn(operator, secret)`, called from the greeter `go()` with the
secret in hand): `unlockOperatorKey` derives the vault key; a returning operator → `restoreOperator()`
(their saved world); a new operator → `claimGuestRealm()` (re-key the guest realm under the operator,
consume the guest head). `claim` is write-new-then-delete-old (crash-safe; guest stays re-claimable).

## App-state handshake (`holo-session:*`)

`holo-session-client.mjs` `holoSession({ save, restore })` is the app side. Protocol: shell→app
`{t:"holo-session:save", surfaceId}` → app→shell `{t:"holo-session:state", surfaceId, state}`;
shell→app `{t:"holo-session:restore", surfaceId, state}`; app→shell `{t:"holo-session:ready"}` on mount.
The shell collects state on flush into `node.appState` (best-effort, ~160ms timeout) and dispatches a
queued restore when a participating app announces readiness. One import adopts it:

```js
import { holoSession } from "/_shared/holo-session-client.mjs";
holoSession({ save: () => myState(), restore: (s) => applyMyState(s) });
```

A non-adopting app keeps its own per-origin storage — an honest, documented boundary.

## Honest boundaries

A bare reload cannot silently restore an operator (restore is post-unlock — the Max-sovereign trade);
the device key is integrity + copied-store protection, not devtools-secrecy; non-adopting apps are not
operator-scoped; cross-device is ADR-0105 (a plaintext export), not this local-encryption axis.
