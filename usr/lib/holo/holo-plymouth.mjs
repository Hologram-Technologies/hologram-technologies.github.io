// holo-plymouth.mjs — Plymouth boot splashes for the Hologram greeter. The real thing, serverless.
//
// Every theme in adi1090x/plymouth-themes (the canonical Linux boot-splash pack, GPL-3.0) is ONE engine:
// a centered sprite cycling progress-0..N-1.png at 25 fps over black — the .script files differ only in
// frame count. So this module IS Plymouth for the web: one tiny player reproduces all 80 themes exactly,
// no interpreter, no daemon, no server.
//
//   • STREAMED, THEN SOVEREIGN — frames stream straight from the theme pack's public CDN (CORS-open) the
//     first time, playing progressively as they arrive; every frame is SEALED into the SAME durable κ
//     store the wallpapers live in (holo-store.js · IDB "holo"/"kappa" · sha256 axis). From then on the
//     boot splash is content-addressed and fully offline — identity is content (Law L2), lost bytes
//     self-heal by re-fetch + re-seal (Law L5).
//   • POWER-ON CHOREOGRAPHY — cold open: pure black + the splash dead-center, exactly like the metal.
//     Then the machine HANDS YOU THE KEYS: the animation glides up and shrinks into a small living
//     emblem above your identity while the black dissolves to your own wallpaper — boot becomes login
//     becomes desktop, one continuous motion. The biometric moment pulses the emblem (Plymouth's
//     password prompt); success flares it out with the glass unfog.
//   • PICKED FROM THE LOGIN SCREEN — a quiet "Boot style" door opens the gallery: frame-0 stills
//     (streamed once, sealed to κ — the gallery itself works offline), the upstream GIF plays on hover,
//     pick → streams → sealed → worn live behind the sheet. Persisted in holo.plymouth.v1; frame-0 is
//     cached as a data URL so the NEXT cold boot paints the splash at literal first frame, zero network.
//
// Fail-open everywhere: no network + no seal → the wallpaper greeter, unchanged. Reduced motion → the
// splash holds frame 0, poses jump instead of glide. Consumed by holo-signin.mjs (attachPlymouth(overlay)).

const KEY = "holo.plymouth.v1";
const FRK = (t) => "holo.plymouth.frames:" + t;     // per-theme sealed-frame manifest (array of κ)
const THK = "holo.plymouth.thumbs";                  // theme → κ of its sealed frame-0 still
const FPS = 25;                                      // the template: 50 Hz refresh / SPEED 2
const RAW = "https://raw.githubusercontent.com/adi1090x/plymouth-themes/master/";
const PREVIEW = "https://raw.githubusercontent.com/adi1090x/files/master/plymouth-themes/previews/";
const DEFAULT_THEME = "circle_hud";
// circle_hud frame-0, embedded so a FIRST-EVER boot paints the emblem with ZERO network (no cold CDN wait) —
// first-time boot then feels as instant as a warm one. Seeded into holo.plymouth.v1 so boot #2 paints it at 0ms.
const DEFAULT_FF = "data:image/png;base64,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";

// ── the catalog: all 80 themes, README order (= preview GIF numbering) — name:pack:frames:~KB ─────────
const CATALOG = (
  "abstract_ring:1:41:3586 abstract_ring_alt:1:76:3752 alienware:1:24:1700 angular:1:30:1049 angular_alt:1:61:1075 " +
  "black_hud:1:164:750 blockchain:1:68:576 circle:1:101:2054 circle_alt:1:48:3492 circle_flow:1:72:886 " +
  "circle_hud:1:156:640 circuit:1:96:3787 colorful:1:375:4555 colorful_loop:1:89:625 colorful_sliced:1:120:4594 " +
  "connect:1:120:2148 cross_hud:1:210:352 cubes:1:81:985 cuts:1:63:130 cuts_alt:1:41:172 " +
  "cyanide:2:24:2116 cybernetic:2:201:2239 dark_planet:2:160:10230 darth_vader:2:115:1160 deus_ex:2:375:3365 " +
  "dna:2:26:600 double:2:40:282 dragon:2:94:3473 flame:2:25:1108 glitch:2:33:1307 " +
  "glowing:2:38:8141 green_blocks:2:125:1645 green_loader:2:40:275 hexagon:2:16:542 hexagon_2:2:100:2000 " +
  "hexagon_alt:2:119:1650 hexagon_dots:2:32:472 hexagon_dots_alt:2:181:1525 hexagon_hud:2:205:780 hexagon_red:2:75:433 " +
  "hexa_retro:3:90:2254 hud:3:20:1000 hud_2:3:40:3009 hud_3:3:125:3256 hud_space:3:119:1660 " +
  "ibm:3:48:441 infinite_seal:3:540:20211 ironman:3:100:18032 liquid:3:19:280 loader:3:105:3180 " +
  "loader_2:3:50:843 loader_alt:3:87:1590 lone:3:64:772 metal_ball:3:100:8300 motion:3:60:1534 " +
  "optimus:3:163:1781 owl:3:151:14817 pie:3:120:847 pixels:3:240:11051 polaroid:3:392:1508 " +
  "red_loader:4:53:474 rings:4:220:2254 rings_2:4:270:6376 rog:4:130:12229 rog_2:4:15:1421 " +
  "seal:4:400:3159 seal_2:4:399:5886 seal_3:4:323:6730 sliced:4:45:2476 sphere:4:36:460 " +
  "spin:4:169:7011 spinner_alt:4:60:939 splash:4:65:469 square:4:45:1144 square_hud:4:173:272 " +
  "target:4:138:3716 target_2:4:90:2889 tech_a:4:166:6053 tech_b:4:192:8918 unrap:4:150:3474"
).split(" ").map((row, i) => {
  const [name, pack, frames, kb] = row.split(":");
  return { name, pack: +pack, frames: +frames, kb: +kb, preview: PREVIEW + (i + 1) + ".gif" };
});
export const PLYMOUTH_THEMES = CATALOG;
const themeOf = (name) => CATALOG.find((t) => t.name === name) || null;
const frameUrl = (t, i) => RAW + "pack_" + t.pack + "/" + t.name + "/progress-" + i + ".png";
const pretty = (n) => n.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ── persisted state — tiny, non-secret, read synchronously by the greeter baseline for 0-ms paint ─────
export function readState() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && typeof s === "object") return s; } catch {}
  return { v: 1, on: true, theme: DEFAULT_THEME };     // first boot: the OS boots like an OS
}
function writeState(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }

// ── the κ store — the SAME durable store the wallpapers seal into (IDB "holo" / "kappa", sha256 axis) ──
let _storeP = null;
function store() {
  if (_storeP) return _storeP;
  _storeP = import("./holo-store.js").then(({ makeStore, idbBackend }) => makeStore({
    axis: "sha256", backend: idbBackend(),
    hash: async (u8) => { const d = await crypto.subtle.digest("SHA-256", u8); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); },
  })).catch(() => {   // store unreachable → same contract in-memory (session-scoped; the splash still plays)
    const m = new Map();
    return { async put(u8) { const d = await crypto.subtle.digest("SHA-256", u8); const k = "sha256:" + [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); m.set(k, u8); return k; }, async get(k) { return m.get(k) || null; } };
  });
  return _storeP;
}
// κ-first bytes: durable store → CDN re-fetch + re-seal (Law L5 self-heal). Returns { bytes, kappa }.
async function kBytes(kappa, url) {
  const st = await store();
  if (kappa) { try { const b = await st.get(kappa); if (b) return { bytes: b, kappa }; } catch {} }
  try {
    const r = await fetch(url, { cache: "force-cache" });
    if (r.ok) { const b = new Uint8Array(await r.arrayBuffer()); let k = kappa; try { k = await st.put(b); } catch {} return { bytes: b, kappa: k }; }
  } catch {}
  return null;
}

