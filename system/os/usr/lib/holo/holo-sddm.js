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

import { openSession, ephemeral, persistSession } from "./holo-identity.mjs";
import { packHandoff, HANDOFF_KEY } from "./holo-handoff.mjs";   // carry the session handoff in storage, not the URL query → a clean holo://os/home bar
// Holo Login: the operator's identity AND omni-chain wallet derive from ONE BIP-39 seed — the
// canonical login identity is now the seed's did:key (the SAME key Holo Wallet/Privacy use), its
// session κ the content address of that key (Law L1, verifySession-compatible). enroll/unlock/roster
// come from here; openSession + guest (ephemeral, non-persistent) stay on holo-identity.
import { enroll as enrollRoot, unlock, roster, relabel } from "./holo-login.mjs";
import { provisionWallet, isPresentationSafe } from "./holo-wallet-provision.mjs";   // auto-provision + surface the wallet on first tap (GAP-2)
// enroll() returns just the principal (the 12-word phrase stays inside the content-addressed vault,
// retrievable later for backup); accepts the old `passphrase` param name as the unlock `secret`.
const enroll = async (o = {}) => (await enrollRoot({ label: o.label, secret: o.passphrase ?? o.secret, cred: o.cred, credPub: o.credPub })).principal;
import { measure, describe } from "./holo-host.mjs";
import { teeAvailable, teeReason, teeName, teeEnroll, teeAssert, teeError } from "./holo-webauthn.mjs";

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
// The Hologram greeter button — a φ-proportioned (h≈44 = 27·φ) brand-teal pill on the dark glass
// card; soft lift + glow on hover, never a colour an SDDM raster shipped. Reduced-motion-safe.
export function Button({ text = "Button", width, onClick }) {
  const b = el("button", { class: "sddm-btn", type: "button" }, text);
  b.style.cssText = `min-width:${width || 144}px;height:44px;border:0;border-radius:13px;color:#04130d;
    font-weight:700;font-size:15px;letter-spacing:.01em;cursor:pointer;padding:0 22px;
    background:linear-gradient(135deg,#7defc9,#34d3a6);box-shadow:0 8px 26px rgba(52,211,166,.30);
    transition:transform .15s ease,box-shadow .2s ease,filter .2s ease;`;
  const rest = () => { b.style.transform = ""; b.style.boxShadow = "0 8px 26px rgba(52,211,166,.30)"; b.style.filter = ""; };
  const hov = () => { b.style.transform = "translateY(-1px)"; b.style.boxShadow = "0 13px 32px rgba(52,211,166,.46)"; b.style.filter = "brightness(1.05)"; };
  b.addEventListener("mouseenter", hov);
  b.addEventListener("mouseleave", rest);
  b.addEventListener("focus", hov);
  b.addEventListener("blur", rest);
  b.addEventListener("mousedown", () => { b.style.transform = "translateY(0) scale(.98)"; });
  b.addEventListener("mouseup", hov);
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

// TextBox.qml — white bg, 1px border #ababab; hover #5692c4; focus #266294; black text;
// 8px inner inset (TextInput width = parent − 16); 100ms transition.
export function TextBox({ password = false, value = "", placeholder = "", height = 44, onEnter } = {}) {
  const i = el("input", { type: password ? "password" : "text", placeholder, autocomplete: password ? "current-password" : "off" });
  i.value = value;
  i.style.cssText = `width:100%;height:${height}px;box-sizing:border-box;background:rgba(255,255,255,.045);color:#eef1ff;
    border:1px solid rgba(125,239,201,.20);border-radius:12px;padding:0 14px;font-size:15px;outline:none;text-align:center;
    transition:border-color .15s,background .15s,box-shadow .15s;`;
  i.addEventListener("focus", () => { i.style.borderColor = "rgba(125,239,201,.65)"; i.style.background = "rgba(255,255,255,.07)"; i.style.boxShadow = "0 0 0 4px rgba(52,211,166,.10)"; });
  i.addEventListener("blur", () => { i.style.borderColor = "rgba(125,239,201,.20)"; i.style.background = "rgba(255,255,255,.045)"; i.style.boxShadow = "none"; });
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
  { id: "primeos", name: "PrimeOS", loader: "shell.html" },
  { id: "manager", name: "Platform Manager", loader: "home.html?manage" },
  { id: "debian", name: "Debian (terminal)", loader: "os.html" },
  { id: "workspace", name: "Workspace (VS Code)", loader: "workspace.html" },
];

// (passphrasePrompt removed — Hologram sign-in is BIOMETRIC-ONLY; there is no passcode to type.
// A device with no biometric uses the phone's biometric via pairWithPhone(), or enters as Guest.)

// pairOverlay({ svg, onCancel }) — the "Sign in with your phone" panel: a themed card holding the
// scannable QR (a Holo QR SVG) and a live status line. Self-contained DOM (like passphrasePrompt),
// so the QML stays minimal. Returns { close, status } so the transport step can update progress.
function pairOverlay({ svg, onCancel }) {
  const close = () => { try { document.body.removeChild(ov); } catch {} onCancel && onCancel(); };
  const qr = el("div", { style: "width:300px;height:300px;background:#fff;border-radius:16px;padding:12px;box-sizing:border-box;" });
  qr.innerHTML = svg;
  const qsvg = qr.querySelector("svg");
  if (qsvg) { qsvg.style.width = "100%"; qsvg.style.height = "100%"; qsvg.style.display = "block"; qsvg.style.imageRendering = "pixelated"; }
  const statusEl = el("div", { style: "font-size:12px;opacity:.75;margin:14px 0;min-height:16px;" }, "Waiting for your phone…");
  const card = el("div", { style: "background:#0d0a24;border:1px solid #2a2550;border-radius:16px;padding:24px;width:348px;color:#e7e9ff;font-family:inherit;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,.55);" },
    el("div", { style: "font-weight:700;font-size:17px;margin-bottom:6px;" }, "Sign in with your phone"),
    el("div", { style: "opacity:.7;font-size:13px;margin-bottom:16px;line-height:1.45;" }, "Open your phone's camera and scan this code, then approve with your fingerprint or face."),
    el("div", { style: "display:grid;place-items:center;" }, qr),
    statusEl,
    el("div", { style: "display:flex;justify-content:center;" }, Button({ text: "Cancel", width: 110, onClick: close })));
  const ov = el("div", { style: "position:fixed;inset:0;background:rgba(7,4,26,.78);backdrop-filter:blur(5px);display:grid;place-items:center;z-index:99999;" }, card);
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
  document.body.appendChild(ov);
  return { close, status: (t) => { statusEl.textContent = t; } };
}

// createGreeter(params) — wires the real SDDM API to the self-sovereign + hardware-bound backend.
export async function createGreeter(params) {
  // CANONICAL LANDING — every sign-in (operator OR guest) ends on the PrimeOS holospace desktop
  // (SESSIONS[0] = shell.html). A boot entry MAY request a specific session via ?next=<loader> (the
  // rEFInd menu offers Debian / Workspace / Manager); if next names a KNOWN session we honour it,
  // otherwise we ALWAYS fall back to the canonical desktop — so a stale or unknown next (e.g. a legacy
  // apps/sdk/index.html) can never strand anyone off the desktop. There is exactly one default.
  const CANONICAL_SESSION = 0;                           // SESSIONS[0] = primeos = shell.html, the one holospace desktop
  const NEXT = params.get("next") || "shell.html";
  const loaderBase = NEXT.split("?")[0];                 // the loader the boot entry asked for (sans query)
  const matchedSession = SESSIONS.findIndex((s) => s.loader.split("?")[0] === loaderBase);
  const defaultSessionIndex = matchedSession >= 0 ? matchedSession : CANONICAL_SESSION;

  const users = await roster().catch(() => []);
  const host = await measure().catch(() => null);
  const hostName = host ? "holo-" + host.hostKappa.split(":").pop().slice(0, 4) : "hologram";

  const handlers = { loginSucceeded: [], loginFailed: [], informationMessage: [], needName: [], needGreetingName: [] };
  const emit = (sig, ...a) => handlers[sig].forEach((f) => { try { f(...a); } catch {} });

  // establish(): bind operator ⊗ host, sign the loginctl-style session, hand off to the shell.
  async function establish(principal, session, { guest = false, secret = null } = {}) {
    const token = await openSession(principal, { session: session.id, next: session.loader, host: host ? host.hostKappa : "", guest: guest || undefined });
    try { await persistSession(token, null); } catch {}   // display-split: presentation only (no operator secret on this path)
    // A guest is NON-PERSISTENT: skip the OPFS session mirror so nothing is written to the store.
    if (!guest) try {
      if (navigator?.storage?.getDirectory) {
        const root = await navigator.storage.getDirectory();
        const v = await root.getDirectoryHandle("var", { create: true });
        const run = await v.getDirectoryHandle("run", { create: true });
        const h = await run.getDirectoryHandle("holo", { create: true });
        const f = await h.getFileHandle("session.json", { create: true });
        const w = await f.createWritable(); await w.write(JSON.stringify(token)); await w.close();
        // Auto-provision + surface the omni-chain wallet on first tap (GAP-2). The wallet PROJECTS from
        // the same seed (principal.addresses), so this is just the PUBLIC address presentation — no secret,
        // no second unlock. The shell reads it for the Home "Wallet" affordance. Guests get none (above).
        try {
          const wal = provisionWallet(principal);
          if (wal.provisioned && isPresentationSafe(wal)) {
            const wf = await h.getFileHandle("wallet.json", { create: true });
            const ww = await wf.createWritable(); await ww.write(JSON.stringify(wal)); await ww.close();
          }
        } catch {}
      }
    } catch {}
    emit("loginSucceeded");
    // Vault stays closed here (display-split): the shell opens it lazily on first credential use, gated by
    // the broker biometric (typically silent within the OS Hello trust window). No secret crosses to the shell.
    const sep = session.loader.includes("?") ? "&" : "?";
    const url = `${session.loader}${sep}operator=${encodeURIComponent(principal.kappa)}&host=${encodeURIComponent(host ? host.hostKappa : "")}&session=${encodeURIComponent(token.id)}`;
    return { url, token };
  }

  // enterShell(url) — the ONE handoff to the desktop, fired at the very END of every sign-in path (not on
  // the tap). No fullscreen (it jumps); instead the greeter's view plays a glass-unfog on loginSucceeded
  // and we redirect once the frost has cleared. The desktop wears the same aurora wallpaper and fades in,
  // so the seam is invisible. Guarded so repeated taps can't double-navigate.
  function enterShell(url, delay = 850) {
    if (sddm.__entering) return; sddm.__entering = true;
    // CLEAN ADDRESS: carry the session handoff in same-origin sessionStorage, not the URL query — so the bar
    // reads a bare holo://os/home, no ?operator=…&session=…. Both pages share the OS origin (host "os"), so
    // storage crosses the navigation; the query was only ever there to survive it. The shell rehydrates once.
    try { const h = packHandoff(url); if (h.handoff) { sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(h.handoff)); url = h.path; } } catch (e) {}
    // native: holo://os/home canonicalizes to shell.html; web/dev keeps shell.html (no canonicalizer).
    if (location.protocol === "holo:") url = String(url).replace(/^(?:.?/)?shell.html(?=[?#]|$)/, "home");
    sddm.__pendingUrl = url;
    setTimeout(() => { location.href = url; }, delay);
  }

  // prewarmShell() — LATENCY: the biometric tap is ~1-2s of otherwise-idle time. The instant a sign-in path
  // commits, start pulling the desktop's bytes into cache (and let the browser pre-parse the HTML) so the
  // post-auth navigation is cache-hot and the desktop paints almost immediately. Pure overlap with the human
  // tap — touches nothing secret, can't fail the login (best-effort, idempotent). The 850ms unfog then hides
  // whatever boot remains.
  let _prewarmed = false;
  function prewarmShell() {
    if (_prewarmed) return; _prewarmed = true;
    try {
      const loader = (SESSIONS[CANONICAL_SESSION] && SESSIONS[CANONICAL_SESSION].loader) || "shell.html";
      try { fetch(loader, { cache: "force-cache" }).then((r) => r && r.text()).catch(() => {}); } catch (e) {}
      try { const l = document.createElement("link"); l.rel = "prefetch"; l.as = "document"; l.href = loader; document.head.appendChild(l); } catch (e) {}
    } catch (e) {}
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
        const { url } = await establish(principal, session, { secret: password });
        enterShell(url);
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
      const finish = async (principal, secret = null) => {
        const { url } = await establish(principal, session, { secret });
        enterShell(url);
      };
      // BIOMETRIC-ONLY (no passcode). The secret that wraps the sovereign key is released ONLY by
      // this device's enclave (Windows Hello / Touch ID). There is nothing to type. If the device
      // has no biometric — or the chosen identity has no biometric enrolled HERE — the operator
      // signs in with their phone's biometric (pairWithPhone) or enters as Guest; we say so plainly.
      try {
        const reason = await teeReason();        // "" when a real biometric ceremony can run here
        if (reason) { emit("informationMessage", (reason || "No biometric on this device") + " — sign in with your phone or continue as Guest"); emit("loginFailed"); return; }
        if (match && !match.cred) { emit("informationMessage", "That identity has no biometric on this device — sign in with your phone"); emit("loginFailed"); return; }
        try {
          if (match && match.cred) {
            emit("informationMessage", "Verifying with " + teeName() + "…");
            const { secret } = await teeAssert({ credentialId: match.cred });
            return finish(await unlock(match.kappa, secret), secret);
          }
          // brand-new operator → bind a sovereign key to this device's enclave. `secret` here is the
          // enclave-derived hardware secret (NOT a typed passcode); enroll's param name is legacy.
          emit("informationMessage", "Setting up " + teeName() + "…");
          const { credentialId, secret, credPub } = await teeEnroll({ name });
          return finish(await enroll({ label: name, passphrase: secret, cred: credentialId, credPub }), secret);
        } catch (e) {
          // A real biometric cancel/timeout → report it. A capability gap (authenticator can't
          // derive a hardware secret) → steer to the phone's biometric; never to a passcode.
          if (/NotAllowed/i.test((e && e.name) || "")) throw e;
          if (/PRF|hardware secret|WebAuthn unavailable/i.test((e && e.message) || "")) {
            emit("informationMessage", "Biometric unavailable here — sign in with your phone or continue as Guest");
            emit("loginFailed"); return;
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
      const reason = await teeReason();
      if (!known.length) { emit("needName"); return; }              // nothing enrolled → enrol path
      if (reason) { emit("informationMessage", reason); emit("needName"); return; }   // no biometric → name/passphrase
      try {
        prewarmShell();                                            // pull the desktop into cache during the tap
        emit("informationMessage", "Verifying with " + teeName() + "…");
        const { secret, credentialId } = await teeAssert({ allowCredentials: known.map((u) => u.cred) });
        const op = known.find((u) => u.cred === credentialId);
        if (!op) throw new Error("This device doesn't recognise that identity");
        const principal = await unlock(op.kappa, secret);         // re-derives κ (Law L5)
        const { url } = await establish(principal, session);
        enterShell(url);
      } catch (e) {
        // A real biometric cancel/timeout → report it. Anything else (no PRF, unknown passkey) →
        // fall back to the Name field so the operator can still sign in or enrol.
        if (/NotAllowed/i.test((e && e.name) || "")) { emit("informationMessage", teeError(e)); emit("loginFailed"); return; }
        emit("needName");
      }
    },
    // sddm.pairWithPhone() — "scan QR to Access" (Holo Pair). This new device mints its OWN key +
    // a single-use channel and shows a QR; the operator's phone (already signed in) scans it, and
    // its biometric-unlocked key GRANTS this device a scoped, revocable capability (no key leaves the
    // phone). Lazy-loads Holo Pair + Holo QR so the default login stays lean. The live phone→desktop
    // transport (κ pub/sub over the content-blind relay) lands next; the QR + offer are ready now.
    async pairWithPhone() {
      const abort = new AbortController();
      try {
        const [pair, { toSVG }] = await Promise.all([import("./holo-pair.mjs"), import("./holo-qr.js")]);
        const deviceName = (host && host.hostKappa ? "holo-" + host.hostKappa.split(":").pop().slice(0, 4) : "This device");
        const { offer, secrets } = await pair.createPairOffer({ deviceName });
        const url = pair.offerToUrl(offer, location.origin);
        const svg = toSVG(url, { scale: 8, margin: 2, dark: "#0b071e", light: "#ffffff", opts: { ecc: "L" } });
        const ui = pairOverlay({ svg, onCancel: () => { sddm.__pairing = null; abort.abort(); } });
        sddm.__pairing = { offer, secrets, url, channel: offer.channel, ui };
        // wait for the phone to drop the grant on the single-use channel, then verify + sign in
        const blob = await pair.pollGrant(offer.channel, { signal: abort.signal });
        if (!blob) { if (!abort.signal.aborted) ui.status("Timed out — Cancel and try again"); return; }
        ui.status("Approved — signing you in…");
        const got = await pair.acceptGrant(secrets, blob);              // decrypt + verify the grant (Law L5)
        const session = SESSIONS[defaultSessionIndex] || SESSIONS[0];
        // a DELEGATED session: the device acts for the operator, carrying the operator-signed grant as
        // proof (only this device could decrypt it — E2E to its key). Device-signed session = a refinement.
        const token = { "@type": "HoloDelegatedSession", delegated: true, operator: got.operator, label: got.label || "",
          device: secrets.deviceKappa, grant: got.grant, can: got.can, session: session.id, next: session.loader,
          host: host ? host.hostKappa : "", issuedAt: new Date().toISOString() };
        try { await persistSession(token, null); } catch {}   // display-split: presentation only; the grant never sits in app-readable storage
        emit("loginSucceeded");
        const sep = session.loader.includes("?") ? "&" : "?";
        const u = `${session.loader}${sep}operator=${encodeURIComponent(got.operator)}&host=${encodeURIComponent(host ? host.hostKappa : "")}&session=${encodeURIComponent(got.grant.id)}&via=pair`;
        enterShell(u);
      } catch (e) {
        const msg = "Phone sign-in failed: " + (e && e.message || e);
        if (sddm.__pairing && sddm.__pairing.ui) sddm.__pairing.ui.status(msg); else emit("informationMessage", msg);
      }
    },
    // sddm.guest() — non-persistent GUEST access: mint an ephemeral sovereign key (never stored), open
    // a session, go. No name, no biometric, no passphrase. Seamless for a human (one tap) AND an agent
    // (login.html?guest=1 calls this on load). Closing the session forgets the key entirely.
    async guest() {
      try {
        const principal = await ephemeral({ label: "Guest" });
        const session = SESSIONS[defaultSessionIndex] || SESSIONS[0];
        emit("informationMessage", "Entering as guest…");
        const { url } = await establish(principal, session, { guest: true });
        enterShell(url);
        return url;
      } catch (e) {
        emit("informationMessage", "Guest sign-in failed: " + (e && e.message || e));
        emit("loginFailed");
      }
    },
    // sddm.unlockPass(kappa, secret) — direct passphrase unlock of a chosen operator (the lock-screen
    // PIN/passphrase box). Biometric stays the primary via unlockDevice(); this is the typed fallback.
    async unlockPass(kappa, secret) {
      const session = SESSIONS[defaultSessionIndex] || SESSIONS[0];
      try {
        if (!secret) { emit("informationMessage", "Enter your passphrase"); emit("loginFailed"); return; }
        emit("informationMessage", "Verifying…");
        const principal = await unlock(kappa, secret);            // holo-login.unlock → re-derives κ (Law L5)
        const { url } = await establish(principal, session);
        enterShell(url);
      } catch (e) {
        emit("informationMessage", /wrong|passphrase|decrypt|aead|tag|secret/i.test((e && e.message) || "") ? "That passphrase didn't work" : ((e && e.message) || "Sign-in failed"));
        emit("loginFailed");
      }
    },
    // sddm.firstRun() — Windows-style "name after auth". A brand-new operator AUTHENTICATES FIRST:
    // we bind a sovereign key to this device's enclave (Windows Hello / Touch ID) with NO name typed,
    // using a neutral default label. On success we DON'T enter yet — we stash the principal and emit
    // needGreetingName so the greeter can ask "what should I call you?". completeFirstRun() then names
    // and enters. No biometric here → steer to the phone / Guest, exactly like access().
    async firstRun() {
      const session = SESSIONS[defaultSessionIndex] || SESSIONS[0];
      try {
        const reason = await teeReason();
        if (reason) { emit("informationMessage", (reason || "No biometric on this device") + " — sign in with your phone or continue as Guest"); emit("loginFailed"); return; }
        emit("informationMessage", "Setting up " + teeName() + "…");
        prewarmShell();                                            // warm the desktop while the enclave enrols
        const { credentialId, secret, credPub } = await teeEnroll({ name: "Hologram" });
        const principal = await enroll({ label: "You", passphrase: secret, cred: credentialId, credPub });   // default label; renamed in completeFirstRun
        sddm.__pendingEnrol = { principal, secret, session };
        emit("needGreetingName");
      } catch (e) {
        if (/NotAllowed/i.test((e && e.name) || "")) { emit("informationMessage", teeError(e)); emit("loginFailed"); return; }
        if (/PRF|hardware secret|WebAuthn unavailable/i.test((e && e.message) || "")) {
          emit("informationMessage", "Biometric unavailable here — sign in with your phone or continue as Guest"); emit("loginFailed"); return;
        }
        emit("informationMessage", teeError(e)); emit("loginFailed");
      }
    },
    // sddm.completeFirstRun(name) — finish the paused first run: set the chosen display name (optional —
    // a blank keeps the default), persist it as the operator's label (κ is unchanged), then establish the
    // session and enter the desktop. The name is the ONLY thing ever typed, and only after authentication.
    async completeFirstRun(name) {
      const pend = sddm.__pendingEnrol;
      if (!pend) { emit("informationMessage", "Sign-in expired — start again"); emit("loginFailed"); return; }
      sddm.__pendingEnrol = null;
      try {
        const label = (name || "").trim();
        if (label) { try { await relabel(pend.principal.kappa, label); } catch {} pend.principal.label = label; }
        const { url } = await establish(pend.principal, pend.session, { secret: pend.secret });
        enterShell(url);
      } catch (e) {
        emit("informationMessage", teeError(e)); emit("loginFailed");
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
