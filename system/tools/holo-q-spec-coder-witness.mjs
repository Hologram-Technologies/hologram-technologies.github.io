// holo-q-spec-coder-witness.mjs — proof that the coder emitting a TYPED SPEC (not free-form HTML) is reliable
// and unlocks the full stack: extraction is forgiving (clean/fenced/prose JSON → spec; garbage → null); the plan
// turns a model reply (string OR streamed deltas) into a spec; and end-to-end a spec-emitting model yields a
// CONFORMANT FULL-STACK app (UI + collections + capabilities from the spec), while a garbled model still yields a
// valid app (the self-fix fallback — never the pseudo-code we saw from raw HTML). Pure Node. Run: node …-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const { specPrompt, extractSpec, makePlan } = await imp("../os/usr/lib/holo/q/holo-q-spec-coder.mjs");
const { buildFromIntent } = await imp("../os/usr/lib/holo/q/holo-q-create-fullstack.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

const SPEC = { name: "Flat Expenses", ui: { type: "page", children: [{ type: "hero", props: { title: "Flat Expenses" } }] }, collections: [{ name: "expenses", kind: "expense", fields: [{ name: "title", type: "string" }] }], capabilities: [{ collection: "expenses", ops: ["read", "write"] }], identity: "required" };
const SPEC_JSON = JSON.stringify(SPEC);

console.log("\nholo-q spec coder — the model fills a typed spec; reliable + full-stack\n");

// ── 1) the prompt anchors the format with a few-shot ──────────────────────────────────────────────────────
console.log("the spec prompt:");
{
  const msgs = specPrompt("a blog");
  ok(msgs.length === 4 && msgs[0].role === "system" && /JSON object/.test(msgs[0].content), "system instruction demands one JSON object");
  ok(msgs[1].role === "user" && msgs[2].role === "assistant" && /"type":"page"/.test(msgs[2].content), "a worked few-shot example anchors the shape (the reliability lever)");
  ok(msgs[3].content.includes("a blog"), "the user's intent is the final turn");
}

// ── 2) forgiving extraction ───────────────────────────────────────────────────────────────────────────────
console.log("\nextraction is forgiving:");
ok(extractSpec(SPEC_JSON).name === "Flat Expenses", "clean JSON → spec");
ok(extractSpec("```json\n" + SPEC_JSON + "\n```").name === "Flat Expenses", "fenced JSON → spec");
ok(extractSpec("Sure! Here is the spec:\n" + SPEC_JSON + "\nHope that helps!").name === "Flat Expenses", "JSON wrapped in prose → spec (outermost {…} taken)");
ok(extractSpec("div.class = nope; Math.random()") === null, "pseudo-code / non-JSON → null (the agent falls back)");
ok(extractSpec("[1,2,3]") === null && extractSpec("") === null, "an array or empty reply → null");

// ── 3) the plan turns a model reply (string OR streamed deltas) into a spec ───────────────────────────────
console.log("\nthe plan (model → spec):");
{
  const planStr = makePlan(async () => SPEC_JSON);
  ok((await planStr("x")).name === "Flat Expenses", "a model returning a JSON string → a spec");
  const planStream = makePlan(async function* () { for (const c of (SPEC_JSON.match(/.{1,20}/gs) || [])) yield c; });
  ok((await planStream("x")).name === "Flat Expenses", "a model STREAMING deltas → collected + parsed into a spec");
  const planBad = makePlan(async () => "I cannot do that. <div>broken");
  ok((await planBad("x")) === null, "a garbled reply → null (no spec)");
}

// ── 4) END-TO-END: a spec-emitting model → a conformant FULL-STACK app (UI + data + caps) ──────────────────
console.log("\nend-to-end — a spec build is full-stack and conformant:");
{
  const generate = async () => SPEC_JSON;                       // the coder emits the spec
  const r = await buildFromIntent("a shared expense tracker", { generate, pricing: { expenses: { amount: 5 } } });
  ok(/^[0-9a-f]{64}$/.test(r.manifestK) && r.test.ok, "the spec compiled to a sealed app that PASSES every law check");
  ok(r.app.collections.length === 1 && r.app.capabilities.length === 1, "the app has DATA (a collection) + a capability — full-stack, not just UI");
  ok(r.api.routes.some((x) => x.path === "/expenses") && r.api.routes.some((x) => x.op === "purchase"), "REST + monetization were derived from the spec's capabilities");
  ok(r.projectionHtml.includes("Flat Expenses") && !/#[0-9a-fA-F]{6}\b/.test(r.projectionHtml.replace(/\/\*holo-tokens\*\/[\s\S]*?<\/style>/, "")), "the UI is beautiful by construction (token-only)");
}

// ── 5) RELIABILITY: a garbled model still yields a valid app (never broken pseudo-code) ───────────────────
console.log("\nreliability — a weak/garbled model never produces a broken app:");
{
  const junk = async () => "div.class='card'> img.src= Math.random()*5 ...";   // exactly the 1.5B failure mode
  const r = await buildFromIntent("a cats page", { generate: junk });
  ok(r.test.ok && /^[0-9a-f]{64}$/.test(r.manifestK), "a pseudo-code reply → the loop falls back to a VALID, sealed, law-passing app");
  ok(r.projectionHtml.includes("cats page"), "the fallback app is built from the intent (still useful)");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
