// holo-learning.mjs — the VISIBLE, honest face of the self-evolving layer (A4). Q quietly learns you
// (encrypted memory → profile → per-user adapter); this surfaces it WITHOUT jargon and keeps you in control:
//   • a one-time Inbox LETTER "I'm getting to know you" with what Q has noticed (your interests), in plain
//     language, stating it's on-device and never shared;
//   • RESET — delete what Q has learned (the adapter + memory);
//   • PAUSE — stop learning (a flag the trainer/scheduler checks).
// Zero config; the user always sees it + controls it. 100% local; nothing egresses. window.HoloLearning.
const PAUSE_KEY = "holo.learn.paused.v1", LETTER_KEY = "holo.learn.lettered.v1";

export function isPaused() { try { return localStorage.getItem(PAUSE_KEY) === "1"; } catch (e) { return false; } }
export function pauseLearning(on) { try { localStorage.setItem(PAUSE_KEY, on ? "1" : "0"); } catch (e) {} return !!on; }

// resetLearning — "reset what Q has learned about me": delete the per-user adapter + wipe memory + re-distill
// (so the profile empties). One honest control; fail-soft per piece.
export async function resetLearning() {
  const ok = { adapter: false, memory: false };
  try { if (typeof window !== "undefined" && window.HoloUserAdapter) ok.adapter = await window.HoloUserAdapter.reset(); } catch (e) {}
  try { if (typeof window !== "undefined" && window.HoloMemory && window.HoloMemory.forget) { await window.HoloMemory.forget(); ok.memory = true; } } catch (e) {}
  try { if (typeof window !== "undefined" && window.HoloProfile && window.HoloProfile.refresh) window.HoloProfile.refresh(); } catch (e) {}
  return ok;
}

// learnedSummary — a plain, honest readout of what Q has noticed (for the letter + a settings view).
export function learnedSummary() {
  try {
    const p = (typeof window !== "undefined" && window.HoloProfile && window.HoloProfile.profile) ? window.HoloProfile.profile() : null;
    return { interests: (p && p["holo:interests"]) || [], observations: (p && p["holo:observations"]) || 0, hasAdapter: false };
  } catch (e) { return { interests: [], observations: 0, hasAdapter: false }; }
}

// postLearningLetter — once, when Q has actually learned something, drop a plain-language letter in the Inbox.
export function postLearningLetter({ force = false } = {}) {
  try {
    if (!force && localStorage.getItem(LETTER_KEY)) return false;                 // once
    const s = learnedSummary();
    if (!s.observations && !s.interests.length) return false;                     // nothing learned yet → stay quiet
    const body = s.interests.length
      ? "So far I've noticed you're into " + s.interests.slice(0, 5).join(", ") + ". I'll quietly tailor your apps, what I surface, and how I answer — all on your device, never shared. You're in control: say “reset what you've learned” or pause me anytime."
      : "I'm starting to learn what you like — kept on your device, never shared. You can reset or pause me anytime.";
    if (typeof window !== "undefined" && window.HoloNotify && window.HoloNotify.q) {
      window.HoloNotify.q({ category: "letter", sender: "Q", title: "I'm getting to know you", body, deepLink: { kind: "holo", value: "learning" } });
      localStorage.setItem(LETTER_KEY, "1"); return true;
    }
    return false;
  } catch (e) { return false; }
}

// captureUpvote(prompt, reply) — the REPLY-CAPTURE: when you 👍 a Q reply, store the (prompt, REPLY) pair so
// the trainer learns from a real example (reply-masked SFT), not just your phrasing. Writes to your encrypted
// memory (meta.reply); refreshes the profile. 100% local. This is what upgrades A0 from "style" to reply-SFT.
export async function captureUpvote(prompt, reply) {
  if (isPaused()) return false;
  const p = String(prompt || ""), r = String(reply || "");
  try { if (typeof window !== "undefined" && window.HoloMemory && window.HoloMemory.remember) { await window.HoloMemory.remember({ kind: "feedback", text: p, vote: "up", meta: { reply: r } }); try { window.HoloProfile && window.HoloProfile.refresh && window.HoloProfile.refresh(); } catch (e) {} return true; } } catch (e) {}
  try { if (typeof window !== "undefined" && window.Q && window.Q.remember) { window.Q.remember({ vote: "up", intent: p, meta: { reply: r } }); return true; } } catch (e) {}
  return false;
}

if (typeof window !== "undefined" && !window.HoloLearning) {
  window.HoloLearning = Object.freeze({ isPaused, pauseLearning, resetLearning, learnedSummary, postLearningLetter, captureUpvote });
  // post the letter once memory is ready (so the interests are populated), deferred + non-blocking.
  try { document.documentElement.addEventListener("holo-memory-ready", () => setTimeout(() => postLearningLetter(), 2500), { once: true }); } catch (e) {}
  try { setTimeout(() => postLearningLetter(), 5000); } catch (e) {}   // fallback if the event already fired
}
export default { isPaused, pauseLearning, resetLearning, learnedSummary, postLearningLetter, captureUpvote };
