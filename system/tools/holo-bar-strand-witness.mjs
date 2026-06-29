#!/usr/bin/env node
// holo-bar-strand-witness.mjs — proves E4: a chrome bar is a NAVIGABLE, ROAMING κ-object.
// A bar edit appends to a holo-strand (append-only, hash-linked); the bar resolves from holo://bar/<κ>
// only on a VERIFIED history (Law L5); two devices converge by comparing histories, never destructively.
// Pure over holo-bar-strand + holo-strand + holo-workspace-roam + holo-bar. node tools/holo-bar-strand-witness.mjs
//
// Checks:
//   1 addressRoundTrip   — barAddress(κ) ⇄ parseBarAddress; accepts hex and did:holo:sha256 forms; rejects junk.
//   2 commitThenCurrent  — commit(items) then current() returns those items + a κ that re-derives (L1).
//   3 navigableResolve   — resolve(holo://bar/<κ>) returns the items for that κ ON the verified strand.
//   4 historyAttested    — every edit chains; strand.verify() holds; a tampered PAST edit breaks verify (L5).
//   5 tamperedCurrentSkip — a store entry whose payload.items ≠ payload.κ is NOT returned as current (L5).
//   6 resolveUnknownNull — resolving a κ that was never committed returns null (fail-closed).
//   7 roamFastForward    — device B (empty) adopts device A's history; heads converge.
//   8 roamDiverged       — A and B edit concurrently after a shared ancestor → diverged, BOTH lineages kept.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { barKappa } from "../os/usr/lib/holo/holo-bar.mjs";
import { barAddress, parseBarAddress, makeBarStrand } from "../os/usr/lib/holo/holo-bar-strand.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const digest = async (s) => createHash("sha256").update(s).digest("hex");
// distinct monotonic times so entries are unique (strand commits a time into each entry)
let t = 0; const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)).toISOString();

const A = [{ ref: "did:holo:sha256:" + "1".repeat(64), label: "Meet" }];
const AB = [...A, { ref: "did:holo:sha256:" + "2".repeat(64), kind: "ext", label: "uBlock" }];
const ABC = [...AB, { ref: "did:holo:sha256:" + "3".repeat(64), label: "Files" }];

