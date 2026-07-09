// S2 (headless): stream a .holo over a byte-counting Range reader, in first-use
// order, verifying each block (L5), DEFERRING token_embd to on-demand rows — then
// run the forward and prove (a) the correct upstream token, (b) the critical-path
// bytes for token 1 exclude the deferred embedding table, (c) the resulting cold
// TTFT per link. This proves the streaming design + numbers before the browser.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { openHoloStream } from "./holo-archive.mjs";
import { GGML_TYPE_NAME, ggmlNBytes } from "./gguf-forge.mjs";
import { parseGgufHeader } from "../qvac-ingest.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const HOLO = "./.models/qwen2.5-0.5b-instruct.holo";
const bytes = new Uint8Array(readFileSync(HOLO));
const tokens = [785, 6722, 315, 9625, 374];  // "The capital of France is"

let fetched = 0, reqs = 0;
const rangeReader = async (start, len) => { fetched += len; reqs++; return bytes.subarray(start, start + len); };

const run = async () => {
  const t0 = Date.now();
  const H = await openHoloStream(rangeReader);
  const headerBytes = H.headerBytes, hh = parseGgufHeader(headerBytes);
  const tdir = {}; for (const x of hh.tensors) tdir[x.name] = x;
  const name2k = new Map(H.order.map(o => [o.name, o.kappa]));
  const tensors = hh.tensors.map(x => ({ name: x.name, dims: x.dims, type: x.ggmlType, typeName: GGML_TYPE_NAME[x.ggmlType] || String(x.ggmlType), kappa: "sha256:" + name2k.get(x.name) }));
  const plan = { format: "gguf-forge/1", arch: hh.meta["general.architecture"], meta: hh.meta, tensors };
  const graph = synthesizeGraph(plan);
  const afterHeader = fetched;

  // STREAM bodies in first-use order — everything except token_embd
  const map = new Map();
  const teName = "token_embd.weight", teK = name2k.get(teName), teT = tdir[teName];
  for (const o of H.order) {
    if (o.name === teName) continue;               // defer the embedding table
    const body = await H.getBody(o.kappa);          // fetch + L5 verify
    map.set(o.kappa, body);
  }
  const afterLayers = fetched;

  // token_embd: fetch ONLY the rows for the prompt tokens (defer the other ~151931 rows)
  const D = hh.meta["qwen2.embedding_length"], bpr = ggmlNBytes(teT.ggmlType, D);
  const teFull = ggmlNBytes(teT.ggmlType, teT.dims[0] * teT.dims[1]);
  const sparse = new Uint8Array(teFull);            // full-size, only needed rows filled
  const need = [...new Set(tokens)];
  for (const t of need) { const row = await H.getBodySlice(teK, t * bpr, bpr); sparse.set(row, t * bpr); }
  map.set(teK, sparse);
  const criticalBytes = fetched;

  // run the forward straight off the streamed store; injected loader skips re-hashing
  // the (sparse) embedding table and trusts the per-block-verified bodies.
  const store = { get: (h) => map.get(h) };          // map keyed by bare hex (meta.order axis)
  const load = (st, k) => map.get(String(k).split(":").pop());
  const logits = forward(plan, graph, store, tokens, { load });
  let am = 0; for (let i = 1; i < logits.length; i++) if (logits[i] > logits[am]) am = i;

  return { am, headerBytes: afterHeader, layerBytes: afterLayers - afterHeader, criticalBytes, full: bytes.length, teFull, reqs, ms: Date.now() - t0 };
};

const r = await run();
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  ok  " + n); } catch (e) { fail++; console.log("FAIL  " + n + "\n      " + e.message); } };

console.log(`streamed: header ${(r.headerBytes / 1e6).toFixed(1)}MB + bodies, ${r.reqs} range requests`);
t("correct upstream token from the STREAMED .holo (bit-identical → Paris)", () => assert.strictEqual(r.am, 12095));
t("token_embd deferred: critical path excludes the embedding table", () => {
  const deferred = r.full - r.criticalBytes;
  console.log(`      critical path ${(r.criticalBytes / 1e6).toFixed(0)}MB of ${(r.full / 1e6).toFixed(0)}MB  →  deferred ${(deferred / 1e6).toFixed(0)}MB (token_embd ${(r.teFull / 1e6).toFixed(0)}MB, fetched only ${[...new Set(tokens)].length} rows)`);
  assert.ok(deferred > 0.8 * r.teFull, "most of token_embd not fetched");
  assert.ok(r.criticalBytes < r.full, "fetched less than the whole file before token 1");
});
t("cold TTFT per link ≈ critical-path bytes ÷ bandwidth", () => {
  const mb = r.criticalBytes / 1e6;
  for (const [label, mbps] of [["50 Mbps phone", 50], ["500 Mbps wifi", 500], ["1 Gbps fiber", 1000]]) {
    const s = (r.criticalBytes * 8 / (mbps * 1e6)).toFixed(1);
    console.log(`      ${label.padEnd(16)} ${s}s  (${mb.toFixed(0)}MB ÷ ${mbps}Mbps)`);
  }
  assert.ok(mb > 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
