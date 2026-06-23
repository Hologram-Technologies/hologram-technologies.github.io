// holo-vault-witness.mjs — proves Holo Pass (the κ-substrate-rooted, signed, epoch-sealed credential
// chain) against the CANONICAL identity stack under Node. Asserts what the substrate REFUSES (the
// holospaces vv pattern): tamper, forged signature, reorder/drop, over-quota, plus L5 re-derivation,
// at-rest opacity, autofill, fail-closed reveal, and epoch separation (forward secrecy).
//   node holo-vault-witness.mjs
import { enroll, unlock } from "../os/usr/lib/holo/holo-login.mjs";
import { openVault, hasVault, __rawChain, __putRawChain } from "../os/usr/lib/holo/holo-vault.mjs";

const SECRET = "vault-witness-prf-secret-0001";   // stands in for the enclave PRF output
const r = {};
const clone = (x) => JSON.parse(JSON.stringify(x));
const throws = async (fn) => { try { await fn(); return false; } catch { return true; } };

const main = async () => {
  const { principal } = await enroll({ label: "operator", secret: SECRET, allowPhrase: true });
  const OP = principal.kappa;
  r.enrolled = /^did:holo:sha256:[0-9a-f]{64}$/.test(OP);
  r.noVaultYet = (await hasVault(OP)) === false;

  // store web2 pw + web2 passkey + web3 via the ONE gate
  const v = await openVault(OP, SECRET);
  await v.put({ origin: "https://mail.google.com", kind: "password", username: "ilya@uor.foundation", secret: "hunter2-correct-horse" });
  await v.put({ origin: "https://www.linkedin.com", kind: "passkey", username: "ilya", secret: JSON.stringify({ credentialId: "ZmFrZQ" }) });
  await v.put({ origin: "https://app.uniswap.org", kind: "web3", username: null, secret: JSON.stringify({ chain: "ethereum", connect: "walletconnect" }) });
  r.hasVaultNow = (await hasVault(OP)) === true;
  r.headKappa = /^did:holo:sha256:[0-9a-f]{64}$/.test(v.headKappa());   // head attests the whole chain

  // metadata-only list; autofill get() returns the secret; identity re-derives
  const listed = v.list();
  r.listCount = listed.length === 3;
  r.listNoSecrets = listed.every((e) => !("secret" in e));
  const g = v.get("https://mail.google.com");
  r.autofill = g && g.username === "ilya@uor.foundation" && g.secret === "hunter2-correct-horse";

  // AT-REST OPACITY (SEC-5): the stored chain has NO cleartext origin or secret — only κs/sigs/sealed bytes
  const raw = await __rawChain(OP);
  const wire = JSON.stringify(raw);
  r.atRestOpaque = !wire.includes("mail.google.com") && !wire.includes("hunter2") && !wire.includes("uniswap");

  // re-open verifies the WHOLE signed chain + decrypts; persists across unlock; identity re-derives (L5)
  const v2 = await openVault(OP, SECRET);
  r.persistAcrossUnlock = v2.list().length === 3 && v2.get("https://app.uniswap.org").kind === "web3";
  r.identityReDerives = (await unlock(OP, SECRET)).kappa === OP;

  // EPOCH ROTATION → forward secrecy: put under epoch0, rotate, put under epoch1; events carry distinct epochs
  await v2.rotateEpoch();
  await v2.put({ origin: "https://news.ycombinator.com", kind: "password", username: "ilya", secret: "pg-rules" });
  const raw2 = await __rawChain(OP);
  const epochs = new Set(raw2.events.filter((e) => e.kind === "credential.put").map((e) => e.epoch));
  r.epochRotated = epochs.has(0) && epochs.has(1);
  r.decryptsAcrossEpochs = (await openVault(OP, SECRET)).list().length === 4;   // per-event epoch key derivation

  const good = clone(await __rawChain(OP));   // known-good chain to restore between refusal cases
  const restore = async () => __putRawChain(clone(good));

  // ── REFUSALS (assert the substrate rejects) ──
  // 1) TAMPER a sealed payload → event κ no longer re-derives (SEC-1) → openVault throws
  { const t = clone(good); const i = t.events.findIndex((e) => e.sealed); t.events[i].sealed = "AAAA" + t.events[i].sealed.slice(4); await __putRawChain(t); r.tamperRefused = await throws(() => openVault(OP, SECRET)); await restore(); }

  // 2) FORGED signature: corrupt sig (body+id intact) → sovereign-sig verify fails (SEC-4) → throws
  { const t = clone(good); t.events[1].sig = "AAAA" + t.events[1].sig.slice(4); await __putRawChain(t); r.forgeRefused = await throws(() => openVault(OP, SECRET)); await restore(); }

  // 3) REORDER/DROP: swap two events → parent links break (SEC-1) → throws
  { const t = clone(good); const a = t.events[1]; t.events[1] = t.events[2]; t.events[2] = a; await __putRawChain(t); r.reorderRefused = await throws(() => openVault(OP, SECRET)); await restore(); }

  // 4) OVER-QUOTA (SEC-8): an oversized secret is refused at put
  { const v3 = await openVault(OP, SECRET); r.overSizeRefused = await throws(() => v3.put({ origin: "https://big.example", kind: "password", secret: "x".repeat(200000) })); await restore(); }

  // 5) WRONG secret cannot open the vault (canonical unlock / AEAD) — fail-closed
  r.wrongSecretRefused = await throws(() => openVault(OP, "WRONG-secret-zzzz"));

  // 6) REVEAL to the human is STEP-UP gated → under Node (no TEE) it FAILS-CLOSED
  { const v4 = await openVault(OP, SECRET); r.revealGatedFailClosed = await (async () => { try { await v4.revealSecret(v4.list()[0].id, {}); return false; } catch (e) { return /step-up|unavailable|TEE|biometric/i.test(String(e.message || e)); } })(); }

  r.ok = Object.values(r).every((x) => x === true);
  console.log("holo-vault witness:", JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
};
main().catch((e) => { console.error("WITNESS ERROR", e); process.exit(2); });
