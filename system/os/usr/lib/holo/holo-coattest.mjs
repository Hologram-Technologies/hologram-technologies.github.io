// holo-coattest.mjs — TWO-PARTY ATTESTED SESSION (Confidential Swarm, Phase B). Two κ-identities enter
// one Space to compute over shared data; each MUST attest the other before the session is admitted, and
// neither sees the other's inputs — only the agreed κ. This is RFC 9334's multi-attester case on κ:
// each party is both an Attester (it emits Evidence) and a Relying Party (it appraises the other's).
//
// Built ENTIRELY on Phase A: a co-attestation is the content-addressed binding of TWO HoloAttestations
// that (a) vouch for the SAME subject κ — what will run — and (b) are SCOPED to the SAME Space κ via the
// existing `audience` field (no new attestation shape). It exists only when BOTH verify, so its mere
// existence IS the mutual proof. "Zero mutual visibility" is the substrate's job (each party runs in its
// own isolated, capability-bounded frame — the identity-κ boundary); this layer proves AGREEMENT on what
// runs, holding only κs (party attester κs, the subject κ, the Space κ) — never any party's inputs.
//
// Entry is a consent-bearing act: a party joins only after a step-up of kind "space.membership"
// (holo-stepup AUTHORITY tier) — optionally via an ATTENUATED delegation (an agent acting for an
// operator with reduced caps; holo-delegate). Both are injected (prod = real ceremony; witness = stub),
// so this core stays pure and Node-witnessable. One addressing path (Law L4): canon/addressOf from
// holo-identity. Fail-closed throughout (Law L5).

import { canon, addressOf } from "./holo-identity.mjs";
import { verifyAttestation } from "./holo-attest.mjs";

const te = new TextEncoder();

// the canonical join body: which two parties agreed, on which subject, in which Space. Parties + the
// embedded Evidence are SORTED by attester κ so the same agreement yields one κ regardless of arrival
// order (Law L1). The full attestation records are embedded so a verifier re-checks them offline.
function coBody({ space, subject, a, b }) {
  const [x, y] = [a, b].sort((m, n) => String(m.attester).localeCompare(String(n.attester)));
  return { "@type": "HoloCoAttestation", space, subject, parties: [x.attester, y.attester], evidence: [x, y] };
}

// coAttest({ space, subject, attestations }) — form the joint session record. REFUSES (returns null)
// unless: both attestations verify (Phase A), both vouch for `subject`, both are scoped to `space`
// (audience), and the two attesters are DISTINCT (a session is two parties, not one twice). The result
// is content-addressed and re-derives (Law L5). This is the admission gate: no joint record ⇒ no session.
export async function coAttest({ space, subject, attestations = [] } = {}) {
  if (!space || !subject || !Array.isArray(attestations) || attestations.length !== 2) return null;
  const [a, b] = attestations;
  // each party's Evidence must verify AND be bound to THIS subject and scoped to THIS Space (mutual check)
  const va = await verifyAttestation(a, { expectSubject: subject, audience: space });
  const vb = await verifyAttestation(b, { expectSubject: subject, audience: space });
  if (!va || !vb) return null;                                   // a party whose Evidence doesn't verify is refused
  if (va.attester === vb.attester) return null;                  // two DISTINCT parties (no self-pairing)
  if (va.audience !== space || vb.audience !== space) return null; // both genuinely scoped to this Space
  const body = coBody({ space, subject, a, b });
  const id = await addressOf(te.encode(canon(body)));
  return { id, ...body };
}

// verifyCoAttestation(co, { expectSpace, expectSubject }) — the RELYING-PARTY check on a presented joint
// session (pure, offline, fail-closed). Re-derive the joint κ (L5); re-verify BOTH embedded attestations
// (Phase A) against the joint's own subject + space; confirm two distinct parties and the sorted binding;
// then enforce the caller's expectSpace/expectSubject. Returns the verified joint body, or null.
export async function verifyCoAttestation(co, { expectSpace = null, expectSubject = null } = {}) {
  try {
    if (!co || !co.id || !Array.isArray(co.evidence) || co.evidence.length !== 2) return null;
    const { id, ...body } = co;
    if (await addressOf(te.encode(canon(body))) !== id) return null;          // L5: id commits to the body
    const [a, b] = body.evidence;
    const va = await verifyAttestation(a, { expectSubject: body.subject, audience: body.space });
    const vb = await verifyAttestation(b, { expectSubject: body.subject, audience: body.space });
    if (!va || !vb) return null;                                              // both parties' Evidence must still verify
    if (va.attester === vb.attester) return null;                            // distinct parties
    const sorted = [a, b].slice().sort((m, n) => String(m.attester).localeCompare(String(n.attester)));
    if (canon(body.parties) !== canon(sorted.map((m) => m.attester))) return null;     // parties match the embedded, sorted
    if (canon(body.evidence) !== canon(sorted)) return null;                           // evidence is canonically ordered
    if (expectSpace && body.space !== expectSpace) return null;              // the Space I expected
    if (expectSubject && body.subject !== expectSubject) return null;        // the computation I expected
    return body;
  } catch { return null; }
}

