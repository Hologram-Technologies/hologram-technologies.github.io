// holo-workspaces.mjs — THE DESKTOP IS THE SET OF WORKSPACES (Phase C). A user can have several named
// workspaces ("Research", "Trading", "Home"); each is a content-κ Space that scopes its OWN per-app
// source chains, so the SAME app κ open in two workspaces keeps independent state AND independent history.
// Switching auto-saves the current one and restores the target — each window resumes from its own chain.
//
// Built on the Phase A/B substrate, no new primitive: a named workspace's per-app capture is just a
// holo-workspace-host whose chain key is "<workspaceκ>::<appκ>" (the workspace identity scopes the app
// chain). The SET itself is recorded on one more source chain — the registry (per operator) — whose
// events (create / rename / activate) are hash-linked, signed, deterministic and never destroyed, so
// "which workspaces exist and which is active" is a re-derivable projection, not a mutable blob.
//
// SIMPLICITY BAR (unchanged): zero app code; the user sees "my other space, intact", never a κ, a chain,
// or a save. Fail-soft. Adapter-injectable (makeWorkspaces) — node-witnessable with in-memory strands;
// the browser binding wires the operator's encrypted registry strand + per-scope κ-stores.

import { makeWorkspaceHost } from "./holo-workspace-host.mjs";
import { seal, UOR_CONTEXT } from "./holo-object.mjs";

const NS = "https://hologram.os/ns/workspaces#";
const hexOf = (k) => (k ? String(k).split(":").pop() : "anon");

// spaceIdOf — a named workspace's STABLE content-κ from { operator, ordinal }. RENAME-INDEPENDENT on
// purpose: the label is mutable, the identity is not (so renaming "Research" never re-homes its windows).
function spaceIdOf(operator, ordinal) {
  return seal({ "@context": [...UOR_CONTEXT, { hw: NS }], "@type": ["prov:Entity", "hw:Workspace"], "hw:operator": operator || null, "hw:ordinal": ordinal | 0 }).id;
}

// makeWorkspaces({ registryStrand, strandFor, operator, now }) → the named-workspace set + per-workspace host.
//   registryStrand : a holo-strand (one per operator) recording create/rename/activate — "the set".
//   strandFor(scopeKey) : → a strand for a composite "<workspaceκ>::<appκ>" key (a per-app chain INSIDE a workspace).
//   operator       : the operator κ the set belongs to (folds into each workspace's stable identity).
export function makeWorkspaces({ registryStrand, strandFor, operator = null, now = () => "1970-01-01T00:00:00Z" } = {}) {
  if (!registryStrand || typeof strandFor !== "function") throw new Error("makeWorkspaces needs a registryStrand and strandFor");
  const hosts = new Map();   // workspaceκ → its scoped capture host (per-app chains live under <wsκ>::<appκ>)

  const ready = () => (registryStrand.ready ? registryStrand.ready() : Promise.resolve());

  // project — fold the registry chain into the live set + the active workspace + the next free ordinal.
  async function project() {
    await ready();
    const byId = new Map(); let active = null; let nextOrd = 0;
    for (const e of registryStrand.replay({})) {
      const k = e["holstr:kind"], p = e["holstr:payload"] || {};
      if (k === "workspace.create") { byId.set(p.id, { id: p.id, name: p.name, ordinal: p.ordinal | 0 }); nextOrd = Math.max(nextOrd, (p.ordinal | 0) + 1); }
      else if (k === "workspace.rename" && byId.has(p.id)) byId.get(p.id).name = p.name;
      else if (k === "workspace.activate" && byId.has(p.id)) active = p.id;
    }
    return { byId, active, nextOrd };
  }

  // list() → { workspaces:[{id,name,ordinal}], active } — what the switcher shows. No κ surfaced to UI.
  async function list() { const { byId, active } = await project(); return { workspaces: [...byId.values()], active }; }

  async function create(name = "Workspace") {
    const { nextOrd } = await project();
    const id = spaceIdOf(operator, nextOrd);
    await registryStrand.append({ kind: "workspace.create", payload: { id, name: String(name), ordinal: nextOrd } });
    return { id, name: String(name), ordinal: nextOrd };
  }
  async function rename(id, name) {
    const { byId } = await project(); if (!byId.has(id)) return null;        // unknown id → no-op (fail-soft)
    await registryStrand.append({ kind: "workspace.rename", payload: { id, name: String(name) } });
    return { id, name: String(name) };
  }
  async function activate(id) {
    const { byId } = await project(); if (!byId.has(id)) return null;
    await registryStrand.append({ kind: "workspace.activate", payload: { id } });
    return id;
  }
  async function active() { return (await project()).active; }

  // host(id) → the per-app capture host SCOPED to this workspace; its app chains are independent of every
  // other workspace's (the key carries the workspace κ). Memoized. Callers use host.workspace(appκ) /
  // host.mount(appκ) / host.capture(appκ, …) exactly as in Phase A — the scoping is invisible to them.
  function host(id) {
    if (!hosts.has(id)) hosts.set(id, makeWorkspaceHost({ strandFor: (appKappa) => strandFor(hexOf(id) + "::" + hexOf(appKappa)), now }));
    return hosts.get(id);
  }
  const open = (id) => host(id);

  // switchTo(id, { saveCurrent }) → auto-save the current workspace (a flush hook the shell passes —
  // each app already autosaves continuously; this is the explicit pre-switch barrier), then make `id`
  // active and return its host. The target's windows resume from their own per-app chains on mount.
  async function switchTo(id, { saveCurrent = null } = {}) {
    if (typeof saveCurrent === "function") { try { await saveCurrent(); } catch (e) {} }
    const a = await activate(id); if (!a) return null;
    return host(id);
  }

  // verify — the registry chain itself re-derives + links (the set's own integrity).
  const verify = () => registryStrand.verify();

  return { list, create, rename, activate, active, host, open, switchTo, verify, spaceIdOf };
}

