// holo-totp-witness.mjs — proves the 2FA engine against the OFFICIAL RFC 6238 Appendix-B test vectors
// (secret "12345678901234567890" → base32 GEZD…, SHA-1), plus otpauth:// parsing + entry codes.
//   node holo-totp-witness.mjs
import { totp, base32decode, parseOtpauth, codeForEntry, remainingSeconds } from "../os/usr/lib/holo/holo-totp.mjs";

const SEC = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";   // base32("12345678901234567890")
const r = {};

const main = async () => {
  r.base32 = new TextDecoder().decode(base32decode(SEC)) === "12345678901234567890";
  // RFC 6238 Appendix B (SHA-1, 8 digits)
  r.v59 = (await totp(SEC, { t: 59, digits: 8 })) === "94287082";
  r.v1111111109 = (await totp(SEC, { t: 1111111109, digits: 8 })) === "07081804";
  r.v1234567890 = (await totp(SEC, { t: 1234567890, digits: 8 })) === "89005924";
  r.v2000000000 = (await totp(SEC, { t: 2000000000, digits: 8 })) === "69279037";
  r.v20000000000 = (await totp(SEC, { t: 20000000000, digits: 8 })) === "65353130";
  // 6-digit is the low 6 of the 8-digit
  r.sixDigit = (await totp(SEC, { t: 59, digits: 6 })) === "287082";
  // otpauth URI parse
  const p = parseOtpauth("otpauth://totp/GitHub:ilya?secret=" + SEC + "&issuer=GitHub&digits=6&period=30&algorithm=SHA1");
  r.otpauth = p.secret === SEC && p.issuer === "GitHub" && p.digits === 6 && p.type === "totp";
  // codeForEntry over a vault entry of kind "totp" (base32 and otpauth forms agree at the same time)
  const a = await codeForEntry({ kind: "totp", secret: SEC }, 1234567890);
  const b = await codeForEntry({ kind: "totp", secret: "otpauth://totp/x?secret=" + SEC }, 1234567890);
  r.entryCode = a.code === "005924" && b.code === "005924" && a.remaining === remainingSeconds(30, 1234567890);
  r.nonTotpNull = (await codeForEntry({ kind: "password", secret: "x" }, 0)) === null;

  r.ok = Object.values(r).every((x) => x === true);
  console.log("holo-totp witness:", JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
};
main().catch((e) => { console.error("WITNESS ERROR", e); process.exit(2); });
