#!/usr/bin/env node
// holo-route-witness.mjs — HOLO ROUTE: typed semantic streams, the routing plane (ADR-0069). Proves the
// THIRD composition boundary — the *data* boundary (beside Holo Link's *call* boundary and Holo
// Orchestrate's *collaboration* boundary). A pipeline is a content-addressed dataflow graph of
// deterministic κ-transforms whose seams are TYPE-CHECKED by re-derivation BEFORE a byte flows; the HOST
// is the pipe (it lowers a typed value into a stage's OWN memory and lifts the result back, the
// isolated-component ABI Holo Link proves); each stage runs as a verifiable κ-transform (re-derive,
// Law L5); a shared (stageκ ⊕ inputκ) is an O(1) rebind (Law L3); the conscience gates each dispatch;
// and the whole run SEALS as one self-verifying PROV-O κ any peer re-runs — tamper anywhere refuses it.
//
// Authority: W3C WebAssembly Core 2.0 · IETF RFC 8785 (JCS) · W3C PROV-O + DID Core · WHATWG Streams ·
// UOR-ADDR (κ = H(canonical_form)) · the Holo Constitution (ADR-0033) · holospaces Laws L1/L3/L5.
//   node tools/holo-route-witness.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeApp } from "../os/usr/lib/holo/holo-app.mjs";
import { makeRoute } from "../os/usr/lib/holo/holo-route.mjs";
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
const route = makeRoute({ app, store, hash: (b) => sha256hex(b) });

// a bump allocator + memory, the isolated-component ABI (Holo Link): every str/bytes stage exports it.
const AL = "int alloc(int n){ int p=load(0); if(p<64)p=64; store(0,p+n); return p; }\n";

// ── stages: deterministic κ-transforms (Holo Forge builds). i32→i32 and str→str. ──
const SQ  = await app.build("int main(int x){ return x * x; }");                    // i32 → i32
const INC = await app.build("int main(int x){ return x + 1; }");                    // i32 → i32
const UPPER = await app.build(AL + "int main(int p, int n){ int out=alloc(n); int i=0; while(i<n){ int c=load8(p+i); if(c>=97 && c<=122){ c=c-32; } store8(out+i,c); i=i+1; } int rec=alloc(8); store(rec,out); store(rec+4,n); return rec; }");   // str → str (uppercase)
const REV   = await app.build(AL + "int main(int p, int n){ int out=alloc(n); int i=0; while(i<n){ store8(out+i, load8(p+n-1-i)); i=i+1; } int rec=alloc(8); store(rec,out); store(rec+4,n); return rec; }");                                            // str → str (reverse)
ok("stages-are-kappa-objects", [SQ, INC, UPPER, REV].every((s) => /^did:holo:sha256:/.test(s.kappa)));

// ── 1 · an i32 PIPELINE runs as a dataflow: pipe(sq).to(inc).run(7) = sq(7)→49 → inc→50 ──
const i32pipe = route.pipe(SQ.kappa).to(INC.kappa);                                 // bare κ → entry "main", i32→i32
ok("i32-pipeline-runs-the-dataflow", (await i32pipe.run(7)) === 50);

// ── 2 · SEMANTIC STREAMS: a typed STRING value crosses isolated stage memories. The host lowers "holo"
// into UPPER's own memory, lifts "HOLO", lowers it into REV's own memory, lifts "OLOH" — the host is the
// pipe (the canonical-ABI lift/lower at the STAGE boundary), proving str values flow, not just bytes. ──
const strStage = (k) => ({ kappa: k, entry: "main", in: "str", out: "str" });
const strpipe = route.pipe(strStage(UPPER.kappa)).to(strStage(REV.kappa));
ok("semantic-string-stream-crosses-stages", (await strpipe.run("holo")) === "OLOH");

// ── 3 · TYPED SEAM checked by re-derivation BEFORE a byte flows: connecting a str-OUT stage to an
// i32-IN stage is REFUSED at assembly with a precise message (never discovered mid-run). ──
let seamRefused = false, seamMsg = "";
try { await route.pipe(strStage(UPPER.kappa)).to(INC.kappa).run("x"); }
catch (e) { seamRefused = /seam\[0→1\] type mismatch/.test(e.message); seamMsg = e.message; }
ok("typed-seam-mismatch-refused-before-run", seamRefused, seamMsg);

// a stage must structurally provide its entry export (verified against its pinned bytes) ──
let entryRefused = false;
try { await route.pipe({ kappa: SQ.kappa, entry: "nope", in: "i32", out: "i32" }).run(3); }
catch (e) { entryRefused = /no entry export "nope"/.test(e.message); }
ok("missing-entry-export-refused", entryRefused);

