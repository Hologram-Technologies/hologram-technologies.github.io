// holo-home-reach.mjs — ZERO-CONFIG REACH, the differentiator. CasaOS tunnels back to one box (port-
// forward, DDNS, VPN); Holo Home has no box. A new device PAIRS (holo-pair: scoped, revocable, operator-
// signed grant — never the key), then over any transport it FETCHES the owner's Home chain and RECONCILES
// it into the local Home. There is no origin: every device is equal, the manifest is the only thing that
// roams, and a peer's Home is taken only after verify-before-adopt. This module owns the two decisions the
// reach needs and nothing else:
//
//   • the TRUST gate — a peer's Home is considered only if the bearer holds a valid delegation from the
//     owner (holo-pair verifyDelegation). No grant, no Home. This is what makes "scan a code" safe.
//   • the RECONCILE policy — given the local chain and a RECEIVED peer chain, decide: adopt (fast-forward),
//     in-sync, behind (keep local), diverged (keep both), or refuse (peer doesn't verify). adopt() itself
//     is the strand's verify-before-adopt; this just decides WHEN to call it.
//
// The transport (WebRTC / BroadcastChannel / κ-DHT) is the host/browser leg and is INJECTED — the surface
// hands a received chain here. Anchored on: holo-strand (verifyEntry), holo-pair (verifyDelegation),
// holo-home (adopt). No new crypto, no new transport.

import { verifyEntry } from "./holo-strand.mjs";
import { verifyDelegation } from "./holo-pair.mjs";

// verifyChain(chain) — standalone end-to-end validation of a RECEIVED chain (mirrors strand.adopt's walk):
// each entry re-derives + its signature checks, seq is in order, and each prev links. Local chains are
// already trusted (ours); this vets a peer's before any decision. Fail-closed.
export async function verifyChain(chain) {
  if (!Array.isArray(chain)) return { ok: false, why: "not-a-chain" };
  let prev = null;
  for (let i = 0; i < chain.length; i++) {
    const v = await verifyEntry(chain[i]);
    if (!v.ok) return { ok: false, brokeAt: i, why: v.why };
    if (chain[i]["holstr:seq"] !== i) return { ok: false, brokeAt: i, why: "seq-out-of-order" };
    if (chain[i]["holstr:prev"] !== prev) return { ok: false, brokeAt: i, why: "prev-link-broken" };
    prev = chain[i].id;
  }
  return { ok: true, head: prev, length: chain.length };
}

// reconcile(local, peer) — how a received peer Home relates to the local one. Pure + fail-closed.
//   refuse   — peer chain doesn't verify (tampered / forged) → never touch local.
//   adopt    — local is empty, OR peer strictly EXTENDS local (fast-forward) → take peer.
//   in-sync  — identical heads → nothing to do.
//   behind   — local already contains peer's history (local extends peer) → keep local.
//   diverged — shared prefix then a fork → keep BOTH; `longest` names which chain to present.
export async function reconcile(local = [], peer = []) {
  const v = await verifyChain(peer);
  if (!v.ok) return { action: "refuse", why: "peer-" + v.why, brokeAt: v.brokeAt ?? null };
  if (!Array.isArray(local) || local.length === 0) return { action: "adopt", why: "empty-local" };

  let cp = 0;
  while (cp < local.length && cp < peer.length && local[cp].id === peer[cp].id) cp++;
  const lh = local[local.length - 1].id, ph = peer[peer.length - 1].id;

  if (lh === ph) return { action: "in-sync" };
  if (cp === local.length && peer.length > local.length) return { action: "adopt", why: "fast-forward" };
  if (cp === peer.length && local.length > peer.length) return { action: "behind" };
  return { action: "diverged", forkAt: cp, longest: local.length >= peer.length ? "local" : "peer" };
}

// joinFromPeer(home, peerChain, { grant, nowMs, expectAud }) — the device-join path. First the TRUST gate:
// if a grant is supplied it must verify for this device (verify-before-trust); no valid grant ⇒ refuse,
// even when the peer chain would otherwise fast-forward. Then reconcile; on `adopt`, call home.adopt.
// Returns { ok, action, adopted, head, why }.
export async function joinFromPeer(home, peerChain, { grant = null, nowMs = undefined, expectAud = null, revoked = [] } = {}) {
  if (grant) {
    const v = await verifyDelegation(grant, { nowMs, expectAud, revoked });
    if (!v.ok) return { ok: false, action: "refuse", adopted: false, why: "ungranted:" + v.reason };
  }
  await home.ready();
  const local = home._strand.replay({});
  const r = await reconcile(local, peerChain);
  if (r.action === "adopt") {
    const a = await home.adopt(peerChain);
    return { ok: !!a.ok, action: a.ok ? "adopt" : "refuse", adopted: !!a.ok, head: a.ok ? a.head : home.head(), why: a.ok ? undefined : a.why };
  }
  return { ok: true, action: r.action, adopted: false, head: home.head(), longest: r.longest, forkAt: r.forkAt };
}

export default { verifyChain, reconcile, joinFromPeer };
