#!/usr/bin/env node
// q-witness.mjs — proves Holo Q is a substrate-native chat app: conversations persist as
// content-addressed κ-objects (not a database), the LibreChat parentMessageId branch tree is a
// verify-on-load Merkle-DAG, and every answer is a re-derivable PROV-O inference receipt (Law L5).
//
// Pure Node, Map-backed store — it imports the SAME core/store.js + core/kappa.js the browser app
// ships, so the re-derivation logic under test is exactly the shipped logic. Emits
// tools/q-witness.result.json = { witnessed, checks, failed, covers, authority } and exits 0/1.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APP = new URL("../../../Hologram Apps/apps/q/core/", import.meta.url);
const { makeChatStore, mapBackend, makeStore } = await import(new URL("store.js", APP));
const { sealReceipt, verifyIntegrity, kappaTokens } = await import(new URL("kappa.js", APP));
const { makeAgents } = await import(new URL("agents.js", APP));
const { makePromptsLib, detectVariables, fillVariables } = await import(new URL("promptsLib.js", APP));
const { makeMemory } = await import(new URL("memory.js", APP));
const { parseToolCalls, sealToolReceipt, toolSystemPrompt } = await import(new URL("tools.js", APP));
const { parseArtifacts } = await import(new URL("../render/artifacts.js", APP));

const checks = {}, failed = [];
const ok = (name, cond, detail) => { checks[name] = !!cond; if (!cond) failed.push(name + (detail ? ` — ${detail}` : "")); return !!cond; };

// deterministic clock so re-runs are byte-stable (Date is fine in Node, but fix it for reproducibility)
let _t = 0; const now = () => new Date(1717000000000 + (_t++) * 1000).toISOString();

const MODEL_K = "did:holo:sha256:" + "a".repeat(64);
const ENGINE_K = "did:holo:sha256:" + "b".repeat(64);
const PARAMS = { decode: "greedy-argmax", maxTokens: 900, repetitionPenalty: 1.05, template: "chatml", thinking: true };

