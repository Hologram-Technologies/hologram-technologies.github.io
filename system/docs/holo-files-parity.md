# Holo Files ⇄ Files (files-community/Files) — feature-parity matrix

> **Gap-audit punch-list** (grounded in `../Hologram Apps/apps/files/index.html`, ~1000 lines, audited
> 2026-06-14). What's DONE, what's MISSING/PARTIAL, prioritized. Unification C1–C3 (desktop ⇄ explorer,
> one bidirectional model) is complete.
>
> **Already shipped:** 5 view modes (details/list/tiles/grid/columns) + per-folder memory · sidebar ·
> breadcrumb · tabs · **dual-pane** · sort/group/filter · search (local + web) · QuickLook · properties
> pane · **κ Verify (L5)** · **tags** (colored, sidebar) · rename · new folder · delete (confirm) ·
> compress/extract · share (κ link) · upload/download · materialize-from-κ · send-to-Holo-Cloud ·
> basic keyboard nav (Backspace/Enter/Space) · multi-select + shift-range · **desktop unification**.
>
> **P0 — core parity, high value**
> 1. **Cut / Copy / Paste file clipboard** (CopyItem·CutItem·PasteItem·PasteItemToSelection) — today only
>    drag-move + "copy κ link" exist; no copy/cut/paste of items between folders.
> 2. **Undo / Redo** (Undo·Redo) — none today (delete says "cannot be undone"). *Cheap win:* every edit
>    already derives a new κ, so undo = previous κ.
> 3. **Recycle Bin + restore** (DeleteItem→recycle · RestoreRecycleBin · EmptyRecycleBin) — delete is
>    currently permanent; κ-adapt: a Recycle κ-folder.
> 4. **Full keyboard map** (Rename=F2 · Ctrl+C/X/V · Ctrl+A select-all · Ctrl+Shift+N · arrow-key grid
>    navigation) — only Backspace/Enter/Space exist now.
> 5. **Command palette** (OpenCommandPalette) — missing.
>
> **P1 — familiar / expected**
> 6. **Open with…** (OpenWith · OpenInIDE→Create studio) — missing; open is type-default only.
> 7. **New file** (CreateFile) — model has it; no "New file" command in the UI (only New folder).
> 8. **Real Favorites / Pin** (PinFolderToSidebar·Unpin) — the sidebar "Pinned" group is hardcoded to the
>    first 3 locations; needs a real user pin action persisted as a κ list.
> 9. **Show hidden / file-extension toggles** (ToggleShowHiddenItems·ToggleShowFileExtensions·ToggleDotFiles) — missing.
> 10. **Box / rubber-band selection** (marquee) — missing (only click + shift/ctrl).
> 11. **Editable address bar** (EditPath) — breadcrumb is read-only; the search box doubles as a κ resolver. Add type-a-path/κ-to-go.
> 12. **Create shortcut** (CreateShortcut·PasteItemAsShortcut) — missing; κ-adapt: a tiny κ-ref object.
>
> **P2 — advanced / polish**
> 13. **Set as wallpaper / background** (SetAs*) — missing here; reuse the shell's κ wallpaper system.
> 14. **Image rotate** (RotateLeft/Right) — missing; κ-adapt: transform → new κ.
> 15. **Compact overlay / PiP** (ToggleCompactOverlay) — missing.
> 16. **Tabbed Properties dialog** (General·Details·Security→κ/owner·Customize) — today a single pane.
> 17. **Git actions completeness** (Clone·Pull·Push·Sync·Init) — partial; route to Holo Gitea.
> 18. **PlayAll** (a media folder → the player) — missing.
>
> **N/A (no κ/OS meaning):** FormatDrive · RunAsAdmin/AnotherUser/PowerShell · InstallDriver/Cert ·
> NTFS alternate-data-streams · StorageSense (see the full table below for reasons).
>
> Suggested order: P0.2 Undo (cheapest, highest safety win) → P0.3 Recycle → P0.1 clipboard → P0.4 keymap
> → P0.5 palette → P1. Each is an independently shippable slice.

---

