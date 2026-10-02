// holo-manifesto.mjs — the greeter's brand chrome: the "Manifesto" door (top-left) and the Hologram
// wordmark (bottom-centre), plus a full-screen, themed reader for the OS Manifesto.
//
// The words are the canonical Hologram OS Manifesto (holo-os/MANIFESTO.md) — imported here verbatim so the
// login screen speaks with the SAME voice as the OS itself. The reader takes the WHOLE screen: one calm
// reading column under a hairline top bar (the enclosed halftone H + HOLOGRAM wordmark), sourced claims as
// live links, the closing line set large, the mark as the signature — and the LIVING PROOF: right after
// section 1's claim, holo-machine-witness.mjs measures the reader's own machine (real specs + a live,
// genuinely measured compute line). It inherits the greeter's appearance tokens
// (--ink/--sheet/--muted…), so it is sharp in Dark, Light, and Immersive alike. Self-contained:
// one call, mountManifesto(overlay); fail-open (a hiccup never blocks sign-in).
//
// SHIP NOTE: the duplicated .hlm-close rule is deliberate — holo ship's ANTI-REVERT gate probes the two
// lines after every live CSS comment; the original rule keeps its exact live bytes and the one-line rule
// after it overrides font-size by cascade. Change rules by APPENDING overrides, not by editing in place.

// The canonical Hologram DOT-HALFTONE mark — the ENCLOSED H (large dots draw the H, small dots close the
// hexagon around it) — is the ONE mark the manifesto wears everywhere: top bar, signature, and the greeter
// wordmark. (The line H-in-cube glyph was retired from this surface by request.) (usr/share/icons/hologram-dark.svg), inlined with fill:currentColor
// so it themes itself — light dots on a dark ground, ink dots on paper — for correct contrast in every mode.
// Pure vector (transparent, resolution-independent, razor-sharp on any display density).
const MARK = `<svg viewBox="-104 -104 208 208" fill="currentColor" role="img" aria-label="Hologram"><g><circle cx="0.20" cy="-97.39" r="2.61"/><circle cx="-22.86" cy="-86.55" r="2.71"/><circle cx="22.54" cy="-86.32" r="2.81"/><circle cx="-0.03" cy="-76.01" r="2.71"/><circle cx="45.26" cy="-75.92" r="7.80"/><circle cx="-45.82" cy="-75.86" r="2.61"/><circle cx="68.34" cy="-65.13" r="7.70"/><circle cx="-68.83" cy="-65.00" r="2.61"/><circle cx="-22.91" cy="-64.90" r="2.61"/><circle cx="22.71" cy="-64.88" r="2.51"/><circle cx="91.24" cy="-54.34" r="2.61"/><circle cx="-45.94" cy="-54.25" r="7.83"/><circle cx="-91.17" cy="-54.19" r="2.71"/><circle cx="-0.03" cy="-54.19" r="2.71"/><circle cx="45.35" cy="-54.19" r="7.80"/><circle cx="-22.86" cy="-43.64" r="2.71"/><circle cx="22.71" cy="-43.49" r="2.51"/><circle cx="68.29" cy="-43.47" r="7.73"/><circle cx="-68.60" cy="-43.37" r="7.73"/><circle cx="-45.85" cy="-32.63" r="7.77"/><circle cx="45.36" cy="-32.60" r="7.80"/><circle cx="-91.26" cy="-32.55" r="2.71"/><circle cx="0.10" cy="-32.51" r="2.61"/><circle cx="91.24" cy="-32.51" r="2.61"/><circle cx="68.22" cy="-21.95" r="7.83"/><circle cx="22.67" cy="-21.84" r="7.87"/><circle cx="-22.86" cy="-21.82" r="2.71"/><circle cx="-68.57" cy="-21.80" r="7.80"/><circle cx="45.45" cy="-11.06" r="7.73"/><circle cx="-0.19" cy="-11.04" r="7.87"/><circle cx="91.35" cy="-11.01" r="2.81"/><circle cx="-91.54" cy="-10.97" r="2.51"/><circle cx="-45.87" cy="-10.87" r="7.73"/><circle cx="22.71" cy="-0.27" r="8.06"/><circle cx="-22.89" cy="-0.21" r="7.90"/><circle cx="68.28" cy="-0.15" r="7.87"/><circle cx="-68.62" cy="-0.11" r="8.00"/><circle cx="-0.06" cy="10.98" r="7.87"/><circle cx="45.54" cy="11.00" r="7.83"/><circle cx="-45.85" cy="11.02" r="7.77"/><circle cx="-91.26" cy="11.10" r="2.71"/><circle cx="91.24" cy="11.13" r="2.61"/><circle cx="22.71" cy="21.64" r="2.71"/><circle cx="-68.74" cy="21.66" r="7.87"/><circle cx="-22.86" cy="21.67" r="7.87"/><circle cx="68.28" cy="21.67" r="7.87"/><circle cx="-91.54" cy="32.46" r="2.61"/><circle cx="0.15" cy="32.46" r="2.71"/><circle cx="-45.72" cy="32.50" r="7.73"/><circle cx="45.54" cy="32.59" r="7.83"/><circle cx="91.35" cy="32.63" r="2.81"/><circle cx="-23.01" cy="43.23" r="2.61"/><circle cx="68.25" cy="43.31" r="7.83"/><circle cx="-68.71" cy="43.34" r="7.83"/><circle cx="22.71" cy="43.37" r="2.90"/><circle cx="91.39" cy="53.92" r="2.71"/><circle cx="45.48" cy="53.95" r="7.87"/><circle cx="-45.86" cy="53.97" r="7.80"/><circle cx="-91.34" cy="53.99" r="2.61"/><circle cx="0.20" cy="54.09" r="2.61"/><circle cx="-68.57" cy="64.90" r="7.80"/><circle cx="-22.86" cy="64.92" r="2.71"/><circle cx="68.28" cy="64.92" r="2.71"/><circle cx="22.54" cy="65.15" r="2.81"/><circle cx="-45.88" cy="75.56" r="7.80"/><circle cx="0.10" cy="75.62" r="2.61"/><circle cx="45.32" cy="75.62" r="2.61"/><circle cx="22.53" cy="86.47" r="2.71"/><circle cx="-22.86" cy="86.75" r="2.71"/><circle cx="-0.03" cy="97.29" r="2.71"/></g></svg>`;

