// core/presets.js — preset CRUD (the saved parameter bundles a conversation spreads, LibreChat's
// conversationPreset semantics). Each preset is a κ-object in the store; the boot index keeps
// pointer rows { presetId, kappa, title } so listing is O(1) without a scan.

import { normPreset } from "./schema.js";

const LC = { lc: "https://librechat.ai/ns#" };

export function makePresets(chatStore) {
  const { store, getIndex, newId } = chatStore;
  const putIndex = async (idx) => { const b = new TextEncoder().encode(JSON.stringify(idx)); return store.backend.putRaw ? store.backend.putRaw("index:org.hologram.HoloQ", b) : store.backend.put("index:org.hologram.HoloQ", b); };

  async function save(p) {
    const norm = normPreset(p);
    if (!norm.presetId) norm.presetId = newId("preset");
    const obj = await store.makeObject({ type: ["schema:PropertyValue", "prov:Entity"], context: [LC], "schema:identifier": norm.presetId, "schema:name": norm.title, "lc:preset": norm });
    const idx = await getIndex();
    idx.presets = idx.presets || [];
    const i = idx.presets.findIndex((x) => x.presetId === norm.presetId);
    const ptr = { presetId: norm.presetId, kappa: obj.id, title: norm.title, defaultPreset: !!p.defaultPreset };
    if (i >= 0) idx.presets[i] = ptr; else idx.presets.push(ptr);
    if (p.defaultPreset) idx.presets.forEach((x) => { if (x.presetId !== norm.presetId) x.defaultPreset = false; });
    await putIndex(idx);
    return { ...norm, kappa: obj.id };
  }

  async function list() { return (await getIndex()).presets || []; }

  async function get(presetId) {
    const ptr = (await list()).find((x) => x.presetId === presetId); if (!ptr) return null;
    const obj = await store.getObj(ptr.kappa); if (!obj) return null;
    if (!(await store.verify(obj))) return null;   // Law L5: a tampered preset is refused
    return { ...normPreset(obj["lc:preset"]), kappa: ptr.kappa };
  }

  async function getDefault() {
    const ptrs = await list(); const d = ptrs.find((x) => x.defaultPreset) || null;
    return d ? get(d.presetId) : null;
  }

  async function remove(presetId) {
    const idx = await getIndex();
    idx.presets = (idx.presets || []).filter((x) => x.presetId !== presetId);
    await putIndex(idx);   // the κ-object stays content-addressed in the store (dedup'd, unreferenced)
  }

  return { save, list, get, getDefault, remove };
}

// The factory default — mirrors the engine's real capabilities (greedy decode is the
// deterministic, verifiable path; temperature stays 0 unless a model declares one).
export const DEFAULT_PRESET = () => normPreset({
  title: "Default", temperature: 0, maxOutputTokens: 900, promptPrefix: "",
});