// ── SAME-ORIGIN pack (S1): the DEFAULT theme boots from usr/share/plymouth/<theme>/frames.pack — the OS
// animates its own boot from its OWN origin, zero third-party CDN. Format: [u32 count][u32 len×count][png…]
// (little-endian). Fail-open: ANY miss returns null and loadFrames falls back to the κ-store + CDN stream
// (exactly today's path) — so the pack can only make the sovereign case better, never the boot worse.
async function loadPack(theme, onFrame, cancelled) {
  let buf = null;
  try {
    const url = new URL("../../share/plymouth/" + theme + "/frames.pack", import.meta.url);
    const r = await fetch(url, { cache: "force-cache" });
    if (!r.ok) return null;
    buf = new Uint8Array(await r.arrayBuffer());
  } catch { return null; }
  if (!buf || buf.length < 8) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint32(0, true);
  if (!count || count > 4096) return null;                       // sanity — a corrupt header falls open to CDN
  let off = 4; const lens = new Array(count);
  for (let i = 0; i < count; i++) { lens[i] = dv.getUint32(off, true); off += 4; }
  const st = await store();
  const kappas = new Array(count).fill(null);
  let firstBytes = null, p = off, loaded = 0;
  for (let i = 0; i < count; i++) {
    if (cancelled()) return { loaded, total: count };
    const len = lens[i]; if (!len || p + len > buf.length) break;
    const bytes = buf.subarray(p, p + len); p += len;
    if (i === 0) firstBytes = bytes;
    try { kappas[i] = await st.put(bytes); } catch {}           // seal each frame → warm boots are κ-native
    loaded++; onFrame(i, bytes);
  }
  if (loaded < 5) return loaded ? { loaded, total: count } : null;
  try { if (kappas.slice(0, loaded).every(Boolean)) localStorage.setItem(FRK(theme), JSON.stringify(kappas.slice(0, loaded))); } catch {}
  if (firstBytes && firstBytes.length < 80000) {                 // frame-0 → next boot's 0-ms baseline
    try { const fr = new FileReader(); fr.onload = () => { const s = readState(); if (s.theme === theme) { s.firstFrame = fr.result; writeState(s); } }; fr.readAsDataURL(new Blob([firstBytes], { type: "image/png" })); } catch {}
  }
  return { loaded, total: count };
}

// ── frame loading: same-origin pack (default) → κ store (offline) → CDN stream + seal on a miss ────────
// onFrame(i, bytes) fires with raw PNG bytes as frames land — the PLAYER decodes on its own thread
// (worker createImageBitmap, or the 2D floor's Image path); playback starts on the first drawable one.
async function loadFrames(theme, onFrame, cancelled) {
  const t = themeOf(theme); if (!t) throw new Error("unknown theme " + theme);
  let manifest = null; try { manifest = JSON.parse(localStorage.getItem(FRK(theme)) || "null"); } catch {}
  // S1: a first-boot DEFAULT theme (nothing sealed yet) animates from the same-origin pack — no CDN.
  if (theme === DEFAULT_THEME && !manifest) {
    try { const packed = await loadPack(theme, onFrame, cancelled); if (packed && packed.loaded > 4) return packed; } catch {}
    if (cancelled()) return { loaded: 0, total: t.frames };
  }
  const total = (manifest && manifest.length) || t.frames;
  const kappas = new Array(total).fill(null);
  let firstBytes = null, loaded = 0;

  const one = async (i) => {
    if (cancelled()) return;
    const got = await kBytes(manifest && manifest[i], frameUrl(t, i));
    if (!got) return;
    kappas[i] = got.kappa;
    if (i === 0) firstBytes = got.bytes;
    loaded++;
    onFrame(i, got.bytes);
  };
  // ordered small batches so the playable prefix grows monotonically (the loop plays what has landed)
  const CONC = 6;
  for (let base = 0; base < total && !cancelled(); base += CONC) {
    await Promise.all(Array.from({ length: Math.min(CONC, total - base) }, (_, j) => one(base + j)));
  }
  if (cancelled()) return { loaded, total };
  // seal the manifest once whole (or whole-minus-holes: a 404'd tail clamps the loop, not the theme)
  if (loaded > 0 && !manifest) {
    const solid = kappas.slice(0, kappas.indexOf(null) === -1 ? kappas.length : kappas.indexOf(null));
    if (solid.length > 4) { try { localStorage.setItem(FRK(theme), JSON.stringify(solid)); } catch {} }
  }
  // cache frame-0 small → the NEXT cold boot paints the splash synchronously, before any module loads
  if (firstBytes && firstBytes.length < 80000) {
    try {
      const fr = new FileReader();
      fr.onload = () => { const s = readState(); if (s.theme === theme) { s.firstFrame = fr.result; writeState(s); } };
      fr.readAsDataURL(new Blob([firstBytes], { type: "image/png" }));
    } catch {}
  }
  return { loaded, total };
}

