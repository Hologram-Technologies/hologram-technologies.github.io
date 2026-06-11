# ADR-035: Holo Skills — Agent Skills (agentskills.io) interoperability as a content-addressed projection

**Status:** Accepted — witnessed: `holo-skills-witness.mjs` is green and `w3c:A49-agentskills-interop`
is a product row in `w3c-conformance.jsonld`; the two spec rows (`agentskills`, `holo-skills`) are in
`specs.json`, and the upstream **Agent Skills format specification** is vendored byte-faithfully and
κ-pinned into the Holo Conform index (ADR-031). Builds on the UOR envelope (ADR-025), the one κ
primitive (Law L2, `holo-uor.mjs`), the witnessed-conformance regime (ADR-024), and mirrors the shape
of Holo NANDA (ADR-034).

**Context.** [Agent Skills](https://agentskills.io) is the open standard for extending an AI agent with
specialized knowledge: a skill is a folder containing a `SKILL.md` (YAML frontmatter — `name`,
`description` — plus Markdown instructions), loaded by *progressive disclosure* (name+description at
startup, the full body on activation, bundled resources on demand). It was originally developed by
Anthropic, released as an open standard, and adopted across the ecosystem — Claude, Claude Code, Gemini
CLI, OpenAI Codex, Cursor, Goose, and **Nous Research's Hermes Agent**, whose "skills" feature discovers
skills from local directories, version-control taps, direct `SKILL.md` URLs, and **well-known endpoints
publishing `/.well-known/skills/index.json`**.

Hologram OS already exposes every capability to agents over MCP (ADR-025, rows A15–A23) and is a
first-class NANDA citizen (ADR-034). But a skills-based agent discovers capability through a *different
door*: it loads a `SKILL.md` into its context as procedural knowledge — it does not call an RPC tool.
Through that door, Hologram OS was **invisible**: no `SKILL.md`, no `/.well-known/skills/index.json`. A
Hermes user could register the MCP server, but could not discover or load Hologram capabilities *as
skills*. The two ecosystems solve adjacent halves of the same problem and should interoperate.

They differ on one axis, and that difference is the whole design. Agent Skills is **file-and-URL-shaped**:
a skill is trusted because it is a document at a path. This substrate is the inverse — **identity is
content** (Law L5): an object's id is `did:holo:sha256:H(canonical-form)`, trusted because it
*re-derives*, with no server. We do not abandon that invariant to publish skills. We do not have to. Two
facts make a projection both possible and better than a bridge:

- **A skill can carry a content address without ceasing to be a valid skill.** The `SKILL.md` bytes are
  the leaf; the skill's *metadata* is a self-verifying UOR object (`did:holo`, schema.org/DCAT) that
  Merkle-links those bytes. A vanilla skills client reads the `SKILL.md`; a UOR-native one re-derives the
  κ and confirms the bytes (Law L5). Same bytes, two readers.
- **A discovery index can be both a plain list and a Merkle root.** The `/.well-known/skills/index.json`
  carries a plain `skills[]` array (`name` · `description` · `path`) any agentskills client consumes
  directly, *and* a κ-rooted `dcat:Catalog` (`links[]` + `id`) whose root `did:holo` commits to every
  skill and its bytes (`verifyDeep`). Dual shape, one document.

**Decision.** **Agent Skills interoperability is a deterministic projection of what already exists, not a
new authoring surface.** Five binding rules:

1. **One skill, two shapes** (`holo-skills.mjs`, `skillDoc` + `project`). Every capability projects to a
   `SKILL.md` that is simultaneously (a) a **valid Agent Skill** — frontmatter satisfying the
   agentskills.io rules (`name` ≤ 64, lowercase + digits + single hyphen, matching its parent directory;
   `description` 1–1024, non-empty); and (b) committed by a **self-verifying UOR object** — the skill's
   metadata is `did:holo:sha256:H(content)` (schema.org `HowTo`/`SoftwareApplication` + DCAT) that
   content-links the real `SKILL.md` bytes as a Merkle leaf, re-derivable (Law L5).
2. **Content-addressed discovery** (`project`, `build`). Every skill object is Merkle-linked under one
   κ-rooted `dcat:Catalog` index whose root `did:holo` commits to the whole skill set *and* their bytes
   (`verifyDeep`, depth ≥ 2). The index is published at `/.well-known/skills/index.json` (the agentskills
   well-known endpoint) and as `skills/index.jsonld` (the full `@graph` for offline deep verification).
3. **Built FROM what exists, no parallel store** (Law L4). The capability roster is the OS MCP tool
   surface (`.well-known/mcp.json` — the *same* source Holo NANDA projects into AgentFacts skills). One
   source, three doors: an **MCP tool** ⊕ a **NANDA AgentFacts skill** ⊕ an **agentskills.io `SKILL.md`**.
   The projection is a pure, deterministic function of content (build-twice-equal).
4. **Mint nothing** (ADR-024 A6). Metadata is schema.org/DCAT/Dublin-Core/PROV-O; the `SKILL.md` leaf is a
   VC-Data-Integrity digest link; the index's consumer list uses agentskills.io's **own** `skills` field
   name — never a Hologram-minted term. The upstream format spec is vendored byte-faithfully and κ-pinned
   into the Holo Conform index (the proof artifact — we validate against *the* spec, byte-for-byte; drift
   is one re-hash away, ADR-031).
5. **No new authoring.** Skills are generated, never hand-written; a hand-edit to any committed artifact
   fails the gate (the witness compares the committed `SKILL.md` / index to a fresh re-derivation).

**Consequences.**

- **Real interoperability today.** `node holo-skills.mjs build` emits `skills/<name>/SKILL.md` (22 skills),
  `.well-known/skills/index.json` (the discovery endpoint), and `skills/index.jsonld` (the κ-rooted graph).
  A Hermes Agent — or any agentskills.io client (Claude Code, Goose, …) — can tap the well-known endpoint
  and load every Hologram capability as a skill, unchanged.
- **Native-ready.** When a skills host adopts content addressing, nothing here changes shape — the skills
  are already self-verifying objects under a κ-rooted index. The advantage of going native (verification
  with no trusted server) is demonstrated, not asserted.
- **Witnessed.** `holo-skills-witness.mjs` proves, against the byte-pinned spec and the substrate's laws:
  spec-validity for all 22, self-verification (Law L5), index re-derivation *through the `SKILL.md` leaf*
  (depth ≥ 2), byte-exact leaves, tamper-refusal (a single mutated `SKILL.md` byte breaks the deep
  re-derivation), determinism, committed-equals-fresh (a hand-edit fails the gate), and mint-nothing.
- **Sovereignty preserved.** We emit and serve the projection; we do not push to a skills marketplace.
  The skills resolve content-addressed with no skills-host server in the trust path.
- **Scope.** This is capability publication as Agent Skills. The roster is the OS MCP tool surface;
  MCP **prompts** are out of scope (they project to the same names as their sibling tools). Agent-created
  / self-improving skills (a skills host writing back) are out of scope — Hologram skills are a
  deterministic projection, not a mutable store.

**External authorities.** The [Agent Skills](https://agentskills.io/specification) open standard
(agentskills.io; originally [Anthropic](https://www.anthropic.com/), the format the Nous Research
[Hermes Agent](https://github.com/nousresearch/hermes-agent) skills feature consumes);
[schema.org](https://schema.org/) + [DCAT](https://www.w3.org/TR/vocab-dcat-3/) + DCMI Terms + PROV-O;
W3C Subresource Integrity / IPLD content-addressed Merkle-DAG (ADR-025); Law L5 (verification by
re-derivation).
