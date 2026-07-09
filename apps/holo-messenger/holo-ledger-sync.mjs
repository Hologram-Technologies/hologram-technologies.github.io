// holo-ledger-sync.mjs - the gossip transport that makes the κ-ledger's global single-claim REAL across replicas.
//
// holo-ledger.mjs proves convergence as math: any replicas holding the same transition set fold to the same winner.
// This layer actually MOVES transitions between replicas so they reach that shared set - by epidemic gossip, with no
// coordinator. It plugs in WITHOUT touching the escrow: `syncingStore` decorates the store's {get,set,has} seam, so
// every fund/claim/refund the escrow writes is automatically broadcast, and every transition a peer sends is merged
// back into the same store the escrow reads. A local optimistic claim that loses the global fold fires `onReconcile`.
//
// Transports are pluggable. `broadcastChannelTransport` is real same-origin cross-context gossip (two tabs / the app
// + the claim page are genuinely separate JS realms). `memoryBus` is the in-process test double with identical
// semantics (deliver-to-others, never-to-self). A relay / WebRTC transport (cross-internet, via the Together relay or
// iroh - see [[holo-dial-iroh]] / [[holo-messenger-together]]) implements the same 3-method interface and is the only
// remaining DEPLOY piece; the engine above it is transport-agnostic and proven here.

import { mergeInto, resolve, exportTransitions } from "./holo-ledger.mjs";

const _emptyRec = () => ({ funded: false, mode: "custodial", committed: null, transitions: {} });
async function _winner(rec, nowMs) { const r = await resolve(exportTransitions(rec), nowMs); return r.state === "claimed" ? r.winner : null; }

// ── syncing store decorator ───────────────────────────────────────────────────────────────────────────────────
// Wrap any base store so writes broadcast (delta only) and peer messages merge in. Returns the wrapped store + a
// `requestSync(kappa)` for anti-entropy (a late joiner pulls existing transitions). onReconcile(kappa, winner) fires
// when an incoming merge changes the canonical claimed-winner - i.e. this replica's optimistic claim was overtaken.
export function syncingStore(base, transport, { onReconcile = null, now = () => Date.now() } = {}) {
  const sent = new Map();        // kappa -> Set(tid) already put on the wire (loop/echo guard for normal gossip)
  const notified = new Set();    // kappa where we've already told the UI its optimistic claim was overtaken (fire once)
  const _seen = (k) => { let s = sent.get(k); if (!s) { s = new Set(); sent.set(k, s); } return s; };
  const _broadcast = (k, transitions) => {
    const s = _seen(k);
    const fresh = transitions.filter((t) => t && t.tid && !s.has(t.tid));
    if (!fresh.length) return;
    fresh.forEach((t) => s.add(t.tid));
    transport.post(k, fresh);
  };
  // fire onReconcile once when THIS replica's optimistic local commit is not the canonical winner - no matter HOW it
  // lost (an incoming better claim, or having claimed after already learning a better one). The UI's "claimed on
  // another device" signal must not depend on the path that produced the loss.
  const _maybeReconcile = async (k, rec) => {
    if (!onReconcile || notified.has(k) || !rec.committed) return;
    const r = await resolve(exportTransitions(rec), now());
    if (r.state === "claimed" && r.winner && r.winner !== rec.committed) { notified.add(k); onReconcile(k, r.winner); }
  };

  const wrapped = {
    has: (k) => base.has(k),
    get: (k) => base.get(k),
    set: (k, rec) => { base.set(k, rec); _broadcast(k, exportTransitions(rec)); _maybeReconcile(k, rec); },   // local write → gossip + reconcile check
  };

  transport.onMessage(async (msg) => {
    if (!msg || !msg.kappa) return;
    if (msg.type === "pull") {                                  // a peer is catching up → answer with the FULL set
      const rec = base.get(msg.kappa);                          // (bypass the echo-guard: a late joiner needs everything)
      if (rec) transport.post(msg.kappa, exportTransitions(rec));
      return;
    }
    if (msg.type !== "tx" || !Array.isArray(msg.transitions)) return;
    const rec = base.get(msg.kappa) || _emptyRec();
    await mergeInto(rec, msg.transitions, now());              // validates each (forged dropped) + set-union
    base.set(msg.kappa, rec);
    msg.transitions.forEach((t) => t && t.tid && _seen(msg.kappa).add(t.tid));   // mark seen so we don't echo them back
    _broadcast(msg.kappa, exportTransitions(rec));             // epidemic relay: forward anything still-fresh onward
    _maybeReconcile(msg.kappa, rec);
  });

  wrapped.requestSync = (k) => transport.postPull(k);
  return wrapped;
}

// ── real transport: BroadcastChannel (same-origin, cross-tab / cross-realm) ───────────────────────────────────
export function broadcastChannelTransport(name = "holo-escrow") {
  if (typeof BroadcastChannel === "undefined") return null;   // caller falls back to no-sync (single-replica) cleanly
  const bc = new BroadcastChannel(name);
  let handler = null;
  bc.onmessage = (e) => { if (handler) handler(e.data); };
  return {
    post: (kappa, transitions) => { try { bc.postMessage({ type: "tx", kappa, transitions }); } catch {} },
    postPull: (kappa) => { try { bc.postMessage({ type: "pull", kappa }); } catch {} },
    onMessage: (cb) => { handler = cb; },
    close: () => { try { bc.close(); } catch {} },
  };
}

// ── test transport: in-process bus with BroadcastChannel semantics (deliver to others, never to self) ─────────
export function memoryBus() {
  const eps = [];
  const deliver = (msg, from) => { for (const ep of eps) if (ep !== from) Promise.resolve().then(() => ep._recv && ep._recv(msg)); };
  return {
    endpoint() {
      let handler = null;
      const ep = {
        post: (kappa, transitions) => deliver({ type: "tx", kappa, transitions }, ep),
        postPull: (kappa) => deliver({ type: "pull", kappa }, ep),
        onMessage: (cb) => { handler = cb; },
        _recv: (m) => { if (handler) handler(m); },
      };
      eps.push(ep);
      return ep;
    },
  };
}
