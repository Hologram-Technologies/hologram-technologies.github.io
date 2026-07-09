// holo-power-session.mjs — POWER & SESSION: one control that ends a session cleanly. Additive weld into the
// messenger's left rail (same idiom as q-summon / q-live-hero: a self-mounting, fail-soft module the boot
// fires-and-forgets).
//
// Why: a sovereign OS needs a front-door that also closes. You can sign IN (the TEE gate) but there was no
//      single, obvious way to sign OUT and secure the box. That belongs at the very bottom of the nav, where
//      a real workstation keeps its power.
// How: append ONE power button below the "You" avatar (nothing else — the rail stays clean). Tapping it opens
//      a calm sheet that speaks the SIGN-IN language (teal glass, the same accent as the gate it returns to):
//      the live session uptime, who you are, and one action — Lock & Sign Out — which calls window.holo.signOut
//      (drops the vault keys + SSO presence) then lands on the clean gate. The rail is React-rendered, so we
//      re-attach on removal.
// What: nothing here invents state. The uptime is real wall-clock since sign-in; the sign-out is the platform's
//       own signOut. Complexity abstracted into one power symbol — the feel is precision, not decoration.

const DOC = document, HTML = DOC.documentElement;
const $ = (s, r) => (r || DOC).querySelector(s);
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const T0_KEY = "holo.session.t0";   // per-tab session clock — survives a soft reload, cleared on sign-out

// ── the session clock ────────────────────────────────────────────────────────────────────────────────────
// First frame of a tab session stamps t0; every later reload (the warm-paint boot) reads the SAME stamp, so
// "uptime" is continuous for the life of the session and resets only when the operator actually signs out.
function sessionStart() {
  try {
    let v = sessionStorage.getItem(T0_KEY);
    if (!v) { v = String(Date.now()); sessionStorage.setItem(T0_KEY, v); }
    const n = parseInt(v, 10); return Number.isFinite(n) ? n : Date.now();
  } catch { return Date.now(); }
}
const T0 = sessionStart();
const pad = (n) => String(n).padStart(2, "0");
function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
const uptimeMs = () => Date.now() - T0;

function operator() {
  try { const o = JSON.parse(localStorage.getItem("holo.lastOperator") || "null"); if (o && o.label) return o; } catch {}
  return null;
}
const initials = (label) => (String(label || "").trim().split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("") || "·").toUpperCase();

// ── icons ────────────────────────────────────────────────────────────────────────────────────────────────
const PWR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2v7.4"/><path d="M6.4 6.9a8 8 0 1 0 11.2 0"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.4"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>';

