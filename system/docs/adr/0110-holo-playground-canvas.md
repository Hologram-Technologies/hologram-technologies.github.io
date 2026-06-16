# ADR-0110 — Holo Playground 3.0: the screen as a real playground

Status: **STAGES 1–3 LANDED (the full core).** The screen is now a genuinely fun, intuitive, limitless playground — edit, drag, hide, delete, scale, rotate, multi-select, unleash forces, play games — with every Law intact. Stage 1 (the canvas layer): a new served module `os/usr/lib/holo/holo-playground-canvas.mjs` (`createPlaySession` + `createCanvasDock` + style/selection/handle helpers + `createSelectionUI`) gives the existing Playground agent (`holo-playground-agent.mjs`) direct manipulation — grab, drag, hide, delete any element — governed by one rule: **play is ephemeral, Freeze commits**. Witnessed `tools/holo-playground-3-witness.mjs` (27/27), row `#holo-playground-canvas`. Stage 2 (whole-screen **forces**): `holo-playground-forces.mjs` (pure field functions + integrator + a data-driven registry: tornado, earthquake, black hole, magnet, confetti, gravity-flip) + `holo-playground-shatter.mjs` (pretext-evaluated text-shatter) drive the SAME ephemeral session, so a tornado that scatters the screen never seals. Witnessed `tools/holo-playground-forces-witness.mjs` (19/19), row `#holo-playground-forces`. Stage 3 (**mini-games** + canvas polish): `holo-playground-games.mjs` (Whack + Match behind a pluggable host that runs in its OWN private session — games can never seal) + marquee multi-select + scale/rotate handles. Witnessed `tools/holo-playground-games-witness.mjs` (19/19), row `#holo-playground-games`. All four Playground rows earl:passed; 0 net-new gate reds.

Relates: ADR-0093 (the `liveEdit` primitive — the ONE edit path Freeze reseals through) · ADR-0095 (κ-aliased live surfaces) · the existing `#holo-playground` row (right-click code edit) · `pretext` (github.com/chenglou/pretext — evaluated for Stage 2 text-shatter).

## Context

Playground today makes every element right-click-**editable as code** (Edit source / Edit text / Duplicate / Delete → reseal to a new κ). That is powerful but not *playful*: there is no grab-and-move, no whole-screen fun, no sense that the screen is yours to bang on. The goal of 3.0 is that arming Playground turns the entire screen into a living, draggable, editable canvas — limitless and intuitive enough that it feels like child's play — without breaking a single Law (the ONE edit path, L5 content-address purity, opt-in dormancy).

The danger is obvious: if dragging, scattering, or a "tornado" silently reseals the κ on every frame, content-addressing becomes meaningless and every idle fidget churns lineage. So the whole design rests on one decision.

## Decision — the L5 play rule: play is ephemeral, Freeze commits

Direct manipulation is **play**, and play is **ephemeral**. Move/hide/delete mutate the **live, real, serializable bytes** of the surface (an inline `style` transform for a move, `display:none` for a hide, structural removal for a delete) but **never seal**. The κ does not churn while you play. Persisting an arrangement is a deliberate, separate act:

- **Freeze ✦** writes the current live bytes into the source and reseals to a **new root κ** through the ONE primitive `createLiveEditor.edit` — the *exact* path the right-click edit, the Q chat sidecar, and Holo DevTools already use. No second sealer. It then clears the play session so the arrangement becomes the new baseline.
- **Reset** restores the **exact pre-play bytes** (ordered re-insert of deleted nodes, attribute-level restore of moved/hidden ones) with zero κ churn.
- **Exiting Playground without Freeze discards** the arrangement.

So a screen you scatter with a tornado and then dismiss is byte-identical to before; only an explicit Freeze changes the content address (Law L5). This rule is the spine that Stages 2–3 ride.

Because a move is a *real* inline-style declaration, the agent's existing `serialize()` (which already strips every `[data-holo-ephemeral]` node and the transient glow class) **bakes the move into the sealed κ** on Freeze while dropping all play-chrome — so the κ === "user source + the frozen arrangement", zero injected noise, re-derivable.

## Architecture — a pure core + a browser skin (the Atlas discipline)

`holo-playground-canvas.mjs` has two halves over the same state:

1. **`createPlaySession`** — PURE and window-free. Every op snapshots the element's pre-play state into a backup map before its first mutation, mutates a real attribute, and `reset()` restores it byte-for-byte. `freeze()` only drops the backups (the live bytes are now the baseline) — it seals nothing. Pure style-attribute helpers (`parseStyle` / `formatStyle` / `setStyleProp` / `composeTransform`) keep a move to one `transform` declaration without clobbering other inline styles, and a zeroed move leaves no residue. Because it touches only `get/set/removeAttribute` and child-node structure, a Node witness drives it over a deterministic mock DOM — no jsdom, no browser.
2. **`createCanvasDock`** — a browser-only `[data-holo-ephemeral]` HUD (pending-count, Freeze, Reset, a tray to un-hide). A no-op without a document, so it never enters the witness or the sealed κ.

The agent (`holo-playground-agent.mjs`) owns the pointer wiring: a primary-button drag past a 4px threshold moves the element (below it, a plain click/selection); the right-click menu gains **Hide** and (when play is pending) **Freeze layout** / **Reset**; **Delete** becomes ephemeral (undoable until Freeze, a strict UX improvement). Any commit — the Freeze button, or an explicit code Apply — reseals the live bytes and then calls `session.freeze()`, so the two verbs stay consistent. This wires into the SAME in-frame and in-shell agent, so both same-origin app frames and non-iframe shell surfaces gain the canvas with **no per-surface code**.

