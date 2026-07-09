// ui/power-panels.js — the Agent builder tab and the Artifacts viewer tab of the side panel.
// Agents: list · build/edit (name · description · instructions · starters · model · armed tools)
// · activate. Artifacts: per-identifier versions with Preview/Code tabs, κ-sealed, downloadable.

import { renderArtifact } from "../render/artifacts.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── AGENTS ────────────────────────────────────────────────────────────────────────────────
export function makeAgentTab({ ctx, els, t, toast }) {
  const { state, bus } = ctx;
  let editing = null;   // the agent draft being edited, or null = list view

  async function render() {
    if (editing) return renderBuilder();
    const ptrs = await ctx.agents.list();
    els.panelbody.innerHTML = `
      <div class="pcard">
        <div class="plab">${t("com_agents_title")} ${state.agentId ? `<span class="v">${t("com_agents_active")}</span>` : ""}</div>
        <div id="ag-list" style="display:flex;flex-direction:column;gap:6px"></div>
        <div style="display:flex;gap:8px;margin-top:9px">
          <button class="btn primary" id="ag-new">${t("com_agents_new")}</button>
          ${state.agentId ? `<button class="btn" id="ag-off">${t("com_agents_deactivate")}</button>` : ""}
        </div>
      </div>`;
    const listEl = els.panelbody.querySelector("#ag-list");
    if (!ptrs.length) listEl.innerHTML = `<span class="note">${t("com_agents_none")}</span>`;
    for (const p of ptrs) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px";
      const on = state.agentId === p.id;
      row.innerHTML = `<span style="flex:none;width:26px;height:26px;border-radius:8px;background:var(--bubble);display:grid;place-items:center">${esc(typeof p.avatar === "string" ? p.avatar : "🤖")}</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${on ? "color:var(--mint);font-weight:600" : ""}">${esc(p.name)}</span>
        <button class="btn" data-a="use" style="font-size:var(--fs)">${on ? "✓" : t("com_agents_use")}</button>
        <button class="iact" data-a="edit" style="width:26px;height:26px">✎</button>`;
      row.querySelector('[data-a="use"]').onclick = async () => { await activate(p.id); render(); };
      row.querySelector('[data-a="edit"]').onclick = async () => { editing = await ctx.agents.get(p.id); render(); };
      listEl.appendChild(row);
    }
    els.panelbody.querySelector("#ag-new").onclick = () => { editing = ctx.agents.normAgent({}); render(); };
    const off = els.panelbody.querySelector("#ag-off");
    if (off) off.onclick = () => { state.agentId = null; state.agent = null; bus.emit("agent-changed"); render(); };
  }

  async function activate(id) {
    const a = await ctx.agents.get(id);
    if (!a) { toast(t("com_ui_integrity_refused")); return; }
    state.agentId = id; state.agent = a;
    bus.emit("agent-changed");
    toast(a.name + " · " + t("com_agents_active"));
  }

  function renderBuilder() {
    const a = editing;
    const field = (id, label, val, ta) => `<div class="pcard"><div class="plab">${label}</div>${ta ? `<textarea id="${id}" style="min-height:${ta}px">${esc(val)}</textarea>` : `<input id="${id}" value="${esc(val)}" style="width:100%;background:var(--bg);border:1px solid var(--field-b);border-radius:9px;color:var(--text);padding:8px 10px;font-size:max(16px,14px)" />`}</div>`;
    els.panelbody.innerHTML =
      field("ab-name", t("com_agents_name"), a.name) +
      field("ab-desc", t("com_agents_desc"), a.description) +
      field("ab-inst", t("com_agents_inst"), a.instructions, 110) +
      field("ab-starters", t("com_agents_starters"), (a.conversation_starters || []).join("\n"), 70) +
      `<div class="pcard"><div class="plab">${t("com_agents_tools")}</div><div id="ab-tools" style="display:flex;flex-direction:column;gap:5px"></div><div class="note">${t("com_agents_tools_note")}</div></div>` +
      `<div style="display:flex;gap:8px"><button class="btn" id="ab-cancel">${t("com_ui_cancel")}</button><button class="btn primary" id="ab-save" style="flex:1">${t("com_ui_save")}</button>${a.id ? `<button class="btn" id="ab-del" style="color:var(--bad)">${t("com_ui_delete")}</button>` : ""}</div>`;
    // armed-tool checkboxes from the live hub
    const toolsEl = els.panelbody.querySelector("#ab-tools");
    const all = (ctx.mcpHub ? ctx.mcpHub.list().flatMap((s) => s.tools.map((x) => x.name)) : []).slice(0, 40);
    if (!all.length) toolsEl.innerHTML = `<span class="note">${t("com_mcp_none")}</span>`;
    for (const name of all) {
      const lab = document.createElement("label");
      lab.style.cssText = "display:flex;align-items:center;gap:8px;font-size:var(--fs);cursor:pointer";
      lab.innerHTML = `<input type="checkbox" ${a.tools.includes(name) ? "checked" : ""} style="accent-color:var(--mint)" /> <span>${esc(name)}</span>`;
      lab.querySelector("input").onchange = (e) => { if (e.target.checked) { if (!a.tools.includes(name)) a.tools.push(name); } else a.tools = a.tools.filter((x) => x !== name); };
      toolsEl.appendChild(lab);
    }
    const q = (id) => els.panelbody.querySelector("#" + id);
    q("ab-cancel").onclick = () => { editing = null; render(); };
    q("ab-save").onclick = async () => {
      a.name = q("ab-name").value.trim() || "Agent";
      a.description = q("ab-desc").value.trim();
      a.instructions = q("ab-inst").value;
      a.conversation_starters = q("ab-starters").value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 4);
      a.model = ctx.state.engine ? ctx.state.engine.model.name : a.model;
      const saved = await ctx.agents.save(a);
      editing = null;
      await activate(saved.id);
      render();
    };
    const del = q("ab-del");
    if (del) del.onclick = async () => { await ctx.agents.remove(a.id); if (state.agentId === a.id) { state.agentId = null; state.agent = null; bus.emit("agent-changed"); } editing = null; render(); };
  }

  return { render };
}

