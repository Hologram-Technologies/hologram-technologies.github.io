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

// A valid RP ID is "localhost" or a real dotted domain — NEVER a bare IP literal (the WebAuthn
// spec forbids IPs as RP IDs, so http://127.0.0.1 throws SecurityError; http://localhost and any
// https:// host work). This is why the dev preview must be opened on localhost, not 127.0.0.1.
function host() { return (globalThis.location && location.hostname) || ""; }
function rpIdValid() {
  const h = host();
  if (h === "localhost") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;          // IPv4 literal
  if (h.includes(":")) return false;                            // IPv6 literal
  return h.includes(".");                                       // a real domain (has a dot)
}
function secureOk() { return typeof window === "undefined" ? false : (window.isSecureContext === true); }

// Why a biometric prompt is not available right now — drives the greeter's fallback messaging.
// Returns "" when biometrics ARE available. Async because it probes the platform authenticator.
export async function teeReason() {
  if (!teeSupported()) return "This browser has no WebAuthn / passkey support";
  if (!secureOk()) return "Biometrics need a secure page (https or localhost)";
  if (!rpIdValid()) return "Open this on https or localhost (not an IP) for biometrics";
  try { if (!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) return "No device biometric is set up (Face ID / Touch ID / Windows Hello / fingerprint)"; }
  catch { return "Could not query the device authenticator"; }
  return "";
}

// True only when THIS device can run a user-verifying PLATFORM biometric ceremony right now:
// the on-device authenticator exists, the page is a secure context, and the RP ID is valid.
// Works uniformly on desktop and mobile (Windows Hello · Touch/Face ID · Android fingerprint).
export async function teeAvailable() {
  return (await teeReason()) === "";
}

// A human name for the local authenticator, for the greeter's status line.
export function teeName() {
  const ua = ((globalThis.navigator && (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent)) || "");
  if (/iphone|ipad|ios/i.test(ua)) return "Face ID / Touch ID";
  if (/mac/i.test(ua)) return "Touch ID";
  if (/win/i.test(ua)) return "Windows Hello";
  if (/android/i.test(ua)) return "your fingerprint";
  return "device biometrics";
}

// Turn a raw WebAuthn / DOMException into a short, human message for the greeter.
export function teeError(e) {
  const n = (e && (e.name || "")) + "";
  const m = (e && (e.message || "")) + "";
  if (/NotAllowed|AbortError/i.test(n)) return "Biometric cancelled or timed out";
  if (/InvalidState/i.test(n)) return "This identity is already set up on this device";
  if (/PRF|hardware secret/i.test(m)) return "This device can't derive a hardware key (no PRF)";
  if (/NotSupported/i.test(n)) return "This device can't do hardware biometric sign-in";
  if (/Security|secure context|RP ID|relying party/i.test(n + m)) return "Biometrics need a secure (https/localhost) page";
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
  // Capture the credential's PUBLIC key (SPKI) so a later step-up assertion signature is offline-
  // verifiable (holo-stepup, second axis). Best-effort: getPublicKey() is widely supported but may be
  // absent on older authenticators — the step-up still carries presence (UV flag) without it.
  let credPub = null;
  try { const spki = cred.response?.getPublicKey?.(); if (spki) credPub = b64u(spki); } catch {}
  let secret = cred.getClientExtensionResults?.()?.prf?.results?.first;
  // Some platforms enable PRF at creation but only RETURN it on a subsequent assertion.
  if (!secret) secret = unb64u((await teeAssert({ credentialId })).secret);
  if (!secret) throw new Error("no PRF / hardware secret");
  return { credentialId, secret: b64u(secret), credPub };
}

// ── assert: biometric prompt for an existing passkey; return {secret, credentialId, ...assertion} ──
// `credentialId` targets one passkey; `allowCredentials` offers a set; BOTH empty ⇒ a usernameless
// (discoverable-credential) prompt where the authenticator itself lists this origin's identities —
// the operator proves possession of a key without ever naming it (Law L1). The returned
// `credentialId` (the passkey the operator actually verified) is what the caller maps to a κ.
//
// `challenge` (optional Uint8Array): for a STEP-UP, pass sha256(canon(action)) so the authenticator's
// assertion signature COMMITS to the action (payload-bound consent, holo-stepup). Omit it for a plain
// unlock and a fresh random challenge is used. The raw assertion bytes (clientDataJSON,
// authenticatorData, signature — all base64url) are returned so the caller can carry the second,
// authenticator-signed axis; the PRF `secret` is returned exactly as before (unlock path unchanged).
export async function teeAssert({ credentialId, allowCredentials, challenge } = {}) {
  if (!teeSupported()) throw new Error("WebAuthn unavailable");
  const ids = (allowCredentials && allowCredentials.length) ? allowCredentials : (credentialId ? [credentialId] : []);
  const ch = (challenge && challenge.byteLength) ? new Uint8Array(challenge) : rand(32);
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: ch,
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
  const resp = assertion.response || {};
  return {
    secret: b64u(secret), credentialId: b64u(assertion.rawId),
    // raw assertion (base64url) — the second axis for holo-stepup; harmless to ignore on the unlock path.
    clientDataJSON: resp.clientDataJSON ? b64u(resp.clientDataJSON) : null,
    authenticatorData: resp.authenticatorData ? b64u(resp.authenticatorData) : null,
    signature: resp.signature ? b64u(resp.signature) : null,
  };
}
