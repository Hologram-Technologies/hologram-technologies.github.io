#!/usr/bin/env node
// holo-ad4m-fediverse-witness.mjs — FEDERATE: the sovereign Spaces read from and write to the open fediverse,
// serverless. A WebFinger handle resolves to an actor; a SIGNED public Note ingests into a Space as a
// verifying Expression (AS2 + UOR on one κ) carrying actor provenance; an UNSIGNED or FORGED activity is
// REFUSED (verify-before-adopt, Law L5); re-polling dedups; a Space post builds a valid AS2 Create{Note} to
// the user's own account. The bridge only does client GET/POST — it hosts nothing.
//
// Authority: W3C ActivityStreams 2.0 / ActivityPub · WebFinger (RFC 7033) · holospaces Laws L1/L5 · composes
// #holo-ad4m + #holo-object + #holo-identity. node tools/holo-ad4m-fediverse-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveActor, pollOutbox, ingestPolled, buildCreateNote, postToFediverse, verifyActivityEd25519, noteExpression } from "../os/usr/lib/holo/holo-ad4m-fediverse.mjs";
import { makeAd4m } from "../os/usr/lib/holo/holo-ad4m.mjs";
import { activitypubLanguage } from "../os/usr/lib/holo/holo-ad4m-fediverse.mjs";
import { canon } from "../os/usr/lib/holo/holo-identity.mjs";
import { verify as verifyObj } from "../os/usr/lib/holo/holo-object.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tk = 0; const now = () => `2026-06-25T00:00:${String(tk++).padStart(2, "0")}.000Z`;
const te = new TextEncoder();
const b64 = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
const SUB = globalThis.crypto.subtle;

// ── a real Ed25519 "actor" key (the federated identity that signs its activities) ────────────────────
const kp = await SUB.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const actorPub = b64(new Uint8Array(await SUB.exportKey("raw", kp.publicKey)));
const sign = async (obj) => b64(await SUB.sign({ name: "Ed25519" }, kp.privateKey, te.encode(canon(obj))));

const ACTOR_ID = "https://mastodon.example/users/ana";
const note = (id, content) => ({ id: `${ACTOR_ID}/statuses/${id}`, type: "Note", attributedTo: ACTOR_ID, content, published: "2026-06-25T00:00:00Z", to: ["https://www.w3.org/ns/activitystreams#Public"] });
const createOf = async (n, signed = true) => { const act = { id: `${n.id}/activity`, type: "Create", actor: ACTOR_ID, object: n }; return signed ? { ...act, signature: await sign(act) } : act; };

// signed real post, an unsigned one, and a forged one (signature over a DIFFERENT activity)
const signedAct = await createOf(note(1, "<p>the wise web greets the fediverse</p>"));
const unsignedAct = await createOf(note(2, "<p>no signature here</p>"), false);
const forgedAct = { ...(await createOf(note(3, "<p>tampered</p>"))), signature: (await sign({ id: "other", type: "Create" })) };

// ── an injected fetch over recorded fixtures (no live network) ───────────────────────────────────────
let getCount = 0, postCount = 0, lastPost = null;
const fetch = async (url, opts) => {
  if (opts && opts.method === "POST") { postCount++; lastPost = { url, opts }; return { status: 202, json: async () => ({}) }; }
  getCount++;
  if (/\.well-known\/webfinger/.test(url)) return { status: 200, json: async () => ({ subject: "acct:ana@mastodon.example", links: [{ rel: "self", type: "application/activity+json", href: ACTOR_ID }] }) };
  if (url === ACTOR_ID) return { status: 200, json: async () => ({ id: ACTOR_ID, type: "Person", preferredUsername: "ana", name: "Ana", outbox: `${ACTOR_ID}/outbox`, publicKey: { id: ACTOR_ID + "#main-key", owner: ACTOR_ID, ed25519: actorPub } }) };
  if (url === `${ACTOR_ID}/outbox`) return { status: 200, json: async () => ({ type: "OrderedCollection", orderedItems: [signedAct, unsignedAct, forgedAct] }) };
  return { status: 404, json: async () => ({}) };
};

const operator = await enroll({ label: "fedi-op", passphrase: "no island" });
const ad4m = makeAd4m({ signer: operator, store: new Map(), now });
ad4m.registerLanguage(activitypubLanguage);
const space = { perspective: ad4m.perspective({ backend: arrayBackend() }) };

