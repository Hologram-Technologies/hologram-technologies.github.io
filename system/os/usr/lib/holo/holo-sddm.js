// holo-sddm.js — the Hologram greeter RUNTIME: SDDM (https://github.com/sddm/sddm) projected
// into the browser, exactly the way Holo Boot projects rEFInd and Holo Splash projects Plymouth
// — a browser can't run Qt/QML, so we run the real SPEC. This module provides SDDM's real
// `SddmComponents 2.0` (Background · Clock · TextBox · PasswordBox · ComboBox · Button) styled
// byte-for-byte to the upstream QML, and SDDM's real greeter context — `config` · `sddm` ·
// `userModel` · `sessionModel` · `textConstants` · `keyboard`. The one substitution the
// holospaces spec demands: `sddm.login()` does NOT call PAM against /etc/passwd — it UNLOCKS a
// SELF-SOVEREIGN KEY held on this device (docs/08 §Identity; Law L1 — identity is the κ-label),
// and binds the session to THIS machine's measured hardware (holo-host). 100% serverless:
// WebCrypto + OPFS. Golden ratio (φ) governs every proportion and rhythm.
//
// The real theme bytes (data/themes/maldives/*, components/2.0/*) are installed verbatim and
// content-addressed under /usr/share/sddm/ — this runtime renders that real theme.

import { enroll, unlock, roster, openSession } from "./holo-identity.mjs";
import { measure, describe } from "./holo-host.mjs";
import { teeAvailable, teeName, teeEnroll, teeAssert, teeError } from "./holo-webauthn.mjs";

export const PHI = 1.6180339887;                 // φ — the proportion the whole greeter is tuned on
const te = (s) => document.createTextNode(s);
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "style") n.style.cssText = v; else if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) n.appendChild(typeof c === "string" ? te(c) : c);
  return n;
}

// ── SddmComponents 2.0 — DOM reproductions of the upstream QML, colours/borders/animations exact.

// Button.qml — #4682b4 → active #266294 → pressed #064264; white bold text; inner white focus
// border; 200ms ColorAnimation; PointingHandCursor.
export function Button({ text = "Button", width, onClick }) {
  const b = el("button", { class: "sddm-btn", type: "button" }, text);
  b.style.cssText = `min-width:${width || 80}px;height:${Math.round(30 * 1)}px;border:0;color:#fff;font-weight:700;
    font-size:14px;cursor:pointer;border-radius:2px;background:#4682b4;transition:background .2s,box-shadow .2s;
    box-shadow:inset 0 0 0 0 rgba(255,255,255,0);padding:0 12px;`;
  const set = (bg, focus) => { b.style.background = bg; b.style.boxShadow = focus ? "inset 0 0 0 1px #fff" : "inset 0 0 0 0 rgba(255,255,255,0)"; };
  b.addEventListener("mouseenter", () => set("#266294", true));
  b.addEventListener("mouseleave", () => set("#4682b4", false));
  b.addEventListener("mousedown", () => set("#064264", true));
  b.addEventListener("mouseup", () => set("#266294", true));
  b.addEventListener("focus", () => set("#266294", true));
  b.addEventListener("blur", () => set("#4682b4", false));
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

// TextBox.qml — white bg, 1px border #ababab; hover #5692c4; focus #266294; black text;
// 8px inner inset (TextInput width = parent − 16); 100ms transition.
export function TextBox({ password = false, value = "", placeholder = "", height = 30, onEnter } = {}) {
  const i = el("input", { type: password ? "password" : "text", placeholder, autocomplete: password ? "current-password" : "off" });
  i.value = value;
  i.style.cssText = `width:100%;height:${height}px;box-sizing:border-box;background:#fff;color:#000;
    border:1px solid #ababab;border-radius:0;padding:0 8px;font-size:14px;outline:none;transition:border-color .1s;`;
  i.addEventListener("mouseenter", () => { if (document.activeElement !== i) i.style.borderColor = "#5692c4"; });
  i.addEventListener("mouseleave", () => { if (document.activeElement !== i) i.style.borderColor = "#ababab"; });
  i.addEventListener("focus", () => { i.style.borderColor = "#266294"; });
  i.addEventListener("blur", () => { i.style.borderColor = "#ababab"; });
  if (onEnter) i.addEventListener("keydown", (e) => { if (e.key === "Enter") onEnter(e); });
  return i;
}

// PasswordBox.qml — TextBox in Password echo (●) + a caps-lock warning glyph.
export function PasswordBox(opts = {}) {
  const wrap = el("div", { style: "position:relative;width:100%;" });
  const box = TextBox({ ...opts, password: true });
  const warn = el("div", { style: "position:absolute;right:6px;top:50%;transform:translateY(-50%);color:#c87b00;opacity:0;transition:opacity .3s;font-size:14px;pointer-events:none;", title: "Caps Lock is on" }, "⚠");
  const caps = (e) => { warn.style.opacity = e.getModifierState && e.getModifierState("CapsLock") ? "1" : "0"; };
  box.addEventListener("keydown", caps); box.addEventListener("keyup", caps);
  wrap.appendChild(box); wrap.appendChild(warn);
  wrap.input = box;
  return wrap;
}

// ComboBox.qml — white box + arrowIcon (angle-down.png); a drop list highlighting on hover.
export function ComboBox({ items = [], index = 0, arrowIcon = "", onChange } = {}) {
  let cur = index;
  const label = el("div", { style: "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#000;font-size:14px;" }, items[cur] ? items[cur].name : "");
  const arrow = arrowIcon ? el("img", { src: arrowIcon, style: "width:12px;height:12px;opacity:.7;" }) : el("div", { style: "color:#000;" }, "▾");
  const box = el("div", { style: `display:flex;align-items:center;gap:6px;height:30px;background:#fff;border:1px solid #ababab;padding:0 8px;cursor:pointer;` }, label, arrow);
  const list = el("div", { style: "position:absolute;left:0;right:0;top:31px;background:#fff;border:1px solid #ababab;z-index:50;display:none;max-height:180px;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,.3);" });
  items.forEach((it, k) => {
    const row = el("div", { style: "padding:6px 8px;color:#000;font-size:14px;cursor:pointer;" }, it.name);
    row.addEventListener("mouseenter", () => { row.style.background = "#4682b4"; row.style.color = "#fff"; });
    row.addEventListener("mouseleave", () => { row.style.background = "#fff"; row.style.color = "#000"; });
    row.addEventListener("click", () => { cur = k; label.textContent = it.name; list.style.display = "none"; onChange && onChange(k, it); });
    list.appendChild(row);
  });
  box.addEventListener("click", () => { list.style.display = list.style.display === "none" ? "block" : "none"; });
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) list.style.display = "none"; });
  const wrap = el("div", { style: "position:relative;width:100%;" }, box, list);
  Object.defineProperty(wrap, "index", { get: () => cur });
  return wrap;
}

