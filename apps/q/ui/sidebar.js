// ui/sidebar.js — the conversation list: search, date groups (Today / Yesterday / Previous 7
// days / Previous 30 days / Older), favorites pinned on top, and the per-row menu (rename ·
// favorite · duplicate · archive · delete). Rows come from the boot index (pointer records);
// the conversations themselves stay verifiable κ-objects in the store.

import { SVG } from "./shell.js";

export function makeSidebar({ ctx, els, t, act, toast }) {
  const { state, bus, chatStore } = ctx;
  let showArchived = false, query = "";
  let menuEl = null;

  els.navsearch.addEventListener("input", () => { query = els.navsearch.value.trim().toLowerCase(); render(); });
  els.navarchived.onclick = () => { showArchived = !showArchived; els.navarchived.style.color = showArchived ? "var(--mint)" : ""; render(); };
  bus.on("conversations-changed", render);
  bus.on("conversation-opened", render);

  function group(ts) {
    const d = new Date(ts), nowD = new Date();
    const day = 864e5, today = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();
    if (d.getTime() >= today) return t("com_nav_today");
    if (d.getTime() >= today - day) return t("com_nav_yesterday");
    if (d.getTime() >= today - 7 * day) return t("com_nav_prev_7");
    if (d.getTime() >= today - 30 * day) return t("com_nav_prev_30");
    return t("com_nav_older");
  }

  async function render() {
    const all = await chatStore.listConversations();
    const rows = all
      .filter((c) => (showArchived ? true : !c.archived))
      .filter((c) => !query || (c.title || "").toLowerCase().includes(query));
    els.navlist.innerHTML = "";
    if (!rows.length) {
      const d = document.createElement("div"); d.className = "nav-group"; d.style.textTransform = "none"; d.style.letterSpacing = "0";
      d.textContent = query ? t("com_nav_no_results") : t("com_nav_no_convos");
      els.navlist.appendChild(d); return;
    }
    const favs = rows.filter((c) => c.favorite);
    const rest = rows.filter((c) => !c.favorite);
    if (favs.length) { addGroup(t("com_nav_favorites")); favs.forEach(addRow); }
    let lastGroup = null;
    for (const c of rest.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))) {
      const g = c.archived ? t("com_nav_archived") : group(c.updatedAt);
      if (g !== lastGroup) { addGroup(g); lastGroup = g; }
      addRow(c);
    }
  }

  function addGroup(label) { const d = document.createElement("div"); d.className = "nav-group"; d.textContent = label; els.navlist.appendChild(d); }

  function addRow(c) {
    const d = document.createElement("div");
    d.className = "convo-item" + (c.conversationId === state.convId ? " active" : "") + (c.favorite ? " favorite" : "");
    d.innerHTML = `<span class="fav">${SVG.star}</span><span class="ttl"></span><button class="dots" aria-label="Options">${SVG.dots}</button>`;
    d.querySelector(".ttl").textContent = c.title || "Chat";
    d.onclick = (e) => { if (e.target.closest(".dots")) return; act.openConversation(c.conversationId); };
    d.querySelector(".dots").onclick = (e) => { e.stopPropagation(); openMenu(e.currentTarget, c, d); };
    els.navlist.appendChild(d);
  }

  function closeMenu() { menuEl?.remove(); menuEl = null; document.removeEventListener("click", closeMenu); }
  function openMenu(anchor, c, rowEl) {
    closeMenu();
    menuEl = document.createElement("div"); menuEl.className = "ctx-menu";
    menuEl.innerHTML = `
      <button data-a="rename">${SVG.edit} ${t("com_ui_rename")}</button>
      <button data-a="fav">${SVG.star} ${c.favorite ? t("com_ui_unfavorite") : t("com_ui_favorite")}</button>
      <button data-a="dup">${SVG.copy} ${t("com_ui_duplicate")}</button>
      <button data-a="archive">${SVG.archive} ${c.archived ? t("com_ui_unarchive") : t("com_ui_archive")}</button>
      <div class="sep"></div>
      <button data-a="del" class="danger">${SVG.trash} ${t("com_ui_delete")}</button>`;
    document.body.appendChild(menuEl);
    const r = anchor.getBoundingClientRect();
    menuEl.style.left = Math.min(r.left, window.innerWidth - menuEl.offsetWidth - 10) + "px";
    menuEl.style.top = Math.min(r.bottom + 4, window.innerHeight - menuEl.offsetHeight - 10) + "px";
    rowEl.classList.add("menu-open");
    setTimeout(() => document.addEventListener("click", closeMenu), 0);

    menuEl.querySelector('[data-a="rename"]').onclick = () => { closeMenu(); inlineRename(rowEl, c); };
    menuEl.querySelector('[data-a="fav"]').onclick = async () => { closeMenu(); await chatStore.updatePointer(c.conversationId, { favorite: !c.favorite }); render(); };
    menuEl.querySelector('[data-a="archive"]').onclick = async () => { closeMenu(); await chatStore.updatePointer(c.conversationId, { archived: !c.archived }); render(); };
    menuEl.querySelector('[data-a="dup"]').onclick = async () => {
      closeMenu();
      // duplicate = a new pointer to the SAME conversation κ — content-addressed, zero copy (O(1))
      const idx = await chatStore.getIndex();
      const ptr = idx.conversations.find((x) => x.conversationId === c.conversationId); if (!ptr) return;
      const copy = { ...ptr, conversationId: chatStore.newId("conv"), title: ptr.title + " · copy", updatedAt: new Date().toISOString() };
      idx.conversations.unshift(copy);
      const b = new TextEncoder().encode(JSON.stringify(idx));
      await (chatStore.store.backend.putRaw ? chatStore.store.backend.putRaw("index:org.hologram.HoloQ", b) : chatStore.store.backend.put("index:org.hologram.HoloQ", b));
      render(); toast(t("com_ui_duplicate") + " ✓ (O(1) — shared by content)");
    };
    menuEl.querySelector('[data-a="del"]').onclick = async () => {
      closeMenu();
      if (!confirm(t("com_ui_delete_confirm"))) return;
      const idx = await chatStore.getIndex();
      idx.conversations = idx.conversations.filter((x) => x.conversationId !== c.conversationId);
      const b = new TextEncoder().encode(JSON.stringify(idx));
      await (chatStore.store.backend.putRaw ? chatStore.store.backend.putRaw("index:org.hologram.HoloQ", b) : chatStore.store.backend.put("index:org.hologram.HoloQ", b));
      if (state.convId === c.conversationId) act.newConversation();
      render();
    };
  }

  function inlineRename(rowEl, c) {
    const ttl = rowEl.querySelector(".ttl");
    const input = document.createElement("input"); input.className = "rename"; input.value = c.title || "";
    ttl.replaceWith(input); input.focus(); input.select();
    const commit = async () => {
      const v = input.value.trim() || "Chat";
      await chatStore.updatePointer(c.conversationId, { title: v });
      if (state.convId === c.conversationId) { state.title = v; els.chattitle.textContent = v; }
      render();
    };
    input.onkeydown = (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") render(); };
    input.onblur = commit;
    input.onclick = (e) => e.stopPropagation();
  }

  render();
  return { render };
}
