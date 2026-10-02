// q-live-hero.mjs — Q LIVE CALL: talk to Q out loud, it streams voice back in realtime. Additive weld of the
// PROVEN realtime speech-to-speech loop (apps/q/q-live.mjs createQLive) into the summoned messenger hero.
//
// The loop already does every hard part (token streaming, speak-as-generated clause pipeline, semantic
// turn-taking, barge-in, speculative sub-second turns, latency metrics). This module is the thin surface weld:
//   · a "Call" button in the hero (fixed sibling — React-reconciliation-proof, same idiom as the chips)
//   · tap → arm() INSIDE the gesture (unlock audio) → start() the loop → an IMMERSIVE call overlay
//   · a BEAUTIFUL, real-time voice visualization: a living radial aura + a scrolling voice-note waveform that
//     BREATHE with the real audio level (live.getLevel()), so you SEE your own voice the instant you speak —
//     WhatsApp-familiar, but immersive. State-aware colour (listening = mint · thinking = grey · speaking = blue).
//   · bridge the loop's state + getLevel() → window `holo-q-state {mode,level}` so the hero orb reacts too.
//   · each finished turn → window.HoloQ.liveIngest(role,text) → a real κ bubble in the ONE Q thread, which
//     the summon layer's observer then seals to the BLAKE3 κ-chain. Call and chat are one conversation.
//   · graceful ladder: no mic permission / no WebGPU → a clear message, chat still works. Never a hard fail.
//
// 100% serverless, on-device: Moonshine/Whisper ASR + BitNet + Kokoro TTS + Silero VAD (weights stream by κ from
// HF, per-block verified), 0 egress at turn time. Just talk — the Cerebras-voice experience with no backend.
const DOC = document, HTML = DOC.documentElement;
const $ = (s, r) => (r || DOC).querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
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
/* the call overlay — full-bleed over the hero: the visualization is the star, calm dark ground, minimal chrome */
#q-call{position:fixed;inset:0;z-index:330;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:0;padding:max(28px,env(safe-area-inset-top)) 22px calc(env(safe-area-inset-bottom) + 26px);text-align:center;
  background:radial-gradient(120% 100% at 50% 30%,rgba(9,11,18,.72),rgba(6,7,12,.90) 60%,rgba(0,0,0,.96));
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
  opacity:0;transition:opacity .45s ease;pointer-events:none}
#q-call.on{opacity:1;pointer-events:auto}
/* the living visualization — a centred canvas that breathes with the voice */
#q-call .qc-stage{position:relative;flex:0 0 auto;width:min(72vw,300px);height:min(72vw,300px);margin-top:2vh}
#q-call .qc-viz{position:absolute;inset:0;width:100%;height:100%}
/* the state label sits under the aura */
#q-call .qc-status{margin-top:16px;font:600 12px/1.3 -apple-system,"Segoe UI",sans-serif;letter-spacing:.24em;text-transform:uppercase;color:#7defc9;min-height:1.2em;transition:color .3s ease}
/* what YOU said — a live, scrolling voice-note waveform + the transcript beneath it */
#q-call .qc-wave{width:min(680px,84vw);height:34px;margin-top:14px;opacity:.9}
#q-call .qc-you{margin-top:6px;font:400 15px/1.5 -apple-system,"Segoe UI",sans-serif;color:rgba(231,237,250,.62);max-width:min(680px,86vw);min-height:1.5em;transition:opacity .2s ease}
/* what Q is saying — large, calm, the focus of the reply */
#q-call .qc-q{margin-top:14px;font:300 clamp(19px,3vh,27px)/1.42 -apple-system,"Segoe UI",sans-serif;color:#f4f7fc;max-width:min(720px,90vw);min-height:1.42em;text-shadow:0 2px 22px rgba(0,0,0,.6)}
#q-call .qc-hint{margin-top:auto;font:400 12.5px/1.4 -apple-system,"Segoe UI",sans-serif;color:rgba(231,237,250,.4);max-width:340px}
#q-call .qc-end{margin-top:18px;height:52px;padding:0 26px;border-radius:26px;border:0;cursor:pointer;
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

