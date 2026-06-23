#!/usr/bin/env node
// holo-delta-llm-witness.mjs — PROVE delta LLM streaming: the SAME delta principle as render, applied to
// autoregressive decoding. A token's KV (its causal projection) is addressed by κ and memoized, so the
// KV-CACHE IS THE DELTA: generating N tokens costs O(N) new-token computes, not O(N²) re-attention; the
// prompt PREFIX is computed once and REUSED across generations (the prompt/persona cache — the LLM form of
// "only you travels"); the KV window is bounded (low memory); and every produced token re-derives to its κ
// (Law L5). Weights already stream by κ (warmDelta ~0); tokens stream through the κ-stream spine.
//
// Checks: KV-reuse is delta (linear computes); throughput model (O(N) vs O(N²)); prompt-cache reuse;
// shared-prefix across generations; bounded KV window; deterministic + content-addressed; token-stream
// refs on repeat; metered tokens/s.   Usage: node tools/holo-delta-llm-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeDeltaDecoder } from "../os/usr/lib/holo/holo-delta-llm.mjs";
import { makeComputeMemo } from "../os/usr/lib/holo/holo-compute-memo.mjs";
import { makeMeter } from "../os/usr/lib/holo/holo-stream-meter.mjs";
import { makeKappaStream, kappaOf } from "../os/usr/lib/holo/holo-kappa-stream.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const enc = (s) => new TextEncoder().encode(s);
const l2 = () => { const m = new Map(); return { get: async (h) => m.get(h) || null, put: async (h, b) => { m.set(h, b); } }; };
const OP = await kappaOf(enc("attn-layer-weights"));                  // the layer/weights κ (the "op")
// causal context identity: KV for position p is determined by tokens[0..p] (so shared prefixes share κ)
const ctxK = (tokens, p) => kappaOf(enc(tokens.slice(0, p + 1).join(",")));
const makeProduce = () => { const c = { calls: 0 }; const fn = async (op, inn) => { c.calls++; return enc("KV:" + inn); }; fn.count = c; return fn; };
// decode a token sequence through a decoder, one causal step per position
async function decode(dec, tokens, produce, meter) { dec.reset(); for (let p = 0; p < tokens.length; p++) await dec.step(OP, await ctxK(tokens, p), produce, { dtMs: 5 }); }

const checks = {};

// ── 1 · KV-reuse is the delta: N tokens ⇒ N computes (linear), reuses are cached attends ──────────
let model = null;
{
  const N = 64; const memo = makeComputeMemo({ l2: l2(), cap: 8192 }); const produce = makeProduce();
  const dec = makeDeltaDecoder({ memo });
  await decode(dec, Array.from({ length: N }, (_, i) => "t" + i), produce);
  const st = dec.stats();
  const naive = (N * (N + 1)) / 2;                                    // no-cache: step p recomputes p+1 KV
  model = { tokens: N, deltaComputes: produce.count.calls, naiveComputes: naive, kvReuses: st.kvReuses, reduction: +(naive / produce.count.calls).toFixed(1) };
  checks.kvReuseIsDelta = produce.count.calls === N && st.computes === N && st.kvReuses === (N * (N - 1)) / 2;
}

// ── 2 · throughput model: O(N) delta vs O(N²) naive ──────────────────────────────────────────────
checks.throughputModel = model.deltaComputes === model.tokens && model.naiveComputes > 10 * model.deltaComputes;

// ── 3 · prompt cache: re-decoding the same prefix recomputes NOTHING (warm prompt) ────────────────
{
  const memo = makeComputeMemo({ l2: l2(), cap: 8192 }); const produce = makeProduce();
  const prompt = ["sys", "you", "are", "helpful"];
  await decode(makeDeltaDecoder({ memo }), prompt, produce);          // first time: 4 computes
  const after1 = produce.count.calls;
  await decode(makeDeltaDecoder({ memo }), prompt, produce);          // again, same memo: all hits
  checks.promptCacheReuse = after1 === 4 && produce.count.calls === 4;
}

