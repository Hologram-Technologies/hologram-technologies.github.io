// holo-q-passport-witness.mjs — proves Q signs its OWN messages (Agent Passport authorship). Node, injected
// crypto (fake sign / verifySig / addressOf), real seal/verify for the messages. Proves: (1) attest binds the
// reply κ to Q's identity with a signature; (2) a valid note verifies to Q's agent; (3) a tampered message κ,
// (4) a swapped public key, and (5) a bad signature are each REFUSED (fail-closed); (6) makeQResponder with a
// passport writes a verifiable message.author note next to the finalized κ; (7) the group responder does too.

import { makeQPassport, verifyQAuthorship, AUTHOR_KIND } from "../os/usr/lib/holo/q/holo-q-passport.mjs";
import { makeQResponder, makeQGroupResponder } from "../os/usr/lib/holo/q/holo-q-contact.mjs";
import { seal, verify } from "../os/usr/lib/holo/holo-object.mjs";
import { messageObject } from "../os/usr/lib/holo/holo-pluck.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "  ok  " : "  XX  ") + m); c ? pass++ : fail++; };

// fake crypto: a signature is "SIG:<pub>:<msg>"; the identity is the content address of the pub.
const fakeAddressOf = async (pub) => "did:holo:sha256:" + String(pub).split("").reverse().join("");   // deterministic, pub-bound
const fakeSign = (pub) => async (msg) => "SIG:" + pub + ":" + String(msg);
const fakeVerifySig = async ({ pub, sig, msg }) => sig === "SIG:" + pub + ":" + String(msg);
const PUB = "QPUBKEY";
async function makePass() { const identity = await fakeAddressOf(PUB); return makeQPassport({ identity, alg: "Ed25519", pub: PUB, sign: fakeSign(PUB) }); }

const mintFn = (input) => ({ object: seal(messageObject(input)) });
function makeFakeThread() {
  const events = [], notes = [];
  return {
    view: () => events.map((e, i) => ({ text: e.text, sender: e.sender, seq: i, kappa: e.kappa })),
    ingest: async (input) => { const o = seal(messageObject(input)); if (!verify(o)) throw new Error("unverifiable"); events.push({ ...input, kappa: o.id }); return { kappa: o.id, seq: events.length - 1 }; },
    appendNote: async (kind, payload) => { notes.push({ kind, payload }); return { kind }; },
    _events: events, _notes: notes,
  };
}
const fakeBrain = (reply = "signed reply") => ({ setSkill: async () => {}, generate: async function* () { for (const w of reply.split(" ")) yield " " + w; } });
const V = { verifySig: fakeVerifySig, addressOf: fakeAddressOf };

// (1)(2) attest + verify
{
  const pp = await makePass();
  const note = await pp.attest("did:holo:sha256:abc123");
  ok(note.kind === AUTHOR_KIND && note.payload["holo:agent"] === pp.identity && note.payload["holo:message"] === "did:holo:sha256:abc123" && note.payload["holo:sig"], "attest binds the message κ to Q's identity with a signature");
  const r = await verifyQAuthorship(note.payload, V);
  ok(r.ok && r.agent === pp.identity, "a valid authorship note verifies to Q's agent");
}

// (3) tampered message κ → refused
{
  const pp = await makePass();
  const note = await pp.attest("did:holo:sha256:original");
  note.payload["holo:message"] = "did:holo:sha256:swapped";   // change the message the note claims
  const r = await verifyQAuthorship(note.payload, V);
  ok(!r.ok && r.why === "bad-signature", "tampered message κ → REFUSED (signature no longer matches)");
}

// (4) swapped public key (claim Q's agent but a different key) → refused
{
  const pp = await makePass();
  const note = await pp.attest("did:holo:sha256:x");
  note.payload["holo:pub"] = "ATTACKERKEY";   // agent stays Q, but the key isn't Q's
  const r = await verifyQAuthorship(note.payload, V);
  ok(!r.ok && r.why === "agent≠key", "swapped public key → REFUSED (agent must be the content address of its key)");
}

// (5) bad signature → refused
{
  const pp = await makePass();
  const note = await pp.attest("did:holo:sha256:y");
  note.payload["holo:sig"] = "SIG:QPUBKEY:forged";
  const r = await verifyQAuthorship(note.payload, V);
  ok(!r.ok && r.why === "bad-signature", "forged signature → REFUSED");
}

// (6) makeQResponder with a passport → a verifiable message.author note next to the reply κ
{
  const thread = makeFakeThread(), pp = await makePass();
  const q = makeQResponder({ thread, brain: fakeBrain("here you go"), passport: pp, now: () => "t" });
  const r = await q.respond("hi", {});
  ok(r.authored === true, "responder reports authored:true when a passport is bound");
  const note = thread._notes.find((n) => n.kind === AUTHOR_KIND && n.payload["holo:message"] === r.kappa);
  ok(!!note, "a message.author note is written next to the finalized reply κ");
  const v = await verifyQAuthorship(note.payload, V);
  ok(v.ok && v.agent === pp.identity, "the reply's authorship verifies to Q (1:1 chat)");
}

// (7) group responder signs its published message too
{
  const thread = makeFakeThread(), pp = await makePass();
  // a human @Q's
  { const o = seal(messageObject({ text: "@Q status?", sender: "Alice", chat: "g", source: "holo" })); thread._events.push({ text: "@Q status?", sender: "Alice", kappa: o.id }); }
  const qg = makeQGroupResponder({ brain: fakeBrain("all green"), passport: pp, now: () => "t" });
  const published = [];
  const r = await qg.respondInGroup(thread, { publish: async (o) => published.push(o), mintFn, group: "g" });
  ok(r.published && r.authored, "group reply published + authored");
  const note = thread._notes.find((n) => n.kind === AUTHOR_KIND && n.payload["holo:message"] === r.kappa);
  const v = note && await verifyQAuthorship(note.payload, V);
  ok(v && v.ok, "the group reply's authorship verifies to Q (@Q in a group)");
}

console.log(`\n${pass}/${pass + fail}${fail ? " FAIL" : " — WITNESSED: Q signs its own messages with its Agent Passport — a sibling provenance note binds each reply κ to Q's sovereign identity; tamper, a swapped key, or a forged signature are all refused. Authorship is Q's, not just the device's."}`);
process.exit(fail ? 1 : 0);
