// holo-q-contact.mjs — Q IS A CONTACT. Talk to your OS like a friend, in Holo Messenger.
//
// The whole design in one line: Q is an ordinary conversation whose outbound `deliver` is the LOCAL brain,
// streamed into an ephemeral bubble that FINALIZES to one immutable κ on the chain. The messenger's
// renderer / store / dedup / verify / reducer are untouched — Q rides the exact pipeline a human does, it
// just sources its bytes from silicon (createHoloModelBrain.generate) instead of a network peer.
//
// Immutability vs. streaming (the one real tension): a message is a frozen κ, but a reply grows token by
// token. Resolution = STREAM→FINALIZE. The caller paints live deltas into a UI-only bubble (the real
// "typing"); when generation completes we thread.ingest the full text as ONE verified κ authored as Q. The
// chain only ever holds finished messages, so thread.verify() stays green. Partial tokens are never
// persisted; an aborted turn writes nothing.
//
// Privacy: a Q reply does ZERO network egress — it is computed on-device and ingested locally. The
// content-blind relay (holo-messenger-transport) is the PEER path (humans / groups), not Q's reply path.
//
// Everything is transport-injected (thread + brain are passed in), so the core is Node-witnessable with a
// fake brain (a generator of fixed deltas) and a fake thread — exactly like the messenger's own witnesses.
//
// Authority: holo-messenger-thread (§2.6 Collection + strand) · holo-q-mux faculties (skill routing) ·
//   createHoloModelBrain (streaming generate + setSkill hot-swap) · Law L5 (finalized κ re-derives).

import { conversationGenesis } from "../holo-messenger-thread.mjs";

// Q's stable identity (display + authorship intent). The real sovereign κ is an Agent Passport
// (holo-agent-passport); until that is bound, this names Q consistently so its bubbles render as Q's.
export const Q_IDENTITY = "did:holo:agent:q";
export const Q_PERSONA =
  "You are Q, the user's on-device companion inside Hologram. You are warm, concise, and genuinely human in tone. " +
  "You live on this device — nothing the user says leaves it. Answer like a thoughtful friend, not a manual.";

// Q's conversation genesis κ (content-addressed; same operator → same Q thread everywhere).
export function qGenesis(operator = "") {
  return conversationGenesis({ platform: "q", chat: "Q", participants: [operator, Q_IDENTITY].filter(Boolean) });
}

