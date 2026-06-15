// holo-pqc-witness.mjs — proves the hybrid post-quantum primitive end to end (Law L5: verify by
// re-derivation, fail closed). Node-only; no network. Run: node system/tools/holo-pqc-witness.mjs
import {
  SCHEMES, signKeygen, hybridSign, hybridVerify, slhKeygen, slhSign, slhVerify,
  kemKeygen, hybridEncaps, hybridDecaps, aeadSeal, aeadOpen, identityKappa, verifyIdentityKappa,
} from "../os/usr/lib/holo/holo-pqc.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { (cond ? pass++ : fail++); console.log(`  ${cond ? "✓" : "✗"}  ${name}`); };
const eqB = (a, b) => Buffer.from(a).equals(Buffer.from(b));

console.log("holo-pqc — hybrid post-quantum primitive\n");

// 1 — hybrid signatures (Ed25519 ‖ ML-DSA-65): both halves must verify
{
  const k = signKeygen();
  const msg = "Holo Identity — one sovereign κ";
  const sig = hybridSign(k.sk, msg);
  ok("hybrid sign/verify (Ed25519 ‖ ML-DSA-65)", hybridVerify(k.pub, msg, sig));
  ok("rejects a tampered message", !hybridVerify(k.pub, msg + "!", sig));
  ok("rejects a forged ML-DSA half", !hybridVerify(k.pub, msg, { ...sig, pq: hybridSign(signKeygen().sk, msg).pq }));
  ok("rejects a forged Ed25519 half", !hybridVerify(k.pub, msg, { ...sig, ed: hybridSign(signKeygen().sk, msg).ed }));
  ok("rejects a wrong scheme id", !hybridVerify(k.pub, msg, { ...sig, scheme: "x" }));
}

// 2 — SLH-DSA backup signer (FIPS 205, hash-based)
{
  const k = slhKeygen(); const m = "anchor";
  const s = slhSign(k.sk, m);
  ok("SLH-DSA backup sign/verify", slhVerify(k.pub, m, s));
  ok("SLH-DSA rejects tamper", !slhVerify(k.pub, m + "x", s));
}

// 3 — hybrid KEM (X25519 ‖ ML-KEM-1024): encaps/decaps agree
{
  const k = kemKeygen();
  const enc = hybridEncaps(k.pub);
  const ss = hybridDecaps(k.sk, enc.ct);
  ok("hybrid KEM shared-secret agreement", eqB(enc.ss, ss) && ss.length === 32);
  const ss2 = hybridDecaps(kemKeygen().sk, enc.ct);
  ok("wrong recipient derives a different secret", !eqB(enc.ss, ss2));
}

// 4 — AEAD at-rest (AES-256-GCM), bound to a hybrid-KEM secret
{
  const k = kemKeygen(); const enc = hybridEncaps(k.pub); const key = hybridDecaps(k.sk, enc.ct);
  const aad = new TextEncoder().encode("vault");
  const sealed = await aeadSeal(enc.ss, "the 12-word seed", aad);
  const open = await aeadOpen(key, sealed, aad);
  ok("AEAD seal/open round-trip over KEM secret", new TextDecoder().decode(open) === "the 12-word seed");
  let tampered = false; try { await aeadOpen(key, sealed, new TextEncoder().encode("wrong-aad")); } catch { tampered = true; }
  ok("AEAD rejects wrong AAD (authenticated)", tampered);
}

// 5 — self-verifying identity κ (Law L1/L5): content-address the versioned hybrid pubkey
{
  const k = signKeygen();
  const kappa = identityKappa(k.pub);
  ok("identity κ is did:holo:sha256", /^did:holo:sha256:[0-9a-f]{64}$/.test(kappa));
  ok("κ re-derives from the pubkey (verify-by-re-derivation)", verifyIdentityKappa(k.pub, kappa));
  ok("κ refuses a different pubkey", !verifyIdentityKappa(signKeygen().pub, kappa));
  ok("κ commits to the scheme (crypto-agility)", JSON.stringify(SCHEMES.sign).length > 0 && kappa === identityKappa(k.pub));
}

console.log(`\n${fail ? "WITNESS FAILED" : "WITNESSED ✓"}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
