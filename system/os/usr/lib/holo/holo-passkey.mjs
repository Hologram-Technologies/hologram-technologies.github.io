// holo-passkey.mjs — Hologram as a WebAuthn PASSKEY PROVIDER (P4 of Holo Pass).
//
// VISION: Hologram IS the authenticator. When any site calls navigator.credentials.create/get, the
// native κ-host routes the ceremony here instead of to a hardware key. We mint a per-rp passkey,
// store the private key IN THE VAULT (kind "passkey", sealed + operator-signed, opaque at rest), and
// satisfy assertions after the ONE TEE biometric step-up. One fingerprint = a passkey for every site,
// device-local, post-quantum-signed at rest, no roaming authenticator, no extension.
//
// FAITHFUL to the WebAuthn spec (so REAL relying parties verify our output): ES256 (P-256) credentials,
// proper authenticatorData (rpIdHash‖flags‖signCount‖attestedCredentialData), "none" attestation, COSE
// pubkey, DER-encoded ECDSA signature over authData‖SHA256(clientDataJSON). The engine is storage- and
// gate-INJECTED (same shape as holo-walletconnect/holo-vault-bridge): the host wires `lookup`/`persist`
// to the vault and `stepup` to holo-stepup. Anti-phishing: assertions bind to the verified rpId/origin;
// a credential minted for one rpId never signs for another (SEC-2 capability, ADR-013 exact-origin).

const te = new TextEncoder();
const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;
const RNG = globalThis.crypto;
if (!SUB) throw new Error("holo-passkey: WebCrypto SubtleCrypto required");