// ── styles — self-contained, px-based (immune to host font resets), injected once ─────────────────────
const CSS = `
#holo-login .hlp{position:fixed;inset:0;z-index:0;pointer-events:none;background:#000;opacity:0;transition:opacity .5s ease,background-color 1.1s ease}
#holo-login .hlp.on{opacity:1}
#holo-login .hlp canvas{position:absolute;inset:0;width:100%;height:100%}
/* greet: the black dissolves — your wallpaper IS the login; the splash lives on as your identity emblem */
#holo-login .hlp.greet{background:rgba(0,0,0,0)}
/* while the emblem is alive it REPLACES the avatar circle — the slot keeps its layout, the paint is the animation */
#holo-login.hlp-anchor .hl-avatar{visibility:hidden}
#holo-login .hlp.verify canvas{animation:hlp-pulse 1.4s ease-in-out infinite}
@keyframes hlp-pulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.45)}}
#holo-login .hlp.done{opacity:0;transition:opacity .62s ease}
#holo-login .hlp.done canvas{animation:none;filter:brightness(1.7);transition:filter .5s ease}
#holo-login.hl-boot .hl-panel{opacity:0!important;pointer-events:none!important}
#holo-login .hl-panel{transition:opacity .55s ease}
/* ── BOOT REVEAL SYNC — during the 3s hero ALL login chrome (identity panel · Manifesto label · Hologram
   wordmark · the ⋯ door) is hidden; it fades in TOGETHER the instant the emblem settles into its slot
   (hl-boot removed), instead of each element popping in on its own separate timer. One coordinated reveal. */
#holo-login.hl-boot .hl-manifesto, #holo-login.hl-boot .hl-brand, #holo-login.hl-boot .hlp-btn{opacity:0!important;animation:none!important;transition:opacity .55s ease}
#holo-login:not(.hl-boot) .hl-manifesto, #holo-login:not(.hl-boot) .hl-brand, #holo-login:not(.hl-boot) .hlp-btn{opacity:1!important;animation:none!important;transition:opacity .55s ease .08s}
/* the ⋯ door — the SAME quiet affordance the home screen wears, top-right: everything about how this
   computer looks and wakes lives behind it. One circle, no words. */
#holo-login .hlp-btn{position:fixed;right:max(20px,env(safe-area-inset-right));top:max(18px,env(safe-area-inset-top));z-index:4;
  pointer-events:auto;display:grid;place-items:center;width:44px;height:44px;background:var(--glass,rgba(10,14,20,.42));border:1px solid var(--glass-border,rgba(255,255,255,.14));
  color:var(--glass-ink,rgba(231,237,250,.8));border-radius:50%;cursor:pointer;font-size:var(--u,16px);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:color .15s,border-color .15s,background .15s;opacity:0;animation:hlp-in .6s ease 1.2s forwards}
#holo-login .hlp-btn:hover{color:var(--ink,#fff);border-color:rgba(52,211,166,.55)}
#holo-login .hlp-btn svg{width:20px;height:20px}
@keyframes hlp-in{to{opacity:1}}
#holo-login .hlp-modes{display:flex;gap:4px;margin:0 22px 16px;padding:4px;border-radius:999px;background:var(--field-bg,rgba(255,255,255,.07));border:1px solid var(--field-border,rgba(255,255,255,.12));flex:0 0 auto}
#holo-login .hlp-modes button{flex:1 1 0;min-height:44px;border:0;background:none;color:var(--muted,#9fb3d0);font:500 var(--u,16px)/1 "Segoe UI",system-ui,sans-serif;padding:10px 0;border-radius:999px;cursor:pointer;transition:color .15s,background .15s}
#holo-login .hlp-modes button:hover{color:var(--ink,#fff)}
#holo-login .hlp-modes button.on{background:var(--ink,#f4f7fc);color:var(--wall,#05070c);font-weight:600}
#holo-login .hlp-gal{position:fixed;inset:0;z-index:6;pointer-events:auto;background:var(--glass,rgba(1,4,9,.6));backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);
  display:grid;place-items:center;animation:hlp-fade .22s ease}
@keyframes hlp-fade{from{opacity:0}}
#holo-login .hlp-sheet{width:min(920px,94vw);max-height:84vh;max-height:84dvh;display:flex;flex-direction:column;overflow:hidden;background:var(--sheet,rgba(8,12,18,.94));
  border:1px solid var(--glass-border,rgba(255,255,255,.12));border-radius:16px;box-shadow:0 28px 80px rgba(0,0,0,.6);color:var(--ink,#e6edf3);font-family:"Segoe UI",system-ui,sans-serif}
#holo-login .hlp-head{display:flex;align-items:center;gap:12px;padding:20px 22px 14px;flex:0 0 auto}
#holo-login .hlp-title{font-size:var(--u,16px);font-weight:700}
#holo-login .hlp-x{margin-left:auto;width:34px;height:34px;flex:0 0 auto;border:0;border-radius:50%;background:var(--field-bg,rgba(255,255,255,.08));color:var(--ink,#c9d1d9);cursor:pointer;font-size:var(--u,16px)}
#holo-login .hlp-x:hover{background:var(--field-border,rgba(255,255,255,.16))}
#holo-login .hlp-srch{padding:12px 14px 8px;flex:0 0 auto}
#holo-login .hlp-srch input{width:100%;box-sizing:border-box;background:var(--field-bg,rgba(1,4,9,.6));border:1px solid var(--field-border,rgba(255,255,255,.12));border-radius:999px;padding:11px 18px;color:var(--ink,#e6edf3);font:inherit;font-size:var(--u,16px);outline:none}
#holo-login .hlp-srch input:focus{border-color:#34d3a6}
/* grid-auto-rows is EXPLICIT — Chromium computes a <button> grid item's intrinsic content height as 0,
   so content-sized rows collapse to the border (the "80 empty bars" failure). Fixed rows are immune. */
#holo-login .hlp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));grid-auto-rows:158px;gap:12px;padding:2px 14px 14px;overflow-y:auto;flex:1 1 auto;min-height:0}
#holo-login .hlp-tile{appearance:none;-webkit-appearance:none;display:flex;flex-direction:column;height:186px;box-sizing:border-box;border:1px solid rgba(255,255,255,.1);border-radius:14px;overflow:hidden;cursor:pointer;background:#05070c;text-align:left;padding:0;margin:0;color:inherit;font:inherit;transition:transform .1s,border-color .12s;position:relative}
#holo-login .hlp-tile:hover{transform:translateY(-2px);border-color:#34d3a6}
#holo-login .hlp-tile.sel{border-color:#34d3a6;box-shadow:0 0 0 2px rgba(52,211,166,.45)}
#holo-login .hlp-tile.sel::after{content:"\\2713";position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:50%;background:#34d3a6;color:#06140f;display:grid;place-content:center;font-size:16px;font-weight:700}
#holo-login .hlp-prev{flex:1 1 auto;min-height:0;background:#000;display:grid;place-items:center;overflow:hidden;position:relative}
#holo-login .hlp-prev img{max-width:90%;max-height:90%;object-fit:contain;display:block}
#holo-login .hlp-prev .hlp-shim{position:absolute;inset:0;background:linear-gradient(100deg,#05070c 30%,#101722 50%,#05070c 70%);background-size:220% 100%;animation:hlp-shimmer 1.2s ease-in-out infinite}
@keyframes hlp-shimmer{to{background-position:-220% 0}}
#holo-login .hlp-prev.off{color:#6e7681;font-size:30px}
#holo-login .hlp-name{flex:0 0 auto;padding:11px 14px 12px;background:rgba(5,7,12,.9);font-size:var(--u,16px);font-weight:600;color:#e6edf3;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* ── the grouped list: ONE OS-familiar settings card holding Boot style (expandable) + the account rows ── */
#holo-login .hlp-list{margin:2px 22px 16px;border:1px solid var(--field-border,rgba(255,255,255,.12));border-radius:14px;overflow:hidden;flex:0 0 auto;display:flex;flex-direction:column;min-height:0}
#holo-login .hlp-sheet.hlp-open .hlp-list{flex:1 1 auto}   /* boot style expanded → the card takes the room, the grid scrolls inside */
#holo-login .hlp-row{display:flex;align-items:center;gap:13px;width:100%;min-height:56px;padding:0 16px;border:0;background:none;color:var(--ink,#e6edf3);font:500 var(--u,16px)/1 "Segoe UI",system-ui,sans-serif;cursor:pointer;text-align:left;transition:background .12s;flex:0 0 auto}
#holo-login .hlp-row + .hlp-row,#holo-login .hlp-boot-body + .hlp-row{border-top:1px solid var(--field-border,rgba(255,255,255,.1))}
#holo-login .hlp-row:hover{background:var(--field-bg,rgba(255,255,255,.06))}
#holo-login .hlp-row .ic{width:22px;height:22px;flex:0 0 auto;color:var(--muted,#9fb3d0)}
#holo-login .hlp-row .lbl{flex:1 1 auto;min-width:0}
#holo-login .hlp-row .val{flex:0 1 auto;color:var(--muted,#8b949e);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-left:10px}
#holo-login .hlp-row .chev{width:18px;height:18px;flex:0 0 auto;color:var(--muted,#8b949e);transition:transform .18s}
#holo-login .hlp-row[aria-expanded="true"] .chev{transform:rotate(90deg)}
#holo-login .hlp-thumb{width:36px;height:36px;flex:0 0 auto;border-radius:8px;overflow:hidden;background:#000;display:grid;place-items:center}
#holo-login .hlp-thumb img{max-width:100%;max-height:100%;object-fit:contain;display:block}
#holo-login .hlp-thumb.off{color:var(--muted,#6e7681);font-size:16px}
#holo-login .hlp-boot-body{border-top:1px solid var(--field-border,rgba(255,255,255,.1));display:flex;flex-direction:column;min-height:0;flex:1 1 auto}
#holo-login .hlp-boot-body[hidden]{display:none}
#holo-login .hlp-foot{padding:12px 22px 16px;font-size:var(--u,16px);color:var(--muted,#6e7681);border-top:1px solid var(--glass-border,rgba(255,255,255,.07));flex:0 0 auto}
#holo-login .hlp-foot a{color:var(--link,#58a6ff);text-decoration:none}
#holo-login .hlp-toast{position:fixed;left:50%;bottom:74px;transform:translateX(-50%);z-index:7;background:var(--sheet,rgba(13,17,23,.95));color:var(--ink,#e6edf3);
  border:1px solid var(--glass-border,rgba(255,255,255,.14));border-radius:999px;padding:10px 20px;font:var(--u,16px) "Segoe UI",system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.6);
  pointer-events:none;animation:hlp-toast 2.6s ease both}
@keyframes hlp-toast{0%{opacity:0;transform:translate(-50%,8px)}10%,82%{opacity:1;transform:translate(-50%,0)}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){#holo-login .hlp,#holo-login .hlp canvas,#holo-login .hlp-btn,#holo-login .hlp-prev .hlp-shim{transition:none;animation:none;opacity:1}}
`;
function injectCss() {
  try { if (document.getElementById("holo-plymouth-css")) return; const s = document.createElement("style"); s.id = "holo-plymouth-css"; s.textContent = CSS; document.head.appendChild(s); } catch {}
}

const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

