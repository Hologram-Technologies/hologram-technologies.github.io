// holo-sound.mjs — Holo Sound: the ONE universal audio router for Hologram.
//
// Runs in EVERY Hologram document — the top shell AND every app frame (the shell injects it on mount the
// same way it injects holo-q-app) — and transparently routes each eligible same-origin <audio>/<video>
// through the Holo Audio engine. So music, audiobooks, podcasts, and the audio track of streamed video all
// get the same exceptional sound: device-native Hi-Fi (EQ + air + brick-wall limiter), EBU-R128 loudness
// normalization, and — for music — the HRTF virtual-speaker stage. Zero per-app work: a surface just plays
// audio and it sounds exceptional. Complexity abstracted; simplicity delivered.
//
// HONEST + SAFE (this is audio — getting it wrong means silence):
//   • SAME-ORIGIN only. A Web Audio MediaElementSource taints + silences cross-origin no-cors media, and
//     once tapped there is NO native fallback — so we attach only to blob:/data:/same-origin sources.
//   • AFTER a user gesture only. The AudioContext can't run before one; attaching earlier would silence a
//     (possibly autoplaying) element with no way back. We arm on the first pointer/key/touch, then attach.
//   • LIVE MediaStreams (WebRTC / comms / mic) are never touched (el.srcObject ⇒ skip).
//   • Per element, once. Opt out with data-holo-sound="off". Wrapped in try/catch; on any doubt, untouched.
//
// Per-kind policy (override with data-holo-sound="music|speech|video|off"):
//   • music  → Hi-Fi + spatial(pref) + loudness     • speech (audiobook/podcast) → Vocal + loudness, no spatial
//   • video  → Hi-Fi + loudness, no spatial          (a movie's stage shouldn't be HRTF-rotated)
// Loudness per track: set data-holo-normalize="<dB>" (e.g. a κ manifest's normalizeDb) or data-holo-lufs,
// or call HoloSound.normalize(el, dB). Absent ⇒ 0 dB (still Hi-Fi + spatial). One spatial toggle for the
// whole OS (shared with the disc): HoloSound.spatial([on]).

