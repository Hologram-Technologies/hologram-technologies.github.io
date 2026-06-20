// holo-memory.mjs — Q'S PERSISTENT USER MODEL (S2 of the Q-unification). The audit found Q forgets you every
// reload: ctx (recent intents + 👍/👎) is session-only with no persistence, the corpus is host-must-index, and
// the stores don't cross-pollinate. This is the one coherent, DURABLE, content-addressed memory of the user's
// world — what you asked, what you built, what you liked — so Q.briefing/Q.recall become genuinely personal
// and survive a reload. Private-first by construction: it lives in YOUR local store; nothing leaves the device
// without explicit, conscience-gated consent. Usage SHAPE (intents, votes, artifacts), never surveillance.
//
//   remember(signal) → a sealed record (Law L5) appended + persisted   // {kind:'intent'|'feedback'|'artifact', text, vote?, meta?}
//   recent({kind,n}) · feedback() · affinity(text) · summary()         // read the model
//   affinity(text) → a learned preference bias ∈ [-1,1] from your votes on SIMILAR things (so Q leans your way)
//   forget({kind,before}) → n deleted (+persist)                        // YOUR control — Q forgets on request
//   export({consent}) → conscience-gated egress (default-deny, Law L1)  // memory is yours; it doesn't phone home
//
// Each record is a self-verifying UOR object — hold its κ, re-derive it; tamper it, the id breaks (the user
// model can't be silently forged). Bounded (a cap trims the oldest), deterministic, isomorphic. The durable
// `backend` ({load, save}) is injected: a witness uses an in-memory array (and proves a "reload" recovers it);
// the browser uses IndexedDB/OPFS. seal() is pure sha256hex(jcs) — browser + Service-Worker safe (no Buffer).

import { seal, verify, UOR_CONTEXT } from "./holo-object.mjs";

const NS = "https://hologram.os/ns/memory#";
const sealObj = (type, props) => seal({ "@context": [...UOR_CONTEXT, { holmem: NS }], "@type": type, ...props });
const toks = (s) => new Set(String(s || "").toLowerCase().match(/[a-z0-9]+/g) || []);

