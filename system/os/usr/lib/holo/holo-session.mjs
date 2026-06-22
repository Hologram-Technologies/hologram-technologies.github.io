// holo-session.mjs — Holo Session: per-realm, device-local experience continuity.
//
// ADR-0104 (v1): a signed-in operator's experience (holospace tabs + order + active tab + per-tab
// world snapshot + a settings allowlist) is κ-sealed into the LOCAL κ-store and rehydrated on boot.
// ADR-0106 (v2, this file): raise the bar to EVERY user and 100% sovereign at rest —
//   • REALMS — one mechanism for both a guest and an operator. activeRealm() is the operator κ when
//     unlocked, else a per-device GUEST realm. A guest's work autosaves exactly like an operator's;
//     a single sign-in CLAIMS it (re-keys it) into the operator — nothing lost (the headline).
//   • AT-REST ENCRYPTION (Max sovereign) — the manifest is AES-GCM sealed before it touches the
//     κ-store, so on a shared browser profile it is NOT readable by another operator. The operator
//     key is derived from the secret entered AT SIGN-IN (PBKDF2, never persisted); a guest/locked
//     session uses a device key (integrity + copied-store protection, honestly NOT confidential vs
//     devtools — documented). A synthetic IV (HMAC of the plaintext) keeps an identical experience
//     sealing to an identical κ (κ-memo preserved) while distinct plaintext gets a distinct IV.
//   • BATTLE-HARDENED — a per-realm seq guard (no cross-tab clobber), a schema version + v1→v2
//     migration, and quota-graceful saves that never corrupt the last good snapshot.
//
// NOTHING leaves the device: the κ-store is local IndexedDB and there is NO fetch on any path
// (Law L4). Reads re-derive their κ (Law L5). Cross-device is a DIFFERENT axis (ADR-0105, the
// portable IPFS leg — which seals a PLAINTEXT manifest by explicit user export, orthogonal to the
// local at-rest encryption here).
//
// The CORE is adapter-injectable (createSession) — the witness drives it with in-memory fakes + an
// injected cipher; the browser BINDINGS wire localStorage + the κ-store + WebCrypto.

import { jcs } from "./holo-uor.mjs";   // the ONE canonical-form primitive (Law L2)

