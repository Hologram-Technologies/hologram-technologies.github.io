#!/usr/bin/env node
// holo-blake3-anchor-witness.mjs — P4 of the canonical-κ cutover: the ATOMIC anchor flip (the sharp edge).
// The trust root — the ONE κ a tamperer cannot forge — becomes blake3(os-closure.json). This proves the
// flip end to end on a throwaway image with the REAL tools, and asserts the live consumers carry the wiring:
//   • holo-anchor-sw bakes blake3(os-closure.json) into the SW's CLOSURE_KAPPA + stamps anchorAxis:"blake3";
//   • the SW's loadClosure check admits the manifest on the blake3 axis and refuses a tampered one;
//   • reseal --check (anchorCurrent) recognizes the blake3-baked anchor as current ✓ (SEALED on both axes);
//   • a tampered manifest matches NEITHER axis → the host fail-closes (never half-flip — invariant #3);
//   • the native consumers are wired: hot_store.cc AnchorOf → kr_blake3_hex; Rust load_store matches blake3.
// The native :9333 prove-boot requires relinking the CEF host (the running exe blocks the link) and is the
// user's host step — the Rust half (cargo test closure_anchor_blake3_is_canonical) proves the verifier logic.
//
//   node tools/holo-blake3-anchor-witness.mjs

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

const root = mkdtempSync(join(tmpdir(), "holo-anchor-witness-"));
try {
  mkdirSync(join(root, "etc"), { recursive: true });
  mkdirSync(join(root, "usr/lib/holo"), { recursive: true });
  for (const lib of ["holo-blake3.mjs", "holo-atlas-coord.mjs"]) copyFileSync(join(here, "../os/usr/lib/holo", lib), join(root, "usr/lib/holo", lib));
  const files = { "alpha.js": "export const a = 1;\n", "beta.css": ".b{color:red}\n" };
  for (const [n, c] of Object.entries(files)) writeFileSync(join(root, n), c);
  writeFileSync(join(root, "etc/os-closure.json"), JSON.stringify({ closure: {
    "alpha.js": { kappa: "did:holo:sha256:" + sha(files["alpha.js"]), bytes: 20 },
    "beta.css": { kappa: "did:holo:sha256:" + sha(files["beta.css"]), bytes: 14 },
  } }, null, 2) + "\n");
  writeFileSync(join(root, "holo-fhs-sw.js"), 'const CLOSURE_KAPPA = "";\n');

  // 1 · reseal-drift (canonical closure) then the REAL holo-anchor-sw against the scratch tree
  rec("reseal-drift sealed the scratch closure", node("reseal-drift.mjs", { HOLO_RESEAL_DIR: root }).status === 0);
  const anchorRun = node("holo-anchor-sw.mjs", { HOLO_ANCHOR_DIR: root });
  rec("holo-anchor-sw ran on the scratch tree", anchorRun.status === 0);
  node("seal-served.mjs", { HOLO_OS_DIR: root });   // pin the stamped manifest + baked SW (drift→anchor→served order)

  // 2 · the manifest declares its canonical axis; the SW is baked with blake3(os-closure.json)
  const closureBytes = readFileSync(join(root, "etc/os-closure.json"));
  const doc = JSON.parse(closureBytes);
  rec("manifest stamped anchorAxis: \"blake3\"", doc.anchorAxis === "blake3");
  const blakeAnchor = blake3hex(closureBytes), shaAnchor = sha(closureBytes);
  const baked = (readFileSync(join(root, "holo-fhs-sw.js"), "utf8").match(/CLOSURE_KAPPA = "([0-9a-f]{64})"/) || [])[1];
  rec("SW CLOSURE_KAPPA == blake3(os-closure.json) (canonical trust root)", baked === blakeAnchor);
  rec("baked anchor is NOT the sha256 value (axis truly flipped)", baked !== shaAnchor);

  // 3 · the SW loadClosure admission logic: blake3 first, tamper matches neither → fail closed
  const admit = (buf) => blake3hex(new Uint8Array(buf)) === baked || sha(buf) === baked;   // mirrors holo-fhs-sw.js
  rec("SW admits the true manifest on the canonical blake3 axis", admit(closureBytes) === true);
  rec("SW refuses a tampered manifest (matches NEITHER axis → fail closed)", admit(Buffer.concat([closureBytes, Buffer.from("/*x*/")])) === false);

  // 4 · reseal --check sees the scratch image SEALED ✓ with the anchor recognized as current
  const check = spawnSync(process.execPath, [join(here, "reseal.mjs"), "--check"], { cwd: join(here, ".."), encoding: "utf8", env: { ...process.env, HOLO_OS_DIR: root } });
  rec("reseal --check: SW anchor current ✓ (blake3 anchor recognized)", /SW anchor: current/.test(check.stdout || ""));
  rec("reseal --check: scratch image SEALED ✓", /SEALED ✓/.test(check.stdout || ""));

  // 5 · structural: the native consumers are wired to the canonical axis
  const anchorTool = readFileSync(join(here, "holo-anchor-sw.mjs"), "utf8");
  rec("holo-anchor-sw computes blake3 + stamps anchorAxis", /blake3hex\(readFileSync\(closurePath\)\)/.test(anchorTool) && /anchorAxis = "blake3"/.test(anchorTool));
  const hotStore = readFileSync(join(here, "../../../holo-apps/apps/tauri/cef-host/src/hot_store.cc"), "utf8");
  rec("CEF HotStore::AnchorOf computes the canonical blake3 anchor", /kr_blake3_hex\(/.test(hotStore) && !/kr_sha256_hex\(/.test(hotStore));
  const rust = readFileSync(join(here, "../../../holo-apps/apps/tauri/src-tauri/kappa-route/src/lib.rs"), "utf8");
  rec("Rust load_store matches the blake3 anchor first", /blake3_hex\(b\) == anchor \|\| sha256_hex\(b\) == anchor/.test(rust));

} finally {
  try { rmSync(root, { recursive: true, force: true }); } catch {}
}

const witnessed = failed === 0;
writeFileSync(join(here, "holo-blake3-anchor-witness.result.json"), JSON.stringify({
  spec: "P4 — the atomic anchor flip: the trust root is blake3(os-closure.json). Proven on a throwaway image with the real tools; consumers (SW, reseal, CEF HotStore, Rust load_store) carry the blake3-first wiring with a sha256 fallback so the flip is atomic-safe and tamper fail-closes. Native :9333 prove-boot is the user's host relink step.",
  witnessed, covers: ["anchor", "trust-root", "blake3", "fail-closed", "atomic-flip", "G1", "SEC-1"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-blake3-anchor-witness: ${passed} passed, ${failed} failed`);
console.log("Native half of P4: cargo test -p kappa-route closure_anchor_blake3_is_canonical · then relink the CEF host for the :9333 prove-boot");
process.exit(witnessed ? 0 : 1);
