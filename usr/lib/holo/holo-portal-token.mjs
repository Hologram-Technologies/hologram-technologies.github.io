// holo-portal-token.mjs — the CAPABILITY side of the κ-Portal (P4). A shared portal link's `#tp` is a REAL
// hybrid post-quantum, content-addressed, SCOPED delegation (holo-delegate over holo-pqc): the sharer grants the
// guest exactly the capabilities the link is meant to carry — nothing more. verifyPortalToken re-derives it
// (Ed25519 ‖ ML-DSA-65 both halves, expiry) before the seed grants any realm; an absent/invalid/over-broad token
// leaves the visitor at least-privilege GUEST (fail-closed). Nesting stays safe by SEC-2: a child token can only
// NARROW (attenuates) — escalation is refused at mint time. This is what makes "send one link to anyone" secure.
import { ed25519 } from "./wdk-crypto/wdk-crypto.bundle.mjs";
import { signKeygen, identityKappa, mldsaSign } from "./holo-pqc.mjs";
import { mintNpc, delegate, verifyDelegation, grants } from "./holo-delegate.mjs";

const te = new TextEncoder();
const b64 = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
const b64u = (s) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

// adapt a hybrid sign-keypair (from signKeygen / an NPC's .sign) into the PC principal shape holo-delegate wants
const pcFromSignKeys = (sign) => ({
  kappa: identityKappa(sign.pub), pub: b64(sign.pub.ed), pqPub: b64(sign.pub.pq),
  sign: (c) => b64(ed25519.sign(te.encode(c), sign.sk.ed)), pqSign: (c) => mldsaSign(sign.sk.pq, c),
});

// makeSharer(label) → a sovereign issuer (fresh hybrid identity). In production the sharer is the operator's
// holo-login PC; this headless issuer lets a device (or a test) mint guest links without a full login ceremony.
export function makeSharer(label = "sharer") { const sign = signKeygen(); return { ...pcFromSignKeys(sign), label, _sign: sign }; }

// mintPortalToken(pc, opts) → { tp, credential, npc }. The sharer grants a fresh guest agent SCOPED caps; `tp`
// is the base64url credential that rides the server-blind #fragment. Default cap = view-only.
export async function mintPortalToken(pc, { capabilities = ["space:view"], notAfter = null, nowIso = null, label = "guest" } = {}) {
  const npc = mintNpc(label);
  const { credential } = await delegate(pc, npc, { capabilities, notAfter, nowIso, issuerCaps: null }); // sovereign root → unbounded issuer
  return { tp: b64u(JSON.stringify(credential)), credential, npc };
}

// verifyPortalToken(tp, opts) → { ok, realm, grant?, reason? }. ok:true (realm "delegate") ONLY if the token
// re-derives, both PQC halves verify, it is unexpired, AND it grants the required capability. Anything else →
// ok:false, realm "guest" (bootPlan's least-privilege default). Wire as bootPlan's `verifyToken`.
export function verifyPortalToken(tp, { nowIso = null, require = null } = {}) {
  let credential; try { credential = JSON.parse(unb64u(tp)); } catch { return { ok: false, realm: "guest", reason: "malformed token" }; }
  const body = verifyDelegation(credential, { nowIso });
  if (!body) return { ok: false, realm: "guest", reason: "token failed verification (tamper/forgery/expiry)" };
  if (require && !grants(body, require)) return { ok: false, realm: "guest", reason: "token does not grant '" + require + "'" };
  return { ok: true, realm: "delegate", grant: { subject: body.subject, issuer: body.issuer, capabilities: body.capabilities, notAfter: body.notAfter ?? null } };
}

// mintChildPortalToken(parentNpc, parentBody, opts) → a NESTED portal's token, issued BY the parent agent and
// bounded by the parent's grant (SEC-2). delegate() throws if `capabilities` is not a subset of the parent's —
// so a nested portal can only ever narrow authority, never widen it. (Feeds P5 infinite nesting.)
export async function mintChildPortalToken(parentNpc, parentBody, { capabilities = [], notAfter = null, nowIso = null, label = "nested-guest" } = {}) {
  const issuer = pcFromSignKeys(parentNpc.sign);
  const child = mintNpc(label);
  const { credential } = await delegate(issuer, child, { capabilities, notAfter, nowIso, issuerCaps: parentBody.capabilities }); // bounded issuer
  return { tp: b64u(JSON.stringify(credential)), credential, npc: child };
}

export default { makeSharer, mintPortalToken, verifyPortalToken, mintChildPortalToken };
