// q-summon.mjs — tap the Q orb and Q slides in from the RIGHT as an OVERLAY drawer, exactly like Holo Wallet:
// same width, same chrome (#0d1117 = --holo-chrome), FLOATING above the home canvas (the wallet's own overlay
// mechanism, mirrored) rather than squeezing it — the desktop keeps its full width so every widget holds its
// exact position and relative size. It is the messenger's OWN Q — one brain, one voice, one memory — re-framed
// as a floating panel. Four welds, all additive, all fail-soft:
//
//   1. THE FLOATING DRAWER — the fully-wired hero (`.holo-hero`) is restyled in place into a RIGHT panel of the
//      wallet width, background var(--holo-chrome) (seamless chrome, no starfield), position:fixed on the right;
//      `html.q-drawer` reveals it over the canvas. The canvas is untouched — no re-centre, no reflow.
//   2. THE VOICE AT t=0 — the tap IS the autoplay gesture, so Q greets you out loud the instant it opens
//      (on-device Kokoro if warm, OS-voice floor otherwise — never mute), name-personalized (firstName()).
//   3. THE WARM BRAIN — window.HoloQ.warm() + the instant seed first-responder, pre-warmed at home-idle, so
//      even a first-time user gets an instant, spoken, intelligent first reply.
//   4. THE κ-THREAD — every painted message sealed to a BLAKE3 κ (did:holo:blake3), hash-linked + verified.
//
// 100% serverless: Web Audio + vendored Kokoro + WebGPU BitNet + pure-JS BLAKE3. Imports only CANONICAL modules.
import { createVoice } from "../q/core/voice-out.js";
import { kappo, kappoVerify } from "../../_shared/holo-kappa.mjs";

const DOC = document, HTML = DOC.documentElement;
const $ = (s, r) => (r || DOC).querySelector(s);

