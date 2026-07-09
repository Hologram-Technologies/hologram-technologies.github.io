// Witness the adapter .holo TRANSPORT the Q #adapter=κ chain rides: forge a LoRA adapter (attn_q) into a
// κ-addressed .holo, then open it the way createHoloModelBrain does (fetch κ → openAdapterHolo) and prove the
// decoded {target,scale,r,layers} round-trips EXACTLY, and that a tampered body is REFUSED (L5 footer).
// (The adapter DELTA math — y += scale·B·(A·x) — is already witnessed bit-exact + argmax-flipping by the C0/C1
//  GPU-vs-CPU parity; this closes the by-κ transport that feeds createHoloBrain({adapter}).)
import { writeHoloArchive } from "../holo-archive.mjs";
import { genTestAdapter, openAdapterHolo } from "../gpu/holo-lora.mjs";
import { sha256hex } from "../../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };

// qwen attn_q dims (inn = n_embd, out = n_head·head_dim); synthetic so no 500MB base model is needed.
const inn = 896, out = 896, r = 8, scale = 1.0, nLayer = 24;
const ad = genTestAdapter({ seed: 1, inn, out, r, nLayer, scale, amp: 0.3 });

const u8 = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const bodies = [], order = [];
for (let L = 0; L < nLayer; L++) {
  for (const [nm, arr] of [["blk." + L + ".A", ad.layers[L].A], ["blk." + L + ".B", ad.layers[L].B]]) {
    const bytes = u8(arr), kappa = sha256hex(bytes); bodies.push({ kappa, bytes }); order.push({ name: nm, kappa });
  }
}
const meta = { format: "holo-adapter/1", target: "attn_q", r, scale, inn, out, nLayer, baseModel: "sha256:test", order };
const { holo, footer, bytes } = writeHoloArchive({ meta, bodies, extKey: "holo.adapter" });
console.log(`forged adapter .holo (${(bytes / 1e3 | 0)} KB, ${nLayer}×{A,B}, footer ${String(footer).slice(0, 28)}…)`);

// OPEN exactly as createHoloModelBrain does post-fetch: openAdapterHolo(new Uint8Array(bytes))
const got = openAdapterHolo(new Uint8Array(holo));
ok(got.target === "attn_q", `target round-trips ("${got.target}")`);
ok(got.r === r && got.scale === scale && got.nLayer === nLayer && got.inn === inn && got.out === out, "r/scale/nLayer/inn/out round-trip");
ok(got.layers.length === nLayer, `${got.layers.length} layers decoded`);
ok(got.layers[0].A.length === r * inn && got.layers[0].B.length === out * r, "per-layer A:[r×inn] B:[out×r] shapes exact");
// the engine will use these EXACT bytes in P.f·P.f·P.saxpy — assert they equal the forged adapter, every layer
let exact = true;
for (let L = 0; L < nLayer && exact; L++) {
  const a = ad.layers[L].A, ga = got.layers[L].A, b = ad.layers[L].B, gb = got.layers[L].B;
  for (let i = 0; i < a.length; i++) if (a[i] !== ga[i]) { exact = false; break; }
  for (let i = 0; i < b.length && exact; i++) if (b[i] !== gb[i]) { exact = false; break; }
}
ok(exact, "decoded A/B == forged A/B, bit-exact across ALL layers (the delta the engine applies is the sealed one)");

// tamper one body byte → openAdapterHolo must REFUSE (L5), not serve a wrong weight
let refused = false;
try { const bad = new Uint8Array(holo); bad[(bad.length >> 1) | 0] ^= 0xff; openAdapterHolo(bad); } catch { refused = true; }
ok(refused, "tampered adapter body → openAdapterHolo REFUSES (L5 fail-closed)");

console.log(`\n${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED: adapter rides the κ-transport createHoloBrain({adapter}) consumes (forge→κ-bodies→L5-open→exact delta)"}`);
process.exit(fail ? 1 : 0);