// ── styles ───────────────────────────────────────────────────────────────────────────────────────────────
const css = DOC.createElement("style");
css.id = "holo-pwr-css";
css.textContent = `
/* the rail power button — sits below the "You" avatar as the rail's last child; a lone glyph, like its
   siblings, at the SAME rail gap (the wrapper adds no extra spacing of its own) */
.holo-pwr{display:flex;justify-content:center;width:100%}
.holo-pwr-btn{color:var(--holo-dim,#a99db4)}
.holo-pwr-btn svg{width:20px;height:20px;opacity:.82;transition:opacity .15s ease,filter .18s ease,transform .14s var(--holo-ease,ease)}
.holo-pwr-btn:hover{background:var(--holo-disc,#2a1834);color:#7defc9;box-shadow:inset 0 0 0 1px rgba(52,211,166,.34)}
.holo-pwr-btn:hover svg{opacity:1;filter:drop-shadow(0 0 7px rgba(52,211,166,.5))}
.holo-pwr-btn.armed{color:#7defc9}
.holo-pwr-btn.armed svg{opacity:1;filter:drop-shadow(0 0 8px rgba(52,211,166,.6))}

/* ── the sheet — one calm pane in the sign-in's own vocabulary (teal glass), φ-quiet, over the running box ── */
#holo-pwr-sheet{position:fixed;inset:0;z-index:2147483400;display:flex;align-items:center;justify-content:center;
  padding:24px;opacity:0;pointer-events:none;transition:opacity .3s cubic-bezier(.4,0,.2,1);
  background:radial-gradient(120% 100% at 50% 36%,rgba(8,11,17,.5),rgba(4,6,11,.82) 66%,rgba(0,0,0,.9));
  -webkit-backdrop-filter:blur(10px) saturate(120%);backdrop-filter:blur(10px) saturate(120%)}
#holo-pwr-sheet.on{opacity:1;pointer-events:auto}
#holo-pwr-sheet .ps{position:relative;width:min(340px,92vw);border-radius:24px;overflow:hidden;text-align:center;
  padding:36px 30px 26px;color:#f4f7fc;font-family:-apple-system,"Segoe UI",Roboto,system-ui,sans-serif;
  background:linear-gradient(165deg,rgba(16,22,30,.82),rgba(9,12,18,.88));
  border:1px solid rgba(125,239,201,.18);box-shadow:0 34px 90px -22px rgba(0,0,0,.72),inset 0 1px 0 rgba(255,255,255,.05);
  transform:translateY(10px) scale(.985);transition:transform .42s cubic-bezier(.2,.9,.2,1)}
#holo-pwr-sheet.on .ps{transform:translateY(0) scale(1)}
/* the power ring — a warm teal core, breathing */
#holo-pwr-sheet .ps-ring{width:62px;height:62px;margin:0 auto 20px;border-radius:50%;display:grid;place-items:center;color:#7defc9;
  background:radial-gradient(circle at 50% 42%,rgba(52,211,166,.24),rgba(52,211,166,.04) 70%);
  box-shadow:inset 0 0 0 1.5px rgba(125,239,201,.4),0 0 34px -6px rgba(52,211,166,.55);animation:holo-pwr-ring 3.6s ease-in-out infinite}
#holo-pwr-sheet .ps-ring svg{width:27px;height:27px}
@keyframes holo-pwr-ring{0%,100%{box-shadow:inset 0 0 0 1.5px rgba(125,239,201,.34),0 0 26px -8px rgba(52,211,166,.45)}50%{box-shadow:inset 0 0 0 1.5px rgba(125,239,201,.6),0 0 40px -4px rgba(52,211,166,.7)}}
#holo-pwr-sheet .ps-time{font:250 clamp(38px,10vw,52px)/1 ui-monospace,"SF Mono","Cascadia Code",Menlo,monospace;
  letter-spacing:.02em;font-variant-numeric:tabular-nums;text-shadow:0 2px 26px rgba(0,0,0,.5)}
#holo-pwr-sheet .ps-cap{margin-top:9px;font:600 10px/1 -apple-system,"Segoe UI",sans-serif;letter-spacing:.32em;text-transform:uppercase;color:rgba(196,243,226,.62)}
#holo-pwr-sheet .ps-id{display:inline-flex;align-items:center;justify-content:center;gap:9px;margin-top:20px}
#holo-pwr-sheet .ps-av{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font:600 11px/1 -apple-system,sans-serif;color:#fff;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.45)}
#holo-pwr-sheet .ps-who{font:600 14px/1.2 -apple-system,"Segoe UI",sans-serif;color:rgba(244,247,252,.9)}
#holo-pwr-sheet .ps-actions{display:flex;flex-direction:column;gap:9px;margin-top:26px}
/* the ONE action — same shape + accent as the sign-in it returns to (holo-login .hl-bio), so the gesture reads as "back to the lock" */
#holo-pwr-sheet .ps-out{height:52px;border:0;border-radius:14px;cursor:pointer;font:600 15px/1 -apple-system,"Segoe UI",sans-serif;color:#06140f;
  display:inline-flex;align-items:center;justify-content:center;gap:9px;
  background:linear-gradient(135deg,#7defc9,#34d3a6);box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 10px 26px -8px rgba(52,211,166,.5);
  transition:transform .13s ease,box-shadow .18s ease,filter .16s ease}
#holo-pwr-sheet .ps-out:hover{transform:translateY(-1px);filter:brightness(1.05);box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 13px 30px -8px rgba(52,211,166,.62)}
#holo-pwr-sheet .ps-out:active{transform:translateY(0) scale(.99)}
#holo-pwr-sheet .ps-out svg{width:18px;height:18px}
#holo-pwr-sheet .ps-stay{height:44px;border:0;border-radius:12px;cursor:pointer;font:500 14px/1 -apple-system,"Segoe UI",sans-serif;
  color:rgba(231,237,250,.6);background:transparent;transition:color .16s ease,background .16s ease}
#holo-pwr-sheet .ps-stay:hover{color:#f4f7fc;background:rgba(255,255,255,.05)}

/* ── power-down: a hologram collapse to a line, then dark, before the gate returns ── */
#holo-pwr-veil{position:fixed;inset:0;z-index:2147483600;background:#04060b;opacity:0;pointer-events:none;transition:opacity .28s ease}
html.holo-powering #holo-pwr-veil{opacity:1;pointer-events:auto}
#holo-pwr-veil .beam{position:absolute;left:0;right:0;top:50%;height:2px;transform:translateY(-50%);
  background:linear-gradient(90deg,transparent,#7defc9,#34d3a6,transparent);box-shadow:0 0 22px 4px rgba(52,211,166,.6);opacity:0}
html.holo-powering #holo-pwr-veil .beam{animation:holo-pwr-off .52s cubic-bezier(.6,0,.3,1) forwards}
@keyframes holo-pwr-off{0%{opacity:0;transform:translateY(-50%) scaleY(60) scaleX(1)}22%{opacity:1;transform:translateY(-50%) scaleY(1) scaleX(1)}70%{opacity:1;transform:translateY(-50%) scaleY(1) scaleX(.02)}100%{opacity:0;transform:translateY(-50%) scaleY(1) scaleX(0)}}

@media (prefers-reduced-motion:reduce){
  #holo-pwr-sheet,#holo-pwr-sheet .ps{transition:opacity .18s ease}
  #holo-pwr-sheet .ps-ring{animation:none}
  html.holo-powering #holo-pwr-veil .beam{animation:none;opacity:0}
}`;
DOC.head.appendChild(css);

// ── the sheet ────────────────────────────────────────────────────────────────────────────────────────────
let sheet = null, sheetOpen = false, tick = 0;

