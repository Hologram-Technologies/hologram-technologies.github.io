// CPU reference for adapter-inference parity: run qwen via the exec WITH the test adapter on attn_q,
// and base (no adapter). The browser run-native ?adapter=1 must reproduce the ADAPTED next-token, and
// it must DIFFER from base (the adapter has a real effect). Same genTestAdapter → same delta both sides.
import { readFileSync } from "node:fs";
import { openGgufHolo, kstreamLoad } from "../gguf-forge-kstream.mjs";
import { synthesizeGraph } from "../gguf-forge-graph.mjs";
import { forward } from "../gguf-forge-exec.mjs";
import { makeTokenizer } from "../gguf-forge-tokenizer.mjs";
import { genTestAdapter } from "../gpu/holo-lora.mjs";

const { plan, store, headerBytes } = openGgufHolo(new Uint8Array(readFileSync("./.models/qwen2.5-0.5b-instruct.holo")));
const graph = synthesizeGraph(plan), S = graph.stats, tok = makeTokenizer(headerBytes);
const D = S.n_embd, QD = S.n_head * S.head_dim, r = 8, scale = 1.0;
const ids = tok.encode("The capital of France is", { addSpecial: false });
const am = (lg) => { let m = 0; for (let j = 1; j < lg.length; j++) if (lg[j] > lg[m]) m = j; return m; };

// build the adapter + the exec map keyed by each layer's attn_q κ
const ad = genTestAdapter({ seed: 1, inn: D, out: QD, r, nLayer: S.n_layer, scale, amp: 0.3 });
const adapter = {};
for (let L = 0; L < S.n_layer; L++) { const w = graph.weights[`blk.${L}.attn_q.weight`]; adapter[w.kappa] = { A: ad.layers[L].A, B: ad.layers[L].B, scale, inn: D, out: QD, r }; }

const base = am(forward(plan, graph, store, ids, { load: kstreamLoad }));
const adapted = am(forward(plan, graph, store, ids, { load: kstreamLoad, adapter }));
console.log(`D=${D} QD=${QD} r=${r} layers=${S.n_layer}`);
console.log(`BASE   next-token = ${base} ${JSON.stringify(tok.decode([base]))}`);
console.log(`ADAPT  next-token = ${adapted} ${JSON.stringify(tok.decode([adapted]))}`);
console.log(adapted !== base ? "✓ adapter CHANGES the output (real effect)" : "(adapter did not change argmax — bump amp)");
console.log(`\nWITNESS_BASE=${base}\nWITNESS_ADAPT=${adapted}`);
