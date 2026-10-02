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
  const p = (typeof persona === "function") ? (persona() || Q_PERSONA) : persona;   // persona may be a LIVE getter (Q's self-knowledge, recomputed each turn) or a plain string
  const msgs = [{ role: "system", content: p }];
  for (const b of (view || []).slice(-max)) {
    const isQ = b && (b.sender === "Q" || b.sender === Q_IDENTITY || b.author === Q_IDENTITY);
    msgs.push({ role: isQ ? "assistant" : "user", content: (b && b.text) || "" });
  }
  return msgs;
}

// mentionsQ(text) — is Q addressed? "@Q" / "@q" as its own token (not inside an email/handle). Pure.
export function mentionsQ(text) { return /(^|[^A-Za-z0-9_@])@q\b/i.test(String(text || "")); }

// ── stripScaffold(raw): the tiny cold-start models (seed.onnx first-responder, and any small brain before
//    it warms) can echo their instruction-template SHELL verbatim instead of just the answer — e.g.
//    "Explanation:\nContext: The user is …\nResponse: <answer>" — or leak ChatML role tokens. That shell must
//    never reach a bubble: it reads as a broken chatbot, not a friend. This removes it so ONLY the human answer
//    paints. It is the single sanitize seam for EVERY tier (seed κ-memo, ONNX seed, full brain, groups) because
//    all of them funnel their text through onDelta + finalizeQ below. Design constraints:
//      • Pure + idempotent  → safe to run on every streamed delta AND again at finalize (stable fixpoint).
//      • Conservative       → the meta-label strip fires ONLY when the text LEADS with a known scaffold label,
//                             so ordinary prose (which may contain "Note:", a colon, etc.) is never touched.
//      • Answer-preserving   → when a "Response:/Answer:/Reply:" label is present after the meta preamble, we keep
//                             everything after the LAST such label (the real answer), dropping the preamble.
export function stripScaffold(raw) {
  let t = String(raw == null ? "" : raw);
  if (!t) return t;
  t = t.replace(/<\|\/?(?:im_start|im_end|endoftext|system|user|assistant)\|>/gi, "");   // ChatML control tokens a small model may echo
  const LEAD_META = /^\s*(?:Explanation|Context|Reasoning|Analysis|Instruction|Task|Input|Output|System|Prompt|Scenario|Situation)\s*:/i;
  if (LEAD_META.test(t)) {
    const re = /(?:^|\n)[ \t]*(?:Response|Answer|Reply)[ \t]*:[ \t]*/gi;   // answer label, LAST wins (models nest)
    let m, cut = -1;
    while ((m = re.exec(t))) cut = m.index + m[0].length;
    if (cut >= 0) t = t.slice(cut);                                        // keep only the answer body
    else t = t.replace(/^(?:[ \t]*(?:Explanation|Context|Reasoning|Analysis|Instruction|Task|Input|Output|System|Prompt|Scenario|Situation)[ \t]*:[^\n]*(?:\n|$))+/i, "");   // preamble still streaming → drop the meta lines
  }
  t = t.replace(/^[ \t]*(?:Response|Answer|Reply|Assistant|AI|Bot|Q)[ \t]*:[ \t]*/i, "");   // a lone leading answer/role label ("Response: hi" → "hi")
  return t.replace(/^\n+/, "");
}

