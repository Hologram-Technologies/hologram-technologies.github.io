// Witness the MOBILE-SAFETY policy in holo-brain-engine: the lm_head chunking is limit-aware, so the SAME
// engine fits whatever per-binding ceiling the device reports — a phone (128MB / 96MB / even 32MB) simply gets
// more, smaller chunks; a desktop keeps the proven ~100k-row chunking. We replicate the engine's exact formula
// and assert: every chunk fits under the device ceiling, ALL rows are covered exactly, no empty chunk, and the
// coarse tier maps as expected. (The real navigator.gpu.requestDevice limits + tier readout are device-bound →
// witnessed live on hardware = OUT-OF-BAND; this proves the math that keeps a phone from OOM-ing.)

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };

// qwen2.5-0.5b lm_head (output.weight): vocab × lmK, Q8_0 → bpr = (lmK/32)·34 bytes/row
const lmN = 151936, lmK = 896, nbL = lmK / 32, bpr = nbL * 34;

// the engine's exact chunking (holo-brain-engine.mjs): fitRows from the device ceiling, then CH/chunkRows
function chunksFor(maxBind) {
  const fitRows = Math.max(1, Math.floor((maxBind * 0.9) / bpr));
  const CH = Math.ceil(lmN / Math.min(100000, fitRows)), chunkRows = Math.ceil(lmN / CH);
  const chunks = [];
  for (let c = 0; c < CH; c++) { const r0 = c * chunkRows, r1 = Math.min(lmN, r0 + chunkRows); if (r1 > r0) chunks.push({ r0, n: r1 - r0, bytes: (r1 - r0) * bpr }); }
  return { CH, chunkRows, chunks };
}
const tierOf = (maxBind) => maxBind >= (1 << 30) ? "high" : maxBind >= (256 * 1024 * 1024) ? "mid" : "low";

const DEVICES = [
  { name: "desktop discrete (2GB binding)", maxBind: 2 * (1 << 30), tier: "high" },
  { name: "WebGPU default / iGPU (128MB)", maxBind: 128 * 1024 * 1024, tier: "low" },
  { name: "constrained phone (96MB)", maxBind: 96 * 1024 * 1024, tier: "low" },
  { name: "tiny mobile (32MB)", maxBind: 32 * 1024 * 1024, tier: "low" },
  { name: "mid GPU (512MB)", maxBind: 512 * 1024 * 1024, tier: "mid" },
];

for (const d of DEVICES) {
  const { CH, chunks } = chunksFor(d.maxBind);
  const ceil = d.maxBind * 0.9;
  const allFit = chunks.every((c) => c.bytes <= ceil);
  const covered = chunks.reduce((s, c) => s + c.n, 0) === lmN && chunks[0].r0 === 0;
  const noEmpty = chunks.every((c) => c.n > 0);
  const big = Math.max(...chunks.map((c) => c.bytes));
  ok(allFit && covered && noEmpty, `${d.name}: ${CH} chunk(s), max ${(big / 1e6).toFixed(1)}MB ≤ ${(ceil / 1e6).toFixed(0)}MB ceiling, all ${lmN} rows covered`);
  ok(tierOf(d.maxBind) === d.tier, `${d.name}: tier '${tierOf(d.maxBind)}' (1.5B upgrade ${tierOf(d.maxBind) === "high" ? "allowed" : "SKIPPED — stays 0.5B"})`);
}

// the desktop path must be UNCHANGED from the proven heuristic (Math.ceil(lmN/100000) = 2 chunks for this vocab)
ok(chunksFor(2 * (1 << 30)).CH === Math.ceil(lmN / 100000), "desktop chunking == the proven pre-change ~100k-row behavior (no regression)");
// and a phone gets strictly MORE chunks than desktop (smaller buffers) — the adaptive win
ok(chunksFor(32 * 1024 * 1024).CH > chunksFor(2 * (1 << 30)).CH, "tiny-mobile gets more, smaller chunks than desktop (adaptive, no OOM)");

console.log(`\n${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED: the engine's lm_head chunking fits every device ceiling (phone→desktop) + tier gates the 1.5B upgrade"}`);
process.exit(fail ? 1 : 0);
