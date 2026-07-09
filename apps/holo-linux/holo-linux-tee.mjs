// holo-linux-tee.mjs — device-biometric unlock for the sovereign machine (WebAuthn PRF).
//
// Returns a secret gated by the platform authenticator (Touch ID / Windows Hello / the native
// holo:hello ceremony in CEF) — one biometric. The worker HKDFs it into the AES-GCM seal key, so the
// saved machine is bound to your biometric on this device. The secret NEVER persists (re-derived per
// unlock). When there is no platform authenticator (e.g. a headless/plain context), unlock returns
// null and the caller falls back to the soft, device-local key — boot is never blocked.
//
// TWO entry points, deliberately separate:
//   • teeUnlock(id) — GET only. Prompts for one biometric ONLY if this machine is already sovereign
//     (a resident credential exists). A brand-new machine returns null with NO prompt → soft tier.
//     This is what boot calls, so a first-time user is never ambushed by a Windows Hello dialog.
//   • teeEnroll(id) — the explicit "make this machine sovereign" action. Creates the resident
//     credential (one biometric) and derives the PRF secret, falling back to a second assertion only
//     on platforms that don't return PRF straight from create(). Behind a user gesture, by design.
const LS_CRED = (id) => "holoLinuxCred:" + id;     // per-machine resident credential id (b64url)
const RP = { name: "Holo Linux" };                 // rpId defaults to the page origin (localhost on the broker)
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const PRF_SALT = new TextEncoder().encode("holo-linux/machine/prf/v1");

export async function teeAvailable() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
  catch (_) { return false; }
}

// True once this machine has a resident credential = it is sovereign (sealed to the biometric). Boot uses
// this to decide whether to prompt at all. No crypto, no prompt — just the local marker.
export function isSovereign(id) { return !!localStorage.getItem(LS_CRED(id)); }

// One biometric assertion → the per-machine PRF secret (ArrayBuffer), or null if the authenticator has no
// PRF/hmac-secret. Shared by unlock + enroll's fallback.
async function getPrf(rawId) {
  const assertion = await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    allowCredentials: [{ id: rawId, type: "public-key" }],
    userVerification: "required",
    extensions: { prf: { eval: { first: PRF_SALT } } },
  } });
  const res = assertion && assertion.getClientExtensionResults && assertion.getClientExtensionResults();
  return (res && res.prf && res.prf.results && res.prf.results.first) || null;
}

// GET-ONLY unlock. Returns the PRF secret if this machine is sovereign, else null (→ soft tier, NO prompt).
// Never enrolls — a new machine boots straight to soft without a biometric dialog.
export async function teeUnlock(id) {
  try {
    if (!(await teeAvailable())) return null;
    const stored = localStorage.getItem(LS_CRED(id));
    if (!stored) return null;                       // not sovereign yet → soft, no prompt
    return await getPrf(fromB64u(stored)) || null;
  } catch (_) { return null; }                      // cancelled / unsupported → soft fallback (never breaks boot)
}

// Explicit "make this machine sovereign": enroll a platform resident credential, derive the PRF secret.
// One biometric on platforms that return PRF from create(); two on those that don't (the create, then a
// single assertion). Returns the secret, or null if the authenticator can't do PRF (caller stays soft and
// must NOT treat the machine as sovereign — we roll the credential marker back so isSovereign stays false).
export async function teeEnroll(id) {
  try {
    if (!(await teeAvailable())) return null;
    const cred = await navigator.credentials.create({ publicKey: {
      rp: RP,
      user: { id: new TextEncoder().encode("holo-linux:" + id), name: "holo-linux/" + id, displayName: "Holo Linux machine" },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
      extensions: { prf: { eval: { first: PRF_SALT } } },
    } });
    if (!cred) return null;
    localStorage.setItem(LS_CRED(id), b64u(cred.rawId));
    // Fast path: some authenticators (incl. recent Windows Hello) return PRF straight from create — one prompt.
    const cr = cred.getClientExtensionResults && cred.getClientExtensionResults();
    let prf = (cr && cr.prf && cr.prf.results && cr.prf.results.first) || null;
    if (!prf) prf = await getPrf(fromB64u(localStorage.getItem(LS_CRED(id))));   // second prompt only if needed
    if (!prf) { localStorage.removeItem(LS_CRED(id)); return null; }             // no PRF → roll back; stay soft
    return prf;
  } catch (_) { localStorage.removeItem(LS_CRED(id)); return null; }             // cancelled → roll back; stay soft
}
