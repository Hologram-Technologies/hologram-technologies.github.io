#!/usr/bin/env node
// holo-ad4m-boot-witness.mjs — THE ONE FRONT DOOR: nine modules + a heartbeat behind a single object,
// window.HoloWeb, with EIGHT plain verbs that a human and an AI agent share. This drives the real composition
// root: the eight verbs work; the agent face and HoloWeb.post hit the SAME Space; guest mode still verifies;
// exactly one ambient instance is used; and NOTHING in the public surface names an engine concept.
//
// Authority: the unified Coasys-on-κ experience · holospaces Law L2 (one wire) / L5 (verifying web) · composes
// all 9 holo-ad4m modules + #holo-ambient. node tools/holo-ad4m-boot-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeHoloWeb } from "../os/usr/lib/holo/holo-ad4m-boot.mjs";
import { makeAmbient } from "../os/usr/lib/holo/holo-ambient.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tk = 0; const now = () => `2026-06-25T00:00:${String(tk++).padStart(2, "0")}.000Z`;

const ana = await enroll({ label: "web-ana", passphrase: "open one door" });
const ambient = makeAmbient();
const web = makeHoloWeb({ signer: ana, now, ambient, displayName: "Ana" });

// ── 1 · me() is a name/handle, never a raw DID ───────────────────────────────────────────────────────
const me = web.me();
ok("meIsAName", me.name === "Ana" && /^@[0-9a-f]{6}$/.test(me.handle) && !JSON.stringify(me).includes("did:holo"), JSON.stringify(me));

// ── 2 · open a Space by name (created on first open); spaces() lists it ──────────────────────────────
const opened = await web.open("Field Notes");
ok("openCreatesSpace", opened.ok && opened.space.name === "Field Notes" && web.spaces().some((s) => s.id === opened.space.id), JSON.stringify(opened.space));

// ── 3 · post a Thing; it appears when the Space is re-opened; people() includes me ───────────────────
const p = await web.post("Field Notes", "the wise web coheres sovereign agents");
const reopened = await web.open("Field Notes");
const ppl = web.people("Field Notes");
ok("postAppears", p.ok && reopened.posts.length === 1 && reopened.posts[0].text.includes("wise web") && ppl.some((x) => x.you), JSON.stringify({ posts: reopened.posts.length, by: reopened.posts[0] && reopened.posts[0].by }));

// ── 4 · private search returns the post with an origin (provenance), corpus not leaked ───────────────
const sr = await web.search("Field Notes", "wise coheres");
ok("searchWithOrigin", sr.ok && sr.results.length >= 1 && sr.results[0].origin === true && sr.results[0].from && !JSON.stringify(sr.results).includes("sovereign"), JSON.stringify(sr.results.map((r) => ({ from: r.from, origin: r.origin }))));

// ── 5 · the AI AGENT drives the SAME web via the MCP face; its post appears in HoloWeb ───────────────
const agent = web._internal.agentFace;
const homeSpace = web._internal.ensureSpace("Home");
const created = await agent.invoke("expression_create", { language: "literal", data: { kind: "note", text: "agent says hello" } });
await agent.invoke("perspective_add_link", { source: web.me().handle, predicate: "posted", target: created.url });
const home = await web.open("Home");
ok("agentSharesTheWeb", created.ok && home.posts.some((x) => x.id === created.url), `home posts=${home.posts.length}`);

// ── 6 · onChange fires when something happens (the live web) ─────────────────────────────────────────
let changed = null; const off = web.onChange((e) => { changed = e; });
await web.post("Field Notes", "a second note");
off();
ok("onChangeFires", changed && changed.kind === "post" && changed.post && changed.post.text === "a second note", JSON.stringify(changed && changed.kind));

// ── 7 · invite returns a link (a way to bring a person/device into a Space) ──────────────────────────
const inv = await web.invite("Field Notes");
ok("inviteLink", inv.ok && typeof inv.link === "string" && /space/.test(inv.link), inv.link);

// ── 8 · the PUBLIC surface is exactly the eight plain verbs — no engine jargon in the names ──────────
const verbs = Object.keys(web).filter((k) => typeof web[k] === "function");
const expected = ["me", "spaces", "open", "post", "search", "invite", "people", "onChange"];
const jargon = /perspective|expression|neighbourhood|kappa|κ|\bdid\b|strand|ad4m|ruleset/i;
ok("eightPlainVerbs", verbs.length === expected.length && expected.every((v) => verbs.includes(v)) && !verbs.some((v) => jargon.test(v)), JSON.stringify(verbs));

// ── 9 · ONE heartbeat: the organs registered on the single ambient instance (no second timer) ───────
const facultyNames = ambient.faculties().map((f) => f.name);
ok("oneHeartbeatWired", facultyNames.includes("ad4m:sync") && facultyNames.includes("ad4m:ingest") && facultyNames.includes("ad4m:heal"), JSON.stringify(facultyNames));

// ── 10 · guest mode (no signer) still yields a VERIFYING web (unsigned content still hash-links) ─────
const guest = makeHoloWeb({ now });
const g = await guest.post("Lobby", "hello as a guest");
const gOpen = await guest.open("Lobby");
const gVerify = await guest._internal.ensureSpace("Lobby").perspective.verify();
ok("guestStillVerifies", guest.me().guest === true && g.ok && gOpen.posts.length === 1 && gVerify.ok, JSON.stringify({ guest: guest.me().guest, v: gVerify.ok }));

await forget(ana.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-ad4m-boot — the one front door: nine witnessed modules + the ambient heartbeat collapse behind a single object (HoloWeb) with eight plain verbs (me/spaces/open/post/search/invite/people/onChange) that a human and an AI agent share on the same path. Spaces, posts, private search, people, invites — with zero engine jargon on the surface, one heartbeat, and a verifying web even as a guest. The whole Coasys-on-κ web, made simple.",
  authority: "Unified Coasys-on-κ experience · holospaces Laws L2/L5 · composes all 9 holo-ad4m modules + #holo-ambient",
  witnessed,
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ad4m-boot-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ad4m BOOT witness — one front door, eight plain verbs (humans and agents, one web)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — the Wise Web behind one simple door` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
