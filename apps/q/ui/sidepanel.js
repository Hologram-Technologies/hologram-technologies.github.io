// ui/sidepanel.js — the right panel: Parameters (the active preset, LibreChat's parameter
// panel semantics wired to what the engine REALLY honors), Model (the verified κ-object +
// dims), Activity (live tok/s · first-token · GPU resident · receipts). Honest controls only:
// greedy decode is the deterministic, verifiable path, so temperature is shown but fixed at 0.

import { makeAgentTab, makeArtifactsTab } from "./power-panels.js";

export function makeSidePanel({ ctx, els, t, toast }) {
  const { state, bus } = ctx;
  const TABS = [["params", t("com_panel_params")], ["agent", t("com_panel_agent")], ["tools", t("com_panel_tools")], ["artifacts", t("com_panel_artifacts")], ["activity", t("com_panel_activity")]];
  const agentTab = makeAgentTab({ ctx, els, t, toast });
  const artifactsTab = makeArtifactsTab({ ctx, els, t });
  ctx.artifactsTab = artifactsTab;   // chat ingests parsed artifacts through this
  bus.on("artifacts-changed", () => { state.panelTab = "artifacts"; document.body.classList.add("panel-open"); render(); });
  let stats = { tokps: 0, ttft: 0 };
  let receiptsCount = 0;

  els.paneltabs.innerHTML = TABS.map(([id, label]) => `<button data-tab="${id}">${label}</button>`).join("");
  els.paneltabs.querySelectorAll("button").forEach((b) => (b.onclick = () => { state.panelTab = b.dataset.tab; render(); }));

  bus.on("genstats", (s) => { stats = s; if (state.panelTab === "activity" && document.body.classList.contains("panel-open")) renderActivity(); });
  bus.on("receipt-sealed", () => { receiptsCount++; });
  bus.on("preset-changed", () => { if (state.panelTab === "params") render(); });
  bus.on("engine-ready", render);
  bus.on("mcp-changed", () => { if (state.panelTab === "tools") render(); bus.emit("tools-badge"); });

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

  function render() {
    els.paneltabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.panelTab));
    if (state.panelTab === "params") renderParams();
    else if (state.panelTab === "agent") agentTab.render();
    else if (state.panelTab === "tools") renderTools();
    else if (state.panelTab === "artifacts") artifactsTab.render();
    else renderActivity();
  }

  // ── Tools: the MCP universe — substrate roster · your servers · the public registry ──
  async function renderTools() {
    const hub = ctx.mcpHub;
    const list = hub.list();
    const enabled = hub.enabledTools().length;
    els.panelbody.innerHTML = `
      <div class="pcard">
        <div class="plab">${t("com_mcp_servers")} <span class="v">${enabled} ${t("com_mcp_tools_live")}</span></div>
        <div id="mcp-list" style="display:flex;flex-direction:column;gap:7px"></div>
        <div style="display:flex;gap:6px;margin-top:9px">
          <input id="mcp-url" placeholder="${t("com_mcp_add_ph")}" style="flex:1;min-width:0;background:var(--bg);border:1px solid var(--field-b);border-radius:9px;color:var(--text);padding:7px 9px;font-size:var(--fs)" />
          <button class="btn" id="mcp-add">${t("com_mcp_add")}</button>
        </div>
        <div class="note">${t("com_mcp_note")}</div>
      </div>
      <div class="pcard">
        <div class="plab">${t("com_mcp_substrate")}</div>
        <div id="mcp-substrate" class="note">…</div>
      </div>
      <div class="pcard">
        <div class="plab">${t("com_mcp_registry")}</div>
        <div style="display:flex;gap:6px">
          <input id="mcp-q" placeholder="${t("com_mcp_search_ph")}" style="flex:1;min-width:0;background:var(--bg);border:1px solid var(--field-b);border-radius:9px;color:var(--text);padding:7px 9px;font-size:var(--fs)" />
          <button class="btn" id="mcp-search">⌕</button>
        </div>
        <div id="mcp-results" style="display:flex;flex-direction:column;gap:6px;margin-top:8px"></div>
      </div>`;
    const q = (id) => els.panelbody.querySelector("#" + id);

    // connected/saved servers
    const listEl = q("mcp-list");
    if (!list.length) listEl.innerHTML = `<span class="note">${t("com_mcp_none")}</span>`;
    for (const s of list) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px";
      const dot = s.status === "connected" ? "var(--mint)" : s.status === "error" ? "var(--bad)" : "var(--faint)";
      row.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:${dot};flex:none"></span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.url)}">${esc(s.name)} <span style="color:var(--faint);font-size:var(--fs)">· ${s.tools.length || 0} tools${s.error ? " · " + esc(s.error.slice(0, 40)) : ""}</span></span>
        <button class="switch ${s.enabled ? "on" : ""}" data-a="toggle"></button>
        <button class="iact" data-a="rm" title="${t("com_ui_delete")}" style="width:24px;height:24px">✕</button>`;
      row.querySelector('[data-a="toggle"]').onclick = () => hub.setEnabled(s.id, !s.enabled);
      row.querySelector('[data-a="rm"]').onclick = () => hub.remove(s.id);
      listEl.appendChild(row);
    }

    q("mcp-add").onclick = async () => { const u = q("mcp-url").value.trim(); if (!u) return; q("mcp-add").disabled = true; await hub.add({ url: u }); };
    q("mcp-url").onkeydown = (e) => { if (e.key === "Enter") q("mcp-add").click(); };

    // substrate ring
    hub.discoverSubstrateServers().then(({ entries, candidates }) => {
      const el = q("mcp-substrate"); if (!el) return;
      const toolCount = entries.reduce((n, e) => n + (Array.isArray(e.tools) ? e.tools.length : 0), 0);
      el.innerHTML = entries.length
        ? `${t("com_mcp_substrate_found", { n: String(toolCount || entries.length) })}<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:6px">` +
          candidates.map((c) => `<button class="btn" data-u="${esc(c)}" style="font-size:var(--fs)">${t("com_mcp_connect")} ${esc(c.replace(location.origin, ""))}</button>`).join("") + `</div>`
        : t("com_mcp_substrate_none");
      el.querySelectorAll("button[data-u]").forEach((b) => (b.onclick = () => hub.add({ url: b.dataset.u, name: "hologram", source: "substrate" })));
    }).catch(() => {});

    // registry ring
    const doSearch = async () => {
      const el = q("mcp-results"); el.innerHTML = `<span class="note">…</span>`;
      try {
        const found = await hub.searchRegistry(q("mcp-q").value.trim());
        el.innerHTML = "";
        if (!found.length) { el.innerHTML = `<span class="note">${t("com_nav_no_results")}</span>`; return; }
        for (const r of found.slice(0, 12)) {
          const row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:center;gap:8px";
          row.innerHTML = `<span style="flex:1;min-width:0"><b style="font-size:var(--fs)">${esc(r.name)}</b><br><span style="color:var(--faint);font-size:var(--fs)">${esc((r.description || "").slice(0, 70))}</span></span>` +
            (r.url ? `<button class="btn" style="font-size:var(--fs)">${t("com_mcp_connect")}</button>` : `<span class="note" style="flex:none">${esc(r.transport)}</span>`);
          if (r.url) row.querySelector("button").onclick = () => hub.add({ url: r.url, name: r.name, source: "registry" });
          el.appendChild(row);
        }
      } catch (e) { el.innerHTML = `<span class="note">registry: ${esc(String(e.message || e))}</span>`; }
    };
    q("mcp-search").onclick = doSearch;
    q("mcp-q").onkeydown = (e) => { if (e.key === "Enter") doSearch(); };
  }

  function renderParams() {
    const p = state.preset || (state.preset = { title: "Default", temperature: 0, maxOutputTokens: state.engine?.model.cap || 900, promptPrefix: "", repetitionPenalty: state.engine?.model.rep ?? 1.05 });
    els.panelbody.innerHTML = `
      <div class="pcard">
        <div class="plab">${t("com_panel_prompt_prefix")}</div>
        <textarea id="pp-prefix" placeholder="${t("com_panel_prompt_prefix_ph")}">${esc(p.promptPrefix || "")}</textarea>
        <div class="note">Rides the first turn of the conversation.</div>
      </div>
      <div class="pcard">
        <div class="plab">${t("com_panel_temp")} <span class="v">${(+p.temperature || 0).toFixed(2)}</span></div>
        <input type="range" id="pp-temp" min="0" max="2" step="0.05" value="${+p.temperature || 0}" disabled />
        <div class="note">${t("com_panel_temp_note")}</div>
      </div>
      <div class="pcard">
        <div class="plab">${t("com_panel_max_tokens")} <span class="v" id="pp-max-v">${p.maxOutputTokens || 900}</span></div>
        <input type="range" id="pp-max" min="64" max="2048" step="32" value="${p.maxOutputTokens || 900}" />
      </div>
      <div class="pcard">
        <div class="plab">${t("com_panel_rep_penalty")} <span class="v" id="pp-rep-v">${(p.repetitionPenalty ?? 1.05).toFixed(2)}</span></div>
        <input type="range" id="pp-rep" min="1" max="1.5" step="0.01" value="${p.repetitionPenalty ?? 1.05}" />
      </div>
      <div class="pcard">
        <div class="plab">${t("com_panel_presets")}</div>
        <div id="pp-list" style="display:flex;flex-direction:column;gap:4px"></div>
        <div style="display:flex;gap:8px;margin-top:9px">
          <button class="btn" id="pp-save">${t("com_panel_save_preset")}</button>
        </div>
      </div>`;
    const q = (id) => els.panelbody.querySelector("#" + id);
    q("pp-prefix").onchange = (e) => { p.promptPrefix = e.target.value; commit(); };
    q("pp-max").oninput = (e) => { q("pp-max-v").textContent = e.target.value; };
    q("pp-max").onchange = (e) => { p.maxOutputTokens = +e.target.value; if (state.engine) state.engine.model.cap = +e.target.value; commit(); };
    q("pp-rep").oninput = (e) => { q("pp-rep-v").textContent = (+e.target.value).toFixed(2); };
    q("pp-rep").onchange = (e) => { p.repetitionPenalty = +e.target.value; if (state.engine) state.engine.model.rep = +e.target.value; commit(); };
    q("pp-save").onclick = async () => {
      const title = prompt(t("com_panel_save_preset"), p.title || "My preset"); if (!title) return;
      await ctx.presets.save({ ...p, title, presetId: null });
      renderPresetList();
    };
    renderPresetList();
    async function renderPresetList() {
      const ptrs = await ctx.presets.list();
      q("pp-list").innerHTML = ptrs.length ? "" : `<span class="note">—</span>`;
      for (const ptr of ptrs) {
        const b = document.createElement("button"); b.className = "btn"; b.style.textAlign = "left";
        b.textContent = ptr.title + (ptr.defaultPreset ? " · " + t("com_panel_default") : "");
        b.onclick = async () => { const full = await ctx.presets.get(ptr.presetId); if (full) { state.preset = full; bus.emit("preset-changed"); } };
        q("pp-list").appendChild(b);
      }
    }
    function commit() { bus.emit("preset-dirty"); }
  }

  function renderModel() {
    const e = state.engine;
    const m = e?.model, d = e?.dims;
    els.panelbody.innerHTML = e ? `
      <div class="pcard">
        <div class="plab">${esc(m.name)}</div>
        <div class="note">${esc(m.size)} · ${esc(m.fmt)} · ${t("com_panel_verified_model")}</div>
      </div>
      <div class="pcard"><div class="plab">model κ</div><div class="kv">${esc(e.modelKappa)}</div></div>
      <div class="pcard"><div class="plab">dims</div>
        <div class="note" style="font-family:var(--mono)">d=${d?.d} · layers=${d?.n_layers} · heads=${d?.n_heads}/${d?.n_kv_heads} · ff=${d?.ff} · vocab=${d?.vocab} · ${d?.bits}-bit</div>
      </div>
      <div class="pcard"><div class="plab">${t("com_panel_gpu")}</div><div class="stat">${(e.gpuBytes / 1e6).toFixed(0)} <small>MB</small></div></div>`
      : `<div class="pcard"><div class="note">${t("com_ui_model_loading")}</div></div>`;
  }

  function renderActivity() {
    const e = state.engine, d = e?.dims;
    els.panelbody.innerHTML = `
      <div class="pgrid">
        <div class="pcard"><div class="plab">${t("com_panel_tokps")}</div><div class="stat">${(stats.tokps || 0).toFixed(1)}</div></div>
        <div class="pcard"><div class="plab">${t("com_panel_ttft")}</div><div class="stat">${stats.ttft ? (stats.ttft / 1000).toFixed(2) : "—"} <small>s</small></div></div>
        <div class="pcard"><div class="plab">${t("com_panel_gpu")}</div><div class="stat">${e ? (e.gpuBytes / 1e6).toFixed(0) : 0} <small>MB</small></div></div>
        <div class="pcard"><div class="plab">${t("com_panel_receipts")}</div><div class="stat">${receiptsCount}</div></div>
      </div>
      ${e ? `<div class="pcard"><div class="plab">${esc(e.model.name)} · ${t("com_panel_verified_model")}</div>
        <div class="note" style="font-family:var(--mono)">d=${d?.d} · layers=${d?.n_layers} · heads=${d?.n_heads}/${d?.n_kv_heads} · vocab=${d?.vocab} · ${d?.bits}-bit</div>
        <div class="kv" style="margin-top:6px">${esc(e.modelKappa)}</div></div>` : ""}
      <div class="pcard"><div class="plab">conscience</div>
        <div class="note">${state.gateOk ? "Constitution ✓ — self-verified, every answer judged (fail-closed)." : "unsealed — running outside the OS frame; answers marked unverified."}</div>
      </div>`;
  }

  render();
  return { render };
}
