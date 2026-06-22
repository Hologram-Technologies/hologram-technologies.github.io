# κ-Open — Phase 0 reflection

Status: reflection (no code yet). Authority: [holospaces](https://github.com/Hologram-Technologies/holospaces) — documentation is authoritative; this doc links back, never restates external systems.

Question this answers: *what already exists that κ-Open must reuse, and where is the genuine net-new?*

Verdict up front: **κ-Open is a polish-unify-and-adapt pass over existing seams, not new infrastructure.** Exactly one net-new module is warranted (`holo-device-tier.mjs`). Everything else is wiring, enhancement, and conformance. Below, each seam is verified present in the canonical tree `holo-os/system/os/` with its real entry point. Three of the prompt's assumptions were wrong and are corrected here.

---

## 1. What already exists (reuse, do not rebuild)

### Resolution & identity (the projection)
- `os/usr/share/frame/holospace.html` — the single seam. Imports `mount, parseLink, projectHtml, entryBase` from `holo-launch.mjs` and `sealConstitution` from `_shared/holo-admit.mjs`. Flow: parse the one LINK (`?app=` | `/~<app>` path hint | bare `#holo://<hex>`) → seal Constitution (fail-closed) → resolve from `./apps/index.jsonld` → fetch `holospace.json` + `holospace.lock.json` → `HoloTerms.gate(def)` → `mount({def,lock,grant})`.
- **κ-native frame boundary already lands.** The entry is fetched **by content** (`/.holo/sha256/<hex>`), re-derived (Law L5 — refuse mismatch), and mounted as `srcdoc` via `projectHtml(...)`. Path mount (`f.src`) is only the resilient cold-miss fallback, still worker-verified. The document *is* the κ, not a location.
- Bare/standalone entry: `?bare=1`. A **shared** link is detected by `#k=` in the fragment (the teleport/provenance convention) or `?shared=1` → lands fullscreen with Share-to-Run chrome (ADR-064). Normal links redirect into `shell.html`.
- Identity boundary holds: host owns wallet/keys via `holo-gov.js`; the mounted app holds nothing and must ask the host. Do not widen `holo.session` (see memory `holo-identity-boundary-audit`).

### Serverless delivery & trust root
- SW `os/holo-fhs-sw.js` — `CLOSURE_KAPPA` baked at line ~233; `CLOSURE_TRUSTED` flips false iff anchor present AND `etc/os-closure.json` fails re-derive; `refuseClosure()` returns a calm **409 Safety Stop** for every request when untrusted. Fail-closed, witnessed (G1/SEC-1).
- Worldwide reach without a server: `os/usr/lib/holo/holo-share-ui.mjs` → `mountShare(...)` produces `#wks=` (serverless, fits QR) or `#car=<cid>` (pinned CAR). Pin via `os/sbin/holo-workspace-sync.mjs` → `pinShareToCloud(rootCid, blocks, {endpoint:"/api/pin"})`. Auto-open on arrival: `os/usr/lib/holo/holo-workspace-sync-ui.mjs` → `resolveBootResume()`.
- QR is real and self-contained: `holo-qr-encode.mjs` → `encode()` (ISO/IEC 18004, RS+mask, no CDN); `holo-qr.js` → `toSVG()`/`toMatrix()`.

### Render substrate (already WebGPU, already parity-gated)
- `os/usr/lib/holo/holo-cosmos-gpu.js` → `HoloCosmosGPU.start(canvas,{seed,reduced})` (raymarch).
- `os/usr/lib/holo/holo-clouds-gpu.js` → `HoloCloudsGPU.createBackground(canvas,opts)` (CLOUDS2 WGSL).
- `os/usr/lib/holo/holo-screen-gpu.js` → `HoloScreenGPU.createScreen(canvas,...)` (bit-exact unsharp).
- All three carry a WebGL2 fallback and are witnessed by `system/tools/webgpu-parity-ci.mjs` (exit 0 pass / 1 fail / 2 inconclusive-no-device). **Reuse these; do not re-vendor a renderer.**
- OS-wide audio: `holo-sound.mjs` auto-routes same-origin media through Hi-Fi/spatial — the loader chime and app audio inherit it for free (post-gesture, reduced-motion-aware).

### Warm-mount & chrome restraint
- `os/usr/lib/holo/holo-play-ui.mjs` → `mountPlay(trigger,{launch})` mounts once and stays warm; full-canvas overlay; hex-dive → `launch(info)`.
- `holo-apps/apps/spaces/holo-spaces.mjs` → `poster(space, expectedKappa)` derives a themed SVG descriptor from a content κ (fail-closed identicon on verify-miss). No live iframe.

### The loader veil already exists in primitive form
- `holospace.html` already shows a HoloFX `scan` sweep ("Resolving holospace…") while it resolves, then a **materialize-on-arrival** animation (`#frame.holo-materialize`, GPU-only opacity/transform/filter, honoured-off for reduced motion). Phase 2 **enhances this existing veil to Google-Earth class** — it does not invent a loader.

---

## 2. The genuine net-new

1. **`os/usr/lib/holo/holo-device-tier.mjs`** — the only real new module. Probes GPU/display/compute/preferences once at boot, returns a `{ultra|high|balanced|lite}` capability profile, caches to `sessionStorage` (profile only, never identity). Every downstream stage reads it. Nothing today picks a render path from device capability — the GPU modules self-fallback, but there is no single adaptive authority.

2. **Loader enhancement** in `holospace.html` — swap the static `scan` veil for a tier-driven cosmos backdrop (reuse `holo-cosmos-gpu.js`/`holo-clouds-gpu.js`; lite tier = content poster/gradient, zero GPU) with centered app name + quiet spinner; cross-fade (not cut) into the existing `holo-materialize` mount. This is editing one file's `<style>` + boot script, not new infrastructure.

3. **Full-bleed chrome pass** — Share-to-Run chrome (`holo-share-chrome.js`, ADR-064) reduced to faint auto-dimming corner affordances; `100dvh`/`svh`, safe-area insets, `prefers-contrast`. Tuning existing chrome, not adding any.

4. **Unfurl meta** — OG/Twitter-card + `theme-color` with a `poster()`-derived image so the link looks alive before the click. The pretty path `/~<app>#k=` already injects `<meta name="holo:app">` for the OG crawler — extend that injection, don't replace it.

---

## 3. Corrections to the prompt's assumptions (flag before depending)

- **`appByKappa` is not a function.** κ resolution is an *implicit two-tier chain*: OS closure (`etc/os-closure.json`) maps identifier↔κ; `apps/index.jsonld` maps κ→metadata; the SW dispatches bytes by content-type after L5 re-derivation. Do not call a non-existent `appByKappa()`; resolve through the closure+catalog the way `holospace.html` already does.
- **Conformance lives at `system/conformance/holospaces/`, not a local `vv/`.** It is bash suites `CC-51…CC-55` (mapping V1–V5: render / linked-data / SPARQL / reasoning / agentic), with `PROMOTION.md`/`PROVENANCE.md`, staged for upstream **PR #33** to the holospaces repo. The κ-Open conformance row + witness go *here*, mirroring the upstream framework — not into a `vv/` directory that does not exist in this tree.
- **The app-grain at the projection is `#k=`** (provenance/teleport), detected in `holospace.html`. `#wks=`/`#car=` are workspace/CAR grains handled by `holo-share-ui.mjs`. The "3 κ-grains" framing is right, but the share-to-run link a guest clicks carries `#k=`.

---

## 4. Conformance framing (holospaces law)

- **arc42 / C4**: κ-Open is one *container* (the projection) gaining one new *component* (`holo-device-tier`) plus enhancements to existing components (loader veil, share chrome, unfurl meta). No new container.
- **OPM (ISO 19450)**: process `Open-by-κ` consumes object `κ-link`, yields object `Mounted-App`; `holo-device-tier` is an instrument object selecting the `Render-Path` process variant.
- **ISO/IEC/IEEE 15288**: this sits in *implementation* + *verification*; "complete" only when its conformance row is witnessed against external authority.
- **Invariants to preserve**: 100% κ/UOR-addressable (never reintroduce location-as-identity); 100% serverless on the open path; Terms gate fail-closed; `CLOSURE_KAPPA` Safety-Stop intact; identity/privkey/session boundary not widened.

---

## 5. Duplication risks (explicitly avoided)

- Do **not** write a new renderer — reuse the three witnessed GPU modules.
- Do **not** write a new loader from scratch — enhance the existing `holospace.html` veil + `holo-materialize`.
- Do **not** write a new share-link or QR path — reuse `holo-share-ui.mjs` / `holo-qr-encode.mjs` / `resolveBootResume`.
- Do **not** add a `vv/` — use `system/conformance/holospaces/`.
- Do **not** invent `appByKappa()` — resolve via closure + `apps/index.jsonld`.
