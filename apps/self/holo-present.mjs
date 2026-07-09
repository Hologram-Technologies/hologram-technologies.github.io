// holo-present.mjs — the CHALLENGE → SELECTIVE-DISCLOSURE → VERIFY loop. This is the magic
// Self.ID (docs.selfid.com) calls "Challenge / Response": a Verifier asks for specific facts,
// the Holder answers with only those facts, and the Verifier trusts the answer by re-derivation —
// never contacting the issuer, never touching a registry, never the network (Laws L3, L5).
//
// Three κ-objects, each named by the hash of its own bytes (Law L1), each signed by its author:
//   • CHALLENGE  — verifier asks `asks:[claim keys]`, bound to a fresh nonce + audience.
//   • PRESENTATION — holder reveals ONLY the asked claims (salted disclosures that re-derive into
//                    the credential's signed `_sd`), bound to the challenge (replay + misdelivery proof).
//   • the verifier re-derives everything locally and returns the revealed claims, or null.
//
// HUMAN ≡ AGENT (the whole point): `present()` is gated by an optional `release` thunk — for a human
// that thunk is a TEE/biometric step-up (holo-stepup); for an agent it is a delegated-capability
// check (holo-delegate). The disclosure code path is otherwise byte-identical. The witness proves it.
//
// One hashing/signing path (Law L2): canon/addressOf come from holo-identity; kappaOfPub/verifySig
// come from holo-credential — no second canonicaliser, no second verifier.

import { canon, addressOf } from "./holo-identity.mjs";
import { verifyCredential, credentialCore, kappaOfPub, verifySig, selectiveOpen } from "./holo-credential.mjs";

const RNG = globalThis.crypto || (typeof require !== "undefined" ? require("node:crypto").webcrypto : null);
const te = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const rand = (n) => RNG.getRandomValues(new Uint8Array(n));

// ── the VERIFIER mints a challenge: what it wants, who it is, a fresh nonce, an audience binding. ──
export async function makeChallenge(verifier, { asks, audience, ttlMs = 300000, issuedAt = null } = {}) {
  if (!verifier || !verifier.kappa || !verifier.sign) throw new Error("makeChallenge needs a signing principal");
  if (!Array.isArray(asks) || !asks.length) throw new Error("a challenge must ask for at least one claim");
  const now = issuedAt || new Date().toISOString();
  const body = { "@type": "HoloChallenge", verifier: verifier.kappa, asks: [...asks].sort(),
    audience: audience || verifier.kappa, issuedAt: now,
    expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(), nonce: hex(rand(12)) };
  const c = canon(body);
  return { kappa: await addressOf(te.encode(c)), ...body, alg: verifier.alg, pub: verifier.pub, sig: await verifier.sign(c) };
}

// verify a challenge (the holder checks before answering): re-derive κ, re-derive verifier κ, check sig + expiry.
export async function verifyChallenge(ch, { now = null } = {}) {
  try {
    if (!ch || !ch.kappa || !ch.sig) return null;
    const { kappa, alg, pub, sig, ...body } = ch;
    const c = canon(body);
    if (await addressOf(te.encode(c)) !== kappa) return null;
    if (await kappaOfPub(pub) !== body.verifier) return null;
    if (!(await verifySig(pub, alg, sig, te.encode(c)))) return null;
    if (body.expiresAt && (now || new Date().toISOString()) > body.expiresAt) return null;
    return body;
  } catch { return null; }
}

// ── the HOLDER answers. Reveals ONLY ch.asks, binds the answer to this challenge, signs it.
//    `release` is the consent gate: human → biometric step-up; agent → delegated-capability check.
//    Returns the presentation κ-object, or null (cannot satisfy / consent refused). ──
export async function present(holder, cred, ch, { release = null, now = null } = {}) {
  if (!holder || !holder.kappa || !holder.sign) throw new Error("present needs a signing principal");
  const chBody = await verifyChallenge(ch, { now });
  if (!chBody) return null;                                                        // refuse to answer a bad challenge
  if (cred.subject !== holder.kappa) return null;                                  // you may only present YOUR credential
  const reveal = selectiveOpen(cred, chBody.asks);
  if (!reveal) return null;                                                        // credential lacks an asked claim
  if (release) { let ok = false; try { ok = await release({ asks: chBody.asks, verifier: chBody.verifier, audience: chBody.audience }); } catch { ok = false; } if (!ok) return null; }
  const body = { "@type": "HoloPresentation", challenge: ch.kappa, audience: chBody.audience, nonce: chBody.nonce,
    credential: credentialCore(cred), reveal, holder: holder.kappa, issuedAt: now || new Date().toISOString() };
  const c = canon(body);
  return { kappa: await addressOf(te.encode(c)), ...body, alg: holder.alg, pub: holder.pub, sig: await holder.sign(c) };
}

