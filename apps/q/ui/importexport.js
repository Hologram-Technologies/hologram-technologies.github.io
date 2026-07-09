// ui/importexport.js — conversation interchange. Export the active conversation as JSON (the
// full branch tree with κ addresses — verifiable elsewhere), Markdown, or plain text; export
// everything from Settings → Data; import the JSON back (messages re-seal to the SAME κ when
// the content is identical — content addressing makes import idempotent, Law L1/L3).

function download(name, mime, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const slug = (s) => (s || "chat").toLowerCase().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "chat";

// Serialize the active conversation's WHOLE tree (all branches), LibreChat-style fields.
export function serializeConversation({ state, rows }) {
  const messages = [...rows.values()].map((r) => ({
    messageId: r.id, parentMessageId: r.parentMessageId, conversationId: state.convId,
    sender: r.sender, isCreatedByUser: r.isCreatedByUser, model: r.model || undefined,
    text: r.text, tokenCount: r.tokenCount ?? undefined, tokenIds: r.tokenIds ?? undefined,
    feedback: r.feedback ?? undefined, createdAt: r.createdAt,
    kappa: r.kappa, receiptKappa: r.receiptKappa ?? undefined,
  }));
  return {
    exporter: "holo-q", format: "librechat-tree-v1",
    conversationId: state.convId, title: state.title, conversationKappa: state.convKappa,
    preset: state.preset || undefined, exportedAt: new Date().toISOString(),
    messages,
  };
}

export function exportConversation(ctx, chat, kind) {
  const rows = chat.rowsRef(); const { state } = ctx;
  if (!rows.size) return;
  if (kind === "json") return download(slug(state.title) + ".json", "application/json", JSON.stringify(serializeConversation({ state, rows }), null, 2));
  const thread = chat.activeThread();
  if (kind === "md") {
    const md = [`# ${state.title}`, ""];
    for (const m of thread) md.push(`**${m.isCreatedByUser ? "User" : m.model || "Assistant"}**`, "", m.text, "");
    if (state.convKappa) md.push(`---`, `conversation κ: \`${state.convKappa}\``);
    return download(slug(state.title) + ".md", "text/markdown", md.join("\n"));
  }
  const txt = thread.map((m) => `${m.isCreatedByUser ? "User" : "Assistant"}: ${m.text}`).join("\n\n");
  return download(slug(state.title) + ".txt", "text/plain", txt);
}

export async function exportAll(ctx) {
  const { chatStore } = ctx;
  const ptrs = await chatStore.listConversations();
  const convs = [];
  for (const p of ptrs) {
    const loaded = await chatStore.loadConversation(p.conversationId);
    if (!loaded) continue;
    // walk the tree exactly like the controller does
    const seen = new Set(); const messages = [];
    async function walkUp(kappa) {
      if (!kappa || seen.has(kappa)) return; seen.add(kappa);
      const obj = await chatStore.store.getObj(kappa); if (!obj) return;
      messages.push({
        messageId: obj["schema:identifier"], parentMessageId: obj["lc:parentMessageId"] || null,
        sender: obj["lc:sender"], isCreatedByUser: !!obj["lc:isCreatedByUser"], model: obj["lc:model"] || undefined,
        text: obj["schema:text"] || "", tokenIds: obj["lc:tokenIds"] || undefined,
        feedback: obj["lc:feedback"] || undefined, createdAt: obj["schema:dateCreated"], kappa,
        receiptKappa: (obj.links || []).find((l) => l.rel === "lc:receipt")?.id || undefined,
      });
      const pl = (obj.links || []).find((l) => l.rel === "lc:parentMessage");
      if (pl) await walkUp(pl.id);
    }
    for (const l of (loaded.conv.links || []).filter((l) => l.rel === "lc:head" || l.rel === "lc:branchTip")) await walkUp(l.id);
    convs.push({ conversationId: p.conversationId, title: p.title, conversationKappa: p.kappa, integrity: loaded.ok, messages });
  }
  download("holo-q-export.json", "application/json", JSON.stringify({ exporter: "holo-q", format: "librechat-tree-v1", exportedAt: new Date().toISOString(), conversations: convs }, null, 2));
}

// Import: accepts our export (single or all). Messages re-seal through the normal save path —
// identical content re-derives the identical κ (idempotent, dedup'd by the substrate).
export async function importFile(ctx) {
  const { chatStore } = ctx;
  const file = await pickFile(".json"); if (!file) return -1;
  let doc; try { doc = JSON.parse(await file.text()); } catch { return -1; }
  const convs = doc.conversations || (doc.messages ? [doc] : []);
  let n = 0;
  for (const c of convs) {
    const convId = chatStore.newId("conv");
    const byId = new Map((c.messages || []).map((m) => [m.messageId, m]));
    const sealedById = new Map();
    async function sealUp(m) {
      if (sealedById.has(m.messageId)) return sealedById.get(m.messageId);
      const parent = m.parentMessageId && byId.has(m.parentMessageId) ? await sealUp(byId.get(m.parentMessageId)) : null;
      const sealed = await chatStore.saveMessage({
        messageId: m.messageId, conversationId: convId, sender: m.sender || (m.isCreatedByUser ? "User" : "Assistant"),
        isCreatedByUser: !!m.isCreatedByUser, model: m.model || null, text: m.text || "",
        tokenCount: m.tokenCount ?? null, tokenIds: m.tokenIds || null, feedback: m.feedback || null,
        createdAt: m.createdAt, parent,
      });
      sealedById.set(m.messageId, sealed);
      return sealed;
    }
    for (const m of byId.values()) await sealUp(m);
    // head = a message with no children
    const hasChild = new Set([...byId.values()].map((m) => m.parentMessageId).filter(Boolean));
    const leaves = [...byId.values()].filter((m) => !hasChild.has(m.messageId));
    const head = leaves.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1);
    if (head) {
      await chatStore.saveConversation({
        conversationId: convId, title: c.title || "Imported chat", preset: c.preset || null,
        headMessage: sealedById.get(head.messageId),
        branchTips: leaves.filter((m) => m !== head).map((m) => sealedById.get(m.messageId)).slice(0, 24),
      });
      n++;
    }
  }
  return n;
}

function pickFile(accept) {
  return new Promise((res) => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = accept;
    i.onchange = () => res(i.files[0] || null);
    i.oncancel = () => res(null);
    i.click();
  });
}
