// holo-signin.mjs — the ONE sovereign sign-in surface for the whole Hologram system.
//
// Every surface — the messenger, any holospace, (next) the OS greeter — mounts THIS, so the entire sign-in
// stack is a platform primitive, not per-app code:
//   • TEE ceremony (holo-webauthn: native Windows Hello / Touch ID → localhost broker → WebAuthn PRF)
//   • sovereign identity (holo-login: BIP-39 seed vault, one did:holo κ, SAME store as the OS greeter)
//   • Sovereign SSO (holo-sso: adopt the session's operator; silent within the enclave trust-window)
//   • Guest (explicit, discoverable; ?guest=1 / window.HoloLogin.guest() for agents)
//   • Identity Roam & Recovery (holo-roam: add a device / restore, same κ, no seed phrase)
//   • Deep Resume (holo-roam.sealResume: your experience follows you, sealed)
//   • speculative warm paint (the caller's warmPaint() overlaps the human's look-and-tap)
//
// ONE CALL for an app author:  const { operator, principal, secret } = await signIn({ app, root })
// It resolves ONLY once a principal is established (TEE unlock/enrol, roam/restore, or an explicit Guest) —
// fail-CLOSED. The signing key + PRF secret NEVER leave the enclave-wrapped vault path. `signOut()` clears
// presence + realm + session; `stepUp(action)` is the payload-bound biometric for confidential actions.
//
// Consumers pass only their specifics: `app` (session label), `appName` (enclave credential label),
// `nextPath` (the shell to open), `warmPaint` (a thunk to warm their shell during the tap), `chrome`
// (reserved: "minimal" today; "full" adds the OS greeter's power/session/pair furniture). Same κ everywhere.

import { teeReason, teeName, teeAssert, teeEnroll, teeError } from "./holo-webauthn.mjs";
import { readPresence, publishPresence, adoptDecision } from "./holo-sso.mjs";
import * as roam from "./holo-roam.mjs";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const initials = (n) => (String(n || "").trim().split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("") || "·").toUpperCase();
const hueOf = (u) => (u && u.avatar && u.avatar.hue != null ? u.avatar.hue : (u && u.hue != null ? u.hue : 210)) | 0;

const I = {
  fp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5.5 11a6.5 6.5 0 0 1 13 0"/><path d="M8.5 11a3.5 3.5 0 0 1 7 0v2.6"/><path d="M12 11v4.4"/><path d="M8.6 14.2V16"/><path d="M15.4 15.4V18"/></svg>',
  person: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8.4" r="4.1"/><path d="M3.8 20.4a8.2 8.2 0 0 1 16.4 0z"/></svg>',
  ghost: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 19a6.5 6.5 0 0 1 13 0"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M12 6l6 6-6 6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
};
// Touch devices get the slide-to-enter; fine-pointer (desktop) keeps the tap key. Resolved once.
const COARSE = (() => { try { const uad = navigator.userAgentData; const mobile = uad ? !!uad.mobile : /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ""); return mobile && matchMedia("(pointer:coarse)").matches; } catch { return false; } })();
const beamHtml = () => `<svg class="hl-beam" preserveAspectRatio="none"><rect x="1" y="1" rx="11" ry="11" pathLength="100"></rect></svg>`;
const enclaveHtml = () => { let n = "this device"; try { n = teeName() || n; } catch {} return `<div class="hl-enclave">${I.lock}<span>Secured by ${esc(n)}</span></div>`; };
const slideHtml = (label) => `<div class="hl-slide" id="hl-slide" role="button" tabindex="0" aria-label="Slide to sign in as ${esc(label)}"><div class="hl-fill"></div><div class="hl-track-lbl"><span>Slide to enter</span></div><div class="hl-knob">${I.arrow}</div></div>`;
// size the beam SVG rect to the key's exact px so the mint comet rides an even rim on a wide button.
function sizeBeam(panel) {
  try { const b = panel.querySelector(".hl-beam"); if (!b) return; const btn = b.closest(".hl-bio"); if (!btn) return;
    const w = btn.clientWidth, h = btn.clientHeight; if (!w || !h) return;
    b.setAttribute("viewBox", `0 0 ${w} ${h}`); const r = b.querySelector("rect"); r.setAttribute("width", w - 2); r.setAttribute("height", h - 2);
  } catch {}
}
// SLIDE-TO-ENTER — a deliberate drag is intent (can't misfire); on release past ~85% it fires onComplete
// (the SAME fail-closed biometric as the tap). fail() snaps the knob back with no penalty.
function resetSlide(slide) {
  const knob = slide.querySelector(".hl-knob"), fill = slide.querySelector(".hl-fill"), lbl = slide.querySelector(".hl-track-lbl");
  slide.classList.remove("armed", "done"); slide.__done = false;
  knob.style.transition = "left .3s cubic-bezier(.4,0,.2,1)"; fill.style.transition = "width .3s cubic-bezier(.4,0,.2,1)";
  knob.style.left = "4px"; fill.style.width = "0"; if (lbl) lbl.innerHTML = "<span>Slide to enter</span>";
}
function wireSlide(slide, onComplete) {
  const knob = slide.querySelector(".hl-knob"), fill = slide.querySelector(".hl-fill"), lbl = slide.querySelector(".hl-track-lbl");
  let dragging = false, startX = 0, x = 0, max = 0;
  const px = (e) => (e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0));
  const bounds = () => { max = slide.clientWidth - knob.offsetWidth - 8; };
  const set = (v) => { x = Math.max(0, Math.min(max, v)); knob.style.left = (4 + x) + "px"; fill.style.width = (knob.offsetWidth + x) + "px"; slide.classList.toggle("armed", x > max * 0.55); };
  const down = (e) => { if (slide.__done) return; dragging = true; bounds(); startX = px(e) - x; knob.style.transition = "none"; fill.style.transition = "none"; try { knob.setPointerCapture && e.pointerId != null && knob.setPointerCapture(e.pointerId); } catch {} e.preventDefault(); };
  const move = (e) => { if (!dragging) return; set(px(e) - startX); };
  const up = () => { if (!dragging) return; dragging = false;
    if (x >= max * 0.85) finish();
    else { knob.style.transition = "left .28s cubic-bezier(.4,0,.2,1)"; fill.style.transition = "width .28s cubic-bezier(.4,0,.2,1)"; set(0); slide.classList.remove("armed"); } };
  const finish = () => { slide.__done = true; bounds(); knob.style.transition = "left .2s"; fill.style.transition = "width .2s"; slide.classList.add("done"); set(max); if (lbl) lbl.innerHTML = `<span class="spin"></span><span>Verifying…</span>`; onComplete(); };
  knob.addEventListener("pointerdown", down); addEventListener("pointermove", move); addEventListener("pointerup", up);
  knob.addEventListener("touchstart", down, { passive: false }); addEventListener("touchmove", move, { passive: false }); addEventListener("touchend", up);
  bounds();
}

