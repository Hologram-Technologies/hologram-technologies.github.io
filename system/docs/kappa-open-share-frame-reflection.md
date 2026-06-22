# κ-Open as the default standalone frame — Phase 0 reflection

Goal: the κ-Open welcome (`holospace.html` splash) is the ONE canonical frame for opening any standalone
Hologram app, and every Share path routes through it.

## Routing today (verified 2026-06-22)

`holospace.html` already hosts the splash (`#holo-loader`: synchronized reveal, 5s-from-`__splashRevealAt`
hold, `decode()` paint, DNA spinner, NASA fallback, cross-fade to mount). Its bottom branch decides standalone
vs shell:

- `?bare=1` **or** shared (`#k=` / `?shared=1`) → `boot()` mounts the app **fullscreen WITH the splash**.
- a plain `?app=κ` (no bare/shared) → `location.replace('/shell.html?open=…')` — the editable desktop, **no splash**.

### Every Share grain — where it lands

| Grain | Built by | Target | Splash? |
|---|---|---|---|
| `#k=` (this app, shell Share btn) | `shell.html shareLinkFor()` (3540) | `/holospace.html?app=κ#k=κ` | **yes** ✓ |
| `#k=` (re-share from a shared landing) | `holo-share-chrome.js shareUrl()` | `holospace.html?app=ref#k=κ` | **yes** ✓ |
| baked pretty card | `holo-share-card.mjs` | `holospace.html?app=κ&shared=1` | **yes** ✓ |
| home screen tap | `home-screen.html` | `?app=κ&bare=1` | **yes** ✓ |
| live cover preview | `shell.html` (5131) | `/holospace.html?app=κ&bare=1` | yes ✓ (cover iframe) |
| `#wks=` (this holospace) | `holo-share-ui.mjs` (81) | `{SHELL_PATH}#wks=…` → `resolveBootResume` | no — **desktop restore of a multi-app workspace (correct; not a single standalone app)** |
| `#car=` (everything, pinned) | `holo-share-ui.mjs` (192) | `{SHELL_PATH}#car=<cid>` → shell | no — desktop restore (correct) |
| paste/import a `#k=` link | `holo-share-ui.mjs` (205) | `window.open(link)` → holospace splash | yes ✓ |

In-shell launches (`openHolospaceApp`/`launch`) open desktop tabs with **no** splash — intentional, the desktop
is not a standalone open.

## Conclusion — the single gap

**Every share of a single app already routes through the splash.** The ONLY standalone-app path that bypasses
it is a **plain `?app=κ` → redirect to shell**. That redirect is the old default ("a single link opens the app
inside the editable World shell"). Per the goal, a direct standalone `?app=κ` should open the **splash** by
default; the editable desktop stays available explicitly via `shell.html` or `?shell=1`.

`#wks=` / `#car=` are workspace/everything restores (inherently multi-app, desktop-shaped) and stay on the
shell — not in scope for "standalone app."

## Phase 1 change (one edit, `holospace.html` bottom branch)

Flip the default: standalone = splash, desktop = explicit.

```
const goShell = params.get("shell") === "1" || (!raw && params.get("bare") !== "1" && !shared);
if (goShell) { …location.replace('/shell.html?open=…') }   // ?shell=1, or no app → desktop home
else        { boot()… }                                    // shared #k=, ?bare=1, OR a plain ?app=κ → splash
```

- `?app=κ` (plain) → splash (NEW). `?app=κ&shell=1` → desktop (opt-out). Empty `holospace.html` → desktop home (unchanged).
- All shared grains unchanged (already splash). `#wks=`/`#car=` unchanged (shell). In-shell launches unchanged (no splash).

No new frame, no fork, κ stays identity, works on a static host. Then reseal in order + `reseal --check`.