// Clock.qml — white time + date, top-right.
export function Clock({ hourFormat = "HH:mm", color = "#fff" } = {}) {
  const t = el("div", { style: `color:${color};font-size:${Math.round(24 * PHI)}px;font-weight:300;text-align:right;text-shadow:0 1px 6px rgba(0,0,0,.5);` });
  const d = el("div", { style: `color:${color};opacity:.9;font-size:14px;text-align:right;text-shadow:0 1px 6px rgba(0,0,0,.5);` });
  const tick = () => { const now = new Date();
    t.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: !/HH/.test(hourFormat) });
    d.textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }); };
  tick(); setInterval(tick, 15000);
  return el("div", { style: "display:grid;gap:2px;" }, t, d);
}

// ── the greeter context: config · sddm · userModel · sessionModel · textConstants · keyboard.
export const textConstants = {
  welcomeText: "Welcome to %1", userName: "Username", password: "Password", session: "Session",
  layout: "Layout", login: "Login", access: "Access", shutdown: "Shut Down", reboot: "Restart",
  prompt: "Unlock your sovereign identity",
  loginSucceeded: "Session established", loginFailed: "Login failed", capslockWarning: "Caps Lock is on",
};

// the sessions the greeter offers (Xsessions analog). PrimeOS — the ONE windowed desktop shell
// (the SDK/World spatial canvas) — is the default: every application opens as a window INSIDE it,
// so it is the single canonical holospace shell. The Platform Manager (devcontainer console) and
// the standalone editor/terminal are folded into selectable sessions, no longer rival default shells.
const SESSIONS = [
  { id: "primeos", name: "PrimeOS", loader: "apps/sdk/index.html" },
  { id: "manager", name: "Platform Manager", loader: "home.html?manage" },
  { id: "debian", name: "Debian (terminal)", loader: "os.html" },
  { id: "workspace", name: "Workspace (VS Code)", loader: "workspace.html" },
];

