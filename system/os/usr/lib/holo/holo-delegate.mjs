// holo-delegate.mjs — PC → NPC delegation: a human Player Character mints a Non-Player Character (an
// agent) as its OWN sovereign hybrid identity, grants it SCOPED, content-addressed capabilities with a
// verifiable lineage, and hands it only a MINIMAL ZK disclosure — sealed by the hybrid post-quantum KEM
// so only that agent can open it. This is the PC/NPC keystone of Holo Identity (ADR-0094), wired to the
// EXISTING Holo Privacy / Holo ZK selective disclosure (holo-ceremony.mjs · holo-zk.js) and the hybrid
// post-quantum primitive (holo-pqc.mjs). No new cryptography; 100% serverless; default-deny.
//
// First principles (holospaces Laws):
//   • The agent is its OWN identity (L1) — κ = content address of its hybrid (Ed25519 ‖ ML-DSA) pubkey.
//   • The grant is an OBJECT (L1/L3): a content-addressed, hybrid-signed capability credential whose κ
//     re-derives; revoke/expire by content, idempotent.
//   • The PC mints no pillar (L4): it ANCHORS the NPC by reference (issuer κ) — the agent acts FOR the
//     PC but never holds the PC's keys or full data.
//   • Verify by re-derivation, fail closed (L5): a tampered grant, a forged either-half signature, an
//     expired grant, or a wrong opener all return null.
//   • Minimal disclosure (Holo Privacy): the agent receives ONLY the claims the capability authorises —
//     a Holo-ZK salted-digest presentation — the rest leak nothing (the salt hides them), and the whole
//     presentation is sealed to the NPC's KEM key (harvest-now-decrypt-later safe).

import { sha256, ed25519 } from "./wdk-crypto/wdk-crypto.bundle.mjs";
import { signKeygen, kemKeygen, hybridEncaps, hybridDecaps, aeadSeal, aeadOpen, identityKappa, mldsaVerify } from "./holo-pqc.mjs";
import { disclose, verifyDisclosure } from "./holo-ceremony.mjs";

const te = new TextEncoder(), td = new TextDecoder();
const HEXC = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, "0"));
const hex = (u) => { let s = ""; for (let i = 0; i < u.length; i++) s += HEXC[u[i]]; return s; };
const b64 = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// canonical JSON (recursively sorted keys) — both sides re-derive identically (Law L5)
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"
  : JSON.stringify(v);
const kappaOf = (s) => "did:holo:sha256:" + hex(sha256(te.encode(s)));

// ── Attenuation (SEC-2 / Invariant A6): authority can only NARROW. A child capability set is admissible
//    only if every capability is one the issuer itself holds. `issuerCaps === null` means a SOVEREIGN root
//    PC (a human owns its own pillars outright) — unbounded by design; any non-null array is a DELEGATED
//    issuer (an NPC re-delegating) and is bounded by its own grant. `*` / `<ns>:*` are honoured as wildcards.
const capMatch = (held, want) => held === want || held === "*"
  || (held.endsWith(":*") && (want === held.slice(0, -1) || want.startsWith(held.slice(0, -1))));
export const attenuates = (issuerCaps, childCaps) =>
  issuerCaps === null || issuerCaps === undefined                                   // sovereign root → unbounded
    ? true
    : Array.isArray(issuerCaps) && Array.isArray(childCaps)
      && childCaps.every((c) => issuerCaps.some((h) => capMatch(h, c)));            // every child cap ⊆ issuer

// ── mint an NPC: a fresh sovereign hybrid identity (Ed25519 ‖ ML-DSA sign keys + an X25519 ‖ ML-KEM
//    key). κ is the content address of its hybrid pubkey. Keep .sign/.kem private to the agent. ──
export function mintNpc(label = "agent") {
  const sign = signKeygen();                 // { sk:{ed,pq}, pub:{ed,pq} }
  const kem = kemKeygen();                    // { sk:{x,pq}, pub:{x,pq} }
  return {
    label, subjectType: "npc",
    kappa: identityKappa(sign.pub),           // self-verifying κ
    sign, kem,
    pub: { ed: b64(sign.pub.ed), pq: b64(sign.pub.pq), kemX: b64(kem.pub.x), kemPq: b64(kem.pub.pq) },
  };
}

