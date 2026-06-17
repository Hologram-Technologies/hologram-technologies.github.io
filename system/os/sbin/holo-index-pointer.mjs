// holo-index-pointer.mjs — a SIGNED, anti-rollback MUTABLE POINTER to "the current κ-index" (T2). The
// sealed index is immutable (its CID is its content); this is the IPFS/IPNS idea — a stable NAME that
// resolves to the latest CID — in κ-native form: an Ed25519-signed record { name → target CID, seq } that
// clients verify against a PINNED public key. Only the key holder can publish a new current index, clients
// refuse an older sequence (downgrade protection), and the served index must match the signed target CID.
//
// Reuses the substrate's signature choice — WebCrypto Ed25519 (the same primitive holo-solana.js verifies
// transaction signatures with). Pure ESM, browser + Node. Honest scope: this gives AUTHORITY + ANTI-ROLLBACK
// + INTEGRITY-BINDING + EXPIRY. Wire-compatible IPNS (the protobuf record published to the Amino DHT,
// resolvable by go-ipfs) is NOT implemented — that needs a libp2p node; this is the holo-native pointer.

import { toHex, fromHex } from "../usr/lib/holo/holo-ipfs.js";

const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;
const enc = (s) => new TextEncoder().encode(s);

// the canonical signed payload — fixed field order so the signature is a deterministic function of the
// record's meaning (NOT its JSON whitespace). validUntil null → "".
const payloadOf = (p) => [p.name, p.target, p.seq, p.issued, p.validUntil || "", p.pub].join("\n");

async function ed25519Verify(pubRaw, sig, msg) {
  const s = subtle(); if (!s) return false;
  try { const k = await s.importKey("raw", pubRaw, { name: "Ed25519" }, false, ["verify"]); return await s.verify("Ed25519", k, sig, msg); }
  catch { return false; }
}

// signPointer({ name, target, seq, validMs, privateKey, pub, now }) → a signed holo:IndexPointer record.
// privateKey is a WebCrypto Ed25519 CryptoKey; pub is its raw public key as hex (the build tool holds both).
export async function signPointer({ name = "holo:index", target, seq, validMs = null, privateKey, pub, now = Date.now() }) {
  const s = subtle(); if (!s) throw new Error("WebCrypto unavailable");
  const issued = new Date(now).toISOString();
  const validUntil = validMs != null ? new Date(now + validMs).toISOString() : null;
  const rec = { "@type": "holo:IndexPointer", name, target, seq, issued, validUntil, pub };
  const sig = new Uint8Array(await s.sign("Ed25519", privateKey, enc(payloadOf(rec))));
  return { ...rec, sig: toHex(sig) };
}

// verifyPointer(p, { pinnedPub, minSeq, now }) → { ok, target, seq, name } | { ok:false, reason }.
//   pinnedPub — the trust root (hex); a pointer signed by any other key is refused.
//   minSeq    — the highest seq this client has accepted; a pointer with seq < minSeq is a rollback →
//               refused. Equal seq is the SAME record (a re-visit) and is accepted (IPNS sequence semantics).
export async function verifyPointer(p, { pinnedPub = null, minSeq = -1, now = Date.now() } = {}) {
  if (!p || p["@type"] !== "holo:IndexPointer" || !p.target || !p.pub || !p.sig) return { ok: false, reason: "not an index pointer" };
  if (pinnedPub && String(p.pub).toLowerCase() !== String(pinnedPub).toLowerCase()) return { ok: false, reason: "untrusted signing key" };
  if (typeof p.seq !== "number" || p.seq < minSeq) return { ok: false, reason: "rollback (seq " + p.seq + " < accepted " + minSeq + ")" };
  if (p.validUntil && now > Date.parse(p.validUntil)) return { ok: false, reason: "expired " + p.validUntil };
  if (!(await ed25519Verify(fromHex(p.pub), fromHex(p.sig), enc(payloadOf(p))))) return { ok: false, reason: "bad signature" };
  return { ok: true, target: p.target, seq: p.seq, name: p.name };
}

// resolveCurrentIndex(fetchImpl, url, { pinnedPub, minSeq }) → { target, seq } | throws. Fetch the pointer,
// verify it, and hand back the attested current index CID. The caller then loads that index and confirms
// the loaded root CID equals `target` (integrity binding — a stale/forged CAR is refused).
export async function resolveCurrentIndex(fetchImpl, url, { pinnedPub = null, minSeq = -1 } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) throw new Error("no fetch");
  const r = await f(url); if (!r || !r.ok) throw new Error("pointer fetch " + (r && r.status));
  const v = await verifyPointer(await r.json(), { pinnedPub, minSeq });
  if (!v.ok) throw new Error("index pointer rejected: " + v.reason);
  return { target: v.target, seq: v.seq };
}

export default { signPointer, verifyPointer, resolveCurrentIndex };
