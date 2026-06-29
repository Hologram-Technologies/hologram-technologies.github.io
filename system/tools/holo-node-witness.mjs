#!/usr/bin/env node
// holo-node-witness.mjs — STEP 2 of the ADAM convergence: the THREE-noun node API. Proves a Hologram node
// presents as exactly agent · languages · perspectives (mirroring ad4m's client), and that an ad4m-shaped
// call sequence — wrap data via a Language → link it in a Perspective → expose a Neighbourhood — runs
// end-to-end against the node. One door; three nouns; nothing else.
// Authority: github.com/coasys/ad4m core client (agent/languages/perspectives/neighbourhoods). node tools/holo-node-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeNode } from "../os/usr/lib/holo/holo-node.mjs";
import { defineLanguage } from "../os/usr/lib/holo/holo-language.mjs";
import { seal, verify as verifyObj, UOR_CONTEXT } from "../os/usr/lib/holo/holo-object.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-27T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const alice = await enroll({ label: "node-alice", passphrase: "one door three nouns" });
const node = makeNode({ signer: alice, now });

// ── 1 · AGENT (the who): the node is a sovereign DID ──────────────────────────────────────────────────
ok("agentIsSovereign", typeof node.agent.me() === "string" && node.agent.me().startsWith("did:holo:"), node.agent.me());

// ── 2 · LANGUAGE (objective): register a Language, wrap data → an Expression κ that re-verifies (L5) ───
const lit = defineLanguage({
  name: "lit", capabilities: { storage: true },
  // a Language that round-trips through the Expression store emits a routable Expression (ad4m:language)
  create: (data) => seal({ "@context": [...UOR_CONTEXT], "@type": ["ad4m:Expression"], "ad4m:language": "lit", "ad4m:data": data }),
  get: (e) => (verifyObj(e) ? e : null),
});
node.languages.register(lit);
const expr = node.languages.express("lit", "hello from a Language");
const reread = node.languages.get(expr.url);
ok("languageWrapsToKappa",
  expr.url.startsWith("did:holo:") && reread && reread.id === expr.url, `url=${String(expr.url).slice(0, 24)}…`);

// ── 3 · PERSPECTIVE (subjective): link the Expression into a signed graph; query finds it ─────────────
const p = node.perspectives.create({ backend: arrayBackend() });
const linked = await p.link(node.agent.me(), "authored", expr.url);
const found = p.query({ predicate: "authored" });
ok("perspectiveLinks",
  linked.ok && found.length === 1 && found[0].target === expr.url && typeof found[0].predicateKappa === "string",
  JSON.stringify({ ok: linked.ok, n: found.length }));

// ── 4 · NEIGHBOURHOOD: a Perspective exposes a share surface (sharedLinks + sync) ─────────────────────
ok("neighbourhoodShares", !!p.neighbourhood && typeof p.neighbourhood.sharedLinks === "function", "share surface present");

// ── 5 · the full ad4m-shaped sequence runs end-to-end through ONE door ────────────────────────────────
const seq =
  node.agent.me() === alice.kappa &&                                  // agent
  node.languages.names().includes("lit") &&                           // languages
  node.languages.express("lit", "again").url.startsWith("did:holo:") && // express
  (await p.link(node.agent.me(), "tagged", expr.url)).ok &&           // perspective
  p.query({ predicate: "tagged" }).length === 1;                      // read back
ok("ad4mShapedSequence", seq, "agent→language→perspective→query end-to-end");

// ── 6 · the node MIRRORS ad4m's client: every core verb is present on the three nouns ─────────────────
const map = {
  "agent.me": typeof node.agent.me === "function",
  "languages.register": typeof node.languages.register === "function",
  "languages.express": typeof node.languages.express === "function",
  "languages.byCapability": typeof node.languages.byCapability === "function",
  "perspectives.create": typeof node.perspectives.create === "function",
  "perspective.link": typeof p.link === "function",
  "perspective.query": typeof p.query === "function",
  "perspective.contract": typeof p.contract === "function",
  "perspective.neighbourhood": !!p.neighbourhood,
};
ok("mirrorsAd4mClient", Object.values(map).every(Boolean), JSON.stringify(Object.entries(map).filter(([, v]) => !v).map(([k]) => k)));

await forget(alice.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-node (ADAM convergence Step 2) — a Hologram node presents as exactly THREE nouns (agent · languages · perspectives), mirroring ad4m's client. An ad4m-shaped sequence (wrap data via a Language → link it in a Perspective → share via a Neighbourhood) runs end-to-end against one door. No new primitive — a thin composition over the three sealed seams.",
  authority: "github.com/coasys/ad4m core client · the meta-ontology diagram · Laws L1/L5",
  witnessed, clientMap: map, checks, failed: fail,
};
writeFileSync(join(here, "holo-node-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-node — STEP 2: the THREE-noun node API (mirrors ad4m's client)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — one door, three nouns` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
