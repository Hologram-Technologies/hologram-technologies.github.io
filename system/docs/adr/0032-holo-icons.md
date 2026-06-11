# ADR-032: Holo Icons — open icon libraries as content-addressed UOR objects

**Status:** Accepted — implemented and witnessed. Ships the vendoring tool (`tools/build-icons.mjs`),
the κ-pinned data for **Material Symbols** (Apache-2.0, Outlined, 6,704 icons) and **Tabler** (MIT,
6,194 icons) under `_shared/icons/<prefix>/icons.json` + `PROVENANCE.txt`, the content-addressed
catalog `_shared/icons/index.json`, the native renderer `_shared/holo-icons.js` (`<holo-icon>`), the
Holo UI Icons picker, and the gate `w3c:A46-icon-libraries` (`holo-icons-witness.mjs`, 8/8). The icon
arm of Holo UI (ADR-030) under adopt-don't-run (ADR-029).

**Context.** Hologram OS had no icon renderer: `data-holo-icons` was set by Holo UI but **never read**
(a dead attribute), icons were inline `<svg>` only, and the component catalog's lone icon entry
(Iconify) was a single hardcoded instance loading from a CDN (esm.sh) — neither scalable nor
serverless. The goal is to integrate the major open icon libraries as **first-class UOR
content-addressable objects**: vendored once, addressed by κ, rendered natively, recolorable, and
swappable as the OS icon theme — 100% in-browser, no CDN.

**Decision.** Adopt the open **Iconify-JSON** icon-set data format (the lingua franca of open icon
libraries) as κ-pinned UOR objects, rendered by a native element — *adopt the published format, don't
run the library's runtime* (ADR-029).

- **Vendored κ-pinned, no CDN (Law L4/L5).** `tools/build-icons.mjs` fetches each set's published
  Iconify-JSON at BUILD time, writes a deterministic (key-sorted) `_shared/icons/<prefix>/icons.json`,
  and records provenance (`PROVENANCE.txt`) + the content address in `_shared/icons/index.json`
  (`{prefix, license, source, count, file, kappa, sri}`, the same shape as the κ-pinned font library).
  A multi-variant set is bounded to one coherent family (Material Symbols → Outlined). The runtime
  loads only the LOCAL data; each set re-derives to its κ on load (Law L5).
- **Native render.** `holo-icons.js` defines `<holo-icon set name size label>` — a dependency-free
  custom element that lazy-loads a set once (cached), injects inline `<svg fill="currentColor">` so an
  icon inherits color + font-size like text and recolors with the accent for free. With no explicit
  `set` it follows the active OS icon theme and re-renders live when `data-holo-icons` changes.
- **Every icon a UOR object.** `HoloIcons.kappa(set,name)` = `did:holo:sha256:H(jcs{prefix,name,body})`
  — each icon is content-addressable, not just the set.
- **`data-holo-icons` made live.** Holo UI's Icons section is now a set **picker** + live preview;
  selecting calls `HoloUI.setIcons(prefix)` → `data-holo-icons` → every `<holo-icon>` reskins. The
  dead attribute became the OS icon-theme switch.

**Consequences.** Two complete, beloved icon libraries (~13k icons) are available OS-wide as
self-verifying, serverless, recolorable objects, and the OS icon theme is swappable from one place.
Costs: ~5 MB of vendored data added to git + the κ-closure (bounded to one variant per set, lazy-loaded
+ κ-cached; could gzip/shard later). The existing `pure` catalog entries (Shoelace/Material Web/Iconify)
still load from CDNs — Holo Icons is the no-CDN path, and re-pointing the Iconify catalog entry to
`<holo-icon>`, plus a browsable per-set showcase tile in the A31 World library, are follow-ups (the sets
are already first-class κ-objects via `index.json` + the witness, and browsable/applicable via the Holo
UI picker). Adding more libraries is a one-line entry in `build-icons.mjs`.

External authorities: **W3C** SVG 2 · Custom Elements / Shadow DOM · Web Cryptography API; **DCAT** +
multiformats (the κ); the open **Iconify-JSON** icon-set data format. Libraries: **Material Symbols**
(Apache-2.0, Google) · **Tabler** (MIT). Builds on ADR-029 (adopt-don't-run), ADR-030 (Holo UI),
ADR-025 (UOR envelope), ADR-024 (witnessed conformance). Witness: `holo-icons-witness.mjs` (A46);
modules: `tools/build-icons.mjs`, `_shared/holo-icons.js`, `_shared/icons/`.
