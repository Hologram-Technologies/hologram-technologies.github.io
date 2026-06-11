// holo-link.mjs — DELEGATED cross-device sign-in for Hologram OS ("scan QR to Access", the
// WhatsApp-linked-devices model done self-sovereignly). A new device (the desktop) mints its OWN
// device key and shows a QR. The operator's existing device (the phone), holding the sovereign key
// unlocked by biometric, scans it and GRANTS that device a scoped, revocable capability to open
// sessions on the operator's behalf — a UCAN-style delegation (iss=operator κ, aud=device κ),
// signed by the operator and END-TO-END encrypted to the device's ephemeral key. The desktop is
// never given the operator's key; it gets a *capability*, which the operator can revoke per-device
// without touching the identity.
//
// Conformance: identity is the key, never a name/location (L1 — the grant binds two κ's). The
// content-blind relay/mesh that carries the blob is never trusted: the delegation is verified by
// RE-DERIVING the operator κ from its public key and checking the signature (L5); a tampered or
// replayed grant is refused. No added substrate — WebCrypto + the existing κ pub/sub (L4).
//
// Pure/isomorphic: uses only WebCrypto (works in the browser greeter AND in Node for the witness).

const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;
const RNG = globalThis.crypto || (typeof require !== "undefined" ? require("node:crypto").webcrypto : null);
const te = new TextEncoder();
const td = new TextDecoder();
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64u = (b) => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => unb64(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4));
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const rand = (n) => RNG.getRandomValues(new Uint8Array(n));
const LINK_V = "holo-link:v1";

// ── canonical form + content address (byte-identical to holo-identity's, so κ's match) ──
export function canon(o) {
  if (Array.isArray(o)) return "[" + o.map(canon).join(",") + "]";
  if (o && typeof o === "object") return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
  return JSON.stringify(o);
}
async function sha256Hex(u8) { return hex(await SUB.digest("SHA-256", u8 instanceof Uint8Array ? u8 : new Uint8Array(u8))); }
export async function addressOf(u8) { return "did:holo:sha256:" + await sha256Hex(u8); }

// ── the signing axis (Ed25519 preferred, ECDSA P-256 fallback) — matches holo-identity ──
let _axis = null;
async function axis() {
  if (_axis) return _axis;
  try { await SUB.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]); _axis = "Ed25519"; }
  catch { _axis = "ECDSA"; }
  return _axis;
}
const keyParams = (a) => a === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" };
const sigParams = (a) => a === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" };

// verify a signature against a public key whose κ is its own content address (L5 re-derivation).
export async function verifySig({ pub, alg, sig, bytes, kappa }) {
  try {
    if (kappa && await addressOf(unb64(pub)) !== kappa) return false;     // κ must re-derive from the pubkey
    const key = await SUB.importKey("raw", unb64(pub), keyParams(alg), false, ["verify"]);
    return await SUB.verify(sigParams(alg), key, unb64(sig), bytes instanceof Uint8Array ? bytes : te.encode(bytes));
  } catch { return false; }
}

// ── 1 · the new device (desktop) mints its own key + an ECDH channel key, and a QR offer ──
// Returns { offer, secrets }. `offer` is what the QR carries; `secrets` stays on the desktop.
export async function createLinkOffer({ deviceName } = {}) {
  const a = await axis();
  const sign = await SUB.generateKey(keyParams(a), true, ["sign", "verify"]);
  const devPubRaw = new Uint8Array(await SUB.exportKey("raw", sign.publicKey));
  const deviceKappa = await addressOf(devPubRaw);                          // the desktop's OWN identity
  const devPkcs8 = new Uint8Array(await SUB.exportKey("pkcs8", sign.privateKey));
  // ECDH P-256 channel keypair: the operator encrypts the grant to this; only this device decrypts.
  const ec = await SUB.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const ecPubRaw = new Uint8Array(await SUB.exportKey("raw", ec.publicKey));
  const ecPkcs8 = new Uint8Array(await SUB.exportKey("pkcs8", ec.privateKey));
  const channel = "did:holo:sha256:" + await sha256Hex(rand(32));          // single-use pub/sub topic
  const offer = { v: LINK_V, channel, deviceKappa, alg: a, devicePub: b64u(devPubRaw), ecdhPub: b64u(ecPubRaw), deviceName: deviceName || "" };
  const secrets = { channel, deviceKappa, alg: a, devicePub: b64u(devPubRaw), devicePkcs8: b64u(devPkcs8), ecdhPkcs8: b64u(ecPkcs8) };
  return { offer, secrets };
}