**Purpose.** The single source of truth for re-creating [files-community/Files](https://github.com/files-community/Files)
(MIT, C#/C++ WinUI 3 + Win32) as **Holo Files** — a κ-native explorer that unifies files, folders and
the desktop. This matrix makes "strictly adhere / feature-complete" *provable*: every Files command
action (161, enumerated from `src/Files.App/Actions/**/*Action.cs` on `main`) is accounted for here.
No silent gaps — each is **Mirror**, **κ-adapt**, or **N/A (with reason)**, and assigned a slice.

**Attribution.** Files is MIT-licensed. Holo Files is an independent re-implementation that *mirrors its
UX/architecture as a specification* (not a port — different language/runtime/OS model). Credit Files in
the About panel and keep this doc as the mapping. When a behavior is ambiguous, the Files source decides.

## Legend
- **✅ Mirror** — re-create the UX/behavior 1:1 in Holo JS-over-κ.
- **⊚ κ-adapt** — Win32/NTFS/shell feature re-grounded in κ semantics (noted).
- **⛔ N/A** — no meaning without a real OS/filesystem/privilege model (reason given).
- **Slice** — S1 shell+views · S2 ops+undo+recycle · S3 tags/search/properties · S4 desktop unification · S5 advanced (archive/git/media/image).

## Current state — audit of the EXISTING app (corrects the initial estimate)
The shipped explorer lives in the **sibling Apps repo**: `../Hologram Apps/apps/files/index.html`
(~984 lines), served at `/apps/files/` (the OS2 holospace dir only vendors `icon.svg`). It already
covers **Slice 1 in full** and much of S2/S3 — verified live:
- **Shell:** sidebar (locations from `ROOTS()`), breadcrumb, tabs, status — present.
- **5 view modes:** Details · List · Tiles · Grid/Icons · Columns (the `vbtn` switcher; persisted to
  `localStorage`; per-platform default via `skinFor`) — present and toggling.
- **Already present beyond S1:** sort + grouping, search (local + web), a details/properties pane,
  Verify (κ re-derivation), and command surface for tag, move, delete, copy, rename, compress/extract,
  share, pin, new-folder, upload/download, trash, undo, paste.

**Therefore the real remaining work is NOT "build the explorer" — it is:**
1. **Gap audit** of the existing app vs. the 161-action table below → a punch-list of what's truly missing
   or κ-adapted incompletely (e.g. dual-pane, recycle round-trip, full undo/redo, tag index as κ).
2. **Unification (was S4, now the headline):** the shell's desktop folders/app-icons
   (`kind:"folder"` nodes in `shell.html`) are a SEPARATE model from `holo-files.js` VFS. Make them ONE:
   the desktop = the explorer rooted at the desktop folder; a folder icon opens into the same app.

Revised slices: **A** gap audit + dual-pane/recycle/undo completion · **B** tags/favorites/recents as κ
objects · **C** desktop⇄explorer unification · **D** advanced (archive/git/media/image). (Old S1 = done.)

## The κ grounding (applies throughout)
- A **file** = a content-addressed object (bytes → κ, Law L5). Identity = hash.
- A **folder** = an object whose content is an ordered manifest `{name, κ, kind, meta}`. Editing derives a **new** folder κ → immutable history → **Undo/Redo and "recycle" are free**.
- **Open** = resolve κ → the ONE `holo-render` path (preview/edit/run by type). Gateway is never trusted; every byte re-derives.
- Tags, favorites, recents, layout/sort/group prefs, shortcuts, the recycle bin, archives = small κ objects too — shareable, re-derivable. A view is a `holo://κ` that reproduces the exact tree + layout.

---

## Navigation, tabs & panes — Slice 1
| Files actions | Status | Holo / κ notes |
|---|---|---|
| NavigateBack, NavigateForward, NavigateUp, NavigateHome | ✅ | per-tab history already exists in the shell; reuse |
| NewTab, NextTab, PreviousTab, CloseSelectedTab, CloseTabBase, CloseAllTabs, CloseOtherTabsSelected, CloseTabsToTheLeft/RightSelected, DuplicateSelectedTab, ReopenClosedTab | ✅ | maps onto the shell's `__tabs` model |
| NewWindow, OpenInNewWindow(+FromHome/Sidebar), BaseOpenInNewWindow | ⊚ | "window" = a holo window/tab (no OS windows) |
| SplitPaneHorizontally/Vertically, ArrangePanesHorizontally/Vertically, ToggleDualPane, CloseActivePane, OpenInNewPane(+FromHome/Sidebar), BaseOpenInNewPane | ✅ | dual-pane explorer (two κ roots side by side) |
| ToggleSidebar, ToggleToolbar, CustomizeToolbar, ToggleFilterHeader, ToggleFullScreen, OpenCommandPalette | ✅ | full-screen + a command palette already exist |
| EnterCompactOverlay, ExitCompactOverlay, ToggleCompactOverlay | ⊚ | picture-in-picture mini window (S5) |

## Layout, sort, group, view — Slice 1
| Files actions | Status | Holo / κ notes |
|---|---|---|
| Layout (Details · List · Tiles · Grid/Icons + size slider · Columns/Miller) | ✅ | per-folder layout memory persisted as a κ pref |
| Group, Sort, SortFoldersFirst, SortFilesFirst, SortFilesAndFoldersTogether | ✅ | |
| ToggleShowFileExtensions, ToggleShowHiddenItems, ToggleDotFilesSetting | ✅ | |

## Selection — Slice 1
| Files actions | Status | Holo / κ notes |
|---|---|---|
| SelectAll, InvertSelection, ClearSelection, ToggleSelect | ✅ | shared with the desktop icon layer |

## Create, open, transfer — Slice 2
| Files actions | Status | Holo / κ notes |
|---|---|---|
| CreateFolder, CreateFile, CreateFolderWithSelection, AddItem | ✅ | new object → κ; inserted into the folder manifest |
| OpenItem, OpenInNewTab(+FromHome/Sidebar), BaseOpenInNewTab | ✅ | resolve κ → holo-render |
| CopyItem, CutItem, PasteItem, PasteItemToSelection, CopyItemFromHome/Shelf/Sidebar, CutItemFromShelf, DuplicateSelectedTab | ✅ | clipboard of κ-refs; paste = manifest edit → new folder κ |
| BaseTransferItem (Move to… / Copy to…), FlattenFolder | ✅ | manifest moves; flatten = merge child manifests |
| CopyPath, CopyPathWithQuotes, CopyItemPath, CopyItemPathWithQuotes, EditPath | ⊚ | "path" = the `holo://κ` address (+ FHS projection) |
| CreateShortcut, CreateShortcutFromDialog, PasteItemAsShortcut | ⊚ | a shortcut = a tiny κ object referencing a target κ (already the desktop "assign-to-app" idea) |
| CreateAlternateDataStream | ⛔ | NTFS alternate data streams — no κ analogue |

## Delete, recycle, undo — Slice 2
| Files actions | Status | Holo / κ notes |
|---|---|---|
| DeleteItem, BaseDelete, DeleteItemPermanently | ⊚ | delete = move into a **Recycle** κ-folder; permanent = drop the ref |
| RestoreRecycleBin, RestoreAllRecycleBin, EmptyRecycleBin | ⊚ | restore = move back; empty = clear the Recycle manifest |
| Undo, Redo, RefreshItems | ✅ | trivial: every edit already made a new folder κ — undo = previous κ |

## Organization: tags, favorites, recents, search — Slice 3
| Files actions | Status | Holo / κ notes |
|---|---|---|
| Tags (assign in properties), RemoveTags | ✅ | tags = a κ index {tag → [κ]}; colored |
| PinFolderToSidebar, UnpinFolderToSidebar, PinToStart, UnpinFromStart | ⊚ | favorites/pins = a κ list (sidebar + dock) |
| Search | ✅ | name search ✅; **content search** ⊚ (index over resolved κ bytes) |

## Properties & preview — Slice 3
| Files actions | Status | Holo / κ notes |
|---|---|---|
| OpenProperties, OpenClassicProperties | ✅ | tabs: General · Details · Security→κ/owner (holo-own) · Customize→icon/cover |
| TogglePreviewPane, ToggleDetailsPane, ToggleInfoPane, LaunchPreviewPopup, OpenFileLocation | ✅ | preview pane = holo-render of the selected κ |

## Theme & settings — Slice 1
| Files actions | Status | Holo / κ notes |
|---|---|---|
| SetDarkTheme, SetLightTheme, SetDefaultTheme, ToggleAppTheme, BaseAppTheme | ✅ | reuse holo-theme tokens |
| OpenSettings, OpenSettingsFile, ToggleShelfPane, BaseUI, I, IToggle | ✅ | settings pages that have a κ meaning; (I/IToggle/BaseUI are base classes) |

## Share & "set as" — Slice 4
| Files actions | Status | Holo / κ notes |
|---|---|---|
| ShareItem | ✅ | reuse the shell's share-to-run (`holo://κ` link + QR) |
| SetAsWallpaperBackground, SetAsLockscreenBackground, SetAsSlideshowBackground, SetAsAppBackground, BaseSetAs | ⊚ | reuse the κ wallpaper system already in the shell |
| PinToStart / PinFolderToSidebar (desktop pinning) | ⊚ | unifies with the desktop folder/icon layer |

## Advanced — Slice 5
| Files actions | Status | Holo / κ notes |
|---|---|---|
| CompressIntoZip, CompressIntoSevenZip, CompressIntoArchive, BaseCompressArchive, DecompressArchiveToChildFolder, BaseDecompressArchive | ⊚ | archive = a κ-bundle; zip/unzip in JS (no Win shell) |
| RotateLeft, RotateRight, BaseRotate | ⊚ | image transform → new κ |
| PlayAll | ✅ | a media folder → the media player app |
| GitClone, GitFetch, GitPull, GitPush, GitSync, GitInit, OpenRepoInIDE | ⊚ | route to Holo Gitea / Create studio |
| InstallFont | ⊚ | register a font κ for the theme system |
| EditInNotepad, OpenInIDE | ⊚ | open the κ in Create studio (Code view) |
| OpenTerminal, OpenTerminalAsAdmin, OpenTerminal(FromHome/Sidebar) | ⊚ | route to the Holo terminal app (no admin tier) |

## N/A — no κ/OS meaning (explicit, not dropped)
| Files actions | Reason |
|---|---|
| FormatDrive, FormatDriveFromHome/Sidebar | no real block devices; "drives" are κ sources |
| InstallInfDriver, InstallCertificate | no Win32 driver/cert store |
| RunAsAdmin, RunAsAnotherUser, RunWithPowershell, BaseRunAs | no OS process/privilege model (capabilities are κ-gated instead) |
| OpenStorageSense (+FromHome/Sidebar) | Windows Storage Sense; the κ cache self-manages |
| OpenLogFile, OpenLogFileLocation, OpenHelp, OpenReleaseNotes | app-meta; minimal/About link only |

---

## Slice plan (each independently verifiable)
1. **S1 — Explorer shell + views.** Tabbed, dual-pane, sidebar, breadcrumb/address bar, command bar, status bar; Details/List/Tiles/Grid/Columns with per-folder memory + sort/group/filter; navigation, selection, command palette, theme. Over the existing `holo-files.js` model + the shell's tab/window/icon primitives.
2. **S2 — File ops + undo + recycle.** Create/open/copy/cut/paste/duplicate/rename/move/delete→recycle→restore; undo/redo (free from κ history); shortcuts.
3. **S3 — Tags, favorites, recents, search, properties, preview pane.**
4. **S4 — Desktop unification.** The desktop *is* Holo Files rooted at the desktop folder; folder icons open into the same explorer; one model, no duplicate paths; share-as-κ; "set as wallpaper".
5. **S5 — Advanced.** Archive, image rotate, media PlayAll, Git, open-in-IDE/terminal, compact overlay.

## Acceptance (from the prompt)
- [ ] S1 shell + 5 view modes + per-folder memory
- [ ] S2 full op set, undoable, recycle round-trips
- [ ] S3 tags/favorites/recents/search persist as κ
- [ ] S4 desktop ⇄ icons ⇄ explorer share ONE model
- [ ] Any view shareable as `holo://κ`, reproduced byte-identically
- [ ] This matrix kept current (Mirror / κ-adapt / N/A) — no silent gaps
- [ ] reduced-motion + keyboard; no console errors; no full-tree re-render per change
