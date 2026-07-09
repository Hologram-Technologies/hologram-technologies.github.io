// core/state.js — a tiny event bus + the app's shared mutable state. No framework: modules
// subscribe to named events and re-render their own DOM islands. Deliberately minimal — the
// durable truth lives in the κ-object store (Law L3); this is only the session's working set.

export function makeBus() {
  const subs = new Map();
  return {
    on(ev, fn) { if (!subs.has(ev)) subs.set(ev, new Set()); subs.get(ev).add(fn); return () => subs.get(ev)?.delete(fn); },
    emit(ev, data) { for (const fn of subs.get(ev) || []) { try { fn(data); } catch (e) { console.error(`[bus:${ev}]`, e); } } },
  };
}

export function makeState() {
  return {
    // model / engine
    engine: null,            // core/engine.js instance (null until a model loads)
    modelIndex: 0,           // index into loader.MODELS
    loading: false,
    gateOk: false,           // conscience constitution self-verify

    // conversation working set
    convId: null,            // active conversation id
    convKappa: null,         // its latest sealed κ
    title: "New Chat",
    messages: [],            // [{ obj (sealed κ-object), id, kappa, ...norm fields, tokenIds }]
    chosenChild: new Map(),  // parent messageId → chosen child messageId (sibling switch)
    streaming: false,
    abort: null,             // AbortController while generating

    // ui
    navOpen: window.innerWidth > 900,
    panelOpen: false,            // the chat is the product — the panel opens on demand
    panelTab: "params",
    settingsOpen: false,

    // preset (the active parameter bundle — LibreChat conversationPreset semantics)
    preset: null,
  };
}
