// holo-model-frame.mjs — A1 of the personal-model-zoo plan: the CANONICAL SHARED FRAME standard + a
// conformance gate, so every κ-addressable .holo LLM DECLARES the quantization frame it lives in.
//
// Why this exists: two models can family-dedup / index-delta (A2) ONLY if their unchanged tensors
// produce BYTE-IDENTICAL κ-blocks — which requires the SAME quantization transform ("frame"). The frame
// is the transform identity (codec, layout, bits, mode, twoBit, incoherence), NOT the model's weights or
// dims. The incoherence rotation is already deterministic (signed-FWHT seeded by tensor width K, see
// e8-quant.mjs signsFor), so a frame is reproducible from its descriptor alone.
//
// HONEST SCOPE: this does NOT requantize anything. Today's models are standard quant frames
// (holo-quant/<layout>-<bits>); the shared E8 frame (atlas-e8/v1) is what models compiled through the
// incoherent-E8 path carry. Moving everything into atlas-e8/v1 is Track B (gated on the 2-bit quality
// experiment), deliberately not done here. A1 just makes the frame EXPLICIT and ENFORCED.
//
// Pure JS, isomorphic (browser + Node 18+), zero deps. Node self-test scans ./models/<name>/manifest.json.

const FRAME_V = 1;

// the fields that DEFINE a quantization transform — two models with the same fingerprint apply the
// identical transform, so identical weights ⇒ identical κ-blocks (the precondition for A2 dedup).
const FRAME_KEYS = ["codec", "layout", "bits", "mode", "twoBit", "incoherent", "grid"];

async function sha256hex(str) {
  const u8 = new TextEncoder().encode(str);
  const d = await (globalThis.crypto || (await import("node:crypto")).webcrypto).subtle.digest("SHA-256", u8);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// extract the frame-defining descriptor from a compiled-model manifest (holo-2bit/1 shape).
export function frameDescriptor(m) {
  const d = {
    codec: m.format || "unknown",          // e.g. "holo-2bit/1"
    layout: m.layout || null,              // e.g. "q3f"
    bits: m.bits ?? null,                  // e.g. 3
    mode: m.mode || null,                  // e.g. "bitnet" | "q3"
    twoBit: !!m.twoBit,
    incoherent: !!m.incoherent,            // QuIP#-style signed-FWHT rotation applied
    grid: m.grid || (m.incoherent ? "e8" : "scalar")   // e8 lattice vs scalar grid
  };
  return d;
}

// the canonical id for a frame — atlas-e8/v1 is THE shared frame family members ride; everything else
// declares its own standalone quant frame (still conformant, just not E8-shareable).
export function frameId(desc) {
  if (desc.incoherent && desc.grid === "e8") return "atlas-e8/v1";
  return `holo-quant/${desc.layout || desc.mode || "q"}-${desc.bits ?? "x"}bit`;
}

export async function frameFingerprint(desc) {
  const canon = JSON.stringify(FRAME_KEYS.map((k) => [k, desc[k]]));   // fixed key order ⇒ stable hash
  return (await sha256hex(canon)).slice(0, 32);
}

// STAMP: add an explicit, self-verifying frame block to a manifest (idempotent).
export async function stampFrame(m) {
  const desc = frameDescriptor(m);
  m.frame = { v: FRAME_V, id: frameId(desc), fingerprint: await frameFingerprint(desc), ...desc };
  return m;
}

// CONFORMANCE GATE: a .holo LLM must DECLARE a frame whose fingerprint re-derives from its own fields.
// Rejects: no frame block, tampered/mismatched fingerprint, or unknown frame version.
export async function checkFrame(m) {
  if (!m || !m.frame) return { conforms: false, reason: "no frame declared (run stampFrame at compile)" };
  if (m.frame.v !== FRAME_V) return { conforms: false, reason: `unknown frame version ${m.frame.v}` };
  const want = await frameFingerprint(frameDescriptor(m));
  if (m.frame.fingerprint !== want) return { conforms: false, reason: `fingerprint mismatch (manifest changed since stamp): ${m.frame.fingerprint} != ${want}` };
  return { conforms: true, id: m.frame.id, fingerprint: m.frame.fingerprint, shared: m.frame.id === "atlas-e8/v1" };
}

// can two stamped models family-dedup / index-delta? Same transform (fingerprint) AND same architecture.
export function shareable(a, b) {
  if (!a.frame || !b.frame) return false;
  if (a.frame.fingerprint !== b.frame.fingerprint) return false;
  for (const k of ["d", "n_layers", "ff", "n_heads", "n_kv_heads", "hd", "vocab"]) if (a[k] !== b[k]) return false;
  return true;
}

// ── Node self-test: scan ./models/*/manifest.json, stamp + gate them, group by family-dedup class,
//    and prove the gate rejects a planted non-conformer. ──
if (typeof process !== "undefined" && process.argv[1] && process.argv[1].endsWith("holo-model-frame.mjs")) {
  const fs = await import("node:fs"); const path = await import("node:path");
  const root = path.join(process.cwd(), "models");
  const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, "manifest.json"))) : [];
  const rows = [], byClass = {};
  for (const name of dirs) {
    let m; try { m = JSON.parse(fs.readFileSync(path.join(root, name, "manifest.json"), "utf8")); } catch { continue; }
    await stampFrame(m);
    const chk = await checkFrame(m);
    const key = `${m.frame.id} · d${m.d}·L${m.n_layers}·ff${m.ff}`;
    (byClass[key] ||= []).push(name);
    rows.push({ model: name, id: m.frame.id, fp: m.frame.fingerprint.slice(0, 12), conforms: chk.conforms, shared: !!chk.shared });
  }
  console.log("\n— frame stamp + conformance over ./models —");
  for (const r of rows) console.log(`  ${r.conforms ? "✓" : "✗"} ${r.model.padEnd(16)} ${r.id.padEnd(22)} fp=${r.fp} ${r.shared ? "[E8-shared]" : "[standalone]"}`);
  console.log("\n— family-dedup classes (same frame + same arch ⇒ A2 can dedup/delta) —");
  for (const [k, v] of Object.entries(byClass)) console.log(`  ${v.length}× ${k}\n        ${v.join(", ")}`);
  // gate must REJECT a non-conformer
  const planted = { format: "holo-2bit/1", layout: "q3f", bits: 3 };   // no frame block
  const bad = await checkFrame(planted);
  const tampered = await stampFrame({ format: "holo-2bit/1", layout: "q3f", bits: 3, incoherent: false });
  tampered.bits = 2;   // change a frame-defining field AFTER stamping → stored fingerprint must no longer match
  const badly = await checkFrame(tampered);
  console.log(`\n— gate rejection proof —\n  no-frame:  conforms=${bad.conforms}  (${bad.reason})\n  tampered:  conforms=${badly.conforms}  (${badly.reason})`);
}
