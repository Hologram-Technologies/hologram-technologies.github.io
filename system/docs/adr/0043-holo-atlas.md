# ADR-043: Holo Atlas — the community map of every holospace, native to the UOR substrate: one self-verifying map of content truth, not popularity

**Status:** Accepted — witnessed: `atlas-witness.mjs` is green and `w3c:A55-holo-atlas` is a required,
product-gated row in `w3c-conformance.jsonld`; the spec row `holo-atlas` is in `specs.json`; the app ships
at `os/apps/atlas/` (A26-packaged, indexed, constitution-bound). Builds on the content-addressed app index
(A26 / `build-app.mjs`), the UOR envelope (ADR-025), the one κ primitive (Law L2), and the agent-door
projections — NANDA (ADR-034), Skills (ADR-035), A2A (ADR-036).

**Context.** The ecosystem has an outside reference point — [Hermes Atlas](https://hermesatlas.com/), a
community map of the Nous Research Hermes ecosystem: a searchable card directory of ~100 repos ranked by
GitHub **popularity** (stars, forks, weekly velocity). It is the natural "front page of an ecosystem." But
popularity is a web2 signal — scraped from a central host, gameable, and orthogonal to whether the thing it
ranks is real. Hologram OS already has everything a map needs, expressed as the *opposite* kind of signal:
every holospace is a self-verifying, content-addressed object, and the OS already publishes the canonical,
machine-readable indices — `apps/index.jsonld` (the DCAT app catalog), each `holospace.json` (the manifest)
+ `holospace.lock.json` (the closure), the per-app NANDA/A2A projections and the OS-wide Skills/MCP roster,
and `apps-witness.result.json` (the integrity proof). What was missing was the *map itself*: a single
surface that discovers, indexes and monitors every holospace — and does so as a first-class citizen of the
substrate, not a dashboard bolted on top.

The UOR-native inversion writes itself. Instead of ranking by stars, map by **content truth**: a
holospace's identity is its `did:holo` (the hash of its own closure); its size is the bytes that κ commits
to; its integrity is re-derivable in your tab (Law L5); its place on the map is the real shared-dependency
graph the store dedups (Law L3); and its reach is the agent doors it is projected through. None of this is
asserted — all of it re-derives. And the map of self-verifying objects is itself a self-verifying object.

**Decision.** **The atlas is a pure projection of the canonical sources, sealed as one re-derivable κ, and
shipped as a holospace that appears in its own map.** Four binding rules:

1. **Discover by reading, not by listing** (`_shared/holo-atlas.js`, `atlasModel(sources)`). The map is a
   pure, deterministic function of what already exists — `apps/index.jsonld` joined to each
   `holospace.json`/`.lock.json` and the door indices (Law L4, no parallel store). There is no
   hand-maintained app list: a new or changed holospace appears (or moves) the moment the indices it is
   built from change. The SAME runtime feeds the browser app and the node witness, so the displayed map and
   the gated proof can never drift.

2. **Map content truth, in two synchronized views.** A **constellation** (a force-directed canvas graph:
   nodes are holospaces sized by closure bytes, edges are shared dependencies (kind `dep`, the Law-L3
   closure graph) and shared specs (kind `spec`, the conformance community); the layout is display-only and
   never sealed) and a searchable, sortable, filterable **directory** of cards. A per-app detail panel
   surfaces the full `did:holo`, the closure table, conformance specs, the four agent doors, provenance,
   and a **live re-derivation badge** — the browser fetches each closure object by κ and re-hashes it
   (`holo-object.js`, the A14 verify-in-tab idiom): a tampered byte shows red, in your tab, with no server.

3. **The four doors are not symmetric — join, don't assume.** NANDA and A2A are *per-app* projections, so a
   record JOINS to them — NANDA by `schema:isBasedOn == the app's root κ`, A2A by `card.name == the app's
   name` (an A2A card carries no app id). Skills and MCP are *OS-wide* (one roster), so they are a single
   shared door, present for every app. The atlas reports door coverage honestly rather than pretending four
   per-app doors exist.

4. **Seal the whole map; self-update is enforced, not hoped** (`holo-atlas.mjs`). The map seals into one
   κ-rooted `schema:ItemList` (`atlas/index.uor.json`) that commits to every holospace as a child UOR
   object (its identity κ + monitored stats), plus a source catalog (`atlas/catalog.uor.json`) — both
   re-derive top-to-bottom (`verifyDeep`). Because the seal is a pure function of the sources, the committed
   artifact must equal a fresh re-derivation: a hand-edit, or a stale atlas after an app changed, **fails
   the gate**. Mint nothing: schema.org/DCAT/Dublin-Core/PROV-O + the atlas's own `hatl:` stat vocab (the
   one minted namespace, the sibling of federate's `hfed:`) + the UOR envelope.

**Consequences.**

- **A real front page today.** `node holo-atlas.mjs build` emits the sealed map + catalog; `os/apps/atlas/`
  is a live holospace that discovers every app from the index, renders the constellation + directory,
  re-derives each κ in-tab, and links each app's NANDA facts, A2A card, Skills index and MCP roster.
- **Self-updating by construction.** Add or change a holospace, rebuild, and the atlas tracks it with zero
  code change — the map is `f(sources)`. The atlas indexes *itself* once it is in `apps/index.jsonld` (a
  holospace too), so the ecosystem count is derived, never literal.
- **Self-verifying, fail-closed.** `atlas-witness.mjs` proves: every app root κ re-derives from its bytes
  via `build-app.computeApp` and matches its lock (Law L5); every closure leaf re-hashes; every app is
  reachable per-app on NANDA + A2A with the OS-wide doors resolving and the door indices re-deriving; the
  sealed map + catalog re-derive; the committed bytes equal a fresh re-derivation; a mutated byte breaks
  `verifyDeep`; every app carries the constitution; and it mints nothing.
- **Autonomous.** Pure client-side, offline, zero server, zero external API — discovery, monitoring and
  verification are all reads of content-addressed bytes.
- **Federation-ready (follow-on).** `atlasModel(sources)` takes a `sources` object; v1 passes the local
  canonical files. A later `sources.federated` (Holo Federate, ADR-038) merges external/community
  holospaces with no UI change. Other explicit follow-ons: an MCP `atlas` tool returning the self-verifying
  map, live peer/usage telemetry, and a homepage tile.

**External authorities.** W3C [schema.org](https://schema.org/) + [DCAT-3](https://www.w3.org/TR/vocab-dcat-3/)
+ [DCMI Terms](http://purl.org/dc/terms/) + [PROV-O](https://www.w3.org/TR/prov-o/); W3C
[Subresource Integrity](https://www.w3.org/TR/SRI/) / [IPLD](https://ipld.io/docs/) content-addressed
Merkle-DAG (Law L5); [DID Core](https://www.w3.org/TR/did-core/) (`did:holo`); the constitution (ADR-033).
Runtime (model + graph): `os/_shared/holo-atlas.js`; sealing + source catalog + CLI: `os/holo-atlas.mjs`;
the app: `os/apps/atlas/`; sealed map + catalog: `os/atlas/index.uor.json` + `os/atlas/catalog.uor.json`;
witness: `os/atlas-witness.mjs`; catalog row: `w3c:A55-holo-atlas` in `conformance/w3c-conformance.jsonld`.
