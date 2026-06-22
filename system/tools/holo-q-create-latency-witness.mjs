// holo-q-create-latency-witness.mjs — re-derivable proof of the low-latency Create path (S6 composition): an
// INSTANT template frame first (0-byte first paint), then the device-planned tiers streamed token-by-token with
// every increment a SAFE renderable frame (smooth assembly), upgrading draft→coder; the tier set is device-sized
// (phone gets the small/low-bit target, no heavy 7B). Composes the REAL tier-plan + cascade + stream-render.
// Pure Node, mock samplers. Run: node holo-q-create-latency-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const { planCodeTiers, tiersFor, streamRenderBuild } = await imp("../os/usr/lib/holo/q/holo-q-create-latency.mjs");
const { tagStructure, visibleText } = await imp("../os/usr/lib/holo/q/holo-q-stream-render.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

const TEMPLATE = (p) => `<main><h1>${p}</h1><p>setting up…</p></main>`;
const DRAFT_DOC = "<!doctype html><html><body><section>draft layout</section></body></html>";
const TARGET_DOC = "<!doctype html><html><body><main>full coder build</main></body></html>";
const mkSampler = (doc) => async function* () { for (const c of (doc.match(/.{1,9}/gs) || [])) yield c; };   // stream in small chunks

const MODEL_TIERS = { draft: { id: "draft-0.5b", bytesMB: 8 }, lowbit: { id: "coder-ternary", bytesMB: 160 }, instant: { id: "coder-1.5b", bytesMB: 1500 }, upgrade: { id: "coder-7b", bytesMB: 3200 } };
const SAMPLERS = { "draft-0.5b": () => mkSampler(DRAFT_DOC)(), "coder-ternary": () => mkSampler(TARGET_DOC)(), "coder-1.5b": () => mkSampler(TARGET_DOC)(), "coder-7b": () => mkSampler(TARGET_DOC)() };

console.log("\nholo-q Create latency — instant template → smooth draft → full coder, device-sized\n");

// ── 1) desktop: template first, then draft, then full coder; every frame is SAFE ──────────────────────────
console.log("desktop build path (instant template → draft → coder), every frame mountable:");
{
  const plan = planCodeTiers({ memoryGB: 16, webgpu: true, downlinkMbps: 100 }, MODEL_TIERS);
  const tiers = tiersFor(plan, SAMPLERS);
  const frames = [];
  const { stats } = await streamRenderBuild({ template: TEMPLATE, prompt: "a pricing page", tiers, onFrame: (html, meta) => frames.push({ html, meta }) });
  ok(frames[0].meta.tier === "template" && frames[0].meta.instant, "the FIRST frame is the instant template (0-byte first paint)");
  ok(stats.order[0] === "template" && stats.order.some((t) => /draft/.test(t)) && stats.order[stats.order.length - 1].includes("coder"), "frame order: template → draft → coder (progressive)");
  ok(frames.every((f) => tagStructure(f.html).balanced), "EVERY emitted frame is a balanced, mountable doc (preview never corrupts)");
  ok(frames.length > 3, "the build streamed many incremental frames (smooth, not one chunk)");
  ok(/full coder build/.test(frames[frames.length - 1].html), "the final frame is the full coder build");
}

// ── 2) monotonic: content only accrues across frames (no flicker/regress) ─────────────────────────────────
console.log("\nsmooth: visible content grows monotonically within a tier:");
{
  const tiers = tiersFor(planCodeTiers({ memoryGB: 16, webgpu: true }, MODEL_TIERS), SAMPLERS);
  const seq = [];
  await streamRenderBuild({ template: TEMPLATE, prompt: "x", tiers, onFrame: (html, meta) => { if (meta.tier !== "template") seq.push({ tier: meta.tier, text: visibleText(html) }); } });
  // monotonic WITHIN a tier; a draft→coder boundary legitimately resets (the {replace} upgrade, blurry→sharp).
  let mono = true; for (let i = 1; i < seq.length; i++) { if (seq[i].tier === seq[i - 1].tier && seq[i].text.length + 4 < seq[i - 1].text.length) { mono = false; break; } }
  ok(mono, "within a tier, each frame's visible text never sharply regresses (smooth blurry→sharp; a tier upgrade may reset)");
}

// ── 3) device-sized: a phone gets the small target, NO heavy 7B ───────────────────────────────────────────
console.log("\ndevice-sized tiers (a phone never waits on a desktop-sized model):");
{
  const phone = planCodeTiers({ memoryGB: 3, webgpu: false, downlinkMbps: 2, saveData: true, mobile: true }, MODEL_TIERS);
  const tphone = tiersFor(phone, SAMPLERS);
  const names = tphone.map((t) => t.name);
  ok(names.some((n) => n.includes("coder-ternary")) && !names.some((n) => n.includes("coder-7b")), "phone → small low-bit coder target, NO 7B");
  ok(names.some((n) => n.startsWith("draft")), "phone leads with the draft tier (instant-first where it matters)");
  const deskPlan = planCodeTiers({ memoryGB: 32, webgpu: true, downlinkMbps: 300 }, MODEL_TIERS);
  const desk = tiersFor(deskPlan, SAMPLERS);
  ok(desk.some((t) => t.name.includes("coder-1.5b")), "desktop → the full coder target");
  ok(phone.residentMB <= phone.budgetMB && deskPlan.residentMB <= deskPlan.budgetMB, "both stay within the device byte budget (never OOM)");
}

// ── 4) abort stops cleanly after the instant template ─────────────────────────────────────────────────────
console.log("\nabort:");
{
  const tiers = tiersFor(planCodeTiers({ memoryGB: 16, webgpu: true }, MODEL_TIERS), SAMPLERS);
  const frames = [];
  await streamRenderBuild({ template: TEMPLATE, prompt: "y", tiers, signal: { aborted: true }, onFrame: (h, m) => frames.push(m.tier) });
  ok(frames.length <= 1 && (frames.length === 0 || frames[0] === "template"), "an aborted build emits at most the instant template, no model streaming");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
