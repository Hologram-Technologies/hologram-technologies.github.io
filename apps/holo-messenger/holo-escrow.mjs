// holo-escrow.mjs - the custodial-by-κ escrow engine. THE LINK IS THE MONEY; this is the lock under it.
//
// A "send" can't pay an address - the recipient is unknown until they Claim. So we use a hashed-timelock escrow:
// the bearer `claimSecret` is a PREIMAGE; funding commits to `hashlock = H(claimSecret)` with `timeout = expires`;
// whoever reveals the preimage claims; after the timeout an unclaimed escrow refunds to the sender. The κ is the
// escrow id. State per κ is OPEN → CLAIMED | REFUNDED - exactly one terminal transition, enforced atomically.
//
// SETTLEMENT is behind a seam: a real chain-HTLC wallet (exposing `htlcFund`) locks on-chain (mode "live"); absent,
// the custodial-by-κ ledger records the lock (mode "custodial", testnet) so the UX round-trips WITHOUT pretending
// real value moved. The ledger here is a module-local store; production replaces it with a swarm-replicated κ-ledger
// (a CRDT/consensus state per κ) so the OPEN→CLAIMED/REFUNDED transition is globally atomic across devices.
//
// SECURITY GATES, every claim/fund: (1) the intent must be sender-SIGNED and unaltered (verifyIntent) - a forged or
// tampered intent is unfundable AND unclaimable; (2) not past its `expires`; (3) the revealed preimage must hash to
// the committed `hashlock`; (4) the κ must still be OPEN. Double-claim and claim-after-refund are impossible.

import { sha256hex, verifyIntent } from "./holo-pay.mjs";
import { makeClaim, makeRefund, resolve, exportTransitions, mergeInto, createSigner } from "./holo-ledger.mjs";

const _emptyRec = () => ({ funded: false, mode: "custodial", committed: null, transitions: {} });

// ── store seam ────────────────────────────────────────────────────────────────────────────────────────────────
// Default: a module-global Map (the custodial-by-κ ledger for this origin). Inject your own {get,set,has} to back it
// with localStorage/OPFS, or - in production - the swarm-replicated κ-ledger. get/set are synchronous on purpose:
// the claim critical-section must run with NO await between the OPEN check and the CLAIMED set (see claimEscrow).
const _MEM = new Map();
function _defaultStore() {
  return { get: (k) => _MEM.get(k) || null, set: (k, v) => _MEM.set(k, v), has: (k) => _MEM.has(k) };
}
// optional persistence across reloads in a browser; falls back to the in-memory ledger when there's no localStorage.
export function localStore(ns = "holo-escrow") {
  if (typeof localStorage === "undefined") return _defaultStore();
  const key = (k) => ns + ":" + k;
  return {
    get: (k) => { try { const s = localStorage.getItem(key(k)); return s ? JSON.parse(s) : null; } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(key(k), JSON.stringify(v)); } catch {} },
    has: (k) => { try { return localStorage.getItem(key(k)) != null; } catch { return false; } },
  };
}

// ── fund (on send) ────────────────────────────────────────────────────────────────────────────────────────────
export async function fund(intent, { store = null, wallet = null, chain = "base", nowMs = null } = {}) {
  const s = store || _defaultStore();
  if (!intent || !intent.kappa) return { ok: false, error: "no payment to fund" };
  if (!(await verifyIntent(intent))) return { ok: false, error: "this payment isn't authentically signed, refusing to fund" };
  if (!intent.hashlock) return { ok: false, error: "this payment has no escrow lock" };
  const now = nowMs || Date.now();
  if (intent.expires && now > intent.expires) return { ok: false, error: "already expired" };
  const existing = s.get(intent.kappa);
  if (existing && existing.funded) return { ok: true, kappa: intent.kappa, mode: existing.mode, live: existing.mode === "live", tx: existing.tx, already: true };   // idempotent

  const mode = wallet && typeof wallet.htlcFund === "function" ? "live" : "custodial";
  let tx = null, swapId = null;
  if (mode === "live") {
    let r;
    try { r = await wallet.htlcFund({ chain, amount: intent.amount, token: intent.asset, hashlock: intent.hashlock, timeout: intent.expires }); }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }   // declined/failed → NOTHING locked, NO link should ship
    tx = (r && (r.tx || r.hash)) || null; swapId = (r && r.swapId) || intent.hashlock;
  }
  const rec = existing || _emptyRec();
  rec.funded = true; rec.mode = mode; rec.tx = tx; rec.swapId = swapId; rec.chain = mode === "live" ? chain : null;
  rec.amount = intent.amount; rec.asset = intent.asset; rec.fiat = intent.fiat || null; rec.expires = intent.expires;
  s.set(intent.kappa, rec);
  return { ok: true, kappa: intent.kappa, mode, live: mode === "live", tx, swapId };
}

