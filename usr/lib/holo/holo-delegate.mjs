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
import { verifyStepUp } from "./holo-stepup.mjs";                                    // Agent Passport: the TEE/hardware root (optional, additive)
import { verifyRevocationSet, isRevoked, freshEnough } from "./holo-revocation.mjs"; // Agent Passport: κ-native revocation (fail-closed)

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
export async function delegate(pc, npc, { capabilities = [], discloseKeys = [], notAfter = null, nowIso = null, issuerCaps = null, stepup = null } = {}, pcCeremony = null) {
  // SEC-2 / A6 — fail CLOSED at mint time: a delegated issuer (issuerCaps is an array) may grant ONLY a
  // subset of what it holds; authority can only narrow. A sovereign root PC (issuerCaps === null) is unbounded.
  if (!attenuates(issuerCaps, capabilities)) {
    const over = capabilities.filter((c) => !issuerCaps.some((h) => capMatch(h, c)));
    throw new Error("holo-delegate: capability escalation refused (L5/SEC-2) — issuer cannot grant " + JSON.stringify(over));
  }
  // ── Agent Passport (OPTIONAL, additive) — if a TEE step-up bound to THIS mandate is supplied, embed it so
  //    the credential carries BOTH roots: substrate (its κ re-derives, L1/L5) AND hardware (a human cleared
  //    this EXACT mandate at a device secure element). Absent ⇒ a plain delegation, byte-identical to before.
  let attestRoot = null;
  if (stepup) {
    const su = await verifyStepUp(stepup);                              // re-verify the hardware proof (offline, fail-closed)
    const mandate = { subject: npc.kappa, capabilities: [...capabilities].sort(), notAfter };
    if (!su || su.kind !== "delegation.issue" || canon(su.payload) !== canon(mandate))
      throw new Error("holo-delegate: step-up not bound to this mandate (L5/§13.7)"); // the biometric must commit to the granted authority
    attestRoot = stepup.webauthn ? "tee" : "soft";                     // honest degradation — record which root actually attested
  }
  const body = {
    "@context": "https://hologram.os/ns/identity", "@type": "HoloDelegation",
    issuer: pc.kappa, issuerPub: pc.pub, issuerPq: pc.pqPub,            // lineage: anchored by reference (L4)
    subject: npc.kappa, subjectType: "npc", subjectLabel: npc.label || "agent",
    capabilities: [...capabilities].sort(), disclosed: [...discloseKeys].sort(),
    issuedAt: nowIso || null, notAfter,
  };
  if (stepup) { body.attestRoot = attestRoot; body.stepup = stepup; }   // only when present → existing delegations stay byte-identical
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

// ── Agent Passport: re-derive the HARDWARE root offline (anyone). Returns "tee" | "soft" | null. A
//    passport is dual-rooted only if this is non-null: the embedded step-up must verify AND its payload
//    must bind exactly this credential's mandate (subject + capabilities + notAfter). `verifyDelegation`
//    already proves the SUBSTRATE root (κ re-derives + hybrid signature); this proves the hardware root. ──
export async function attestationOf(credential) {
  try {
    const su = credential && credential.stepup;
    if (!su) return null;                                               // a plain delegation, no hardware root
    const ok = await verifyStepUp(su);                                  // L5: token re-derives, operator κ, sig, challenge binding
    if (!ok || ok.kind !== "delegation.issue") return null;
    const mandate = { subject: credential.subject, capabilities: credential.capabilities, notAfter: credential.notAfter ?? null };
    if (canon(ok.payload) !== canon(mandate)) return null;             // the human cleared THIS exact authority, not another
    return credential.attestRoot || (su.webauthn ? "tee" : "soft");
  } catch { return null; }
}

// ── Agent Passport read API (one call for BOTH doors — human surface + agent self-introspection). Verifies
//    both roots and returns the presentable passport, or null. Read-only: it mints nothing (an agent can
//    SHOW its passport, never issue one — SEC-2). `dualRoot` is true only when a hardware root is present. ──
export async function passportOf(credential, { nowIso = null } = {}) {
  const body = verifyDelegation(credential, { nowIso });               // substrate root (κ re-derives + hybrid sig + expiry)
  if (!body) return null;
  const attestRoot = await attestationOf(credential);                  // hardware root (step-up bound to this mandate) | null
  return {
    subject: body.subject, label: body.subjectLabel, issuer: body.issuer,
    capabilities: body.capabilities, notAfter: body.notAfter ?? null,
    attestRoot, dualRoot: attestRoot !== null,                         // dual-rooted ⇔ both substrate AND hardware verified
  };
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
export const CAP_FOR_KIND = {
  // reads (value never moves) — all need only wallet:read
  address: "wallet:read", addresses: "wallet:read", balance: "wallet:read", tokenBalance: "wallet:read", price: "wallet:read", history: "wallet:read", swapQuote: "wallet:read", swapQuoteEvm: "wallet:read", bridgeQuote: "wallet:read", lendingPositions: "wallet:read", fiatQuote: "wallet:read", aaAddress: "wallet:read",
  // signing / spending (fiat = initiates a money flow + reveals the address → spend-class consent)
  sign: "wallet:sign", signTypedData: "wallet:spend", swap: "wallet:spend", swapEvm: "wallet:spend", bridge: "wallet:spend", lending: "wallet:spend", fiat: "wallet:spend", aaSend: "wallet:spend", aa7702: "wallet:spend", send: "wallet:spend",
};
// ── Agent Passport: per-capability freshness window (LOCKED policy 2026-06-22). Worst-case exposure of a
//    revoked agent = its window. spend/reveal are short (they always step up anyway → the window is a
//    backstop), sign medium, read long. Unknown caps fall back to the tightest (spend) window. ──
export const TTL_FOR_CAP = { "wallet:spend": 60000, "wallet:sign": 300000, "wallet:read": 3600000 };

// ── HUMAN SURFACE (browser glue): mint an Agent Passport in ONE biometric. The operator step-up over the
//    mandate is the SAME ceremony that unlocks the signer (exposeSecret), so the human taps once: the secure
//    element attests "I, here, now, authorize exactly this agent for exactly these capabilities," and that
//    proof is embedded in the delegation. TEE-only (requireStepUp fail-closes without an enclave) — the
//    browser passport is always attestRoot:"tee"; the "soft" fallback exists only for headless re-derivation.
//    Mints nothing but an attenuated projection of the operator (SEC-2): an agent can be GIVEN a passport,
//    never issue one for itself. Returns { credential, sealed } exactly like delegate(). ──
export async function mintPassport({ operator, npc, capabilities = [], notAfter = null, discloseKeys = [], appId = "org.hologram.HoloIdentity", reason = "" } = {}, { credentialId } = {}, pcCeremony = null) {
  if (!operator || !npc) throw new Error("holo-delegate.mintPassport: operator κ and npc are required");
  const { requireStepUp } = await import("./holo-stepup.mjs");
  const { unlock } = await import("./holo-login.mjs");
  const mandate = { subject: npc.kappa, capabilities: [...capabilities].sort(), notAfter };
  const { token, secret } = await requireStepUp(
    { kind: "delegation.issue", payload: mandate, appId, operator,
      reason: reason || `Authorize agent “${npc.label || "agent"}” for ${capabilities.join(", ") || "no capabilities"}` },
    { credentialId, exposeSecret: true });                              // ONE biometric: attest the mandate AND release the unlock secret
  const pc = await unlock(operator, secret);                           // re-derive the sovereign signer from the SAME TEE ceremony
  return await delegate(pc, npc, { capabilities, notAfter, discloseKeys, stepup: token }, pcCeremony);
}

export function authorizeRequest(delegation, { kind = "send", revoked = [], revocationSet = null, nowIso = null, ttlMs = null } = {}) {
  if (!delegation) return { ok: true, agent: null };
  const body = verifyDelegation(delegation, { nowIso });
  if (!body) return { ok: false, reason: "delegation failed verification" };
  const need = CAP_FOR_KIND[kind] || "wallet:spend";
  // legacy caller-supplied deny array (kept for back-compat)
  if (Array.isArray(revoked) && revoked.includes(body.subject)) return { ok: false, reason: "agent has been revoked" };
  // κ-native revocation set: sealed, owner-signed, self-verifying — consulted FAIL-CLOSED with last-known-good
  // bounded by the per-capability freshness window. A tampered set, a stale set, or a listed subject all deny.
  if (revocationSet) {
    const rev = verifyRevocationSet(revocationSet);
    if (!rev) return { ok: false, reason: "revocation set failed verification" };
    const ttl = ttlMs ?? TTL_FOR_CAP[need] ?? 60000;
    if (!freshEnough(rev, { nowIso, ttlMs: ttl })) return { ok: false, reason: "revocation set stale" };
    if (isRevoked(rev, body.subject)) return { ok: false, reason: "agent has been revoked" };
  }
  if (!grants(body, need)) return { ok: false, reason: "agent not granted “" + need + "”" };
  return { ok: true, agent: { subject: body.subject, label: body.subjectLabel, cap: need, issuer: body.issuer } };
}
