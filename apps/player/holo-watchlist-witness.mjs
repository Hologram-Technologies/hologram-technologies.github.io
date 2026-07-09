#!/usr/bin/env node
// holo-watchlist-witness.mjs — proves "My List" is an append-only, hash-linked κ-chain you own: adds are
// idempotent, the head attests the whole list, a tampered export is refused on adopt, and a clean export
// round-trips (portable + shareable + roamable). This is Jellyseerr's request DB replaced by a strand.
//
// Checks:
//   1 addAndList     — adding two titles lists both; add is idempotent (no dup).
//   2 hashLinked     — each entry chains to the previous (prev === prior id); verifyChain passes.
//   3 removeRelinks  — removing the middle re-links the tail into a still-valid chain.
//   4 exportAdopt    — a clean export adopts into a fresh list (verify-before-trust round-trip).
//   5 tamperRefused  — flipping a title in an export breaks re-derivation → adopt refuses.
//   6 reorderRefused — reordering entries breaks the prev-links → adopt refuses.
//
// node holo-watchlist-witness.mjs   (from holo-apps/apps/player/)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createWatchlist, memStore } from "./holo-watchlist.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const A = { id: "tmdb:movie:603", name: "The Matrix", kind: "movie", posterUrl: null, year: 1999 };
const B = { id: "tmdb:series:1396", name: "Breaking Bad", kind: "series", year: 2008 };
const C = { id: "tmdb:movie:27205", name: "Inception", kind: "movie", year: 2010 };

const wl = createWatchlist({ store: memStore() });

// 1
await wl.add(A, 1); await wl.add(B, 2); await wl.add(A, 3);   // third add is a dup
{
  const l = await wl.list();
  ok("addAndList", l.length === 2 && (await wl.has(A.id)) && (await wl.has(B.id)), JSON.stringify(l.map((e) => e.item.name)));
}
// 2
{
  const l = await wl.list();
  ok("hashLinked", l[0].prev === "" && l[1].prev === l[0].id && (await wl.verifyChain(l)), JSON.stringify(l.map((e) => [e.item.name, e.prev.slice(0, 10)])));
}
// 3
await wl.add(C, 4);                       // list: A, B, C
await wl.remove(B.id);                     // remove middle → A, C re-linked
{
  const l = await wl.list();
  ok("removeRelinks", l.length === 2 && l[0].item.id === A.id && l[1].item.id === C.id && l[1].prev === l[0].id && (await wl.verifyChain(l)), JSON.stringify(l.map((e) => e.item.name)));
}
// 4
{
  const payload = await wl.exportList();
  const fresh = createWatchlist({ store: memStore() });
  const adopted = await fresh.adopt(payload);
  const l = await fresh.list();
  ok("exportAdopt", adopted === true && l.length === 2 && l[1].item.id === C.id, JSON.stringify({ adopted, names: l.map((e) => e.item.name) }));
}
// 5 — tamper a title; adopt must refuse (id no longer re-derives)
{
  const payload = await wl.exportList();
  payload.entries[0] = { ...payload.entries[0], item: { ...payload.entries[0].item, name: "Hacked" } };
  const fresh = createWatchlist({ store: memStore() });
  ok("tamperRefused", (await fresh.adopt(payload)) === false, "expected refusal");
}
// 6 — reorder entries; the prev-links break → refuse
{
  const payload = await wl.exportList();
  payload.entries.reverse();
  const fresh = createWatchlist({ store: memStore() });
  ok("reorderRefused", (await fresh.adopt(payload)) === false, "expected refusal");
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-watchlist — 'My List' as an append-only, hash-linked κ-chain you own: idempotent adds, head attests the whole list, remove re-links the tail, a clean export adopts (verify-before-trust round-trip), and a tampered or reordered export is refused. Replaces Jellyseerr's request DB with a portable, shareable, roamable strand.",
  authority: "rests on #holo-watchlist (Holo-strand discipline) — Phase 2 of the streaming/metadata plan",
  witnessed,
  covers: witnessed ? ["add-and-list", "hash-linked", "remove-relinks", "export-adopt", "tamper-refused", "reorder-refused"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-watchlist-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-watchlist witness — My List as a hash-linked κ-chain you own (portable · verifiable · roamable)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the request DB, replaced by a strand you carry" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
