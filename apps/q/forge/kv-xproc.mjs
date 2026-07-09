// Cross-process prefix-KV witness (substrate-convergence S4). Two separate node
// processes share KV state through a content-addressed on-disk store — proving the
// runtime's KV is portable across the process boundary (what llama.cpp/vLLM in-RAM
// caches cannot do):
//   node kv-xproc.mjs produce <dir>   # prefill prefix, persist KV blobs + index, print golden next-token
//   node kv-xproc.mjs consume <dir>   # FRESH process: restore blob from disk, decode suffix only, match golden
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { KvStore } from "./gguf-forge-kvcache.mjs";

const MODE = process.argv[2], DIR = process.argv[3];
const MODEL = ".models/qwen2.5-0.5b-instruct-q4_k_m.gguf";
const PREFIX = [785, 6722, 374], SUFFIX = [264, 11, 13], SEQ = [...PREFIX, ...SUFFIX];

const f = forgeGguf(new Uint8Array(readFileSync(MODEL)));   // weights re-forged in BOTH processes (deterministic root κ)
const graph = synthesizeGraph(f.plan);
const wstore = { get: (hex) => f.blocks.get(hex) };
const argmax = (lg) => { let am = 0; for (let i = 1; i < lg.length; i++) if (lg[i] > lg[am]) am = i; return am; };

if (MODE === "produce") {
  const golden = argmax(forward(f.plan, graph, wstore, SEQ));         // full forward → golden next token
  const kv = new KvStore();
  const outKV = {}; forward(f.plan, graph, wstore, PREFIX, { outKV });
  kv.put(f.rootKappa, PREFIX, outKV);
  const { index, blocks } = kv.export();
  mkdirSync(DIR, { recursive: true });
  for (const contentHex of Object.keys(blocks)) writeFileSync(join(DIR, contentHex + ".kvb"), blocks[contentHex]);
  writeFileSync(join(DIR, "index.json"), JSON.stringify({ model: f.rootKappa, prefix: PREFIX, seq: SEQ, golden, index }));
  console.log(`PRODUCE ok: root=${f.rootKappa.slice(0, 28)}… golden=${golden} blobs=${Object.keys(blocks).length}`);
} else if (MODE === "consume") {
  const meta = JSON.parse(readFileSync(join(DIR, "index.json"), "utf8"));
  if (meta.model !== f.rootKappa) throw new Error("model root mismatch across processes");
  const blocks = {};
  for (const tokenHex of Object.keys(meta.index)) { const ch = meta.index[tokenHex].contentHex; if (!blocks[ch]) blocks[ch] = new Uint8Array(readFileSync(join(DIR, ch + ".kvb"))); }
  const kv = new KvStore().import({ index: meta.index, blocks });    // L5-verifies each blob
  const hit = kv.longestPrefix(f.rootKappa, SEQ);                    // restore prefix produced by the OTHER process
  if (!hit || hit.len !== PREFIX.length) throw new Error(`prefix not restored from disk (len=${hit?.len})`);
  const lg = forward(f.plan, graph, wstore, SEQ, { inKV: hit.kv });  // decode SUFFIX only — no re-prefill of P
  const am = argmax(lg), decoded = SEQ.length - hit.len;
  const ok = am === meta.golden;
  console.log(`CONSUME ${ok ? "ok" : "FAIL"}: restored ${hit.len}/${SEQ.length} from disk, decoded only ${decoded} suffix tok, next=${am} ${ok ? "==" : "!="} golden ${meta.golden}`);
  process.exit(ok ? 0 : 1);
} else {
  console.error("usage: kv-xproc.mjs produce|consume <dir>"); process.exit(2);
}
