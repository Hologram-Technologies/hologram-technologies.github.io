// holo-vault-sync.mjs — post-quantum, end-to-end-encrypted vault sync across the operator's devices.
//
// Move Holo Pass credentials to another device of the same operator (or share to a recipient) WITHOUT a
// plaintext server: the live credential set is sealed under a fresh key wrapped to the recipient's HYBRID
// public key via X25519 ‖ ML-KEM-1024 (holo-pqc.hybridEncaps — a break in EITHER family is not a break,
// so it is harvest-now-decrypt-later resistant). The relay forwards only opaque ciphertext (SEC-7,
// content-blind); the recipient decapsulates with its hybrid secret and merges into its own vault. No new
// crypto — the KEM + AEAD are the vendored, audited holo-pqc primitives. Law L4 (one substrate path).
//
// Pairing model: each device holds a hybrid KEM keypair (kemKeygen); pairing exchanges public keys (the
// existing phone-pairing flow carries the recipient pub). Same-operator devices share the sovereign
// identity, so a synced credential re-derives identically; the package itself is bound to the recipient.

import { kemKeygen, hybridEncaps, hybridDecaps, aeadSeal, aeadOpen } from "./holo-pqc.mjs";

const te = new TextEncoder();
const td = new TextDecoder();
const AAD = te.encode("holo-vault/sync/v1");

// a per-device recipient identity for sync: hybrid X25519+ML-KEM-1024 keypair. Persist `sk` device-local
// (sealed by the device cipher in production); share `pub` during pairing.
export function newSyncIdentity() { return kemKeygen(); }   // { scheme, sk:{x,pq}, pub:{x,pq} }

// seal a credential set TO a recipient's hybrid public key (PQ + classical). Returns an opaque package
// (KEM ciphertext + AEAD blob) safe to hand a content-blind relay — it reveals no origin or secret.
export async function sealForRecipient(creds, recipientPub) {
  const { ct, ss } = hybridEncaps(recipientPub);                       // ss = SHA-256(x25519_dh ‖ mlkem_ss ‖ scheme)
  const sealed = await aeadSeal(ss, te.encode(JSON.stringify(creds)), AAD);
  return { v: 1, scheme: "holo-vault/sync/hybrid-kem", ct, sealed };
}

// open a sync package with the recipient's hybrid SECRET. Fail-closed (AEAD throws on tamper/wrong key).
export async function openPackage(pkg, recipientSk) {
  if (!pkg || !pkg.ct || !pkg.sealed) throw new Error("sync: malformed package");
  const ss = hybridDecaps(recipientSk, pkg.ct);
  const pt = await aeadOpen(ss, pkg.sealed, AAD);                       // throws if ss wrong or bytes tampered
  return JSON.parse(td.decode(pt));
}

// ── vault-level convenience: export the live set from an unlocked handle, import into one. ──
function liveCreds(handle) {
  return handle.list().map((m) => { const e = handle.get(m.id); return { origin: e.origin, kind: e.kind, username: e.username, label: e.label, secret: e.secret }; });
}
// EXPORT: from an unlocked vault handle → an opaque package wrapped to the recipient device's pub.
export async function exportVault(handle, recipientPub) { return sealForRecipient(liveCreds(handle), recipientPub); }
// IMPORT: open the package with this device's sync secret and MERGE into the unlocked vault (put each).
export async function importVault(handle, pkg, recipientSk) {
  const creds = await openPackage(pkg, recipientSk);
  let n = 0; for (const c of creds) { if (c && c.origin) { await handle.put(c); n++; } }
  return n;
}