const te = new TextEncoder();
const td = new TextDecoder();
const hexOf = (k) => String(k).split(":").pop();
const SUB = () => globalThis.crypto.subtle;
async function sha256bytes(bytes) { return new Uint8Array(await SUB().digest("SHA-256", bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))); }
async function sha256hex(bytes) { return [...await sha256bytes(bytes)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
const b64e = (u8) => btoa(String.fromCharCode(...u8));
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const SCHEMA_VERSION = 2;

// ── the settings allowlist (unchanged from v1) — exactly which localStorage keys ARE "the
//    experience". A key is captured iff it is an exact SETTINGS_KEY or carries a SETTINGS_PREFIX and
//    is not an identity/session/device/one-shot key. (The witness asserts coverage of each axis.)
export const SETTINGS_PREFIXES = Object.freeze(["holo-widgets.", "holo.voice.", "holo:wall", "holo-vinyl.", "holo.q."]);
export const SETTINGS_KEYS = Object.freeze(["holo.playground"]);
const EXCLUDE = new Set(["holo.device.id", "holo.install.dismissed"]);
export function isExperienceKey(k) {
  if (!k || typeof k !== "string") return false;
  if (EXCLUDE.has(k) || k.startsWith("holo.session.")) return false;
  if (SETTINGS_KEYS.includes(k)) return true;
  return SETTINGS_PREFIXES.some((p) => k.startsWith(p));
}

const HEAD_PREFIX = "holo.session.head.";
// realm → head key. A guest realm ("guest:<deviceHex>") keeps its prefix so it can never collide with
// an operator κ's hex namespace (per-operator + per-guest isolation in one map).
const headKey = (realm) => HEAD_PREFIX + (String(realm).startsWith("guest:") ? String(realm) : hexOf(realm));
export const guestRealm = (device) => "guest:" + hexOf(device);

// ── ciphers — the at-rest boundary. makeCipher(rawKeyBytes) gives {seal,open} with AES-GCM and a
//    SYNTHETIC IV (HMAC-SHA256 of the plaintext under a derived MAC subkey). Deterministic in the
//    (key, plaintext) pair → identical experience seals to an identical κ (κ-memo), distinct plaintext
//    gets a distinct IV (the AES-GCM-SIV discipline; we don't claim RFC 8452, just its safety property).
//    Two subkeys are split from the raw key so AES and the IV-MAC never share a key.
async function subKeys(rawKeyBytes) {
  const enc = await sha256bytes(concat(rawKeyBytes, te.encode("|holo-session/enc")));
  const mac = await sha256bytes(concat(rawKeyBytes, te.encode("|holo-session/iv")));
  return {
    aes: await SUB().importKey("raw", enc, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]),
    hmac: await SUB().importKey("raw", mac, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
  };
}
function concat(a, b) { const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; }
export function makeCipher(rawKeyBytes) {
  const raw = rawKeyBytes instanceof Uint8Array ? rawKeyBytes : new Uint8Array(rawKeyBytes);
  return {
    async seal(pt) {
      const { aes, hmac } = await subKeys(raw);
      const iv = new Uint8Array(await SUB().sign("HMAC", hmac, pt)).slice(0, 12);   // synthetic IV
      const ct = new Uint8Array(await SUB().encrypt({ name: "AES-GCM", iv }, aes, pt));
      return concat(iv, ct);                                                        // iv ‖ ciphertext
    },
    async open(blob) {
      try {
        const { aes } = await subKeys(raw);
        const u = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
        const iv = u.slice(0, 12), ct = u.slice(12);
        return new Uint8Array(await SUB().decrypt({ name: "AES-GCM", iv }, aes, ct));
      } catch { return null; }                                                      // wrong key / tamper → null
    },
  };
}
// deriveOperatorKeyBytes — the vault key, from the secret the operator JUST entered at sign-in/unlock.
// PBKDF2(secret, salt = SHA-256(operator ‖ deviceSalt), 210k) → 32 bytes. The secret is never stored.
export async function deriveOperatorKeyBytes(operator, secret, deviceSalt) {
  const base = await SUB().importKey("raw", te.encode(String(secret)), "PBKDF2", false, ["deriveBits"]);
  const salt = await sha256bytes(te.encode(String(operator) + "|" + String(deviceSalt)));
  return new Uint8Array(await SUB().deriveBits({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, base, 256));
}

// ── the injectable core ──────────────────────────────────────────────────────────────────────
// kv:    { get, set, remove, keys }   store: { put(κ,u8), get(κ)->u8|null }   now: () -> ISO string
export function createSession({ kv, store, now }) {
  function captureSettings() {
    const out = {};
    for (const k of kv.keys()) { if (isExperienceKey(k)) { const v = kv.get(k); if (v != null) out[k] = v; } }
    return out;
  }
  function cleanTab(t) {
    const o = { id: t.id, title: t.title || "", addr: t.addr || "", home: !!t.home };
    if (t.pinned) o.pinned = true;
    if (t.group) o.group = t.group;
    o.snap = (t.snap && typeof t.snap === "object") ? { world: t.snap.world || [], layout: t.snap.layout || null, focusedId: t.snap.focusedId || null } : null;
    return o;
  }
  // The manifest body is PLAINTEXT + deterministic (no seq, no nonce) so it is content-addressable and
  // cross-device-dedupable (ADR-0105). holo:v is the schema version; seq lives OUT-OF-BAND in the head.
  function buildManifest({ operator, device, tabs, activeTab, settings }) {
    return {
      "@context": ["https://www.w3.org/ns/did/v1", { holo: "https://hologram.os/ns#", prov: "http://www.w3.org/ns/prov#" }],
      "@type": ["prov:Entity", "holo:SessionManifest"],
      "holo:v": SCHEMA_VERSION,
      "holo:operator": { "@id": operator },
      "holo:device": device,
      "prov:generatedAtTime": now(),
      "holo:experience": { tabs: (tabs || []).map(cleanTab), activeTab: activeTab | 0, settings: settings || {} },
    };
  }
  async function kappaOfBody(body) { return "did:holo:sha256:" + await sha256hex(te.encode(jcs(body))); }

  // head value is JSON { k: κ, seq, tab }. A legacy bare-κ string (v1 / ADR-0105) reads as seq 0.
  function readHead(realm) {
    const raw = kv.get(headKey(realm)); if (!raw) return null;
    if (typeof raw === "string" && raw[0] === "{") { try { return JSON.parse(raw); } catch { return null; } }
    return { k: raw, seq: 0, tab: null };
  }

  // save — seal (optionally encrypt) the experience and advance the realm head, with a cross-tab guard
  // and quota-graceful failure. Returns { kappa, seq } | { skipped } | { ok:false, why }.
  async function save({ realm, device, tabs, activeTab, settings, cipher = null, tab = null, expectSeq = null }) {
    if (!realm) return { ok: false, why: "no-realm" };
    const head = readHead(realm);
    // cross-tab guard: if another tab advanced the head past what THIS save was based on, don't clobber it.
    if (head && expectSeq != null && head.seq > expectSeq && head.tab && head.tab !== tab) return { skipped: true, why: "raced", seq: head.seq };
    const body = buildManifest({ operator: realm, device, tabs, activeTab, settings: settings || captureSettings() });
    const pt = te.encode(jcs(body));
    let blob; try { blob = cipher ? await cipher.seal(pt) : pt; } catch (e) { return { ok: false, why: "seal:" + (e && e.message) }; }
    const kappa = "did:holo:sha256:" + await sha256hex(blob);
    try { await store.put(kappa, blob); } catch (e) { return { ok: false, why: "quota" }; }   // last good snapshot untouched
    const seq = (head && head.seq | 0) + 1;
    try { kv.set(headKey(realm), JSON.stringify({ k: kappa, seq, tab })); } catch (e) { return { ok: false, why: "quota-head" }; }
    return { kappa, seq, body };
  }

  // restore — head → κ-store → L5 re-derive → decrypt (or v1 plaintext migrate) → device check.
  // Returns the manifest body (with holo:v normalized) or null for a clean default.
  async function restore({ realm, device, cipher = null }) {
    if (!realm) return null;
    const head = readHead(realm); if (!head || !head.k) return null;
    const blob = await store.get(head.k); if (!blob) return null;                  // missing / evicted → clean default
    if (("did:holo:sha256:" + await sha256hex(blob)) !== head.k) return null;      // Law L5: poisoned byte → refuse
    const u = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
    let body = parseManifest(u);                                                   // v1 plaintext path (migration)
    if (!body && cipher) { const pt = await cipher.open(u); if (pt) body = parseManifest(pt); }   // v2 ciphertext path
    if (!body) return null;                                                        // wrong key / tamper / garbage
    if (body["holo:device"] && body["holo:device"] !== device) return null;        // copied to another machine → clean default
    if (body["holo:v"] == null) body["holo:v"] = 1;                                // a migrated v1 manifest
    return body;
  }
  function parseManifest(u8) {
    let m; try { m = JSON.parse(td.decode(u8)); } catch { return null; }
    if (!m || !Array.isArray(m["@type"]) || !m["@type"].includes("holo:SessionManifest")) return null;
    return m;
  }

  // claim — the headline: re-key one realm's experience under another (guest → operator) with NOTHING
  // lost, then consume the source head. Write-new-THEN-delete-old so a crash leaves the guest re-claimable.
  async function claim({ fromRealm, toRealm, device, fromCipher = null, toCipher = null, tab = null }) {
    const body = await restore({ realm: fromRealm, device, cipher: fromCipher });
    if (!body) return null;                                                        // nothing to claim
    const exp = body["holo:experience"] || {};
    const res = await save({ realm: toRealm, device, tabs: exp.tabs || [], activeTab: exp.activeTab | 0, settings: exp.settings || {}, cipher: toCipher, tab });
    if (!res || res.ok === false || res.skipped) return null;                      // claim failed → leave the guest realm intact
    try { kv.remove(headKey(fromRealm)); } catch {}                                // consume the guest realm
    return { ...res, body };
  }

  function apply(body) {
    const exp = (body && body["holo:experience"]) || {};
    const settings = exp.settings || {};
    for (const [k, v] of Object.entries(settings)) { if (isExperienceKey(k)) { try { kv.set(k, v); } catch {} } }
    return { tabs: Array.isArray(exp.tabs) ? exp.tabs : [], activeTab: exp.activeTab | 0 };
  }

  function reset(realm) {
    try { kv.remove(headKey(realm)); } catch {}
    for (const k of [...kv.keys()]) { if (isExperienceKey(k)) { try { kv.remove(k); } catch {} } }
  }

  return { captureSettings, buildManifest, kappaOfBody, readHead, save, restore, claim, apply, reset };
}

// ════════════════════════ browser bindings ════════════════════════
function browserKv() {
  const ls = globalThis.localStorage;
  return {
    get: (k) => ls.getItem(k),
    set: (k, v) => ls.setItem(k, String(v)),
    remove: (k) => ls.removeItem(k),
    keys: () => { const out = []; for (let i = 0; i < ls.length; i++) out.push(ls.key(i)); return out; },
  };
}
async function browserStore() {
  const m = await import("./holo-forge/holo-kstore.mjs");
  return { put: (k, u8) => m.kput(k, u8), get: (k) => m.kget(k).then((b) => b || null) };
}
const TAB_ID = (() => { try { const r = new Uint8Array(4); globalThis.crypto.getRandomValues(r); return [...r].map((b) => b.toString(16).padStart(2, "0")).join(""); } catch { return "tab"; } })();

export async function deviceId(kv = browserKv()) {
  let id = null; try { id = kv.get("holo.device.id"); } catch {}
  if (id) return id;
  const r = new Uint8Array(16); globalThis.crypto.getRandomValues(r);
  id = "did:holo:sha256:" + await sha256hex(r);
  try { kv.set("holo.device.id", id); } catch {}
  return id;
}
// the device key — a random 32-byte key minted once per profile, for the guest/locked realm. Stored in
// localStorage (so it's co-located, hence the honest "not confidential vs devtools" caveat — it gives
// integrity + protects an exfiltrated/copied store, NOT secrecy against this profile's own devtools).
function deviceKeyBytes(kv = browserKv()) {
  let s = null; try { s = kv.get("holo.session.devkey"); } catch {}
  if (s) { try { return b64d(s); } catch {} }
  const r = new Uint8Array(32); globalThis.crypto.getRandomValues(r);
  try { kv.set("holo.session.devkey", b64e(r)); } catch {}
  return r;
}

export function signedInOperator() {
  try {
    const t = JSON.parse((typeof globalThis.sessionStorage !== "undefined" && globalThis.sessionStorage.getItem("holo.identity")) || "null");
    if (t && t.operator && !t.guest) return t.operator;
  } catch {}
  return null;
}

let _bound = null, _opKey = null, _seq = Object.create(null);
async function bound() {
  if (!_bound) { _bound = createSession({ kv: browserKv(), store: await browserStore(), now: () => new Date().toISOString() }); }
  return _bound;
}
// unlockOperatorKey — call at sign-in/unlock, where the secret is in hand. Derives + caches the vault
// key in memory (never persisted). After this, the operator realm becomes active.
export async function unlockOperatorKey({ operator, secret } = {}) {
  if (!operator || !secret) return false;
  const dev = await deviceId();
  _opKey = { operator, bytes: await deriveOperatorKeyBytes(operator, secret, dev) };
  return true;
}
export function lockOperator() { _opKey = null; }
export function operatorLocked() { const op = signedInOperator(); return !!op && !(_opKey && _opKey.operator === op); }

// activeRealm — an UNLOCKED operator → their κ realm (vault cipher); a guest OR a signed-in-but-locked
// session → the device realm (device cipher). So work is NEVER lost while locked, and a sign-in CLAIMS it.
async function activeRealm() {
  const op = signedInOperator();
  if (op && _opKey && _opKey.operator === op) return { realm: op, cipher: makeCipher(_opKey.bytes), operator: true };
  const dev = await deviceId();
  return { realm: guestRealm(dev), cipher: makeCipher(deviceKeyBytes()), operator: false };
}

// activeCipher — the current at-rest cipher for ANY module that needs to seal/open private data under the
// same key discipline as the experience manifest: the operator's vault cipher when unlocked, else the device
// cipher (guest/locked). So a store like holo-memory can encrypt-at-rest with ONE shared, sovereign key —
// nothing readable by a same-origin app, nothing leaves the device. Returns { realm, cipher, operator }.
export async function activeCipher() { return activeRealm(); }

export async function saveSnapshot(state) {
  const core = await bound(); const { realm, cipher } = await activeRealm(); const device = await deviceId();
  const res = await core.save({ ...state, realm, device, cipher, tab: TAB_ID, expectSeq: _seq[realm] });
  if (res && res.seq != null) _seq[realm] = res.seq;
  return res;
}
export async function restoreSnapshot() {
  const core = await bound(); const { realm, cipher } = await activeRealm(); const device = await deviceId();
  const head = core.readHead(realm); if (head && head.seq != null) _seq[realm] = head.seq;
  return core.restore({ realm, device, cipher });
}
export async function applyExperience(body) { return (await bound()).apply(body); }
export async function resetDevice() {
  const core = await bound(); const { realm } = await activeRealm(); core.reset(realm); return true;
}
// claimGuestRealm — on sign-in/unlock: if the (guest/locked) device realm has work, re-key it under the
// now-unlocked operator and consume it. Returns the claimed body (the live desktop carries straight over).
export async function claimGuestRealm() {
  const op = signedInOperator(); if (!op || !(_opKey && _opKey.operator === op)) return null;
  const core = await bound(); const device = await deviceId();
  return core.claim({ fromRealm: guestRealm(device), toRealm: op, device, fromCipher: makeCipher(deviceKeyBytes()), toCipher: makeCipher(_opKey.bytes), tab: TAB_ID });
}
// restoreOperator — after unlock, restore the operator's EXISTING sovereign realm (when there is no
// fresh guest work to claim). Returns the body or null.
export async function restoreOperator() {
  const op = signedInOperator(); if (!op || !(_opKey && _opKey.operator === op)) return null;
  const core = await bound(); const device = await deviceId();
  return core.restore({ realm: op, device, cipher: makeCipher(_opKey.bytes) });
}

// ── ADR-0105 (Workspace Sync) browser hooks — Holo Session is the SINGLE capture authority; these expose
//    the live PLAINTEXT manifest + a device-agnostic resume stash for the portable IPFS sealer + boot path.
export async function currentExperienceManifest({ tabs, activeTab } = {}) {
  const core = await bound();
  const device = await deviceId();
  const operator = signedInOperator() || device;
  return core.buildManifest({ operator, device, tabs: tabs || [], activeTab: activeTab | 0, settings: core.captureSettings() });
}
export function stashResume(body) { try { globalThis.localStorage.setItem("holo.session.resume", JSON.stringify(body)); return true; } catch { return false; } }
export function takeResume() {
  try { const ls = globalThis.localStorage; const s = ls.getItem("holo.session.resume"); if (!s) return null; ls.removeItem("holo.session.resume"); return JSON.parse(s); } catch { return null; }
}
