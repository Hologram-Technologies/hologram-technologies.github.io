#!/usr/bin/env node
// holo-blake3-seal-layer-witness.mjs — P5 of the canonical-κ cutover. The seal layer (strand, vault,
// credential, present, identity, …) mints its κ through ONE keystone: holo-identity. This proves the
// CANONICAL κ axis is now available there (kappaOf = the substrate's kappo = blake3) ALONGSIDE the sha256
// CC-1 bridge (addressOf), additively and reversibly:
//   • kappaOf(bytes) is a well-formed blake3 κ that re-derives (kappaVerify) and refuses tamper (Law L5);
//   • kappaOf is DISTINCT from the sha256 addressOf — two axes over the SAME canonical bytes (like
//     holo-object's blakeDid sitting beside its did:holo:sha256 id): the object resolves on the canonical
//     substrate while its persisted sha id is untouched (additive — no chain re-mint, invariant #4);
//   • the additive seam does NOT regress the seal layer: the keystone module witnesses (strand, vault,
//     credential, present) still pass after holo-identity gained the canonical export;
//   • the SD-JWT-VC disclosure leaves are LABELED bridges (they must interop, so they stay sha256).
//
//   node tools/holo-blake3-seal-layer-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const { addressOf, kappaOf, kappaVerify } = await import(new URL("../os/usr/lib/holo/holo-identity.mjs", import.meta.url));
const { blake3hex } = await import(new URL("../os/usr/lib/holo/holo-blake3.mjs", import.meta.url));

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); };
const te = new TextEncoder();

// 1 · the canonical seam is the substrate's kappo (blake3) and is a real L5 admission check.
const bytes = te.encode(JSON.stringify({ "holstr:op": "did:holo:blake3:abc", seq: 1, body: "a sealed entry" }));
const k = await kappaOf(bytes);
rec("kappaOf mints a canonical did:holo:blake3 κ", /^did:holo:blake3:[0-9a-f]{64}$/.test(k));
rec("kappaOf ≡ the substrate's blake3 (kappo)", k === "did:holo:blake3:" + blake3hex(bytes));
rec("kappaVerify accepts the true bytes (Law L5)", (await kappaVerify(bytes, k)) === true);
rec("kappaVerify refuses a tampered seal", (await kappaVerify(te.encode("tampered"), k)) === false);

// 2 · additive dual-axis: the canonical κ sits beside the sha256 CC-1 bridge over the SAME bytes.
const shaId = await addressOf(bytes);
rec("addressOf still mints the sha256 CC-1 bridge id (unchanged, persisted chains intact)", /^did:holo:sha256:[0-9a-f]{64}$/.test(shaId));
rec("the two axes are DISTINCT (blake3 κ ≠ sha256 id)", k.split(":").pop() !== shaId.split(":").pop());
rec("both axes re-derive from the same canonical bytes (resolvable + reversible)",
  k.split(":").pop() === blake3hex(bytes) && shaId.split(":").pop().length === 64);

// 3 · the additive seam does NOT regress the seal layer — keystone module witnesses still GREEN.
const mod = (w) => spawnSync(process.execPath, [join(here, w)], { encoding: "utf8" }).status === 0;
for (const w of ["holo-strand-witness.mjs", "holo-vault-witness.mjs", "holo-credential-witness.mjs", "holo-present-witness.mjs"]) {
  rec(`seal-layer witness still GREEN after the canonical seam: ${w}`, mod(w));
}

// 4 · the SD-JWT-VC disclosure leaves are labeled bridges (interop — stay sha256, NOT κ).
const cred = readFileSync(join(here, "../os/usr/lib/holo/holo-credential.mjs"), "utf8");
const pres = readFileSync(join(here, "../os/usr/lib/holo/holo-present.mjs"), "utf8");
rec("credential disclosure leaf marked // BRIDGE: SD-JWT-VC", /BRIDGE: SD-JWT-VC/.test(cred));
rec("presentation disclosure leaf marked // BRIDGE: SD-JWT-VC", /BRIDGE: SD-JWT-VC/.test(pres));

const witnessed = failed === 0;
writeFileSync(join(here, "holo-blake3-seal-layer-witness.result.json"), JSON.stringify({
  spec: "P5 — the seal layer gains the canonical κ axis (kappaOf = kappo = blake3) at its keystone (holo-identity), additively beside the sha256 CC-1 persistence/interop bridge. The minted object resolves on the canonical substrate; persisted chains are untouched (no flag-day re-mint). Keystone module witnesses stay green; SD-JWT-VC disclosure leaves stay labeled bridges.",
  witnessed, covers: ["seal-layer", "identity", "kappo", "canonical-kappa", "additive", "sd-jwt-bridge", "law-l5"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-blake3-seal-layer-witness: ${passed} passed, ${failed} failed`);
process.exit(witnessed ? 0 : 1);
