// holo-mail-summary.mjs - M2/1: Auto-Summarize. One present-tense sentence per thread, computed on Q,
// cached as a signed κ-link so it survives reload and recomputes ONLY when a new message lands.
//
// Pure + injectable: takes the two proven seams (ai = holo-mail-ai, provider = holo-mail-provider) plus a
// strand (holo-strand) for durable, verifiable, reversible storage. No model, no network here. Law L5:
// if Q yields nothing, there is no summary - never a fabricated one.

const SYS =
  "You summarize an email thread in ONE short, present-tense sentence - the essence only. " +
  "No preamble, no quotes, no sign-off, no more than one sentence.";

export function makeMailSummary({ ai, provider, strand = null, now = () => new Date().toISOString() } = {}) {
  const mem = new Map();   // jid -> { jid, lastId, summary, kappa, ts } - fast in-proc κ-memo

  function promptFor(msgs) {
    const body = msgs
      .map((m) => provider.toEmailForLLM(m, { contentCap: 600 }))
      .map((v) => `${v.date || ""} ${v.from} - ${v.subject}\n${v.content}`)
      .join("\n---\n");
    return `Summarize this email thread in one sentence:\n\n${body}`;
  }

  // durable memo: the most recent mail:summary κ-link recorded for this thread (survives reload).
  function durableGet(jid) {
    if (!strand || typeof strand.replay !== "function") return null;
    const rows = strand.replay({ kind: "mail:summary" });
    for (let i = rows.length - 1; i >= 0; i--) {
      const p = rows[i]["holstr:payload"];
      if (p && p.jid === jid) return p;
    }
    return null;
  }

  async function summarize(jid, { force = false } = {}) {
    const msgs = provider.threadMessages(jid);
    if (!msgs || !msgs.length) return null;
    const lastId = msgs[msgs.length - 1].id;

    if (!force) {
      const hot = mem.get(jid);
      if (hot && hot.lastId === lastId) return { ...hot, cached: "hot" };
      const cold = durableGet(jid);
      if (cold && cold.lastId === lastId) { mem.set(jid, cold); return { ...cold, cached: "chain" }; }
    }

    const summary = (await ai.qGenerateText({ system: SYS, prompt: promptFor(msgs), label: "summarize" }))
      .replace(/\s+/g, " ").trim();

    const ts = now();
    let kappa = null;
    if (strand && typeof strand.append === "function") {
      const rec = await strand.append({ kind: "mail:summary", payload: { jid, lastId, summary, ts } });
      kappa = rec.id;
    }
    const out = { jid, lastId, summary, kappa, ts };
    mem.set(jid, out);
    return { ...out, cached: false };
  }

  async function summarizeAll(jids) {
    const out = [];
    for (const jid of jids) { try { out.push(await summarize(jid)); } catch { out.push(null); } }
    return out;
  }

  const get = (jid) => mem.get(jid) || durableGet(jid);

  return { summarize, summarizeAll, get };
}

export default { makeMailSummary };
