// holo-workspace.mjs — PER-APP WORKSPACE (Phase B): an app's saved state + full history, projected onto
// its own source chain. Each holospace tab / holo app is its own workspace — auto-saved, resumable, and
// time-travelable — with ZERO app code: the OS frame (holo-workspace-host) drives this. A snapshot is a
// `workspace.snapshot` entry on the app's strand, so history is deterministic, atomic, signed, and NEVER
// destroyed — rollback is an append (git-revert), not a delete (Law: monotonic). The user sees "rewind",
// never version control; no κ, no jargon. Pure + injectable (node-witnessable); browser host wires it live.

const KIND = "workspace.snapshot";
const stable = (s) => JSON.stringify(s === undefined ? null : s);

// makeWorkspace({ appKappa, strand, now }) → one app's workspace over its own (per-app) strand.
//   save(state)   → append a snapshot IFF it changed (lazy/cheap); returns the version entry or null.
//   resume()      → the latest saved state (or null) — what mount restores.
//   versions()    → the ordered history [{ n, seq, kappa, at, signed }] — "see all changes".
//   preview(n)    → the state at version n, READ-ONLY (scrub the timeline; no append).
//   revert(n)     → append a snapshot restoring version n (history intact + auditable); returns the entry.
//   diff(a,b)     → a plain change set between two versions { added, removed, changed, count }.
export function makeWorkspace({ appKappa, strand, now = () => "1970-01-01T00:00:00Z" } = {}) {
  if (!appKappa || !strand) throw new Error("a workspace needs an appKappa and a strand");
  const ready = () => (strand.ready ? strand.ready() : Promise.resolve());
  const snaps = () => strand.replay({ kind: KIND });
  const stateOf = (e) => (e && e["holstr:payload"] ? e["holstr:payload"].state : null);

  async function currentState() { await ready(); const s = snaps(); return s.length ? stateOf(s[s.length - 1]) : null; }

  async function save(state) {
    await ready();
    const cur = await currentState();
    if (cur !== null && stable(cur) === stable(state)) return null;          // lazy: unchanged → no version
    return strand.append({ kind: KIND, payload: { app: appKappa, state } });
  }

  async function versions() {
    await ready();
    return snaps().map((e, n) => ({ n, seq: e["holstr:seq"], kappa: e.id, at: e["prov:generatedAtTime"] || null, signed: !!e["holstr:sig"], revertOf: (e["holstr:payload"] || {}).revertOf ?? null }));
  }
  async function preview(n) { await ready(); const s = snaps(); return s[n] ? stateOf(s[n]) : null; }

  async function revert(n) {
    await ready();
    const s = snaps(); const e = s[n]; if (!e) return null;
    return strand.append({ kind: KIND, payload: { app: appKappa, state: stateOf(e), revertOf: n } });   // append-restore, never destroy
  }

  async function diff(a, b) {
    await ready();
    const A = (await preview(a)) || {}, B = (await preview(b)) || {};
    const ka = Object.keys(A), kb = Object.keys(B);
    const added = kb.filter((k) => !(k in A));
    const removed = ka.filter((k) => !(k in B));
    const changed = ka.filter((k) => k in B && stable(A[k]) !== stable(B[k]));
    return { added, removed, changed, count: added.length + removed.length + changed.length };
  }

  // bundle() → { head, entries } — the shareable/roamable form of this app's chain (for advertise).
  async function bundle() { await ready(); return { head: strand.head ? strand.head() : null, entries: strand.replay({}) }; }
  // adopt(entries) → adopt a peer's chain into THIS workspace (verify-before-adopt, fail-closed via the strand).
  async function adopt(entries) { await ready(); return strand.adopt ? strand.adopt(entries) : { ok: false, why: "no-adopt" }; }

  return { appKappa, save, resume: currentState, versions, preview, revert, diff, bundle, adopt };
}

if (typeof window !== "undefined") window.HoloWorkspace = { makeWorkspace };
