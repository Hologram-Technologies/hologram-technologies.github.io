#!/usr/bin/env node
// holo-app-witness.mjs — proves BUILD · RUN · SHARE, the three native verbs every holospace fulfils
// (ADR-0051), over the shared content-addressed substrate. Pure Node (Map-backed holo-store), no
// browser. It builds Holo-C → wasm into the κ-store, RUNS by artifact κ AND by source κ (the single-κ
// self-compile), proves the build is O(1) on repeat (rebind, not recompile), shares a κ as holo://κ,
// and refuses a tampered byte on read (Law L5).
//
// Authority: W3C WebAssembly Core 2.0 · IETF RFC 8785 (JCS) · W3C PROV-O / DID Core · UOR-ADDR · Law
// L1/L2/L5. Writes the result the gate joins.  node tools/holo-app-witness.mjs

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

const SOURCE = `int add(int a, int b) { return a + b; }
int fib(int n) { if (n < 2) return n; return add(fib(n - 1), fib(n - 2)); }
int gcd(int a, int b) { while (b != 0) { int t = a % b; a = b; b = t; } return a; }
`;

const store = makeStore({ hash: (b) => sha256hex(b), axis: "did:holo:sha256", backend: memBackend() });
const app = makeApp({ store, hash: (b) => sha256hex(b) });
app.build.compilerKappa = "did:holo:sha256:" + sha256hex(readFileSync(join(OS, "usr/lib/holo/holo-forge/holo-forge.mjs")));

// ── BUILD: compile → wasm, persisted by κ; the source + artifact + receipt are all κ-objects ──
const b = await app.build(SOURCE);
ok("build-returns-kappas", /^did:holo:sha256:/.test(b.kappa) && /^did:holo:sha256:/.test(b.sourceKappa) && /^did:holo:sha256:/.test(b.receipt));
ok("artifact-content-addressed", b.kappa === "did:holo:sha256:" + sha256hex(await store.get(b.kappa)));
ok("artifact-in-store", (await store.get(b.kappa)) != null && (await store.get(b.sourceKappa)) != null && (await store.get(b.receipt)) != null);

// ── O(1): rebuild identical source → rebind to the cached build, not a recompile ──
const b2 = await app.build(SOURCE);
ok("build-deterministic", b2.kappa === b.kappa);
ok("build-O(1)-rebind", b2.hit === true);

// ── RUN by ARTIFACT κ: resolve + execute ──
const r1 = await app.run(b.kappa);
ok("run-by-artifact-kappa", r1.exports.fib(10) === 55 && r1.exports.gcd(48, 36) === 12 && r1.selfCompiled === false);

// ── RUN by SOURCE κ: the single κ SELF-COMPILES, then runs ──
const r2 = await app.run(b.sourceKappa);
ok("run-by-source-kappa-self-compiles", r2.exports.fib(10) === 55 && r2.selfCompiled === true);

// ── RUN raw source directly (build-then-run) ──
const r3 = await app.run(SOURCE);
ok("run-raw-source", r3.exports.add(2, 3) === 5);

// ── SHARE: the κ IS the share (holo://κ, location-independent) ──
const s = app.share(b.kappa);
ok("share-is-the-kappa", s.kappa === b.kappa && s.holo === "holo://" + b.kappa.split(":").pop());

// ── Law L5: a tampered byte under a κ is refused on read ──
const good = await store.get(b.kappa);
const tampered = Uint8Array.from(good); tampered[tampered.length - 2] ^= 0xff;
ok("tamper-refused-on-read", (await store.verify(b.kappa, tampered)) === false && (await store.verify(b.kappa, good)) === true);

// ── PINS — the build is reproducible, so its κ's are constants ──
// artifact + source are pinned (stable: the compiler's OUTPUT is deterministic). The receipt κ is NOT
// pinned — it embeds the compiler's own κ, which legitimately shifts on any edit to the compiler source
// (even a comment); the receipt is proven sound by being content-addressed did:holo (build-returns-kappas).
const PIN = { artifact: "did:holo:sha256:9e708c7f8e2ce1fa5f7a6cd84d06a7720ca18c9b73d577b2473cdffa742665f9", source: "did:holo:sha256:28e83c448277b107a84b5608da959b06192deb9e2fe5ac7c2c71f78a470ef9b4" };
ok("artifact-rederives-to-pin", b.kappa === PIN.artifact, b.kappa);
ok("source-rederives-to-pin", b.sourceKappa === PIN.source, b.sourceKappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "BUILD · RUN · SHARE are native verbs over the shared content-addressed κ-store (holo-store) — one substrate for data and code",
    "build compiles Holo-C → wasm, persisting source + artifact + PROV-O receipt as κ-objects; O(1) rebind on repeat (no recompile)",
    "run executes by κ: an ARTIFACT κ runs directly, a SOURCE κ self-compiles then runs — one κ, self-compiling",
    "share returns holo://κ — the κ IS the share, location-independent and self-verifying",
    "Law L5: a tampered byte under a κ is refused on read",
  ],
  build: { artifact: b.kappa, source: b.sourceKappa, receipt: b.receipt, exports: b.exports },
  checks, failed: fail,
  authority: "W3C WebAssembly Core 2.0 · IETF RFC 8785 (JCS) · W3C PROV-O · W3C DID Core · UOR-ADDR · Law L1/L2/L5",
};
writeFileSync(join(here, "holo-app-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo App witness — build · run · share\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  artifact ${b.kappa}\n  source   ${b.sourceKappa}\n  receipt  ${b.receipt}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
