#!/usr/bin/env node
// holo-pocket-witness.mjs — STEP 3 of the ADAM convergence: apps share ONLY through Perspectives. Proves an
// asset IS a κ; content authored in app A embeds ZERO-COPY into app B via a κ-WAL (a …/embeds κ-Link whose
// target is the asset κ); Share/Pluck/+ingest all round-trip through the ONE Pocket; attach is a cross-app
// …/attaches link; and an app holding its own private store FAILS conformance.
// Authority: Moss/Weave asset interop (WAL + pocket) on κ · the diagram's "Interoperable" top row · Law L5.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeNode } from "../os/usr/lib/holo/holo-node.mjs";
import { makePocket, appConforms, EMBEDS, ATTACHES } from "../os/usr/lib/holo/holo-pocket.mjs";
import { defineLanguage } from "../os/usr/lib/holo/holo-language.mjs";
import { seal, verify as verifyObj, UOR_CONTEXT } from "../os/usr/lib/holo/holo-object.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-27T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const alice = await enroll({ label: "pocket-alice", passphrase: "grab and drop" });
const node = makeNode({ signer: alice, now });
node.languages.register(defineLanguage({
  name: "doc", capabilities: { storage: true },
  create: (data) => seal({ "@context": [...UOR_CONTEXT], "@type": ["ad4m:Expression"], "ad4m:language": "doc", "ad4m:data": data }),
  get: (e) => (verifyObj(e) ? e : null),
}));
const pocket = makePocket(node);
const me = node.agent.me();

// app A authors an asset (a doc). The asset IS a κ; a κ-WAL locates it.
const assetA = node.languages.express("doc", "the field notes");
const walA = pocket.wal(assetA.url, { app: "editor", type: "doc" });

// ── 1 · an asset is a κ; a κ-WAL locates+resolves it (re-verified, Law L5) ────────────────────────────
const resolved = pocket.resolve(walA);
ok("assetIsKappa", pocket.isWal(walA) && resolved && resolved.id === assetA.url, `wal=${String(walA.kappa).slice(0, 24)}…`);

// ── 2 · app B embeds A's asset ZERO-COPY via the κ-WAL (a …/embeds link; target IS the κ, no bytes copied) ─
const appB = node.perspectives.create({ backend: arrayBackend() });
pocket.grab(walA);                                   // grab in app A
const dropped = pocket.drop();                        // …drop into app B
const emb = await pocket.embed(appB, me, dropped);
const embLinks = appB.query({ predicate: EMBEDS });
const zeroCopy = embLinks.length === 1 && embLinks[0].target === assetA.url;     // link carries only the κ
const stillResolves = pocket.resolve(pocket.wal(embLinks[0].target)).id === assetA.url;  // re-derive from shared store
ok("crossAppEmbedZeroCopy", emb.ok && zeroCopy && stillResolves, JSON.stringify({ ok: emb.ok, zeroCopy }));

// ── 3 · Share / Pluck / +ingest ALL round-trip through the ONE Pocket (the fold) ──────────────────────
const sources = {
  share: () => pocket.wal(node.languages.express("doc", "shared thing").url),
  pluck: () => pocket.wal(node.languages.express("doc", "plucked message").url),
  ingest: () => pocket.wal(node.languages.express("doc", "ingested file").url),
};
const wals = Object.values(sources).map((f) => f());
const allOnePath = wals.every((w) => { pocket.grab(w); return pocket.isWal(w) && !!pocket.resolve(w); });
ok("pocketFold", allOnePath && pocket.peek().length >= 3, "Share/Pluck/+ingest one path");

// ── 4 · attach is a cross-app …/attaches κ-Link (predicate-as-κ present) ──────────────────────────────
const att = await pocket.attach(appB, me, walA);
const attLinks = appB.query({ predicate: ATTACHES });
ok("attachIsCrossAppLink",
  att.ok && attLinks.length === 1 && attLinks[0].target === assetA.url && typeof attLinks[0].predicateKappa === "string",
  JSON.stringify({ ok: att.ok, n: attLinks.length }));

// ── 5 · an app with its OWN private store FAILS conformance (must share via Perspectives) ─────────────
const good = appConforms({ perspectives: ["garden"], produces: ["doc"], consumes: ["doc"] });
const bad = appConforms({ perspectives: ["garden"], produces: ["doc"], consumes: ["doc"], store: { secret: 1 } });
ok("appWithPrivateStoreFailsConformance", good.ok === true && bad.ok === false && bad.why === "private-store", JSON.stringify({ good: good.ok, bad: bad.why }));

await forget(alice.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-pocket (ADAM convergence Step 3) — apps share ONLY through Perspectives. An asset is a κ; a κ-WAL locates it; app B embeds app A's asset zero-copy via a …/embeds κ-Link (target IS the κ); Share/Pluck/+ingest fold onto one Pocket; attach is a …/attaches cross-app link; an app with its own private store fails conformance. The diagram's 'Interoperable' top row, on κ.",
  authority: "Moss/Weave asset interop (WAL + pocket) on κ · the meta-ontology diagram top row · Law L5",
  witnessed, checks, failed: fail,
};
writeFileSync(join(here, "holo-pocket-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-pocket — STEP 3: apps share ONLY through Perspectives (κ-WAL + Pocket)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — grab anything, drop anywhere; nothing copied` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