// ── isRealAnswer(text, userText): the QUALITY FLOOR (HOLO-Q-FIRST-CONTACT C1). A candidate reply may
//    finalize as Q's κ only if it is a real answer — not a one-glyph fragment (a live screenshot showed Q
//    reply with a single `"`), not an echo of the user's own words, not a canned-bot greeting. Used as the
//    ESCALATION predicate in respond(): a tier whose draft fails simply falls through to the next rung
//    (exactly like an empty generation), so the floor never silences Q — it routes around weak answers.
//    Pure + deterministic → Node-witnessable. Conservative by design: legitimate short answers ("4.",
//    "Yes — done.") pass via the terminal-punctuation clause; ordinary prose is never rejected. ──
export function isRealAnswer(text, userText = "", opts = {}) {
  const t = String(text == null ? "" : text).trim();
  if (!t) return false;
  const glyphs = (t.match(/[\p{L}\p{N}]/gu) || []).length;                        // letters + digits ("4." is a real answer)
  if (!glyphs) return false;                                                      // pure punctuation/emoji fragment ('"', '…')
  const words = t.split(/\s+/).filter((w) => /\p{L}|\d/u.test(w)).length;
  const short = words < 2 || glyphs < 6;
  if (short && !/[.!?…]$/.test(t)) return false;                                  // an unterminated fragment; "4." or "Yes!" stay legal
  const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\d]+/gu, " ").trim();
  const nt = norm(t), nu = norm(userText);
  if (nu && nu.length >= 4 && (nt === nu || (nt.startsWith(nu) && nt.length < nu.length + 8))) return false;   // parrot-echo of the user's turn
  if (/\bhow (?:can|may) i (?:help|assist) you\b/i.test(t) && !/\b(hi|hey|hello|good (?:morning|afternoon|evening))\b/i.test(String(userText || ""))) return false;   // canned-bot tell outside a greeting
  if (opts && opts.strict) {
    // STRICT tier (the cold ONNX seed's 16-token drafts): a truncated draft almost never ends in terminal
    // punctuation and word-salad repeats itself ("let me let me…" was caught live). Real seed drafts pass both;
    // a rejected one escalates to the full brain — strict mode never silences Q, it only routes around junk.
    if (!/[.!?…)"']$/.test(t)) return false;                                      // mid-word truncation ("…for you will phone to30")
    if (/\b(\p{L}+(?:\s+\p{L}+)?)\s+\1\b/iu.test(t)) return false;                // immediate word/bigram stutter ("let me let me")
    if (/^[a-z]/.test(t)) return false;                                           // leading fragment ("n home I'm sorry…") — a finished draft starts a sentence
    if (((t.match(/"/g) || []).length % 2) === 1) return false;                   // unbalanced straight quote ('Sure! Please let me" is when…')
  }
  return true;
}

// ── makeQGroupResponder({ brain, now, persona, classify }) — M7: Q as a PARTICIPANT in a human group thread.
// respondInGroup(thread, { publish, mintFn, ... }) reads the shared thread, replies ONLY when the latest message
// @-mentions Q (and isn't Q's own), and PUBLISHES the reply over the group's transport so every peer sees it
// (publish = the group's secure.publishSecure; it also local-echoes → ingests on the chain). Idempotent per
// trigger κ (one reply per mention) and self-skipping (never answers itself → no loops). Group-aware history:
// each human turn is prefixed with its sender so Q knows who said what and can address the asker. ──
export function makeQGroupResponder({ brain, now = () => new Date().toISOString(), persona = Q_PERSONA, classify = classifySkill, passport = null, polish = null } = {}) {
  const handled = new Set();
  function groupHistory(view, max = 16) {
    const p = (typeof persona === "function") ? (persona() || Q_PERSONA) : persona;   // LIVE persona getter or string
    const msgs = [{ role: "system", content: p + " You are in a GROUP chat. Reply briefly, addressing the person who mentioned you (@Q)." }];
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
    try { for await (const d of brain.generate(groupHistory(view), { signal })) { if (signal && signal.aborted) break; text += d; try { onDelta(d, stripScaffold(text)); } catch (e) {} } }
    catch (e) {} finally { onTyping(false); }
    if (signal && signal.aborted) return { aborted: true };
    text = stripScaffold(text).trim();
    if (!text) return { skipped: "empty-gen" };
    // Q's group replies go out in the SAME voice as its 1:1 chat: the deterministic identity guard (no cloud-identity
    // claim) + humanize (strip every LLM tell) run here before publish, so an @Q answer in a group is warm human prose,
    // never a chatbot that says "as an AI" or claims to be ChatGPT. Fail-open: a null/throwing polish leaves text as-is.
    if (polish) { try { const p = await polish(text); if (p && typeof p === "string" && p.trim()) text = p.trim(); } catch (e) {} }
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
export function makeQResponder({ thread, brain, now = () => new Date().toISOString(), persona = Q_PERSONA, classify = classifySkill, passport = null, seed = null, brainReady = null, onnxSeed = null, polish = null, retrieve = null, split = null } = {}) {
  async function setTyping(on, onTyping) {
    try { onTyping && onTyping(on); } catch (e) {}
    if (thread && thread.appendNote) { try { await thread.appendNote("typing", { who: Q_IDENTITY, isTyping: !!on }); } catch (e) {} }   // M3: REAL typing event
  }
  function brainIsReady() { try { return brainReady ? !!brainReady() : !!(brain && brain.info && brain.info().ready); } catch (e) { return false; } }
  // finalize ONE immutable κ authored as Q (+ optional voice media + Agent-Passport signature). Shared by the
  // instant seed path and the full-brain path.
  async function finalizeQ(text, media = []) {
    text = stripScaffold(text);   // never persist instruction-template scaffolding — one seam, every tier
    if (polish) { try { const p = await polish(text); if (p && typeof p === "string") text = p; } catch (e) {} }   // flawless-grammar seam: Q's own replies go out tidy too (on-device, fail-open)
    // M15 D1 — MULTI-BUBBLE: split the finalized reply into natural human beats and ingest EACH as its own κ, with a
    // typing beat between, so Q talks like a person instead of dropping one wall. Backward-compatible: no `split` fn,
    // a single beat, media attached, or the flag off (localStorage holo.q.beats="0") ⇒ exactly ONE message, as before.
    let beats = [text];
    try {
      const on = (typeof localStorage !== "undefined") && localStorage.getItem("holo.q.beats") === "1";   // OPT-IN (default OFF) — single message is byte-identical to the original path; multi-beat re-enables once proven in the live render
      if (split && on && !media.length) { const b = split(text); if (Array.isArray(b) && b.length > 1) beats = b; }
    } catch (e) {}
    let res = null; const baseMs = Date.now();
    for (let i = 0; i < beats.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, Math.min(1200, 340 + beats[i].length * 5)));   // a human pause between beats (no typing-note pollution)
      const sentAt = beats.length > 1 ? new Date(baseMs + i).toISOString() : now();   // strictly-increasing per beat so ordering + κ-keys can never collide (single beat = exactly now(), unchanged)
      res = await thread.ingest({ text: beats[i], sender: "Q", sentAt, chat: "Q", source: "holo", ...(i === beats.length - 1 && media.length ? { media } : {}) });
      if (passport && passport.attest) { try { const a = await passport.attest(res.kappa); await thread.appendNote(a.kind, a.payload); } catch (e) {} }
    }
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
      if (ans && !isRealAnswer(stripScaffold(ans), intentText)) ans = null;   // C1 floor: a weak memo entry falls through (curated seeds all pass; this guards a bad edit)
      if (ans) {
        const disp = stripScaffold(ans);
        await setTyping(true, onTyping);
        try { onDelta(disp, disp); } catch (e) {}
        await setTyping(false, onTyping);
        if (signal && signal.aborted) return { aborted: true, skill: "respond", text: disp, kappa: null };
        const res = await finalizeQ(ans);
        return { aborted: false, skill: "respond", text: disp, kappa: res.kappa, seq: res.seq, media: [], authored: !!passport, seed: true };
      }
    }

    // ── COLD-START NOVEL (responsiveness): the κ-memo missed and the brain is still streaming → draft an instant
    //    short answer from the ~7MB ONNX seed so even unscripted first questions reply fast. Fail-soft + cold-only. ──
    if (onnxSeed && onnxSeed.respond && !brainIsReady()) {
      await setTyping(true, onTyping);
      let stext = "";
      try { for await (const tok of onnxSeed.respond(historyFrom(view, { persona }))) { if (signal && signal.aborted) break; stext += tok; try { onDelta(tok, stripScaffold(stext)); } catch (e) {} } }
      catch (e) {} finally { await setTyping(false, onTyping); }
      if (signal && signal.aborted) return { aborted: true, skill: "respond", text: stripScaffold(stext), kappa: null };
      stext = stripScaffold(stext).trim();   // a scaffold-ONLY draft strips to empty → falls through to the full brain (honest)
      // C1 QUALITY FLOOR: the tiny seed can emit a one-glyph or parrot draft (a live screenshot caught a lone `"`
      // finalized as Q's whole reply). A draft below the floor is treated EXACTLY like an empty one — fall through
      // to the full brain / the surface's proven fallback ladder — instead of persisting garbage as a κ.
      if (stext && isRealAnswer(stext, intentText, { strict: true })) { const res = await finalizeQ(stext); return { aborted: false, skill: "respond", text: stext, kappa: res.kappa, seq: res.seq, media: [], authored: !!passport, seedOnnx: true }; }
      // empty/weak seed draft → fall through to the full brain (honest)
    }

    const skill = classify(intentText);
    if (brain && brain.setSkill) { try { await brain.setSkill(skill); } catch (e) {} }   // M4: silent per-task specialist

    const history = historyFrom(view, { persona });
    // M1 — ground Q in the user's OWN world: an on-device retriever (injected by the surface) returns the real,
    // cited messages relevant to this turn. Injected as a system turn AFTER the persona so Q answers from the
    // user's actual context and cites it — never fabricating. Empty → no injection (Q answers as itself). The
    // retrieved text is the user's private data; it stays on-device (generation is local, 0 egress).
    if (retrieve) { try { const ctx = await retrieve(intentText); if (ctx && typeof ctx === "string") history.splice(1, 0, { role: "system", content: ctx }); } catch (e) {} }
    await setTyping(true, onTyping);
    let text = "";
    // C1 floor at the LAST rung: one silent regenerate on a below-floor answer; the retry's result stands either
    // way (an imperfect answer beats silence — this rung must never dead-end a surface that has no fallback).
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        text = "";
        try {
          for await (const delta of brain.generate(history, { signal })) {
            if (signal && signal.aborted) break;
            text += delta;
            try { onDelta(delta, stripScaffold(text)); } catch (e) {}
          }
        } catch (e) { /* a load/stream failure leaves text as-is; honest partial, finalized below only if non-empty */ }
        if (signal && signal.aborted) break;
        if (!text.trim() || isRealAnswer(stripScaffold(text).trim(), intentText)) break;   // empty (nothing to retry against) or real → done
      }
    } finally { await setTyping(false, onTyping); }

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
      return { hit: true, text: stripScaffold(rec.text).trim() };
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
  window.HoloQContact = { Q_IDENTITY, Q_PERSONA, qGenesis, classifySkill, historyFrom, makeQResponder, makeSpeculator, stripScaffold, isRealAnswer };
}

export default { Q_IDENTITY, Q_PERSONA, qGenesis, classifySkill, historyFrom, makeQResponder, makeSpeculator, stripScaffold, isRealAnswer };
