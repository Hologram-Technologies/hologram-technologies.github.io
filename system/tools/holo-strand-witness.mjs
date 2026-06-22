#!/usr/bin/env node
// holo-strand-witness.mjs — proves THE OPERATOR'S SOURCE CHAIN (holo-strand): one hash-linked,
// operator-signed, append-only thread whose HEAD κ attests the WHOLE ordered history. This is
// Holochain's source-chain insight on the κ substrate — and it must FAIL CLOSED on any drop,
// reorder, insert, or content/signature tamper (Law L5 over the sequence, not just per record).
//
// It drives the REAL substrate: holo-object seal/verify for the content address, and a REAL enrolled
// holo-identity principal as the signer — so signed authorship is proven against the production axis,
// not a stub. Backend is an in-memory array so a fresh strand can "reload" it (durability proof).
//
// Checks (all must hold):
//   1 genesisAndAppendChain   — append advances head; seq 0..n; each prev = the prior entry's κ.
//   2 headAttestsHistory      — head === last entry κ; verify() ok with the right length + head.
//   3 everyEntryReDerives     — every entry's id re-derives from its body (Law L5, holo-object).
//   4 operatorSigned          — signed entries verify: sig over the entry κ, pub content-addresses to op.
//   5 tamperContentRefused    — mutate a middle entry's payload ⇒ verify refuses AT that index.
//   6 reorderRefused          — swap two entries ⇒ verify refuses (prev/seq linkage broken).
//   7 dropRefused             — remove a middle entry ⇒ verify refuses (prev link broken).
//   8 forgedSigRefused        — replace a signature with garbage ⇒ verify refuses (bad-sig).
//   9 durableReload           — a fresh strand over the SAME backend recovers the chain; head + verify hold.
//  10 unsignedStillChained    — a strand with NO signer still hash-links and verifies (content-address core).
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · IETF RFC 8785 (JCS) · W3C PROV-O · holospaces Laws
// L1/L2/L5 · rests on #holo-object + #holo-identity. node tools/holo-strand-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand, verifyEntry } from "../os/usr/lib/holo/holo-strand.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let store = clone(init); return { load: async () => clone(store), save: async (r) => { store = clone(r); }, dump: () => clone(store) }; };

let tick = 0;                                  // deterministic clock — distinct, ordered timestamps
const now = () => `2026-06-22T00:00:${String(tick++).padStart(2, "0")}.000Z`;

// a REAL operator principal as signer (production Ed25519/ECDSA axis via holo-identity)
const op = await enroll({ label: "strand-tester", passphrase: "correct horse battery" });

// ── build a 4-entry chain through the real signer ───────────────────────────────────────────────────
const backend = arrayBackend();
const strand = makeStrand({ backend, now, signer: op });
const e0 = await strand.append({ kind: "session.open", payload: { host: "primeos" } });
const e1 = await strand.append({ kind: "ingest", payload: { name: "note.txt", bytes: 42 } });
const e2 = await strand.append({ kind: "q.action", payload: { intent: "clear inbox", approved: true } });
const e3 = await strand.append({ kind: "wallet.approve", payload: { chain: "base", amount: "1.0" } });
const recs = [e0, e1, e2, e3];

// ── 1 · the chain links: head advances, seq is 0..3, each prev = the prior κ ─────────────────────────
ok("genesisAndAppendChain",
  e0["holstr:prev"] === null && e0["holstr:seq"] === 0
  && recs.every((r, i) => r["holstr:seq"] === i)
  && e1["holstr:prev"] === e0.id && e2["holstr:prev"] === e1.id && e3["holstr:prev"] === e2.id
  && strand.length() === 4,
  `head=${String(strand.head()).slice(0, 24)}…`);

// ── 2 · the head κ attests the whole history ─────────────────────────────────────────────────────────
const v = await strand.verify();
ok("headAttestsHistory", v.ok && v.length === 4 && v.head === e3.id && strand.head() === e3.id, JSON.stringify(v));

// ── 3 · Law L5: every entry id re-derives from its body (independent of the chain walk) ──────────────
const perEntry = await Promise.all(recs.map((r) => verifyEntry(r)));
ok("everyEntryReDerives", perEntry.every((r) => r.ok), JSON.stringify(perEntry.map((r) => r.ok)));