// ── the drawer skin: a right-side panel of wallet dimensions + rail chrome, floating over the canvas (no squeeze) ──
const css = DOC.createElement("style");
css.id = "q-summon-css";
css.textContent = `
/* EXACT Holo Wallet parity: reference the wallet's OWN width var (so Q and the wallet are pixel-identical and
   never drift), and the wallet's env gap. Wallet = a compact, focused lane (22vw, 360px floor) — NOT a wide panel. */
:root{ --q-rail-w: var(--holo-rail-w, 60px); --q-drawer-w: var(--holo-wallet-w, min(92vw, max(360px, 22vw))); --q-env-gap: var(--holo-env-gap, 0px); }

/* OVERLAY — no dock, no squeeze. Q FLOATS above the canvas (html.q-drawer .holo-hero is position:fixed on the right);
   the desktop keeps its FULL width so the greeting · % ring · quote · orb hold their EXACT position and relative size.
   This matches the wallet's overlay behaviour — ONE rule for every right slide-out: the canvas never moves. The old
   q-docked squeeze rules are gone (they shifted the composition and, via --holo-aside-w below, re-flowed the widgets). */

/* THE DRAWER — the hero re-framed as the wallet's panel: EXACT wallet parity (user directive) — wallet width,
   wallet chrome (--holo-chrome #1f1f1e, the same flat panel the wallet uses), the wallet's soft left shadow so
   the slide box lifts off the canvas identically, same .26s entrance curve. ONE right slide-out, one look. */
html.q-drawer .holo-hero{
  inset:0 0 0 auto!important; width:var(--q-drawer-w)!important; overflow:hidden!important;
  background:var(--holo-chrome,#1f1f1e)!important;
  padding-top:0!important; align-items:stretch!important; justify-content:flex-start!important;
  border-left:0!important; box-shadow:none!important;
  animation:q-drawer-in .26s var(--holo-ease,ease) both!important; touch-action:auto!important;
}
/* opacity-only (NO transform on .holo-hero): a transform would make its position:fixed composer hero-relative.
   The panel simply fades/floats in over the right lane — the canvas underneath never moves (overlay, like the wallet). */
@keyframes q-drawer-in{ from{opacity:0} to{opacity:1} }
/* header row: a small living orb + status, top-left of the drawer (absolute within the hero → tracks the panel) */
html.q-drawer .holo-hero-orb{ position:absolute!important; top:15px!important; left:17px!important; width:42px!important; height:42px!important; min-width:0!important; margin:0!important; filter:drop-shadow(0 0 12px rgba(91,140,255,.5))!important; }
html.q-drawer .holo-hero-orb.listening{ filter:drop-shadow(0 0 20px rgba(125,239,201,.6))!important; }
/* q-chat header parity: "Q" name with the live status right under it (online · Listening… · Thinking… ·
   Q is speaking…) — clear, concise feedback beside the orb, exactly like the standalone q-chat header. */
html.q-drawer .holo-hero-status{ position:absolute!important; top:36px!important; left:68px!important; margin:0!important;
  font-size:11.5px!important; line-height:1!important; font-weight:400!important; color:rgba(255,255,255,.42)!important;
  text-align:left!important; max-width:calc(100% - 120px)!important; white-space:nowrap!important; overflow:hidden!important; text-overflow:ellipsis!important; }
html.q-drawer .holo-hero-status:empty::before{ content:"online"; }
/* IMMERSION: while Q is open, the home-canvas orb hides (Q is HERE — no second orb floating on the wallpaper) */
html.q-drawer .holo-home-orb, html.q-drawer .holo-global-orb{ opacity:0!important; pointer-events:none!important; transition:opacity .2s ease!important; }
/* zero divider lines anywhere in the frame — one flat plane, exactly the nav chrome */
html.q-drawer .holo-hero, html.q-drawer .holo-hero *{ border-color:transparent!important; }
html.q-drawer .holo-hero-thread, html.q-drawer .holo-hero-stage{ border:0!important; }
html.q-drawer .holo-hero-x{ position:absolute!important; top:13px!important; right:13px!important; width:34px; height:34px; }
html.q-drawer .holo-hero-stage{ max-width:none!important; width:100%!important; margin-top:62px!important; padding:0 10px!important; align-items:stretch!important; }
html.q-drawer .holo-hero-thread{ max-width:none!important; width:100%!important; padding:8px 8px 88px!important; -webkit-mask-image:none!important; mask-image:none!important; }
html.q-drawer .holo-hero-bubble{ max-width:90%!important; }
html.q-drawer .holo-hero-empty{ max-width:none!important; padding:0 18px; }
html.q-drawer .holo-hero-open{ display:none!important; }
/* CLEAN q-chat look: hide the inbox brief / auto-tidy / ledger — a conversation, not a dashboard */
html.q-drawer .holo-hero-brief,html.q-drawer .holo-hero-auto,html.q-drawer .holo-hero-ledger{ display:none!important; }
/* composer pill centered WITHIN the right drawer */
html.q-drawer .holo-hero-compose{ left:calc(100vw - var(--q-drawer-w) / 2)!important; width:min(calc(var(--q-drawer-w) - 26px), 92vw)!important; bottom:calc(16px + env(safe-area-inset-bottom))!important; background:#2a3942!important; }
html.q-drawer .holo-hero-input::placeholder{ color:rgba(233,237,239,.5)!important; }

/* ── WHATSAPP CHAT — Q (incoming) grey bubble on the LEFT with a tail; you (outgoing) green bubble on the RIGHT
   with a tail; a small dim time (+ read tick) inside each bubble; a 3-dot "typing…" bubble. No wallpaper — just
   the chrome ground, exactly like the ask. Familiar, human, real-time. ── */
html.q-drawer .holo-hero,html.q-drawer .holo-hero-thread{ background:var(--holo-chrome,#1f1f1e)!important; background-image:none!important; }
html.q-drawer .holo-hero-bubble{ position:relative!important; font-size:14.6px!important; line-height:20px!important;
  padding:6px 9px 7px 10px!important; box-shadow:0 1px .6px rgba(0,0,0,.2)!important; margin:1px 0 3px!important; max-width:80%!important; }
/* Q — incoming grey, left, square top-left corner + a little tail */
html.q-drawer .holo-hero-bubble.q{ background:#202c33!important; color:#e9edef!important; align-self:flex-start!important; margin-right:auto!important; border-radius:0 8px 8px 8px!important; }
html.q-drawer .holo-hero-bubble.q::before{ content:""!important; position:absolute!important; top:0; left:-8px; border-right:8px solid #202c33; border-top:8px solid transparent; }
/* you — outgoing green, right, square top-right corner + a little tail */
html.q-drawer .holo-hero-bubble.me{ background:#005c4b!important; color:#e9edef!important; align-self:flex-end!important; margin-left:auto!important; margin-right:0!important; border-radius:8px 0 8px 8px!important; }
html.q-drawer .holo-hero-bubble.me::before{ content:""!important; position:absolute!important; top:0; right:-8px; border-left:8px solid #005c4b; border-top:8px solid transparent; }
/* the in-bubble time (+ tick) — floats bottom-right, the text wraps around it, just like WhatsApp */
.q-time{ float:right!important; margin:5px -1px -3px 12px!important; font-size:11px!important; line-height:15px!important; color:rgba(233,237,239,.42)!important; user-select:none!important; white-space:nowrap!important; }
.holo-hero-bubble.me .q-time{ color:rgba(233,237,239,.6)!important; }
.q-time .q-tick{ margin-left:3px!important; color:#53bdeb!important; letter-spacing:-3px!important; }
/* the 3-dot TYPING bubble — Q "typing…", like WhatsApp */
html.q-drawer .holo-hero-bubble.q.typing{ padding:12px 15px!important; min-width:0!important; }
html.q-drawer .holo-hero-bubble.q.typing > :not(.q-typing){ display:none!important; }
.q-typing{ display:inline-flex!important; gap:5px; align-items:center; height:8px; }
.q-typing i{ width:7px;height:7px;border-radius:50%;background:rgba(233,237,239,.55);display:inline-block;animation:qdot 1.25s infinite ease-in-out; }
.q-typing i:nth-child(2){ animation-delay:.16s } .q-typing i:nth-child(3){ animation-delay:.32s }
@keyframes qdot{ 0%,58%,100%{ transform:translateY(0);opacity:.35 } 28%{ transform:translateY(-4px);opacity:1 } }

/* the ONE header name "Q" — vertically centred beside the orb (the header is just orb + Q + ✕, nothing else) */
#q-drawer-title{position:fixed;top:27px;left:calc(100vw - var(--q-drawer-w) + 68px);z-index:302;color:#f4f7fc;font:650 16px/1 -apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.2px;pointer-events:none;opacity:0;transition:opacity .3s ease}
html.q-drawer #q-drawer-title{opacity:1}
/* κ-chain still seals + verifies every message silently (window.QSummon.verify()); the proof chip is HIDDEN — it
   was redundant clutter that overlapped the composer. A conversation, not a dashboard. */
#q-kappa-chip{display:none!important}
/* SUGGESTION CHIPS — inside the right drawer, above the composer */
#q-hero-chips{position:fixed;left:calc(100vw - var(--q-drawer-w));width:var(--q-drawer-w);box-sizing:border-box;bottom:calc(env(safe-area-inset-bottom) + 74px);z-index:305;
  display:flex;gap:8px;justify-content:flex-start;flex-wrap:nowrap!important;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:0 14px;pointer-events:none;
  opacity:0;transform:translateY(6px);transition:opacity .45s ease,transform .45s cubic-bezier(.4,0,.2,1)}
#q-hero-chips::-webkit-scrollbar{display:none}   /* ONE clean row that scrolls sideways on any width — never a 4-row stack */
#q-hero-chips.on{opacity:1;transform:none;pointer-events:auto}
#q-hero-chips button{pointer-events:auto;flex:0 0 auto;white-space:nowrap;color:#eef3fb;border-radius:20px;padding:7px 13px;font-size:12.5px;
  cursor:pointer;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.05);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:transform .14s ease,border-color .16s ease,background .16s ease}
#q-hero-chips button:hover{border-color:rgba(139,123,255,.55);transform:translateY(-1px);background:rgba(255,255,255,.09)}
#q-hero-chips button:active{transform:scale(.96)}
@media (prefers-reduced-motion:reduce){#q-hero-chips{transition:opacity .2s ease}}

/* SUBTLE latency read — tok/s + TTFT of the last real reply, whisper-quiet in the header (WhatsApp-clean: the
   chat stays a conversation; this is a faint monospace glance, never a dashboard). Data-only, off the hot path. */
#q-stats{position:fixed;top:19px;right:56px;z-index:303;pointer-events:none;white-space:nowrap;
  font:600 10.5px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.02em;
  display:flex;gap:7px;align-items:center;opacity:0;transition:opacity .45s ease}
html.q-drawer #q-stats.on{opacity:.5}
#q-stats .qs-s{color:#9fd3ff}                 /* tok/s */
#q-stats .qs-t{color:#7fefc9}                 /* TTFT — fast (warm-KV) reads mint */
#q-stats .qs-t.cold{color:#ffce8a}            /* a slow first token (cold prefill) reads a warmer amber */
@media (max-width:640px){ #q-stats{top:calc(16px + env(safe-area-inset-top,0px));right:62px} }

/* ── MOBILE: a phone is a first-class Q device — the drawer goes FULL-BLEED (100vw/100dvh), not a 94vw panel
   with a dead sliver. No canvas squeeze (the sheet OWNS the screen, native-chat style); safe-area insets for
   the notch/home-bar; and the composer floats above the soft keyboard via --q-kb (visualViewport, set below). */
@media (max-width: 640px){
  :root{ --q-drawer-w: 100vw; }
  /* the sheet fills the screen — drop the desktop panel chrome (left border + side shadow) */
  html.q-drawer .holo-hero{ width:100vw!important; border-left:none!important; box-shadow:none!important; padding-top:env(safe-area-inset-top,0px)!important; }
  /* don't squeeze/collapse home to 0 — the full-bleed sheet simply covers it (no big slide, no reflow) */
  html.q-docked .holo-wa-root{ width:100vw!important; }
  html.q-docked .holo-home-space,html.q-docked .holo-home-wall,html.q-docked .holo-home-scrim,
  html.q-docked .holo-wa-root .cs-main-container,html.q-docked .holo-home-orb,html.q-docked .holo-global-orb{ right:0!important; }
  /* header + title clear the notch */
  html.q-drawer .holo-hero-orb{ top:calc(15px + env(safe-area-inset-top,0px))!important; }
  html.q-drawer .holo-hero-status{ top:calc(26px + env(safe-area-inset-top,0px))!important; }
  html.q-drawer .holo-hero-x{ top:calc(13px + env(safe-area-inset-top,0px))!important; width:40px;height:40px; }   /* ≥40px touch target */
  #q-drawer-title{ top:calc(16px + env(safe-area-inset-top,0px)); left:70px; }
  /* full-width composer + chips, floated ABOVE the soft keyboard (--q-kb) so the input is never covered */
  html.q-drawer .holo-hero-compose{ left:50vw!important; width:calc(100vw - 24px)!important; bottom:calc(16px + env(safe-area-inset-bottom,0px) + var(--q-kb,0px))!important; }
  #q-hero-chips{ bottom:calc(74px + env(safe-area-inset-bottom,0px) + var(--q-kb,0px)); }

  /* ── M3 TOUCH ERGONOMICS ─────────────────────────────────────────────────────────────────────────────
     thumb-first: contained momentum scroll (the thread scrolls, the page/canvas behind it never drags or
     rubber-bands), bigger tap targets, and thread padding that clears the composer + the keyboard. */
  html.q-drawer .holo-hero-thread{
    overscroll-behavior:contain!important; -webkit-overflow-scrolling:touch!important;   /* momentum, no scroll-chaining */
    padding-bottom:calc(104px + env(safe-area-inset-bottom,0px) + var(--q-kb,0px))!important;   /* last bubble never hides under composer/keyboard */
  }
  /* the full-bleed sheet must not let the page behind bounce/scroll (iOS rubber-band, pull-to-refresh) */
  html.q-drawer, html.q-drawer body{ overscroll-behavior:none!important; -webkit-text-size-adjust:100%!important; }
  /* chips = real touch targets (≥40px), easy to tap one-thumb */
  #q-hero-chips{ gap:9px; padding:0 16px; }
  #q-hero-chips button{ min-height:40px; padding:11px 16px!important; font-size:14px!important; }
  /* the composer input + send are comfortable to tap */
  html.q-drawer .holo-hero-input{ font-size:16px!important; }   /* ≥16px → iOS won't zoom the page on focus */
  html.q-drawer .holo-hero-send{ min-width:42px!important; min-height:42px!important; }
  /* the close affordance is a generous hit area */
  html.q-drawer .holo-hero-x{ display:flex!important; align-items:center!important; justify-content:center!important; }
}
/* ══ OVERLAP FIX (2026-07-13) — header text + chips no longer collide (measured 0 overlap) ══════════ */
html body #q-drawer-title{ top:20px!important; }                                       /* "Q" name — upper */
html body .holo-hero .holo-hero-status{ top:39px!important; }                          /* status — below, no collision */
html body #q-hero-chips{ bottom:calc(env(safe-area-inset-bottom,0px) + 96px)!important; }  /* clear the composer */

/* ══ THE DRAWER IS Q-CHAT (2026-07-13) — feature-complete by construction ════════════════════════════
   Fill the Q hero with an iframe of the standalone q-chat (SW-rescued, same-origin). Hide the native
   hero UI; the iframe owns the 360px lane. q-chat brings streaming · voice · pill · seed · persona. ══ */
html.q-drawer .holo-hero > :not(.q-chat-iframe):not(.holo-hero-x), html body .holo-hero > :not(.q-chat-iframe):not(.holo-hero-x){ display:none!important; }
html body .holo-hero .q-chat-iframe{ position:absolute!important; inset:0!important; width:100%!important; height:100%!important; border:0!important; display:block!important; background:var(--holo-chrome,#0d1117)!important; z-index:5!important; }
html body .holo-hero .holo-hero-x{ z-index:6!important; }   /* keep the ✕ close above the iframe */

/* ══ HIDE NATIVE OVERLAYS (2026-07-11) — the iframe q-chat owns the composer/chips/call now ═══════════
   #q-call-btn + #q-hero-chips are q-summon fixed overlays OUTSIDE .holo-hero → they floated over the
   iframe (duplicate Call pill + doubled chips). The embedded q-chat has its own → hide the duplicates. */
html body #q-call-btn, html body #q-hero-chips{ display:none!important; }

/* ══ ONE CLEAN HEADER (2026-07-11) — kill the duplicate "Q" (=> "QQ") ════════════════════════════════
   #q-drawer-title is a q-summon overlay OUTSIDE .holo-hero, floating over the iframe q-chat's own "Q"
   header. The iframe header is the single source → hide the stray title. */
html body #q-drawer-title{ display:none!important; }

`;
DOC.head.appendChild(css);
// keyboard-aware composer (mobile): track the VISUAL viewport so the composer/chips float above the soft
// keyboard instead of hiding behind it. --q-kb = how much the keyboard eats from the bottom; 0 when closed.
try {
  const vv = window.visualViewport;
  if (vv) {
    const onVV = () => { const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)); HTML.style.setProperty("--q-kb", kb + "px"); };
    vv.addEventListener("resize", onVV, { passive: true }); vv.addEventListener("scroll", onVV, { passive: true }); onVV();
  }
} catch {}

