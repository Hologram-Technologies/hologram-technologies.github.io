#!/usr/bin/env node
// qml-mcp-witness.mjs — PROVE the render_qml MCP tool is live + useful to AI agents. Drives the
// canonical Hologram MCP server (os/usr/lib/holo/mcp/holo-mcp.mjs) over JSON-RPC: confirms the tool
// is advertised in tools/list, calls it on the REAL upstream SDDM greeter source, and checks the
// returned object is the real component tree, self-verifies (Law L5), and is deterministic
// (a second call re-derives the SAME κ). No browser, no Qt — an agent introspects a QML UI's
// structure + wired API through one verifiable tool.
//
//   node tools/qml-mcp-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeServer } from "../os/usr/lib/holo/mcp/holo-mcp.mjs";
import { verify } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); };

const srv = makeServer({ manifests: [] });
const call = (method, params) => srv.handle({ jsonrpc: "2.0", id: 1, method, params });
const payloadOf = (res) => JSON.parse(res.result.content[0].text);

// 1 · advertised in tools/list (discoverable)
const list = await call("tools/list", {});
const tool = (list.result.tools || []).find((t) => t.name === "render_qml");
ok("advertised", !!tool && /qml/i.test(tool.description), tool ? "present" : "render_qml not in tools/list");
ok("has-input-schema", !!(tool && tool.inputSchema && tool.inputSchema.properties && tool.inputSchema.properties.qml), "qml input declared");

// 2 · runs the REAL upstream greeter source
const qml = readFileSync(join(OS, "usr/share/sddm/themes/maldives/Main.qml"), "utf8");
const res = await call("tools/call", { name: "render_qml", arguments: { qml, baseUrl: "/usr/share/sddm/themes/maldives/" } });
ok("no-error", res.result && !res.result.isError, res.result && res.result.isError ? res.result.content[0].text : "");
let p = null; try { p = payloadOf(res); } catch (e) { ok("parse-result", false, e.message); }
if (p) {
  ok("real-tree", p.objectCount >= 20 && p.result && p.result.tree && p.result.tree.type === "Rectangle", `objectCount=${p.objectCount} root=${p.result && p.result.tree && p.result.tree.type}`);
  ok("imports", Array.isArray(p.imports) && p.imports.some((i) => /QtQuick/.test(i)) && p.imports.some((i) => /SddmComponents/.test(i)), (p.imports || []).join(", "));
  ok("self-verifies", verify(p.result), "Law L5 on the render object");
}

// 3 · deterministic — a second call re-derives the SAME κ (trustless: recompute, don't trust)
const res2 = await call("tools/call", { name: "render_qml", arguments: { qml, baseUrl: "/usr/share/sddm/themes/maldives/" } });
const p2 = (() => { try { return payloadOf(res2); } catch { return null; } })();
ok("deterministic", p && p2 && p.result.id === p2.result.id, p && p2 ? `${p.result.id} vs ${p2.result.id}` : "no second result");

// 4 · honest error path (default-deny on bad input)
const bad = await call("tools/call", { name: "render_qml", arguments: {} });
ok("error-path", bad.result && bad.result.isError === true, "missing qml should error");

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "qml-mcp-witness.result.json"), JSON.stringify({
  "@type": "earl:TestResult", witnessed,
  covers: witnessed ? ["render_qml is a live MCP tool", "returns the real self-verifying QML tree (Law L5)", "deterministic (re-derivable κ)", "advertised in tools/list"] : [],
  checks, failed: fail, did: (function () { try { return payloadOf(res).result.id; } catch { return null; } })(),
  authority: "W3C Model Context Protocol (2024-11-05) · Qt 6 QML Reference · verify by re-derivation (Law L5)",
}, null, 2) + "\n");

console.log("Holo QML — render_qml MCP tool witness\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  render_qml is live + agent-usable" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