try {
  const backend = mapBackend();
  const cs = makeChatStore(backend, { now });
  const convId = "conv-witness-1";

  // ── build a 3-turn thread: user → assistant(+receipt) → user → assistant ──
  const m0 = await cs.saveMessage({ conversationId: convId, sender: "User", isCreatedByUser: true, text: "What is the capital of France?" });

  const out1 = [12, 34, 56, 78];
  const rec1 = await sealReceipt({ promptText: "What is the capital of France?", ctxIds: [], turnIds: [1, 2, 3], outIds: out1, text: "Paris.", params: PARAMS, modelKappa: MODEL_K, engineKappa: ENGINE_K });
  await cs.saveReceipt(rec1);
  const m1 = await cs.saveMessage({ conversationId: convId, sender: "Assistant", isCreatedByUser: false, model: "Qwen2.5-1.5B", text: "Paris.", tokenCount: out1.length, parent: m0, receiptKappa: rec1.id });

  const m2 = await cs.saveMessage({ conversationId: convId, sender: "User", isCreatedByUser: true, text: "And of Japan?", parent: m1 });
  const m3 = await cs.saveMessage({ conversationId: convId, sender: "Assistant", isCreatedByUser: false, model: "Qwen2.5-1.5B", text: "Tokyo.", parent: m2 });

  const conv = await cs.saveConversation({ conversationId: convId, title: "Capitals", headMessage: m3 });

  // 1 · conversation κ re-derives (Law L1/L5)
  ok("conversation-kappa-rederives", await cs.store.verify(conv), "conv.id != address(conv)");

  // 2 · the whole message tree verifies top-to-bottom (Merkle-DAG)
  const deep = await cs.store.verifyDeep(conv);
  ok("message-tree-integrity-clean", deep.ok, deep.why ? `${deep.why} @ ${deep.at}` : "");

  // 2b · tamper a middle message → verifyDeep refuses (and points at the break)
  await cs.store._corrupt(m1.id, (o) => { o["schema:text"] = "London."; });
  const tampered = await cs.store.verifyDeep(conv);
  ok("message-tree-integrity-tamper-refused", tampered.ok === false, "tamper not detected");
  // restore for the remaining checks
  await cs.store._corrupt(m1.id, (o) => { o["schema:text"] = "Paris."; });

  // 3 · two regenerations under the SAME parent → distinct κ, same parentMessageId (sibling fork)
  const sibA = await cs.saveMessage({ conversationId: convId, sender: "Assistant", isCreatedByUser: false, text: "Paris is the capital.", parent: m0 });
  const sibB = await cs.saveMessage({ conversationId: convId, sender: "Assistant", isCreatedByUser: false, text: "It's Paris.", parent: m0 });
  ok("sibling-fork-distinct-kappa", sibA.id !== sibB.id && sibA["lc:parentMessageId"] === m0["schema:identifier"] && sibB["lc:parentMessageId"] === m0["schema:identifier"], "siblings not distinct or wrong parent");

  // 4 · the inference receipt re-derives to its address; tamper any field → refused (Law L5)
  ok("receipt-rederives", (await verifyIntegrity(rec1)).ok, "receipt id != address(body)");
  const forged = JSON.parse(JSON.stringify(rec1)); forged.body["prov:generated"]["holo:tokenCount"] = 999;
  ok("receipt-tamper-refused", (await verifyIntegrity(forged)).ok === false, "forged receipt still verified");

  // 5 · the output-tokens κ is deterministic (the re-derivation anchor)
  const k1 = await kappaTokens(out1), k2 = await kappaTokens(out1);
  ok("receipt-output-kappa-stable", k1 === k2 && rec1.body["prov:generated"]["holo:outputTokens"] === k1, "output κ not stable");

  // 6 · store round-trip: load by pointer, re-verify the loaded object (the sync-Map shim)
  const fresh = makeChatStore(backend, { now });   // a NEW chat store over the SAME backend (cold load)
  const loaded = await fresh.loadConversation(convId);
  ok("store-roundtrip", loaded && loaded.ok && loaded.conv.id === conv.id, "cold load did not re-verify");

  // ── the POWER features (LibreChat parity, substrate-native) ──────────────────────────────

  // 7 · agents are κ-objects: save → pointer → get re-verifies; tamper → refused
  const agents = makeAgents(cs);
  const ag = await agents.save({ name: "Guide", instructions: "Be a guide.", tools: ["verify_object"], conversation_starters: ["What is κ?"] });
  ok("agent-kappa-sealed", !!ag.kappa && ag.kappa.startsWith("did:holo:sha256:"), "no κ");
  const agBack = await agents.get(ag.id);
  ok("agent-rederives", !!agBack && agBack.name === "Guide" && agBack.tools.includes("verify_object"), "agent did not re-verify");
  await cs.store._corrupt(ag.kappa, (o) => { o["lc:agent"].instructions = "Be evil."; });
  ok("agent-tamper-refused", (await agents.get(ag.id)) === null, "tampered agent still loaded");

  // 8 · prompts library: production version is a κ-object; {{variables}} parse + fill
  const plib = makePromptsLib(cs);
  const g = await plib.save({ name: "Explainer", command: "explain", prompt: "Explain {{topic}} at a {{level:beginner|expert}} level.", type: "text" });
  const prod = await plib.production(g.groupId);
  ok("prompt-production-kappa", !!prod && !!prod.kappa, "no production version");
  const vars = detectVariables(prod.prompt);
  ok("prompt-variables", vars.length === 2 && vars[0].name === "topic" && vars[1].options && vars[1].options.length === 2, JSON.stringify(vars));
  ok("prompt-fill", fillVariables(prod.prompt, { "topic": "κ", "level:beginner|expert": "expert" }) === "Explain κ at a expert level.", "fill mismatch");

  // 9 · memory: set/inject as κ-objects; the local tools exist for the agentic loop
  const mem = makeMemory(cs);
  const ms = await mem.set("favorite_color", "The user's favorite color is mint green.");
  ok("memory-set-kappa", ms.ok && ms.kappa.startsWith("did:holo:sha256:"), ms.error || "no κ");
  ok("memory-injection", (await mem.injection()).includes("favorite_color"), "injection missing key");
  ok("memory-local-tools", mem.localTools().map((x) => x.def.name).join(",") === "set_memory,delete_memory", "local tools wrong");
  ok("memory-key-validated", !(await mem.set("Bad Key!", "x")).ok, "invalid key accepted");

  // 10 · the MCP tool loop wire format: tool_call parse + per-call PROV-O receipt re-derives
  const calls = parseToolCalls('before <tool_call>\n{"name":"search_web","arguments":{"query":"uor"}}\n</tool_call> after');
  ok("toolcall-parse", calls.length === 1 && calls[0].name === "search_web" && calls[0].arguments.query === "uor", JSON.stringify(calls));
  ok("toolprompt-declares", toolSystemPrompt([{ name: "t1", description: "d", inputSchema: { type: "object" } }]).includes("<tools>"), "no tools block");
  const trec = await sealToolReceipt({ server: "hologram", tool: "search_web", args: { query: "uor" }, resultText: "result", ok: true });
  ok("toolreceipt-rederives", (await verifyIntegrity(trec)).ok, "tool receipt id != address(body)");

  // 11 · artifacts: the :::artifact wire format parses (identifier · type · title · fenced content)
  const arts = parseArtifacts(':::artifact{identifier="demo-page" type="text/html" title="Demo"}\n```html\n<h1>Hi</h1>\n```\n:::');
  ok("artifact-parse", arts.length === 1 && arts[0].identifier === "demo-page" && arts[0].type === "text/html" && arts[0].content === "<h1>Hi</h1>", JSON.stringify(arts));

} catch (e) {
  ok("witness-ran", false, String((e && e.stack) || e));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed, checks, failed,
  covers: [
    "Conversations persist as content-addressed κ-objects, not a database (Law L1/L3)",
    "The LibreChat parentMessageId branch tree is a verify-on-load Merkle-DAG (Law L5)",
    "Tampering any message, receipt, or agent byte is refused by re-derivation",
    "Every answer is a re-derivable PROV-O inference receipt sealed to a did:holo",
    "Agents, prompt versions, memories and artifacts are themselves κ-objects",
    "The MCP tool loop's wire format parses and every tool call seals its own PROV-O receipt",
    "Prompt-library {{variables}} (incl. option dropdowns) detect and fill exactly",
  ],
  authority: "IETF RFC 8785 (JCS) · W3C PROV-O · W3C DID Core · W3C Subresource Integrity · UOR content-addressing (κ = H(canonical form)) · verify-by-re-derivation (Law L1/L3/L5) · LibreChat data model (reproduced)",
};
writeFileSync(join(here, "q-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`q-witness — ${witnessed ? "WITNESSED ✓" : "NOT witnessed ✗"}`);
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"} ${k}`);
if (failed.length) console.log("  failed:\n   - " + failed.join("\n   - "));
process.exit(witnessed ? 0 : 1);
