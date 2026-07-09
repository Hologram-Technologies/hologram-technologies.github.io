// core/tools.js — the agentic TOOL-CALLING loop over the local engine + MCP. Qwen2.5's
// native function-calling convention: the system turn declares tools as JSON schemas inside
// a <tools>…</tools> block; the model emits <tool_call>{"name":…,"arguments":…}</tool_call>;
// each result returns as a user-role <tool_response>…</tool_response> turn and generation
// continues — until a turn arrives with no tool call (the final answer) or maxRounds hits.
//
// Substrate-native: EVERY tool call is sealed as its own PROV-O activity (tool ⊕ args ⊕
// result, each by κ) and the per-call receipts ride the answer's receipt — a verifiable
// work-trail for agentic answers, the chat-layer analogue of Holo Orchestrate (ADR-045).

import { didHolo, kappaText, jcs } from "./kappa.js";

// The system turn that arms the model with tools (Qwen2.5 function-calling convention).
export function toolSystemPrompt(tools, extra = "") {
  const decls = tools.map((t) => JSON.stringify({ type: "function", function: { name: t.name, description: t.description || "", parameters: t.inputSchema || { type: "object", properties: {} } } })).join("\n");
  return (
    (extra ? extra + "\n\n" : "") +
    "# Tools\n\nYou may call one or more functions to assist with the user query.\n\n" +
    "You are provided with function signatures within <tools></tools> XML tags:\n<tools>\n" + decls + "\n</tools>\n\n" +
    "For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:\n" +
    '<tool_call>\n{"name": <function-name>, "arguments": <args-json-object>}\n</tool_call>'
  );
}

// Parse <tool_call> blocks out of a model turn. Tolerant: bare JSON with name+arguments
// also counts (small models sometimes drop the tags).
export function parseToolCalls(text) {
  const calls = [];
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let m;
  while ((m = re.exec(text))) { try { const j = JSON.parse(m[1]); if (j && j.name) calls.push({ name: j.name, arguments: j.arguments || {} }); } catch {} }
  // ```json fenced code blocks with {name, arguments} (Qwen2.5-Coder often emits this form)
  if (!calls.length) {
    const cb = /```(?:json|tool_call)?\s*(\{[\s\S]*?\})\s*```/g;
    while ((m = cb.exec(text))) { try { const j = JSON.parse(m[1]); if (j && j.name && ("arguments" in j)) calls.push({ name: j.name, arguments: j.arguments || {} }); } catch {} }
  }
  if (!calls.length) {
    const t = text.trim();
    if (t.startsWith("{") && t.includes('"name"')) { try { const j = JSON.parse(t); if (j.name && ("arguments" in j)) calls.push({ name: j.name, arguments: j.arguments || {} }); } catch {} }
  }
  return calls;
}

export const stripToolCalls = (text) => text
  .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
  .replace(/```(?:json|tool_call)?\s*\{[\s\S]*?"name"[\s\S]*?\}\s*```/g, "")   // strip fenced tool calls too
  .trim();

// Seal one tool call as a PROV-O activity (its own did:holo — tamper → refuse).
export async function sealToolReceipt({ server, tool, args, resultText, ok }) {
  const body = {
    "@context": ["http://www.w3.org/ns/prov#", { holo: "https://hologram.os/ns/q#" }],
    "@type": "prov:Activity", "holo:kind": "tool-call",
    "prov:used": { "holo:server": server, "holo:tool": tool, "holo:args": await didHolo(JSON.parse(jcs(args || {}))), "holo:argsJson": jcs(args || {}) },
    "prov:generated": { "holo:result": await kappaText(resultText), "holo:ok": !!ok },
  };
  return { id: await didHolo(body), body };
}

// Frame the agentic first turn: system(tools) + user prompt (ChatML, by hand so the system
// block rides this turn). Exposed so the caller can persist the EXACT ids that run (the
// ctx-concat invariant of the message tree).
export function frameAgenticTurn({ tools, promptText, hasHistory, extraSystem = "" }) {
  const sys = toolSystemPrompt(tools.map((t) => t.def), extraSystem);
  return (hasHistory ? "<|im_end|>\n" : "") +
    `<|im_start|>system\n${sys}<|im_end|>\n<|im_start|>user\n${promptText}<|im_end|>\n<|im_start|>assistant\n`;
}

// The loop. `callbacks.onToolCall({name,args})` / `onToolResult({name,text,receipt})` let the
// UI stream the work-trail live. Returns { text, rounds, toolReceipts, trace, ids }.
export async function runToolLoop({ engine, tools, promptText, ctxIds, firstFramed, signal, onToken, onToolCall, onToolResult, maxRounds = 4 }) {
  const toolReceipts = []; const trace = [];
  let framed = firstFramed || frameAgenticTurn({ tools, promptText, hasHistory: ctxIds.length > 0 });
  let ids = ctxIds.slice();
  let finalText = "", rounds = 0;

  for (; rounds < maxRounds; rounds++) {
    const turnIds = engine.tokenize(framed);
    ids = ids.concat(turnIds);
    // tight per-round budget: a tool_call is ~50 tokens, a final answer ~300 — snappy rounds,
    // the same total work, far lower latency than letting one round run the whole cap.
    // generous budget: tool calls that carry CODE (write_file, build_app) need room — a truncated
    // call is invalid JSON and silently fails. 1536 fits a small app; plain rounds end early on EOS.
    const res = await engine.generate(ids, { signal, onToken, maxNew: 1536 });
    ids = res.ids;
    const calls = parseToolCalls(res.text);
    if (!calls.length || (signal && signal.aborted)) { finalText = stripToolCalls(res.text); break; }

    // execute every call this round through MCP, seal a receipt each
    const responses = [];
    for (const c of calls) {
      if (signal && signal.aborted) break;
      const t = tools.find((x) => x.def.name === c.name);
      onToolCall && onToolCall({ name: c.name, args: c.arguments, server: t ? t.serverName : "?" });
      let text, ok = true, render = null;
      try {
        if (!t) throw new Error("unknown tool: " + c.name);
        const r = await t.call(c.arguments);
        text = r.text; ok = !r.isError; render = r.render || null;   // build_app → live preview payload
      } catch (e) { text = "ERROR: " + (e && e.message || e); ok = false; }
      const receipt = await sealToolReceipt({ server: t ? t.serverName : "?", tool: c.name, args: c.arguments, resultText: text, ok });
      toolReceipts.push(receipt);
      trace.push({ name: c.name, args: c.arguments, text: text.slice(0, 4000), ok, receiptId: receipt.id, server: t ? t.serverName : "?" });
      onToolResult && onToolResult({ name: c.name, text, ok, receipt, render });
      responses.push(`<tool_response>\n${text.slice(0, 2400)}\n</tool_response>`);   // bounded — tool output must fit the local context window
    }
    // feed results back (user role per the Qwen convention) and continue
    framed = `<|im_end|>\n<|im_start|>user\n${responses.join("\n")}<|im_end|>\n<|im_start|>assistant\n`;
    finalText = stripToolCalls(res.text);   // best-so-far, replaced if a later round answers
  }
  return { text: finalText, rounds: rounds + 1, toolReceipts, trace, ids };
}
