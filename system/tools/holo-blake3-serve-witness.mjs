#!/usr/bin/env node
// holo-blake3-serve-witness.mjs — P3 of the canonical-κ cutover (the web Service Worker half; the native
// Rust verifier half is `cargo test -p kappa-route` — canonical_blake3_only_pin_verifies,
// legacy_sha_only_pin_still_resolves, blake3_axis_enforced). The SW (holo-fhs-sw.js) is the JS serve
// authority. This witness proves its blake3-FIRST decision is correct by exercising the SAME fold →
// axis-select → re-derive logic on real bytes, and asserts the live SW source carries that wiring (so a
// revert fails the gate):
//   • foldClosure indexes the canonical blake3 (top-level field OR alsoKnownAs) into a path→blake3 map;
//   • a served path with a blake3 pin verifies on the blake3 axis (kappo) — the trust check;
//   • a legacy sha-only entry falls back to the sha256 bridge alias and still verifies;
//   • a flipped byte is refused on whichever axis is canonical for that path (Law L5).
//
//   node tools/holo-blake3-serve-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const { blake3hex } = await import(new URL("../os/usr/lib/holo/holo-blake3.mjs", import.meta.url));
const sha256hex = (buf) => createHash("sha256").update(buf).digest("hex");

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); };

// ── 1 · functional: the SW's fold + axis-select + verify, on real bytes ──
// foldClosure (mirrors holo-fhs-sw.js): sha256 alias → BYPATH; canonical blake3 (top-level OR alsoKnownAs) → BYPATH_B3.
function fold(closure) {
  const BYPATH = new Map(), BYPATH_B3 = new Map();
  for (const [p, v] of Object.entries(closure)) {
    const k = typeof v === "string" ? v : (v.kappa || v.did || v["@id"] || "");
    const hex = String(k).split(":").pop().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(hex) && !BYPATH.has(p)) BYPATH.set(p, hex);
    if (v && typeof v === "object") for (const c of [v.blake3, ...(v.alsoKnownAs || [])]) {
      const b = /^did:holo:blake3:([0-9a-f]{64})$/.exec(String(c));
      if (b && !BYPATH_B3.has(p)) BYPATH_B3.set(p, b[1].toLowerCase());
    }
  }
  return { BYPATH, BYPATH_B3 };
}
// select (mirrors the SW path-request branch): canonical blake3 first, else the sha bridge alias.
const select = (maps, rel) => { const b3 = maps.BYPATH_B3.get(rel); return b3 ? { axis: "blake3", expect: b3 } : { axis: "sha256", expect: maps.BYPATH.get(rel) || null }; };
// verify (mirrors the SW L5 check): re-derive on the selected axis.
const verify = (axis, buf, expect) => (axis === "blake3" ? blake3hex(buf) : sha256hex(buf)) === expect;

const te = new TextEncoder();
const aBytes = te.encode("export const ok = 1;\n");      // canonical-pinned (os-served shape)
const lBytes = te.encode(".legacy{color:blue}\n");        // legacy sha-only
const closure = {
  "a.js": { blake3: "did:holo:blake3:" + blake3hex(aBytes), kappa: "did:holo:sha256:" + sha256hex(aBytes) },   // post-cutover served entry
  "legacy.css": "did:holo:sha256:" + sha256hex(lBytes),    // pre-cutover string entry (sha alias only)
};
const maps = fold(closure);

const selA = select(maps, "a.js");
rec("served path with a blake3 pin selects the CANONICAL (blake3) axis", selA.axis === "blake3" && selA.expect === blake3hex(aBytes));
rec("canonical axis verifies the true bytes (kappo trust check)", verify(selA.axis, aBytes, selA.expect) === true);
rec("canonical axis REFUSES a flipped byte (Law L5)", verify(selA.axis, te.encode("export const ok = 2;\n"), selA.expect) === false);

const selL = select(maps, "legacy.css");
rec("legacy sha-only entry falls back to the sha256 bridge alias", selL.axis === "sha256" && selL.expect === sha256hex(lBytes));
rec("bridge alias still verifies (additive cutover, nothing breaks)", verify(selL.axis, lBytes, selL.expect) === true);
rec("bridge alias REFUSES a flipped byte", verify(selL.axis, te.encode(".legacy{color:red}\n"), selL.expect) === false);

// alsoKnownAs-only entry (legacy blake3 carrier) is treated as canonical too
const akaBytes = te.encode("aka only\n");
const m2 = fold({ "aka.js": { kappa: "did:holo:sha256:" + sha256hex(akaBytes), alsoKnownAs: ["did:holo:blake3:" + blake3hex(akaBytes)] } });
const selAka = select(m2, "aka.js");
rec("alsoKnownAs blake3 is honored as the canonical axis", selAka.axis === "blake3" && verify(selAka.axis, akaBytes, selAka.expect));

// ── 2 · structural: the LIVE SW source carries the blake3-first wiring (a revert fails this gate) ──
const sw = readFileSync(join(here, "../os/holo-fhs-sw.js"), "utf8");
rec("SW declares BYPATH_B3 (canonical verification pins)", /let BYPATH_B3 = null/.test(sw) && /BYPATH_B3 = new Map\(\)/.test(sw));
rec("SW foldClosure reads the canonical top-level blake3 field", /\[v\.blake3, \.\.\.\(v\.alsoKnownAs/.test(sw));
rec("SW path branch prefers the blake3 axis", /BYPATH_B3\.get\(rel\)/.test(sw) && /axis = "blake3"; expect = b3/.test(sw));
rec("SW L5 verify re-derives on the blake3 axis", /axis === "blake3" \? blake3hex/.test(sw));

const witnessed = failed === 0;
writeFileSync(join(here, "holo-blake3-serve-witness.result.json"), JSON.stringify({
  spec: "P3 (web SW half) — the Service Worker serve authority verifies the canonical BLAKE3 axis first, with the sha256 bridge alias as legacy fallback. Functional fold/select/verify on real bytes + structural assertions on the live holo-fhs-sw.js. Native half: cargo test -p kappa-route.",
  witnessed, covers: ["service-worker", "blake3-first", "law-l5", "dual-axis", "serve-authority"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-blake3-serve-witness: ${passed} passed, ${failed} failed`);
console.log("Native half of P3: cargo test -p kappa-route (canonical_blake3_only_pin_verifies, legacy_sha_only_pin_still_resolves, blake3_axis_enforced)");
process.exit(witnessed ? 0 : 1);