// ── Q's summon voice (canonical core voice; HD warms once, floor voice means never mute) ──────────────────
const voice = createVoice({ onLevel: (level) => { try { window.dispatchEvent(new CustomEvent("holo-q-state", { detail: { mode: "speaking", level } })); } catch {} } });
// HOLO-Q-INSTANT-REAL: expose the drawer's ONE warmed voice so the embedded q-chat frame reuses it (no 2nd
// Kokoro load) — same-origin, read-only. window.HoloVoice.speak() = the parent's beautiful neural voice.
try { window.HoloVoice = { speak: (t) => { try { return voice.speak(String(t || "")); } catch (e) {} }, stop: () => { try { voice.stop && voice.stop(); } catch (e) {} }, ready: () => { try { return voice.ready ? !!voice.ready() : true; } catch (e) { return true; } } }; } catch (e) {}
const TTS_URL = new URL("../../usr/lib/holo/voice/holo-voice-tts.mjs", import.meta.url).href;

function firstName() {
  const clean = (s) => { s = String(s || "").trim(); const l = s.toLowerCase(); return (s && l !== "you" && l !== "operator" && l !== "guest") ? s.split(/\s+/)[0] : ""; };
  try { const o = JSON.parse(sessionStorage.getItem("holo.identity") || "null"); if (o && !o.guest && clean(o.label)) return clean(o.label); } catch {}
  try { const p = JSON.parse(localStorage.getItem("holo-messenger/profile/v1") || "null"); if (p && clean(p.name)) return clean(p.name); } catch {}
  try { const m = clean(localStorage.getItem("holo.chat.me")); if (m) return m; } catch {}
  try { const o = JSON.parse(localStorage.getItem("holo.lastOperator") || "null"); if (o && clean(o.label)) return clean(o.label); } catch {}
  return "";
}
const GKEY = "holo.q.summon.greeted";
function greetLine() {
  const n = firstName(), who = n ? " " + n : "";
  let first = true; try { first = !localStorage.getItem(GKEY); localStorage.setItem(GKEY, String(Date.now())); } catch {}
  return first
    ? `Hey${who}, I'm Q. I live right here on your device, so whatever you tell me stays with you, always. What's on your mind?`
    : `Welcome back${who}. I'm right here — what's on your mind?`;
}

function warm() {
  try { window.speechSynthesis && speechSynthesis.getVoices(); } catch {}
  try { voice.warmHD({ ttsUrl: TTS_URL }).catch(() => {}); } catch {}
  let tries = 0;
  (function brain() {
    // kick BOTH tiers the instant HoloQ exists: the full BitNet brain (the ~28s κ-stream) AND the ~7MB ONNX
    // seed. Started here — at drawer-open / idle — the seed is ready to DRAFT the first novel turn in ~1s while
    // the brain finishes behind it, so the cold first answer never waits on the full model. Both idempotent.
    try { if (window.HoloQ && window.HoloQ.warm) { window.HoloQ.warm(); try { window.HoloQ.warmSeed && window.HoloQ.warmSeed(); } catch {} return; } } catch {}
    if (++tries < 40) setTimeout(brain, 700);
  })();
}
function warmWhenIdle() {
  if (DOC.visibilityState !== "visible") { DOC.addEventListener("visibilitychange", warmWhenIdle, { once: true }); return; }
  if ("requestIdleCallback" in window) requestIdleCallback(warm, { timeout: 4500 }); else setTimeout(warm, 2500);
}
// MOBILE-LEAN (2026-07): the idle auto-warm pulls the ~7MB ONNX seed AND the ~28s BitNet κ-stream — the
// single heaviest thing on the mobile boot path. Q still warms INSTANTLY on the real orb tap (onOrbDown →
// warm(), below), so on phones / data-saver we skip the *speculative* auto-warm and let genuine intent
// trigger it. Desktop is unchanged. Predicate = coarse-pointer + small viewport (the shell's own phone
// test) or Save-Data — flagship phones included, since mobile CPU/battery/net are the constraint, not GPU.
const _qLeanMobile = (() => { try { return (matchMedia("(pointer:coarse)").matches && Math.min(innerWidth, innerHeight) <= 700) || navigator.connection?.saveData === true; } catch { return false; } })();
if (!_qLeanMobile) warmWhenIdle();