// ── intent → faculty (the zoo, invisible): pure + deterministic so it is Node-witnessable and never
//    surprises. Maps a user turn to a holo-q-mux faculty; brain.setSkill hot-swaps the specialist on the
//    warm base (no reload). Unknown intent → "respond" (the base chat brain). Never shows a model name. ──
export function classifySkill(text) {
  const t = String(text || "").toLowerCase();
  if (/```|\bfunction\b|\bclass\b|\bbug\b|\bstack ?trace\b|\brefactor\b|\bcompile\b|\bregex\b|\bpython\b|\bjavascript\b|\btypescript\b|\bsql\b|\bcode\b/.test(t)) return "code";
  if (/^\s*(make|build|create|generate|design)\b.*\b(holospace|space|app|page|site|dashboard|game|tool)\b/.test(t)) return "create";
  if (/\b(summari[sz]e|tl;?dr|extract|condense)\b/.test(t)) return "compression";
  return "respond";
}

// thread.view() bubble list → the [{role, content}] history createHoloModelBrain.generate consumes.
// Q's own bubbles map to "assistant"; everyone else to "user". A system persona leads. Bounded window.
export function historyFrom(view, { persona = Q_PERSONA, max = 16 } = {}) {
  const msgs = [{ role: "system", content: persona }];
  for (const b of (view || []).slice(-max)) {
    const isQ = b && (b.sender === "Q" || b.sender === Q_IDENTITY || b.author === Q_IDENTITY);
    msgs.push({ role: isQ ? "assistant" : "user", content: (b && b.text) || "" });
  }
  return msgs;
}

// mentionsQ(text) — is Q addressed? "@Q" / "@q" as its own token (not inside an email/handle). Pure.
export function mentionsQ(text) { return /(^|[^A-Za-z0-9_@])@q\b/i.test(String(text || "")); }

// ── makeQGroupResponder({ brain, now, persona, classify }) — M7: Q as a PARTICIPANT in a human group thread.
// respondInGroup(thread, { publish, mintFn, ... }) reads the shared thread, replies ONLY when the latest message
// @-mentions Q (and isn't Q's own), and PUBLISHES the reply over the group's transport so every peer sees it
// (publish = the group's secure.publishSecure; it also local-echoes → ingests on the chain). Idempotent per
// trigger κ (one reply per mention) and self-skipping (never answers itself → no loops). Group-aware history:
// each human turn is prefixed with its sender so Q knows who said what and can address the asker. ──
export function makeQGroupResponder({ brain, now = () => new Date().toISOString(), persona = Q_PERSONA, classify = classifySkill, passport = null } = {}) {
  const handled = new Set();
  function groupHistory(view, max = 16) {
    const msgs = [{ role: "system", content: persona + " You are in a GROUP chat. Reply briefly, addressing the person who mentioned you (@Q)." }];
    for (const b of (view || []).slice(-max)) {
      const isQ = b && (b.sender === "Q" || b.sender === Q_IDENTITY || b.author === Q_IDENTITY);
      msgs.push({ role: isQ ? "assistant" : "user", content: isQ ? (b.text || "") : `${b.sender || "Someone"}: ${b.text || ""}` });
    }
    return msgs;
  }
  async function respondInGroup(thread, { publish, mintFn, group = "", onDelta = () => {}, onTyping = () => {}, signal = null } = {}) {
    const view = thread && thread.view ? thread.view() : [];
    const last = view[view.length - 1];
    if (!last) return { skipped: "empty" };
    if (last.sender === "Q" || last.sender === Q_IDENTITY) return { skipped: "own" };          // never answer self → no loop
    if (!mentionsQ(last.text)) return { skipped: "no-mention" };                                // mention-gated: silent unless @Q'd
    const key = last.kappa || (last.seq + ":" + (last.text || ""));
    if (handled.has(key)) return { skipped: "already" };                                        // one reply per mention (idempotent)
    handled.add(key);
    if (brain && brain.setSkill) { try { await brain.setSkill(classify(last.text)); } catch (e) {} }
    onTyping(true);
    let text = "";
    try { for await (const d of brain.generate(groupHistory(view), { signal })) { if (signal && signal.aborted) break; text += d; try { onDelta(d, text); } catch (e) {} } }
    catch (e) {} finally { onTyping(false); }
    if (signal && signal.aborted) return { aborted: true };
    text = text.trim();
    if (!text) return { skipped: "empty-gen" };
    if (typeof mintFn !== "function" || typeof publish !== "function") return { skipped: "no-publish", text };
    const obj = mintFn({ text, sender: "Q", sentAt: now(), chat: group, source: "holo" }).object;   // authored as Q
    await publish(obj);                                                                          // → peers + local echo (ingests on chain)
    if (passport && passport.attest && thread.appendNote) { try { const a = await passport.attest(obj.id); await thread.appendNote(a.kind, a.payload); } catch (e) {} }   // Q signs the group message
    return { published: true, text, kappa: obj.id, authored: !!passport };
  }
  return { respondInGroup, mentionsQ };
}

// ── makeQResponder({ thread, brain, now, persona, classify }) — the receive side.
// respond(input, { signal, onDelta, onTyping }) reads the thread as history, routes the skill silently,
// streams the brain's deltas (onDelta paints them live = the real typing indicator), and on completion
// finalizes ONE verified κ via thread.ingest authored as Q. Abort → no κ written. Returns the outcome. ──
// `seed(text)→string|null` is the O(1) cold-start κ-memo (holo-q-seed.seedLookup); `brainReady()→bool` reports
// whether the full brain's κ-shards have streamed in. While the brain is still cold, a predictable first question
// is answered INSTANTLY from the seed (zero model, zero network); warm users always get the full brain.
// `onnxSeed.respond(history)→async-iterable<token>` is the ~7MB ONNX seed first-responder: while the brain is
// cold AND the κ-memo misses (a NOVEL question), it drafts an instant short answer so even unscripted first
// questions don't wait for the full 480MB stream. Fail-soft: a null/empty seed falls through to the brain.
export function makeQResponder({ thread, brain, now = () => new Date().toISOString(), persona = Q_PERSONA, classify = classifySkill, passport = null, seed = null, brainReady = null, onnxSeed = null } = {}) {
  async function setTyping(on, onTyping) {
    try { onTyping && onTyping(on); } catch (e) {}
    if (thread && thread.appendNote) { try { await thread.appendNote("typing", { who: Q_IDENTITY, isTyping: !!on }); } catch (e) {} }   // M3: REAL typing event
  }
  function brainIsReady() { try { return brainReady ? !!brainReady() : !!(brain && brain.info && brain.info().ready); } catch (e) { return false; } }
  // finalize ONE immutable κ authored as Q (+ optional voice media + Agent-Passport signature). Shared by the
  // instant seed path and the full-brain path.
  async function finalizeQ(text, media = []) {
    const res = await thread.ingest({ text, sender: "Q", sentAt: now(), chat: "Q", source: "holo", ...(media.length ? { media } : {}) });
    if (passport && passport.attest) { try { const a = await passport.attest(res.kappa); await thread.appendNote(a.kind, a.payload); } catch (e) {} }
    return res;
  }

  // opts.speak + opts.tts + opts.mediaStore → after the text streams, synthesize Q's voice and attach it to
  // the SAME finalized message as an AudioObject media κ (one message, text + voice). Off by default.
  async function respond(input = "", { signal = null, onDelta = () => {}, onTyping = () => {}, speak = false, tts = null, mediaStore = null } = {}) {
    const view = thread && thread.view ? thread.view() : [];
    const lastUser = [...view].reverse().find((b) => b && b.sender !== "Q" && b.sender !== Q_IDENTITY);
    const intentText = (typeof input === "string" ? input : (input && input.text)) || (lastUser && lastUser.text) || "";

    // ── COLD-START INSTANT (responsiveness): answer the predictable first questions O(1) from the sealed seed
    //    κ-memo — ZERO model, ZERO network — while the full brain's κ-shards stream in. Cold-only, so warm users
    //    always get the full brain. A miss falls through to the brain below (honest). ──
    if (seed && !brainIsReady()) {
      let ans = null; try { ans = seed(intentText); } catch (e) { ans = null; }
      if (ans) {
        await setTyping(true, onTyping);
        try { onDelta(ans, ans); } catch (e) {}
        await setTyping(false, onTyping);
        if (signal && signal.aborted) return { aborted: true, skill: "respond", text: ans, kappa: null };
        const res = await finalizeQ(ans);
        return { aborted: false, skill: "respond", text: ans, kappa: res.kappa, seq: res.seq, media: [], authored: !!passport, seed: true };
      }
    }

    // ── COLD-START NOVEL (responsiveness): the κ-memo missed and the brain is still streaming → draft an instant
    //    short answer from the ~7MB ONNX seed so even unscripted first questions reply fast. Fail-soft + cold-only. ──
    if (onnxSeed && onnxSeed.respond && !brainIsReady()) {
      await setTyping(true, onTyping);
      let stext = "";
      try { for await (const tok of onnxSeed.respond(historyFrom(view, { persona }))) { if (signal && signal.aborted) break; stext += tok; try { onDelta(tok, stext); } catch (e) {} } }
      catch (e) {} finally { await setTyping(false, onTyping); }
      if (signal && signal.aborted) return { aborted: true, skill: "respond", text: stext, kappa: null };
      stext = stext.trim();
      if (stext) { const res = await finalizeQ(stext); return { aborted: false, skill: "respond", text: stext, kappa: res.kappa, seq: res.seq, media: [], authored: !!passport, seedOnnx: true }; }
      // empty seed draft → fall through to the full brain (honest)
    }

    const skill = classify(intentText);
    if (brain && brain.setSkill) { try { await brain.setSkill(skill); } catch (e) {} }   // M4: silent per-task specialist

    const history = historyFrom(view, { persona });
    await setTyping(true, onTyping);
    let text = "";
    try {
      for await (const delta of brain.generate(history, { signal })) {
        if (signal && signal.aborted) break;
        text += delta;
        try { onDelta(delta, text); } catch (e) {}
      }
    } catch (e) { /* a load/stream failure leaves text as-is; honest partial, finalized below only if non-empty */ }
    finally { await setTyping(false, onTyping); }

    if (signal && signal.aborted) return { aborted: true, skill, text, kappa: null };   // ephemeral bubble dropped by caller
    text = text.trim();
    if (!text) return { aborted: false, empty: true, skill, text: "", kappa: null };

    let media = [];
    if (speak && tts && mediaStore) {   // M5: synthesize the spoken reply, store it by κ, attach to this message
      try { const a = await tts(text); if (a && a.bytes) { const k = await mediaStore.put(a.bytes, a.mime || "audio/x-pcm-f32", a.meta || null); if (k) media = [{ kappa: k, mime: a.mime || "audio/x-pcm-f32", kind: "schema:associatedMedia" }]; } } catch (e) {}
    }
    const res = await finalizeQ(text, media);   // ONE immutable κ (text [+ voice]), Agent-Passport signed
    return { aborted: false, skill, text, kappa: res.kappa, seq: res.seq, media, authored: !!passport };
  }

  return { respond, classify };
}

// ── makeSpeculator({ brain, persona, classify }) — M2 zero-latency.
// On a debounced draft pause the UI calls start(draft, view): we begin generating against the draft with an
// abortable signal, keyed by the draft text. On send, commit(text): if it matches the speculation we return
// the already-(in-flight/finished) reply → perceived latency ≈ 0; if it differs we abort and report a miss
// so the caller falls back to a normal respond(). Pure control logic; Node-witnessable with a fake brain. ──
export function makeSpeculator({ brain, persona = Q_PERSONA, classify = classifySkill } = {}) {
  let current = null;   // { key, controller, promise, text, done }
  const keyOf = (t) => String(t || "").trim().replace(/\s+/g, " ");

  function start(draft, view) {
    const key = keyOf(draft);
    if (!key) return;
    if (current && current.key === key) return;        // already speculating this exact draft
    if (current) { try { current.controller.abort(); } catch (e) {} }
    const controller = new AbortController();
    const history = historyFrom(view, { persona }).concat([{ role: "user", content: String(draft) }]);
    const rec = { key, controller, text: "", done: false };
    rec.promise = (async () => {
      try {
        if (brain && brain.setSkill) { try { await brain.setSkill(classify(draft)); } catch (e) {} }
        for await (const d of brain.generate(history, { signal: controller.signal })) {
          if (controller.signal.aborted) break;
          rec.text += d;
        }
      } catch (e) {} finally { rec.done = true; }
    })();
    current = rec;
  }

  // commit(text) → { hit, text? }. A hit means the reply was pre-generated; finalize it as Q's κ yourself
  // (thread.ingest), no second generation needed. A miss means discard + respond() normally.
  async function commit(text) {
    const key = keyOf(text);
    if (current && current.key === key) {
      const rec = current; current = null;
      await rec.promise;
      return { hit: true, text: rec.text.trim() };
    }
    if (current) { try { current.controller.abort(); } catch (e) {} current = null; }
    return { hit: false };
  }

  function abort() { if (current) { try { current.controller.abort(); } catch (e) {} current = null; } }
  return { start, commit, abort, get speculating() { return !!current; } };
}

// ── browser binding: window.HoloQContact — the seam the messenger surface wires.
// In index.html: thread = HoloThread.makeThread({ genesis: qGenesis(operatorκ), ... }); brain =
// createHoloModelBrain({ model:"qwen2.5-0.5b", skill:"respond" }); const q = makeQResponder({ thread, brain });
// on send → q.respond(text, { onDelta: paintLiveBubble, onTyping: showTyping }); pin the Q thread top-of-inbox
// with an always-online dot. Speculation: makeSpeculator({ brain }); input 'pause' → start(draft, view);
// send → commit(text) (hit ⇒ ingest the text as Q; miss ⇒ q.respond). All on-device; no egress.
if (typeof window !== "undefined" && !window.HoloQContact) {
  window.HoloQContact = { Q_IDENTITY, Q_PERSONA, qGenesis, classifySkill, historyFrom, makeQResponder, makeSpeculator };
}

export default { Q_IDENTITY, Q_PERSONA, qGenesis, classifySkill, historyFrom, makeQResponder, makeSpeculator };
