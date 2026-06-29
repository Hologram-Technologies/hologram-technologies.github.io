// holo-q-seed.mjs — Q's COLD-START INSTANT answers. A tiny, SHIPPED table of pre-sealed canonical replies to the
// handful of things a brand-new user predictably asks first (hi · who are you · what can you do · is this private
// · what is this · getting started · thanks). Checked BEFORE any model, so the very first turn returns in O(1) with
// ZERO model load and ZERO network — Q feels alive the instant you ask, while the full brain's κ-shards stream in.
//
// These are Q's REAL canonical answers (Law L5: pre-sealed content, not fabrication), each carrying a content κ for
// provenance. A novel phrasing simply MISSES and falls through to the live on-device brain — honest by design.
// Ported verbatim from the proven voice loop (holo-voice.js L0 seed κ-memo) so chat + voice answer identically.

export const SEED_ENTRIES = [
  { keys: ["hi", "hello", "hey", "yo", "hiya", "hey q", "hi q", "hello q", "good morning", "good afternoon", "good evening", "sup"],
    a: "Hello. I'm Q. I'm yours, and I learn as you do. Ask me anything, or tell me what to do." },
  { keys: ["who are you", "what are you", "what is q", "who is q", "whats q", "tell me about yourself", "what r u"],
    a: "I'm Q, the mind of this OS, running entirely on your device. Nothing you say to me leaves it unless you ask. I can answer you, and I can act across the whole OS." },
  { keys: ["what can you do", "what can you help with", "what do you do", "help", "capabilities", "what can i ask you", "what can i ask", "how can you help", "what are you capable of"],
    a: "Two things: I answer you, and I act for you. Try “open files”, “change the theme”, or “take me to settings”, or just ask a question. I can see and act across your whole OS." },
  { keys: ["is this private", "is it private", "are you private", "is my data safe", "does anything leave my device", "do you send my data", "where does my data go", "is my data private", "do you store my data", "do you collect my data"],
    a: "Private by default. I run on your device. Your words, files, and actions stay here. Nothing leaves unless you explicitly choose to send it." },
  { keys: ["what is hologram", "what is hologram os", "what is this", "what is this os", "whats this", "what is holo", "what is this place"],
    a: "This is Hologram, a sovereign OS that runs entirely on your device. Everything here is yours: your files, apps, and data, addressed by content and verifiable. I'm Q, your guide through it." },
  { keys: ["how do i start", "getting started", "what should i do", "where do i begin", "how do i get started", "what now", "where do i start", "how does this work"],
    a: "Start anywhere. Open Files to see what's yours, or just tell me what you want to make and I'll build it with you. Nothing here is permanent until you say so." },
  { keys: ["thanks", "thank you", "thx", "ty", "cheers", "thank you q", "much appreciated"],
    a: "Anytime." },
];

let _seedMap = null;
function seedMap() { if (!_seedMap) { _seedMap = new Map(); for (const e of SEED_ENTRIES) for (const k of e.keys) _seedMap.set(k, e.a); } return _seedMap; }
function seedNorm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(); }
const SEED_FILLER = /^((?:hey|hi|hello|ok|okay|yo|please|q|so|um|uh)\s+)+/;

// content κ for a sealed answer (FNV-1a) — a provenance marker that this is a fixed, addressable answer.
export function seedKappa(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return "seed:" + ("0000000" + h.toString(16)).slice(-8); }

// O(1) lookup: exact normalized match, then with a leading greeting/filler and a trailing "q" address stripped.
// Returns the canonical answer string, or null (→ caller falls through to the live brain). Pure.
export function seedLookup(text) {
  const m = seedMap(), n = seedNorm(text);
  if (!n) return null;
  if (m.has(n)) return m.get(n);
  const stripped = n.replace(SEED_FILLER, "").replace(/\s+q$/, "").trim();
  if (stripped && stripped !== n && m.has(stripped)) return m.get(stripped);
  return null;
}

if (typeof window !== "undefined" && !window.HoloQSeed) window.HoloQSeed = { SEED_ENTRIES, seedLookup, seedKappa };

export default { SEED_ENTRIES, seedLookup, seedKappa };