// ── the PC issues a delegation: a hybrid-signed, content-addressed capability grant + an optional ZK
//    minimal disclosure sealed to the NPC's KEM key. `pc` is a holo-login principal
//    ({ kappa, pub, pqPub, sign(), pqSign() }). `pcCeremony` = { digests, disclosures } from firstRun. ──
export async function delegate(pc, npc, { capabilities = [], discloseKeys = [], notAfter = null, nowIso = null, issuerCaps = null } = {}, pcCeremony = null) {
  // SEC-2 / A6 — fail CLOSED at mint time: a delegated issuer (issuerCaps is an array) may grant ONLY a
  // subset of what it holds; authority can only narrow. A sovereign root PC (issuerCaps === null) is unbounded.
  if (!attenuates(issuerCaps, capabilities)) {
    const over = capabilities.filter((c) => !issuerCaps.some((h) => capMatch(h, c)));
    throw new Error("holo-delegate: capability escalation refused (L5/SEC-2) — issuer cannot grant " + JSON.stringify(over));
  }
  const body = {
    "@context": "https://hologram.os/ns/identity", "@type": "HoloDelegation",
    issuer: pc.kappa, issuerPub: pc.pub, issuerPq: pc.pqPub,            // lineage: anchored by reference (L4)
    subject: npc.kappa, subjectType: "npc", subjectLabel: npc.label || "agent",
    capabilities: [...capabilities].sort(), disclosed: [...discloseKeys].sort(),
    issuedAt: nowIso || null, notAfter,
  };
  const c = canon(body);
  const credential = { id: kappaOf(c), ...body, alg: "Ed25519", sig: await pc.sign(c), pqSig: pc.pqSign(c) }; // HYBRID sig
  // ZK minimal disclosure → sealed to the NPC by the hybrid KEM (only the agent can open it)
  let sealed = null;
  if (pcCeremony && discloseKeys.length) {
    const presentation = await disclose(pcCeremony, discloseKeys);     // reveals ONLY discloseKeys (Holo ZK)
    const enc = hybridEncaps(npc.kem ? npc.kem.pub : { x: unb64(npc.pub.kemX), pq: unb64(npc.pub.kemPq) });
    sealed = { ct: enc.ct, env: await aeadSeal(enc.ss, te.encode(JSON.stringify(presentation))) };
  }
  return { credential, sealed };
}

// ── verify a delegation (anyone, offline): re-derive κ, check BOTH PC signatures, check expiry. ──
export function verifyDelegation(credential, { nowIso = null } = {}) {
  try {
    const { id, alg, sig, pqSig, ...body } = credential;
    const c = canon(body);
    if (kappaOf(c) !== id) return null;                                 // id commits to the body
    if (!ed25519.verify(unb64(sig), te.encode(c), unb64(body.issuerPub))) return null;   // classical half
    if (!mldsaVerify(body.issuerPq, c, pqSig)) return null;             // post-quantum half (both required)
    if (body.notAfter && nowIso && nowIso > body.notAfter) return null; // expired
    return body;
  } catch { return null; }
}

// ── the NPC opens its sealed disclosure (only it can — hybrid KEM) and ZK-verifies the presentation. ──
export async function openDelegation(npc, sealed) {
  if (!sealed) return null;
  const ss = hybridDecaps(npc.kem.sk, sealed.ct);                       // X25519 ‖ ML-KEM
  const presentation = JSON.parse(td.decode(await aeadOpen(ss, sealed.env)));
  return await verifyDisclosure(presentation);                         // → the authorised claims only | null
}

// has-capability check (after verifyDelegation)
export const grants = (body, capability) => !!body && Array.isArray(body.capabilities) && body.capabilities.includes(capability);

// ── authorise an agent's WALLET request at the seam (the single source of truth, shared by the wallet
//    listener and the witness). A signing request's kind maps to the capability it needs; the grant must
//    verify, not be revoked, and include that capability. The HUMAN still approves at the gate afterwards —
//    this only governs who may ask (default-deny). No delegation ⇒ not an agent request (governed elsewhere). ──
export const CAP_FOR_KIND = { address: "wallet:read", sign: "wallet:sign", signTypedData: "wallet:spend", swap: "wallet:spend", send: "wallet:spend" };
export function authorizeRequest(delegation, { kind = "send", revoked = [], nowIso = null } = {}) {
  if (!delegation) return { ok: true, agent: null };
  const body = verifyDelegation(delegation, { nowIso });
  if (!body) return { ok: false, reason: "delegation failed verification" };
  if (Array.isArray(revoked) && revoked.includes(body.subject)) return { ok: false, reason: "agent has been revoked" };
  const need = CAP_FOR_KIND[kind] || "wallet:spend";
  if (!grants(body, need)) return { ok: false, reason: "agent not granted “" + need + "”" };
  return { ok: true, agent: { subject: body.subject, label: body.subjectLabel, cap: need, issuer: body.issuer } };
}
