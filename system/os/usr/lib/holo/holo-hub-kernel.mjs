// holo-hub-kernel.mjs — Holo Hub Stage 3 (ADR-0094): Medusa's commerce MATH, compiled to run
// in-tab as a verifiable Forge κ-transform — VERBATIM Medusa code, not re-implemented.
//
// "Adopt, don't run" has one honest exception (ADR-0029): Medusa's PURE calculation functions
// are vendored and COMPILED (not re-written). The κ-transform (Holo Forge, ADR-0051):
//   κ(Medusa source) ⊕ κ(esbuild) ⊕ κ(flags) ⊕ κ(bignumber.js) → κ(kernel)
// esbuild is deterministic, so the kernel re-derives byte-for-byte (Law L5); it inlines its only
// runtime dep (bignumber.js) → 0-network at runtime (serverless). The result is an ESM module that
// runs identically in the browser (a Blob import) and Node (the witness).
//
// SCOPE (honest): this kernel is the CLEAN pure core — the tax + totals MATH
// (`totals/math.ts` `MathBN`, `totals/big-number.ts`, `totals/tax/index.ts`). Their only external
// value dep is `bignumber.js`; `@medusajs/types` is type-only (esbuild elides). The broader totals
// (cart/line-item/shipping) and promotion ACTION-selection pull `@medusajs/framework/utils` +
// `@mikro-orm/postgresql` (glue) and are the next compile sub-stage — surfaced, never faked.

import { bundleRepo } from "./holo-forge-bundle.mjs";
import { forgeReceipt, jcs } from "./holo-forge/holo-forge.mjs";
import { blake3hex } from "./holo-blake3.mjs";

// §1.2: the ONE canonical content hash is BLAKE3. κ mints below use blake3hex (SYNC), not the
// injected sha256 `hash` — the prior injected axis is retained only for optional caller diagnostics.
const enc = (s) => new TextEncoder().encode(s);
const kappaOf = (str) => "did:holo:blake3:" + blake3hex(enc(str));

// The verbatim Medusa files this kernel compiles (paths under vendor/medusa/, re-hashable to κ).
export const KERNEL_FILES = Object.freeze([
  "packages/core/utils/src/totals/math.ts",
  "packages/core/utils/src/totals/big-number.ts",
  "packages/core/utils/src/totals/tax/index.ts",
  "packages/core/utils/src/common/is-defined.ts",
  "packages/core/utils/src/common/is-string.ts",
  "packages/core/utils/src/common/is-big-number.ts",
  "packages/core/utils/src/common/is-object.ts",
]);

// A CURATED pure-subset barrel for the impure `../common` index (which upstream re-exports
// express/fs/mikro-orm helpers). The verbatim Medusa files are UNTOUCHED — this only changes how
// the `../common` specifier RESOLVES at build time, keeping the bundle hermetic + pure (ADR-0029).
const COMMON_SHIM = 'export { isDefined } from "./is-defined"\n';

// The kernel entry: re-export Medusa's commerce-math public surface, verbatim.
const ENTRY = [
  'export { calculateTaxTotal, calculateAmountsWithTax } from "./packages/core/utils/src/totals/tax"',
  'export { BigNumber } from "./packages/core/utils/src/totals/big-number"',
  'export { MathBN } from "./packages/core/utils/src/totals/math"',
  "",
].join("\n");

// buildCommerceKernel({ read, esbuild, bignumber, hash }) → { js, kappa, receipt, files, unresolved }.
//   read(relPath)  — verbatim text of a vendored Medusa file (under vendor/medusa/)
//   esbuild        — the injected bundler (Node: esbuild; browser: esbuild-wasm)
//   bignumber      — the vendored bignumber.js ESM source (its only runtime dep)
//   hash(str)      — OPTIONAL legacy sha256hex (accepted but unused; κ is minted with BLAKE3 §1.2)
export async function buildCommerceKernel({ read, esbuild, bignumber, hash }) {
  if (typeof read !== "function") throw new Error("buildCommerceKernel needs read(relPath)");
  if (!esbuild?.build) throw new Error("buildCommerceKernel needs an injected esbuild");
  if (!bignumber) throw new Error("buildCommerceKernel needs the vendored bignumber.js source");

  const files = new Map();
  files.set("entry.ts", { text: ENTRY });
  for (const p of KERNEL_FILES) files.set(p, { text: read(p) });
  files.set("packages/core/utils/src/common/index.ts", { text: COMMON_SHIM }); // curated pure barrel

  // bignumber.js → the vendored source (the ONE runtime dep, inlined); @medusajs/* types are erased.
  const resolveBare = async (spec) =>
    spec === "bignumber.js" ? { contents: bignumber } :
    spec.startsWith("@medusajs/") ? { contents: "" } : null;

  const { js, unresolved, warnings } = await bundleRepo({
    files, entry: "entry.ts", esbuild, resolveBare, format: "esm",
    // big-number.ts reads process.env.* with a `|| default` fallback — define them away so the
    // bundle is browser-safe (no `process`) and deterministic; the documented defaults apply.
    define: {
      "process.env.MEDUSA_EPSILON": "undefined",
      "process.env.MEDUSA_DEFAULT_CURRENCY_EPSILON": "undefined",
    },
  });
  if (unresolved.length) throw new Error("commerce kernel has unresolved deps: " + unresolved.join(", "));

  const kappa = kappaOf(js);
  const sourceKappa = kappaOf(jcs([...files.keys()].sort().map((k) => [k, files.get(k).text])));
  const receipt = forgeReceipt({
    sourceKappa, compilerKappa: "esbuild",
    flagsKappa: kappaOf(jcs({ bundle: true, format: "esm", platform: "browser" })),
    artifactKappa: kappa, lang: "medusa-commerce-kernel",
    exports: ["calculateTaxTotal", "calculateAmountsWithTax", "BigNumber", "MathBN"],
  });
  return { js, kappa, receipt, unresolved, warnings, files: [...files.keys()] };
}

export default { buildCommerceKernel, KERNEL_FILES };
