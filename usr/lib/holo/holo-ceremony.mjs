// holo-ceremony.mjs — the INVISIBLE first-run ceremony for Holo Login. Runs silently the first time
// an operator enrols; the user never sees it. It composes the EXISTING Holo ZK + Holo Privacy (no new
// crypto), establishing the two things that make later "selective disclosure to apps, people and
// agents" possible — sovereignly, no server, no $500 rite:
//
//   1. SOVEREIGN KNOWLEDGE — the operator self-issues a salted-digest claim set (Holo ZK `sdIssue`,
//      IETF SD-JWT shape): name, did, created-at, device… Only the DIGESTS are signed + published;
//      the salts+values stay on the device. Later, Holo Privacy's gate() (default-deny) discloses
//      ONLY the claims a request is authorised for — the rest leak nothing (the salt hides them).
//   2. SOCIAL GRAPH — an empty, append-only, content-addressed edge log is opened. Relationships
//      accrue later as BILATERAL edges (two operators co-sign one edge — "the overlap is the
//      relationship; no platform owns it"). The blades/agentprivacy idea, done sovereignly.
//
// Every object is signed by the operator's key + content-addressed (id = κ of its canonical bytes),
// so anyone can re-derive + verify it (Law L5). Reuses holo-identity addressing + holo-pair verify.

import { addressOf, canon } from "./holo-identity.mjs";
import { verifySig } from "./holo-pair.mjs";

const te = new TextEncoder();
let _zk = null;
async function zk() { if (!_zk) { if (!globalThis.HoloZK) await import("./holo-zk.js"); _zk = globalThis.HoloZK; } return _zk; }   // holo-zk.js is an IIFE → globalThis.HoloZK

// firstRun(principal, { claims }) → { credential, disclosures, graph }. `principal` is a holo-login
// operator ({ kappa, did, label, alg, pub, sign }). `disclosures` (the salts+values) stays PRIVATE
// (on the device); `credential` + `graph` are signed + content-addressed (safe to publish).
export async function firstRun(principal, { claims = {}, nowIso } = {}) {
  const ZK = await zk();
  const at = nowIso || new Date().toISOString();
  const knowledge = { name: principal.label || "", did: principal.did, identity: principal.kappa, createdAt: at, ...claims };
  const sd = await ZK.sdIssue(knowledge);                              // { digests (signed set), disclosures (private) }
  const credBody = { "@type": "HoloKnowledge", iss: principal.kappa, did: principal.did, alg: principal.alg, digests: sd.digests, issuedAt: at };
  const credential = { id: await addressOf(te.encode(canon(credBody))), ...credBody, pub: principal.pub, sig: await principal.sign(canon(credBody)) };
  const graphBody = { "@type": "HoloSocialGraph", owner: principal.kappa, did: principal.did, alg: principal.alg, edges: [], openedAt: at };
  const graph = { id: await addressOf(te.encode(canon(graphBody))), ...graphBody, pub: principal.pub, sig: await principal.sign(canon(graphBody)) };
  return { credential, disclosures: sd.disclosures, graph };
}

// disclose ONLY `keys` from the held disclosures → a presentation that reveals nothing else.
export async function disclose({ digests, disclosures }, keys) { return (await zk()).sdDisclose({ digests, disclosures }, keys); }
export async function verifyDisclosure(presentation) { return (await zk()).sdVerify(presentation); }   // → revealed claims | null (forgery)

// verify a signed, content-addressed ceremony object (credential / graph): re-derive κ + check sig.
export async function verifyObject(obj) {
  if (!obj || !obj.id || !obj.sig) return false;
  const { id, sig, pub, ...body } = obj;
  const bytes = te.encode(canon(body));
  if (await addressOf(bytes) !== id) return false;
  return verifySig({ pub, alg: body.alg, sig, bytes });
}

// a BILATERAL social edge: two operators co-sign one relationship object (neither party — and no
// platform — owns it alone). Append it to both graphs. Either signature missing ⇒ not a real edge.
export async function bilateralEdge(a, b, { kind = "knows", nowIso } = {}) {
  const body = { "@type": "HoloEdge", a: a.kappa, b: b.kappa, aDid: a.did, bDid: b.did, kind, at: nowIso || new Date().toISOString() };
  const id = await addressOf(te.encode(canon(body)));
  return { id, ...body, algA: a.alg, algB: b.alg, pubA: a.pub, pubB: b.pub, sigA: await a.sign(canon(body)), sigB: await b.sign(canon(body)) };
}
export async function verifyEdge(edge) {
  if (!edge || !edge.id || !edge.sigA || !edge.sigB) return false;
  const { id, sigA, sigB, pubA, pubB, algA, algB, ...body } = edge;
  const bytes = te.encode(canon(body));
  if (await addressOf(bytes) !== id) return false;
  return (await verifySig({ pub: pubA, alg: algA, sig: sigA, bytes })) && (await verifySig({ pub: pubB, alg: algB, sig: sigB, bytes }));
}
