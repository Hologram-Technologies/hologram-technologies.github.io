// holo-q-collection-witness.mjs — Stage C proof (the data plane): a collection's STATE IS ITS FRONTIER, reduced
// deterministically (clock, κ) so all observers fold to byte-identical state (§2.7); every record/event is a κ
// (per-record, dedup SEC-3, re-derivable SEC-1/L5); concurrent writes both stay in the frontier and MERGE to one
// convergent state regardless of merge order (the multiplayer foundation); "add a field" folds in with no
// migration; tombstone hides without mutating history. Pure Node, substrate hash. Run: node …-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const C = await import(pathToFileURL(resolve(HERE, "../os/usr/lib/holo/q/holo-q-collection.mjs")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const genesis = C.makeGenesis({ owner: "alice", reducerK: "r1", recordKind: "expense", fields: [{ name: "title", type: "string" }, { name: "amount", type: "number" }] });

console.log("\nholo-q collection — state IS the frontier, deterministic, κ-addressed, convergent\n");

// ── 1) genesis seeds the collection; state reflects the declared shape ─────────────────────────────────────
console.log("genesis seeds the collection:");
{
  const coll = C.createCollection(genesis);
  const st = C.reduce(coll, C.recordsReducer);
  ok(/^[0-9a-f]{64}$/.test(coll.id), "the collection has a κ id (= its genesis)");
  ok(st.kind === "expense" && st.fields.length === 2 && Object.keys(st.records).length === 0, "reduced state reflects the declared kind + fields, no records yet");
  ok(coll.frontier.size === 1 && coll.frontier.has(coll.id), "the frontier is just the genesis");
}

// ── 2) appends: frontier advances; each record keyed by its OWN κ (per-record addressing) ─────────────────
console.log("\nappends advance the frontier; each record is a κ:");
let liveColl, rec1;
{
  const coll = C.createCollection(genesis);
  rec1 = C.append(coll, { kind: "expense", payload: { title: "Pizza", amount: 20 }, author: "alice" });
  const rec2 = C.append(coll, { kind: "expense", payload: { title: "Coffee", amount: 4 }, author: "bob" });
  const st = C.reduce(coll, C.recordsReducer);
  ok(/^[0-9a-f]{64}$/.test(rec1) && rec1 !== rec2, "each append yields a distinct record κ");
  ok(st.records[rec1].title === "Pizza" && st.records[rec2].amount === 4, "the records fold into state, addressed by their κ");
  ok(coll.frontier.size === 1 && coll.frontier.has(rec2), "the frontier is the latest head (linear append)");
  liveColl = coll;
}

// ── 3) DETERMINISTIC: the same events fold to byte-identical state regardless of insertion order ──────────
console.log("\ndeterministic: same events → byte-identical state, any order:");
{
  const entries = [...liveColl.events.entries()];                              // [κ, event] pairs
  const fwd = { id: liveColl.id, events: new Map(entries), frontier: liveColl.frontier };
  const rev = { id: liveColl.id, events: new Map([...entries].reverse()), frontier: liveColl.frontier };
  ok(eq(C.reduce(fwd, C.recordsReducer), C.reduce(rev, C.recordsReducer)), "the same events in forward vs reversed insertion order reduce to identical state (order-independent)");
}

// ── 4) CONCURRENT writes merge to ONE convergent state (multiplayer foundation) ───────────────────────────
console.log("\nconcurrent writes converge (the multiplayer foundation):");
{
  const base = C.createCollection(genesis);
  const alice = C.clone(base), bob = C.clone(base);
  C.append(alice, { kind: "expense", payload: { title: "Rent", amount: 800 }, author: "alice" });   // both off the same genesis frontier
  C.append(bob, { kind: "expense", payload: { title: "Wifi", amount: 30 }, author: "bob" });
  const ab = C.merge(alice, bob), ba = C.merge(bob, alice);
  ok(ab.frontier.size === 2, "two concurrent events both remain in the merged frontier (heads)");
  ok(eq(C.reduce(ab, C.recordsReducer), C.reduce(ba, C.recordsReducer)), "merge(A,B) and merge(B,A) reduce to the SAME state (convergent, order-free)");
  const st = C.reduce(ab, C.recordsReducer);
  ok(Object.values(st.records).some((r) => r.title === "Rent") && Object.values(st.records).some((r) => r.title === "Wifi"), "both writers' records are present after merge");
}

// ── 5) ADD A FIELD with no migration; tombstone hides without mutating history ────────────────────────────
console.log("\nschema-free evolution + tombstone:");
{
  const coll = C.createCollection(genesis);
  const r = C.append(coll, { kind: "expense", payload: { title: "Taxi", amount: 12 } });
  C.append(coll, { kind: "expense", payload: { title: "Gift", amount: 25, paidBy: "carol", split: 3 } });   // NEW fields, no migration
  let st = C.reduce(coll, C.recordsReducer);
  ok(Object.values(st.records).some((x) => x.paidBy === "carol" && x.split === 3), "a record with NEW fields folds in — no migration, no schema server");
  const before = coll.events.size;
  C.append(coll, { kind: "tombstone", payload: { target: r } });
  st = C.reduce(coll, C.recordsReducer);
  ok(!st.records[r] && coll.events.size === before + 1, "tombstone HIDES the record from state but the events (history) are retained");
}

// ── 6) L5: every event re-derives to its κ; SEC-3 dedup ───────────────────────────────────────────────────
console.log("\nintegrity + dedup:");
{
  const coll = C.createCollection(genesis);
  C.append(coll, { kind: "expense", payload: { title: "A", amount: 1 } });
  ok(C.verify(coll).ok, "every event re-derives to its κ (SEC-1/L5)");
  const dup = C.merge(coll, C.clone(coll));   // merging a replica with itself
  ok(dup.events.size === coll.events.size, "identical events resolve to one κ on merge (SEC-3 dedup)");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