// Encode/parse the QR payload. A scannable deep link so a phone camera opens the authorizer page.
export function offerToUrl(offer, baseUrl = "") {
  const frag = b64u(te.encode(JSON.stringify(offer)));
  return `${baseUrl.replace(/\/$/, "")}/link.html#o=${frag}`;
}
export function urlToOffer(url) {
  const m = String(url).match(/[#&]o=([A-Za-z0-9\-_]+)/);
  if (!m) throw new Error("not a holo-link QR");
  const offer = JSON.parse(td.decode(unb64u(m[1])));
  if (offer.v !== LINK_V) throw new Error("unsupported link version");
  return offer;
}

const DEFAULT_CAPS = ["session/open"];                                      // attenuated: only open a session

// ── 2 · the phone mints the delegation (signed by the operator) and E2E-encrypts it to the device ──
// operator: an unlocked holo-identity principal ({ kappa, pub, alg, sign }). Returns { blob, grantId }.
export async function mintDeviceGrant(operator, offer, { caps = DEFAULT_CAPS, ttlMs = 30 * 24 * 3600e3, nowMs } = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const delegation = {
    "@type": "HoloDelegation",
    iss: operator.kappa, issPub: operator.pub, issAlg: operator.alg, issLabel: operator.label || "",
    aud: offer.deviceKappa, audPub: offer.devicePub,
    can: [...caps].sort(),
    channel: offer.channel,
    nbf: new Date(now).toISOString(), exp: new Date(now + ttlMs).toISOString(),
    nonce: hex(rand(8)),
  };
  const body = canon(delegation);
  const grantId = await addressOf(te.encode(body));
  const sig = await operator.sign(body);                                   // ONLY the operator can mint this
  const grant = { id: grantId, ...delegation, sig };
  // E2E: ECDH(ephemeral, device ecdhPub) → HKDF → AES-GCM. Relay sees ciphertext only.
  const eph = await SUB.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const ephPub = new Uint8Array(await SUB.exportKey("raw", eph.publicKey));
  const devEc = await SUB.importKey("raw", unb64u(offer.ecdhPub), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await SUB.deriveBits({ name: "ECDH", public: devEc }, eph.privateKey, 256));
  const hk = await SUB.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aes = await SUB.deriveKey({ name: "HKDF", hash: "SHA-256", salt: unb64u(offer.channel.split(":").pop()), info: te.encode(LINK_V) }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = rand(12);
  const ct = new Uint8Array(await SUB.encrypt({ name: "AES-GCM", iv }, aes, te.encode(JSON.stringify(grant))));
  const blob = { v: LINK_V, channel: offer.channel, epk: b64u(ephPub), iv: b64u(iv), ct: b64u(ct) };
  return { blob, grantId };
}

// ── 3 · the desktop decrypts + VERIFIES the grant (re-derive κ, check sig/aud/window) ──
export async function acceptGrant(secrets, blob, { nowMs, revoked = [] } = {}) {
  if (!blob || blob.v !== LINK_V) throw new Error("not a holo-link grant");
  if (blob.channel !== secrets.channel) throw new Error("grant is for a different channel");
  const ecPriv = await SUB.importKey("pkcs8", unb64u(secrets.ecdhPkcs8), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const ephPub = await SUB.importKey("raw", unb64u(blob.epk), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await SUB.deriveBits({ name: "ECDH", public: ephPub }, ecPriv, 256));
  const hk = await SUB.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aes = await SUB.deriveKey({ name: "HKDF", hash: "SHA-256", salt: unb64u(blob.channel.split(":").pop()), info: te.encode(LINK_V) }, hk, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  let grant;
  try { grant = JSON.parse(td.decode(new Uint8Array(await SUB.decrypt({ name: "AES-GCM", iv: unb64u(blob.iv) }, aes, unb64u(blob.ct))))); }
  catch { throw new Error("grant did not decrypt for this device"); }
  if (grant.channel !== secrets.channel) throw new Error("grant bound to a different pairing");
  const v = await verifyDelegation(grant, { nowMs, revoked, expectAud: secrets.deviceKappa });
  if (!v.ok) throw new Error("grant rejected: " + v.reason);
  return { operator: grant.iss, label: grant.issLabel, can: grant.can, exp: grant.exp, grant };
}

// Standalone verifier — re-derive the issuer κ, check the signature, audience, time window, caps.
export async function verifyDelegation(grant, { nowMs, revoked = [], expectAud, allowedCaps = DEFAULT_CAPS } = {}) {
  try {
    if (!grant || grant["@type"] !== "HoloDelegation" || !grant.sig || !grant.id) return { ok: false, reason: "malformed" };
    const { id, sig, issPub, issAlg, ...body } = grant;
    const bodyBytes = te.encode(canon(body));
    if (await addressOf(bodyBytes) !== id) return { ok: false, reason: "id does not commit to the body" };
    if (await addressOf(unb64(issPub)) !== body.iss) return { ok: false, reason: "issuer κ is not this pubkey (L5)" };
    if (!(await verifySig({ pub: issPub, alg: issAlg, sig, bytes: bodyBytes }))) return { ok: false, reason: "bad operator signature" };
    if (expectAud && body.aud !== expectAud) return { ok: false, reason: "audience is a different device" };
    // attenuation: a delegated capability may never exceed the allowed set (escalation refused)
    if (!body.can.every((c) => allowedCaps.includes(c))) return { ok: false, reason: "capability escalation" };
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (body.nbf && now < Date.parse(body.nbf)) return { ok: false, reason: "not yet valid" };
    if (body.exp && now > Date.parse(body.exp)) return { ok: false, reason: "expired" };
    if (revoked.includes(id)) return { ok: false, reason: "revoked" };
    return { ok: true, grant };
  } catch (e) { return { ok: false, reason: e.message || "verify error" }; }
}

// ── 4 · revocation — the operator signs a per-device revocation (one κ the device can re-check) ──
export async function makeRevocation(operator, grantId, { nowMs } = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const body = { "@type": "HoloRevocation", iss: operator.kappa, issPub: operator.pub, issAlg: operator.alg, revokes: grantId, at: new Date(now).toISOString() };
  const id = await addressOf(te.encode(canon(body)));
  return { id, ...body, sig: await operator.sign(canon(body)) };
}
export async function verifyRevocation(rev) {
  try {
    const { id, sig, issPub, issAlg, ...body } = rev;
    if (await addressOf(unb64(issPub)) !== body.iss) return null;
    if (!(await verifySig({ pub: issPub, alg: issAlg, sig, bytes: te.encode(canon(body)) }))) return null;
    return body.revokes;
  } catch { return null; }
}
