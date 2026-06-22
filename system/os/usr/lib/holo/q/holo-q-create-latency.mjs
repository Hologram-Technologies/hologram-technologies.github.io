// holo-q-create-latency.mjs — the low-latency Create path (S6): compose per-device tiering + the cascade +
// the streaming-safe renderer into ONE flow. A build paints an INSTANT template (0 bytes), then the fastest
// device-sized tier streams in token-by-token — every increment normalized to a SAFE renderable frame
// (holo-q-stream-render) so the app assembles smoothly — upgrading to the full coder when it lands. The tier
// set is chosen per device (holo-q-tier-plan) so a phone never waits on a desktop-sized model. Pure
// orchestration over the real modules → Node-witnessed; the browser throttles onFrame to rAF and mounts each
// frame (or diff-patches). This is the composition that turns "instant template then a 1.5GB wait" into
// "instant template → real build in ~1s → full fidelity," sized to the device.
//
//   planCodeTiers(device, tiers)                         -> planTiers() result for the code faculty
//   tiersFor(plan, samplers)                             -> ordered [{name, sampler, whenReady}]
//   streamRenderBuild({ template, prompt, tiers, onFrame, signal, maxTokens }) -> { stats }

import { planTiers } from "./holo-q-tier-plan.mjs";
import { tiersFromPlan } from "./holo-q-codegen-cascade.mjs";
import { streamSafeDocument } from "./holo-q-stream-render.mjs";
import { buildMessages, extractHTML } from "./holo-q-codegen.js";

export const planCodeTiers = (device, tiers) => planTiers({ device, tiers });
export const tiersFor = (plan, samplers) => tiersFromPlan(plan, samplers);

export async function streamRenderBuild({ template = null, prompt = "", current = null, tiers = [], onFrame = null, signal = null, maxTokens = 4096 } = {}) {
  const aborted = () => !!(signal && signal.aborted);
  const stats = { frames: 0, byTier: {}, order: [], firstTier: null, finalTier: null };
  const frame = (html, tier) => {
    stats.frames++; stats.byTier[tier] = (stats.byTier[tier] || 0) + 1;
    if (stats.firstTier == null) stats.firstTier = tier;
    if (stats.order[stats.order.length - 1] !== tier) stats.order.push(tier);
    stats.finalTier = tier;
    if (onFrame) { try { onFrame(streamSafeDocument(html), { tier, instant: tier === "template" }); } catch (e) {} }   // every frame is SAFE to mount
  };

  // 0) instant template floor — 0 bytes, paints immediately (the first thing the user sees).
  if (template) { let f = ""; try { f = template(prompt, current) || ""; } catch (e) { f = ""; } if (f) frame(f, "template"); }

  // 1) each device-planned tier, streamed token-by-token → a safe frame per increment (smooth assembly).
  const messages = buildMessages(prompt, current);
  for (const t of tiers) {
    if (aborted()) break;
    if (!t || typeof t.sampler !== "function") continue;
    if (typeof t.whenReady === "function") { try { await t.whenReady(); } catch (e) { continue; } }   // load the tier (draft fast, target slow) — the user keeps the best frame meanwhile
    if (aborted()) break;
    let raw = "", started = false, lastFrame = "";
    try {
      for await (const d of t.sampler(messages, { maxTokens, signal })) {
        if (aborted()) break;
        raw += (d && d.delta != null ? d.delta : d);
        const partial = extractHTML(raw) || raw;
        if (partial && partial !== lastFrame) { lastFrame = partial; frame(partial, t.name); }
        started = true;
      }
    } catch (e) { if (!started) continue; }
  }
  return { stats };
}

export default { planCodeTiers, tiersFor, streamRenderBuild };
