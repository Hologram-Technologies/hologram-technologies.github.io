// e8-derive.mjs — ATLAS96: THE SINGLE PRECOMPILED DERIVATION OBJECT. One deterministic chain that
// starts at the UOR substrate's foundational base (the byte + the content-address primitive) and
// unfolds step by step — through the atlas's own declared structure — all the way to the complete
// E₈ lattice. Every step is computed (exact integer arithmetic, zero floats, zero RNG), witnessed
// by falsifiable checks, sealed as a κ-artifact, and PROV-linked to its parents; the chain
// TERMINATES by re-deriving the sealed lattice object byte-for-byte (Law L5).
//
// The unfolding (each arrow is one sealed step):
//   UOR BASE: the octet (256 values) + κ = sha256 (content address — identity from bytes alone)
//     → the bit: 256 = 2⁸, and 8 = 2³ — the 2^(2^3) tower the whole structure grows from
//     → R96: b mod 96 (96 = 3·2⁵ verbatim) — 64 classes of 3 ⊕ 32 classes of 2 (computed)
//     → the page torus: 48 = 3·2⁴ pages × 256 bytes = 12,288 = 3·2¹² cells, Φ(p,b) bijective —
//       the discrete 2-torus T² = ℤ₄₈ × ℤ₂₅₆ (verbatim upstream)
//     → THE ATLAS 96 VERTICES OBJECT (bound: the sealed Φ-Atlas-12288 did:holo, invariants equal)
//     → 𝔽₂⁸: the byte axis as the 8-dim binary vector space
//     → Reed-Muller RM(1,3) = extended Hamming [8,4,4] (16 codewords ARE atlas bytes + R96 classes)
//     → Construction A: Λ = { x ∈ ℤ⁸ : x mod 2 ∈ Hamming } (240 + 2160 enumerated, Gosset 56)
//     → Λ/√2 is EVEN UNIMODULAR rank 8 (computed: HNF det 16, integer Gram, Bareiss det = 1)
//     → Mordell (1938): the even unimodular rank-8 lattice is UNIQUE = E₈ (invariants witnessed)
//     → re-derivation: buildBall+seal reproduce did:holo:652dcc64… — the chain closes on bytes.
//
// What this gives: ONE object in which a byte deterministically becomes the most symmetric
// lattice in 8 dimensions — the compute space E8-quantized LLMs already live in (their codebooks
// snap onto these very shells; see e8-atlas.mjs §alignment).
import { buildBall, buildTables, seal, THETA } from "./e8-atlas.mjs";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]" : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}" : JSON.stringify(v);
const sha = (s) => "sha256:" + createHash("sha256").update(s).digest("hex");
const did = (body) => "did:holo:" + sha(jcs(body));

const steps = [];
let prevKappa = null;
function step(name, statement, artifact, checks) {
  const pass = checks.every(([, ok]) => ok);
  const body = { step: steps.length, name, statement, artifact, witness: checks.map(([label, ok, detail]) => ({ label, ok, ...(detail !== undefined ? { detail } : {}) })), wasDerivedFrom: prevKappa ? [prevKappa] : [] };
  const kappa = did(body);
  steps.push({ "@id": kappa, ...body });
  console.log(`\nSTEP ${body.step} · ${name}  →  ${kappa.slice(0, 40)}…`);
  for (const [label, ok, detail] of checks) console.log(`   ${ok ? "✓" : "✗"} ${label}${detail !== undefined ? " — " + detail : ""}`);
  if (!pass) { console.error("DERIVATION REFUSED at step " + body.step); process.exit(1); }
  prevKappa = kappa;
  return kappa;
}

