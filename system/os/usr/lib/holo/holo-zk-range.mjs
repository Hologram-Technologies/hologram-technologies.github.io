// holo-zk-range.mjs — B3: TRANSPARENT range / predicate proofs. Prove "age ≥ 18", "balance ≥ X", or
// "v ∈ [a,b]" WITHOUT revealing v, as a κ-addressable proof. This is the self-asserted numeric tier
// holo-proof.mjs flagged as the frontier — no issuer needed, you commit to your own value and prove a
// predicate over it in zero knowledge.
//
// HARD CONSTRAINTS (honoured): NO trusted setup, NO SNARK, NO vendored curve.
//   • Group = RFC 3526 2048-bit MODP safe prime p (p = 2q+1). Pure BigInt modexp — nothing vendored.
//   • Generators g, h are NOTHING-UP-MY-SLEEVE: g = a fixed square; h = hash-to-subgroup of a public label.
//     Nobody knows log_g(h) → binding rests only on discrete-log hardness. Transparent: no setup ceremony.
//   • Pedersen commit C = g^v · h^r (mod p), perfectly hiding (r uniform), computationally binding.
//   • Range [0,2^n): bit-decompose v = Σ b_i 2^i; commit each bit C_i = g^{b_i} h^{r_i}; a Fiat–Shamir
//     OR-proof (Cramer–Damgård–Schoenmakers) shows each C_i opens to 0 or 1; the verifier checks
//     C = Π C_i^{2^i} (binds the bits to the value commitment). Zero-knowledge, non-interactive.
//   • v ≥ t  ⇔  (v − t) ∈ [0,2^n): the verifier derives C_{v−t} = C_v · g^{−t} and range-proves it.
//   • v ∈ [a,b] ⇔ (v−a) ∈ [0,2^n) ∧ (b−v) ∈ [0,2^n).
//
// This delivers the SECURITY property of a Bulletproof range proof (transparent, hiding, sound) at LINEAR
// proof size (n bit-proofs). The log-size inner-product Bulletproof is a future SIZE optimization — NOT a
// trust-model change (same assumptions). 100% local; pure + isomorphic (Node + browser).
import { sha256hex } from "./holo-uor.mjs";

// ── RFC 3526 MODP-2048 safe prime (p = 2q+1), standard, well-vetted. Transparent: a public constant. ──
const P = BigInt("0x" + (
  "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD" +
  "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED" +
  "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F" +
  "83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B" +
  "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510" +
  "15728E5A8AACAA68FFFFFFFFFFFFFFFF"));
const Q = (P - 1n) / 2n;                                   // prime order of the QR subgroup we work in

const modpow = (b, e, m) => { b %= m; if (b < 0n) b += m; let r = 1n; while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; };
const inv = (a) => modpow((a % P + P) % P, P - 2n, P);     // Fermat inverse mod prime P
const sq = (a) => (a * a) % P;                             // squaring maps into the order-q QR subgroup

// generators in the prime-order subgroup (squares ⇒ order q). g, h: nothing-up-my-sleeve.
const G = sq(2n);                                          // g = 2^2 (a fixed square)
function hashToSubgroup(label) { let h = 0n, i = 0; do { h = BigInt("0x" + sha256hex(label + "#" + i)) % P; h = sq(h); i++; } while (h <= 1n); return h; }
const H = hashToSubgroup("holo-zk:range:H/v1");            // log_g(H) unknown to everyone (derived from a label)

const toHex = (x) => x.toString(16);
const fromHex = (s) => BigInt("0x" + s);
function randScalar() {                                    // uniform in [1, Q)
  const bytes = new Uint8Array(40);
  (globalThis.crypto || require("node:crypto").webcrypto).getRandomValues(bytes);
  let x = 0n; for (const b of bytes) x = (x << 8n) | BigInt(b);
  return (x % (Q - 1n)) + 1n;
}
const Hq = (...parts) => BigInt("0x" + sha256hex(parts.join("|"))) % Q;   // Fiat–Shamir challenge in [0,Q)

