// holo-bao-witness.mjs — proves the BLAKE3 streaming foundation:
//   P0  parity  — holo-blake3.mjs == official BLAKE3 (empty vector) AND one-shot == incremental
//   P1  seam    — kappo()/kappoHex/kappoVerify canonical; shaBridge is a distinct bridge, not a κ
//   S1  bao     — verified streaming: every chunk verifies against the single root; tamper refused;
//                 root == canonical hash; random-access proofs; verifiedChunks admits clean, refuses dirty
// Run: node holo-os/system/tools/holo-bao-witness.mjs

import { blake3hex, createBlake3 } from "../os/usr/lib/holo/holo-blake3.mjs";
import { kappo, kappoHex, kappoVerify, hexOf, isKappa, shaBridge, KAPPA_PREFIX } from "../os/usr/lib/holo/holo-kappa.mjs";
import * as bao from "../os/usr/lib/holo/holo-bao.mjs";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log("  ✗ " + msg); } };

// deterministic byte gen (no Math.random — reproducible): LCG, plus the official i%251 pattern.
const lcg = (seed, n) => { const u = new Uint8Array(n); let x = seed >>> 0; for (let i = 0; i < n; i++) { x = (1664525 * x + 1013904223) >>> 0; u[i] = x >>> 24; } return u; };
const pat = (n) => { const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = i % 251; return u; };

// sizes that exercise every tree shape: empty, sub-chunk, exact chunk, +1, powers of two, and
// non-power-of-two chunk counts (the asymmetric splits — where a naive proof builder breaks).
const SIZES = [0, 1, 63, 64, 1023, 1024, 1025, 2048, 2049, 3072, 4096, 7000, 65536, 100001];

console.log("holo-bao-witness — BLAKE3 verified-streaming foundation (P0 parity · P1 seam · S1 bao)\n");

// ── P0 — parity ───────────────────────────────────────────────────────────────────────
ok(blake3hex(new Uint8Array(0)) === "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
   "P0: empty input == official BLAKE3 empty vector");
for (const n of SIZES) {
  const b = pat(n);
  // one-shot vs incremental hasher, feeding in odd-sized slabs to cross chunk boundaries
  const h = createBlake3();
  for (let off = 0; off < n; off += 333) h.update(b.subarray(off, Math.min(off + 333, n)));
  ok(h.hex() === blake3hex(b), `P0: incremental == one-shot @${n}`);
  ok(bao.rootHex(b) === blake3hex(b), `P0: bao.rootHex == blake3hex @${n}`);
}

// ── P1 — seam ─────────────────────────────────────────────────────────────────────────
{
  const b = pat(5000);
  ok(kappoHex(b) === blake3hex(b), "P1: kappoHex == blake3hex");
  ok(kappo(b) === KAPPA_PREFIX + blake3hex(b), "P1: kappo == did:holo:blake3:<hex>");
  ok(hexOf(kappo(b)) === blake3hex(b), "P1: hexOf strips the DID to the address");
  ok(isKappa(kappo(b)) && !isKappa("did:holo:blake3:xyz"), "P1: isKappa validates the address form");
  ok(kappoVerify(b, kappo(b)) === true, "P1: kappoVerify admits matching bytes (L5)");
  ok(kappoVerify(pat(5001), kappo(b)) === false, "P1: kappoVerify refuses non-matching bytes (L5)");
  const sha = await shaBridge(b);
  ok(/^[0-9a-f]{64}$/.test(sha) && sha !== kappoHex(b), "P1: shaBridge is a DISTINCT sha-256 (bridge, not κ)");
}

// ── S1 — verified streaming (bao) ───────────────────────────────────────────────────────
for (const n of SIZES) {
  const b = pat(n);
  const enc = bao.encode(b);
  ok(enc.root === blake3hex(b), `S1: encode.root == canonical κ @${n}`);
  // every chunk verifies against the single root, with NO other bytes held
  let allOk = true;
  for (const c of enc.chunks) if (!bao.verifyChunk(enc.root, c.index, c.bytes, c.proof)) allOk = false;
  ok(allOk, `S1: every chunk verifies against root @${n} (${enc.chunks.length} chunks)`);
  // random-access proof matches the streamed proof
  const mid = Math.floor(enc.chunks.length / 2);
  const pr = bao.proofFor(b, mid);
  ok(bao.verifyChunk(enc.root, mid, enc.chunks[mid].bytes, pr.proof), `S1: random-access proofFor verifies @${n}#${mid}`);
}