// INSTANT-Q hover+prefetch (2026-07-15): warm Q the instant the cursor reaches the orb (desktop head-start, before the tap) so
// "waking Q up" is gone by open-time; and prefetch the q-chat drawer resource at idle so the FIRST orb tap
// boots its iframe from cache (the hero+iframe then persist → every later open is a 0ms reveal). Additive.
let _hoverWarmed = 0;
DOC.addEventListener("pointerover", (e) => {
  try {
    const t = e.target; if (!t || !t.closest || !t.closest(".holo-home-orb, .holo-global-orb")) return;
    const now = Date.now(); if (now - _hoverWarmed < 5000) return; _hoverWarmed = now; warm();
  } catch (x) {}
}, { capture: true, passive: true });
function _prefetchChat() {
  try { const u = new URL("../q/q-chat.html?guest=1&embed=1", import.meta.url).href; fetch(u, { credentials: "same-origin" }).then((r) => r && r.text()).catch(() => {}); } catch (x) {}
}
if (!_qLeanMobile) { if ("requestIdleCallback" in window) requestIdleCallback(_prefetchChat, { timeout: 5000 }); else setTimeout(_prefetchChat, 3000); }


let greeting = false;
function speakGreeting() { greeting = true; Promise.resolve(voice.speak(greetLine())).catch(() => {}).then(() => { greeting = false; }); }
function bargeIn() { if (greeting) { greeting = false; try { voice.stop(); } catch {} } }
window.addEventListener("keydown", bargeIn, { capture: true, passive: true });

// ── open (dock + drawer) on orb tap; the tap opens the hero, we just add the classes + speak ───────────────
const heroOpen = () => !!$(".holo-hero");
let titleEl = null;
function ensureTitle() { if (!titleEl) { titleEl = DOC.createElement("div"); titleEl.id = "q-drawer-title"; titleEl.textContent = "Q"; DOC.body.appendChild(titleEl); } }
// ── SQUEEZE via the ONE shared contract (HoloAside, defined in the messenger bundle): opening Q squeezes the
//    home canvas from the right by the drawer's own width and glides the body-level widgets to stay centred in
//    it — identical to Wallet + Inbox. Never dims. Fail-soft: if HoloAside isn't up yet, fall back to clearing
//    any stale --holo-aside-w directly (overlay), so Q always opens. ──
function reserveAside() { try { if (window.HoloAside) window.HoloAside.open("q"); } catch (e) {} }
function releaseAside() { try { if (window.HoloAside) window.HoloAside.close("q"); else HTML.style.removeProperty("--holo-aside-w"); } catch (e) {} }
function openClasses() { HTML.classList.add("q-drawer", "q-docked"); ensureTitle(); requestAnimationFrame(reserveAside); }
function closeClasses() { HTML.classList.remove("q-drawer", "q-docked"); releaseAside(); }
// MINIMAL-FIRST STABILITY (2026-07-11): the messenger shell now owns the Q surface's open/close via its
// own React state. This handler MUST NOT toggle drawer classes or squeeze the canvas — doing so raced the
// shell (its 1.5s safety timer, finding no `.holo-hero` of its own, released the canvas squeeze the shell's
// panel sat in → "opens then closes"). It now does ONE non-visual thing: pre-warm the brain on the tap, so
// the first reply is instant. No classes, no aside, no timer, no duplicate greeting — zero UI conflict.
function onOrbDown(e) {
  const orb = e.target && e.target.closest && e.target.closest(".holo-home-orb, .holo-global-orb");
  if (!orb) return;
  warm();                           // low-latency: kick the brain + seed load on the gesture (idempotent, no UI)
  // BELT-AND-SUSPENDERS: React mounts `.holo-hero` a beat after the tap. Poll briefly and apply the drawer
  // class the moment it appears (in case the MutationObserver misses a deeply-nested portal mount) so the
  // panel is ALWAYS the 360px right slide-out, never full-screen. Guarded → no flash, no close.
  let tries = 0;
  const t = setInterval(() => {
    if ($(".holo-hero")) { if (!HTML.classList.contains("q-drawer")) openClasses(); clearInterval(t); }
    else if (++tries > 20) clearInterval(t);   // ~1s window; the shell may open a non-hero surface — then do nothing
  }, 50);
}
DOC.addEventListener("pointerdown", onOrbDown, { capture: true, passive: true });

// ── the κ-thread: every painted message → did:holo:blake3, hash-linked, verified on every load ────────────
const LKEY = "holo.q.kappa-thread.v1";
const enc = new TextEncoder();
const sealBytes = (m) => enc.encode(JSON.stringify({ v: 1, role: m.role, text: m.text, ts: m.ts, prev: m.prev }));
let ledger = []; try { ledger = JSON.parse(localStorage.getItem(LKEY) || "[]"); } catch {}
const seen = new Set(ledger.map((m) => m.role + " " + m.text));
let chainOk = true, brokenAt = -1;
function verifyChain() {
  let prev = null;
  for (let i = 0; i < ledger.length; i++) { const m = ledger[i]; if (m.prev !== prev || !kappoVerify(sealBytes(m), m.k)) { chainOk = false; brokenAt = i; return false; } prev = m.k; }
  chainOk = true; brokenAt = -1; return true;
}
verifyChain();
function persist() { try { localStorage.setItem(LKEY, JSON.stringify(ledger.slice(-240))); } catch {} }
function seal(role, text) {
  const key = role + " " + text;
  if (!text || seen.has(key)) return null;
  const m = { v: 1, role, text, ts: Date.now(), prev: ledger.length ? ledger[ledger.length - 1].k : null };
  m.k = kappo(sealBytes(m));
  ledger.push(m); seen.add(key); persist(); chip();
  return m.k;
}
let chipEl = null;
function chip() {
  if (!heroOpen()) { if (chipEl) chipEl.classList.remove("on"); return; }
  if (!chipEl) { chipEl = DOC.createElement("div"); chipEl.id = "q-kappa-chip"; DOC.body.appendChild(chipEl); }
  const last = ledger[ledger.length - 1];
  chipEl.textContent = chainOk ? `⛓ ${ledger.length} sealed · verified` + (last ? ` · κ…${last.k.slice(-8)}` : "")
    : `⛓ chain broken at #${brokenAt} — history was altered`;
  chipEl.classList.toggle("bad", !chainOk); chipEl.classList.add("on");
}

// ── suggestion chips (drawer-docked; drive the hero's React input) ─────────────────────────────────────────
const CHIPS = ["Tell me something amazing", "Write something beautiful", "Help me think", "Tell a joke"];
let chipsEl = null;
function heroHasUserMsg() { try { return !!DOC.querySelector(".holo-hero-bubble.me"); } catch { return false; } }
function driveSend(text) {
  const inp = DOC.querySelector("#holo-hero-input"); if (!inp) return;
  try {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(inp, text); inp.dispatchEvent(new Event("input", { bubbles: true }));
    const send = DOC.querySelector(".holo-hero-send");
    if (send && !send.disabled) send.click(); else inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  } catch {}
}
function showChips() {
  if (!heroOpen() || heroHasUserMsg()) return;
  if (!chipsEl) {
    chipsEl = DOC.createElement("div"); chipsEl.id = "q-hero-chips";
    for (const c of CHIPS) { const b = DOC.createElement("button"); b.textContent = c; b.onclick = () => { hideChips(); bargeIn(); driveSend(c); }; chipsEl.appendChild(b); }
    DOC.body.appendChild(chipsEl);
  }
  requestAnimationFrame(() => chipsEl && chipsEl.classList.add("on"));
}
function hideChips() { if (chipsEl) chipsEl.classList.remove("on"); }