// ── 1 · address round-trip ──────────────────────────────────────────────────────────────────────────
{
  const hex = "a".repeat(64);
  const fromHex = barAddress(hex);
  const fromDid = barAddress("did:holo:sha256:" + hex);
  ok("addressRoundTrip",
     fromHex === "holo://bar/" + hex && fromDid === fromHex &&
     parseBarAddress(fromHex) === hex && parseBarAddress("holo://nope") === null && barAddress("garbage") === "",
     fromHex);
}
// ── 2 · commit then current ─────────────────────────────────────────────────────────────────────────
{
  const bs = makeBarStrand({ strand: makeStrand({ now }), digest });
  const c = await bs.commit("bookmarks", AB);
  const cur = await bs.current("bookmarks");
  const expect = await barKappa(AB, digest);
  ok("commitThenCurrent",
     cur.kappa === expect && c.kappa === expect && JSON.stringify(cur.items) === JSON.stringify(AB) &&
     cur.address === "holo://bar/" + expect.replace("did:holo:sha256:", ""),
     cur.kappa);
}
// ── 3 · navigable resolve ───────────────────────────────────────────────────────────────────────────
{
  const bs = makeBarStrand({ strand: makeStrand({ now }), digest });
  await bs.commit("bookmarks", A);
  const c2 = await bs.commit("bookmarks", AB);          // newer state, same kind
  const hit = await bs.resolve(c2.address, "bookmarks");
  ok("navigableResolve", !!hit && hit.kappa === c2.kappa && JSON.stringify(hit.items) === JSON.stringify(AB), hit && hit.address);
}
// ── 4 · history attested; a tampered PAST edit breaks verify ────────────────────────────────────────
{
  const strand = makeStrand({ now });
  const bs = makeBarStrand({ strand, digest });
  await bs.commit("bookmarks", A);
  await bs.commit("bookmarks", AB);
  await bs.commit("bookmarks", ABC);
  const before = await strand.verify();
  // reach into the chain and mutate a past entry's payload (simulate a store tamper)
  const entries = strand.replay({});
  entries[1]["holstr:payload"].items = ABC;             // entry 1 now lies about what it committed
  const after = await strand.verify();
  ok("historyAttested", before.ok === true && before.length === 3 && after.ok === false && after.brokeAt === 1, JSON.stringify({ before: before.ok, after: after.ok, at: after.brokeAt }));
}
// ── 5 · a tampered current payload is skipped (κ ≠ items) ───────────────────────────────────────────
{
  const strand = makeStrand({ now });
  const bs = makeBarStrand({ strand, digest });
  await bs.commit("bookmarks", A);                       // intact older state
  await bs.commit("bookmarks", AB);                      // newest
  // tamper ONLY the newest payload's items (leave its κ stale) — current() must skip it and fall back to A
  const edits = strand.replay({});
  edits[edits.length - 1]["holstr:payload"].items = ABC; // items now ≠ payload.kappa
  const cur = await bs.current("bookmarks");
  ok("tamperedCurrentSkip", JSON.stringify(cur.items) === JSON.stringify(A), JSON.stringify(cur.items.map((x) => x.label)));
}
// ── 6 · unknown κ resolves to null ──────────────────────────────────────────────────────────────────
{
  const bs = makeBarStrand({ strand: makeStrand({ now }), digest });
  await bs.commit("bookmarks", A);
  const miss = await bs.resolve("holo://bar/" + "f".repeat(64), "bookmarks");
  ok("resolveUnknownNull", miss === null);
}
// ── 7 · roam: device B fast-forwards to device A's history ──────────────────────────────────────────
{
  const a = makeBarStrand({ strand: makeStrand({ now }), digest });
  await a.commit("bookmarks", A);
  await a.commit("bookmarks", AB);
  const b = makeBarStrand({ strand: makeStrand({ now }), digest });   // empty device
  const decision = await b.roam(a.bundle());
  const bCur = await b.current("bookmarks");
  ok("roamFastForward",
     decision.outcome === "fast-forward" && decision.adopted === true &&
     b.strand.head() === a.strand.head() && JSON.stringify(bCur.items) === JSON.stringify(AB),
     decision.outcome);
}
// ── 8 · roam: concurrent edits after a shared ancestor → diverged, keep both ────────────────────────
{
  // Shared genesis: build A's first entry, then have B ADOPT it so they share an ancestor, then each
  // appends a DIFFERENT edit → divergence.
  const a = makeBarStrand({ strand: makeStrand({ now }), digest });
  await a.commit("bookmarks", A);                         // shared ancestor (seq 0)
  const b = makeBarStrand({ strand: makeStrand({ now }), digest });
  await b.roam(a.bundle());                               // B fast-forwards onto the shared ancestor
  await a.commit("bookmarks", AB);                        // A's unique edit
  await b.commit("bookmarks", ABC);                       // B's concurrent, different edit
  const decision = await b.roam(a.bundle());              // B sees A's divergent head
  ok("roamDiverged",
     decision.outcome === "diverged" && decision.ancestorAt === 0 &&
     Array.isArray(decision.lineages) && decision.lineages.length === 2,
     decision.outcome + " @" + decision.ancestorAt);
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-bar-strand (E4) — a chrome bar is a NAVIGABLE, ROAMING κ-object. Each edit appends to a holo-strand (append-only, hash-linked); the head κ attests the whole edit history (Law L5 over the sequence). The current bar, and any past bar state, resolve from holo://bar/<κ> ONLY on a verified strand with items that re-derive to that κ. Two devices converge by comparing histories — fast-forward or keep-both, never destructive. Pure assembly over holo-strand + holo-workspace-roam + holo-bar; no new crypto, no new transport.",
  authority: "rests on #holo-strand + #holo-workspace-roam + #holo-bar",
  witnessed,
  covers: witnessed ? ["address-round-trip", "commit-then-current", "navigable-resolve", "history-attested", "tampered-current-skip", "resolve-unknown-null", "roam-fast-forward", "roam-diverged"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-bar-strand-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-bar-strand witness — a chrome bar is a navigable, roaming κ-object (E4)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  navigable holo://bar/<κ>, attested history, non-destructive roam" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
