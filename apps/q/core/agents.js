// core/agents.js — AGENTS as κ-objects (LibreChat agent semantics, substrate-native). An agent
// bundles identity + instructions + model + parameters + armed tools + conversation starters;
// selecting one shapes every turn (instructions ride the system block, its tool selection arms
// the MCP loop). Field names follow the LibreChat agent schema so exports interoperate; each
// version re-seals to a new κ (history is free, Law L3).

import { normPreset } from "./schema.js";

const LC = { lc: "https://librechat.ai/ns#" };

export function normAgent(a = {}) {
  return {
    id: typeof a.id === "string" ? a.id : null,
    name: a.name || "New Agent",
    description: a.description || "",
    instructions: a.instructions || "",
    avatar: a.avatar || null,                          // { filepath, source } | emoji string | null
    provider: a.provider || "holo-q",                  // the local substrate engine
    model: a.model || null,                            // a MODELS[] name
    model_parameters: {
      temperature: +(a.model_parameters?.temperature ?? 0) || 0,
      max_output_tokens: +(a.model_parameters?.max_output_tokens ?? 900) || 900,
    },
    tools: Array.isArray(a.tools) ? a.tools : [],      // armed tool names (the MCP loop selection)
    mcpServerNames: Array.isArray(a.mcpServerNames) ? a.mcpServerNames : [],
    conversation_starters: Array.isArray(a.conversation_starters) ? a.conversation_starters.filter(Boolean).slice(0, 4) : [],
    artifacts: a.artifacts || "default",               // 'default' | 'custom' (custom: instructions own the format)
    recursion_limit: +(a.recursion_limit ?? 4) || 4,   // max tool rounds
    category: a.category || "general",
    version: +(a.version ?? 1) || 1,
  };
}

export function makeAgents(chatStore) {
  const { store, getIndex, newId } = chatStore;
  const putIndex = async (idx) => { const b = new TextEncoder().encode(JSON.stringify(idx)); return store.backend.putRaw ? store.backend.putRaw("index:org.hologram.HoloQ", b) : store.backend.put("index:org.hologram.HoloQ", b); };

  async function save(a) {
    const norm = normAgent(a);
    if (!norm.id) norm.id = newId("agent");
    const prevPtr = ((await getIndex()).agents || []).find((x) => x.id === norm.id);
    if (prevPtr) norm.version = (prevPtr.version || 1) + 1;
    const obj = await store.makeObject({
      type: ["schema:SoftwareAgent", "prov:Entity"], context: [LC],
      "schema:identifier": norm.id, "schema:name": norm.name, "schema:description": norm.description,
      "lc:agent": norm,
      ...(prevPtr ? { links: [{ ...store.contentLink("prov:wasRevisionOf", prevPtr.kappa, "schema:SoftwareAgent"), "schema:name": "previousVersion" }] } : {}),
    });
    const idx = await getIndex();
    idx.agents = idx.agents || [];
    const ptr = { id: norm.id, kappa: obj.id, name: norm.name, avatar: norm.avatar, category: norm.category, version: norm.version };
    const i = idx.agents.findIndex((x) => x.id === norm.id);
    if (i >= 0) idx.agents[i] = ptr; else idx.agents.push(ptr);
    await putIndex(idx);
    return { ...norm, kappa: obj.id };
  }

  async function list() { return (await getIndex()).agents || []; }

  async function get(id) {
    const ptr = (await list()).find((x) => x.id === id); if (!ptr) return null;
    const obj = await store.getObj(ptr.kappa); if (!obj) return null;
    if (!(await store.verify(obj))) return null;       // Law L5: a tampered agent is refused
    return { ...normAgent(obj["lc:agent"]), kappa: ptr.kappa };
  }

  async function remove(id) {
    const idx = await getIndex();
    idx.agents = (idx.agents || []).filter((x) => x.id !== id);
    await putIndex(idx);
  }

  return { save, list, get, remove, normAgent };
}
