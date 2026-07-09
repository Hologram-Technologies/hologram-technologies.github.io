// holo-roam.mjs — Identity Roam & Recovery: one sovereign identity, every device, no seed phrase.
//
// A new device becomes the SAME sovereign κ by approving on a device you already trust. It reuses holo-pair's
// E2E channel (createPairOffer / offer↔url / postGrant / pollGrant) and the SAME WebCrypto construction
// (ECDH P-256 → HKDF-SHA256 → AES-GCM) to carry the SEED — a 12-word mnemonic — not just a delegation. The
// mnemonic is sealed END-TO-END to the new device's offer key (the relay is blind), gated by a fresh biometric
// on the trusted device (the caller reads it via holo-login.revealMnemonic under a step-up), bounded by a
// short expiry, and re-wrapped under the NEW device's own enclave on arrival (holo-login.recover). So the seed
// crosses the wire only as ciphertext only the new device can open, is never shown to a human, and is never
// persisted unwrapped.
//
// Recovery (all devices lost): the mnemonic sealed under a recovery key SPLIT into a link part + a short human
// code — restoring needs BOTH. The 12-word phrase (holo-login.revealMnemonic) remains the ultimate break-glass,
// surfaced only under Advanced, never the primary UX.
//
// Pure/isomorphic — WebCrypto only, so the crypto is Node-witnessable (works in the greeter, any holospace, and
// the witness). No new cryptography: same primitives + construction as holo-pair, a distinct HKDF `info` per use
// so keys never alias across the delegation cipher, the seed-roam cipher, and the recovery cipher.

import { createPairOffer, offerToUrl, urlToOffer, postGrant, pollGrant } from "./holo-pair.mjs";

const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;
const RNG = globalThis.crypto || (typeof require !== "undefined" ? require("node:crypto").webcrypto : null);
const te = new TextEncoder();
const td = new TextDecoder();
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64u = (b) => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => unb64(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4));
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const rand = (n) => RNG.getRandomValues(new Uint8Array(n));

export const ROAM_V = "holo-roam:v1";
const SEED_INFO = () => te.encode("holo-roam:seed:v1");         // seed-roam cipher — distinct from holo-pair's grant cipher
const REC_INFO = () => te.encode("holo-roam:recovery:v1");     // recovery cipher — distinct again

