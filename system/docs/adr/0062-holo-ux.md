# ADR-062: Holo UX — the experience doctrine as one self-verifying UOR object

**Status:** Accepted — implemented and witnessed (`#holo-ux`, `tools/holo-ux-witness.mjs`, 37
checks). Revives and completes the Holo UX layer for OS2: ADR-028 defined the Holo UX Profile in
the original tree but OS2 only ported its dormant runtime modules (`holo-ux.js`,
`holo-capability.mjs`, `holo-voice.mjs`) with no canonical object, no conformance row, and the
host-OS resolver (`holo-platform.js`) wired only ad-hoc into a few components. This ADR makes Holo
UX a sealed, self-verifying, gated source of truth — the experience analogue of what ADR-057 made
the Holo UI tokens. It sits **under [ADR-030 Holo UI](0030-holo-ui.md)**: Holo UI is the control
surface (`window.HoloUI` · `holo-ui.html`), Holo UX is the *experience* it controls.

**Context.** A computer should feel native the first second it opens — like home on whatever
machine boots it — and should treat the person's time, attention, money, compute and energy as
sacred. Those are not decorations on top of an app; they are *parameters*, and in this OS every
parameter is a content-addressed object, not a config trusted by location (ADR-025, Law L4/L5). The
brief is concrete: autodetect the host OS and adapt dynamically; feel familiar and effortless;
reveal power on the user's curiosity, never force it; maximize signal over noise; and hold the eight
UX lessons of Steve Jobs (design is how it works; simplicity ruthlessly refined; the user first;
focus and say no; detail in the unseen; redefine the question; seamless integration; it just works
and delights). Four facts constrain the design:

- **One object, one identity (L1/L2).** There must be exactly one canonical UX source; every
  surface binds its κ, none restates its values — change the κ, the whole system changes.
- **Mint nothing (ADR-024).** The genuinely-new UX terms live in a scoped OWL/SKOS vocabulary
  (`hosux:`); every near-equivalent declares `skos:closeMatch` to a ratified authority (WCAG, RAIL,
  UA Client Hints, UOR-ADDR). The rest reuses SKOS, schema.org, DCMI Terms and PROV-O unchanged.
- **Verify by re-derivation (L5).** The object and its source links must re-derive to their content
  address; a tampered byte is refused, never trusted.
- **No drift.** The dereferenceable vocabulary and the sealed object are *materialized* from one
  data source, never hand-maintained in parallel (the discipline `holo-voice.mjs` already uses).

**Decision.** The experience is **one content-addressed object — the Holo UX doctrine** — declared
from a single source, sealed onto the substrate, resolved against the host, and propagated to every
holospace.

- **One source (`_shared/holo-ux-doctrine.mjs`).** Pure data: thirteen TENETS (the five founding
  principles + Jobs's eight lessons), each a `prefLabel`, a plain-voice `principle`, and a checkable
  `obligation` — the conformable rule a per-app ratchet binds; the seven host OSes the doctrine
  spans; and the materializers that emit the vocabulary and feed the sealed object. Nothing
  downstream restates these values.

- **The dereferenceable vocabulary (`os/usr/share/ns/ux.jsonld`).** The `hosux:` OWL ontology +
  the doctrine as a SKOS `ConceptScheme`, materialized from the source (the witness refuses any
  drift). Mints only the new UX terms (`Tenet`, `obligation`, `PlatformProfile`, `capabilityTier`,
  `voiceRegister`, `resourceBudget`); everything else is reused W3C/community vocabulary.

- **The sealed object (`os/etc/holo-ux/doctrine.uor.json`).** A UOR envelope (ADR-025) that embeds
  the thirteen tenets, the FAITHFUL native-OS profile matrix (driven through the real
  `HoloPlatform.profileFor` resolver, not restated), the capability tiers, the plain-voice register
  and the tier-aware resource budget, and **Merkle-links** the eight canonical source files
  (`ux.jsonld`, `holo-ux-doctrine.mjs`, `holo-ux.js`, `holo-platform.js`, `holo-capability.mjs`,
  `holo-voice.mjs`, `holo-phi.css`, `holo-perf-budget.json`) by content address. Its `did:holo`
  re-derives and a tampered linked byte breaks the address (L5). Built deterministically by
  `tools/seal-ux-doctrine.mjs`; carries the blake3 alias for the shared substrate.

- **Native by autodetection (the experience adjusts dynamically).** `holo-ux.js` resolves the host
  with `HoloPlatform` and adapts the chrome to its native feel — modifier key (⌘/Ctrl), window-
  control side (left on macOS, right on Win/Linux), font, accent — stamping `data-holo-platform` /
  `-mod` / `-controls` and SEEDING the native accent + font through Holo Theme **without overriding
  an explicit user choice**. It also resolves the device capability tier and propagates the whole
  resolved state down the nested-holospace tree (the same `postMessage` pattern as Holo Theme), so
  the host is one fact applied everywhere — not re-detected per app. The desktop shell loads it.

- **Conformance.** `tools/holo-ux-witness.mjs` proves the object re-derives and its links re-derive
  (L5, tamper-refused); the vocabulary has not drifted; all thirteen tenets carry obligations and
  are embedded; the five named hosts (+ iPadOS/ChromeOS) resolve to *distinct* native feel and the
  sealed matrix is faithful to the live resolver; the runtime applies it and the shell loads it; the
  tier resolution is conservative + honest headless; the doctrine practises its own plain voice; and
  the budget keeps interaction ≤100 ms on every tier (RAIL). Required row `#holo-ux` in the gate.

**Consequences.** The experience is now a canonical, self-verifying κ-object every holospace can
bind — "feels native, familiar and effortless, treats my resources as sacred" becomes the gate, not
a hope, exactly as the Holo UI tokens did for the look. It composes with ADR-022/023/024/025/030/057
and adds zero runtime framework. The next step (a maintainer's, per the brief) is the *per-app*
ratchet that wires every native app's conformance to these upstream parameters — the experience
twin of `#app-ui-wired` / `#app-ui-tokens`. Costs: the `hosux:` vocabulary and the seal step to
maintain (re-run `seal-ux-doctrine.mjs` after editing the doctrine — the witness catches a stale
seal); and the same honest non-coverage of pixel-only surfaces (VM/canvas) inherited from ADR-023.

**External authorities — W3C / platform:** UA Client Hints (host autodetect); HTML Standard
(cross-document messaging); CSS Custom Properties; Media Queries L5 (`prefers-*`); Device Memory;
Network Information; WebGPU. **Semantic web:** OWL 2; RDF Schema 1.1; SKOS Reference; JSON-LD 1.1;
PROV-O; DCMI Terms; schema.org; RFC 8785 (JCS). **Accessibility / performance:** WCAG 2.2 (§1.4.3
Contrast, §1.4.4 Resize Text, §2.3.3 Animation, §2.5.8 Target Size); RAIL / W3C Web Performance.
**Identity & regime:** ADR-022 (W3C content addressing), ADR-023 (Holo Theme), ADR-024 (conformance
gate), ADR-025 (UOR envelope), ADR-028 (Holo UX Profile), ADR-030 (Holo UI), ADR-057 (Holo UI
conformance). UOR-ADDR (κ = H(canonical_form)); verify by re-derivation (Law L5).
