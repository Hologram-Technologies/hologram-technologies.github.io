// ui/boot.js — the app's orchestrator: theme → conscience → κ-store → engine → shell →
// feature modules → restore. One import graph, no build step, everything substrate-local.

import { makeBus, makeState } from "../core/state.js";
import { kappaBackend } from "../core/backend.js";
import { makeChatStore } from "../core/store.js";
import { makePresets } from "../core/presets.js";
import { makeMcpHub } from "../core/mcphub.js";
import { makeAgents } from "../core/agents.js";
import { makePromptsLib } from "../core/promptsLib.js";
import { makeMemory } from "../core/memory.js";
import { installKeymap } from "../core/keymap.js";
import * as loader from "../core/loader.js";
import { createEngine } from "../core/engine.js";
import strings, { makeT } from "../locales/en.js";
import { initMarkdown } from "../render/markdown.js";
import { mountShell, SVG } from "./shell.js";
import { makeMessagesView } from "./messages.js";
import { makeChat } from "./chat.js";
import { codeTools } from "../core/code-tools.js";
import { skillTools, skillsDiscoveryPrompt } from "../core/skills.js";
import { makeComposer } from "./composer.js";
import { makeSidebar } from "./sidebar.js";
import { makeSidePanel } from "./sidepanel.js";
import { makeSettings, makeSettingsStore } from "./settings.js";
import { exportConversation } from "./importexport.js";

const t = makeT(strings);

(async function boot() {
  try {
    await bootInner();
  } catch (e) {
    console.error("[holo-q boot]", e);
    const s = document.getElementById("status") || document.body.appendChild(document.createElement("div"));
    s.textContent = "boot error: " + (e && e.message || e);
  }
})();

