#!/usr/bin/env node
// holo-compose-mcp-witness.mjs — AGENTS COMPOSE a universe of interoperable apps over MCP (Holo Link,
// ADR-0060). Drives the canonical Hologram MCP server: an AI agent builds capability κ-objects, COMPOSES
// them by CONTENT ADDRESS (`extern … from "κ"`, including typed `str` interfaces), RUNS the composition
// (the linker resolves + verifies + links the dependency graph, no server), and SHARES it as one holo://κ.
// The composition is itself a κ — a first-class object that flows into Own (ADR-0053) · Settle (ADR-0048)
// · Orchestrate (ADR-0045), which already operate on any κ. The universe of apps, agent-driven.
//
// Authority: W3C MCP (2024-11-05) · W3C WebAssembly Core 2.0 (imports/linking) · IETF RFC 8785 (JCS) ·
// UOR-ADDR · Law L1/L3/L5.   node tools/holo-compose-mcp-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeServer } from "../os/usr/lib/holo/mcp/holo-mcp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); };

const srv = makeServer({ manifests: [] });
const call = (method, params) => srv.handle({ jsonrpc: "2.0", id: 1, method, params });
const payload = async (name, args) => JSON.parse((await call("tools/call", { name, arguments: args })).result.content[0].text);

// 1 · the agent builds a CAPABILITY library → a content-addressed κ-object
const B = await payload("holo_build", { source: "int add(int a, int b) { return a + b; } int mul(int a, int b) { return a * b; }" });
ok("agent-builds-capability", B.ok === true && /^did:holo:sha256:[0-9a-f]{64}$/.test(B.kappa) && B.exports.includes("add"));

// 2 · the agent COMPOSES an app that imports the capability BY CONTENT ADDRESS (deps surfaced in `imports`)
const A = await payload("holo_build", { source: `extern int add(int a, int b) from "${B.kappa}";\nint main() { return add(40, 2); }` });
ok("agent-composes-by-content-address", A.ok === true && Array.isArray(A.imports) && A.imports.length === 1 && A.imports[0].kappa === B.kappa);

// 3 · the agent RUNS the composition → the linker resolves + verifies + links the dependency, no server
const R = await payload("holo_run", { kappa: A.kappa, fn: "main" });
ok("agent-runs-linked-composition", R.ok === true && R.result === 42);

// 4 · the whole composition is ONE shareable content address (holo://κ)
const S = await payload("holo_share", { kappa: A.kappa });
ok("agent-shares-composition-kappa", S.holo === "holo://" + A.kappa.split(":").pop());

// 5 · TYPED composition over MCP — the agent composes a WIT-style string-passing component (isolated memories)
const SB = await payload("holo_build", { source: "int alloc(int n) { int p = load(0); if (p < 64) p = 64; store(0, p + n); return p; } int bytesum(int p, int n) { int s = 0; int i = 0; while (i < n) { s = s + load8(p + i); i = i + 1; } return s; }" });
const SA = await payload("holo_build", { source: `extern int bytesum(str s) from "${SB.kappa}";\nint alloc(int n) { int p = load(0); if (p < 64) p = 64; store(0, p + n); return p; }\nint main() { int p = alloc(3); store8(p, 65); store8(p + 1, 66); store8(p + 2, 67); return bytesum(p, 3); }` });
const SR = await payload("holo_run", { kappa: SA.kappa, fn: "main" });
ok("agent-composes-typed-string-component", SB.ok === true && SA.ok === true && SR.ok === true && SR.result === 198);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "an AI agent builds capability κ-objects, composes them BY CONTENT ADDRESS (extern … from κ) and runs the linked result over MCP — no server",
    "holo_build surfaces a composition's dependency κ's in `imports`; holo_run resolves + verifies (L5) + links them (L3 dedup)",
    "agents compose TYPED (WIT) components too — a string crosses between isolated component memories, lifted/lowered by the linker",
    "the composition is itself a κ (holo://κ) — a first-class object that flows into Own (ADR-0053) · Settle (ADR-0048) · Orchestrate (ADR-0045), which operate on any κ",
  ],
  library: { kappa: B.kappa }, composed: { kappa: A.kappa, imports: A.imports, ran: R.result },
  checks, failed: fail,
  authority: "W3C Model Context Protocol (2024-11-05) · W3C WebAssembly Core 2.0 · IETF RFC 8785 (JCS) · UOR-ADDR · Law L1/L3/L5",
};
writeFileSync(join(here, "holo-compose-mcp-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Compose MCP witness — agents compose a universe of apps by content address\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
