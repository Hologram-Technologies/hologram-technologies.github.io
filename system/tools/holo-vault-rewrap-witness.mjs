// holo-vault-rewrap-witness.mjs — proves the vault TEE-only rewrap migration (hologram-auth-vault-rewrap-
// plan.md) against the REAL holo-login + WDK vault. Two layers:
//   INVARIANTS (#1–#3) — the load-bearing properties the migration rests on (no behaviour change needed).
//   STAGES (S1/S2/S3/S4) — the implemented guards, exercised via the __setTeeAvailable test seam (the
//     TEE-only guards are browser-gated; this stubs "a TEE is present" so Node can prove the LOGIC; the
//     physical biometric ceremony itself is device-proven).
// Hermetic Node, fail-closed (nonzero on any miss). The 12-word phrase is the only recovery — every stage
// keeps it, and re-wrap is verified κ-stable BEFORE persisting (no lockout window).

import * as login from "../os/usr/lib/holo/holo-login.mjs";

const b64 = (u) => Buffer.from(u).toString("base64");
const prfLike = () => b64(crypto.getRandomValues(new Uint8Array(32)));   // a 32-byte enclave-grade secret
const wrapOf = async (kappa) => (await login.roster()).find((o) => o.kappa === kappa)?.wrap;

let pass = 0, fail = 0; const rows = [];
const W = (claim, ok) => { rows.push({ claim, ok: !!ok }); ok ? pass++ : fail++; };
const throws = async (fn) => { try { await fn(); return false; } catch { return true; } };

(async () => {
  login.__setTeeAvailable(async () => false);   // default: off-device (guards inert) for the invariant layer

  // ── INVARIANTS ────────────────────────────────────────────────────────────────────────────────
  const secretA = prfLike();
  const { principal, mnemonic } = await login.enroll({ label: "rewrap-witness", secret: secretA, cred: "cred-A", credPub: "pubA" });
  const kappa = principal.kappa;
  W("vault opens with the exact enrolling secret", (await login.unlock(kappa, secretA)).kappa === kappa);
  W("vault REFUSES a typed passphrase (≠ the PRF secret)", await throws(() => login.unlock(kappa, "hunter2-correct-horse")));
  W("vault REFUSES a different high-entropy secret", await throws(() => login.unlock(kappa, prfLike())));

  const secretB = prfLike();
  const reco = await login.recover({ mnemonic, secret: secretB, cred: "cred-A" });
  W("re-wrap preserves κ (seed/identity unchanged)", reco.principal.kappa === kappa);
  W("re-wrapped vault opens with the NEW secret", (await login.unlock(kappa, secretB)).kappa === kappa);
  W("re-wrapped vault no longer opens with the OLD secret", await throws(() => login.unlock(kappa, secretA)));
  W("re-wrap preserves the wallet address (seed-derived)", (await login.unlock(kappa, secretB)).address("ethereum") === reco.principal.address("ethereum"));
  await login.forget(kappa);
  W("recovery from the 12 words yields the SAME κ", (await login.recover({ mnemonic, secret: prfLike(), cred: "cred-A" })).principal.kappa === kappa);
  await login.forget(kappa);

  // ── S1: wrap tag ────────────────────────────────────────────────────────────────────────────────
  const tee = await login.enroll({ label: "tee-op", secret: prfLike(), cred: "cred-T" });
  W("S1: cred-bearing enrol is tagged wrap:\"tee\"", (await wrapOf(tee.principal.kappa)) === "tee");
  const ph = await login.enroll({ label: "phrase-op", secret: "a-typed-secret", allowPhrase: true });
  W("S1: no-cred (allowPhrase) enrol is tagged wrap:\"phrase\"", (await wrapOf(ph.principal.kappa)) === "phrase");

  // ── S2: refuse minting a passphrase vault on a TEE device ─────────────────────────────────────────
  login.__setTeeAvailable(async () => true);
  W("S2: no-cred enrol on a TEE device is REFUSED", await throws(() => login.enroll({ label: "x", secret: "typed" })));
  W("S2: cred enrol on a TEE device still succeeds", !!(await login.enroll({ label: "y", secret: prfLike(), cred: "cred-Y" })).principal);
  W("S2: explicit allowPhrase (headless) still permitted", !!(await login.enroll({ label: "z", secret: "typed", allowPhrase: true })).principal);

  // ── S4: a phrase vault refuses seed/phrase exposure on a TEE device (until upgraded) ──────────────
  const legacyKappa = ph.principal.kappa;   // wrap:"phrase" from S1
  W("S4: unlockSeed REFUSES a phrase vault on a TEE device", await throws(() => login.unlockSeed(legacyKappa, "a-typed-secret")));
  W("S4: revealMnemonic REFUSES a phrase vault on a TEE device", await throws(() => login.revealMnemonic(legacyKappa, "a-typed-secret")));

  // ── S3: transparent re-wrap upgrade — phrase → tee, κ-stable, then sensitive ops work ─────────────
  const teeSecret = prfLike();
  const up = await login.upgradeWrap(legacyKappa, "a-typed-secret", teeSecret, "cred-upgraded");
  W("S3: upgrade flips wrap to \"tee\"", up.wrap === "tee" && (await wrapOf(legacyKappa)) === "tee");
  W("S3: upgrade preserves κ", (await login.unlock(legacyKappa, teeSecret)).kappa === legacyKappa);
  W("S3: upgrade re-keys (old typed secret no longer opens it)", await throws(() => login.unlock(legacyKappa, "a-typed-secret")));
  W("S4 after upgrade: unlockSeed now succeeds (tee vault)", (await login.unlockSeed(legacyKappa, teeSecret)).length > 0);
  W("S4 after upgrade: revealMnemonic returns the SAME (unchanged) phrase", (await login.revealMnemonic(legacyKappa, teeSecret)) === ph.mnemonic);
  W("S3: upgrade is idempotent on a tee vault (no-op without new cred)", (await login.upgradeWrap(legacyKappa, teeSecret, teeSecret)).wrap === "tee");

  login.__setTeeAvailable(async () => false);
  console.log("\nholo-vault-rewrap (invariants + stages S1–S4):");
  for (const r of rows) console.log(`  [${r.ok ? "✓" : "✗"}] ${r.claim}`);
  console.log(`\n${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED (S2/S3/S4 logic proven; the biometric ceremony + holo-sddm upgrade wiring are device-proven)"}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("witness crashed:", e && e.stack || e); process.exit(2); });
