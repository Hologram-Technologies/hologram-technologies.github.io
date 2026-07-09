// ui/settings.js — the Settings sheet: General (theme · accent · font size), Chat (enter-to-send ·
// receipts · markdown), Speech (dictation language · read-aloud + rate), Data (storage · export all ·
// import · delete all), About. Settings persist in the boot index (substrate-local, no account).

import { storageEstimate } from "../core/backend.js";
import { exportAll, importFile } from "./importexport.js";

export function makeSettingsStore(chatStore) {
  let cache = null;
  async function load() {
    if (cache) return cache;
    const idx = await chatStore.getIndex();
    cache = { enterSend: true, receipts: true, markdown: true, tts: true, ttsRate: 1, sttLang: "", palette: "auto", ...(idx.settings || {}) };
    return cache;
  }
  async function save(patch) {
    cache = { ...(await load()), ...patch };
    const idx = await chatStore.getIndex(); idx.settings = cache;
    const b = new TextEncoder().encode(JSON.stringify(idx));
    await (chatStore.store.backend.putRaw ? chatStore.store.backend.putRaw("index:org.hologram.HoloQ", b) : chatStore.store.backend.put("index:org.hologram.HoloQ", b));
  }
  return { load, save, get: (k) => (cache ? cache[k] : undefined) };
}

