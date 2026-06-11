#!/usr/bin/env node
// holo-app-mcp-witness.mjs — PROVE build · run · share are usable by AI agents over MCP. Drives the
// canonical Hologram MCP server (os/usr/lib/holo/mcp/holo-mcp.mjs) via JSON-RPC: the tools are
// advertised in tools/list; holo_build compiles Holo-C → a content-addressed wasm κ (and returns a
// STRUCTURED {line,col,message} error on bad source — the agent's fix-and-retry loop); holo_run
// executes by κ (artifact runs directly; source κ self-compiles) and calls exported functions;
// holo_share returns holo://κ. No browser. Authority: W3C MCP (2024-11-05) · W3C WebAssembly Core 2.0
// · IETF RFC 8785 (JCS) · UOR-ADDR · Law L5. Writes the result the gate joins.
//
//   node tools/holo-app-mcp-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeServer } from "../os/usr/lib/holo/mcp/holo-mcp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); };

const srv = makeServer({ manifests: [] });
const call = (method, params) => srv.handle({ jsonrpc: "2.0", id: 1, method, params });
const payload = async (method, params) => JSON.parse((await call(method, params)).result.content[0].text);

const SRC = "int add(int a,int b){return a+b;}\nint fib(int n){if(n<2)return n;return add(fib(n-1),fib(n-2));}\nint gcd(int a,int b){while(b!=0){int t=a%b;a=b;b=t;}return a;}\n";

// 1 · advertised + schema'd (discoverable by any MCP host / OpenAI / Anthropic tool runtime)
const list = await call("tools/list", {});
const names = (list.result.tools || []).map((t) => t.name);
ok("tools-advertised", ["holo_build", "holo_run", "holo_share"].every((n) => names.includes(n)), names.filter((n) => n.startsWith("holo_")).join(", "));
const buildTool = list.result.tools.find((t) => t.name === "holo_build");
ok("build-has-schema", !!(buildTool && buildTool.inputSchema && buildTool.inputSchema.properties && buildTool.inputSchema.properties.source));

// 2 · BUILD → a content-addressed wasm κ + receipt + exports
const b = await payload("tools/call", { name: "holo_build", arguments: { source: SRC } });
ok("build-ok", b.ok === true && /^did:holo:sha256:[0-9a-f]{64}$/.test(b.kappa) && /^did:holo:sha256:/.test(b.receipt), JSON.stringify(b).slice(0, 80));
ok("build-exports", Array.isArray(b.exports) && b.exports.includes("fib") && b.exports.includes("gcd"));

// 3 · BUILD on bad source → STRUCTURED error the agent can act on (the fix-and-retry loop)
const bad = await payload("tools/call", { name: "holo_build", arguments: { source: "int f(){ return x; }" } });
ok("build-structured-error", bad.ok === false && !!bad.error && typeof bad.error.message === "string" && bad.error.line != null, JSON.stringify(bad.error || {}));

// 4 · O(1) — rebuild identical source rebinds, not recompiles
const b2 = await payload("tools/call", { name: "holo_build", arguments: { source: SRC } });
ok("build-O(1)-rebind", b2.kappa === b.kappa && b2.rebind === true);

// 5 · RUN by ARTIFACT κ + call an exported function
const r1 = await payload("tools/call", { name: "holo_run", arguments: { kappa: b.kappa, fn: "fib", args: [10] } });
ok("run-by-artifact", r1.ok === true && r1.result === 55 && r1.selfCompiled === false, JSON.stringify(r1).slice(0, 80));
const rg = await payload("tools/call", { name: "holo_run", arguments: { kappa: b.kappa, fn: "gcd", args: [48, 36] } });
ok("run-call-args", rg.result === 12);

// 6 · RUN by SOURCE κ → self-compiles
const r2 = await payload("tools/call", { name: "holo_run", arguments: { kappa: b.sourceKappa, fn: "fib", args: [10] } });
ok("run-source-kappa-self-compiles", r2.ok === true && r2.selfCompiled === true && r2.result === 55);

// 7 · RUN by raw source (build-then-run, one call)
const r3 = await payload("tools/call", { name: "holo_run", arguments: { source: SRC, fn: "add", args: [2, 3] } });
ok("run-raw-source", r3.result === 5);

// 8 · SHARE → holo://κ
const s = await payload("tools/call", { name: "holo_share", arguments: { kappa: b.kappa } });
ok("share-holo-uri", s.holo === "holo://" + b.kappa.split(":").pop());

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "build · run · share are advertised MCP tools (tools/list) with input schemas — usable by any MCP host / OpenAI / Anthropic tool runtime",
    "holo_build compiles Holo-C → a content-addressed wasm κ + a PROV-O receipt; O(1) rebind on repeat",
    "holo_build returns a STRUCTURED {message,line,col} error on bad source — the agent's fix-and-retry build loop",
    "holo_run executes by κ (artifact runs directly; source κ self-compiles) and calls exported functions with i32 args",
    "holo_share returns holo://κ — agents collaborate by passing the content address; no server (Law L5)",
  ],
  build: { kappa: b.kappa, receipt: b.receipt, exports: b.exports },
  checks, failed: fail,
  authority: "W3C Model Context Protocol (2024-11-05) · W3C WebAssembly Core 2.0 · IETF RFC 8785 (JCS) · UOR-ADDR · Law L5",
};
writeFileSync(join(here, "holo-app-mcp-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo App MCP witness — build · run · share for AI agents\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
