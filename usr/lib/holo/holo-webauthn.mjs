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
// The native Hologram host (CEF/Tauri) serves the OS over the first-party `holo://` κ-scheme — a secure,
// registered origin whose PLATFORM authenticator (Windows Hello / Touch ID / Secure Enclave) is reachable
// exactly as on an https page (measured: navigator.credentials.create invokes the real OS biometric
// ceremony over holo://). Its host label (e.g. "os") is single-label by design, which the dotted-domain
// rule below would otherwise reject — so on the κ-scheme we treat the origin as a valid relying party and
// OFFER the on-device TEE, instead of falling back to phone/guest. On the web (https) nothing changes.
function nativeHost() { return typeof location !== "undefined" && location.protocol === "holo:"; }
function rpIdValid() {
  if (nativeHost()) return true;                               // κ-scheme is a verified first-party RP
  const h = host();
  if (h === "localhost") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;          // IPv4 literal
  if (h.includes(":")) return false;                            // IPv6 literal
  return h.includes(".");                                       // a real domain (has a dot)
}

// ── localhost WebAuthn broker (native κ-scheme only) ─────────────────────────────────────────────
// Under holo://os the RP ID is "os" — a single-label id Chromium's WebAuthn REJECTS, so navigator.credentials
// .{create,get} fail there (this is why "Sign in" did nothing). The ceremony therefore runs in a hidden iframe
// served from http://localhost (rpId "localhost" is valid + a secure context); we drive it by postMessage and
// receive the FULL teeEnroll/teeAssert result (all base64url, JSON-safe). The PRF secret + private key never
// leave the device. teeEnroll/teeAssert auto-route here when location.protocol === "holo:" — so the greeter's
// firstRun()/unlockDevice() and the shell's step-up all work through the SAME path, with no caller changes.
const BROKER_URL = () => (globalThis.__holoBrokerUrl || "http://localhost:8495/usr/share/frame/stepup-broker.html");
let _brokerFrame = null, _brokerReq = 0;
function brokerFrame() {
  if (_brokerFrame) return _brokerFrame;
  _brokerFrame = new Promise((resolve, reject) => {
    let f; try { f = document.createElement("iframe"); } catch (e) { return reject(e); }
    f.setAttribute("aria-hidden", "true");
    // CRITICAL: a cross-origin iframe may not call navigator.credentials.{create,get} unless the parent
    // DELEGATES the WebAuthn Permissions-Policy features to it. Without this the OS biometric prompt never
    // appears (the ceremony hangs). Delegate both to the broker's exact origin.
    try { const bo = new URL(BROKER_URL()).origin; f.setAttribute("allow", "publickey-credentials-create " + bo + "; publickey-credentials-get " + bo); } catch (e) {}
    f.style.cssText = "position:fixed;width:1px;height:1px;border:0;left:-9999px;top:-9999px";
    const onReady = (e) => { if (e.source === f.contentWindow && e.data && e.data.__holoBroker && e.data.ready) { window.removeEventListener("message", onReady); resolve(f); } };
    window.addEventListener("message", onReady);
    f.addEventListener("error", () => { window.removeEventListener("message", onReady); reject(new Error("biometric broker iframe failed to load")); });
    document.body.appendChild(f); f.src = BROKER_URL();
    setTimeout(() => { window.removeEventListener("message", onReady); reject(new Error("biometric broker not reachable (is the localhost broker server up?)")); }, 12000);
  });
  _brokerFrame.catch(() => { _brokerFrame = null; });            // allow retry if the broker wasn't up yet
  return _brokerFrame;
}
async function brokerCall(op, params) {
  const f = await brokerFrame();
  const origin = new URL(BROKER_URL()).origin;
  return new Promise((resolve, reject) => {
    const id = "w" + (++_brokerReq);
    const onMsg = (e) => { if (e.source !== f.contentWindow) return; const m = e.data; if (!m || !m.__holoBroker || m.id !== id) return; window.removeEventListener("message", onMsg); if (m.ok) { const { __holoBroker, id: _i, ok, ...rest } = m; resolve(rest); } else reject(new Error(m.err || "broker denied")); };
    window.addEventListener("message", onMsg);
    f.contentWindow.postMessage(Object.assign({ __holoBrokerReq: 1, id, op }, params), origin);
    setTimeout(() => { window.removeEventListener("message", onMsg); reject(new Error("biometric broker request timeout")); }, 60000);
  });
}

