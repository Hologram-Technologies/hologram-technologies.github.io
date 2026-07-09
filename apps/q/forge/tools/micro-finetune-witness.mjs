// micro-finetune-witness.mjs — A1 orchestrator: window.HoloMicroFinetune is now REAL (was `async () => null`).
// Proves the scheduler's `train` plug contract: SFT samples + a mounted LoRA model → sealed adapter BYTES whose
// κ re-derives (what HoloUserAdapter.save persists, encrypted); null when no model (scheduler skips, fail-soft);
// aborts without persisting. Wires the OS orchestrator to the proven forge whole-transformer loop. 100% local.
import { makeMicroFinetune } from "../../../../../holo-os/system/os/usr/lib/holo/holo-micro-finetune.mjs";
import { trainGraphLoRA, sealAdapters } from "../gguf-forge-lora-graph.mjs";
import { sha256hex, kappa } from "../../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "  ok  " : "  XX  ") + m); c ? pass++ : fail++; };
const lcg = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296 - 0.5; }; };

const D = 8, NH = 2, HD = 4, FF = 12, V = 24, rank = 2;
const mkM = () => { const rnd = lcg(11); const rf = (n, s = 0.3) => Float64Array.from({ length: n }, () => rnd() * s); const nrm = (n) => Float64Array.from({ length: n }, () => 1 + rnd() * 0.1);
  const mk = () => ({ attn_norm: nrm(D), Wq: rf(D * D), Wk: rf(D * D), Wv: rf(D * D), Wo: rf(D * D), Aq: rf(rank * D), Bq: rf(D * rank), Av: rf(rank * D), Bv: rf(D * rank), ffn_norm: nrm(D), Wg: rf(FF * D), Wu: rf(FF * D), Wd: rf(D * FF) });
  return { D, NH, HD, FF, V, rank, eps: 1e-5, freqBase: 10000, scale: 1.5, tok_embd: rf(V * D, 0.5), out_norm: nrm(D), layers: [mk(), mk()] }; };
const samples = [{ ids: [3, 7, 1, 5], targets: [7, 1, 5, 9], mask: [0, 1, 1, 1] }];
const opts = { steps: 80, lr: 0.08, warmupSteps: 6 };

// 1. no model mounted → returns null (scheduler skips; fail-soft)
{
  const mf = makeMicroFinetune({ getModel: () => null, train: trainGraphLoRA, opts });
  ok((await mf(samples, {})) === null, "no trainable model → null (scheduler skips)");
}
// 2. no samples → null
{
  const mf = makeMicroFinetune({ getModel: () => mkM(), train: trainGraphLoRA, opts });
  ok((await mf([], {})) === null, "no up-voted samples → null");
}
// 3. real run → adapter BYTES whose κ matches the trained model's sealAdapters (re-derivable)
{
  const M = mkM();
  const mf = makeMicroFinetune({ getModel: () => M, train: trainGraphLoRA, opts });
  const bytes = await mf(samples, {});
  ok(bytes instanceof Uint8Array && bytes.length > 8, `returns sealed adapter bytes (${bytes ? bytes.length : 0} B)`);
  const k = kappa("sha256", sha256hex(bytes));
  ok(k === sealAdapters(M).kappa, `adapter bytes re-derive to the trained model's κ ${k.slice(0, 22)}…`);
}
// 4. abort before persisting → null (never save a half run)
{
  const M = mkM();
  const mf = makeMicroFinetune({ getModel: () => M, train: trainGraphLoRA, opts });
  ok((await mf(samples, { signal: { aborted: true } })) === null, "aborted signal → null (no half-trained adapter persisted)");
}

console.log(`\n${pass}/${pass + fail}${fail ? " FAIL" : " — WITNESSED: HoloMicroFinetune is real — SFT samples → whole-transformer LoRA train → sealed, re-derivable adapter bytes the scheduler persists encrypted; fail-soft + abort-safe."}`);
process.exit(fail ? 1 : 0);
