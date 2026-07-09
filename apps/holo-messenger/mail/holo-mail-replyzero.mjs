// holo-mail-replyzero.mjs - M2/2: Reply Zero. Classify each thread from the OPERATOR's point of view into
// TO_REPLY / AWAITING_REPLY / FYI / ACTIONED, so "what do I owe a reply to" is one glance. On Q via Seam A's
// qGenerateObject; every verdict a signed κ-link (kind:"mail:status"), cached by thread+last-message.
//
// Pure + injectable ({ ai, provider, strand }). No model/network here. Law L5: no brain → no verdict.

export const STATUS_SCHEMA = {
  type: "object",
  required: ["status", "rationale"],
  fields: {
    status: { type: "enum", values: ["TO_REPLY", "AWAITING_REPLY", "FYI", "ACTIONED"] },
    rationale: { type: "string" },
  },
};

// Author's own decision rules (clean-room). Q judges the WHOLE thread, not just the last message.
const SYS =
  "You classify an email thread from the reader's point of view (messages marked 'You:' are the reader's). " +
  "Choose exactly one status:\n" +
  "TO_REPLY - the reader has an unanswered question, an unmet request, or a promise they still owe.\n" +
  "AWAITING_REPLY - the reader asked/requested and is waiting on someone else; the ball is not in their court.\n" +
  "FYI - informational only, no action needed from the reader.\n" +
  "ACTIONED - every question is answered and every request fulfilled; the thread is done.\n" +
  "Read every message. A fulfilled request is no longer awaited. In multi-person threads weigh only the reader's obligations.";

const LANES = { TO_REPLY: "toReply", AWAITING_REPLY: "awaiting", FYI: "fyi", ACTIONED: "actioned" };

export function makeMailReplyZero({ ai, provider, strand = null, now = () => new Date().toISOString() } = {}) {
  const mem = new Map();   // jid -> { jid, lastId, status, rationale, kappa, ts }

  function promptFor(msgs) {
    const body = msgs
      .map((m) => {
        const v = provider.toEmailForLLM(m, { contentCap: 500 });
        return `${m.fromMe ? "You" : v.from} - ${v.subject}\n${v.content}`;
      })
      .join("\n---\n");
    return `Classify this thread's status for the reader:\n\n${body}`;
  }

  function durableGet(jid) {
    if (!strand || typeof strand.replay !== "function") return null;
    const rows = strand.replay({ kind: "mail:status" });
    for (let i = rows.length - 1; i >= 0; i--) { const p = rows[i]["holstr:payload"]; if (p && p.jid === jid) return p; }
    return null;
  }

  async function classify(jid, { force = false } = {}) {
    const msgs = provider.threadMessages(jid);
    if (!msgs || !msgs.length) return null;
    const lastId = msgs[msgs.length - 1].id;

    if (!force) {
      const hot = mem.get(jid);
      if (hot && hot.lastId === lastId) return { ...hot, cached: "hot" };
      const cold = durableGet(jid);
      if (cold && cold.lastId === lastId) { mem.set(jid, cold); return { ...cold, cached: "chain" }; }
    }

    const verdict = await ai.qGenerateObject({ system: SYS, prompt: promptFor(msgs), schema: STATUS_SCHEMA, label: "thread-status" });
    const ts = now();
    let kappa = null;
    if (strand && typeof strand.append === "function") {
      const rec = await strand.append({ kind: "mail:status", payload: { jid, lastId, status: verdict.status, rationale: verdict.rationale, ts } });
      kappa = rec.id;
    }
    const out = { jid, lastId, status: verdict.status, rationale: verdict.rationale, kappa, ts };
    mem.set(jid, out);
    return { ...out, cached: false };
  }

  // lanes(jids) → { toReply, awaiting, fyi, actioned } - TO_REPLY is what the Reply-Zero lane shows first.
  async function lanes(jids) {
    const buckets = { toReply: [], awaiting: [], fyi: [], actioned: [] };
    for (const jid of jids) {
      let r; try { r = await classify(jid); } catch { r = null; }
      if (r && LANES[r.status]) buckets[LANES[r.status]].push(r);
    }
    return buckets;
  }

  const get = (jid) => mem.get(jid) || durableGet(jid);

  return { classify, lanes, get };
}

export default { makeMailReplyZero, STATUS_SCHEMA };
