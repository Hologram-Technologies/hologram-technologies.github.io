# ADR-0082: Holo Prov — provenance is a binding, in-tab-verifiable feature of every holospace: each app proves its own lineage by re-deriving every ancestor's closure, and the shell maintains the live, content-addressed provenance hypergraph

**Status:** Accepted — LANDED in the running OS but **witness + conformance row pending** (the ADR-0052
posture). The in-tab twin (`os/usr/lib/holo/holo-prov.js`, exposing `window.HoloProv` + the live lineage
badge, opt-out `<meta name="holo-prov" content="off">`) and the shell binding
(`os/usr/lib/holo/holo-prov-ui.js`) are implemented and **bound on every holospace**: the World shell
imports the binding once and calls `HoloProv.register(node, el)` as it mounts each window
(`os/usr/share/frame/shell.html`, the import + the per-mount call, the twin of `holo-own-ui.js`).
**Deferred:** the isomorphic witness `tools/holo-prov-witness.mjs` (the verification core is already a
pure function built for exactly this — see Decision 1) and the required `#holo-prov` row in
`os/etc/conformance.jsonld`. Builds on the UOR envelope (ADR-0025), the verify-in-tab idiom of **Holo
Atlas** (ADR-0043), the append-only hash-linked chain of **Holo AgentTrust** (ADR-0039), the remix
lineage of **Holo Own** (ADR-0053) / **Holo Share-to-Run** (ADR-0064), W3C PROV-O, and Law L5.

> **Numbering note.** This feature shipped citing "ADR-0076" in code, which collided with **Holo Heal**
> (ADR-0076, LANDED) and **Holo Suspend** (moved to ADR-0077). Heal keeps 0076; Holo Prov is assigned its
> own number here (0082) and the source references are corrected to match. This ADR is written
> retroactively to give a shipped, binding feature the decision record it never had.

**Context.** The substrate makes every object self-verifying by content (Law L5), and objects *evolve*:
a holospace is revised (`prov:wasRevisionOf`) and remixed from another (`prov:wasDerivedFrom`, the
one-tap fork of ADR-0064, the Title lineage of ADR-0053). But evolution was *recorded* without being
*shown* or *checked at the point of use*: an app carried a parent edge in its manifest, yet nothing
verified that the parent actually existed, that its bytes re-derived, or that the edge pointed where it
claimed — and a user looking at a running app had no way to see "where did this come from, and is that
lineage real?" A provenance claim you cannot re-derive is exactly the "trust me" the substrate exists to
dissolve. Two facts make a stronger treatment both possible and cheap. First, a lineage is just a walk
over content-addressed edges, and each hop is checkable by *the same re-derivation the OS already does
for delivery*: resolve the claimed parent κ to an indexed app, assert the parent's `holospace.lock.json`
root equals the κ the child commits to, and re-hash every file in the parent's closure to its κ (Law L5).
A forged parent is caught structurally — it resolves to no indexed app, or its bytes do not re-derive.
Second, because that check is a **pure function of injectable resolvers**, the exact logic the browser
runs is the logic a Node witness runs (the Holo Atlas isomorphism, ADR-0043) — so "provenance is
verified, not asserted" is witnessable, not a slogan.

**Decision.** **Make provenance a binding, in-tab-verifiable feature of every holospace, and maintain the
live provenance hypergraph at one shell binding point.** Three rules.

1. **Lineage is re-derived, not trusted — by one isomorphic core.** `walkLineage(selfManifest, R)` walks
   `prov:wasDerivedFrom`/`prov:wasRevisionOf` from this app toward genesis; each hop asserts the **edge**
   (`parent.lock.root === the κ the child claims`) **and** re-derives the parent's **whole closure**
   (`reDeriveClosure`: re-hash every file in `holospace.lock.json` to its κ; `ok` ⇔ every file present and
   re-derives). The walk's `ok` ⇔ every hop verifies; it is acyclic by construction (a `seen` guard is
   belt-and-braces). The core takes injectable resolvers (`sha256hex` · `folderForKappa` over
   `/apps/index.jsonld` · `getLock` · `getManifest` · `getBytes`), so the **browser app and the Node
   witness exercise identical logic** (ADR-0043). A genesis app (no parent) verifies trivially and shows
   nothing.

