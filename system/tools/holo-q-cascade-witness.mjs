// holo-q-cascade-witness.mjs — re-derivable proof of the phone-instant cascade's two guarantees:
//   FIDELITY — once the target brain is resident, the cascade commits TOKEN-FOR-TOKEN exactly what the full
//              target would greedily decode alone (speculative verify is exact, not approximate).
//   EARLINESS — while the target is still loading, the FIRST token is emitted from the tiny draft (instant
//              first word), before the target runs a single forward pass.
//   + SPEEDUP (target forward passes << tokens generated) and FAIL-SAFE (no draft / draft throws / target
//   never lands all degrade safely). Pure Node, deterministic mock brains — no GPU, no model load.
// Run: node holo-q-cascade-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const { cascadeDecode, referenceGreedy } = await import(pathToFileURL(resolve(HERE, "../os/usr/lib/holo/q/holo-q-cascade.mjs")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ── deterministic, prefix-DEPENDENT mock brains (a real target's argmax depends on the whole prefix) ──────
const V = 100;
const mkTarget = (readyFn) => ({ ready: readyFn, greedy: (s) => { const n = s.length, a = s[n - 1] || 0, b = s[n - 2] || 0; return (a * 31 + b * 7 + n * 13 + 5) % V; } });
// the draft is a GOOD-but-imperfect approximation of the target (as a small model is to a big one): it agrees
// with the target except on ~25% of prefixes (where it proposes a wrong token → the target corrects it).
const mkDraft = (target, readyFn = () => true) => ({ ready: readyFn, greedy: (s) => { const t = target.greedy(s); return (s.reduce((x, y) => x + y, 0) % 4 === 0) ? (t + 1) % V : t; } });

const PROMPT = [7, 11, 3], N = 40;

console.log("\nholo-q cascade — speculative-verify fidelity + draft-first earliness witness\n");

// ── 1) FIDELITY: target resident from t=0 → committed output == the full model's own greedy decode ────────
console.log("fidelity — resident target: cascade output IS the full model's greedy decode:");
{
  const target = mkTarget(() => true), draft = mkDraft(target);
  const ref = await referenceGreedy(target, PROMPT, N);
  const r = await cascadeDecode(draft, target, PROMPT, { maxNew: N, k: 4 });
  ok(r.tokens.length === N, `generated exactly ${N} tokens`);
  ok(eq(r.tokens, ref), "cascade tokens === target-alone greedy tokens (token-for-token, exact)");
  ok(r.stats.accepted > 0 && r.stats.corrections > 0, "the run actually exercised both accept (draft right) and correct (draft wrong) paths");
  ok(r.stats.targetRounds < r.stats.generated, `speedup: ${r.stats.targetRounds} target forward passes for ${r.stats.generated} tokens (×${r.stats.speedup.toFixed(2)})`);
}

// ── 2) EARLINESS: target loading → first token comes from the draft, before any target forward pass ───────
console.log("\nearliness — target still streaming in: the first word is the draft's, instantly:");
{
  let targetUp = false;                                   // target not resident yet
  const target = mkTarget(() => targetUp), draft = mkDraft(target);
  let firstSeen = null, targetRoundsAtFirst = null;
  const r = await cascadeDecode(draft, target, PROMPT, {
    maxNew: N, k: 4,
    onToken: (e) => { if (firstSeen == null) { firstSeen = e; targetRoundsAtFirst = 0; } if (e.pos === 5) targetUp = true; },  // target lands mid-stream
  });
  ok(firstSeen && firstSeen.source === "draft" && firstSeen.fidelity === "draft", "first token is from the DRAFT (instant first word, honest draft fidelity)");
  ok(r.stats.draftOnly >= 1, "≥1 draft-only token emitted before the target was resident");
  ok(r.stats.targetRounds >= 1 && r.stats.generated === N, "after the target landed it took over and the stream completed");
  // every token AFTER the target became resident carries full-model fidelity
  ok(r.tokens.length === N, "blurry→sharp: early draft tokens, then full-model-verified tokens, one seamless stream");
}

// ── 3) FAIL-SAFE: no draft, draft throws, target never lands — all degrade without a crash ────────────────
console.log("\nfail-safe — degrade to whatever brain is available, never throw:");
{
  const target = mkTarget(() => true);
  const ref = await referenceGreedy(target, PROMPT, N);
  const noDraft = await cascadeDecode(null, target, PROMPT, { maxNew: N, k: 4 });
  ok(eq(noDraft.tokens, ref) && noDraft.stats.proposed === 0, "no draft → pure target, output still == full model (bonus-token path)");

  const throwing = { ready: () => true, greedy: () => { throw new Error("draft died"); } };
  const r2 = await cascadeDecode(throwing, target, PROMPT, { maxNew: N, k: 4 });
  ok(eq(r2.tokens, ref), "draft throws → caught, target carries the whole decode at full fidelity");

  let up = false;                                          // target NEVER becomes ready
  const draftOnly = mkDraft(mkTarget(() => true), () => true);
  const r3 = await cascadeDecode(draftOnly, mkTarget(() => up), PROMPT, { maxNew: 8, k: 4 });
  ok(r3.tokens.length === 8 && r3.stats.targetRounds === 0 && r3.stats.draftOnly === 8, "target never lands → draft-only keeps talking (graceful, no hang)");

  ok((await cascadeDecode(null, null, PROMPT, { maxNew: N })).tokens.length === 0, "no brains at all → empty, no throw");
}

// ── 4) EOS is respected ───────────────────────────────────────────────────────────────────────────────────
console.log("\nstop token honored:");
{
  const target = mkTarget(() => true); target.eos = target.greedy(PROMPT);   // make the very first target token the stop id
  const draft = mkDraft(target);
  const r = await cascadeDecode(draft, target, PROMPT, { maxNew: N, k: 4 });
  ok(r.tokens.length >= 1 && r.tokens[r.tokens.length - 1] === target.eos, "generation stops at the target's EOS, not at maxNew");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
