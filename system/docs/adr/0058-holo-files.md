# ADR-0058: Holo Files — the native, substrate-native file explorer

**Status:** Accepted — implemented and witnessed (`#holo-files`,
`tools/holo-files-witness.mjs`, required). Builds on ADR-0026 (sovereign delivery — the OS as a
content-addressed graph), ADR-0028→0030 (Holo UX/UI, the one look & feel), and the FHS-graph
filesystem (`#fhs-graph`). A faithful reproduction of [files-community/Files](https://github.com/files-community/Files),
not a port — the same precedent as the MetaMask (Holo Wallet) and VS Code (Holo Workspace) reskins.

**Context.** Hologram OS2 is, end to end, a content-addressed object universe — a Linux-FHS root
realized as a self-verifying graph, every holospace a sealed `holospace.lock.json` closure, the whole
runtime an `os-closure.json` of `path → κ` — yet there was no way for a person to *see and touch* it.
Every other OS has a file explorer as a first-class citizen; OS2 had none. The brief: a delightful,
native-feeling explorer that is 100% substrate-native, serverless, private and fast, wears the host
OS's chrome, and is a core part of every shell. A literal port of Files (C#/WinUI/.NET) cannot run
serverless in a browser, so the decision is to reproduce its feature set and visual language as a
native-web holospace wired directly to the substrate.

**Decision.**

1. **One unified VFS over the real substrate** (`os/usr/lib/holo/holo-files.js`, the engine; the
   FHS `index.jsonld` graph is only a coarse directory *label* layer). The sidebar is the union of
   the substrate's actual planes: **Home** (the user's writable space, OPFS-backed, `/home/user`);
   **This Hologram** (the FHS root as the live content-addressed graph); **Holospaces** (the app
   catalog → drill into a holospace's sealed lock closure); **OS Runtime** (the OS-wide closure,
   `path → κ`). Read-only over the immutable substrate (content-addressed = immutable by definition);
   full read/**WRITE** only in Home (W3C File System Access / OPFS). Per-file listings come from the
   lock closures and `os-closure.json`, not the FHS skeleton — the skeleton has no per-file detail.

2. **Every object is self-verifying, in the UI.** Each file row carries its `did:holo` κ; a
   "Verify · re-derive κ (Law L5)" action re-hashes the bytes locally with Web Cryptography and
   refuses on mismatch (a tampered byte yields a different κ). Nothing leaves the device — verification
   is re-derivation, not a server call. This makes the explorer the human-facing edge of Law L5.

3. **The same model, the host's native chrome.** `holo-platform.js` detects the host
   (Windows · macOS · iOS · iPadOS · Android · ChromeOS · Linux) and `HoloFiles.skinFor()` resolves
   the file-manager skin — Finder (columns default, traffic-light side, translucent), File Explorer
   (Fluent command bar, details default), Files (touch targets, grid/list), Nautilus — applied via
   `html[data-os]` plus the platform accent, font and modifier symbols. A faithful Files layout
   (sidebar · breadcrumb command bar · Details / List / Tiles / Grid / Columns · details pane ·
   context menu · Home landing page) underneath. Pure DOM + Web Crypto + OPFS, no framework, no CDN
   (Law L4); Holo UX propagates the device tier to it like every other surface.

4. **A core part of every holospace shell.** The explorer is the app `apps/files`, but it is wired
   into the World shell (`apps/sdk`, the redirect target every holospace boots inside): a Files dock
   button, a host-native ⌘/Ctrl⇧E shortcut, and a `holo-open` `postMessage` bridge so the explorer
   can launch any holospace it surfaces. So it is reachable from anywhere in the OS, not a standalone.

5. **Seamless integration with Holo Search and Holo Cloud — same substrate, not a bridge.**
   The search box is a *unified omnibox* (Holo Search): it searches the whole substrate recursively
   (Home · Cloud · Holospaces · OS Runtime), resolves any pasted content address / identifier
   (`κ · did:holo · CID · DOI · URL`, via `holo-resolve.classify` + an OS-closure hex scan) to the
   object it names, and on Enter runs the open-web resolve→federate→answer pipeline (`holo-find`, no
   AI) as an inline answer card. Holo Cloud is a *mounted location*, not a bridge: Files loads
   `HoloWebDAV` and reads the **same** OPFS `holo-cloud/{blocks,tree.json}` the Cloud app uses, so a
   file "Sent to Cloud" from Files is the same content-addressed, deduped, E2E κ-object that appears in
   Holo Cloud (and vice versa). Every object also yields a `holo://κ` share link.

**Consequences.**

- The two integrations + the desktop interactions are witnessed live (`#holo-files`, 27 checks):
  unified search finds objects, a κ resolves to its object, a Home file sent to Cloud appears in the
  Holo Cloud location and re-derives (Law L5 over the cloud κ-store); a new tab opens / switches /
  closes (multi-tab browsing), Ctrl-click extends a multi-selection, and a file moves into a folder
  (the drag-to-move primitive; OS files dropped onto the explorer upload into the current Home folder);
  a colored **tag** is assigned and surfaces in a filterable sidebar section (content files carry the tag
  on their κ — tag once, tagged everywhere); **dual-pane** opens a second, independently-navigable pane
  (drag across to copy a read-only substrate object into Home or move within Home).
- **Drag-out-as-κ (the substrate magic):** dragging any file OUT carries its `holo://κ` (text/uri-list +
  text/plain, so it pastes anywhere) AND the real bytes as a DownloadURL (a droppable file on the OS
  desktop / another app, pre-warmed on selection). Dropping a `holo://κ` / `did:holo:` / 64-hex link IN
  resolves it (`materialize`) and writes the verified object into Home — a content address is a portable,
  re-derivable handle to the object, in and out of the explorer.
- Files keeps its own dark palette (a files-community reproduction — the **adopt-vs-own** model, ADR-0023);
  its identity colors are registered in the `holo-app-token` ratchet baseline rather than tokenized.

- The explorer is gate-clean by construction: `holo-fhs-map.mjs` maps `_shared/x` and
  `apps/<id>/_shared/x` to the OS runtime, the audit only counts fallbacks to the *legacy* origin,
  and Files defaults to the OPFS Home landing page (the one substrate read — the apps catalog — is an
  Apps-repo read, not a fallback). Result: `files` audits at 0 fallbacks / 0 missing / 0 errors.
- Editing the World shell (`apps/sdk`) means re-locking it alongside `files` in the add-app cascade
  (`relock-app files` → `relock-app sdk` → `gen-apps-catalog` → `audit` → `gate`).
- `#holo-files` is a browser-tier witness (committed result, like `#boot` / `#qml-render` /
  `#own-ui`): `holo-files-witness.mjs` drives the real UI in Chromium — click into Holospaces →
  verify a κ → write to Home — and is `required` in the gate.
- Honest scope for v1: the substrate is browsed read-only and the κ-store sidebar slot is a stub;
  Files is slug-addressed until the next `os-closure` rebuild (same as q / amp / atlas96 — not
  gate-required). Drag-and-drop, multi-select operations, and upload-from-disk are tracked follow-ups.
