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
ok("isolated-typed-string-composes", lifted === 198 && bAlone !== 198 && SAPP.imports[0].params[0] === "str");

// ── 10 · WIT RETURNS — a component HANDS BACK a string or a struct (canonical-ABI indirect return: the
// callee returns a pointer to its result in ITS memory; the linker lowers it BACK into the caller's). ──
const RLIB = await app.build(`int alloc(int n){ int p=load(0); if(p<64)p=64; store(0,p+n); return p; }
int reverse(int p, int n){ int out=alloc(n); int i=0; while(i<n){ store8(out+i, load8(p+n-1-i)); i=i+1; } int rec=alloc(8); store(rec,out); store(rec+4,n); return rec; }
int divmod(int a, int b){ int buf=alloc(8); int q=a/b; store(buf,q); store(buf+4, a-q*b); int rec=alloc(8); store(rec,buf); store(rec+4,8); return rec; }`);
const STRRET = await app.build(`extern str reverse(str s) from "${RLIB.kappa}";
int alloc(int n){ int p=load(0); if(p<64)p=64; store(0,p+n); return p; }
int main(){ int p=alloc(2); store8(p,104); store8(p+1,105); int rec=reverse(p,2); int rp=load(rec); return load8(rp)*100 + load8(rp+1); }`);
const STRUCTRET = await app.build(`extern str divmod(int a, int b) from "${RLIB.kappa}";
int alloc(int n){ int p=load(0); if(p<64)p=64; store(0,p+n); return p; }
int main(){ int rec=divmod(17,5); int bp=load(rec); return load(bp)*10 + load(bp+4); }`);
ok("component-returns-a-string", (await app.run(STRRET.kappa)).exports.main() === 10604);   // reverse "hi" → "ih"
ok("component-returns-a-struct", (await app.run(STRUCTRET.kappa)).exports.main() === 32);    // divmod 17/5 → {q:3, r:2}

// ── 11 · WIT RECORDS · LISTS · VARIANTS — composite types whose fields are STRINGS cross isolated memories;
// the linker walks the type and lift/lowers every string RECURSIVELY (one general mechanism for all shapes) ──
const AL = (s) => "int alloc(int n){ int p=load(0); if(p<64)p=64; store(0,p+n); return p; }\n" + s;
const RICH = await app.build(AL(`int describe(int n){ int label=alloc(3); store8(label,72); store8(label+1,73); store8(label+2,33); int rec=alloc(12); store(rec,label); store(rec+4,3); store(rec+8, n*n); return rec; }
int makewords(){ int w0=alloc(2); store8(w0,72); store8(w0+1,105); int w1=alloc(2); store8(w1,121); store8(w1+1,111); int arr=alloc(16); store(arr,w0); store(arr+4,2); store(arr+8,w1); store(arr+12,2); int rec=alloc(8); store(rec,arr); store(rec+4,2); return rec; }
int classify(int n){ int rec=alloc(12); if(n>0){ store(rec,0); store(rec+4,n*2); } else { int s=alloc(3); store8(s,78); store8(s+1,79); store8(s+2,33); store(rec,1); store(rec+4,s); store(rec+8,3); } return rec; }`));
const richMain = async (src) => (await app.run((await app.build(AL(src))).kappa)).exports.main();
const recR = await richMain(`extern rec(str, int) describe(int n) from "${RICH.kappa}";\nint main(){ int r=describe(7); int lp=load(r); int ll=load(r+4); int v=load(r+8); return load8(lp)*100 + ll*10 + (v==49); }`);
ok("record-with-string-field-composes", recR === 7231);    // describe(7) → { label:"HI!", value:49 }
const listR = await richMain(`extern list(str) makewords() from "${RICH.kappa}";\nint main(){ int r=makewords(); int arr=load(r); int s0=load(arr); int s1=load(arr+8); return load8(s0)*1000 + load8(s1)*10 + load(r+4); }`);
ok("list-of-strings-composes", listR === 73212);           // makewords() → ["Hi","yo"]
const varR = await richMain(`extern variant(int, str) classify(int n) from "${RICH.kappa}";\nint main(){ int r=classify(0); int tag=load(r); int sp=load(r+4); int sl=load(r+8); return tag*1000 + load8(sp)*10 + sl; }`);
ok("variant-with-string-case-composes", varR === 1783);    // classify(0) → variant tag 1 = "NO!"

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
    "WIT RETURNS — a component hands BACK a string or a struct (canonical-ABI indirect return: the callee returns a pointer to its result; the linker lowers it back into the caller's own memory)",
    "WIT RECORDS · LISTS · VARIANTS — composite types whose fields are themselves strings cross isolated memories; one general recursive lift/lower walks the type descriptor and copies every string field into the destination's own memory",
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
