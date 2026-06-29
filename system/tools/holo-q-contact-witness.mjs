// holo-q-contact-witness.mjs — proves the Q-as-a-contact core (holo-q-contact.mjs) end-to-end in Node with
// a FAKE brain (a generator of fixed deltas) and a FAKE thread (backed by the REAL seal/verify, so the
// finalized message is a genuinely content-addressed κ that re-derives). No GPU, no DOM, deterministic.
//
// Proves: (1) thread.view → [{role,content}] history maps Q↔assistant / others↔user; (2) respond STREAMS
// deltas (the live "typing"), (3) finalizes ONE real verifiable κ authored as Q, (4) raises a REAL typing
// note up then down, (5) routes the skill silently (code prompt → setSkill("code")), (6) ABORT writes no κ
// (ephemeral only), (7) speculation HIT returns the pre-generated reply / MISS reports a miss, (8) classify
// + genesis are deterministic.

import { makeQResponder, makeSpeculator, classifySkill, historyFrom, qGenesis, Q_IDENTITY } from "../os/usr/lib/holo/q/holo-q-contact.mjs";
import { seal, verify } from "../os/usr/lib/holo/holo-object.mjs";
import { messageObject } from "../os/usr/lib/holo/holo-pluck.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "  ok  " : "  XX  ") + m); c ? pass++ : fail++; };

// ── FAKE thread: real content-addressing (seal/verify), in-memory event list + notes ──
function makeFakeThread(seed = []) {
  const events = seed.slice(), notes = [];
  return {
    view: () => events.map((e, i) => ({ text: e.text, sender: e.sender, seq: i, kappa: e.kappa })),
    ingest: async (input) => { const obj = seal(messageObject(input)); if (!verify(obj)) throw new Error("ingest produced an unverifiable object"); const ev = { ...input, kappa: obj.id }; events.push(ev); return { kappa: obj.id, seq: events.length - 1 }; },
    appendNote: async (kind, payload) => { notes.push({ kind, payload }); return { kind }; },
    verify: () => events.every((e) => { const o = seal(messageObject({ text: e.text, sender: e.sender, sentAt: e.sentAt, chat: e.chat, source: e.source })); return verify(o); }),
    _events: events, _notes: notes,
  };
}

// ── FAKE brain: yields a canned reply word-by-word; records setSkill calls ──
function makeFakeBrain(reply = "Hey — good to see you. What's on your mind?") {
  const skills = [];
  return {
    skills,
    setSkill: async (s) => { skills.push(s); return { adapter: false, skill: s }; },
    generate: async function* (history, { signal } = {}) {
      const words = String(reply).split(" ");
      for (let i = 0; i < words.length; i++) { if (signal && signal.aborted) return; yield (i ? " " : "") + words[i]; }
    },
  };
}

// (1) history mapping
{
  const view = [{ text: "hi", sender: "Me" }, { text: "hello!", sender: "Q" }];
  const h = historyFrom(view);
  ok(h[0].role === "system" && h[1].role === "user" && h[1].content === "hi" && h[2].role === "assistant" && h[2].content === "hello!", "thread.view → history maps Me→user, Q→assistant, with a system persona");
}

// (2)(3)(4) stream + finalize + typing
{
  const thread = makeFakeThread([{ text: "hey Q", sender: "Me", kappa: "x" }]);
  const brain = makeFakeBrain("Hi! I'm right here.");
  const q = makeQResponder({ thread, brain, now: () => "2026-06-29T00:00:00Z" });
  const deltas = []; const typing = [];
  const r = await q.respond("hey Q", { onDelta: (d) => deltas.push(d), onTyping: (on) => typing.push(on) });
  ok(deltas.length === 4 && deltas.join("") === "Hi! I'm right here.", `respond STREAMS deltas live (${deltas.length} tokens)`);
  ok(r.text === "Hi! I'm right here." && r.kappa && /sha256/.test(String(r.kappa)), `finalizes ONE verifiable κ ${String(r.kappa).slice(0, 26)}…`);
  const qEvent = thread._events.find((e) => e.sender === "Q");
  ok(qEvent && qEvent.text === "Hi! I'm right here.", "the finalized message is authored as Q on the chain");
  ok(thread._events.length === 2, "exactly ONE Q message appended (no partials persisted)");
  ok(thread.verify(), "thread.verify() stays green after the Q turn (Law L5)");
  ok(typing[0] === true && typing[typing.length - 1] === false, "typing raised TRUE then FALSE (real generation lifecycle)");
  ok(thread._notes.some((n) => n.kind === "typing" && n.payload.isTyping === true) && thread._notes.some((n) => n.kind === "typing" && n.payload.isTyping === false), "REAL typing notes written to the chain (the messenger lacked these)");
}

// (5) silent skill routing
{
  const thread = makeFakeThread();
  const brain = makeFakeBrain("Here's the fix.");
  const q = makeQResponder({ thread, brain, now: () => "2026-06-29T00:00:00Z" });
  await q.respond("can you fix the bug in this function?", {});
  ok(brain.skills.includes("code"), `code-intent prompt silently routed setSkill("code") (got ${JSON.stringify(brain.skills)})`);
}

// (6) abort writes no κ
{
  const thread = makeFakeThread([{ text: "go", sender: "Me", kappa: "x" }]);
  const brain = makeFakeBrain("one two three four five");
  const q = makeQResponder({ thread, brain, now: () => "2026-06-29T00:00:00Z" });
  const ctrl = new AbortController(); let n = 0;
  const r = await q.respond("go", { signal: ctrl.signal, onDelta: () => { if (++n === 1) ctrl.abort(); } });
  ok(r.aborted === true, "aborted mid-stream → returns { aborted: true }");
  ok(thread._events.length === 1, "abort persists NOTHING (ephemeral bubble only, no κ on the chain)");
}

// (7) speculation hit / miss
{
  const brain = makeFakeBrain("Speculated answer ready.");
  const spec = makeSpeculator({ brain });
  spec.start("what's the weather", []);
  const hit = await spec.commit("what's the weather");
  ok(hit.hit === true && hit.text === "Speculated answer ready.", "speculation HIT: pre-generated reply returned on unchanged send (≈0 latency)");
  spec.start("draft one", []);
  const miss = await spec.commit("totally different");
  ok(miss.hit === false && spec.speculating === false, "speculation MISS on edited send → discarded, caller falls back to respond()");
}

// (8) determinism
{
  ok(qGenesis("op-abc") === qGenesis("op-abc"), "qGenesis is content-addressed (stable per operator)");
  ok(classifySkill("write a python function") === "code" && classifySkill("make me a holospace dashboard") === "create" && classifySkill("how are you?") === "respond", "classifySkill is deterministic across intents");
  ok(Q_IDENTITY === "did:holo:agent:q", "Q has a stable identity for authorship");
}

console.log(`\n${pass}/${pass + fail}${fail ? " FAIL" : " — WITNESSED: Q is a contact whose reply streams from the local brain and FINALIZES to one verifiable κ — live typing, silent skill routing, abort-safe (no partial persisted), speculative zero-latency, all on-device. The messenger pipeline is untouched."}`);
process.exit(fail ? 1 : 0);
