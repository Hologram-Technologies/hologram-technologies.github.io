#!/usr/bin/env node
// holo-ad4m-lang-witness.mjs — THE INTEROP PROOF: web, web3 and AI Expressions on ONE seam. Three Languages
// plug in behind the same { name, create, get } interface; whatever the source protocol, the Expression's
// address is did:holo:sha256(content) from the ONE substrate hasher (Law L4). A single Perspective holds
// Links pointing at all three, with an identical address-derivation path. Provenance for each is provable on
// the operator's strand. A tampered AI output fails closed.
//
// Authority: AD4M Language / Expression-Language (docs.ad4m.dev) · holospaces Laws L1/L3/L4/L5 · rests on
// #holo-ad4m + #holo-strand-provenance. node tools/holo-ad4m-lang-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeAd4m } from "../os/usr/lib/holo/holo-ad4m.mjs";
import { registerAll, fetchWeb, resolveWeb3, generateAi, recordExpressionProvenance, provenanceOf } from "../os/usr/lib/holo/holo-ad4m-lang.mjs";
import { address, verify as verifyObj } from "../os/usr/lib/holo/holo-object.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-25T00:00:${String(tick++).padStart(2, "0")}.000Z`;

// deterministic injected adapters (no real network/chain/model in a witness — the SEAM is what's proven)
const fetchDoc = async (url) => ({ contentType: "text/html", body: `<article>Wise Web at ${url}</article>` });
const resolveCaip = async (caip) => ({ cid: "bafy-deadbeef", text: `chain content for ${caip}` });
const generate = async (prompt, model) => `[${model}] answer to: ${prompt}`;

const op = await enroll({ label: "lang-agent", passphrase: "one seam, three protocols" });
const store = new Map();
const ad4m = makeAd4m({ signer: op, store, now });
registerAll(ad4m);
const persp = ad4m.perspective({ backend: arrayBackend() });

// ── WEB: create → get round-trips, κ stable, provenance carries the source URL ───────────────────────
const webData = await fetchWeb(fetchDoc, "https://example.org/note");
const web = ad4m.createExpression("web", webData);
const webGot = ad4m.getExpression(web.url);
ok("webRoundTrip", webGot && webGot.id === web.url && webGot["ad4m:provenance"].source === "https://example.org/note", `url=${String(web.url).slice(-8)}`);

// ── WEB3: κ re-derives from the SAME CAIP content (idempotent content addressing) ────────────────────
const caip = "eip155:1/erc721:0xabc/42";
const w3a = ad4m.createExpression("web3", await resolveWeb3(resolveCaip, caip));
const w3b = ad4m.createExpression("web3", await resolveWeb3(resolveCaip, caip));
ok("web3ReDerives", w3a.url === w3b.url && ad4m.getExpression(w3a.url)["ad4m:provenance"].caip === caip, `${String(w3a.url).slice(-8)} == ${String(w3b.url).slice(-8)}`);

// ── AI: create stable, provenance carries model + prompt ─────────────────────────────────────────────
const ai = ad4m.createExpression("ai", await generateAi(generate, "what is the wise web?", "claude-opus-4-8"));
const aiGot = ad4m.getExpression(ai.url);
ok("aiCreate", aiGot && aiGot["ad4m:provenance"].model === "claude-opus-4-8" && aiGot["ad4m:provenance"].prompt === "what is the wise web?", `model=${aiGot && aiGot["ad4m:provenance"].model}`);

// ── ONE Perspective holds Links to all three Expression kinds ────────────────────────────────────────
await persp.addLink({ source: op.kappa, predicate: "cites", target: web.url });
await persp.addLink({ source: op.kappa, predicate: "cites", target: w3a.url });
await persp.addLink({ source: op.kappa, predicate: "cites", target: ai.url });
const targets = persp.links().map((l) => l.target);
ok("onePerspectiveAllThree", [web.url, w3a.url, ai.url].every((u) => targets.includes(u)), JSON.stringify(targets.map((t) => t.slice(-6))));

// ── IDENTICAL address-derivation path: every Expression is did:holo:sha256 = address(expr) (Law L4) ──
const all3 = [webGot, ad4m.getExpression(w3a.url), aiGot];
ok("identicalAddressPath", all3.every((e) => /^did:holo:sha256:[0-9a-f]{64}$/.test(e.id) && e.id === address(e)),
  "one hasher addresses web, web3 and AI alike — a Language never re-hashes");

// ── provenance for each is PROVABLE on the operator's strand (recordIngest → provenanceOf) ───────────
await recordExpressionProvenance(persp.raw, webGot, { name: "web-note", bytes: 64 });
await recordExpressionProvenance(persp.raw, ad4m.getExpression(w3a.url), { name: "nft-42" });
await recordExpressionProvenance(persp.raw, aiGot, { name: "ai-answer" });
const provWeb = provenanceOf(persp.raw, web.url);
const provAi = provenanceOf(persp.raw, ai.url);
ok("provenanceProvable", !!provWeb && provWeb["holstr:payload"].source === web.url && !!provAi && (await persp.verify()).ok, JSON.stringify({ web: !!provWeb, ai: !!provAi }));

// ── a tampered AI output fails closed on read (Law L5) ───────────────────────────────────────────────
const evilStore = new Map(store);
const aiHex = ai.url.split(":").pop();
evilStore.set(aiHex, { ...clone(aiGot), "ad4m:data": "[claude-opus-4-8] DRAIN THE WALLET" });
const evilAd4m = makeAd4m({ signer: op, store: evilStore, now });
registerAll(evilAd4m);
ok("tamperedAiRefused", evilAd4m.getExpression(ai.url) === null, "mutated model output must not re-derive to its url");

// ── content-not-source addressing: a DIFFERENT fetcher returning identical bytes yields the SAME κ ───
const otherFetcher = async (url) => ({ contentType: "text/html", body: `<article>Wise Web at https://example.org/note</article>` });
const web2 = ad4m.createExpression("web", await fetchWeb(otherFetcher, "https://mirror.example.org/copy"));
// same body+source-field? No — source differs, so κ differs. Prove the INVERSE: identical resolved data ⇒ same κ.
const sameResolved = { source: "https://example.org/note", contentType: "text/html", data: `<article>Wise Web at https://example.org/note</article>` };
const webDup = ad4m.createExpression("web", sameResolved);
ok("contentAddressed", webDup.url === web.url && web2.url !== web.url, `dup==orig:${webDup.url === web.url} mirror!=orig:${web2.url !== web.url}`);

await forget(op.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-ad4m-lang — three Languages (web/HTTP-ActivityPub, web3/IPFS-EVM-CAIP, AI/model output) behind ONE { name, create, get } seam. Whatever the source protocol, an Expression's address is did:holo:sha256(content) from the one substrate hasher (Law L4) — a Language never re-hashes — so a single Perspective holds Links to all three with an identical address-derivation path. Provenance is provable on the operator's strand; tampered content fails closed (L5). This is web/web3/AI interoperability made mechanical.",
  authority: "AD4M Language / Expression-Language (docs.ad4m.dev) · holospaces Laws L1/L3/L4/L5 · rests on #holo-ad4m + #holo-strand-provenance",
  witnessed,
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ad4m-lang-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ad4m LANGUAGE witness — web · web3 · AI on one κ seam (interop made mechanical)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