export function makeSettings({ ctx, els, t, toast, act }) {
  const { settings, chatStore, bus } = ctx;
  const TABS = [["general", t("com_settings_general")], ["chat", t("com_settings_chat")], ["speech", t("com_settings_speech")], ["data", t("com_settings_data")], ["about", t("com_settings_about")]];
  let tab = "general";

  async function open() {
    await settings.load();
    els.modals.hidden = false;
    render();
  }
  function close() { els.modals.hidden = true; els.modals.innerHTML = ""; }

  function render() {
    els.modals.innerHTML = `
      <div class="sheet" role="dialog" aria-label="${t("com_nav_settings")}">
        <div class="sheet-head"><h2>${t("com_nav_settings")}</h2><button class="x" aria-label="${t("com_ui_close")}">✕</button></div>
        <div class="sheet-body">
          <div class="sheet-tabs">${TABS.map(([id, l]) => `<button data-t="${id}" class="${id === tab ? "on" : ""}">${l}</button>`).join("")}</div>
          <div class="sheet-pane" id="setpane"></div>
        </div>
      </div>`;
    els.modals.querySelector(".x").onclick = close;
    els.modals.onclick = (e) => { if (e.target === els.modals) close(); };
    els.modals.querySelectorAll(".sheet-tabs button").forEach((b) => (b.onclick = () => { tab = b.dataset.t; render(); }));
    const pane = els.modals.querySelector("#setpane");
    if (tab === "general") renderGeneral(pane);
    else if (tab === "chat") renderChat(pane);
    else if (tab === "speech") renderSpeech(pane);
    else if (tab === "data") renderData(pane);
    else renderAbout(pane);
  }

  const row = (lab, sub, ctrl) => `<div class="set-row"><div><span class="lab">${lab}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</div>${ctrl}</div>`;
  const sw = (id, on) => `<button class="switch ${on ? "on" : ""}" id="${id}" role="switch" aria-checked="${on}"></button>`;
  const wireSwitch = (pane, id, key, after) => {
    const b = pane.querySelector("#" + id);
    b.onclick = async () => { const on = !b.classList.contains("on"); b.classList.toggle("on", on); await settings.save({ [key]: on }); after?.(on); };
  };

  function renderGeneral(pane) {
    const pal = settings.get("palette") || "auto";
    pane.innerHTML =
      row(t("com_settings_theme"), "", `<span class="seg" id="pal">${[["auto", t("com_settings_theme_auto")], ["dark", t("com_settings_theme_dark")], ["light", t("com_settings_theme_light")]].map(([v, l]) => `<button data-v="${v}" class="${v === pal ? "on" : ""}">${l}</button>`).join("")}</span>`) +
      row(t("com_settings_font_size"), "", `<span class="seg" id="fs">${[["0.9", "A−"], ["1", "A"], ["1.12", "A+"]].map(([v, l]) => `<button data-v="${v}">${l}</button>`).join("")}</span>`);
    pane.querySelectorAll("#pal button").forEach((b) => (b.onclick = async () => {
      pane.querySelectorAll("#pal button").forEach((x) => x.classList.toggle("on", x === b));
      await settings.save({ palette: b.dataset.v });
      document.documentElement.dataset.palette = b.dataset.v;
      try { window.HoloTheme?.setPalette?.(b.dataset.v); } catch {}
    }));
    pane.querySelectorAll("#fs button").forEach((b) => (b.onclick = () => { try { window.HoloTheme?.setFontScale?.(+b.dataset.v); } catch { document.documentElement.style.fontSize = (+b.dataset.v * 100) + "%"; } }));
  }

  function renderChat(pane) {
    pane.innerHTML =
      row(t("com_settings_enter_send"), "Shift+Enter inserts a newline. Ctrl+Enter always sends.", sw("s-enter", settings.get("enterSend") !== false)) +
      row(t("com_settings_show_receipts"), "Every answer carries a verifiable PROV-O receipt (Law L5).", sw("s-receipts", settings.get("receipts") === true)) +
      row(t("com_settings_markdown"), "", sw("s-md", settings.get("markdown") !== false));
    wireSwitch(pane, "s-enter", "enterSend");
    wireSwitch(pane, "s-receipts", "receipts", () => act.rerender());
    wireSwitch(pane, "s-md", "markdown", () => act.rerender());
  }

  function renderSpeech(pane) {
    pane.innerHTML =
      row(t("com_ui_speech_input"), t("com_settings_stt_note"), `<input id="s-lang" placeholder="${navigator.language}" value="${settings.get("sttLang") || ""}" style="background:var(--field);border:1px solid var(--field-b);border-radius:9px;color:var(--text);padding:7px 10px;width:130px" />`) +
      row(t("com_settings_tts_enable"), "", sw("s-tts", settings.get("tts") !== false)) +
      row(t("com_settings_tts_rate"), "", `<input type="range" id="s-rate" min="0.6" max="1.6" step="0.1" value="${settings.get("ttsRate") || 1}" style="width:140px;accent-color:var(--mint)" />`);
    pane.querySelector("#s-lang").onchange = (e) => settings.save({ sttLang: e.target.value.trim() });
    wireSwitch(pane, "s-tts", "tts", () => act.rerender());
    pane.querySelector("#s-rate").onchange = (e) => settings.save({ ttsRate: +e.target.value });
  }

  async function renderData(pane) {
    const { usage, quota } = await storageEstimate();
    const gb = (n) => (n / 1073741824).toFixed(2);
    const mems = ctx.memory ? await ctx.memory.list() : [];
    pane.innerHTML =
      row(t("com_settings_storage"), `${gb(usage)} GB of ${gb(quota)} GB used`, "") +
      `<div class="set-row" style="flex-direction:column;align-items:stretch"><div><span class="lab">${t("com_memory_title")}</span><span class="sub">${mems.length ? mems.reduce((n, m) => n + (m.tokenCount || 0), 0) + " / " + ctx.memory.tokenLimit + " tokens" : t("com_memory_none")}</span></div>
        <div id="d-mems" style="display:flex;flex-direction:column;gap:5px;margin-top:8px"></div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <input id="d-mkey" placeholder="${t("com_memory_key_ph")}" style="width:140px;background:var(--field);border:1px solid var(--field-b);border-radius:9px;color:var(--text);padding:7px 9px;font-size:var(--fs)" />
          <input id="d-mval" placeholder="${t("com_memory_value_ph")}" style="flex:1;min-width:0;background:var(--field);border:1px solid var(--field-b);border-radius:9px;color:var(--text);padding:7px 9px;font-size:var(--fs)" />
          <button class="btn" id="d-madd">${t("com_memory_add")}</button>
        </div></div>` +
      row(t("com_settings_export_all"), "Conversations + presets, as verifiable JSON.", `<button class="btn" id="d-exp">${t("com_ui_export")}</button>`) +
      row(t("com_settings_import_file"), "", `<button class="btn" id="d-imp">${t("com_ui_import")}</button>`) +
      row(t("com_settings_clear"), "", `<button class="btn" id="d-clear" style="color:var(--bad)">${t("com_ui_delete")}</button>`);
    const memsEl = pane.querySelector("#d-mems");
    for (const m of mems) {
      const r2 = document.createElement("div");
      r2.style.cssText = "display:flex;align-items:center;gap:8px;font-size:var(--fs)";
      r2.innerHTML = `<b style="font-family:var(--mono);flex:none">${m.key}</b><span style="flex:1;min-width:0;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span><button class="iact" style="width:24px;height:24px">✕</button>`;
      r2.querySelector("span").textContent = m.value;
      r2.querySelector("button").onclick = async () => { await ctx.memory.remove(m.key); renderData(pane); };
      memsEl.appendChild(r2);
    }
    pane.querySelector("#d-madd").onclick = async () => {
      const r3 = await ctx.memory.set(pane.querySelector("#d-mkey").value, pane.querySelector("#d-mval").value);
      if (!r3.ok) toast(r3.error); else renderData(pane);
    };
    pane.querySelector("#d-exp").onclick = () => exportAll(ctx);
    pane.querySelector("#d-imp").onclick = async () => { const n = await importFile(ctx); if (n >= 0) { toast(`${t("com_ui_import")} ✓ ${n}`); bus.emit("conversations-changed"); } };
    pane.querySelector("#d-clear").onclick = async () => {
      if (!confirm(t("com_settings_clear_confirm"))) return;
      await new Promise((res) => { const rq = indexedDB.deleteDatabase("holo-q"); rq.onsuccess = rq.onerror = rq.onblocked = res; });
      location.reload();
    };
  }

  function renderAbout(pane) {
    pane.innerHTML = `<p style="line-height:1.65;color:var(--muted)">${t("com_settings_about_text")}</p>
      <div class="pcard"><div class="plab">app</div><div class="kv">org.hologram.HoloQ · LibreChat-parity spine · UOR substrate-native</div></div>`;
  }

  return { open, close };
}
