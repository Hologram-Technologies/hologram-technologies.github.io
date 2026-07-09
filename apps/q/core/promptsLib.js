// core/promptsLib.js — the PROMPTS LIBRARY as κ-objects (LibreChat prompt-group semantics).
// A group carries name · category · oneliner · command (the /slash trigger) and points at its
// PRODUCTION version; every version is its own immutable κ-object (text or chat type). The
// {{variable}} syntax matches LibreChat: {{name}}, {{name:opt1|opt2}} dropdowns, and the
// special variables {{current_date}} {{current_datetime}} {{iso_datetime}} {{current_user}}.

const LC = { lc: "https://librechat.ai/ns#" };
export const COMMAND_RE = /^[a-z0-9-]{1,56}$/;
export const VAR_RE = /{{([^{}]+?)}}/g;
const SPECIAL = ["current_date", "current_datetime", "iso_datetime", "current_user"];

export function detectVariables(text) {
  const out = []; const seen = new Set(); let m;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(text || ""))) {
    const raw = m[1].trim();
    const name = raw.split(":")[0].trim();
    if (SPECIAL.includes(name.toLowerCase()) || seen.has(name)) continue;
    seen.add(name);
    const opts = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1).split("|").map((s) => s.trim()).filter(Boolean) : null;
    out.push({ name, raw, options: opts });
  }
  return out;
}

export function replaceSpecialVars(text, { userName = "operator" } = {}) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const day = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()];
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const off = -d.getTimezoneOffset(); const tz = (off >= 0 ? "+" : "-") + pad(Math.floor(Math.abs(off) / 60)) + ":" + pad(Math.abs(off) % 60);
  const sub = (t, name, v) => t.replace(new RegExp(`{{\\s*${name}\\s*}}`, "gi"), v);
  let out = text || "";
  out = sub(out, "current_date", `${date} (${day})`);
  out = sub(out, "current_datetime", `${date} ${time} ${tz} (${day})`);
  out = sub(out, "iso_datetime", d.toISOString());
  out = sub(out, "current_user", userName);
  return out;
}

export function fillVariables(text, values) {
  let out = text || "";
  for (const [raw, v] of Object.entries(values || {})) {
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`{{\\s*${esc}\\s*}}`, "g"), v);
  }
  return out;
}

export function makePromptsLib(chatStore) {
  const { store, getIndex, newId } = chatStore;
  const putIndex = async (idx) => { const b = new TextEncoder().encode(JSON.stringify(idx)); return store.backend.putRaw ? store.backend.putRaw("index:org.hologram.HoloQ", b) : store.backend.put("index:org.hologram.HoloQ", b); };

  // Save a version into a group (creates the group when groupId is null); production by default.
  async function save({ groupId, name, category = "", oneliner = "", command = "", prompt, type = "text", production = true }) {
    command = (command || "").toLowerCase();
    if (command && !COMMAND_RE.test(command)) throw new Error("command must be a-z 0-9 dash, ≤56 chars");
    const versionObj = await store.makeObject({
      type: ["schema:CreativeWork", "prov:Entity"], context: [LC],
      "lc:prompt": prompt || "", "lc:type": type === "chat" ? "chat" : "text",
      "schema:dateCreated": new Date().toISOString(),
    });
    const idx = await getIndex();
    idx.promptGroups = idx.promptGroups || [];
    let g = groupId ? idx.promptGroups.find((x) => x.groupId === groupId) : null;
    if (!g) {
      g = { groupId: newId("pgroup"), name: name || "New Prompt", category, oneliner, command, versions: [], productionKappa: null, numberOfGenerations: 0 };
      idx.promptGroups.push(g);
    }
    if (name) g.name = name;
    if (category !== undefined) g.category = category;
    if (oneliner !== undefined) g.oneliner = oneliner;
    if (command !== undefined) g.command = command;
    g.versions.push({ kappa: versionObj.id, createdAt: new Date().toISOString() });
    if (production || !g.productionKappa) g.productionKappa = versionObj.id;
    await putIndex(idx);
    return { ...g };
  }

  async function list() { return (await getIndex()).promptGroups || []; }

  async function production(groupId) {
    const g = (await list()).find((x) => x.groupId === groupId); if (!g || !g.productionKappa) return null;
    const obj = await store.getObj(g.productionKappa); if (!obj) return null;
    if (!(await store.verify(obj))) return null;       // Law L5
    return { group: g, prompt: obj["lc:prompt"], type: obj["lc:type"], kappa: g.productionKappa };
  }

  async function setProduction(groupId, kappa) {
    const idx = await getIndex();
    const g = (idx.promptGroups || []).find((x) => x.groupId === groupId);
    if (g && g.versions.some((v) => v.kappa === kappa)) { g.productionKappa = kappa; await putIndex(idx); }
  }

  async function recordUse(groupId) {
    const idx = await getIndex();
    const g = (idx.promptGroups || []).find((x) => x.groupId === groupId);
    if (g) { g.numberOfGenerations = (g.numberOfGenerations || 0) + 1; await putIndex(idx); }
  }

  async function remove(groupId) {
    const idx = await getIndex();
    idx.promptGroups = (idx.promptGroups || []).filter((x) => x.groupId !== groupId);
    await putIndex(idx);
  }

  return { save, list, production, setProduction, recordUse, remove };
}
