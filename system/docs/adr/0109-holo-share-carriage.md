# ADR-0109 — Holo Share: the ❤️ Share verb as a left side-carriage

Status: **LANDED** (UI). A new served module `os/usr/lib/holo/holo-share-ui.mjs` (`mountShare`) renders the Share flow as a RIGHT-docked side-carriage that matches the Create studio (`#create-studio`) for one coherent feel; `shell.html` mounts it on the `❤️ Share` button (docking the canvas via the existing `--holo-aside-w`, the same gesture Create and the wallet use) and retires the two prior Share surfaces. No new substrate. No new conformance row (presentation over the witnessed ADR-0105 sealer + ADR-0106 capture).

Relates: ADR-0105 (the IPFS sealer + transports this presents) · ADR-0106 (the session capture: `captureHolospace` / `captureWorkspace` / the `everythingAuthGate`) · `holo-qr.js` (the QR) · the Create composer / wallet dock (the side-carriage pattern).

## Context

`❤️ Share` fired two surfaces at once: the centered `#share-scrim` modal (`shareNode`, a QR + social preview of the holospace link) and, after a concurrent edit, the workspace-sync popover card bound to the same button as its `trigger`. Two overlapping surfaces, small and modal, did not match the third of the promise: effortlessly **share** a serverless holo app as one link that drops into any social platform, saves locally, or backs up to IPFS. Share deserves the same first-class side-carriage treatment Create has.

## Decision

One **left side-carriage** (`#holo-share-panel`) that docks the canvas and presents a single, self-explanatory, golden-ratio flow.

1. **Same carriage as Create, on the right.** `#holo-share-panel` mirrors `#create-studio` exactly: `position:fixed; right:0; width:clamp(380px,36vw,520px)`, the `#0a0a0b` surface, the `.42s` slide, a `cs-chead`-style header (gradient logo, brand, icon buttons). It docks the canvas via the existing `--holo-aside-w` (the wallet/Create gesture), so the live holospace squeezes left beside it. Esc, a canvas click, or the Share button again closes it. No second panel system.

2. **One clean, no-scroll flow, composed on φ** (pad 21, gaps 13·21·34): a *This holospace / Everything* scope toggle (self-explanatory, no extra label); the **link ready with its QR** front and centre the moment it seals (a 208px QR, the link field, a Copy button, a primary native `navigator.share`); two equal ways to keep it (Save a file via `exportCar`, Sovereign cloud via `publishToCloud`); and one honest proof line (a green tick, "Re-derives to its address. No server.", the short content address). A small header arrow swaps to a tidy "open a shared link or file" view (`onImport`) and back. Redundant copy removed (no hero paragraph, no social card, no verbose summaries). The link is the `#wks=` self-contained form (`encodeResumeLink`), so the bytes ride the URL fragment and never reach a server.

3. **Reuse, do not reinvent.** The sealer (`holo-workspace-sync.mjs`) and `holo-qr.js` are dynamic-imported on first open (boot stays lean). The shell passes the existing `captureHolospace` / `captureWorkspace` / `onImportShared` callbacks and the `everythingAuthGate`, so sharing **Everything** still re-proves presence to the device biometric for a signed-in operator (fail-closed, ADR-0106). Guests share with no gate (already device-local).

4. **Supersede, do not stack.** The Share button is bound only to the carriage; the old `#share-scrim` modal and `shareNode` remain defined but unbound (no second Share surface). The workspace-sync omnibar UI keeps only its boot-resume export.

## Design bar (met)

Golden-ratio rhythm (pad 21, gaps 13·21·34, a 208px QR focal), the Create palette for an identical feel, text kept readable (no tiny labels, body and actions at 16px, the κ hash 14px mono), zero em-dashes or hyphen separators in the copy, the one OS-wide `prefers-reduced-motion` guard honored (the QR bloom and slide disable), and full-width on phones. Everything fits one viewport with no scroll. The link "blooms" in; the dock glides; nothing janks.

## Honest boundaries (shown in the panel, not faked)

A `#wks=` link is sovereign and serverless (it carries its own bytes). A cloud (IPFS) token reaches another device only once a peer pins it. A live web tab reloads from its origin; an authored app runs anywhere. The "Everything" link is a plaintext consented export, distinct from the encrypted local store (the ADR-0106 line). A link too large for a URL steers the user to file or cloud. Nothing claims a reach it does not have.

## One carriage for Create · Play · Share (the primitive)

Share proved the carriage; the three verbs now share it. `os/usr/lib/holo/holo-aside.mjs` `createAside({ id, title, logo, defaultW, minW, maxW })` is the ONE right side-carriage primitive: synchronous `--holo-aside-w` dock, the throttle-safe `.42s` slide (26px nudge + visibility, never stuck off-screen), a **drag-to-resize** left-edge grip (live, clamped, persisted per id; click it to collapse, double-click to reset), **no auto-close** on a canvas click (Esc / grip-click / ✕ close), and a **single-open registry** so one carriage at a time (with `registerAsideCloser` / `closeAllAsides` letting the Create studio join the rule).

- **Share** renders into `createAside().body`; its bespoke shell + the `world`-pointerdown auto-close are gone.
- **Play** opens `createAside({ id:"play", title:"Holo Hub", defaultW:560, maxW:1000 })` and streams the Hub app iframe into the body (instead of a full tab) — wider by default, drag to grow.
- **Create** adopts the carriage by class: `#create-studio` gains `.holo-aside` (so it inherits the identical dock + slide), a `.ha-grip` (drag-resize + persist), and `closeAllAsides()` + `registerAsideCloser` for single-open; its verb toggles. Its studio internals (chat / preview / editor / DevTools / publish) and lifecycle are kept intact — the SAFE adoption, since Create's dock already mirrored the primitive's pattern exactly. (A deeper internal JS port was judged not worth the regression risk on a working crown-jewel surface that can't be driven live in this harness; the uniform feel + resize + toggle + no-auto-close are fully delivered.)

The three verbs now open with one identical chrome, animation, drag-resize, and feel.

## Files

- `os/usr/lib/holo/holo-share-ui.mjs` — **new**, the left Share side-carriage (`mountShare`).
- `os/usr/share/frame/shell.html` — `--holo-aside-l` dock (calc + glide on the five chrome elements), `#share-btn` bound to `mountShare`, the `mountWorkspaceSync(trigger)` popover + the `shareNode` binding retired (`resolveBootResume` kept).

Composes ADR-0105 / ADR-0106 + `holo-qr.js`; grounded in Laws L1/L4/L5; mints nothing new. Pending: the `os-closure.json` κ-pin for the new served module (served via SW fallback meanwhile, the established deferral); whatever could not be driven live in this harness is noted, not faked.