// ── 1 · WebFinger resolves the handle to an actor (id + outbox + key) ────────────────────────────────
const actor = await resolveActor("@ana@mastodon.example", { fetch });
ok("webfingerResolves", actor.id === ACTOR_ID && /outbox$/.test(actor.outbox) && actor.publicKey && actor.publicKey.ed25519 === actorPub, JSON.stringify({ id: actor.id, name: actor.name }));

// ── 2 · poll the outbox: ONLY the signed Create{Note} survives verify-before-adopt ───────────────────
const seen = new Set();
const polled = await pollOutbox(actor, { fetch, seen });
ok("verifyBeforeAdopt", polled.length === 1 && polled[0].note.content.includes("greets the fediverse"), `survived=${polled.length} (signed only)`);

// ── 3 · the unsigned + forged activities were REFUSED (Law L5 at the edge) ───────────────────────────
const contents = polled.map((p) => p.note.content);
ok("unsignedAndForgedRefused", !contents.some((c) => c.includes("no signature")) && !contents.some((c) => c.includes("tampered")), JSON.stringify(contents.length));

// ── 4 · the verifier itself: tamper the signed activity's body ⇒ verify false ────────────────────────
const mutated = clone(signedAct); mutated.object.content = "<p>edited in flight</p>";
const vGood = await verifyActivityEd25519(signedAct, actor.publicKey);
const vBad = await verifyActivityEd25519(mutated, actor.publicKey);
ok("signatureVerifier", vGood === true && vBad === false, JSON.stringify({ good: vGood, bad: vBad }));

// ── 5 · ingest into the Space: a verifying Expression (AS2 + UOR on one κ) ───────────────────────────
const links = await ingestPolled(space, polled, ad4m);
const expr = ad4m.getExpression(links[0].expr);
ok("noteIsExpression", links.length === 1 && expr && verifyObj(expr) && expr["@type"].includes("Note") && expr["@type"].includes("ad4m:Expression"), JSON.stringify(expr && expr["@type"]));

// ── 6 · provenance names the federated actor; the Link is sourced to the handle ──────────────────────
ok("actorProvenance", expr["ad4m:provenance"].actor === ACTOR_ID && links[0].from === "@ana@mastodon.example" && space.perspective.links({ predicate: "posted" }).length === 1, JSON.stringify(expr["ad4m:provenance"]));

// ── 7 · re-poll dedups (idempotent — nothing new on the second pass) ─────────────────────────────────
const again = await pollOutbox(actor, { fetch, seen });
ok("dedupIdempotent", again.length === 0, `second poll yielded ${again.length}`);

// ── 8 · WRITE: a Space post builds a valid AS2 Create{Note} and POSTs to the user's OWN outbox ───────
const account = { actorId: ACTOR_ID, outbox: `${ACTOR_ID}/outbox`, token: "user-oauth-token" };
const sent = await postToFediverse(account, "posted from a sovereign Space", { fetch });
ok("postToFediverse", sent.ok && sent.create.type === "Create" && sent.create.object.type === "Note" && sent.create.object.content.includes("sovereign Space") && lastPost.opts.headers.authorization === "Bearer user-oauth-token", JSON.stringify({ status: sent.status }));

// ── 9 · CLIENT-ONLY: the bridge only did GET/POST — it hosts nothing (no server, no inbox, no relay) ─
ok("clientOnlyNoServer", getCount >= 3 && postCount === 1 && typeof globalThis.HoloFediverseServer === "undefined", JSON.stringify({ gets: getCount, posts: postCount }));

await forget(operator.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-ad4m-fediverse — the sovereign Spaces federate with the open fediverse, serverless. A WebFinger handle resolves to an actor; signed public Notes ingest as verifying Expressions (AS2 + UOR on one content-addressed κ) carrying actor provenance; unsigned/forged activities are refused (verify-before-adopt, Law L5); polling dedups; a Space post builds a valid AS2 Create{Note} posted to the user's OWN account. Read by polling, write as the user — we host nothing. An AP Note IS an Expression: a mapping, not a protocol reimplementation.",
  authority: "W3C ActivityStreams 2.0 / ActivityPub · WebFinger RFC 7033 · holospaces Laws L1/L5 · composes #holo-ad4m + #holo-object + #holo-identity",
  witnessed,
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ad4m-fediverse-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ad4m FEDERATE witness — the κ web joins the open fediverse (serverless, verify-before-adopt)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — no longer an island; every crossing byte verified` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
