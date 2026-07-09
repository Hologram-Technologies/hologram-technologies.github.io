// Forge the deterministic test adapter (attn_q, the one ?adapter=1 generates in-page) into a real .holo
// addressed by κ — so it can be opened by a link exactly like a model. Per-layer A/B = κ-bodies; meta
// carries {target,r,scale,inn,out,nLayer,baseModel}. Footer κ = the adapter's shareable identity.
import { readFileSync, writeFileSync } from "node:fs";
import { openGgufHolo } from "../gguf-forge-kstream.mjs";
import { synthesizeGraph } from "../gguf-forge-graph.mjs";
import { writeHoloArchive } from "../holo-archive.mjs";
import { genTestAdapter } from "../gpu/holo-lora.mjs";
import { sha256hex } from "../../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

// dims from the base model (qwen attn_q): inn = n_embd, out = n_head·head_dim
const { plan, rootHolo } = openGgufHolo(new Uint8Array(readFileSync("./.models/qwen2.5-0.5b-instruct.holo")));
const S = synthesizeGraph(plan).stats;
const inn = S.n_embd, out = S.n_head * S.head_dim, r = 8, scale = 1.0, amp = 0.3, nLayer = S.n_layer;
const ad = genTestAdapter({ seed: 1, inn, out, r, nLayer, scale, amp });

const bodies = [], order = [];
const u8 = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
for (let L = 0; L < nLayer; L++) {
  for (const [nm, arr] of [["blk." + L + ".A", ad.layers[L].A], ["blk." + L + ".B", ad.layers[L].B]]) {
    const bytes = u8(arr), kappa = sha256hex(bytes);
    bodies.push({ kappa, bytes }); order.push({ name: nm, kappa });
  }
}
const meta = { format: "holo-adapter/1", target: "attn_q", r, scale, inn, out, nLayer, baseModel: String(rootHolo), order };
const { holo, footer, bytes } = writeHoloArchive({ meta, bodies, extKey: "holo.adapter" });
writeFileSync("./.models/qwen-attn_q-adapter.holo", holo);
console.log(`wrote ./.models/qwen-attn_q-adapter.holo (${(bytes / 1e3 | 0)} KB, ${nLayer} layers × {A,B}, ${bodies.length} κ-bodies)`);
console.log("adapter footer κ:", footer);
console.log("ADAPTER_KAPPA=" + String(footer).split(":").pop());
