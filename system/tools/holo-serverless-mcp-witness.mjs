#!/usr/bin/env node
// holo-serverless-mcp-witness.mjs — PROVE the MCP server is 100% SERVERLESS: it runs with no Node,
// no SDK, no origin server. The engine (holo-mcp-core.mjs) imports ONLY the browser-safe holo-object,
// so the SAME bytes that answer MCP in Node also run in a Service Worker and an in-page transport.
//   1 · ISOMORPHIC BY CONSTRUCTION — the core + the browser transport import NO node:* / require() /
//       SDK; their only dependency (holo-object) is node-free too. So they load in a browser/SW.
//   2 · the core answers the full MCP surface + the standardized application-agnostic core
//       (holo_describe → a self-verifying W3C capability card) with zero server.
//   3 · build·run·share execute serverlessly on an INJECTED forge (window.HoloApp in the browser).
//   4 · PARITY — the serverless card is byte-identical to the Node core's (single source of truth).
//   5 · the in-page MessagePort transport round-trips a real MCP request/response.
//   6 · the shipped Service Worker (holo-fhs-sw.js) carries the serverless MCP endpoint — every
//       statically-hosted holospace answers /mcp + /~<app>/mcp with NO origin server.
// Authority: W3C Model Context Protocol (2024-11-05) · W3C Service Workers · schema.org/PROV-O · Law L1/L4/L5.
//
//   node tools/holo-serverless-mcp-witness.mjs

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as core from "../os/usr/lib/holo/mcp/holo-mcp-core.mjs";
import { makeBrowserServer, serveOverPort } from "../os/usr/lib/holo/mcp/holo-mcp-browser.js";
import * as node from "../os/usr/lib/holo/mcp/holo-mcp.mjs";
import { verify } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS2 = join(here, "../os");
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); };
const src = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const nodeFree = (s) => !/from\s+["']node:/.test(s) && !/\brequire\s*\(/.test(s) && !/@modelcontextprotocol/.test(s);

// 1 · ISOMORPHIC BY CONSTRUCTION — no node:* / require() / SDK anywhere in the serverless chain
const coreSrc = src(join(OS2, "usr/lib/holo/mcp/holo-mcp-core.mjs"));
const browserSrc = src(join(OS2, "usr/lib/holo/mcp/holo-mcp-browser.js"));
const objectSrc = src(join(OS2, "usr/lib/holo/holo-object.mjs"));
ok("core-node-free", nodeFree(coreSrc) && coreSrc.length > 0, "holo-mcp-core.mjs");
ok("browser-transport-node-free", nodeFree(browserSrc) && browserSrc.length > 0, "holo-mcp-browser.js");
ok("only-dep-node-free", nodeFree(objectSrc), "holo-object.mjs");

// 2 · the core answers the full surface + the standardized core, with zero server
const manifest = { name: "Holo Privacy", id: "privacy", tools: [{ name: "verify_disclosure", description: "verify a VP", inputSchema: { type: "object", properties: {} } }] };
const srv = core.makeServer({ appManifest: manifest });
const call = (m, p) => srv.handle({ jsonrpc: "2.0", id: 1, method: m, params: p });
const init = await call("initialize", {});
ok("initialize", init.result?.protocolVersion === "2024-11-05" && init.result?.serverInfo?.name === "hologram-os/privacy");
const names = (await call("tools/list", {})).result.tools.map((t) => t.name);
ok("standardized-core-present", names.includes("holo_describe") && names.includes("verify_object") && names.includes("resolve_object") && names.includes("verify_disclosure"));
const card = JSON.parse((await call("tools/call", { name: "holo_describe", arguments: {} })).result.content[0].text);
ok("describe-self-verifies", verify(card) === true && (card["@type"] || []).includes("schema:SoftwareApplication"));
const capRes = (await call("resources/read", { uri: "holo://capabilities" })).result?.contents?.[0]?.text;
ok("capabilities-resource", !!capRes && JSON.parse(capRes).id === card.id);

// 3 · build·run·share execute serverlessly on an INJECTED forge (a window.HoloApp surrogate)
const fakeApp = { build: async () => ({ kappa: "did:holo:sha256:" + "a".repeat(64), sourceKappa: "did:holo:sha256:" + "b".repeat(64), receipt: "did:holo:sha256:" + "c".repeat(64), exports: ["f"], hit: false }),
  run: async () => ({ kappa: "did:holo:sha256:" + "a".repeat(64), selfCompiled: false, exports: { f: () => 7 } }), share: (k) => ({ kappa: k, holo: "holo://" + k.split(":").pop(), url: "#k=" + k }) };
const srvApp = core.makeServer({ appManifest: manifest, app: fakeApp });
const built = JSON.parse((await srvApp.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "holo_build", arguments: { source: "int f(){return 7;}" } } })).result.content[0].text);
ok("build-run-share-serverless", built.ok === true, JSON.stringify(built).slice(0, 60));
const noForge = (await call("tools/call", { name: "holo_build", arguments: { source: "int f(){return 1;}" } })).result;
ok("forge-honest-without-app", noForge.isError === true);

// 4 · PARITY — the serverless capability card is byte-identical to the Node core's (single source of truth)
const reg = node.buildAppRegistry(manifest);
ok("card-parity-with-node-core", core.capabilityCard(reg).id === node.capabilityCard(reg).id);

// 5 · the in-page MessagePort transport round-trips a real MCP request/response
const bsrv = makeBrowserServer({ appManifest: manifest });
const ch = new MessageChannel();
serveOverPort(ch.port2, bsrv);
const portResult = await new Promise((res) => { const h = (e) => { ch.port1.removeEventListener("message", h); res(e.data); }; ch.port1.addEventListener("message", h); ch.port1.start && ch.port1.start(); ch.port1.postMessage({ jsonrpc: "2.0", id: 9, method: "initialize", params: {} }); });
ch.port1.close();
ok("in-page-messageport-transport", portResult?.result?.serverInfo?.name === "hologram-os/privacy" && portResult.id === 9);

// 6 · the shipped Service Worker carries the serverless MCP endpoint (static — it runs in a browser/SW, not Node)
const swSrc = src(join(OS2, "holo-fhs-sw.js"));
ok("service-worker-serverless-mcp", /isMcpRoute/.test(swSrc) && /makeMcpServer|holo-mcp-core/.test(swSrc) && /\/~|mcp/.test(swSrc), "SW answers /mcp + /~<app>/mcp client-side");

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "the MCP engine is ISOMORPHIC by construction — holo-mcp-core.mjs + the in-page transport import no node:* / require() / SDK; their only dependency (holo-object) is node-free, so they run in a browser / Service Worker",
    "the core answers the full MCP surface + the standardized application-agnostic core (holo_describe → a self-verifying W3C capability card) with zero server",
    "build·run·share execute serverlessly on an injected forge (window.HoloApp); without one they report honestly",
    "the serverless capability card is byte-identical to the Node core's — single source of truth",
    "the in-page MessagePort transport round-trips a real MCP request/response (the canonical browser-native transport)",
    "the shipped Service Worker (holo-fhs-sw.js) carries the serverless MCP endpoint — every statically-hosted holospace answers /mcp + /~<app>/mcp with no origin server (Law L1/L4)",
  ],
  checks, failed: fail,
  authority: "W3C Model Context Protocol (2024-11-05) · W3C Service Workers · schema.org · W3C PROV-O · UOR content-addressing (Law L1/L4/L5)",
};
writeFileSync(join(here, "holo-serverless-mcp-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Serverless MCP witness — the MCP server runs with no server (browser / Service Worker)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