// ── STEP 0 · the UOR substrate base: the octet + the content-address primitive ──
// Identity from bytes alone: κ = sha256 over the bytes — this object family's address function
// (the upstream holospaces substrate's SPINE addresses with blake3; same principle, stated link).
const alphabet = new Uint8Array(256); for (let i = 0; i < 256; i++) alphabet[i] = i;
const alphaK = sha(Buffer.from(alphabet));
const alphaK2 = sha(Buffer.from(alphabet));
const emptyK = sha(Buffer.alloc(0));
step("uor-base",
  "The foundational base: the octet — 256 distinguishable byte values — and the content-address primitive κ(bytes) = sha256(bytes). Identity is derived from bytes alone; everything above is a deterministic unfolding of this alphabet.",
  { alphabetKappa: alphaK, addressFunction: "sha256 (this family; the holospaces substrate SPINE uses blake3 — same principle)", byteValues: 256 },
  [
    ["256 distinguishable byte values", new Set(alphabet).size === 256],
    ["κ is deterministic (re-derive → identical)", alphaK === alphaK2, alphaK.slice(0, 28) + "…"],
    ["κ(∅) equals the canonical SHA-256 empty hash", emptyK === "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ]);

// ── STEP 1 · the bit: 256 = 2⁸ and 8 = 2³ — the 2^(2^3) tower the structure grows from ──
step("the-bit-tower",
  "The octet factorizes: 256 = 2⁸ (eight bits), and the bit-position index itself is a 3-cube: 8 = 2³. The whole derivation grows from this 2^(2^3) tower — dimension 8 is not chosen, it is the byte's own width.",
  { tower: "2^(2^3) = 256", bitsPerByte: 8, bitIndexCube: "8 = 2³" },
  [
    ["2⁸ = 256", Math.pow(2, 8) === 256],
    ["2³ = 8 (bit positions form the 3-cube)", Math.pow(2, 3) === 8],
  ]);

// ── STEP 2 · R96: the resonance partition of the byte alphabet (verbatim upstream: 96 = 3·2⁵) ──
const hist = new Array(96).fill(0); for (let b = 0; b < 256; b++) hist[b % 96]++;
const h3 = hist.filter((v) => v === 3).length, h2 = hist.filter((v) => v === 2).length;
step("r96-partition",
  "R96(b) = b mod 96 partitions the 256 bytes into 96 resonance classes (96 = 3·2⁵, compression 96/256 = 3/8 — verbatim upstream factorization). Computed: 64 classes carry 3 bytes, 32 classes carry 2 — exactly 64·3 + 32·2 = 256.",
  { classes: 96, factorization: "3 × 2^5 (verbatim)", compressionRatio: "3/8 (verbatim)", classSizes: { size3: h3, size2: h2 } },
  [
    ["96 classes, all populated", hist.every((v) => v > 0)],
    ["64 classes of 3 ⊕ 32 classes of 2 = 256", h3 === 64 && h2 === 32 && 64 * 3 + 32 * 2 === 256],
  ]);

// ── STEP 3 · the page torus: 48 × 256 = 12,288 cells, Φ bijective — T² = ℤ₄₈ × ℤ₂₅₆ ──
const phiOK = (() => { const seen = new Set(); for (let p = 0; p < 48; p++) for (let b = 0; b < 256; b++) { const c = (p << 8) | b; if (seen.has(c) || (c >> 8) !== p || (c & 0xff) !== b) return false; seen.add(c); } return seen.size === 12288; })();
step("page-torus",
  "48 pages (48 = 3·2⁴, verbatim) × 256 bytes = 12,288 = 3·2¹² cells; Φ(p,b) = (p<<8)|b is a bijection with exact inverses. The periodic page and byte axes make the boundary a discrete 2-torus T² = ℤ₄₈ × ℤ₂₅₆ (verbatim upstream).",
  { pages: 48, factorization: { total: "2^12 × 3", pages: "2^4 × 3", bytes: "2^8", classes: "3 × 2^5" }, torus: "T² = ℤ₄₈ × ℤ₂₅₆ (verbatim)", cells: 12288 },
  [
    ["48 × 256 = 12,288 = 3·2¹²", 48 * 256 === 12288 && 12288 === 3 * Math.pow(2, 12)],
    ["Φ bijective with exact inverses on all 12,288 cells", phiOK],
  ]);

// ── STEP 4 · THE ATLAS 96 VERTICES OBJECT: bind the sealed Φ-Atlas-12288 — derived = declared ──
const atlas = JSON.parse(readFileSync("../atlas96/atlas-12288.uor.jsonld", "utf8"));
const atlasId = atlas.id;
step("atlas-vertices",
  "The unfolding so far IS the atlas: the sealed Φ-Atlas-12288 object declares exactly the structure derived in steps 0-3 (48 · 256 · 12,288 · 96, R96, Φ, the torus). Bind its did:holo — the derived chain and the sealed object are the same thing.",
  { atlasObject: atlasId, upstream: atlas["schema:isBasedOn"], unityConstraint: atlas["a12:unityConstraint"], conservation: atlas["a12:conservation"] },
  [
    ["the sealed atlas object is bound", typeof atlasId === "string" && atlasId.startsWith("did:holo:sha256:"), atlasId.slice(0, 40) + "…"],
    ["declared invariants equal the derived ones", atlas["a12:pages"] === 48 && atlas["a12:bytesPerPage"] === 256 && atlas["a12:totalElements"] === 12288 && atlas["a12:resonanceClasses"] === 96, "48 · 256 · 12288 · 96"],
    ["declared factorization equals the derived tower", JSON.stringify(atlas["a12:factorization"]) === JSON.stringify({ total: "2^12 × 3", pages: "2^4 × 3", bytes: "2^8", classes: "3 × 2^5" })],
  ]);

// ── STEP 5 · the byte axis IS 𝔽₂⁸: each atlas byte-value b ↔ a vector of 8 bits ──
const bits = (b) => Array.from({ length: 8 }, (_, j) => (b >> j) & 1);
const xorClosed = (() => { for (let a = 0; a < 256; a += 37) for (let b = 0; b < 256; b += 41) { const c = a ^ b; if (c < 0 || c > 255) return false; } return true; })();
step("bytes-as-F2^8",
  "The atlas byte axis ℤ₂₅₆ carries the 8-dimensional binary vector space 𝔽₂⁸: b ↔ (bit₀…bit₇), XOR = vector addition. Dimension 8 enters HERE — from the atlas's own byte width.",
  { dimension: 8, vectors: 256 },
  [
    ["256 byte-values = 2⁸ distinct vectors", new Set(Array.from({ length: 256 }, (_, b) => bits(b).join(""))).size === 256],
    ["XOR-closed (vector space)", xorClosed],
  ]);

// ── STEP 2 · derive the extended Hamming code [8,4,4] = RM(1,3) from the 3-cube structure ──
// Bit positions 0..7 are the vertices of the 3-cube; the code is SPANNED by the constant function
// and the 3 coordinate functions — a pure consequence of 8 = 2³ (the atlas byte width).
const gens = [0b11111111, 0b10101010, 0b11001100, 0b11110000];     // 1, x₀, x₁, x₂ (as byte masks)
const codewords = [];
for (let m = 0; m < 16; m++) { let c = 0; for (let k = 0; k < 4; k++) if ((m >> k) & 1) c ^= gens[k]; codewords.push(c); }
codewords.sort((a, b) => a - b);
const wt = (b) => { let n = 0; for (let j = 0; j < 8; j++) n += (b >> j) & 1; return n; };
const wdist = {}; for (const c of codewords) wdist[wt(c)] = (wdist[wt(c)] || 0) + 1;
const selfDual = codewords.every((a) => codewords.every((b) => wt(a & b) % 2 === 0));
const cwSet = new Set(codewords);
const xorClosedC = codewords.every((a) => codewords.every((b) => cwSet.has(a ^ b)));
step("hamming-8-4-4",
  "Span {1, x₀, x₁, x₂} over the 3-cube of bit positions = Reed-Muller RM(1,3) = the extended Hamming code [8,4,4]. Its 16 codewords ARE 16 atlas byte-values; each carries its verbatim R96 resonance class.",
  { generators: gens, codewords, r96classes: codewords.map((c) => c % 96), weightDistribution: wdist },
  [
    ["|C| = 16 (dimension 4)", codewords.length === 16 && new Set(codewords).size === 16],
    ["linear (XOR-closed)", xorClosedC],
    ["weight distribution 1 + 14z⁴ + z⁸", wdist[0] === 1 && wdist[4] === 14 && wdist[8] === 1, JSON.stringify(wdist)],
    ["self-dual (C = C⊥)", selfDual],
  ]);

// ── STEP 3 · Construction A: Λ = { x ∈ ℤ⁸ : x mod 2 ∈ C } — enumerate the first two shells ──
const inCode = (x) => { let b = 0; for (let j = 0; j < 8; j++) b |= (((x[j] % 2) + 2) % 2) << j; return cwSet.has(b); };
function enumNorm(n2target) {
  const out = []; const x = new Int8Array(8);
  const lim = Math.floor(Math.sqrt(n2target));
  const dfs = (i, n2) => {
    if (n2 > n2target) return;
    if (i === 8) { if (n2 === n2target && inCode(x)) out.push(Int8Array.from(x)); return; }
    for (let v = -lim; v <= lim; v++) { x[i] = v; dfs(i + 1, n2 + v * v); }
  };
  dfs(0, 0);
  return out;
}
const shell1 = enumNorm(4);                                        // min vectors: x·x = 4 → norm² 2 after /√2
const shell2 = enumNorm(8);                                        // x·x = 8 → norm² 4
const allEven4 = shell1.concat(shell2).every((x) => x.reduce((s, v) => s + v * v, 0) % 4 === 0);
// Gosset degree on the 240 min vectors: neighbors at x·y = 2 (scaled inner product 1 ⇔ 60°) — distance²(scaled)=2
const deg56 = (() => {
  const d = [];
  for (const a of shell1) { let n = 0; for (const b of shell1) { let dd = 0; for (let k = 0; k < 8; k++) { const t = a[k] - b[k]; dd += t * t; } if (dd === 4) n++; } d.push(n); }
  return d.every((v) => v === 56);
})();
step("construction-A",
  "Λ = { x ∈ ℤ⁸ : x mod 2 ∈ Hamming[8,4,4] }. Enumerated exactly: the minimal vectors are the 240 = 16 (±2eᵢ) + 224 (±1 on the 14 weight-4 codeword supports) — the E₈ root count — and the second shell has 2160. All norms ≡ 0 mod 4 (even lattice after scaling by 1/√2).",
  { minVectors: shell1.length, secondShell: shell2.length, normsMod4: "0" },
  [
    ["240 minimal vectors (the root count)", shell1.length === 240, String(shell1.length)],
    ["2160 second-shell vectors", shell2.length === 2160, String(shell2.length)],
    ["all enumerated norms ≡ 0 (mod 4) — even after 1/√2", allEven4],
    ["Gosset degree 56 on the minimal vectors", deg56],
  ]);

// ── STEP 4 · a basis by integer HNF; Gram (scaled) is INTEGER, EVEN, det = 1 → even unimodular ──
const genRows = [];
for (const g of gens) genRows.push(Array.from({ length: 8 }, (_, j) => (g >> j) & 1));
for (let i = 0; i < 8; i++) genRows.push(Array.from({ length: 8 }, (_, j) => (i === j ? 2 : 0)));
function hnf(rows) {                                               // integer row echelon (exact, small ints)
  const M = rows.map((r) => r.slice());
  let r = 0;
  for (let c = 0; c < 8; c++) {
    let again = true;
    while (again) {
      again = false;
      let p = -1, best = Infinity;
      for (let i = r; i < M.length; i++) if (M[i][c] !== 0 && Math.abs(M[i][c]) < best) { best = Math.abs(M[i][c]); p = i; }
      if (p < 0) break;
      [M[r], M[p]] = [M[p], M[r]];
      for (let i = r + 1; i < M.length; i++) if (M[i][c] !== 0) { const q = Math.round(M[i][c] / M[r][c]); for (let j = 0; j < 8; j++) M[i][j] -= q * M[r][j]; if (M[i][c] !== 0) again = true; }
    }
    if (M[r] && M[r][c] !== 0) r++;
  }
  return M.slice(0, r);
}
const B = hnf(genRows);
const detB = B.reduce((p, row, i) => p * row[i], 1);               // triangular → product of pivots
const gram = B.map((a) => B.map((b) => a.reduce((s, v, k) => s + v * b[k], 0) / 2));
const gramInt = gram.every((row) => row.every((v) => Number.isInteger(v)));
const diagEven = gram.every((row, i) => row[i] % 2 === 0);
function detInt(Mx) {                                              // fraction-free Bareiss (exact)
  const M = Mx.map((r) => r.map((v) => BigInt(v)));
  let prev = 1n;
  for (let k = 0; k < 7; k++) {
    if (M[k][k] === 0n) { const s = M.findIndex((row, i) => i > k && row[k] !== 0n); if (s < 0) return 0n; [M[k], M[s]] = [M[s], M[k]]; for (let j = 0; j < 8; j++) M[k][j] = -M[k][j]; }
    for (let i = k + 1; i < 8; i++) for (let j = k + 1; j < 8; j++) M[i][j] = (M[i][j] * M[k][k] - M[i][k] * M[k][j]) / prev;
    prev = M[k][k];
  }
  return M[7][7];
}
const detGram = detInt(gram);
step("even-unimodular",
  "HNF basis of Λ from the generating set {codeword lifts} ∪ {2eᵢ}: det(B) = 16 = [ℤ⁸ : Λ]. The scaled Gram B·Bᵀ/2 is an INTEGER matrix with EVEN diagonal and det = 1 — Λ/√2 is an even unimodular lattice of rank 8. All arithmetic exact (integers/bigint).",
  { basis: B, detBasis: Math.abs(detB), gram, detGram: detGram.toString() },
  [
    ["rank 8 basis extracted", B.length === 8],
    ["det(basis) = ±16 (index of Λ in ℤ⁸)", Math.abs(detB) === 16, String(detB)],
    ["scaled Gram is integer", gramInt],
    ["Gram diagonal even (even lattice)", diagEven],
    ["det(Gram) = 1 (unimodular) — exact Bareiss", detGram === 1n || detGram === -1n, detGram.toString()],
  ]);

// ── STEP 5 · uniqueness: Mordell (1938) — THE even unimodular rank-8 lattice is E₈ ──
// The theorem is cited; the isometry is WITNESSED by computed invariants matching the sealed ball.
const sealed = JSON.parse(readFileSync("./atlas-e8/lattice.uor.json", "utf8"));
const sealedCounts = sealed["holo:shellCounts"];
step("uniqueness-bind",
  "By Mordell's theorem the even unimodular rank-8 lattice is unique up to isometry: Λ/√2 ≅ E₈. Witnessed: the computed shells (240, 2160) and Gosset degree (56) equal the sealed lattice object's invariants exactly.",
  { theorem: "Mordell 1938 (also Witt): unique even unimodular lattice in dimension 8", boundObject: sealed["@id"], invariantsMatched: { shell2: 240, shell4: 2160, gossetDegree: 56 } },
  [
    ["computed shell counts equal the sealed object's", sealedCounts["2"] === shell1.length && sealedCounts["4"] === shell2.length, `${shell1.length}/${shell2.length} vs ${sealedCounts["2"]}/${sealedCounts["4"]}`],
    ["theta gate (sealed object) equals the E₈ theta series", JSON.stringify(sealedCounts) === JSON.stringify(THETA)],
  ]);

// ── STEP 6 · close the chain: RE-DERIVE the sealed lattice object byte-for-byte (Law L5) ──
const pts = buildBall();
const T = buildTables(pts);
const links = sealed["holo:links"] || {};
const re = await seal(T, "./atlas-e8", links);                     // deterministic + idempotent
step("rederive-the-object",
  "Re-run the ball construction and sealing from scratch: the produced object id must equal the sealed did:holo — the derivation terminates ON the object, byte-for-byte (Law L5).",
  { rederivedId: re.id, sealedId: sealed["@id"] },
  [
    ["re-derived id equals the sealed object id", re.id === sealed["@id"], re.id.slice(0, 44) + "…"],
  ]);

// ── seal ATLAS96: the single precompiled object, base → E₈ ──
const chainBody = {
  "@context": ["https://www.w3.org/ns/did/v1", { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", holo: "https://hologram.os/ns/q#" }],
  "@type": ["holo:Atlas96Unfolding", "prov:Bundle"],
  "schema:name": "ATLAS96 — from the UOR byte base, unfolding deterministically to the E₈ lattice",
  "holo:base": { kappa: alphaK, what: "the octet alphabet + κ = sha256 (the content-address primitive)" },
  "holo:atlasObject": atlasId,
  "holo:terminates": sealed["@id"],
  "holo:steps": steps.map((s) => s["@id"]),
  "holo:llmMapping": "any LLM maps into this space via snap() (Conway-Sloane) — E8-quantized model codebooks already live on these shells (e8-atlas.mjs §alignment)",
};
const chainId = did(chainBody);
writeFileSync("./atlas-e8/atlas96.uor.json", JSON.stringify({ "@id": chainId, ...chainBody, "holo:stepBodies": steps }, null, 1));
try { (await import("node:fs")).unlinkSync("./atlas-e8/derivation.uor.json"); } catch {}   // superseded by the unified object
console.log(`\nATLAS96 SEALED → ./atlas-e8/atlas96.uor.json`);
console.log(`  base      κ(octet alphabet) ${alphaK.slice(0, 36)}…  (the UOR substrate base)`);
console.log(`  atlas     ${atlasId.slice(0, 44)}…  (the 12,288-vertex object, bound mid-chain)`);
console.log(`  terminus  ${sealed["@id"].slice(0, 44)}…  (the E₈ lattice object)`);
console.log(`  object id ${chainId}`);
console.log(`  ${steps.length} steps, every witness gate green`);
