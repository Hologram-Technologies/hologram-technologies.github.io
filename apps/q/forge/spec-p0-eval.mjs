#!/usr/bin/env node
// spec-p0-eval.mjs — P0 baseline for Q's speculative decoder (Track B, HOLO-DSPARK-DRAFTER-PROMPT.md).
//
// WHAT: model-free, offline evaluator that replays the EXACT specDecode() acceptance loop
// (qvac-gpu.js) against greedy "tapes" (a prompt + the target model's greedy continuation).
// Because real verification is greedy-argmax against the committed sequence, the committed
// tokens ARE the greedy tape — so acceptance is fully determined by the tape + the drafter,
// with no model in the loop. This lets us score any drafter (n-gram today, a learned DSpark
// drafter tomorrow) on the honest metric — tokens committed per verification pass — for free.
//
// WHY offline: the live spec path is WebGPU-only (needs a browser + the 9B on the GPU). This
// harness gives a deterministic, laptop-runnable bar to beat before spending a GPU on training.
//
// USAGE:
//   node spec-p0-eval.mjs --self-test                 # runs with synthetic tapes, no data needed
//   node spec-p0-eval.mjs --tapes tapes.json          # score the n-gram baseline on real tapes
//   node spec-p0-eval.mjs --tapes tapes.json --drafter ./my-drafter.mjs   # score a learned drafter
//
// TAPES FORMAT (tapes.json):  { "tapes": [ { "prompt": [ids...], "greedy": [ids...] }, ... ] }
//   prompt = committed prefix before generation; greedy = the target's greedy continuation ids.
//   Capture real tapes from Q by running the target greedy (decode()/generate()) and recording ids.
//
// DRAFTER MODULE (--drafter ./file.mjs):  export default (seq, max) => number[]
//   Same contract as the in-engine seam (qvac-gpu.js setDrafter). Return up to `max` proposed
//   ids following `seq` (the full committed sequence so far). May be sync or async.

const KX = 8;                     // must match qvac-gpu.js
const MAX_DRAFTS = KX - 1;        // window is [tKnown, ...drafts] ≤ KX

// ── n-gram baseline: byte-identical logic to ngramDraft() in qvac-gpu.js ──────────────
function ngramDraft(seq, max) {
  const n = seq.length; if (n < 4) return [];
  for (let g = 3; g >= 1; g--) {
    const a = seq.slice(n - g);
    for (let i = n - g - 1; i >= 0; i--) {
      let hit = true; for (let j = 0; j < g; j++) if (seq[i + j] !== a[j]) { hit = false; break; }
      if (hit) { const out = seq.slice(i + g, i + g + max); if (out.length) return out; }
    }
  }
  return [];
}

// ── replay one tape through the exact specDecode acceptance + cold-backoff loop ────────
async function replay(tape, drafter) {
  const seq = tape.prompt.slice();     // full committed sequence (drafter sees this grow)
  const T = tape.greedy;               // greedy continuation ids = the verification ground truth
  let p = 0, cold = 0;
  const st = { windows: 0, drafted: 0, accepted: 0, committed: 0 };
  while (p < T.length) {
    let drafts = [];
    if (cold <= 0) {
      drafts = (await drafter(seq, MAX_DRAFTS)) || [];
      if (drafts.length > MAX_DRAFTS) drafts = drafts.slice(0, MAX_DRAFTS);
    }
    // greedy verify: accept leading drafts that match the greedy tape (longest common prefix)
    let a = 0;
    while (a < drafts.length && (p + a) < T.length && drafts[a] === T[p + a]) a++;
    const commit = Math.min(a + 1, T.length - p);   // row0 (always) + accepted; capped at tape end
    for (let i = 0; i < commit; i++) seq.push(T[p + i]);
    p += commit;
    st.windows++; st.drafted += drafts.length; st.accepted += a; st.committed += commit;
    if (drafts.length && a === 0) cold = 3; else if (cold > 0) cold--;   // mirrors SP.cold backoff
  }
  return st;
}

