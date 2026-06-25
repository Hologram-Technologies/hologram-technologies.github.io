#!/usr/bin/env node
// holo-ad4m-flux-witness.mjs — THE FLUX SURFACE, proven felt. The boot witness proves the eight verbs and
// that the verb NAMES carry no jargon; this proves the part a human actually experiences: two operators in
// the same Space CONVERGE (a peer renders the real TEXT of a post it did not author), a tampered post does
// NOT render (verify-before-render, Law L5), the Social DNA refuses a malformed Link, private search cites
// origin without leaking the corpus, an AI agent drives the same Space a human reads — and the WORDS ON THE
// RENDERED SURFACE (apps/web/index.html) name no engine concept at all.
//
// Two makeHoloWeb instances are wired over an in-memory loopback transport (separate tabs/devices are real
// peers over a BroadcastChannel in the browser; here the channel is a direct call). No server, no daemon.
//
// Authority: unified Coasys-on-κ experience · holospaces L5 (verifying web) · LAND-flux-surface acceptance.
// node tools/holo-ad4m-flux-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeHoloWeb } from "../os/usr/lib/holo/holo-ad4m-boot.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tk = 0; const now = () => `2026-06-25T01:00:${String(tk++).padStart(2, "0")}.000Z`;

const ana = await enroll({ label: "flux-ana", passphrase: "two devices one web" });
const bob = await enroll({ label: "flux-bob", passphrase: "two devices one web" });

// the loopback: each side's transport delivers straight into the other side's deliver(). Delivery is
// fire-and-forget in production (a real P2P channel is eventual; the UI re-renders on the "sync" event), so
// for a DETERMINISTIC witness we capture every pending delivery promise and settle() the whole cascade —
// a delivery triggers a want/have answer which triggers more deliveries — until the bus is quiet.
let webA, webB;
const names = new Map([[ana.kappa, "Ana"], [bob.kappa, "Bob"]]);
const pending = [];
const enq = (p) => { pending.push(p); };
async function settle() { let n = 0; while (pending.length && n++ < 50) { const batch = pending.splice(0); await Promise.all(batch); } }
webA = makeHoloWeb({ signer: ana, now, displayName: "Ana", names, transport: { spacePost: (sid, m) => enq(webB._internal.deliver(sid, m)) } });
webB = makeHoloWeb({ signer: bob, now, displayName: "Bob", names, transport: { spacePost: (sid, m) => enq(webA._internal.deliver(sid, m)) } });

// both operators open the same Space (created on first open). Opening announces presence (want/have).
await webA.open("Garden");
await webB.open("Garden");
await settle();

// ── 1 · CONVERGENCE: Ana posts; Bob — a different operator — renders the real TEXT, by a NAME, no raw DID ──
await webA.post("Garden", "the tomatoes need water");
await settle();
const bobView = await webB.open("Garden");
const seen = bobView.posts.find((p) => p.text === "the tomatoes need water");
// the `by` an end user sees is a NAME, never a raw agent DID (the post `id` is the Thing's own content κ — that
// is correct and not surfaced as identity). So the gate is on author/by fields, not on the κ of the content.
const noRawAuthor = bobView.posts.every((p) => !/^did:/.test(String(p.by)) && !/did:holo/.test(String(p.by)));
ok("peerRendersText",
  !!seen && seen.by === "Ana" && noRawAuthor,
  JSON.stringify({ posts: bobView.posts.map((p) => ({ text: p.text, by: p.by })) }));

// ── 2 · LATE JOIN backfill: a third operator opens the Space AFTER the post and still sees it ──────────────
const cara = await enroll({ label: "flux-cara", passphrase: "two devices one web" });
let webC;
names.set(cara.kappa, "Cara");
// rewire A/B to also reach C (a tiny 3-node bus): broadcast to every other node (each delivery captured).
const bus = [];
const broadcast = (fromIdx) => (sid, m) => { bus.forEach((w, i) => { if (i !== fromIdx) enq(w._internal.deliver(sid, m)); }); };
const webA2 = makeHoloWeb({ signer: ana, now, displayName: "Ana", names, transport: { spacePost: broadcast(0) } });
const webB2 = makeHoloWeb({ signer: bob, now, displayName: "Bob", names, transport: { spacePost: broadcast(1) } });
webC = makeHoloWeb({ signer: cara, now, displayName: "Cara", names, transport: { spacePost: broadcast(2) } });
bus.push(webA2, webB2, webC);
await webA2.open("Plaza"); await webB2.open("Plaza"); await settle();
await webA2.post("Plaza", "welcome to the plaza"); await settle();
await webB2.post("Plaza", "glad to be here"); await settle();
const caraView0 = await webC.open("Plaza");           // Cara joins last; want/have backfills Links + bodies
await settle();
const caraView = await webC.open("Plaza");
ok("lateJoinBackfill",
  caraView.posts.length === 2 && caraView.posts.map((p) => p.text).join("|") === "welcome to the plaza|glad to be here",
  JSON.stringify(caraView.posts.map((p) => p.text)));

