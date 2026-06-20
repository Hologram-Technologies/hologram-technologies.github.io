// holo-q-codegen-cascade-witness.mjs — re-derivable proof that Create's build is PROGRESSIVE and device-aware:
// an instant template, then the fastest-resident coder, upgrading to the full coder when it lands — each a
// complete document that replaces the last (blurry→sharp) — and the tier set is chosen per device so a phone
// never waits on a desktop-sized model. Pure Node, mock samplers + planTiers — no GPU. Reuses the real
// extractHTML so the docs are validated exactly as in production. Run: node holo-q-codegen-cascade-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const { createTieredCodegen, tiersFromPlan, createCascadeSampler } = await imp("../os/usr/lib/holo/q/holo-q-codegen-cascade.mjs");
const { planTiers } = await imp("../os/usr/lib/holo/q/holo-q-tier-plan.mjs");
const { createCodegen } = await imp("../os/usr/lib/holo/q/holo-q-codegen.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

// a mock streaming coder: yields its doc in a few deltas (so we exercise live block-level emission).
const mkSampler = (doc, whenReadyMs = 0) => {
  let resolved = whenReadyMs === 0;
  const sampler = async function* () { const parts = doc.match(/.{1,12}/gs) || [doc]; for (const p of parts) yield p; };
  return { sampler, whenReady: async () => { resolved = true; }, _isReady: () => resolved };
};
const TEMPLATE = (prompt) => `<main><h1>${prompt}</h1><p>template floor</p></main>`;
const DRAFT_DOC  = "<!doctype html><html><body><section>draft build</section></body></html>";
const TARGET_DOC = "<!doctype html><html><body><main>full coder build</main></body></html>";

console.log("\nholo-q codegen cascade — progressive, device-aware Create build\n");

// ── 1) progression: template → draft → target, each a full doc replacing the last ─────────────────────────
console.log("progression (template → fast draft → full coder), best upgrades each tier:");
{
  const docs = [];
  const cg = createTieredCodegen({
    template: TEMPLATE,
    tiers: [
      { name: "draft:tiny",  sampler: mkSampler(DRAFT_DOC).sampler,  whenReady: async () => {} },
      { name: "target:coder", sampler: mkSampler(TARGET_DOC).sampler, whenReady: async () => {} },
    ],
  });
  const r = await cg.generate({ prompt: "a pricing card", onDoc: (doc, tier) => docs.push({ tier, doc }) });
  const tiersSeen = docs.map((d) => d.tier.split(":")[0]);
  ok(tiersSeen[0] === "template", "the FIRST document emitted is the instant template (no model wait)");
  ok(tiersSeen.includes("draft") && tiersSeen.lastIndexOf("draft") < tiersSeen.lastIndexOf("target"), "draft output appears BEFORE the full coder output");
  ok(r.source === "full coder build" || r.source.includes("full coder"), "the final best document is the full coder's build");
  ok(r.tier === "target:coder", "the winning tier is reported honestly (target:coder)");
}

// ── 2) instant: the template is emitted before any tier's model is awaited ─────────────────────────────────
console.log("\ninstant first paint: template emitted before the (slow) coder is ready:");
{
  const order = [];
  let coderLoaded = false;
  const slowTarget = { sampler: (async function* () { yield TARGET_DOC; })(), whenReady: async () => { coderLoaded = true; } };
  const cg = createTieredCodegen({
    template: TEMPLATE,
    tiers: [{ name: "target:coder", sampler: async function* () { yield TARGET_DOC; }, whenReady: async () => { coderLoaded = true; } }],
  });
  await cg.generate({ prompt: "x", onDoc: (doc, tier) => order.push({ tier: tier.split(":")[0], coderLoaded }) });
  ok(order[0].tier === "template" && order[0].coderLoaded === false, "template renders while the coder is still loading (instant, no 1.5GB wait)");
}

// ── 3) device-aware: the tier set differs phone vs desktop (planTiers → tiersFromPlan) ────────────────────
console.log("\ndevice-aware tiering via planTiers → tiersFromPlan:");
{
  const TIERS = { draft: { id: "draft-tiny", bytesMB: 8 }, lowbit: { id: "ternary", bytesMB: 160 }, instant: { id: "coder-1.5b", bytesMB: 1500 }, upgrade: { id: "coder-7b", bytesMB: 3200 } };
  const samplers = { "draft-tiny": () => (async function* () { yield DRAFT_DOC; })(), "ternary": () => (async function* () { yield TARGET_DOC; })(), "coder-1.5b": () => (async function* () { yield TARGET_DOC; })(), "coder-7b": () => (async function* () { yield TARGET_DOC; })() };
  const desk = tiersFromPlan(planTiers({ device: { memoryGB: 16, webgpu: true, downlinkMbps: 100 }, tiers: TIERS }), samplers);
  const phone = tiersFromPlan(planTiers({ device: { memoryGB: 3, webgpu: false, downlinkMbps: 2, saveData: true, mobile: true }, tiers: TIERS }), samplers);
  ok(desk.some((t) => t.name.includes("coder-1.5b")) , "desktop plan → full coder target tier");
  ok(phone.some((t) => t.name.includes("ternary")) && !phone.some((t) => t.name.includes("coder-7b")), "phone plan → small low-bit target, NO heavy 7B (right bytes per device)");
  ok(phone.some((t) => t.name.startsWith("draft")), "phone plan leads with the draft (instant-first where it matters most)");
}

// ── 4) fallback + abort: a failing tier keeps the best-so-far; abort stops cleanly ────────────────────────
console.log("\nresilience: failing tier keeps best-so-far; abort stops:");
{
  const docs = [];
  const cg = createTieredCodegen({
    template: TEMPLATE,
    tiers: [
      { name: "draft:tiny", sampler: mkSampler(DRAFT_DOC).sampler, whenReady: async () => {} },
      { name: "target:coder", sampler: async function* () { throw new Error("coder OOM"); }, whenReady: async () => {} },
    ],
  });
  const r = await cg.generate({ prompt: "y", onDoc: (doc, tier) => docs.push(tier) });
  ok(r.source.includes("draft build"), "full coder failed → the draft build stands (never a blank screen)");

  const docs2 = [];
  const cg2 = createTieredCodegen({ template: TEMPLATE, tiers: [{ name: "draft:tiny", sampler: mkSampler(DRAFT_DOC).sampler, whenReady: async () => {} }] });
  const r2 = await cg2.generate({ prompt: "z", signal: { aborted: true }, onDoc: (doc, tier) => docs2.push(tier) });
  ok(docs2.length === 0 || (docs2.length === 1 && docs2[0] === "template"), "aborted build emits at most the instant template, no model run");
}

// ── 5) THE WIRE: createCascadeSampler as `device` through the REAL createCodegen (minimal shell change) ────
console.log("\nthe actual wire — cascade sampler as `device` in the real createCodegen:");
{
  // tier samplers in the holo-q-codegen `device` shape: yield text deltas. draft ready now; target after a tick.
  const draftSampler = async function* () { for (const p of (DRAFT_DOC.match(/.{1,16}/gs) || [])) yield p; };
  let targetReady = false;
  const targetSampler = async function* () { for (const p of (TARGET_DOC.match(/.{1,16}/gs) || [])) yield p; };
  const device = createCascadeSampler({ tiers: [
    { name: "draft", sampler: draftSampler, whenReady: async () => {} },
    { name: "target", sampler: targetSampler, whenReady: async () => { targetReady = true; } },
  ] });
  const cg = createCodegen({ device });
  const seen = [];
  const r = await cg.generate({ prompt: "a todo app", onToken: (html) => seen.push(html) });
  ok(r.source === TARGET_DOC, "createCodegen final source == the full coder doc (the {replace} reset worked — not concatenated)");
  ok(seen.some((h) => h.includes("draft build")), "the DRAFT build was shown live before the coder finished (no 1.5GB wait)");
  ok(seen[seen.length - 1].includes("full coder build") && !seen[seen.length - 1].includes("draft build"), "final render is the clean coder doc, draft fully replaced");
}

// ── 6) the wire degrades safely: target throws before producing → the draft build stands ──────────────────
console.log("\nthe wire is fail-safe: a dead coder leaves the draft build on screen:");
{
  const draftSampler = async function* () { yield DRAFT_DOC; };
  const device = createCascadeSampler({ tiers: [
    { name: "draft", sampler: draftSampler, whenReady: async () => {} },
    { name: "target", sampler: async function* () { throw new Error("coder failed to load"); }, whenReady: async () => {} },
  ] });
  const r = await createCodegen({ device }).generate({ prompt: "x" });
  ok(r.source === DRAFT_DOC, "coder dies → the draft build remains the result (never a blank screen)");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
