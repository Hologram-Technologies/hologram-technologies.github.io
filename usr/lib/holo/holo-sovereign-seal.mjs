// holo-sovereign-seal.mjs — SOVEREIGNTY P3: carry your world as a single sealed κ you own. Your world (the
// holo* keys — identity, settings, session, preferences) is canonicalized (Law L2), sealed under a key only
// YOU hold (AES-256-GCM, PBKDF2 from your passphrase), and labelled by the BLAKE3 κ of the sealed bytes — a
// self-verifying backup that re-derives (Law L5). No server holds it; only your key opens it. unseal(seal(x))===x.
//
// The seal key is SEPARATE from the world it seals (you can't be inside your own lock) — the passphrase/recovery
// key is what you keep. Binding it to your passkey/identity is the P0 integration; here the key is a parameter.
//
//   seal(state, passphrase) → { kappa, envelope }        open(envelope, passphrase, kappa?) → state
//   carry(passphrase[, store]) → { kappa, envelope }     restore({envelope,kappa}, passphrase[, store]) → n
import { jcs } from "./holo-object.mjs";
import { blake3hex } from "./holo-blake3.mjs";

const te = new TextEncoder(), td = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const b64 = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64d = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const KDF_ITERS = 210000;

async function deriveKey(passphrase, salt) {
  const base = await subtle().importKey("raw", te.encode(String(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", salt, iterations: KDF_ITERS, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// seal your world → a sealed, self-verifying backup κ. Only the passphrase holder can open it.
export async function seal(state, passphrase) {
  if (!passphrase) throw new Error("sovereign seal: a key (passphrase) is required");
  const plain = te.encode(jcs(state));                                 // canonical bytes (L2 — same world → same κ)
  const salt = rand(16), iv = rand(12);
  const key = await deriveKey(passphrase, salt);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, plain));
  const envelope = { v: 1, alg: "AES-256-GCM", kdf: `PBKDF2-SHA256-${KDF_ITERS}`, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  return { kappa: "blake3:" + blake3hex(te.encode(jcs(envelope))), envelope };
}

// open a sealed backup → your world. Re-derives the κ (L5) then decrypts; wrong key or tamper is REFUSED.
export async function open(envelope, passphrase, kappa = null) {
  if (kappa && ("blake3:" + blake3hex(te.encode(jcs(envelope)))) !== kappa) throw new Error("sovereign backup did not re-derive to its κ — refused (L5)");
  const key = await deriveKey(passphrase, b64d(envelope.salt));
  let plain; try { plain = await subtle().decrypt({ name: "AES-GCM", iv: b64d(envelope.iv) }, key, b64d(envelope.ct)); }
  catch { throw new Error("sovereign backup refused: wrong key or tampered"); }
  return JSON.parse(td.decode(new Uint8Array(plain)));
}

// gather / apply the user's world (the holo* localStorage keys). Injectable store for witnessing.
const OWNED = (k) => /^holo/.test(k);
export function collectWorld(store = globalThis.localStorage) {
  const w = {}; for (let i = 0; i < store.length; i++) { const k = store.key(i); if (OWNED(k)) w[k] = store.getItem(k); } return w;
}
export function applyWorld(state, store = globalThis.localStorage) {
  let n = 0; for (const [k, v] of Object.entries(state || {})) if (OWNED(k)) { store.setItem(k, v); n++; } return n;
}

export async function carry(passphrase, store) { return seal(collectWorld(store), passphrase); }
export async function restore(backup, passphrase, store) { return applyWorld(await open(backup.envelope, passphrase, backup.kappa), store); }

// ── your world as a file you own ─────────────────────────────────────────────────────────────────────
export function backupToText(backup) { return JSON.stringify({ v: 1, kappa: backup.kappa, envelope: backup.envelope }); }
export function parseBackup(text) { const j = JSON.parse(text); if (!j || !j.envelope || !j.kappa) throw new Error("not a Hologram world backup"); return { kappa: j.kappa, envelope: j.envelope }; }

// download your sealed world as a .holo file — a backup only your key opens. Returns its κ.
export async function downloadBackup(passphrase, filename = "my-hologram-world.holo", store) {
  const backup = await carry(passphrase, store);
  const url = URL.createObjectURL(new Blob([backupToText(backup)], { type: "application/octet-stream" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return backup.kappa;
}
export async function restoreFromText(text, passphrase, store) { return restore(parseBackup(text), passphrase, store); }

// self-register the door when in a browser — window.HoloWorld.backup(passphrase) / .restoreText(text, pass)
try { if (typeof window !== "undefined") window.HoloWorld = Object.assign(window.HoloWorld || {}, { seal, open, carry, restore, backup: downloadBackup, restoreText: restoreFromText, backupToText, parseBackup, collectWorld }); } catch {}

export default { seal, open, collectWorld, applyWorld, carry, restore, backupToText, parseBackup, downloadBackup, restoreFromText };
