# hologram-mcp

The **Hologram OS MCP server** — agent access to a content-addressed, self-verifying object
substrate. Built on the official [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk).

What makes it different: **every resource is a self-verifying UOR object**. An agent fetches
a resource, gets schema.org JSON-LD it understands, *and re-derives the hash to verify it*
(`did:holo`, Law L5) — provenance and integrity with no trusted server. No ordinary MCP
server can do that.

## Run

```sh
npx hologram-mcp            # stdio  (Claude Desktop, the OpenAI Agents SDK, …)
npx hologram-mcp --http     # Streamable HTTP + /.well-known/mcp.json discovery
```

Add to an MCP host (e.g. Claude Desktop `mcpServers`):

```json
{ "hologram": { "command": "npx", "args": ["-y", "hologram-mcp"] } }
```

## Surface (MCP, near feature-complete)

- **Resources** — self-verifying UOR objects (content-addressed JSON-LD).
- **Tools** — `verify_object` (re-derive a did), `resolve_object`, `ask_model` (sampling — the
  holospace asks the agent's *own* model), `ask_user` (elicitation), `list_roots`, plus any a
  holospace declares.
- **Prompts**, **completions**, **resource subscriptions**, **sampling**, **roots**,
  **elicitation** — bridged.
- **Transports** — stdio and Streamable HTTP; discovery at `/.well-known/mcp.json`.

## Interop

Spec-conformant MCP, so any MCP host can consume it (Claude, the OpenAI Agents SDK, …). The
tool registry also projects to OpenAI function-calling and Anthropic tool-use schemas.

## Notes

- **Until published to npm**, `npx hologram-mcp` won't resolve — install from source and run
  `node bin/hologram-mcp.mjs` (or `npm link`).
- **HTTP transport** (`--http`) is **stateful** by default: a session per client (the full
  surface, including the inverse direction). POST requires
  `Accept: application/json, text/event-stream`; the session id rides the `mcp-session-id`
  header; `GET /mcp` is the server→client event stream; `DELETE /mcp` closes it. The simpler
  stateless mode (`stateful: false`) supports plain request/response only — no server→client
  calls (sampling/elicitation/roots) or notifications.
- **Out of the box** the server exposes the built-in tools, 2 prompts, and one self-verifying
  sample resource (`holo://sample`); mount holospace manifests under `apps/<id>/` for more.

Part of [Hologram OS](https://github.com/Hologram-Technologies/hologram-os). MIT licensed.