// ── browser binding: the operator's encrypted registry strand + per-scope encrypted app chains, one set
// for the whole OS. Fail-soft; the shell switcher degrades to a single (default) workspace if absent.
if (typeof window !== "undefined") {
  const wire = async () => {
    try {
      if (window.HoloWorkspaces) { window.HoloWorkspaces.makeWorkspaces = makeWorkspaces; }
      const strandMod = await import("./holo-strand.mjs");
      const te = new TextEncoder(), td = new TextDecoder();
      const DB = "holo-workspaces", STORE = "kv";
      const open = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const s = t.objectStore(STORE); const rq = fn(s); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); };
      const cipher = async () => { try { const m = await import("./holo-session.mjs"); return m.activeCipher ? (await m.activeCipher()).cipher : null; } catch (e) { return null; } };
      const keyedBackend = (recKey) => ({
        load: async () => { const raw = await tx("readonly", (s) => s.get(recKey)); if (!raw || !raw.blob) return []; const c = await cipher(); if (!c) return []; try { const pt = await c.open(raw.blob); return pt ? JSON.parse(td.decode(pt)) : []; } catch (e) { return []; } },
        save: async (recs) => { const c = await cipher(); if (!c) return null; const blob = await c.seal(te.encode(JSON.stringify(recs))); return tx("readwrite", (s) => s.put({ v: 1, blob }, recKey)); },
      });
      const now = () => new Date().toISOString();
      const strandFor = (scopeKey) => strandMod.makeStrand({ backend: keyedBackend("scope::" + scopeKey), now });
      let operator = null; try { const id = await import("./holo-identity.mjs"); operator = (id.activeOperator && (await id.activeOperator())?.kappa) || null; } catch (e) {}
      const registryStrand = strandMod.makeStrand({ backend: keyedBackend("registry::" + hexOf(operator)), now });
      await registryStrand.ready();
      window.HoloWorkspaces = makeWorkspaces({ registryStrand, strandFor, operator, now });
      window.HoloWorkspaces.makeWorkspaces = makeWorkspaces;
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-workspaces-ready"));
    } catch (e) { /* leave a bare factory; callers fail-soft */ if (typeof window !== "undefined" && !window.HoloWorkspaces) window.HoloWorkspaces = { makeWorkspaces }; }
  };
  wire();
}
