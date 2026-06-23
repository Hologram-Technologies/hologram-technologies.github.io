// holo-workspace-host.mjs — THE UNIVERSAL CAPTURE SEAM (Phase A). Makes EVERY holospace tab / holo app
// its own persistent workspace with ZERO app code: the OS frame opens-or-resumes a per-app source chain
// at mount and auto-saves on change. Apps don't opt in and write nothing. One chain per app κ (each its
// own backend; holo-strand-stores keeps them one store underneath). Lazy + cheap: a chain only grows on a
// real change. Fail-soft: no seam ⇒ today's behaviour. The user never sees a save button, a version, or a κ.
//
// Core is injectable (strandFor) — node-witnessable with in-memory strands; the browser binding wires a
// per-app encrypted κ-store (the same sovereign cipher as the rest of the OS, fail-closed). Pure assembly
// over holo-strand + holo-workspace; no new crypto.

import { makeStrand } from "./holo-strand.mjs";
import { makeWorkspace } from "./holo-workspace.mjs";

// makeWorkspaceHost({ strandFor, now }) → the registry + capture seam.
//   workspace(appκ) → the (memoized) per-app workspace.
//   mount(appκ)     → { workspace, state } — resume the app's last state on open (drift-proof via the chain).
//   capture(appκ, getState, subscribe) → wire an app's change signal to lazy auto-save; returns unsubscribe.
export function makeWorkspaceHost({ strandFor, now = () => "1970-01-01T00:00:00Z" } = {}) {
  const open = new Map();
  function workspace(appKappa) {
    if (!open.has(appKappa)) open.set(appKappa, makeWorkspace({ appKappa, strand: strandFor(appKappa), now }));
    return open.get(appKappa);
  }
  async function mount(appKappa) {
    const ws = workspace(appKappa);
    let state = null; try { state = await ws.resume(); } catch (e) {}            // fail-soft: missing state ⇒ clean open
    return { workspace: ws, state };
  }
  // capture — the frame calls this once per app: getState() returns the app's current snapshot; subscribe(cb)
  // registers a change listener and returns an unsubscribe. Auto-saves lazily (no-op when unchanged).
  function capture(appKappa, getState, subscribe) {
    const ws = workspace(appKappa);
    const tick = async () => { try { const s = getState(); if (s !== undefined) await ws.save(s); } catch (e) {} };
    let off = () => {};
    try { off = subscribe(tick) || off; } catch (e) {}
    return () => { try { off(); } catch (e) {} };
  }
  return { workspace, mount, capture };
}

// ── browser binding: a per-app encrypted κ-store, one workspace host for the whole OS frame ──
if (typeof window !== "undefined") {
  const hexOf = (k) => String(k).split(":").pop();
  const te = new TextEncoder(), td = new TextDecoder();
  const DB = "holo-workspace", STORE = "kv";
  const open = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const s = t.objectStore(STORE); const rq = fn(s); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); };
  const cipher = async () => { try { const m = await import("./holo-session.mjs"); return m.activeCipher ? (await m.activeCipher()).cipher : null; } catch (e) { return null; } };
  const perAppBackend = (appKappa) => {
    const KEY = "ws." + hexOf(appKappa);
    return {
      load: async () => {
        const raw = await tx("readonly", (s) => s.get(KEY)); if (!raw || raw.v !== 1 || !raw.blob) return [];
        const c = await cipher(); if (!c) return []; try { const pt = await c.open(raw.blob); return pt ? JSON.parse(td.decode(pt)) : []; } catch (e) { return []; }
      },
      save: async (entries) => {
        const c = await cipher(); if (!c) return null;                          // locked / no key → never write plaintext
        const blob = await c.seal(te.encode(JSON.stringify(entries)));
        return tx("readwrite", (s) => s.put({ v: 1, blob }, KEY));
      },
    };
  };
  const strandFor = (appKappa) => makeStrand({ backend: perAppBackend(appKappa), now: () => new Date().toISOString() });
  window.HoloWorkspaceHost = makeWorkspaceHost({ strandFor, now: () => new Date().toISOString() });
}