// passphrasePrompt(name) — the graceful fallback when a device has no biometric/TEE (or the
// operator's key predates biometrics). A minimal, theme-matched overlay that returns the typed
// passphrase, or null if dismissed. Self-contained so the QML stays a single Name + Access field.
function passphrasePrompt(name, firstRun) {
  return new Promise((resolve) => {
    const done = (v) => { try { document.body.removeChild(ov); } catch {} resolve(v); };
    const inp = el("input", { type: "password", placeholder: "Passphrase", autocomplete: "current-password",
      style: "width:100%;box-sizing:border-box;height:36px;border-radius:8px;border:1px solid #3a356a;background:#06041a;color:#fff;padding:0 10px;font-size:14px;outline:none;" });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") done(inp.value); if (e.key === "Escape") done(null); });
    const go = Button({ text: "Access", width: 120, onClick: () => done(inp.value) });
    const card = el("div", { style: "background:#0d0a24;border:1px solid #2a2550;border-radius:14px;padding:22px;width:300px;color:#e7e9ff;font-family:inherit;box-shadow:0 24px 80px rgba(0,0,0,.55);" },
      el("div", { style: "font-weight:700;font-size:16px;margin-bottom:4px;" }, firstRun ? "Set a passphrase" : "Passphrase"),
      el("div", { style: "opacity:.65;font-size:12px;margin-bottom:14px;" }, (firstRun ? "Protect " : "Unlock ") + (name || "your identity")),
      inp,
      el("div", { style: "display:flex;justify-content:flex-end;gap:8px;margin-top:14px;" }, go));
    const ov = el("div", { style: "position:fixed;inset:0;background:rgba(7,4,26,.72);backdrop-filter:blur(4px);display:grid;place-items:center;z-index:99999;" }, card);
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) done(null); });
    document.body.appendChild(ov);
    setTimeout(() => inp.focus(), 30);
  });
}