function buildSheet() {
  const el = DOC.createElement("div");
  el.id = "holo-pwr-sheet";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Power");
  const op = operator();
  const hue = (op && op.hue != null ? op.hue : 210) | 0;
  const av = op
    ? `<div class="ps-av" style="background:linear-gradient(140deg,hsl(${hue} 52% 46%),hsl(${hue + 26} 52% 46%))">${initials(op.label)}</div>`
    : `<div class="ps-av" style="background:linear-gradient(140deg,#5b6b86,#3a455c)">·</div>`;
  const who = op ? op.label : "Guest";
  el.innerHTML = `<div class="ps">
    <div class="ps-ring">${PWR}</div>
    <div class="ps-time" id="holo-pwr-bigtime">${fmt(uptimeMs())}</div>
    <div class="ps-cap">Session uptime</div>
    <div class="ps-id">${av}<div class="ps-who">${escapeHtml(who)}</div></div>
    <div class="ps-actions">
      <button class="ps-out" id="holo-pwr-out">${LOCK}<span>Lock &amp; Sign Out</span></button>
      <button class="ps-stay" id="holo-pwr-stay">Resume</button>
    </div>
  </div>`;
  DOC.body.appendChild(el);
  el.addEventListener("click", (e) => { if (e.target === el) close(); });
  $("#holo-pwr-stay", el).addEventListener("click", close);
  $("#holo-pwr-out", el).addEventListener("click", powerDown);
  return el;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function open() {
  if (!sheet) sheet = buildSheet();
  sheetOpen = true;
  const t = $("#holo-pwr-bigtime", sheet); if (t) t.textContent = fmt(uptimeMs());
  // reveal by forced reflow (NOT rAF — a backgrounded/headless tab never fires rAF, so the fade would never arm)
  void sheet.offsetWidth;
  sheet.classList.add("on");
  DOC.addEventListener("keydown", onKey, true);
}
function close() {
  sheetOpen = false;
  if (sheet) sheet.classList.remove("on");
  DOC.removeEventListener("keydown", onKey, true);
  const b = $(".holo-pwr-btn"); if (b) b.classList.remove("armed");
}
function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }

// THE secure exit: drop the vault keys + SSO presence (window.holo.signOut), forget the session clock, then
// land on the CLEAN gate (drop ?guest=1 / hash, replace history) so the box is locked and can't be walked back.
let powering = false;
async function powerDown() {
  if (powering) return; powering = true;
  ensureVeil();
  HTML.classList.add("holo-powering");
  try { sessionStorage.removeItem(T0_KEY); } catch {}
  try { if (window.holo && window.holo.signOut) await window.holo.signOut(); } catch {}
  const go = () => { try { location.replace(location.pathname); } catch { location.href = location.pathname; } };
  reduced() ? go() : setTimeout(go, 520);
}
function ensureVeil() {
  if ($("#holo-pwr-veil")) return;
  const v = DOC.createElement("div"); v.id = "holo-pwr-veil"; v.innerHTML = '<div class="beam"></div>';
  DOC.body.appendChild(v);
}

// ── the rail control (React-reconciliation-proof: re-attach if the rail re-renders it away) ──────────────
let railCtrl = null;
function buildRailControl() {
  const wrap = DOC.createElement("div");
  wrap.className = "holo-pwr";
  const btn = DOC.createElement("button");
  btn.type = "button";
  btn.className = "holo-rail-btn holo-pwr-btn";
  btn.title = "Lock & sign out";
  btn.setAttribute("aria-label", "Power — lock and sign out");
  btn.innerHTML = PWR;
  btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); btn.classList.add("armed"); open(); });
  wrap.appendChild(btn);
  railCtrl = wrap;
  return wrap;
}
function attach() {
  const rail = $(".holo-rail");
  if (!rail) return false;
  if (railCtrl && railCtrl.isConnected && railCtrl.parentNode === rail) return true;
  const existing = rail.querySelector(".holo-pwr");
  if (existing) { railCtrl = existing; return true; }
  rail.appendChild(buildRailControl());
  return true;
}

// one heartbeat: keep the control mounted, and tick the open sheet's clock (the rail shows no time — clean)
function beat() {
  attach();
  if (sheetOpen && sheet) { const b = sheet.querySelector("#holo-pwr-bigtime"); if (b) { const s = fmt(uptimeMs()); if (b.textContent !== s) b.textContent = s; } }
}

function start() {
  if (typeof window === "undefined") return;
  if (window.__holoPowerSession) return; window.__holoPowerSession = true;
  const mo = new MutationObserver(() => { attach(); });
  try { mo.observe(DOC.body, { childList: true, subtree: true }); } catch {}
  attach();
  tick = setInterval(beat, 1000);
  // a public seam so an agent / Q can end the session too: window.HoloPower.signOut()
  window.HoloPower = { open, close, signOut: powerDown, uptime: uptimeMs, since: () => T0 };
}

if (DOC.readyState === "loading") DOC.addEventListener("DOMContentLoaded", start, { once: true });
else start();

export { open as openPowerSheet, powerDown as signOut };
