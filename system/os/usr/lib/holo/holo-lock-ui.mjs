// holo-lock-ui.mjs — Warm Lock browser binding: a full-bleed, frosted LOCK overlay rendered INSIDE the live
// shell (not a navigation, not an iframe). The warm-resident shell stays alive + restored; this gates it
// behind a biometric on hide/idle and dismisses on one tap — no navigation, no re-restore (the session key
// stays in memory). Mirrors the lock-screen vocabulary (avatar → name → "It's me") and reuses the SAME
// ceremony as login (teeAssert) + the same never-blank guarantee (a 12s watchdog → actionable recovery,
// never an infinite spinner). Eligible only for a real operator with a device biometric (policy: holo-lock).
//
// Wired by shell-main.mjs: `installWarmLock()` once after boot. See [[holo-login-auth-restore-onemotion]],
// [[holo-boot-warm-resident]], [[holo-login-never-blank]].

import { shouldLock } from "./holo-lock.mjs";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const initials = (n) => (String(n || "").trim().split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("") || "·").toUpperCase();
const IDLE_MS = 5 * 60 * 1000;   // auto-lock after 5 min of inactivity (no settings — one sensible default)

const I = {
  fp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5.5 11a6.5 6.5 0 0 1 13 0"/><path d="M8.5 11a3.5 3.5 0 0 1 7 0v2.6"/><path d="M12 11v4.4"/><path d="M8.6 14.2V16"/><path d="M15.4 15.4V18"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
};

// lockEligibility() → { operator, cred, label, hue } | null. Fail-OPEN: a guest, a session with no device
// biometric, or an operator with no enrolled credential here returns null → never locked (never stranded).
export async function lockEligibility() {
  try {
    const HS = await import("./holo-session.mjs");
    const op = HS.signedInOperator && HS.signedInOperator();
    if (!op) return null;                                            // guest / no operator
    const { teeReason } = await import("./holo-webauthn.mjs");
    if (await teeReason()) return null;                              // no device biometric → never strand
    let cred = null;
    try { const HL = await import("./holo-login.mjs"); const c = await HL.credentialOf(op); cred = c && c.credentialId; } catch (e) {}
    if (!cred) return null;                                          // nothing to unlock with here
    let face = {};
    try { face = JSON.parse(localStorage.getItem("holo.lastOperator") || "{}") || {}; } catch (e) {}
    return { operator: op, cred, label: face.label || "Welcome", hue: face.hue != null ? (face.hue | 0) : 210 };
  } catch (e) { return null; }
}

let _cssDone = false;
function injectStyle() {
  if (_cssDone || document.getElementById("holo-lock-css")) { _cssDone = true; return; }
  _cssDone = true;
  const s = document.createElement("style");
  s.id = "holo-lock-css";
  s.textContent = `
  .holo-lock{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;
    font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:#f4f7fc;--lacc:#7defc9;--lacc2:#34d3a6;
    animation:holoLockIn .18s cubic-bezier(.4,0,.2,1) both;}
  .holo-lock-frost{position:absolute;inset:0;background:rgba(7,11,22,.5);
    -webkit-backdrop-filter:blur(40px) saturate(1.3) brightness(.9);backdrop-filter:blur(40px) saturate(1.3) brightness(.9);}
  .holo-lock-panel{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;gap:18px;padding:24px;max-width:92vw;}
  .holo-lock-av{width:clamp(88px,14vmin,120px);height:clamp(88px,14vmin,120px);border-radius:50%;display:grid;place-items:center;
    color:#fff;font-size:2.4rem;font-weight:600;box-shadow:0 .6em 1.8em rgba(0,0,0,.4),inset 0 0 0 2px rgba(255,255,255,.6);text-shadow:0 1px 2px rgba(0,0,0,.4);}
  .holo-lock-name{margin:0;font-size:1.5rem;font-weight:300;text-shadow:0 2px 18px rgba(0,0,0,.45);}
  .holo-lock-bio{min-width:min(86vw,300px);height:46px;border:0;border-radius:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:9px;
    font-size:1rem;font-weight:600;color:#06140f;background:linear-gradient(135deg,var(--lacc),var(--lacc2));box-shadow:0 .7em 1.6em rgba(52,211,166,.32);
    font-family:inherit;transition:transform .12s,box-shadow .18s,filter .18s;}
  .holo-lock-bio:hover{transform:translateY(-1px);filter:brightness(1.05);} .holo-lock-bio:active{transform:translateY(0) scale(.99);} .holo-lock-bio:disabled{opacity:.7;cursor:default;}
  .holo-lock-bio svg{width:1.18em;height:1.18em;}
  .holo-lock-alt{background:none;border:0;color:rgba(231,237,250,.82);font-size:1rem;font-family:inherit;cursor:pointer;padding:8px 12px;border-radius:8px;display:inline-flex;align-items:center;gap:8px;transition:color .15s;}
  .holo-lock-alt:hover{color:#fff;} .holo-lock-alt svg{width:1.05em;height:1.05em;}
  .holo-lock-status{min-height:1.5em;font-size:1rem;color:#c4f3e2;display:flex;align-items:center;justify-content:center;gap:8px;}
  .holo-lock-status.err{color:#ffc0c0;}
  .holo-lock-spin{width:1em;height:1em;border-radius:50%;border:2px solid rgba(125,239,201,.28);border-top-color:var(--lacc);animation:holoLockSpin .7s linear infinite;flex:0 0 auto;}
  @keyframes holoLockSpin{to{transform:rotate(360deg);}}
  @keyframes holoLockIn{from{opacity:0;}to{opacity:1;}}
  .holo-lock.out{animation:holoLockOut .15s cubic-bezier(.4,0,.2,1) both;}
  @keyframes holoLockOut{to{opacity:0;}}
  @media (prefers-reduced-motion:reduce){.holo-lock,.holo-lock.out,.holo-lock-spin{animation:none;}}
  `;
  document.head.appendChild(s);
}

