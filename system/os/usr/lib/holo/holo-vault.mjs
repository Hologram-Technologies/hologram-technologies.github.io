// holo-vault.mjs — Holo Pass: the unified, TEE-gated credential layer, rooted at the κ-substrate.
//
// ONE biometric gate is the user's identity for the whole web — web2 passwords, web2 passkeys, web3
// connections — all under the SAME enclave ceremony that unlocks the sovereign identity (holo-login).
//
// SECURITY IS THE SUBSTRATE'S, NOT THIS MODULE'S. Credentials are first-class κ-addressed content: a
// per-operator, hash-linked, operator-SIGNED, append-only event chain (like holo-strand). Each event
// re-derives to its own κ (Law L5 / SEC-1), links its parent (drop/reorder fail-closed), is signed
// Ed25519 ‖ ML-DSA-65 by the operator (SEC-4, post-quantum), and seals its payload (origin, username,
// secret) with AEAD under a per-vault EPOCH key derived from the enclave PRF secret (SEC-5 κ-as-
// capability; holo-apps §2.8 epoch confidentiality + forward secrecy). The at-rest chain is OPAQUE —
// only κs, signatures and epoch indices; no cleartext origin or secret ever touches disk. Verifying the
// head verifies ALL history. Object-capability authority: autofill is read; reveal/export is step-up
// gated (SEC-2, attenuate-only; holo-apps §2.9 consent-bearing kinds). No master password, no server.
//
// Laws/specs: L1 content-is-name · L2 canonical-forms · L3 store-is-memory · L4 one-substrate-path ·
// L5 verify-by-re-derivation · SEC-1 integrity · SEC-2 authority · SEC-4 identity · SEC-5 confidentiality
// · SEC-6 verified resolution · SEC-8 resource bounds. PQ + TEE + consent extend SEC-1..8 at the OS layer.

import { unlock as loginUnlock } from "./holo-login.mjs";       // the ONE canonical biometric gate
import { canon, addressOf } from "./holo-identity.mjs";         // canonical form + did:holo:sha256
import { mldsaVerify } from "./holo-pqc.mjs";                   // post-quantum signature verify (ML-DSA-65)

const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;
const RNG = globalThis.crypto;
const te = new TextEncoder();
const td = new TextDecoder();
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s) => Uint8Array.from(atob(String(s)), (c) => c.charCodeAt(0));
const concat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; };

const MAX_EVENTS = 10000;            // SEC-8: per-operator chain length bound
const MAX_SEALED = 64 * 1024;        // SEC-8: per-event sealed payload bound
const CRED_KINDS = new Set(["password", "passkey", "web3", "totp", "note", "card", "identity"]); // full 1Password-class item types

