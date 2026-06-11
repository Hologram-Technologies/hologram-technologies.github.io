# ADR-029: Adopt the desktop, don't run it — freedesktop/KDE standards as κ-objects, the DE as a swappable skin

**Status:** Accepted — the load-bearing pattern is already witnessed three times: **A37** adopts
the KDE **KWin tile-tree** layout format (`holo-zones.js`, `holo-zones.test.mjs`), **A38** adopts
the KDE **KColorScheme `.colors`** format (`_shared/holo-kcolorscheme.js`, `theme-kde-witness.mjs`,
the Breeze theme derived byte-faithfully from upstream), and **A39** adopts the KDE **Look-and-Feel
(Global Theme) package** as one κ-object wired through Holo Theme (`_shared/holo-lookandfeel.js`,
`theme-lookandfeel-witness.mjs`). This ADR records the *policy* those instances establish; each
further adoption named below ships its own witnessed row (ADR-024).
Governs UX/ecosystem reuse across the shell (`apps/world`) and the theme system (ADR-023, ADR-028).

**Context.** The goal is a desktop-native OS experience — feature-rich, familiar, magical —
delivered in *any browser* and **100% native to the UOR content-addressable substrate**, where
every window, theme, layout and app is a self-verifying κ-object (ADR-025). The instinct is to
reuse a mature open-source desktop environment — KDE Plasma — rather than handwrite one. That
instinct is right about *reuse* and wrong about *what* is reusable. Three facts close the door on
running a foreign desktop in the browser:

- **A toolkit is not the DOM.** Plasma is Qt/QML/C++ rendering to its own scene graph on
  Wayland/X11. QML objects cannot become DOM objects; there is no bridge. The same holds for any
  native widget toolkit (GTK, Qt). A toolkit's *widgets* are unreachable from the page.
- **Streaming and WASM yield pixels, not objects.** Running Plasma in a VM/container and piping it
  over RDP/VNC/WebRTC (the WSL2 route we tried) delivers a framebuffer: opaque pixels over a wire,
  server-bound, nothing κ-addressed, nothing self-verifying. Qt-for-WebAssembly collapses a Qt app
  into one opaque WebGL canvas — still not DOM objects, still not κ. Both violate substrate-nativeness
  outright (Law L1 location-independence, Law L5 re-derivation).
- **Other web desktops re-import a foreign object model.** daedalOS, Puter, OS.js and kin are either
  framework-coupled (React) or backend-coupled. Adopting their *runtime* re-imports someone else's
  object model in place of κ-objects, and a framework dependency breaks Law L4. There is no existing
  OSS desktop *runtime* that is native to this substrate.

What *does* port is everything a desktop publishes as **open, declarative data and assets** — and KDE
publishes nearly all of it: KWin layouts, color schemes, icon themes, window decorations, Global
Theme packages — atop the cross-desktop **freedesktop.org / XDG** standards every Linux desktop shares.

**Decision.** **Adopt the desktop, do not run it.** The *engine* is the browser-native,
content-addressed shell we already have (Custom Elements + Shadow DOM + Pointer Events; the window
manager, zones, keyboard layer, omnibox and theme system of A27–A38). A desktop environment —
Plasma/Breeze — is bound to it as a **swappable look-and-feel *profile*: published formats and assets
re-derived to κ**, never a runtime. Three binding rules:

1. **Never import a foreign runtime or widget toolkit** (Law L4). No Qt/QML/GTK, no UI framework as a
   source of truth, no streamed framebuffer as the shell. The shell stays standards-only DOM.
2. **Adopt the published *format/asset*, re-derived to its κ** (Law L5). A KWin tile-tree, a `.colors`
   scheme, a Breeze SVG, a `.desktop` entry is parsed by a pure, dependency-free adapter into the
   substrate's own object model, and content-addresses to a `holo://κ` — interoperable, not reinvented.
   One canonical adapter per format (Law L2); no parallel configuration medium.
3. **Every adoption is witnessed** (ADR-024). An adapter ships a Node witness (purity, faithful
   derivation, provenance, conformance) and a `w3c-conformance.jsonld` row; the decision is not done
   until it is green. The discipline is its own proof against drift.

The DE is thereby demoted from *engine* to *profile*: Breeze is what makes the shell *look and behave*
like Plasma, expressed as data the substrate owns. Swap the profile and the same engine wears a
macOS or Windows face — without touching the runtime.

**The adoption surface (roadmap — each an "adopt, not handwrite" κ-binding + witness).**

- **KDE Global Theme / Look-and-Feel package** — **Shipped (A39).** KDE's published Look-and-Feel
  KPackage (`metadata.json` + `contents/defaults`) is parsed into **one κ-object that reskins the whole
  desktop**: colors + Breeze square shape + Noto Sans flow through `HoloTheme.importTheme`, and the
  look-and-feel references (icons · decoration · layout · splash · cursor) are surfaced to the shell.
  "Save/share your setup as a global theme" is sharing a `holo://κ` a peer re-derives bit-for-bit.
- **Icon theme** — freedesktop **Icon Theme Spec** + the Breeze icon set (public LGPL repo
  `invent.kde.org/frameworks/breeze-icons`; no local/WSL files needed) into the content-addressed
  component/icon library (A31).
- **`.desktop` entries** — freedesktop **Desktop Entry Spec** adopted as the launch manifest, mapped to
  `holospace.json` (A26/A28) — the whole freedesktop app ecosystem's launch metadata reused as-is.
- **AppStream** — already partway (Holo Hub / ODRS, `holo-rank-hub`); the app-store data model.
- **Notifications + system tray** — freedesktop **Notifications** and **StatusNotifierItem** interface
  contracts adopted as in-browser object/event contracts.

**Consequences.** **Familiar** because the shell implements the *same standards every Linux desktop
implements* — Breeze makes it look like Plasma; XDG makes it behave like one. **Magical** because the
delta no native desktop has is preserved end-to-end: every window, theme, layout and app is
self-verifying, serverless, multiplayer, re-derivable and shareable as a link. The DE becomes a
first-class swappable artifact (Breeze today; macOS/Windows profiles later) rather than a runtime
dependency. We explicitly **reject** the streamed-Plasma and Qt-WASM routes as substrate-violating
dead-ends, and reject adopting any framework-coupled web desktop. The standing cost is one pure
adapter + one witness per adopted format — the same price A37 and A38 already paid, and the same
construction guarantee they already provide.

External authorities: **freedesktop.org / XDG** (Desktop Entry, Icon Theme, Notifications,
StatusNotifierItem, Base Directory, AppStream); **KDE** (KWin tile-tree, KColorScheme `.colors`,
Look-and-Feel / Global Theme, Breeze — LGPL); **W3C/WHATWG** (Custom Elements, Shadow DOM, Pointer
Events, CSS Custom Properties & Color 4, Design Tokens); **WCAG 2.2**. Builds on ADR-023 (Holo Theme),
ADR-024 (witnessed conformance), ADR-025 (the UOR envelope), ADR-028 (the UX Profile). Witnesses to
date: `holo-zones.test.mjs` (A37), `theme-kde-witness.mjs` (A38), `theme-lookandfeel-witness.mjs` (A39).
Modules: `_shared/holo-zones.js`, `_shared/holo-kcolorscheme.js`, `_shared/holo-lookandfeel.js`
(wired into `_shared/holo-theme.js` via `applyGlobalTheme`).
