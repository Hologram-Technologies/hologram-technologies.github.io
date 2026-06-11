// holo-login.mjs — Holo Login: the greeter's canonical sovereign identity, UNIFIED with the wallet.
//
// One BIP-39 seed (Tether WDK, vendored + audited — NO new crypto here) PROJECTS to everything:
//   • the operator's signing identity — SLIP-0010 Ed25519 → did:key, the SAME key Holo Wallet /
//     Holo Privacy / Holo Terms use;
//   • an omni-chain wallet (every chain's address derives from the seed);
//   • a content-addressed UOR vault — the encrypted seed (Law L1/L5).
// The greeter signs sessions with a principal derived from this seed, so login === wallet ===
// privacy === ONE identity. The seed/HD/vault crypto is WDK; the session + addressing is the
// existing holo-identity. This module is the WIRING, not new cryptography.
//
// The principal's κ is the CONTENT ADDRESS of its pubkey (did:holo:sha256 — Law L1, the law-canonical
// identity the session layer + verifySession already use), and it carries the W3C did:key projection
// of the SAME key. Two standard names, one seed. L4 (web platform + vendored audited crypto, no
// server), L5 (the seed κ re-derives identity + wallet + vault; unlock verifies by re-derivation).

import { identity, createVault, openVault, vaultKappa, generateMnemonic, validateMnemonic, seedFromMnemonic, deriveAddress, CHAINS } from "./holo-wdk.js";
import { addressOf } from "./holo-identity.mjs";

const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;
const te = new TextEncoder();
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));

// The vault passkey must be ≥12 chars (WDK) — normalise ANY secret (a biometric PRF output, or a
// typed passphrase) to a stable 44-char key. The vault's PBKDF2 supplies the work factor.
async function vaultKey(secret) { return b64(await SUB.digest("SHA-256", te.encode(String(secret || "")))); }
function avatarFor(kappa) { const h = kappa.split(":").pop(); return { hue: parseInt(h.slice(0, 4), 16) % 360, glyph: h.slice(0, 2).toUpperCase() }; }

// principalFromSeed(seed, label) → the greeter's signing principal. Compatible AS-IS with
// holo-identity's openSession/verifySession (κ = did:holo:sha256(pub)); carries `did` (did:key) and
// the wallet address helpers. The Ed25519 private key lives only in memory (non-extractable).
export async function principalFromSeed(seed, label = "operator") {
  const id = identity(seed);                                          // { did, publicKeyRaw, pkcs8 }
  const priv = await SUB.importKey("pkcs8", id.pkcs8, { name: "Ed25519" }, false, ["sign"]);
  const kappa = await addressOf(id.publicKeyRaw);                     // did:holo:sha256 — Law L1 canonical
  return {
    kappa, did: id.did, label, alg: "Ed25519", pub: b64(id.publicKeyRaw),
    async sign(bytesOrStr) { const u8 = typeof bytesOrStr === "string" ? te.encode(bytesOrStr) : bytesOrStr; return b64(await SUB.sign({ name: "Ed25519" }, priv, u8)); },
    address(chain, index = 0) { return deriveAddress(chain, seed, index); },
    addresses(index = 0) { const o = {}; for (const c of Object.keys(CHAINS)) o[c] = deriveAddress(c, seed, index); return o; },
  };
}

function record(principal, vault, cred) {
  return { kappa: principal.kappa, did: principal.did, label: principal.label, alg: "Ed25519", pub: principal.pub,
    vault, vaultKappa: vaultKappa(vault), cred: cred || null, avatar: avatarFor(principal.kappa), createdAt: new Date().toISOString() };
}

// enroll — first run: mint a fresh seed → wallet + identity, wrap the seed in a content-addressed
// vault, persist. Returns the principal AND the 12-word recovery phrase (shown/sharded by the caller).
export async function enroll({ label = "operator", secret, cred } = {}) {
  const mnemonic = generateMnemonic(12);
  const vault = await createVault(mnemonic, await vaultKey(secret));
  const principal = await principalFromSeed(seedFromMnemonic(mnemonic), label);
  const rec = record(principal, vault, cred);
  // INVISIBLE first-run ceremony — self-issue the sovereign-knowledge claim set + open the social
  // graph (Holo ZK / Holo Privacy). Non-blocking: a hiccup here never blocks sign-in.
  try { const { firstRun } = await import("./holo-ceremony.mjs"); const c = await firstRun(principal); rec.knowledge = c.credential; rec.graph = c.graph; rec.sd = c.disclosures; } catch {}
  await store.put(rec);
  return { principal, mnemonic, did: principal.did, vaultLink: "holo://" + vaultKappa(vault).split(":").pop() };
}