// ── claim (reveal the preimage) ───────────────────────────────────────────────────────────────────────────────
// The link itself proves the claim is legitimate (signed intent + revealed preimage), so this works off the funding
// device. Locally we OPTIMISTICALLY commit the first valid claim (sync critical-section → one local winner). The
// GLOBAL winner is decided by the ledger fold once replicas gossip (see escrowStatus.reconciled / mergePeer).
export async function claimEscrow(intent, { claimSecret = null, claimerPub = null, claimerSigner = null, store = null, nowMs = null, wallet = null } = {}) {
  const s = store || _defaultStore();
  const now = nowMs || Date.now();
  // authenticity + freshness + hashlock - a forged/tampered/expired/wrong-key claim never even enters the ledger
  if (!intent || !intent.kappa) return { ok: false, error: "not a payment" };
  if (!(await verifyIntent(intent))) return { ok: false, error: "this link isn't authentically signed" };
  if (intent.expires && now > intent.expires) return { ok: false, error: "this payment has expired" };
  const secret = claimSecret || intent.claimSecret;
  if (!secret) return { ok: false, error: "this link has no claim key" };
  if ((await sha256hex(secret)) !== intent.hashlock) return { ok: false, error: "this claim key doesn't match the payment" };

  // mint the signed claim transition (await BEFORE the critical section)
  const signer = claimerSigner || (await createSigner());
  const t = await makeClaim(intent, { claimSecret: secret, signer, at: now });

  // SYNC critical-section: record the transition + take the LOCAL optimistic commit (first valid claim wins here).
  const rec = s.get(intent.kappa) || _emptyRec();
  if (!rec.funded) rec.offDevice = true;
  const already = rec.committed && rec.committed !== t.tid;
  rec.transitions[t.tid] = t;
  if (!rec.committed) rec.committed = t.tid;
  s.set(intent.kappa, rec);
  if (already) return { ok: false, error: "already claimed" };

  // ON-CHAIN settlement leg. Live when this device funded on-chain (rec.mode) OR — for the RECIPIENT, who has no
  // funding record — when the wallet finds a live swap for this hashlock on a configured chain (auto-discovery, so
  // the tamper-proof source is the chain itself, not a hint in the link). Reveal the preimage → funds settle to the
  // claimer's address. The κ-ledger commit above stays the off-chain single-claim guard.
  let onchain = null, live = rec.mode === "live";
  if (wallet && typeof wallet.htlcClaim === "function") {
    try {
      const found = live ? { chain: rec.chain } : (typeof wallet.htlcSwapExists === "function" ? await wallet.htlcSwapExists({ hashlock: intent.hashlock }) : null);
      if (found) { live = true; rec.mode = "live"; rec.chain = rec.chain || found.chain || null; s.set(intent.kappa, rec);
        const cr = await wallet.htlcClaim({ chain: rec.chain || found.chain, hashlock: intent.hashlock, preimage: secret });
        onchain = (cr && (cr.tx || cr.hash)) || null;
      }
    } catch (e) { return { ok: false, error: "on-chain claim failed: " + String((e && e.message) || e) }; }
  }
  return { ok: true, amount: intent.amount, asset: intent.asset, fiat: intent.fiat || null, mode: rec.mode, live, offDevice: !!rec.offDevice, tid: t.tid, tx: onchain, claimerPub: claimerPub || signer.pub, custodialWallet: live ? null : "κ:" + intent.kappa.slice(0, 16) };
}

