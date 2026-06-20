// holo-q-cascade-provider.mjs — adapt the cascade (holo-q-cascade.mjs) into the active-plane PROVIDER shape
// ({ id, faculty, isReady, generate }) that holo-q-active.mjs / facultySampler already consume. This is how
// the phone-instant cascade plugs into Q's orchestration with NO surface change: bind a cascade provider to a
// faculty (respond/code) and every surface that streams that faculty now streams draft-first → target-verified
// tokens, detokenized to text deltas, exactly like any other brain.
//
//   createCascadeProvider({ draft, target, tokenizer, faculty, k, maxNew, render, id }) → provider
//
// CONTRACTS it bridges:
//   • draft, target : TOKEN-LEVEL brains — { ready()->bool, greedy(tokenIds)->id (sync or async), eos? }.
//                     (The real .holo brains satisfy this by exposing their per-token decode step; see
//                     holo-q-cascade.mjs. The draft is the tiny ~5-10MB tier resident in ~1s.)
//   • tokenizer     : { encode(text)->number[], decode(number[])->string }. decode MUST be prefix-stable
//                     (decode(ids[0..n]) startsWith decode(ids[0..n-1])) so streaming deltas are exact.
//   • render        : (messages)->string — turn a chat history into the prompt text (default below; the real
//                     wiring passes the model's chat-template renderer).
//
// PROVIDER it yields:
//   • isReady()     : true as soon as the DRAFT (or target) is resident → the active plane treats Q as runnable
//                     and starts streaming in ~1s, before the full model has landed.
//   • generate(messages, opts) : async-iterable of TEXT deltas (the facultySampler shape). Honors opts.signal
//                     (barge-in / new turn) and opts.maxTokens. Never throws on a flaky brain — ends the stream.

import { cascadeDecode } from "./holo-q-cascade.mjs";

function defaultRender(messages) {
  if (typeof messages === "string") return messages;
  const lines = (messages || []).map((m) => `${m.role || "user"}: ${m.content == null ? "" : m.content}`);
  return lines.join("\n") + "\nassistant:";
}

export function createCascadeProvider({ draft, target, tokenizer, faculty = "respond", k = 4, maxNew = 256, render, id } = {}) {
  if (!tokenizer || typeof tokenizer.encode !== "function" || typeof tokenizer.decode !== "function")
    throw new Error("createCascadeProvider needs a tokenizer { encode, decode }");
  const renderMessages = render || defaultRender;
  const pid = id || "cascade-" + faculty;

  // runnable the instant the draft is up (talk in ~1s); target may still be streaming in behind it.
  const isReady = () => !!((draft && draft.ready && draft.ready()) || (target && target.ready && target.ready()));

  async function* generate(messages, opts = {}) {
    const prompt = tokenizer.encode(renderMessages(messages));
    const tokens = [];                                   // committed token ids so far (for prefix-stable decode)
    const queue = []; let wake = null, done = false;
    const pump = () => { if (wake) { const w = wake; wake = null; w(); } };
    const onToken = (e) => { tokens.push(e.token); queue.push(tokenizer.decode(tokens)); pump(); };   // running full text

    const run = cascadeDecode(draft, target, prompt, { k, maxNew: opts.maxTokens || maxNew, onToken, signal: opts.signal })
      .catch(() => {}).finally(() => { done = true; pump(); });

    let prev = "";
    while (true) {
      if (queue.length) { const full = queue.shift(); const delta = full.slice(prev.length); prev = full; if (delta) yield delta; continue; }
      if (done) break;
      if (opts.signal && opts.signal.aborted) break;
      await new Promise((r) => { wake = r; });
    }
    await run;
  }

  return {
    id: pid, faculty, isReady, generate,
    describe: () => ({ engine: "cascade", draft: (draft && draft.id) || null, target: (target && target.id) || null, ready: isReady() }),
  };
}

export default createCascadeProvider;
