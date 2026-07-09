// holo-lora.mjs — a LoRA adapter as a κ-object + a deterministic test adapter shared by the GPU runtime
// and the CPU witness. An adapter is the learned delta y += scale·B·(A·x) on top of a base linear; it is
// content (per-layer A,B matrices) → content-addressed (its κ), shareable as a link, applied on-device.
// genTestAdapter produces a small reproducible adapter (seeded LCG, identical in Node + browser) so the
// GPU forward and the CPU oracle apply the SAME delta — proving adapter-inference parity.

import { readHolo, writeHoloArchive } from "../holo-archive.mjs";

const lcg = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s / 4294967296 - 0.5) * 2; }; };

// Open a LoRA adapter sealed as a .holo (writeHoloArchive): per-layer A/B loaded BY κ with per-body L5 +
// footer L5 (a tampered body is REFUSED). Same rails as a model (readHolo store). Returns {meta, layers, footer}.
export function openAdapterHolo(bytes) {
  const h = readHolo(bytes);                              // footer L5 + per-body L5 store + meta
  const m = h.meta, byName = new Map(m.order.map((o) => [o.name, o.kappa]));
  const f32 = (name) => { const c = h.store.get(byName.get(name)).slice(); return new Float32Array(c.buffer, c.byteOffset, c.byteLength / 4); };  // each body re-derives its κ (L5) on get
  const layers = [];
  for (let L = 0; L < m.nLayer; L++) layers.push({ A: f32("blk." + L + ".A"), B: f32("blk." + L + ".B") });
  return { meta: m, target: m.target, scale: m.scale, r: m.r, inn: m.inn, out: m.out, nLayer: m.nLayer, layers, footer: h.footer };
}

// adapter for ONE target module (e.g. attn_q) across all layers: layers[L] = {A:[r×inn], B:[out×r]}.
export function genTestAdapter({ seed = 1, inn, out, r, nLayer, scale = 1.0, amp = 0.05 }) {
  const layers = [];
  for (let L = 0; L < nLayer; L++) {
    const ra = lcg(seed * 100003 + L * 2 + 1), rb = lcg(seed * 100003 + L * 2 + 2);
    const A = new Float32Array(r * inn); for (let i = 0; i < A.length; i++) A[i] = ra() * amp;
    const B = new Float32Array(out * r); for (let i = 0; i < B.length; i++) B[i] = rb() * amp;
    layers.push({ A, B });
  }
  return { target: "attn_q", scale, inn, out, r, nLayer, layers };
}

// Seal an adapter (genTestAdapter / a trained checkpoint) as a .holo that openAdapterHolo reads back byte-for-byte:
// each per-layer A/B is a content body keyed by sha256(bytes) (L5 on get), meta carries {target,scale,r,inn,out,
// nLayer,order}. Footer = sha256(everything) = the adapter's shareable did:holo (a tampered body is REFUSED on open).
// sha256hex is injected (Node: holo-uor; browser: a hex-sha) so this stays DOM-free + dependency-free like the rest.
export function sealAdapterHolo(ad, sha256hex) {
  if (!ad || !ad.layers || !ad.nLayer) throw new Error("sealAdapterHolo: not an adapter");
  const order = [], bodies = [];
  const push = (name, f32) => {
    const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
    const hex = sha256hex(u8); order.push({ name, kappa: hex }); bodies.push({ kappa: hex, bytes: u8 });
  };
  for (let L = 0; L < ad.nLayer; L++) { push("blk." + L + ".A", ad.layers[L].A); push("blk." + L + ".B", ad.layers[L].B); }
  const meta = { format: "holo-lora/1", target: ad.target, scale: ad.scale, r: ad.r, inn: ad.inn, out: ad.out, nLayer: ad.nLayer, order };
  return writeHoloArchive({ meta, bodies, extKey: "holo.lora" });   // { holo, footer, bytes }
}

// raw f32 footprint of an adapter's deltas (the lower bound the seal rounds up from). Pure arithmetic, no alloc.
export function adapterBytes(ad) { let n = 0; for (const L of ad.layers) n += L.A.byteLength + L.B.byteLength; return n; }

// content identity of an adapter: sha256 over its bytes (the shareable κ). sha256hex injected (Node/browser).
export async function adapterKappa(ad, sha256hex) {
  const parts = [];
  for (const L of ad.layers) { parts.push(new Uint8Array(L.A.buffer, L.A.byteOffset, L.A.byteLength), new Uint8Array(L.B.buffer, L.B.byteOffset, L.B.byteLength)); }
  let n = 0; for (const p of parts) n += p.length; const all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return "sha256:" + (await sha256hex(all));
}
