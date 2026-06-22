// holo-devtools-kappa-lens-witness.mjs — Stage A6 proof (#holo-devtools-app): the κ-lens exposes EVERY κ-object a
// holo-app holds (manifest · reducer · projection elements · collections · capabilities · REST/MCP), each
// inspectable (resolve + verify, L5) and controllable through a GOVERNED descriptor only (edit→new κ, data→a
// proposal §2.9, capability→an attenuated grant SEC-2) — never an autonomous write; a tampered block is REFUSED
// (red). Composes the REAL full-stack builder. Pure Node. Run: node holo-devtools-kappa-lens-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const { lensFor, inspectKappa } = await imp("../os/usr/lib/holo/devtools/holo-devtools-kappa-lens.mjs");
const { buildFullStackApp } = await imp("../os/usr/lib/holo/q/holo-q-app-agent.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

const plan = async () => ({ name: "Flat Expenses", identity: "required", ui: { type: "page", children: [{ type: "hero", props: { title: "Flat Expenses" } }, { type: "form", props: { fields: [{ label: "What", name: "title", type: "text" }], submit: "add" } }] }, collections: [{ name: "expenses", kind: "expense", fields: [{ name: "title", type: "string" }] }], capabilities: [{ collection: "expenses", ops: ["read", "write"] }] });
const build = await buildFullStackApp("a shared expense tracker", { plan, pricing: { expenses: { amount: 5 } } });
const lens = lensFor(build);

console.log("\nholo-devtools κ-lens — every κ-object inspectable + governed (#holo-devtools-app)\n");

// ── 1) the lens exposes EVERY group of κ-object ───────────────────────────────────────────────────────────
console.log("the lens covers the whole app:");
{
  const groups = new Set(lens.objects.map((o) => o.group));
  ok(["manifest", "reducer", "projection", "collection", "capability", "rest", "mcp"].every((g) => groups.has(g)), "manifest · reducer · projection · collection · capability · REST · MCP are all exposed");
  ok(lens.objects.some((o) => o.group === "manifest" && o.kappa === build.manifestK), "the manifest κ is the app identity");
  ok(lens.objects.filter((o) => o.group === "projection").length > 0, "every projection ELEMENT is a κ-object (the UI κ-DAG)");
  ok(lens.objects.some((o) => o.group === "collection" && o.name === "expenses"), "the data collection is exposed");
  ok(lens.objects.some((o) => o.group === "rest" && o.path === "/expenses/access"), "the derived REST surface (incl. the priced route) is exposed");
}

// ── 2) every inspectable κ-object RE-DERIVES (L5) ─────────────────────────────────────────────────────────
console.log("\nread-through-κ — every object verifies (L5):");
{
  const inspectables = lens.objects.filter((o) => o.kappa);
  ok(inspectables.length > 0 && inspectables.every((o) => o.verified === true), `all ${inspectables.length} κ-objects re-derive to their κ (verified)`);
  ok(inspectables.every((o) => o.kid && o.kid.startsWith("did:holo:sha256:")), "each carries its did:holo identity");
}

// ── 3) a tampered block is REFUSED on inspect (red), missing fails loudly ─────────────────────────────────
console.log("\ntamper-refuse (SEC-1/L5 — the verify badge goes red):");
{
  const k = build.manifestK, store = build.sealed.store;
  ok(inspectKappa(k, store).verified === true, "a valid κ inspects + verifies");
  const bad = Object.assign({}, store); bad[k] = bad[k].replace("Flat Expenses", "EVIL");
  let refused = false; try { inspectKappa(k, bad); } catch (e) { refused = /L5 REFUSE/.test(e.message); }
  ok(refused, "a tampered block is REFUSED on inspect (does not re-derive)");
  let missed = false; try { inspectKappa("deadbeef", store); } catch (e) { missed = /MISSING/.test(e.message); }
  ok(missed, "a missing κ fails loudly (never silently trusted)");
}

// ── 4) control is GOVERNED only — never an autonomous write ───────────────────────────────────────────────
console.log("\ncontrol is governed (no autonomous writes):");
{
  const el = lens.objects.find((o) => o.group === "projection");
  ok(el.control && el.control.kind === "editAtPath", "a projection element's control is editAtPath (→ a new κ + prov)");
  const data = lens.objects.find((o) => o.group === "collection");
  ok(data.control && data.control.kind === "propose", "a collection's control is a PROPOSAL (§2.9) — never an autonomous write");
  const cap = lens.objects.find((o) => o.group === "capability");
  ok(cap.control && cap.control.kind === "grant", "a capability's control is an attenuate-only grant (SEC-2)");
  ok(lens.objects.filter((o) => o.group === "rest" || o.group === "mcp").every((o) => !o.control), "REST/MCP entries are read surfaces here (mutation rides the data/capability path, not a raw call)");
}

// ── 5) capability-scoped: only the app's DECLARED collections appear ──────────────────────────────────────
console.log("\ncapability-scoped:");
ok(lens.objects.filter((o) => o.group === "capability").every((c) => lens.objects.some((o) => o.group === "collection" && o.name === c.collection)), "every exposed capability is over a DECLARED collection (no ambient authority)");

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
