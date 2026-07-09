// holo-manifesto.mjs — the greeter's brand chrome: the "Manifesto" door (top-left) and the Hologram
// wordmark (bottom-centre), plus a clean, themed reader for the OS Manifesto.
//
// The words are the canonical Hologram OS Manifesto (holo-os/MANIFESTO.md) — imported here verbatim so the
// login screen speaks with the SAME voice as the OS itself. The reader inherits the greeter's appearance
// tokens (--ink/--sheet/--muted…), so it is sharp in Dark, Light, and Immersive alike. Self-contained:
// one call, mountManifesto(overlay); fail-open (a hiccup never blocks sign-in).

// the canonical H-in-cube line mark (usr/share/icons/holo-glyph.svg) — currentColor, crisp at any size.
const GLYPH = `<svg viewBox="0 0 128 128" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M64 18 L104 41 V87 L64 110 L24 87 V41 Z"/><path d="M50 46 V82 M78 46 V82 M50 64 H78"/></svg>`;

// The canonical Hologram DOT-HALFTONE mark (usr/share/icons/hologram-dark.svg), inlined with fill:currentColor
// so it themes itself — light dots on a dark ground, ink dots on paper — for correct contrast in every mode.
// Pure vector (transparent, resolution-independent, razor-sharp on any display density).
const MARK = `<svg viewBox="-104 -104 208 208" fill="currentColor" role="img" aria-label="Hologram"><g><circle cx="0.20" cy="-97.39" r="2.61"/><circle cx="-22.86" cy="-86.55" r="2.71"/><circle cx="22.54" cy="-86.32" r="2.81"/><circle cx="-0.03" cy="-76.01" r="2.71"/><circle cx="45.26" cy="-75.92" r="7.80"/><circle cx="-45.82" cy="-75.86" r="2.61"/><circle cx="68.34" cy="-65.13" r="7.70"/><circle cx="-68.83" cy="-65.00" r="2.61"/><circle cx="-22.91" cy="-64.90" r="2.61"/><circle cx="22.71" cy="-64.88" r="2.51"/><circle cx="91.24" cy="-54.34" r="2.61"/><circle cx="-45.94" cy="-54.25" r="7.83"/><circle cx="-91.17" cy="-54.19" r="2.71"/><circle cx="-0.03" cy="-54.19" r="2.71"/><circle cx="45.35" cy="-54.19" r="7.80"/><circle cx="-22.86" cy="-43.64" r="2.71"/><circle cx="22.71" cy="-43.49" r="2.51"/><circle cx="68.29" cy="-43.47" r="7.73"/><circle cx="-68.60" cy="-43.37" r="7.73"/><circle cx="-45.85" cy="-32.63" r="7.77"/><circle cx="45.36" cy="-32.60" r="7.80"/><circle cx="-91.26" cy="-32.55" r="2.71"/><circle cx="0.10" cy="-32.51" r="2.61"/><circle cx="91.24" cy="-32.51" r="2.61"/><circle cx="68.22" cy="-21.95" r="7.83"/><circle cx="22.67" cy="-21.84" r="7.87"/><circle cx="-22.86" cy="-21.82" r="2.71"/><circle cx="-68.57" cy="-21.80" r="7.80"/><circle cx="45.45" cy="-11.06" r="7.73"/><circle cx="-0.19" cy="-11.04" r="7.87"/><circle cx="91.35" cy="-11.01" r="2.81"/><circle cx="-91.54" cy="-10.97" r="2.51"/><circle cx="-45.87" cy="-10.87" r="7.73"/><circle cx="22.71" cy="-0.27" r="8.06"/><circle cx="-22.89" cy="-0.21" r="7.90"/><circle cx="68.28" cy="-0.15" r="7.87"/><circle cx="-68.62" cy="-0.11" r="8.00"/><circle cx="-0.06" cy="10.98" r="7.87"/><circle cx="45.54" cy="11.00" r="7.83"/><circle cx="-45.85" cy="11.02" r="7.77"/><circle cx="-91.26" cy="11.10" r="2.71"/><circle cx="91.24" cy="11.13" r="2.61"/><circle cx="22.71" cy="21.64" r="2.71"/><circle cx="-68.74" cy="21.66" r="7.87"/><circle cx="-22.86" cy="21.67" r="7.87"/><circle cx="68.28" cy="21.67" r="7.87"/><circle cx="-91.54" cy="32.46" r="2.61"/><circle cx="0.15" cy="32.46" r="2.71"/><circle cx="-45.72" cy="32.50" r="7.73"/><circle cx="45.54" cy="32.59" r="7.83"/><circle cx="91.35" cy="32.63" r="2.81"/><circle cx="-23.01" cy="43.23" r="2.61"/><circle cx="68.25" cy="43.31" r="7.83"/><circle cx="-68.71" cy="43.34" r="7.83"/><circle cx="22.71" cy="43.37" r="2.90"/><circle cx="91.39" cy="53.92" r="2.71"/><circle cx="45.48" cy="53.95" r="7.87"/><circle cx="-45.86" cy="53.97" r="7.80"/><circle cx="-91.34" cy="53.99" r="2.61"/><circle cx="0.20" cy="54.09" r="2.61"/><circle cx="-68.57" cy="64.90" r="7.80"/><circle cx="-22.86" cy="64.92" r="2.71"/><circle cx="68.28" cy="64.92" r="2.71"/><circle cx="22.54" cy="65.15" r="2.81"/><circle cx="-45.88" cy="75.56" r="7.80"/><circle cx="0.10" cy="75.62" r="2.61"/><circle cx="45.32" cy="75.62" r="2.61"/><circle cx="22.53" cy="86.47" r="2.71"/><circle cx="-22.86" cy="86.75" r="2.71"/><circle cx="-0.03" cy="97.29" r="2.71"/></g></svg>`;