function avatarHtml(u) {
  if (u && u.label) { const h = hueOf(u); return `<div class="hl-avatar" style="background:linear-gradient(140deg,hsl(${h} 52% 46%),hsl(${h + 26} 52% 46%))">${esc(initials(u.label))}</div>`; }
  return `<div class="hl-avatar" style="background:linear-gradient(140deg,#5b6b86,#3a455c)">${I.person}</div>`;
}
// THE SOVEREIGN FACE on the gate: the initials paint instantly (never block first frame), then the operator's
// verified portrait — resolved through the SAME one door every surface uses (messenger rail, wallet pill,
// identity card: holo-portrait.mjs) — takes their place. u.kappa resolves the bound record; the κ-less greeting
// hint uses the last-operator hint record. Both verify by re-derivation (Law L5): tampered bytes simply leave
// the initials standing. An explicit guest never hydrates (guest law).
async function hydrateFace(panel, u) {
  try {
    if (!u || u.guest) return;
    const P = await import("./holo-portrait.mjs");
    const p = u.kappa ? await P.resolvePortrait(u.kappa) : await P.resolveHintPortrait();
    const el = panel && panel.querySelector(".hl-avatar");
    if (!p || !el) return;
    el.innerHTML = `<img src="${p.url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } catch {}
}
// SUPER-CLEAN GATE: two choices on the face — the biometric (your name) + "Continue as guest". The rare
// recovery doors (another device / restore) live behind the SAME ⋯ the appearance does (holo-plymouth's
// panel renders whatever actions the primitive offers it) — one quiet door for everything secondary.
const guestBtnHtml = () => `<button class="hl-alt" id="hl-guestbtn">${I.ghost}<span>Continue as guest</span></button>`;

const _linkStyle = "width:100%;font-size:12px;padding:10px;border-radius:8px;background:rgba(255,255,255,.08);color:#cfe;border:1px solid rgba(255,255,255,.15);font-family:inherit";
function renderAddDevice(panel, url) {
  panel.innerHTML = `${avatarHtml(null)}<h1 class="hl-name">Add this device</h1>
    <div class="hl-auth">
      <div class="status">On a device you're already signed into, open this and approve:</div>
      <div id="hl-qr" style="width:196px;height:196px;background:#fff;border-radius:12px;padding:8px;box-sizing:border-box;display:none"></div>
      <input id="hl-adddev-url" readonly value="${esc(url)}" style="${_linkStyle}">
      <div class="status"><span class="spin"></span><span>Waiting for your other device…</span></div>
    </div>`;
  try { import("./holo-qr.js").then((q) => { try { const svg = (q.toSVG || q.encode)(url, { scale: 5, margin: 2, dark: "#06140f", light: "#ffffff" }); const el = panel.querySelector("#hl-qr"); if (el && svg) { el.innerHTML = svg; el.style.display = "block"; const s = el.querySelector("svg"); if (s) { s.style.width = "100%"; s.style.height = "100%"; s.style.imageRendering = "pixelated"; } } } catch {} }).catch(() => {}); } catch {}
}
function renderRestore(panel) {
  panel.innerHTML = `${avatarHtml(null)}<h1 class="hl-name">Restore</h1>
    <div class="hl-auth">
      <input id="hl-restore-link" placeholder="Recovery link" style="${_linkStyle}">
      <input id="hl-restore-code" placeholder="Code" inputmode="numeric" autocomplete="one-time-code" style="${_linkStyle}">
      <button class="hl-bio" id="hl-restore-go">${I.arrow}Restore</button>
      <div class="status"></div>
    </div>`;
}

// cache a tiny NON-secret greeting hint under the key the OS greeter uses (holo.lastOperator) so a returning
// operator's name + "It's me" paint at first frame next cold open — zero identity load.
function cacheOperator(u) {
  try { if (u && u.label) localStorage.setItem("holo.lastOperator", JSON.stringify({ label: u.label, hue: hueOf(u), cred: (u.cred != null ? (typeof u.cred === "string" ? true : !!u.cred) : true) })); } catch {}
}

// LATENCY: warm the heavy identity graph (holo-login → WDK vault) + the caller's shell DURING the look-and-tap.
let _warm = false;
function prewarm(warmPaint) {
  if (_warm) return; _warm = true;
  try { import("./holo-login.mjs"); } catch {}
  try { if (typeof warmPaint === "function") warmPaint(); } catch {}
}

// SELF-CONTAINED CSS — so ANY surface can mount the primitive UNSTYLED. Injected ONLY when the primitive
// creates its own overlay (i.e. the host page did NOT pre-place + style #holo-login). A host that provides
// #holo-login (the messenger's app.html) owns its own look and this is a no-op — never overrides it.
const HL_CSS = `#holo-login{position:fixed;inset:0;z-index:2147483000;color:var(--ink);font-family:"Segoe UI",system-ui,-apple-system,sans-serif;
  --u:clamp(19px,2vmin,23px);--g1:calc(var(--u)*1.618);--g2:calc(var(--u)*2.618);--avatar:clamp(96px,calc(var(--u)*6.854),128px);--field:min(86vw,calc(var(--avatar)*2.618));--accent:#7defc9;--accent-2:#34d3a6;
  --ink:#f4f7fc;--ink-dim:rgba(231,237,250,.82);--status:#c4f3e2;--shadow:0 2px 18px rgba(0,0,0,.45);--wall:var(--boot-ground,#1f1f1e);
  --glass:rgba(10,14,20,.42);--glass-border:rgba(255,255,255,.14);--glass-ink:rgba(231,237,250,.8);
  --sheet:rgba(8,12,18,.94);--muted:#8b949e;--link:#58a6ff;--field-bg:rgba(255,255,255,.09);--field-border:rgba(255,255,255,.22)}
#holo-login[data-appearance="dark"]{--shadow:none}
#holo-login[data-appearance="light"]{--ink:#0b1220;--ink-dim:rgba(11,18,32,.74);--status:#0e6f5c;--shadow:none;--wall:#eef1f6;
  --glass:rgba(255,255,255,.66);--glass-border:rgba(11,18,32,.18);--glass-ink:rgba(11,18,32,.8);
  --sheet:rgba(250,252,255,.97);--muted:#5a6572;--link:#0969da;--field-bg:rgba(11,18,32,.06);--field-border:rgba(11,18,32,.22)}
#holo-login *{box-sizing:border-box}
#holo-login .hl-wall{position:fixed;inset:0;z-index:0;background:var(--wall) center/cover no-repeat}
#holo-login .hl-frost{position:fixed;inset:0;z-index:1;background:transparent;pointer-events:none}
#holo-login .hl-lock{position:fixed;inset:0;z-index:2;display:grid;justify-items:center;align-items:start;padding:calc(61.8vh - var(--avatar)/2) var(--g2) var(--g2);padding-top:calc(61.8dvh - var(--avatar)/2);pointer-events:none}
@media (max-height:620px),(max-width:500px){#holo-login .hl-lock{padding-top:calc(56vh - var(--avatar)/2);padding-top:calc(56dvh - var(--avatar)/2)}}
#holo-login .hl-panel{display:flex;flex-direction:column;align-items:center;text-align:center;width:var(--field);max-width:92vw;pointer-events:auto;animation:hl-rise .7s cubic-bezier(.4,0,.2,1) .05s both}
#holo-login .hl-avatar{width:var(--avatar);height:var(--avatar);border-radius:50%;display:grid;place-items:center;color:#fff;font-size:calc(var(--avatar)*.37);font-weight:600;box-shadow:0 .5em 1.5em rgba(0,0,0,.35),inset 0 0 0 1.5px rgba(255,255,255,.38)}
#holo-login .hl-avatar svg{width:62%;height:62%;opacity:.92}
#holo-login .hl-name{margin:var(--g1) 0 0;font-size:var(--u);font-weight:600;letter-spacing:.01em;line-height:1.15;text-shadow:var(--shadow)}
#holo-login .hl-auth{margin-top:var(--g1);display:flex;flex-direction:column;align-items:center;gap:var(--u);width:100%}
#holo-login .hl-bio{position:relative;overflow:hidden;width:100%;min-height:max(var(--g2),52px);border-radius:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:calc(var(--u)*.55);font-size:var(--u);font-weight:600;letter-spacing:.01em;color:#eef2f8;background:linear-gradient(180deg,rgba(28,30,28,.94),rgba(12,13,12,.96));border:1px solid rgba(255,255,255,.16);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 12px 34px rgba(0,0,0,.5);font-family:inherit;transition:transform .12s,box-shadow .18s,border-color .3s}
#holo-login .hl-bio:hover{transform:translateY(-1px);border-color:rgba(125,239,201,.45);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 16px 40px rgba(0,0,0,.55),0 0 0 1px rgba(52,211,166,.1)}
#holo-login .hl-bio:active{transform:translateY(0) scale(.99)}
#holo-login .hl-bio:disabled{cursor:progress;border-color:rgba(125,239,201,.55)}
#holo-login .hl-bio:disabled span{color:var(--accent)}
#holo-login .hl-bio svg:not(.hl-beam){width:1.3em;height:1.3em;flex:0 0 auto;color:var(--accent)}
#holo-login .hl-bio .hl-beam{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity .2s}
#holo-login .hl-bio .hl-beam rect{fill:none;stroke:var(--accent);stroke-width:1.6;stroke-dasharray:15 85;stroke-linecap:round;filter:drop-shadow(0 0 5px rgba(52,211,166,.7))}
#holo-login .hl-bio:disabled .hl-beam{opacity:1}
#holo-login .hl-bio:disabled .hl-beam rect{animation:hl-beam 1.3s linear infinite}
@keyframes hl-beam{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}
#holo-login .hl-enclave{margin-top:calc(var(--u)*-.35);display:flex;align-items:center;justify-content:center;gap:calc(var(--u)*.42);font-size:var(--u);font-weight:450;color:var(--ink-dim);opacity:.66;text-shadow:var(--shadow)}
#holo-login .hl-enclave svg{width:1em;height:1em;color:var(--accent);opacity:.9;flex:0 0 auto}
#holo-login .hl-slide{position:relative;width:100%;min-height:max(var(--g2),56px);border-radius:12px;user-select:none;touch-action:none;overflow:hidden;background:linear-gradient(180deg,rgba(28,30,28,.94),rgba(12,13,12,.96));border:1px solid rgba(255,255,255,.16);box-shadow:inset 0 1px 3px rgba(0,0,0,.6)}
#holo-login .hl-slide .hl-fill{position:absolute;top:0;bottom:0;left:0;width:0;border-radius:12px;background:linear-gradient(90deg,rgba(52,211,166,.34),rgba(52,211,166,.03))}
#holo-login .hl-slide .hl-track-lbl{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:calc(var(--u)*.45);pointer-events:none;color:var(--ink-dim);font-size:var(--u);font-weight:500;letter-spacing:.01em;text-shadow:var(--shadow)}
#holo-login .hl-slide .hl-knob{position:absolute;top:4px;bottom:4px;left:4px;aspect-ratio:1;border-radius:9px;cursor:grab;display:grid;place-items:center;color:#062019;background:linear-gradient(180deg,#3ce0b0,#28c096);box-shadow:0 4px 12px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.42);touch-action:none}
#holo-login .hl-slide .hl-knob:active{cursor:grabbing}
#holo-login .hl-slide .hl-knob svg{width:1.3em;height:1.3em;color:#062019}
#holo-login .hl-slide.armed{border-color:rgba(125,239,201,.5)}
#holo-login .hl-slide.done .hl-fill{width:100%!important;background:linear-gradient(90deg,#34d3a6,#7defc9)}
#holo-login .hl-alt{background:none;border:0;color:var(--ink-dim);opacity:.66;margin-top:calc(var(--u)*.3);font-size:var(--u);font-weight:500;font-family:inherit;cursor:pointer;padding:calc(var(--u)*.3) calc(var(--u)*.55);border-radius:calc(var(--u)*.4);display:inline-flex;align-items:center;gap:calc(var(--u)*.4);min-height:44px;transition:color .15s,opacity .15s}
#holo-login .hl-alt:hover{color:var(--ink);opacity:1}#holo-login .hl-alt svg{width:1.05em;height:1.05em}
#holo-login .hl-more{opacity:.72}#holo-login .hl-more:hover{opacity:1}
#holo-login .status{min-height:calc(var(--u)*1.5);font-size:var(--u);color:var(--status);display:flex;align-items:center;justify-content:center;gap:calc(var(--u)*.5);text-shadow:var(--shadow)}
#holo-login .status.err{color:#ffc0c0}
#holo-login[data-appearance="light"] .status.err{color:#b3261e}
#holo-login .spin{width:1em;height:1em;border-radius:50%;border:2px solid rgba(125,239,201,.28);border-top-color:var(--accent);animation:hl-spin .7s linear infinite;flex:0 0 auto}
@keyframes hl-spin{to{transform:rotate(360deg)}}@keyframes hl-rise{from{opacity:0;transform:translateY(10px) scale(.99);filter:blur(2px)}to{opacity:1;transform:none;filter:none}}
#holo-login.unfog .hl-frost{animation:hl-defog .72s cubic-bezier(.4,0,.2,1) forwards}#holo-login.unfog .hl-panel{animation:hl-lift .68s cubic-bezier(.4,0,.2,1) forwards;pointer-events:none}
@keyframes hl-defog{to{opacity:0}}@keyframes hl-lift{to{opacity:0;transform:translateY(-10px) scale(1.03)}}
@media (prefers-reduced-motion:reduce){#holo-login .hl-panel,#holo-login .spin,#holo-login .hl-bio:disabled::after{animation:none}#holo-login.unfog .hl-frost,#holo-login.unfog .hl-panel{animation:hl-defog .3s ease forwards}}
/* NO-OVERLAP (appended override) — the panel was anchored at a fixed 61.8vh, independent of the bottom-pinned
   wordmark, so on any short-enough screen the actions ran into the brand. Cap the golden anchor so the panel
   always clears the reserved wordmark band (golden preserved wherever it fits); tiny screens drop the mark. */
#holo-login .hl-lock{padding-top:max(16px,min(calc(61.8vh - var(--avatar)/2),calc(100vh - 520px)));padding-bottom:max(var(--g2),88px)}
#holo-login .hl-lock{padding-top:max(16px,min(calc(61.8dvh - var(--avatar)/2),calc(100dvh - 520px)))}
@media (max-height:520px){#holo-login .hl-brand{display:none}}
/* CLAUDE-DESK BALANCE (appended override) — the greeter uses the screen the way the enclosing Claude desktop
   does: a larger identity slot (so the boot emblem lands bigger, per holo-plymouth's anchor math), the panel
   settled toward true centre, ONE uniform UI text (every visible word the same size and weight — only the
   HOLOGRAM logotype keeps its own logotype style), and a calmer bottom band under a smaller wordmark. */
#holo-login{--avatar:clamp(120px,calc(var(--u)*7.6),152px)}
#holo-login .hl-lock{padding-top:max(16px,min(calc(61.8vh - var(--avatar)/2),calc(100vh - 470px)))}
#holo-login .hl-lock{padding-top:max(16px,min(calc(61.8dvh - var(--avatar)/2),calc(100dvh - 470px)))}
#holo-login .hl-name,#holo-login .hl-lbl,#holo-login .hl-bio,#holo-login .hl-alt,#holo-login .hl-enclave{font-size:var(--u);font-weight:500;letter-spacing:0}
/* CENTER (appended override) — the side gutter YIELDS to the field: under ~710px wide the fixed φ gutter
   overflowed the single grid track right, so the panel sat off-centre on phones (+24px at 375px). */
#holo-login .hl-lock{padding-left:max(12px,min(var(--g2),calc((100vw - var(--field))/2)));padding-right:max(12px,min(var(--g2),calc((100vw - var(--field))/2)))}`;
function injectCss() {
  try { if (document.getElementById("holo-signin-css")) return; const s = document.createElement("style"); s.id = "holo-signin-css"; s.textContent = HL_CSS; document.head.appendChild(s); } catch {}
}
// the overlay: a full-bleed lock above #root (created here if the host page's baseline didn't).
function ensureOverlay() {
  let ov = document.getElementById("holo-login");
  if (ov) return ov;                                   // host provided + styled it (e.g. the messenger) → leave it
  injectCss();                                         // primitive-owned surface → bring our own CSS (self-contained)
  ov = document.createElement("div");
  ov.id = "holo-login";
  ov.innerHTML = `<div class="hl-wall"></div><div class="hl-frost"></div><main class="hl-lock"><div class="hl-panel" id="holo-login-panel"></div></main>`;
  document.body.appendChild(ov);
  return ov;
}

// ── THE ONE IDENTITY CONTROL — your name IS the sign-in. ──────────────────────────────────────────────
// No heading, no separate label: the emblem (or your portrait) above, then ONE button that carries the
// fingerprint and your name — who you are and the act of proving it are the same object. While the enclave
// checks you, the button scans (pure CSS on :disabled — every door gets it for free). Appearance and boot
// style live behind the ⋯ door (holo-plymouth's Appearance panel), so the lock itself stays two choices.
function renderBusy(panel, msg) {
  panel.innerHTML = `${avatarHtml(null)}<div class="hl-auth"><div class="status"><span class="spin"></span><span>${esc(msg || "")}</span></div></div>`;
}
function renderReturning(panel, u) {
  const label = esc(u.label || "It’s me");
  // Desktop: the name IS the tap key. Touch: a slide-to-enter (a drag is intent that can't misfire).
  const control = COARSE
    ? slideHtml(u.label || "you")
    : `<button class="hl-bio" id="hl-bio" aria-label="Sign in as ${esc(u.label || "you")}">${beamHtml()}${I.fp}<span class="hl-lbl">${label}</span></button>`;
  panel.innerHTML = `${avatarHtml(u)}
    <div class="hl-auth">${control}${guestBtnHtml()}<div class="status"></div></div>`;
  hydrateFace(panel, u);
  if (!COARSE) requestAnimationFrame(() => sizeBeam(panel));
}
function renderFirstRun(panel) {
  // First run enrols this device's enclave — a deliberate one-time act, so it stays a tap on every device.
  panel.innerHTML = `${avatarHtml(null)}
    <div class="hl-auth"><button class="hl-bio" id="hl-signin" title="One tap, nothing to set up">${beamHtml()}${I.fp}<span class="hl-lbl">Sign in</span></button>${guestBtnHtml()}<div class="status"></div></div>`;
  requestAnimationFrame(() => sizeBeam(panel));
}
function renderNoBio(panel, u, reason) {
  panel.innerHTML = `${avatarHtml(u)}
    <div class="hl-auth"><button class="hl-bio" id="hl-guest">${I.ghost}<span>Continue as guest</span></button>
      <div class="status">${esc(reason || "No device biometric here")}</div></div>`;
  hydrateFace(panel, u);
}

// ── THE NAME CEREMONY — authenticate first, name second (the holo-login.relabel seam, now wired). ─────────
// Once, right after the FIRST successful ceremony, the operator is asked what they want to be called. The
// name is metadata on the sovereign record (κ unchanged — identity stays the key, Law L1), lives ONLY in the
// device vault, and flows everywhere a greeting paints: session presentation (messenger home), holo.lastOperator
// (next boot's first frame), presence (SSO). Roam/restore joins arrive already named → no ask. Answering or
// declining both settle it — the question is asked at most once per operator, ever. Guests are never asked.
const NAME_DEFAULTS = new Set(["", "you", "operator"]);
const askedKey = (kappa) => "holo.name.asked:" + kappa;
function askName(panel, u) {
  const field = "width:100%;text-align:center;font-size:calc(var(--u,17px)*1.18);font-weight:300;padding:.62em .8em;border-radius:.55em;background:rgba(255,255,255,.09);color:#f4f7fc;border:1px solid rgba(255,255,255,.22);outline:none;font-family:inherit";
  panel.innerHTML = `${avatarHtml(u)}<h1 class="hl-name">What should we call you?</h1>
    <div class="hl-auth">
      <input id="hl-name-input" style="${field}" placeholder="Your name" maxlength="48" autocomplete="off" spellcheck="false" enterkeyhint="done">
      <button class="hl-bio" id="hl-name-go">${I.arrow}Continue</button>
      <button class="hl-alt hl-more" id="hl-name-skip">Not now</button>
      <div class="status">Kept on this device — never sent anywhere.</div>
    </div>`;
  return new Promise((resolve) => {
    const input = panel.querySelector("#hl-name-input");
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; resolve(String(v || "").trim().replace(/\s+/g, " ").slice(0, 48)); };
    const go = panel.querySelector("#hl-name-go"); if (go) go.onclick = () => done(input && input.value);
    const skip = panel.querySelector("#hl-name-skip"); if (skip) skip.onclick = () => done("");
    if (input) { input.onkeydown = (e) => { if (e.key === "Enter") done(input.value); }; setTimeout(() => { try { input.focus(); } catch {} }, 40); }
  });
}
async function ensureNamed(panel, principal) {
  if (!principal || principal.guest) return principal;
  let asked = false; try { asked = localStorage.getItem(askedKey(principal.kappa)) === "1"; } catch {}
  if (asked || !NAME_DEFAULTS.has(String(principal.label || "").trim().toLowerCase())) return principal;
  const name = await askName(panel, null);
  try { localStorage.setItem(askedKey(principal.kappa), "1"); } catch {}
  if (name) {
    try { const L = await import("./holo-login.mjs"); await L.relabel(principal.kappa, name); principal.label = name; } catch {}
  }
  return principal;
}

// signOut() — the missing piece: clear the shared presence, lock the operator realm, drop the session. After
// this a fresh open shows the full gate again. Exposed on window.holo.signOut.
export async function signOut() {
  try { (await import("./holo-sso.mjs")).clearPresence(); } catch {}
  try { const s = await import("./holo-session.mjs"); if (s.lockOperator) s.lockOperator(); if (s.clearSession) s.clearSession(); } catch {}
}
// stepUp(action) — the payload-bound biometric for a CONFIDENTIAL action (send, reveal, spend). One call;
// SSO gates ENTRY, this gates ACTS. Exposed on window.holo.stepUp.
export async function stepUp(action) {
  const m = await import("./holo-stepup.mjs");
  return m.requireStepUp ? m.requireStepUp(action) : null;
}

// signIn({ app, root, chrome, appName, nextPath, warmPaint, params }) → Promise<{ operator, principal, secret, guest }>.
// The ONE sovereign sign-in call. Resolves only once a principal is established (fail-closed).
// `onEstablished({ principal, secret, guest, operator })` (optional) — a HANDOFF SEAM. When provided, the
// caller OWNS establishment: the primitive runs the ceremony (TEE/SSO/roam/guest), then hands the verified
// principal to onEstablished instead of doing its own openSession/publish. This is how a surface with a
// DIFFERENT session model + a NAVIGATION handoff (the OS greeter: SESSIONS/?next= → OPFS session.json →
// wallet → stashUnlock → enterShell) mounts the ONE ceremony without the primitive hardcoding its specifics.
// Omit it (the messenger) and the default same-page establish runs, unchanged.
export async function signIn({ root, params, app = "holospace", appName = "Hologram", nextPath = "", warmPaint = null, chrome = "minimal", onEstablished = null } = {}) {
  params = params || new URLSearchParams(location.search);
  const overlay = ensureOverlay();
  // PLYMOUTH BOOT SPLASH — the boot-animation layer + the "Boot style" door (holo-plymouth: real Plymouth
  // themes, streamed once + sealed to κ, played by one canvas). Purely additive and fail-open: if the
  // module can't load or no frame ever lands, this greeter is exactly what it was.
  let plymouth = null;
  const plymouthHost = { actions: [] };   // the seam: signIn OFFERS its rare doors; the ⋯ panel renders them
  try { import("./holo-plymouth.mjs").then((m) => { plymouth = m.attachPlymouth(overlay, plymouthHost); }).catch(() => {}); } catch {}
  // MANIFESTO + WORDMARK — the greeter's brand chrome (top-left door + bottom-centre Hologram mark), speaking
  // the OS's own words. Purely additive and fail-open (a hiccup never blocks sign-in).
  try { import("./holo-manifesto.mjs?v=mark11").then((m) => m.mountManifesto(overlay)).catch(() => {}); } catch {}
  const panel = document.getElementById("holo-login-panel");
  const statusEl = () => panel.querySelector(".status");
  // BUSY-IN-CONTROL — while a control (the name key / the slide) is mid-ceremony it becomes the busy sink:
  // the status text paints INSIDE it and the separate status line stays quiet (cleaner, more professional).
  // Errors always drop back to the status line and hand the control back to the operator.
  let busySink = null;
  const bioLbl = (btn) => btn && btn.querySelector(".hl-lbl");
  const enterBusy = (btn) => { if (!btn) return; const fp = btn.querySelector("svg:not(.hl-beam)"); if (fp) fp.style.display = "none"; busySink = bioLbl(btn); };
  const exitBusy = (btn, label) => { busySink = null; if (!btn) return; const fp = btn.querySelector("svg:not(.hl-beam)"); if (fp) fp.style.display = ""; const s = bioLbl(btn); if (s && label != null) s.textContent = label; };
  const setStatus = (t, err) => { if (err) { try { plymouth && plymouth.calm(); } catch {} } if (!err && busySink) { busySink.textContent = t || ""; return; } const el = statusEl(); if (el) { el.className = "status" + (err ? " err" : ""); el.textContent = t || ""; } };
  const setBusy = (m) => { try { plymouth && plymouth.verify(); } catch {} if (busySink) { busySink.textContent = m || ""; return; } const el = statusEl(); if (el) { el.className = "status"; el.innerHTML = `<span class="spin"></span><span>${esc(m || "")}</span>`; } };

  return new Promise(async (resolve) => {
    // CEREMONY BEATS (HOLO-BOOT-CEREMONY-PROMPT B0) — fail-open, measurement only.
    const beat = (n) => { try { performance.mark("holo:ceremony:" + n); } catch {} try { const L = window.HoloLife; if (L && L.mark) L.mark("ceremony:" + n); } catch {} };
    // THE LAST SEAM (B5): the glass must defog ONTO AN ALREADY-PAINTED home, never onto a blank #root.
    // Auth resolves IMMEDIATELY (the host's boot awaits it to render the home — holding it would deadlock
    // into the cap and tax every login); only the VISUAL defog waits for the home's first paint, bounded
    // (~800ms) so a slow home never holds the operator hostage. Interval, not rAF (hidden tabs freeze rAF).
    // ARRIVAL (A3): a returning operator with a pending Deep Resume must land IN the resumed context — the
    // host consumes `holo.resume.pending` (reads + removes) as it applies scroll/drafts, so "key gone" is the
    // applied signal. GUEST law: a guest session never applies a resume, so a stale pending key must never
    // hold a guest's defog to the cap (the film witness caught exactly that). The 800ms cap rules either way.
    const resumeSettled = (auth) => { try { return !!(auth && auth.guest) || !sessionStorage.getItem("holo.resume.pending"); } catch { return true; } };
    const homeReady = (auth) => { try { return !!document.querySelector(".holo-rail, .holo-wa-root, .cs-main-container") && resumeSettled(auth); } catch { return false; } };
    const done = (auth) => {
      beat("auth-ok");
      resolve(auth);                                       // hand the identity to the home NOW — it boots behind the glass
      const finish = () => {
        beat("unfog-start");
        try { plymouth && plymouth.complete(); } catch {}  // the splash flares out with the unfog — boot complete
        overlay.classList.add("unfog");
        setTimeout(() => { try { overlay.remove(); } catch {} }, 720);
      };
      if (homeReady(auth)) { beat("home-paint"); return finish(); }
      const t0 = Date.now();
      const iv = setInterval(() => {
        const ready = homeReady(auth);
        if (!ready && Date.now() - t0 < 800) return;
        clearInterval(iv);
        if (ready) beat("home-paint");
        finish();
      }, 80);
    };

    const establish = async (principal, secret, guest) => {
      // THE NAME CEREMONY — after the device-rooted ceremony has passed, before anything else paints. One
      // choke-point, so EVERY door (first-run enrol, returning unlock, silent SSO, restore) names exactly once.
      if (!guest) { try { principal = await ensureNamed(panel, principal); } catch {} }
      // AUTO-SKIP marker: record whether THIS entry was a guest, so a returning guest re-enters with no gate
      // next time (set below, before the gate). Cleared on any real-operator entry so an enrolled operator is
      // NEVER auto-downgraded to guest (even on a transient roster-read miss).
      try { if (guest) localStorage.setItem("holo.lastWasGuest", "1"); else localStorage.removeItem("holo.lastWasGuest"); } catch {}
      // HANDOFF SEAM: a caller (e.g. the OS greeter) owns session + navigation. Run the ceremony, hand off,
      // still cache the greeting hint for next-boot baseline, then reveal. The caller's onEstablished does its
      // own openSession/persist/publish/enterShell — the primitive does NOT double it.
      if (typeof onEstablished === "function") {
        try { await onEstablished({ principal, secret, guest, operator: principal.kappa }); }
        catch (e) { setStatus(teeError(e), true); return; }
        try { cacheOperator({ label: principal.label, hue: principal.avatar && principal.avatar.hue, cred: true }); } catch {}
        setStatus("Opening…");
        return done({ principal, operator: principal.kappa, secret: guest ? null : secret, guest: !!guest });
      }
      try {
        const id = await import("./holo-identity.mjs");
        const token = await id.openSession(principal, { session: app, next: nextPath, host: "", guest: guest || undefined });
        await id.persistSession(token, null);
      } catch {}
      if (secret && !guest) {
        try { const s = await import("./holo-session.mjs"); await s.unlockOperatorKey({ operator: principal.kappa, secret }); } catch {}
      }
      cacheOperator({ label: principal.label, hue: principal.avatar && principal.avatar.hue, cred: true });
      if (!guest) { try { publishPresence({ operator: principal.kappa, label: principal.label, guest: false }); } catch {} }
      setStatus("Opening…");
      done({ principal, operator: principal.kappa, secret: guest ? null : secret, guest: !!guest });
    };

    const guestEnter = async () => {
      renderBusy(panel, "Entering as guest…");
      try { const id = await import("./holo-identity.mjs"); const principal = await id.ephemeral({ label: "Guest" }); await establish(principal, null, true); }
      catch (e) { renderNoBio(panel, null, ""); setStatus("Guest sign-in failed: " + (e && e.message || e), true); const g = panel.querySelector("#hl-guest"); if (g) g.onclick = guestEnter; }
    };

    // ── IDENTITY ROAM & RECOVERY + DEEP RESUME ─────────────────────────────────────────────────────
    const bindAndEnter = async (mnemonic, label) => {
      const L = await import("./holo-login.mjs");
      let cred = null, credPub = null, secret = null;
      try { if (!(await teeReason())) { const e = await teeEnroll({ name: appName }); cred = e.credentialId; credPub = e.credPub; secret = e.secret; } } catch {}
      if (!secret) { try { secret = localStorage.getItem("holo-messenger/id-secret") || ""; } catch {} if (!secret) { secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))); try { localStorage.setItem("holo-messenger/id-secret", secret); } catch {} } }
      const { principal } = await L.recover({ mnemonic, secret, label: label || "You", cred, credPub });
      await establish(principal, secret, false);
    };
    const joinAndEnter = async () => {
      try {
        const off = await roam.newDeviceOffer({ deviceName: "this device", baseUrl: location.origin });
        renderAddDevice(panel, off.url);
        const abort = new AbortController(); overlay.__abort = abort;
        const joined = await roam.awaitDeviceJoin(off.secrets, { base: "", signal: abort.signal, timeoutMs: 180000 });
        if (!joined) { setStatus("Timed out — Restore or try again", true); return; }
        setBusy("Adding this device…");
        try { if (joined.resume) { const rs = await roam.openResume(joined.mnemonic, joined.resume); if (rs && rs.state) sessionStorage.setItem("holo.resume.pending", JSON.stringify(rs.state)); } } catch {}
        await bindAndEnter(joined.mnemonic, joined.label);
      } catch (e) { setStatus(teeError(e), true); }
    };
    const restoreAndEnter = async () => {
      renderRestore(panel);
      const go = panel.querySelector("#hl-restore-go");
      if (go) go.onclick = async () => {
        go.disabled = true;
        try {
          const link = (panel.querySelector("#hl-restore-link") || {}).value || "";
          const code = (panel.querySelector("#hl-restore-code") || {}).value || "";
          setBusy("Restoring…");
          const { mnemonic } = await roam.restoreFromRecovery(link.trim(), code.trim());
          await bindAndEnter(mnemonic, "You");
        } catch (e) { go.disabled = false; setStatus("Restore failed: " + (e && e.message || e), true); }
      };
    };
    const approveFromOperator = async (offerUrl) => {
      const pres = readPresence(); const op = pres && pres.operator; if (!op) throw new Error("no signed-in operator on this device");
      const { secret } = await teeAssert({});
      const L = await import("./holo-login.mjs");
      const mnemonic = await L.revealMnemonic(op, secret);
      let resume = null; try { const st = window.__holoResume && window.__holoResume.get && window.__holoResume.get(); if (st) resume = (await roam.sealResume(mnemonic, st, { seq: st.seq })).blob; } catch {}
      return roam.approveDevice({ offerUrl, mnemonic, label: (pres && pres.label) || "", resume, base: "" });
    };
    // window.holo — the callable platform API (sign-in, sign-out, step-up, roam) for any surface / agent.
    try {
      window.holo = window.holo || {};
      window.holo.signIn = (opts) => signIn(opts);
      window.holo.signOut = signOut;
      window.holo.stepUp = stepUp;
      window.holo.roam = {
        newDeviceOffer: roam.newDeviceOffer, approveDevice: roam.approveDevice, awaitDeviceJoin: roam.awaitDeviceJoin,
        acceptSeedRoam: roam.acceptSeedRoam, mintRecoveryLink: roam.mintRecoveryLink, restoreFromRecovery: roam.restoreFromRecovery,
        sealResume: roam.sealResume, openResume: roam.openResume, resumeIsFresh: roam.resumeIsFresh,
        approveFromOperator,
        async mintRecovery() { const pres = readPresence(); const op = pres && pres.operator; if (!op) throw new Error("no signed-in operator"); const { secret } = await teeAssert({}); const L = await import("./holo-login.mjs"); const mnemonic = await L.revealMnemonic(op, secret); return roam.mintRecoveryLink(mnemonic, { baseUrl: location.origin }); },
      };
    } catch {}

    // window.HoloLogin — the AGENT-facing API (mirrors #holo-agent-login). Guest with ONE call, no human.
    try {
      window.HoloLogin = {
        service: app,
        options: (() => { try { return JSON.parse(document.getElementById("holo-agent-login").textContent).options; } catch { return []; } })(),
        guest() { guestEnter(); return "Entering as guest — an instant, private, ephemeral session. Nothing persists."; },
      };
    } catch {}

    // ?guest=1 / ?as=guest — the agent / headless door.
    if (params.get("guest") === "1" || params.get("as") === "guest") { return guestEnter(); }

    // discover the enrolment state from holo-login's roster — the SAME store the OS greeter reads/writes.
    let roster = [];
    try { const L = await import("./holo-login.mjs"); roster = await L.roster(); } catch {}
    let reason = ""; try { reason = await teeReason(); } catch (e) { reason = teeError(e); }
    const hasBio = !reason;
    const known = roster.filter((u) => u && u.cred);
    let selected = known[0] || roster[0] || null;
    if (selected) cacheOperator(selected);

    // ── SOVEREIGN SSO ──────────────────────────────────────────────────────────────────────────────
    try {
      const presence = readPresence();
      const nativeSilent = (location.protocol === "holo:" && typeof window.cefQuery === "function" && window.__holoHelloSilent === true);
      const dec = adoptDecision({ presence, roster, nowMs: Date.now(), nativeSilent });
      window.__sso = { adopted: false, silent: false, reason: dec.reason, operator: dec.adopt ? dec.operator : null };
      if (dec.adopt) {
        selected = known.find((u) => u.kappa === dec.operator) || selected;
        if (dec.silent && hasBio) {
          try {
            renderBusy(panel, "Welcome back…");
            const { secret, credentialId } = await teeAssert({ allowCredentials: [dec.cred] });
            const op = known.find((u) => u.cred === credentialId) || { kappa: dec.operator };
            const L = await import("./holo-login.mjs");
            const principal = await L.unlock(op.kappa, secret);
            window.__sso = { adopted: true, silent: true, source: "trust-window", reason: "silent", operator: principal.kappa };
            await establish(principal, secret, false);
            return;
          } catch (e) { window.__sso.reason = "silent-failed"; }
        }
      }
    } catch (e) {}

    const wireGuest = () => {
      const g = panel.querySelector("#hl-guestbtn"); if (g) g.onclick = guestEnter;
    };
    // OFFER the recovery doors to the ⋯ panel — holo-plymouth renders them as the OS-familiar grouped
    // list rows (icon · label · chevron). Read lazily at panel-open; fail-open both ways.
    plymouthHost.actions = [
      { label: "Use another device", icon: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>', run: () => joinAndEnter() },
      { label: "Restore", icon: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3.2-6.9"/><path d="M3 4v5h5"/></svg>', run: () => restoreAndEnter() },
    ];

    // AUTO-SKIP FOR RETURNING GUESTS (no redundant gate — "it just works" like WhatsApp): a visitor whose LAST
    // entry was a guest AND who has no enrolled operator credential is a returning guest — re-enter silently,
    // exactly as tapping "Continue as guest" would. The guest namespace is stable ("guest"), so identity + chats
    // carry over; there is nothing to authenticate. First-timers (no marker) still see the gate ONCE; an enrolled
    // operator (selected.cred) still gets their secure biometric — the marker is cleared on any operator entry so
    // this can never downgrade one. Zero-prompt, no-downgrade, honest serverless auto-resume.
    try { if (localStorage.getItem("holo.lastWasGuest") === "1" && (!selected || !selected.cred)) return guestEnter(); } catch {}

    // No enclave here (headless / no biometric) → Guest is the way in.
    if (!hasBio) { renderNoBio(panel, selected, reason); const g = panel.querySelector("#hl-guest"); if (g) g.onclick = guestEnter; return; }

    // FIRST RUN — one tap enrols a κ bound to this device's enclave.
    if (!selected || !selected.cred) {
      renderFirstRun(panel);
      addEventListener("resize", () => sizeBeam(panel));
      prewarm(warmPaint);
      const si = panel.querySelector("#hl-signin");
      if (si) si.onclick = async () => {
        sizeBeam(panel);
        enterBusy(si);
        si.disabled = true;
        try {
          setBusy("Setting up " + teeName() + "…");
          const { credentialId, secret, credPub } = await teeEnroll({ name: appName });
          const L = await import("./holo-login.mjs");
          const { principal } = await L.enroll({ label: "You", secret, cred: credentialId, credPub });
          await establish(principal, secret, false);
        } catch (e) { si.disabled = false; exitBusy(si, "Sign in"); setStatus(teeError(e), true); }
      };
      wireGuest();
      setTimeout(() => { try { panel.querySelector("#hl-signin").focus(); } catch {} }, 40);
      return;
    }

    // RETURNING OPERATOR — your name IS the key; unlock re-derives κ (Law L5). Desktop taps, touch slides;
    // both call the SAME fail-closed ceremony (doUnlock). fail() only restores the control — never opens.
    renderReturning(panel, selected);
    prewarm(warmPaint);
    const doUnlock = async (fail) => {
      try {
        setBusy("Verifying with " + teeName() + "…");
        const { secret, credentialId } = await teeAssert({ allowCredentials: known.map((k) => k.cred) });
        const op = known.find((k) => k.cred === credentialId) || selected;
        const L = await import("./holo-login.mjs");
        const principal = await L.unlock(op.kappa, secret);
        await establish(principal, secret, false);
      } catch (e) { try { fail && fail(); } catch {} setStatus(teeError(e), true); }
    };
    const bio = panel.querySelector("#hl-bio");
    if (bio) { bio.onclick = () => { sizeBeam(panel); enterBusy(bio); bio.disabled = true; doUnlock(() => { bio.disabled = false; exitBusy(bio, selected.label || "It’s me"); }); }; addEventListener("resize", () => sizeBeam(panel)); }
    const slide = panel.querySelector("#hl-slide");
    if (slide) wireSlide(slide, () => { busySink = slide.querySelector(".hl-track-lbl span:last-child"); doUnlock(() => { busySink = null; resetSlide(slide); }); });
    wireGuest();
    setTimeout(() => { try { (bio || slide).focus(); } catch {} }, 40);
  });
}

// back-compat alias — existing callers of mountLogin() keep working through the ONE primitive.
export const mountLogin = signIn;
export default signIn;
