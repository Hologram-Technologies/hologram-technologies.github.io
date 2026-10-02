// holo-q-corpus.mjs — THE ONE CONTEXT PLANE (U2 of Q-ONE). Q's grounding used to end at chat messages: the
// retrieval index covers conversations only, and every other surface (Files, mail, Holo TV, vision) knew things
// Q could not recall. This is the missing plane: ONE private, on-device κ-corpus that ANY surface projects
// facts into and EVERY Q turn recalls from — so Q simply *knows* your world, not just your chats.
//
// The ingenious part is what this module does NOT build: no second store, no second crypto, no second claim
// path. A fact is a HoloMemory record with kind:"fact" — so the corpus automatically inherits everything U1
// just made true of memory: AES-GCM sealed at rest under the realm cipher, realm-keyed (a guest's facts can't
// clobber an operator's), CLAIMED into your sovereign realm at sign-in, rehydrated on unlock, bounded, and
// every record a self-verifying UOR object (Law L5). One store, one discipline, one relationship.
//
//   HoloCorpus.publish({source, text, meta}) → sealed fact into the plane        // any operator surface
//   HoloCorpus.recall(query, k)              → top-k relevant facts (token+recency scored)
//   postMessage {type:"holo-corpus:publish"} → the bridge for sandboxed holospaces (same-origin, capped)
//
// SAFETY: facts are DATA for grounding, never instructions — the grounded-context weave labels them so, and
// the guard spine (injection notice / identity guard) already wraps every grounded turn. Publishes are length-
// capped, source-tagged, and rate-limited; the bridge accepts same-origin frames only. Private by construction:
// the plane lives in the realm-encrypted store; nothing leaves the device (Law L1).

const CAP_TEXT = 300, CAP_SRC = 24, RATE_N = 30, RATE_MS = 60000;
const toks = (s) => new Set(String(s || "").toLowerCase().match(/[a-z0-9]+/g) || []);

function makeCorpus(mem) {
  let stamps = [];   // publish timestamps for the rate cap
  function allowed() { const now = Date.now(); stamps = stamps.filter((t) => now - t < RATE_MS); if (stamps.length >= RATE_N) return false; stamps.push(now); return true; }

  async function publish({ source, text, meta } = {}) {
    const src = String(source || "app").replace(/[^a-z0-9_-]/gi, "").slice(0, CAP_SRC) || "app";
    const t = String(text || "").replace(/\s+/g, " ").trim().slice(0, CAP_TEXT);
    if (!t || !allowed()) return null;
    try { return await mem.remember({ kind: "fact", text: t, meta: { ...(meta && typeof meta === "object" ? meta : {}), source: src } }); }
    catch (e) { return null; }
  }

  // recall — the few facts from your world most relevant to THIS turn: token overlap (Jaccard) + a recency nudge.
  // Deterministic, cheap, on-device. Returns [{text, source, at}] best-first; [] when nothing genuinely matches.
  async function recall(query, k = 4) {
    try {
      if (mem.ready) await mem.ready();
      const q = toks(query); if (!q.size) return [];
      const facts = mem.recent({ kind: "fact", n: 200 });
      const scored = [];
      for (let i = 0; i < facts.length; i++) {
        const r = facts[i]; const rt = toks(r["holmem:text"]); if (!rt.size) continue;
        const overlap = [...q].filter((x) => rt.has(x)).length; if (!overlap) continue;
        const jac = overlap / (q.size + rt.size - overlap);
        scored.push({ score: jac + (1 - i / facts.length) * 0.05, text: r["holmem:text"], source: (r["holmem:meta"] && r["holmem:meta"].source) || "app", at: r["prov:generatedAtTime"] || null });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, Math.max(1, k | 0)).map(({ text, source, at }) => ({ text, source, at }));
    } catch (e) { return []; }
  }

  async function summary() { try { if (mem.ready) await mem.ready(); const f = mem.recent({ kind: "fact", n: 200 }); const by = {}; for (const r of f) { const s = (r["holmem:meta"] && r["holmem:meta"].source) || "app"; by[s] = (by[s] || 0) + 1; } return { facts: f.length, sources: by }; } catch (e) { return { facts: 0, sources: {} }; } }

  // recent — the most recent facts REGARDLESS of query (recall() needs query tokens; proactive surfacing needs
  // "what has the user been doing lately", newest first). Same shape as recall's items.
  async function recent(k = 6) { try { if (mem.ready) await mem.ready(); const f = mem.recent({ kind: "fact", n: Math.max(1, k | 0) }); return f.map((r) => ({ text: r["holmem:text"], source: (r["holmem:meta"] && r["holmem:meta"].source) || "app", at: r["prov:generatedAtTime"] || null })); } catch (e) { return []; } }

  return { publish, recall, summary, recent };
}

// ── browser binding: window.HoloCorpus over window.HoloMemory (waits for it), + the same-origin holospace
// bridge so sandboxed apps (Files · mail · TV) can project without importing anything: parent-post a fact.
if (typeof window !== "undefined") {
  const bind = () => {
    try {
      if (window.HoloCorpus || !window.HoloMemory) return !!window.HoloCorpus;
      window.HoloCorpus = makeCorpus(window.HoloMemory);
      window.addEventListener("message", (e) => {
        try {
          if (e.origin !== location.origin) return;                       // same-origin holospaces only
          const d = e.data;
          if (d && d.type === "holo-corpus:publish") window.HoloCorpus.publish({ source: d.source, text: d.text, meta: d.meta });
        } catch (err) {}
      });
      try { document.documentElement.dispatchEvent(new Event("holo-corpus-ready")); } catch (e) {}
      return true;
    } catch (e) { return false; }
  };
  if (!bind()) {
    try { document.documentElement.addEventListener("holo-memory-ready", bind, { once: true }); } catch (e) {}
    let n = 0; const iv = setInterval(() => { if (bind() || ++n > 40) clearInterval(iv); }, 500);   // belt-and-suspenders
  }
}

export { makeCorpus };
