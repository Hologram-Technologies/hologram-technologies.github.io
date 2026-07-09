// holo-direct.mjs - the Holo Direct ENGINE: one clean API the messenger calls, composing the four verified primitives -
// holo-seal (sealed+signed+κ envelope), holo-dm (blind mailbox / offline delivery), holo-verify (safety number + TOFU
// trust), and the sovereign identity. Send seals to a contact and drops it in their mailbox (works whether or not
// they're online); poll pulls, opens, and verifies what's waiting for you. Trust/verify + key-change warnings are built
// in. (holo-ratchet is the stronger per-session mode - enabled once prekey publishing lands; per-message ECIES already
// gives forward secrecy for each message.)

import * as Seal from "./holo-seal.mjs";
import * as DM from "./holo-dm.mjs";
import * as Verify from "./holo-verify.mjs";

export async function makeDirect({ identity = null, mailboxBase = null, trustStore = null, load = null, save = null } = {}) {
  const id = identity || await Seal.generateIdentity();
  const myPub = await Seal.exportPublic(id);
  // each sovereign identity gets its OWN trust store - never a shared global key (else two identities, or a stale entry
  // from a prior session, collide and look like a key change). Namespace the persistence by my own identity.
  const nsKey = "holo.direct.trust." + myPub.sign.slice(0, 22);
  const trust = trustStore || Verify.makeTrustStore({
    load: load || (() => { try { return (typeof localStorage !== "undefined") ? JSON.parse(localStorage.getItem(nsKey) || "{}") : {}; } catch { return {}; } }),
    save: save || ((c) => { try { if (typeof localStorage !== "undefined") localStorage.setItem(nsKey, JSON.stringify(c)); } catch {} }),
  });
  const book = new Map();     // contactId → pub {sign,box}
  const listeners = { message: [], keychange: [] };
  const emit = (ev, x) => (listeners[ev] || []).forEach((f) => { try { f(x); } catch {} });

  // add / update a contact (pub from the sovereign graph). Detects a KEY CHANGE (anti-MITM) before trusting it.
  function addContact(contactId, pub, { acceptChange = false } = {}) {
    const st = trust.check(contactId, pub);
    if (st.status === "changed" && !acceptChange) { emit("keychange", { contactId, pub, wasVerified: st.wasVerified }); book.set(contactId, pub); return { ...st, blocked: true }; }
    trust.record(contactId, pub); book.set(contactId, pub);
    return trust.check(contactId, pub);
  }
  function _findBySign(signPub) { for (const [cid, p] of book) if (p.sign === signPub) return cid; return null; }

  async function send(contactId, text) {
    const pub = book.get(contactId); if (!pub) return { ok: false, error: "unknown contact" };
    const env = await Seal.seal(text, { toBoxPub: pub.box, fromKeys: id, fromPub: myPub });
    await DM.mailboxDrop(pub.box, Seal.toWire(env), { mailboxBase });   // offline-safe; P2P fast-path can front this later
    return { ok: true, kappa: env.kappa, ts: env.ts, contactId };
  }

  // pull everything waiting for me, open + verify, map each to a known contact. Emits "message" per decrypted item.
  async function poll() {
    const items = await DM.receiveOffline(id, myPub.box, Seal.open, { mailboxBase });
    const out = [];
    for (const it of items) {
      const r = it.result; if (!r.ok) continue;
      const contactId = _findBySign(r.from);
      const known = !!contactId;
      const verified = !!r.verified && known;   // signature valid AND from a contact we know
      const msg = { contactId: contactId || "unknown:" + (r.from || "").slice(0, 12), from: r.from, text: r.plaintext, verified, known, ts: it.ts };
      out.push(msg); emit("message", msg);
    }
    return out;
  }

  return {
    myPub,
    addContact,
    contacts: () => [...book.keys()],
    send, poll,
    safetyNumber: (contactId) => { const p = book.get(contactId); return p ? Verify.safetyNumber(myPub, p) : Promise.resolve(null); },
    safetyEmojis: Verify.safetyEmojis, safetyDigits: Verify.safetyDigits,
    verifyStatus: (contactId) => { const p = book.get(contactId); return p ? trust.check(contactId, p) : { status: "unknown" }; },
    markVerified: (contactId) => trust.markVerified(contactId),
    on: (ev, cb) => { (listeners[ev] || (listeners[ev] = [])).push(cb); },
  };
}
