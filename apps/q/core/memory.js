// core/memory.js — persistent USER MEMORY (LibreChat memory semantics, substrate-native).
// Memories are key/value facts (key validated /^[a-z_]+$/, value a complete sentence) stored as
// κ-objects with pointers in the boot index. They inject into the system block as the
// "# Existing memory:" section, and the model maintains them itself through two LOCAL tools
// (set_memory / delete_memory) armed alongside MCP tools in the agentic loop — no server,
// every write content-addressed and verifiable.

const LC = { lc: "https://librechat.ai/ns#" };
export const KEY_RE = /^[a-z_]+$/;

export function makeMemory(chatStore, { tokenLimit = 2000 } = {}) {
  const { store, getIndex, newId } = chatStore;
  const putIndex = async (idx) => { const b = new TextEncoder().encode(JSON.stringify(idx)); return store.backend.putRaw ? store.backend.putRaw("index:org.hologram.HoloQ", b) : store.backend.put("index:org.hologram.HoloQ", b); };
  const tokensOf = (s) => Math.ceil((s || "").length / 4);   // a fair, dependency-free estimate

  async function list() { return (await getIndex()).memories || []; }

  async function set(key, value) {
    key = String(key || "").toLowerCase().trim();
    if (!KEY_RE.test(key)) return { ok: false, error: "invalid key — use lowercase letters and underscores" };
    const idx = await getIndex();
    idx.memories = idx.memories || [];
    const used = idx.memories.filter((m) => m.key !== key).reduce((n, m) => n + (m.tokenCount || 0), 0);
    const tc = tokensOf(value);
    if (used + tc > tokenLimit) return { ok: false, error: `memory full: ${used}+${tc} > ${tokenLimit} tokens` };
    const obj = await store.makeObject({
      type: ["schema:Statement", "prov:Entity"], context: [LC],
      "lc:key": key, "lc:value": String(value || ""), "lc:tokenCount": tc,
      "schema:dateModified": new Date().toISOString(),
    });
    const i = idx.memories.findIndex((m) => m.key === key);
    const ptr = { key, kappa: obj.id, value: String(value || ""), tokenCount: tc, updated_at: new Date().toISOString() };
    if (i >= 0) idx.memories[i] = ptr; else idx.memories.push(ptr);
    await putIndex(idx);
    return { ok: true, key, kappa: obj.id };
  }

  async function remove(key) {
    const idx = await getIndex();
    idx.memories = (idx.memories || []).filter((m) => m.key !== key);
    await putIndex(idx);
    return { ok: true };
  }

  // The system-block injection ("# Existing memory:" — the LibreChat convention).
  async function injection() {
    const mems = await list();
    if (!mems.length) return "";
    const used = mems.reduce((n, m) => n + (m.tokenCount || 0), 0);
    return `# Memory Status:\nCurrent memory usage: ${used} tokens\nToken limit: ${tokenLimit} tokens\nRemaining capacity: ${Math.max(0, tokenLimit - used)} tokens\n\n# Existing memory:\n` +
      mems.map((m) => `- ${m.key}: ${m.value}`).join("\n");
  }

  // The two LOCAL tools the agentic loop arms (same shape as MCP hub tools).
  function localTools() {
    return [
      {
        def: { name: "set_memory", description: "Remember a fact about the user across conversations. Only when the user explicitly asks (\"remember that…\"). key: lowercase_with_underscores; value: one complete sentence.", inputSchema: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] } },
        serverName: "memory", call: async (a) => { const r = await set(a.key, a.value); return { text: JSON.stringify(r), isError: !r.ok }; },
      },
      {
        def: { name: "delete_memory", description: "Forget a remembered fact, by key. Only when the user explicitly asks.", inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
        serverName: "memory", call: async (a) => { const r = await remove(a.key); return { text: JSON.stringify(r), isError: false }; },
      },
    ];
  }

  return { list, set, remove, injection, localTools, tokenLimit };
}
