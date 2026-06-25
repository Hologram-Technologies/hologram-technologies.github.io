// holo-ad4m-fediverse.mjs — FEDERATE: let the sovereign Spaces read from and write to the open fediverse
// (ActivityPub / Mastodon), so the κ web stops being an island. The whole bridge rests on ONE fact:
// ActivityStreams 2.0 is JSON-LD, and a UOR Expression is JSON-LD — so an AP Note IS an Expression. This is
// a mapping, not a protocol reimplementation: we seal an AS2 object on the SAME content-addressed identity
// that carries the UOR vocab, zero loss (holo-object multi-vocab @context).
//
// Serverless, honestly asymmetric — we run NOTHING:
//   • read  = POLL a public actor's outbox (JSON-LD over HTTPS, pure client) → seal each Note as an Expression.
//   • write = POST a Create{Note} to the USER'S OWN account on their existing instance (their token).
//   • trust = VERIFY the actor's signature before adopting, then re-derive the sealed Expression (Law L5).
//             A peer/instance is a latency source, never a trust source. Unsigned/forged → refused.
// Real-time inbound delivery (an inbox/relay) is a later, optional step — not built here.
//
// fetch is INJECTED (deterministic in the witness, real fetch in the browser), so this is pure + isomorphic.
// The signature scheme is pluggable (HTTP Signatures / LD Signatures in production); the default verifier is a
// detached Ed25519 over the canonical activity, which captures the verify-before-adopt property end to end.

import { seal, verify as verifyObj, UOR_CONTEXT } from "./holo-object.mjs";
import { canon } from "./holo-identity.mjs";

const AS2 = "https://www.w3.org/ns/activitystreams";
const NS = "https://hologram.os/ns/ad4m#";
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
const te = new TextEncoder();
const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// an AP Note sealed as an Expression: AS2 + UOR on ONE content-addressed object (Law L1). The Note's content
// addresses to did:holo:sha256 like any Expression; provenance carries the federated origin (actor + activity).
export function noteExpression(note, prov = {}) {
  return seal({
    "@context": [AS2, ...UOR_CONTEXT, { ad4m: NS }],
    "@type": ["Note", "ad4m:Expression"],
    "ad4m:language": "activitypub",
    "ad4m:data": note,
    "ad4m:provenance": prov,
  });
}

// the activitypub Language for the facade: ad4m.createExpression("activitypub", { note, prov }).
export const activitypubLanguage = Object.freeze({
  name: "activitypub",
  create: ({ note, prov }) => noteExpression(note, prov || {}),
  get: (e) => (verifyObj(e) ? e : null),
});

// resolveActor(handle, { fetch }) — WebFinger → actor document. handle = "@user@instance" or "user@instance".
export async function resolveActor(handle, { fetch } = {}) {
  if (!fetch) throw new Error("resolveActor needs an injected fetch");
  const h = String(handle).replace(/^@/, "");
  const [user, instance] = h.split("@");
  if (!user || !instance) throw new Error("handle must be user@instance");
  const wf = await (await fetch(`https://${instance}/.well-known/webfinger?resource=acct:${h}`)).json();
  const links = (wf && wf.links) || [];
  const self = links.find((l) => l.rel === "self" && /activity\+json|ld\+json/.test(l.type || "")) || links.find((l) => l.rel === "self");
  if (!self || !self.href) throw new Error("no actor self-link in webfinger");
  const actor = await (await fetch(self.href)).json();
  return { handle: "@" + h, id: actor.id, outbox: actor.outbox, publicKey: actor.publicKey || null, name: actor.name || actor.preferredUsername || h };
}

// the default activity verifier (pluggable): a detached Ed25519 signature over the canonical activity (minus
// its `signature`) against the actor's published key. Production swaps in an HTTP Signatures / LD Signatures
// adapter — this keeps the VERIFY-BEFORE-ADOPT contract real end to end (a forged/unsigned activity → false).
export async function verifyActivityEd25519(activity, publicKey) {
  try {
    if (!SUB || !publicKey) return false;
    const raw = publicKey.ed25519 || publicKey.raw || null;
    const { signature, ...body } = activity || {};
    if (!signature || !raw) return false;
    const key = await SUB.importKey("raw", unb64(raw), { name: "Ed25519" }, false, ["verify"]);
    return await SUB.verify({ name: "Ed25519" }, key, unb64(signature), te.encode(canon(body)));
  } catch (e) { return false; }
}

// pollOutbox(actor, opts) — POLL a public outbox; return ONLY verified Create{Note}s (verify-before-adopt).
//   fetch          : injected client.
//   verifyActivity : (activity, actor.publicKey) → bool. Omit ⇒ accept (use only for unsigned/test corpora).
//   seen           : a Set of activity ids already adopted (idempotent dedup); mutated in place.
export async function pollOutbox(actor, { fetch, verifyActivity = verifyActivityEd25519, seen = new Set(), max = 50 } = {}) {
  if (!fetch || !actor || !actor.outbox) return [];
  const ob = await (await fetch(actor.outbox)).json();
  const items = (ob && (ob.orderedItems || ob.items)) || [];
  const out = [];
  for (const act of items) {
    if (out.length >= max) break;
    if (!act || act.type !== "Create" || !act.object || act.object.type !== "Note") continue;  // only public notes
    if (act.id && seen.has(act.id)) continue;                                                   // dedup (idempotent)
    if (verifyActivity) { const ok = await verifyActivity(act, actor.publicKey); if (!ok) continue; }  // L5 at the edge
    out.push({ note: act.object, prov: { actor: actor.id, activity: act.id || null, handle: actor.handle } });
    if (act.id) seen.add(act.id);
  }
  return out;
}

// ingestPolled(target, polled, ad4m) — seal each verified Note as an Expression and add a `posted` Link to
// the Space's Perspective, sourced to the federated actor. The chain is authored (signed) by the operator who
// pulled it in; the Expression's provenance names the actor — so the display shows "from @actor", honestly.
export async function ingestPolled(target, polled, ad4m) {
  const links = [];
  for (const { note, prov } of polled) {
    const { url } = ad4m.createExpression("activitypub", { note, prov });
    const link = await target.perspective.addLink({ source: prov.handle || prov.actor, predicate: "posted", target: url });
    links.push({ link, expr: url, from: prov.handle || prov.actor });
  }
  return links;
}

// ── WRITE: post as the user (their account, their token) — no inbox, no relay, nothing we host ──────────
export function buildCreateNote({ actorId, content, to = [PUBLIC] }) {
  return { "@context": AS2, type: "Create", actor: actorId, to, object: { type: "Note", attributedTo: actorId, content: String(content), to } };
}
export async function postToFediverse(account, content, { fetch } = {}) {
  if (!fetch || !account || !account.outbox) return { ok: false, reason: "need account.outbox + fetch" };
  const create = buildCreateNote({ actorId: account.actorId, content });
  const r = await fetch(account.outbox, { method: "POST", headers: { "content-type": "application/activity+json", authorization: "Bearer " + (account.token || "") }, body: JSON.stringify(create) });
  return { ok: r.status >= 200 && r.status < 300, status: r.status, create };
}

// browser binding: expose the bridge; surfaces wire follow/post through HoloWeb. fetch is the real one.
if (typeof window !== "undefined") {
  window.HoloFediverse = { resolveActor, pollOutbox, ingestPolled, verifyActivityEd25519, buildCreateNote, postToFediverse, activitypubLanguage };
}

export default { resolveActor, pollOutbox, ingestPolled, buildCreateNote, postToFediverse, activitypubLanguage, noteExpression, verifyActivityEd25519 };
