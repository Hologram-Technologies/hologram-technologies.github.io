#!/usr/bin/env node
// holo-link-witness.mjs — HOLO LINK: content-addressed composition. Proves CLOSURE on the substrate —
// objects combine into new self-verifying objects and split back apart, connected only by a single
// self-referential κ. A library compiles to a κ-object; an app imports it BY CONTENT ADDRESS (the κ is
// the WASM import's module-name, so the app's own bytes commit to its dependency); running the app LINKS
// the dependency from the store, verified by re-derivation (Law L5) and instantiated once (Law L3); the
// dependency still stands alone as its own object; a tampered dependency refuses the whole run.
//
// Authority: W3C WebAssembly Core 2.0 (imports/linking) · IETF RFC 8785 (JCS) · UOR-ADDR · Law L1/L3/L5.
//   node tools/holo-link-witness.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeApp } from "../os/usr/lib/holo/holo-app.mjs";
import { makeStore, memBackend } from "../os/usr/lib/holo/holo-store.js";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const backend = memBackend();
const store = makeStore({ hash: (b) => sha256hex(b), axis: "did:holo:sha256", backend });
const app = makeApp({ store, hash: (b) => sha256hex(b) });
app.build.compilerKappa = "did:holo:sha256:" + sha256hex(readFileSync(join(OS, "usr/lib/holo/holo-forge/holo-forge.mjs")));

// ── 1 · a LIBRARY is a κ-object ──
const LIB = `int add(int a, int b) { return a + b; }
int mul(int a, int b) { return a * b; }
`;
const B = await app.build(LIB);
ok("library-is-kappa-object", /^did:holo:sha256:/.test(B.kappa) && B.exports.join(",") === "add,mul");

// ── 2 · an APP imports the library BY CONTENT ADDRESS (the κ in the source) ──
const APP = `extern int add(int a, int b) from "${B.kappa}";
int main() { return add(40, 2); }
`;
const A = await app.build(APP);
ok("app-builds-with-kappa-import", /^did:holo:sha256:/.test(A.kappa) && A.imports.length === 1 && A.imports[0].kappa === B.kappa);

// ── 3 · CLOSURE: the combined object's own bytes (hence its κ) commit to its dependency's κ ──
const aWasm = await store.get(A.kappa);
ok("closure-bytes-commit-to-dependency-kappa", new TextDecoder("latin1").decode(aWasm).includes(B.kappa));

// ── 4 · COMBINE + RUN by content address: the dependency is linked from the store + executed (L5 sem.) ──
const rA = await app.run(A.kappa);
ok("composed-runs-via-content-address", rA.exports.main() === 42 && rA.selfCompiled === false);

// running the SOURCE κ also self-compiles, links, and runs (one κ, self-bootable)
const rAsrc = await app.run(A.sourceKappa);
ok("composed-runs-from-source-kappa", rAsrc.exports.main() === 42 && rAsrc.selfCompiled === true);

// ── 5 · SPLIT: the dependency still stands alone as its own self-verifying, runnable object ──
const rB = await app.run(B.kappa);
ok("dependency-stands-alone", rB.exports.add(7, 8) === 15 && rB.exports.mul(6, 7) === 42);

// ── 6 · O(1): recompose (rebuild the app) → rebind to the cached build, not a recompile ──
const A2 = await app.build(APP);
ok("compose-O(1)-rebind", A2.kappa === A.kappa && A2.hit === true);

// ── 7 · SHARE: the whole composition is reachable from ONE κ ──
const s = app.share(A.kappa);
ok("share-the-composition-kappa", s.holo === "holo://" + A.kappa.split(":").pop());

// ── 8 · Law L5: a tampered dependency refuses the whole run (re-derivation across the link) ──
const good = await store.get(B.kappa);
const bad = Uint8Array.from(good); bad[bad.length - 2] ^= 0xff;
await backend.set(B.kappa, bad);                    // corrupt the dependency under its κ
let refused = false;
try { await app.run(A.kappa); } catch (e) { refused = /L5 refused/.test(e.message); }
await backend.set(B.kappa, good);                   // restore
ok("tampered-dependency-refuses-run", refused && (await app.run(A.kappa)).exports.main() === 42);

// ── 9 · WIT-style ISOLATED TYPED interfaces (the canonical-ABI core): a STRING crosses between two
// components that EACH KEEP THEIR OWN memory. The app builds "ABC" in ITS memory; the imported library
// sums the bytes in ITS memory; the linker LIFTS the string from the caller and LOWERS it into the callee
// (the type info travels in a content-addressed `holo-iface` custom section). ──
const SLIB = await app.build("int alloc(int n) { int p = load(0); if (p < 64) p = 64; store(0, p + n); return p; } int bytesum(int p, int n) { int s = 0; int i = 0; while (i < n) { s = s + load8(p + i); i = i + 1; } return s; }");
const SAPP = await app.build(`extern int bytesum(str s) from "${SLIB.kappa}";
int main() { store8(64, 65); store8(65, 66); store8(66, 67); return bytesum(64, 3); }
`);
const lifted = (await app.run(SAPP.kappa)).exports.main();              // "ABC"(65+66+67) lifted from A's mem → lowered into B's
const bAlone = (await app.run(SLIB.kappa)).exports.bytesum(64, 3);      // B's OWN memory at 64 is empty (not A's) → proves ISOLATION
ok("isolated-typed-string-composes", lifted === 198 && bAlone !== 198 && SAPP.imports[0].str[0] === 0);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "content-addressed composition: an app imports a library by κ (the κ is the WASM import module-name)",
    "CLOSURE — the combined object's bytes commit to its dependency's κ; reachable from one self-referential κ",
    "combine + run by content address: the dependency is linked from the store, verified (L5), instantiated once (L3)",
    "split — the dependency still stands alone as its own self-verifying, runnable κ-object",
    "O(1) recompose (rebind, not recompile); the whole composition shares as one holo://κ",
    "Law L5: a tampered dependency refuses the whole run (re-derivation across the link)",
    "WIT-style isolated typed interfaces — a STRING crosses between components that each keep their OWN memory; the linker lifts it from the caller and lowers it into the callee (canonical-ABI core), the string-type info carried in a content-addressed holo-iface custom section",
  ],
  library: { kappa: B.kappa, exports: B.exports },
  composed: { kappa: A.kappa, source: A.sourceKappa, imports: A.imports },
  checks, failed: fail,
  authority: "W3C WebAssembly Core 2.0 · IETF RFC 8785 (JCS) · W3C PROV-O · W3C DID Core · UOR-ADDR · Law L1/L3/L5",
};
writeFileSync(join(here, "holo-link-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Link witness — content-addressed composition (closure)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  library  ${B.kappa}\n  composed ${A.kappa}  ← imports ${A.imports.map((i) => i.kappa.slice(0, 24) + "…").join(", ")}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