// ── 3 · TAMPER REFUSED: corrupt the Expression body on Bob's side; the post stops rendering (L5 on read) ───
// take a real synced post on Bob, mutate the stored body so it no longer re-derives to its κ, re-open.
const targetUrl = seen.id;
const hex = targetUrl.split(":").pop();
const bodyOnBob = webB._internal.ad4m.store.get(hex);
const tampered = JSON.parse(JSON.stringify(bodyOnBob));
tampered["ad4m:data"].text = "the tomatoes are ON FIRE";   // content changed, κ (id) left unchanged ⇒ won't verify
webB._internal.ad4m.store.set(hex, tampered);
const afterTamper = await webB.open("Garden");
ok("tamperDoesNotRender",
  !afterTamper.posts.some((p) => p.id === targetUrl) && !afterTamper.posts.some((p) => /ON FIRE/.test(p.text)),
  JSON.stringify(afterTamper.posts.map((p) => p.text)));

// ── 4 · FORGED AUTHOR REFUSED: a Links advertisement claiming Bob's authorship over Ana's entries is dropped ─
const anaSpace = webA._internal.spacesById.get("garden");
const anaEntries = anaSpace.perspective.raw.replay({});
const before = (await webB.open("Garden")).posts.length;
await webB._internal.deliver("garden", { t: "ad4m:links", author: bob.kappa, entries: anaEntries, from: "forge" });
const after = (await webB.open("Garden")).posts.length;
ok("forgedAuthorRefused", after === before, `before=${before} after=${after}`);

// ── 5 · SOCIAL DNA: a malformed Link (missing the target of the triple) is refused, fail-closed ────────────
const gate = anaSpace.dna.gate({ source: ana.kappa, predicate: "posted" });   // no target
ok("dnaRefusesMalformed", gate.ok === false && gate.why === "rule-violation", JSON.stringify(gate));

// ── 6 · PRIVATE SEARCH: a result carries an origin + a NAME, and the corpus text is not in the payload ─────
const sr = await webA.search("Garden", "tomatoes water");
ok("searchCitesOriginNoLeak",
  sr.ok && sr.results.length >= 1 && sr.results[0].origin === true && typeof sr.results[0].from === "string"
    && !JSON.stringify(sr.results).includes("tomatoes"),
  JSON.stringify(sr.results.map((r) => ({ from: r.from, origin: r.origin }))));

// ── 7 · AGENT PARITY: the MCP agent face posts into a Space, and a human reading that Space sees it ─────────
const agent = webA._internal.agentFace;
const made = await agent.invoke("expression_create", { language: "literal", data: { kind: "note", text: "agent waters the garden" } });
await agent.invoke("perspective_add_link", { source: webA.me().handle, predicate: "posted", target: made.url });
const home = await webA.open("Home");
ok("agentSharesTheSpace", made.ok && home.posts.some((p) => p.text === "agent waters the garden"), `home posts=${home.posts.length}`);

// ── 8 · JARGON GATE over the RENDERED surface: the words a human SEES in apps/web carry no engine concept ───
// extract visible text from the surface HTML: drop <script>/<style> blocks, drop tags, keep human-visible
// text + the placeholder/title/aria strings a user reads. Reject any engine vocabulary.
const surfacePath = join(here, "../../../holo-apps/apps/web/index.html");
const html = readFileSync(surfacePath, "utf8");
const noBlocks = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
const placeholders = [...noBlocks.matchAll(/(?:placeholder|title|aria-label|content)="([^"]*)"/gi)].map((m) => m[1]).join(" ");
const visibleText = noBlocks.replace(/<[^>]+>/g, " ") + " " + placeholders;
const JARGON = /perspective|expression|neighbourhood|neighborhood|\bκ\b|kappa|\bDID\b|\bstrand\b|ad4m|ruleset|holstr/i;
const jhit = visibleText.match(JARGON);
ok("surfaceHasNoJargon", !jhit, jhit ? `found "${jhit[0]}" in visible surface text` : "clean");

await Promise.all([forget(ana.kappa), forget(bob.kappa), forget(cara.kappa)]);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-ad4m-flux — the Flux surface, felt: two operators in one Space converge (a peer renders the real text of a post it did not author), a late joiner backfills, a tampered post does not render (L5 on read), a forged-author advertisement is dropped, the Social DNA refuses a malformed Link, private search cites origin without leaking the corpus, the MCP agent drives the same Space a human reads — and the words on the rendered surface (apps/web) name no engine concept.",
  authority: "Unified Coasys-on-κ experience · holospaces L5 · LAND-flux-surface acceptance · composes holo-ad4m{,-neighbourhood,-dna,-mcp,-synergy} via holo-ad4m-boot",
  witnessed,
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ad4m-flux-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ad4m FLUX witness — convergence, tamper-refusal, provenance, agent parity, zero surface jargon\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — a person and an agent both walk into the Wise Web` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
