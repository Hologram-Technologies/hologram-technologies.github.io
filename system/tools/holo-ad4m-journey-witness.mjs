#!/usr/bin/env node
// holo-ad4m-journey-witness.mjs — THE UNIFICATION, END TO END. One cold-start narrative drives the WHOLE
// Coasys-on-κ stack as a single coherent experience, proving the pieces compose into one Wise Web:
//   Ana enrolls (an Agent = a key) → creates Expressions in three Languages (web · web3 · AI) → builds a
//   Perspective of Links → a Social DNA governs it → she publishes a Neighbourhood → Ben joins and converges
//   → a delegated AI agent drives the same ontology over the MCP face → a private Synergy search returns
//   provenance-stamped, credited results with the corpus never exposed. Everything re-derives; nothing leaks.
//
// This is the "mother test": a coherent journey through Flux (spaces/people/posts) + Synergy + an agent,
// where each step rests on a GREEN per-module witness. Authority: AD4M meta-ontology + Coasys Synergy +
// holospaces Laws L1–L5. node tools/holo-ad4m-journey-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeAd4m } from "../os/usr/lib/holo/holo-ad4m.mjs";
import { registerAll, fetchWeb, resolveWeb3, generateAi } from "../os/usr/lib/holo/holo-ad4m-lang.mjs";
import { makeDna, defineRuleset } from "../os/usr/lib/holo/holo-ad4m-dna.mjs";
import { makeNeighbourhood } from "../os/usr/lib/holo/holo-ad4m-neighbourhood.mjs";
import { makeAd4mAgent } from "../os/usr/lib/holo/holo-ad4m-mcp.mjs";
import { makeSynergy } from "../os/usr/lib/holo/holo-ad4m-synergy.mjs";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { recordIngest } from "../os/usr/lib/holo/holo-strand-provenance.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-25T00:00:${String(tick++).padStart(2, "0")}.000Z`;
const hub = { peers: [], inflight: [], post(from, m) { for (const p of this.peers) if (p.self !== from) this.inflight.push(Promise.resolve(p.onMessage(m))); }, async settle() { const f = this.inflight; this.inflight = []; await Promise.all(f); } };

// ── Ana arrives: an Agent is a key. No account, no server. ───────────────────────────────────────────
const ana = await enroll({ label: "journey-ana", passphrase: "one sovereign web" });
const ben = await enroll({ label: "journey-ben", passphrase: "cohere without a server" });
const anaAd4m = makeAd4m({ signer: ana, store: new Map(), now }); registerAll(anaAd4m);
ok("agentIsAKey", anaAd4m.me() === ana.kappa, `ana=${String(ana.kappa).slice(-8)}`);

// ── She makes three Things, from three different worlds, that all become the same kind of thing ──────
const web = anaAd4m.createExpression("web", await fetchWeb(async () => ({ contentType: "text/html", body: "<p>field notes</p>" }), "https://ana.example/notes"));
const w3 = anaAd4m.createExpression("web3", await resolveWeb3(async () => ({ cid: "bafy-1", text: "a minted artwork" }), "eip155:1/erc721:0x/7"));
const ai = anaAd4m.createExpression("ai", await generateAi(async (p) => "a summary of " + p, "field notes", "claude-opus-4-8"));
ok("threeWorldsOneThing", [web, w3, ai].every((e) => /^did:holo:sha256:/.test(e.url)) && anaAd4m.getExpression(web.url) && anaAd4m.getExpression(w3.url), "web · web3 · ai → one κ kind");

// ── A Space (Perspective) governed by Social DNA (only members, allowed predicates) ──────────────────
const members = new Set([ana.kappa, ben.kappa]);
const ruleset = defineRuleset({ name: "ana-space", version: 1, rules: { "ad4m:link": { require: ["source", "predicate", "target"], enum: { predicate: ["posted", "replied", "boosted"] } } } });
const anaPersp = anaAd4m.perspective({ backend: arrayBackend() });
const anaDna = makeDna({ perspective: anaPersp, ruleset, me: ana.kappa, isMember: (a) => members.has(a) });
const post1 = await anaDna.addLink({ source: ana.kappa, predicate: "posted", target: web.url });
const bad = await anaDna.addLink({ source: ana.kappa, predicate: "deleted", target: web.url }); // not allowed
ok("dnaGovernsTheSpace", post1.ok && bad.ok === false && (await anaDna.conformance()).ok, JSON.stringify({ posted: post1.ok, refusedBad: !bad.ok }));

