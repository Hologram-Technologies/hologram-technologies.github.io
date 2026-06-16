# Migration — Hologram OS → lean shell + satellite repos

Hologram OS is split across two repositories so the OS itself stays a thin,
canonical holospace shell. This file records what moved where, and why.

## Repository topology

| Repo | Role |
|------|------|
| **hologram-os** (this repo, remote `os-holo`) | The lean shell: boot chain, κ-substrate runtime, service workers, the FHS map/serve, the universal core libraries every holo app links against, and the gate/witness machinery that seals them. Also holds the model κ-manifest (`system/os/usr/lib/holo/voice/models.manifest.json`). |
| **hologram-apps** (remote `apps-holo`) | Individual app packages (`apps/<id>/`), each with its own `holospace.json` declaring the OS libraries it needs via `shared[]`, and its own κ-sealed `holospace.lock.json`. |

Model weights are **content-addressed runtime artifacts, not source** — gitignored
under `system/os/usr/lib/holo/voice/vendor/` and fetched + hash-verified on demand by
`system/tools/vendor-voice-model.mjs`. Their canonical κ-pins live in
`voice/models.manifest.json` (generated from that script). The earlier separate
`holo-models` repo was folded into this manifest; there is no third repo.

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
model/SR blobs are gitignored runtime artifacts (see `voice/models.manifest.json`), not committed to history.

### Kept — build-time tools (left in place deliberately)
`holo-theme.mjs`, `holo-phi.mjs`, `make-vendor.mjs` are node CLIs (not runtime
libs) but resolve their I/O via `import.meta.url` relative to `usr/lib/holo/`
(e.g. `holo-theme.mjs` reads its sibling `holo-theme.css`; `make-vendor.mjs`
writes to `_shared/vendor/`). They are co-located with their inputs/outputs by
design; moving them to `system/tools/` would break those paths.

## Folding single-app libraries into their apps

Of the 27 libraries declared by exactly one app, **15 were folded** out of
os-holo's `_shared` and into their one owning app (Hologram Apps); the other **12
stay** because they are also imported by core os-holo libraries.

**Folded (15)** — file moved into the app, `_shared/<lib>` imports rewritten to
app-relative, dropped from `holospace.json` `shared[]`, lock resealed:

| App | Folded libs |
|-----|-------------|
| etherscan | holo-blockscout, holo-chain-brand, holo-eth-stream, holo-etherscan-api, holo-scan-tools |
| stream | holo-obs, holo-owncast, holo-pump |
| git | holo-git, holo-gitea |
| capture | holo-capture · browser: holo-install · ipfs: holo-snapshot · music: holo-subsonic · notepad: holo-roam |

(`holo-etherscan-api.js` still imports the staying `holo-eth.js` via `./_shared/`.)

**Kept (12, core-wired)** — also imported by core libs that stay, so folding would
break the shell: `holo-telemetry.mjs` ← `holo-theme.js`/`holo-sdk.js`; the
`holo-qvac.*` pair ← voice/sdk/scaffold/q; `holo-record`/`holo-memory` ←
`holo-manage.js`; `holo-atlas.js` ← `holo-pm.mjs`; `holo-omni.js` ← `holo-search.js`;
`holo-solana-stream.js` ← `holo-solana.js`; `holo-dock-config.json` ← the core dock;
`holo-audio.js`, `holo-jellyfin.js`, `holo-stations.js`. Folding these would require
refactoring the core libraries off the app libraries first.

The fold is a **cross-repo reseal pipeline**: per app, file moved → imports rewritten
→ `holospace.json` edited → `relock-app.mjs` (new app root κ) → `apps/index.jsonld`
regenerated. Verified statically (syntax + import resolution + no stale `_shared`
refs) and via the gate (18 reds, **zero net-new**). Note: `os-closure.json`'s
`apps[]` root pins were already stale before this work (no auto-regenerator) and are
not gate-checked; they were left as-is rather than partially hand-edited.

## Classification method

SHELL-CORE was determined by a transitive import closure from the boot-chain
entry points (`index.html`, `usr/share/frame/*.html`, the service workers, the
FHS map), cross-referenced against every app's declared `shared[]`. A library is
kept in os-holo iff it is reachable from boot OR declared by an app as a shared
dependency. Dead candidates were each verified by reading actual reference context
across both repos (a mention in a witness, `os-closure.json`, or an ADR is not a
runtime dependency).
