# Holo SDK — build serverless, content-addressed apps

> One command scaffolds a **fully functional, beautiful, self-verifying** holospace,
> auto-wired to the five Hologram OS core modules. Share a link and it boots in **any
> browser, with no server**. Buildless and vanilla — the substrate is the package manager.

The Holo SDK (ADR-0050) is the front door to the UOR content-addressable substrate. It is
**strictly grounded in the holospaces specification** ([Hologram-Technologies/holospaces](https://github.com/Hologram-Technologies/holospaces)):
every app it produces is a κ-addressed holospace whose identity *is* its content (Law L1),
that re-derives byte-for-byte on any peer (Law L5), boots from a single link (A28), and carries
the constitution (ADR-033).

---

## Getting started

The SDK is two pieces — a **generator** and a **runtime façade** — and zero build step:

- `os/tools/create-holospace.mjs` — scaffolds an app and drives the existing content-addressing
  pipeline so it is gate-green on creation.
- `os/_shared/holo-sdk.js` — `window.HoloSDK`, a unified façade over the five core modules.

No npm install, no bundler, no `dist/`. The app loads everything by content address
(`/.holo/sha256/<κ>`) over the κ Service Worker.

## Quickstart

```sh
# from os/
node tools/create-holospace.mjs my-app --name "My App" --summary "What it does." --category Utility
```

That one command:

1. writes `apps/my-app/` — a beautiful `index.html`, `holospace.json`, `icon.svg`;
2. compiles the shared refs to content addresses (`gen-imports`);
3. content-addresses the whole closure into a self-verifying `holospace.lock.json` (`build-app`);
4. indexes it in the DCAT store (`build-app`'s index);
5. confirms it is a self-verifying, constitution-bound, indexed holospace (`apps-witness`).

Flags: `--name`, `--summary`, `--category`, `--accent #rrggbb`, `--minimal` (wire only the five
core modules + façade), `--force` (overwrite).

## Core concepts

- **Holospace** — a bootable, κ-addressed app. One `holospace.json` declares what it *is*; the
  generated `holospace.lock.json` is its content-addressed closure (every file → its κ + W3C SRI).
- **κ (kappa)** — a content address: `did:holo:sha256:<hex> = H(canonical bytes)`. Identity is
  *what*, never *where* (Law L1).
- **Verify, don't trust** — every byte is accepted only after re-deriving its κ (Law L5). The
  `apps-witness` and `holo-sdk-witness` prove it offline.
- **Single-link boot** — opening `holospace.html?app=<id>` (or the `holo://κ` form) boots the
  holospace + app in any browser, served by κ from cache/peers/origin — no server (A28/A29).
- **Constitution-bound** — `holo-conscience.js` is pinned into every closure automatically (ADR-033).

## The five core modules (auto-wired)

A generated app loads all five and the façade exposes them on `window.HoloSDK`:

| Module | Façade | What it gives you |
| --- | --- | --- |
| Holo UI | `HoloSDK.ui()` | theme · typography · density · layout · icons (`.setAccent`, `.on('holo-ui-change')`) |
| Holo UX | `HoloSDK.ux()` | device-tier resolution (`.get()`, `.refresh()`) |
| Holo Terms | `HoloSDK.terms()` | MyTerms — effective, default-deny capabilities (already gated at mount) |
| Holo Privacy | `HoloSDK.privacy()` | minimal, purpose-bound disclosure (`.gate(req)` → a W3C Verifiable Presentation, or null) |
| Holo Conform | `HoloSDK.conform` | the fail-closed conscience gate (`.evaluate(d)`, `.sealed()`) |

Plus the UOR primitive `HoloSDK.object()` / `HoloSDK.address()` / `HoloSDK.verify()` (Law L5)
and `HoloSDK.icon(name)` for the `<holo-icon>` element.

## API reference

```js
await HoloSDK.ready();              // resolves when theme is applied + the conscience gate self-verified
HoloSDK.info();                     // { ui, ux, terms, privacy, conform, object, tier, accent }
HoloSDK.ui().setAccent("#22c55e");  // live re-theme
HoloSDK.ux().refresh();             // re-probe the device tier
const vp = await HoloSDK.privacy().gate({ purpose: "dpv:ServiceProvision", recipient: "my-app",
  claims: [{ category: "dpv-pd:EmailAddress", name: "email" }] });   // null = default-deny
HoloSDK.conform.evaluate({});       // { outcome: "accept" | "caveat" | "block", ... }
const did = await HoloSDK.address(obj);  HoloSDK.verify({ id: did, ...obj });   // Law L5
const off = HoloSDK.on("holo-ui-change", render);   // returns an unsubscribe
```

The façade is **lazy** — it reads the globals on call, never at import — so module load order
never races. Load `holo-sdk.js` before your inline module and `HoloSDK.ready()` awaits the rest.

## Sharing — a link is the whole app

A holospace has no server to deploy. Its identity is its content address, so **the share unit is a
link**. Send `holospace.html?app=<id>` (or `holo://<κ>`) and the recipient's browser boots the
holospace and the app inside it, resolving every byte by κ and re-deriving it locally (Law L5).
Identical content dedups and caches across apps (Law L3), so boots are low-latency. Every generated
app is also published into the DCAT index, the agent doors (NANDA · A2A · Skills · MCP) and the
Atlas — interoperable by construction.

## Conformance

The SDK is a first-class, witnessed citizen: spec row `holo-sdk` (`os/specs.json`), required catalog
row `w3c:A60-holo-sdk`, witness `os/holo-sdk-witness.mjs`. The witness proves — offline — that a
*generated* app re-derives (L5), is single-link bootable (A26/A28), constitution-bound (ADR-033),
wired to all five core modules, and conforms only to specs that exist (strict grounding).

## Roadmap

- **Stage 2 — egress.** Adopt the openSDKs runtime (MIT) as a κ-object for apps that reach external
  APIs; egress gated by Holo Privacy/Terms (`--egress`).
- **Stage 3 — observability.** `holo-trace.js`: spans as content-addressed UOR objects aligned to
  OpenTelemetry semantic conventions + W3C Trace Context, projecting to OTLP (dual-trust).
- **Stage 4 — browser-native AI.** `holo-ai.js`: an OSS in-browser inference engine adopted as
  κ-objects, model weights verified by κ (Law L5), prompts gated by Privacy/Terms, on `HoloSDK.ai`.
