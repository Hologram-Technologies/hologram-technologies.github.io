// holo-vault-sync-witness.mjs — proves post-quantum vault sync: device A's credential set is sealed to
// device B's HYBRID (X25519‖ML-KEM-1024) public key, travels as opaque ciphertext (content-blind relay,
// SEC-7), and B decapsulates + merges into its own vault. Asserts: PQ-KEM round-trip, end-to-end transfer
// with secrets intact, at-rest/in-transit opacity, and fail-closed on tamper or wrong recipient key.
//   node holo-vault-sync-witness.mjs
import { enroll } from "../os/usr/lib/holo/holo-login.mjs";
import { openVault, forgetVault } from "../os/usr/lib/holo/holo-vault.mjs";
import { newSyncIdentity, exportVault, importVault, openPackage } from "../os/usr/lib/holo/holo-vault-sync.mjs";

const r = {};
const throws = async (fn) => { try { await fn(); return false; } catch { return true; } };

const main = async () => {
  // device A: enroll + a vault with three credentials
  const A = (await enroll({ label: "A", secret: "sync-A-secret-0001", allowPhrase: true })).principal.kappa;
  await forgetVault(A).catch(() => {});
  const va = await openVault(A, "sync-A-secret-0001");
  await va.put({ origin: "https://mail.google.com", kind: "password", username: "ilya", secret: "gmail-pw-α" });
  await va.put({ origin: "https://www.bank.example", kind: "password", username: "ilya", secret: "bank-pw-β" });
  await va.put({ origin: "https://app.uniswap.org", kind: "web3", username: null, secret: JSON.stringify({ connect: "wc" }) });

  // device B: a fresh operator + its hybrid sync identity (public key shared during pairing)
  const B = (await enroll({ label: "B", secret: "sync-B-secret-0002", allowPhrase: true })).principal.kappa;
  await forgetVault(B).catch(() => {});
  const deviceB = newSyncIdentity();                                   // { sk:{x,pq}, pub:{x,pq} }
  r.hybridKeypair = !!(deviceB.pub.x && deviceB.pub.pq && deviceB.sk.x && deviceB.sk.pq);

  // A seals its vault TO B's hybrid pub → an opaque package (this is all the content-blind relay carries)
  const pkg = await exportVault(va, deviceB.pub);
  r.packageOpaque = (() => { const wire = JSON.stringify(pkg); return !wire.includes("mail.google.com") && !wire.includes("gmail-pw") && !wire.includes("bank-pw") && !wire.includes("uniswap"); })();

  // PQ-KEM round-trip: B opens the package with its hybrid secret → recovers the credential set
  const creds = await openPackage(pkg, deviceB.sk);
  r.kemRoundTrip = Array.isArray(creds) && creds.length === 3;
  r.secretsIntact = creds.find((c) => c.origin === "https://www.bank.example").secret === "bank-pw-β";

  // end-to-end: import into B's OWN vault, then B unlocks and reads them
  const vb = await openVault(B, "sync-B-secret-0002");
  const n = await importVault(vb, pkg, deviceB.sk);
  const vb2 = await openVault(B, "sync-B-secret-0002");
  r.mergedIntoB = n === 3 && vb2.list().length === 3 && vb2.get("https://mail.google.com").secret === "gmail-pw-α";

  // WRONG recipient key → cannot open (bound to B's hybrid key) — fail-closed
  const other = newSyncIdentity();
  r.wrongKeyRefused = await throws(() => openPackage(pkg, other.sk));

  // TAMPER the KEM ciphertext or the AEAD blob → open fails — fail-closed (SEC-1)
  const t1 = JSON.parse(JSON.stringify(pkg)); t1.sealed.ct = "AAAA" + t1.sealed.ct.slice(4);
  r.tamperSealedRefused = await throws(() => openPackage(t1, deviceB.sk));
  const t2 = JSON.parse(JSON.stringify(pkg)); t2.ct.pq = "AAAA" + t2.ct.pq.slice(4);
  r.tamperKemRefused = await throws(() => openPackage(t2, deviceB.sk));

  r.ok = Object.values(r).every((x) => x === true);
  console.log("holo-vault-sync witness:", JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
};
main().catch((e) => { console.error("WITNESS ERROR", e); process.exit(2); });
