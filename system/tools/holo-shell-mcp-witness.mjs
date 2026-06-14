#!/usr/bin/env node
// holo-shell-mcp-witness.mjs — PROVE every holospace is its own MCP server, with NATIVE, re-derivable
// tool execution. Drives the dependency-free MCP core (os/usr/lib/holo/mcp/holo-mcp.mjs) by JSON-RPC,
// no browser, no SDK, no separate process:
//   · buildAppRegistry(manifest) yields an APP-SCOPED surface — exactly that app's tools + the
//     universal substrate verbs, and NO other app's tools leak in (per-app isolation).
//   · a declared tool's handler is a CONTENT ADDRESS (κ): a compiled wasm transform run on the forge.
//     The agent re-derives the artifact (Law L5) AND — the forge being deterministic — recomputes the
//     same result κ across runs. The result object self-verifies.
//   · a declarative `resolve`+`select` handler projects a content-addressed object; the projection is
//     itself sealed as a self-verifying UOR object.
//   · the core answers the MCP surface: initialize · tools/list · tools/call.
// Authority: W3C MCP (2024-11-05) · W3C WebAssembly Core 2.0 · IETF RFC 8785 (JCS) · UOR-ADDR · Law L5.
//
//   node tools/holo-shell-mcp-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildRegistry, buildAppRegistry, handle } from "../os/usr/lib/holo/mcp/holo-mcp.mjs";
import { verify, makeObject } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); };
const call = (registry, ctx, method, params) => handle({ jsonrpc: "2.0", id: 1, method, params }, { registry, ...ctx });
const payload = async (registry, ctx, name, args) => JSON.parse((await call(registry, ctx, "tools/call", { name, arguments: args })).result.content[0].text);

// 0 · compile a pure transform into the shared forge κ-store via the built-in holo_build → its κ
const built = await payload(buildRegistry([]), {}, "holo_build", { source: "int dbl(int x){ return x*2; }" });
ok("handler-built", built.ok === true && /^did:holo:sha256:[0-9a-f]{64}$/.test(built.kappa), JSON.stringify(built).slice(0, 80));

// Two distinct apps: one with a κ-handler tool, one with a resolve+select projection tool.
const mathApp = { name: "Math Demo", id: "mathdemo",
  tools: [{ name: "double", description: "double an int", inputSchema: { type: "object", properties: { x: { type: "number" } }, required: ["x"] },
    handler: { kappa: built.kappa, fn: "dbl", params: ["x"] } }] };
const chainObj = makeObject(new Map(), { type: ["schema:Thing"], "schema:name": "ethereum", address: "0xABC123" });
const store = new Map([["mathdemo/chain.json", chainObj]]);
const chainApp = { name: "Chain Demo", id: "chaindemo",
  tools: [{ name: "chain_addr", description: "the chain address", inputSchema: { type: "object", properties: {} },
    handler: { resolve: "mathdemo/chain.json", select: "address" } }],
  resources: [{ uri: "mathdemo/chain.json", name: "chain", mimeType: "application/ld+json" }] };

const mathReg = buildAppRegistry(mathApp);
const chainReg = buildAppRegistry(chainApp);

// 1 · per-app surface — the app's tool + the universal verbs, scoped server name
ok("app-scoped-server", mathReg.server.name === "hologram-os/mathdemo");
const mathNames = mathReg.tools.map((t) => t.name);
ok("app-tool-advertised", mathNames.includes("double") && mathNames.includes("verify_object") && mathNames.includes("holo_build"));
ok("schema-carried", !!mathReg.tools.find((t) => t.name === "double")?.inputSchema?.properties?.x);

// 2 · ISOLATION — app A's registry must not contain app B's tools (and vice versa)
ok("isolation-no-leak", !mathNames.includes("chain_addr") && !chainReg.tools.map((t) => t.name).includes("double"));

// 3 · MCP surface answers initialize / tools/list / tools/call
const init = await call(mathReg, {}, "initialize", {});
ok("initialize", init.result?.protocolVersion === "2024-11-05" && init.result?.serverInfo?.name === "hologram-os/mathdemo");
const tl = await call(mathReg, {}, "tools/list", {});
ok("tools-list", (tl.result?.tools || []).some((t) => t.name === "double"));