async function bootInner() {
  // ── substrate context ─────────────────────────────────────────────────────
  const bus = makeBus();
  const state = makeState();
  const backend = kappaBackend();
  const chatStore = makeChatStore(backend);
  const presets = makePresets(chatStore);
  const settings = makeSettingsStore(chatStore);
  await settings.load();
  document.documentElement.dataset.palette = settings.get("palette") || "auto";

  // conscience (ADR-033): fail-soft for ABSENCE (outside the OS frame), fail-closed when present.
  let evaluateText = () => ({ outcome: "unverified" });
  let gateOk = false;
  try {
    const c = await import("../_shared/holo-conscience.js");
    evaluateText = c.evaluateText;
    try { const r = await c.verifyConstitution(); gateOk = !!(r && r.ok); } catch {}
  } catch {}
  state.gateOk = gateOk;

  const mcpHub = makeMcpHub({ chatStore, bus });
  const agents = makeAgents(chatStore);
  const promptsLib = makePromptsLib(chatStore);
  const memory = makeMemory(chatStore);
  const ctx = { bus, state, chatStore, presets, settings, loader, evaluateText, mcpHub, agents, promptsLib, memory, codeTools, skillTools, skillsDiscoveryPrompt };
  mcpHub.restore().then(() => {   // reconnect enabled servers in the background (non-blocking)
    for (const s of mcpHub.list()) if (s.enabled) mcpHub.connect(s.id).catch(() => {});
  });

  // ── shell + features ──────────────────────────────────────────────────────
  const root = document.getElementById("app");
  const { els, setNav, setPanel, toast } = mountShell(root, { t });
  // the panel restores the user's saved layout choice — but only as a rail (wide screens);
  // a bottom sheet must never open by itself over the landing
  state.panelOpen = settings.get("panelOpen") === true && window.innerWidth > 1100;
  setNav(state.navOpen); setPanel(state.panelOpen);

  // `view` renders; its actions late-bind to `chat` (created right after) through a proxy.
  const view = makeMessagesView({ els, t, act: lateAct(), settings });
  const chat = makeChat({ ctx, view, els, t, toast });
  const composer = makeComposer({ ctx, els, t, act: chat, toast });
  makeSidebar({ ctx, els, t, act: chat, toast });
  const panel = makeSidePanel({ ctx, els, t });
  const settingsSheet = makeSettings({ ctx, els, t, toast, act: chat });

  function lateAct() { return new Proxy({}, { get: (_, k) => (...a) => chat?.[k]?.(...a) }); }

  // header + sidebar wiring
  els.navtoggle.onclick = () => setNav(document.body.classList.contains("nav-closed"));
  els.paneltoggle.onclick = () => { const open = !document.body.classList.contains("panel-open"); setPanel(open); settings.save({ panelOpen: open }); panel.render(); };   // layout choice persists (LibreChat semantics)
  els.newchat.onclick = () => chat.newConversation();
  els.navcustomize.onclick = () => settingsSheet.open();
  els.navartifacts.onclick = () => { state.panelTab = "artifacts"; setPanel(true); panel.render(); };
  els.navlibrary.onclick = () => { els.user.value = "/"; els.user.focus(); els.user.dispatchEvent(new Event("input")); };   // the prompt library lives behind `/`
  bus.on("close-nav", () => setNav(false));
  // ── the neural-computer flagship: an agent-built app renders LIVE in-tab, its κ re-derives ──
  bus.on("app-preview", (r) => {
    try {
      const body = document.getElementById("panelbody"); if (!body) return;
      state.panelTab = "preview"; setPanel(true);
      const blob = new Blob([r.html], { type: "text/html" }), url = URL.createObjectURL(blob);
      body.innerHTML = "";
      const bar = document.createElement("div"); bar.style.cssText = "font:11px ui-monospace,monospace;color:var(--faint);padding:8px 12px;display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--line)";
      bar.innerHTML = `<b style="color:var(--accent)">${r.path}</b> · sealed · <span title="${r.kappa}">${r.kappa.slice(0, 30)}…</span>`;
      const vb = document.createElement("button"); vb.textContent = "verify ⟳"; vb.style.cssText = "cursor:pointer;border:1px solid var(--line);border-radius:5px;padding:1px 8px;background:none;color:var(--accent);font:inherit";
      vb.onclick = async () => { const k = "did:holo:sha256:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(r.html)))].map((b) => b.toString(16).padStart(2, "0")).join(""); vb.textContent = (k === r.kappa) ? "✓ every byte re-derives" : "✗ mismatch"; vb.style.color = (k === r.kappa) ? "#0c0" : "#c00"; };
      bar.appendChild(vb);
      const frame = document.createElement("iframe"); frame.src = url; frame.style.cssText = "width:100%;height:calc(100% - 38px);border:0;background:#fff";
      body.appendChild(bar); body.appendChild(frame);
    } catch {}
  });

  // ── MODES — one mind, three ways in. Chat answers · Cowork does (tools) · Code builds
  //    (artifacts). The switch reframes the landing + arms the right capability; the engine,
  //    store and receipts are the same underneath. Persisted like any other setting. ──
  state.mode = settings.get("mode") || "chat";
  const MODE_CHIPS = {
    chat: [
      { ic: SVG.edit, label: t("com_chip_write"), fill: "Write a short piece about " },
      { ic: SVG.book, label: t("com_chip_learn"), fill: "Explain, with one simple example: " },
      { ic: SVG.codeMode, label: t("com_chip_code"), fill: "Write a small function that " },
      { ic: SVG.ok, label: t("com_chip_prove"), fill: "Answer briefly, then explain how I can verify this answer's receipt: " },
    ],
    cowork: [
      { ic: SVG.search, label: t("com_chip_search"), fill: "Search the web for " },
      { ic: SVG.box, label: t("com_chip_resolve"), fill: "Resolve and verify this identifier: " },
      { ic: SVG.book, label: t("com_chip_summarize"), fill: "Summarize the key points of: " },
    ],
    code: [
      { ic: SVG.codeMode, label: t("com_chip_page"), fill: "Build a small HTML page that " },
      { ic: SVG.fork, label: t("com_chip_diagram"), fill: "Draw a mermaid diagram of " },
      { ic: SVG.spark, label: t("com_chip_svg"), fill: "Draw an SVG of " },
    ],
  };
  function applyMode() {
    els.modeswitch.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.mode === state.mode));
    els.user.placeholder = t("com_ph_" + state.mode);
    const h = new Date().getHours();
    els.greettext.textContent = t(h < 12 ? "com_greet_morning" : h < 18 ? "com_greet_afternoon" : "com_greet_evening");
    els.greettag.textContent = t("com_tag_" + state.mode);
    // chips: the active agent's starters win; otherwise the mode's suggestions (click = fill, not send)
    els.chips.innerHTML = "";
    const starters = (state.agent && state.agent.conversation_starters) || [];
    if (starters.length) {
      for (const s of starters) { const b = document.createElement("button"); b.textContent = s; b.onclick = () => chat.send(s); els.chips.appendChild(b); }
    } else {
      for (const c of MODE_CHIPS[state.mode] || []) {
        const b = document.createElement("button"); b.innerHTML = `<span class="ci">${c.ic}</span>${c.label}`;
        b.onclick = () => { els.user.value = c.fill; els.user.focus(); els.user.setSelectionRange(c.fill.length, c.fill.length); els.user.dispatchEvent(new Event("input")); };
        els.chips.appendChild(b);
      }
    }
    if (state.mode === "code") state.panelTab = "artifacts";   // building? the artifacts viewer is the natural co-pane
  }
  els.modeswitch.querySelectorAll("button").forEach((b) => (b.onclick = () => {
    state.mode = b.dataset.mode;
    applyMode(); bus.emit("mode-changed");          // instant — persistence follows
    settings.save({ mode: state.mode });
  }));
  applyMode();

  // first run: seed three starter prompts so `/`, `+` and Library are alive from minute one
  // (each shows a different power: variables, option dropdowns, plain commands)
  promptsLib.list().then(async (groups) => {
    if (groups.length || (await chatStore.getIndex()).promptsSeeded) return;
    await promptsLib.save({ name: "Summarize", command: "summarize", oneliner: "Boil a text down to its essence", type: "text",
      prompt: "Summarize the following as {{form:3 bullets|one paragraph|one line}}:\n\n{{text}}" });
    await promptsLib.save({ name: "Explain", command: "explain", oneliner: "A clear explanation with one example", type: "text",
      prompt: "Explain {{topic}} to a {{level:beginner|expert}}. End with one concrete example." });
    await promptsLib.save({ name: "Improve", command: "improve", oneliner: "Tighten any text, same meaning", type: "text",
      prompt: "Rewrite this to be clearer and tighter. Keep the meaning. Return only the result:\n\n{{text}}" });
    const idx = await chatStore.getIndex(); idx.promptsSeeded = true;
    const b = new TextEncoder().encode(JSON.stringify(idx));
    await (chatStore.store.backend.putRaw ? chatStore.store.backend.putRaw("index:org.hologram.HoloQ", b) : chatStore.store.backend.put("index:org.hologram.HoloQ", b));
  }).catch(() => {});
  bus.on("agent-changed", applyMode);
  bus.on("conversation-opened", applyMode);

  // share: the conversation's verifiable JSON to the native share sheet / clipboard
  els.sharebtn.onclick = async () => {
    exportConversation(ctx, chat, "json");
    toast(t("com_ui_export") + " ✓");
  };
  bus.on("conversation-opened", () => { els.sharebtn.disabled = false; });

  // model menu
  function renderModelMenu() {
    els.modelmenu.innerHTML = "";
    loader.MODELS.forEach((m, i) => {
      const row = document.createElement("div");
      row.className = "mrow" + (i === state.modelIndex && state.engine ? " active" : "");
      row.innerHTML = `<div><div class="mn">${m.name}</div><div class="md">${m.size}${i === state.modelIndex && state.engine ? " · active" : ""}</div></div><span class="tag">κ-object</span>`;
      row.onclick = () => { els.modelmenu.hidden = true; pickModel(i); };
      els.modelmenu.appendChild(row);
    });
  }
  els.modelbtn.onclick = (e) => { e.stopPropagation(); renderModelMenu(); els.modelmenu.hidden = !els.modelmenu.hidden; };
  document.addEventListener("click", () => { els.modelmenu.hidden = true; });
  bus.on("model-pick", pickModel);

  // ── Holo Mind bridge (ADR-0081): offer this app's QVAC engine to the OS-wide ambient loop as its
  // model SAMPLER. Holo Q runs framed inside the OS shell (window.parent / window.top hold the shell's
  // window.HoloMind) or standalone (no shell → no-op). Passing the sampler is a same-origin function
  // reference (the OS serves Q and the shell from one origin), so when the shell's loop calls it, it
  // executes here, against THIS tab's loaded model. The sampler reads state.engine at call time, so it
  // always uses the currently-loaded model; it returns "" when no model is loaded (the loop then falls
  // back to its deterministic plan). This is the OS's established "borrow the model" idiom (the
  // ask_model / samplerJudge sampler shape), now backed by real on-device QVAC inference.
  const qvacSampler = async ({ prompt, maxTokens } = {}) => {
    const e = state.engine; if (!e) return "";
    const ids = e.tokenize(e.frameTurn(String(prompt ?? ""), false));
    const { text } = await e.generate(ids, { maxNew: maxTokens || 256 });
    return text || "";
  };
  let _mindWired = false;
  function registerMindSampler() {
    if (_mindWired) return;
    for (const w of [window, window.parent, window.top]) {
      try { if (w && w.HoloMind && typeof w.HoloMind.setSampler === "function") { w.HoloMind.setSampler(qvacSampler); _mindWired = true; return; } } catch { /* cross-origin frame — skip */ }
    }
  }

  async function pickModel(i) {
    if (state.loading || (i === state.modelIndex && state.engine)) return;
    state.loading = true;
    const m = loader.MODELS[i];
    els.modelname.textContent = m.name; els.modelbadge.hidden = true;
    els.status.innerHTML = `<span class="gen">${t("com_ui_model_loading")}</span>`;
    try {
      state.engine?.destroy(); state.engine = null; els.submit.disabled = true;
      const loaded = await loader.loadModel(m, {
        onStatus: (s) => { els.status.textContent = s || ""; },
        onProgress: (done, total, what) => { els.status.textContent = `${m.name} — ${total ? Math.round((done / total) * 100) : 0}% (${what})`; },
      });
      if (!loaded || !loaded.gpu) { els.modelname.textContent = t("com_ui_choose_model"); return; }
      state.engine = await createEngine(m, loaded);
      // opt-in learned speculative drafter (flag HOLO_Q_DRAFT): the drafter proposes, the target
      // batch-verifies → BYTE-IDENTICAL output, faster decode. Default OFF; any failure is swallowed so
      // boot and default decode are never affected. Only engages when the engine has the batch-verify head.
      try {
        const on = globalThis.HOLO_Q_DRAFT || (typeof localStorage !== "undefined" && localStorage.getItem("HOLO_Q_DRAFT") === "1");
        if (on && state.engine.specAvailable) {
          const base = new URL("../forge/gpu/", import.meta.url);
          const { createQDrafter } = await import(new URL("holo-q-drafter.mjs", base).href);
          state.engine.setDrafter(await createQDrafter({ onnxUrl: new URL("seed_9b.onnx", base).href, jsonUrl: new URL("seed_9b.json", base).href }));
          console.log("[Q] speculative drafter registered (seed_9b)");
        }
      } catch (e) { console.warn("[Q] drafter not registered:", e && e.message); }
      state.modelIndex = i;
      els.modelbadge.hidden = false;
      els.status.innerHTML = `<span class="kk">${state.engine.modelKappa.slice(0, 30)}…</span> <span style="color:var(--faint)">· verified · on your GPU</span>`;
      bus.emit("engine-ready");
      registerMindSampler();           // offer this QVAC engine to the OS Holo Mind loop (ADR-0081)
    } finally { state.loading = false; }
  }

  // keyboard map
  installKeymap({
    newChat: () => chat.newConversation(),
    toggleNav: () => setNav(document.body.classList.contains("nav-closed")),
    focusInput: () => composer.focus(),
    send: () => chat.send(),
    stop: () => chat.stop(),
    modelMenu: () => els.modelbtn.click(),
  });

  // warm the markdown pipeline in idle time (so the first answer renders instantly)
  if (window.requestIdleCallback) requestIdleCallback(() => initMarkdown());
  else setTimeout(() => initMarkdown(), 300);

  // ── boot sequence: restore last conversation, then load the default model ──
  const ptrs = await chatStore.listConversations();
  if (ptrs.length) await chat.openConversation(ptrs[0].conversationId);
  else await chat.newConversation();

  const noauto = new URLSearchParams(location.search).get("noauto");
  if (!noauto) {
    if (!navigator.gpu) els.status.textContent = "This device has no WebGPU — Holo Q runs the model locally and needs it.";
    else await pickModel(loader.defaultModelIndex());
  }

  // OS frame handshake — the Hologram OS desktop frame listens for this.
  try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: "holo-q-ready", gate: gateOk }, "*"); } catch {}
  window.__holoq = { ctx, chat, loader };   // debugging / witness handle
  window.__ready = true;
}
