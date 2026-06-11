# Hologram OS

🌐 **Your personal internet supercomputer.** Fast, free and private.

*An internet computer for the open, semantic web.*

> ⏻ **Boot it:** open [`index.html`](index.html) — the single gateway. It brings up the κ Service Worker (the substrate gateway) and enters the boot chain (rEFInd → Plymouth → SDDM → PrimeOS), all in your browser, rooted in your hardware.
>
> 🤖 **AI agents — start at [`AGENTS.md`](AGENTS.md)** · map: [`llms.txt`](system/llms.txt) · capabilities: [`agents.json`](system/os/.well-known/agents.json). Every action is governed by the **[Constitution](CONSTITUTION.md)** — a fail-closed conscience (ADR-033), front and centre.

Every object — a holospace (app), a file, a track, a credential — is named by its own
self-verifying content address (`did:holo:sha256:…`), expressed as W3C linked data
(JSON-LD), and composes into one infinitely-nestable, serverless object graph. Resolve
any reference, re-derive its hash, and you have verified it — no server to trust (**Law L5**).

It runs in the browser, boots from a content address, and is built as a first-party
**product** on [holospaces](https://github.com/Hologram-Technologies/holospaces), consumed
*unmodified* as a pinned submodule (ADR-006) — the engine is canonical; this repo carries
only product.

## The idea

Content addressing alone gives a graph of opaque, self-verifying blobs — no meaning (raw
IPFS). W3C linked data alone gives meaning, but it is unverifiable and server-bound. Put
both on the same object and you get what none of web2 / web3 / AI has alone: a
**self-verifying, interpretable, serverless object graph**. UOR is the structural piece
(identity + composition); W3C is the semantic piece (meaning). That union is the OS.

## Architecture

| Layer | What | Where |
|---|---|---|
| Substrate | UOR content-addressable storage / compute / networking (the κ axis) | upstream `hologram` |
| Engine | holospaces — realizations, κ-addressing, the wasm browser peer | `holospaces/` (submodule) |
| OS image | the bootable, content-addressed web image served to the browser / Pages | `os/` |
| Addressing | `did:holo` identity · `holo://<κ>` native · dereferenceable HTTPS IRI — one canonical form | ADR-022 |
| Objects | every object a self-verifying linked-data node | ADR-025 |
| Conformance | every component witnessed against an external W3C authority; a strict gate blocks any non-conformant build | ADR-024 |

## Repository layout

The root is deliberately minimal — open the repo and you see a gateway and a few docs;
the entire system is one folder away.

```
hologram-os/
├── index.html         ← the gateway: open this and a whole OS boots from one file
├── README.md          ← you are here
├── AGENTS.md          ← AI agents start here
├── CONSTITUTION.md    ← the fail-closed conscience (ADR-033) — governs every action
└── system/            everything else — the OS image, the engine, the tooling
    ├── os/                the bootable, content-addressed OS image (served by hash; ADR-026)
    ├── holospaces/        the engine — pinned submodule, consumed unmodified (ADR-006)
    ├── crates/            Rust — the browser peer (wasm32) + the hologram-mcp npm package
    ├── docs/              architecture decisions (adr/) + the did:holo method spec (specs/)
    ├── conformance/       the W3C conformance regime + strict gate (ADR-024)
    ├── tools/             serve · witnesses · build
    ├── scripts/           repo tooling — relay, new-spec, serve
    ├── llms.txt           the agent map
    └── codemeta.json · package.json · CODE_OF_CONDUCT · CONTRIBUTING · SECURITY
```

The deploy publishes only the gateway + the `os/` image (lean, no source), and the
Service Worker maps the flat URL space onto the FHS tree at runtime.

## Build

```
git submodule update --init --recursive
# the browser peer + OS image build from crates/holospaces-web by its own scripts
# (wasm-pack / the GitHub Pages deploy). See that crate.
```

## Conformance — how "done" is defined

Nothing is complete until a witness proves it against an **external authority** (W3C,
IETF, IPLD, schema.org). The regime is declared in
[`os/etc/conformance.jsonld`](system/os/etc/conformance.jsonld) and enforced by
[`tools/gate.mjs`](system/tools/gate.mjs):

```
cd system && npm run gate    # node tools/gate.mjs — must pass to ship
```

The gate re-runs each pure-Node witness live, fails closed on any unwitnessed required row,
and emits a W3C **EARL** report
([`os/etc/earl-report.jsonld`](system/os/etc/earl-report.jsonld)); the catalog is itself
valid JSON-LD.

## For AI agents

Start with **[AGENTS.md](AGENTS.md)**. Every object is self-describing JSON-LD with a
verifiable `did:holo`, so an agent can fetch, interpret, *and verify* with no trusted
server. The MCP server projects holospaces as **self-verifying** MCP resources + tools,
generated from the `apps/<id>/holospace.json` manifests, with a built-in `verify_object`
tool no ordinary MCP server has. Two tiers: the **official MCP SDK**
([`holo-mcp-sdk.mjs`](system/os/holo-mcp-sdk.mjs) — `@modelcontextprotocol/sdk`
vendored unmodified, Law-L5 pinned) for Node, and a dependency-free core
([`holo-mcp.mjs`](system/os/holo-mcp.mjs)) for the browser/edge. The same
tool registry projects to **OpenAI** and **Anthropic** tool schemas. It is reachable over
stdio and **Streamable HTTP** (with MCP prompts and a `.well-known/mcp.json` discovery doc),
and the **OpenAI Agents SDK** is witnessed consuming it. A holospace can even ask the
agent's *own* model back (MCP **sampling** — the inverse direction). The server is near
MCP feature-complete (resources, tools, prompts, sampling, completions, roots, elicitation,
subscriptions) and ships as the standalone **[`hologram-mcp`](system/crates/holospaces-mcp/)** npm
package: `npx hologram-mcp` (the deploy publishes `.well-known/mcp.json` for discovery).

## Relationship to holospaces

Hologram OS evolves independently and consumes the engine unmodified — no forks, no
duplication. Engine-level work belongs upstream in holospaces (ADR-006).

---

License: see [LICENSE](LICENSE). Architecture decisions: [docs/adr/](system/docs/adr/).