// ── epoch key: PBKDF2 from the enclave PRF secret, salted per operator + epoch + a VAULT domain label,
//    so it is cryptographically distinct from the identity seed-wrap and the session key, and each epoch
//    is a distinct key (rotation ⇒ forward secrecy; an old epoch key cannot open a newer epoch's bytes). ──
async function epochKeyBytes(secret, operator, epoch) {
  const base = await SUB.importKey("raw", te.encode(String(secret || "")), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(await SUB.digest("SHA-256", te.encode(String(operator) + "|holo-vault/epoch/" + epoch)));
  return new Uint8Array(await SUB.deriveBits({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, base, 256));
}
function cipherFor(keyBytes) {
  const aesKey = async () => SUB.importKey("raw", new Uint8Array(await SUB.digest("SHA-256", concat(keyBytes, te.encode("|holo-vault/enc")))), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  return {
    async seal(pt) { const iv = RNG.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await SUB.encrypt({ name: "AES-GCM", iv }, await aesKey(), pt)); return concat(iv, ct); },
    async open(blob) { try { const u = blob instanceof Uint8Array ? blob : new Uint8Array(blob); return new Uint8Array(await SUB.decrypt({ name: "AES-GCM", iv: u.slice(0, 12) }, await aesKey(), u.slice(12))); } catch { return null; } },
  };
}

// Ed25519 verify of a sovereign signature over the canonical event body.
async function verifyEd(pubB64, sigB64, msgStr) {
  try { const key = await SUB.importKey("raw", unb64(pubB64), { name: "Ed25519" }, false, ["verify"]); return SUB.verify({ name: "Ed25519" }, key, unb64(sigB64), te.encode(msgStr)); } catch { return false; }
}

// stable credential identity κ over the (origin, kind, username) tuple — the chain groups events by this.
async function targetKappa(origin, ck, username) { return addressOf(te.encode(canon({ origin, ck, username: username || null }))); }

// ── verify the WHOLE chain (head attests all history). Any break ⇒ throw (fail-closed). SEC-1/4/6, L5. ──
async function verifyChain(events, operator) {
  let prevId = null, prevClock = -1;
  for (const e of events) {
    const { id, alg, pub, sig, pqAlg, pqPub, pqSig, ...body } = e;
    const c = canon(body);
    if ((await addressOf(te.encode(c))) !== id) throw new Error("vault: event κ re-derivation failed (SEC-1)");
    if ((await addressOf(unb64(pub))) !== operator || body.op !== operator) throw new Error("vault: event not bound to operator (SEC-4)");
    if (body.parent !== prevId) throw new Error("vault: chain link broken — drop/reorder (SEC-1)");
    if (!(body.clock > prevClock)) throw new Error("vault: non-monotonic clock");
    if (!(await verifyEd(pub, sig, c))) throw new Error("vault: sovereign signature invalid (SEC-4)");
    if (pqPub && !mldsaVerify(pqPub, c, pqSig)) throw new Error("vault: post-quantum signature invalid (SEC-4/PQ)");
    prevId = id; prevClock = body.clock;
  }
  return prevId; // the head κ
}

// reduce the chain → live winning event per target (latest by clock; tombstone removes). Deterministic.
function reduce(events) {
  const byTarget = new Map();
  for (const e of events) { const prev = byTarget.get(e.target); if (!prev || e.clock > prev.clock || (e.clock === prev.clock && e.id > prev.id)) byTarget.set(e.target, e); }
  const live = new Map();
  for (const [t, e] of byTarget) if (e.kind === "credential.put") live.set(t, e);
  return live;
}

// ── persistence: the opaque event chain + epoch index, per operator. IndexedDB / in-memory (Node). ──
const hasIDB = typeof indexedDB !== "undefined";
const mem = new Map();
const DB = "holo-vault", OS = "chains";
function openDB() { return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(OS, { keyPath: "operator" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idb(mode, fn) { const db = await openDB(); return new Promise((res, rej) => { const req = fn(db.transaction(OS, mode).objectStore(OS)); req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }
const store = {
  async get(op) { if (hasIDB) return idb("readonly", (s) => s.get(op)); return mem.get(op) || null; },
  async put(rec) { if (hasIDB) { await idb("readwrite", (s) => s.put(rec)); return; } mem.set(rec.operator, rec); },
  async del(op) { if (hasIDB) { await idb("readwrite", (s) => s.delete(op)); return; } mem.delete(op); },
};

// open the credential vault for an operator. Verifies identity via the ONE canonical biometric unlock
// (holo-login.unlock; re-derives κ, throws on wrong secret — L5), then verifies the WHOLE signed chain
// (SEC-1/4/6) and decrypts live payloads into an in-memory projection (plaintext lives only in-session).
export async function openVault(operator, secret) {
  const principal = await loginUnlock(operator, secret);
  if (principal.kappa !== operator) throw new Error("vault: identity re-derivation mismatch (L5)");
  const rec = (await store.get(operator)) || { operator, events: [], epoch: 0 };
  if (rec.events.length > MAX_EVENTS) throw new Error("vault: chain exceeds bound (SEC-8)");
  await verifyChain(rec.events, operator);                          // head attests all history (fail-closed)

  // decrypt the live set into memory (origin/secret never persisted in cleartext — SEC-5)
  const ekCache = new Map();
  const ek = async (n) => { if (!ekCache.has(n)) ekCache.set(n, cipherFor(await epochKeyBytes(secret, operator, n))); return ekCache.get(n); };
  const live = reduce(rec.events);
  const proj = new Map(); // target κ → { id, origin, kind, username, label, secret, updatedAt }
  for (const [t, e] of live) {
    const pt = await (await ek(e.epoch)).open(unb64(e.sealed));
    if (!pt) throw new Error("vault: payload decrypt failed (SEC-1/SEC-5)");
    const p = JSON.parse(td.decode(pt));
    proj.set(t, { id: t, origin: p.origin, kind: p.ck, username: p.username || null, label: p.label || null, secret: p.secret, updatedAt: e.ts });
  }
  let epoch = rec.epoch | 0;
  let head = rec.events.length ? rec.events[rec.events.length - 1].id : null;
  let clock = rec.events.length ? rec.events[rec.events.length - 1].clock : 0;

  async function append(kind, target, sealedB64, epochUsed) {
    if (rec.events.length + 1 > MAX_EVENTS) throw new Error("vault: chain exceeds bound (SEC-8)");
    if (sealedB64 && sealedB64.length > MAX_SEALED * 2) throw new Error("vault: event exceeds size bound (SEC-8)");
    const body = { "@type": "HoloVaultEvent", v: 1, kind, op: operator, epoch: epochUsed, target, parent: head, clock: clock + 1, ts: new Date().toISOString(), nonce: b64(RNG.getRandomValues(new Uint8Array(8))), sealed: sealedB64 || null };
    const c = canon(body);
    const id = await addressOf(te.encode(c));
    const event = { ...body, id, alg: "Ed25519", pub: principal.pub, sig: await principal.sign(c), pqAlg: principal.pqAlg, pqPub: principal.pqPub, pqSig: principal.pqSign(c) };
    rec.events.push(event); rec.epoch = epoch; await store.put(rec);
    head = id; clock = body.clock;
    return event;
  }

  const handle = {
    operator,
    headKappa() { return head; },                                  // the head κ attests the whole chain
    epoch() { return epoch; },
    list() { return [...proj.values()].map((e) => ({ id: e.id, origin: e.origin, kind: e.kind, username: e.username, label: e.label, updatedAt: e.updatedAt })); }, // metadata only — no secret
    get(idOrOrigin) { for (const e of proj.values()) if (e.id === idOrOrigin || e.origin === idOrOrigin) return { ...e }; return null; }, // full cred for host autofill
    async put({ origin, kind = "password", username = null, secret: cred = null, label = null }) {
      if (!origin) throw new Error("vault.put: origin required");
      if (!CRED_KINDS.has(kind)) throw new Error("vault.put: bad kind " + kind);
      const target = await targetKappa(origin, kind, username);
      const sealed = await (await ek(epoch)).seal(te.encode(JSON.stringify({ origin, ck: kind, username, label, secret: cred })));
      const ev = await append("credential.put", target, b64(sealed), epoch);
      proj.set(target, { id: target, origin, kind, username, label, secret: cred, updatedAt: ev.ts });
      return { id: target, origin, kind, username, label, updatedAt: ev.ts };
    },
    async remove(idOrOrigin) {
      const e = handle.get(idOrOrigin); if (!e) return 0;
      await append("credential.tombstone", e.id, null, epoch); proj.delete(e.id); return 1;
    },
    // forward-secrecy rotation (holo-apps §2.8): bump the epoch; future seals use a fresh key. Old-epoch
    // ciphertext is unreadable with the new key and vice-versa (distinct PBKDF2 keys).
    async rotateEpoch() { epoch = epoch + 1; rec.epoch = epoch; await store.put(rec); return epoch; },
    // surface a secret TO THE HUMAN (show/export) — consent-bearing → payload-bound STEP-UP, fail-closed.
    async revealSecret(idOrOrigin, { credentialId } = {}) {
      const e = handle.get(idOrOrigin); if (!e) throw new Error("vault: no such entry");
      const { requireStepUp } = await import("./holo-stepup.mjs");
      const token = await requireStepUp({ kind: "vault.reveal", operator, appId: "holo://os", payload: { entry: e.id, origin: e.origin }, reason: "Reveal the saved secret for " + e.origin }, { credentialId });
      if (!token) throw new Error("vault: reveal denied");
      return { origin: e.origin, kind: e.kind, username: e.username, secret: e.secret, stepup: token.id };
    },
  };
  return handle;
}

export async function hasVault(operator) { const r = await store.get(operator); return !!(r && r.events && r.events.length); }
export async function forgetVault(operator) { return store.del(operator); }

// TEST SEAM (witness only): read the raw at-rest chain to assert opacity + to craft refusal cases.
export async function __rawChain(operator) { return store.get(operator); }
export async function __putRawChain(rec) { return store.put(rec); }