// createGreeter(params) — wires the real SDDM API to the self-sovereign + hardware-bound backend.
export async function createGreeter(params) {
  const NEXT = params.get("next") || "apps/sdk/index.html";
  const loaderBase = NEXT.split("?")[0];                 // the loader the boot entry asked for (sans query)
  const defaultSessionIndex = Math.max(0, SESSIONS.findIndex((s) => s.loader.split("?")[0] === loaderBase));

  const users = await roster().catch(() => []);
  const host = await measure().catch(() => null);
  const hostName = host ? "holo-" + host.hostKappa.split(":").pop().slice(0, 4) : "hologram";

  const handlers = { loginSucceeded: [], loginFailed: [], informationMessage: [], needName: [] };
  const emit = (sig, ...a) => handlers[sig].forEach((f) => { try { f(...a); } catch {} });

  // establish(): bind operator ⊗ host, sign the loginctl-style session, hand off to the shell.
  async function establish(principal, session) {
    const token = await openSession(principal, { session: session.id, next: session.loader, host: host ? host.hostKappa : "" });
    try { sessionStorage.setItem("holo.session", JSON.stringify(token)); } catch {}
    try {
      if (navigator?.storage?.getDirectory) {
        const root = await navigator.storage.getDirectory();
        const v = await root.getDirectoryHandle("var", { create: true });
        const run = await v.getDirectoryHandle("run", { create: true });
        const h = await run.getDirectoryHandle("holo", { create: true });
        const f = await h.getFileHandle("session.json", { create: true });
        const w = await f.createWritable(); await w.write(JSON.stringify(token)); await w.close();
      }
    } catch {}
    emit("loginSucceeded");
    const sep = session.loader.includes("?") ? "&" : "?";
    const url = `${session.loader}${sep}operator=${encodeURIComponent(principal.kappa)}&host=${encodeURIComponent(host ? host.hostKappa : "")}&session=${encodeURIComponent(token.id)}`;
    return { url, token };
  }

  const sddm = {
    hostName,
    canPowerOff: true, canReboot: true,
    // sddm.login(user, password, sessionIndex) — the real signature. user = operator name (or κ);
    // password = the passphrase that unlocks the self-sovereign key. A name with no matching
    // operator ENROLLS a new sovereign identity (first boot / add user) — keeping the UI verbatim.
    async login(user, password, sessionIndex) {
      const session = SESSIONS[sessionIndex] || SESSIONS[defaultSessionIndex] || SESSIONS[0];
      const name = (user || "").trim();
      if (!name) { emit("informationMessage", "Enter your operator name"); emit("loginFailed"); return; }
      if (!password) { emit("informationMessage", "Enter your passphrase"); emit("loginFailed"); return; }
      const match = users.find((u) => u.label === name || u.kappa === name || u.kappa.endsWith(name));
      try {
        let principal;
        if (match) principal = await unlock(match.kappa, password);
        else principal = await enroll({ label: name, passphrase: password });   // first run / new identity
        const { url } = await establish(principal, session);
        sddm.__pendingUrl = url;
        setTimeout(() => { location.href = url; }, 850);
      } catch (e) {
        emit("informationMessage", /passphrase/i.test(e.message || "") ? "Wrong passphrase" : (e.message || "Login failed"));
        emit("loginFailed");
      }
    },
    // sddm.access(name) — the ONE-FIELD sign-in: prove yourself to this device's hardware TEE
    // (Windows Hello / Touch ID, via WebAuthn) and that biometric releases the secret that unlocks
    // your self-sovereign key. No passphrase to type. Auto-detects the authenticator; if the device
    // has none, falls back to a passphrase prompt so sign-in still works. Same key, same κ as login().
    async access(user) {
      const name = (user || "").trim();
      if (!name) { emit("informationMessage", "Enter your name"); emit("loginFailed"); return; }
      const match = users.find((u) => u.label === name || u.kappa === name || u.kappa.endsWith(name));
      const session = SESSIONS[defaultSessionIndex] || SESSIONS[0];
      const finish = async (principal) => {
        const { url } = await establish(principal, session);
        sddm.__pendingUrl = url;
        setTimeout(() => { location.href = url; }, 850);
      };
      // passphrase path: unlock an existing key, or enrol a new one wrapped with a typed secret.
      const viaPassphrase = async () => {
        const pass = await passphrasePrompt(name, !match);
        if (pass == null) { emit("loginFailed"); return; }
        return finish(match ? await unlock(match.kappa, pass) : await enroll({ label: name, passphrase: pass }));
      };
      try {
        const hasTee = await teeAvailable();
        // No TEE on this device, or an existing key that predates biometrics → passphrase
        // (a biometric secret can't unwrap a passphrase-wrapped key).
        if (!hasTee || (match && !match.cred)) {
          if (!hasTee) emit("informationMessage", "No biometric device — use your passphrase");
          return await viaPassphrase();
        }
        try {
          if (match && match.cred) {
            emit("informationMessage", "Verifying with " + teeName() + "…");
            const { secret } = await teeAssert({ credentialId: match.cred });
            return finish(await unlock(match.kappa, secret));
          }
          // brand-new operator → bind a sovereign key to this device's enclave
          emit("informationMessage", "Setting up " + teeName() + "…");
          const { credentialId, secret } = await teeEnroll({ name });
          return finish(await enroll({ label: name, passphrase: secret, cred: credentialId }));
        } catch (e) {
          // A real biometric cancel/timeout → report it. A capability gap (authenticator can't
          // derive a hardware secret) → degrade gracefully to a passphrase so sign-in still works.
          if (/NotAllowed/i.test((e && e.name) || "")) throw e;
          if (/PRF|hardware secret|WebAuthn unavailable/i.test((e && e.message) || "")) {
            emit("informationMessage", "Biometric unavailable here — use your passphrase");
            return await viaPassphrase();
          }
          throw e;
        }
      } catch (e) {
        emit("informationMessage", teeError(e));
        emit("loginFailed");
      }
    },
    // sddm.unlockDevice() — the RETURNING-operator path: no name typed. The operators enrolled on
    // this device already live in the local store (Law L3), so a usernameless biometric (WebAuthn
    // discoverable credential) is enough — the operator proves possession of a key, never names it
    // (Law L1). The passkey actually verified is mapped to its κ, then unlock() RE-DERIVES that κ
    // from the stored public key and refuses a mismatch (Law L5). If nothing is enrolled or there is
    // no biometric, emit needName so the greeter reveals the Name field (enrol / passphrase path).
    async unlockDevice() {
      const known = users.filter((u) => u.cred);
      const session = SESSIONS[defaultSessionIndex] || SESSIONS[0];
      if (!known.length || !(await teeAvailable())) { emit("needName"); return; }
      try {
        emit("informationMessage", "Verifying with " + teeName() + "…");
        const { secret, credentialId } = await teeAssert({ allowCredentials: known.map((u) => u.cred) });
        const op = known.find((u) => u.cred === credentialId);
        if (!op) throw new Error("This device doesn't recognise that identity");
        const principal = await unlock(op.kappa, secret);         // re-derives κ (Law L5)
        const { url } = await establish(principal, session);
        sddm.__pendingUrl = url;
        setTimeout(() => { location.href = url; }, 850);
      } catch (e) {
        // A real biometric cancel/timeout → report it. Anything else (no PRF, unknown passkey) →
        // fall back to the Name field so the operator can still sign in or enrol.
        if (/NotAllowed/i.test((e && e.name) || "")) { emit("informationMessage", teeError(e)); emit("loginFailed"); return; }
        emit("needName");
      }
    },
    powerOff() { document.documentElement.innerHTML = '<div style="position:fixed;inset:0;background:#000"></div>'; },
    reboot() { location.href = "boot.html"; },                 // → rEFInd
    suspend() { document.body.style.transition = "filter .3s"; document.body.style.filter = "brightness(.15) blur(3px)"; },
    connect(sig, fn) { if (handlers[sig]) handlers[sig].push(fn); },
  };

  const userModel = { lastUser: users[0] ? users[0].label : "", count: users.length, users };
  const sessionModel = { lastIndex: defaultSessionIndex, sessions: SESSIONS, count: SESSIONS.length };
  const keyboard = { enabled: false, capsLock: false, layouts: [] };
  return { sddm, userModel, sessionModel, textConstants, keyboard, host, describe, PHI,
    config: { background: "usr/share/sddm/themes/maldives/background.jpg" } };
}
