#!/usr/bin/env node
// holo-arch-witness.mjs — PROVE CC-10 (holospaces Quality Requirements): "Missing platform matches must
// be an explicit error, never a silently wrong architecture." Two halves, both asserted against the REAL
// artifacts (no reimplementation):
//   1 · the shared guard os/usr/lib/holo/holo-arch.mjs throws a descriptive ArchMismatchError on a
//       mismatch AND on a missing arch declaration, names BOTH architectures, and passes on a match
//       (incl. well-known aliases) — so the error is explicit, not silent.
//   2 · the canonical emulator app (holo-apps/apps/holo-x86) ENFORCES it: kappa.json declares matching
//       engine + image arch, and index.html calls assertEngineArch BEFORE it instantiates the engine
//       (new V86) and BEFORE it fetches the heavy engine/image bytes — so a wrong-arch image fails fast.
//
// Pure Node (no Chromium): the guard is pure logic proven by import, and the wiring is proven by source.
// The full-browser render of the error page is a separate tier (the guard fires before any heavy fetch,
// so a mismatch errors instantly).
//
//   node tools/holo-arch-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { OS_LIB, APPS_DIR } from "./holo-paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { assertEngineArch, normArch, ArchMismatchError } = await import(pathToFileURL(join(OS_LIB, "holo-arch.mjs")));

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok, d = "") => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}${d ? "  (" + d + ")" : ""}`); };
const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// ── 1 · the guard logic (the real exported function) ──
rec("match: identical arch passes (boot may proceed)", assertEngineArch("x86", "x86") === true);
rec("match: well-known aliases collapse (i686 ≡ x86; aarch64 ≡ arm64)", assertEngineArch("i686", "x86") === true && normArch("aarch64") === normArch("arm64"));

const mm = throws(() => assertEngineArch("riscv64", "x86", { what: "a RISC-V image", engine: "the v86 x86 emulator" }));
rec("mismatch: throws ArchMismatchError (refuses a wrong architecture)", mm instanceof ArchMismatchError && mm.name === "ArchMismatchError");
rec("mismatch: the error is EXPLICIT — names BOTH architectures (never silent)", !!mm && /riscv64/.test(mm.message) && /x86/.test(mm.message) && mm.imageArch === "riscv64" && mm.engineArch === "x86");

const undecl = throws(() => assertEngineArch(undefined, "x86"));
const empty = throws(() => assertEngineArch("", "x86"));
rec("missing declaration: an undeclared/empty image arch is an EXPLICIT error (no silent guess)", undecl instanceof ArchMismatchError && empty instanceof ArchMismatchError);

// a near-miss that must NOT silently match: 32-bit x86 image vs a 64-bit-only token stays distinct
rec("non-vacuous: genuinely different arches do not collapse (x86 ≠ riscv64 ≠ arm64)", normArch("x86") !== normArch("riscv64") && normArch("riscv64") !== normArch("arm64"));

// ── 2 · the canonical app ENFORCES it (source-level wiring, against the real files) ──
let kappa = null, html = "";
try { kappa = JSON.parse(readFileSync(join(APPS_DIR, "holo-x86/kappa.json"), "utf8")); } catch {}
try { html = readFileSync(join(APPS_DIR, "holo-x86/index.html"), "utf8"); } catch {}

const eArch = kappa && kappa.engine && kappa.engine.arch;
const iArch = kappa && kappa.image && kappa.image.cdrom && kappa.image.cdrom.arch;
rec("holo-x86 kappa.json declares engine arch AND image arch", !!eArch && !!iArch, `engine=${eArch} image=${iArch}`);
rec("holo-x86 declared arches match (the app boots, never self-refuses on its own image)", !!eArch && !!iArch && normArch(eArch) === normArch(iArch));

const iImport = html.indexOf("holo-arch.mjs");
const iCall = html.indexOf("assertEngineArch(");
const iNewV86 = html.indexOf("new V86(");
const iFirstFetch = html.indexOf("fetchVerified(kappa.engine");
rec("holo-x86 imports the shared guard (single source of truth)", iImport !== -1);
rec("holo-x86 CALLS assertEngineArch (enforced, not just present)", iCall !== -1);
rec("the guard runs BEFORE the engine is instantiated (new V86)", iCall !== -1 && iNewV86 !== -1 && iCall < iNewV86);
rec("the guard runs BEFORE any heavy engine/image fetch (fails fast, no wasted download)", iCall !== -1 && iFirstFetch !== -1 && iCall < iFirstFetch);

// proof the app's own values pass the real guard (so this wiring boots, and only a genuine mismatch trips it)
let appPasses = false; try { appPasses = assertEngineArch(iArch, eArch) === true; } catch {}
rec("the guard, applied to holo-x86's own declared arches, PASSES (mechanism is live + consistent)", appPasses);

const witnessed = failed === 0;
writeFileSync(join(here, "holo-arch-witness.result.json"), JSON.stringify({
  spec: "CC-10 — a κ-disk/image is admitted to an emulator engine only when their architectures match; a missing or mismatched platform is an explicit, descriptive error (ArchMismatchError naming both arches), never a silently-wrong architecture. The shared guard (os/usr/lib/holo/holo-arch.mjs) is enforced by the canonical emulator app (holo-x86) BEFORE it instantiates the engine or fetches heavy bytes.",
  authority: "holospaces docs/10-Quality-Requirements CC-10 (missing platform matches must be an explicit error, never a silently wrong architecture) · CC-9 (boot to userspace on the emulator core) — guard os/usr/lib/holo/holo-arch.mjs; wiring holo-apps/apps/holo-x86 (kappa.json + index.html)",
  witnessed,
  covers: ["cc-10", "explicit-arch-error", "no-silent-wrong-arch", "guard-enforced-before-boot"],
  engineArch: eArch || null, imageArch: iArch || null,
  note: "Guard logic proven by import; enforcement proven by source against the real holo-x86 files. The full-browser render of the error page is a separate tier — the guard fires before any heavy fetch, so a mismatch errors instantly. Adoption beyond holo-x86 (the ~100 v86 distro apps) is incremental: each declares image arch + calls the same guard.",
  checks, passed, failed,
}, null, 2) + "\n");

console.log(`\nholo-arch-witness: ${passed} passed, ${failed} failed  (CC-10 witnessed=${witnessed})`);
process.exit(witnessed ? 0 : 1);