// ── E2E seal to a device's P-256 ECDH pubkey (holo-pair's construction, roam `info`) ──
async function sealToDevice(devicePubB64u, channelB64u, obj) {
  const eph = await SUB.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const ephPub = new Uint8Array(await SUB.exportKey("raw", eph.publicKey));
  const dev = await SUB.importKey("raw", unb64u(devicePubB64u), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await SUB.deriveBits({ name: "ECDH", public: dev }, eph.privateKey, 256));
  const hk = await SUB.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aes = await SUB.deriveKey({ name: "HKDF", hash: "SHA-256", salt: unb64u(channelB64u), info: SEED_INFO() }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = rand(12);
  const ct = new Uint8Array(await SUB.encrypt({ name: "AES-GCM", iv }, aes, te.encode(JSON.stringify(obj))));
  return { v: ROAM_V, channel: channelB64u, epk: b64u(ephPub), iv: b64u(iv), ct: b64u(ct) };
}
async function openFromDevice(secrets, blob) {
  if (!blob || blob.v !== ROAM_V) throw new Error("not a holo-roam blob");
  if (blob.channel !== secrets.channel) throw new Error("roam blob is for a different channel");
  const ecPriv = await SUB.importKey("pkcs8", unb64u(secrets.devicePkcs8), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const ephPub = await SUB.importKey("raw", unb64u(blob.epk), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await SUB.deriveBits({ name: "ECDH", public: ephPub }, ecPriv, 256));
  const hk = await SUB.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aes = await SUB.deriveKey({ name: "HKDF", hash: "SHA-256", salt: unb64u(blob.channel), info: SEED_INFO() }, hk, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = new Uint8Array(await SUB.decrypt({ name: "AES-GCM", iv: unb64u(blob.iv) }, aes, unb64u(blob.ct)));   // throws on wrong device / tamper (AES-GCM tag)
  return JSON.parse(td.decode(pt));
}

// ── ADD A DEVICE ─────────────────────────────────────────────────────────────────────────────────
// 1 · NEW device mints an offer (its own ECDH device key + a single-use channel) and shows the QR/link.
export async function newDeviceOffer({ deviceName, baseUrl = "" } = {}) {
  const { offer, secrets } = await createPairOffer({ deviceName });
  return { offer, secrets, url: offerToUrl(offer, baseUrl), channel: offer.channel };
}

// 2 · TRUSTED device (operator signed in): seal the operator's MNEMONIC to the new device and post it.
// `mnemonic` MUST come from a fresh biometric step-up (holo-login.revealMnemonic) on the trusted device —
// this module never reads the vault itself. Short expiry; nonce; bound to the offer's channel.
// `resume` (optional) is a sealed Deep-Resume blob (sealResume below) — the trusted device's live experience,
// carried on the SAME E2E channel so "add a device" ALSO drops the new device where you were. One motion.
export async function approveDevice({ offer, offerUrl, mnemonic, label = "", resume = null, ttlMs = 5 * 60e3, nowMs, base = "", post = true } = {}) {
  if (typeof mnemonic !== "string" || !mnemonic.trim()) throw new Error("approveDevice needs the operator mnemonic (from a biometric step-up)");
  const o = offer || (await urlToOffer(offerUrl));
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const payload = { "@type": "HoloSeedRoam", v: ROAM_V, mnemonic, label, channel: o.channel,
    nbf: new Date(now).toISOString(), exp: new Date(now + ttlMs).toISOString(), nonce: hex(rand(8)) };
  if (resume) payload.resume = resume;                            // sealed Deep-Resume blob (opaque here; opened with the mnemonic)
  const blob = await sealToDevice(o.devicePub, o.channel, payload);
  if (post) await postGrant(o.channel, blob, { base });          // reuse holo-pair's content-blind relay
  return { blob };
}

// 3 · NEW device polls the channel, decrypts + validates, returns the mnemonic (transient — the caller
// immediately recover()s it under THIS device's enclave and drops it). null on timeout/abort.
export async function awaitDeviceJoin(secrets, { base = "", nowMs, signal, timeoutMs } = {}) {
  const blob = await pollGrant(secrets.channel, { base, signal, timeoutMs });
  if (!blob) return null;
  return acceptSeedRoam(secrets, blob, { nowMs });
}
export async function acceptSeedRoam(secrets, blob, { nowMs } = {}) {
  const p = await openFromDevice(secrets, blob);                 // throws if not for this device / tampered
  if (!p || p["@type"] !== "HoloSeedRoam" || p.channel !== secrets.channel) throw new Error("not a seed-roam payload");
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (p.nbf && now < Date.parse(p.nbf)) throw new Error("roam not yet valid");
  if (p.exp && now > Date.parse(p.exp)) throw new Error("roam expired");
  if (typeof p.mnemonic !== "string" || !p.mnemonic.trim()) throw new Error("no seed in roam payload");
  return { mnemonic: p.mnemonic, label: p.label || "", resume: p.resume || null };
}

// ── RECOVERY LINK ────────────────────────────────────────────────────────────────────────────────
// mnemonic sealed under recoveryKey(linkKey, code): the LINK carries linkKey + the sealed blob; the CODE is a
// short human factor delivered out-of-band. Need BOTH to restore (the link alone, or the code alone, is inert).
async function recoveryKey(linkKeyBytes, code) {
  const ikm = new Uint8Array([...linkKeyBytes, ...te.encode(String(code))]);
  const hk = await SUB.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
  return SUB.deriveKey({ name: "HKDF", hash: "SHA-256", salt: te.encode("holo-roam/recovery/salt/v1"), info: REC_INFO() }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function mintRecoveryLink(mnemonic, { baseUrl = "", codeLen = 6 } = {}) {
  if (typeof mnemonic !== "string" || !mnemonic.trim()) throw new Error("mintRecoveryLink needs the mnemonic");
  const linkKey = rand(32);
  const code = [...rand(codeLen)].map((b) => (b % 10)).join("");           // short numeric code, out-of-band
  const key = await recoveryKey(linkKey, code);
  const iv = rand(12);
  const ct = new Uint8Array(await SUB.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify({ "@type": "HoloRecovery", v: ROAM_V, mnemonic }))));
  const payload = { v: ROAM_V, k: b64u(linkKey), iv: b64u(iv), ct: b64u(ct) };
  const link = `${String(baseUrl).replace(/\/$/, "")}/restore.html#r=${b64u(te.encode(JSON.stringify(payload)))}`;
  return { link, code };
}
export async function restoreFromRecovery(link, code) {
  const m = String(link).match(/[#&]r=([A-Za-z0-9\-_]+)/);
  if (!m) throw new Error("not a recovery link");
  const payload = JSON.parse(td.decode(unb64u(m[1])));
  if (payload.v !== ROAM_V) throw new Error("unsupported recovery version");
  const key = await recoveryKey(unb64u(payload.k), String(code));
  let obj;
  try { obj = JSON.parse(td.decode(new Uint8Array(await SUB.decrypt({ name: "AES-GCM", iv: unb64u(payload.iv) }, key, unb64u(payload.ct))))); }
  catch { throw new Error("wrong recovery code"); }                        // AES-GCM tag mismatch = wrong code / tampered link
  if (!obj || obj["@type"] !== "HoloRecovery" || typeof obj.mnemonic !== "string") throw new Error("corrupt recovery payload");
  return { mnemonic: obj.mnemonic };
}

// ── DEEP RESUME (cross-device experience) ─────────────────────────────────────────────────────────
// Your live experience (active chat · scroll · draft · …) sealed under a key derived from the MNEMONIC — so
// it is device-INDEPENDENT (any device of the same operator holds the mnemonic and can open it) yet operator-
// bound (only the operator can). This is distinct from holo-session's DEVICE-bound at-rest realm key, which
// stays for local at-rest; roam needs a key that travels. Carried inside the roam handoff, or pulled standalone
// through the relay/κ-store ("continue here"). `seq` gives freshness (latest wins; a stale import is refused).
const RESUME_INFO = () => te.encode("holo-roam:resume:v1");
async function resumeKey(mnemonic) {
  const hk = await SUB.importKey("raw", te.encode(String(mnemonic)), "HKDF", false, ["deriveKey"]);
  return SUB.deriveKey({ name: "HKDF", hash: "SHA-256", salt: te.encode("holo-roam/resume/salt/v1"), info: RESUME_INFO() }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function sealResume(mnemonic, state, { seq = 1, nowMs } = {}) {
  if (typeof mnemonic !== "string" || !mnemonic.trim()) throw new Error("sealResume needs the operator mnemonic");
  const key = await resumeKey(mnemonic);
  const body = { "@type": "HoloResume", v: ROAM_V, seq: seq | 0, at: new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString(), state: state || {} };
  const iv = rand(12);
  const ct = new Uint8Array(await SUB.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(body))));
  const payload = { v: ROAM_V, seq: seq | 0, iv: b64u(iv), ct: b64u(ct) };
  const kappa = await addr(te.encode(JSON.stringify(payload)));   // content address (tamper-evident)
  return { kappa, blob: { ...payload, kappa } };
}
export async function openResume(mnemonic, blob) {
  if (!blob || blob.v !== ROAM_V || !blob.ct) throw new Error("not a resume blob");
  if (blob.kappa) { const { kappa, ...rest } = blob; if ((await addr(te.encode(JSON.stringify(rest)))) !== kappa) throw new Error("resume κ does not commit to the bytes (L5)"); }
  const key = await resumeKey(mnemonic);
  let body;
  try { body = JSON.parse(td.decode(new Uint8Array(await SUB.decrypt({ name: "AES-GCM", iv: unb64u(blob.iv) }, key, unb64u(blob.ct))))); }
  catch { throw new Error("resume did not decrypt for this operator"); }   // wrong operator / tamper (AES-GCM tag)
  if (!body || body["@type"] !== "HoloResume") throw new Error("not a resume payload");
  return { state: body.state || {}, seq: body.seq | 0, at: body.at || null };
}
// freshness: apply a roamed snapshot only if it is STRICTLY newer than what this device already has (no clobber).
export function resumeIsFresh(blob, sinceSeq = 0) { return !!blob && (blob.seq | 0) > (sinceSeq | 0); }
async function addr(u8) { return "did:holo:sha256:" + [...new Uint8Array(await SUB.digest("SHA-256", u8))].map((x) => x.toString(16).padStart(2, "0")).join(""); }

export { offerToUrl, urlToOffer };   // re-export the transport helpers so a consumer imports ONE module
