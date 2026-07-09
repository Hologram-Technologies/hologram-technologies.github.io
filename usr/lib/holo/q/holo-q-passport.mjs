// holo-q-passport.mjs — Q SIGNS ITS OWN MESSAGES (Agent Passport authorship).
//
// A Q reply finalizes to a κ on the conversation chain; by default the strand entry is signed by the DEVICE
// operator (the device vouches "my Q said this"). This adds the stronger claim: Q signs the reply κ with its
// OWN sovereign key, recorded as a SIBLING provenance note (kind "message.author") — exactly like the
// message.consent note in holo-messenger-send. It is NOT part of the content κ, so dedup / content-addressing
// is unchanged; the authorship is verifiable provenance bound to the message, fail-closed.
//
// Verification re-derives Q's identity FROM its public key (addressOf), so a note cannot claim a key it does
// not own, then checks the signature over the message κ. A tampered note, a wrong key, or a bad signature is
// REFUSED (Law L5). Crypto is injected (sign / verifySig / addressOf) so the core is Node-witnessable with
// fakes; the browser binding wires WebCrypto (Ed25519 → ECDSA P-256 fallback) + holo-identity.addressOf,
// matching the operator principal exactly (holo-identity.principalFrom).

export const AUTHOR_KIND = "message.author";

// makeQPassport({ identity, alg, pub, sign }) — identity = addressOf(pubRaw); sign(strOrBytes) → signature (b64).
// attest(messageKappa) → { kind, payload } the responder appends to the chain next to the message.
export function makeQPassport({ identity, alg = "Ed25519", pub = "", sign } = {}) {
  if (!identity || typeof sign !== "function") throw new Error("makeQPassport: identity + sign() required");
  async function attest(messageKappa) {
    const k = String(messageKappa);
    const sig = await sign(k);                                   // Q signs the message's content address
    return { kind: AUTHOR_KIND, payload: { "holo:message": k, "holo:agent": identity, "holo:alg": alg, "holo:pub": pub, "holo:sig": sig } };
  }
  return { identity, alg, pub, attest, AUTHOR_KIND };
}

// verifyQAuthorship(payload, { verifySig, addressOf }) → { ok, agent?, why? }.
// (1) the claimed agent MUST be the content address of the supplied public key (no lying about whose key it is);
// (2) the signature MUST verify over the message κ. Either failure → fail-closed.
export async function verifyQAuthorship(payload, { verifySig, addressOf = null } = {}) {
  if (!payload || typeof verifySig !== "function") return { ok: false, why: "no-verifier" };
  const k = payload["holo:message"], agent = payload["holo:agent"], pub = payload["holo:pub"], sig = payload["holo:sig"], alg = payload["holo:alg"];
  if (!k || !agent || !pub || !sig) return { ok: false, why: "incomplete" };
  if (addressOf) { let derived; try { derived = await addressOf(pub); } catch (e) { return { ok: false, why: "addr-failed" }; } if (derived !== agent) return { ok: false, why: "agent≠key" }; }
  let okSig = false; try { okSig = await verifySig({ alg, pub, sig, msg: String(k) }); } catch (e) { okSig = false; }
  return okSig ? { ok: true, agent } : { ok: false, why: "bad-signature" };
}

// ── browser binding: window.HoloQPassport — a real WebCrypto passport for Q ──
// create() mints Q's sovereign keypair (non-extractable private key), identity = addressOf(rawPub) (the SAME
// content-address holo-identity uses for the operator), and returns { passport, verifySig, addressOf } so the
// responder can sign and any surface can verify. All on-device; the private key never leaves WebCrypto.
if (typeof window !== "undefined" && !window.HoloQPassport) {
  const SUB = globalThis.crypto && globalThis.crypto.subtle;
  const te = new TextEncoder();
  const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
  const u8FromB64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const keyParams = (a) => a === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" };
  const sigParams = (a) => a === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" };
  async function addressOf(pubB64) { const raw = u8FromB64(pubB64); const d = new Uint8Array(await SUB.digest("SHA-256", raw)); let h = ""; for (const x of d) h += x.toString(16).padStart(2, "0"); return "did:holo:sha256:" + h; }
  async function verifySig({ alg, pub, sig, msg }) { try { const key = await SUB.importKey("raw", u8FromB64(pub), keyParams(alg || "Ed25519"), false, ["verify"]); return await SUB.verify(sigParams(alg || "Ed25519"), key, u8FromB64(sig), te.encode(String(msg))); } catch (e) { return false; } }
  window.HoloQPassport = {
    makeQPassport, verifyQAuthorship, AUTHOR_KIND, addressOf, verifySig,
    async create() {
      let alg = "Ed25519", kp;
      try { kp = await SUB.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]); }
      catch { alg = "ECDSA"; kp = await SUB.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]); }
      const pubRaw = new Uint8Array(await SUB.exportKey("raw", kp.publicKey));
      const pub = b64(pubRaw), identity = await addressOf(pub);
      const sign = async (s) => b64(await SUB.sign(sigParams(alg), kp.privateKey, te.encode(String(s))));
      return { passport: makeQPassport({ identity, alg, pub, sign }), identity, verifySig, addressOf };
    },
  };
}

export default { makeQPassport, verifyQAuthorship, AUTHOR_KIND };
