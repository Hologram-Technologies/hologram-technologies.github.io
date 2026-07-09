// core/q-brain-fast.mjs — Q's FAST on-device brain, drop-in for createHoloModelBrain.
//
// Same provider shape (load · generate → text-delta async-iterator · chat · info · setSkill), so
// holo-q-contact.mjs's makeQResponder / makeQGroupResponder bind it with ZERO changes: Q rides the exact
// stream→finalize pipeline, it just sources its bytes from THIS engine (core/loader + core/engine — the
// native-ternary κ-object path with the fixed incremental-detok decode) instead of the qwen holo-brain.
//
// Why this exists: the messenger's default brain (qwen2.5-0.5b via holo-brain-engine) is heavy and its
// app-path decode was O(n²). This one loads a native-ternary BitNet κ-object (0.69 GB, verified per-block),
// decodes at ~70 tok/s warm, and streams byte-identical incremental text. It is 100% on-device at decode
// time — only a ONE-TIME tokenizer-header Range fetch touches the source host at load (the weights are the
// local, L5-verified b/<κ>.gz blocks). Bundle the header to make load fully egress-free (follow-up).
//
// URL discipline (the one gotcha): core/loader's MODELS use a PAGE-relative kappaUrl ("./models/<name>"),
// which is wrong from any page other than /apps/q/. loadKappaObject resolves the manifest, blocks AND the
// bundled tokenizer relative to its baseUrl, so we override kappaUrl to an ABSOLUTE mount ("/apps/q/models/
// <name>") — that makes the whole load self-contained from the messenger (or anywhere).

import { ready, loadModel, MODELS } from "./loader.js";
import { createEngine } from "./engine.js";
import { selfFacts, selfPersona, selfIntro } from "./q-self.mjs";   // Q's live, grounded self-knowledge (M0)

// The default fast brain = BitNet-2B (native ternary, llama3 template, coherent — Falcon-E degenerates).
// Override via opts.family / opts.modelName. kappaBase is the absolute mount core/loader's models live under.
const DEFAULTS = { family: "BitNet", kappaBase: "/apps/q/models", maxTokens: 512 };

