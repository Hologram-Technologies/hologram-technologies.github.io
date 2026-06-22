// holo-q-app-spec-witness.mjs — Stage A proof: intent → a TYPED spec → the holo-apps bundle (manifest κ +
// reducer κ + projection κ + collections + capabilities), content-addressed and conformant. Generation targets
// typed slots, so a MALFORMED spec is repaired into a VALID app (the reliability fix for weak coders); the
// projection is beautiful by construction (κ-component library + conscience) and decomposes to a κ-DAG; the app
// declares kinds + capabilities only over declared collections and never authors platform kinds (§2.9/§3). Pure
// Node, the substrate hash. Run: node holo-q-app-spec-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const { validateSpec, compileSpec, PLATFORM_KINDS } = await imp("../os/usr/lib/holo/q/holo-q-app-spec.mjs");
const { audit } = await imp("../os/usr/lib/holo/q/holo-q-design-conscience.mjs");
const dag = await imp("../os/usr/lib/holo/q/holo-q-app-dag.mjs");
const { sha256hex, jcs } = await imp("../os/usr/lib/holo/holo-uor.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

// a well-formed spec (what Q's structured synth produces): a small expense-tracker app.
const SPEC = {
  name: "Flat Expenses",
  ui: { type: "page", children: [
    { type: "nav", props: { brand: "Flat Expenses", links: ["Home", "Add"] } },
    { type: "hero", props: { title: "Flat Expenses", subtitle: "Split costs with your flatmates", cta: "Add expense" } },
    { type: "section", props: { title: "This month" }, children: [
      { type: "cardGrid", props: { cards: [{ title: "Total", value: "$420" }, { title: "You owe", value: "$70" }] } },
    ] },
    { type: "form", props: { fields: [{ label: "What", name: "title", type: "text" }, { label: "Amount", name: "amount", type: "number" }], submit: "add-expense" } },
    { type: "footer", props: { text: "On-device · yours" } },
  ] },
  collections: [{ name: "expenses", kind: "expense", fields: [{ name: "title", type: "string" }, { name: "amount", type: "number" }, { name: "at", type: "timestamp" }] }],
  capabilities: [{ collection: "expenses", ops: ["read", "write"] }],
  identity: "required",
};

console.log("\nholo-q app spec — intent → typed spec → the holo-apps bundle (κ)\n");

// ── 1) a valid spec compiles to the holo-apps bundle structure, content-addressed ─────────────────────────
const app = compileSpec(SPEC);
console.log("compile → manifest κ + reducer κ + projection κ + collections + capabilities:");
ok(/^[0-9a-f]{64}$/.test(app.manifestK) && app.kid.startsWith("did:holo:sha256:"), "the app has a manifest κ = its identity (CC-1/L1)");
ok(/^[0-9a-f]{64}$/.test(app.reducerK) && /^[0-9a-f]{64}$/.test(app.projectionK), "the manifest names a reducer κ and a projection κ");
ok(app.manifest.reducer === app.reducerK && app.manifest.projection === app.projectionK, "the manifest binds exactly those κs");
ok(sha256hex(jcs(app.manifest)) === app.manifestK, "the manifest κ re-derives from its content (L5)");
ok(app.collections.length === 1 && app.collections[0].genesisK, "each collection has a genesis (pins the reducer κ)");

// ── 2) the projection is BEAUTIFUL by construction + every element addressable ────────────────────────────
console.log("\nbeautiful by construction + addressable:");
ok(audit(app.projectionHtml).clean, "the projection audits CLEAN against the holo design spec (tokens, dark, viewport, a11y)");
ok(!/#[0-9a-fA-F]{6}\b/.test(app.projectionHtml.replace(/\/\*holo-tokens\*\/[\s\S]*?<\/style>/, "")), "no raw hex in the app — only --holo-* tokens");
ok(dag.verify(app.projectionDAG.store).ok, "the projection decomposes to a κ-DAG; every element re-derives (S2/L5)");
ok(dag.recompose(app.projectionDAG.root, app.projectionDAG.store) === app.projectionHtml, "the projection κ-DAG round-trips byte-identical");

// ── 3) conformance: capabilities only over declared collections; app never authors platform kinds ────────
console.log("\nholo-apps conformance (§2.9/§3, SEC-2):");
ok(app.capabilities.every((c) => app.collections.some((col) => col.name === c.collection)), "capabilities are only over DECLARED collections");
ok(!app.manifest.kinds.app.some((k) => PLATFORM_KINDS.includes(k)), "the app authors only its OWN kinds, never platform kinds (genesis/membership/epoch/tombstone)");
ok(app.manifest.kinds.platform.join() === PLATFORM_KINDS.join(), "platform kinds are declared as interpreted-uniformly");
ok(app.capabilities.every((c) => c.ops.every((o) => ["read", "write", "admin"].includes(o))), "capabilities use only valid, attenuate-able ops (SEC-2)");

// ── 4) RELIABILITY: a malformed spec is REPAIRED into a valid app (the weak-coder fix) ────────────────────
console.log("\nreliability — a malformed spec → a valid app, never broken pseudo-code:");
{
  const UGLY = {
    name: "Bad",
    ui: { type: "page", children: [{ type: "GiantBespokeWidget", props: {} }, { type: "hero", props: { title: "Still fine" } }] },   // unknown component
    collections: [{ name: "notes!!", kind: "note", fields: [{ name: "x", type: "weirdtype" }] }],
    capabilities: [{ collection: "does-not-exist", ops: ["write", "hack"] }, { collection: "notes", ops: ["read"] }],
  };
  const r = compileSpec(UGLY);
  ok(/^[0-9a-f]{64}$/.test(r.manifestK), "the malformed spec still compiles to a valid app κ");
  ok(audit(r.projectionHtml).clean && r.projectionHtml.includes("Still fine"), "the unknown component was repaired out; the rest renders clean");
  ok(r.report.some((x) => x.fix === "unknown-component") && r.report.some((x) => x.fix === "cap-dropped"), "the repairs are reported (unknown component dropped, bogus capability dropped)");
  ok(r.capabilities.length === 1 && r.capabilities[0].collection === "notes" && !r.capabilities[0].ops.includes("hack"), "the capability over a non-existent collection + the invalid op were stripped");
  ok(r.collections[0].fields[0].type === "string", "the invalid field type coerced to a safe default");
}

// ── 5) deterministic: same spec → same app κ ──────────────────────────────────────────────────────────────
console.log("\ndeterministic:");
ok(compileSpec(SPEC).manifestK === app.manifestK, "same spec → same manifest κ (re-derivable identity)");

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