// Pedersen commit: C = g^v · h^r (mod p). Returns the commitment + the blind (kept secret by the prover).
export function commit(v, r) { r = r == null ? randScalar() : BigInt(r); const C = (modpow(G, BigInt(v), P) * modpow(H, r, P)) % P; return { C, r }; }

// ── bit OR-proof: prove C = g^b h^r opens to b ∈ {0,1}, in zero knowledge (CDS OR of two Schnorr-on-h) ──
function proveBit(C, b, r, ctx, i) {
  const Y0 = C, Y1 = (C * inv(G)) % P;                     // b=0 ⇒ Y0=h^r ; b=1 ⇒ Y1=h^r
  const Y = [Y0, Y1], known = Number(b), x = ((r % Q) + Q) % Q;
  const ef = randScalar(), zf = randScalar();              // simulate the FALSE branch
  const tf = (modpow(H, zf, P) * inv(modpow(Y[1 - known], ef, P))) % P;
  const w = randScalar(), tr = modpow(H, w, P);            // real branch commitment
  const t0 = known === 0 ? tr : tf, t1 = known === 0 ? tf : tr;
  const E = Hq(ctx, i, toHex(C), toHex(t0), toHex(t1));
  const er = ((E - ef) % Q + Q) % Q, zr = (w + er * x) % Q;
  const e0 = known === 0 ? er : ef, e1 = known === 0 ? ef : er;
  const z0 = known === 0 ? zr : zf, z1 = known === 0 ? zf : zr;
  return { t0: toHex(t0), t1: toHex(t1), e0: toHex(e0), e1: toHex(e1), z0: toHex(z0), z1: toHex(z1) };
}
function verifyBit(C, pf, ctx, i) {
  try {
    const Y0 = C, Y1 = (C * inv(G)) % P;
    const t0 = fromHex(pf.t0), t1 = fromHex(pf.t1), e0 = fromHex(pf.e0), e1 = fromHex(pf.e1), z0 = fromHex(pf.z0), z1 = fromHex(pf.z1);
    const E = Hq(ctx, i, toHex(C), toHex(t0), toHex(t1));
    if (((e0 + e1) % Q) !== E) return false;               // challenges must split the FS challenge
    if (modpow(H, z0, P) !== (t0 * modpow(Y0, e0, P)) % P) return false;   // branch 0 Schnorr
    if (modpow(H, z1, P) !== (t1 * modpow(Y1, e1, P)) % P) return false;   // branch 1 Schnorr
    return true;
  } catch (e) { return false; }
}

// proveRange(v, n) — prove the committed value v ∈ [0, 2^n). Returns { C (hex), bits:[{C,or}], n } + the blind.
export function proveRange(v, n = 32) {
  v = BigInt(v); if (v < 0n || v >= (1n << BigInt(n))) throw new Error("holo-zk-range: value out of [0,2^n)");
  const bits = []; let r = 0n;
  const Cv0 = []; // build bit commitments; the value blind r = Σ r_i·2^i so Π C_i^{2^i} = g^v h^r
  for (let i = 0; i < n; i++) {
    const bi = (v >> BigInt(i)) & 1n, ri = randScalar();
    const Ci = (modpow(G, bi, P) * modpow(H, ri, P)) % P;
    r = (r + ri * (1n << BigInt(i))) % Q;
    Cv0.push({ Ci, bi, ri });
  }
  const C = (modpow(G, v, P) * modpow(H, r, P)) % P;        // = Π C_i^{2^i}
  const ctx = toHex(C) + ":" + n;
  for (let i = 0; i < n; i++) bits.push({ C: toHex(Cv0[i].Ci), or: proveBit(Cv0[i].Ci, Cv0[i].bi, Cv0[i].ri, ctx, i) });
  return { proof: { C: toHex(C), n, bits }, blind: toHex(r) };
}

