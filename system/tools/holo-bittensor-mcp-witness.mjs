#!/usr/bin/env node
// holo-bittensor-mcp-witness.mjs — PROVE Holo Bittensor (ADR-0071) is usable by AI agents over MCP.
// Drives the canonical Hologram MCP server (os/usr/lib/holo/mcp/holo-mcp.mjs) over JSON-RPC:
// bittensor_snapshot / bittensor_agentfacts / bittensor_infer / bittensor_settle are advertised
// (tools/list, JSON-Schema'd) and, called on the deterministic sample subnet, return SELF-VERIFYING
// UOR objects (Law L5) that re-derive — the metagraph catalogue, a dual-trust AgentFacts, a PROV-O
// inference receipt, TAO settlement vouchers. A tampered object verifies false through the agent's
// own verify_object tool. Deterministic, no browser, no network. Pure Node.
//
//   node tools/holo-bittensor-mcp-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeServer } from "../os/usr/lib/holo/mcp/holo-mcp.mjs";
import { verify as verifyObject } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; let passed = 0, failed = 0;
const rec = (n, c, d = "") => { checks[n] = !!c; c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };

const srv = makeServer({ manifests: [] });
const call = (method, params) => srv.handle({ jsonrpc: "2.0", id: 1, method, params });
const payloadOf = (res) => JSON.parse(res.result.content[0].text);

// 1 · the four Bittensor tools are advertised + JSON-Schema'd (discoverable by any MCP host)
const list = await call("tools/list", {});
const tools = list.result.tools || [];
const names = tools.map((t) => t.name);
for (const n of ["bittensor_snapshot", "bittensor_agentfacts", "bittensor_infer", "bittensor_settle"]) rec(`${n} advertised in tools/list`, names.includes(n));
const inferTool = tools.find((t) => t.name === "bittensor_infer");
rec("bittensor_infer declares a JSON-Schema input (prompt)", !!(inferTool && inferTool.inputSchema && inferTool.inputSchema.properties && inferTool.inputSchema.properties.prompt));

// 2 · bittensor_snapshot → a self-verifying κ-rooted catalogue that pins the block hash (Law L5)
const snap = payloadOf(await call("tools/call", { name: "bittensor_snapshot", arguments: {} }));
rec("bittensor_snapshot returns a self-verifying catalogue (re-derive, Law L5)", verifyObject(snap.catalog) && snap.catalog.id === snap.root);
rec("bittensor_snapshot pins the block hash + lists the subnet's neurons", snap.catalog["bt:blockHash"] === snap.blockHash && Array.isArray(snap.neurons) && snap.neurons.length === 3);
// deterministic — a second call re-derives the SAME catalogue κ
const snap2 = payloadOf(await call("tools/call", { name: "bittensor_snapshot", arguments: {} }));
rec("bittensor_snapshot is deterministic (same catalogue κ)", snap2.root === snap.root);

// 3 · bittensor_agentfacts → a dual-trust AgentFacts: self-verifying UOR object AND a valid hotkey-signed VC
const af = payloadOf(await call("tools/call", { name: "bittensor_agentfacts", arguments: { hotkey: snap.neurons[0].hotkey } }));
rec("bittensor_agentfacts returns a self-verifying AgentFacts (re-derive, Law L5)", verifyObject(af.agentFacts) && af.did === af.agentFacts.id);
rec("bittensor_agentfacts is dual-trust (the neuron's hotkey signature verifies)", af.dualTrust === true && /^@DID:bittensor:/.test(af.agentFacts.agent_name));

// 4 · bittensor_infer → a re-derivable PROV-O inference receipt bound to the neuron, the answer text verifiable
const inf = payloadOf(await call("tools/call", { name: "bittensor_infer", arguments: { prompt: "What is the capital of France?" } }));
rec("bittensor_infer answers + returns a self-verifying receipt (Law L5)", inf.answer === "Paris." && verifyObject(inf.receipt) && inf.verified === true);
// the agent re-verifies the receipt through the server's OWN verify_object tool
const vo = payloadOf(await call("tools/call", { name: "verify_object", arguments: { object: inf.receipt } }));
rec("the receipt re-verifies through the agent's verify_object tool", vo.verified === true);
// a tampered answer is refused by verify_object (the agent catches the forgery)
const forged = JSON.parse(JSON.stringify(inf.receipt)); forged["prov:generated"]["schema:text"] = "London.";
const voBad = payloadOf(await call("tools/call", { name: "verify_object", arguments: { object: forged } }));
rec("a tampered inference receipt is refused (verify_object false)", voBad.verified === false);

// 5 · bittensor_settle → TAO vouchers per proven step, each self-verifying, testnet-gated
const st = payloadOf(await call("tools/call", { name: "bittensor_settle", arguments: {} }));
rec("bittensor_settle pays every proven step (self-verifying vouchers, testnet)", Array.isArray(st.released) && st.released.length === 2 && st.network === "testnet" && st.verified === true && st.released.every((v) => verifyObject(v) && v["schema:priceCurrency"] === "TAO"));
rec("the work receipt is self-verifying (the PROV-O collaboration DAG, Law L5)", verifyObject(st.workReceipt));

const witnessed = failed === 0;
writeFileSync(join(here, "holo-bittensor-mcp-witness.result.json"), JSON.stringify({
  spec: "Holo Bittensor (ADR-0071) is usable by AI agents over MCP — bittensor_snapshot · bittensor_agentfacts · bittensor_infer · bittensor_settle are advertised, JSON-Schema'd tools returning self-verifying UOR objects (Law L5): an agent maps a subnet, reads a neuron's dual-trust AgentFacts, queries a miner and re-derives the inference receipt, and settles TAO against proven work — without trusting any server; a tampered object is refused through verify_object",
  authority: "W3C Model Context Protocol (2024-11-05) · Bittensor SDK (bt-api-ref) · Project NANDA AgentFacts · W3C DID Core + VC Data Integrity + PROV-O + DCAT · IETF RFC 8785 (JCS) · UOR-ADDR (κ = H(canonical_form)) · verify by re-derivation (Law L5)",
  witnessed,
  covers: ["bittensor-mcp", "agents-as-clients", "self-verifying", "dual-trust", "inference-receipt", "settlement", "law-l5"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-bittensor-mcp-witness: ${passed} passed, ${failed} failed`);
process.exit(witnessed ? 0 : 1);