// ── She publishes a Neighbourhood; Ben joins and converges — no server between them ──────────────────
const benAd4m = makeAd4m({ signer: ben, store: new Map(), now });
const benPersp = benAd4m.perspective({ backend: arrayBackend() });
const anaNb = makeNeighbourhood({ perspective: anaPersp, me: ana.kappa, self: "ANA", post: (m) => hub.post("ANA", m) });
const benNb = makeNeighbourhood({ perspective: benPersp, me: ben.kappa, self: "BEN", post: (m) => hub.post("BEN", m) });
hub.peers.push({ self: "ANA", onMessage: anaNb.onMessage }, { self: "BEN", onMessage: benNb.onMessage });
anaNb.publish(); await hub.settle();
await benNb.addLink({ source: ben.kappa, predicate: "replied", target: web.url }); benNb.publish(); await hub.settle();
ok("neighbourhoodConverges", benNb.sharedLinks().some((l) => l.author === ana.kappa) && anaNb.sharedLinks().some((l) => l.author === ben.kappa) && anaNb.members().length === 2, JSON.stringify({ a: anaNb.sharedLinks().length, b: benNb.sharedLinks().length }));

// ── A delegated AI agent drives the SAME ontology over the MCP face (agents are peers) ───────────────
const face = makeAd4mAgent({ ad4m: anaAd4m, perspective: anaPersp, neighbourhood: anaNb });
const created = await face.invoke("expression_create", { language: "literal", data: { note: "agent-made" } });
await face.invoke("perspective_add_link", { source: ana.kappa, predicate: "posted", target: created.url });
const q = await face.invoke("perspective_query", { predicate: "posted" });
ok("agentDrivesOntology", created.ok && q.ok && q.links.some((l) => l.target === created.url), `agent posted ${q.links.length} links`);

// ── Private Synergy search over the space, provenance-stamped + credited, corpus never exposed ───────
const creditStrand = makeStrand({ backend: arrayBackend(), now, signer: ana });
const provStrand = makeStrand({ backend: arrayBackend(), now, signer: ana });
const syn = makeSynergy({ creditStrand, provStrand });
syn.index({ url: web.url, text: "field notes on the wise web", owner: ana.kappa });
syn.index({ url: w3.url, text: "a minted artwork about coherence", owner: ben.kappa });
await recordIngest(provStrand, { source: web.url, name: "notes" });
await recordIngest(provStrand, { source: w3.url, name: "art" });
const session = "did:holo:sha256:" + "7".repeat(64);
const worker = await enroll({ label: "journey-worker", passphrase: "attested" });
const search = await syn.privateSearch(["wise", "coherence"], { worker, session });
const leaked = JSON.stringify(search.results).includes("field notes") || JSON.stringify(search.results).includes("artwork");
ok("synergyPrivateAndPaid", search.ok && search.results.length >= 2 && search.results.every((r) => r.provenance && r.credit) && !leaked && search.worker === worker.kappa, JSON.stringify({ n: search.results.length, leaked }));

// ── Everything she touched still re-derives — trust travelled with the bytes, not a server ───────────
const allVerify = (await anaPersp.verify()).ok && (await benPersp.verify()).ok && (await creditStrand.verify()).ok && (await provStrand.verify()).ok;
ok("everythingReDerives", allVerify, "every Perspective + ledger + provenance chain verifies (Law L5)");

await forget(ana.kappa); await forget(ben.kappa); await forget(worker.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-ad4m journey — the whole Coasys-on-κ stack as ONE coherent experience: an Agent is a key; Expressions from web/web3/AI all become the same κ kind; a Perspective governed by Social DNA; a Neighbourhood that converges with a peer over no server; a delegated AI agent driving the same ontology over MCP; a private, provenance-stamped, credited Synergy search that never exposes its corpus — and everything re-derives. The mother test: spaces, people, things you can trust, with all complexity abstracted.",
  authority: "AD4M meta-ontology (docs.ad4m.dev) · Coasys Synergy · holospaces Laws L1–L5 · composes all 8 holo-ad4m modules",
  witnessed,
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ad4m-journey-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ad4m JOURNEY witness — the whole stack as one coherent Wise Web (the mother test)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — Coasys unites on the κ substrate, end to end` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