// the operator's ceremony artefacts — { knowledge (signed claim credential), graph (social-graph log),
// disclosures (the PRIVATE salts+values, device-only) }. What Holo Privacy's gate() discloses from.
export async function ceremonyOf(kappa) {
  const r = await store.get(kappa);
  return r ? { knowledge: r.knowledge || null, graph: r.graph || null, disclosures: r.sd || null } : null;
}

// unlock — returning: open this operator's vault with the biometric/passphrase secret, re-derive.
export async function unlock(kappa, secret) {
  const rec = await store.get(kappa);
  if (!rec) throw new Error("no such operator on this device");
  const { seed } = openVault(rec.vault, await vaultKey(secret));      // throws on the wrong secret (AEAD)
  const principal = await principalFromSeed(seed, rec.label);
  if (principal.kappa !== kappa) throw new Error("identity failed re-derivation (Law L5)");
  return principal;
}

// recover — on a new device, from the 12-word phrase → the SAME canonical identity + wallet.
export async function recover({ mnemonic, secret, label = "operator", cred } = {}) {
  if (!validateMnemonic(mnemonic)) throw new Error("invalid recovery phrase");
  const vault = await createVault(mnemonic, await vaultKey(secret));
  const principal = await principalFromSeed(seedFromMnemonic(mnemonic), label);
  await store.put(record(principal, vault, cred));
  return { principal, did: principal.did, vaultLink: "holo://" + vaultKappa(vault).split(":").pop() };
}

// revealMnemonic — the 12-word recovery phrase for backup. Requires the unlock secret (a fresh
// biometric / passphrase) — an open session is NOT enough to surface the phrase (Law L1: the key).
export async function revealMnemonic(kappa, secret) {
  const rec = await store.get(kappa);
  if (!rec) throw new Error("no such operator on this device");
  return openVault(rec.vault, await vaultKey(secret)).mnemonic;       // throws on the wrong secret (AEAD)
}
// backed-up flag — drives the deferrable "secure your account" nudge (don't nag once they've saved it).
export async function isBackedUp(kappa) { const r = await store.get(kappa); return !!(r && r.backedUp); }
export async function markBackedUp(kappa, val = true) { const r = await store.get(kappa); if (r) { r.backedUp = !!val; await store.put(r); } }

// unlockSeed — open this operator's vault and return the raw 64-byte BIP-39 seed, so the Holo Wallet
// app can boot the SAME wallet (HoloWallet.openSeed) with no second vault: one unlock, one identity.
export async function unlockSeed(kappa, secret) {
  const rec = await store.get(kappa);
  if (!rec) throw new Error("no such operator on this device");
  return openVault(rec.vault, await vaultKey(secret)).seed;            // throws on the wrong secret (AEAD)
}

// currentOperator — who is signed in on this device: the session's operator if present (skip guests,
// who are non-persistent and walletless), else the device's primary operator. Drives "your wallet
// just opens" — the wallet app unlocks THIS operator's unified vault by biometric.
export async function currentOperator() {
  let kappa = null;
  try { const t = JSON.parse((typeof sessionStorage !== "undefined" && sessionStorage.getItem("holo.session")) || "null"); if (t && t.operator && !t.guest) kappa = t.operator; } catch {}
  const ops = await roster();
  return (kappa && ops.find((o) => o.kappa === kappa)) || ops[0] || null;
}

export async function roster() {
  return (await store.all()).map((r) => ({ kappa: r.kappa, did: r.did, label: r.label, alg: r.alg, cred: r.cred || null, avatar: r.avatar || avatarFor(r.kappa), createdAt: r.createdAt }));
}
export async function forget(kappa) { return store.del(kappa); }
// attach the WebAuthn credential id to an operator after a biometric is enrolled for it
export async function attachCred(kappa, cred) { const r = await store.get(kappa); if (r) { r.cred = cred; await store.put(r); } }

// ── persistence — IndexedDB (browser), in-memory under Node (the witness) ──
const hasIDB = typeof indexedDB !== "undefined";
const mem = new Map();
const DB = "holo-login", OS = "operators";
function openDB() { return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(OS, { keyPath: "kappa" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idb(mode, fn) { const db = await openDB(); return new Promise((res, rej) => { const req = fn(db.transaction(OS, mode).objectStore(OS)); req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }
async function idbAll() { const db = await openDB(); return new Promise((res, rej) => { const out = []; const tx = db.transaction(OS, "readonly"); tx.objectStore(OS).openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { out.push(c.value); c.continue(); } else res(out); }; tx.onerror = () => rej(tx.error); }); }
const store = {
  async put(rec) { if (hasIDB) { await idb("readwrite", (s) => s.put(rec)); return; } mem.set(rec.kappa, rec); },
  async get(k) { if (hasIDB) return idb("readonly", (s) => s.get(k)); return mem.get(k) || null; },
  async all() { if (hasIDB) return idbAll(); return [...mem.values()]; },
  async del(k) { if (hasIDB) { await idb("readwrite", (s) => s.delete(k)); return; } mem.delete(k); },
};
