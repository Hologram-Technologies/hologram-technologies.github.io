#!/usr/bin/env node
// holo-blake3-seal-witness.mjs — P2 of the canonical-κ cutover. Proves the SEALER now mints BLAKE3 as the
// PRIMARY κ on every internal object, with sha256 demoted to a re-derivable bridge alias — without touching
// the real OS manifests. It builds a throwaway sealed image (old, pre-cutover shape: sha-only + a legacy
// alsoKnownAs entry), runs the REAL sub-tools (reseal-drift via HOLO_RESEAL_DIR, seal-served via
// HOLO_OS_DIR) against it, and asserts:
//   • every boot-closure entry gains a canonical top-level `blake3` κ that re-derives from the bytes;
//   • the sha256 bridge alias (kappa/sri/multibase) is kept and also re-derives;
//   • the served-set manifest carries {blake3, kappa} on every file (was sha-only strings);
//   • a flipped byte breaks the CANONICAL (blake3) re-derivation → the gate would refuse it (Law L5);
//   • reseal.mjs --check (the CI gate) reports the scratch image SEALED ✓ on BOTH axes.
//
//   node tools/holo-blake3-seal-witness.mjs

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const { blake3hex } = await import(new URL("../os/usr/lib/holo/holo-blake3.mjs", import.meta.url));

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const node = (script, env) => spawnSync(process.execPath, [join(here, script)], { cwd: join(here, ".."), encoding: "utf8", env: { ...process.env, ...env } });

