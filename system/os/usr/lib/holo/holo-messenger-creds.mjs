// holo-messenger-creds.mjs — LOG IN ONCE, EVERY PLATFORM. Per-platform session continuity stored in
// the canonical TEE-gated credential vault (holo-vault / Holo Pass), so one biometric unlocks every
// messenger at once — no per-app login, no master password, no server.
//
// A linked platform is a vault entry: origin = holo-messenger://<adapter id>, kind = "note" (an opaque
// session blob — NOT autofilled into arbitrary web pages, unlike password/web3 kinds), username = the
// account handle, secret = the session continuity. Everything that makes this safe is the vault's, not
// ours: the at-rest chain is opaque (no cleartext origin/secret — SEC-5), operator-signed + hash-linked
// (SEC-1/4, drop/reorder fail-closed), AEAD-sealed under a per-vault epoch key with forward-secrecy
// rotation (§2.8), and revealing a secret is a payload-bound TEE step-up (SEC-2 consent). This module
// only NAMES platforms in that vault.
//
// Pure assembly over an open vault handle (holo-vault.openVault) — Node-witnessable with the canonical
// holo-login identity stack. No new crypto, no new store.
//
// Authority: holo-vault (Holo Pass) · holo-stepup (reveal gate) · holo-apps §2.8/§2.9 · SEC-1/2/4/5.

const PREFIX = "holo-messenger://";

export const platformOrigin = (adapterId) => PREFIX + String(adapterId);
const idFromOrigin = (origin) => String(origin).slice(PREFIX.length);
const tryParse = (s) => { try { return JSON.parse(s); } catch { return s; } };

// linkPlatform(vault, adapter, { account, session, label }) — connect a platform: seal its session
// continuity into the vault. Idempotent per (origin) — a re-link updates the latest event.
export async function linkPlatform(vault, adapter, { account = null, session = null, label = null } = {}) {
  if (!vault || !adapter || !adapter.id) throw new Error("creds: vault + adapter required");
  return vault.put({
    origin: platformOrigin(adapter.id),
    kind: "note",                                          // opaque session blob; never page-autofilled
    username: account,
    secret: typeof session === "string" ? session : JSON.stringify(session || {}),
    label: label || adapter.label || adapter.id,
  });
}

// linkedPlatforms(vault) → metadata for every connected platform (NO secret). The inbox shows these as
// the platforms you're signed into.
export function linkedPlatforms(vault) {
  return (vault.list() || [])
    .filter((e) => String(e.origin).startsWith(PREFIX))
    .map((e) => ({ id: idFromOrigin(e.origin), label: e.label, account: e.username, updatedAt: e.updatedAt }));
}

// platformLinked(vault, adapterId) → boolean.
export const platformLinked = (vault, adapterId) => !!(vault.get(platformOrigin(adapterId)));

// platformSession(vault, adapterId) → the in-session session continuity (warm session), or null. Plaintext
// lives only in the unlocked in-memory projection (the vault never persists it in cleartext).
export function platformSession(vault, adapterId) {
  const e = vault.get(platformOrigin(adapterId));
  return e ? tryParse(e.secret) : null;
}

// unlinkPlatform(vault, adapterId) — disconnect (tombstone the entry).
export const unlinkPlatform = (vault, adapterId) => vault.remove(platformOrigin(adapterId));

// revealPlatformSession(vault, adapterId, { credentialId }) — surface the raw session TO THE HUMAN
// (export/debug): consent-bearing → payload-bound TEE step-up, fail-closed (throws if denied / no TEE).
export const revealPlatformSession = (vault, adapterId, opts = {}) => vault.revealSecret(platformOrigin(adapterId), opts);

if (typeof window !== "undefined" && !window.HoloMessengerCreds) {
  window.HoloMessengerCreds = { platformOrigin, linkPlatform, linkedPlatforms, platformLinked, platformSession, unlinkPlatform, revealPlatformSession };
}
