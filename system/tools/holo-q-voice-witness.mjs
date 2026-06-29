// holo-q-voice-witness.mjs — proves the Q voice-note flow (holo-q-voice.mjs) in Node with a FAKE ear (ASR),
// FAKE voice (TTS), and a FAKE κ media store, over a fake thread backed by the REAL seal/verify. No audio I/O.
//
// Proves: (1) a voice note → transcript becomes YOUR message with the audio attached as a media κ; (2) Q replies
// and, when speak=true, Q's reply κ ALSO carries an AudioObject media κ (one message, text + voice); (3) speak=false
// → Q reply is text-only; (4) the transcript drives silent skill routing; (5) abort writes no Q κ; (6) the
// messages are real verifiable κ (thread.verify green) with media links sealed in.

import { makeQVoice } from "../os/usr/lib/holo/q/holo-q-voice.mjs";
import { seal, verify } from "../os/usr/lib/holo/holo-object.mjs";
import { messageObject } from "../os/usr/lib/holo/holo-pluck.mjs";
import { createHash } from "node:crypto";

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "  ok  " : "  XX  ") + m); c ? pass++ : fail++; };

function makeFakeThread() {
  const events = [], notes = [];
  return {
    view: () => events.map((e, i) => ({ text: e.text, sender: e.sender, seq: i, media: e.media || [] })),
    ingest: async (input) => { const obj = seal(messageObject(input)); if (!verify(obj)) throw new Error("unverifiable"); const ev = { ...input, kappa: obj.id }; events.push(ev); return { kappa: obj.id, seq: events.length - 1 }; },
    appendNote: async (kind, payload) => { notes.push({ kind, payload }); return { kind }; },
    verify: () => events.every((e) => verify(seal(messageObject({ text: e.text, sender: e.sender, sentAt: e.sentAt, chat: e.chat, source: e.source, media: e.media })))),
    _events: events, _notes: notes,
  };
}
function makeFakeBrain(reply = "Sure — here's what I think.") {
  const skills = [];
  return { skills, setSkill: async (s) => { skills.push(s); }, generate: async function* (h, { signal } = {}) { for (const w of String(reply).split(" ")) { if (signal && signal.aborted) return; yield " " + w; } } };
}
const kOf = (bytes) => "sha256:" + createHash("sha256").update(Buffer.from(bytes)).digest("hex");
function makeFakeMediaStore() { const seen = []; return { put: async (bytes) => { const k = kOf(bytes); seen.push(k); return k; }, _seen: seen }; }
const fakeTTS = async (text) => ({ bytes: new TextEncoder().encode("PCM:" + text), mime: "audio/x-pcm-f32", meta: { sampleRate: 24000 } });

// (1)(2)(6) inbound voice note, Q speaks back
{
  const thread = makeFakeThread(), brain = makeFakeBrain("Right here with you."), media = makeFakeMediaStore();
  const asr = async () => "what's the plan for today";
  const v = makeQVoice({ thread, brain, asr, tts: fakeTTS, mediaStore: media, now: () => "2026-06-29T00:00:00Z" });
  const r = await v.inbound({ audio: new Uint8Array([1, 2, 3, 4]), mime: "audio/x-pcm-f32" }, { speak: true });
  ok(r.transcript === "what's the plan for today", "voice note transcribed (on-device ASR)");
  const userMsg = thread._events.find((e) => e.sender === "Me");
  ok(userMsg && userMsg.text === r.transcript && userMsg.media && userMsg.media.length === 1, "your message carries the transcript + the audio as a media κ");
  const qMsg = thread._events.find((e) => e.sender === "Q");
  ok(qMsg && qMsg.media && qMsg.media.length === 1 && /^sha256:/.test(qMsg.media[0].kappa), "Q's reply κ carries a spoken AudioObject (text + voice, one message)");
  ok(r.reply === "Right here with you." && /sha256/.test(String(r.replyKappa)), "Q reply finalized to a verifiable κ");
  ok(thread.verify(), "thread.verify() green with media links sealed in (Law L5)");
  ok(media._seen.length === 2, "two audio leaves stored by content address (your note + Q's reply)");
}

// (3) speak=false → Q reply text-only
{
  const thread = makeFakeThread(), brain = makeFakeBrain("Text only."), media = makeFakeMediaStore();
  const v = makeQVoice({ thread, brain, asr: async () => "hello", tts: fakeTTS, mediaStore: media, now: () => "2026-06-29T00:00:00Z" });
  const r = await v.inbound({ audio: new Uint8Array([9]) }, { speak: false });
  ok((r.replyMedia || []).length === 0, "speak=false → Q reply is text-only (no synthesized audio)");
  const qMsg = thread._events.find((e) => e.sender === "Q");
  ok(qMsg && !(qMsg.media && qMsg.media.length), "Q reply κ has no media when not spoken");
}

// (4) transcript drives silent skill routing
{
  const thread = makeFakeThread(), brain = makeFakeBrain("Fixed.");
  const v = makeQVoice({ thread, brain, asr: async () => "fix the bug in this function please", tts: fakeTTS, mediaStore: makeFakeMediaStore(), now: () => "t" });
  await v.inbound({ audio: new Uint8Array([1]) }, { speak: false });
  ok(brain.skills.includes("code"), `spoken code request silently routed setSkill("code") (got ${JSON.stringify(brain.skills)})`);
}

// (5) abort writes no Q κ
{
  const thread = makeFakeThread(), brain = makeFakeBrain("one two three four");
  const v = makeQVoice({ thread, brain, asr: async () => "go", tts: fakeTTS, mediaStore: makeFakeMediaStore(), now: () => "t" });
  const ctrl = new AbortController(); let n = 0;
  const r = await v.inbound({ audio: new Uint8Array([1]) }, { signal: ctrl.signal, speak: true, onDelta: () => { if (++n === 1) ctrl.abort(); } });
  ok(r.aborted === true, "aborted mid-reply → { aborted: true }");
  ok(!thread._events.some((e) => e.sender === "Q"), "abort persists no Q message (your voice note stays; no half reply)");
}

console.log(`\n${pass}/${pass + fail}${fail ? " FAIL" : " — WITNESSED: a voice note to Q transcribes on-device, becomes your message with the audio attached, and Q answers in text + its own voice — one verifiable κ per turn, skill-routed, abort-safe, serverless."}`);
process.exit(fail ? 1 : 0);
