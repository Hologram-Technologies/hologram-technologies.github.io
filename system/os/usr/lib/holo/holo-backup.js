// holo-backup.js — the deferrable "Secure your account" nudge for Holo Login. A fresh operator's
// identity lives only on this device (biometric-wrapped); until they save the 12-word recovery phrase
// (or link a second device / set up guardians), losing the device loses the account. This shows a
// gentle, dismissible banner AFTER sign-in: "Back up now" re-authenticates (biometric, the phrase is
// never shown on an idle open session) and reveals the words; "Later" defers to the next session. Once
// saved, it never nags again. Self-contained DOM (browser only); reuses holo-login + holo-webauthn.

import * as login from "./holo-login.mjs";
import { teeReason, teeAssert } from "./holo-webauthn.mjs";

const DEFER_KEY = "holo.backup.deferred";
const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === "style") n.style.cssText = v; else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v); else if (v != null) n.setAttribute(k, v); } for (const c of kids) if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); return n; };
const btn = (kind) => "border:0;border-radius:10px;font:600 var(--holo-text-sm,1rem) system-ui;padding:9px 14px;cursor:pointer;" + (kind === "primary" ? "background:#4682b4;color:#fff;" : "background:transparent;color:#9aa3c7;border:1px solid #2a2550;");

// maybeNudge(kappa) — show the banner if this operator hasn't backed up + hasn't deferred this session.
export async function maybeNudge(kappa) {
  try {
    if (!kappa || (await login.isBackedUp(kappa))) return false;
    if (sessionStorage.getItem(DEFER_KEY) === kappa) return false;
    const op = (await login.roster()).find((o) => o.kappa === kappa);
    if (!op) return false;
    banner(op); return true;
  } catch { return false; }
}

// The nudge is now a first-class notification (Holo Notify): a sticky, actionable "Backup" alert that
// ALSO files into the persistent Center, instead of a one-off hardcoded-hex banner. Tokens + φ + the OS's
// own chrome come for free from the primitive. "Later" defers for the session; "Back up now" reveals.
function banner(op) {
  const fire = () => {
    if (!(typeof window !== "undefined" && window.HoloNotify)) return false;
    window.HoloNotify.notify({
      sender: "Backup", severity: "warn", sticky: true, icon: "🔑",
      title: "Secure your account",
      body: "Back up your recovery phrase so you never lose access — even if you lose this device.",
      actions: [
        { label: "Later", run: () => { try { sessionStorage.setItem(DEFER_KEY, op.kappa); } catch {} } },
        { label: "Back up now", primary: true, run: () => { reveal(op.kappa).catch((e) => console.warn("[backup]", e && e.message)); } },
      ],
    });
    return true;
  };
  if (!fire()) setTimeout(fire, 400);   // Notify mounts at boot; retry once if this fires first
}

// reveal(kappa) — re-authenticate (biometric / passphrase), then surface the 12 words; confirm → saved.
export async function reveal(kappa) {
  const op = (await login.roster()).find((o) => o.kappa === kappa);
  const reason = await teeReason();
  let secret;
  if (op?.cred && !reason) secret = (await teeAssert({ credentialId: op.cred })).secret;   // biometric re-auth
  else { secret = await passphrasePrompt(); if (secret == null) return; }
  phraseModal(kappa, await login.revealMnemonic(kappa, secret));
}

function phraseModal(kappa, mnemonic) {
  const words = mnemonic.split(" ");
  const close = () => ov.remove();
  const grid = el("div", { id: "holo-backup-words", style: "display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0;" },
    ...words.map((w, i) => el("div", { style: "background:#06041a;border:1px solid #2a2550;border-radius:8px;padding:8px 10px;font:600 var(--holo-text-sm,1rem) ui-monospace,monospace;" }, el("span", { style: "opacity:.5;margin-right:6px;" }, String(i + 1)), w)));
  const card = el("div", { style: "background:#0d0a24;border:1px solid #2a2550;border-radius:16px;padding:24px;width:360px;max-width:calc(100% - 32px);color:#e7e9ff;font-family:system-ui,sans-serif;box-shadow:0 24px 80px rgba(0,0,0,.6);" },
    el("div", { style: "font-weight:700;font-size:17px;margin-bottom:6px;" }, "Your recovery phrase"),
    el("div", { style: "opacity:.7;font-size:var(--holo-text-sm,1rem);line-height:1.45;" }, "Write these 12 words down and keep them safe. Anyone with them controls your account — never share them, never type them into a website."),
    grid,
    el("div", { style: "display:flex;gap:8px;justify-content:flex-end;" },
      el("button", { style: btn("ghost"), onclick: () => { navigator.clipboard?.writeText(mnemonic); } }, "Copy"),
      el("button", { id: "holo-backup-saved", style: btn("primary"), onclick: async () => { await login.markBackedUp(kappa); close(); document.getElementById("holo-backup-nudge")?.remove(); } }, "I've saved it")));
  const ov = el("div", { id: "holo-backup-modal", style: "position:fixed;inset:0;background:rgba(7,4,26,.78);backdrop-filter:blur(5px);display:grid;place-items:center;z-index:99999;" }, card);
  document.body.appendChild(ov);
}

function passphrasePrompt() {
  return new Promise((resolve) => {
    const done = (v) => { ov.remove(); resolve(v); };
    const inp = el("input", { type: "password", placeholder: "Your passphrase", autocomplete: "current-password", style: "width:100%;box-sizing:border-box;height:38px;border-radius:10px;border:1px solid #3a356a;background:#06041a;color:#fff;padding:0 12px;font-size:var(--holo-text-sm,1rem);outline:none;margin-bottom:12px;" });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") done(inp.value); if (e.key === "Escape") done(null); });
    const card = el("div", { style: "background:#0d0a24;border:1px solid #2a2550;border-radius:14px;padding:22px;width:300px;color:#e7e9ff;font-family:system-ui,sans-serif;" },
      el("div", { style: "font-weight:700;font-size:var(--holo-text-sm,1rem);margin-bottom:10px;" }, "Confirm it's you"), inp,
      el("div", { style: "display:flex;justify-content:flex-end;" }, el("button", { style: btn("primary"), onclick: () => done(inp.value) }, "Reveal phrase")));
    const ov = el("div", { style: "position:fixed;inset:0;background:rgba(7,4,26,.72);backdrop-filter:blur(4px);display:grid;place-items:center;z-index:99999;" }, card);
    document.body.appendChild(ov); setTimeout(() => inp.focus(), 30);
  });
}

if (typeof window !== "undefined") window.HoloBackup = { maybeNudge, reveal };