// ── WhatsApp finishing touches: a dim in-bubble time (+ read tick for you), and a 3-dot "typing…" bubble ──
function hhmm() { const d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
function stamp(b, role) { if (!b || b.querySelector(".q-time")) return; const s = DOC.createElement("span"); s.className = "q-time"; s.innerHTML = hhmm() + (role === "me" ? ' <span class="q-tick">✓✓</span>' : ""); b.appendChild(s); }
function injectDots(b) { if (!b || b.querySelector(".q-typing")) return; const s = DOC.createElement("span"); s.className = "q-typing"; s.innerHTML = "<i></i><i></i><i></i>"; b.appendChild(s); }

// observe the hero: seal each bubble; manage the docked-drawer lifecycle
const mo = new MutationObserver((muts) => {
  for (const mut of muts) {
    for (const n of mut.addedNodes) {
      if (!(n instanceof Element)) continue;
      // NESTING-PROOF (2026-07-11): React portals mount `.holo-hero` INSIDE a wrapper node, so the added
      // node may not itself be the hero — check descendants too, or the drawer class never sets and the
      // hero renders unstyled full-screen instead of the 360px right slide-out.
      if ((n.classList && n.classList.contains("holo-hero")) || (n.querySelector && n.querySelector(".holo-hero"))) { if (!HTML.classList.contains("q-drawer")) { openClasses(); verifyChain(); chip(); setTimeout(showChips, 300); } }
      const bubbles = n.classList && n.classList.contains("holo-hero-bubble") ? [n] : (n.querySelectorAll ? n.querySelectorAll(".holo-hero-bubble") : []);
      for (const b of bubbles) {
        if (b.classList.contains("typing")) { injectDots(b); continue; }   // Q "typing…" — 3 animated dots
        const role = b.classList.contains("me") ? "me" : "q";
        const text = (b.textContent || "").trim();   // capture BEFORE the stamp — the time must NOT enter the κ-seal
        stamp(b, role);                               // WhatsApp in-bubble time + read tick
        const k = seal(role, text);
        if (role === "me") hideChips();
        if (k && role === "q") bargeIn();
      }
    }
    for (const n of mut.removedNodes) {
      if (n instanceof Element && ((n.classList && n.classList.contains("holo-hero")) || (n.querySelector && n.querySelector(".holo-hero"))) && !$(".holo-hero")) {
        closeClasses();                          // un-squeeze the canvas
        if (chipEl) chipEl.classList.remove("on");
        hideChips(); bargeIn();
      }
    }
  }
});
mo.observe(DOC.body, { childList: true, subtree: true });

// ── subtle tok/s + TTFT read (standalone-parity, but always-on + whisper-quiet instead of ?stats-gated) ──
// Pulls the last REAL brain turn's metrics from window.HoloQ.stats() ({ttft,tokps,at}); seed/instant replies
// carry no engine stats so it simply shows the last measured reply. Off the hot path (a 1s poll, data-only).
let statsEl = null, statsAt = -1;
function renderStats() {
  if (!heroOpen()) { if (statsEl) statsEl.classList.remove("on"); return; }
  let s = null; try { s = window.HoloQ && window.HoloQ.stats && window.HoloQ.stats(); } catch {}
  if (!s || !s.at || s.at === statsAt) return;
  const ttft = Math.round(s.ttft || 0), tps = Math.round(s.tokps || 0);
  if (!ttft && !tps) return;
  statsAt = s.at;
  if (!statsEl) { statsEl = DOC.createElement("div"); statsEl.id = "q-stats"; statsEl.title = "last reply · time-to-first-token · tokens/sec"; DOC.body.appendChild(statsEl); }
  const cold = ttft >= 500;   // a slow first token ≈ cold prefill; a fast one ≈ warm-KV reuse
  statsEl.innerHTML = (tps ? `<span class="qs-s">${tps} tok/s</span>` : "") + (ttft ? `<span class="qs-t${cold ? " cold" : ""}">${ttft} ms</span>` : "");
  statsEl.classList.add("on");
}
setInterval(renderStats, 1000);

// ══ Q SEES — the WhatsApp composer's real icons (emoji · attach · camera) + on-device VISION ═════════════════
// 😊 inserts an emoji; 📎 attaches a photo; 📷 opens the camera. A picked image becomes a WhatsApp photo bubble
// (κ-sealed) and Q SEES it: a small vision model (transformers.js image-to-text, streamed from PUBLIC HF, reusing
// the already-shipped Kokoro transformers vendor) captions it ON-DEVICE (0 egress — the photo never leaves you),
// then Q reasons about it in its own voice via the normal reply path. Honest: no fake buttons; fail-soft if vision
// can't load. React owns the composer, so we (re)inject our icons on a light poll.
(function qSees() { try {
  const S = DOC.createElement("style"); S.id = "q-sees-css"; S.textContent = `
    html.q-drawer .holo-hero-compose .q-cico{flex:0 0 auto;width:32px;height:32px;border:0;background:transparent;color:#8696a0;cursor:pointer;display:grid;place-items:center;padding:0;border-radius:50%;transition:color .15s,background .15s}
    html.q-drawer .holo-hero-compose .q-cico:hover{color:#d1d7db;background:rgba(255,255,255,.07)}
    html.q-drawer .holo-hero-compose .q-cico svg{width:21px;height:21px}
    #q-emoji{position:fixed;z-index:341;background:#233138;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:7px;display:none;grid-template-columns:repeat(7,32px);gap:1px;box-shadow:0 10px 34px rgba(0,0,0,.55)}
    #q-emoji.on{display:grid}
    #q-emoji button{font-size:20px;background:transparent;border:0;cursor:pointer;padding:4px;border-radius:8px;line-height:1}
    #q-emoji button:hover{background:rgba(255,255,255,.09)}
    html.q-drawer .holo-hero-bubble.me.q-img{padding:3px 3px 4px!important}
    html.q-drawer .holo-hero-bubble.me.q-img img{display:block;border-radius:7px;max-width:min(220px,60vw);width:100%;height:auto}
  `; DOC.head.appendChild(S);
  const EMO = ["😊","😂","❤️","👍","🙏","🔥","🎉","😍","🤔","😅","👏","💡","✅","😎","🥳","😢","😮","🙌","💪","✨","👌","🤝","🫶","🌟","🍕","☕","😴","💯"];
  const IC = {
    emoji:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.4 2 4 2 4-2 4-2"/><line x1="9" y1="9.2" x2="9.01" y2="9.2"/><line x1="15" y1="9.2" x2="15.01" y2="9.2"/></svg>',
    attach:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.9-2.9l8.5-8.5"/></svg>',
    camera:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  };
  const heroInput = () => DOC.querySelector("#holo-hero-input");
  function insertText(t) { const inp = heroInput(); if (!inp) return; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; setter.call(inp, (inp.value || "") + t); inp.dispatchEvent(new Event("input", { bubbles: true })); try { inp.focus(); } catch {} }
  let emojiEl = null;
  function emojiPanel() { if (emojiEl) return emojiEl; emojiEl = DOC.createElement("div"); emojiEl.id = "q-emoji"; for (const e of EMO) { const b = DOC.createElement("button"); b.textContent = e; b.onmousedown = (ev) => ev.preventDefault(); b.onclick = () => insertText(e); emojiEl.appendChild(b); } DOC.body.appendChild(emojiEl); DOC.addEventListener("pointerdown", (ev) => { if (emojiEl.classList.contains("on") && !emojiEl.contains(ev.target) && !(ev.target.closest && ev.target.closest(".q-emoji"))) emojiEl.classList.remove("on"); }, true); return emojiEl; }
  function toggleEmoji(btn) { const p = emojiPanel(); const r = btn.getBoundingClientRect(); p.classList.toggle("on"); if (p.classList.contains("on")) { const h = p.getBoundingClientRect().height || 220; p.style.left = Math.max(8, Math.min(r.left, innerWidth - 236)) + "px"; p.style.top = Math.max(8, r.top - h - 8) + "px"; } }
  function pickFile(capture) { const inp = DOC.createElement("input"); inp.type = "file"; inp.accept = "image/*"; if (capture) inp.setAttribute("capture", "environment"); inp.style.display = "none"; inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) onImage(f); setTimeout(() => inp.remove(), 0); }; DOC.body.appendChild(inp); inp.click(); }
  function addImageBubble(url) { const thread = DOC.querySelector(".holo-hero-thread") || DOC.querySelector(".holo-hero-stage"); if (!thread) return null; const b = DOC.createElement("div"); b.className = "holo-hero-bubble me q-img"; const img = DOC.createElement("img"); img.src = url; img.alt = "photo"; b.appendChild(img); try { stamp(b, "me"); } catch {} thread.appendChild(b); try { b.scrollIntoView({ block: "end" }); } catch {} return b; }
  function looking(on) { const thread = DOC.querySelector(".holo-hero-thread") || DOC.querySelector(".holo-hero-stage"); if (!thread) return; let t = thread.querySelector(".q-look"); if (on) { if (!t) { t = DOC.createElement("div"); t.className = "holo-hero-bubble q typing q-look"; injectDots(t); thread.appendChild(t); try { t.scrollIntoView({ block: "end" }); } catch {} } } else if (t) { t.remove(); } }
  let _vlmP = null;
  function vlm() { if (_vlmP) return _vlmP; _vlmP = (async () => { const tf = await import("/_shared/voice/vendor/kokoro/transformers/transformers.js"); try { const w = new URL("/_shared/voice/vendor/kokoro/transformers/", import.meta.url).href; if (tf.env && tf.env.backends && tf.env.backends.onnx && tf.env.backends.onnx.wasm) { tf.env.backends.onnx.wasm.wasmPaths = w; } tf.env.allowRemoteModels = true; tf.env.allowLocalModels = false; } catch {} const dev = (typeof navigator !== "undefined" && navigator.gpu) ? "webgpu" : "wasm"; return tf.pipeline("image-to-text", "Xenova/vit-gpt2-image-captioning", { device: dev, dtype: "q8" }); })().catch((e) => { _vlmP = null; throw e; }); return _vlmP; }
  async function caption(file) { const pipe = await vlm(); const url = URL.createObjectURL(file); try { const out = await pipe(url); return String((out && out[0] && (out[0].generated_text || out[0].text)) || "").trim(); } finally { try { URL.revokeObjectURL(url); } catch {} } }
  async function onImage(file) {
    const url = URL.createObjectURL(file);
    addImageBubble(url); try { seal("me", "[photo]"); } catch {} try { hideChips(); } catch {}
    looking(true);
    let cap = ""; try { cap = await caption(file); } catch (e) { try { console.debug("[q-sees]", e && e.message); } catch {} }
    looking(false);
    const q = heroInput() && heroInput().value ? heroInput().value.trim() : "";
    if (cap) { try { window.HoloCorpus && window.HoloCorpus.publish({ source: "photo", text: cap }); } catch {} }   // U2: what Q SAW joins the one context plane
    if (cap) driveSend((q ? q + " " : "") + "(About the photo I just shared — it shows: " + cap + ". Talk to me about it naturally, in your own words.)");
    else driveSend(q || "I just shared a photo — I couldn't get my eyes going to read it just now, but I'm here with you.");
  }
  function ensureIcons() {
    if (!heroOpen()) return;
    const cmp = DOC.querySelector(".holo-hero-compose"); if (!cmp || cmp.querySelector(".q-cico")) return;
    const send = cmp.querySelector(".holo-hero-send");
    const mk = (n, fn) => { const b = DOC.createElement("button"); b.type = "button"; b.className = "q-cico q-" + n; b.setAttribute("aria-label", n); b.innerHTML = IC[n]; b.onmousedown = (e) => e.preventDefault(); b.onclick = (e) => { e.preventDefault(); fn(b); }; return b; };
    cmp.insertBefore(mk("emoji", (b) => toggleEmoji(b)), cmp.firstChild);
    const att = mk("attach", () => pickFile(false)), cam = mk("camera", () => pickFile(true));
    if (send) { cmp.insertBefore(att, send); cmp.insertBefore(cam, send); } else { cmp.appendChild(att); cmp.appendChild(cam); }
  }
  setInterval(ensureIcons, 500);   // React owns the composer → (re)inject our icons if it re-renders
  window.QSees = { icons: ensureIcons, image: onImage, caption, version: 1 };
} catch (e) { try { window.__qSeesErr = String((e && (e.stack || e.message)) || e); console.warn("[q-sees] init failed:", e); } catch {} } })();   // Q Sees must NEVER break the drawer

