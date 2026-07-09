// core/store.js — the κ-object CONVERSATION STORE. Conversations are NOT database rows; each
// Message and each Conversation is a self-verifying UOR object (a canonical JSON-LD document whose
// identity is did:holo:sha256 of its own content), and the LibreChat parentMessageId tree is
// expressed as content-addressed LINKS so a child's κ commits to its parent's κ — a Merkle-DAG
// (Law L3 dedup, Law L5 verify-on-resolve). The object envelope mirrors _shared/holo-object.mjs
// byte-for-byte (same UOR_CONTEXT, same address() = H(canonical without id), same link digests),
// but is implemented here over Web Crypto (core/kappa.js) so it runs in the browser AND in the
// pure-Node witness. Bytes are persisted through a pluggable BACKEND: holo-kstore (IndexedDB) in
// the app, a Map in the witness. No server; everything is content-addressed and re-derivable.

import { jcs, sha256hex, didHolo } from "./kappa.js";

const _enc = new TextEncoder();
const _dec = new TextDecoder();

// The base envelope @context — identical to _shared/holo-object.mjs.
export const UOR_CONTEXT = [
  "https://www.w3.org/ns/did/v1",
  "https://w3id.org/security/data-integrity/v2",
  { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", dcterms: "http://purl.org/dc/terms/",
    rel: "schema:additionalType", links: { "@id": "schema:hasPart", "@container": "@set" } },
];

const hexOf = (did) => String(did).split(":").pop();
const _b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
const _b64url = (u8) => _b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sha256raw(u8) { return new Uint8Array(await crypto.subtle.digest("SHA-256", u8)); }
async function sriOf(u8) { return "sha256-" + _b64(await sha256raw(u8)); }
async function mbOf(u8) { const d = await sha256raw(u8); const mh = new Uint8Array(d.length + 2); mh[0] = 0x12; mh[1] = 0x20; mh.set(d, 2); return "u" + _b64url(mh); }

// address(obj): self-verifying identity = did:holo:sha256:H(canonical content with id/alsoKnownAs removed).
const stripId = (obj) => { const { id, alsoKnownAs, ...content } = obj; return content; };
const addressOf = (obj) => didHolo(stripId(obj));
const canonStored = (sealed) => _enc.encode(jcs(sealed));   // the EXACT bytes a link's digest commits to (sealed, WITH id — mirrors holo-object put())

