// range-proof-witness.mjs — B3 authority: transparent NUMERIC predicate proofs end-to-end through holo-proof.
// Prove "age ≥ 18" / "balance ∈ [a,b]" WITHOUT revealing the value, as a κ-addressable proof — no trusted
// setup, no SNARK, no vendored curve (Pedersen over RFC 3526 + bit-decomposition OR-proofs). Witnesses:
//   • the predicate VERIFIES, and verifyProof returns ONLY the fact (no value);
//   • a FALSE predicate cannot be honestly proven, and a re-labelled proof is REJECTED (soundness);
//   • the proof is ZERO-KNOWLEDGE (no plaintext value) and κ re-derives (tamper-refuse);
//   • shareProof is CONSENT-GATED and names "the value is NOT revealed".
import { provePredicate, verifyProof, shareProof, decodeProofLink } from "./usr/lib/holo/holo-proof.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "  ok  " : "  XX  ") + m); c ? pass++ : fail++; };
const N = 8;   // small bit-width keeps the witness fast (2048-bit modexp); the API default is 32

(async () => {
  // 1. age ≥ 18 (you are 21): verifies, and the verifier learns ONLY the predicate
  const p = provePredicate({ value: 21, op: "ge", bound: 18, n: N });
  const v = await verifyProof(p);
  ok(v && v.ok && v.predicate && v.predicate.claim === "≥ 18", `age ≥ 18 verifies → learns only the fact (${v && v.predicate && v.predicate.claim})`);
  ok(!("value" in (v || {})) && v.predicate && !("value" in v.predicate), "verified result carries NO value — only the predicate");

  // 2. zero-knowledge: the proof bytes never contain the secret value 21
  ok(!JSON.stringify(p).includes("\"21\"") && !JSON.stringify(p).includes(":21,"), "proof is zero-knowledge (no plaintext value 21)");

  // 3. boundary: 18 ≥ 18 holds
  ok(await verifyProof(provePredicate({ value: 18, op: "ge", bound: 18, n: N })).then((r) => !!(r && r.ok)), "18 ≥ 18 holds (inclusive bound)");

  // 4. soundness — a FALSE statement cannot be honestly proven
  let refused = false; try { provePredicate({ value: 16, op: "ge", bound: 18, n: N }); } catch (e) { refused = true; }
  ok(refused, "16 ≥ 18 is REFUSED — an honest prover cannot prove a false predicate");

  // 5. soundness — a real "≥18" proof must NOT validate when re-labelled "≥25" (forge attempt)
  const forged = { ...p, t: (25).toString(16) };          // tamper the threshold
  ok((await verifyProof(forged)) === null, "a ≥18 proof re-labelled ≥25 is REJECTED (binding) — also κ tamper-refuses");

  // 6. tamper the κ id directly → refuse
  const tamperedId = { ...p, id: "did:holo:sha256:" + "00".repeat(32) };
  ok((await verifyProof(tamperedId)) === null, "tampered κ id → verifyProof refuses (tamper-refuse)");

  // 7. range: balance ∈ [18, 65] (you are 30)
  const pin = provePredicate({ value: 30, op: "in", a: 18, b: 65, n: N });
  ok(await verifyProof(pin).then((r) => !!(r && r.ok && r.predicate.op === "in")), "value ∈ [18, 65] verifies (range predicate)");

  // 8. shareProof is CONSENT-GATED + names that the value is not revealed; the link round-trips + verifies
  const denied = await shareProof({ predicate: { op: "ge", bound: 21, value: 30 }, audience: "a bar", gate: async () => ({ ok: false, reason: "user declined" }) });
  ok(denied && denied.refused, "shareProof without consent → REFUSED (no proof emitted)");
  let named = "";
  const granted = await shareProof({ predicate: { op: "ge", bound: 21, value: 30 }, audience: "a bar", gate: async (a) => { named = a.reason; return { ok: true }; } });
  ok(/NOT revealed/i.test(named), `consent prompt NAMES that the value is not revealed ("${named.slice(-34)}")`);
  const back = decodeProofLink(granted.link);
  ok(await verifyProof(back).then((r) => !!(r && r.ok)), "shared #proof= link round-trips + verifies offline (value never crosses)");

  console.log(`\n${pass}/${pass + fail}${fail ? " FAIL" : " — WITNESSED: transparent numeric predicate proofs (age ≥ 18, value ∈ [a,b]) — verify the FACT, never the value; false statements unprovable, re-labels/tampers rejected, share consent-gated. No trusted setup, no SNARK."}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
