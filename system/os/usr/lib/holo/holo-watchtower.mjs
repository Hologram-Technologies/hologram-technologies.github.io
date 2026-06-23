// holo-watchtower.mjs — proactive, ON-DEVICE security audit of the Holo Pass vault. Runs entirely local
// (no egress, SEC-7): flags weak, reused, and old passwords, common-breach matches, and logins missing
// 2FA. The magical "your security at a glance" with zero data leaving the device. (An optional HIBP
// k-anonymity range check — leaks only a 5-char SHA-1 prefix — is a SEPARATE, egress-gated add, not here.)

// a tiny embedded set of the most common breached passwords (offline signal; the full corpus is the
// optional egress-gated HIBP check). Lowercased.
const COMMON = new Set(["123456", "123456789", "password", "qwerty", "12345678", "111111", "123123", "abc123", "1234567", "password1", "iloveyou", "admin", "welcome", "monkey", "letmein", "dragon", "000000", "qwerty123", "1q2w3e4r", "trustno1", "sunshine", "master", "hello123", "passw0rd", "football"]);

// password strength → 0..100 + label. Length-led, class diversity, penalties for repeats/sequences/common.
export function strength(pw) {
  if (!pw) return { score: 0, label: "empty" };
  let s = Math.min(pw.length, 24) * 4;
  if (/[a-z]/.test(pw)) s += 8; if (/[A-Z]/.test(pw)) s += 8; if (/[0-9]/.test(pw)) s += 8; if (/[^A-Za-z0-9]/.test(pw)) s += 14;
  if (/(.)\1\1/.test(pw)) s -= 15;                                      // 3+ repeats
  if (/0123|1234|2345|3456|abcd|qwert|asdf/i.test(pw)) s -= 20;          // sequences
  if (COMMON.has(pw.toLowerCase())) s = Math.min(s, 5);                  // common = effectively broken
  s = Math.max(0, Math.min(100, s));
  return { score: s, label: s < 40 ? "weak" : s < 70 ? "fair" : "strong" };
}

const DAY = 86400000;

// audit a credential set (pure). creds: [{id, origin, kind, username, secret, updatedAt}]. Returns a report.
// opts: { now (ms), oldDays=365 }.
export function audit(creds, { now = Date.now(), oldDays = 365 } = {}) {
  const pwd = creds.filter((c) => c.kind === "password" || c.kind === "web3");
  // reuse map: which secret appears in >1 entry
  const bySecret = new Map();
  for (const c of pwd) if (c.secret) { const k = c.secret; bySecret.set(k, (bySecret.get(k) || 0) + 1); }
  const totpOrigins = new Set(creds.filter((c) => c.kind === "totp").map((c) => c.origin));

  const items = [];
  let weak = 0, reused = 0, old = 0, breached = 0, no2fa = 0;
  for (const c of pwd) {
    const issues = [];
    const st = strength(c.secret || "");
    if (st.label === "weak") { issues.push("weak"); weak++; }
    if (c.secret && bySecret.get(c.secret) > 1) { issues.push("reused"); reused++; }
    if (c.updatedAt && now - Date.parse(c.updatedAt) > oldDays * DAY) { issues.push("old"); old++; }
    if (c.secret && COMMON.has(String(c.secret).toLowerCase())) { issues.push("breached"); breached++; }
    if (c.kind === "password" && !totpOrigins.has(c.origin)) { issues.push("no2fa"); no2fa++; }
    if (issues.length) items.push({ id: c.id, origin: c.origin, strength: st, issues });
  }
  const total = pwd.length;
  // health score: start 100, subtract weighted penalties (bounded)
  const penalty = breached * 25 + weak * 12 + reused * 10 + old * 4 + no2fa * 3;
  const score = total ? Math.max(0, 100 - Math.min(100, Math.round(penalty / Math.max(1, total) * 1.4 + (breached ? 20 : 0)))) : 100;
  return { score, summary: { total, weak, reused, old, breached, no2fa }, items: items.sort((a, b) => severity(b) - severity(a)) };
}
function severity(it) { const w = { breached: 4, weak: 3, reused: 2, no2fa: 1, old: 1 }; return it.issues.reduce((s, k) => s + (w[k] || 0), 0); }

// audit an unlocked vault handle (pulls the live set).
export function auditVault(handle, opts) {
  const creds = handle.list().map((m) => { const e = handle.get(m.id); return { id: e.id, origin: e.origin, kind: e.kind, username: e.username, secret: e.secret, updatedAt: e.updatedAt }; });
  return audit(creds, opts);
}
