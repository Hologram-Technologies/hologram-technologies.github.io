// q-live-hero.mjs — Q LIVE CALL: talk to Q out loud, it streams voice back in realtime. Additive weld of the
// PROVEN realtime speech-to-speech loop (apps/q/q-live.mjs createQLive) into the summoned messenger hero.
//
// The loop already does every hard part (token streaming, speak-as-generated clause pipeline, semantic
// turn-taking, barge-in, speculative sub-second turns, latency metrics). This module is the thin surface weld:
//   · a "Call" button in the hero (fixed sibling — React-reconciliation-proof, same idiom as the chips)
//   · tap → arm() INSIDE the gesture (unlock audio) → start() the loop → a live-caption call overlay
//   · bridge the loop's state + getLevel() → window `holo-q-state {mode,level}` so the hero orb reacts (it
//     already listens); q-live emits on its own bus and does NOT dispatch the window event, so we do.
//   · each finished turn → window.HoloQ.liveIngest(role,text) → a real κ bubble in the ONE Q thread, which
//     the summon layer's observer then seals to the BLAKE3 κ-chain. Call and chat are one conversation.
//   · graceful ladder: no mic permission / no WebGPU → a clear message, chat still works. Never a hard fail.
//
// 100% serverless, on-device: Moonshine/Whisper ASR + BitNet + Kokoro TTS + Silero VAD, 0 egress at turn time.
const DOC = document, HTML = DOC.documentElement;
const $ = (s, r) => (r || DOC).querySelector(s);
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

// ── styles ────────────────────────────────────────────────────────────────────────────────────────────────
const css = DOC.createElement("style");
css.id = "q-live-css";
css.textContent = `
/* the Call affordance — a quiet pill above the composer, right of the chips row */
#q-call-btn{position:fixed;right:16px;bottom:calc(env(safe-area-inset-bottom) + 20px);z-index:306;
  display:none;align-items:center;gap:7px;height:40px;padding:0 15px;border-radius:20px;cursor:pointer;
  color:#eef3fb;font:600 13.5px/1 -apple-system,"Segoe UI",Roboto,sans-serif;border:1px solid rgba(139,123,255,.4);
  background:linear-gradient(135deg,rgba(46,58,82,.72),rgba(30,38,54,.72));
  backdrop-filter:blur(20px) saturate(150%);-webkit-backdrop-filter:blur(20px) saturate(150%);
  box-shadow:0 4px 18px rgba(0,0,0,.32);transition:transform .14s ease,border-color .16s ease,box-shadow .16s ease}
#q-call-btn.on{display:inline-flex}
#q-call-btn:hover{transform:translateY(-1px);border-color:rgba(139,123,255,.7);box-shadow:0 6px 24px rgba(139,123,255,.35)}
#q-call-btn:active{transform:scale(.96)}
#q-call-btn svg{width:16px;height:16px}
/* the call overlay — full-bleed over the hero: orb breathes (via holo-q-state), live caption, end button */
#q-call{position:fixed;inset:0;z-index:330;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:22px;padding:32px 24px calc(env(safe-area-inset-bottom) + 32px);text-align:center;
  background:radial-gradient(120% 100% at 50% 34%,rgba(9,11,18,.62),rgba(6,7,12,.86) 62%,rgba(0,0,0,.92));
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);
  opacity:0;transition:opacity .4s ease;pointer-events:none}
#q-call.on{opacity:1;pointer-events:auto}
#q-call .qc-status{font:600 12.5px/1.3 -apple-system,"Segoe UI",sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#7defc9;min-height:1.2em}
#q-call .qc-you{font:400 15px/1.5 -apple-system,"Segoe UI",sans-serif;color:rgba(231,237,250,.62);max-width:min(680px,86vw);min-height:1.5em;transition:opacity .2s ease}
#q-call .qc-q{font:300 clamp(19px,3.1vh,28px)/1.42 -apple-system,"Segoe UI",sans-serif;color:#f4f7fc;max-width:min(720px,90vw);min-height:1.42em;text-shadow:0 2px 22px rgba(0,0,0,.6)}
#q-call .qc-hint{font:400 12.5px/1.4 -apple-system,"Segoe UI",sans-serif;color:rgba(231,237,250,.42);max-width:340px}
#q-call .qc-end{margin-top:6px;height:52px;padding:0 26px;border-radius:26px;border:0;cursor:pointer;
  color:#fff;font:600 15px/1 -apple-system,"Segoe UI",sans-serif;display:inline-flex;align-items:center;gap:9px;
  background:linear-gradient(135deg,#ff5b7b,#e0245e);box-shadow:0 8px 26px rgba(224,36,94,.42);transition:transform .14s ease,filter .16s ease}
#q-call .qc-end:hover{filter:brightness(1.06)}#q-call .qc-end:active{transform:scale(.96)}
#q-call .qc-end svg{width:18px;height:18px}
#q-call.err .qc-status{color:#ffb3c0}
@media (prefers-reduced-motion:reduce){#q-call{transition:opacity .2s ease}}
`;
DOC.head.appendChild(css);

const PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>';
const HANGUP = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.1.2-4.5.6v3.1c0 .5-.3.9-.7 1.1-.9.4-1.7.9-2.5 1.5-.2.2-.5.3-.8.3-.3 0-.6-.1-.8-.4L.3 13.4a1.1 1.1 0 0 1 0-1.6C3.1 9.2 7.3 7.5 12 7.5s8.9 1.7 11.7 4.3a1.1 1.1 0 0 1 0 1.6l-1.7 2.3c-.2.3-.5.4-.8.4-.3 0-.6-.1-.8-.3-.8-.6-1.6-1.1-2.5-1.5a1.2 1.2 0 0 1-.7-1.1V9.6C15.1 9.2 13.6 9 12 9z"/></svg>';

// ── the loop (lazy, one shared instance) + orb-state bridge ──────────────────────────────────────────────
let live = null, callEl = null, rafId = 0, sealedYou = "", lastQ = "";
function setStatus(t, err) { if (!callEl) return; const s = $(".qc-status", callEl); if (s) s.textContent = t || ""; callEl.classList.toggle("err", !!err); }
function setYou(t) { if (callEl) { const e = $(".qc-you", callEl); if (e) e.textContent = t ? "“" + t + "”" : ""; } }
function setQ(t) { if (callEl) { const e = $(".qc-q", callEl); if (e) e.textContent = t || ""; } }
function orb(mode, level) { try { window.dispatchEvent(new CustomEvent("holo-q-state", { detail: { mode, level } })); } catch {} }
function pumpOrb() {
  if (!live) return;
  const lvl = (live.getLevel ? live.getLevel() : 0) || 0;
  const mode = live.phase || "idle";
  orb(mode, lvl);
  rafId = requestAnimationFrame(pumpOrb);
}

function overlay() {
  if (callEl) return callEl;
  callEl = DOC.createElement("div");
  callEl.id = "q-call";
  callEl.innerHTML =
    '<div class="qc-status">connecting…</div>' +
    '<div class="qc-you"></div>' +
    '<div class="qc-q"></div>' +
    '<div class="qc-hint">Just talk — Q hears you and answers out loud. Speak over it any time.</div>' +
    '<button class="qc-end" aria-label="End call">' + HANGUP + 'End call</button>';
  $(".qc-end", callEl).onclick = endCall;
  DOC.body.appendChild(callEl);
  return callEl;
}

let _lastSealedQ = "", _mod = null, _armed = false, _lastWarn = "";

