// holo-watchtower-witness.mjs — proves the on-device security audit flags weak/reused/old/breached
// passwords + 2FA-missing, scores health, and (live) audits a real vault handle. No egress.
//   node holo-watchtower-witness.mjs
import { strength, audit, auditVault } from "../os/usr/lib/holo/holo-watchtower.mjs";
import { enroll } from "../os/usr/lib/holo/holo-login.mjs";
import { openVault, forgetVault } from "../os/usr/lib/holo/holo-vault.mjs";

const r = {};
const now = Date.parse("2026-06-23T00:00:00Z");
const old = "2024-01-01T00:00:00Z";

const main = async () => {
  // strength scorer
  r.weakCommon = strength("password").label === "weak" && strength("123456").label === "weak";
  r.strongPassphrase = strength("Tr0ub4dour&3-Xq!92mz").label === "strong";

  // pure audit over a synthetic set
  const creds = [
    { id: "1", origin: "https://a.com", kind: "password", secret: "password", updatedAt: now }, // breached+weak+no2fa
    { id: "2", origin: "https://b.com", kind: "password", secret: "Re-Used-Pw-22!", updatedAt: now },
    { id: "3", origin: "https://c.com", kind: "password", secret: "Re-Used-Pw-22!", updatedAt: old }, // reused+old
    { id: "4", origin: "https://d.com", kind: "password", secret: "Z9$kqke!2mWvb3xLp", updatedAt: now }, // strong but no2fa
    { id: "5", origin: "https://d.com", kind: "totp", secret: "GEZDGNBVGY3TQOJQ", updatedAt: now },     // d.com HAS 2fa
  ];
  const rep = audit(creds, { now });
  const find = (id) => rep.items.find((x) => x.id === id);
  r.breachedFlagged = find("1") && find("1").issues.includes("breached") && find("1").issues.includes("weak") && find("1").issues.includes("no2fa");
  r.reusedFlagged = find("2") && find("2").issues.includes("reused") && find("3").issues.includes("reused");
  r.oldFlagged = find("3").issues.includes("old");
  r.no2faNudge = !!(find("2") && find("2").issues.includes("no2fa"));         // b.com password, no totp → nudge
  r.twofaSatisfied = !rep.items.some((i) => i.id === "4" && i.issues.includes("no2fa")); // d.com HAS a totp → no nudge
  r.summary = rep.summary.total === 4 && rep.summary.breached === 1 && rep.summary.reused === 2 && rep.summary.old === 1;
  r.scoreLow = rep.score < 70;                                 // a breached+reused vault scores poorly
  r.worstFirst = rep.items[0].id === "1";                      // breached entry sorts to the top

  // live: audit a real unlocked vault
  const OP = (await enroll({ label: "wt", secret: "wt-secret-0003", allowPhrase: true })).principal.kappa;
  await forgetVault(OP).catch(() => {});
  const v = await openVault(OP, "wt-secret-0003");
  await v.put({ origin: "https://weak.example", kind: "password", username: "x", secret: "qwerty" });
  await v.put({ origin: "https://strong.example", kind: "password", username: "y", secret: "Z9$kqke!2mWvb3xLp" });
  const live = auditVault(v, { now });
  r.liveAudit = live.summary.total === 2 && live.items.some((i) => i.origin === "https://weak.example" && i.issues.includes("weak"));

  r.ok = Object.values(r).every((x) => x === true);
  console.log("holo-watchtower witness:", JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
};
main().catch((e) => { console.error("WITNESS ERROR", e); process.exit(2); });
