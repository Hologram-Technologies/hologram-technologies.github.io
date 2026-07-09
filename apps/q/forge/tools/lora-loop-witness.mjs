// Witness the PER-USER fine-tune LOOP (holo-lora-train-loop): it actually LEARNS on the proven primitives.
// Frozen W0; an adapter is trained from (x → target token) SFT samples via forward→masked-CE→backward→AdamW.
// Proves: loss FALLS; the adapter makes the model predict targets the frozen base W0 alone CANNOT; the
// training checkpoint is a content-addressed κ that re-derives (resume), and a tampered checkpoint is REFUSED
// (L5). This is "the model becomes yours" — on-device, κ-sealed. (The real run wraps the SAME primitives
// around the whole transformer on the GPU; that scale is OUT-OF-BAND here.)
import { trainLoRA, predict, resumeCheckpoint } from "../holo-lora-train-loop.mjs";

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
const lcg = (s) => { let x = (s >>> 0) || 1; return () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x / 4294967296 - 0.5; }; };

const dims = { inn: 16, out: 8, r: 4 }, scale = 1;
const rw = lcg(7); const W0 = new Float32Array(dims.out * dims.inn); for (let i = 0; i < W0.length; i++) W0[i] = rw() * 0.5;   // frozen base
const rx = lcg(99); const mk = () => { const x = new Float32Array(dims.inn); for (let i = 0; i < dims.inn; i++) x[i] = rx(); return x; };
const targets = [0, 3, 5, 7];                                   // the per-user "preference" to learn
const samples = targets.map((tg) => ({ x: mk(), target: tg }));

// baseline: what the FROZEN base model predicts (no adapter)
const baseAcc = samples.filter((s) => predict(W0, null, null, scale, s.x, dims, false) === s.target).length;

const res = trainLoRA({ W0, dims, samples, steps: 500, lr: 0.08, scale, seed: 1 });
const first = res.losses[0], last = res.losses[res.losses.length - 1];
const adaptAcc = samples.filter((s) => predict(W0, res.A, res.B, scale, s.x, dims, true) === s.target).length;

ok(last < first * 0.5, `loss falls ${first.toFixed(3)} → ${last.toFixed(4)} (the loop is learning)`);
ok(adaptAcc === samples.length, `adapter predicts ${adaptAcc}/${samples.length} target tokens correctly (learned your preference)`);
ok(adaptAcc > baseAcc, `adapter ADDED capability the frozen base lacked (base ${baseAcc}/${samples.length} → adapted ${adaptAcc}/${samples.length})`);
ok(res.checkpoint.kappa && res.checkpoint.kappa.startsWith("sha256:"), `training checkpoint is a content-addressed κ (${res.checkpoint.kappa.slice(0, 22)}…)`);

// resume: load-by-κ re-derives the exact A/B
const loaded = resumeCheckpoint(res.checkpoint.bytes, res.checkpoint.kappa);
ok(loaded.A.length === res.A.length && loaded.A.every((v, i) => v === res.A[i]) && loaded.B.every((v, i) => v === res.B[i]), "resume: checkpoint κ re-derives the EXACT adapter (A,B) — immutable κ-DAG of checkpoints");
// tamper → L5 refuse
let refused = false; try { const bad = res.checkpoint.bytes.slice(); bad[bad.length >> 1] ^= 0xff; resumeCheckpoint(bad, res.checkpoint.kappa); } catch (e) { refused = true; }
ok(refused, "tampered checkpoint → REFUSED (L5 fail-closed)");
// determinism: same data + seed → same adapter κ (re-derivable training run)
const res2 = trainLoRA({ W0, dims, samples, steps: 500, lr: 0.08, scale, seed: 1 });
ok(res2.checkpoint.kappa === res.checkpoint.kappa, "deterministic: same data+seed → same adapter κ (re-derivable on-device run)");

console.log(`\n${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED: the per-user LoRA loop LEARNS on-device, seals each step as a κ, resumes by κ, refuses tamper"}`);
process.exit(fail ? 1 : 0);
