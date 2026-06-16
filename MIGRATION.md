# Migration — Hologram OS → lean shell + satellite repos

Hologram OS is split across three repositories so the OS itself stays a thin,
canonical holospace shell. This file records what moved where, and why.

## Repository topology

| Repo | Role |
|------|------|
| **os-holo** (this repo) | The lean shell: boot chain, κ-substrate runtime, service workers, the FHS map/serve, the universal core libraries every holo app links against, and the gate/witness machinery that seals them. |
| **Hologram Apps** | Individual app packages (`apps/<id>/`), each with its own `holospace.json` declaring the OS libraries it needs via `shared[]`, and its own κ-sealed `holospace.lock.json`. |
| **holo-models** | The content-addressed LLM/ONNX model artifact store. Weights are NOT committed to os-holo — they are gitignored runtime artifacts fetched + hash-verified by `system/tools/vendor-voice-model.mjs`. holo-models holds the canonical κ-manifest. |

## What changed in this restructuring

Split baseline: the feature commit "holo-share-to-run: omni resolver, onion,
session/workspace sync, share carriage, media/mesh, ONNX forge" was the last
commit before this restructuring. (Commit hashes were rewritten by the history
purge below, so this references the commit by message rather than a stale hash.)

### Deleted — dead code (11 files, `system/os/usr/lib/holo/`)
Verified unreferenced by any runtime loader across both repos, and not wired into
any witness, `os-closure.json`, or the gate (so deletion produced **zero net-new
gate reds** — baseline 18, after 18):

- `holo-onnx-decode.mjs` — future stub, never wired.
- `holo-mui.js`, `holo-mui-app.js` — unreferenced MUI demo pair.
- `holo-kcolorscheme.js`, `holo-lookandfeel.js` — pure utils, never imported.
- `holo-voice-lab.js` — manual test bench.
- `holo-appstream.js` — superseded; hub data layer inlined elsewhere.
- `game-frame.js` — referenced only in comments (an idiom), never loaded.
- `holo-podman.js`, `holo-podman-cli.js` — unwired container-engine prototype.
- `holo-search-tools.js` — unreferenced agent-tools draft.

### Purged from history
- `system/_nsr/` — neural super-resolution scratch (depth/resrgan ONNX experiments,
  ~158 MB). Research scratch, never part of the shell.
- `system/tools/bin/yt-dlp.exe` — a fetched tool binary (~17 MB), not source.

Both removed from the working tree, added to `.gitignore`, and purged from all
history with `git filter-repo` (the only way to actually shrink `.git`). Large
model/SR blobs belong in holo-models, not in os-holo history.

### Kept — build-time tools (left in place deliberately)
`holo-theme.mjs`, `holo-phi.mjs`, `make-vendor.mjs` are node CLIs (not runtime
libs) but resolve their I/O via `import.meta.url` relative to `usr/lib/holo/`
(e.g. `holo-theme.mjs` reads its sibling `holo-theme.css`; `make-vendor.mjs`
writes to `_shared/vendor/`). They are co-located with their inputs/outputs by
design; moving them to `system/tools/` would break those paths.

## Deferred — folding single-app libraries into their apps

The goal of moving each single-consumer library out of os-holo and into its one
owning app was investigated and **deferred** to a dedicated, verifiable pass.

Findings that make this a sub-project rather than a file move:

1. Of 27 libraries declared by exactly one app, **15 are also imported by core
   os-holo libraries that must stay** (e.g. `holo-telemetry.mjs` ← `holo-theme.js`
   + `holo-sdk.js`; the `holo-qvac.*` pair ← voice/sdk/scaffold/q; `holo-record`/
   `holo-memory` ← `holo-manage.js`; `holo-atlas.js` ← `holo-pm.mjs`; `holo-omni.js`
   ← `holo-search.js`; `holo-solana-stream.js` ← `holo-solana.js`; `holo-dock-config.json`
   ← the core dock). Folding those out breaks the shell; they are app-declared but
   OS-internal.
2. Folding even the ~12 cleanly-isolated libraries is a **cross-repo reseal
   pipeline**, not a copy: move file → rewrite `./_shared/X.js` imports to `./X.js`
   → edit `holospace.json` → `relock-app.mjs` (changes the app root κ) → regenerate
   `apps/index.jsonld` → re-seal os-holo's `os-closure.json` (which pins each app
   root). It requires per-app runtime verification that the app still loads, which
   is not possible from the witness/gate alone.

The cleanly-foldable subset, for the future pass: `holo-capture.js`→capture,
`holo-blockscout.js`/`holo-chain-brand.js`/`holo-eth-stream.js`/
`holo-etherscan-api.js`/`holo-scan-tools.js`→etherscan, `holo-install.js`→browser,
`holo-owncast.js`/`holo-pump.js`→stream, `holo-snapshot.js`→ipfs,
`holo-subsonic.js`→music, `holo-roam.js`→notepad.

## Classification method

SHELL-CORE was determined by a transitive import closure from the boot-chain
entry points (`index.html`, `usr/share/frame/*.html`, the service workers, the
FHS map), cross-referenced against every app's declared `shared[]`. A library is
kept in os-holo iff it is reachable from boot OR declared by an app as a shared
dependency. Dead candidates were each verified by reading actual reference context
across both repos (a mention in a witness, `os-closure.json`, or an ADR is not a
runtime dependency).