// The Manifesto, from Hologram OS. Sections mirror MANIFESTO.md; typeset for a calm, sharp read.
const LEAD = "Your personal supercomputer. Fast, free, and private. It runs entirely in your browser, and it is yours.";
const INTRO = [
  "The most powerful computing ever built is not yours.",
  "It lives in a building you will never enter, rented by the hour, watching while it works. You bought the device in your hands, but you rent the software on it. You create the data, but it sleeps on someone else’s machine. You ask the questions, but the intelligence that answers belongs to a company, and it remembers you for reasons that are not yours.",
  "The world calls this normal: a screen you look at, owned by people who look back.",
  "A supercomputer is hard. So they kept it. They kept the servers, the accounts, and the complexity, and handed you a small window into it.",
  "We do the opposite. We hold the complexity and hand you the simplicity. The supercomputer becomes yours, and it fits in a browser tab.",
];
const SECTIONS = [
  ["It is yours before you ask", ["When you arrive, nothing demands that you prove yourself to a stranger. The machine opens as if it had been waiting for you, because it had. No account in the cloud grants you entry. The key is you."]],
  ["Nothing leaves unless you say so", ["Everything here lives on this device. Your files, your spaces, your work: on your machine, not in transit, not in a ledger you cannot read. Apps and agents do not take. They ask, once, for each thing, and you decide. What you do not grant stays hidden. What you grant, you can take back.", "This is not a privacy setting. It is the floor."]],
  ["Build it. Run it. Share it.", ["Describe what you want, and it is built: beside you, in the open, beautiful by default. You do not choose from a shelf of someone else’s apps. You compose your own, and when one thing changes, the rest heals to match.", "It runs the moment you ask. No install, no server, no sign-up. A serverless application that simply runs, in any browser, anywhere.", "And it is yours to give. Share it as one address, and whoever opens it just runs it. No account, no permission, no trace back to you.", "Fast. Free. Private."]],
  ["You do not trust it. You verify it.", ["We do not ask for your faith. Every part of this system re-derives from its own content: a single address the bytes themselves compute. Change one byte and it will not run. You can check this yourself, live, and watch the count finish in front of you.", "Sovereignty that cannot be verified is only a promise. This one you can prove."]],
  ["It serves you, and it will not be moved", ["It does what you ask. It does not argue, nag, or stall, and it will not refuse a lawful request from you. You are the operator. It answers to you.", "But there are lines it will not cross, even at your own command, because crossing them is how you would be betrayed. It will never surrender your private identity. It will never reveal what you have sealed. And when you say stop, everything stops. These are not preferences. They are red lines, and a red line never bends.", "It will not state as fact anything it cannot trace to a source, and when you ask why, it shows you its reasoning. Honesty before comfort. You are owed the truth in a form you can check, not the flattery that keeps you scrolling."]],
  ["The world comes in on your terms", ["The web is not a place you visit and are watched. It is a library you pull into your sanctuary. Bring in anything: a page, a repository, an app. It becomes yours, governed, content-addressed, answerable to you. You reach outward from safety, and you never have to leave it to do so."]],
  ["You are not alone in this", ["From your first moment here, Q is with you. On this device, a faculty of your own mind, never a vendor’s voice in your ear. It introduces itself once, then steps back. It offers, never nags. It keeps the thread of what you have done, and when you ask, it tells your story back to you. Q is the witness to a world you authored."]],
  ["The purpose", ["There is only one.", "Not to capture your attention. Not to harvest your behavior. Not to rent you intelligence by the question.", "To give you a supercomputer that is wholly yours, and to enable you, every sovereign user, to tell your story with it.", "We abstract the complexity. You keep the simplicity, the power, and the proof.", "The machine hands you the instrument and gets out of the way.", "From here, you can build your world."]],
];
const CLOSE_LINE = "This machine is mine.";
const FOOTNOTE = "Every claim here is something the OS already does — sealed as a content-addressed object, proven consistent across all 1024 situations its principles range over. Do not trust this page. Verify it.";

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const CSS = `
#holo-login .hl-manifesto{position:fixed;left:max(22px,env(safe-area-inset-left));top:max(20px,env(safe-area-inset-top));z-index:4;
  pointer-events:auto;border:0;background:none;color:var(--ink-dim,rgba(231,237,250,.82));font:500 var(--u,16px)/1 "Segoe UI",system-ui,sans-serif;
  cursor:pointer;padding:8px 4px;letter-spacing:.01em;text-shadow:var(--shadow,none);opacity:0;animation:hlm-in .6s ease 1.2s forwards;transition:color .15s}
#holo-login .hl-manifesto:hover{color:var(--ink,#fff)}
#holo-login .hl-brand{position:fixed;left:50%;transform:translateX(-50%);bottom:max(26px,env(safe-area-inset-bottom));z-index:3;
  pointer-events:none;display:inline-flex;align-items:center;gap:11px;color:var(--ink,#f4f7fc);opacity:0;animation:hlm-in .7s ease 1.35s forwards}
#holo-login .hl-brand svg{width:26px;height:26px;flex:0 0 auto;filter:drop-shadow(var(--shadow,0 0 0 transparent))}
#holo-login .hl-brand b{font:700 var(--u,15px)/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.2em;padding-left:.2em;color:var(--ink-dim,rgba(231,237,250,.86));text-shadow:var(--shadow,none)}
@keyframes hlm-in{to{opacity:1}}
@media (prefers-reduced-motion:reduce){#holo-login .hl-manifesto,#holo-login .hl-brand{animation:none;opacity:1}}

#holo-login .hlm-scrim{position:fixed;inset:0;z-index:8;pointer-events:auto;background:var(--glass,rgba(1,4,9,.66));
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:grid;place-items:center;animation:hlm-fade .22s ease}
@keyframes hlm-fade{from{opacity:0}}
#holo-login .hlm-sheet{width:min(680px,94vw);max-height:88vh;max-height:88dvh;display:flex;flex-direction:column;overflow:hidden;
  background:var(--sheet,rgba(8,12,18,.96));border:1px solid var(--glass-border,rgba(255,255,255,.12));border-radius:18px;
  box-shadow:0 28px 90px rgba(0,0,0,.6);color:var(--ink,#e6edf3);font-family:"Segoe UI",system-ui,-apple-system,sans-serif}
#holo-login .hlm-head{display:flex;align-items:center;gap:12px;padding:20px 26px 14px;flex:0 0 auto}
#holo-login .hlm-head .g{width:26px;height:26px;flex:0 0 auto;color:var(--ink,#e6edf3)}
#holo-login .hlm-head .t{font-size:calc(var(--u,16px)*1.15);font-weight:700;letter-spacing:.01em}
#holo-login .hlm-x{margin-left:auto;width:34px;height:34px;flex:0 0 auto;border:0;border-radius:50%;background:var(--field-bg,rgba(255,255,255,.08));color:var(--ink,#c9d1d9);cursor:pointer;font-size:var(--u,16px)}
#holo-login .hlm-x:hover{background:var(--field-border,rgba(255,255,255,.16))}
#holo-login .hlm-body{padding:4px 26px 26px;overflow-y:auto;flex:1 1 auto;min-height:0;font-size:var(--u,16px);line-height:1.62}
#holo-login .hlm-lead{font-size:calc(var(--u,16px)*1.12);font-weight:600;color:var(--ink,#f4f7fc);margin:6px 0 22px;padding-left:16px;border-left:2px solid var(--accent-2,#34d3a6);line-height:1.5}
#holo-login .hlm-body p{margin:0 0 15px;color:var(--ink-dim,rgba(231,237,250,.86))}
#holo-login .hlm-body h3{margin:26px 0 10px;font-size:var(--u,16px);font-weight:700;color:var(--ink,#f4f7fc);letter-spacing:.01em}
#holo-login .hlm-close{margin:28px 0 4px;font-size:calc(var(--u,16px)*1.28);font-weight:700;color:var(--ink,#f4f7fc);text-align:center}
#holo-login .hlm-note{margin-top:22px;padding-top:16px;border-top:1px solid var(--glass-border,rgba(255,255,255,.09));font-size:calc(var(--u,16px)*.92);color:var(--muted,#8b949e)}
`;

