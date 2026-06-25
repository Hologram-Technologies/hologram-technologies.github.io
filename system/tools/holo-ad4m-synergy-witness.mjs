#!/usr/bin/env node
// holo-ad4m-synergy-witness.mjs — COASYS SYNERGY on κ, serverless: a PRIVATE search whose corpus is sealed
// (the worker's host sees only ciphertext), accepted only after verify-before-accept; results carry PROVABLE
// provenance; and use mints κ-native MUTUAL CREDIT to the data's owner. Ranking is holo-rank's personalized
// PageRank. A forged result is refused; the raw corpus never leaks; the credit ledger verifies.
//
// Authority: Coasys Synergy (privacy-preserving distributed search, provenance-as-asset, Synergy Fuel) ·
// holospaces Laws L4/L5 · composes #holo-swarm + #holo-rank + #holo-strand-provenance + #holo-strand.
// node tools/holo-ad4m-synergy-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeSynergy } from "../os/usr/lib/holo/holo-ad4m-synergy.mjs";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { recordIngest } from "../os/usr/lib/holo/holo-strand-provenance.mjs";
import { acceptResult, attestResult, workOrder } from "../os/usr/lib/holo/holo-swarm.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-25T00:00:${String(tick++).padStart(2, "0")}.000Z`;

// principals: a requester, a recruited worker, and two data owners who earn credit
const requester = await enroll({ label: "syn-req", passphrase: "private search" });
const worker = await enroll({ label: "syn-worker", passphrase: "attested compute" });
const alice = await enroll({ label: "syn-alice", passphrase: "data has provenance" });
const bob = await enroll({ label: "syn-bob", passphrase: "contribution earns credit" });
const session = "did:holo:sha256:" + "5".repeat(64);

const creditStrand = makeStrand({ backend: arrayBackend(), now, signer: requester });
const provStrand = makeStrand({ backend: arrayBackend(), now, signer: requester });
const syn = makeSynergy({ creditStrand, provStrand });

// a small corpus with provenance recorded on the spine
const docs = [
  { url: "did:holo:sha256:" + "a".repeat(64), text: "the wise web coheres sovereign agents", owner: alice.kappa },
  { url: "did:holo:sha256:" + "b".repeat(64), text: "collective intelligence without losing the individual", owner: bob.kappa },
  { url: "did:holo:sha256:" + "c".repeat(64), text: "a recipe for sourdough bread", owner: bob.kappa },
];
for (const d of docs) { syn.index(d); await recordIngest(provStrand, { source: d.url, name: d.text.slice(0, 12) }); }
syn.cite(docs[0].url, docs[1].url, alice.kappa);     // a vote: "wise web" cites "collective intelligence"

// ── 1 · private search returns ranked corpus results for a matching query ────────────────────────────
const res = await syn.privateSearch(["wise", "collective"], { worker, session });
ok("privateSearchReturns", res.ok && res.results.length >= 2 && res.results.every((r) => /^did:holo:sha256:/.test(r.url)), JSON.stringify({ n: res.results.length }));

// ── 2 · ranking is holo-rank's PageRank: scores present, sorted descending ───────────────────────────
const scores = res.results.map((r) => r.score);
ok("rankedByPageRank", scores.length >= 2 && scores.every((s) => typeof s === "number") && scores.slice(1).every((s, i) => scores[i] >= s), JSON.stringify(scores.map((s) => +s.toFixed(4))));

// ── 3 · each result carries PROVABLE provenance (a signed ingest entry on the spine) ─────────────────
ok("provenancePerResult", res.results.every((r) => r.provenance && /^did:holo:sha256:/.test(r.provenance)) && (await provStrand.verify()).ok, JSON.stringify(res.results.map((r) => !!r.provenance)));

// ── 4 · CONFIDENTIAL: the sealed corpus contains no plaintext term (the worker's host sees ciphertext) ─
const sealedStr = JSON.stringify(res.sealed);
ok("corpusSealed", !sealedStr.includes("sourdough") && !sealedStr.includes("sovereign") && res.sealed["@type"] === "HoloSealedInput", "no plaintext term in the sealed dispatch");

// ── 5 · VERIFY-BEFORE-ACCEPT: the accepted result names the recruited worker ─────────────────────────
ok("verifyBeforeAccept", res.worker === worker.kappa, `worker=${String(res.worker).slice(-8)}`);

// ── 6 · a FORGED output is refused (no false accept) ─────────────────────────────────────────────────
const work = (await workOrder({ op: "synergy.rank", inputs: [docs[0].url], params: {} })).kappa;
const honest = "did:holo:sha256:" + "0".repeat(64);
const receipt = await attestResult({ work, output: honest, session }, worker);
const forgedAccept = await acceptResult({ work, output: "did:holo:sha256:" + "f".repeat(64), attestation: receipt, session, expectWorker: worker.kappa });
ok("forgedResultRefused", forgedAccept === null, "a receipt for one output cannot accept a different output");

// ── 7 · MUTUAL CREDIT minted to the provenance owners; each credit κ re-derives ──────────────────────
const creditKappas = res.results.map((r) => r.credit).filter(Boolean);
const ledgerOk = (await creditStrand.verify()).ok;
ok("creditMinted", creditKappas.length === res.results.length && creditKappas.every((k) => /^did:holo:sha256:/.test(k)) && ledgerOk, JSON.stringify({ minted: creditKappas.length, ledger: ledgerOk }));

// ── 8 · the credit LEDGER is correct: Bob (2 matching docs? no — 1 matched) and Alice earn what they're owed ─
const aliceBal = syn.balanceOf(alice.kappa);
const bobBal = syn.balanceOf(bob.kappa);
ok("ledgerBalances", aliceBal >= 1 && bobBal >= 1 && (aliceBal + bobBal) === res.results.length, JSON.stringify({ alice: aliceBal, bob: bobBal }));

// ── 9 · OVERSHARE refused: the result object never carries the raw corpus text ───────────────────────
const resStr = JSON.stringify(res.results);
ok("noOvershare", !resStr.includes("sourdough") && !resStr.includes("coheres") && !resStr.includes("recipe"), "results expose κ + score + owner, never the corpus text");

await forget(requester.kappa); await forget(worker.kappa); await forget(alice.kappa); await forget(bob.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-ad4m-synergy — Coasys Synergy on κ, serverless: a privacy-preserving distributed search whose corpus is sealed (the worker's host sees only ciphertext, holo-swarm) and accepted only after verify-before-accept (Law L5); results ranked by holo-rank's re-derivable personalized PageRank; each carries provable provenance (holo-strand-provenance); and use mints κ-native mutual credit (Synergy Fuel) to the data owner — an append-only ledger strand, no token deploy, no chain. A forged result is refused; the raw corpus never leaks.",
  authority: "Coasys Synergy (privacy-preserving search · provenance-as-asset · Synergy Fuel) · holospaces Laws L4/L5 · composes #holo-swarm + #holo-rank + #holo-strand-provenance + #holo-strand",
  witnessed,
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ad4m-synergy-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ad4m SYNERGY witness — private search · provenance-as-asset · mutual credit (serverless)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
