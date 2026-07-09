// holo-push-route.mjs - the heart of Holo Reach: turn a MINIMAL, content-blind push payload into a notification and a
// deep-link, and (on the sender side) build the minimal payload that's safe to put on the wire. Shared by the service
// worker AND node tests (pure logic - no DOM, no SW globals) so the "never leak / deep-link to the right surface"
// guarantees are verifiable. The golden rule: a SEALED message's content NEVER rides the push - the SW fetches +
// decrypts locally; the push service/OS only ever learn "you have something."

// ── build the notification a push should show (null ⇒ show nothing) ──
export function notificationFor(payload) {
  const p = payload || {};
  const who = p.name || "Someone";
  switch (p.t) {
    case "call":
      return { title: who + (p.video ? " · video call" : " · calling"), body: "Tap to answer", tag: "call:" + (p.room || p.chat || ""), requireInteraction: true, renotify: true, data: { route: p } };
    case "meet":
      return { title: (p.name || "A room") + " · meeting", body: "Tap to join", tag: "meet:" + (p.room || p.chat || ""), requireInteraction: true, data: { route: p } };
    case "pay":
      return { title: who + (p.kind === "request" ? " requests " : " sent you ") + (p.amount || "money"), body: "Tap to open", tag: "pay:" + (p.kappa || p.chat || ""), data: { route: p } };
    case "dm":   // native Holo message. SEALED ⇒ NEVER content - just a routable "sealed message" cue.
      return { title: who, body: p.sealed ? "🔒 New sealed message" : (p.preview || "New message"), tag: "dm:" + (p.chat || ""), data: { route: p } };
    case "bridge":   // a bridged network's message; preview is opt-in and explicitly NOT E2E.
      return { title: who, body: p.preview || "New message", tag: "chat:" + (p.chat || ""), data: { route: p } };
    case "together":
      return { title: who + " invited you", body: p.kind === "listen" ? "Listen together" : "Watch together", tag: "tog:" + (p.chat || ""), data: { route: p } };
    default:
      return null;   // unknown / Noise (filtered upstream in REACH-B) → nothing
  }
}

// ── where clicking the notification takes you ──
export function routeFor(payload) {
  const p = payload || {};
  if (p.t === "call") return { surface: "call", room: p.room, chat: p.chat };
  if (p.t === "meet") return { surface: "meet", room: p.room, chat: p.chat };
  if (p.t === "pay") return { surface: "chat", chat: p.chat, pay: p.kappa || null };
  if (p.t === "together") return { surface: "chat", chat: p.chat, together: true };
  return { surface: "chat", chat: p.chat };   // dm / bridge → open the chat
}

// ── build the MINIMAL, content-blind payload the sender puts on the wire ──
// This is what the push relay + the OS push service can see. For a sealed DM it carries NO content - only enough to
// route + a `sealed` flag; the SW fetches the ciphertext from the mailbox and decrypts on-device. A bridged/native
// preview is included ONLY when explicitly allowed AND the message isn't sealed.
export function pushEnvelope(o = {}) {
  const t = o.t, e = { t, name: o.name || "", chat: o.chat || "", ts: o.nowMs || Date.now() };
  if (t === "call" || t === "meet") { if (o.room) e.room = o.room; e.video = !!o.video; }
  else if (t === "pay") { e.amount = o.amount || ""; e.kind = o.payKind || "send"; if (o.kappa) e.kappa = o.kappa; }
  else if (t === "dm") { e.sealed = !!o.sealed; if (o.allowPreview && !o.sealed && o.preview) e.preview = String(o.preview).slice(0, 140); }
  else if (t === "bridge") { if (o.allowPreview && o.preview) e.preview = String(o.preview).slice(0, 140); }
  else if (t === "together") { e.kind = o.kind || "watch"; }
  return e;
}

// does this payload carry any user content? (a test/audit helper - sealed DMs must return false)
export function leaksContent(payload) { const p = payload || {}; return !!(p.preview || p.body || p.text || p.message); }