// ── the player: ONE facade, two backends, the same choreography ────────────────────────────────────────
// Poses are draw-space (crisp at any scale — CSS transforms would blur the canvas):
//   boot   — dead-center, up to 62vmin: the machine booting, exactly like the metal
//   greet  — the living emblem IS your identity: it lands on the avatar slot (anchored, a touch larger)
//   verify — the emblem leans in slightly while the enclave checks you (CSS pulses brightness)
// Anchored poses track the .hl-avatar rect live (the circle itself is hidden — the animation replaces it);
// the fraction values are only the fallback for a greeter without an avatar in its panel.
//
// GPU backend (default): decode + chroma-key + temporal blend + present live on an OffscreenCanvas in a
// dedicated Worker — the main thread never decodes or keys a pixel (the witnessed source of boot-beat
// jank), and consecutive 25 fps sprite frames are crossfaded by fractional phase so motion presents at
// the display's own rate. dpr up to 3 for device-pixel sharpness. Probe-BEFORE-transfer (a transferred
// canvas is consumed); any missing capability falls open to the proven 2D player below, byte-identical
// behavior. Force a rung: ?emblem=gpu | ?emblem=2d.
const POSES = {
  boot:   { cx: 0.5, cy: 0.46, cap: 0.62 },
  greet:  { cx: 0.5, cy: 0.36, cap: 0.50, anchor: true, mult: 8 },
  verify: { cx: 0.5, cy: 0.36, cap: 0.54, anchor: true, mult: 8 },
};
// GOLDEN HERO: the emblem grows UPWARD from the identity slot (its bottom pinned just above the button) to
// fill the upper golden-major section — its centre lands on the upper golden line (38.2vh) while the
// identity sits on the lower golden line (61.8vh). Capped by the vertical space (to a golden top margin)
// AND by screen width, so it is as large as the composition allows yet never overflows or crowds the button.
function anchorTarget(overlay, p, fallback) {
  try {
    const a = overlay.querySelector(".hl-avatar");
    if (a) {
      const r = a.getBoundingClientRect();
      if (r.width) {
        const topGap = Math.round(window.innerHeight * 0.06);        // golden breathing room above the emblem
        const cap = Math.max(r.width, Math.min(r.width * (p.mult || 8), r.bottom - topGap, window.innerWidth * 0.9));
        return { cx: r.left + r.width / 2, cy: r.bottom - cap / 2, cap };
      }
    }
  } catch {}
  return fallback;
}
// Plymouth sprites bake their black screen into the PNG; over the wallpaper that black must be AIR.
// The GPU backend keys in the fragment shader (zero main-thread cost); this CPU twin serves the 2D floor.
// `ink` = the light appearance: a mostly-white sprite would vanish on paper, so the keyed emblem is
// PRINTED — every pixel darkened to ink weight with its hue kept (white → near-black, green → deep green).
// Fail-open: any canvas trouble keeps the original image.
function keyBlack(img, ink) {
  try {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return img;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, w, h), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const v = Math.max(p[i], p[i + 1], p[i + 2]);
      if (v < 48) p[i + 3] = Math.min(p[i + 3], Math.max(0, ((v - 12) / 36) * 255) | 0);
      if (ink && v > 0) { const f = 46 / Math.max(v, 31); p[i] = (p[i] * f) | 0; p[i + 1] = (p[i + 1] * f) | 0; p[i + 2] = (p[i + 2] * f) | 0; }
    }
    x.putImageData(d, 0, 0);
    return c;
  } catch { return img; }
}
// ── LIVING MOTION — the emblem is a hologram suspended in space: it breathes with a slow autonomous float
// and, on a device with a pointer, leans with your cursor (parallax). Both are tiny px offsets folded into
// the pose TARGET, so the player's existing ease smooths them for free — no worker or shader surgery. Under
// reduced motion it holds perfectly still. Works on both backends (GPU worker via send(), 2D via liveTarget). ─
let _paraX = 0, _paraY = 0, _paraArmed = false;
function armParallax() {
  if (_paraArmed) return; _paraArmed = true;
  if (reducedMotion()) return;
  try {
    addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;                 // desktop hover only — touch has no idle hover
      _paraX = -((((e.clientX / innerWidth) || 0.5) - 0.5)) * 26;   // ±13px, opposite the cursor → it floats in front of the glass
      _paraY = -((((e.clientY / innerHeight) || 0.5) - 0.5)) * 20;  // ±10px
    }, { passive: true });
    addEventListener("blur", () => { _paraX = 0; _paraY = 0; }, { passive: true });
  } catch {}
}
function posOffset() {                                        // px offset added to an ANCHORED pose's centre
  if (reducedMotion()) return { x: 0, y: 0 };
  let fx = 0, fy = 0;
  try { const t = performance.now() / 1000; fx = Math.sin(t * 0.55) * 6; fy = Math.cos(t * 0.42) * 7.5; } catch {}
  return { x: fx + _paraX, y: fy + _paraY };
}

// ── the 2D floor: the proven player, unchanged physics (25 fps stepped, CPU key) — dpr up to 3 + high-quality
// smoothing so the emblem is crisp at true device resolution on retina and phones. ────────────────────────
function make2dPlayer(overlay, layer, canvas, onLive) {
  const ctx = canvas.getContext("2d");
  try { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; } catch {}
  const images = [];            // sparse, filled as frames land
  let prefix = 0;               // contiguous playable prefix — the loop only plays what has landed
  let raf = 0, t0 = 0, alive = true, last = 0, started = false, inkOn = false;
  const pose = { ...POSES.boot };          // current, eased toward target every frame
  let target = POSES.boot;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  function size() { canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); }
  size(); addEventListener("resize", size);
  // anchored poses resolve to the avatar slot's live rect (panel rise/resize tracked every frame)
  function liveTarget() {
    if (!target.anchor) return target;
    const cw = canvas.width / dpr, ch = canvas.height / dpr, vmin = Math.min(cw, ch);
    const px = anchorTarget(overlay, target, null);
    if (!px) return target;
    const o = posOffset();
    return { cx: (px.cx + o.x) / cw, cy: (px.cy + o.y) / ch, cap: px.cap / vmin };
  }
  function draw(idx) {
    const img = images[idx]; if (!img) return;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    const vmin = Math.min(cw, ch);
    // Plymouth centers the sprite at its natural size; the pose caps it (boot ≈ the metal, greet = emblem)
    const s = Math.min(1, (vmin * pose.cap) / Math.max(iw, ih));
    const w = iw * s, h = ih * s;
    const cx = cw * pose.cx, cy = ch * pose.cy;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  }
  function loop(now) {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden || prefix === 0) { last = now; return; }
    if (!t0) t0 = now;
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    // glide the pose toward its target (exp ease ≈ 750ms settle); reduced motion snaps
    const tgt = liveTarget();
    const k = reducedMotion() ? 1 : Math.min(1, dt * 5.5);
    pose.cx += (tgt.cx - pose.cx) * k;
    pose.cy += (tgt.cy - pose.cy) * k;
    pose.cap += (tgt.cap - pose.cap) * k;
    const idx = Math.floor((now - t0) / (1000 / FPS)) % Math.max(prefix, 1);
    draw(idx);
  }
  function wake() {
    while (images[prefix]) prefix++;
    if (!started && prefix > 0) {                          // first drawable frame → the splash is alive
      started = true;
      try { onLive(); } catch {}
      const t = liveTarget(); pose.cx = t.cx; pose.cy = t.cy; pose.cap = t.cap;   // snap to the current pose…
      draw(0);                                             // …and paint frame 0 NOW (instant first paint, even before rAF)
      // ALWAYS run the sprite cycle — a contained in-place loop, like a loading spinner. Under reduced motion
      // the loop SNAPS the pose (no glide across the screen), so the emblem still LIVES without jarring motion.
      // (Gating the whole loop on reduced motion was the "static emblem on mobile" bug: many phones enable it.)
      raf = requestAnimationFrame(loop);
    }
  }
  return {
    mode: "2d",
    frame(i, bytes) {
      const img = new Image();
      img.onload = () => { try { URL.revokeObjectURL(img.src); } catch {} if (!alive) return; images[i] = keyBlack(img, inkOn); wake(); };
      img.onerror = () => { try { URL.revokeObjectURL(img.src); } catch {} };
      img.src = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    },
    pose(name) { target = POSES[name] || POSES.greet; if (reducedMotion()) { const t = liveTarget(); pose.cx = t.cx; pose.cy = t.cy; pose.cap = t.cap; if (images[0]) draw(0); } },
    ink(on) { const flip = inkOn !== !!on; inkOn = !!on; return flip && started; },   // true → frames need a re-key (caller replays)
    reset() { images.length = 0; prefix = 0; t0 = 0; started = false; },
    destroy() { alive = false; cancelAnimationFrame(raf); removeEventListener("resize", size); },
  };
}