// tamper: flip one byte in one chunk → THAT chunk refused, the rest still verify (streaming survives)
{
  const b = pat(100001);
  const enc = bao.encode(b);
  const t = 3; // tamper chunk 3
  const dirty = Uint8Array.from(enc.chunks[t].bytes); dirty[0] ^= 0x01;
  ok(bao.verifyChunk(enc.root, t, dirty, enc.chunks[t].proof) === false, "S1: tampered chunk is REFUSED");
  let others = true;
  for (const c of enc.chunks) if (c.index !== t && !bao.verifyChunk(enc.root, c.index, c.bytes, c.proof)) others = false;
  ok(others, "S1: all other chunks still verify (one bad chunk doesn't poison the stream)");
  // wrong index also fails (counter binds position → no reordering)
  ok(bao.verifyChunk(enc.root, t + 1, enc.chunks[t].bytes, enc.chunks[t].proof) === false, "S1: wrong index refused (reorder-proof)");
}

// S0 soundness lock — adversarial proof manipulation (beyond a tampered chunk): a swapped sibling SIDE,
// a TRUNCATED proof (dropped sibling), and an EXTENDED proof (extra garbage sibling) must each be refused.
{
  const b = pat(100001);
  const enc = bao.encode(b);
  const t = 5;                                           // a chunk deep enough to have a multi-sibling proof
  const orig = enc.chunks[t].proof;
  ok(orig.length >= 2, "S0: deep chunk has a multi-sibling proof to attack");
  // swap one sibling's side L↔R → folds to the wrong root
  const swapped = orig.map((s, i) => i === 0 ? { side: s.side === "L" ? "R" : "L", cv: s.cv } : s);
  ok(bao.verifyChunk(enc.root, t, enc.chunks[t].bytes, swapped) === false, "S0: swapped sibling side REFUSED");
  // truncate the proof (drop the top sibling) → never reaches the true root
  ok(bao.verifyChunk(enc.root, t, enc.chunks[t].bytes, orig.slice(0, -1)) === false, "S0: truncated proof REFUSED");
  // extend the proof with a garbage sibling → ROOT applied at the wrong level
  const extended = [...orig, { side: "L", cv: new Array(8).fill(0) }];
  ok(bao.verifyChunk(enc.root, t, enc.chunks[t].bytes, extended) === false, "S0: extended/garbage proof REFUSED");
  // a forged CV in an existing sibling → wrong root
  const forged = orig.map((s, i) => i === orig.length - 1 ? { side: s.side, cv: s.cv.map((x) => (x ^ 1) >>> 0) } : s);
  ok(bao.verifyChunk(enc.root, t, enc.chunks[t].bytes, forged) === false, "S0: forged sibling CV REFUSED");
}

// verifiedChunks: clean stream admits all in order; a tampered stream throws (refuses)
{
  const b = lcg(42, 50000);
  const enc = bao.encode(b);
  let count = 0;
  for await (const c of bao.verifiedChunks(enc.root, enc.chunks)) count++;
  ok(count === enc.chunks.length, "S1: verifiedChunks admits a clean stream whole");
  const bad = enc.chunks.map((c, i) => i === 2 ? { ...c, bytes: Uint8Array.from(c.bytes, (x) => x ^ 0) , } : c);
  bad[2] = { ...bad[2], bytes: Uint8Array.from(enc.chunks[2].bytes) }; bad[2].bytes[5] ^= 0xff;
  let threw = false;
  try { for await (const _ of bao.verifiedChunks(enc.root, bad)) { /* consume */ } } catch { threw = true; }
  ok(threw, "S1: verifiedChunks REFUSES a tampered stream (throws)");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
