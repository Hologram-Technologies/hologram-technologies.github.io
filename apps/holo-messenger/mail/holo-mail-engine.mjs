// holo-mail-engine.mjs - the production COMPOSITION ROOT. Binds the five mail modules to the real seams:
// provider (email-bridge), strand (holo-strand), and the real on-device Q brain (holo-q-mux via
// facultySampler). One object the messenger calls: enrich a thread, draft a reply, sort into lanes.
//
// makeMailEngine is pure + injectable (Node-gated with mocks). attachMailEngine wires the REAL browser
// seams and exposes window.HoloMail. Graceful by law: if Q isn't loaded, every faculty yields nothing and
// the engine returns nulls (never a fabricated summary/draft - Law L5), never throws at the call site.

import { makeMailAI } from "./holo-mail-ai.mjs";
import { makeMailProvider } from "./holo-mail-provider.mjs";
import { makeMailSummary } from "./holo-mail-summary.mjs";
import { makeMailReplyZero } from "./holo-mail-replyzero.mjs";
import { makeMailCategorize } from "./holo-mail-categorize.mjs";
import { makeMailCold } from "./holo-mail-cold.mjs";
import { makeMailDraft } from "./holo-mail-draft.mjs";

const laneOf = (status, category, cold) =>
  cold ? "cold"
  : status === "TO_REPLY" ? "reply"
  : category === "Team" ? "team"
  : (category === "News" || category === "Notifications") ? "news"
  : "important";

// makeMailEngine({ provider, strand, brainFor, now })
//   provider : a mail provider (holo-mail-provider) - threadMessages/allMessages/toEmailForLLM.
//   strand   : a holo-strand (durable κ) or null (in-mem only).
//   brainFor : (label) => brain | null - routes a faculty to a Q brain ({ generate }). null ⇒ no brain.
export function makeMailEngine({ provider, strand = null, brainFor = () => null, now = () => new Date().toISOString() } = {}) {
  const ai = makeMailAI({ route: (label) => brainFor(label) });
  const summary = makeMailSummary({ ai, provider, strand, now });
  const replyz = makeMailReplyZero({ ai, provider, strand, now });
  const categ = makeMailCategorize({ ai, provider, strand, now });
  const cold = makeMailCold({ ai, provider, strand, now });
  const drafter = makeMailDraft({ ai, provider, strand, now });

  const safe = async (fn) => { try { return await fn(); } catch { return null; } };

  // prime() - bulk-categorize senders once so categoryOf() is populated for lane sorting.
  const prime = () => safe(() => categ.categorizeInbox());

  // enrich(jid) - the per-thread intelligence the row + reader read: summary, status, cold, lane.
  async function enrich(jid) {
    const msgs = provider.threadMessages(jid);
    if (!msgs || !msgs.length) return null;
    const last = msgs[msgs.length - 1];
    const [s, st, cl] = await Promise.all([
      safe(() => summary.summarize(jid)),
      safe(() => replyz.classify(jid)),
      safe(() => cold.isCold(last)),
    ]);
    const sender = (msgs.find((m) => !m.fromMe) || {}).from || "";
    const category = categ.categoryOf(sender);
    const status = st ? st.status : null;
    const isCold = !!(cl && cl.cold);
    return { jid, lastId: last.id, summary: s ? s.summary : null, status, cold: isCold, category, lane: laneOf(status, category, isCold) };
  }

  // draftFor(jid) - the ready reply, or null when nothing is owed / Q is absent.
  const draftFor = (jid) => safe(() => drafter.draft(jid));

  // lanes(jids) - bucket threads for the split inbox. primes categories first.
  async function lanes(jids) {
    await prime();
    const buckets = { important: [], reply: [], team: [], news: [], cold: [] };
    for (const jid of jids) {
      const e = await enrich(jid);
      if (e) buckets[e.lane].push(e);
    }
    return buckets;
  }

  // markCold / markNotCold - the learned exclusion, surfaced for the UI.
  return { enrich, draftFor, lanes, prime, markCold: cold.markCold, markNotCold: cold.markNotCold,
           _modules: { ai, summary, replyz, categ, cold, drafter } };
}

// ── browser attach: wire the REAL seams and expose window.HoloMail ───────────────────────────────────
// Best-effort + fail-soft: a missing bridge or unloaded Q just means the engine returns nulls. The
// messenger calls window.HoloMail.enrich(jid) when an email thread is viewed. Dist layout: q modules at
// /usr/lib/holo/q; the mail modules ship alongside under the messenger's module root.
export async function attachMailEngine(opts = {}) {
  const base = opts.base || "http://127.0.0.1:8793";
  const provider = opts.provider || makeMailProvider({ base });
  const strand = opts.strand || (typeof window !== "undefined" ? window.HoloStrand : null) || null;

  let brainFor = () => null;
  try {
    // resolve the live Q brain per faculty via the mux (facultySampler yields nothing until a brain binds).
    const muxMod = await import(opts.muxUrl || "/usr/lib/holo/q/holo-q-mux.js");
    const active = await import(opts.activeUrl || "/usr/lib/holo/q/holo-q-active.mjs");
    const mux = muxMod.default || muxMod;
    // classifiers → a light faculty; drafting → the reasoner. Both fall back to the main brain safely.
    const facultyFor = (label) => (label === "draft-reply" ? (opts.draftFaculty || "respond") : (opts.classifyFaculty || "respond"));
    const cache = new Map();
    brainFor = (label) => {
      const f = facultyFor(label);
      if (!cache.has(f)) { const s = active.facultySampler(mux, f); cache.set(f, { id: `q:${f}`, generate: (m, o) => s(m, o) }); }
      return cache.get(f);
    };
  } catch { /* Q not present → brainFor stays null → engine returns nulls (no fabrication) */ }

  const engine = makeMailEngine({ provider, strand, brainFor });
  if (typeof window !== "undefined") window.HoloMail = engine;
  return engine;
}

export default { makeMailEngine, attachMailEngine };
