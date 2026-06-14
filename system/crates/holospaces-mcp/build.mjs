#!/usr/bin/env node
// build.mjs — assemble the publishable package. The canonical MCP + UOR sources live ONCE in
// the OS2 product tree under /usr/lib/holo (the holo runtime kit, where they are witnessed); this
// copies the set the server needs into lib/ at (pre)pack time, so there is no duplicated source in
// git. lib/ mirrors the product layout (lib/holo-*.mjs + lib/mcp/*.mjs) so the server's relative
// imports (../holo-object, ../holo-qml) resolve unchanged. GUARDED: every source is checked BEFORE
// anything is removed, so a missing source can never wipe lib/ (regression fix). Pure Node.
import { mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "..", "os", "usr", "lib", "holo");        // OS2 holo runtime kit
const ROOT_FILES = ["holo-object.mjs", "holo-uor.mjs", "holo-rank.mjs", "holo-qml.mjs"];
const MCP_FILES = ["holo-mcp.mjs", "holo-mcp-sdk.mjs", "holo-mcp-http.mjs", "holo-mcp-launch.mjs", "holo-liberty.mjs", "holo-jupyter.mjs", "make-well-known.mjs"];

// resolve + verify EVERY source exists first — never rm lib/ on an incomplete tree.
const plan = [
  ...ROOT_FILES.map((f) => ({ from: join(SRC, f), to: join(here, "lib", f) })),
  ...MCP_FILES.map((f) => ({ from: join(SRC, "mcp", f), to: join(here, "lib", "mcp", f) })),
];
const missing = plan.filter((p) => !existsSync(p.from)).map((p) => p.from);
if (missing.length) { console.error(`build: ${missing.length} source(s) not found — refusing to touch lib/:\n  ${missing.join("\n  ")}`); process.exit(1); }

rmSync(join(here, "lib"), { recursive: true, force: true });   // safe now: every source verified present
mkdirSync(join(here, "lib", "mcp"), { recursive: true });
for (const p of plan) copyFileSync(p.from, p.to);
console.log(`built lib/ — ${plan.length} modules copied from ${SRC}`);