function pickModel(cfg) {
  const want = String(cfg.modelName || cfg.family || "BitNet").toLowerCase();
  const m = MODELS.find((x) => (x.fam || "").toLowerCase() === want || (x.name || "").toLowerCase().includes(want)) || MODELS.find((x) => (x.fam || "").toLowerCase() === "bitnet");
  if (!m) throw new Error("q-brain-fast: no model matches " + want);
  // An ABSOLUTE host URL (the κ-object now lives on HF, not on this machine) is already page-independent —
  // use it verbatim. Only a page-relative "./models/<name>" needs absolute-mounting so it resolves from ANY page.
  if (/^https?:\/\//.test(m.kappaUrl || "")) return { ...m };
  const rel = String(m.kappaUrl || "").replace(/^\.?\//, "").replace(/^models\//, "");   // "./models/bitnet-2b" → "bitnet-2b"
  return { ...m, kappaUrl: String(cfg.kappaBase).replace(/\/+$/, "") + "/" + rel };
}

// Render an [{role,content}] history (system + turns, as makeQResponder builds it) to the model's chat
// template — the multi-turn generalization of core/engine's single-turn frameTurn. Covers the templates
// the engine knows; unknown families fall back to a persona-led last-user Q/A frame.
export function frameHistory(M, history) {
  const list = Array.isArray(history) ? history : [];
  // merge ALL system turns into one system block (persona + any injected context, e.g. M1 grounded retrieval) —
  // taking only the first would silently DROP injected context and the model would fall back to a generic refusal.
  const persona = list.filter((x) => x && x.role === "system" && x.content).map((x) => x.content).join("\n\n");
  const turns = list.filter((x) => x && x.role !== "system" && (x.content || "").length);

  if (M.llama3) {
    let s = persona ? `<|start_header_id|>system<|end_header_id|>\n\n${persona}<|eot_id|>` : "";
    for (const t of turns) s += `<|start_header_id|>${t.role === "assistant" ? "assistant" : "user"}<|end_header_id|>\n\n${t.content}<|eot_id|>`;
    return s + `<|start_header_id|>assistant<|end_header_id|>\n\n`;
  }
  if (M.qwen) {
    const noThink = M.qwen3 ? "<think>\n\n</think>\n\n" : "";
    let s = persona ? `<|im_start|>system\n${persona}<|im_end|>\n` : "";
    for (const t of turns) s += `<|im_start|>${t.role === "assistant" ? "assistant" : "user"}\n${t.content}<|im_end|>\n`;
    return s + `<|im_start|>assistant\n` + noThink;
  }
  if (M.olmo) {
    let s = persona ? `<|system|>\n${persona}\n` : "";
    for (const t of turns) s += t.role === "assistant" ? `<|assistant|>\n${t.content}\n` : `<|user|>\n${t.content}\n`;
    return s + `<|assistant|>\n`;
  }
  // word-frame / plain: only the last user turn carries (base models have no multi-turn template)
  const lastUser = [...turns].reverse().find((t) => t.role !== "assistant");
  const q = (lastUser && lastUser.content) || "";
  if (M.userWord) return (persona ? persona + "\n" : "") + "User: " + q + "\nFalcon:";
  return (persona ? persona + "\n" : "") + "Question: " + q + "\nAnswer:";
}

// A stable fingerprint of a rendered history (roles+contents) — warm continuation reuses the running token
// sequence only when the new history is EXACTLY the previous one plus a fresh user turn (same system, same prior).
function sigOf(list) { return (list || []).map((e) => (e.role || "") + "" + (e.content || "")).join(""); }

// The incremental frame for ONE new user turn — the tokens frameHistory() would ADD after the previous assistant
// reply (which the KV already holds). It closes the prior reply (<eot>/<|im_end|>/newline) then adds the user block
// and the assistant header, byte-for-byte matching frameHistory so warm ids extend the cold prefix exactly. Returns
// null for templates whose trailing generation header differs from the in-context turn (qwen3 <think>), forcing cold.
function tailSegment(M, userText) {
  const u = userText || "";
  if (M.llama3) return `<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n${u}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`;
  if (M.qwen && !M.qwen3) return `<|im_end|>\n<|im_start|>user\n${u}<|im_end|>\n<|im_start|>assistant\n`;
  if (M.olmo) return `\n<|user|>\n${u}\n<|assistant|>\n`;
  return null;   // word-frame / diffusion / qwen3-thinking → no stable single-turn tail; rebuild cold
}

// framePersona(M, personaText) → JUST the system block frameHistory() renders (NO trailing assistant/generation
// header), so its token ids are a byte-prefix of any real turn's ids and can be pinned once + reused (KV-commons).
// Templated families end the block on a special token (<|eot_id|> / <|im_end|>), so the boundary tokenizes stably.
// Returns null for base/word-frame families (no special-token boundary → prefix could drift → don't pin, prefill cold).
export function framePersona(M, personaText) {
  const p = String(personaText || ""); if (!p) return "";
  if (M.llama3) return `<|start_header_id|>system<|end_header_id|>\n\n${p}<|eot_id|>`;
  if (M.qwen) return `<|im_start|>system\n${p}<|im_end|>\n`;
  if (M.olmo) return `<|system|>\n${p}\n`;
  return null;
}

export function createFastQBrain(opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  const M = pickModel(cfg);
  let engine = null, loadingP = null;
  let info = { ready: false, model: M.name, device: null, resident: false };
  // WARM-KV session: the running token ids of the LAST committed turn (system + all prior turns + the reply AS
  // GENERATED — never re-tokenized) and a signature of the history they represent. buildIds() extends this by one
  // user turn so gpu.sync() finds the whole prior conversation already in KV and prefills ONLY the new turn.
  let sess = null;   // { ids: number[], sig: string }

  // encode a history to the running token ids (framed + optional bos), ready for engine.generate
  function idsFor(history) {
    let ids = engine.tokenize(frameHistory(M, history));
    if (M.bos && engine.bosId != null) ids = [engine.bosId, ...ids];
    return ids;
  }

  // WARM path: if `history` is exactly the last committed conversation plus one new user turn (same system + prior),
  // extend the running ids by just that turn's tokens — reusing the generated reply ids VERBATIM (no re-tokenize
  // round-trip that would drift the prefix). gpu.sync() then reuses the resident KV for the whole prior conversation
  // and prefills only the appended tokens. Otherwise fall back to a full cold frame. Warm is always CORRECT: if the
  // GPU KV was disturbed by an interleaved call, sync() simply re-prefills the same ids from scratch (== cold cost).
  function buildIds(history) {
    const list = Array.isArray(history) ? history : [];
    const last = list[list.length - 1];
    if (sess && list.length >= 2 && last && last.role !== "system") {
      const tail = tailSegment(M, last.content);
      if (tail != null && sigOf(list.slice(0, list.length - 1)) === sess.sig) {
        return { ids: sess.ids.concat(engine.tokenize(tail)), warm: true };
      }
    }
    return { ids: idsFor(list), warm: false };
  }
  // record the running ids + the history they now represent, so the NEXT turn can extend them. Only committed turns
  // advance the session; a speculative branch (persist:false) warms the GPU KV but leaves the committed pointer put.
  function updateSession(history, replyText, finalIds, aborted) {
    if (aborted || !finalIds || !replyText) return;   // partial/empty → don't trust continuity next turn (stays cold, safe)
    const represented = (Array.isArray(history) ? history : []).concat([{ role: "assistant", content: replyText }]);
    sess = { ids: finalIds.slice(), sig: sigOf(represented) };
  }

  async function load(onProgress) {
    if (engine) return info;
    if (loadingP) return loadingP;
    loadingP = (async () => {
      if (!(typeof navigator !== "undefined" && navigator.gpu)) throw new Error("no WebGPU on this device");
      await ready();   // wasm tokenizer init (shared instance)
      const loaded = await loadModel(M, {
        onStatus: () => {},
        onProgress: (d, t, w) => { try { onProgress && onProgress({ done: d, total: t, phase: w, model: M.name }); } catch (e) {} },
      });
      if (!loaded || !loaded.gpu) throw new Error("q-brain-fast: model load failed (" + M.name + ")");
      engine = await createEngine(M, loaded);
      // MEASURED from the real engine, not asserted: device/resident reflect an engine that actually uploaded
      // weights to the GPU (dims + gpuBytes are live signals) — so info() can never claim residency it lacks.
      info = { ready: true, model: M.name, device: (engine && engine.dims ? "webgpu" : null), resident: !!(engine && (engine.gpuBytes || engine.dims)) };
      return info;
    })().catch((e) => { loadingP = null; throw e; });
    return loadingP;
  }
  async function ensure(onProgress) { if (!engine) await load(onProgress); return engine; }

  // generate(history, { signal, onProgress }) → async-iterator of TEXT DELTAS (exactly what makeQResponder
  // accumulates + paints via onDelta). engine.generate reports CUMULATIVE text per step; we diff to deltas
  // and pump them through a small queue so this stays a clean generator (and honors the abort signal).
  async function* generate(history, o = {}) {
    await ensure(o.onProgress);
    if (!engine) return;
    const signal = o.signal || null;
    const { ids, warm } = buildIds(history);
    if (o.onWarm) try { o.onWarm(warm); } catch (e) {}   // let the caller instrument warm-vs-cold prefill
    const cap = o.maxTokens || cfg.maxTokens || M.cap || 256;
    const persist = o.speculative !== true;   // a speculative branch warms the KV but must NOT advance the committed session

    const queue = []; let done = false, wake = null, prev = "", finalIds = null;
    const kick = () => { if (wake) { const w = wake; wake = null; w(); } };
    const run = engine.generate(ids, {
      maxNew: cap, signal,
      onToken: ({ text, ids: cur }) => { if (cur) finalIds = cur; const d = (text || "").slice(prev.length); if (d) { prev = text; queue.push(d); kick(); } },
    }).then((res) => { if (res && res.ids) finalIds = res.ids; done = true; kick(); }).catch(() => { done = true; kick(); });

    while (true) {
      if (queue.length) { yield queue.shift(); continue; }
      if (done) break;
      if (signal && signal.aborted) break;
      await new Promise((r) => (wake = r));
    }
    try { await run; } catch (e) {}
    // extend the warm-KV session with this turn's full running ids (only for a COMMITTED, complete turn — a
    // speculative branch leaves the committed pointer put; its KV still lives in gpu.cached for sync() to reuse).
    if (persist) updateSession(history, prev, finalIds, !!(signal && signal.aborted));
  }

  // chat(history, opts) → full string (used by window.HoloQ.generate + light background features).
  // o.onStats(stats) surfaces the engine's measured { ttft, tokps, msExec } for a turn (else discarded) — used by
  // the reply path's latency HUD + HoloQ.selfTest to SHOW the warm-KV win instead of asserting it. Non-breaking.
  async function chat(history, o = {}) {
    await ensure(o.onProgress);
    if (!engine) return "";
    const ids = idsFor(history);
    const res = await engine.generate(ids, { maxNew: o.maxTokens || cfg.maxTokens || M.cap || 256, signal: o.signal || null });
    if (o.onStats) { try { o.onStats({ ...(res && res.stats || {}), promptTokens: ids.length }); } catch (e) {} }
    return ((res && res.text) || "").trim();
  }

  // native-ternary κ-object → no LoRA adapters; skill routing is a no-op (the base is the specialist).
  const setSkill = async () => ({ adapter: false, unsupported: true });
  const setAdapter = async () => ({ adapter: false, unsupported: true });

  // Q's LIVE self-knowledge (M0), derived from THIS instance's real model + engine κ — the grounded truth
  // every surface leads with so Q is honestly self-aware and never confabulates a cloud identity. Available
  // even before load (identity is in M); the κ fills in once the engine is resident.
  const facts = () => selfFacts({ model: M, engine });
  const persona = () => selfPersona({ model: M, engine });
  const intro = () => selfIntro({ model: M, engine });

  // pinPersona(text): prefill + pin the EXACT persona system block ONCE (KV-COMMONS), so the FIRST turn reuses it
  // instead of re-prefilling the whole persona. `text` MUST equal what the caller sends as the system turn (e.g. the
  // messenger's persona()+Q_STYLE) or the ids won't byte-match and the pin is silently wasted. Call once, post-warm,
  // before the first turn (pinPrefix resets the KV, so never mid-conversation). Returns the pinned length (0 = skipped).
  let _personaPinned = false;
  async function pinPersona(text) {
    try {
      if (_personaPinned || !engine || !engine.kvPinAvailable) return 0;
      const block = framePersona(M, text != null ? text : persona());
      if (!block) return 0;                                    // null/empty → base family or no persona; skip (cold, correct)
      let ids = engine.tokenize(block);
      if (M.bos && engine.bosId != null) ids = [engine.bosId, ...ids];
      const L = await engine.pinPrefix(ids);
      _personaPinned = L > 0;
      return L;
    } catch (e) { return 0; }
  }

  return { id: "q-brain-fast-" + (M.fam || M.name), load, generate, chat, setSkill, setAdapter, info: () => info, facts, persona, intro, pinPersona, pinLen: () => { try { return engine && engine.pinLen ? engine.pinLen() : 0; } catch (e) { return 0; } } };
}

export default createFastQBrain;
