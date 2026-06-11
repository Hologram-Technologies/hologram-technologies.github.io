// holo-liberty.mjs — the easter egg's MCP surface. Loads the self-verifying *On Liberty*
// UOR graph (apps/liberty/on-liberty.uor.json, built by build-liberty.mjs) into a resolver
// store so an agent can FETCH the whole book — and re-derive every did:holo to verify it
// (Law L5) — over MCP, with no server trusted; and exposes the `read_liberty` tool that
// returns a single self-verifying chapter. The book about why no authority deserves blind
// trust, served by a substrate that asks for none. Pure Node.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RESOURCE_URI = "apps/liberty/on-liberty.uor.json";

// loadLiberty(here, store) → indexes the graph into `store` (uri → doc, did:holo → node) and
// returns the read_liberty tool handler. Pass the SAME store the music library uses so one
// resolver answers for both. No-ops gracefully if the graph hasn't been built.
export function loadLiberty(here, store = new Map()) {
  const base = dirname(fileURLToPath(import.meta.url));   // os/mcp/ — resolve the graph relative to THIS module, not the caller
  const path = join(base, "..", "apps", "liberty", "on-liberty.uor.json");
  let doc = null;
  if (existsSync(path)) {
    try {
      doc = JSON.parse(readFileSync(path, "utf8"));
      store.set(RESOURCE_URI, doc);
      for (const o of doc["@graph"] || []) if (o.id) store.set(o.id, o);
    } catch {}
  }
  const sections = doc ? (doc["@graph"] || []).filter((o) => (o["@type"] || []).includes("schema:Chapter")) : [];
  const root = doc && doc.root ? store.get(doc.root) : null;

  // read_liberty(args) → a self-verifying UOR object the agent can re-derive. No args → the
  // book root; {chapter:n} → section n (0=Introduction, 1..5 = the chapters); {find:phrase}
  // → the section containing the phrase (e.g. the harm principle).
  const read_liberty = async (args = {}) => {
    if (!doc) return "On Liberty graph not built — run `node build-liberty.mjs`.";
    if (args.find) {
      const f = String(args.find).toLowerCase();
      return sections.find((c) => (c["schema:text"] || "").toLowerCase().includes(f))
        || `No section of On Liberty contains "${args.find}".`;
    }
    if (typeof args.chapter === "number")
      return sections[args.chapter] || `Section ${args.chapter} out of range (0..${sections.length - 1}).`;
    return root || doc;
  };

  return { store, doc, sections, toolHandlers: { read_liberty } };
}