Code editing (Edit source / Edit text) stays an explicit, immediate κ-edit — a different verb from play. The line is: *direct manipulation is play (ephemeral); code editing is authoring (immediate).*

## Staged plan

- **Stage 1 (LANDED).** The canvas: drag-to-move, hide, ephemeral delete, the dock, Freeze/Reset. Proves the ephemeral-vs-seal spine. Witness 27/27, row green.
- **Stage 2 (LANDED).** Whole-screen **forces** — `tornado`, `earthquake`, and a data-driven field registry (`black-hole`, `magnet`, `confetti`, `gravity-flip`) where a force is a pure field function over object centroids plus a pure integrator (gravity · damping · floor/wall/ceiling collision · spin), driven by a browser rAF engine that writes through the SAME session (so Freeze/Reset just work) and never seals. The dock gains a Forces launcher (in-frame app surfaces only — forces never fling shell chrome). Text paragraphs shatter into word fragments that fly individually (see pretext below). Witness 19/19, row green.
- **Stage 3 (LANDED).** **Mini-games** played on the screen's own κ-objects (Whack + Match) behind a pluggable data-driven host (`holo-playground-games.mjs`). A game is the cleanest statement of the L5 rule: it runs in its OWN private `createPlaySession`, separate from the surface's editable session, so it can **never** seal — quitting resets that private session and the surface returns untouched. Plus the canvas polish that completes the "limitless canvas": **marquee multi-select** + group drag, and **scale/rotate handles** (`createSelectionUI`) that drive the same session (Freezable like a move). Also fixed a latent edit-after-Freeze bug — `freeze()` now keeps the per-element transform map so a drag/scale after a Freeze composes from the baked transform instead of clobbering it. Witness 19/19, row green.

### How a game can never seal (Stage 3)

Forces ride the *surface's* session (you may want to Freeze a tornado's result). A game must not — it is pure fun, not an edit. So `createGameHost` owns a **second, private** `createPlaySession`; every move/scale/hide a game makes lives there, never in the surface session the dock's Freeze reseals. On quit, the private session resets and the surface is byte-identical. The witness checks the structural invariant: the host is inert without a document and the pure logic exposes no sealer. Multi-select outlines and game markers use `holo-pg-*` classes, which `cleanClass` now strips wholesale — no transient class can ever reach a κ.

### How a force rides the spine (Stage 2)

A force is not a new κ concept — it is an *automated driver* of the Stage 1 session. `createForceEngine` reads each top-level object's live rect once, seeds a particle from the session's current transform, ticks the pure `integrate()` on `requestAnimationFrame`, and writes every frame through `session.setTransform`. Because that is the exact same tracked mutation a drag makes, **Reset restores byte-for-byte and Freeze bakes the settled arrangement through the ONE path — for free**. The engine mutes the session's per-frame `onChange` so the dock isn't rebuilt 60fps, applies a decaying screen-shake for the earthquake, and on stop/settle reassembles any shattered text *before* returning, so a Freeze never bakes a transient. The witness proves the spine by simulating a force over the real session with no rAF: a move goes live, nothing is posted up, the shard layer is stripped, and Reset is byte-identical.

## pretext evaluation (Stage 2 dependency, honest)

`chenglou/pretext` is a DOM-free **text measurement & layout** library: a one-time `prepare()` caches segment widths via canvas, then `layout()` is pure arithmetic — no `getBoundingClientRect`, no reflow. It is **not** a drag/physics toy, so it is orthogonal to Tracks A–C. Its one genuine fit is **text-shatter without reflow**: to blow a paragraph apart word-by-word in a tornado you need every word as an independent particle, and you cannot afford a layout pass per frame for hundreds of fragments.

**Decision (Stage 2): adopt pretext's core idea, not the library.** pretext's value is *comprehensive* correctness — bidi, i18n segmentation, full line-breaking — shipped as its own toolchain. Our need is narrow: the x/y offset of each whitespace-split word in one element's font, measured once, off the layout path. Vendoring the whole library (its own build) is not justified by that single use, so `holo-playground-shatter.mjs` takes pretext's *core idea* — DOM-free canvas measurement + pure-arithmetic layout — as a minimal shim. `layoutWords` is pure and isomorphic: the metric function is injected (a real canvas `measureText` in the browser, a deterministic stub in the witness), so word geometry is witnessed with no browser. This is exactly the sanctioned fallback the prompt named ("if the win doesn't justify the dependency, fall back to a minimal Range/canvas-measure shim and say so"). The `measure` interface is the seam: if richer scripts ever need true shaping, vendor pretext behind it without touching the engine.

## Design bar (met for Stage 1)

Touch + mouse parity (pointer events), ≥16px dock with 44px hit targets, golden-ratio rhythm, `--holo-*` tokens, no em-dashes in copy. `prefers-reduced-motion` is honored by the existing OS guard; the forces of Stage 2 must tame/disable under it.

## Honest boundaries

Stage 1 ships drag/hide/delete + Freeze/Reset only — scale/rotate handles, marquee multi-select, forces, and games are staged. The heavy shell renderer has been unresponsive to preview eval in this harness, so the live-shell round-trip is asserted by witness + clean-boot, not by a live screenshot; the data spine (play → serialize-survives → Freeze through the ONE path → re-derive) is proven pure-Node against the real sealer.
