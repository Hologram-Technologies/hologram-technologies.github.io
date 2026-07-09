// holo-release-verify.mjs — downstream acceptance of a release pointer (S2/S3 of the downstream-holospace
// initiative). Isomorphic: the boot page, the service worker, and Node witnesses all use THIS one module.
//
// The rule (fail-closed, Law L5 + SEC-1/4/6):
//   a head is accepted only if (1) its id re-derives from its body, (2) it is SIGNED and the signature
//   verifies over the id, (3) authorship is CONTINUOUS with the pinned head (same pub key), and
//   (4) it does not travel backwards (seq strictly grows; the same head re-presented is a no-op).
// With no pin yet (first boot) the head is trusted-on-first-use and becomes the pin — every later
// update must chain from it. Rollback is NOT a violation: re-pinning a parent is an explicit local
// act (the store still holds it), never something a remote pointer can cause.

import { verifyEntry } from "../../usr/lib/holo/holo-strand.mjs";

// verifyChain(entries) — Law L5 over the whole strand: every entry re-derives + verifies its
// signature, seq is dense from 0, every prev is exactly the prior id. Mirrors strand.verify()
// for a plain array (the pointer file world has no backend).
export async function verifyChain(entries) {
  let prev = null;
  for (let i = 0; i < (entries || []).length; i++) {
    const rec = entries[i];
    const v = await verifyEntry(rec);
    if (!v.ok) return { ok: false, brokeAt: i, why: v.why };
    if (rec["holstr:seq"] !== i) return { ok: false, brokeAt: i, why: "seq-out-of-order" };
    if (rec["holstr:prev"] !== prev) return { ok: false, brokeAt: i, why: "prev-link-broken" };
    prev = rec.id;
  }
  return { ok: true, length: (entries || []).length, head: prev };
}

// acceptHead(head, pinned) → { ok, pin?, why?, unchanged? }
//   head   : the fetched release.json record (untrusted bytes from an untrusted origin)
//   pinned : the locally durable { id, seq, pub } from the last accepted release (null on first boot)
export async function acceptHead(head, pinned = null) {
  if (!head || typeof head !== "object") return { ok: false, why: "no-head" };
  const v = await verifyEntry(head);
  if (!v.ok) return { ok: false, why: v.why };                                   // tampered or forged (L5/SEC-1)
  if (!v.signed) return { ok: false, why: "unsigned-release" };                  // no signature → no update
  const pub = head["holstr:pub"], seq = head["holstr:seq"];
  if (pinned) {
    if (pub !== pinned.pub) return { ok: false, why: "key-discontinuity" };      // a different author cannot replace the strand (SEC-4)
    if (head.id === pinned.id) return { ok: true, unchanged: true, pin: pinned };
    if (!(seq > pinned.seq)) return { ok: false, why: "replay-stale-head" };     // an old release re-presented as new is refused
  }
  return { ok: true, pin: { id: head.id, seq, pub } };
}

export default { verifyChain, acceptHead };