// ── 4 · shared prefix across generations: only the divergent tail computes ────────────────────────
{
  const memo = makeComputeMemo({ l2: l2(), cap: 8192 }); const produce = makeProduce();
  await decode(makeDeltaDecoder({ memo }), ["a", "b", "c", "d"], produce);   // 4 computes
  const base = produce.count.calls;
  await decode(makeDeltaDecoder({ memo }), ["a", "b", "X", "Y"], produce);   // shares [a,b]; only X,Y new
  checks.sharedPrefix = base === 4 && (produce.count.calls - base) === 2;
}

// ── 5 · bounded KV window (low memory) ───────────────────────────────────────────────────────────
{
  const memo = makeComputeMemo({ l2: l2(), cap: 8192 });
  const dec = makeDeltaDecoder({ memo, window: 8 });
  await decode(dec, Array.from({ length: 20 }, (_, i) => "w" + i), makeProduce());
  checks.boundedKV = dec.stats().kvSize === 8;
}

// ── 6 · deterministic + content-addressed (Law L5) ───────────────────────────────────────────────
{
  const m1 = makeComputeMemo({ l2: l2() }), m2 = makeComputeMemo({ l2: l2() });
  const d1 = makeDeltaDecoder({ memo: m1 }), d2 = makeDeltaDecoder({ memo: m2 });
  const r1 = await d1.step(OP, await ctxK(["p", "q"], 1), makeProduce());
  const r2 = await d2.step(OP, await ctxK(["p", "q"], 1), makeProduce());
  checks.deterministic = r1.kappa === r2.kappa && r1.kappa === (await kappaOf(enc("KV:" + (await ctxK(["p", "q"], 1)))));
}

// ── 7 · token stream: a repeated generation streams as refs (no re-send) ─────────────────────────
{
  const memo = makeComputeMemo({ l2: l2() }); const produce = makeProduce();
  const stream = makeKappaStream();                                   // shared consumer cache
  const dec = makeDeltaDecoder({ memo });
  const seq = ["the", "quick", "brown", "fox"];
  dec.reset(); const a = []; for (let p = 0; p < seq.length; p++) { const ev = await stream.frame((await dec.step(OP, await ctxK(seq, p), produce)).bytes); await stream.admit(ev); a.push(ev); }
  dec.reset(); const b = []; for (let p = 0; p < seq.length; p++) { const ev = await stream.frame((await dec.step(OP, await ctxK(seq, p), produce)).bytes); b.push(ev); }
  checks.tokenStreamRefs = a.every((e) => e.kind === "obj") && b.every((e) => e.kind === "ref");
}

// ── 8 · metered tokens/s ─────────────────────────────────────────────────────────────────────────
{
  const memo = makeComputeMemo({ l2: l2() }); const meter = makeMeter();
  const dec = makeDeltaDecoder({ memo, meter });
  const seq = Array.from({ length: 20 }, (_, i) => "m" + i);
  dec.reset(); for (let p = 0; p < seq.length; p++) await dec.step(OP, await ctxK(seq, p), makeProduce(), { dtMs: 10 });  // 20 tokens, 10ms each = 200ms
  checks.meterTokensPerSec = Math.abs(meter.snapshot().tokensPerSec - 100) < 1e-6;                                       // 20 tok / 0.2 s
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-delta-llm-witness.result.json"), JSON.stringify({
  spec: "Delta LLM streaming: a token's KV is addressed by κ and memoized, so the KV-cache IS the delta — N tokens cost O(N) computes not O(N²); the prompt prefix is computed once and reused across generations (prompt/persona cache); KV window bounded (low memory); tokens re-derive to their κ (L5) and stream as refs on repeat. Same delta principle as render, applied to decoding.",
  authority: "holospaces Laws L1/L2/L3/L5 · transformer KV-cache (external) · prefix/prompt caching · content-addressed memoization",
  witnessed,
  covers: witnessed ? ["delta-llm", "kv-reuse-delta", "throughput-on-vs-onsquared", "prompt-cache", "shared-prefix", "bounded-kv", "deterministic", "token-stream-refs", "tokens-per-sec"] : [],
  model,
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
if (model) console.log(`· decode model: ${model.deltaComputes} computes (O(N)) vs naive ${model.naiveComputes} (O(N²)) = ${model.reduction}× fewer for ${model.tokens} tokens`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ the KV-cache is the delta — O(N) decode, prompt reused across generations, bounded memory, tokens re-derive" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