// ── the GPU worker: decode (createImageBitmap — no hidden-tab decode() trap), shader chroma-key,
// frame-pair temporal blend to display rate, pose easing, present. Classic worker from a Blob URL
// (no import map, no extra manifest asset — works on any mount). No template literals inside. ─────────
const GPU_WORKER_SRC =
  '"use strict";\n' +
  "var device=null,ctx=null,canvas=null,pipeline=null,sampler=null,ubuf=null;\n" +
  "var dpr=1,reduced=false,cw=0,chh=0;\n" +
  "var tex=[],pend=[];\n" +
  "var prefix=0,started=false,t0=0,raf=0,last=0;\n" +
  "var pose={cx:0,cy:0,cap:0},target=null,ink=0;\n" +
  "var WGSL=''+\n" +
  "'struct U { rect: vec4<f32>, misc: vec4<f32> };\\n'+\n" +
  "'@group(0) @binding(0) var<uniform> u: U;\\n'+\n" +
  "'@group(0) @binding(1) var smp: sampler;\\n'+\n" +
  "'@group(0) @binding(2) var texA: texture_2d<f32>;\\n'+\n" +
  "'@group(0) @binding(3) var texB: texture_2d<f32>;\\n'+\n" +
  "'struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };\\n'+\n" +
  "'@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {\\n'+\n" +
  "'  var c = array<vec2<f32>,6>(vec2<f32>(-1.,-1.), vec2<f32>(1.,-1.), vec2<f32>(-1.,1.), vec2<f32>(-1.,1.), vec2<f32>(1.,-1.), vec2<f32>(1.,1.));\\n'+\n" +
  "'  let k = c[vi];\\n'+\n" +
  "'  let px = u.rect.xy + k * u.rect.zw * 0.5;\\n'+\n" +
  "'  var o: VOut;\\n'+\n" +
  "'  o.pos = vec4<f32>(px.x / u.misc.y * 2. - 1., 1. - px.y / u.misc.z * 2., 0., 1.);\\n'+\n" +
  "'  o.uv = k * 0.5 + vec2<f32>(0.5, 0.5);\\n'+\n" +
  "'  return o;\\n'+\n" +
  "'}\\n'+\n" +
  "'@fragment fn fs(i: VOut) -> @location(0) vec4<f32> {\\n'+\n" +
  "'  let a = textureSample(texA, smp, i.uv);\\n'+\n" +
  "'  let b = textureSample(texB, smp, i.uv);\\n'+\n" +
  "'  let c = mix(a, b, u.misc.x);\\n'+\n" +
  "'  let v = max(c.r, max(c.g, c.b));\\n'+\n" +
  "'  let alpha = min(c.a, clamp((v - 0.047) / 0.141, 0., 1.));\\n'+\n" +
  "'  var rgb = c.rgb;\\n'+\n" +
  "'  if (u.misc.w > 0.5) { rgb = rgb * (0.18 / max(v, 0.12)); }\\n'+\n" +
  "'  return vec4<f32>(rgb * alpha, alpha);\\n'+\n" +
  "'}\\n';\n" +
  "self.onmessage=function(e){var d=e.data||{};\n" +
  " if(d.t==='probe'){Promise.resolve().then(async function(){var ok=false;try{ok=!!(self.navigator&&navigator.gpu&&await navigator.gpu.requestAdapter());}catch(err){}self.postMessage({t:'probe',ok:ok});});}\n" +
  " else if(d.t==='init'){init(d).catch(function(err){self.postMessage({t:'err',m:String(err)});});}\n" +
  " else if(d.t==='frame'){frame(d.i,d.buf);}\n" +
  " else if(d.t==='pose'){target={cx:d.cx,cy:d.cy,cap:d.cap};if(!pose.cap){pose.cx=d.cx;pose.cy=d.cy;pose.cap=d.cap;}if(reduced&&started){pose.cx=d.cx;pose.cy=d.cy;pose.cap=d.cap;render(0,0,0.016,0);}}\n" +
  " else if(d.t==='ink'){ink=d.on?1:0;if(reduced&&started)render(0,0,0.016,0);}\n" +
 " else if(d.t==='resize'){dpr=d.dpr;cw=d.w;chh=d.h;if(canvas&&ctx){canvas.width=Math.max(1,Math.round(cw*dpr));canvas.height=Math.max(1,Math.round(chh*dpr));}}\n" +
  " else if(d.t==='reset'){for(var i=0;i<tex.length;i++){if(tex[i]){try{tex[i].tex.destroy();}catch(err){}}}tex.length=0;pend.length=0;prefix=0;started=false;t0=0;}\n" +
  "};\n" +
  "async function init(d){\n" +
  " canvas=d.canvas;dpr=d.dpr;reduced=!!d.reduced;cw=d.w;chh=d.h;\n" +
  " var adapter=await navigator.gpu.requestAdapter();\n" +
  " device=await adapter.requestDevice();\n" +
  " ctx=canvas.getContext('webgpu');\n" +
  " var format=navigator.gpu.getPreferredCanvasFormat();\n" +
  " canvas.width=Math.max(1,Math.round(cw*dpr));canvas.height=Math.max(1,Math.round(chh*dpr));\n" +
  " ctx.configure({device:device,format:format,alphaMode:'premultiplied'});\n" +
  " sampler=device.createSampler({magFilter:'linear',minFilter:'linear'});\n" +
  " ubuf=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});\n" +
  " var mod=device.createShaderModule({code:WGSL});\n" +
  " pipeline=device.createRenderPipeline({layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format:format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});\n" +
  " var p=pend.splice(0,pend.length);\n" +
  " for(var j=0;j<p.length;j++)frame(p[j][0],p[j][1]);\n" +
  "}\n" +
  "async function frame(i,buf){\n" +
  " if(!device){pend.push([i,buf]);return;}\n" +
  " var bmp=null;\n" +
  " try{bmp=await createImageBitmap(new Blob([buf],{type:'image/png'}),{premultiplyAlpha:'none',colorSpaceConversion:'none'});}catch(err){return;}\n" +
  " var t=device.createTexture({size:[bmp.width,bmp.height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});\n" +
  " device.queue.copyExternalImageToTexture({source:bmp},{texture:t,premultipliedAlpha:false},[bmp.width,bmp.height]);\n" +
  " var rec={tex:t,w:bmp.width,h:bmp.height};\n" +
  " try{bmp.close();}catch(err){}\n" +
  " tex[i]=rec;\n" +
  " while(tex[prefix])prefix++;\n" +
  " if(!started&&prefix>0){started=true;self.postMessage({t:'first'});render(0,0,0.016,0);raf=requestAnimationFrame(loop);}\n" +
  "}\n" +
  "function loop(now){\n" +
  " raf=requestAnimationFrame(loop);\n" +
  " if(prefix===0){last=now;return;}\n" +
  " if(!t0)t0=now;\n" +
  " var dt=Math.min((now-last)/1000,0.1);last=now;\n" +
  " var tt=(now-t0)/40;\n" +
  " var idx=Math.floor(tt)%prefix;\n" +
  " var phase=tt-Math.floor(tt);\n" +
  " render(idx,prefix>1?(idx+1)%prefix:idx,dt,phase);\n" +
  "}\n" +
  "function render(idx,nxt,dt,phase){\n" +
  " var a=tex[idx];if(!a||!ctx||!pipeline)return;\n" +
  " var b=tex[nxt]||a;\n" +
  " if(target){var k=reduced?1:Math.min(1,(dt||0.016)*5.5);\n" +
  "  pose.cx+=(target.cx-pose.cx)*k;pose.cy+=(target.cy-pose.cy)*k;pose.cap+=(target.cap-pose.cap)*k;}\n" +
  " var s=Math.min(1,pose.cap/Math.max(a.w,a.h));\n" +
  " var w=a.w*s*dpr,h=a.h*s*dpr;\n" +
  " var u=new Float32Array([pose.cx*dpr,pose.cy*dpr,w,h,phase||0,canvas.width,canvas.height,ink]);\n" +
  " device.queue.writeBuffer(ubuf,0,u);\n" +
  " var bg=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf}},{binding:1,resource:sampler},{binding:2,resource:a.tex.createView()},{binding:3,resource:b.tex.createView()}]});\n" +
  " var enc=device.createCommandEncoder();\n" +
  " var pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});\n" +
  " pass.setPipeline(pipeline);pass.setBindGroup(0,bg);pass.draw(6);pass.end();\n" +
  " device.queue.submit([enc.finish()]);\n" +
  "}\n";