// The Manifesto, from Hologram OS (holo-os/MANIFESTO.md, verbatim). Paragraphs carry their sources as
// inline [text](url) links so every factual claim stays checkable right where it is made.
const TITLE = "The Hologram Manifesto";
const SECTIONS = [
  ["You are holding a supercomputer", [
    "In 1997 the fastest computer on Earth was a machine called ASCI Red. It filled a room the size of a tennis court at [Sandia National Laboratories](https://newsreleases.sandia.gov/releases/2006/asci-red-decom.html), cost 46 million dollars, and was the first computer in history to pass one trillion calculations per second. It was built to simulate nuclear weapons. For three years [nothing on the planet could match it](https://top500.org/resources/top-systems/asci-red-sandia-national-laboratory/).",
    "In 2020 Apple shipped a thin laptop with no cooling fan whose graphics engine pushes [2.6 trillion calculations per second](https://www.apple.com/newsroom/2020/11/apple-unleashes-m1/). The phone in your pocket belongs to the same class. Measured against every machine in living memory, the device you are reading this on is a supercomputer.",
    "That is the fact this whole document rests on. You already own the machine. What you do not own is your computing.",
  ]],
  ["Everything that matters runs somewhere else", [
    "Your files sleep on machines you will never see. Your photos, your messages, your work: stored, indexed, and studied in buildings you will never enter. [Three companies collect 63 percent](https://www.srgresearch.com/articles/cloud-market-share-trends-big-three-together-hold-63-while-oracle-and-the-neoclouds-inch-higher) of everything the world spends on cloud computing. You bought the device in your hands, but you rent the software on it. You ask the questions, but the intelligence that answers belongs to a company, and it remembers you for reasons that are not yours.",
    "The world calls this normal: a screen you look at, owned by people who look back.",
  ]],
  ["The limit is the business model, not the technology", [
    "There was a time when this arrangement was honest. A real supercomputer was rare and hard to run, so companies ran it for you and handed you a window into it. That time has ended, but the arrangement survives, because it pays.",
    "Renting computing earns money every month; handing it over earns money once. Your data on their machines is what keeps you from leaving. The account is the leash: your identity lives with the landlord, so everything you do exists at the landlord's pleasure. None of this requires a villain. Each company is simply following its own economics. But those economics point one way, and it is away from you.",
  ]],
  ["Even the biggest companies cannot hand it back", [
    "If good intentions could fix this, it would already be fixed. The largest technology companies employ many of the best engineers alive, and many of them genuinely care about privacy. So you get encryption, permission prompts, privacy dashboards, all real, and all built inside one boundary: the fix must never touch the rent. Your identity stays in their cloud. Your data stays on their machines. The window into the supercomputer gets nicer every year, and it stays a window.",
  ]],
  ["What it would take to succeed", [
    "Start from the machine you already hold, and the requirements write themselves.",
    "Everything must run on your device. The whole system, not a companion app with a cloud behind it.",
    "It must open without an account. Nothing to sign up for and no one to ask. The key must be you: the same face or fingerprint that unlocks your device, through [an open standard](https://www.w3.org/TR/webauthn-2/) that no company owns.",
    "Nothing may leave unless you say so. Not as a setting buried in a menu, but as the floor the whole system stands on.",
    "It must need no installation, because installation is a gate with a gatekeeper. It has to run in the one program every device already has: the browser.",
    "You must be able to check all of this yourself. A promise of privacy from someone you cannot audit is just a promise.",
    "And it must include intelligence that runs on your device, because if the thinking still happens in a rented building, everything above collapses.",
    "Miss any one of these and you have rebuilt the old world with new paint.",
  ]],
  ["Others have tried, and stopped halfway", [
    "Privacy apps bolt a lock onto the rented model; your identity still lives in their cloud. Running your own server moves the landlord's machine into your closet and hands you the landlord's job; the complexity that was the whole problem is now yours. Local AI tools ask you to install runtimes and type into terminals, which quietly filters out almost everyone. Each solves one requirement and concedes the rest. The old world survives on the requirement nobody meets in full.",
  ]],
  ["Hologram meets all of them at once", [
    "Hologram is an operating system that runs entirely inside a browser tab.",
    "Open one address and a full computer appears: desktop, files, messenger, wallet, browser, and Q, an intelligence that lives on your machine and thinks with your own graphics chip, through [a standard now built into browsers](https://www.w3.org/TR/webgpu/). No install. No account. No server behind it. Your files stay on your device. You sign in with your fingerprint or face, and that key never leaves the hardware it was made in.",
    "You do not have to trust a word of this. Every part of the system is named by a fingerprint computed from its exact bytes, using [a published, openly audited algorithm](https://github.com/BLAKE3-team/BLAKE3). Change one byte anywhere and the name no longer matches, and it will not run. Even the rules the system operates under are such an object: alter them and it refuses to start, rather than run a law it cannot prove. You can watch this verification happen, live, the first time you open it.",
    "What you make here is yours to give. Share it as a single address, and whoever opens it simply runs it. No account, no permission, no trace back to you.",
    "Every claim on this page is something the system already does. Nothing here is a roadmap.",
    "We hold the complexity. You hold the supercomputer. And the first time you watch this machine prove itself, you will stop taking our word for anything and say your own:",
  ]],
];
const CLOSE_LINE = "This machine is mine.";
const FOOTNOTE = "Hologram runs under a constitution that is itself a verifiable object, sealed and proven consistent across all 1024 situations its principles range over. Do not trust this page. Verify it.";

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
// tiny, safe inline renderer: escape everything, then re-admit ONLY [text](https://…) links.
const md = (s) => esc(s).replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