// ── NATIVE platform authenticator (preferred) ────────────────────────────────────────────────────
// On the native host the C++ runs the OS biometric (Windows Hello / Touch ID) DIRECTLY via webauthn.dll
// over the `holo:hello:` cefQuery — the real dialog, no iframe, no localhost, no permission prompt. This
// is the fast, clean path; the localhost broker is only the fallback for hosts without the native verb.
const RP_ID_NATIVE = "hologram.os";
function nativeHello() { return typeof window !== "undefined" && typeof window.cefQuery === "function" && nativeHost(); }
function helloCall(op, params = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    // SETTLE GUARD (defense-in-depth): the native ceremony runs the OS dialog on a worker thread and ALWAYS
    // calls back — UNLESS that callback is lost (e.g. the page navigates/reloads while the worker is still
    // blocked, tearing down the message-router callback). cefQuery has no client-side timeout, so a lost
    // callback would leave this Promise pending FOREVER ("Verifying with Windows Hello…" hangs). 90s is safely
    // past the ceremony's own 60s WebAuthN timeout, so a legitimate (even slow) prompt resolves first; this only
    // ever fires on a genuinely lost callback, turning an infinite spinner into a catchable, recoverable error.
    const t = setTimeout(() => { if (done) return; done = true; reject(new Error("biometric timed out — no response from " + teeName())); }, 90000);
    const settle = (fn) => (...a) => { if (done) return; done = true; clearTimeout(t); fn(...a); };
    const ok = settle(resolve), no = settle(reject);
    try {
      window.cefQuery({
        request: "holo:hello:" + JSON.stringify({ op, ...params }),
        persistent: false,
        onSuccess: (r) => { try { const j = JSON.parse(r); j && j.ok === false ? no(new Error(j.error || "biometric failed")) : ok(j); } catch (e) { no(e); } },
        onFailure: (code, msg) => { no(new Error(msg || ("biometric error " + code))); },
      });
    } catch (e) { no(e); }
  });
}
function secureOk() { return typeof window === "undefined" ? false : (window.isSecureContext === true); }

// Why a biometric prompt is not available right now — drives the greeter's fallback messaging.
// Returns "" when biometrics ARE available. Async because it probes the platform authenticator.
export async function teeReason() {
  if (nativeHello()) return "";                                   // the native host runs the OS biometric directly — always available
  if (!teeSupported()) return "This browser has no WebAuthn / passkey support";
  if (!secureOk()) return "Biometrics need a secure page (https or localhost)";
  if (!rpIdValid()) return "Open this on https or localhost (not an IP) for biometrics";
  // isUserVerifyingPlatformAuthenticatorAvailable() can hang or be unimplemented over the native κ-scheme,
  // so bound it. A DEFINITIVE false means no biometric is enrolled → say so (web and native alike). But a
  // timeout/error is NOT proof of absence on the native host (the platform ceremony is reachable there
  // regardless), so assume available and let the real biometric prompt be the source of truth.
  let uvpa;
  try {
    uvpa = await Promise.race([
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
      new Promise((res) => setTimeout(() => res(nativeHost() ? true : "timeout"), 1500)),
    ]);
  } catch { uvpa = nativeHost() ? true : "error"; }
  if (uvpa === false) return "No device biometric is set up (Face ID / Touch ID / Windows Hello / fingerprint)";
  if (uvpa !== true && !nativeHost()) return "Could not query the device authenticator";
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
export async function teeEnroll(args = {}) {
  if (nativeHello()) return helloCall("enroll", { name: args.name, rpId: RP_ID_NATIVE });      // native OS dialog (no iframe)
  if (nativeHost()) return brokerCall("enroll", { name: args.name, userId: args.userId });     // holo:// → localhost fallback
  return _teeEnrollDirect(args);
}
async function _teeEnrollDirect({ name, userId } = {}) {
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
export async function teeAssert(args = {}) {
  const challengeB64 = args.challenge && args.challenge.byteLength ? b64u(args.challenge) : undefined;
  if (nativeHello()) { const cid = args.credentialId || (args.allowCredentials && args.allowCredentials[0]) || ""; return helloCall("assert", { credentialId: cid, rpId: RP_ID_NATIVE, challenge: challengeB64 }); }
  if (nativeHost()) return brokerCall("assert", { credentialId: args.credentialId, allowCredentials: args.allowCredentials, challenge: challengeB64 });
  return _teeAssertDirect(args);
}
async function _teeAssertDirect({ credentialId, allowCredentials, challenge } = {}) {
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