// ── base64url ⇄ bytes (WebAuthn ids/challenges travel as base64url) ─────────────────────────────────
const b64u = (buf) => { const b = new Uint8Array(buf); let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = (s) => { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const cat = (...arrs) => { let n = 0; for (const a of arrs) n += a.length; const out = new Uint8Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
const sha256 = async (bytes) => new Uint8Array(await SUB.digest("SHA-256", bytes));

// ── minimal CBOR encoder (only the subset WebAuthn needs: uint, negint, bytes, text, map) ───────────
// Canonical enough for attestationObject + COSE_Key. Keys are emitted in the order given (we order them
// per the COSE/WebAuthn convention), values recursively encoded.
function cborHead(major, n) {
  if (n < 24) return new Uint8Array([(major << 5) | n]);
  if (n < 0x100) return new Uint8Array([(major << 5) | 24, n]);
  if (n < 0x10000) return new Uint8Array([(major << 5) | 25, n >> 8, n & 0xff]);
  return new Uint8Array([(major << 5) | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}
function cbor(v) {
  if (typeof v === "number" && Number.isInteger(v)) {
    return v >= 0 ? cborHead(0, v) : cborHead(1, -v - 1);                 // major 0 uint, major 1 negint
  }
  if (v instanceof Uint8Array) return cat(cborHead(2, v.length), v);     // major 2 byte string
  if (typeof v === "string") { const b = te.encode(v); return cat(cborHead(3, b.length), b); } // major 3 text
  if (v && v.__map) {                                                    // major 5 map (ordered entries)
    const entries = v.__map; const parts = [cborHead(5, entries.length)];
    for (const [k, val] of entries) parts.push(cbor(k), cbor(val));
    return cat(...parts);
  }
  throw new Error("cbor: unsupported value");
}
const cmap = (entries) => ({ __map: entries });

// ── raw (r‖s, 32+32) → DER ECDSA signature (WebAuthn requires DER) ─────────────────────────────────
function rawToDer(raw) {
  const r = raw.slice(0, 32), s = raw.slice(32, 64);
  const trim = (x) => { let i = 0; while (i < x.length - 1 && x[i] === 0) i++; x = x.slice(i); if (x[0] & 0x80) x = cat(new Uint8Array([0]), x); return x; };
  const R = trim(r), S = trim(s);
  const body = cat(new Uint8Array([0x02, R.length]), R, new Uint8Array([0x02, S.length]), S);
  return cat(new Uint8Array([0x30, body.length]), body);
}

// ── COSE_Key for an ES256 (P-256) public key, from its raw uncompressed form (0x04‖x‖y) ─────────────
function coseKeyFromRaw(raw) {
  const x = raw.slice(1, 33), y = raw.slice(33, 65);
  // map: 1(kty)=2(EC2), 3(alg)=-7(ES256), -1(crv)=1(P-256), -2(x), -3(y) — canonical key order
  return cbor(cmap([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, y]]));
}

// ── authenticatorData = rpIdHash(32)‖flags(1)‖signCount(4 BE)‖[attestedCredentialData] ──────────────
const F_UP = 0x01, F_UV = 0x04, F_AT = 0x40;     // user-present, user-verified, attested-cred-data
async function authData(rpId, flags, signCount, attestedCred /* Uint8Array | null */) {
  const rpIdHash = await sha256(te.encode(rpId));
  const sc = new Uint8Array([(signCount >>> 24) & 0xff, (signCount >>> 16) & 0xff, (signCount >>> 8) & 0xff, signCount & 0xff]);
  return attestedCred ? cat(rpIdHash, new Uint8Array([flags]), sc, attestedCred) : cat(rpIdHash, new Uint8Array([flags]), sc);
}

const AAGUID = new Uint8Array(16);   // all-zero AAGUID: a software/provider authenticator (privacy-preserving, RP-agnostic)

function clientData(type, challenge, origin) {
  // challenge arrives as base64url (the spec's transport form) or bytes; emit it as base64url.
  const ch = typeof challenge === "string" ? challenge : b64u(challenge);
  return te.encode(JSON.stringify({ type, challenge: ch, origin, crossOrigin: false }));
}

// ── createCredential — satisfy navigator.credentials.create() for `rpId` ────────────────────────────
// Returns the PublicKeyCredential-shaped result (b64url fields) AND `store` (the secret to persist in
// the vault). The caller (host/shell) persists `store` under vault kind "passkey", origin=rpId.
export async function createCredential({ rpId, rpName = rpId, userId, userName = "", userDisplayName = "", challenge, origin, signCount = 0 }) {
  if (!rpId || !challenge || !origin) throw new Error("createCredential: rpId, challenge, origin required");
  const kp = await SUB.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const rawPub = new Uint8Array(await SUB.exportKey("raw", kp.publicKey));     // 0x04‖x‖y
  const privJwk = await SUB.exportKey("jwk", kp.privateKey);
  const credId = RNG.getRandomValues(new Uint8Array(32));
  const cose = coseKeyFromRaw(rawPub);
  const credIdLen = new Uint8Array([(credId.length >> 8) & 0xff, credId.length & 0xff]);
  const attestedCred = cat(AAGUID, credIdLen, credId, cose);
  const ad = await authData(rpId, F_UP | F_UV | F_AT, signCount, attestedCred);
  const attObj = cbor(cmap([["fmt", "none"], ["attStmt", cmap([])], ["authData", ad]]));   // "none" attestation
  const cdj = clientData("webauthn.create", challenge, origin);
  const userHandle = userId != null ? (typeof userId === "string" ? userId : b64u(userId)) : null;
  return {
    credential: {
      id: b64u(credId), rawId: b64u(credId), type: "public-key",
      response: { attestationObject: b64u(attObj), clientDataJSON: b64u(cdj) },
      authenticatorAttachment: "platform",
    },
    store: { credentialId: b64u(credId), rpId, privJwk, userHandle, userName, userDisplayName, signCount },
    publicKeyCose: b64u(cose),           // for the relying party (and our witness) to verify assertions
  };
}

// ── getAssertion — satisfy navigator.credentials.get() for `rpId`, after the step-up gate ────────────
// `lookup(rpId, allowIds)` → the stored passkey record (or null); `stepup` (default: deny) gates the
// signing; `persist(record)` saves the incremented signCount. Returns the assertion (b64url fields).
export async function getAssertion({ rpId, challenge, origin, allowCredentials = [] }, { lookup, stepup = async () => null, persist = async () => {} } = {}) {
  if (!rpId || !challenge || !origin) throw new Error("getAssertion: rpId, challenge, origin required");
  if (typeof lookup !== "function") throw new Error("getAssertion: lookup required");
  const allowIds = (allowCredentials || []).map((c) => (typeof c === "string" ? c : (c.id || b64u(c)))).filter(Boolean);
  const rec = await lookup(rpId, allowIds);
  if (!rec) throw new Error("no passkey for " + rpId);      // anti-phishing: no cred for this rpId → fail-closed
  // STEP-UP: the operator must prove presence to sign. Payload-bound to THIS rpId+challenge (SEC-2).
  const token = await stepup({ kind: "passkey.assert", appId: "holo://os", payload: { rpId, credentialId: rec.credentialId, challenge: typeof challenge === "string" ? challenge : b64u(challenge) }, reason: "Sign in to " + rpId });
  if (!token) throw new Error("passkey: step-up denied");
  const priv = await SUB.importKey("jwk", rec.privJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const nextCount = (rec.signCount | 0) + 1;
  const ad = await authData(rpId, F_UP | F_UV, nextCount, null);    // assertion: no attested-cred-data
  const cdj = clientData("webauthn.get", challenge, origin);
  const signed = cat(ad, await sha256(cdj));
  const rawSig = new Uint8Array(await SUB.sign({ name: "ECDSA", hash: "SHA-256" }, priv, signed));
  await persist({ ...rec, signCount: nextCount });
  return {
    credential: {
      id: rec.credentialId, rawId: rec.credentialId, type: "public-key",
      response: { authenticatorData: b64u(ad), clientDataJSON: b64u(cdj), signature: b64u(rawToDer(rawSig)), userHandle: rec.userHandle || null },
      authenticatorAttachment: "platform",
    },
    stepup: token.id, signCount: nextCount,
  };
}

// ── verifyAssertion — RELYING-PARTY-side check (also the witness's verifier). Given the COSE pubkey
//    minted at create() and the assertion, confirm the signature over authData‖SHA256(clientDataJSON),
//    the rpIdHash, the challenge, the origin, and a monotonic signCount. Returns {ok, reason}. ─────────
export async function verifyAssertion({ publicKeyCose, assertion, expectedRpId, expectedChallenge, expectedOrigin, lastSignCount = -1 }) {
  try {
    const r = assertion.response;
    const ad = unb64u(r.authenticatorData), cdj = unb64u(r.clientDataJSON), der = unb64u(r.signature);
    const cd = JSON.parse(new TextDecoder().decode(cdj));
    if (cd.type !== "webauthn.get") return { ok: false, reason: "bad clientData type" };
    if (expectedChallenge != null && cd.challenge !== (typeof expectedChallenge === "string" ? expectedChallenge : b64u(expectedChallenge))) return { ok: false, reason: "challenge mismatch" };
    if (expectedOrigin != null && cd.origin !== expectedOrigin) return { ok: false, reason: "origin mismatch" };
    const rpIdHash = ad.slice(0, 32), expHash = await sha256(te.encode(expectedRpId));
    for (let i = 0; i < 32; i++) if (rpIdHash[i] !== expHash[i]) return { ok: false, reason: "rpIdHash mismatch" };
    const flags = ad[32]; if (!(flags & F_UP)) return { ok: false, reason: "UP not set" };
    const signCount = (ad[33] << 24) | (ad[34] << 16) | (ad[35] << 8) | ad[36];
    if (signCount <= lastSignCount) return { ok: false, reason: "signCount not monotonic" };
    // import the COSE pubkey → raw, verify DER signature
    const cose = unb64u(publicKeyCose);     // we stored x at -2, y at -3; reconstruct raw 0x04‖x‖y
    const x = coseGet(cose, -2), y = coseGet(cose, -3);
    if (!x || !y) return { ok: false, reason: "bad COSE key" };
    const rawPub = cat(new Uint8Array([4]), x, y);
    const key = await SUB.importKey("raw", rawPub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const rawSig = derToRaw(der);
    const signed = cat(ad, await sha256(cdj));
    const ok = await SUB.verify({ name: "ECDSA", hash: "SHA-256" }, key, rawSig, signed);
    return { ok, reason: ok ? "ok" : "signature invalid" };
  } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
}

// minimal COSE map reader for the two byte-string fields we need (-2 x, -3 y)
function coseGet(buf, wantKey) {
  let i = 0; const ib = buf[i++]; const n = ib & 0x1f; if ((ib >> 5) !== 5) return null;   // must be a map
  for (let e = 0; e < n; e++) {
    const k = readInt(buf, i); i = k.next; const v = readItem(buf, i); i = v.next;
    if (k.val === wantKey && v.bytes) return v.bytes;
  }
  return null;
}
function readInt(buf, i) { const ib = buf[i++]; const major = ib >> 5, info = ib & 0x1f; let n = info; if (info === 24) n = buf[i++]; else if (info === 25) { n = (buf[i] << 8) | buf[i + 1]; i += 2; } return { val: major === 1 ? -n - 1 : n, next: i }; }
function readItem(buf, i) { const ib = buf[i]; const major = ib >> 5; if (major === 2) { const h = readInt(buf, i); const len = h.val; const start = h.next; return { bytes: buf.slice(start, start + len), next: start + len }; } const h = readInt(buf, i); return { val: h.val, next: h.next }; }
function derToRaw(der) {
  let i = 2; if (der[i++] !== 0x02) throw new Error("bad DER"); let rl = der[i++]; let r = der.slice(i, i + rl); i += rl;
  if (der[i++] !== 0x02) throw new Error("bad DER"); let sl = der[i++]; let s = der.slice(i, i + sl);
  const pad = (x) => { if (x.length > 32) x = x.slice(x.length - 32); if (x.length < 32) x = cat(new Uint8Array(32 - x.length), x); return x; };
  return cat(pad(r), pad(s));
}

export const __test = { cbor, cmap, rawToDer, derToRaw, coseKeyFromRaw, authData, b64u, unb64u };
