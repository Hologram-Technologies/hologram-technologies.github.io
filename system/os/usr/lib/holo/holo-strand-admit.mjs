// holo-strand-admit.mjs — V of the Holochain-parity plan: PEER RE-VALIDATION ON RECEIPT. In Holochain a
// receiving peer is a validation authority — it re-runs the rules itself before storing or trusting an
// op, never on the author's say-so. Hologram already verifies-before-mount (the holospace gate, L5);
// this makes that gate a full validation authority: an incoming entry is admitted only if (1) its κ
// re-derives and its signature verifies (Law L5), (2) its author is not immune-blocked by a confirmed
// warrant (holo-warrant, W), and (3) it satisfies the governing content-addressed ruleset (holo-strand-
// rules, P4) when we re-run it ourselves. Fail-closed at every stage. Deterministic by construction —
// validate() reads only the entry + ruleset data (no clock, no randomness), so every peer reaches the
// same verdict (the discipline Holochain requires of validation callbacks).
//
// Pure assembly, additive, projection-only: no new crypto, no change to holo-strand. The one receive
// gate every transport (gossip, share-link, swarm dispatch) routes through. Reachable by agents
// (window.HoloStrandAdmit) and, via the shell's verify-before-mount, by humans.

import { verifyEntry } from "./holo-strand.mjs";
import { validate } from "./holo-strand-rules.mjs";

// admit(entry, { ruleset, immunity }) → { ok, stage?, why?, actor, signed }. The full receive-side check,
// fail-closed in order: integrity (L5) → immune (W) → rules (P4). `ruleset` is the governing ruleset
// object (resolve it by the entry's adopted ruleset κ); `immunity` is a holo-warrant makeImmunity().
export async function admit(entry, { ruleset = null, immunity = null } = {}) {
  const ev = await verifyEntry(entry);                                       // (1) Law L5 — κ re-derives, sig verifies
  if (!ev.ok) return { ok: false, stage: "integrity", why: ev.why, actor: null };
  const actor = entry["holstr:op"] || null;
  if (immunity && actor && immunity.isBlocked(actor)) return { ok: false, stage: "immune", why: "actor-blocked", actor };  // (2) W
  if (ruleset) {                                                             // (3) P4 — re-run the governing ruleset ourselves
    const v = validate(entry, ruleset);
    if (!v.ok) return { ok: false, stage: "rules", why: "invalid", violations: v.violations, actor };
  }
  return { ok: true, actor, signed: ev.signed };
}

// admitChain(entries, { ruleset, immunity }) → admit an incoming chain SEGMENT: every entry admits AND
// the segment links (seq monotonic from the first, each prev = the prior entry's κ). Returns
// { ok, length, admitted, rejectedAt?, why? }. Fail-closed — one bad entry refuses the whole segment.
export async function admitChain(entries = [], { ruleset = null, immunity = null } = {}) {
  let prev = entries.length ? (entries[0]["holstr:prev"] ?? null) : null;
  const baseSeq = entries.length ? (entries[0]["holstr:seq"] | 0) : 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const a = await admit(e, { ruleset, immunity });
    if (!a.ok) return { ok: false, length: entries.length, admitted: i, rejectedAt: i, why: a.why, stage: a.stage };
    if (e["holstr:seq"] !== baseSeq + i) return { ok: false, length: entries.length, admitted: i, rejectedAt: i, why: "seq-out-of-order" };
    if (e["holstr:prev"] !== prev) return { ok: false, length: entries.length, admitted: i, rejectedAt: i, why: "prev-link-broken" };
    prev = e.id;
  }
  return { ok: true, length: entries.length, admitted: entries.length };
}

// browser binding: the agent/transport seam. The shell's verify-before-mount routes incoming κ-objects
// through admit() so "valid" is enforced on receipt for humans too. Fail-soft; callers degrade if absent.
if (typeof window !== "undefined") {
  window.HoloStrandAdmit = { admit, admitChain };
}