const CSS = `
#holo-login .hl-manifesto{position:fixed;left:max(22px,env(safe-area-inset-left));top:max(20px,env(safe-area-inset-top));z-index:4;
  pointer-events:auto;border:0;background:none;color:var(--ink-dim,rgba(231,237,250,.82));font:500 var(--u,16px)/1 "Segoe UI",system-ui,sans-serif;
  cursor:pointer;padding:8px 4px;letter-spacing:.01em;text-shadow:var(--shadow,none);opacity:0;animation:hlm-in .6s ease 1.2s forwards;transition:color .15s}
#holo-login .hl-manifesto:hover{color:var(--ink,#fff)}
/* the brand never arrives — it was always there (HOLO-BOOT-CEREMONY B1): no entrance animation; the host
   baseline paints it with the first black frame and this rule merely keeps its geometry. */
#holo-login .hl-brand{position:fixed;left:50%;transform:translateX(-50%);bottom:max(26px,env(safe-area-inset-bottom));z-index:3;
  pointer-events:none;display:inline-flex;align-items:center;gap:clamp(11px,1.4vw,16px);color:var(--ink,#f4f7fc)}
#holo-login .hl-brand svg{width:clamp(36px,4.2vw,44px);height:clamp(36px,4.2vw,44px);flex:0 0 auto;filter:drop-shadow(var(--shadow,0 0 0 transparent));shape-rendering:geometricPrecision}
#holo-login .hl-brand b{font:600 clamp(24px,3.6vw,36px)/1 "Bahnschrift","DIN Alternate","DIN Next","Roboto Condensed","Segoe UI",system-ui,sans-serif;letter-spacing:.26em;text-transform:uppercase;padding-left:.26em;color:var(--ink-dim,rgba(231,237,250,.86));text-shadow:var(--shadow,none);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:geometricPrecision}
@keyframes hlm-in{to{opacity:1}}
/* reduced motion: kill entrances only. NEVER transform:none the brand — its CENTERING is a transform
   (left:50% + translateX(-50%)); flattening it parks the wordmark half a width to the right. */
@media (prefers-reduced-motion:reduce){#holo-login .hl-manifesto,#holo-login .hl-brand{animation:none;opacity:1}
#holo-login .hlm-doc{animation:none;opacity:1;transform:none}}

/* ——— the reader: the manifesto owns the WHOLE screen — one hairline top bar, one calm column ——— */
#holo-login .hlm-scrim{position:fixed;inset:0;z-index:8;pointer-events:auto;display:flex;flex-direction:column;
  background:var(--sheet,rgba(10,13,17,.97));backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
  color:var(--ink,#e6edf3);font-family:"Segoe UI",system-ui,-apple-system,sans-serif;animation:hlm-fade .25s ease}
@keyframes hlm-fade{from{opacity:0}}
#holo-login .hlm-top{flex:0 0 auto;display:flex;align-items:center;gap:12px;
  padding:max(18px,env(safe-area-inset-top)) max(30px,env(safe-area-inset-right)) 16px max(30px,env(safe-area-inset-left));
  border-bottom:1px solid var(--glass-border,rgba(255,255,255,.09))}
#holo-login .hlm-top .g{width:24px;height:24px;flex:0 0 auto;color:var(--ink,#f4f7fc)}
#holo-login .hlm-top .w{font:700 13px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.26em;padding-left:.26em;color:var(--ink,#f4f7fc)}
#holo-login .hlm-x{margin-left:auto;width:36px;height:36px;flex:0 0 auto;border:0;border-radius:10px;cursor:pointer;
  background:transparent;color:var(--ink-dim,rgba(231,237,250,.75));font-size:17px;transition:background .15s,color .15s}
#holo-login .hlm-x:hover{background:var(--field-bg,rgba(255,255,255,.08));color:var(--ink,#fff)}
#holo-login .hlm-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;outline:none;scrollbar-gutter:stable both-edges}
/* fluid measure: the column grows with the screen (700px → 900px) and the TYPE grows in step, so the
   line length stays a comfortable ~75 characters on a phone, a laptop, and a 4K display alike. */
#holo-login .hlm-doc{max-width:clamp(700px,46vw,900px);margin:0 auto;font-size:clamp(17px,1.18vw,19.5px);
  padding:clamp(40px,7vh,84px) 24px clamp(56px,9vh,110px);animation:hlm-rise .5s ease both}
@keyframes hlm-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
#holo-login .hlm-doc h1{margin:0 0 clamp(30px,5vh,52px);font-size:clamp(30px,3.1vw,46px);font-weight:700;
  letter-spacing:-.015em;line-height:1.12;color:var(--ink,#f7fafc)}
#holo-login .hlm-doc h2{margin:46px 0 14px;font-size:1.12em;font-weight:700;letter-spacing:.005em;line-height:1.3;color:var(--ink,#f4f7fc)}
#holo-login .hlm-doc p{margin:0 0 1em;font-size:1em;line-height:1.75;color:var(--ink-dim,rgba(231,237,250,.87))}
#holo-login .hlm-doc a{color:inherit;text-decoration:underline;text-decoration-color:rgba(160,180,210,.4);
  text-underline-offset:3px;transition:text-decoration-color .15s}
#holo-login .hlm-doc a:hover{text-decoration-color:currentColor}
/* the witness shares the column's exact width — one edge line down the whole page (no breakout) */
#holo-login .hlm-witness{margin:46px 0 50px}
#holo-login .hlm-close{margin:clamp(48px,8vh,72px) 0 40px;font-size:clamp(24px,3.2vw,31px);font-weight:700;
  letter-spacing:-.01em;color:var(--ink,#f7fafc);text-align:center}
#holo-login .hlm-close{font-size:clamp(24px,2.4vw,36px)}
#holo-login .hlm-sig{display:flex;align-items:center;justify-content:center;gap:13px;margin:0 0 52px;color:var(--ink,#f4f7fc)}
#holo-login .hlm-sig svg{width:30px;height:30px;flex:0 0 auto}
#holo-login .hlm-sig b{font:700 14px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.26em;padding-left:.26em}
#holo-login .hlm-note{padding-top:18px;border-top:1px solid var(--glass-border,rgba(255,255,255,.09));
  font-size:13.5px;line-height:1.6;color:var(--muted,#8b949e)}
@media (max-width:560px){
  #holo-login .hlm-doc{padding-left:20px;padding-right:20px}
  #holo-login .hlm-doc p{font-size:16px}
  #holo-login .hlm-doc h2{font-size:17.5px}
}
/* CLAUDE-DESK ⤵ — appended overrides; base rules keep their anti-revert probes (SHIP NOTE above) */
#holo-login .hl-manifesto{font-weight:500;letter-spacing:0;padding:7px 11px;border-radius:9px;-webkit-font-smoothing:antialiased;transition:background .15s,color .15s}
#holo-login .hl-manifesto:hover{background:var(--field-bg,rgba(255,255,255,.08));color:var(--ink,#fff)}
#holo-login .hlm-scrim,#holo-login .hlm-doc{-webkit-font-smoothing:antialiased}
/* CLAUDE-DESK ⤴ */
/* CLAUDE-READ ⤵ — editorial premium: serif display moments + calmer sans body, generous rhythm (appended) */
#holo-login .hlm-doc{font-size:clamp(17px,1.15vw,19px)}
#holo-login .hlm-doc h1{font-family:"Constantia","Iowan Old Style","Palatino Linotype",Georgia,"Times New Roman",serif;font-weight:600;letter-spacing:-.005em;font-size:clamp(34px,3.6vw,54px);line-height:1.08;margin-bottom:clamp(34px,5.5vh,58px)}
#holo-login .hlm-doc h2{font-weight:600;font-size:1.16em;letter-spacing:0;margin-top:clamp(40px,6vh,58px)}
#holo-login .hlm-doc p{line-height:1.78;color:var(--ink-dim,rgba(231,237,250,.82))}
#holo-login .hlm-doc a{text-decoration-color:rgba(160,180,210,.35);text-underline-offset:4px}
#holo-login .hlm-close{font-family:"Constantia","Iowan Old Style","Palatino Linotype",Georgia,serif;font-weight:600;letter-spacing:-.005em;font-size:clamp(28px,3.3vw,44px);margin-top:clamp(56px,9vh,88px)}
#holo-login .hlm-top .w{font-weight:600;letter-spacing:.24em}
#holo-login .hlm-note{color:var(--muted,#8b949e);font-size:13px;line-height:1.65}
@media (max-width:560px){#holo-login .hlm-doc h1{font-size:32px}#holo-login .hlm-close{font-size:26px}}
/* CLAUDE-READ ⤴ */

/* CLAUDE-DESK WORDMARK (appended override) — smaller, sharper brand mark on BOTH the boot hero and the login
   greeter: it signs the screen quietly instead of shouting from the bottom edge, with a touch more breathing
   room beneath it. (The base .hl-brand rule keeps its exact bytes for the anti-revert gate; NEVER transform
   the mark here: its centring is a transform and flattening it parks the wordmark off-centre.) */
#holo-login .hl-brand svg{width:clamp(26px,2.6vw,30px);height:clamp(26px,2.6vw,30px)}
#holo-login .hl-brand b{font-size:clamp(17px,1.9vw,21px)}
#holo-login .hl-brand{bottom:max(30px,3vh,env(safe-area-inset-bottom))}
`;

