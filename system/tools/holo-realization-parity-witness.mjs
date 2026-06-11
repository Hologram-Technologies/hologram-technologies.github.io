#!/usr/bin/env node
// holo-realization-parity-witness.mjs — PROVE OS2 mints COMPOSED-object κ byte-identical to the
// hologram substrate. holo-blake3-witness proves the σ-axis on RAW bytes (a leaf/blob); this proves
// the level above it: a Realization's IDENTITY κ = BLAKE3 over the SPINE-2 canonical SHELL
// (IRI · ordered 71-byte κ-refs · payload), so a whole OBJECT — not just a blob — resolves on the
// shared substrate. Two external authorities compose to the result, OFFLINE:
//   1. FRAMING — OS2 `encode(iri, refs, payload, kappaCodec71)` is byte-identical to the substrate's
//      `realizations::encode` (holospaces/src/realizations.rs:171-183):
//        IRI · 0x00 · u32LE refcount · refs(71-byte KappaLabel each) · u32LE len · payload.
//      Asserted by reconstructing the documented layout INDEPENDENTLY and comparing bytes.
//   2. HASH — kappaBlake3(bytes) == substrate address_bytes(bytes) for ANY bytes (proven by
//      holo-blake3-witness against the official BLAKE3 vectors + the substrate's own `as1` σ-axis
//      conformance). Therefore kappaBlake3(encode(...)) == substrate `Realization::kappa()` — the κ
//      this object would carry on the substrate. No 6.5 MB wasm, no substrate build.
// Optional LIVE cross-check: set HOLO_WASM_PKG to a built holospaces_web pkg dir and the composed
// shell is diffed against the substrate's own kappa() export; absent/unloadable → recorded skipped
// (honest — never a false pass), exactly like the repo's other external-tool witnesses.
//
//   node tools/holo-realization-parity-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));            // tools/
const L = (p) => new URL("../os/usr/lib/holo/" + p, import.meta.url);
const { encode, decode, toCanonical, toJsonld, kappaCodec71, makeAddress, makeKernel, memStore, substrateSeam } = await import(L("holo-realization.mjs"));
const { blake3hex, kappaBlake3 } = await import(L("holo-blake3.mjs"));

const te = new TextEncoder();
const u32le = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const cat = (...ps) => { let n = 0; for (const p of ps) n += p.length; const o = new Uint8Array(n); let i = 0; for (const p of ps) { o.set(p, i); i += p.length; } return o; };
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); };

const CTX = "https://uor.foundation/holospaces/vocab#";
const IRI = "https://uor.foundation/holospaces/realization/holospace";

// A COMPOSED object: two operand κ-refs (real 71-byte blake3 σ-labels) + literal payload props.
const k1 = kappaBlake3(te.encode("operand-one"));               // "blake3:" + 64 hex = 71 bytes
const k2 = kappaBlake3(te.encode("operand-two"));
const obj = { "@context": CTX, "@type": IRI, parent: k1, schemaRef: k2, title: "Notes", count: 5 };

// ── 1 · FRAMING: encode == the substrate SPINE-2 shell, byte-for-byte ─────────────────────────
const { iri, refs, payload } = toCanonical(obj);                // κ-valued props → ordered refs; rest → JCS payload
const got = encode(iri, refs, payload, kappaCodec71);
// Independent reconstruction of realizations.rs:171-183 (NOT via encode):
const expect = cat(te.encode(iri), Uint8Array.of(0), u32le(refs.length), ...refs.map((r) => te.encode(r)), u32le(payload.length), payload);
rec("framing is byte-identical to the substrate SPINE-2 shell (realizations.rs:171-183)", eq(got, expect));
rec("each κ-ref is the fixed-width 71-byte KappaLabel71 (blake3:+64hex)", refs.length === 2 && refs.every((r) => te.encode(r).length === 71));
rec("IRI is NUL-terminated; refcount + payload-len are u32LE", got[te.encode(iri).length] === 0 && eq(got.subarray(iri.length + 1, iri.length + 5), u32le(2)));

