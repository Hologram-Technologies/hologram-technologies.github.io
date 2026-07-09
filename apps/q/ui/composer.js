// ui/composer.js — the message box: autosize, Enter/Ctrl+Enter send (configurable), Esc stop,
// `/` preset-prompt menu and `@` model-mention menu at the caret, and dictation via the
// browser's speech engine (Web Speech API — on-device on Chromium-class engines; no server).

export function makeComposer({ ctx, els, t, act, toast }) {
  const { state, bus, settings } = ctx;
  const ta = els.user;

  const autosize = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 200) + "px"; };
  ta.addEventListener("input", () => { autosize(); maybeMenu(); });
  bus.on("composer-resize", autosize);

  ta.addEventListener("keydown", (e) => {
    if (menuOpen()) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); moveSel(e.key === "ArrowDown" ? 1 : -1); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickSel(); return; }
      if (e.key === "Escape") { e.preventDefault(); closeMenu(); return; }
    }
    const enterSends = settings.get("enterSend") !== false;
    if (e.key === "Enter" && !e.shiftKey && enterSends) { e.preventDefault(); act.send(); }
  });

  els.submit.onclick = () => { if (state.streaming) act.stop(); else act.send(); };
  // "+" = the command door: opens the `/` menu (prompts · presets) right at the caret
  if (els.plusbtn) els.plusbtn.onclick = () => { if (!/(^|\s)\/$/.test(ta.value)) ta.value += (ta.value && !/\s$/.test(ta.value) ? " " : "") + "/"; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.dispatchEvent(new Event("input")); };
  bus.on("streaming", (on) => { els.submit.disabled = on ? false : !state.engine; });
  bus.on("engine-ready", () => { els.submit.disabled = false; ta.focus(); });

  // ── `/` prompts (presets) and `@` models, anchored above the composer ────
  let menuKind = null, menuItems = [], menuSel = 0;
  const menuOpen = () => !els.cmdmenu.hidden;
  const closeMenu = () => { els.cmdmenu.hidden = true; menuKind = null; };

  async function maybeMenu() {
    const v = ta.value, pos = ta.selectionStart;
    const head = v.slice(0, pos);
    const slash = head.match(/(?:^|\s)\/([\w-]*)$/);
    const at = head.match(/(?:^|\s)@([\w.-]*)$/);
    if (slash) return openMenu("prompt", slash[1]);
    if (at) return openMenu("model", at[1]);
    closeMenu();
  }

  async function openMenu(kind, query) {
    menuKind = kind; menuSel = 0;
    if (kind === "prompt") {
      // the prompts LIBRARY first (by /command, LibreChat semantics), then parameter presets
      const q = (query || "").toLowerCase();
      const groups = ctx.promptsLib ? await ctx.promptsLib.list() : [];
      const fromLib = groups
        .filter((g) => !q || (g.command || "").includes(q) || g.name.toLowerCase().includes(q))
        .map((g) => ({ title: "/" + (g.command || g.name), desc: g.oneliner || g.name, apply: () => applyPromptGroup(g) }));
      const ptrs = await ctx.presets.list();
      const loadedPresets = (await Promise.all(ptrs.map((p) => ctx.presets.get(p.presetId)))).filter(Boolean);
      const fromPresets = loadedPresets
        .filter((p) => !q || p.title.toLowerCase().includes(q))
        .map((p) => ({ title: p.title, desc: (p.promptPrefix || "").slice(0, 80) || "parameter preset", apply: () => applyPreset(p) }));
      menuItems = [...fromLib, ...fromPresets];
    } else {
      // @ = agents first (LibreChat's @-mention switches the agent), then models
      const q = (query || "").toLowerCase();
      const agents = ctx.agents ? await ctx.agents.list() : [];
      const fromAgents = agents
        .filter((a) => !q || a.name.toLowerCase().includes(q))
        .map((a) => ({ title: "@" + a.name, desc: "agent", apply: async () => { eraseTrigger(); const full = await ctx.agents.get(a.id); if (full) { state.agent = full; state.agentId = a.id; bus.emit("agent-changed"); toast(full.name + " · active"); } } }));
      const fromModels = ctx.loader.MODELS
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => !q || m.name.toLowerCase().includes(q))
        .map(({ m, i }) => ({ title: m.name, desc: `${m.size} · ${m.fmt}`, apply: () => { eraseTrigger(); bus.emit("model-pick", i); } }));
      menuItems = [...fromAgents, ...fromModels];
    }
    if (!menuItems.length) {   // never a dead door — say what lives here
      els.cmdmenu.innerHTML = `<button disabled style="cursor:default"><span class="t">${esc(t(kind === "prompt" ? "com_cmd_empty_prompts" : "com_cmd_empty_models"))}</span></button>`;
      els.cmdmenu.hidden = false;
      return;
    }
    els.cmdmenu.innerHTML = menuItems.map((it, i) => `<button data-i="${i}" class="${i === menuSel ? "sel" : ""}"><span class="t">${esc(it.title)}</span><span class="d">${esc(it.desc)}</span></button>`).join("");
    els.cmdmenu.hidden = false;
    els.cmdmenu.querySelectorAll("button").forEach((b) => (b.onclick = () => { menuSel = +b.dataset.i; pickSel(); }));
  }
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  function moveSel(d) { menuSel = (menuSel + d + menuItems.length) % menuItems.length; els.cmdmenu.querySelectorAll("button").forEach((b, i) => b.classList.toggle("sel", i === menuSel)); }
  function pickSel() { const it = menuItems[menuSel]; closeMenu(); if (it) it.apply(); }
  function eraseTrigger() {
    const v = ta.value, pos = ta.selectionStart;
    ta.value = v.slice(0, pos).replace(/(?:^|\s)[/@][\w.-]*$/, (s) => (s.startsWith(" ") ? " " : "")) + v.slice(pos);
    autosize();
  }
  function applyPreset(p) {
    eraseTrigger();
    state.preset = { ...p }; bus.emit("preset-changed");
    toast(`${p.title} · preset applied`);
    ta.focus();
  }
  async function applyPromptGroup(g) {
    eraseTrigger();
    const prod = await ctx.promptsLib.production(g.groupId);
    if (!prod) { toast(t("com_ui_integrity_refused")); return; }
    const { fillPromptDialog } = await import("./vardialog.js");
    const filled = await fillPromptDialog({ els, t, promptText: prod.prompt, userName: "operator" });
    if (filled == null) { ta.focus(); return; }
    await ctx.promptsLib.recordUse(g.groupId);
    if (prod.type === "chat") { act.send(filled); }                 // chat prompts submit directly
    else { ta.value = (ta.value ? ta.value + " " : "") + filled; autosize(); ta.focus(); }   // text prompts insert
  }
  document.addEventListener("click", (e) => { if (!els.cmdmenu.contains(e.target) && e.target !== ta) closeMenu(); });

  // ── dictation (Web Speech). Graceful: hidden when the engine is unavailable. ──
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) els.micbtn.style.display = "none";
  let rec = null;
  els.micbtn.onclick = () => {
    if (rec) { rec.stop(); return; }
    try {
      rec = new SR();
      rec.lang = settings.get("sttLang") || navigator.language || "en-US";
      rec.interimResults = true; rec.continuous = true;
      const base = ta.value;
      rec.onresult = (e) => {
        let txt = "";
        for (const r of e.results) txt += r[0].transcript;
        ta.value = (base ? base + " " : "") + txt; autosize();
      };
      rec.onend = () => { rec = null; els.micbtn.classList.remove("rec"); };
      rec.onerror = () => { rec = null; els.micbtn.classList.remove("rec"); };
      els.micbtn.classList.add("rec");
      rec.start();
    } catch { rec = null; els.micbtn.classList.remove("rec"); }
  };

  autosize();
  return { focus: () => ta.focus(), autosize };
}
