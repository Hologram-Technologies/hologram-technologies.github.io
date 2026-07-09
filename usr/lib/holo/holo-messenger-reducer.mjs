// holo-messenger-reducer.mjs — holowhat's messenger reducer, vendored VERBATIM (the pure fold; its
// holo-apps.js dep is only used by createMessengerApp, not the reducer). Source:
// github.com/afflom/holowhat — crates/holospaces-web/web/assets/scripts/holo-messenger.js.
//
// Deterministic reducer: a topologically-sorted, decrypted array of events { id, author, clock, kind,
// payload } folds into { messages, rootMessages } with reactions, edits (author-gated), replies and
// thread hierarchy. We feed it OUR signed + epoch-sealed §2.6 events (P4-proven) and render its projection
// — so the surface gains holowhat's message affordances on top of our verify-before-trust substrate.
//
// Kinds: 'message' (Create) · 'edit' (Update, original author only) · 'reaction' (Like) · 'delete'
// (original author only). Unchanged from holowhat.

export function messengerReducer(events) {
  const messageMap = new Map();

  for (const ev of events) {
    const payload = ev.payload || {};
    const type = payload.type || "";

    if (ev.kind === "message" || type === "Create") {
      const body = payload.object?.content || payload.body;
      const timestamp = payload.object?.published
        ? new Date(payload.object.published).getTime()
        : (payload.timestamp || 0);
      const parentId = payload.object?.inReplyTo || payload.parentId || null;
      const attachment = payload.object?.attachment || payload.attachment || null;

      messageMap.set(ev.id, {
        id: ev.id, author: ev.author, clock: ev.clock, body, parentId, timestamp, attachment,
        reactions: new Map(), edits: [], replies: [],
      });
    } else if (ev.kind === "edit" || type === "Update") {
      const targetId = payload.object?.id || payload.target;
      const body = payload.object?.content || payload.body;
      if (messageMap.has(targetId)) {
        const msg = messageMap.get(targetId);
        if (msg.author === ev.author) {                 // only the original author can edit
          msg.edits.push({ id: ev.id, author: ev.author, clock: ev.clock, body });
          msg.body = body;
        }
      }
    } else if (ev.kind === "reaction" || type === "Like") {
      const targetId = payload.object || payload.target;
      const symbol = payload.content || payload.symbol;
      if (messageMap.has(targetId)) {
        const msg = messageMap.get(targetId);
        if (!msg.reactions.has(symbol)) msg.reactions.set(symbol, new Set());
        msg.reactions.get(symbol).add(ev.author);
      }
    } else if (ev.kind === "delete" || type === "Delete") {
      const targetId = payload.object?.id || payload.target || (typeof payload.object === "string" ? payload.object : null);
      if (targetId && messageMap.has(targetId)) {
        const msg = messageMap.get(targetId);
        if (msg.author === ev.author) messageMap.delete(targetId);   // only the original author can retract
      }
    }
  }

  const rootMessages = [];
  for (const msg of messageMap.values()) {
    if (msg.parentId && messageMap.has(msg.parentId)) messageMap.get(msg.parentId).replies.push(msg.id);
    else rootMessages.push(msg);
  }

  const formatReactions = (m) => { const list = []; for (const [symbol, authors] of m.entries()) list.push({ symbol, count: authors.size, authors: Array.from(authors) }); return list; };
  const messagesList = Array.from(messageMap.values()).map((msg) => ({ ...msg, reactions: formatReactions(msg.reactions) }));

  return {
    messages: messagesList.sort((a, b) => (a.clock !== b.clock ? a.clock - b.clock : a.id.localeCompare(b.id))),
    rootMessages: rootMessages.map((m) => m.id),
  };
}

if (typeof window !== "undefined" && !window.HoloMessengerReducer) window.HoloMessengerReducer = { messengerReducer };