2. **Two surfaces, one binding, no per-app code.** (a) The **in-tab twin** (`holo-prov.js`) wires real
   `fetch`/WebCrypto resolvers, exposes `window.HoloProv`, and auto-mounts a **live lineage badge** — the
   verified chain with a ✓/✗ per hop and a "re-derived in your tab (Law L5)" line — opt-out via
   `<meta name="holo-prov" content="off">`, best-effort, never blocking the app. (b) The **shell binding**
   (`holo-prov-ui.js`) is imported **once** by the World shell, which calls `register(node, el)` as it
   mounts each holospace: it reads that app's manifest + version chain (`holospace.prov.json`), attaches a
   titlebar **provenance cue** (`⛓ v<n>` with `↩` when the app is a remix — the twin of the ownership
   cue), and records the app in the hypergraph. One binding point; no per-app code, no per-app relock.

3. **The live provenance hypergraph — the foundation for Holo Indexer.** The binding maintains the
   evolving-object graph in `graph()`: **nodes** are holospaces (with head version + version count),
   **edges** are cross-app remix (`wasDerivedFrom`) ⊕ each per-app version step (`wasRevisionOf`).
   `on(cb)` subscribes to updates (fires immediately, then on every newly-registered holospace);
   `chainOf(appId)` returns a holospace's audit trail. Because each chain is self-verifying (Law L5), the
   indexer **broadcasts truth it can re-derive, never a feed it must trust** — the substrate's answer to a
   blockchain indexer, content-addressed end to end, with no chain and no server.

**Consequences.** Every running holospace now shows *and proves* where it came from, in your tab, with a
forged parent refused by re-derivation rather than trusted. Provenance is ambient (a badge + a titlebar
cue on every window) and binding (one shell import, no app opts in or out of being verifiable), and the
hypergraph turns the population of evolving objects into one navigable, re-derivable graph — the seam a
future **Holo Indexer** subscribes to. The standing cost is the discipline ADR-0024 already pays and that
this ADR still owes: the isomorphic witness (`tools/holo-prov-witness.mjs`, straightforward since the core
is already pure) and the required `#holo-prov` conformance row, so a build cannot ship a Holo Prov whose
verify-in-tab logic has drifted from what the witness proves. Honest scope: the badge and hypergraph are
read-only views over `holospace.prov.json` / `holospace.lock.json` / `/apps/index.jsonld`; minting and
re-sealing version chains is a build/operator act (Holo Own / Share-to-Run), not Prov's — Prov *shows and
verifies*, it does not author.

**External authorities.** W3C **PROV-O** (`prov:wasDerivedFrom` / `prov:wasRevisionOf` — the lineage
edges) · [schema.org](https://schema.org/) + **DCAT 3** (the app index `/apps/index.jsonld`) · W3C
**Subresource Integrity** / IPLD content-addressed Merkle-DAG (Law L5, the closure re-derivation) · W3C
**DID Core** (`did:holo`) · IETF **RFC 8785** (JCS, the canonical form) · UOR-ADDR (`κ = H(canonical
form)`) · holospaces Laws **L1** (identity is content not location), **L2** (canonical forms only),
**L5** (verify by re-derivation). Mints nothing. Modules: `os/usr/lib/holo/holo-prov.js` (the in-tab twin
+ `walkLineage`/`reDeriveClosure`), `os/usr/lib/holo/holo-prov-ui.js` (the shell binding + the
hypergraph); binding: `os/usr/share/frame/shell.html`; deferred witness: `tools/holo-prov-witness.mjs`;
deferred row: `#holo-prov` in `os/etc/conformance.jsonld`.
