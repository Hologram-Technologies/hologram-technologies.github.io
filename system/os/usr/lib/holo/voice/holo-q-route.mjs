// holo-q-route.mjs — route an utterance through the REAL Holo Q mux faculties (Mixture-of-Specialists),
// instead of one flat brain. It mounts the OS's own core brains (respond = the general text model, code =
// the coder) into holo-q-mux as lazy, readiness-gated providers, classifies the utterance into a faculty,
// and streams from the active brain for that faculty via the canonical resolver (holo-q-active).
//
// The honest behaviour, straight from the mux design:
//   • a faculty's brain lazy-loads its κ-disk only on first use (nothing warm at boot);
//   • until the coder is loaded, a `code` query is answered by the text brain and silently UPGRADES to the
//     coder the moment it's ready (facultySampler re-resolves per call) — never blocks, never fakes (L5);
//   • if the mux/brains can't load at all, createQRouter() still works on the text brain alone.
//
// WASM, not WebGPU: the q8 LLM decoder hits an ORT WebGPU kernel bug on this stack (verified gibberish) —
// so the brains run on the any-browser WASM floor (slower, correct). Revisit WebGPU when the kernel is fixed.
//
//   const r = createQRouter();   // mounts the core brains (lazy)
//   const { text, faculty, model } = await r.ask("fix this regex", { messages, onDelta, signal });

import mux from "../q/holo-q-mux.js";
import { mountCoreBrains } from "../q/holo-q-corebrains.mjs";
import { facultySampler, resolveActive, describeActive } from "../q/holo-q-active.mjs";
import { createLLM } from "./holo-voice-llm.mjs";

// ── faculty classifier — distinctive technical signals → the `code` faculty; everything else → `respond`.
// Conservative on purpose: a misroute to the coder only costs latency, but we don't want every "go to the
// store" pulling the 1.5B coder, so we key on distinctive terms / a coding ACTION on a code noun.
const CODE_RE = /\b(python|javascript|typescript|golang|rust|kotlin|swift|regex|sql|html|css|json|yaml|refactor|debug|compile|compiler|syntax\s*error|stack\s*trace|exception|traceback|algorithm|recursion|big-?o|leetcode|npm|pip|cargo|git\s+(commit|rebase|merge|diff)|def\s|\bclass\b|\bfunction\b|\basync\b|endpoint)\b/i;
const CODE_VERB = /\b(write|create|fix|debug|refactor|implement|optimi[sz]e|review|explain|generate|port)\b[^.?!]{0,40}\b(code|function|script|program|class|method|module|component|query|regex|api|bug|error|snippet)\b/i;
export function classifyFaculty(text) {
  const t = String(text || "");
  if (CODE_VERB.test(t) || CODE_RE.test(t)) return "code";
  return "respond";
}

export function createQRouter(opts = {}) {
  opts = opts || {};
  const onProgress = opts.onProgress || null;
  // the OS's own brains as the faculty providers (WASM floor). makeCode = the vendored Coder-1.5B (the
  // pinned coder is 3B — too heavy for a phone; 1.5B is the mobile-right coder, with the 0.5B as its floor).
  const makeText = () => createLLM({ wasm: { model: "onnx-community/Qwen2.5-0.5B-Instruct", dtype: "q8" }, wasmFallback: { model: "onnx-community/Qwen2.5-0.5B-Instruct", dtype: "q8" }, preferWebGPU: false, maxTokens: 160 });
  const makeCode = () => createLLM({ wasm: { model: "onnx-community/Qwen2.5-Coder-1.5B-Instruct", dtype: "q8" }, wasmFallback: { model: "onnx-community/Qwen2.5-0.5B-Instruct", dtype: "q8" }, preferWebGPU: false, maxTokens: 320 });
  // hasGPU gates whether the `code` faculty BINDS at all; we run it on WASM, so bind it (unless caller opts
  // out). Until the coder is ready, `code` resolves through the chain to the text brain.
  let mounted = null; try { mounted = mountCoreBrains(mux, { makeText, makeCode, hasGPU: opts.code !== false, onProgress }); } catch (e) { mounted = null; }

  // a faculty-appropriate system prompt is injected when the caller didn't supply one (so a code answer
  // isn't squeezed by a "one sentence" chat persona).
  const SYS = {
    respond: "You are Q, the on-device assistant for Hologram OS. You run entirely on this device — private, no servers. Answer warmly and concisely — a sentence or two, plain prose, no markdown or lists unless asked. If you don't know, say so plainly.",
    code: "You are Q's coding specialist, running entirely on-device. Write correct, complete, idiomatic code in a single fenced code block, then one or two lines explaining it. Be precise; don't pad.",
  };
  const samplers = {};
  const samplerFor = (task) => samplers[task] || (samplers[task] = facultySampler(mux, task));

  // wait until SOME brain in the faculty's chain is runnable (cold start), kicking the lazy loads. Capped so
  // a wedged load can't hang forever — past the cap we try anyway (generate() also awaits its own load).
  async function awaitReady(task, signal, capMs) {
    const t0 = Date.now();
    while (true) {
      let r; try { r = resolveActive(mux, task); } catch (e) { r = { runnable: false }; }
      if (r.runnable) return true;
      if (signal && signal.aborted) return false;
      if (Date.now() - t0 > (capMs || 90000)) return false;
      try { const p = mux.routeTask(task); if (p && p.kick) p.kick(); const pr = mux.routeTask("respond"); if (pr && pr.kick) pr.kick(); } catch (e) {}
      await new Promise((res) => setTimeout(res, 200));
    }
  }

  async function ask(text, o = {}) {
    const task = classifyFaculty(text);
    let messages = o.messages || [{ role: "user", content: String(text || "") }];
    if (!messages.length || messages[0].role !== "system") messages = [{ role: "system", content: SYS[task] || SYS.respond }].concat(messages);
    await awaitReady(task, o.signal, o.capMs);
    const sampler = samplerFor(task);
    let acc = "";
    try {
      for await (const d of sampler(messages, { maxTokens: o.maxTokens || (task === "code" ? 320 : 160), signal: o.signal })) {
        acc += d; if (o.onDelta) { try { o.onDelta(acc.trim()); } catch (e) {} }
      }
    } catch (e) { /* stream error → return whatever we have */ }
    let model = null; try { model = describeActive(mux, task); } catch (e) {}
    return { text: acc.trim(), faculty: task, model };
  }

  return { ask, faculty: classifyFaculty, mounted, describe: function () { try { return mux.describeMux(); } catch (e) { return null; } } };
}

export default createQRouter;
