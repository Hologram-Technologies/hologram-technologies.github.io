// holo-factory-catalog.mjs — the CANDIDATE CATALOG for Holo Factory (ADR-0097): the live enumeration of
// fixable targets, so the tender's triage has something to locate WITHOUT the user passing candidates. This
// is the last seam between "locates" and "fully hands-off on real holospaces": with a catalog wired,
// Q.factory.watch("keep my notepad working") finds the notepad surface and closes the loop unattended.
//
// A candidate is { id, text, read?(), write?(source), lang?, verify? } — `text` is what triage embeds, read
// is the current source (for the brain's context + the parse oracle), write persists a verified fix. The
// catalog COMPOSES providers (each a { list() → candidates }) and a self-register seam (target()), de-duping
// by id. Providers are INJECTED — the holo-mind idiom — so the catalog is witnessable in Node with stubs and
// live in the browser over the real doors (liveEdit surfaces, the κ-route, an app self-registering itself).

// createCatalog(providers) → { candidates, add, target, untarget, targets }. Pure; async candidates().
export function createCatalog(providers = []) {
  const explicit = new Map();                                      // id → candidate (apps/scene self-register here)
  const provs = Array.isArray(providers) ? [...providers] : [providers];
  async function candidates() {
    const out = [], seen = new Set();
    for (const c of explicit.values()) { if (c && c.id != null && !seen.has(c.id)) { seen.add(c.id); out.push(c); } }   // explicit first (richest)
    for (const p of provs) {
      let list = [];
      try { list = p && typeof p.list === "function" ? await p.list() : (Array.isArray(p) ? p : []); } catch (e) { list = []; }
      for (const c of list) { if (c && c.id != null && !seen.has(c.id)) { seen.add(c.id); out.push(c); } }
    }
    return out;
  }
  const api = {
    candidates,
    add(p) { provs.push(p); return api; },
    // target(id, spec) — an app/holospace SELF-REGISTERS as a fixable target (the clean opt-in; richest read/write).
    target(id, spec = {}) { explicit.set(id, { id, text: spec.text || id, read: spec.read, write: spec.write, lang: spec.lang || "js", verify: spec.verify }); return id; },
    untarget(id) { return explicit.delete(id); },
    targets() { return [...explicit.values()]; },
  };
  return api;
}

// liveEditProvider — every live mounted holospace surface (HoloLiveEdit) as a candidate: write through the
// GOVERNED agentEdit door (conscience-gated, hosc:Edit receipt); read through the injected resolveSource
// (κ → source, e.g. a /.holo/sha256/<hex> κ-route fetch). No resolveSource ⇒ read is omitted (the brain
// then proposes from the signal alone — degrades honestly, the parse oracle still verifies the candidate).
export function liveEditProvider(editor, { resolveSource = null, describe = null, lang = "html" } = {}) {
  if (!editor || typeof editor.list !== "function") return { list: () => [] };
  return {
    list: async () => (editor.list() || []).map((id) => ({
      id, text: (describe && describe(id)) || id, lang,
      read: resolveSource ? (async () => { const k = typeof editor.kappaOf === "function" ? editor.kappaOf(id) : null; return k ? await resolveSource(k) : null; }) : undefined,
      write: typeof editor.agentEdit === "function"
        ? (async (src) => { const r = await editor.agentEdit(id, src, { caller: "holo-factory" }); if (!r || !r.ok) throw new Error((r && r.reason) || "edit refused (governed)"); return r; })
        : undefined,
    })),
  };
}

// listProvider — an explicit array of candidates you already hold read/write for (objects, files, fixtures).
export function listProvider(items) { return { list: () => (Array.isArray(items) ? items.slice() : []) }; }

// kRouteResolver — the live κ → source reader over the content-addressed route (Law L5: the bytes ARE the κ).
// Pure given the injected fetch (the browser passes window.fetch; the witness stubs it).
export function kRouteResolver(fetchFn, { base = "/.holo/sha256/" } = {}) {
  return async (kappa) => {
    if (!kappa) return null;
    const hex = String(kappa).split(":").pop();
    try { const r = await fetchFn(base + hex); return r && r.ok ? await r.text() : null; } catch (e) { return null; }
  };
}

export default { createCatalog, liveEditProvider, listProvider, kRouteResolver };
