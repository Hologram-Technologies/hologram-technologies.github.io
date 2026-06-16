// holo-omni-q.mjs — the omnibar's PRIVATE intelligence: Q.recall (model-free BM25 ⊕ κ-graph) over a corpus of
// everything you've resolved. Type a question → relevant chunks from YOUR stuff, ranked + graph-expanded,
// on-device, zero models, zero network. The studio's brain, brought to the single bar. It AUTO-SEEDS from the
// omnibar's memory (holo-omni-index's localStorage), so it stays in sync with no extra wiring — and indexes
// richer text (page/card content) when given. Reuses holo-q-corpus + holo-q-recall verbatim.

import { createCorpus } from "../usr/lib/holo/q/holo-q-corpus.js";
import { createRecall } from "../usr/lib/holo/q/holo-q-recall.js";

let _corpus = null, _R = null;
const _seen = new Set();   // addrs already indexed (so re-seeding is a no-op)
const _meta = new Map();   // addr → { title, kind } (recall results carry pageId=addr; we re-attach the label)

function ensure() { if (!_corpus) { _corpus = createCorpus({ embedder: null }); _R = createRecall({ corpus: _corpus, synth: null }); } return _R; }

// indexObject({addr,title,kind,text?}) — add/refresh an object in the private corpus (a "page" = its text).
export async function indexObject(e) {
  if (!e || !e.addr) return; ensure();
  _meta.set(e.addr, { title: e.title || e.addr, kind: e.kind || "" });
  const text = [e.title || "", e.kind || "", e.addr || "", e.text || ""].filter(Boolean).join("\n\n");
  try { await _corpus.index({ id: e.addr, text, meta: { addr: e.addr, kind: e.kind, title: e.title } }); _seen.add(e.addr); } catch {}
}

// seed(entries) — index any not-yet-seen entries (the omnibar's memory). Idempotent.
export async function seed(entries) { ensure(); for (const e of entries || []) if (e && e.addr && !_seen.has(e.addr)) await indexObject(e); }
const readIndex = () => { try { return JSON.parse(localStorage.getItem("holo:omni-index") || "[]"); } catch { return []; } };

// askPrivate(q,{k,entries}) → { results:[{addr,title,kind,text,via,rank}], ms, receipt } — recall over YOUR
// corpus (no model, no network). Auto-seeds from the omnibar memory first. `entries` overrides the source (witness).
export async function askPrivate(q, { k = 6, entries = null } = {}) {
  const R = ensure();
  await seed(entries || (typeof localStorage !== "undefined" ? readIndex() : []));
  try {
    const out = await R.recall(q, { k: k * 3, synthesize: false });
    const seen = new Set(), results = [];   // one row per object (a page yields many chunks); keep the best-ranked
    for (const h of out.results || []) { if (seen.has(h.pageId)) continue; seen.add(h.pageId); results.push({ addr: h.pageId, ...(_meta.get(h.pageId) || {}), text: h.text, via: (h.via || []).join("+"), rank: h.rank }); if (results.length >= k) break; }
    return { results, ms: out.ms, receipt: out.receipt };
  } catch (e) { return { results: [], error: String((e && e.message) || e) }; }
}

export const corpusStats = () => (_corpus ? _corpus.stats() : null);
export default { indexObject, seed, askPrivate, corpusStats };
