// holo-zone.mjs — A MUTABLE NAME, OWNED BY A KEY, ON THE OPERATOR'S OWN SOURCE CHAIN. This is the one
// thing content-addressing lacks — a name whose target can CHANGE — built without a registrar, a root
// zone, a KSK, or a blockchain. A zone is not a new store: it is a VIEW over holo-strand (the operator's
// single hash-linked, signed, append-only spine) filtered to `zone.bind` / `zone.revoke` entries. So your
// names live on the SAME re-derivable thread as the rest of your history (Law L2 — one spine, no parallel
// medium), and inherit its guarantees for free: the head κ attests every binding you ever made, drop/
// reorder/tamper all fail closed (Law L5 over the sequence), and an operator signature binds AUTHORSHIP so
// only the owner can change a name under their zone.
//
// Resolution is re-derivation, never delegation: resolve(label) VERIFIES the whole chain first (fail-
// closed), then reads the latest non-revoked binding for that label (last-write-wins). A stale head is
// detectably behind; a forged or foreign-owned entry is refused. There is no authority to ask — only math
// to check. Mutate a name by appending a new signed binding; the old target stays in history (rewindable).
//
// The fully-qualified name is `holo://zone/<owner-sha256-hex>/<label>` — analogous to holo://space/<id>.
// A bare, human-typed name resolving to a zone needs an ANCHOR (which owner answers for "ilya.deck"?);
// that anchor layer is holo-root, a later phase. This module is the owned-name primitive it stands on.
//
// Anchored 100% in the existing substrate — no new crypto, no new store:
//   • makeStrand (holo-strand.mjs)   — the hash-linked, operator-signed, append-only spine + verify/adopt.
//   • seal/verify (holo-object.mjs)  — every entry is a UOR object addressed by its content (Law L1/L5).
//   • addressOf   (holo-identity.mjs)— the owner κ IS the content address of its public key (CC-1).
// The core is adapter-injectable (makeZone) — node-testable with an in-memory backend + a real enrolled
// principal as signer; the browser binding wires the live operator strand.

import { makeStrand } from "./holo-strand.mjs";

const BIND = "zone.bind";
const REVOKE = "zone.revoke";

// a label is one speakable name segment: letters/digits, with '-' and '.' inside (so three-word names
// like "brass.junior.quiz" are first-class). No whitespace, no scheme — the qualified form carries those.
export const validLabel = (l) => typeof l === "string" && /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/i.test(l);