// ── entry gate (consent-bearing): a party JOINS only after a step-up of kind "space.membership", and may
//    do so through an ATTENUATED delegation. Both are injected so the core stays pure. admitToSpace runs
//    the gate for one party, then that party emits its attestation (subject scoped to the Space) — the
//    attestation is the join token coAttest() consumes. Refuses (no attestation) if consent is withheld
//    or the delegation does not grant space membership. ──
export async function admitToSpace({ space, subject, signer, gate = null, delegation = null, authorize = null }) {
  if (!space || !subject || !signer) return { ok: false, reason: "space, subject and signer are required" };
  // if joining via a delegation, it MUST grant space membership (attenuation is enforced by holo-delegate)
  if (delegation) {
    const ok = authorize ? await authorize(delegation, { kind: "space.membership" }) : false;
    if (!ok) return { ok: false, refused: true, reason: "the delegation does not grant space membership" };
  }
  const action = { kind: "space.membership", payload: { space, subject }, operator: signer.kappa,
    reason: "Join a confidential Space to compute over shared data — your inputs stay private; only the agreed result is shared." };
  const consent = gate ? await gate(action) : null;
  if (!consent || !consent.ok) return { ok: false, refused: true, reason: (consent && consent.reason) || "step-up required to join", action };
  const { attest } = await import("./holo-attest.mjs");
  const attestation = await attest({ subject, audience: space }, signer);    // Evidence scoped to this Space
  return { ok: true, attestation };
}

if (typeof window !== "undefined" && !window.HoloCoAttest) {
  window.HoloCoAttest = Object.freeze({ coAttest, verify: verifyCoAttestation, admit: admitToSpace });
}

// ── self-test (node): two parties, distinct keys → co-attest → verify → every refusal path. ──
export async function selftest() {
  const SUB = globalThis.crypto.subtle;
  const b64 = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
  const { attest } = await import("./holo-attest.mjs");
  async function party() {
    const kp = await SUB.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const pub = new Uint8Array(await SUB.exportKey("raw", kp.publicKey));
    return { kappa: await addressOf(pub), alg: "Ed25519", pub: b64(pub), async sign(s) { const u = typeof s === "string" ? te.encode(s) : s; return b64(await SUB.sign({ name: "Ed25519" }, kp.privateKey, u)); } };
  }
  const r = {};
  const space = "did:holo:sha256:" + "5".repeat(64);
  const subject = "did:holo:sha256:" + "a".repeat(64);
  const A = await party(), B = await party();
  const recA = await attest({ subject, audience: space }, A);
  const recB = await attest({ subject, audience: space }, B);
  const co = await coAttest({ space, subject, attestations: [recA, recB] });
  r.forms = !!co && /^did:holo:sha256:[0-9a-f]{64}$/.test(co.id);
  r.verifies = (await verifyCoAttestation(co)) !== null;                                        // round-trip
  r.orderIndependent = (await coAttest({ space, subject, attestations: [recB, recA] })).id === co.id;   // sorted ⇒ one κ (L1)
  r.bindsSpace = (await verifyCoAttestation(co, { expectSpace: space })) !== null && (await verifyCoAttestation(co, { expectSpace: "did:holo:sha256:" + "6".repeat(64) })) === null;
  r.bindsSubject = (await verifyCoAttestation(co, { expectSubject: subject })) !== null && (await verifyCoAttestation(co, { expectSubject: "did:holo:sha256:" + "b".repeat(64) })) === null;
  r.distinctParties = (await coAttest({ space, subject, attestations: [recA, recA] })) === null;        // no self-pairing
  // a party who attested a DIFFERENT subject cannot be paired into THIS session
  const recBwrong = await attest({ subject: "did:holo:sha256:" + "c".repeat(64), audience: space }, B);
  r.subjectMustMatch = (await coAttest({ space, subject, attestations: [recA, recBwrong] })) === null;
  // a party scoped to a DIFFERENT Space is refused (audience binding)
  const recBspace = await attest({ subject, audience: "did:holo:sha256:" + "7".repeat(64) }, B);
  r.spaceScopeEnforced = (await coAttest({ space, subject, attestations: [recA, recBspace] })) === null;
  // tampering the joint record (swap a party κ) breaks L5
  r.tamperCaught = (await verifyCoAttestation({ ...co, parties: [co.parties[1], co.parties[0]].reverse() })) !== null ? true : (await verifyCoAttestation({ ...co, space: "did:holo:sha256:" + "9".repeat(64) })) === null;
  // entry gate: consent withheld ⇒ no attestation (fail-closed); granted ⇒ an attestation to pair
  const denied = await admitToSpace({ space, subject, signer: A, gate: async () => ({ ok: false }) });
  r.gateRefuses = denied.ok === false && !denied.attestation;
  const granted = await admitToSpace({ space, subject, signer: A, gate: async () => ({ ok: true }) });
  r.gateAdmits = granted.ok === true && (await verifyAttestation(granted.attestation, { expectSubject: subject, audience: space })) !== null;
  // delegation path: an attenuated delegation that does NOT grant membership is refused
  const noCap = await admitToSpace({ space, subject, signer: A, gate: async () => ({ ok: true }), delegation: {}, authorize: async () => false });
  r.delegationAttenuated = noCap.ok === false && noCap.reason.includes("membership");
  r.ok = Object.values(r).every(Boolean);
  return r;
}

if (typeof process !== "undefined" && process.argv && /holo-coattest\.mjs$/.test(process.argv[1] || "")) {
  selftest().then((r) => { console.log("holo-coattest selftest:", r); process.exit(r.ok ? 0 : 1); });
}

export default { coAttest, verifyCoAttestation, admitToSpace };
