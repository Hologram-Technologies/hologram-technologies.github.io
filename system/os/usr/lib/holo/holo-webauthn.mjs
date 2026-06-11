// holo-webauthn.mjs — device-native biometric sign-in for Hologram OS.
//
// The operator signs in by proving presence to THIS device's hardware Trusted Execution
// Environment (TEE) — Windows Hello, Apple Touch ID / Face ID (Secure Enclave), Android
// StrongBox — surfaced by the W3C Web Authentication API (WebAuthn) PLATFORM authenticator.
// There is no server and no shared password: the authenticator's PRF extension (CTAP2
// `hmac-secret`) derives a high-entropy secret INSIDE the secure enclave, released only after
// a successful biometric (userVerification: required). That secret is what wraps the self-
// sovereign key in holo-identity — so the key at rest can be unwrapped only by a biometric on
// this exact device. The private key never leaves the enclave; the PRF secret never leaves the
// page. Law L1 (identity is a sovereign key, not a server account) · Law L4 (the web platform
// IS the engine — WebAuthn, no foreign runtime).
//
// Secure-context only: WebAuthn requires https:// or localhost/127.0.0.1 (both satisfied by the
// dev κ-route server and a Pages deploy). Pure-ish: touches navigator.credentials only when
// called, so the module still imports under Node (where teeAvailable() simply returns false).

const RP_NAME = "Hologram OS";
const te = new TextEncoder();

// base64url ⇄ bytes (WebAuthn ids and the PRF secret travel as base64url strings).
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => {
  const t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(t + "===".slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
};

// The fixed PRF "salt" — a stable context label so the same authenticator yields the same secret
// every unlock (HMAC-SHA256 over this label, keyed inside the enclave). Versioned for rotation.
const PRF_SALT = te.encode("holo-identity:prf:v1");

const RNG = globalThis.crypto || null;
const rand = (n) => RNG.getRandomValues(new Uint8Array(n));

// ── detection ──────────────────────────────────────────────────────────────────
export function teeSupported() {
  return typeof PublicKeyCredential !== "undefined" && !!(globalThis.navigator && navigator.credentials && navigator.credentials.create);
}

// True only when THIS device has a user-verifying platform authenticator (a real TEE/biometric),
// not a roaming security key. This is the "auto-detect the device" gate the greeter checks.
export async function teeAvailable() {
  if (!teeSupported()) return false;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch { return false; }
}

// A human name for the local authenticator, for the greeter's status line.
export function teeName() {
  const ua = ((globalThis.navigator && (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent)) || "");
  if (/win/i.test(ua)) return "Windows Hello";
  if (/mac|iphone|ipad|ios/i.test(ua)) return "Touch ID";
  if (/android/i.test(ua)) return "device biometrics";
  return "device biometrics";
}

// Turn a raw WebAuthn / DOMException into a short, human message for the greeter.
export function teeError(e) {
  const n = (e && (e.name || "")) + "";
  const m = (e && (e.message || "")) + "";
  if (/NotAllowed/i.test(n)) return "Biometric cancelled or timed out";
  if (/PRF|hardware secret/i.test(m)) return "This device can't derive a hardware key (no PRF)";
  if (/SecurityError|secure context/i.test(n + m)) return "Biometric needs a secure (https/localhost) page";
  return m || "Biometric sign-in failed";
}

// ── enrol: mint a platform passkey bound to the TEE; return {credentialId, secret} ──
// `secret` (base64url) becomes the wrapping passphrase for the sovereign key.
export async function teeEnroll({ name, userId } = {}) {
  if (!teeSupported()) throw new Error("WebAuthn unavailable");
  const uid = userId ? te.encode(String(userId)) : rand(16);
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: RP_NAME, id: location.hostname },
      user: { id: uid, name: name || "operator", displayName: name || "operator" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "required" },
      timeout: 60000,
      attestation: "none",
      extensions: { prf: { eval: { first: PRF_SALT } } },
    },
  });
  if (!cred) throw new Error("biometric setup cancelled");
  const credentialId = b64u(cred.rawId);
  let secret = cred.getClientExtensionResults?.()?.prf?.results?.first;
  // Some platforms enable PRF at creation but only RETURN it on a subsequent assertion.
  if (!secret) secret = unb64u((await teeAssert({ credentialId })).secret);
  if (!secret) throw new Error("no PRF / hardware secret");
  return { credentialId, secret: b64u(secret) };
}

// ── assert: biometric prompt for an existing passkey; return {secret, credentialId} ──
// `credentialId` targets one passkey; `allowCredentials` offers a set; BOTH empty ⇒ a usernameless
// (discoverable-credential) prompt where the authenticator itself lists this origin's identities —
// the operator proves possession of a key without ever naming it (Law L1). The returned
// `credentialId` (the passkey the operator actually verified) is what the caller maps to a κ.
export async function teeAssert({ credentialId, allowCredentials } = {}) {
  if (!teeSupported()) throw new Error("WebAuthn unavailable");
  const ids = (allowCredentials && allowCredentials.length) ? allowCredentials : (credentialId ? [credentialId] : []);
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      rpId: location.hostname,
      timeout: 60000,
      userVerification: "required",
      allowCredentials: ids.map((id) => ({ type: "public-key", id: unb64u(id) })),
      extensions: { prf: { eval: { first: PRF_SALT } } },
    },
  });
  if (!assertion) throw new Error("biometric cancelled");
  const secret = assertion.getClientExtensionResults?.()?.prf?.results?.first;
  if (!secret) throw new Error("no PRF / hardware secret");
  return { secret: b64u(secret), credentialId: b64u(assertion.rawId) };
}
