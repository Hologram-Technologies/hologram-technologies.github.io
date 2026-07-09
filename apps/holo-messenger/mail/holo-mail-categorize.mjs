// holo-mail-categorize.mjs - M2/3: smart labels / split-inbox. Bulk-categorize SENDERS against a user
// taxonomy on Q (Seam A qGenerateObject); hallucinated categories are coerced to "Other"; each sender→
// category is a signed κ-tag (kind:"mail:category") the lanes/tabs read. Pure + injectable.

export const SENDERS_SCHEMA = {
  type: "object",
  required: ["senders"],
  fields: {
    senders: {
      type: "array",
      items: {
        type: "object",
        required: ["sender", "category"],
        fields: { sender: { type: "string" }, category: { type: "string" }, rationale: { type: "string", nullable: true } },
      },
    },
  },
};

export const DEFAULT_TAXONOMY = [
  { name: "Important", description: "a real person who needs the reader's attention" },
  { name: "Team", description: "colleagues, internal threads" },
  { name: "News", description: "newsletters, digests, marketing, product updates" },
  { name: "Notifications", description: "automated alerts, receipts, calendar, no-reply" },
];

const SYS =
  "You assign each email sender to exactly one of the given categories, using their address and recent " +
  "subjects. If unclear or none fit, use \"Other\". Only ever use a category from the provided list (or \"Other\").";

export function makeMailCategorize({ ai, provider, strand = null, now = () => new Date().toISOString(), taxonomy = DEFAULT_TAXONOMY } = {}) {
  const mem = new Map();   // sender -> category

  // Build a sender list from the local corpus: address + a few recent subjects.
  function sendersFromCorpus({ max = 40 } = {}) {
    const by = new Map();
    for (const m of provider.allMessages ? provider.allMessages() : []) {
      if (m.fromMe || !m.from) continue;
      const s = by.get(m.from) || { emailAddress: m.from, samples: [] };
      if (s.samples.length < 3) s.samples.push({ subject: m.subject, snippet: m.snippet });
      by.set(m.from, s);
    }
    return [...by.values()].slice(0, max);
  }

  function promptFor(senders, categories) {
    const cats = categories.map((c) => `- ${c.name}: ${c.description}`).join("\n");
    const body = senders
      .map((s) => `${s.emailAddress}\n` + (s.samples || []).map((e) => `  · ${e.subject}`).join("\n"))
      .join("\n");
    return `Categories:\n${cats}\n\nSenders:\n${body}`;
  }

  async function categorize(senders, { categories = taxonomy } = {}) {
    if (!senders || !senders.length) return [];
    const allowed = new Set([...categories.map((c) => c.name), "Other"]);
    const out = await ai.qGenerateObject({ system: SYS, prompt: promptFor(senders, categories), schema: SENDERS_SCHEMA, label: "categorize" });
    const rows = out.senders.map((r) => ({ sender: r.sender, category: allowed.has(r.category) ? r.category : "Other" }));
    const ts = now();
    for (const r of rows) {
      mem.set(r.sender, r.category);
      if (strand && typeof strand.append === "function") await strand.append({ kind: "mail:category", payload: { ...r, ts } });
    }
    return rows;
  }

  const categorizeInbox = (opts) => categorize(sendersFromCorpus(opts), opts);

  function categoryOf(sender) {
    if (mem.has(sender)) return mem.get(sender);
    if (strand && typeof strand.replay === "function") {
      const rows = strand.replay({ kind: "mail:category" });
      for (let i = rows.length - 1; i >= 0; i--) { const p = rows[i]["holstr:payload"]; if (p && p.sender === sender) return p.category; }
    }
    return null;
  }

  return { categorize, categorizeInbox, categoryOf, sendersFromCorpus };
}

export default { makeMailCategorize, SENDERS_SCHEMA, DEFAULT_TAXONOMY };
