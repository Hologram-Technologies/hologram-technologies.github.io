// q-summon.mjs — tap the Q orb and Q slides in from the RIGHT as a docked drawer, exactly like Holo Wallet:
// same width, same chrome (#0d1117 = --holo-chrome), and it SQUEEZES the home canvas to the left (the wallet's
// own dock mechanism, mirrored) rather than covering it. It is the messenger's OWN Q — one brain, one voice,
// one memory — re-framed as a docked panel. Four welds, all additive, all fail-soft:
//
//   1. THE DOCKED DRAWER — the fully-wired hero (`.holo-hero`) is restyled in place into a RIGHT panel of the
//      wallet width, background var(--holo-chrome) (seamless chrome, no starfield); `html.q-docked` pulls the
//      home wall/scrim/greeting/orb/quote in by the drawer width so the canvas re-centers in the freed space.
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

// ── the drawer skin: a right-side panel of wallet dimensions + rail chrome, and the DOCK that squeezes home ──
const css = DOC.createElement("style");
css.id = "q-summon-css";
css.textContent = `
:root{ --q-rail-w: var(--holo-rail-w, 60px); --q-drawer-w: min(94vw, max(440px, 44vw)); }

/* DOCK — squeeze the home canvas LEFT by the drawer width (the wallet's own mechanism, mirrored for Q) */
html.q-docked .holo-wa-root{ width: calc(100vw - var(--q-drawer-w))!important; }
html.q-docked .holo-home-space{ right: var(--q-drawer-w)!important; }
html.q-docked .holo-home-wall,html.q-docked .holo-home-scrim{ right: var(--q-drawer-w)!important; }
html.q-docked .holo-home-orb,html.q-docked .holo-global-orb{ right: calc(var(--q-drawer-w) + clamp(22px,3.2vw,48px))!important; }
html.q-docked .holo-home-quote{ left: calc(var(--q-rail-w) + (100vw - var(--q-rail-w) - var(--q-drawer-w)) / 2)!important; }
html.q-docked .holo-wa-root .cs-main-container{ right: var(--q-drawer-w)!important; }
/* smooth squeeze both ways */
.holo-home-space,.holo-home-wall,.holo-home-scrim,.holo-home-orb,.holo-global-orb,.holo-home-quote,.holo-wa-root{
  transition: right .38s cubic-bezier(.4,0,.2,1), left .38s cubic-bezier(.4,0,.2,1), width .38s cubic-bezier(.4,0,.2,1)!important; }

/* THE DRAWER — the hero, re-framed on the RIGHT. Wallet width, chrome background (no starfield). */
html.q-drawer .holo-hero{
  inset:0 0 0 auto!important; width:var(--q-drawer-w)!important;
  background:var(--holo-chrome,#0d1117)!important;
  padding-top:0!important; align-items:stretch!important; justify-content:flex-start!important;
  border-left:1px solid rgba(255,255,255,.06);
  box-shadow:-16px 0 60px rgba(0,0,0,.5);
  animation:q-drawer-in .42s ease both!important; touch-action:auto!important;
}
/* opacity-only (NO transform): a transform on .holo-hero would make its position:fixed composer hero-relative.
   The motion comes from the DOCK — the canvas squeezing left as Q fades in (exactly like the wallet). */
@keyframes q-drawer-in{ from{opacity:0} to{opacity:1} }
/* header row: a small living orb + status, top-left of the drawer (absolute within the hero → tracks the panel) */
html.q-drawer .holo-hero-orb{ position:absolute!important; top:15px!important; left:17px!important; width:42px!important; height:42px!important; min-width:0!important; margin:0!important; filter:drop-shadow(0 0 12px rgba(91,140,255,.5))!important; }
html.q-drawer .holo-hero-orb.listening{ filter:drop-shadow(0 0 20px rgba(125,239,201,.6))!important; }
html.q-drawer .holo-hero-status{ position:absolute!important; top:26px!important; left:70px!important; margin:0!important; font-size:10.5px!important; letter-spacing:.18em!important; }
html.q-drawer .holo-hero-x{ position:absolute!important; top:13px!important; right:13px!important; width:34px; height:34px; }
html.q-drawer .holo-hero-stage{ max-width:none!important; width:100%!important; margin-top:62px!important; padding:0 10px!important; align-items:stretch!important; }
html.q-drawer .holo-hero-thread{ max-width:none!important; width:100%!important; padding:8px 8px 88px!important; -webkit-mask-image:none!important; mask-image:none!important; }
html.q-drawer .holo-hero-bubble{ max-width:90%!important; }
html.q-drawer .holo-hero-empty{ max-width:none!important; padding:0 18px; }
html.q-drawer .holo-hero-open{ display:none!important; }
/* CLEAN q-chat look: hide the inbox brief / auto-tidy / ledger — a conversation, not a dashboard */
html.q-drawer .holo-hero-brief,html.q-drawer .holo-hero-auto,html.q-drawer .holo-hero-ledger{ display:none!important; }
/* composer pill centered WITHIN the right drawer */
html.q-drawer .holo-hero-compose{ left:calc(100vw - var(--q-drawer-w) / 2)!important; width:min(calc(var(--q-drawer-w) - 26px), 92vw)!important; bottom:calc(16px + env(safe-area-inset-bottom))!important; }

/* the header title "Q" — top-left of the drawer */
#q-drawer-title{position:fixed;top:16px;left:calc(100vw - var(--q-drawer-w) + 70px);z-index:302;color:#f4f7fc;font:650 17px/1 -apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.2px;pointer-events:none;opacity:0;transition:opacity .3s ease}
html.q-drawer #q-drawer-title{opacity:1}
/* κ-chain proof chip — bottom-left, inside the drawer */
#q-kappa-chip{position:fixed;left:calc(100vw - var(--q-drawer-w) + 12px);bottom:14px;z-index:340;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;
  color:#9fd3ff;background:rgba(10,14,20,.55);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:5px 10px;pointer-events:none;opacity:0;transition:opacity .5s ease .25s}
#q-kappa-chip.on{opacity:.7}
#q-kappa-chip.bad{color:#ffb3c0;border-color:rgba(255,120,140,.4)}
/* SUGGESTION CHIPS — inside the right drawer, above the composer */
#q-hero-chips{position:fixed;left:calc(100vw - var(--q-drawer-w));width:var(--q-drawer-w);box-sizing:border-box;bottom:calc(env(safe-area-inset-bottom) + 74px);z-index:305;
  display:flex;gap:8px;justify-content:center;flex-wrap:wrap;padding:0 14px;pointer-events:none;
  opacity:0;transform:translateY(6px);transition:opacity .45s ease,transform .45s cubic-bezier(.4,0,.2,1)}
#q-hero-chips.on{opacity:1;transform:none}
#q-hero-chips button{pointer-events:auto;white-space:nowrap;color:#eef3fb;border-radius:20px;padding:7px 13px;font-size:12.5px;
  cursor:pointer;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.05);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:transform .14s ease,border-color .16s ease,background .16s ease}
#q-hero-chips button:hover{border-color:rgba(139,123,255,.55);transform:translateY(-1px);background:rgba(255,255,255,.09)}
#q-hero-chips button:active{transform:scale(.96)}
@media (prefers-reduced-motion:reduce){#q-hero-chips{transition:opacity .2s ease}}

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
}
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
warmWhenIdle();

let greeting = false;
function speakGreeting() { greeting = true; Promise.resolve(voice.speak(greetLine())).catch(() => {}).then(() => { greeting = false; }); }
function bargeIn() { if (greeting) { greeting = false; try { voice.stop(); } catch {} } }
window.addEventListener("keydown", bargeIn, { capture: true, passive: true });

// ── open (dock + drawer) on orb tap; the tap opens the hero, we just add the classes + speak ───────────────
const heroOpen = () => !!$(".holo-hero");
let titleEl = null;
function ensureTitle() { if (!titleEl) { titleEl = DOC.createElement("div"); titleEl.id = "q-drawer-title"; titleEl.textContent = "Q"; DOC.body.appendChild(titleEl); } }
function openClasses() { HTML.classList.add("q-drawer", "q-docked"); ensureTitle(); }
function closeClasses() { HTML.classList.remove("q-drawer", "q-docked"); }
function onOrbDown(e) {
  if (heroOpen()) return;
  const orb = e.target && e.target.closest && e.target.closest(".holo-home-orb, .holo-global-orb");
  if (!orb) return;
  openClasses();                    // the hero mounts already-docked (canvas squeezes as Q slides in)
  speakGreeting();                  // the tap IS the gesture → Q speaks by name at t=0
  warm();                           // …and the SAME gesture kicks the brain + seed load NOW (not at idle) → by the
                                    // time you finish reading the greeting + typing, the seed can answer instantly
  setTimeout(() => { if (!heroOpen()) closeClasses(); }, 1500);   // safety: never leave the canvas squeezed with no drawer
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
const CHIPS = ["Tell me something amazing", "Write me something beautiful", "Help me think through something", "Tell me a joke"];
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

// observe the hero: seal each bubble; manage the docked-drawer lifecycle
const mo = new MutationObserver((muts) => {
  for (const mut of muts) {
    for (const n of mut.addedNodes) {
      if (!(n instanceof Element)) continue;
      if (n.classList && n.classList.contains("holo-hero")) { openClasses(); verifyChain(); chip(); setTimeout(showChips, 300); }
      const bubbles = n.classList && n.classList.contains("holo-hero-bubble") ? [n] : (n.querySelectorAll ? n.querySelectorAll(".holo-hero-bubble") : []);
      for (const b of bubbles) {
        if (b.classList.contains("typing")) continue;
        const role = b.classList.contains("me") ? "me" : "q";
        const k = seal(role, (b.textContent || "").trim());
        if (role === "me") hideChips();
        if (k && role === "q") bargeIn();
      }
    }
    for (const n of mut.removedNodes) {
      if (n instanceof Element && n.classList && n.classList.contains("holo-hero")) {
        closeClasses();                          // un-squeeze the canvas
        if (chipEl) chipEl.classList.remove("on");
        hideChips(); bargeIn();
      }
    }
  }
});
mo.observe(DOC.body, { childList: true, subtree: true });

// ── debug/verification surface ────────────────────────────────────────────────────────────────────────────
window.QSummon = {
  thread: () => ledger.slice(),
  verify: () => ({ ok: verifyChain(), brokenAt, sealed: ledger.length }),
  kappaOf: (i) => (ledger[i] || {}).k || null,
  speak: (t) => voice.speak(t),
  name: () => firstName(),
  version: 4,
};
try { console.info("[q-summon] live — RIGHT docked drawer (wallet parity) · sealed:", ledger.length, "· chain:", chainOk ? "verified" : "BROKEN@" + brokenAt); } catch {}
