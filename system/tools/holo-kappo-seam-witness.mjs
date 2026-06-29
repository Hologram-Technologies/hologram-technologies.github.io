#!/usr/bin/env node
// holo-kappo-seam-witness.mjs — P1 of the canonical-κ cutover. There is ONE function the whole system
// mints and verifies κ through: kappo() in os/usr/lib/holo/holo-kappa.mjs. This witness proves the seam
// is the substrate's BLAKE3 (kappo ≡ blake3hex), that kappoVerify is a true Law-L5 admission check
// (re-derive, refuse tamper), that hexOf parses every κ form, and that shaBridge() is the DISTINCT,
// clearly-named SHA bridge for foreign-protocol boundaries (NOT a κ). Critically it also proves the seam
// agrees with what the sealer ALREADY emits: for real boot-closure entries, kappo(bytes) == the blake3
// alsoKnownAs the closure carries — so when P2+ make blake3 the primary axis, the verifier and the
// sealer compute the identical address. No call-site behavior changes here; this just locks the seam.
//
//   node tools/holo-kappo-seam-witness.mjs

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const { kappo, kappoHex, kappoVerify, hexOf, isKappa, shaBridge, KAPPA_PREFIX } =
  await import(new URL("../os/usr/lib/holo/holo-kappa.mjs", import.meta.url));
const { blake3hex } = await import(new URL("../os/usr/lib/holo/holo-blake3.mjs", import.meta.url));
const { fhsMap } = await import(new URL("../os/lib/holo-fhs-map.mjs", import.meta.url));

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); };
const te = new TextEncoder();

// 1 · the seam IS BLAKE3 — kappo/kappoHex ≡ blake3hex, the prefix is the blake3 DID.
const sample = te.encode("the substrate's one address");
rec("KAPPA_PREFIX is the blake3 DID", KAPPA_PREFIX === "did:holo:blake3:");
rec("kappoHex ≡ blake3hex", kappoHex(sample) === blake3hex(sample));
rec("kappo ≡ did:holo:blake3:<hex>", kappo(sample) === "did:holo:blake3:" + blake3hex(sample));

// 2 · kappoVerify is a real L5 admission check — re-derive, accept the true bytes, refuse a tampered one.
const k = kappo(sample);
rec("kappoVerify accepts true bytes", kappoVerify(sample, k) === true);
rec("kappoVerify refuses a flipped byte", kappoVerify(te.encode("the substrate's one addres!"), k) === false);

// 3 · hexOf parses every accepted κ form to the same 64-hex tail; isKappa gates well-formedness.
const hx = blake3hex(sample);
rec("hexOf parses did:holo:blake3 form", hexOf("did:holo:blake3:" + hx) === hx);
rec("hexOf parses bare blake3: label", hexOf("blake3:" + hx) === hx);
rec("hexOf parses bare hex", hexOf(hx) === hx);
rec("isKappa true for a real κ", isKappa(k) === true);
rec("isKappa false for junk", isKappa("did:holo:blake3:nothex") === false);

// 4 · shaBridge() is the DISTINCT, named SHA bridge — NOT a κ. It equals sha256, and never collides with kappo.
const shaHex = createHash("sha256").update(Buffer.from(sample)).digest("hex");
rec("shaBridge ≡ sha256 (the bridge encoding)", (await shaBridge(sample)) === shaHex);
rec("shaBridge is NOT the κ (distinct axis)", (await shaBridge(sample)) !== kappoHex(sample));

// 5 · the seam agrees with the SEALER on the REAL boot closure: for each entry that already carries a
//     blake3 alias, kappo(served bytes) must equal it. This is the cross-check that P2's promotion is
//     coherent — the verifier (kappo) and the sealer (reseal-drift) compute the identical blake3 address.
// Compare only IN-STEP entries: a pin whose sha primary still matches the on-disk bytes. A drifted
// working-tree file (sha primary stale) carries a stale blake3 alias too and is re-pinned at the next
// reseal — that is closure drift, not a seam disagreement, so it's out of scope for this seam check.
const closure = JSON.parse(readFileSync(join(OS, "etc/os-closure.json"), "utf8")).closure || {};
const shaOf = (buf) => createHash("sha256").update(buf).digest("hex");
let checkedReal = 0, agree = 0, missing = 0, drifted = 0;
for (const [key, v] of Object.entries(closure)) {
  const aka = (v && v.alsoKnownAs || []).find((a) => /blake3/.test(String(a)));
  if (!aka) continue;
  const phys = fhsMap(key) || key;
  const abs = join(OS, phys);
  if (!existsSync(abs) || statSync(abs).isDirectory()) { missing++; continue; }
  const buf = readFileSync(abs);
  if (shaOf(buf) !== hexOf(v.kappa)) { drifted++; continue; }   // pin is stale → out of scope (reseal pending)
  checkedReal++;
  if (kappoHex(buf) === hexOf(aka)) agree++;
}
rec(`kappo agrees with the sealer's blake3 alias on all ${checkedReal} in-step closure files`, checkedReal > 0 && agree === checkedReal);

const witnessed = failed === 0;
writeFileSync(join(here, "holo-kappo-seam-witness.result.json"), JSON.stringify({
  spec: "P1 — the ONE canonical κ seam (holo-kappa.mjs kappo()) is the substrate's BLAKE3, with a real L5 verify and a distinct, named shaBridge() for foreign-protocol boundaries. Agrees with the sealer's blake3 alias on the live boot closure.",
  witnessed,
  covers: ["kappo", "kappoVerify", "shaBridge", "canonical-kappa", "law-l5", "seam"],
  realClosureFilesChecked: checkedReal, agree, absent: missing,
  checks, passed, failed,
}, null, 2) + "\n");

console.log(`\nholo-kappo-seam-witness: ${passed} passed, ${failed} failed · ${checkedReal} real closure files agree (${missing} absent)`);
process.exit(witnessed ? 0 : 1);
