// holo-verify.mjs - verify-your-contact for Holo Direct: make the E2E privacy CHECKABLE, and stop a silent
// man-in-the-middle. Two tools:
//   1) a SAFETY NUMBER - a symmetric, order-independent fingerprint of the *pair* of identities. Alice and Bob compute
//      the exact same code from each other's public keys; comparing it once (read it aloud, or scan a QR) proves no one
//      swapped a key in the middle. Rendered as 60 digits (à la Signal) and as an emoji strip for quick visual compare.
//   2) a TRUST STORE (TOFU) - remember a contact's identity key on first contact; if it ever CHANGES, raise a warning
//      and drop "verified" until the user re-checks. That change is exactly what a MITM attack looks like.
//
// Pure logic over public keys + a small persisted map - no secrets here. The store persists (localStorage in the app;
// inject {load,save} for tests) so key-change detection survives across sessions.

const _te = new TextEncoder();
const _s = () => (globalThis.crypto && globalThis.crypto.subtle) || (typeof crypto !== "undefined" && crypto.subtle);
async function _sha256hex(str) { const h = await _s().digest("SHA-256", _te.encode(str)); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
const _idStr = (pub) => (pub.sign || "") + "|" + (pub.box || "");

// symmetric fingerprint of the PAIR - sorted so it's identical whichever side computes it.
export async function safetyNumber(pubA, pubB) {
  const [x, y] = [_idStr(pubA), _idStr(pubB)].sort();
  return _sha256hex("holo-safety-v1|" + x + "|" + y);
}
// 60 decimal digits, 12 groups of 5 - read-aloud friendly, matches the Signal shape.
export function safetyDigits(hex) {
  const g = []; for (let i = 0; i < 12; i++) g.push((parseInt(hex.substr(i * 5, 5), 16) % 100000).toString().padStart(5, "0"));
  return g.join(" ");
}
const _EMOJI = ["🐌","🦋","🌵","🍎","🚀","🎈","🔑","🌙","🍀","🐳","🔥","🎸","🍄","⚡","🌈","🦊","🐙","🌻","🍉","🎯","🛸","🏔","🦜","🐧","🧭","🕰","🎨","🎲","🧩","🪁","🦩","🌊","🍇","🐝","🎃","🌷","🦉","🌸","🍔","🎁","🚲","🗝","🪺","🦈","🌮","🐢","🎺","🧊","🌴","🍕","🦚","🌟","🍩","🐬","🎬","🧸","🌺","🍭","🦭","🍋","🥁","🌞","🍒","🐣"];
// 8 emojis from an 8-byte window - a glance-comparable strip. (falls back to digits for the definitive check)
export function safetyEmojis(hex) { const out = []; for (let i = 0; i < 8; i++) { const byte = parseInt(hex.substr(i * 2, 2), 16); out.push(_EMOJI[byte % _EMOJI.length]); } return out.join(" "); }

// ── trust store (TOFU + key-change detection) ──
export function makeTrustStore({ load = null, save = null } = {}) {
  let contacts = {};
  try { contacts = (load ? load() : (typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem("holo.direct.trust") || "{}") : {})) || {}; } catch { contacts = {}; }
  function _persist() { try { if (save) save(contacts); else if (typeof localStorage !== "undefined") localStorage.setItem("holo.direct.trust", JSON.stringify(contacts)); } catch {} }

  // read-only: what's the trust status of `pub` for contact `id`? Never mutates.
  function check(id, pub) {
    const key = _idStr(pub), cur = contacts[id];
    if (!cur) return { status: "new", verified: false };
    if (cur.key === key) return { status: "same", verified: !!cur.verified };
    return { status: "changed", verified: false, wasVerified: !!cur.verified };   // ⚠ looks like a MITM - warn + block trust
  }
  // record a key. On "new" this is TOFU (trust on first use). For a CHANGED key, only call after the user ACCEPTS the
  // change (e.g. re-verified out-of-band) - it resets verified:false so they must re-check.
  function record(id, pub) {
    const key = _idStr(pub), cur = contacts[id];
    if (cur && cur.key === key) return contacts[id];
    contacts[id] = { key, verified: false, firstSeen: cur ? cur.firstSeen : Date.now(), changedAt: cur ? Date.now() : null };
    _persist(); return contacts[id];
  }
  function markVerified(id) { if (contacts[id]) { contacts[id].verified = true; _persist(); } }
  return { check, record, markVerified, get: (id) => contacts[id] || null, all: () => ({ ...contacts }) };
}