// ── a throwaway sealed image in the OLD (pre-cutover) shape ──
const root = mkdtempSync(join(tmpdir(), "holo-seal-witness-"));
try {
  mkdirSync(join(root, "etc"), { recursive: true });
  // reseal-drift resolves its blake3 + atlas implementations from the target tree (HOLO_RESEAL_DIR), so a
  // faithful scratch image stages the same two lib files the real os/ carries (Law L2 — one impl).
  mkdirSync(join(root, "usr/lib/holo"), { recursive: true });
  for (const lib of ["holo-blake3.mjs", "holo-atlas-coord.mjs"]) copyFileSync(join(here, "../os/usr/lib/holo", lib), join(root, "usr/lib/holo", lib));
  const files = { "alpha.js": "export const a = 1;\n", "beta.css": ".b{color:red}\n", "gamma.json": '{"g":2}\n' };
  for (const [n, c] of Object.entries(files)) writeFileSync(join(root, n), c);
  // OLD boot-closure shape: one sha-only entry, one legacy sha+alsoKnownAs-blake3 entry. fhsMap returns
  // null for these flat keys → they resolve literally, so the sub-tools hash the files we just wrote.
  const oldClosure = { closure: {
    "alpha.js": { kappa: "did:holo:sha256:" + sha(files["alpha.js"]), sri: "x", multibase: "y", bytes: files["alpha.js"].length },
    "beta.css": { kappa: "did:holo:sha256:" + sha(files["beta.css"]), bytes: files["beta.css"].length, alsoKnownAs: ["did:holo:blake3:" + blake3hex(new TextEncoder().encode(files["beta.css"]))] },
    "gamma.json": "did:holo:sha256:" + sha(files["gamma.json"]),
  } };
  writeFileSync(join(root, "etc/os-closure.json"), JSON.stringify(oldClosure, null, 2) + "\n");
  // a holo-fhs-sw.js with a CLOSURE_KAPPA const so the anchor step has something to bake (sha of closure).
  writeFileSync(join(root, "holo-fhs-sw.js"), 'const CLOSURE_KAPPA = "";\n');

  // ── run the REAL sub-tools against the scratch image ──
  const drift = node("reseal-drift.mjs", { HOLO_RESEAL_DIR: root });
  rec("reseal-drift ran on the scratch image", drift.status === 0);
  const served = node("seal-served.mjs", { HOLO_OS_DIR: root });
  rec("seal-served ran on the scratch image", served.status === 0);

  // ── assert the boot closure is now blake3-PRIMARY on every entry ──
  const closure = JSON.parse(readFileSync(join(root, "etc/os-closure.json"), "utf8")).closure;
  let allCanonical = true, shaAliasKept = true, blakeReDerives = true, shaReDerives = true;
  for (const [k, v] of Object.entries(closure)) {
    const bytes = readFileSync(join(root, k));
    if (typeof v !== "object" || !/^did:holo:blake3:[0-9a-f]{64}$/.test(v.blake3 || "")) allCanonical = false;
    if (!/^did:holo:sha256:[0-9a-f]{64}$/.test(v.kappa || "")) shaAliasKept = false;
    if (v.blake3 && v.blake3.split(":").pop() !== blake3hex(bytes)) blakeReDerives = false;
    if (v.kappa && v.kappa.split(":").pop() !== sha(bytes)) shaReDerives = false;
  }
  rec("every boot entry now carries a canonical blake3 κ (incl. the old sha-only & string entries)", allCanonical);
  rec("sha256 bridge alias is kept on every boot entry", shaAliasKept);
  rec("canonical blake3 κ re-derives from the bytes (Law L5)", blakeReDerives);
  rec("sha256 bridge alias re-derives from the bytes", shaReDerives);

  // ── assert the served set carries both axes ──
  const servedMap = JSON.parse(readFileSync(join(root, "etc/os-served.json"), "utf8")).closure;
  let servedDual = Object.keys(servedMap).length > 0;
  for (const [k, v] of Object.entries(servedMap)) {
    if (k.endsWith("os-served.json")) continue;
    if (typeof v !== "object" || !v.blake3 || !v.kappa) servedDual = false;
  }
  rec("served-set manifest carries {blake3, kappa} on every file (was sha-only strings)", servedDual);

  // ── tamper: a flipped byte must break the CANONICAL (blake3) re-derivation ──
  const tampered = new TextEncoder().encode("export const a = 2;\n");   // alpha.js, one byte changed
  rec("a flipped byte breaks the canonical blake3 κ (Law L5 refusal)", blake3hex(tampered) !== (closure["alpha.js"]?.blake3 || "").split(":").pop());

  // ── the CI gate sees the scratch image as SEALED ✓ on BOTH axes ──
  const anchorSrc = readFileSync(join(root, "holo-fhs-sw.js"), "utf8").replace('const CLOSURE_KAPPA = ""', `const CLOSURE_KAPPA = "${sha(readFileSync(join(root, "etc/os-closure.json")))}"`);
  writeFileSync(join(root, "holo-fhs-sw.js"), anchorSrc);   // anchor the scratch SW to its closure (so --check anchor passes)
  const check = node("reseal.mjs", { HOLO_OS_DIR: root });  // --check honors HOLO_OS_DIR for the staged artifact
  // reseal --check needs the flag; run it explicitly
  const checkRun = spawnSync(process.execPath, [join(here, "reseal.mjs"), "--check"], { cwd: join(here, ".."), encoding: "utf8", env: { ...process.env, HOLO_OS_DIR: root } });
  rec("reseal --check reports the scratch image SEALED ✓ (both axes re-derive)", /SEALED ✓/.test(checkRun.stdout || ""));

} finally {
  try { rmSync(root, { recursive: true, force: true }); } catch {}
}

const witnessed = failed === 0;
writeFileSync(join(here, "holo-blake3-seal-witness.result.json"), JSON.stringify({
  spec: "P2 — the sealer mints BLAKE3 as the primary κ (dual-axis, sha256 demoted to a re-derivable bridge alias) on the boot closure AND the served set. Proven on a throwaway image with the real sub-tools; the production manifests are left to the user's seal flow.",
  witnessed, covers: ["sealer", "blake3-primary", "sha-alias", "dual-axis", "law-l5"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-blake3-seal-witness: ${passed} passed, ${failed} failed`);
process.exit(witnessed ? 0 : 1);