const W = window, DOC = document;
if (W.HoloSound) { /* already inited in this document */ } else {

const SPATIAL_LS = "holo.sound.spatial.v1";                      // shared with holo-vinyl (one toggle, whole OS)
const SELF = (DOC.currentScript && DOC.currentScript.src) || "";
const SHARED = SELF ? SELF.replace(/holo-sound\.mjs.*$/, "") : "/_shared/";

const PROFILES = {
  music:  { preset: "Hi-Fi", spatial: true },
  speech: { preset: "Vocal", spatial: false },
  video:  { preset: "Hi-Fi", spatial: false },
};
const spatialPref = () => { try { const v = W.localStorage.getItem(SPATIAL_LS); return v === null ? true : v === "1"; } catch (e) { return true; } };

let armed = false, audioLibP = null;
const engines = new Set();                                       // attached { el, fx, profile }

function loadHoloAudio() {
  if (W.HoloAudio) return Promise.resolve(W.HoloAudio);
  if (audioLibP) return audioLibP;
  audioLibP = new Promise((resolve) => {
    try { const s = DOC.createElement("script"); s.src = SHARED + "holo-audio.js"; s.defer = true; s.setAttribute("data-holo-ephemeral", "");
      s.onload = () => resolve(W.HoloAudio || null); s.onerror = () => resolve(null); (DOC.head || DOC.documentElement).appendChild(s); }
    catch (e) { resolve(null); }
  });
  return audioLibP;
}

function profileName(el) {
  const d = (el.dataset && el.dataset.holoSound || "").toLowerCase();
  if (d === "off" || d === "comms" || d === "none") return null;
  if (PROFILES[d]) return d;
  return el.tagName === "VIDEO" ? "video" : "music";
}
function normDbOf(el) {
  const n = el.dataset && el.dataset.holoNormalize;
  if (n != null && n !== "" && isFinite(+n)) return +n;
  const l = el.dataset && el.dataset.holoLufs;                  // convenience: gain toward −16 LUFS (no peak guard here)
  if (l != null && l !== "" && isFinite(+l)) return Math.min(0, -16 - +l);
  return 0;
}
function eligible(el) {
  try {
    if (el.__holoSound || el.__holoSrc) return false;            // already routed (here or by another tap, e.g. the disc)
    if (el.srcObject) return false;                              // live MediaStream — comms/mic, never touch
    const url = el.currentSrc || el.src || ""; if (!url) return false;
    if (url.startsWith("blob:") || url.startsWith("data:")) return true;
    return new URL(url, location.href).origin === location.origin;   // same-origin only (cross-origin would silence)
  } catch (e) { return false; }
}

function attach(el) {
  if (!armed) return;                                            // wait for a user gesture (context can run)
  const prof = profileName(el); if (!prof) { el.__holoSound = "skip"; return; }
  if (!eligible(el)) return;
  loadHoloAudio().then((HA) => {
    if (!HA || !HA.create || el.__holoSound || el.__holoSrc || !eligible(el)) return;
    let fx; try { fx = HA.create(el); } catch (e) { return; }
    if (!fx || !fx.ok) return;
    el.__holoSound = fx; const rec = { el, fx, profile: prof }; engines.add(rec);
    const p = PROFILES[prof];
    try { fx.setPreset(p.preset); } catch (e) {}
    try { if (fx.canSpatial) fx.setSpatial(p.spatial && spatialPref()); } catch (e) {}
    try { if (fx.setNormalize) fx.setNormalize(normDbOf(el)); } catch (e) {}
    try { fx.resume(); } catch (e) {}
    // re-read per-track loudness when the source changes (surfaces update data-holo-normalize per track)
    el.addEventListener("loadeddata", () => { try { fx.setNormalize(normDbOf(el)); } catch (e) {} });
    el.addEventListener("play", () => { try { fx.resume(); } catch (e) {} });
    // SAFETY NET: if the context still can't run shortly after play, we cannot un-tap — but log nothing and
    // rely on the gesture gate (post-activation resume is reliable). Verified by the live meter (fx.level).
  });
}

function scan() { try { DOC.querySelectorAll("audio,video").forEach(attach); } catch (e) {} }

function arm() {
  if (armed) return; armed = true;
  scan();                                                       // attach to anything already present + playing
  try { ["pointerdown", "keydown", "touchstart"].forEach((t) => W.removeEventListener(t, arm, true)); } catch (e) {}
}

function init() {
  // observe the document for new media (apps mount players lazily) + attach on first real play
  try {
    const mo = new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === "AUDIO" || n.tagName === "VIDEO") attach(n);
      else if (n.querySelectorAll) n.querySelectorAll("audio,video").forEach(attach);
    } });
    mo.observe(DOC.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  // also catch the first play of any media (covers elements created+played before they're observed)
  try { DOC.addEventListener("play", (e) => { const t = e.target; if (t && (t.tagName === "AUDIO" || t.tagName === "VIDEO")) attach(t); }, true); } catch (e) {}
  // arm on the first user gesture (so the AudioContext can run)
  if (W.navigator && W.navigator.userActivation && W.navigator.userActivation.hasBeenActive) armed = true;
  if (armed) { scan(); }
  else { try { ["pointerdown", "keydown", "touchstart"].forEach((t) => W.addEventListener(t, arm, true)); } catch (e) {} }
}

W.HoloSound = {
  // read or set the OS-wide spatial preference (shared with the disc); re-applies to media in THIS document.
  spatial(on) {
    if (on === undefined) return spatialPref();
    on = !!on; try { W.localStorage.setItem(SPATIAL_LS, on ? "1" : "0"); } catch (e) {}
    engines.forEach((r) => { if (r.fx.canSpatial) { try { r.fx.setSpatial(PROFILES[r.profile].spatial && on); } catch (e) {} } });
    return on;
  },
  normalize(el, db) { try { if (el && el.__holoSound && el.__holoSound.setNormalize) el.__holoSound.setNormalize(+db || 0); } catch (e) {} },
  attached() { return engines.size; },
  rescan: scan,
  engineFor(el) { return el && el.__holoSound && el.__holoSound.ok ? el.__holoSound : null; },
};

if (DOC.readyState === "loading") DOC.addEventListener("DOMContentLoaded", init); else init();

}
