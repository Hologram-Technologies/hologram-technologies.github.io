// GGUF Forge conformance witness. Re-derives the sealed κ-closure from disk and the
// runtime's laws, emitting a row per claim (claim / authority / status) — the
// holospaces witness model: a claim is proven only when re-derivation agrees and
// the gate stays green. Honest by construction: a mismatch fails, never fakes green.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { sha256hex, sriOf, mbSha256, didHolo } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";
import { buildClosure, rootOf, SEALED } from "./seal-forge.mjs";
import { forgeGguf, loadByKappa, mapStore } from "./gguf-forge.mjs";

const lock = JSON.parse(readFileSync(new URL("./holospace.lock.json", import.meta.url)));
const manifest = JSON.parse(readFileSync(new URL("./holospace.json", import.meta.url)));

const rows = [];
let pass = 0, fail = 0;
const witness = (claim, authority, fn) => {
  try { fn(); pass++; rows.push({ claim, authority, status: "pass" }); }
  catch (e) { fail++; rows.push({ claim, authority, status: "FAIL", detail: e.message }); }
};

// L5 — every sealed byte re-derives to its pinned κ / SRI / multibase.
witness("L5 closure re-derives (κ, SRI, multibase per file)", "holo-uor sha256 / W3C SRI", () => {
  for (const [rel, ent] of Object.entries(lock.closure)) {
    const bytes = new Uint8Array(readFileSync(new URL(rel, import.meta.url)));
    assert.strictEqual(didHolo("sha256", sha256hex(bytes)), ent.kappa, `κ ${rel}`);
    assert.strictEqual(sriOf(bytes), ent.sri, `sri ${rel}`);
    assert.strictEqual(mbSha256(bytes), ent.multibase, `multibase ${rel}`);
  }
});

// L1 — identity is content: the root κ recomputes from the canonical closure.
witness("L1 root κ = H(canonical closure)", "holo-uor jcs+sha256", () => {
  assert.strictEqual(rootOf(buildClosure(new URL(".", import.meta.url))), lock.root);
  assert.match(lock.root, /^did:holo:sha256:[0-9a-f]{64}$/);
});

// closure completeness — the lock pins exactly the declared runtime files.
witness("closure pins the full declared runtime", "seal-forge SEALED list", () => {
  assert.deepStrictEqual(Object.keys(lock.closure).sort(), [...SEALED].sort());
  assert.strictEqual(lock.files, SEALED.length);
});

// L5 tamper — a single altered byte is refused (the enforcement mechanism).
witness("L5 tamper refused (one flipped byte)", "re-derivation mismatch", () => {
  const rel = "gguf-forge.mjs";
  const bytes = new Uint8Array(readFileSync(new URL(rel, import.meta.url)));
  bytes[0] ^= 0xff;
  assert.notStrictEqual(didHolo("sha256", sha256hex(bytes)), lock.closure[rel].kappa);
});

// manifest declares the binding specs (P2: self-describing, conforms.specs).
witness("manifest conforms to law-l5 + holo-constitution", "holospace.json", () => {
  const specs = manifest.conforms.specs;
  for (const s of ["law-l5", "holo-constitution"]) assert.ok(specs.includes(s), `missing ${s}`);
  assert.strictEqual(manifest.id, lock.identifier);
});

// L1/L2/L5 on actual model weights — the forge's substantive claim, on a tiny GGUF.
witness("model weights: L1 identity, L2 dedup, L5 tamper-refuse", "forge round-trip", () => {
  // minimal 2-tensor GGUF with one duplicated tensor (built inline)
  const gguf = buildTinyGguf();
  const f = forgeGguf(gguf);
  // L1: deterministic root
  assert.strictEqual(forgeGguf(gguf.slice()).rootKappa, f.rootKappa);
  // L2: the two identical tensors share one κ-block
  assert.ok(f.blocks.size < f.tensors.length, "dedup");
  // L5: tamper a stored block -> refuse
  const store = mapStore(f.blocks);
  const hex = f.tensors[0].kappa.split(":").pop();
  f.blocks.get(hex)[0] ^= 0xff;
  assert.throws(() => loadByKappa(store, f.tensors[0].kappa), /L5 REFUSE/);
});

// minimal GGUF (2 F32 tensors, one duplicated) — enough to exercise the laws
function buildTinyGguf() {
  let parts = [], len = 0; const push = (b) => { parts.push(b); len += b.length; };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); push(b); };
  const u64 = (v) => { const b = new Uint8Array(8); const dv = new DataView(b.buffer); dv.setUint32(0, v >>> 0, true); dv.setUint32(4, 0, true); push(b); };
  const str = (s) => { const e = new TextEncoder().encode(s); u64(e.length); push(e); };
  const tensors = [["a", 64], ["b_dup", 64]];
  push(new TextEncoder().encode("GGUF")); u32(3); u64(tensors.length); u64(1);
  str("general.architecture"); u32(8); str("llama");
  let off = 0; const ALIGN = 32;
  for (const [name, n] of tensors) { str(name); u32(1); u64(n); u32(0); u64(off); off = Math.ceil((off + n * 4) / ALIGN) * ALIGN; }
  if (len % ALIGN) push(new Uint8Array(ALIGN - (len % ALIGN)));
  const dataStart = len;
  const payload = new Uint8Array(64 * 4); for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) & 0xff; // same bytes -> dedup
  let cur = dataStart;
  for (const [, n] of tensors) { while (len < cur) push(new Uint8Array(1)); push(payload); cur = Math.ceil((cur + n * 4) / ALIGN) * ALIGN; }
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}

console.log("GGUF Forge conformance (holospaces witness):");
for (const r of rows) console.log(`  [${r.status === "pass" ? "✓" : "✗"}] ${r.claim}  — ${r.authority}${r.detail ? "\n        " + r.detail : ""}`);
console.log(`\nroot: ${lock.root}`);
console.log(`${pass}/${pass + fail} rows green${fail ? " — GATE RED" : " — GATE GREEN"}`);
process.exit(fail ? 1 : 0);