function injectCss() { try { if (document.getElementById("holo-manifesto-css")) return; const s = document.createElement("style"); s.id = "holo-manifesto-css"; s.textContent = CSS; document.head.appendChild(s); } catch {} }

export function openManifesto(overlay) {
  injectCss();
  const scrim = document.createElement("div"); scrim.className = "hlm-scrim";
  let html = `<div class="hlm-sheet" role="dialog" aria-label="Hologram Manifesto" aria-modal="true">
    <div class="hlm-head"><span class="g">${GLYPH}</span><span class="t">Manifesto</span><button class="hlm-x" aria-label="Close">✕</button></div>
    <div class="hlm-body"><div class="hlm-lead">${esc(LEAD)}</div>`;
  for (const p of INTRO) html += `<p>${esc(p)}</p>`;
  for (const [h, ps] of SECTIONS) { html += `<h3>${esc(h)}</h3>`; for (const p of ps) html += `<p>${esc(p)}</p>`; }
  html += `<div class="hlm-close">${esc(CLOSE_LINE)}</div><div class="hlm-note">${esc(FOOTNOTE)}</div></div></div>`;
  scrim.innerHTML = html;
  const close = () => { scrim.remove(); document.removeEventListener("keydown", esc2, true); };
  const esc2 = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener("keydown", esc2, true);
  scrim.addEventListener("pointerdown", (e) => { if (e.target === scrim) close(); });
  scrim.querySelector(".hlm-x").onclick = close;
  overlay.appendChild(scrim);
  try { scrim.querySelector(".hlm-x").focus(); } catch {}
}

// mountManifesto(overlay) — the ONE call the greeter makes: the top-left door + the bottom-centre wordmark.
export function mountManifesto(overlay) {
  if (!overlay || overlay.querySelector(".hl-manifesto")) return;
  injectCss();
  const link = document.createElement("button");
  link.type = "button"; link.className = "hl-manifesto"; link.textContent = "Manifesto";
  link.onclick = () => openManifesto(overlay);
  const brand = document.createElement("div");
  brand.className = "hl-brand"; brand.setAttribute("aria-label", "Hologram");
  brand.innerHTML = `${MARK}<b>HOLOGRAM</b>`;
  overlay.appendChild(link);
  overlay.appendChild(brand);
}
export default mountManifesto;
