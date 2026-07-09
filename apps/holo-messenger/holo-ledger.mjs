// holo-ledger.mjs - the swarm-replicated κ-ledger that gives an escrow GLOBAL single-claim across devices.
//
// The escrow's per-device Map blocks a second claim only on ONE device. A bearer link, though, can be opened on two
// devices at once - so "claimed at most once" must hold GLOBALLY. This ledger is the mechanism: each fund/claim/refund
// is a SIGNED, content-addressed transition; replicas exchange transitions and merge by SET UNION (a grow-only CRDT);
// the canonical state is a DETERMINISTIC fold over the merged set. Because the fold is a pure function of the set and
// the order is content-based, every replica that has seen the same transitions computes the SAME single winner - no
// coordinator, no locks, no consensus round. Two devices that each optimistically committed a different claim, once
// they gossip, converge on one winner and revoke the other.
//
// What's PROVEN offline here: the merge converges (set-union is commutative/associative/idempotent) and the fold is
// deterministic, so cross-replica agreement is math, not networking. What's DEPLOY: the gossip transport (iroh/swarm)
// that moves transitions between devices - modelled here by exportTransitions()/merge() so it's transport-agnostic.

import { sha256hex, verifySig, createSigner } from "./holo-pay.mjs";

// canonical string for a transition - every signed/identifying field, stable order. `by` = the signer's public key.
function _tcanon(t) {
  return ["L1", t.type, t.kappa, t.hashlock || "", t.preimage || "", String(t.amount ?? ""), t.asset || "", t.fiat || "", String(t.expires || ""), t.by || "", String(t.at || "")].join("|");
}

// build the transitions (each carries everything a fresh replica needs to validate it WITHOUT other context -
// crucial for an off-device claimer who only ever saw the link, never the sender's fund).
export async function makeClaim(intent, { claimSecret, signer, at }) {
  const t = { type: "claim", kappa: intent.kappa, hashlock: intent.hashlock, preimage: claimSecret, amount: intent.amount, asset: intent.asset, fiat: intent.fiat || null, expires: intent.expires, by: signer.pub, at };
  t.sig = await signer.sign(_tcanon(t));
  t.tid = await sha256hex(_tcanon(t));
  return t;
}
export async function makeRefund(intent, { signer, at }) {
  const t = { type: "refund", kappa: intent.kappa, expires: intent.expires, by: signer.pub, at };
  t.sig = await signer.sign(_tcanon(t));
  t.tid = await sha256hex(_tcanon(t));
  return t;
}

// a transition is valid in isolation iff its self-signature verifies AND its type-specific invariants hold. This is
// the gate every replica applies on merge - a forged or altered transition is silently dropped, never folded.
export async function validTransition(t, nowMs) {
  if (!t || !t.type || !t.kappa || !t.by || !t.sig) return false;
  if (!(await verifySig(t.by, t.sig, _tcanon(t)))) return false;
  if (t.type === "claim") {
    if (!t.preimage || (await sha256hex(t.preimage)) !== t.hashlock) return false;   // must reveal the real preimage
    if (t.expires && t.at > t.expires) return false;                                  // a claim minted after expiry is void
    return true;
  }
  if (t.type === "refund") return !!(t.expires && nowMs > t.expires);                  // refund only valid past the timeout
  return false;
}

// DETERMINISTIC fold: among valid claims, the winner is the earliest by (at, tid) - content-tiebroken, so identical on
// every replica. A claim beats any refund (you can't refund money that was claimed). Pure function of the set.
export async function resolve(transitions, nowMs = Date.now()) {
  const valid = [];
  for (const t of transitions) if (await validTransition(t, nowMs)) valid.push(t);
  const claims = valid.filter((t) => t.type === "claim");
  if (claims.length) {
    claims.sort((a, b) => (a.at - b.at) || (a.tid < b.tid ? -1 : a.tid > b.tid ? 1 : 0));
    const w = claims[0];
    return { state: "claimed", winner: w.tid, by: w.by, amount: w.amount, asset: w.asset, fiat: w.fiat };
  }
  const refunds = valid.filter((t) => t.type === "refund");
  if (refunds.length) {
    refunds.sort((a, b) => (a.at - b.at) || (a.tid < b.tid ? -1 : 1));
    return { state: "refunded", winner: refunds[0].tid };
  }
  return { state: "open" };
}

// the sync surface (transport-agnostic). exportTransitions → what you gossip; merge → fold a peer's transitions in.
export function exportTransitions(rec) {
  return rec && rec.transitions ? Object.values(rec.transitions) : [];
}
export async function mergeInto(rec, remote, nowMs = Date.now()) {
  rec.transitions = rec.transitions || {};
  for (const t of remote || []) {
    if (rec.transitions[t.tid]) continue;                 // idempotent - union by content id
    if (await validTransition(t, nowMs)) rec.transitions[t.tid] = t;
  }
  return rec;
}

export { createSigner };   // re-export so callers mint a claimer key without reaching into holo-pay