// ── 4 · operator signature: every entry is signed; sig verifies + pub content-addresses to the op κ ──
ok("operatorSigned",
  recs.every((r) => r["holstr:sig"] && r["holstr:op"] === op.kappa && r["holstr:pub"] === op.pub)
  && perEntry.every((r) => r.signed === true),
  "entries must carry a verifying operator signature bound to op κ");

// ── 5 · tamper the CONTENT of a middle entry ⇒ verify refuses at that index ──────────────────────────
const tampered = clone(backend.dump());
tampered[2]["holstr:payload"].intent = "drain wallet";
const vt = await makeStrand({ backend: arrayBackend(tampered) }).verify();
ok("tamperContentRefused", vt.ok === false && vt.brokeAt === 2, JSON.stringify(vt));

// ── 6 · reorder two entries ⇒ verify refuses (linkage broken) ────────────────────────────────────────
const reordered = clone(backend.dump());
[reordered[1], reordered[2]] = [reordered[2], reordered[1]];
const vr = await makeStrand({ backend: arrayBackend(reordered) }).verify();
ok("reorderRefused", vr.ok === false, JSON.stringify(vr));

// ── 7 · drop a middle entry ⇒ verify refuses (prev link no longer matches) ───────────────────────────
const dropped = clone(backend.dump()); dropped.splice(2, 1);
const vd = await makeStrand({ backend: arrayBackend(dropped) }).verify();
ok("dropRefused", vd.ok === false, JSON.stringify(vd));

// ── 8 · forge a signature ⇒ verify refuses (bad-sig) ─────────────────────────────────────────────────
const forged = clone(backend.dump());
forged[1]["holstr:sig"] = btoa("not a real signature over this entry key");
const vf = await makeStrand({ backend: arrayBackend(forged) }).verify();
const vf1 = await verifyEntry(forged[1]);
ok("forgedSigRefused", vf.ok === false && vf.brokeAt === 1 && vf1.ok === false, JSON.stringify({ vf, why: vf1.why }));

// ── 9 · durability: a FRESH strand over the same backend recovers the chain (a "reload") ─────────────
const reloaded = makeStrand({ backend, now });
await reloaded.ready();
const vrl = await reloaded.verify();
ok("durableReload", vrl.ok && vrl.length === 4 && reloaded.head() === e3.id, JSON.stringify(vrl));

// ── 10 · the content-address core works with NO signer (unsigned but still hash-linked) ─────────────
const plain = makeStrand({ backend: arrayBackend(), now });
const p0 = await plain.append({ kind: "event", payload: 1 });
const p1 = await plain.append({ kind: "event", payload: 2 });
const vp = await plain.verify();
ok("unsignedStillChained", vp.ok && vp.length === 2 && p1["holstr:prev"] === p0.id && !p0["holstr:sig"], JSON.stringify(vp));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-strand — THE OPERATOR'S SOURCE CHAIN: one hash-linked, operator-signed, append-only thread whose head κ attests the whole ordered history. Each entry is a UOR object addressed by its content (Law L1) that commits to the previous entry's κ (prev) and its seq, so drop/reorder/insert/content-tamper all break re-derivation (Law L5 over the sequence). An optional operator signature (the holo-identity Ed25519/ECDSA axis) binds authorship over the entry κ. Holochain's source-chain insight on the κ substrate — no DHT, no consensus. The store-fragmentation that makes resume/provenance drift collapses to ONE re-derivable spine.",
  authority: "UOR-ADDR (κ = H(canonical_form)) · IETF RFC 8785 (JCS) · W3C PROV-O · holospaces Laws L1/L2/L5 · rests on #holo-object + #holo-identity",
  witnessed,
  covers: witnessed ? ["hash-linked-chain", "head-attests-history", "law-l5", "operator-signed", "tamper-refused", "reorder-refused", "drop-refused", "forged-sig-refused", "durable-reload", "unsigned-content-chain"] : [],
  sample: { head: strand.head(), length: strand.length(), kinds: recs.map((r) => r["holstr:kind"]) },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-strand-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-strand witness — the operator's source chain (hash-linked · operator-signed · head attests history)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  chain: ${strand.length()} entries · head ${String(strand.head()).slice(0, 28)}… · kinds ${recs.map((r) => r["holstr:kind"]).join(", ")}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  scattered records collapse to one re-derivable, tamper-evident spine" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
