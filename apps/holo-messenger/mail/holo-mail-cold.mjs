// holo-mail-cold.mjs - M2/4: cold-email blocker. Staged: (1) a learned κ-tag for the sender, (2) any prior
// two-way correspondence in the corpus, (3) else Q classifies (Seam A qGenerateObject). Cold mail gets its
// own lane and never touches Important. Pure + injectable. False positives are markable → learned exclusion.

export const COLD_SCHEMA = {
  type: "object",
  required: ["coldEmail", "reason"],
  fields: { coldEmail: { type: "boolean" }, reason: { type: "string" } },
};

const SYS =
  "You decide if an email is a COLD email - unsolicited outreach the reader never invited, typically " +
  "selling a product/service, recruiting, or pitching a partnership. NOT cold: investors, warm intros, " +
  "existing customers, receipts, newsletters, and automated notifications. Answer with coldEmail + a short reason.";

export function makeMailCold({ ai, provider, strand = null, now = () => new Date().toISOString() } = {}) {
  // learned tags: sender -> true(cold)/false(not-cold), most-recent wins.
  function tagOf(sender) {
    if (!strand || typeof strand.replay !== "function") return null;
    const rows = strand.replay({ kind: "mail:cold-tag" });
    for (let i = rows.length - 1; i >= 0; i--) { const p = rows[i]["holstr:payload"]; if (p && p.sender === sender) return p.cold; }
    return null;
  }
  async function mark(sender, cold) {
    if (strand && typeof strand.append === "function") await strand.append({ kind: "mail:cold-tag", payload: { sender, cold: !!cold, ts: now() } });
  }
  const markCold = (s) => mark(s, true);
  const markNotCold = (s) => mark(s, false);   // exclusion: rescue a false positive

  // prior correspondence = the reader ever sent TO this address (engaged) or exchanged before.
  function hasHistory(sender) {
    for (const m of provider.allMessages ? provider.allMessages() : []) {
      if (m.fromMe && Array.isArray(m.to) && m.to.includes(sender)) return true;
    }
    return false;
  }

  // classify one inbound message. Returns { cold, reason, stage } - stage names WHICH rule decided (honesty).
  async function isCold(msg) {
    const sender = msg.from;
    if (msg.fromMe) return { cold: false, reason: "own message", stage: "self" };
    const tag = tagOf(sender);
    if (tag !== null) return { cold: tag, reason: tag ? "known cold sender" : "sender marked not-cold", stage: "tag" };
    if (hasHistory(sender)) return { cold: false, reason: "prior correspondence", stage: "history" };
    const v = await ai.qGenerateObject({
      system: SYS, schema: COLD_SCHEMA, label: "cold-email",
      prompt: `From: ${msg.fromName ? `${msg.fromName} <${sender}>` : sender}\nSubject: ${msg.subject}\n\n${(msg.text || "").slice(0, 500)}`,
    });
    return { cold: !!v.coldEmail, reason: v.reason, stage: "ai" };
  }

  return { isCold, tagOf, markCold, markNotCold, hasHistory };
}

export default { makeMailCold, COLD_SCHEMA };
