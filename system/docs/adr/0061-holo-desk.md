# ADR-0061: Holo Desk — the substrate-native desktop

**Status:** Accepted — implemented and witnessed (`tools/holo-desk-witness.mjs`, 13/13; conformance
row `#holo-desk`). Adds the desktop surface to the OS shell by REUSING the existing engines — it runs
no foreign runtime (ADR-0029).

**Context.** Hologram OS had a dock (ADR-0059) and a Files explorer (ADR-0058), but no *desktop*: the
dock's "Show desktop" merely revealed the Platform Manager console — no wallpaper, no icons, no native
"New folder". A browser-based OS that wants to "feel like a desktop in any browser" needs the one
surface every desktop user expects: a wallpaper you can change, icons you can arrange, and a
right-click "New ▸ Folder" that drops a folder you can immediately name.

**Decision.** Ship **Holo Desk** (`_shared/holo-desk.js` + `holo-desk.css`, `window.HoloDesk`) — a
top-level desktop layer that sits BEHIND the one app frame (`#holoframe`), so opening an app covers it
and the dock's "Show desktop" reveals it. It is composed entirely from engines that already exist:

- **Files = the writable OPFS Home.** Icons are the real children of `/home/user/Desktop` via
  `HoloFiles` (ADR-0058). "New ▸ Folder" → `HoloFiles.mkdir`; inline rename → `HoloFiles.rename`
  (hardened here with a recursive-copy fallback so renaming a *folder* works even where OPFS
  `move()` rejects directories); delete → `HoloFiles.remove`. Home is read/WRITE; the rest of the
  substrate stays read-only. Double-click opens a folder *in place* (breadcrumb back), fully
  self-contained in the lean image.
- **Every icon is a UOR object.** Glyphs render as `<holo-icon>` (ADR-0032). The whole κ-pinned
  library (~13k Material Symbols + Tabler) is made *discoverable and applicable natively* by a new
  `HoloIcons.names(prefix)` primitive feeding a searchable picker; applying an icon stores its
  `HoloIcons.kappa(set,name)` = `did:holo:sha256:…` — the icon's content address.
- **Native feel by host OS.** `HoloPlatform` (`data-holo-platform`) drives folder tint (manila-gold
  on Windows, blue on macOS), selection shape, and auto-arrange origin (top-left vs top-right) — the
  same desktop, the host's chrome.
- **The layout is itself a self-verifying object.** Wallpaper + per-item icon/position are sealed via
  `HoloObject.address` to `/home/user/.desktop/desk.uor.json` with its derived `id`; it re-derives on
  load (Law L5). The desktop's arrangement is content-addressed, not loose state.
- **Desktop-as-home.** `home.html` now boots onto the desktop instead of auto-mounting the VS Code
  workbench (still provisioned and one click away via `window.__openWorkspace` / the dock).
- **Nest + arrange + select.** Drag an icon (or a marquee-selected group) onto a folder to move it
  inside (`HoloFiles.moveHome`, hardened with a recursive-copy fallback for directories); drag on the
  empty surface for a rubber-band multi-select; the auto-arrange grid measures the dock and insets
  around it so icons never hide behind the taskbar on any OS.
- **Folder covers that match contents.** A folder's glyph renders up to four live previews of its
  children (image thumbnails or κ-glyphs), updated whenever the folder changes — the macOS/Windows
  "stack" affordance, content-true.
- **Save any app to the desktop / dock.** "New ▸ App shortcut…" opens a picker over the content-
  addressed app catalog; choosing one writes a tiny `<Name>.holospace` shortcut (kind=app) that
  launches in the one frame on double-click, and a right-click "Pin to dock" pins it to the native
  menu bar via `HoloDock.pin`.

All `font-size` in the new chrome clamps to the `--holo-font-min` readability floor (ADR-0057), and
the layer respects the boot splash + the dock's `--holo-dock-h`.

**Consequences.** The OS finally has a real desktop that feels native and effortless: right-click New
Folder, type a name, drag it where you want, give it any of 13k content-addressed icons — every one a
substrate object, with the whole arrangement re-derivable to a κ. Costs: two new `_shared` files in
the κ-closure and a desktop-vs-manager boot change (the manager remains at `?manage`). The boot
witness loads `holospace.html` directly, so the home-surface change does not affect it. Follow-ups:
app/file shortcuts on the desktop (drop a `holo://κ`), multi-select marquee, and a Files-app handoff
for deep folder trees.

External authorities: **W3C** OPFS / File System Access · Web Crypto · Custom Elements. Builds on
ADR-0058 (Holo Files), ADR-0032 (Holo Icons), ADR-0059 (Holo Dock), ADR-0030/0057 (Holo UI),
ADR-0029 (adopt-don't-run), ADR-0025 (UOR envelope). Witness: `tools/holo-desk-witness.mjs`
(`#holo-desk`); modules: `_shared/holo-desk.js`, `_shared/holo-desk.css`, `_shared/holo-icons.js`
(`+names`), `_shared/holo-files.js` (folder-rename fallback).