// ── refund (timeout) ──────────────────────────────────────────────────────────────────────────────────────────
export async function refund(intent, { store = null, signer = null, nowMs = null, wallet = null } = {}) {
  const s = store || _defaultStore();
  const now = nowMs || Date.now();
  if (!intent || !intent.kappa) return { ok: false, error: "not a payment" };
  const rec = s.get(intent.kappa);
  if (!rec) return { ok: false, error: "no escrow to refund" };
  const st = await resolve(Object.values(rec.transitions), now);
  if (st.state === "claimed") return { ok: false, error: "already claimed, can't refund" };
  if (st.state === "refunded") return { ok: false, error: "already refunded" };
  if (!(rec.expires && now > rec.expires)) return { ok: false, error: "not yet expired, can't refund" };
  const sgn = signer || (await createSigner());
  const t = await makeRefund(intent, { signer: sgn, at: now });
  rec.transitions[t.tid] = t;
  s.set(intent.kappa, rec);
  // ON-CHAIN refund leg — the funder reclaims from the contract (gated by the wallet). Only when this was funded live.
  let onchain = null;
  if (rec.mode === "live" && wallet && typeof wallet.htlcRefund === "function") {
    try { const rr = await wallet.htlcRefund({ chain: rec.chain, hashlock: intent.hashlock }); onchain = (rr && (rr.tx || rr.hash)) || null; }
    catch (e) { return { ok: false, error: "on-chain refund failed: " + String((e && e.message) || e) }; }
  }
  return { ok: true, amount: rec.amount, asset: rec.asset, mode: rec.mode, live: rec.mode === "live", tx: onchain };
}

// ── status - the canonical (post-merge) state via the deterministic ledger fold ───────────────────────────────
export async function status(kappaOrIntent, { store = null, nowMs = null } = {}) {
  const s = store || _defaultStore();
  const now = nowMs || Date.now();
  const k = typeof kappaOrIntent === "string" ? kappaOrIntent : (kappaOrIntent && kappaOrIntent.kappa);
  if (!k) return { state: "none" };
  const rec = s.get(k);
  if (!rec) return { state: "none" };
  const r = await resolve(Object.values(rec.transitions), now);
  if (r.state === "open") return { state: rec.funded ? "open" : "none", committed: rec.committed || null, canonicalWinner: null, reconciled: false };
  // reconciled = this replica's optimistic local winner is NOT the global canonical winner → it was revoked on gossip.
  return { state: r.state, canonicalWinner: r.winner, committed: rec.committed || null, reconciled: !!(rec.committed && r.state === "claimed" && rec.committed !== r.winner), by: r.by, amount: r.amount, asset: r.asset };
}

// ── sync surface (transport-agnostic): gossip transitions between device replicas ─────────────────────────────
export function exportPeer(kappaOrIntent, { store = null } = {}) {
  const s = store || _defaultStore();
  const k = typeof kappaOrIntent === "string" ? kappaOrIntent : (kappaOrIntent && kappaOrIntent.kappa);
  const rec = s.get(k);
  return rec ? exportTransitions(rec) : [];
}
export async function mergePeer(kappaOrIntent, remoteTransitions, { store = null, nowMs = null } = {}) {
  const s = store || _defaultStore();
  const now = nowMs || Date.now();
  const k = typeof kappaOrIntent === "string" ? kappaOrIntent : (kappaOrIntent && kappaOrIntent.kappa);
  const rec = s.get(k) || _emptyRec();
  await mergeInto(rec, remoteTransitions || [], now);
  s.set(k, rec);
  return status(k, { store: s, nowMs: now });
}
