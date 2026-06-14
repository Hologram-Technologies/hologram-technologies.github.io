# Holo Files ⇄ Files (files-community/Files) — feature-parity matrix

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
