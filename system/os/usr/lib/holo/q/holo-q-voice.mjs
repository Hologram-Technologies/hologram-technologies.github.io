// holo-q-voice.mjs — VOICE NOTES with Q (M5). A voice note to Q transcribes on-device, Q answers, and Q can
// answer with its own voice — all in the same chat thread, text and voice interchangeable.
//
// Flow (inbound): your audio → ASR (Whisper/Moonshine, on-device) → the transcript becomes your message (with
// the audio attached as an AudioObject media κ) → Q replies via the normal responder (stream→finalize), and if
// `speak`, Q's reply κ also carries a Kokoro-synthesized AudioObject. Nothing leaves the device; the audio is a
// content-addressed leaf in the κ-store, referenced by the message — exactly how the messenger already models media.
//
// ASR / TTS / the media store are INJECTED, so the orchestration is Node-witnessable with fakes (holo-q-voice-
// witness.mjs). The browser binding wires the real createASR/createTTS (holo-voice-asr/-tts) + a κ media store.
//
// Authority: holo-voice-asr (createASR.transcribe) · holo-voice-tts (createTTS.synth → {audio,sampling_rate}) ·
//   holo-q-contact (makeQResponder, stream→finalize) · holo-pluck media links (schema:AudioObject) · Law L5.

import { makeQResponder } from "./holo-q-contact.mjs";

// makeQVoice({ thread, brain, asr, tts, mediaStore, now, responder })
//   asr({ audio, mime })           → Promise<string transcript>
//   tts(text)                      → Promise<{ bytes:Uint8Array, mime?, meta? }>   (passed through to the responder)
//   mediaStore.put(bytes, mime, m) → Promise<κ>   (content-addressed leaf; verify-on-fetch downstream)
export function makeQVoice({ thread, brain, asr = null, tts = null, mediaStore = null, now = () => new Date().toISOString(), responder = null } = {}) {
  const q = responder || makeQResponder({ thread, brain, now });

  // inbound(voiceNote, opts) — a voice note TO Q. Transcribes, posts it as YOUR message (audio + transcript),
  // then streams Q's reply (spoken by default). Returns { transcript, reply, replyKappa, replyMedia, aborted }.
  async function inbound({ audio = null, mime = "audio/x-pcm-f32" } = {}, { onDelta = () => {}, onTyping = () => {}, signal = null, speak = true } = {}) {
    if (!asr) throw new Error("holo-q-voice: no ASR bound");
    const transcript = String((await asr({ audio, mime })) || "").trim();
    let userMedia = [];
    if (mediaStore && audio) { try { const k = await mediaStore.put(audio, mime, null); if (k) userMedia = [{ kappa: k, mime, kind: "schema:associatedMedia" }]; } catch (e) {} }
    // your voice note becomes a message on the chain (transcript shown, audio attached) — verify-before-trust on render
    await thread.ingest({ text: transcript, sender: "Me", sentAt: now(), chat: "Q", source: "holo", ...(userMedia.length ? { media: userMedia } : {}) });
    const r = await q.respond(transcript, { onDelta, onTyping, signal, speak, tts, mediaStore });
    return { transcript, reply: r.text, replyKappa: r.kappa, replyMedia: r.media || [], aborted: !!r.aborted };
  }

  return { inbound, respond: q.respond };
}

// ── browser binding: window.HoloQVoice.create({ thread, brain }) → a ready voice contact ──
// Wires the REAL on-device engines: createASR().transcribe for the ear, createTTS().synth for Q's voice, and a
// minimal κ media store (sha256 content address + an object URL for immediate playback; swap in the OPFS κ-store
// for durable media). All on-device, serverless. Lazy + fail-soft: if a vendored engine is missing, voice simply
// isn't offered and text chat is unaffected.
if (typeof window !== "undefined" && !window.HoloQVoice) {
  window.HoloQVoice = {
    makeQVoice,
    async create({ thread, brain, voice = "af_heart" } = {}) {
      const here = new URL("../voice/", import.meta.url).href;
      const [{ createASR }, { createTTS }] = await Promise.all([
        import(/* @vite-ignore */ here + "holo-voice-asr.mjs"),
        import(/* @vite-ignore */ here + "holo-voice-tts.mjs"),
      ]);
      const rec = createASR(); const speaker = createTTS({ voice });
      const asr = async ({ audio }) => { const r = await rec.transcribe(audio); return r && r.text; };
      // synth → {audio:Float32Array, sampling_rate}; carry raw PCM bytes + the rate so the UI can play it back.
      const tts = async (text) => { const a = await speaker.synth(text); const f = a && a.audio; if (!f) return null; return { bytes: new Uint8Array(f.buffer, f.byteOffset, f.byteLength), mime: "audio/x-pcm-f32", meta: { sampleRate: a.sampling_rate } }; };
      // minimal κ media store: content address by SHA-256, hold bytes + a playable blob URL (mime-agnostic).
      const SUB = globalThis.crypto && globalThis.crypto.subtle;
      const blobs = new Map();
      const mediaStore = {
        async put(bytes, mime) { const d = SUB ? new Uint8Array(await SUB.digest("SHA-256", bytes)) : bytes; let h = ""; for (const b of d) h += b.toString(16).padStart(2, "0"); const k = "sha256:" + h.slice(0, 64); try { blobs.set(k, URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }))); } catch (e) {} return k; },
        url(k) { return blobs.get(k) || null; },
      };
      return { ...makeQVoice({ thread, brain, asr, tts, mediaStore }), mediaStore, _engines: { rec, speaker } };
    },
  };
}

export default { makeQVoice };