// normTarget(t) — accept what a name may point AT and canonicalise it (or null if it is not a thing we
// can later re-derive): a κ (did:holo / 64-hex / holo://<hex>), an IPFS CID, or a sub-zone reference.
export function normTarget(t) {
  const s = String(t == null ? "" : t).trim();
  if (/^did:holo:sha256:[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  if (/^[0-9a-f]{64}$/i.test(s)) return "did:holo:sha256:" + s.toLowerCase();
  if (/^holo:\/\/[0-9a-f]{64}$/i.test(s)) return "did:holo:sha256:" + s.slice(7).toLowerCase();
  if (/^ipfs:\/\//i.test(s) || /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]+)$/i.test(s)) return s;
  if (/^holo:\/\/zone\/[0-9a-f]{64}\/[a-z0-9][a-z0-9.-]{0,62}$/i.test(s)) return s.toLowerCase();
  return null;
}

const hexOf = (kappa) => String(kappa || "").split(":").pop();

// makeZone({ owner, strand, backend, now }) → an owned, mutable name space.
//   owner  : the zone owner. A principal { kappa, alg, pub, sign } to WRITE; a bare κ string to READ a
//            received zone (verify-before-trust). Required — it scopes the namespace and the signatures.
//   strand : an existing holo-strand to VIEW (the operator's one spine). Absent ⇒ a private strand is made
//            with `owner` as signer (and `backend` for durability) — the node-test path.
//   now    : () → ISO string for entry timestamps (distinct, ordered events).
export function makeZone({ owner = null, strand = null, backend = null, now = () => "1970-01-01T00:00:00Z" } = {}) {
  const ownerKappa = typeof owner === "string" ? owner : (owner && owner.kappa) || null;
  const signer = owner && typeof owner.sign === "function" ? owner : null;     // present ⇒ writable
  const chain = strand || makeStrand({ backend, now, signer });

  const ownerHex = () => hexOf(ownerKappa);
  const qualified = (label) => `holo://zone/${ownerHex()}/${label}`;

  // verifyZone — the trust gate (fail-closed) BEFORE any read. The chain must re-derive + link end-to-end
  // (Law L5, via holo-strand), AND every binding entry must be SIGNED by exactly this zone's owner κ — so
  // no one can graft a name into your zone, and you cannot be tricked into reading someone else's chain as
  // if it were the owner you asked for.
  async function verifyZone() {
    const v = await chain.verify();
    if (!v.ok) return { ok: false, why: "chain:" + v.why, brokeAt: v.brokeAt };
    const entries = chain.replay({});
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e["holstr:kind"] !== BIND && e["holstr:kind"] !== REVOKE) continue;     // a zone view tolerates other kinds on the shared spine
      if (!e["holstr:sig"]) return { ok: false, why: "unsigned-binding", brokeAt: i };
      if (ownerKappa && e["holstr:op"] !== ownerKappa) return { ok: false, why: "foreign-owner", brokeAt: i };
    }
    return { ok: true, head: chain.head() };
  }

  // resolve(label) — verify, then read the latest non-revoked binding (last-write-wins). No network, no
  // authority: the answer is the chain re-derived. Works fully offline (Law L3).
  async function resolve(label) {
    if (!validLabel(label)) return { ok: false, why: "bad-label" };
    const v = await verifyZone();
    if (!v.ok) return { ok: false, why: "zone-unverified:" + v.why, head: chain.head() };
    let target = null, at = -1;
    for (const [i, e] of chain.replay({}).entries()) {
      const p = e["holstr:payload"] || {};
      if (p.label !== label) continue;
      if (e["holstr:kind"] === BIND) { target = normTarget(p.target); at = i; }
      else if (e["holstr:kind"] === REVOKE) { target = null; at = i; }
    }
    if (!target) return { ok: false, why: "unbound", label, head: chain.head() };
    return { ok: true, label, target, kappa: target, seq: at, owner: ownerKappa, head: chain.head(), name: qualified(label) };
  }

  // list() — the current name→target map (latest non-revoked binding per label).
  async function list() {
    const v = await verifyZone();
    if (!v.ok) return { ok: false, why: v.why };
    const map = {};
    for (const e of chain.replay({})) {
      const p = e["holstr:payload"] || {};
      if (!p.label) continue;
      if (e["holstr:kind"] === BIND) map[p.label] = normTarget(p.target);
      else if (e["holstr:kind"] === REVOKE) delete map[p.label];
    }
    return { ok: true, names: map, head: chain.head() };
  }

  // bind(label, target) — append a signed binding (mutate by appending; the prior target stays in history).
  async function bind(label, target) {
    if (!signer) return { ok: false, why: "read-only-zone" };
    if (!validLabel(label)) return { ok: false, why: "bad-label" };
    const t = normTarget(target);
    if (!t) return { ok: false, why: "bad-target" };
    const rec = await chain.append({ kind: BIND, payload: { label, target: t } });
    return { ok: true, label, target: t, entry: rec.id, head: chain.head(), name: qualified(label) };
  }

  // revoke(label) — append a signed tombstone; the name resolves unbound until re-bound.
  async function revoke(label) {
    if (!signer) return { ok: false, why: "read-only-zone" };
    if (!validLabel(label)) return { ok: false, why: "bad-label" };
    const rec = await chain.append({ kind: REVOKE, payload: { label } });
    return { ok: true, label, entry: rec.id, head: chain.head() };
  }

  // adopt(entries) — receive a peer's zone (gossip / cross-device roam) and verify-before-adopt: the chain
  // must re-derive end-to-end AND be owned by this zone's owner κ, else refuse and keep the local chain.
  async function adopt(entries) {
    const r = await chain.adopt(entries);
    if (!r.ok) return r;
    const vz = await verifyZone();
    if (!vz.ok) return { ok: false, why: "rejected:" + vz.why };
    return { ok: true, head: chain.head(), length: r.length };
  }

  // entries() — the raw chain entries, for serialising a zone to a peer (the gossip/roam wire).
  const entries = () => chain.replay({});

  return { resolve, list, bind, revoke, adopt, verifyZone, entries, head: () => chain.head(), qualified, ownerKappa, strand: chain };
}

// ── browser binding: window.HoloZone as a VIEW over the live operator spine (window.HoloStrand). Names are
// not a new store — they ride the one source chain. The owner κ is supplied when the operator unlocks
// (setOwner), at which point the zone becomes writable; until then it reads (verify-before-trust). Fail-soft.
if (typeof window !== "undefined") {
  const wire = () => {
    try {
      if (window.HoloZone || !window.HoloStrand) return;
      let view = makeZone({ owner: null, strand: window.HoloStrand });
      window.HoloZone = {
        resolve: (l) => view.resolve(l),
        list: () => view.list(),
        bind: (l, t) => view.bind(l, t),
        revoke: (l) => view.revoke(l),
        adopt: (e) => view.adopt(e),
        head: () => view.head(),
        // setOwner(principal) — bind the unlocked operator as the zone owner/signer (makes names writable).
        setOwner: (op) => { view = makeZone({ owner: op, strand: window.HoloStrand }); window.HoloZone.qualified = view.qualified; window.HoloZone.ownerKappa = view.ownerKappa; },
        qualified: view.qualified, ownerKappa: view.ownerKappa,
      };
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-zone-ready"));
    } catch (e) { /* leave unset; callers fail-soft */ }
  };
  if (window.HoloStrand) wire();
  else if (document.documentElement) document.documentElement.addEventListener("holo-strand-ready", wire, { once: true });
}

export default { makeZone, validLabel, normTarget };