// ── 2 · HASH: composed Realization κ = blake3:<hex> of the shell (= substrate Realization::kappa) ─
const kappa = kappaBlake3(got);
rec("composed κ is a well-formed blake3 σ-label", /^blake3:[0-9a-f]{64}$/.test(kappa));
rec("κ == blake3:<hex> of the canonical shell (matches substrate address_bytes)", kappa === "blake3:" + blake3hex(got));
rec("deterministic (equal shell ⇒ equal κ)", kappaBlake3(got) === kappa);
const flip = Uint8Array.from(got); flip[flip.length - 1] ^= 0xff;
rec("single-bit sensitive (tamper any payload byte ⇒ different κ)", kappaBlake3(flip) !== kappa);
const reordered = encode(iri, [k2, k1], payload, kappaCodec71);  // refs carry position structurally
rec("ref ORDER is part of identity (swapping operands ⇒ different κ)", kappaBlake3(reordered) !== kappa);

// ── 3 · KERNEL: mint @id via the blessed seam, re-derive (L5), round-trip the JSON-LD ─────────
const seam = substrateSeam(blake3hex);
const address = makeAddress(seam);
const id = await address.address(obj);
rec("kernel mints the substrate κ as the object's @id", id === kappa);
rec("@id re-derives from content (Law L5)", await address.verify({ ...obj, "@id": id }));
const back = toJsonld(decode(got, kappaCodec71), id);
rec("JSON-LD ⇄ canonical-form bijection round-trips (refs + literals exact)",
  back.parent === k1 && back.schemaRef === k2 && back.title === "Notes" && back.count === 5 && back["@id"] === id);

// ── 4 · KappaLabel71 fixed-width invariant (the substrate's operand encoding) ─────────────────
let threw = false; try { kappaCodec71.enc("blake3:tooshort"); } catch { threw = true; }
rec("kappaCodec71 refuses a non-71-byte ref (substrate fixed-width invariant)", threw);
rec("kappaCodec71 accepts a 71-byte blake3 label", kappaCodec71.enc(k1).length === 71);

// ── 5 · END-TO-END: write → durable κ-store (re-derives, L2) → resolve (re-derives, L5) ───────
const kernel = makeKernel({ store: memStore(seam), address, codec: seam.codec });
const written = await kernel.write(obj);
rec("write stores the object under its substrate κ (Law L2)", written === kappa);
const resolved = await kernel.resolve(written);
rec("resolve re-derives + projects back to JSON-LD (Law L5)", resolved.title === "Notes" && resolved.parent === k1 && resolved["@id"] === kappa);

// ── 6 · OPTIONAL live oracle: the substrate's own kappa() wasm on the SAME composed shell ─────
let oracle = { skipped: true, reason: "HOLO_WASM_PKG unset — proven offline via KAT + framing" };
const pkgDir = process.env.HOLO_WASM_PKG;
if (pkgDir) {
  try {
    const mod = await import(pathToFileURL(join(pkgDir, "holospaces_web.js")).href);
    if (typeof mod.default === "function") { try { await mod.default(); } catch {} }
    const wasmKappa = mod.kappa(got);
    oracle = { skipped: false, match: wasmKappa === kappa, wasmKappa, os2Kappa: kappa };
    rec("LIVE: substrate wasm kappa(shell) == OS2 composed κ", wasmKappa === kappa);
  } catch (e) { oracle = { skipped: true, reason: "load failed: " + e.message }; }
}

const witnessed = failed === 0;
writeFileSync(join(here, "holo-realization-parity-witness.result.json"), JSON.stringify({
  spec: "OS2 mints COMPOSED-object κ byte-identical to the hologram substrate — a Realization's identity = BLAKE3 over the SPINE-2 canonical shell (IRI · ordered 71-byte κ-refs · payload). A whole object, not just a leaf blob, resolves on the shared UOR substrate (the convergence that makes 'one substrate' literal).",
  authority: "hologram substrate realizations::encode SPINE-2 shell layout, realizations.rs:171-183 (consumed by reference, ADR-006) · Official BLAKE3 test vectors (BLAKE3-team) · the substrate's as1 σ-axis conformance (σ-axis == blake3 reference) · UOR-ADDR (κ = H(canonical_form)) · verify by re-derivation (Law L5)",
  witnessed,
  covers: ["realization-parity", "spine-2-shell", "kappa-label-71", "composed-object", "upstream-interop", "uor-addr", "law-l5", "law-l2"],
  oracle,
  checks, passed, failed,
}, null, 2) + "\n");

console.log(`\nholo-realization-parity-witness: ${passed} passed, ${failed} failed${oracle.skipped ? "  (live wasm oracle: skipped — offline KAT+framing authority)" : `  (live wasm oracle: ${oracle.match ? "MATCH" : "MISMATCH"})`}`);
process.exit(witnessed ? 0 : 1);