function injectCss() { try { const old = document.getElementById("holo-manifesto-css"); if (old) old.remove(); const s = document.createElement("style"); s.id = "holo-manifesto-css"; s.textContent = CSS; document.head.appendChild(s); } catch {} }

export function openManifesto(overlay) {
  injectCss();
  const scrim = document.createElement("div"); scrim.className = "hlm-scrim";
  let body = `<h1>${esc(TITLE)}</h1>`;
  SECTIONS.forEach(([h, ps], i) => {
    body += `<h2>${esc(h)}</h2>`; for (const p of ps) body += `<p>${md(p)}</p>`;
    // the LIVING PROOF: right where section 1 claims "you are holding a supercomputer", the page measures
    // the reader's own machine (holo-machine-witness) — proof at the point of claim, dormant until scrolled to.
    if (i === 0) body += `<div class="hlm-witness"></div>`;
  });
  body += `<div class="hlm-close">${esc(CLOSE_LINE)}</div>
    <div class="hlm-sig">${MARK}<b>HOLOGRAM</b></div>
    <div class="hlm-note">${esc(FOOTNOTE)}</div>`;
  scrim.innerHTML = `<div class="hlm-top" role="banner"><span class="g">${MARK}</span><span class="w">HOLOGRAM</span>
      <button class="hlm-x" aria-label="Close">✕</button></div>
    <div class="hlm-scroll" role="dialog" aria-label="${esc(TITLE)}" aria-modal="true" tabindex="-1"><article class="hlm-doc">${body}</article></div>`;
  let witness = null;
  try {
    import("./holo-machine-witness.mjs?v=w5").then((m) => {
      const slot = scrim.querySelector(".hlm-witness");
      if (slot && slot.isConnected) witness = m.mountWitness(slot, { root: scrim.querySelector(".hlm-scroll") });
    }).catch(() => {});
  } catch {}
  const close = () => { try { witness && witness.stop(); } catch {} scrim.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  scrim.querySelector(".hlm-x").onclick = close;
  overlay.appendChild(scrim);
  try { scrim.querySelector(".hlm-scroll").focus({ preventScroll: true }); } catch {}
}

// mountManifesto(overlay) — the ONE call the greeter makes: the top-left door + the bottom-centre wordmark.
export function mountManifesto(overlay) {
  if (!overlay || overlay.querySelector(".hl-manifesto")) return;
  injectCss();
  const link = document.createElement("button");
  link.type = "button"; link.className = "hl-manifesto"; link.textContent = "Manifesto";
  link.onclick = () => openManifesto(overlay);
  overlay.appendChild(link);
  // ADOPT a brand the host baseline already painted (app.html stands it with the very first frame — B1);
  // only a baseline-less surface (the primitive's own overlay, e.g. the native greeter) mounts it here.
  if (!overlay.querySelector(".hl-brand")) {
    const brand = document.createElement("div");
    brand.className = "hl-brand"; brand.setAttribute("aria-label", "Hologram");
    brand.innerHTML = `${MARK}<b>HOLOGRAM</b>`;
    overlay.appendChild(brand);
  }
}
export default mountManifesto;