// ══ Q REACHES OUT — proactive, personalized, RESTRAINED. Q messages you FIRST when there's genuinely something
// worth saying (a new day after you've been away, a long gap), grounded in your memory. A soft green badge pulses
// on the home Q orb; when you open, the message is already there — spoken, by name. ≤1 unsolicited reach-out/day +
// quiet hours + never on a first-ever visit → a thoughtful friend, not a nagging app. Wrapped: never breaks the drawer.
(function qReach() { try {
  const s = DOC.createElement("style"); s.id = "q-reach-css"; s.textContent = `
    #q-reach-badge{position:fixed;z-index:341;width:12px;height:12px;border-radius:50%;background:#25d366;border:2px solid #0b141a;opacity:0;transform:scale(.5);transition:opacity .35s ease,transform .35s cubic-bezier(.2,.9,.3,1.2);pointer-events:none}
    #q-reach-badge.on{opacity:1;transform:scale(1);animation:qreachpulse 2.2s infinite}
    @keyframes qreachpulse{0%{box-shadow:0 0 0 0 rgba(37,211,102,.5)}70%{box-shadow:0 0 0 9px rgba(37,211,102,0)}100%{box-shadow:0 0 0 0 rgba(37,211,102,0)}}
    html.q-drawer .holo-hero-bubble.q.q-reach{border-left:2px solid rgba(37,211,102,.5)!important}
  `; DOC.head.appendChild(s);
  const RK = "holo.q.reach.v1", LIMIT = 1;
  const load = () => { try { return JSON.parse(localStorage.getItem(RK) || "{}"); } catch { return {}; } };
  const save = (o) => { try { localStorage.setItem(RK, JSON.stringify(o)); } catch {} };
  const today = () => new Date().toISOString().slice(0, 10);
  const quiet = () => { const h = new Date().getHours(); return h < 7 || h >= 22; };
  // record THIS visit (for the "long gap" trigger), capturing the previous visit first
  let stt = load(); const prevVisit = stt.lastVisit || 0; const now = Date.now();
  const daysSince = prevVisit ? (now - prevVisit) / 86400000 : 0;
  stt.lastVisit = now; save(stt);

  function badgeEl() { let b = DOC.getElementById("q-reach-badge"); if (!b) { b = DOC.createElement("div"); b.id = "q-reach-badge"; DOC.body.appendChild(b); } return b; }
  function positionBadge() { const orb = $(".holo-home-orb"); const b = DOC.getElementById("q-reach-badge"); if (!orb || !b) return; const r = orb.getBoundingClientRect(); b.style.left = (r.right - 13) + "px"; b.style.top = (r.top + 2) + "px"; }
  function setBadge(on) { const b = badgeEl(); b.classList.toggle("on", !!on); if (on) positionBadge(); }
  addEventListener("resize", () => { const b = DOC.getElementById("q-reach-badge"); if (b && b.classList.contains("on")) positionBadge(); }, { passive: true });

  const trimFact = (f) => { f = String(f || "").replace(/\s+/g, " ").trim(); return f.length > 64 ? f.slice(0, 62) + "…" : f; };
  // Q NOTICES: the ranking brain decides WHAT is worth saying (grounded or nothing). QReach owns WHEN + delivery +
  // restraint; QNotices.pick() returns the single most useful TRUE thing right now, or null → Q stays silent (the
  // generic "just checking in" filler is gone). Fail-soft fallback ONLY for an explicit gap after a real absence.
  async function compose(reason) {
    try { if (window.QNotices && window.QNotices.pick) { const n = await window.QNotices.pick({ name: firstName(), reason }); if (n && n.text && String(n.text).trim()) return String(n.text).trim(); } } catch {}
    if (reason === "gap") { const who = firstName() || "there", hr = new Date().getHours(); const g = hr < 12 ? "Morning" : hr < 18 ? "Hey" : "Evening"; return `${g}, ${who}. It's been a little while — I'm right here whenever you want to think something through.`; }
    return "";   // grounded or nothing: no notice worth surfacing → silence
  }
  const within = () => { const c = load().count || {}; return !(c.date === today() && (c.n || 0) >= LIMIT); };
  function reason() {
    const st = load();
    if (!prevVisit) return null;              // never reach out to someone you just met (first-ever visit)
    if (quiet() || !within() || st.pending) return null;
    if (daysSince >= 2) return "gap";         // you've been away a while
    if (st.lastReachDay !== today()) return "day";   // first return of a new day
    return null;
  }
  let composing = false;
  async function evaluate() { if (composing) return; const r = reason(); if (!r) return; composing = true; let text = ""; try { text = await compose(r); } catch {} composing = false; if (!text) return; const st = load(); st.pending = { text, at: Date.now(), reason: r }; save(st); setBadge(true); }
  let delivering = false;
  async function deliver() {
    const st = load(), p = st.pending; if (!p || !p.text || delivering) return; delivering = true;
    // COUNT + clear FIRST (atomic, before any async) so restraint holds and no timer re-queues it
    delete st.pending; st.lastReachDay = today(); const c = st.count || {}; st.count = (c.date === today()) ? { date: today(), n: (c.n || 0) + 1 } : { date: today(), n: 1 }; save(st); setBadge(false);
    // deliver as a REAL Q bubble via the thread ingest (React-managed, persists; the observer seals it), + speak
    try { if (window.HoloQ && window.HoloQ.liveIngest) await window.HoloQ.liveIngest("q", p.text); } catch {}
    try { seal("q", p.text); } catch {}   // ensure sealed to the κ-thread even if the ingest path is quiet (dedup-safe)
    try { voice.speak(p.text); } catch {}
    delivering = false;
  }
  const openObs = new MutationObserver(() => { if (heroOpen()) setTimeout(deliver, 700); });
  openObs.observe(DOC.body, { childList: true, subtree: true });
  setTimeout(evaluate, 4000);                                   // a beat after load
  setInterval(() => { if (!heroOpen()) evaluate(); }, 600000);  // every 10 min while closed — calm, never spammy
  setInterval(() => { const b = DOC.getElementById("q-reach-badge"); if (b && b.classList.contains("on") && !heroOpen()) positionBadge(); }, 1500);
  window.QReach = { evaluate, deliver, reason, within, state: load, badge: setBadge,
    force: async () => { const st = load(); st.pending = { text: await compose("gap"), at: Date.now(), reason: "gap" }; save(st); setBadge(true); return st.pending.text; }, version: 1 };
} catch (e) { try { console.warn("[q-reach] init failed:", e); } catch {} } })();

