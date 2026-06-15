// holo-identity.mjs — the self-sovereign IDENTITY layer for Hologram OS. The operator
// "logs in" by UNLOCKING a key that lives on THIS device — never a server account
// (holospaces docs/08 §Identity: "the operator signs in by unlocking a self-sovereign
// key — not a server account"; Law L1 — identity is the κ-label, never a host/URL). The
// principal's identity κ is the CONTENT ADDRESS of its public key (CC-1: σ-axis sha256),
// so the same key yields the same principal on any peer, with no registry. The private
// key is wrapped at rest with the operator's passphrase (PBKDF2 → AES-GCM) and decrypted
// only in memory on unlock; it never leaves the device. Unlock RE-DERIVES the κ from the
// stored public key and refuses a mismatch (Law L5 — verify by re-derivation).
//
// No dependency: the web platform's WebCrypto IS the engine (Law L4 — everything through
// the substrate). Isomorphic — the derive/canon/verify core is pure (node-testable);
// enroll/unlock/roster persist to IndexedDB (and mirror to OPFS — Law L3, "the store is
// the memory") only in the browser, falling back to an in-memory map under node tests.

const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;
const RNG = globalThis.crypto || (typeof require !== "undefined" ? require("node:crypto").webcrypto : null);
const te = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => RNG.getRandomValues(new Uint8Array(n));

// Stable, key-sorted JSON — the canonical form a κ commits to (Law L2: canonical forms only).
export function canon(obj) {
  if (Array.isArray(obj)) return "[" + obj.map(canon).join(",") + "]";
  if (obj && typeof obj === "object") return "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + canon(obj[k])).join(",") + "}";
  return JSON.stringify(obj);
}

export async function sha256Hex(u8) {
  const d = await SUB.digest("SHA-256", u8 instanceof Uint8Array ? u8 : new Uint8Array(u8));
  return hex(d);
}
// did:holo:sha256:H(bytes) — the same self-verifying address the substrate uses (CC-1).
export async function addressOf(u8) { return "did:holo:sha256:" + await sha256Hex(u8); }

// ── the signing axis: prefer Ed25519 (modern Chromium / node ≥18); fall back to ECDSA P-256.
let _axis = null;
async function axis() {
  if (_axis) return _axis;
  try { await SUB.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]); _axis = "Ed25519"; }
  catch { _axis = "ECDSA"; }
  return _axis;
}
const keyParams = (a) => a === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" };
const sigParams = (a) => a === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" };