// ── the VERIFIER checks the answer, fully offline (Law L5, fail-closed). Returns
//    { claims, issuer, subject, schema } | null. No issuer contact anywhere in this function. ──
export async function verifyPresentation(resp, ch, { now = null, expectedAudience = null, checkSchema = null, isRevoked = null } = {}) {
  try {
    if (!resp || !resp.kappa || !resp.sig) return null;
    const { kappa, alg, pub, sig, ...body } = resp;
    const c = canon(body);
    if (await addressOf(te.encode(c)) !== kappa) return null;                      // presentation commits to its body
    if (ch && body.challenge !== ch.kappa) return null;                           // bound to THIS challenge
    if (ch && body.nonce !== ch.nonce) return null;                              // replay refusal (stale nonce)
    const aud = expectedAudience || (ch && ch.audience);
    if (aud && body.audience !== aud) return null;                               // misdelivery refusal (wrong audience)
    if (await kappaOfPub(pub) !== body.holder) return null;                      // holder κ = address of its pubkey
    if (!(await verifySig(pub, alg, sig, te.encode(c)))) return null;            // holder binding signature
    const cbody = await verifyCredential(body.credential, { now, checkSchema, isRevoked });
    if (!cbody) return null;                                                     // the credential itself must verify
    if (cbody.subject !== body.holder) return null;                             // the presenter IS the credential's subject
    const asks = ch ? ch.asks : Object.keys(body.reveal || {});
    const claims = {};
    for (const k of Object.keys(body.reveal || {})) {
      const d = body.reveal[k];
      if (!Array.isArray(d) || d[1] !== k) return null;
      if (!cbody._sd.includes(await leaf(d))) return null;                       // revealed leaf must re-derive into signed _sd
      claims[k] = d[2];
    }
    for (const k of asks) if (!(k in claims)) return null;                       // completeness: every asked claim present
    for (const k of Object.keys(claims)) if (!asks.includes(k)) return null;     // no over-disclosure / leak beyond the ask
    return { claims, issuer: cbody.issuer, subject: cbody.subject, schema: cbody.schema };
  } catch { return null; }
}

// one leaf hash — re-imported so verifyPresentation re-derives by the SAME path issuance committed to.
async function leaf(disclosure) { const { sha256Hex } = await import("./holo-identity.mjs"); return sha256Hex(te.encode(canon(disclosure))); }

// ── self-test (node): the full magical loop, plus every refusal. ──
export async function selftest() {
  const { ephemeral } = await import("./holo-identity.mjs");
  const { issueCredential } = await import("./holo-credential.mjs");
  const r = {};
  const issuer = await ephemeral({ label: "Gov" });
  const human = await ephemeral({ label: "Alice" });          // a human operator κ
  const agent = await ephemeral({ label: "AgentSmith" });     // an AI agent κ — same shape
  const verifier = await ephemeral({ label: "BarSite" });

  // issue the SAME kind of credential to a human and to an agent
  const credH = await issueCredential(issuer, { subject: human.kappa, claims: { ageOver18: true, country: "EE", dob: "1990-02-01" } });
  const credA = await issueCredential(issuer, { subject: agent.kappa, claims: { ageOver18: true, country: "EE", scope: "trade" } });

  const ch = await makeChallenge(verifier, { asks: ["ageOver18"], audience: verifier.kappa });

  // HUMAN path — gated by a biometric step-up stand-in
  const presH = await present(human, credH, ch, { release: async () => true /* TEE/biometric released */ });
  const okH = await verifyPresentation(presH, ch, { expectedAudience: verifier.kappa });
  r.humanProves = !!okH && okH.claims.ageOver18 === true;
  r.humanMinimal = okH && Object.keys(okH.claims).length === 1 && !("dob" in okH.claims);   // dob NEVER left the holder

  // AGENT path — gated by a delegated-capability check; IDENTICAL disclosure code path
  const presA = await present(agent, credA, ch, { release: async () => true /* delegated capability ok */ });
  const okA = await verifyPresentation(presA, ch, { expectedAudience: verifier.kappa });
  r.agentProves = !!okA && okA.claims.ageOver18 === true;
  r.symmetry = okH && okA && okH.issuer === okA.issuer && okH.subject === human.kappa && okA.subject === agent.kappa;

  // REFUSALS
  r.consentRefused = (await present(human, credH, ch, { release: async () => false })) === null;
  r.notSubject = (await present(verifier, credH, ch, { release: async () => true })) === null;     // wrong holder
  const ch2 = await makeChallenge(verifier, { asks: ["ageOver18"], audience: verifier.kappa });
  r.replayRefused = (await verifyPresentation(presH, ch2, { expectedAudience: verifier.kappa })) === null; // stale nonce vs new challenge
  r.audienceRefused = (await verifyPresentation(presH, ch, { expectedAudience: "did:holo:sha256:" + "0".repeat(64) })) === null;
  r.tamperRefused = (await verifyPresentation({ ...presH, reveal: { ageOver18: [presH.reveal.ageOver18[0], "ageOver18", false] } }, ch, { expectedAudience: verifier.kappa })) === null;
  const chMore = await makeChallenge(verifier, { asks: ["passport"], audience: verifier.kappa });
  r.cannotSatisfy = (await present(human, credH, chMore, { release: async () => true })) === null;  // credential lacks the claim

  r.ok = Object.values(r).every(Boolean);
  return r;
}

if (typeof process !== "undefined" && process.argv && /holo-present\.mjs$/.test(process.argv[1] || "")) {
  selftest().then((r) => { console.log("holo-present selftest:", r); process.exit(r.ok ? 0 : 1); });
}
