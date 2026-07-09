// gguf-forge-kstream witness — the LLM runs 100% from κ-bodies, loaded BY κ with L5, no re-forge.
//   • open the REAL qwen2.5-0.5b .holo (per-tensor κ-bodies) → forge-compatible plan + L5 store
//   • run the Tier-A forward sourcing EVERY weight by its κ (per-block L5 on first use, cached after)
//   • argmax must equal the witnessed forge/llama.cpp result (3283) → parity preserved through κ-stream
//   • a tampered archive is refused (footer L5)
// This is the substrate load path of the vision (no monolithic re-forge); the browser streams the SAME
// .holo over HTTP-Range / SW κ-route / IPFS via openGgufHoloStream — serverless + verified + warm-cached.
import { readFileSync } from "node:fs";
import { openGgufHolo, kstreamLoad } from "./gguf-forge-kstream.mjs";
import { readHolo } from "./holo-archive.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";

const HOLO = "./.models/qwen2.5-0.5b-instruct.holo";
const TOKENS = [785, 6722, 374, 264];          // "The capital of France is" — witnessed argmax 3283 (== llama.cpp)
const EXPECT = 3283;
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
const t0 = Date.now(), el = () => ((Date.now() - t0) / 1000).toFixed(0) + "s";

const bytes = new Uint8Array(readFileSync(HOLO));
console.log(`[${el()}] read ${(bytes.length / 1e6 | 0)}MB .holo`);

// 1. open by κ — plan reconstructed from the embedded gguf.header + name→κ directory (no GGUF re-forge)
const cache = new Map();
const { plan, store, rootHolo, meta } = openGgufHolo(bytes, { cache });
console.log(`[${el()}] opened: arch=${plan.arch} tensors=${plan.tensors.length} rootHolo=${String(rootHolo).slice(0, 28)}…`);
ok(plan.arch === "qwen2" && plan.tensors.length === meta.nTensors && plan.tensors.every((t) => /sha256:[0-9a-f]{64}/.test(t.kappa)),
   `opened from κ-bodies: ${plan.tensors.length} tensors each addressed by κ (no monolithic re-forge)`);

// 2. L5 verify-on-receipt: every body re-derives to its κ on first get (store throws on mismatch)
const probe = plan.tensors[10].kappa.split(":").pop();
let l5ok = false; try { const b = store.get(probe); l5ok = !!b; } catch { l5ok = false; }
ok(l5ok, `per-body L5: weight loaded by κ re-derives + is accepted`);
// tamper the archive → footer L5 refuses the whole thing
const tampered = bytes.slice(); tampered[Math.floor(bytes.length / 2)] ^= 0xff;
let refused = false; try { readHolo(tampered); } catch { refused = true; }
ok(refused, `tampered archive is REFUSED on receipt (footer L5)`);

// 3. RUN the model from the κ-stream store — every matvec sources its weight by κ (cached after first L5)
const graph = synthesizeGraph(plan);
console.log(`[${el()}] graph: family=${graph.family} layers=${graph.stats.n_layer} — running forward from κ-bodies…`);
const logits = forward(plan, graph, store, TOKENS, { load: kstreamLoad });
let am = 0; for (let j = 1; j < logits.length; j++) if (logits[j] > logits[am]) am = j;
console.log(`[${el()}] forward done: argmax=${am}, ${cache.size} κ-blocks cached (warm = O(1))`);
ok(am === EXPECT, `forward FROM κ-bodies → argmax ${am} == witnessed forge/llama.cpp (${EXPECT}) — parity preserved through the κ-stream`);
ok(cache.size === plan.tensors.length, `every weight loaded exactly once by κ then cached (${cache.size}/${plan.tensors.length}) — O(1) warm reuse`);

console.log(`\n[${el()}] ${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED: the LLM runs from κ-bodies by κ, L5, parity-exact"}`);
process.exit(fail ? 1 : 0);