// PBKDF2(passphrase) → an AES-GCM wrapping key (the passphrase never leaves this function).
async function wrapKey(passphrase, salt) {
  const base = await SUB.importKey("raw", te.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return SUB.deriveKey({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// A deterministic avatar (hue + the κ's own glyph) so an operator is recognisable without a server.
function avatarFor(kappa) {
  const h = kappa.split(":").pop();
  return { hue: parseInt(h.slice(0, 4), 16) % 360, glyph: h.slice(0, 2).toUpperCase() };
}

// ── a principal: the unlocked identity. Holds the in-memory signer; the private key is
//    non-extractable, so even the signer can't leak it.
async function principalFrom(rec, privKey) {
  const a = rec.alg;
  return {
    kappa: rec.kappa, label: rec.label, alg: a, pub: rec.pub, avatar: rec.avatar || avatarFor(rec.kappa),
    async sign(bytesOrStr) {
      const u8 = typeof bytesOrStr === "string" ? te.encode(bytesOrStr) : bytesOrStr;
      return b64(await SUB.sign(sigParams(a), privKey, u8));
    },
  };
}

// ── enrollment (first run): mint a self-sovereign key, content-address it, wrap it, persist it.
// `passphrase` is the secret that wraps the key — a human passphrase OR a hardware secret derived
// from this device's TEE (holo-webauthn, PRF). `cred` optionally records the WebAuthn credential
// id whose biometric releases that secret, so a later unlock knows which authenticator to invoke.
export async function enroll({ label, passphrase, cred }) {
  if (!passphrase) throw new Error("a passphrase is required to wrap the key");
  const a = await axis();
  const kp = await SUB.generateKey(keyParams(a), true, ["sign", "verify"]);
  const pubRaw = new Uint8Array(await SUB.exportKey("raw", kp.publicKey));
  const kappa = await addressOf(pubRaw);                              // identity = content address of the pubkey
  const pkcs8 = new Uint8Array(await SUB.exportKey("pkcs8", kp.privateKey));
  const salt = rand(16), iv = rand(12);
  const wrapped = new Uint8Array(await SUB.encrypt({ name: "AES-GCM", iv }, await wrapKey(passphrase, salt), pkcs8));
  const rec = { kappa, label: (label || "operator").trim(), alg: a, pub: b64(pubRaw),
    salt: b64(salt), iv: b64(iv), wrapped: b64(wrapped), avatar: avatarFor(kappa), createdAt: new Date().toISOString() };
  if (cred) rec.cred = cred;                                          // TEE: the biometric credential that unlocks this key
  await store.put(rec);
  // re-import the (non-extractable) private key so the returned principal can sign immediately
  const priv = await SUB.importKey("pkcs8", pkcs8, keyParams(a), false, ["sign"]);
  return principalFrom(rec, priv);
}

// ── unlock (login): decrypt with the passphrase, RE-DERIVE the κ (Law L5), return the principal.
export async function unlock(kappa, passphrase) {
  const rec = await store.get(kappa);
  if (!rec) throw new Error("no such operator on this device");
  // Law L5: the stored κ must re-derive from the stored public key, or the record was tampered.
  if (await addressOf(unb64(rec.pub)) !== rec.kappa) throw new Error("identity record failed Law-L5 verification");
  let pkcs8;
  try { pkcs8 = new Uint8Array(await SUB.decrypt({ name: "AES-GCM", iv: unb64(rec.iv) }, await wrapKey(passphrase, unb64(rec.salt)), unb64(rec.wrapped))); }
  catch { throw new Error("wrong passphrase"); }                      // AES-GCM auth-tag mismatch ⇒ bad passphrase
  const priv = await SUB.importKey("pkcs8", pkcs8, keyParams(rec.alg), false, ["sign"]);
  return principalFrom(rec, priv);
}

// ── ephemeral (GUEST): mint a self-sovereign key that is NEVER written to the store. Same κ model
//    (identity is the content address of the pubkey, Law L1), but it lives only in memory — closing
//    the session forgets it. Seamless one-call access for a human ("Continue as guest") or an agent.
export async function ephemeral({ label = "Guest" } = {}) {
  const a = await axis();
  const kp = await SUB.generateKey(keyParams(a), true, ["sign", "verify"]);
  const pubRaw = new Uint8Array(await SUB.exportKey("raw", kp.publicKey));
  const kappa = await addressOf(pubRaw);
  const pkcs8 = new Uint8Array(await SUB.exportKey("pkcs8", kp.privateKey));
  const priv = await SUB.importKey("pkcs8", pkcs8, keyParams(a), false, ["sign"]);
  return principalFrom({ kappa, label, alg: a, pub: b64(pubRaw), avatar: avatarFor(kappa), guest: true }, priv);
}

// ── the roster (SDDM userModel): the operators enrolled on this device.
export async function roster() {
  return (await store.all()).map((r) => ({ kappa: r.kappa, label: r.label, alg: r.alg, cred: r.cred || null, avatar: r.avatar || avatarFor(r.kappa), createdAt: r.createdAt }));
}
export async function forget(kappa) { return store.del(kappa); }

// ── a session assertion: a content-addressed, signed claim "this operator opened this
//    session" — the handoff token the greeter writes and the shell verifies (Law L5).
// A session carries subjectType (pc = human player · npc = agent) and, when the principal has a
// post-quantum co-key, a HYBRID co-signature: the Ed25519 sig (bound to the operator κ) attests the
// declared pqPub, and an ML-DSA co-signature proves possession — a break in EITHER family is not a break.
export async function openSession(principal, { session, next, host, guest, subjectType } = {}) {
  const body = { "@type": "HoloSession", operator: principal.kappa, label: principal.label,
    subjectType: subjectType || "pc",
    session: session || "primeos", next: next || "", host: host || "", issuedAt: new Date().toISOString(), nonce: hex(rand(8)),
    ...(principal.pqPub ? { pqAlg: principal.pqAlg, pqPub: principal.pqPub } : {}),
    ...(guest ? { guest: true } : {}) };
  const c = canon(body);
  const id = await addressOf(te.encode(c));
  const token = { id, ...body, alg: principal.alg, pub: principal.pub, sig: await principal.sign(c) };
  if (principal.pqSign && principal.pqPub) token.pqSig = await principal.pqSign(c);   // hybrid co-signature (Ed25519 ‖ ML-DSA)
  return token;
}
// Verify a session token end-to-end: re-derive its id, re-derive the operator κ from the
// signing key, check the classical signature, and — if a post-quantum co-key is declared — the ML-DSA
// co-signature too (Law L5, fail closed). Returns the verified body or null. Backward-compatible: a
// classical-only token (no pqPub) verifies exactly as before.
export async function verifySession(token) {
  try {
    if (!token || !token.id || !token.sig) return null;
    const { id, alg, pub, sig, pqSig, ...body } = token;
    const c = canon(body);
    if (await addressOf(te.encode(c)) !== id) return null;            // id must commit to the body (incl. pqPub)
    if (await addressOf(unb64(pub)) !== body.operator) return null;   // operator κ must be this pubkey's address
    const key = await SUB.importKey("raw", unb64(pub), keyParams(alg), false, ["verify"]);
    if (!(await SUB.verify(sigParams(alg), key, unb64(sig), te.encode(c)))) return null;
    if (body.pqPub) {                                                  // hybrid: the ML-DSA co-sig must ALSO verify
      const { mldsaVerify } = await import("./holo-pqc.mjs");
      if (!pqSig || !mldsaVerify(body.pqPub, c, pqSig)) return null;
    }
    return body;
  } catch { return null; }
}

// ───────────────────────────────────────────────────────────────────────────────
// Persistence — IndexedDB (browser), with an OPFS mirror (Law L3); in-memory under node.
// ───────────────────────────────────────────────────────────────────────────────
const hasIDB = typeof indexedDB !== "undefined";
const mem = new Map();
const DB = "holo-identity", OS_STORE = "operators";

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(OS_STORE, { keyPath: "kappa" });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idb(mode, fn) {
  const db = await openDB();
  return new Promise((res, rej) => { const req = fn(db.transaction(OS_STORE, mode).objectStore(OS_STORE)); req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}
async function idbAll() {
  const db = await openDB();
  return new Promise((res, rej) => { const out = []; const tx = db.transaction(OS_STORE, "readonly");
    tx.objectStore(OS_STORE).openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { out.push(c.value); c.continue(); } else res(out); }; tx.onerror = () => rej(tx.error); });
}
// OPFS mirror: the operator record is also content (κ → canonical bytes) under /etc/operators.
async function opfsMirror(rec) {
  try {
    if (!navigator?.storage?.getDirectory) return;
    const root = await navigator.storage.getDirectory();
    const etc = await root.getDirectoryHandle("etc", { create: true });
    const ops = await etc.getDirectoryHandle("operators", { create: true });
    const fh = await ops.getFileHandle(rec.kappa.split(":").pop() + ".json", { create: true });
    const w = await fh.createWritable(); await w.write(canon(rec)); await w.close();
  } catch { /* OPFS optional; IndexedDB is the source of truth */ }
}
const store = {
  async put(rec) { if (hasIDB) { await idb("readwrite", (s) => s.put(rec)); opfsMirror(rec); return; } mem.set(rec.kappa, rec); },
  async get(kappa) { if (hasIDB) return idb("readonly", (s) => s.get(kappa)); return mem.get(kappa) || null; },
  async all() { if (hasIDB) return idbAll(); return [...mem.values()]; },
  async del(kappa) { if (hasIDB) { await idb("readwrite", (s) => s.delete(kappa)); return; } mem.delete(kappa); },
};

// ── self-test (node): enroll → unlock (right + wrong passphrase) → session round-trip.
export async function selftest() {
  const r = {};
  const p = await enroll({ label: "tester", passphrase: "correct horse" });
  r.kappa = /^did:holo:sha256:[0-9a-f]{64}$/.test(p.kappa);
  r.roster = (await roster()).some((o) => o.kappa === p.kappa);
  const back = await unlock(p.kappa, "correct horse"); r.unlock = back.kappa === p.kappa;
  try { await unlock(p.kappa, "wrong"); r.rejectsWrong = false; } catch { r.rejectsWrong = true; }
  const tok = await openSession(back, { session: "primeos", next: "home.html" });
  r.session = !!(await verifySession(tok));
  const tampered = { ...tok, operator: "did:holo:sha256:" + "0".repeat(64) };
  r.tamperCaught = (await verifySession(tampered)) === null;
  await forget(p.kappa);
  r.ok = Object.values(r).every(Boolean);
  return r;
}

if (typeof process !== "undefined" && process.argv && /holo-identity\.mjs$/.test(process.argv[1] || "")) {
  selftest().then((r) => { console.log("holo-identity selftest:", r); process.exit(r.ok ? 0 : 1); });
}
