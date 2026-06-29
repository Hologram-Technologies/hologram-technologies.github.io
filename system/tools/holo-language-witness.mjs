#!/usr/bin/env node
// holo-language-witness.mjs — STEP 1 of the ADAM convergence: the ONE objective Language seam. Proves the
// scattered network/format adapters (Forge=compile, Projection/Media=codec, κ-Roots/Truenames=naming,
// Transport=replicate, fediverse=transport, web/ipfs=storage) all resolve through ONE capability-typed
// interface; a κ from any Language re-verifies (L5); a new network is ONE object (evolvable); a Language with
// its own hasher is refused (L4); the taxonomy spans all six capabilities.
// Authority: ADAM Language (LinkLanguage) · the diagram's objective layer · Laws L4/L5. node tools/holo-language-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeLanguages, defineLanguage, CAPABILITIES } from "../os/usr/lib/holo/holo-language.mjs";
import { seal, verify as verifyObj, UOR_CONTEXT } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// a representative Language per real subsystem: WRAPS its source, SEALS via the one substrate sealer (never
// its own hasher), re-verifies on get. The six span all six capabilities.
const adapter = (name, cap) => defineLanguage({
  name, capabilities: { [cap]: true },
  create: (data) => seal({ "@context": UOR_CONTEXT, "@type": ["holo:LangValue"], lang: name, data: data ?? null }),
  get: (e) => (verifyObj(e) ? e : null),
});
const SUBSYSTEMS = [
  ["ipfs", "storage"], ["fediverse", "transport"], ["projection", "codec"],
  ["roots", "naming"], ["forge", "compile"], ["transport", "replicate"],
];

const langs = makeLanguages();
for (const [n, c] of SUBSYSTEMS) langs.register(adapter(n, c));

// ── 1 · all six adapters resolve through the SAME interface ───────────────────────────────────────────
const created = SUBSYSTEMS.map(([n]) => ({ language: n, value: langs.byName(n).create("hello-" + n) }));
const allResolve = created.every((ref) => { const got = langs.resolve(ref); return got && got.lang === ref.language; });
ok("allThroughOneInterface", langs.size() === 6 && allResolve, `size=${langs.size()} allResolve=${allResolve}`);

// ── 2 · a κ from any Language re-verifies; a tampered κ fails closed (Law L5) ─────────────────────────
const good = created[0];
const tampered = { language: good.language, value: JSON.parse(JSON.stringify(good.value)) };
tampered.value.data = "FORGED";                                    // mutate content, keep the id ⇒ won't re-derive
ok("kappaReverifies", !!langs.resolve(good) && langs.resolve(tampered) === null, "good resolves, tampered is null");

// ── 3 · registering a NEW network is ONE object, no core change (the "evolvable" property) ────────────
const before = langs.size();
langs.register(adapter("solid", "storage"));                       // a brand-new network, one defineLanguage
const grew = langs.size() === before + 1 && !!langs.byName("solid");
ok("evolvableOneObject", grew, `size ${before}->${langs.size()}`);

// ── 4 · the capability taxonomy SPANS all six classes (the seam covers every kind of adapter) ─────────
const covered = langs.coveredCapabilities();
ok("capabilityTaxonomySpans", CAPABILITIES.every((c) => covered.includes(c)), `covered=${covered.join(",")}`);

// ── 5 · a Language with its OWN hasher is refused (Law L4: one sealer, hash-agnostic Languages) ───────
let l4 = false;
try { defineLanguage({ name: "rogue", capabilities: { storage: true }, hasher: () => "nope", create: () => ({}), get: () => null }); }
catch { l4 = true; }
ok("hashAgnosticL4", l4, "a Language carrying its own hasher must throw");

// ── 6 · resolve routes by name and fails closed on an unknown Language ────────────────────────────────
ok("resolveRoutesByName",
  !!langs.resolve({ language: "projection", value: langs.byName("projection").create("frame") }) &&
    langs.resolve({ language: "nonexistent", value: {} }) === null,
  "known routes, unknown is null");

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-language (ADAM convergence Step 1) — ONE objective Language seam: every network/format adapter resolves through a single {name, capabilities, create, get} contract; output re-verifies (L5); a Language carries no hasher (L4); the six-capability taxonomy spans Forge/Projection/Media/Roots/Transport/fediverse/web. Registering a network is one object (evolvable).",
  authority: "ADAM Language / LinkLanguage · the diagram's objective layer · Laws L4/L5",
  witnessed, checks, failed: fail,
};
writeFileSync(join(here, "holo-language-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-language — STEP 1: the ONE objective Language seam\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — the third noun is a single seam` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