// contentLink(rel, kappa): a LEAF edge to raw content already addressed by its κ (no bytes needed) —
// identical to holo-object.contentLink. Verified at resolve by re-hashing the raw bytes to the address.
export function contentLink(rel, kappa, type = "schema:MediaObject") {
  const hex = String(kappa).split(":").pop();
  const digest = Uint8Array.from(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const mh = new Uint8Array(digest.length + 2); mh[0] = 0x12; mh[1] = 0x20; mh.set(digest, 2);
  return { id: `did:holo:sha256:${hex}`, rel, "@type": type, leaf: true, digestSRI: "sha256-" + _b64(digest), digestMultibase: "u" + _b64url(mh) };
}

// makeStore(backend) — backend = { get(hex)→Promise<Uint8Array|undefined>, put(hex,bytes)→Promise,
// putRaw?(key,bytes)/getRaw?(key) for the boot-index pointer record }.
export function makeStore(backend) {
  const mem = new Map();   // hex → Uint8Array (session cache; sync verifyDeep operates over it)

  async function putObj(obj) {
    const sealed = { ...obj, id: await addressOf(obj) };
    const bytes = canonStored(sealed);
    const hex = hexOf(sealed.id);
    mem.set(hex, bytes);
    await backend.put(hex, bytes);
    return sealed;
  }
  async function getBytes(did) { const hex = hexOf(did); let b = mem.get(hex); if (b) return b; b = await backend.get(hex); if (b) mem.set(hex, b); return b; }
  async function getObj(did) { const b = await getBytes(did); return b ? JSON.parse(_dec.decode(b)) : null; }

  // a typed Merkle edge to a sealed UOR child (the digest commits to the child's stored bytes).
  async function uorLink(rel, child) {
    const bytes = mem.get(hexOf(child.id)) || await backend.get(hexOf(child.id));
    return { id: child.id, rel, "@type": child["@type"], digestSRI: await sriOf(bytes), digestMultibase: await mbOf(bytes) };
  }

  // build + seal + store a UOR object. `links` already built (children stored first → Merkle).
  async function makeObject({ type, context = [], links = [], ...props }) {
    const obj = { "@context": [...UOR_CONTEXT, ...context], "@type": type, ...props, ...(links.length ? { links } : {}) };
    return putObj(obj);
  }

  const verify = async (obj) => obj.id === await addressOf(obj);

  // verifyDeep — re-derive + verify the WHOLE DAG (Law L5 at every level). Pre-loads links into mem.
  async function verifyDeep(obj, depth = 0) {
    if (!(await verify(obj))) return { ok: false, at: obj.id, why: "id does not re-derive", depth };
    let maxDepth = depth;
    for (const link of obj.links || []) {
      const bytes = await getBytes(link.id);
      if (!bytes) return { ok: false, at: link.id, why: "unresolved link", depth };
      if ((await sriOf(bytes)) !== link.digestSRI) return { ok: false, at: link.id, why: "link digest mismatch", depth };
      if (link.leaf) { if ((await sha256hex(bytes)) !== hexOf(link.id)) return { ok: false, at: link.id, why: "content hash mismatch", depth }; maxDepth = Math.max(maxDepth, depth + 1); continue; }
      const child = JSON.parse(_dec.decode(bytes));
      if (child.id !== link.id) return { ok: false, at: link.id, why: "id/link mismatch", depth };
      const r = await verifyDeep(child, depth + 1); if (!r.ok) return r; maxDepth = Math.max(maxDepth, r.depth);
    }
    return { ok: true, depth: maxDepth };
  }

  // tamper helper (for the witness): overwrite a stored object's bytes with a flipped field.
  async function _corrupt(did, mutate) { const o = await getObj(did); mutate(o); const bytes = canonStored(o); mem.set(hexOf(did), bytes); await backend.put(hexOf(did), bytes); }

  return { makeObject, putObj, getObj, getBytes, uorLink, contentLink, verify, verifyDeep, mem, backend, _corrupt };
}

// ── high-level chat API over a κ-object store ───────────────────────────────────────────────
// LibreChat-faithful field names. parentMessageId → an "lc:parentMessage" content-addressed link.
const LC = { lc: "https://librechat.ai/ns#" };
const rid = (p) => p + "-" + Math.random().toString(36).slice(2, 12);   // id is a human handle; substrate identity is the κ

export function makeChatStore(backend, { now = () => new Date().toISOString() } = {}) {
  const S = makeStore(backend);
  const INDEX_KEY = "index:org.hologram.HoloQ";
  const getIndex = async () => { try { const b = await (backend.getRaw ? backend.getRaw(INDEX_KEY) : backend.get(INDEX_KEY)); return b ? JSON.parse(_dec.decode(b)) : { conversations: [], presets: [] }; } catch { return { conversations: [], presets: [] }; } };
  const putIndex = async (idx) => { const b = _enc.encode(JSON.stringify(idx)); return backend.putRaw ? backend.putRaw(INDEX_KEY, b) : backend.put(INDEX_KEY, b); };

  // Persist a PROV-O inference receipt as raw content addressed by its own κ (rec.id = H(jcs(body))),
  // so a message's contentLink("lc:receipt", rec.id) leaf-verifies (sha256(stored bytes) === κ).
  async function saveReceipt(rec) {
    const bytes = _enc.encode(jcs(rec.body));
    const hex = String(rec.id).split(":").pop();
    S.mem.set(hex, bytes); await backend.put(hex, bytes);
    return rec.id;
  }

  // Save one message as a κ-object. `parent` (a sealed message object) is a Merkle uorLink — the
  // branch tree, so the child's κ commits to the parent's κ. receiptKappa is a leaf content-link.
  // tokenIds (the turn's exact token sequence) makes context reconstruction and Law-L5
  // re-derivation possible after a cold reload.
  async function saveMessage({ messageId, conversationId, sender, isCreatedByUser, model, text, content, tokenCount, tokenIds, error, unfinished, feedback, fromMemo, toolTrace, createdAt, parent, receiptKappa, toolReceiptKappas = [], files = [] }) {
    const links = [];
    if (parent) links.push({ ...(await S.uorLink("lc:parentMessage", parent)), "schema:name": "parentMessageId" });
    if (receiptKappa) links.push({ ...S.contentLink("lc:receipt", receiptKappa, "prov:Activity"), "schema:name": "receipt" });
    for (const k of toolReceiptKappas) links.push({ ...S.contentLink("lc:toolReceipt", k, "prov:Activity"), "schema:name": "toolReceipt" });
    for (const f of files) links.push({ ...S.contentLink("schema:associatedMedia", f.kappa, "schema:MediaObject"), "schema:name": f.name });
    return S.makeObject({
      type: ["schema:Message", "prov:Entity"], context: [LC],
      "schema:identifier": messageId || rid("msg"), "lc:conversationId": conversationId,
      "lc:parentMessageId": (parent && parent["schema:identifier"]) || null,   // the human handle of the parent (for export/tree rebuild)
      "lc:sender": sender, "lc:isCreatedByUser": !!isCreatedByUser, "lc:model": model || null,
      "schema:text": text || "", "lc:content": content || null, "lc:tokenCount": tokenCount ?? null,
      "lc:tokenIds": tokenIds || null, "lc:fromMemo": !!fromMemo,
      "lc:toolTrace": toolTrace || null,
      "lc:error": error || null, "lc:unfinished": !!unfinished, "lc:feedback": feedback || null,
      "schema:dateCreated": createdAt || now(),
      links,
    });
  }

  // Save the conversation κ-object → links to the head (active leaf) + branch tips. Re-sealed each turn.
  async function saveConversation({ conversationId, title, tags, files, preset, createdAt, headMessage, branchTips = [] }) {
    const links = [];
    if (headMessage) links.push({ ...(await S.uorLink("lc:head", headMessage)), "schema:name": "head" });
    for (const t of branchTips) links.push({ ...(await S.uorLink("lc:branchTip", t)), "schema:name": "tip" });
    const conv = await S.makeObject({
      type: ["schema:Conversation", "prov:Collection"], context: [LC],
      "schema:identifier": conversationId, "schema:name": title || "New Chat",
      "lc:tags": tags || [], "lc:files": files || [], "lc:preset": preset || null,
      "schema:dateCreated": createdAt || now(), "schema:dateModified": now(),
      links,
    });
    // update the boot index (pointer-only; the conversation itself is verifiable)
    const idx = await getIndex();
    const ptr = { conversationId, kappa: conv.id, title: conv["schema:name"], updatedAt: conv["schema:dateModified"], archived: false, favorite: false, folder: null };
    const i = idx.conversations.findIndex((c) => c.conversationId === conversationId);
    if (i >= 0) idx.conversations[i] = { ...idx.conversations[i], ...ptr }; else idx.conversations.unshift(ptr);
    await putIndex(idx);
    return conv;
  }

  async function listConversations() { return (await getIndex()).conversations; }
  async function updatePointer(conversationId, patch) { const idx = await getIndex(); const i = idx.conversations.findIndex((c) => c.conversationId === conversationId); if (i >= 0) { idx.conversations[i] = { ...idx.conversations[i], ...patch }; await putIndex(idx); } }
  async function loadConversation(conversationId) {
    const idx = await getIndex(); const ptr = idx.conversations.find((c) => c.conversationId === conversationId); if (!ptr) return null;
    const conv = await S.getObj(ptr.kappa); if (!conv) return null;
    const v = await S.verifyDeep(conv);
    return { conv, kappa: ptr.kappa, ok: v.ok, integrity: v };
  }
  const verifyConversation = async (kappa) => { const conv = await S.getObj(kappa); return conv ? S.verifyDeep(conv) : { ok: false, why: "not found" }; };

  return { store: S, saveReceipt, saveMessage, saveConversation, listConversations, loadConversation, verifyConversation, updatePointer, getIndex, newId: rid };
}

// A simple Map backend (the witness uses this; the app wraps holo-kstore instead).
export function mapBackend() {
  const m = new Map();
  return {
    get: async (hex) => m.get(hex),
    put: async (hex, bytes) => { m.set(hex, bytes); },
    getRaw: async (k) => m.get(k),
    putRaw: async (k, bytes) => { m.set(k, bytes); },
    _map: m,
  };
}
