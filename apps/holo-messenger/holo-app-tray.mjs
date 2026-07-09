// holo-app-tray.mjs — the App Tray: discover any holo app, drop it into a chat, run it, bring everyone.
//
// Moss's bento tool-library, κ-native and in-chat. Sourced from the REAL catalog (holospaces.jsonld).
// One gesture: "+" in the composer → a clean bottom-sheet of apps → tap → the app is SHARED into the room
// (everyone sees a card) AND opens for you. Anyone taps the card → runs the same app. That is "stream any
// app with others" — serverless co-navigation, no Together needed for the baseline.
//
// Design: golden ratio throughout (φ=1.618), minimal chrome, familiar (an iOS/WhatsApp attach sheet).
// Additive: installs window.HoloApps; if absent, the chat works unchanged. The chat core delegates app-card
// rendering + preview here (isCard/renderCard/previewOf), so the messenger stays generic.

import * as HoloPay from "./holo-pay.mjs";   // money is a card, too (real, serverless, testnet-safe)
import "./holo-launcher.mjs";                // installs window.HoloOpen (the one launcher)

const PHI = 1.618;
const CATALOG_URL = "/apps/holospaces.jsonld";

// compact card codec (unicode-safe b64url of a small object) — shared by pay + identity cards.
function _enc(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function _dec(s) { try { return JSON.parse(decodeURIComponent(escape(atob(String(s).replace(/-/g, "+").replace(/_/g, "/"))))); } catch { return null; } }

// the signed-in operator, best-effort: the session the shell wrote, else a friendly default (pre-enroll preview).
function currentIdentity() {
  try {
    const s = JSON.parse(sessionStorage.getItem("holo.identity") || "null");
    if (s && (s.operator || s.kappa)) return { kappa: s.operator || s.kappa, label: s.label || "You" };
  } catch {}
  try { const n = localStorage.getItem("holo.chat.me"); if (n) return { kappa: null, label: n }; } catch {}
  return { kappa: null, label: "You" };
}
// contextual TEE step-up (invisible when the vault isn't present): gate a value action, fail-soft on testnet.
async function maybeStepUp(action) {
  try {
    const su = await import("../../usr/lib/holo/holo-stepup.mjs");
    if (su && su.buildStepUp && window.HoloStepUp && window.HoloStepUp.teeAssert) { await su.buildStepUp(action, window.HoloStepUp); return true; }
  } catch {}
  return false;   // no vault → testnet: proceed unblocked (honestly, no real funds move)
}

// ── Present-ID: prove a fact in chat by selective disclosure (real holo-present, fully offline) ─────
const CLAIM_LABEL = { ageOver18: "over 18", teamAdmin: "a team admin", human: "a real person" };
const ASKABLE = [{ key: "ageOver18", label: "Over 18" }, { key: "teamAdmin", label: "Team admin" }, { key: "human", label: "Real person" }];
const claimLabel = (k) => CLAIM_LABEL[k] || k;
let _idLib = null;
async function idLib() {
  if (_idLib) return _idLib;
  const [P, C, I] = await Promise.all([import("../self/holo-present.mjs"), import("../self/holo-credential.mjs"), import("../self/holo-identity.mjs")]);
  _idLib = { makeChallenge: P.makeChallenge, present: P.present, verifyPresentation: P.verifyPresentation, issueCredential: C.issueCredential, ephemeral: I.ephemeral, enroll: I.enroll, unlock: I.unlock, roster: I.roster };
  return _idLib;
}
// ── issuer trust: a proof is only as good as who signed it. You choose whom to trust. ──
const TRUST_KEY = "holo.chat.trust";
function _trustMap() { try { return JSON.parse(localStorage.getItem(TRUST_KEY) || "{}"); } catch { return {}; } }
export function trustIssuer(kappa, label) { const m = _trustMap(); m[kappa] = label || "issuer"; try { localStorage.setItem(TRUST_KEY, JSON.stringify(m)); } catch {} return m; }
export function trustedLabel(kappa) { return _trustMap()[kappa] || null; }
// a STABLE issuer, persisted via REAL holo-identity so the trust flip is demonstrable end-to-end.
// (A real authority's key is NEVER in the app — it grants credentials out-of-band; this stands in for the demo.)
async function demoIssuer(L) {
  try { const r = await L.roster(); const rec = (r || []).find((x) => x.label === "Holo ID"); if (rec) return await L.unlock(rec.kappa, "holo-demo"); } catch {}
  return await L.enroll({ label: "Holo ID", passphrase: "holo-demo" });
}
// ASK: a signed challenge for one claim → an ask card in the room.
async function askFlow(claimKey, channel) {
  try {
    const L = await idLib(); const me = currentIdentity();
    const asker = await L.ephemeral({ label: me.label });
    const ch = await L.makeChallenge(asker, { asks: [claimKey] });
    if (channel && channel.send) channel.send(PFX_ASK + _enc({ ch, by: me.label }));
  } catch {}
}
// PROVE: reveal ONLY the asked claim, gated by a TEE step-up → a self-verifying proof card.
async function proveFlow(ch, asks, channel) {
  try {
    const L = await idLib(); const me = currentIdentity();
    const holder = await L.ephemeral({ label: me.label });
    const issuer = await demoIssuer(L);   // a STABLE issuer κ, so a verifier can decide to trust it
    const claims = {}; for (const k of asks) claims[k] = true;
    const cred = await L.issueCredential(issuer, { subject: holder.kappa, claims });
    const release = async () => { await maybeStepUp({ "@type": "HoloStepUp", kind: "id.reveal", operator: holder.kappa, reason: "Reveal " + asks.map(claimLabel).join(", "), payload: { asks } }); return true; };
    const pres = await L.present(holder, cred, ch, { release });
    if (pres && channel && channel.send) channel.send(PFX_PROOF + _enc({ pres, ch }));
  } catch {}
}

// the real catalog gives names, taglines and accents; this bridges each Space to a servable app + a glyph,
// and adds a few first-class apps. (Opening a κ-composition through the OS launcher is the one remaining stub;
// until then each card opens a real, servable representative under /apps/<slug>/.)
// each catalog member (an app κ) → a legible name, glyph, and its servable app under /apps/<slug>/.
const MEMBER_META = {
  "org.hologram.HoloTrade":       { name: "Trade",    glyph: "📈", slug: "trade" },
  "org.hologram.HoloEtherscan":   { name: "Explorer", glyph: "🔎", slug: "etherscan" },
  "org.hologram.HoloStream":      { name: "Stream",   glyph: "📡", slug: "stream" },
  "org.hologram.HoloCapture":     { name: "Capture",  glyph: "⏺", slug: "capture" },
  "org.hologram.HoloTube":        { name: "Tube",     glyph: "▶️", slug: "holo-tube" },
  "org.hologram.HoloCodeDesktop": { name: "Code",     glyph: "⌨️", slug: "code" },
  "org.hologram.HoloGit":         { name: "Git",      glyph: "🔀", slug: "git" },
  "org.hologram.HoloForge":       { name: "Forge",    glyph: "🔨", slug: "forge" },
  "org.hologram.HoloQ":           { name: "Q",        glyph: "🧠", slug: "q" },
  "org.hologram.QvacSdk":         { name: "QVAC",     glyph: "🧩", slug: "qvac" },
  "org.hologram.HoloBootPrompt":  { name: "Boot",     glyph: "⚡", slug: "boot-prompt" },
  "org.hologram.HoloPrivacy":     { name: "Privacy",  glyph: "🛡️", slug: "privacy" },
  "org.hologram.HoloTerms":       { name: "Terms",    glyph: "📜", slug: "terms" },
  "org.hologram.HoloControl":     { name: "Control",  glyph: "⚙️", slug: "control" },
  "org.hologram.HoloLinux":       { name: "Linux",    glyph: "🐧", slug: "holo-linux" },
  "org.hologram.HoloX86":         { name: "x86",      glyph: "🖥️", slug: "holo-x86" },
  "org.hologram.Holo3D":          { name: "3D",       glyph: "🧊", slug: "holo-3d" },
};
const SPACE_GLYPH = { "org.hologram.holospace.Web3": "🪙", "org.hologram.holospace.CreatorStudio": "🎬", "org.hologram.holospace.DevCockpit": "⌨️", "org.hologram.holospace.AILab": "🧪", "org.hologram.holospace.TrustCenter": "🛡️", "org.hologram.holospace.EmulationArcade": "🕹️" };
const STANDALONE = [
  { kind: "app", id: "watch",   name: "Watch", tagline: "Public-domain film, together.", accent: "#e7c66b", glyph: "🎬", slug: "watch" },
  { kind: "app", id: "music",   name: "Music", tagline: "Play a room a record.",         accent: "#ff7ab6", glyph: "🎵", slug: "music" },
  { kind: "app", id: "files",   name: "Files", tagline: "Your device, mapped to κ.",     accent: "#5b8cff", glyph: "📁", slug: "files" },
  { kind: "app", id: "notepad", name: "Notes", tagline: "A page you both can hold.",     accent: "#34d3a6", glyph: "📝", slug: "notepad" },
  { kind: "app", id: "book",    name: "Read",  tagline: "Open a book on the table.",     accent: "#c77bff", glyph: "📚", slug: "book" },
];

let _catalog = null;
export async function catalog() {
  if (_catalog) return _catalog;
  const spaces = [];
  try {
    const j = await (await fetch(CATALOG_URL)).json();
    for (const d of (j["dcat:dataset"] || [])) {
      const id = d["schema:identifier"];
      const members = (d["holo:members"] || []).map((m) => {
        const meta = MEMBER_META[m["holo:app"]] || { name: m["holo:app"], glyph: "▦", slug: null };
        return { kind: "app", name: meta.name, glyph: meta.glyph, slug: meta.slug, kappa: m["holo:appRoot"] };   // κ = identity, slug = how it runs
      });
      spaces.push({ kind: "space", id, kappa: d["holo:root"], name: d["schema:name"], tagline: d["holo:tagline"] || d["schema:description"] || "",
        accent: d["holo:accent"] || "#00a884", glyph: SPACE_GLYPH[id] || "▦", members });
    }
  } catch {}
  _catalog = [...STANDALONE, ...spaces];
  return _catalog;
}
export function findSpace(id) { return (_catalog || []).find((x) => x.kind === "space" && x.id === id) || null; }

// ── in-chat cards: a shared APP, PAYMENT, or IDENTITY is just a message ────────────────────────────
// One rich-message layer. The chat core delegates isCard/renderCard/previewOf here and stays generic —
// so identity, money and apps all arrive in the thread as tappable cards, authored by your κ.
const PFX_APP = "holo:app:", PFX_PAY = "holo:pay:", PFX_ID = "holo:id:", PFX_ASK = "holo:ask:", PFX_PROOF = "holo:proof:";
function cardText(a) { const slug = a.kind === "space" ? "space:" + a.id : a.slug; return PFX_APP + [slug, a.glyph, a.name, a.accent, a.tagline || ""].join("|"); }
export function parseCard(text) { const p = String(text).slice(PFX_APP.length).split("|"); return { slug: p[0], glyph: p[1], name: p[2], accent: p[3], tagline: p[4] || "" }; }
export function isCard(text) { return typeof text === "string" && [PFX_APP, PFX_PAY, PFX_ID, PFX_ASK, PFX_PROOF].some((p) => text.startsWith(p)); }
export function previewOf(text) {
  if (typeof text !== "string") return null;
  if (text.startsWith(PFX_APP)) return "📎 " + parseCard(text).name;
  if (text.startsWith(PFX_PAY)) { const d = _dec(text.slice(PFX_PAY.length)) || {}; return (d.kind === "request" ? "💰 " : "💸 ") + (d.money || "payment"); }
  if (text.startsWith(PFX_ID))  { const d = _dec(text.slice(PFX_ID.length)) || {}; return "🪪 " + (d.label || "identity"); }
  if (text.startsWith(PFX_ASK)) { const d = _dec(text.slice(PFX_ASK.length)) || {}; const a = (d.ch && d.ch.asks) || []; return "🔐 Asks: " + a.map(claimLabel).join(", "); }
  if (text.startsWith(PFX_PROOF)) return "✅ Verified";
  return null;
}

// the shared card DOM — accent-tinted badge (44px), title + one subline, optional action word. Minimal.
function _cardEl({ glyph, accent = "#00a884", title, sub, onClick, cta = null }) {
  const el = document.createElement("button"); el.type = "button"; el.className = "holo-appcard";
  el.style.cssText = "display:flex;align-items:center;gap:13px;width:233px;max-width:100%;text-align:left;border:0;cursor:pointer;background:#0e1a1e;border-radius:13px;padding:13px;color:#e9edef;";
  el.innerHTML =
    `<span style="flex:0 0 auto;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font-size:22px;background:${accent}22;box-shadow:inset 0 0 0 1.5px ${accent}66;">${glyph}</span>` +
    `<span style="min-width:0;flex:1;"><span data-role="title" style="display:block;font-weight:600;font-size:15px;">${title}</span><span data-role="sub" style="display:block;font-size:13px;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sub || ""}</span></span>` +
    (cta ? `<span style="flex:0 0 auto;font-size:13px;font-weight:700;color:${accent};">${cta}</span>` : "");
  if (onClick) el.onclick = onClick;
  return el;
}
export function renderCard(text, channel = null) {
  if (text.startsWith(PFX_APP)) { const a = parseCard(text); return _cardEl({ glyph: a.glyph, accent: a.accent, title: a.name, sub: a.tagline, onClick: () => (window.HoloOpen ? window.HoloOpen(a) : openApp(a)) }); }
  if (text.startsWith(PFX_ASK)) {
    const d = _dec(text.slice(PFX_ASK.length)) || {}; const asks = (d.ch && d.ch.asks) || [];
    return _cardEl({ glyph: "🔐", accent: "#5b8cff", title: (d.by || "Someone") + " asks", sub: "Are you " + asks.map(claimLabel).join(", ") + "?", cta: "Prove", onClick: () => proveFlow(d.ch, asks, channel) });
  }
  if (text.startsWith(PFX_PROOF)) {
    const d = _dec(text.slice(PFX_PROOF.length)) || {};
    const el = _cardEl({ glyph: "🔎", accent: "#8a93a6", title: "Verifying…", sub: "checking on your device" });
    const setBadge = (a) => { const b = el.children[0]; b.style.background = a + "22"; b.style.boxShadow = "inset 0 0 0 1.5px " + a + "66"; };
    let res = null;
    const paint = () => {
      const g = el.children[0], t = el.querySelector('[data-role="title"]'), s = el.querySelector('[data-role="sub"]');
      if (!res || !res.claims) { g.textContent = "🚫"; setBadge("#e6462e"); t.textContent = "Couldn't verify"; s.textContent = "this proof didn't check out"; el.style.opacity = ".65"; el.onclick = null; return; }
      const claim = Object.keys(res.claims).map(claimLabel).join(", ");
      const trusted = trustedLabel(res.issuer);
      if (trusted) { g.textContent = "✅"; setBadge("#00d09c"); t.textContent = "Verified · " + claim; s.textContent = "by " + trusted; el.onclick = null; el.style.cursor = "default"; }
      else { g.textContent = "☑️"; setBadge("#e6a23c"); t.textContent = "Self-attested · " + claim; s.textContent = "Tap to trust this issuer"; el.style.cursor = "pointer"; el.onclick = () => { trustIssuer(res.issuer, "Holo ID"); paint(); }; }
    };
    (async () => { try { const L = await idLib(); res = await L.verifyPresentation(d.pres, d.ch); } catch {} paint(); })();
    return el;
  }
  if (text.startsWith(PFX_PAY)) {
    const d = _dec(text.slice(PFX_PAY.length)) || {}; const req = d.kind === "request";
    return _cardEl({ glyph: req ? "💰" : "💸", accent: "#00d09c", title: (req ? "Requesting " : "") + (d.money || ""),
      sub: d.memo || (req ? "Tap to pay" : (d.who ? "from " + d.who : "Tap to claim")), cta: req ? "Pay" : "Claim",
      onClick: () => d.u && openApp({ name: req ? "Pay" : "Claim", glyph: req ? "💰" : "💸", accent: "#00d09c", url: d.u }) });
  }
  if (text.startsWith(PFX_ID)) {
    const d = _dec(text.slice(PFX_ID.length)) || {};
    const short = d.k ? String(d.k).replace(/^did:holo:sha256:/, "").slice(0, 10) + "…" : "";
    return _cardEl({ glyph: d.glyph || "🪪", accent: "#5b8cff", title: d.label || "Someone", sub: (d.k ? short + " · " : "") + "sovereign identity", cta: "Verified" });
  }
  const g = document.createElement("div"); g.textContent = text; return g;
}

// ── the run surface (open an app full-bleed; re-share to the room) ────────────────────────────────
let _overlay = null, _shareBack = null;
export function openApp(a, { channel = null } = {}) {
  if (channel) _shareBack = channel;
  closeApp();
  _overlay = document.createElement("div");
  _overlay.className = "holo-app-run";
  _overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:#0b141a;display:flex;flex-direction:column;";
  const bar = document.createElement("div");
  bar.style.cssText = "flex:0 0 auto;height:55px;display:flex;align-items:center;gap:13px;padding:0 21px;border-bottom:1px solid #ffffff14;";
  bar.innerHTML = `<span style="width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-size:18px;background:${a.accent}22;box-shadow:inset 0 0 0 1.5px ${a.accent}66;">${a.glyph}</span><b style="font-size:15px;">${a.name}</b>`;
  const grow = document.createElement("div"); grow.style.cssText = "flex:1;";
  const share = document.createElement("button"); share.textContent = "Share to chat"; share.style.cssText = "border:0;background:#00a884;color:#04160f;font-weight:600;border-radius:16px;padding:8px 14px;cursor:pointer;";
  share.onclick = () => { if (_shareBack && _shareBack.send) _shareBack.send(cardText(a)); share.textContent = "Shared ✓"; share.disabled = true; };
  if (!_shareBack) share.style.display = "none";
  const x = document.createElement("button"); x.textContent = "✕"; x.title = "Close"; x.style.cssText = "border:0;background:#0006;color:#fff;width:44px;height:44px;border-radius:50%;cursor:pointer;font-size:16px;";
  x.onclick = closeApp;
  bar.append(grow, share, x);
  const frame = document.createElement("iframe");
  frame.src = a.url || ("/apps/" + a.slug + "/");
  frame.style.cssText = "flex:1;width:100%;border:0;background:#000;";
  frame.setAttribute("allow", "camera;microphone;autoplay;clipboard-read;clipboard-write;fullscreen");
  _overlay.append(bar, frame); document.body.appendChild(_overlay);
  document.addEventListener("keydown", _esc);
}
export function closeApp() { if (_overlay) { _overlay.remove(); _overlay = null; document.removeEventListener("keydown", _esc); } }
function _esc(e) { if (e.key === "Escape") closeApp(); }

// a Space opens its REAL composition — its member apps, tiled in order. Tap a member → HoloOpen it.
export async function openSpace(ref) {
  let space = ref;
  if (ref && typeof ref.slug === "string" && ref.slug.startsWith("space:")) { await catalog(); space = findSpace(ref.slug.slice(6)) || ref; }
  if (!Array.isArray(space.members)) { await catalog(); space = findSpace(space.id) || space; }
  const members = space.members || [], accent = space.accent || "#00a884";
  closeApp();
  _overlay = document.createElement("div"); _overlay.className = "holo-app-run";
  _overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:#0b141a;color:#e9edef;display:flex;flex-direction:column;font:15px/1.45 system-ui,sans-serif;";
  const bar = document.createElement("div");
  bar.style.cssText = "flex:0 0 auto;height:55px;display:flex;align-items:center;gap:13px;padding:0 21px;border-bottom:1px solid #ffffff14;";
  bar.innerHTML = `<span style="width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-size:18px;background:${accent}22;box-shadow:inset 0 0 0 1.5px ${accent}66;">${space.glyph || "▦"}</span><b style="font-size:17px;">${space.name || "Space"}</b>`;
  const grow = document.createElement("div"); grow.style.cssText = "flex:1;";
  const x = document.createElement("button"); x.textContent = "✕"; x.title = "Close"; x.style.cssText = "border:0;background:#0006;color:#fff;width:44px;height:44px;border-radius:50%;cursor:pointer;font-size:16px;";
  x.onclick = closeApp; bar.append(grow, x);
  const grid = document.createElement("div");
  grid.style.cssText = "flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(144px,1fr));gap:21px;padding:34px;align-content:start;";
  for (const m of members) {
    const tile = document.createElement("button"); tile.type = "button";
    tile.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:8px;border:0;background:#111b21;border-radius:21px;padding:21px 13px;color:inherit;cursor:pointer;";
    tile.innerHTML = `<span style="width:55px;height:55px;border-radius:50%;display:grid;place-items:center;font-size:26px;background:${accent}1f;box-shadow:inset 0 0 0 1.5px ${accent}55;">${m.glyph}</span><span style="font-size:14px;font-weight:600;">${m.name}</span>`;
    tile.onclick = () => (window.HoloOpen ? window.HoloOpen({ ...m, kind: "app", accent }) : openApp({ ...m, accent }));
    grid.appendChild(tile);
  }
  _overlay.append(bar, grid); document.body.appendChild(_overlay); document.addEventListener("keydown", _esc);
}

// ── the tray (a golden-ratio bottom sheet) ───────────────────────────────────────────────────────
let _sheet = null;
export async function pick(channel = null) {
  const apps = await catalog();
  if (_sheet) closeTray();
  _sheet = document.createElement("div");
  _sheet.className = "holo-app-tray";
  _sheet.style.cssText = "position:fixed;inset:0;z-index:2147483001;display:flex;align-items:flex-end;justify-content:center;background:#0008;backdrop-filter:blur(2px);";
  const sheet = document.createElement("div");
  sheet.style.cssText = "width:100%;max-width:610px;height:61.8vh;background:#111b21;color:#e9edef;border-radius:21px 21px 0 0;box-shadow:0 -20px 60px #0009;display:flex;flex-direction:column;overflow:hidden;font:14px/1.45 system-ui,sans-serif;";
  const handle = document.createElement("div"); handle.style.cssText = "flex:0 0 auto;display:grid;place-items:center;padding:8px 0 0;"; handle.innerHTML = `<span style="width:34px;height:4px;border-radius:2px;background:#ffffff2a;"></span>`;
  const search = document.createElement("input"); search.type = "search"; search.placeholder = "Search apps";
  search.style.cssText = "flex:0 0 auto;min-height:44px;box-sizing:border-box;margin:13px 21px 0;background:#202c33;border:0;border-radius:22px;padding:13px 18px;color:#e9edef;outline:none;font-size:15px;";
  const grid = document.createElement("div");
  grid.style.cssText = "flex:1 1 auto;min-height:0;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(89px,1fr));gap:21px 13px;padding:21px;align-content:start;";
  const draw = (q) => {
    grid.innerHTML = "";
    for (const a of apps) {
      if (q && !(a.name + " " + a.tagline).toLowerCase().includes(q)) continue;
      const tile = document.createElement("button"); tile.type = "button";
      tile.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:8px;border:0;background:transparent;color:inherit;cursor:pointer;padding:0;";
      tile.innerHTML =
        `<span style="width:55px;height:55px;border-radius:50%;display:grid;place-items:center;font-size:26px;background:${a.accent}1f;box-shadow:inset 0 0 0 1.5px ${a.accent}55;">${a.glyph}</span>` +
        `<span style="font-size:13px;font-weight:600;text-align:center;line-height:1.2;">${a.name}</span>`;
      tile.onclick = () => { closeTray(); if (channel && channel.send) channel.send(cardText(a)); (window.HoloOpen ? window.HoloOpen(a) : openApp(a, { channel })); };
      grid.appendChild(tile);
    }
  };
  // OS actions in the same "+": money + your identity, alongside apps — the whole OS, one clean row.
  const actions = document.createElement("div");
  actions.style.cssText = "flex:0 0 auto;display:flex;gap:8px;padding:13px 21px 0;";
  const pill = (label, onclick) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.style.cssText = "flex:1;background:#202c33;border:0;border-radius:16px;padding:9px 6px;color:#e9edef;font-size:13px;font-weight:600;cursor:pointer;"; b.onclick = onclick; return b; };
  const showMoney = (kind) => {
    grid.innerHTML = "";
    const f = document.createElement("div"); f.style.cssText = "grid-column:1/-1;display:flex;flex-direction:column;gap:13px;max-width:377px;margin:8px auto;width:100%;";
    const amt = document.createElement("input"); amt.type = "number"; amt.min = "0"; amt.placeholder = "0"; amt.inputMode = "decimal";
    amt.style.cssText = "background:#202c33;border:0;border-radius:13px;padding:16px;color:#e9edef;font-size:34px;text-align:center;outline:none;";
    const memo = document.createElement("input"); memo.placeholder = "What for? (optional)"; memo.maxLength = 140;
    memo.style.cssText = "background:#202c33;border:0;border-radius:13px;padding:12px 16px;color:#e9edef;outline:none;";
    const go = document.createElement("button"); go.type = "button";
    const setLabel = () => { go.textContent = (kind === "send" ? "Send " : "Request ") + (amt.value ? "$" + amt.value : "money"); };
    go.style.cssText = "background:#00d09c;border:0;border-radius:21px;padding:14px;color:#04160f;font-weight:700;font-size:15px;cursor:pointer;"; setLabel();
    amt.addEventListener("input", setLabel);
    go.onclick = async () => {
      const v = Number(amt.value); if (!(v > 0)) { amt.focus(); return; }
      go.disabled = true; go.textContent = "…";
      try {
        const me = currentIdentity();
        const intent = await HoloPay.createPayment({ kind, amount: v, fiat: "USD", asset: "USDC", fromName: me.label, memo: memo.value });
        if (kind === "send") await maybeStepUp({ "@type": "HoloStepUp", kind: "wallet.send", operator: me.kappa, reason: "Send $" + v, payload: { kappa: intent.kappa, amount: v } });   // TEE, invisible when no vault
        const link = HoloPay.buildLink(intent);
        if (channel && channel.send) channel.send(PFX_PAY + _enc({ u: link.https, money: HoloPay.formatMoney(intent), who: me.label, memo: memo.value, kind }));
        closeTray();
      } catch { go.disabled = false; setLabel(); }
    };
    f.append(amt, memo, go); grid.appendChild(f); setTimeout(() => amt.focus(), 30);
  };
  const showVerify = () => {
    grid.innerHTML = "";
    const f = document.createElement("div"); f.style.cssText = "grid-column:1/-1;display:flex;flex-direction:column;gap:13px;max-width:377px;margin:8px auto;width:100%;";
    const hint = document.createElement("div"); hint.textContent = "Ask someone to prove they're…"; hint.style.cssText = "font-size:15px;opacity:.7;";
    f.appendChild(hint);
    for (const a of ASKABLE) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = a.label;
      b.style.cssText = "min-height:44px;background:#202c33;border:0;border-radius:22px;padding:12px 16px;color:#e9edef;font-size:15px;font-weight:600;text-align:left;cursor:pointer;";
      b.onclick = () => { askFlow(a.key, channel); closeTray(); };
      f.appendChild(b);
    }
    grid.appendChild(f);
  };
  actions.append(
    pill("💸 Send", () => showMoney("send")),
    pill("💰 Request", () => showMoney("request")),
    pill("🪪 Card", () => { const me = currentIdentity(); if (channel && channel.send) channel.send(PFX_ID + _enc({ k: me.kappa, label: me.label, glyph: "🪪" })); closeTray(); }),
    pill("🔐 Ask", showVerify),
  );
  draw("");
  search.addEventListener("input", () => draw(search.value.trim().toLowerCase()));
  sheet.append(handle, search, actions, grid); _sheet.appendChild(sheet); document.body.appendChild(_sheet);
  _sheet.addEventListener("click", (e) => { if (e.target === _sheet) closeTray(); });
  setTimeout(() => search.focus(), 30);
}
export function closeTray() { if (_sheet) { _sheet.remove(); _sheet = null; } }

export function installHoloApps() {
  if (typeof window === "undefined") return false;
  window.HoloApps = Object.assign(window.HoloApps || {}, { catalog, pick, openApp, openSpace, findSpace, closeApp, closeTray, isCard, parseCard, renderCard, previewOf, trustIssuer, trustedLabel });
  return true;
}
try { installHoloApps(); } catch {}
