// holo-messenger-epoch.mjs — POST-QUANTUM CONFIDENTIALITY (holo-apps §2.8) for a conversation.
//
// A conversation's messages are sealed at rest and in transit under a per-collection EPOCH KEY:
// a fresh AES-256-GCM key that encrypts each message body, itself wrapped to every member's
// HYBRID public key — X25519 ‖ ML-KEM-1024 (holo-pqc.hybridEncaps). A break in EITHER family is
// not a break (harvest-now-decrypt-later resistant): exactly the operator's post-quantum mandate.
// The wrapped-key set is content-addressed (the epoch κ), so any member re-derives it and a relay
// that holds it learns nothing (SEC-5/SEC-7). Membership change rotates the epoch (forward
// secrecy): a removed member cannot open new-epoch messages, while members keep old epoch keys to
// read history (§2.8).
//
// This is the CONFIDENTIALITY ENVELOPE around the substrate, not a replacement for it. The
// plaintext message content κ (what dedups across platforms, SEC-3) lives INSIDE the envelope;
// a content-blind relay and at-rest storage see only the ciphertext envelope (its own κ) and the
// cleartext header (collection, epoch). A member unwraps the epoch key, opens the body, and then
// re-derives the content κ verify-before-trust (Law L5) before it is ever rendered.
//
// No new crypto: KEM + AEAD are the vendored, audited holo-pqc primitives (same as holo-vault-sync).
// Pure + isomorphic; Node-witnessable.
//
// Authority: holo-apps §2.8 (epoch key · AEAD body · wrapped-to-members · rotation/forward-secrecy)
//   · holo-pqc (X25519‖ML-KEM-1024 hybrid KEM, AES-256-GCM) · holospaces SEC-5/SEC-7 · Law L1/L5.

import { hybridEncaps, hybridDecaps, aeadSeal, aeadOpen } from "./holo-pqc.mjs";
import { seal, verify } from "./holo-object.mjs";
import { mountFromPayload } from "./holo-pluck.mjs";

const te = new TextEncoder();
const td = new TextDecoder();
const NS = "https://hologram.os/ns#";
const WRAP_AAD = te.encode("holo-messenger/epoch-wrap/v1");
const rand = (n) => (globalThis.crypto).getRandomValues(new Uint8Array(n));

// a member = { kappa, pub } where pub is a hybrid KEM public key { x, pq } (holo-pqc.kemKeygen().pub).
// newEpoch({ genesis, members, seq }) → { id, meta, key, seq }. `key` is the SECRET epoch key (kept in
// memory / sealed by the device cipher); `meta` is the κ-addressed public wrapped-key set; `id` = epoch κ.
export async function newEpoch({ genesis, members = [], seq = 0 } = {}) {
  const key = rand(32);
  const wraps = [];
  for (const m of members) {
    const { ct, ss } = hybridEncaps(m.pub);                          // X25519 ‖ ML-KEM-1024 encapsulation
    const wrap = await aeadSeal(ss, key, WRAP_AAD);                  // wrap the epoch key under the hybrid secret
    wraps.push({ member: String(m.kappa), kem: ct, wrap });
  }
  wraps.sort((a, b) => (a.member < b.member ? -1 : a.member > b.member ? 1 : 0));   // order-independent κ
  const meta = seal({
    "@context": ["https://schema.org/", { holo: NS }],
    "@type": "holo:Epoch",
    "holo:collection": String(genesis),
    "holo:epochSeq": seq,
    scheme: "holo-messenger/epoch/hybrid-kem-x25519-mlkem1024",
    wraps,
  });
  return { id: meta.id, meta, key, seq };
}

// rotateEpoch(prevEpoch, members) → a fresh epoch for the new membership (forward secrecy). Old
// messages stay readable with the retained old epoch key; new messages are sealed under this one only.
export async function rotateEpoch(prevEpoch, members) {
  return newEpoch({ genesis: prevEpoch.meta["holo:collection"], members, seq: (prevEpoch.seq || 0) + 1 });
}

// unwrapEpochKey(epochMeta, member) → the secret epoch key, by decapsulating this member's wrap with its
// hybrid SECRET. Throws (fail-closed) if the member has no wrap or the secret is wrong.
export async function unwrapEpochKey(epochMeta, member) {
  const w = (epochMeta.wraps || []).find((w) => w.member === String(member.kappa));
  if (!w) throw new Error("epoch: not a member of this epoch");
  const ss = hybridDecaps(member.sk, w.kem);
  return await aeadOpen(ss, w.wrap, WRAP_AAD);                       // throws on wrong key / tamper
}

// sealMessage(epoch, messageObject) → the ciphertext ENVELOPE (its own κ). The body { content κ +
// object } is AEAD-sealed under the epoch key with the epoch κ as AAD; the header stays cleartext.
export async function sealMessage(epoch, messageObject) {
  const body = te.encode(JSON.stringify({ kappa: messageObject.id, object: messageObject }));
  const ct = await aeadSeal(epoch.key, body, te.encode(epoch.id));
  return seal({
    "@context": ["https://schema.org/", { holo: NS }],
    "@type": "holo:SealedMessage",
    "holo:collection": epoch.meta["holo:collection"],
    "holo:epoch": epoch.id,
    ct,
  });
}

// openMessage(epochKey, envelope) → { ok, object, kappa } | { ok:false, why }. Fail-closed: the
// envelope must re-derive (L5), the AEAD must open under the epoch key, and the recovered content
// must re-derive to its own κ (verify-before-trust) before it is trusted.
export async function openMessage(epochKey, envelope) {
  try {
    if (!envelope || !verify(envelope)) return { ok: false, why: "envelope-tampered" };
    const pt = await aeadOpen(epochKey, envelope.ct, te.encode(envelope["holo:epoch"]));
    const inner = JSON.parse(td.decode(pt));
    const mounted = mountFromPayload({ kappa: inner.kappa, object: inner.object });
    if (!mounted.ok) return { ok: false, why: "content-" + mounted.why };
    return { ok: true, object: mounted.object, kappa: mounted.kappa, epoch: envelope["holo:epoch"] };
  } catch (e) { return { ok: false, why: "aead-open-failed" }; }
}

if (typeof window !== "undefined" && !window.HoloMessengerEpoch) {
  window.HoloMessengerEpoch = { newEpoch, rotateEpoch, unwrapEpochKey, sealMessage, openMessage };
}