// PRELOAD on hero-open (idle) so the loop module + instance exist BEFORE the tap — then arm() can run
// SYNCHRONOUSLY inside the click gesture (audio-unlock is gesture-bound; a dynamic import() await would
// close the gesture window and leave audio silently locked — the exact arm() footgun).
function preload() {
  if (_mod || live) return;
  import("../q/q-live.mjs").then((m) => { _mod = m; try { ensureLive(); } catch {} }).catch(() => {});
}
function wireEvents(l) {
  l.on("state", (s) => { orb(s); setStatus(s === "listening" ? "listening" : s === "thinking" ? "thinking…" : s === "speaking" ? "speaking" : "ready"); });
  l.on("partial", (t) => setYou(t));
  l.on("final", (t) => { const txt = String(t || "").trim(); if (txt && txt !== sealedYou) { sealedYou = txt; setYou(txt); try { window.HoloQ && window.HoloQ.liveIngest && window.HoloQ.liveIngest("me", txt); } catch {} try { window.HoloQ && window.HoloQ.remember && window.HoloQ.remember(txt); } catch {} } });   // ONE MEMORY: what you say out loud is remembered in chat too
  l.on("reply", (full) => { lastQ = String(full || ""); setQ(lastQ); });
  l.on("spoken", (cap) => { if (cap) setQ(cap); });
  l.on("bargein", () => setStatus("listening"));
  l.on("metrics", (m) => { if (m && m.total != null && lastQ && lastQ !== _lastSealedQ) { _lastSealedQ = lastQ; try { window.HoloQ && window.HoloQ.liveIngest && window.HoloQ.liveIngest("q", lastQ); } catch {} } });
  l.on("warn", (w) => { _lastWarn = String(w || ""); try { console.debug("[q-live]", w); } catch {} });   // kept so a failed start can name the real cause
  l.on("progress", (p) => { if (p && p.phase) setStatus((p.phase === "ear" ? "waking my ears" : p.phase === "voice" ? "warming my voice" : p.phase === "brain" ? "waking up" : "loading") + "…"); });
}
function ensureLive() {
  if (live || !_mod) return live;
  let persona = ""; try { persona = (window.HoloQ && window.HoloQ.persona) ? window.HoloQ.persona() : ""; } catch {}
  live = _mod.createQLive(persona ? { persona } : {});
  wireEvents(live);
  return live;
}
// SYNCHRONOUS audio unlock — MUST run first thing in the click stack (before any await).
function armNow() {
  const inst = ensureLive();
  if (inst && !_armed) { try { inst.arm(); _armed = true; } catch {} }
  else if (!inst) {   // module still loading → best-effort raw unlock so audio isn't dead-on-arrival
    try { const ac = window.__qCallAC || (window.__qCallAC = new (window.AudioContext || window.webkitAudioContext)()); const b = ac.createBuffer(1, 1, 22050); const s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(0); if (ac.resume) ac.resume(); } catch {}
  }
}
async function startCall() {
  if (live && live.active) return;
  const el = overlay();
  requestAnimationFrame(() => el.classList.add("on"));
  setStatus("connecting…"); setYou(""); setQ(""); sealedYou = ""; lastQ = ""; _lastSealedQ = ""; _lastWarn = "";
  orb("thinking", 0);   // the orb stirs THE INSTANT you tap Call — a live presence, before the loop loads
  if (!_mod) { try { _mod = await import("../q/q-live.mjs"); } catch (e) { setStatus("voice unavailable", true); setQ("I couldn't load my voice just now — you can still type to me."); orb("idle", 0); return; } }
  const inst = ensureLive();
  if (!inst) { setStatus("voice unavailable", true); setQ("I couldn't start my voice just now — you can still type to me."); orb("idle", 0); return; }
  if (!_armed) { try { inst.arm(); _armed = true; } catch {} }   // arm if the sync path couldn't (module loaded late)
  try {
    await inst.start();
    // Q REMEMBERS YOU (voice): the loop rebuilds its system turn from brain.persona() at load, so inject what Q
    // knows about the person AFTER start — the call opens already aware of your name / what you're building.
    try {
      if (window.HoloQ && window.HoloQ.recall && inst.history && inst.history[0]) {
        const facts = await window.HoloQ.recall("", 6);
        if (facts && facts.length) inst.history[0].content += "\n\nWhat you already know about the person you're talking with (private, on this device — use naturally, don't recite): " + facts.join("; ") + ".";
      }
    } catch (e) {}
    setStatus("listening");
    cancelAnimationFrame(rafId); rafId = requestAnimationFrame(pumpOrb);
  } catch (e) {
    const msg = (e && e.name === "NotAllowedError") ? "I'd love to hear you — allow microphone access and tap Call again."
      : (_lastWarn ? ("I couldn't get my voice going (" + _lastWarn.slice(0, 80) + "). You can still type to me.")
      : "I need a mic and a WebGPU browser (Chrome, Edge, or Brave) to talk out loud. You can still type to me.");
    setStatus("can't start the call", true); setQ(msg); orb("idle", 0);
  }
}

function endCall() {
  try { live && live.stop(); } catch {}
  live = null; _armed = false;   // a fresh instance next call needs a fresh arm(); module stays cached
  cancelAnimationFrame(rafId); rafId = 0;
  orb("idle", 0);
  if (callEl) { callEl.classList.remove("on"); }
}

// ── the Call button, injected into the hero (shown while the hero is open) ───────────────────────────────
let btnEl = null;
function ensureButton() {
  if (btnEl) return;
  btnEl = DOC.createElement("button");
  btnEl.id = "q-call-btn";
  btnEl.setAttribute("aria-label", "Call Q — talk out loud");
  btnEl.innerHTML = PHONE + "<span>Call</span>";
  // click IS the gesture: armNow() unlocks audio SYNCHRONOUSLY (before any await), then startCall() loads + starts.
  btnEl.onclick = () => { armNow(); startCall(); };
  DOC.body.appendChild(btnEl);
}
function showButton() { ensureButton(); preload(); btnEl.classList.add("on"); }
function hideButton() { if (btnEl) btnEl.classList.remove("on"); }

// observe the hero: show Call while it's open; end the call + hide when it closes
const mo = new MutationObserver((muts) => {
  for (const mut of muts) {
    for (const n of mut.addedNodes) if (n instanceof Element && n.classList && n.classList.contains("holo-hero")) showButton();
    for (const n of mut.removedNodes) if (n instanceof Element && n.classList && n.classList.contains("holo-hero")) { hideButton(); endCall(); }
  }
});
mo.observe(DOC.body, { childList: true, subtree: true });
if ($(".holo-hero")) showButton();

// debug surface
window.QLiveHero = { start: startCall, end: endCall, active: () => !!live, get instance() { return live; }, version: 3 };
try { console.info("[q-live-hero] ready — Call button rides the hero; reuses createQLive (apps/q/q-live.mjs)"); } catch {}
