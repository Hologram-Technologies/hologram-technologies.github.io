# ADR-050: Holo SDK — the front door to the substrate: one generator + one runtime façade build self-verifying, serverless holospaces auto-wired to the OS core modules

**Status:** Accepted — witnessed: `holo-sdk-witness.mjs` is green and `w3c:A60-holo-sdk` is a
required, product-gated row in `w3c-conformance.jsonld`; the `holo-sdk` spec row is in `specs.json`;
the runtime ships at `os/_shared/holo-sdk.js`, the generator at `os/tools/create-holospace.mjs`, the
guide at `docs/sdk/README.md`, and a generated reference app at `os/apps/hello/` (A26-packaged,
indexed, constitution-bound). Builds on the content-addressed app package (A26 / `build-app.mjs`),
the κ-route compiler (`gen-imports.mjs`), single-link serverless boot (A28/A29), the UOR envelope
(ADR-025), the constitution (ADR-033), and the core modules Holo UI (ADR-0030), UX (ADR-028), Terms
(`holo-terms`), Privacy (`holo-privacy`), Conform (ADR-031).

**Context.** The substrate could already *run* holospaces, but it had no **front door**. Authoring an
app meant hand-copying `_example/holospace.json`, hand-writing the κ-routed `<link>`/`<script>`
wiring, and running three tools in the right order — expert-only, error-prone, and nothing made the
five core modules (UI · UX · Terms · Privacy · Conform) actually *present* by construction. Two
external references framed the ask. **openSDKs** (openintegrations/openSDKs, MIT) is the ergonomic to
copy — spec-driven generation + a copy-a-template CLI — but not the runtime: it generates HTTP API
clients for talking to *servers*, the exact opposite of a Law L1 substrate where identity is content,
not location, and there is no server to call. **QVAC** (Tether, Apache-2.0) is the *format* to copy —
a unified, pluggable, namespaced surface with examples-first docs, and the same local-first / no-cloud
thesis — but again its domain runtime (on-device AI) is not the substrate. The lesson both teach:
take the **pattern**, adopt any **code as a κ-object** (ADR-0029), never run a foreign runtime.

**Decision.** Ship the Holo SDK as exactly two pieces, buildless and vanilla, that *orchestrate the
existing pipeline* rather than reinvent it:

1. **A runtime façade** — `os/_shared/holo-sdk.js` exposes `window.HoloSDK`, a unified, lazily-bound
   surface over the globals the projection and auto-injection already provide: `ui` · `ux` · `terms`
   · `privacy` · `conform` (the conscience gate) · `object` (UOR address/verify) · `icon`. It wraps —
   it adds no crypto, no UI, no gate. `ready()` resolves once the theme is applied and the
   constitution has self-verified (Law L5); accessors read `window.*` on call, so module load order
   never races. This is the "auto-wired" promise made into one import.

2. **A generator** — `os/tools/create-holospace.mjs` scaffolds `apps/<id>/` from embedded templates (a
   tasteful, mobile- and theme-conformant `index.html`; a schema-valid `holospace.json` whose
   `conforms.specs` name only ids that exist; an `icon.svg`), then drives the established cascade:
   `gen-imports` (compile shared refs → κ-addresses, reconcile the manifest) → `build-app`
   (content-address the closure into a self-verifying `did:holo` lock; `holo-conscience.js` is pinned
   automatically, ADR-033) → the DCAT index → `apps-witness`. One command yields a gate-green,
   single-link-bootable holospace. A `--minimal` flag honours QVAC's "include only what you need"; the
   five core modules stay always-wired (the hard requirement).

The SDK is itself a catalogued, witnessed citizen: the `holo-sdk` spec row, the required `w3c:A60`
row, and `holo-sdk-witness.mjs`, which proves — offline — that a *generated* app satisfies the
holospaces invariants: its root and whole closure re-derive (Law L5), it is indexed and single-link
bootable (A26/A28), constitution-bound (ADR-033), auto-wired to all five core modules + the façade,
and conforms only to specs that exist (strict grounding — the gate's own rule).

**Consequences.** Anyone can build, run, and **share** a fully functional holospace in one command;
the share unit is a link, and opening it boots the holospace + app in any browser, served by κ from
cache/peers/origin with no server (A28/A29, Law L1) and low latency (content-addressed dedup + cache,
Law L3). Generated apps are interoperable by construction — indexed in DCAT and projected into the
agent doors (NANDA · A2A · Skills · MCP) and the Atlas. Because the generator emits and re-locks an
app under `os/apps/**`, creating one triggers the standard re-lock cascade; the generator runs the
app-level steps, and `build-os-root.mjs` recomposes the OS root at ship time. `holo-sdk.js` is an
app-level `_shared` module (loaded inside the app iframe, not part of the OS bootstrap), so it is
*not* in the delivery `SHELL`; it is committed to the OS root transitively through any app that uses
it. Three capabilities are scoped as follow-on stages with their own ADRs: openSDKs egress (Stage 2),
OpenTelemetry-aligned observability (Stage 3), and browser-native serverless AI (Stage 4). The core
SDK already *enables* AI apps today; Stage 4 makes local inference a first-class κ-object capability.

**External authorities.** holospaces specification (Hologram-Technologies/holospaces) — Laws L1/L4/L5,
the holospace manifest; W3C DID Core (`did:holo`) + Subresource Integrity + JSON-LD; openSDKs (MIT,
pattern only); QVAC / Tether (Apache-2.0, format only). Mints nothing — schema.org/DCAT/PROV-O + the
UOR envelope, as the rest of the catalog.