// main-side controller: probes the worker's adapter BEFORE transferring the canvas (a consumed canvas
// can't fall back), then only reads the avatar rect + posts pose targets — the sole main-thread work.
async function makeGpuPlayer(overlay, layer, canvas, onLive) {
  if (typeof Worker === "undefined" || !("gpu" in navigator) || !canvas.transferControlToOffscreen || typeof createImageBitmap === "undefined") return null;
  let worker = null, url = null;
  try {
    url = URL.createObjectURL(new Blob([GPU_WORKER_SRC], { type: "text/javascript" }));
    worker = new Worker(url);
  } catch { try { if (url) URL.revokeObjectURL(url); } catch {} return null; }
  const ok = await new Promise((res) => {
    const to = setTimeout(() => res(false), 4500);
    const h = (e) => { if (e.data && e.data.t === "probe") { worker.removeEventListener("message", h); clearTimeout(to); res(!!e.data.ok); } };
    worker.addEventListener("message", h);
    try { worker.postMessage({ t: "probe" }); } catch { clearTimeout(to); res(false); }
  });
  try { URL.revokeObjectURL(url); } catch {}
  if (!ok) { try { worker.terminate(); } catch {} return null; }
  const off = canvas.transferControlToOffscreen();       // point of no return — the worker owns the pixels
  const dpr = () => Math.min(window.devicePixelRatio || 1, 3);
  worker.postMessage({ t: "init", canvas: off, w: innerWidth, h: innerHeight, dpr: dpr(), reduced: reducedMotion() }, [off]);
  worker.addEventListener("message", (e) => { if (e.data && e.data.t === "first") { try { onLive(); } catch {} } });
  let target = POSES.boot, watch = 0, last = null;
  const send = () => {
    const p = target, cw = innerWidth, ch = innerHeight, vmin = Math.min(cw, ch);
    let t = { cx: cw * p.cx, cy: ch * p.cy, cap: vmin * p.cap };
    if (p.anchor) { t = anchorTarget(overlay, p, t); const o = posOffset(); t = { cx: t.cx + o.x, cy: t.cy + o.y, cap: t.cap }; }
    if (!last || Math.abs(t.cx - last.cx) > 0.25 || Math.abs(t.cy - last.cy) > 0.25 || Math.abs(t.cap - last.cap) > 0.25) {
      last = t;
      try { worker.postMessage({ t: "pose", cx: t.cx, cy: t.cy, cap: t.cap }); } catch {}
    }
  };
  const tick = () => { watch = requestAnimationFrame(tick); send(); };   // one rect read per frame — nothing else
  send(); watch = requestAnimationFrame(tick);
  const onRs = () => { try { worker.postMessage({ t: "resize", w: innerWidth, h: innerHeight, dpr: dpr() }); } catch {} };
  addEventListener("resize", onRs);
  return {
    mode: "gpu-worker",
    frame(i, bytes) { try { const buf = bytes.slice().buffer; worker.postMessage({ t: "frame", i, buf }, [buf]); } catch {} },
    pose(name) { target = POSES[name] || POSES.greet; last = null; send(); },
    ink(on) { try { worker.postMessage({ t: "ink", on: !!on }); } catch {} return false; },   // shader-side — never needs a replay
    reset() { try { worker.postMessage({ t: "reset" }); } catch {} },
    destroy() { cancelAnimationFrame(watch); removeEventListener("resize", onRs); try { worker.terminate(); } catch {} },
  };
}

// TOUCH / MOBILE = the 2D main-thread player, always. WebGPU-in-a-Worker over an OffscreenCanvas is the
// one combo that is unreliable on phones: iOS/Android throttle or never fire the worker's rAF, so the
// emblem renders its pose ONCE and then freezes (the "static image on mobile" bug). The main-thread 2D
// player drives rAF on the page's own frame clock — universally reliable, and these emblems are small, so
// the CPU cost is nothing. ?emblem=gpu forces the worker anyway (desktop testing); ?emblem=2d forces 2D.
function isMobileLike() {
  try {
    if (matchMedia("(pointer: coarse)").matches) return true;                       // any touchscreen
    if (Math.min(window.innerWidth, window.innerHeight) < 600) return true;         // phone-sized
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "")) return true;
  } catch {}
  return false;
}

// the facade: same synchronous API the choreography uses; the backend resolves async (frames queue).
// TWO layers of defense against a silent GPU stall: mobile never picks GPU, AND a watchdog swaps any
// GPU backend that hasn't drawn a first frame within ~2s onto a FRESH-canvas 2D player, replaying the
// early frames — so the emblem always ends up moving, on any device, even if WebGPU lies about working.
function makePlayer(overlay, layer, onLive) {
  armParallax();                                           // living motion: pointer-lean (desktop) + autonomous float
  let backend = null, queue = [], lastPose = null, lastInk = null, dead = false;
  let firstFired = false, watchdog = 0, early = [];        // early frame copies, for a fallback replay
  let forced = null; try { forced = new URLSearchParams(location.search).get("emblem"); } catch {}

  const freshCanvas = () => { const old = layer.querySelector("canvas"); if (old) old.remove(); const c = document.createElement("canvas"); layer.appendChild(c); return c; };
  const live = () => { if (firstFired) return; firstFired = true; clearTimeout(watchdog); early = []; try { onLive(); } catch {} };
  function build2d() {
    backend = make2dPlayer(overlay, layer, freshCanvas(), live);
    if (lastInk != null) backend.ink(lastInk);
    if (lastPose) backend.pose(lastPose);
    for (const [i, b] of early) backend.frame(i, b);       // replay what the stalled backend never showed
  }
  function forward(i, bytes) {
    if (!firstFired && early.length < 24) { try { early.push([i, bytes.slice()]); } catch {} }
    if (!firstFired && !watchdog && backend && backend.mode === "gpu-worker") {
      watchdog = setTimeout(() => { if (firstFired) return; try { backend.destroy(); } catch {} build2d(); }, 2200);
    }
    if (backend) backend.frame(i, bytes);
  }

  (async () => {
    const wantGpu = forced === "gpu" || (forced !== "2d" && !isMobileLike());
    let b = null;
    if (wantGpu) { try { b = await makeGpuPlayer(overlay, layer, freshCanvas(), live); } catch { b = null; } }
    if (dead) { try { b && b.destroy(); } catch {} return; }
    if (b) { backend = b; if (lastInk != null && b.ink) b.ink(lastInk); if (lastPose) b.pose(lastPose); }
    else build2d();
    const q = queue; queue = null;
    for (const [i, bytes] of q) forward(i, bytes);
  })();

  return {
    mode: () => (backend ? backend.mode : "pending"),
    frame(i, bytes) { if (backend) forward(i, bytes); else if (queue) queue.push([i, bytes]); },
    pose(name) { lastPose = name; if (backend) backend.pose(name); },
    ink(on) { lastInk = !!on; return backend && backend.ink ? backend.ink(on) : false; },   // truthy → caller replays (2D re-key)
    reset() { if (queue) queue = []; early = []; firstFired = false; clearTimeout(watchdog); watchdog = 0; if (backend) backend.reset(); },
    destroy() { dead = true; clearTimeout(watchdog); if (backend) backend.destroy(); },
  };
}

// ── gallery thumbnails: each tile wears the theme's REAL frame-0 (streamed once, sealed to κ) — the
// gallery itself becomes offline-capable. The upstream GIF preview plays on hover only. ────────────────
let _thumbMap = null;   // ONE shared map — concurrent loaders mutate it; each write persists the whole map
function thumbMap() { if (!_thumbMap) { try { _thumbMap = JSON.parse(localStorage.getItem(THK) || "{}") || {}; } catch { _thumbMap = {}; } } return _thumbMap; }
const _thumbURL = new Map();   // theme → objectURL (session)
async function thumbFor(t) {
  if (_thumbURL.has(t.name)) return _thumbURL.get(t.name);
  const m = thumbMap();
  const got = await kBytes(m[t.name], frameUrl(t, 0));
  if (!got) return null;
  if (m[t.name] !== got.kappa) { m[t.name] = got.kappa; try { localStorage.setItem(THK, JSON.stringify(m)); } catch {} }
  const url = URL.createObjectURL(new Blob([got.bytes], { type: "image/png" }));
  _thumbURL.set(t.name, url);
  return url;
}

