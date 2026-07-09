// core/schema.js — lean, dependency-free validators ("zod-lite") for the LibreChat-faithful
// Conversation / Message / Preset shapes. Field names mirror LibreChat's data model (packages/
// data-schemas) so an exported conversation interoperates; values are validated/normalised, not
// hashed (the κ-object store is what makes them content-addressed). No build step, no dep.

const isStr = (v) => typeof v === "string";
const isBool = (v) => typeof v === "boolean";
const isNum = (v) => typeof v === "number" && !Number.isNaN(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const clampNum = (v, lo, hi, d) => (isNum(v) ? Math.min(hi, Math.max(lo, v)) : d);

// A chat message (one node in the parentMessageId tree).
export function normMessage(m = {}) {
  return {
    messageId: isStr(m.messageId) ? m.messageId : null,
    conversationId: isStr(m.conversationId) ? m.conversationId : null,
    parentMessageId: isStr(m.parentMessageId) ? m.parentMessageId : null,   // tree edge
    sender: isStr(m.sender) ? m.sender : (m.isCreatedByUser ? "User" : "Assistant"),
    isCreatedByUser: isBool(m.isCreatedByUser) ? m.isCreatedByUser : false,
    model: isStr(m.model) ? m.model : null,
    text: isStr(m.text) ? m.text : "",
    content: arr(m.content),                          // structured parts (text/tool/image/reasoning)
    tokenCount: isNum(m.tokenCount) ? m.tokenCount : null,
    error: m.error || null,
    unfinished: !!m.unfinished,
    feedback: m.feedback && isStr(m.feedback.rating || "") ? { rating: m.feedback.rating, tag: m.feedback.tag || null, text: m.feedback.text || "" } : (m.feedback || null),
    files: arr(m.files),
    createdAt: isStr(m.createdAt) ? m.createdAt : null,
    receiptKappa: isStr(m.receiptKappa) ? m.receiptKappa : null,             // links the PROV-O inference receipt
  };
}

// A conversation (spreads the active preset, like LibreChat's conversationPreset).
export function normConversation(c = {}) {
  return {
    conversationId: isStr(c.conversationId) ? c.conversationId : null,
    title: isStr(c.title) ? c.title : "New Chat",
    tags: arr(c.tags),
    files: arr(c.files),
    folder: isStr(c.folder) ? c.folder : null,
    archived: !!c.archived,
    favorite: !!c.favorite,
    isTemporary: !!c.isTemporary,
    preset: c.preset ? normPreset(c.preset) : null,
    createdAt: isStr(c.createdAt) ? c.createdAt : null,
    updatedAt: isStr(c.updatedAt) ? c.updatedAt : null,
  };
}

// A preset / parameter bundle. Bounds mirror common LLM ranges; model is the local κ-object id.
export function normPreset(p = {}) {
  return {
    presetId: isStr(p.presetId) ? p.presetId : null,
    title: isStr(p.title) ? p.title : "Preset",
    model: isStr(p.model) ? p.model : null,
    temperature: clampNum(p.temperature, 0, 2, 0),
    top_p: clampNum(p.top_p, 0, 1, 1),
    top_k: clampNum(p.top_k, 0, 200, 40),
    maxOutputTokens: clampNum(p.maxOutputTokens, 1, 8192, 1024),
    promptPrefix: isStr(p.promptPrefix) ? p.promptPrefix : "",
    presence_penalty: clampNum(p.presence_penalty, -2, 2, 0),
    frequency_penalty: clampNum(p.frequency_penalty, -2, 2, 0),
    stop: arr(p.stop),
    iconURL: isStr(p.iconURL) ? p.iconURL : null,
    isArchived: !!p.isArchived,
  };
}

// Walk a flat message list into the LibreChat parentMessageId tree → {roots, byId, childrenOf}.
export function buildTree(messages) {
  const byId = new Map(); const childrenOf = new Map(); const roots = [];
  for (const m of messages) { byId.set(m.messageId, m); childrenOf.set(m.messageId, []); }
  for (const m of messages) {
    if (m.parentMessageId && childrenOf.has(m.parentMessageId)) childrenOf.get(m.parentMessageId).push(m.messageId);
    else roots.push(m.messageId);
  }
  return { roots, byId, childrenOf };
}

// The active thread = follow the chosen child at each branch from a root to a leaf.
export function threadOf(tree, { choose = (siblings) => siblings[siblings.length - 1] } = {}) {
  const out = []; let cur = tree.roots.length ? choose(tree.roots) : null;
  while (cur) { out.push(tree.byId.get(cur)); const kids = tree.childrenOf.get(cur) || []; cur = kids.length ? choose(kids) : null; }
  return out;
}
