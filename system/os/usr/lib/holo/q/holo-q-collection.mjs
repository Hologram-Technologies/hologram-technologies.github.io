// holo-q-collection.mjs — Stage C: the data plane. A Collection is an app-interpreted closure of an event DAG;
// its STATE IS ITS FRONTIER (the head κs), reduced by the one reducer the genesis pins. Events are immutable,
// content-addressed (κ), causally ordered by parents + a Lamport clock with a (clock, κ) deterministic
// tiebreak, so "a frontier reduces to byte-identical output for all observers" (§2.7). Concurrent events both
// stay in the frontier and MERGE deterministically (CRDT-like — the multiplayer foundation). "Add a field"
// folds in with no migration (there is no schema server, only content). Per-record κ = a shareable/forkable
// row; identical content is one κ (SEC-3); every event re-derives to its κ (SEC-1/L5). Pure + sync →
// Node-witnessed; the κ-store IS the database, in-browser, serverless.
//
//   makeGenesis({ owner, reducerK, recordKind, fields, epoch }) -> genesis event
//   createCollection(genesis) / clone(coll)
//   append(coll, { kind, payload, author }) -> κ        // appends an event onto the frontier
//   merge(a, b) -> coll                                 // union of two replicas; heads recomputed
//   reduce(coll, reducer) -> state                      // deterministic fold (clock, κ)
//   verify(coll) -> { ok, bad, count }                  // L5: every event re-derives to its κ
//   recordsReducer                                      // the default record-collection reducer

import { sha256hex, jcs } from "../holo-uor.mjs";

const kOf = (ev) => sha256hex(jcs(ev));

export function makeGenesis({ owner = "", reducerK = "", recordKind = "item", fields = [], epoch = 0 } = {}) {
  return { kind: "genesis", parents: [], clock: 0, owner, reducer: reducerK, recordKind, fields, epoch };   // identity (its κ) = the collection id; never includes its own κ
}

export function createCollection(genesis) {
  const k = kOf(genesis);
  return { id: k, events: new Map([[k, genesis]]), frontier: new Set([k]) };
}
export const clone = (coll) => ({ id: coll.id, events: new Map(coll.events), frontier: new Set(coll.frontier) });

export function append(coll, { kind, payload = null, author = "" } = {}) {
  const parents = [...coll.frontier].sort();                                  // sorted → deterministic content
  const clock = 1 + parents.reduce((m, p) => Math.max(m, coll.events.get(p) ? coll.events.get(p).clock : 0), 0);
  const ev = { kind, collection: coll.id, parents, clock, author, payload };
  const k = kOf(ev);
  if (!coll.events.has(k)) {                                                   // SEC-3: identical content is one κ
    coll.events.set(k, ev);
    for (const p of parents) coll.frontier.delete(p);                         // parents are now observed → not heads
    coll.frontier.add(k);
  }
  return k;
}

// union two replicas by κ (dedup), then recompute the frontier = events referenced by nobody's parents.
export function merge(a, b) {
  const events = new Map([...a.events, ...b.events]);
  const referenced = new Set();
  for (const ev of events.values()) for (const p of ev.parents) referenced.add(p);
  const frontier = new Set([...events.keys()].filter((k) => !referenced.has(k)));
  return { id: a.id, events, frontier };
}

// deterministic total order: (clock, κ). A child's clock is strictly > its parents', so causal order is
// respected automatically; concurrent events tiebreak by κ → every observer folds to the same state (§2.7).
export function reduce(coll, reducer) {
  const pairs = [...coll.events.entries()].sort(([ka, a], [kb, b]) => (a.clock - b.clock) || (ka < kb ? -1 : ka > kb ? 1 : 0));
  let state;
  for (const [k, ev] of pairs) state = reducer(state, Object.assign({ _k: k }, ev));
  return state;
}

export function verify(coll) {
  let bad = 0;
  for (const [k, ev] of coll.events) if (kOf(ev) !== k) bad++;
  return { ok: bad === 0, bad, count: coll.events.size };
}

// the default reducer for a record collection. Platform kinds folded uniformly; an app record-append uses the
// event's κ as the record id (per-record κ); `edit` supersedes (original retained in history); `tombstone`
// hides a target (history retained). Pure — no clock/random/IO.
export function recordsReducer(state, ev) {
  if (ev.kind === "genesis") return { kind: ev.recordKind, fields: (ev.fields || []).slice(), records: {}, order: [] };
  if (!state) state = { kind: "item", fields: [], records: {}, order: [] };
  if (ev.kind === "tombstone") { const t = ev.payload && ev.payload.target; if (t && state.records[t]) { const r = { ...state.records }; delete r[t]; return { ...state, records: r, order: state.order.filter((x) => x !== t) }; } return state; }
  if (ev.kind === "edit") { const t = ev.payload && ev.payload.target; if (t && state.records[t]) return { ...state, records: { ...state.records, [t]: { ...state.records[t], ...(ev.payload.set || {}) } } }; return state; }
  if (ev.kind === "membership" || ev.kind === "epoch") return state;          // platform: handled by the auth plane (Stage E)
  return { ...state, records: { ...state.records, [ev._k]: ev.payload }, order: state.order.concat(ev._k) };   // a record-append: κ IS the id
}

export default { makeGenesis, createCollection, clone, append, merge, reduce, verify, recordsReducer };
