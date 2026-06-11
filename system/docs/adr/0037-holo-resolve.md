# ADR-037: Holo Resolve — the universal resolver: any internet identifier or query → a self-verifying UOR object

**Status:** Accepted — witnessed: `holo-resolve-witness.mjs` is green and `uor:holo-resolve` is a
required, product-gated row in `w3c-conformance.jsonld`. Five real, byte-pinned responses (Wikipedia,
Wikidata, Crossref, Open Library, OpenStreetMap) are vendored as the offline ground truth. Builds on the
UOR envelope (ADR-025), the one κ primitive (Law L2), the conformance regime (ADR-024), the constitution
(ADR-033, which governs the resolver's input), and HoloDiscover/HoloRank.

**Context.** Hologram OS makes every object a self-verifying `did:holo` linked-data node — but until now
those objects were ones the OS *minted*. The open internet is already an enormous object universe:
Wikidata (the universal entity graph), Wikipedia, OpenStreetMap (every place), Crossref/DOI (every paper),
Open Library (every book), plus the content-addressed worlds the OS already verifies (IPFS, Ethereum). All
of it is reachable from any browser, over open APIs, with no key and no AI. What was missing was the one
move that turns a search bar into a window onto that universe: **resolve any identifier or query to a
self-verifying UOR object.** The inspiration is direct — a sovereign-data system unified many private sources into one
internal record via a connector framework, a deterministic query router, and entity resolution; pointed
*outward* over the open web and emitting the OS's own UOR envelope, the same architecture becomes a
universal front door. The key realisation: the "intelligence" is **federation + reconciliation +
verification, not generation** — so it needs no model, and is *more* trustworthy than one, because every
fact re-derives (Law L5).

**Decision.** **The search bar is a universal resolver.** Four binding rules:

1. **Classify deterministically, resolve to one envelope.** `classify(input)` maps any input — a DOI, an
   ISBN, a Wikidata Q-id, a place name or coordinates, a CID, an ENS name or address, a URL, a `did:holo`,
   or free text — to a resolver *kind*, with no model. The open-data kinds resolve over public APIs; the
   content-addressed kinds (`did:holo` / κ / IPFS / Ethereum) **delegate** to the engines that already
   verify them (`holo-object`, `holo-ipfs`, `holo-eth`). Every result is the *same* self-verifying UOR
   object the OS already speaks (schema.org + Dublin Core + PROV-O), so it composes, nests, ranks and
   verifies like any other.
2. **Normalise purely; provenance by re-derivation.** Each source has a *pure* `normalize(response)`
   function (response → canonical schema.org props) — deterministic, so its output is content-addressable.
   The raw response bytes are pinned by their κ as a Merkle leaf (`prov:wasDerivedFrom`), so the object
   commits to *exactly* the bytes the open web returned: a snapshot that re-derives forever, immune to
   link-rot and silent edits, with drift detectable by content (the Holo Conform monitor idiom). The reference design
   cites a source you click to verify by eye; Holo Resolve re-derives the bytes.
3. **Reconcile to the universal join.** Objects from different sources are linked to a canonical Wikidata
   Q-id (`schema:sameAs`): Wikipedia's "Douglas Adams" and Wikidata's Q42 reconcile to the *same* entity.
   This is classic entity resolution, realised as the open web's universal join — and it makes the
   federated result one graph, not a list. A paper resolves with its cited DOIs as `schema:citation`
   edges, each resolvable on demand: the internet becomes one navigable, verifiable object graph.
4. **Govern the input; witness the whole.** Untrusted input is screened by the constitution's immune
   perimeter (ADR-033 §8.1) before it is resolved. Everything is witnessed offline against the vendored
   real responses: classification routes correctly, every response self-verifies with an exact provenance
   leaf, resolution is deterministic, cross-source reconciliation holds, the citation graph is real, the
   resolver catalog is one re-derivable content address, and the catalog mints nothing.

**Consequences.** Hologram OS gains a content-addressed, serverless front door to the open web's object
universe: type anything into one bar and get back a self-verifying object you can open, nest, relate
(HoloRank over the reference graph), and save as your own content-addressed slice — sovereign, no AI, no
keys, from any browser. The standing cost is one resolver module, five byte-pinned fixtures, and one
witness — the same construction discipline ADR-024 already pays. This first slice ships five open-data
resolvers + the content-addressed delegations; it is the spine. Explicit follow-ons: **federated search**
(fan one query across the sources in parallel, reconcile, rank — HoloDiscover supercharged); **deeper
graph traversal** (resolve a citation/related edge to its object, nest it — A27); **the composed answer
card** (assemble facts from multiple sources, each a clickable `did:holo`, conflicts flagged — deterministic
contradiction detection); **more resolvers** (GBIF, PubChem, arXiv, GitHub, DNS/DNSLink, ActivityPub);
**the homepage** (wire the splash search bar live); and **the MCP tool** (`resolve_object` returning a
self-verifying object an agent re-derives). One honest constraint: some public APIs are not CORS-enabled,
so a few resolvers need a content-blind gateway/proxy — but because results re-derive by κ, the proxy is
*never trusted* (Law L5 holds regardless).

External authorities: **Wikipedia REST v1**, **Wikidata** (wbgetentities), **Crossref**, **Open Library**,
**OpenStreetMap** (Nominatim); **W3C schema.org / DCAT 3 / DCMI Terms / PROV-O**; **W3C Subresource
Integrity** / **IPLD** content-addressed Merkle-DAG (Law L5); the constitution's immune perimeter
(ADR-033). Runtime (classify + pure normalizers): `os/_shared/holo-resolve.js`; sealing + live fetch +
catalog + CLI: `os/holo-resolve.mjs`; vendored real responses + pin ledger: `os/resolve/fixtures/` +
`os/resolve/pins.json`; sealed catalog: `os/resolve/catalog.uor.json`; witness:
`os/holo-resolve-witness.mjs`; catalog row: `uor:holo-resolve` in `conformance/w3c-conformance.jsonld`.
