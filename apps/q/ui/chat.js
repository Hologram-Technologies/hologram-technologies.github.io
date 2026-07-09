// ui/chat.js — the conversation CONTROLLER. Owns the message tree (LibreChat parentMessageId
// semantics over κ-objects), the engine token loop, sibling/branch navigation, edit-resubmit,
// regenerate, fork, feedback, and persistence after every turn. The substrate gives the magic:
//   · κ-memo — an identical (context ⊕ prompt ⊕ model ⊕ params) replays the answer in O(1)
//   · fork — a new conversation REFERENCES the same message κ-objects (O(1), zero copy)
//   · every assistant turn seals a PROV-O receipt that re-derives to its address (Law L5)

import { normMessage } from "../core/schema.js";
import { verifyIntegrity } from "../core/kappa.js";
import { runToolLoop, frameAgenticTurn } from "../core/tools.js";
import { parseArtifacts, stripArtifacts, artifactInstructions } from "../render/artifacts.js";

export function makeChat({ ctx, view, els, t, toast }) {
  const { state, bus, chatStore } = ctx;

  // ── in-memory tree of the active conversation ────────────────────────────
  // rows: Map messageId → { id, kappa, obj, parentMessageId, text, isCreatedByUser, tokenIds,
  //                         receiptKappa, feedback, createdAt, sender, model, fromMemo }
  let rows = new Map();
  let childrenOf = new Map();   // messageId → [childId,…] in creation order

  const rowFromObj = (obj, kappa) => ({
    id: obj["schema:identifier"], kappa: kappa || obj.id, obj,
    parentMessageId: obj["lc:parentMessageId"] || null,
    sender: obj["lc:sender"], isCreatedByUser: !!obj["lc:isCreatedByUser"],
    model: obj["lc:model"], text: obj["schema:text"] || "",
    tokenIds: obj["lc:tokenIds"] || null, tokenCount: obj["lc:tokenCount"],
    feedback: obj["lc:feedback"] || null, createdAt: obj["schema:dateCreated"],
    receiptKappa: (obj.links || []).find((l) => l.rel === "lc:receipt")?.id || null,
    toolReceiptKappas: (obj.links || []).filter((l) => l.rel === "lc:toolReceipt").map((l) => l.id),
    toolTrace: obj["lc:toolTrace"] || null,
    fromMemo: !!obj["lc:fromMemo"],
  });

  function index() {
    childrenOf = new Map();
    for (const r of rows.values()) {
      const p = r.parentMessageId || "__root__";
      if (!childrenOf.has(p)) childrenOf.set(p, []);
      childrenOf.get(p).push(r.id);
    }
    for (const kids of childrenOf.values()) kids.sort((a, b) => String(rows.get(a)?.createdAt).localeCompare(String(rows.get(b)?.createdAt)));
  }

  const siblingsOf = (msg) => childrenOf.get(msg.parentMessageId || "__root__") || [msg.id];
  const chosen = (parentId) => {
    const kids = childrenOf.get(parentId || "__root__") || [];
    if (!kids.length) return null;
    const pick = state.chosenChild.get(parentId || "__root__");
    return kids.includes(pick) ? pick : kids[kids.length - 1];   // default: newest branch
  };

  // The ACTIVE THREAD: follow chosen children root → leaf.
  function activeThread() {
    const out = []; let cur = chosen(null);
    while (cur) { const r = rows.get(cur); if (!r) break; out.push(r); cur = chosen(r.id); }
    return out;
  }
  const leaf = () => activeThread().at(-1) || null;

  // The conversation context as TOKENS: concat of each turn's stored tokenIds along the path.
  // (Exact — assistant turns keep their generated ids, so re-prefill matches the original run.)
  const threadIds = (upto) => {
    const ids = [];
    for (const r of activeThread()) { if (upto && r.id === upto.id) break; if (r.tokenIds) ids.push(...r.tokenIds); }
    return ids;
  };

  // ── persistence ──────────────────────────────────────────────────────────
  async function persistMessage(fields, parentRow) {
    const sealed = await chatStore.saveMessage({ ...fields, parent: parentRow ? parentRow.obj : null });
    const row = rowFromObj(sealed);
    rows.set(row.id, row); index();
    return row;
  }

  async function persistConversation() {
    const lf = leaf(); if (!lf) return;
    const tips = [...childrenOf.entries()].flatMap(([, kids]) => kids).map((id) => rows.get(id))
      .filter((r) => r && !(childrenOf.get(r.id) || []).length).map((r) => r.obj);
    const conv = await chatStore.saveConversation({
      conversationId: state.convId, title: state.title,
      preset: state.preset || null, headMessage: lf.obj,
      branchTips: tips.filter((o) => o["schema:identifier"] !== lf.id).slice(0, 24),
    });
    state.convKappa = conv.id;
    bus.emit("conversations-changed");
  }

  // ── engine plumbing ──────────────────────────────────────────────────────
  const kChip = (k) => `<span class="kk">${String(k).slice(0, 30)}…</span>`;
  const setStatus = (html) => { els.status.innerHTML = html || ""; };

  async function generateTurn({ promptText, parentRow }) {
    const engine = state.engine; if (!engine) { toast(t("com_ui_model_loading")); return; }
    state.streaming = true; state.abort = new AbortController();
    els.submit.classList.add("stop"); els.submit.textContent = "■"; els.submit.disabled = false;
    bus.emit("streaming", true);

    // 1 · the user turn — framed EXACTLY as it will run (plain, or agentic with the tools
    //     system block), so the stored tokenIds keep the ctx-concat invariant of the tree.
    //     The system layers compose: preset prefix ⊕ active agent instructions ⊕ memory ⊕ artifacts.
    const ctxIds = threadIds();
    const mcpTools = ctx.mcpHub ? ctx.mcpHub.enabledTools() : [];
    const agentSel = state.agent;   // the active agent (κ-verified) shapes tools + instructions
    const liveTools = [
      ...(agentSel && agentSel.tools.length ? mcpTools.filter((x) => agentSel.tools.includes(x.def.name)) : mcpTools),
      ...(ctx.memory ? ctx.memory.localTools() : []),
      ...(state.mode === "code" ? ctx.codeTools() : []),   // Code mode: native OPFS file tools (read/write/edit/list/grep) → agentic coding
      ...(state.mode === "code" ? ctx.skillTools() : []),  // self-evolving skills: list/read/save (agentskills.io-compatible, UOR-sealed)
    ];
    const sysParts = [];
    if (state.preset?.promptPrefix?.trim()) sysParts.push(state.preset.promptPrefix.trim());
    if (agentSel?.instructions?.trim()) sysParts.push(agentSel.instructions.trim());
    if (ctx.memory) { const mem = await ctx.memory.injection(); if (mem) sysParts.push(mem); }
    if (state.mode === "code" || ctx.settings.get("artifacts") !== false) sysParts.push(artifactInstructions());   // Code mode always builds
    if (state.mode === "code" && ctx.skillsDiscoveryPrompt) { try { const sd = await ctx.skillsDiscoveryPrompt(); if (sd) sysParts.push(sd); } catch {} }   // progressive disclosure: learned skills (names+descriptions)
    const extraSystem = sysParts.join("\n\n");
    const isAgentic = liveTools.length > 0 && engine.model.qwen && engine.model.tools !== false;   // small ternary models opt out of tool framing
    const framed = isAgentic
      ? frameAgenticTurn({ tools: liveTools, promptText, hasHistory: ctxIds.length > 0, extraSystem })
      : engine.frameTurn(applyPrefix(promptText, ctxIds.length > 0), ctxIds.length > 0);
    const turnIds = engine.tokenize(framed);
    if (engine.model.bos && engine.bosId != null && ctxIds.length === 0) turnIds.unshift(engine.bosId);   // models whose chat template REQUIRES a leading BOS (Falcon-E, LLaMA-3)
    const userRow = await persistMessage({
      messageId: chatStore.newId("msg"), conversationId: state.convId, sender: "User",
      isCreatedByUser: true, text: promptText, tokenIds: turnIds,
    }, parentRow);
    view.render(activeThread().slice(0, -0), siblingsOf);   // show the user bubble
    view.scrollBottom();

    // 2 · generate — agentic (MCP tool loop, when tools are live) or plain; κ-memo replays
    //     identical (context ⊕ prompt ⊕ model ⊕ params) in O(1) with no decode
    let outIds = null, outText = "", fromMemo = false, stats = null;
    let toolReceipts = [], toolTrace = null;
    try {
      const key = await engine.memoKey(ctxIds, turnIds, { ...engine.params(), tools: liveTools.map((x) => x.def.name).sort() });
      const hit = !isAgentic && engine.memoGet(key);   // agentic answers depend on live tools — never memo-replayed
      if (hit) { outIds = hit.outIds.slice(); outText = hit.text; fromMemo = true; engine.reset(); }
      else if (isAgentic) {
        const stream = view.startStream();
        const res = await runToolLoop({
          engine, tools: liveTools, promptText, ctxIds, firstFramed: framed, signal: state.abort.signal,
          onToken: ({ text, ids: all, stats: s }) => { stream.update(text); stream.stats(s); stats = s; bus.emit("genstats", s); setStatus(`<span class="gen">${t("com_ui_generating")}</span> · ${kChip(engine.fingerprint(all))}`); },
          onToolCall: ({ name, server }) => { stream.trail(t("com_tools_using", { name }) + ` <span style="color:var(--faint)">· ${server}</span>`); },
          onToolResult: ({ name, ok, render }) => {
            stream.trail(`${ok ? "✓" : "✗"} ${name}`);
            // build_app → render the sealed object LIVE (the neural-computer flagship: agent builds
            // a real app, it runs in-tab, the κ chip re-derives every byte — serverless, verifiable).
            if (render && render.kind === "app") { try { bus.emit("app-preview", render); } catch {} }
          },
        });
        stream.done();
        // the user row carries the framed first turn; the assistant row carries EVERYTHING the
        // loop appended after it (outputs + tool-response turns) — ctx-concat stays exact.
        // Re-derivation of agentic answers is honest: decode="agentic+tools" (tool results are
        // external — κ-bound via per-call receipts, not re-runnable).
        outIds = res.ids.slice(ctxIds.length + turnIds.length);
        outText = res.text;
        toolReceipts = res.toolReceipts; toolTrace = res.trace;
        for (const tr of toolReceipts) await chatStore.saveReceipt(tr);
      }
      else {
        const stream = view.startStream();
        const ids = ctxIds.concat(turnIds);
        const res = await engine.generate(ids, {
          signal: state.abort.signal,
          onToken: ({ text, ids: all, stats: s }) => {
            stream.update(text); stream.stats(s);
            stats = s; bus.emit("genstats", s);
            setStatus(`<span class="gen">${t("com_ui_generating")}</span> · ${kChip(engine.fingerprint(all))}`);
          },
        });
        stream.done();
        if (res.error) { setStatus("error: " + res.error); }
        outIds = res.outIds; outText = res.text;
        engine.memoSet(key, { outIds: outIds.slice(), text: outText });
      }
    } finally {
      state.streaming = false; state.abort = null;
      els.submit.classList.remove("stop"); els.submit.textContent = "↑";
      bus.emit("streaming", false);
    }
    if (!outIds || !outIds.length) { setStatus(""); view.render(activeThread(), siblingsOf); return; }

    // 2b · artifacts: parse :::artifact blocks out of the answer, seal each version as a
    //      κ-object, open the panel; the message keeps a compact reference card instead.
    try {
      const arts = parseArtifacts(outText);
      if (arts.length && ctx.artifactsTab) { await ctx.artifactsTab.ingest(arts); outText = stripArtifacts(outText); }
    } catch {}

    // 3 · seal the PROV-O receipt (the agentic work-trail rides prov:used) + persist the turn
    const rec = await engine.buildReceipt({
      promptText, ctxIds, turnIds, outIds, fromMemo, evaluateText: ctx.evaluateText,
      paramsPatch: isAgentic ? { decode: "agentic+tools", toolCalls: toolTrace ? toolTrace.length : 0 } : undefined,
      extraUsed: toolReceipts.length ? { "holo:toolReceipts": toolReceipts.map((x) => x.id) } : undefined,
    });
    await chatStore.saveReceipt(rec);
    await persistMessage({
      messageId: chatStore.newId("msg"), conversationId: state.convId, sender: "Assistant",
      isCreatedByUser: false, model: engine.model.name, text: outText, tokenCount: outIds.length,
      tokenIds: outIds, receiptKappa: rec.id, fromMemo, toolTrace,
      toolReceiptKappas: toolReceipts.map((x) => x.id),
    }, userRow);

    // 4 · title (first exchange) + persist the conversation root
    if (state.title === "New Chat") { state.title = promptText.slice(0, 60) + (promptText.length > 60 ? "…" : ""); els.chattitle.textContent = state.title; }
    await persistConversation();
    view.render(activeThread(), siblingsOf); view.scrollBottom();
    const c = rec.body["holo:conscience"] || {};
    const tail = c.outcome === "block" ? ' · <span style="color:var(--bad)">conscience: blocked</span>' : c.outcome === "caveat" ? ' · <span style="color:var(--warn)">caveat</span>' : "";
    setStatus(kChip(rec.id) + ` <span style="color:var(--faint)">· this answer, proven by content${fromMemo ? " · ⚡ O(1) memo" : ""}${tail}</span>`);
  }

  const applyPrefix = (p, hasHistory) => {
    const pre = state.preset?.promptPrefix?.trim();
    return pre && !hasHistory ? pre + "\n\n" + p : p;   // system prompt rides the first turn
  };

  // ── public actions ───────────────────────────────────────────────────────
  async function send(text) {
    const p = (text ?? els.user.value).trim(); if (!p || state.streaming) return;
    els.user.value = ""; bus.emit("composer-resize");
    if (!state.convId) await newConversation(false);
    await generateTurn({ promptText: p, parentRow: leaf() });
  }

  function stop() { state.abort?.abort(); }

  async function regenerate(msg) {
    if (state.streaming) return;
    const parent = rows.get(msg.parentMessageId);   // the user turn
    if (!parent) return;
    state.chosenChild.set(parent.parentMessageId || "__root__", parent.id);
    await generateRegen(parent);
  }
  async function generateRegen(parentUserRow) {
    // re-run generation under the SAME user turn → a NEW SIBLING assistant message
    const engine = state.engine; if (!engine) return;
    state.streaming = true; state.abort = new AbortController();
    els.submit.classList.add("stop"); els.submit.textContent = "■"; bus.emit("streaming", true);
    try {
      const ctxIds = threadIds(parentUserRow);
      const turnIds = parentUserRow.tokenIds || engine.tokenize(engine.frameTurn(parentUserRow.text, ctxIds.length > 0));
      engine.reset();
      const stream = view.startStream();
      let stats = null;
      const res = await engine.generate(ctxIds.concat(turnIds), {
        signal: state.abort.signal,
        onToken: ({ text, ids: all, stats: s }) => { stream.update(text); stats = s; bus.emit("genstats", s); setStatus(`<span class="gen">${t("com_ui_generating")}</span> · ${kChip(engine.fingerprint(all))}`); },
      });
      stream.done();
      if (res.outIds.length) {
        const rec = await engine.buildReceipt({ promptText: parentUserRow.text, ctxIds, turnIds, outIds: res.outIds, evaluateText: ctx.evaluateText });
        await chatStore.saveReceipt(rec);
        const row = await persistMessage({
          messageId: chatStore.newId("msg"), conversationId: state.convId, sender: "Assistant",
          isCreatedByUser: false, model: engine.model.name, text: res.text, tokenCount: res.outIds.length,
          tokenIds: res.outIds, receiptKappa: rec.id,
        }, parentUserRow);
        state.chosenChild.set(parentUserRow.id, row.id);
        await persistConversation();
      }
    } finally {
      state.streaming = false; state.abort = null;
      els.submit.classList.remove("stop"); els.submit.textContent = "↑"; bus.emit("streaming", false);
    }
    view.render(activeThread(), siblingsOf); view.scrollBottom();
  }

  // Edit + resubmit (LibreChat): the edited prompt becomes a SIBLING of the original user
  // message (same parent) — the original branch stays reachable via the pager.
  async function editResubmit(msg, newText) {
    if (state.streaming) return;
    const parent = msg.parentMessageId ? rows.get(msg.parentMessageId) : null;
    await generateTurn({ promptText: newText, parentRow: parent });
  }

  function switchSibling(msg, dir) {
    const sibs = siblingsOf(msg); const i = sibs.indexOf(msg.id);
    const next = sibs[(i + dir + sibs.length) % sibs.length];
    state.chosenChild.set(msg.parentMessageId || "__root__", next);
    view.render(activeThread(), siblingsOf);
  }

  // Fork from a message: a NEW conversation whose head links the SAME κ-objects — the history
  // is shared by content address, so the fork is O(1) and byte-verifiable (no copy, Law L3).
  async function fork(msg) {
    const newConvId = chatStore.newId("conv");
    await chatStore.saveConversation({ conversationId: newConvId, title: (state.title || "Chat") + " · fork", preset: state.preset || null, headMessage: msg.obj });
    bus.emit("conversations-changed");
    toast(t("com_ui_forked"));
    await openConversation(newConvId);
  }

  async function feedback(msg, rating, btn) {
    const next = msg.feedback?.rating === rating ? null : { rating, tag: null, text: "" };
    // a feedback edit re-seals the message κ-object (a NEW sibling-in-place: same parent, new κ)
    const parent = msg.parentMessageId ? rows.get(msg.parentMessageId) : null;
    const sealed = await chatStore.saveMessage({
      messageId: msg.id, conversationId: state.convId, sender: msg.sender, isCreatedByUser: msg.isCreatedByUser,
      model: msg.model, text: msg.text, tokenCount: msg.tokenCount, tokenIds: msg.tokenIds,
      receiptKappa: msg.receiptKappa, feedback: next, createdAt: msg.createdAt, parent: parent ? parent.obj : null,
    });
    const row = rowFromObj(sealed); rows.set(row.id, row); index();
    await persistConversation();
    view.render(activeThread(), siblingsOf);
  }

  function speak(msg) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(msg.text);
      u.rate = ctx.settings.get("ttsRate") || 1;
      speechSynthesis.speak(u);
    } catch {}
  }

  // ── receipt resolution (after reload, from the κ-store) ─────────────────
  async function resolveReceipt(msg) {
    try {
      const bytes = await chatStore.store.getBytes(msg.receiptKappa); if (!bytes) return null;
      const body = JSON.parse(new TextDecoder().decode(bytes));
      const rec = { id: msg.receiptKappa, body, params: body["prov:used"]["holo:params"] };
      // reconstruct token sequences from the thread for re-derivation
      rec.outIds = msg.tokenIds || []; rec.ctxIds = threadIds(rows.get(msg.parentMessageId)); rec.turnIds = rows.get(msg.parentMessageId)?.tokenIds || [];
      return rec;
    } catch { return null; }
  }
  const verifyReceipt = (rec) => verifyIntegrity(rec);
  const reDeriveReceipt = (rec) => state.engine ? state.engine.reDerive(rec) : { ok: false, reason: t("com_ui_model_loading") };

  // ── conversation lifecycle ───────────────────────────────────────────────
  async function newConversation(render = true) {
    state.convId = chatStore.newId("conv"); state.convKappa = null; state.title = "New Chat";
    rows = new Map(); childrenOf = new Map(); state.chosenChild = new Map();
    state.engine?.reset();
    els.chattitle.textContent = ""; setStatus("");
    if (render) { view.render([], siblingsOf); els.user.focus(); }
    bus.emit("conversation-opened");
  }

  // Load: resolve the conversation κ-object, verify the WHOLE Merkle-DAG (Law L5), then walk
  // head + branch tips up their parent links to reconstruct the tree (siblings included).
  async function openConversation(conversationId) {
    const loaded = await chatStore.loadConversation(conversationId);
    if (!loaded) return;
    if (!loaded.ok) { toast(t("com_ui_integrity_refused")); console.warn("integrity:", loaded.integrity); }
    rows = new Map(); state.chosenChild = new Map();
    const seen = new Set();
    async function walkUp(kappa) {
      if (!kappa || seen.has(kappa)) return; seen.add(kappa);
      const obj = await chatStore.store.getObj(kappa); if (!obj) return;
      const row = rowFromObj(obj, kappa);
      if (!rows.has(row.id)) rows.set(row.id, row);
      const pl = (obj.links || []).find((l) => l.rel === "lc:parentMessage");
      if (pl) await walkUp(pl.id);
    }
    const tips = (loaded.conv.links || []).filter((l) => l.rel === "lc:head" || l.rel === "lc:branchTip");
    for (const l of tips) await walkUp(l.id);
    index();
    state.convId = conversationId; state.convKappa = loaded.kappa;
    state.title = loaded.conv["schema:name"] || "Chat";
    if (loaded.conv["lc:preset"]) { state.preset = loaded.conv["lc:preset"]; bus.emit("preset-changed"); }
    els.chattitle.textContent = state.title;
    state.engine?.reset();   // KV cache no longer matches — next turn re-prefills from tokenIds
    view.render(activeThread(), siblingsOf); view.scrollBottom();
    setStatus(state.convKappa ? `<span class="kk">${String(state.convKappa).slice(0, 30)}…</span> <span style="color:var(--faint)">· this conversation, addressed by content</span>` : "");
    bus.emit("conversation-opened");
    if (window.innerWidth <= 900) bus.emit("close-nav");
  }

  const rerender = () => view.render(activeThread(), siblingsOf);

  return {
    send, stop, regenerate, editResubmit, switchSibling, fork, feedback, speak,
    resolveReceipt, verifyReceipt, reDeriveReceipt,
    newConversation, openConversation, rerender,
    activeThread, leaf, siblingsOf, rowsRef: () => rows,
  };
}
