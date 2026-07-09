// holo-grant.mjs — the SINGLE canonical issuer for operator authorizations over the mesh substrate.
//
// Everything is rooted in the ONE TEE authorization. The operator's sovereign key is released ONLY through the
// canonical gate — the LOGIN ceremony (session-scoped: authorizing your OWN device's mesh node) or holo-stepup
// (a deliberate SHARE to another did:holo) — NEVER stored, NEVER a parallel secret. Both authorizations are
// signed in the EXACT bytes the native node verifies (handshake.rs / capability.rs), so the JS issuance and the
// Rust verification are one substrate. Mirrors holo-delegate.mjs::mintPassport — the existing step-up-rooted
// delegation pattern — so authority transfer has ONE chokepoint, not two.

/** base64 → lowercase hex (the wire form the native node parses). */
function hexOfB64(b64) {
  const s = atob(b64);
  let h = "";
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(2, "0");
  return h;
}

/**
 * MESH DELEGATION — authorize THIS device's mesh node to serve as the operator. Session-scoped: it rides the
 * LOGIN ceremony (the principal is already unlocked by the login biometric — the canonical TEE authorization),
 * so it asks for NO second prompt. Signs the exact message hologram-net-bare's handshake verifies:
 *   "holo-mesh-delegation\n<opDid>\n<meshPubHex>"  →  line: opDid \t opPubHex \t meshPubHex \t sigHex
 */
export async function issueMeshDelegation(principal, opDid, meshPubHex) {
  const sig = await principal.sign("holo-mesh-delegation\n" + opDid + "\n" + meshPubHex);
  return opDid + "\t" + hexOfB64(principal.pub) + "\t" + meshPubHex + "\t" + hexOfB64(sig);
}

/**
 * CAPABILITY GRANT — authorize ANOTHER did:holo to fetch a SENSITIVE κ (a specific κ hex, or "*"). A deliberate
 * SHARE, so it routes through the canonical TEE gate holo-stepup (kind "capability.grant" ∈ AUTHORITY): ONE
 * biometric attests the share AND releases the signer (exposeSecret), the SAME one-tap pattern as mintPassport.
 * Signs "holo-capability\n<owner>\n<holder>\n<resource>" — the exact bytes capability.rs::verify_grant checks.
 * Returns { line, stepup }: the grant the node verifies + its step-up token (dual-rooted: substrate κ + TEE).
 */
export async function grantCapability(operator, subjectDid, resource, { credentialId, reason } = {}) {
  const { requireStepUp } = await import("./holo-stepup.mjs");
  const { unlock } = await import("./holo-login.mjs");
  const { token, secret } = await requireStepUp(
    {
      kind: "capability.grant",
      payload: { subject: subjectDid, resource },
      appId: "org.hologram.HoloShare",
      operator,
      reason: reason || "Share access with " + String(subjectDid).slice(0, 28) + "…",
    },
    { credentialId, exposeSecret: true } // ONE biometric: attest the share AND release the signer
  );
  const principal = await unlock(operator, secret); // sovereign signer re-derived from the SAME TEE ceremony
  const sig = await principal.sign("holo-capability\n" + operator + "\n" + subjectDid + "\n" + resource);
  const line = operator + "\t" + hexOfB64(principal.pub) + "\t" + subjectDid + "\t" + resource + "\t" + hexOfB64(sig);
  return { line, stepup: token };
}

// ── transmit: turn a grant into a link the holder opens ───────────────────────────────────────────────────────
// A grant is just bytes — it travels IN the share link, no server. The holder's node presents it on fetch
// (gated-get), so the serving node releases the gated κ only to that holder. base64url so it survives a URL.

function b64urlOfLine(line) {
  // line is ASCII (hex ‖ did ‖ did ‖ resource ‖ hex, tab-separated) → btoa is safe; make it URL-clean.
  return btoa(line).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function lineOfB64url(s) {
  let b = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  return atob(b);
}

/** PURE: compose the holder's share link from an already-issued grant. Factored out so it is testable without
 *  the TEE. `base` defaults to the in-OS holospace surface that verifies-before-mount. */
export function buildGatedLink(line, kappa, holderDid, base = "holo://os/holospace.html") {
  const q = "gk=" + encodeURIComponent(kappa) + "&to=" + encodeURIComponent(holderDid) + "&grant=" + b64urlOfLine(line);
  return base + (base.includes("?") ? "&" : "?") + q;
}

/** The holder side: recover { kappa, holder, grantLine } from a share link (or null if it carries no grant). */
export function parseGatedShare(link) {
  let qs;
  try {
    qs = new URL(link).searchParams;
  } catch {
    const i = String(link).indexOf("?");
    qs = new URLSearchParams(i >= 0 ? String(link).slice(i + 1) : String(link));
  }
  const grant = qs.get("grant");
  if (!grant) return null;
  return { kappa: qs.get("gk") || "", holder: qs.get("to") || "", grantLine: lineOfB64url(grant) };
}

/** THE SHARE ACTION — what a "Share (gated)" button calls. ONE biometric (via grantCapability → holo-stepup)
 *  authorizes the share AND signs the grant; returns a link to hand the holder + the step-up token. No second
 *  prompt, no stored key, no server. */
export async function shareGatedLink(operator, holderDid, kappa, { credentialId, reason, base } = {}) {
  const { line, stepup } = await grantCapability(operator, holderDid, kappa, { credentialId, reason });
  return { link: buildGatedLink(line, kappa, holderDid, base), stepup };
}