// 4 · κ-HANDLER executes natively — value correct, result object self-verifies (Law L5)
const r1 = await payload(mathReg, {}, "double", { x: 21 });
ok("kappa-handler-runs", r1.result === 42, JSON.stringify(r1).slice(0, 80));
ok("kappa-result-self-verifies", verify(r1.object) === true);

// 5 · RE-DERIVABLE — a second call recomputes the SAME result κ (deterministic, trustless)
const r2 = await payload(mathReg, {}, "double", { x: 21 });
ok("kappa-result-re-derives", r1.object.id === r2.object.id && /^did:holo:sha256:/.test(r1.object.id));

// 6 · DECLARATIVE resolve+select projection — value correct + projection self-verifies
const r3 = await payload(chainReg, { resolve: (u) => store.get(u) || null }, "chain_addr", {});
ok("resolve-handler-runs", r3.value === "0xABC123" && verify(r3.result) === true, JSON.stringify(r3).slice(0, 80));

// 7 · a declared tool with NO handler is honestly reported (not silently broken)
const noHandler = buildAppRegistry({ name: "Bare", id: "bare", tools: [{ name: "bare_tool", description: "x", inputSchema: { type: "object" } }] });
const bareRes = await call(noHandler, {}, "tools/call", { name: "bare_tool", arguments: {} });
ok("declared-no-handler-honest", bareRes.result?.isError === true);

// 8 · STANDARDIZED, APPLICATION-AGNOSTIC CORE — holo_describe is present on every app and returns a
//     self-verifying W3C capability card (schema.org SoftwareApplication + a schema:Action per tool).
ok("holo_describe-present", mathReg.tools.some((t) => t.name === "holo_describe") && chainReg.tools.some((t) => t.name === "holo_describe"));
const cardMath = await payload(mathReg, {}, "holo_describe", {});
const cardChain = await payload(chainReg, {}, "holo_describe", {});
ok("card-self-verifies", verify(cardMath) === true && verify(cardChain) === true);
ok("card-is-software-application", (cardMath["@type"] || []).includes("schema:SoftwareApplication"));
ok("card-conforms-to-mcp", JSON.stringify(cardMath["dct:conformsTo"] || "").includes("modelcontextprotocol"));
// app-agnostic: SAME shape, app-specific content — the agent introspects ANY holospace uniformly
ok("card-app-agnostic", cardMath["schema:name"] === "Math Demo" && cardChain["schema:name"] === "Chain Demo"
  && (cardMath["schema:potentialAction"] || []).some((a) => a["schema:name"] === "double")
  && (cardChain["schema:potentialAction"] || []).some((a) => a["schema:name"] === "chain_addr"));
// also published as the standard resource holo://capabilities (resources/read), same object
const viaResource = (await call(mathReg, {}, "resources/read", { uri: "holo://capabilities" })).result?.contents?.[0]?.text;
ok("card-as-standard-resource", !!viaResource && JSON.parse(viaResource).id === cardMath.id);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "every holospace is its own MCP server — buildAppRegistry(manifest) yields an app-scoped surface (the app's tools + the universal substrate verbs) with a scoped server name",
    "per-app ISOLATION — one app's registry never leaks another app's tools",
    "a declared tool's handler is a CONTENT ADDRESS (κ): a wasm transform run on the forge; the result object self-verifies (Law L5) and RE-DERIVES to the same κ across runs (deterministic, trustless)",
    "a declarative resolve+select handler projects a content-addressed object and seals the projection as its own self-verifying UOR object",
    "the dependency-free core answers the MCP surface: initialize · tools/list · tools/call; a declared tool with no handler is honestly reported",
    "a STANDARDIZED, application-agnostic core (holo_describe) is present on every app and returns a self-verifying W3C capability card — schema.org SoftwareApplication + a schema:Action per tool + conformsTo MCP — so an agent introspects ANY holospace uniformly; also published as the standard resource holo://capabilities",
  ],
  sample: { handlerKappa: built.kappa, doubleResult: r1.result, resultKappa: r1.object.id, projection: r3.value },
  checks, failed: fail,
  authority: "W3C Model Context Protocol (2024-11-05) · W3C WebAssembly Core 2.0 · IETF RFC 8785 (JCS) · UOR content-addressing (Law L1/L2/L5)",
};
writeFileSync(join(here, "holo-shell-mcp-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Shell MCP witness — every holospace is its own MCP server, with native κ-handlers\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
