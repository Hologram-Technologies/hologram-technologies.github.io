// holo-voice-wake.mjs — W0: "Hey Q" wake word, built on the STREAMING EAR's partials (no separate KWS model, no
// download — the wake faculty IS the ear, so it's on-device + private by construction). Watches each rolling
// partial for the wake phrase, matched PHONETICALLY (the ASR renders "hey q" as "hey cue"/"hey queue"/"hey kew"),
// fires ONCE per utterance, strips the phrase, and hands the TRAILING command straight to the conversation — so
// "Hey Q, what's the weather?" is one breath, never "say it twice".
//
// Pure + DOM-free; onWake injected. The phrase is just text, so ANY wake word works with no model swap.

// tokenize keeping ORIGINAL tokens (casing/apostrophes for the downstream command) aligned 1:1 with a normalized
// form used only for matching — so the trailing command is returned verbatim ("what's the weather?", not "what s …").
function tokenize(text) {
  const orig = String(text || "").trim().split(/\s+/).filter(Boolean);
  const n = orig.map((w) => w.toLowerCase().replace(/[^a-z0-9']/g, ""));
  return { orig, n };
}
const editDist = (a, b) => { const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 0; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; };

// homophone variants for the short keywords the ASR most often mangles (single letters / names). The default
// covers "hey q"; a custom phrase can pass its own `variants` (per-word arrays) or just rely on edit distance.
const DEFAULT_VARIANTS = {
  q: ["q", "cue", "queue", "kew", "kyu", "cu", "kue", "qu"],
  hey: ["hey", "hay", "hi", "ay"],
  ok: ["ok", "okay"],
  computer: ["computer"],
};

function wordMatches(phraseWord, heard, variants) {
  if (heard === phraseWord) return true;
  const v = (variants && variants[phraseWord]) || DEFAULT_VARIANTS[phraseWord];
  if (v && v.includes(heard)) return true;
  return editDist(heard, phraseWord) <= Math.floor(phraseWord.length * 0.34);   // tolerant for longer words only
}

// makeWakeWord({ phrase, variants, onWake, cooldownMs, scanLead }) → { observe(partialText, atMs), reset(), armed() }
//   phrase     : the wake phrase, e.g. "hey q" (text — any phrase, no model).
//   variants   : optional { word: [forms] } overrides/extends the homophone map.
//   onWake     : ({ at, tail }) — fired ONCE when the phrase is heard; `tail` = the command after the phrase.
//   cooldownMs : ignore a re-fire within this window after a turn (debounce the growing-partial repeats / turn tail).
//   scanLead   : allow the phrase to start within the first N words (leading "um"/"ok" filler). Default 2.
export function makeWakeWord({ phrase = "hey q", variants = null, onWake = () => {}, cooldownMs = 1500, scanLead = 2 } = {}) {
  const pw = tokenize(phrase).n; const P = pw.length;
  let fired = false, lastWakeAt = -1e9;

  // match the phrase starting at index `i` (over normalized tokens `n`); return the ORIGINAL tail after it, or null.
  function matchAt(orig, n, i) {
    if (i + P > n.length) return null;
    for (let k = 0; k < P; k++) if (!wordMatches(pw[k], n[i + k], variants)) return null;
    return orig.slice(i + P).join(" ");
  }

  function observe(text, atMs = 0) {
    const { orig, n } = tokenize(text);
    if (fired) {                                                  // already armed: keep returning the growing command tail
      for (let i = 0; i <= Math.min(scanLead, n.length - P); i++) { const tail = matchAt(orig, n, i); if (tail != null) return { woke: false, armed: true, tail }; }
      return { woke: false, armed: true, tail: orig.join(" ") };
    }
    if (atMs - lastWakeAt < cooldownMs) return { woke: false, armed: false };   // debounce
    for (let i = 0; i <= Math.min(scanLead, Math.max(0, n.length - P)); i++) {
      const tail = matchAt(orig, n, i);
      if (tail != null) { fired = true; lastWakeAt = atMs; onWake({ at: atMs, tail }); return { woke: true, armed: true, tail }; }
    }
    return { woke: false, armed: false };
  }

  return { observe, reset() { fired = false; }, armed: () => fired };
}

// makeEchoSafeWake — W2: wrap a wake detector so Q can NEVER wake itself. While Q is speaking, its own TTS leaks
// into the mic and the ear transcribes it — if Q's response happens to contain the wake phrase, that must NOT
// self-wake. Gate: while speaking, only forward a partial to the wake detector when the mic energy passes the
// echo threshold (a genuine user talking OVER Q — the same gate barge-in uses). Q's own echo is below it → no
// self-wake. A real user over the top wakes (and the barge path stops Q). Off-speech, the wake detector is normal.
//   observe(partialText, { micLevel, qSpeaking, qOutputLevel, atMs }) → { woke, armed?, tail?, suppressed? }
export function makeEchoSafeWake({ wake, bargeFloor = 0.05, bargeEcho = 0.4, echoGuard = null } = {}) {
  if (!wake) throw new Error("makeEchoSafeWake needs a wake (makeWakeWord)");
  const isEcho = echoGuard || ((micLevel, qOutputLevel) => micLevel < Math.max(bargeFloor, (qOutputLevel || 0) * bargeEcho));
  function observe(text, ctx = {}) {
    if (ctx.qSpeaking && isEcho(ctx.micLevel == null ? 1 : ctx.micLevel, ctx.qOutputLevel)) return { woke: false, suppressed: true };
    return wake.observe(text, ctx.atMs || 0);
  }
  return { observe, reset: () => wake.reset(), armed: () => wake.armed() };
}

export default { makeWakeWord, makeEchoSafeWake };
