// holo-arch.mjs — CC-10 guard: an emulated-OS image (a κ-disk) is admitted to an emulator engine ONLY
// when their architectures match. A missing platform match is an EXPLICIT, descriptive error — never a
// silently-wrong architecture (holospaces Quality Requirements CC-10: "Missing platform matches must be
// an explicit error, never a silently wrong architecture"). The check is cheap and runs BEFORE any heavy
// engine/image bytes are fetched, so a wrong-arch image fails fast and loud instead of crashing deep
// inside the JIT (or, worse, half-booting a wrong machine). Pure + dependency-free → the same function
// runs in the app (dynamic import) and in the Node witness, so there is ONE source of truth.

export class ArchMismatchError extends Error {
  constructor(message, { imageArch, engineArch, ctx } = {}) {
    super(message);
    this.name = "ArchMismatchError";
    this.imageArch = imageArch;
    this.engineArch = engineArch;
    this.ctx = ctx || {};
  }
}

// Normalize common architecture spellings so equivalent names compare equal (x86 family, arm64, riscv).
// Conservative: only well-known aliases collapse; an unknown token compares by its lowercased self, so a
// genuinely different arch never silently matches.
const ALIAS = {
  x86: "x86", i386: "x86", i686: "x86", ia32: "x86", x8632: "x86",
  x8664: "x86_64", x86_64: "x86_64", amd64: "x86_64", em64t: "x86_64",
  arm: "arm", armv7: "arm", arm64: "arm64", aarch64: "arm64",
  riscv: "riscv64", riscv64: "riscv64", rv64: "riscv64",
};
export const normArch = (a) => {
  const k = String(a == null ? "" : a).toLowerCase().replace(/[\s._-]/g, "");
  return ALIAS[k] || k;
};

// assertEngineArch(imageArch, engineArch, ctx) → true | throws ArchMismatchError
//   imageArch  — the architecture the κ-disk/image targets (declared in the app's kappa.json)
//   engineArch — the architecture the emulator engine actually runs (e.g. v86 ⇒ "x86")
//   ctx        — { what, engine } for a human-readable message
// CC-10 semantics:
//   · image declares NO arch        → explicit error (a missing match can't be assumed away)
//   · image arch ≠ engine arch      → explicit error (refuse the wrong architecture)
//   · arches match                  → return true (boot may proceed)
export function assertEngineArch(imageArch, engineArch, ctx = {}) {
  const what = ctx.what || "this image";
  const engine = ctx.engine || "this emulator";
  if (imageArch == null || String(imageArch).trim() === "") {
    throw new ArchMismatchError(
      `unsupported architecture: ${what} declares no target architecture, so it cannot be matched to ${engine} (runs "${engineArch}"). Refusing to boot — a missing platform match is an explicit error, never a silent guess (CC-10).`,
      { imageArch: imageArch ?? null, engineArch, ctx });
  }
  if (normArch(imageArch) !== normArch(engineArch)) {
    throw new ArchMismatchError(
      `unsupported architecture: ${what} targets "${imageArch}", but ${engine} runs "${engineArch}". Refusing to boot a mismatched architecture (it would run silently wrong) — CC-10.`,
      { imageArch, engineArch, ctx });
  }
  return true;
}

export default { assertEngineArch, normArch, ArchMismatchError };