// makeMemory({ backend, now, cap, conscience }) → the persistent model.
//   backend  : the durable store { load: async()→records[]|null, save: async(records)→void }. Absent ⇒ in-memory only.
//   cap      : max records kept (oldest trimmed) — bounded memory, never an unbounded log. Default 500.
export function makeMemory({ backend = null, now = () => "1970-01-01T00:00:00Z", cap = 500, conscience = null } = {}) {
  let records = [];                 // [{ id, holmem:kind, holmem:text, holmem:vote, holmem:meta, prov:generatedAtTime }]
  let hydrated = false;

  async function ready() {          // hydrate once from the durable backend (survives reload)
    if (hydrated) return;
    hydrated = true;
    if (backend && typeof backend.load === "function") {
      try { const r = await backend.load(); if (Array.isArray(r)) records = r.slice(-cap); } catch (e) {}
    }
  }
  async function persist() { if (backend && typeof backend.save === "function") { try { await backend.save(records); } catch (e) {} } }

  // remember — append a sealed record and persist. The record's identity commits to its content (Law L5);
  // its timestamp is part of the event (a remembered moment is distinct in time), so two are never confused.
  async function remember(signal = {}) {
    await ready();
    const kind = String(signal.kind || "intent");
    const rec = sealObj(["prov:Entity", "holmem:Record"], {
      "holmem:kind": kind,
      "holmem:text": String(signal.text || ""),
      ...(signal.vote ? { "holmem:vote": signal.vote === "up" ? "up" : "down" } : {}),
      ...(signal.meta ? { "holmem:meta": signal.meta } : {}),
      "prov:generatedAtTime": now(),
    });
    records.push(rec);
    if (records.length > cap) records = records.slice(-cap);   // bounded — trim the oldest
    await persist();
    return rec;
  }

  const all = (kind) => (kind ? records.filter((r) => r["holmem:kind"] === kind) : records.slice());
  const recent = ({ kind = null, n = 10 } = {}) => all(kind).slice(-n).reverse();   // most-recent first

  function feedback() {
    let up = 0, down = 0;
    for (const r of records) if (r["holmem:kind"] === "feedback") { if (r["holmem:vote"] === "up") up++; else if (r["holmem:vote"] === "down") down++; }
    return { up, down };
  }

  // affinity(text) — a learned bias ∈ [-1,1]: did the user UP/DOWN-vote things SIMILAR to this? Weighted by
  // token overlap (Jaccard). Lets Q lean toward what you've liked without any model — deterministic, yours.
  function affinity(text) {
    const t = toks(text); if (!t.size) return 0;
    let num = 0, den = 0;
    for (const r of records) {
      if (r["holmem:kind"] !== "feedback" || !r["holmem:vote"]) continue;
      const rt = toks(r["holmem:text"]); if (!rt.size) continue;
      const overlap = [...t].filter((x) => rt.has(x)).length; if (!overlap) continue;
      const w = overlap / (t.size + rt.size - overlap);          // Jaccard
      num += w * (r["holmem:vote"] === "up" ? 1 : -1); den += w;
    }
    return den ? Math.round((num / den) * 1000) / 1000 : 0;
  }

  function summary() {
    const fb = feedback();
    return { intents: all("intent").length, artifacts: all("artifact").length, votes: fb.up + fb.down, feedback: fb,
      total: records.length, since: records.length ? records[0]["prov:generatedAtTime"] : null };
  }

  // forget — YOUR control. Delete by kind and/or everything before a timestamp; persists the smaller model.
  async function forget({ kind = null, before = null } = {}) {
    await ready();
    const n0 = records.length;
    records = records.filter((r) => !((kind == null || r["holmem:kind"] === kind) && (before == null || r["prov:generatedAtTime"] < before)));
    await persist();
    return n0 - records.length;
  }

  // export — memory is private-first: egress is default-deny AND conscience-gated (Law L1). It does not phone home.
  function exportModel(target, { consent = false } = {}) {
    if (!consent) return { ok: false, reason: "local-only — your memory is private-first (Law L1)" };
    if (conscience && typeof conscience.evaluate === "function") {
      const v = conscience.evaluate({ action: "memory.export", target, count: records.length });
      if (!v || v.outcome === "block") return { ok: false, reason: `refused by conscience — ${(v && v.reason) || "blocked"}` };
    }
    return { ok: true, target, records: records.slice() };
  }

  return { ready, remember, recent, feedback, affinity, summary, forget, export: exportModel, verify };
}

export { verify };

// ── browser binding: window.HoloMemory over a durable IndexedDB backend, once HoloApp is ready. Q.remember
// writes through here so feedback + intents SURVIVE reload, and Q.briefing/recall can read the user model.
// Law L1 private-first, L2 one canonical wire. Fail-soft (a fresh in-memory model) if storage is unavailable.
if (typeof window !== "undefined") {
  const idbBackend = () => {
    const KEY = "holo.memory.v1", DB = "holo-memory", STORE = "kv";
    const open = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const s = t.objectStore(STORE); const rq = fn(s); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); };
    return { load: () => tx("readonly", (s) => s.get(KEY)).then((v) => v || []), save: (recs) => tx("readwrite", (s) => s.put(recs, KEY)) };
  };
  const wire = async () => {
    try {
      if (window.HoloMemory || !window.HoloApp) return;
      const backend = (typeof indexedDB !== "undefined") ? idbBackend() : null;
      const mem = makeMemory({ backend, now: () => new Date().toISOString(), conscience: window.HoloConscience || null });
      await mem.ready();
      window.HoloMemory = mem;
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-memory-ready"));
    } catch (e) { /* leave unset; callers fail-soft */ }
  };
  if (window.HoloApp) wire();
  else if (document.documentElement) document.documentElement.addEventListener("holo-app-ready", wire, { once: true });
}
