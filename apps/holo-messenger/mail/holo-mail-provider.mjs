// holo-mail-provider.mjs - SEAM B: the email provider, as a thin adapter over the email-bridge.
//
// Inbox Zero's logic consumes one abstraction (an EmailProvider yielding a canonical ParsedMessage). We
// already own the transport: email-bridge (:8793) speaks IMAP IDLE + SMTP and auto-configures every
// provider. This module implements the SAME method surface over the bridge's HTTP/SSE API, so the mail
// brain (holo-mail-rules/replyzero/cold/…) never knows whether it's Gmail, iCloud, or Fastmail underneath.
//
// It keeps a local corpus (thread -> messages), hydrated from the /events stream, so reads are instant and
// offline-first - the AI runs over local κ-cached mail, the bridge reconciles behind it. No model here.

const DEFAULT_BASE = "http://127.0.0.1:8793";
const LLM_CONTENT_CAP = 4000;   // trim body before it reaches Q - latency guard (classifiers cap tighter)

// One event off the bridge -> our canonical message. Only true message events carry extId; typed control
// frames (summary-delta / relogin-needed / typing) are skipped by the caller.
export function normalizeMessage(ev) {
  const text = ev.text || "";
  const atts = [];
  if (ev.media) atts.push({ id: ev.media.id, mimeType: ev.media.mime || "application/octet-stream", kind: ev.media.kind || "file" });
  return {
    id: ev.extId || ev.jid,
    threadId: ev.jid,
    from: ev.fromEmail || "",
    fromName: ev.sender || ev.fromEmail || "",
    to: Array.isArray(ev.toEmails) ? ev.toEmails : [],
    subject: ev.subject || "(no subject)",
    date: ev.sentAt || null,
    fromMe: !!ev.fromMe,
    text,
    snippet: text.replace(/\s+/g, " ").slice(0, 140),
    listUnsubscribe: ev.listUnsubscribe || "",
    attachments: atts,
    attachmentCount: ev.attachmentCount || atts.length,
  };
}

// The trimmed view the AI layer sees - matches Inbox Zero's EmailForLLM contract (functional), our shaping.
export function toEmailForLLM(msg, { contentCap = LLM_CONTENT_CAP } = {}) {
  return {
    id: msg.id,
    from: msg.fromName ? `${msg.fromName} <${msg.from}>` : msg.from,
    to: (msg.to || []).join(", "),
    subject: msg.subject,
    content: (msg.text || "").slice(0, contentCap),
    date: msg.date,
    listUnsubscribe: msg.listUnsubscribe || undefined,
    attachments: (msg.attachments || []).map((a) => ({ filename: a.id, mimeType: a.mimeType })),
  };
}

export function makeMailProvider({ base = DEFAULT_BASE, fetch = globalThis.fetch } = {}) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(base)) throw new Error(`holo-mail-provider: base must be loopback, got ${base}`);
  const corpus = new Map();   // threadId -> [msg] (chronological)
  const listeners = new Set();

  const j = async (path, init) => { const r = await fetch(base + path, init); if (!r.ok) throw new Error(`${path} → ${r.status}`); return r.json(); };

  function record(ev) {
    const msg = normalizeMessage(ev);
    const arr = corpus.get(msg.threadId) || [];
    if (arr.some((m) => m.id === msg.id)) return null;   // de-dup by message id
    arr.push(msg); arr.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    corpus.set(msg.threadId, arr);
    for (const cb of listeners) { try { cb(msg); } catch {} }
    return msg;
  }

  // ── reads (local-first) ──
  const status = () => j("/status");
  const listThreads = () => j("/summary");                                  // [{ jid, chat, preview, ts, unread, pinned, group }]
  const threadMessages = (jid) => (corpus.get(jid) || []).slice();          // from the local corpus
  const allMessages = () => [...corpus.values()].flat();
  const mediaUrl = (id) => `${base}/media/${encodeURIComponent(id)}`;
  const avatarUrl = (jid) => `${base}/avatar/${encodeURIComponent(jid)}`;

  // ── writes ──
  const sendReply = ({ chat, text }) => j("/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat, text }) });
  const markRead = (chat) => j("/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat }) });

  // ── live: drain the SSE /events stream into the corpus. Returns a stop() fn. ──
  async function connect({ signal } = {}) {
    const res = await fetch(base + "/events", { signal, headers: { Accept: "text/event-stream" } });
    if (!res.ok || !res.body) throw new Error(`/events → ${res.status}`);
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
            const line = frame.split("\n").find((l) => l.startsWith("data:")); if (!line) continue;
            let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
            if (ev.type) continue;              // skip typed control frames - only message events build the corpus
            record(ev);
          }
        }
      } catch { /* stream ended / cancelled */ }
    })();
    return () => { try { reader.cancel(); } catch {} };
  }

  const onMessage = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };

  return {
    status, listThreads, threadMessages, allMessages, mediaUrl, avatarUrl,
    sendReply, markRead, connect, onMessage, toEmailForLLM,
    _record: record,   // test seam
  };
}

export default { makeMailProvider, normalizeMessage, toEmailForLLM };
