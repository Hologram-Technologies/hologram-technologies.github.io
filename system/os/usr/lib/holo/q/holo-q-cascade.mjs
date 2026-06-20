// holo-q-cascade.mjs — the phone-instant CASCADE: a tiny DRAFT brain talks in ~1s while the full TARGET
// brain streams in, then the target VERIFIES every token so the committed output converges to full-model
// fidelity. This is the one genuinely-new piece of the instant-cold-load design (holo-instant-cold-load-
// assessment.md §3C): the latency magic (draft-first emission) + the fidelity magic (speculative verify).
//
// Two phases, one stream:
//   • Phase 1 — TARGET LOADING: emit DRAFT tokens immediately (instant first word; draft-quality, honest
//     "blurry"). These are marked fidelity:"draft" — the only tokens that are not full-model-exact.
//   • Phase 2 — TARGET RESIDENT: speculative decoding. The draft proposes k tokens; the target verifies them
//     in ONE batched forward; the longest matching prefix is accepted and one correction/bonus token added.
//     Every committed token equals the target's own greedy argmax at the committed prefix ⇒ from the moment
//     the target is resident the output is TOKEN-FOR-TOKEN identical to running the full model alone, at a
//     fraction of the target forward passes. (Classic greedy speculative decoding; the fidelity is exact, not
//     approximate.)
//
// Pure ESM, GPU-agnostic: the draft/target are injected as a small TOKEN-LEVEL contract so this logic is
// Node-witnessed with mock models. The real .holo brains satisfy it by exposing their per-token decode step
// (see TOKEN-LEVEL CONTRACT below). Never throws on a flaky model — degrades to whatever brain is available.
//
// TOKEN-LEVEL CONTRACT (what a brain must expose to ride the cascade):
//   model.ready()            → bool   — is this brain resident & runnable right now (weights streamed in)?
//   model.greedy(tokenIds)   → number — the argmax next-token id for the given committed prefix (greedy).
//   model.eos                → number (optional) — stop id.
// In deployment, the target's verification of k proposals is ONE batched forward (k+1 logits); here it is
// modelled as k+1 greedy() calls of the same committed prefix — logically identical, and what makes the
// fidelity provable. `targetRounds` counts the batched passes (the real cost), so rounds << tokens = the win.

const EMPTY = Object.freeze({ tokens: [], stats: {} });

async function callGreedy(m, seq) { try { return m && m.ready && m.ready() && typeof m.greedy === "function" ? await m.greedy(seq) : null; } catch (e) { return null; } }   // greedy() may be async (real GPU forward awaits) — await is transparent for sync mocks

// cascadeDecode — run the draft→target cascade for one generation.
//   draft, target : the TOKEN-LEVEL contract above (target may start not-ready and become ready mid-stream).
//   prompt        : number[] token ids.
//   opts.maxNew   : max tokens to generate (default 64).
//   opts.k        : draft look-ahead per speculative round (default 4).
//   opts.onToken  : ({ token, source:"draft"|"target", fidelity:"draft"|"target", pos }) => void — live stream.
//   opts.maxIdle  : safety: stop if neither brain can produce a token this many times in a row (default 2).
// → { tokens:number[], stats:{ firstTokenSource, firstTokenFidelity, draftOnly, proposed, accepted,
//     corrections, bonus, targetRounds, generated, speedup } }.  speedup = generated / max(1,targetRounds).
export async function cascadeDecode(draft, target, prompt = [], opts = {}) {
  const k = Math.max(1, opts.k || 4), maxNew = Math.max(1, opts.maxNew || 64), maxIdle = Math.max(1, opts.maxIdle || 2);
  const onToken = typeof opts.onToken === "function" ? opts.onToken : null;
  const signal = opts.signal || null;
  if (!draft && !target) return EMPTY;

  const out = [], seq = prompt.slice();
  const st = { firstTokenSource: null, firstTokenFidelity: null, draftOnly: 0, proposed: 0, accepted: 0, corrections: 0, bonus: 0, targetRounds: 0, generated: 0, speedup: 0 };
  let idle = 0;

  const emit = (token, source, fidelity) => {
    out.push(token); seq.push(token); st.generated++;
    if (st.firstTokenSource == null) { st.firstTokenSource = source; st.firstTokenFidelity = fidelity; }
    if (onToken) { try { onToken({ token, source, fidelity, pos: out.length - 1 }); } catch (e) {} }
  };
  const isEos = (m, t) => m && m.eos != null && t === m.eos;

  while (out.length < maxNew) {
    if (signal && signal.aborted) break;                          // caller cancelled (barge-in / new turn) → stop cleanly
    const targetUp = !!(target && target.ready && target.ready());

    // ── Phase 1: target still loading → emit draft tokens now (instant first word; honest draft fidelity) ──
    if (!targetUp) {
      const t = await callGreedy(draft, seq);
      if (t == null) { if (++idle >= maxIdle) break; continue; }   // neither usable yet — in the browser this awaits the next ready-tick
      idle = 0; st.draftOnly++; emit(t, "draft", "draft");
      if (isEos(draft, t)) break;
      continue;
    }

    // ── Phase 2: target resident → speculative decode (draft proposes, target verifies, output = target) ──
    idle = 0;
    const proposals = [];
    let dseq = seq.slice();
    for (let i = 0; i < k; i++) { const p = await callGreedy(draft, dseq); if (p == null) break; proposals.push(p); dseq.push(p); }
    st.proposed += proposals.length;
    st.targetRounds++;                                            // ONE batched target forward verifies them all

    let mismatch = false, done = false;
    for (let i = 0; i < proposals.length; i++) {
      const tgt = await target.greedy(seq);                       // target argmax at the committed prefix
      if (tgt === proposals[i]) { st.accepted++; emit(tgt, "draft", "target"); }   // draft was right → free token, full fidelity
      else { st.corrections++; emit(tgt, "target", "target"); mismatch = true; }   // draft wrong → take target, discard the rest
      if (out.length >= maxNew || isEos(target, tgt)) { done = true; break; }
    }
    if (done) break;
    if (!mismatch && out.length < maxNew) {                       // all k accepted → the verification pass yields one bonus token free
      const bonus = await target.greedy(seq); st.bonus++; emit(bonus, "target", "target");
      if (isEos(target, bonus)) break;
    }
  }

  st.speedup = st.generated / Math.max(1, st.targetRounds);
  return { tokens: out, stats: st };
}

// referenceGreedy — the ground truth: what the TARGET model alone would greedily decode. The cascade's
// committed tokens (from the moment the target is resident) must equal this exactly. Exposed so any caller
// (and the witness) can assert fidelity, and so a "verify this cascade matches the full model" gate is cheap.
export async function referenceGreedy(target, prompt = [], maxNew = 64) {
  const out = [], seq = prompt.slice();
  for (let i = 0; i < maxNew; i++) {
    const t = await callGreedy(target, seq);
    if (t == null) break;
    out.push(t); seq.push(t);
    if (target.eos != null && t === target.eos) break;
  }
  return out;
}

export default { cascadeDecode, referenceGreedy };