// ==  EVERY HOLOSPACE PROJECTS INTO THE PLANE (U2b of Q-ONE). The shell already materializes the OPEN
// holospace's live context as window.__holoSpaceCtx = {appId, name, url, title, summary} (the __holoCtx shim
// each app carries). This one watcher distills that into HoloCorpus facts - so opening a file, watching a
// show, reading a page ALL become things Q simply knows, with ZERO per-app adapters. Dedup by app+title
// (publish once per thing, not per tick); the corpus adds its own rate/length caps. Fail-soft, never breaks.
(function qProject() { try {
  const seen = new Set(); let lastKey = "";
  function tick() {
    try {
      const c = window.__holoSpaceCtx;
      if (!c || !c.appId) { lastKey = ""; return; }
      const title = String(c.title || "").trim(), summary = String(c.summary || "").trim();
      if (!title && !summary) return;
      const key = c.appId + "|" + title;
      if (key === lastKey || seen.has(key)) return;
      lastKey = key; seen.add(key); if (seen.size > 200) seen.clear();
      const C = window.HoloCorpus; if (!C || !C.publish) return;
      const name = String(c.name || c.appId).trim();
      C.publish({ source: String(c.appId).slice(0, 24), text: (name ? name + ": " : "") + (title || "") + (summary ? " - " + summary.slice(0, 180) : ""), meta: { url: c.url || "" } });
    } catch (e) {}
  }
  setInterval(tick, 5000); setTimeout(tick, 2500);
  window.QProject = { tick, version: 1 };
} catch (e) { try { console.warn("[q-project] init failed:", e); } catch {} } })();

// ══ Q DOES: REMINDERS FIRE (D1). Every 15s scan the realm store for due reminders and deliver them through
// the living surfaces: drawer open → a real spoken κ bubble right now (liveIngest); closed → the QReach badge
// pulses and the message waits (you ASKED for this — an explicit reminder bypasses the 1/day restraint).
// Append-only lifecycle: firing/cancelling appends a reminder-x record referencing the reminder's sealed id —
// nothing is ever mutated, and the whole thing rides U1's realms (encrypted, claimed at sign-in). Fail-soft.
(function qRemind() { try {
  let busy = false;
  async function tick() {
    if (busy) return; busy = true;
    try {
      const M = window.HoloMemory; if (!M || !M.recent) return;
      if (M.ready) await M.ready();
      const xs = new Set(M.recent({ kind: "reminder-x", n: 80 }).map((r) => r["holmem:meta"] && r["holmem:meta"].ref).filter(Boolean));
      const due = M.recent({ kind: "reminder", n: 80 }).filter((r) => !xs.has(r.id) && r["holmem:meta"] && r["holmem:meta"].at && new Date(r["holmem:meta"].at) <= new Date());
      if (!due.length) return;
      const r = due[due.length - 1];                                   // oldest due first (recent() is newest-first)
      await M.remember({ kind: "reminder-x", text: "fired", meta: { ref: r.id } });
      const msg = "⏰ You asked me to remind you: " + r["holmem:text"] + ".";
      if (heroOpen() && window.HoloQ && window.HoloQ.liveIngest) { window.HoloQ.liveIngest("q", msg); try { voice.speak(msg); } catch {} }
      else {
        try { const K = "holo.q.reach.v1"; const st = JSON.parse(localStorage.getItem(K) || "{}"); if (!st.pending) { st.pending = { text: msg, at: Date.now(), reason: "reminder" }; localStorage.setItem(K, JSON.stringify(st)); } } catch {}
        try { window.QReach && window.QReach.badge && window.QReach.badge(true); } catch {}
      }
    } catch (e) {} finally { busy = false; }
  }
  setInterval(tick, 15000); setTimeout(tick, 6000);
  window.QRemind = { tick, version: 1 };
} catch (e) { try { console.warn("[q-remind] init failed:", e); } catch {} } })();