// ── APPEARANCE — the ONE panel behind the ⋯ door: how your computer looks (Dark · Light · Immersive,
// the SAME holo.theme.v1 row home wears, via the canonical HoloTheme.setMode contract) and how it wakes
// (the boot styles). No login-only state anywhere: pick here, the whole OS follows. ────────────────────
const THEME_MODES = ["dark", "light", "immersive"];
function themeMode() {
  try { const t = JSON.parse(localStorage.getItem("holo.theme.v1") || "{}") || {}; return t.immersive === false ? (t.palette === "light" ? "light" : "dark") : "immersive"; } catch { return "immersive"; }
}
function themeWallSrc() {
  let w = ""; try { w = (JSON.parse(localStorage.getItem("holo.theme.v1") || "{}") || {}).wallpaper || ""; } catch {}
  const m = String(w).match(/^(sha256|blake3|sha512):([0-9a-f]+)$/i);
  let src = m ? ("/.holo/" + m[1].toLowerCase() + "/" + m[2]) : ((!w || w === "plain" || /^live:/i.test(w)) ? "" : w);
  if (!src) { try { src = localStorage.getItem("holo-messenger/wallpaper-src") || ""; } catch {} }
  return src || "/apps/holo-messenger/_vendor/wallpaper-default.jpg";
}
function applyMode(overlay, m) {
  try {
    if (window.HoloTheme && window.HoloTheme.setMode) window.HoloTheme.setMode(m);
    else { const t = JSON.parse(localStorage.getItem("holo.theme.v1") || "{}") || {}; if (m === "immersive") t.immersive = true; else { t.palette = m; t.immersive = false; } localStorage.setItem("holo.theme.v1", JSON.stringify(t)); }
  } catch {}
  overlay.setAttribute("data-appearance", m);
  const wall = overlay.querySelector(".hl-wall");
  if (wall) wall.style.backgroundImage = m === "immersive" ? 'url("' + themeWallSrc() + '")' : "none";
}

// ── the panel: modes on top, boot styles beneath, the host's rare doors at the bottom — everything
// applies LIVE behind the sheet. `host.actions` is whatever the greeter offers (recovery flows today);
// read at open time, rendered as one quiet row, gone when empty. ───────────────────────────────────────
function openGallery(overlay, current, onPick, host) {
  const CHEV = `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`;
  const curName = current ? pretty(current) : "Off";
  const gal = document.createElement("div"); gal.className = "hlp-gal";
  gal.innerHTML = `<div class="hlp-sheet" role="dialog" aria-label="Appearance">
    <div class="hlp-head"><div class="hlp-title">Appearance</div>
      <button class="hlp-x" aria-label="Close">✕</button></div>
    <div class="hlp-modes" role="radiogroup" aria-label="Theme"></div>
    <div class="hlp-list">
      <button type="button" class="hlp-row hlp-boot-toggle" aria-expanded="false">
        <span class="hlp-thumb${current ? "" : " off"}">${current ? '<img alt="">' : "◌"}</span>
        <span class="lbl">Boot style</span><span class="val">${curName}</span>${CHEV}</button>
      <div class="hlp-boot-body" hidden>
        <div class="hlp-srch"><input type="search" placeholder="Search" spellcheck="false"></div>
        <div class="hlp-grid"></div>
      </div>
    </div>
    <div class="hlp-foot">Animations by <a href="https://github.com/adi1090x/plymouth-themes" target="_blank" rel="noopener">adi1090x</a> · GPL 3.0</div>
  </div>`;
  const sheet = gal.querySelector(".hlp-sheet"), list = gal.querySelector(".hlp-list");
  const modes = gal.querySelector(".hlp-modes");
  const drawModes = () => { const cur = themeMode(); modes.querySelectorAll("button").forEach((b) => { const on = b.dataset.mode === cur; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); }); };
  for (const m of THEME_MODES) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.mode = m; b.setAttribute("role", "radio");
    b.textContent = m.charAt(0).toUpperCase() + m.slice(1);
    b.onclick = () => { applyMode(overlay, m); drawModes(); };   // live — the lock re-inks behind the sheet
    modes.appendChild(b);
  }
  drawModes();
  // the current boot style's own frame-0 sits on the row — a tiny live preview of what you wear now
  if (current) { const t = themeOf(current); if (t) thumbFor(t).then((u) => { const im = gal.querySelector(".hlp-thumb img"); if (im && u) im.src = u; }).catch(() => {}); }

  const grid = gal.querySelector(".hlp-grid");
  const close = () => { gal.remove(); document.removeEventListener("keydown", esc, true); try { clearTimeout(sweep); io && io.disconnect(); } catch {} };
  const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener("keydown", esc, true);
  gal.addEventListener("pointerdown", (e) => { if (e.target === gal) close(); });
  gal.querySelector(".hlp-x").onclick = close;

  // ── the host's rare doors (Use another device · Restore) — appended to the SAME grouped card, so the
  // whole panel reads as one clean settings list: Boot style, then the account rows. ──────────────────────
  const hostActs = (host && Array.isArray(host.actions)) ? host.actions : [];
  for (const a of hostActs) {
    const b = document.createElement("button"); b.type = "button"; b.className = "hlp-row";
    b.innerHTML = `${a.icon || ""}<span class="lbl">${a.label}</span>${CHEV}`;
    b.onclick = () => { close(); try { a.run(); } catch {} };
    list.appendChild(b);
  }

  // ── Boot style is COLLAPSED by default (clean). Expanding it reveals the search + grid; the 80 thumbnails
  // load lazily only THEN, so opening the panel is instant. ───────────────────────────────────────────────
  const bootBody = gal.querySelector(".hlp-boot-body"), toggle = gal.querySelector(".hlp-boot-toggle");
  let built = false, sweep = 0;
  const expand = (show) => {
    toggle.setAttribute("aria-expanded", String(show));
    bootBody.hidden = !show;
    sheet.classList.toggle("hlp-open", show);
    if (show && !built) { built = true; draw(""); sweep = setTimeout(() => { for (const j of allJobs) if (!j.queued) { j.queued = 1; pending.push(j); } pump(); }, 700); }
    if (show) setTimeout(() => { try { inp.focus(); } catch {} }, 60);
  };
  toggle.onclick = () => expand(bootBody.hidden);

  // thumbnail loader — a small queue (never stampedes the CDN). IntersectionObserver PRIORITIZES what's
  // on screen; a fallback sweep enqueues the rest regardless (IO callbacks pause in hidden tabs, and 80
  // frame-0 stills are ~1–2 MB total — worth having them all sealed for the offline gallery anyway).
  const pending = [];
  let inFlight = 0;
  const pump = () => {
    while (inFlight < 4 && pending.length) {
      const job = pending.shift();
      if (job.queued === 2) continue;                     // already loaded via the other path
      job.queued = 2;
      const { t, img, shim } = job;
      inFlight++;
      thumbFor(t).then((url) => {
        if (url) { img.src = url; img.dataset.still = url; }
        if (shim) shim.remove();
      }).catch(() => { if (shim) shim.remove(); }).finally(() => { inFlight--; pump(); });
    }
  };
  const allJobs = [];
  const io = ("IntersectionObserver" in window) ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const job = e.target.__hlpJob; if (job && !job.queued) { job.queued = 1; pending.unshift(job); }   // visible first
    }
    pump();
  }, { root: grid, rootMargin: "240px" }) : null;

  function tile(t) {
    const el = document.createElement("button"); el.type = "button";
    el.className = "hlp-tile" + (current === (t ? t.name : null) ? " sel" : "");
    if (!t) {
      el.innerHTML = `<div class="hlp-prev off">◌</div><div class="hlp-name">Off</div>`;
    } else {
      el.innerHTML = `<div class="hlp-prev"><div class="hlp-shim"></div><img alt="" draggable="false"></div>
        <div class="hlp-name">${pretty(t.name)}</div>`;
      const img = el.querySelector("img"), shim = el.querySelector(".hlp-shim");
      el.__hlpJob = { t, img, shim, queued: 0 };
      allJobs.push(el.__hlpJob);
      if (io) io.observe(el); else { el.__hlpJob.queued = 1; pending.push(el.__hlpJob); pump(); }
      // hover = the theme comes alive (upstream GIF); leave = back to the sealed still
      el.addEventListener("pointerenter", () => { img.src = t.preview; }, { passive: true });
      el.addEventListener("pointerleave", () => { if (img.dataset.still) img.src = img.dataset.still; }, { passive: true });
    }
    el.onclick = () => { close(); onPick(t ? t.name : null); };
    return el;
  }
  function draw(q) {
    grid.innerHTML = "";
    allJobs.length = 0; pending.length = 0;
    grid.appendChild(tile(null));
    const needle = (q || "").toLowerCase().trim();
    for (const t of CATALOG) if (!needle || t.name.includes(needle.replace(/\s+/g, "_")) || pretty(t.name).toLowerCase().includes(needle)) grid.appendChild(tile(t));
  }
  const inp = gal.querySelector(".hlp-boot-body input");
  inp.addEventListener("input", () => draw(inp.value));   // the grid is built lazily on first expand (fast open)
  overlay.appendChild(gal);
}

