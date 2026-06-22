// holo-q-membership.mjs — Stage E: the identity / auth / token-gating plane, as the platform fold over the
// `membership` and `epoch` events of a collection. Self-sovereign identity is content-addressed from a key
// (SEC-4). A `membership` grant is VALID only if its author held `admin` at that position in reduced order, and
// may grant AT MOST the capabilities the author holds (attenuation; SEC-2). Revocation rotates the `epoch` →
// forward secrecy: the removed member loses perception of post-revocation content (SEC-5: κ is the capability to
// perceive). Per §2.9 a membership event exists ONLY when the granter authorizes (signs) it — the app cannot
// author it. Pure + deterministic (no clock/random/IO) → folds with holo-q-collection.reduce in (clock, κ)
// order, so all observers compute the same roster. Node-witnessed; runs in-browser, serverless.
//
//   membershipReducer(state, ev)                       // the platform fold → { owner, epoch, caps }
//   can(state, id, op) · isMember(state, id) · canPerceive(state, id)
//   identityOf(publicKeyBytesOrString) -> κ            // SEC-4: identity = content of the key
//   proposeMembership({action,subject,ops}) -> proposal(needsAuth)     // §2.9: propose, never auto-author
//   authorMembership(proposal, { author, sign }) -> event | null       // exists only on the granter's signature

import { sha256hex, jcs } from "../holo-uor.mjs";

const OPS = ["read", "write", "admin"];
const clean = (ops) => [...new Set((Array.isArray(ops) ? ops : []).filter((o) => OPS.includes(o)))].sort();

// SEC-4: an operator is a content-addressed identity, deterministic from their key; cannot be forged for another.
export const identityOf = (key) => "id:" + sha256hex(typeof key === "string" ? key : jcs(key));

// the platform fold. genesis names the owner (every capability). membership grants/revokes (validity +
// attenuation). epoch rotates the key. Folded in (clock, κ) order → validity is checked at each event's position.
export function membershipReducer(state, ev) {
  if (ev.kind === "genesis") return { owner: ev.owner, epoch: ev.epoch || 0, caps: { [ev.owner]: ["read", "write", "admin"] } };
  if (!state) state = { owner: "", epoch: 0, caps: {} };
  if (ev.kind === "epoch") return { ...state, epoch: (ev.payload && ev.payload.epoch != null) ? ev.payload.epoch : state.epoch + 1 };
  if (ev.kind === "membership") {
    const p = ev.payload || {};
    const authorOps = state.caps[ev.author] || [];
    if (!authorOps.includes("admin")) return state;                  // VALIDITY RULE: only an admin may author membership → else VOID
    const ops = clean(p.ops);
    if (p.action === "grant") {
      const granted = ops.filter((o) => authorOps.includes(o));      // ATTENUATION: grant ⊆ held (SEC-2)
      const cur = new Set(state.caps[p.subject] || []); granted.forEach((o) => cur.add(o));
      return { ...state, caps: { ...state.caps, [p.subject]: clean([...cur]) } };
    }
    if (p.action === "revoke") {
      const cur = new Set(state.caps[p.subject] || []); ops.forEach((o) => cur.delete(o));
      const caps = { ...state.caps }; if (cur.size) caps[p.subject] = clean([...cur]); else delete caps[p.subject];
      return { ...state, caps, epoch: state.epoch + 1 };              // REVOCATION → epoch rotation (forward secrecy, SEC-5)
    }
  }
  return state;                                                       // app kinds / tombstone: handled by the app reducer
}

export const can = (state, id, op) => !!(state && state.caps[id] && state.caps[id].includes(op));
export const isMember = (state, id) => !!(state && state.caps[id]);
// SEC-5: to perceive a collection you must hold `read` AND the current epoch key. A revoked member loses read,
// so canPerceive is false the moment the epoch rotates past them — they never receive the new epoch's content.
export const canPerceive = (state, id) => can(state, id, "read");

// §2.9: the app PROPOSES a membership change; it becomes an event ONLY when the granter authorizes (signs) it.
export function proposeMembership({ action, subject, ops, reason }) {
  return { kind: "membership", payload: { action, subject, ops: clean(ops), reason: reason || null }, needsAuth: true };
}
export function authorMembership(proposal, { author, sign } = {}) {
  if (!proposal || !author || typeof sign !== "function") return null;   // no authorization → no event (the app cannot author)
  const ev = { kind: "membership", payload: proposal.payload, author };
  let sig = null; try { sig = sign(ev); } catch (e) { sig = null; }
  if (!sig) return null;                                                  // the granter declined to sign → no grant
  return { ...ev, sig };
}

export default { membershipReducer, can, isMember, canPerceive, identityOf, proposeMembership, authorMembership };