// ── the living voice visualization — a canvas that BREATHES with the real audio level ────────────────────
// Two layers, one presence: a radial AURA (bars in a ring + a soft core) that pulses with the level, and a
// scrolling voice-note WAVEFORM (WhatsApp-familiar) fed by a rolling history of the level — you literally watch
// your own voice as you speak. Colour tracks the phase so the whole thing shifts mood: mint while it listens,
// grey while it thinks, blue while it speaks. Driven by the ONE rAF that already pumps the orb (no extra loops).
const LVLN = 56;
let lvlHist = new Float32Array(LVLN), lvlHead = 0, smoothL = 0, vizT = 0;
const TINT = { listening: [125, 239, 201], speaking: [123, 140, 255], thinking: [150, 160, 190], idle: [120, 150, 180] };
function fit(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.__ctx || (canvas.__ctx = canvas.getContext("2d"));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}
function drawAura(canvas, level, mode) {
  const { ctx, w, h } = fit(canvas);
  const cx = w / 2, cy = h / 2, t = vizT;
  const [r, g, b] = TINT[mode] || TINT.idle;
  const baseR = Math.min(w, h) * 0.17, amp = Math.min(w, h) * 0.15;
  ctx.lineCap = "round";
  // radial bars — each length driven by the level + a per-bar organic wobble (alive even at rest)
  const N = 76;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    const nz = 0.5 + 0.5 * Math.sin(t * 2.1 + i * 0.5) * Math.sin(t * 1.27 + i * 0.19);
    const len = baseR + (0.30 + 0.70 * nz) * amp * (0.28 + level * 1.7);
    const x1 = cx + Math.cos(a) * baseR, y1 = cy + Math.sin(a) * baseR;
    const x2 = cx + Math.cos(a) * len, y2 = cy + Math.sin(a) * len;
    ctx.strokeStyle = "rgba(" + r + "," + g + "," + b + "," + (0.22 + 0.5 * nz).toFixed(3) + ")";
    ctx.lineWidth = 2.3; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  // soft breathing core
  const orbR = baseR * (0.66 + level * 0.55 + 0.05 * Math.sin(t * 1.6));
  const grd = ctx.createRadialGradient(cx, cy, orbR * 0.08, cx, cy, orbR);
  grd.addColorStop(0, "rgba(" + r + "," + g + "," + b + "," + (0.5 + level * 0.45).toFixed(3) + ")");
  grd.addColorStop(0.6, "rgba(" + r + "," + g + "," + b + "," + (0.14 + level * 0.2).toFixed(3) + ")");
  grd.addColorStop(1, "rgba(" + r + "," + g + "," + b + ",0)");
  ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(cx, cy, orbR, 0, Math.PI * 2); ctx.fill();
}
function drawWave(canvas, mode) {
  const { ctx, w, h } = fit(canvas);
  const [r, g, b] = TINT[mode] || TINT.idle;
  const bars = LVLN, gap = w / bars, cy = h / 2, bw = Math.max(2, gap * 0.5);
  for (let i = 0; i < bars; i++) {
    const v = lvlHist[(lvlHead + i) % LVLN];
    const bh = Math.max(2.5, v * h * 0.92);
    const x = i * gap + gap * 0.5 - bw / 2;
    ctx.fillStyle = "rgba(" + r + "," + g + "," + b + "," + (0.28 + 0.6 * v).toFixed(3) + ")";
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, cy - bh / 2, bw, bh, bw / 2); ctx.fill(); }
    else ctx.fillRect(x, cy - bh / 2, bw, bh);
  }
}
function pumpOrb() {
  const lvl = clamp((live && live.getLevel ? live.getLevel() : 0) || 0, 0, 1);
  const mode = (live && live.phase) || "thinking";
  smoothL += (lvl - smoothL) * 0.30; vizT += 0.016;
  orb(mode, lvl);
  lvlHist[lvlHead] = smoothL; lvlHead = (lvlHead + 1) % LVLN;   // rolling history for the voice-note waveform
  if (callEl && callEl.classList.contains("on")) {
    const az = $(".qc-viz", callEl); if (az) drawAura(az, smoothL, mode);
    const wv = $(".qc-wave", callEl); if (wv) drawWave(wv, mode);
  }
  rafId = requestAnimationFrame(pumpOrb);
}
function startViz() { if (!rafId) rafId = requestAnimationFrame(pumpOrb); }
function stopViz() { cancelAnimationFrame(rafId); rafId = 0; }

function overlay() {
  if (callEl) return callEl;
  callEl = DOC.createElement("div");
  callEl.id = "q-call";
  callEl.innerHTML =
    '<div class="qc-stage"><canvas class="qc-viz"></canvas></div>' +
    '<div class="qc-status">connecting…</div>' +
    '<canvas class="qc-wave"></canvas>' +
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
  lvlHist.fill(0); lvlHead = 0; smoothL = 0;
  orb("thinking", 0); startViz();   // the aura stirs THE INSTANT you tap Call — a live presence, before the loop loads
  if (!_mod) { try { _mod = await import("../q/q-live.mjs"); } catch (e) { setStatus("voice unavailable", true); setQ("I couldn't load my voice just now — you can still type to me."); return; } }
  const inst = ensureLive();
  if (!inst) { setStatus("voice unavailable", true); setQ("I couldn't start my voice just now — you can still type to me."); return; }
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
  } catch (e) {
    const msg = (e && e.name === "NotAllowedError") ? "I'd love to hear you — allow microphone access and tap Call again."
      : (_lastWarn ? ("I couldn't get my voice going (" + _lastWarn.slice(0, 80) + "). You can still type to me.")
      : "I need a mic and a WebGPU browser (Chrome, Edge, or Brave) to talk out loud. You can still type to me.");
    setStatus("can't start the call", true); setQ(msg);
  }
}

function endCall() {
  try { live && live.stop(); } catch {}
  live = null; _armed = false;   // a fresh instance next call needs a fresh arm(); module stays cached
  stopViz();
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

// debug / verification surface — expose the visualization so it can be driven with synthetic levels headless
window.QLiveHero = {
  start: startCall, end: endCall, active: () => !!live, get instance() { return live; },
  _viz: { open: () => { overlay().classList.add("on"); startViz(); }, feed: (v) => { try { live = live || { getLevel: () => 0, phase: "listening" }; live.getLevel = () => clamp(+v || 0, 0, 1); } catch {} } },
  version: 4,
};
try { console.info("[q-live-hero] ready — Call rides the hero; realtime voice viz over createQLive (apps/q/q-live.mjs)"); } catch {}