// ── ARTIFACTS ─────────────────────────────────────────────────────────────────────────────
// state.artifacts: Map identifier → { identifier, type, title, versions: [{content, kappa, at}], current }
export function makeArtifactsTab({ ctx, els, t }) {
  const { state, bus } = ctx;

  async function render() {
    const arts = [...(state.artifacts || new Map()).values()];
    if (!arts.length) { els.panelbody.innerHTML = `<div class="pcard"><div class="note">${t("com_artifacts_none")}</div></div>`; return; }
    const active = state.artifactOpen && state.artifacts.get(state.artifactOpen) || arts[arts.length - 1];
    els.panelbody.innerHTML = `
      <div class="pcard" style="padding:9px">
        <select id="art-pick" style="width:100%;background:var(--bg);border:1px solid var(--field-b);border-radius:9px;color:var(--text);padding:7px 9px">${arts.map((a) => `<option value="${esc(a.identifier)}" ${a === active ? "selected" : ""}>${esc(a.title)} · ${esc(a.type)}</option>`).join("")}</select>
      </div>
      <div class="pcard" style="flex:1;display:flex;flex-direction:column;min-height:340px;padding:0;overflow:hidden">
        <div style="display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--border-soft)">
          <span class="seg"><button id="art-prev-tab" class="on">${t("com_artifacts_preview")}</button><button id="art-code-tab">${t("com_artifacts_code")}</button></span>
          <span style="flex:1"></span>
          ${active.versions.length > 1 ? `<span class="sib"><button id="art-vprev">‹</button><span>${active.current + 1}/${active.versions.length}</span><button id="art-vnext">›</button></span>` : ""}
          <button class="iact" id="art-dl" title="${t("com_ui_export")}" style="width:26px;height:26px">⇩</button>
        </div>
        <div id="art-host" style="flex:1;min-height:280px"></div>
        <div style="padding:6px 10px;border-top:1px solid var(--border-soft)" class="note kv">${esc((active.versions[active.current] || {}).kappa || "")}</div>
      </div>`;
    const q = (id) => els.panelbody.querySelector("#" + id);
    const host = q("art-host");
    const ver = active.versions[active.current];
    let tab = "preview";
    const paint = async () => {
      if (tab === "preview") await renderArtifact(host, { ...active, content: ver.content });
      else { const { renderMarkdown } = await import("../render/markdown.js"); host.innerHTML = ""; const d = document.createElement("div"); d.style.cssText = "padding:10px;overflow:auto;height:100%"; await renderMarkdown(d, "```" + (active.type.includes("html") ? "html" : active.type.includes("svg") ? "xml" : "txt") + "\n" + ver.content + "\n```"); host.appendChild(d); }
      q("art-prev-tab").classList.toggle("on", tab === "preview");
      q("art-code-tab").classList.toggle("on", tab === "code");
    };
    q("art-pick").onchange = (e) => { state.artifactOpen = e.target.value; render(); };
    q("art-prev-tab").onclick = () => { tab = "preview"; paint(); };
    q("art-code-tab").onclick = () => { tab = "code"; paint(); };
    if (active.versions.length > 1) {
      q("art-vprev").onclick = () => { active.current = (active.current - 1 + active.versions.length) % active.versions.length; render(); };
      q("art-vnext").onclick = () => { active.current = (active.current + 1) % active.versions.length; render(); };
    }
    q("art-dl").onclick = () => {
      const ext = active.type.includes("html") ? ".html" : active.type.includes("svg") ? ".svg" : active.type.includes("mermaid") ? ".mmd" : ".md";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([ver.content], { type: "text/plain" }));
      a.download = active.identifier + ext; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    };
    await paint();
  }

  // ingest artifacts parsed from a finished turn: seal each version as a κ-object
  async function ingest(parsed) {
    if (!parsed.length) return;
    state.artifacts = state.artifacts || new Map();
    for (const p of parsed) {
      const obj = await ctx.chatStore.store.makeObject({
        type: ["schema:CreativeWork", "prov:Entity"], context: [{ lc: "https://librechat.ai/ns#" }],
        "schema:identifier": p.identifier, "schema:name": p.title, "schema:encodingFormat": p.type, "schema:text": p.content,
        "schema:dateCreated": new Date().toISOString(),
      });
      let slot = state.artifacts.get(p.identifier);
      if (!slot) { slot = { ...p, versions: [], current: 0 }; state.artifacts.set(p.identifier, slot); }
      slot.title = p.title; slot.type = p.type;
      slot.versions.push({ content: p.content, kappa: obj.id, at: Date.now() });
      slot.current = slot.versions.length - 1;
      state.artifactOpen = p.identifier;
    }
    bus.emit("artifacts-changed");
  }

  return { render, ingest };
}
