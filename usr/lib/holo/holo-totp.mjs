// holo-totp.mjs — built-in 2FA: RFC 6238 TOTP / RFC 4226 HOTP, so Holo Pass replaces a separate
// authenticator app. The TOTP secret is just another vault credential (kind:"totp"); the code is
// generated on-device and (with autofill) typed for you — one biometric, no phone juggling. Pure JS over
// SubtleCrypto HMAC (no new crypto). Supports otpauth:// URIs (what sites' QR codes encode).

const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;

// RFC 4648 base32 decode (TOTP secrets are base32, case-insensitive, '=' padding optional).
export function base32decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(s).toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0, val = 0; const out = [];
  for (const c of clean) { const i = A.indexOf(c); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { bits -= 8; out.push((val >>> bits) & 0xff); } }
  return new Uint8Array(out);
}

const ALGO = { "SHA1": "SHA-1", "SHA256": "SHA-256", "SHA512": "SHA-512" };

// HOTP(counter) — RFC 4226 dynamic truncation.
async function hotp(keyBytes, counter, digits, algo) {
  const ctr = new Uint8Array(8); let n = BigInt(counter); for (let i = 7; i >= 0; i--) { ctr[i] = Number(n & 0xffn); n >>= 8n; }
  const key = await SUB.importKey("raw", keyBytes, { name: "HMAC", hash: ALGO[algo] || "SHA-1" }, false, ["sign"]);
  const h = new Uint8Array(await SUB.sign("HMAC", key, ctr));
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

// TOTP for a base32 secret. opts: { t (unix seconds), step=30, digits=6, algo="SHA1" }.
export async function totp(secretBase32, { t = Math.floor(Date.now() / 1000), step = 30, digits = 6, algo = "SHA1" } = {}) {
  return hotp(base32decode(secretBase32), Math.floor(t / step), digits, algo);
}
export function remainingSeconds(step = 30, t = Math.floor(Date.now() / 1000)) { return step - (t % step); }

// parse an otpauth://totp/Label?secret=...&issuer=...&digits=...&period=...&algorithm=... URI (QR payload)
export function parseOtpauth(uri) {
  const m = /^otpauth:\/\/(totp|hotp)\/([^?]*)\?(.*)$/i.exec(String(uri || ""));
  if (!m) throw new Error("totp: not an otpauth URI");
  const q = Object.fromEntries(new URLSearchParams(m[3]));
  if (!q.secret) throw new Error("totp: otpauth missing secret");
  return { type: m[1].toLowerCase(), label: decodeURIComponent(m[2] || ""), secret: q.secret, issuer: q.issuer || null, digits: +(q.digits || 6), period: +(q.period || 30), algorithm: (q.algorithm || "SHA1").toUpperCase() };
}

// generate the current code for a vault entry of kind "totp" (entry.secret = base32 OR an otpauth URI).
export async function codeForEntry(entry, t) {
  if (!entry || entry.kind !== "totp") return null;
  let cfg = { secret: entry.secret, digits: 6, period: 30, algorithm: "SHA1" };
  if (/^otpauth:/i.test(entry.secret)) { const p = parseOtpauth(entry.secret); cfg = { secret: p.secret, digits: p.digits, period: p.period, algorithm: p.algorithm }; }
  const code = await totp(cfg.secret, { t, step: cfg.period, digits: cfg.digits, algo: cfg.algorithm });
  return { code, remaining: remainingSeconds(cfg.period, t) };
}