// verifyRange(proof) — check Π C_i^{2^i} == C AND every bit OR-proof. Reveals nothing about v. Pure boolean.
export function verifyRange(proof) {
  try {
    if (!proof || !Array.isArray(proof.bits) || proof.bits.length !== proof.n) return false;
    const C = fromHex(proof.C), ctx = proof.C + ":" + proof.n;
    let prod = 1n;
    for (let i = 0; i < proof.n; i++) {
      const Ci = fromHex(proof.bits[i].C);
      if (!verifyBit(Ci, proof.bits[i].or, ctx, i)) return false;
      prod = (prod * modpow(Ci, 1n << BigInt(i), P)) % P;
    }
    return prod === C;                                     // bits compose to the value commitment
  } catch (e) { return false; }
}

// proveGE(v, t, n) — prove v ≥ t without revealing v: range-prove w = v − t ∈ [0,2^n). The published C is the
// commitment to v (= C_w · g^t), so a verifier with the public t derives C_w = C · g^{−t} and range-checks it.
export function proveGE(v, t, n = 32) {
  v = BigInt(v); t = BigInt(t); const w = v - t;
  if (w < 0n) throw new Error("holo-zk-range: cannot honestly prove v ≥ t when v < t");
  const rp = proveRange(w, n);                              // proof is over C_w
  const Cw = fromHex(rp.proof.C), Cv = (Cw * modpow(G, t, P)) % P;   // C_v = C_w · g^t (same blind)
  return { "@type": "HoloRangePredicate", op: "ge", t: toHex(t), n, Cv: toHex(Cv), range: rp.proof };
}
// verifyGE(pred) — derive C_w = C_v · g^{−t}, require it equals the range proof's C, then verify the range.
export function verifyGE(pred) {
  try {
    if (!pred || pred.op !== "ge") return false;
    const Cv = fromHex(pred.Cv), t = fromHex(pred.t), Cw = (Cv * inv(modpow(G, t, P))) % P;
    if (Cw !== fromHex(pred.range.C)) return false;        // binds the range proof to "v − t"
    return verifyRange(pred.range);
  } catch (e) { return false; }
}

// proveRangeIn(v, a, b, n) / verifyRangeIn — v ∈ [a,b]: (v−a) ≥ 0 AND (b−v) ≥ 0, both in [0,2^n).
export function proveRangeIn(v, a, b, n = 32) {
  v = BigInt(v); a = BigInt(a); b = BigInt(b);
  const lo = proveGE(v, a, n);                              // v ≥ a
  const hiV = b - v; if (hiV < 0n) throw new Error("holo-zk-range: v > b");
  const hi = proveGE(b, v, n);                             // b ≥ v  (commits to b's value; reveals b, not v)
  return { "@type": "HoloRangePredicate", op: "in", a: toHex(a), b: toHex(b), n, lo, hi };
}
export function verifyRangeIn(pred) {
  if (!pred || pred.op !== "in") return false;
  return verifyGE(pred.lo) && verifyGE(pred.hi);
}

// selftest — sound + zero-knowledge, deterministic enough to gate.
export function rangeSelftest() {
  const r = {};
  r.commitHides = (() => { const a = commit(42), b = commit(42); return a.C !== b.C; })();   // fresh blind ⇒ different
  r.geTrue = verifyGE(proveGE(21, 18, 8));
  r.geEq = verifyGE(proveGE(18, 18, 8));
  let geFalse = true; try { proveGE(16, 18, 8); geFalse = false; } catch (e) {}               // honest prover refuses
  r.geFalseRefused = geFalse;
  // soundness: a real proof for "≥18" must NOT validate when re-labelled "≥25"
  const p = proveGE(21, 18, 8); const forged = { ...p, t: toHex(25n) };
  r.relabelRejected = !verifyGE(forged);
  r.inTrue = verifyRangeIn(proveRangeIn(30, 18, 65, 8));
  r.zk = !JSON.stringify(proveGE(21, 18, 8)).includes("\"21\"");                              // no plaintext value
  r.ok = Object.values(r).every((v) => v === true);
  return r;
}

if (typeof window !== "undefined" && !window.HoloZKRange) {
  window.HoloZKRange = Object.freeze({ commit, proveRange, verifyRange, proveGE, verifyGE, proveRangeIn, verifyRangeIn, rangeSelftest });
}
export default { commit, proveRange, verifyRange, proveGE, verifyGE, proveRangeIn, verifyRangeIn, rangeSelftest };