// renderOverlay(elig, onUnlocked) → the DOM overlay. Built synchronously (never-blank). "It's me" → teeAssert.
function renderOverlay(elig, onUnlocked) {
  injectStyle();
  const ov = document.createElement("div");
  ov.className = "holo-lock";
  ov.setAttribute("role", "dialog");
  ov.setAttribute("aria-modal", "true");
  ov.setAttribute("aria-label", "Locked — sign in to continue");
  const avStyle = `background:linear-gradient(140deg,hsl(${elig.hue} 52% 46%),hsl(${(elig.hue + 26) % 360} 52% 46%))`;
  const face = `<div class="holo-lock-av" style="${avStyle}">${esc(initials(elig.label))}</div><h1 class="holo-lock-name">${esc(elig.label)}</h1>`;
  let watchdog = null, busy = false;
  const clearW = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };

  const mountSignIn = () => {
    ov.innerHTML = `<div class="holo-lock-frost"></div><div class="holo-lock-panel">${face}
      <button class="holo-lock-bio" id="hl-go">${I.fp}It’s me</button>
      <div class="holo-lock-status" id="hl-st"></div></div>`;
    const go = ov.querySelector("#hl-go"), st = ov.querySelector("#hl-st");
    const setBusy = (m) => { st.className = "holo-lock-status"; st.innerHTML = `<span class="holo-lock-spin"></span><span>${esc(m)}</span>`; };
    const setErr = (m) => { clearW(); st.className = "holo-lock-status err"; st.textContent = m; };
    const attempt = async () => {
      if (busy) return; busy = true; go.disabled = true;
      let bioName = "Windows Hello";
      try { const { teeName } = await import("./holo-webauthn.mjs"); bioName = teeName(); } catch (e) {}
      setBusy("Verifying with " + bioName + "…");
      clearW(); watchdog = setTimeout(() => { watchdog = null; mountStuck(); }, 12000);   // never-blank: recover, don't hang
      try {
        const { teeAssert } = await import("./holo-webauthn.mjs");
        await teeAssert({ allowCredentials: [elig.cred] });        // proves presence; _opKey stays in memory → instant
        clearW(); dismiss();
      } catch (e) { busy = false; go.disabled = false; setErr("Try again"); }
    };
    go.onclick = attempt;
    setTimeout(() => { try { go.focus(); } catch (e) {} }, 60);    // Enter/Space ready; the user still initiates
  };

  // never-blank recovery when the ceremony stalls (>12s) — keep the face, swap the spinner for sure ways forward.
  const mountStuck = () => {
    busy = false;
    ov.innerHTML = `<div class="holo-lock-frost"></div><div class="holo-lock-panel">${face}
      <div class="holo-lock-status">Taking longer than usual.</div>
      <button class="holo-lock-bio" id="hl-retry">${I.fp}Try again</button>
      <button class="holo-lock-alt" id="hl-out">${I.out}Sign out</button></div>`;
    ov.querySelector("#hl-retry").onclick = () => mountSignIn();
    ov.querySelector("#hl-out").onclick = () => { try { location.href = "/usr/share/frame/login.html"; } catch (e) { location.reload(); } };
  };

  const dismiss = () => {
    ov.classList.add("out");
    const done = () => { try { ov.remove(); } catch (e) {} try { onUnlocked && onUnlocked(); } catch (e) {} };
    let fired = false; const once = () => { if (fired) return; fired = true; done(); };
    ov.addEventListener("animationend", once, { once: true });
    setTimeout(once, 220);                                          // reduced-motion / no-animation fallback
  };

  mountSignIn();
  return ov;
}

// installWarmLock() — wire the lock into the live shell. Locks on hide (warm-resident SW_HIDE fires
// visibilitychange) and after idle; covers the desktop so a reveal is gated before it's interactable. Returns
// a tiny handle (lock/isLocked) for scripting/Q. Idempotent per page.
export function installWarmLock() {
  if (typeof document === "undefined") return { lock: () => {}, isLocked: () => false };
  let overlay = null, locked = false, arming = false, idleT = null;

  async function doLock(reason) {
    if (locked || arming) return;
    arming = true;
    try {
      const elig = await lockEligibility();                         // async: operator + biometric + credential
      if (!elig || !shouldLock({ operator: elig.operator, hasBiometric: true, reason })) { arming = false; return; }
      if (locked) { arming = false; return; }                       // a concurrent lock won the race
      locked = true;
      overlay = renderOverlay(elig, () => { locked = false; if (overlay) { try { overlay.remove(); } catch (e) {} overlay = null; } resetIdle(); });
      document.body.appendChild(overlay);                           // covers the live desktop (top layer, captures input)
    } catch (e) {}
    arming = false;
  }
  function resetIdle() { if (idleT) clearTimeout(idleT); idleT = setTimeout(() => doLock("idle"), IDLE_MS); }

  // hide (warm-resident reveal will then find it already locked → no desktop flash) + idle
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") doLock("hidden"); });
  ["pointerdown", "keydown", "wheel", "touchstart"].forEach((ev) =>
    document.addEventListener(ev, () => { if (!locked) resetIdle(); }, { passive: true }));
  resetIdle();

  const api = { lock: doLock, isLocked: () => locked, eligibility: lockEligibility };
  try { window.HoloLock = api; } catch (e) {}
  return api;
}

export default { installWarmLock, lockEligibility };