// ── debug/verification surface ────────────────────────────────────────────────────────────────────────────

// THE DRAWER IS Q-CHAT (2026-07-13): mount the feature-complete standalone q-chat inside the Q hero.
function mountQChat() {
  const hero = DOC.querySelector(".holo-hero");
  if (!hero || hero.querySelector(".q-chat-iframe")) return;
  const f = DOC.createElement("iframe");
  f.className = "q-chat-iframe";
  try { f.allow = "microphone; camera; autoplay"; } catch (e) {}   // delegate mic/cam/autoplay into the iframe (else getUserMedia is blocked → "couldn't reach the microphone")
  try { f.src = new URL("../q/q-chat.html?guest=1&embed=1", import.meta.url).href; } catch { f.src = "/apps/q/q-chat.html?guest=1&embed=1"; }
  f.addEventListener("load", () => { try {
    const d = f.contentDocument; if (!d) return;                       // same-origin → we can style it plain
    const st = d.createElement("style"); st.id = "q-embed";
    st.textContent = "#wall,.wall,[class*=wall]{display:none!important}html,body,header,#log,main,[class*=thread],footer{background:#1f1f1e!important;background-image:none!important;backdrop-filter:none!important;border:0!important}body::before,body::after{display:none!important}/*HOLO-Q-SEAMLESS*/#in{background:rgba(255,255,255,.055)!important;box-shadow:none!important;border:0!important}.inwrap::before,.inwrap::after{display:none!important}.chip{background:rgba(255,255,255,.05)!important;border-color:transparent!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}#send{background:rgba(255,255,255,.09)!important;box-shadow:none!important}header{border-bottom-color:transparent!important}";
    d.head.appendChild(st);
    // ONE clean greeting: drop q-chat's idle "No rush…" nudge (it persists in history → reads as a 2nd greeting)
    try {
      const w = f.contentWindow, NUDGE = "No rush at all";
      const kill = () => { d.querySelectorAll(".msg").forEach((m) => { if (((m.textContent || "").trim()).indexOf(NUDGE) === 0) m.remove(); }); };
      kill(); new w.MutationObserver(kill).observe(d.body, { childList: true, subtree: true });
    } catch {}
  } catch {} });
  hero.appendChild(f);
}
new MutationObserver(mountQChat).observe(DOC.body, { childList: true, subtree: true });
mountQChat();

window.QSummon = {
  thread: () => ledger.slice(),
  verify: () => ({ ok: verifyChain(), brokenAt, sealed: ledger.length }),
  kappaOf: (i) => (ledger[i] || {}).k || null,
  speak: (t) => voice.speak(t),
  name: () => firstName(),
  open: () => { if (!heroOpen()) { const orb = $(".holo-home-orb, .holo-global-orb"); if (orb) orb.click(); openClasses(); speakGreeting(); warm(); } },   // programmatic summon (the one door's Q.summon)
  version: 4,
};
try { console.info("[q-summon] live — RIGHT docked drawer (wallet parity) · sealed:", ledger.length, "· chain:", chainOk ? "verified" : "BROKEN@" + brokenAt); } catch {}

// ══ THE ONE DOOR (Q-ONE U4): window.Q — the single canonical surface every human, app, and agent touches.
// ZERO new logic: every verb DELEGATES to the one proven implementation underneath (HoloQ · HoloCorpus ·
// HoloMemory · QSummon · QLiveHero) — this is unification, not another Q. Non-clobbering: if a window.Q
// already exists (the holospace shim, the OS shell), only the MISSING verbs are added, so the door is one
// continuous surface everywhere. Fail-soft (the Q-Sees law): the drawer never depends on this block.
(function qDoor() { try {
  const Q = (window.Q && typeof window.Q === "object") ? window.Q : {};
  const HQ = () => window.HoloQ || {};
  const add = (name, fn) => { if (!(name in Q)) Q[name] = fn; };
  add("act",      (t) => { const h = HQ(); return h.act ? h.act(t) : Promise.resolve(null); });                       // say it, done (classify → do, injection-immune)
  add("ask",      async (t) => { const h = HQ(); try { const a = h.act ? await h.act(t) : null; if (a) return a; } catch (e) {} try { if (h.ready && h.ready() && h.generate) return await h.generate(String(t || "")); } catch (e) {} return null; });   // an answer or a deed — the brain when warm, honest null when cold
  add("open",     (app) => { const h = HQ(); return h.act ? h.act("open " + String(app || "")) : Promise.resolve(null); });
  add("summon",   () => { try { window.QSummon && window.QSummon.open && window.QSummon.open(); return true; } catch (e) { return false; } });
  add("call",     () => { try { return !!(window.QLiveHero && (window.QLiveHero.start(), true)); } catch (e) { return false; } });
  add("remember", (t) => { const h = HQ(); return h.remember ? h.remember(t) : undefined; });
  add("recall",   (q, k) => { const h = HQ(); return h.recall ? h.recall(q, k) : Promise.resolve([]); });
  add("know",     (source, text, meta) => { const C = window.HoloCorpus; return (C && C.publish) ? C.publish({ source, text, meta }) : Promise.resolve(null); });   // project a fact into Q's world
  add("facts",    (q, k) => { const C = window.HoloCorpus; return (C && C.recall) ? C.recall(q, k) : Promise.resolve([]); });
  add("grounded", (q) => { const h = HQ(); return h.grounded ? h.grounded(q) : Promise.resolve(""); });
  add("warm",     () => { const h = HQ(); try { h.warm && h.warm(); h.warmSeed && h.warmSeed(); } catch (e) {} });
  add("ready",    () => { const h = HQ(); try { return !!(h.ready && h.ready()); } catch (e) { return false; } });
  add("stats",    () => { const h = HQ(); try { return h.stats ? h.stats() : null; } catch (e) { return null; } });
  add("self",     async () => {   // Q's honest, live self-description — derived, never confabulated
    const h = HQ(); const out = { name: "Q", where: "on this device — private, serverless", ready: false };
    try { out.ready = !!(h.ready && h.ready()); } catch (e) {}
    try { out.persona = h.persona ? h.persona().slice(0, 400) : ""; } catch (e) {}
    try { out.stats = h.stats ? h.stats() : null; } catch (e) {}
    try { if (window.HoloMemory && window.HoloMemory.summary) out.memory = window.HoloMemory.summary(); } catch (e) {}
    try { if (window.HoloCorpus && window.HoloCorpus.summary) out.world = await window.HoloCorpus.summary(); } catch (e) {}
    try { if (window.QSummon && window.QSummon.verify) out.thread = window.QSummon.verify(); } catch (e) {}
    try { if (window.QEvolve && window.QEvolve.status) out.evolution = await window.QEvolve.status(); } catch (e) {}   // U3b: the honest self-evolution record — how Q lawfully became more itself
    return out;
  });
  add("evolve",   () => { const E = window.QEvolve; return (E && E.propose) ? window.Q.act("evolve yourself") : Promise.resolve(null); });   // the door's verb → the one action path
  window.Q = Q;
  try { console.info("[q-door] ONE door live — window.Q (ask · act · open · summon · call · remember · recall · know · facts · grounded · warm · self)"); } catch (e) {}
} catch (e) { try { console.warn("[q-door] init failed:", e); } catch {} } })();