function report(name, agg) {
  const { windows, drafted, accepted, committed } = agg;
  const speedup = committed / windows;                       // tokens committed per verification pass
  const acceptRate = drafted ? accepted / drafted : 0;
  const meanAccLen = windows ? accepted / windows : 0;
  console.log(`\n[${name}]`);
  console.log(`  tokens committed : ${committed}`);
  console.log(`  verify passes    : ${windows}`);
  console.log(`  drafted / accepted: ${drafted} / ${accepted}  (accept rate ${(acceptRate * 100).toFixed(1)}%)`);
  console.log(`  mean accepted-len : ${meanAccLen.toFixed(2)} tokens/window`);
  console.log(`  SPEEDUP          : ${speedup.toFixed(2)}x  (vs 1.00x no-draft)`);
  return speedup;
}

async function scoreAll(tapes, drafter, name) {
  const agg = { windows: 0, drafted: 0, accepted: 0, committed: 0 };
  for (const t of tapes) { const s = await replay(t, drafter); for (const k in agg) agg[k] += s[k]; }
  return report(name, agg);
}

// ── synthetic tapes for --self-test (seeded, deterministic; no model needed) ──────────
function synthTapes() {
  let s = 0x9e3779b9 >>> 0;
  const rnd = (m) => { s = (s * 1664525 + 1013904223) >>> 0; return s % m; };   // seeded LCG
  // (1) highly repetitive: n-gram should accept a lot. (2) near-random: n-gram ~0.
  const rep = { prompt: [1, 2, 3, 4], greedy: [] };
  for (let i = 0; i < 200; i++) rep.greedy.push([5, 6, 7, 8][i % 4]);
  const rand = { prompt: [10, 11, 12, 13], greedy: [] };
  for (let i = 0; i < 200; i++) rand.greedy.push(100 + rnd(50000));
  // (3) structured code-like: repeated idioms with novel spans between.
  const code = { prompt: [20, 21, 22, 23], greedy: [] };
  const idiom = [30, 31, 32];
  for (let i = 0; i < 60; i++) { code.greedy.push(...idiom, 200 + rnd(1000), 200 + rnd(1000)); }
  return [rep, rand, code];
}

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

  let tapes;
  if (has('--self-test') || (!val('--tapes'))) {
    if (!has('--self-test')) { console.error('no --tapes given; running --self-test. See header for usage.'); }
    tapes = synthTapes();
    console.log(`self-test: ${tapes.length} synthetic tapes (repetitive / near-random / code-like)`);
  } else {
    const fs = await import('node:fs');
    const doc = JSON.parse(fs.readFileSync(val('--tapes'), 'utf8'));
    tapes = doc.tapes || doc;
    if (!Array.isArray(tapes) || !tapes.length) throw new Error('tapes file has no tapes');
    console.log(`loaded ${tapes.length} tapes from ${val('--tapes')}`);
  }

  // baseline: n-gram (always scored, it is the bar to beat)
  const baseSpeedup = await scoreAll(tapes, ngramDraft, 'n-gram baseline');

  // optional: a learned/candidate drafter module
  const dpath = val('--drafter');
  if (dpath) {
    const path = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const mod = await import(pathToFileURL(path.resolve(process.cwd(), dpath)).href);
    const fn = mod.default || mod.drafter;
    if (typeof fn !== 'function') throw new Error(`${dpath} must export default (seq,max)=>ids`);
    const candSpeedup = await scoreAll(tapes, fn, `candidate: ${dpath}`);
    const lift = ((candSpeedup / baseSpeedup - 1) * 100).toFixed(1);
    console.log(`\n==> candidate is ${lift}% ${candSpeedup >= baseSpeedup ? 'FASTER' : 'SLOWER'} than n-gram baseline`);
  } else {
    console.log('\n(pass --drafter ./file.mjs to score a learned drafter against this baseline)');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
