// Witness: the "Sign in does nothing" fix. Under holo:// the RP ID is "os" (single-label) → Chromium rejects
// the WebAuthn ceremony, so teeEnroll/teeAssert must run in the localhost broker. This proves:
//  (1) ROUND-TRIP: an operator enrolled with the PRF secret as a base64url STRING (the greeter's form) unlocks
//      with that SAME string (the shell's form after the fix) — and FAILS with the old bytes form (the bug).
//  (2) WIRING: teeEnroll/teeAssert route through the broker only on the native κ-scheme; the broker replies with
//      the FULL result verbatim (credentialId kept, secret not double-encoded); the shell returns the string.
import { enroll, unlockSeed } from "../os/usr/lib/holo/holo-login.mjs";
import fs from "node:fs";
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

async function main() {
  const r = {};
  // ── (1) secret-FORM round-trip — the correctness crux of the fix ──────────────────────────────────
  const prfSecret = "Zm9vYmFyYmF6cHJmc2VjcmV0dmFsdWUtMTIz";        // a base64url PRF output, exactly as teeEnroll returns it
  const { principal } = await enroll({ label: "You", secret: prfSecret, allowPhrase: true });  // greeter: passphrase = the STRING
  r.enroll_minted = !!(principal && principal.kappa);
  const seed = await unlockSeed(principal.kappa, prfSecret);       // shell unlock with the SAME string form (post-fix)
  r.unlock_sameStringForm = !!(seed && seed.length === 64);        // vaultKey = SHA-256(String(secret)) → matches → real seed
  // the OLD shell path returned u2bytes(secret); String(Uint8Array) = "102,111,..." ≠ the string → MUST fail
  const bytesForm = Uint8Array.from(prfSecret, (c) => c.charCodeAt(0));
  r.unlock_bytesFormRefused = await unlockSeed(principal.kappa, bytesForm).then((s) => !s, () => true);

  // ── (2) wiring is in the sealed source ────────────────────────────────────────────────────────────
  const wa = read("../os/usr/lib/holo/holo-webauthn.mjs");
  // NATIVE path PREFERRED (OS dialog via cefQuery, no iframe), broker as fallback, direct preserved.
  r.wire_enrollNative = wa.includes('if (nativeHello()) return helloCall("enroll"');
  r.wire_assertNative = wa.includes('return helloCall("assert"');
  r.wire_brokerFallback = wa.includes('if (nativeHost()) return brokerCall("enroll"') && wa.includes('brokerCall("assert"');
  r.wire_directPreserved = wa.includes("async function _teeEnrollDirect(") && wa.includes("async function _teeAssertDirect(");
  r.wire_reasonNative = wa.includes('if (nativeHello()) return "";');
  const broker = read("../os/usr/share/frame/stepup-broker.html");
  r.wire_brokerVerbatim = broker.includes("reply(m.id, { ok: true, ...a });") && broker.includes("reply(m.id, { ok: true, ...en });") && !broker.includes("b2u(a.secret");
  const shell = read("../os/usr/share/frame/shell.html");
  r.wire_shellReturnsString = shell.includes('return r.secret;   // the base64url PRF string verbatim');
  // ── (3) native host wiring: the cefQuery verb, the webauthn.dll module, and the build are all present ──
  const handler = read("../../../holo-apps/apps/tauri/cef-host/src/handler.cc");
  r.host_helloVerb = handler.includes('req.rfind("holo:hello:", 0) == 0') && handler.includes("holo::HelloEnroll") && handler.includes("holo::HelloAssert") && handler.includes("GetWindowHandle()");
  const hello = read("../../../holo-apps/apps/tauri/cef-host/src/holo_hello.cc");
  r.host_helloUsesHmacSecret = hello.includes("WEBAUTHN_EXTENSIONS_IDENTIFIER_HMAC_SECRET") && hello.includes("WebAuthNAuthenticatorMakeCredential") && hello.includes("pHmacSecretSaltValues");
  const cmake = read("../../../holo-apps/apps/tauri/cef-host/CMakeLists.txt");
  r.host_helloInBuild = cmake.includes("src/holo_hello.cc");

  r.ok = Object.entries(r).every(([k, v]) => k === "ok" || v === true);
  console.log("holo-greeter-broker (sign-in fix) witness:", JSON.stringify(r, null, 2));
  if (!r.ok) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(2); });