// ── 4 · Law L3: re-running the SAME (stageκ ⊕ inputκ) is an O(1) REBIND, not a recompute ──
const fresh = await route.route([SQ.kappa, INC.kappa], 5, { withReceipt: true });   // input 5 — not run elsewhere
const again = await route.route([SQ.kappa, INC.kappa], 5, { withReceipt: true });
ok("L3-identical-stage-input-rebinds-O(1)",
  fresh.value === 26 && fresh.activities.every((a) => a["hosc:rebind"] === false) && again.activities.every((a) => a["hosc:rebind"] === true));

// ── 5 · SEAL: the whole run is one self-verifying PROV-O κ (the pipeline IS an object) ──
const sealed = await route.seal(i32pipe.spec(), 7);
ok("pipeline-seals-to-one-self-verifying-kappa",
  /^did:holo:sha256:/.test(sealed.kappa) && sealed.value === 50 && sealed.object["hosc:activities"].length === 2);

// ── 6 · SHARE: the sealed pipeline is reachable from ONE holo://κ ──
ok("share-the-pipeline-kappa", sealed.share.holo === "holo://" + sealed.kappa.split(":").pop());

// ── 7 · Law L5: hold ONLY the sealed κ → re-derive the object AND re-run it; reproduce the final κ ──
const v = await route.verify(sealed.kappa);
ok("L5-sealed-pipeline-re-derives", v.ok === true && v.generated === sealed.outKappa);

// ── 8 · Law L5: a TAMPERED stage refuses the whole pipeline (re-derivation across the dataflow) ──
const good = await store.get(SQ.kappa);
const bad = Uint8Array.from(good); bad[bad.length - 2] ^= 0xff;
await backend.set(SQ.kappa, bad);                                                   // corrupt a stage under its κ
const vBad = await route.verify(sealed.kappa);
await backend.set(SQ.kappa, good);                                                  // restore
ok("L5-tampered-stage-refuses-pipeline", vBad.ok === false && (await route.verify(sealed.kappa)).ok === true);

// also: flipping the SEALED object's own bytes fails re-derivation at the κ layer ──
const sgood = await store.get(sealed.kappa); const sbad = Uint8Array.from(sgood); sbad[10] ^= 0xff;
await backend.set(sealed.kappa, sbad);
const vSeal = await route.verify(sealed.kappa);
await backend.set(sealed.kappa, sgood);
ok("L5-tampered-seal-refuses", vSeal.ok === false && /L5/.test(vSeal.reason || ""));

// ── 9 · the CONSCIENCE gates each stage dispatch (ADR-0033): a blocking verdict HALTS the flow, fail-closed ──
const gated = makeRoute({ app, store, hash: (b) => sha256hex(b), conscience: { evaluate: () => ({ outcome: "block", reason: "policy" }) } });
let conscienceHalt = false;
try { await gated.route([SQ.kappa, INC.kappa], 7); }
catch (e) { conscienceHalt = /refused by conscience/.test(e.message); }
ok("conscience-gate-halts-the-flow", conscienceHalt);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "typed semantic streams: a content-addressed pipeline of deterministic κ-transforms runs the dataflow (i32 and str)",
    "the HOST is the pipe — a typed STRING value crosses isolated stage memories (lower into the stage's own memory, lift the result), the canonical-ABI lift/lower at the stage boundary (Holo Link's isolated-component model)",
    "typed seams are checked by re-derivation BEFORE a byte flows — a type-mismatched seam (str→i32) is refused at assembly with a precise message; a stage missing its entry export is refused (verified against its pinned bytes)",
    "Law L3 — re-running the same (stageκ ⊕ inputκ) is an O(1) rebind, not a recompute",
    "the whole run SEALS as one self-verifying PROV-O κ (the pipeline is an object) reachable from one holo://κ",
    "Law L5 — holding only the sealed κ re-derives the object AND re-runs it, reproducing the final output κ byte-for-byte",
    "Law L5 — a tampered stage OR a tampered seal refuses the whole pipeline (re-derivation across the dataflow)",
    "the Holo Constitution (ADR-0033) — a blocking conscience verdict halts the flow at stage dispatch, fail-closed",
  ],
  stages: { sq: SQ.kappa, inc: INC.kappa, upper: UPPER.kappa, reverse: REV.kappa },
  sealed: { kappa: sealed.kappa, value: sealed.value, activities: sealed.object["hosc:activities"].length },
  checks, failed: fail,
  authority: "W3C WebAssembly Core 2.0 · IETF RFC 8785 (JCS) · W3C PROV-O · W3C DID Core · WHATWG Streams · UOR-ADDR · Holo Constitution (ADR-0033) · Law L1/L3/L5",
};
writeFileSync(join(here, "holo-route-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Route witness — typed semantic streams, the routing plane (ADR-0069)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  sq ${SQ.kappa.slice(0, 28)}…  ·  upper ${UPPER.kappa.slice(0, 28)}…\n  sealed pipeline ${sealed.kappa}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
