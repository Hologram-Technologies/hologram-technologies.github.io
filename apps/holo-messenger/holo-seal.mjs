// holo-seal.mjs - the sealed envelope for Holo Direct (sovereign, end-to-end encrypted messaging).
//
// Each message is sealed to the RECIPIENT and signed by the SENDER's sovereign identity, then content-addressed (κ):
//   • confidential: a fresh EPHEMERAL ECDH key per message → ECDH(eph, recipientBox) → HKDF → AES-256-GCM (ECIES).
//     Because the sender key is ephemeral, past messages stay sealed even if a long-term key later leaks (per-message FS;
//     a full ratchet is DM-C). Only the recipient's private box key can derive the secret → only they can read it.
//   • authentic: the whole envelope is SIGNED with the sender's identity signing key → the reader knows it's really them.
//   • tamper-evident: κ = SHA-256 over the canonical envelope + signature. Any change breaks κ (and the signature, and
//     AES-GCM). Three independent checks.
//
// Vetted WebCrypto only (ECDH/ECDSA P-256, HKDF-SHA256, AES-256-GCM) - universally available in Node + browsers. A
// post-quantum HYBRID (X25519+ML-KEM, ML-DSA signatures via the sovereign identity/TEE) is a later upgrade (DM roadmap);
// we claim only what's implemented. Keys are injected (from holo-identity in production); we never invent our own trust.

const _te = new TextEncoder(), _td = new TextDecoder();
const _subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || (typeof crypto !== "undefined" && crypto.subtle);
function _b64(buf) { const b = new Uint8Array(buf); let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function _ub64(str) { const s = atob(str); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
async function _sha256hex(s) { const h = await _subtle().digest("SHA-256", _te.encode(s)); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join(""); }

const SIGN_ALG = { name: "ECDSA", namedCurve: "P-256" }, SIGN_OP = { name: "ECDSA", hash: "SHA-256" };
const BOX_ALG = { name: "ECDH", namedCurve: "P-256" };

// ── identities (in production these come from holo-identity / the TEE; here we can also mint them for tests) ──
export async function generateIdentity() {
  const sign = await _subtle().generateKey(SIGN_ALG, true, ["sign", "verify"]);
  const box = await _subtle().generateKey(BOX_ALG, true, ["deriveBits"]);
  return { sign, box };
}
// the shareable public identity - hand this to contacts (both keys are public)
export async function exportPublic(identity) {
  return { sign: _b64(await _subtle().exportKey("raw", identity.sign.publicKey)), box: _b64(await _subtle().exportKey("raw", identity.box.publicKey)) };
}
async function _importSignPub(b) { return _subtle().importKey("raw", _ub64(b), SIGN_ALG, true, ["verify"]); }
async function _importBoxPub(b) { return _subtle().importKey("raw", _ub64(b), BOX_ALG, true, []); }

// a stable, human-checkable fingerprint of an identity (DM-D verify-your-contact)
export async function fingerprint(pub) { const hex = await _sha256hex(pub.sign + "|" + pub.box); return hex.match(/.{1,4}/g).slice(0, 8).join(" "); }

async function _hkdfAesKey(sharedBits) {
  const base = await _subtle().importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  return _subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: _te.encode("holo-seal-v1") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
function _canon(e) { return [e.v, e.epk, e.iv, e.ct, e.from, e.to, e.ts].join(""); }

// seal plaintext TO a recipient's public box key, signed by the sender's identity. Returns a serializable envelope.
export async function seal(plaintext, { toBoxPub, fromKeys, fromPub, nowMs = null } = {}) {
  const eph = await _subtle().generateKey(BOX_ALG, true, ["deriveBits"]);
  const recipient = await _importBoxPub(toBoxPub);
  const shared = await _subtle().deriveBits({ name: "ECDH", public: recipient }, eph.privateKey, 256);
  const aesKey = await _hkdfAesKey(shared);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = _te.encode(fromPub.sign + "|" + toBoxPub);   // bind ciphertext to sender+recipient (anti-confusion)
  const ct = await _subtle().encrypt({ name: "AES-GCM", iv, additionalData: aad }, aesKey, _te.encode(String(plaintext)));
  const env = { v: 1, epk: _b64(await _subtle().exportKey("raw", eph.publicKey)), iv: _b64(iv), ct: _b64(ct), from: fromPub.sign, to: toBoxPub, ts: nowMs || Date.now() };
  const canon = _canon(env);
  env.sig = _b64(await _subtle().sign(SIGN_OP, fromKeys.sign.privateKey, _te.encode(canon)));
  env.kappa = await _sha256hex(canon + "|" + env.sig);
  return env;
}

// open an envelope with MY identity. Returns { ok, plaintext, verified, from }. verified=false ⇒ don't show as authentic.
export async function open(env, { myKeys, expectFrom = null } = {}) {
  if (!env || env.v !== 1 || !env.epk || !env.ct || !env.sig) return { ok: false, error: "malformed" };
  const canon = _canon(env);
  if ((await _sha256hex(canon + "|" + env.sig)) !== env.kappa) return { ok: false, error: "integrity" };   // tamper → κ mismatch
  let verified = false;
  try { verified = await _subtle().verify(SIGN_OP, await _importSignPub(env.from), _ub64(env.sig), _te.encode(canon)); } catch {}
  if (expectFrom && env.from !== expectFrom) return { ok: false, error: "unexpected-sender", verified };
  try {
    const eph = await _importBoxPub(env.epk);
    const shared = await _subtle().deriveBits({ name: "ECDH", public: eph }, myKeys.box.privateKey, 256);
    const aesKey = await _hkdfAesKey(shared);
    const aad = _te.encode(env.from + "|" + env.to);
    const pt = _td.decode(await _subtle().decrypt({ name: "AES-GCM", iv: _ub64(env.iv), additionalData: aad }, aesKey, _ub64(env.ct)));
    return { ok: true, plaintext: pt, verified, from: env.from };
  } catch { return { ok: false, error: "decrypt", verified }; }   // wrong recipient / corrupted → can't open
}

// wire helpers - the envelope is already plain JSON of base64 fields; nothing here is secret except what only the
// recipient can decrypt. This is what crosses the datachannel / sits in the mailbox: ciphertext, never plaintext.
export function toWire(env) { return JSON.stringify(env); }
export function fromWire(s) { try { return JSON.parse(s); } catch { return null; } }
