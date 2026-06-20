// holo-q-codegen.js — the generative seam behind Create mode's "build anything" (ADR-0087 / a Lovable-
// style prompt→app loop on the substrate's terms). It turns a plain-English prompt into ONE complete,
// self-contained, content-addressed holospace (a single HTML document), routed through a HYBRID of
// tiers so quality scales without ever lying about which model ran:
//
//   BOOST    — an opt-in bridge to a frontier model (a network call; best quality). Off unless set.
//   DEVICE   — the on-device model (Qwen2.5 via the vendored transformers.js / Holo Voice LLM seam):
//              serverless + private, streamed; bounded quality (components/simple apps).
//   TEMPLATE — the deterministic floor (instant, no model): always works, the zero-latency baseline.
//
// Conversational ITERATION is edit-the-already-created (the trinity precedence, ADR-0086/0087): a refine
// prompt carries the CURRENT document as context, so the model edits the existing κ-object rather than
// re-creating from scratch. Pure controller — the model samplers are INJECTED, so the routing/prompt/
// extraction are witnessed in Node; the heavy model load happens only when a real build is requested.

// ── the codegen prompt (build + edit) ────────────────────────────────────────────────────────────
const SYS = "You are Holo, an expert front-end engineer. Output ONLY one complete, self-contained HTML5 "
  + "document: a DOCTYPE, inline <style> and <script>, NO external resources, NO markdown code fences, NO "
  + "explanation before or after. Make it polished, responsive, accessible, and dark-themed by default.";
export function buildMessages(prompt, current) {
  const sys = { role: "system", content: SYS };
  if (current && String(current).trim()) {
    return [sys, { role: "user", content: "Here is the current document:\n\n" + current + "\n\nApply this change and return the FULL updated document:\n" + prompt }];
  }
  return [sys, { role: "user", content: "Build this as a single HTML document:\n" + prompt }];
}

// extractHTML(text) — pull the HTML doc out of a model reply (strip stray prose / ``` fences). Robust to
// a model that wraps or chatters; returns "" if there is no markup (caller falls to the template floor).
export function extractHTML(text) {
  let s = String(text || "");
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1];
  const m = s.match(/<!doctype html|<html[\s>]|<(?:meta|style|div|section|main|body|h1|svg)[\s>]/i);
  if (m) s = s.slice(s.indexOf(m[0]));
  s = s.trim();
  return /<[a-z!][\s\S]*>/i.test(s) ? s : "";
}

// createCodegen({ device, boost }) — `device`/`boost` are samplers: (messages, opts) → async-iterable of
// token-text deltas (the Holo Voice LLM's generate() shape; a boost bridge implements the same).
export function createCodegen({ device = null, boost = null, maxTokens = 2048 } = {}) {
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  // generate({ prompt, current?, boost?, onToken?, signal? }) → { source, mode, ms } | null.
  // mode ∈ "boost" | "device". Returns null when no model is available (caller uses the template floor).
  async function generate({ prompt, current = null, boost: wantBoost = false, onToken = null, signal = null } = {}) {
    const sampler = (wantBoost && boost) ? boost : device;
    const mode = (wantBoost && boost) ? "boost" : "device";
    if (!sampler) return null;
    const messages = buildMessages(prompt, current);
    const t0 = now(); let raw = "";
    for await (const d of sampler(messages, { maxTokens, signal })) {
      if (signal && signal.aborted) break;
      // a tiered/cascade sampler hands us { replace } when a better tier takes over → its full doc REPLACES the
      // prior tier's (blurry→sharp); a plain sampler only ever yields deltas, so this is a no-op for it.
      if (d && typeof d === "object" && d.replace != null) raw = String(d.replace);   // typeof guard: a STRING delta has a .replace method too
      else raw += (d && d.delta != null ? d.delta : d);
      if (onToken) { try { onToken(extractHTML(raw) || raw, raw); } catch (e) {} }
    }
    const source = extractHTML(raw);
    return { source, mode, ms: +(now() - t0).toFixed(1), raw };
  }

  return {
    generate, buildMessages, extractHTML,
    has: (tier) => tier === "boost" ? !!boost : tier === "device" ? !!device : true,
    describe: () => ({
      tiers: "boost (frontier · network · opt-in) → device (on-device Qwen2.5 · serverless · streamed) → template (instant floor)",
      iteration: "a refine prompt carries the current document → the model EDITS the existing κ-object (create-then-edit)",
      output: "ONE self-contained HTML doc → a content-addressed holospace you own (editable code, serverless delivery)",
      honest: "labels which tier ran every build; the on-device tier is bounded (components/simple apps), frontier needs the boost",
    }),
  };
}

// bindVoiceModel({ enginePath?, models? }) → a DEVICE sampler backed by the vendored on-device LLM
// (Holo Voice LLM / Qwen2.5 via transformers.js). Lazy: the model loads on the first real build.
export async function bindVoiceModel(opts = {}) {
  const mod = await import(/* @vite-ignore */ (opts.modulePath || "../voice/holo-voice-llm.mjs"));
  const create = mod.createLLM || mod.default;
  const llm = create(opts.llm || {});
  // expose the streaming sampler in the codegen shape; load progress flows through opts.onProgress.
  const sampler = (messages, o = {}) => llm.generate(messages, { maxTokens: o.maxTokens, signal: o.signal, onProgress: opts.onProgress });
  sampler.load = (onProgress) => llm.load(onProgress);
  sampler.info = () => llm.info();
  return sampler;
}

export default { buildMessages, extractHTML, createCodegen, bindVoiceModel };