function toast(overlay, msg) {
  try { const t = document.createElement("div"); t.className = "hlp-toast"; t.textContent = msg; overlay.appendChild(t); setTimeout(() => t.remove(), 2600); } catch {}
}

// ── attachPlymouth(overlay, host) — the ONE call the greeter makes. Returns the choreography controller.
// `host.actions` (optional, read lazily at panel-open) = rare doors the greeter wants inside the ⋯ panel. ──
export function attachPlymouth(overlay, host) {
  if (!overlay || overlay.querySelector(".hlp-btn")) return null;
  injectCss();
  const state = readState();
  // First-ever run: persist the default WITH the embedded frame-0, so the NEXT boot's 0-ms baseline paints
  // the emblem instantly (no cold CDN) — and this run feeds the same bytes below for an instant live paint.
  try { if (!localStorage.getItem(KEY)) { if (state.theme === DEFAULT_THEME && !state.firstFrame) state.firstFrame = DEFAULT_FF; writeState(state); } } catch {}
  try { if (!overlay.getAttribute("data-appearance")) overlay.setAttribute("data-appearance", themeMode()); } catch {}   // primitive overlays get the mode too
  let layer = null, player = null, gen = 0;
  let onEmblemLive = () => {};   // set by the boot-beat setup; fired the instant the emblem paints its first frame

  function ensureLayer() {
    if (layer) return;
    layer = document.createElement("div"); layer.className = "hlp";   // the facade owns the canvas (it may swap it on GPU-stall fallback)
    const wall = overlay.querySelector(".hl-wall");
    if (wall && wall.nextSibling) overlay.insertBefore(layer, wall.nextSibling); else overlay.prepend(layer);
    // onLive fires at the backend's FIRST drawable frame (whichever backend won the ladder):
    // the splash is alive — it wears the avatar slot and the 0-ms baseline still yields, and the boot
    // beat can lift NOW (the panel rises the moment there is a real emblem to greet you with).
    player = makePlayer(overlay, layer, () => {
      try { layer.classList.add("on"); overlay.classList.add("hlp-anchor"); dropBaseline(); onEmblemLive(); } catch {}
    });
    player.ink(isInk());
  }
  // the LIGHT appearance prints the emblem in ink (a white sprite on paper would vanish). The signal is
  // the overlay's [data-appearance] — the appearance switch flips it; observing keeps the modules decoupled.
  const isInk = () => { try { return overlay.getAttribute("data-appearance") === "light"; } catch { return false; } };
  try {
    new MutationObserver(() => {
      if (!player) return;
      if (player.ink(isInk())) play(state.theme);          // 2D floor re-keys by replaying (κ-local, fast)
    }).observe(overlay, { attributes: true, attributeFilter: ["data-appearance"] });
  } catch {}
  function play(theme) {
    ensureLayer();
    const my = ++gen;
    player.reset();
    layer.classList.remove("done");
    // INSTANT first paint (zero network): feed the cached/seeded frame-0 the moment we start — so a first-EVER
    // boot's emblem materialises with the module (no wait for the cold CDN), then the streamed frames continue
    // the animation. The default theme falls back to the embedded DEFAULT_FF even before it is sealed.
    try {
      const s = readState();
      const ff = (s.theme === theme && s.firstFrame) ? s.firstFrame : (theme === DEFAULT_THEME ? DEFAULT_FF : null);
      if (ff) { const b = Uint8Array.from(atob(ff.split(",").pop()), (c) => c.charCodeAt(0)); if (b.length) player.frame(0, b); }
    } catch {}
    loadFrames(theme, (i, bytes) => { if (my === gen) player.frame(i, bytes); }, () => my !== gen)
      .catch(() => { if (my === gen && state.on) { layer.classList.remove("on"); overlay.classList.remove("hlp-anchor"); } });   // no frames at all → wallpaper + circle stay
  }
  // the host baseline (app.html) may have painted a synchronous frame-0 still; remove it once live
  function dropBaseline() { try { const b = document.getElementById("hl-plymouth-base"); if (b) { b.style.opacity = "0"; setTimeout(() => b.remove(), 900); } } catch {} }

  // THE BOOT BEAT — lean, readiness-gated. The panel rises the instant the emblem is alive, after a crisp
  // minimum flash and NEVER longer than a hard cap — no fixed multi-second wait. Skippable by any tap/key.
  // A supercomputer is ready when it is ready, not on a timer. Counted from the baseline's 0-ms frame
  // (window.__hlBootT0) so the beat measures REAL boot latency, not module-load time.
  // A deliberate HERO: the emblem holds large, dead-centre, for ~3s, THEN glides into the identity slot as the
  // whole login reveals together. (Was readiness-gated 320–1400ms, which made the emblem flick away instantly and
  // the chrome pop in on its own separate timers.) Still skippable by a tap/key; hard cap protects a slow network.
  const BOOT_MIN = 2800, BOOT_MAX = 3400;
  const bootT0 = (() => { try { return window.__hlBootT0 || Date.now(); } catch { return Date.now(); } })();
  let bootDone = false, bootTimer = 0;
  const endBoot = () => {
    if (bootDone) return; bootDone = true; clearTimeout(bootTimer);
    try { overlay.classList.remove("hl-boot"); if (layer) { layer.classList.add("greet"); player.pose("greet"); } dropBaseline(); } catch {}
  };
  const panelEl = overlay.querySelector("#holo-login-panel");
  const bootable = overlay.classList.contains("hl-boot") || !panelEl || !panelEl.childElementCount;
  if (state.on && bootable && !reducedMotion()) {
    overlay.classList.add("hl-boot");
    bootTimer = setTimeout(endBoot, Math.max(250, BOOT_MAX - (Date.now() - bootT0)));   // hard cap — never stall on a slow network
    onEmblemLive = () => { if (bootDone) return; clearTimeout(bootTimer); bootTimer = setTimeout(endBoot, Math.max(0, BOOT_MIN - (Date.now() - bootT0))); };   // alive → rise after the min flash
    overlay.addEventListener("pointerdown", endBoot, { once: true, capture: true });
    document.addEventListener("keydown", endBoot, { once: true, capture: true });
  } else if (state.on) { setTimeout(endBoot, 0); }
  if (state.on) play(state.theme);

  // the ⋯ door — appearance + boot style in ONE panel, same affordance as the home screen
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "hlp-btn"; btn.title = "Appearance"; btn.setAttribute("aria-label", "Appearance");
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>`;
  btn.onclick = () => openGallery(overlay, readState().on ? readState().theme : null, (name) => api.setTheme(name), host);
  btn.addEventListener("pointerenter", () => { try { store(); } catch {} }, { passive: true, once: true });   // warm the κ store during hover intent
  overlay.appendChild(btn);

  const api = {
    setTheme(name) {
      const s = readState();
      if (!name) {
        writeState({ ...s, on: false, firstFrame: undefined });
        gen++; if (layer) layer.classList.remove("on");
        overlay.classList.remove("hlp-anchor");           // splash off → the avatar circle returns
        toast(overlay, "Boot splash off");
        return;
      }
      writeState({ ...s, on: true, theme: name, firstFrame: undefined });
      state.on = true; state.theme = name;
      if (layer) { layer.classList.add("greet"); player.pose("greet"); }
      toast(overlay, pretty(name));
      play(name);
    },
    // choreography hooks for the greeter — all fail-open no-ops when the splash is off
    verify() { try { if (layer) { layer.classList.add("verify"); player.pose("verify"); } } catch {} },
    calm() { try { if (layer) { layer.classList.remove("verify"); player.pose("greet"); } } catch {} },
    complete() { try { endBoot(); if (layer) { layer.classList.remove("verify"); layer.classList.add("done"); } setTimeout(() => api.destroy(), 900); } catch {} },   // overlay is removed right after — stop the loop with it
    destroy() { gen++; try { player && player.destroy(); } catch {} },
  };
  try { window.HoloPlymouth = { open: () => btn.click(), set: (n) => api.setTheme(n), themes: CATALOG.map((t) => t.name), state: readState, mode: () => (player ? player.mode() : "none") }; } catch {}
  return api;
}
export default attachPlymouth;
