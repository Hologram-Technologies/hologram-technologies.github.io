// holo-membrane.mjs — M of the Holochain-parity plan: PER-APP MEMBRANES. In Holochain each hApp is its
// own validating network with a join boundary; here the same on the κ substrate. A MEMBRANE is a
// content-addressed κ-object that declares an app/space's boundary: its governing ruleset κ (P4 — what
// counts as valid inside), its join predicate (who may enter), and its operator authority. It is
// forkable (change the ruleset or the join → a new membrane κ). Entry is deterministic and fail-closed:
// open, or a verifiable operator-signed invite, or closed. Membership is a SEC-4 content-addressed roster
// bound to the membrane + operator (it re-derives, and changes iff membership or the membrane changes).
//
// The tie to the rest: a member's entries are governed by membrane.rulesetKappa, so holo-strand-admit (V)
// validates them under the membrane's rules — the membrane SCOPES validation per app. Pure assembly over
// holo-object (seal/verify) + holo-identity (canon/addressOf, the SEC-4 roster mechanism); no new crypto.

import { seal, verify as verifyObj, UOR_CONTEXT } from "./holo-object.mjs";
import { canon, addressOf } from "./holo-identity.mjs";

const NS = "https://hologram.os/ns/membrane#";
const te = new TextEncoder();
const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const keyParams = (a) => (a === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" });
const sigParams = (a) => (a === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" });

// defineMembrane({ app, operator, rulesetKappa, join }) → a content-addressed membrane (the app boundary).
//   join: { type: "open" } | { type: "invite" } | { type: "closed" }   (declarative, deterministic).
export function defineMembrane({ app, operator, rulesetKappa, join = { type: "open" } } = {}) {
  if (!operator) throw new Error("a membrane must bind an operator authority");
  return seal({ "@context": [...UOR_CONTEXT, { holmem: NS }], "@type": ["holmem:Membrane"], app: app || null, operator, rulesetKappa: rulesetKappa || null, join });
}

// issueInvite(membraneKappa, invitee, signer) → a signed, content-addressed invite (sig outside the
// addressed body, like every other claim). Only an invite signed by the membrane's operator admits.
export async function issueInvite(membraneKappa, invitee, signer) {
  if (!signer) throw new Error("an invite must be signed");
  const body = seal({ "@context": [...UOR_CONTEXT, { holmem: NS }], "@type": ["holmem:Invite"], membrane: membraneKappa, invitee });
  return { ...body, "holmem:sig": await signer.sign(body.id), "holmem:alg": signer.alg, "holmem:pub": signer.pub, "holmem:issuer": signer.kappa };
}

async function inviteValid(invite, { membrane, invitee, issuer }) {
  try {
    const { "holmem:sig": sig, "holmem:alg": alg, "holmem:pub": pub, "holmem:issuer": iss, ...body } = invite || {};
    if (!verifyObj(body)) return false;                                          // L5: invite κ re-derives
    if (body.membrane !== membrane || body.invitee !== invitee) return false;    // targets THIS membrane + candidate
    if (!sig || !pub || iss !== issuer) return false;                            // must be signed by the membrane operator
    if ((await addressOf(unb64(pub))) !== iss) return false;                     // pub content-addresses to the issuer (CC-1)
    if (!SUB) return true;
    const key = await SUB.importKey("raw", unb64(pub), keyParams(alg), false, ["verify"]);
    return SUB.verify(sigParams(alg), key, unb64(sig), te.encode(body.id));
  } catch { return false; }
}

// evaluateJoin(membrane, { candidate, invite }) → { admitted, why }. Deterministic, fail-closed.
export async function evaluateJoin(membrane, { candidate, invite = null } = {}) {
  const j = (membrane && membrane.join) || { type: "closed" };
  if (j.type === "open") return { admitted: true, why: "open" };
  if (j.type === "closed") return { admitted: false, why: "closed" };
  if (j.type === "invite") {
    if (!candidate || !invite) return { admitted: false, why: "invite-required" };
    const okI = await inviteValid(invite, { membrane: membrane.id, invitee: candidate, issuer: membrane.operator });
    return okI ? { admitted: true, why: "invited" } : { admitted: false, why: "invite-invalid" };
  }
  return { admitted: false, why: "unknown-join" };
}

// membraneRoster(membrane, members, operator) — the SEC-4 content-addressed membership: members reduced to
// κ + sorted, bound to the membrane κ + operator. Re-derives; changes iff membership OR membrane changes.
export async function membraneRoster(membrane, members = []) {
  const body = { "@type": "holmem:Roster", membrane: membrane.id, operator: membrane.operator, members: [...new Set(members.map(String))].filter(Boolean).sort() };
  const canonical = canon(body);
  const rosterKappa = await addressOf(te.encode(canonical));
  return { rosterKappa, canonical, ...body };
}
export async function verifyMembraneRoster(roster) {
  try {
    if (!roster || !roster.rosterKappa) return null;
    const { rosterKappa, canonical, ...body } = roster;
    if (canon(body) !== canonical) return null;
    if ((await addressOf(te.encode(canonical))) !== rosterKappa) return null;
    if (!body.membrane || !body.operator) return null;
    return body;
  } catch { return null; }
}

if (typeof window !== "undefined") {
  window.HoloMembrane = { defineMembrane, issueInvite, evaluateJoin, membraneRoster, verifyMembraneRoster };
}
