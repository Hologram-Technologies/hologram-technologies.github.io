#!/usr/bin/env node
// holo-front-witness.mjs — STEP A of the ADAM convergence: the ONE front door makes the three nouns FELT.
// Proves an app surface bound to a Hologram node renders ONLY from the node (no private store); a grab-in-A →
// drop-in-B embed works through the live Pocket and re-resolves; an app declaring a private store is refused
// at mount; and a SECOND agent (Q) acts through the SAME front-door verbs (a peer, not ambient).
// Authority: ADAM "apps share through user-owned Perspectives" · the diagram's Interoperable row · Law L5.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeFront } from "../os/usr/lib/holo/holo-front.mjs";
import { EMBEDS } from "../os/usr/lib/holo/holo-pocket.mjs";
import { defineLanguage } from "../os/usr/lib/holo/holo-language.mjs";
import { seal, verify as verifyObj, UOR_CONTEXT } from "../os/usr/lib/holo/holo-object.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-27T00:00:${String(tick++).padStart(2, "0")}.000Z`;
const docLang = defineLanguage({
  name: "doc", capabilities: { storage: true },
  create: (data) => seal({ "@context": [...UOR_CONTEXT], "@type": ["ad4m:Expression"], "ad4m:language": "doc", "ad4m:data": data }),
  get: (e) => (verifyObj(e) ? e : null),
});

const alice = await enroll({ label: "front-alice", passphrase: "felt three nouns" });
const front = makeFront({ signer: alice, now });
front.node.languages.register(docLang);
const me = front.me();

// ── 1 · a conformant app mounts; an app with a PRIVATE STORE is refused (apps share only via Perspectives) ─
const editor = front.mount({ name: "editor", perspectives: ["notes"], produces: ["doc"], consumes: ["doc"] }, { backend: arrayBackend() });
const rogue = front.mount({ name: "rogue", perspectives: ["notes"], produces: ["doc"], consumes: ["doc"], store: { secret: 1 } });
ok("privateStoreRefused", editor.ok && rogue.ok === false && rogue.why === "private-store", JSON.stringify({ editor: editor.ok, rogue: rogue.why }));

// ── 2 · the app renders ONLY from the node: after put(), view() reflects the Perspective, no private copy ──
await editor.handle.put(me, "wrote", front.node.languages.express("doc", "field notes").url);
const view = editor.handle.view({ predicate: "wrote" });
const fromNode = editor.handle.perspective.query({ predicate: "wrote" });
ok("rendersFromNodeOnly",
  view.length === 1 && JSON.stringify(view) === JSON.stringify(fromNode) && front.app("editor").store === undefined,
  `view==query=${JSON.stringify(view) === JSON.stringify(fromNode)}`);

// ── 3 · grab-in-A → drop-in-B embed through the LIVE pocket; re-resolves (zero copy) ──────────────────
const board = front.mount({ name: "board", perspectives: ["wall"], produces: [], consumes: ["doc"] }, { backend: arrayBackend() });
const asset = front.node.languages.express("doc", "a shared note");
front.pocket.grab(front.pocket.wal(asset.url));               // grab in editor
const w = front.pocket.drop();                                 // drop into board
const emb = await front.pocket.embed(board.handle.perspective, me, w);
const embedded = board.handle.view({ predicate: EMBEDS });
const reresolved = front.pocket.resolve(front.pocket.wal(embedded[0].target));
ok("grabDropEmbedAcrossApps",
  emb.ok && embedded.length === 1 && embedded[0].target === asset.url && reresolved && reresolved.id === asset.url,
  JSON.stringify({ ok: emb.ok, n: embedded.length }));

// ── 4 · a SECOND agent (Q) acts through the SAME front-door verbs (a peer, not ambient) ───────────────
const q = await enroll({ label: "front-q", passphrase: "the local ai" });
const qFront = makeFront({ signer: q, now });
qFront.node.languages.register(docLang);
const qApp = qFront.mount({ name: "q-notes", perspectives: ["notes"], produces: ["doc"], consumes: ["doc"] }, { backend: arrayBackend() });
const qPut = await qApp.handle.put(qFront.me(), "wrote", qFront.node.languages.express("doc", "q's summary").url);
ok("qIsPeerThroughSameApi", qFront.me() !== me && qFront.me().startsWith("did:holo:") && qPut.ok && qApp.handle.view({ predicate: "wrote" }).length === 1, "Q uses the same verbs");

await forget(alice.kappa); await forget(q.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-front (ADAM convergence Step A) — the ONE front door makes the three nouns felt: an app is a thin view over a node (renders only from Perspective queries, stores nothing private); a private-store app is refused; grab→drop embed across apps works through the live Pocket and re-resolves zero-copy; Q acts as a peer through the same verbs.",
  authority: "ADAM apps-share-through-Perspectives · the meta-ontology diagram · Law L5",
  witnessed, checks, failed: fail,
};
writeFileSync(join(here, "holo-front-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-front — STEP A: the ONE front door (three nouns, felt)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — apps are thin views over the node; nothing private` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
