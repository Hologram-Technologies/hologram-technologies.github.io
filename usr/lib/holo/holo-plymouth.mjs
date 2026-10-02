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
  if (firstBytes && firstBytes.length < 80000) sealFirstFrame(theme, firstBytes);  // frame-0 → next boot's 0-ms baseline
  return { loaded, total: count };
}

// Seals frame-0 KEYED (black → air, keyBlack's own ramp): the baseline layer paints it over the boot
// ground (#1f1f1e), where a raw frame's baked-black rectangle would read as a darker box. Fail-open:
// canvas trouble seals nothing and the previous seal (or DEFAULT_FF) stands.
function sealFirstFrame(theme, bytes) {
  try {
    const img = new Image();
    const u = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    img.onload = () => {
      try { URL.revokeObjectURL(u); } catch {}
      try {
        const keyed = keyBlack(img);
        if (!keyed || !keyed.toDataURL) return;
        const url = keyed.toDataURL("image/png");
        if (url.length > 120000) return;
        // ffKeyed stamps the seal as CHROMA-KEYED — the baseline paints ONLY stamped (or embedded-default)
        // frames, so a legacy unkeyed seal can never put a baked-black square over the boot ground again
        // (the ground and the login wall are ONE token, --boot-ground; this keeps the image honest too).
        const s = readState(); if (s.theme === theme) { s.firstFrame = url; s.ffKeyed = true; writeState(s); }
      } catch {}
    };
    img.onerror = () => { try { URL.revokeObjectURL(u); } catch {} };
    img.src = u;
  } catch {}
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
  if (firstBytes && firstBytes.length < 80000) sealFirstFrame(theme, firstBytes);
  return { loaded, total };
}

// ── styles — self-contained, px-based (immune to host font resets), injected once ─────────────────────
const CSS = `
#holo-login .hlp{position:fixed;inset:0;z-index:0;pointer-events:none;background:var(--boot-ground,#1f1f1e);opacity:0;transition:opacity .5s ease,background-color 1.1s ease}
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
/* ── BOOT REVEAL SYNC — during the hero ALL login chrome (identity panel · Manifesto label · the ⋯ door)
   is hidden; it fades in TOGETHER the instant the emblem settles into its slot (hl-boot removed), instead
   of each element popping in on its own separate timer. One coordinated reveal.
   The BRAND (.hl-brand — H mark + wordmark) is deliberately NOT gated: it stands from the literal first
   frame (the app.html baseline paints it with the black) and never blinks across the whole ceremony. */
#holo-login.hl-boot .hl-manifesto, #holo-login.hl-boot .hlp-btn{opacity:0!important;animation:none!important;transition:opacity .55s ease}
#holo-login:not(.hl-boot) .hl-manifesto, #holo-login:not(.hl-boot) .hlp-btn{opacity:1!important;animation:none!important;transition:opacity .55s ease .08s}
#holo-login .hl-brand{opacity:1!important;animation:none!important}
/* the panel's own reveal: an explicit fresh animation at hl-boot removal — the load-time hl-rise has long
   finished (fill:both holds opacity 1), and a transition cannot interpolate an animation-supplied value,
   so without this the panel would SNAP in while the rest fades (.hlp-reveal is added by endBoot). */
@keyframes hlp-reveal{from{opacity:0;transform:translateY(10px) scale(.99)}to{opacity:1;transform:none}}
#holo-login.hlp-reveal:not(.hl-boot):not(.unfog) .hl-panel{animation:hlp-reveal .6s cubic-bezier(.4,0,.2,1) both}
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
@media (prefers-reduced-motion:reduce){#holo-login .hlp,#holo-login .hlp canvas,#holo-login .hlp-btn,#holo-login .hlp-prev .hlp-shim{transition:none;animation:none;opacity:1}
#holo-login.hlp-reveal:not(.hl-boot):not(.unfog) .hl-panel{animation:none}}
/* CLAUDE-DESK ⤵ — appended overrides; base rules keep their anti-revert probes */
#holo-login .hlp-btn{width:40px;height:40px;transition:background .15s,color .15s,border-color .15s,box-shadow .15s}
#holo-login .hlp-btn:hover{background:var(--field-bg,rgba(255,255,255,.12));border-color:var(--glass-border,rgba(255,255,255,.2));color:var(--ink,#fff)}
#holo-login .hlp-btn:focus-visible{outline:2px solid var(--accent,#7defc9);outline-offset:2px}
@media (pointer:coarse){#holo-login .hlp-btn{width:44px;height:44px}}
#holo-login .hlp-sheet{border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.5)}
#holo-login .hlp-head{padding:18px 20px 12px}
#holo-login .hlp-title{font-weight:600;letter-spacing:-.01em}
#holo-login .hlp-x{background:transparent;border-radius:9px}
#holo-login .hlp-x:hover{background:var(--field-bg,rgba(255,255,255,.08))}
#holo-login .hlp-list{border-radius:12px}
#holo-login .hlp-row{min-height:52px}
#holo-login .hlp-srch input{border-radius:10px}
#holo-login .hlp,#holo-login .hlp-sheet,#holo-login .hlp-scrim{-webkit-font-smoothing:antialiased}
@media (max-width:560px){#holo-login .hlp-sheet{width:96vw;border-radius:16px}#holo-login .hlp-modes,#holo-login .hlp-list{margin-left:16px;margin-right:16px}}
/* CLAUDE-DESK ⤴ */
/* CLAUDE-READ ⤵ — Claude-premium panel content: softer segmented, calmer rows, muted footer link (appended) */
#holo-login .hlp-modes{padding:5px;gap:5px;background:var(--field-bg,rgba(255,255,255,.05));border-color:var(--glass-border,rgba(255,255,255,.08))}
#holo-login .hlp-modes button{font-weight:500;letter-spacing:-.005em;min-height:42px}
#holo-login .hlp-modes button.on{background:#f5f5f2;color:#1a1a18;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.22)}
#holo-login .hlp-row{gap:14px;min-height:54px}
#holo-login .hlp-row .val{color:var(--muted,#8b949e);font-weight:450}
#holo-login .hlp-row .ic,#holo-login .hlp-row .chev{color:var(--muted,#8b949e)}
#holo-login .hlp-list{border-color:var(--glass-border,rgba(255,255,255,.08))}
#holo-login .hlp-thumb{border-radius:9px}
#holo-login .hlp-foot{color:var(--muted,#8b949e);font-size:13px}
#holo-login .hlp-foot a{color:var(--ink-dim,rgba(231,237,250,.7));text-decoration:underline;text-decoration-color:rgba(255,255,255,.2);text-underline-offset:2px}
/* CLAUDE-READ ⤴ */
/* STAGE ⤵ — the hero emblem sits IN a space, not ON a flat: one key light above centre + an edge vignette (static gradients, GPU-composited, zero per-frame cost). Lit only while the boot holds the hero; dissolves with the ceremony. */
#holo-login .hlp::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 1.2s ease;background:radial-gradient(42% 42% at 50% 46%,rgba(125,239,201,.04),transparent 70%),radial-gradient(62% 56% at 50% 46%,rgba(255,255,255,.05),transparent 72%),radial-gradient(130% 130% at 50% 50%,transparent 56%,rgba(0,0,0,.42) 100%)}
#holo-login.hl-boot .hlp.on::before{opacity:1}
#holo-login .hlp.greet::before,#holo-login .hlp.done::before{opacity:0}
/* STAGE ⤴ */
`;
function injectCss() {
  try { if (document.getElementById("holo-plymouth-css")) return; const s = document.createElement("style"); s.id = "holo-plymouth-css"; s.textContent = CSS; document.head.appendChild(s); } catch {}
}

const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

// ── DEVICE TIER — the ONE adaptive-quality authority (holo-device-tier.mjs), wired into the emblem. ────
// The player renders at the DEVICE'S ceiling, not blindly at 3×: dprCap comes from the tier profile
// (lite=1 · balanced=1.5 · high=2 · ultra=3), and a `lite`/Save-Data device wears the sealed frame-0 as a
// STATIC POSTER (the device-tier doctrine: a still that feels chosen, not a dropped-frame animation).
// Fail-open: no module → the previous behavior exactly (cap 3, always animate). The sync guess lands
// before first paint; probe() refines async and the loop picks the new cap up on its next size check.
let _tier = null;
try {
  import("./holo-device-tier.mjs").then((m) => {
    try { _tier = m.get(); } catch {}
    try { m.probe().then((p) => { if (p) _tier = p; }).catch(() => {}); } catch {}
  }).catch(() => {});
} catch {}
// The emblem is ONE small sprite blit — cheap even at full native resolution — so it renders at the
// device's TRUE pixel ratio (capped at 3), NOT the tier's conservative full-screen dprCap. A 3×-DPR phone
// on the `balanced` tier was drawing the boot emblem at 1.5× and upscaling it to the screen → visibly soft.
// Full native res is what makes it read as razor-sharp and high-resolution against the wallpaper.
const emblemDpr = () => Math.min(window.devicePixelRatio || 1, 3);
const emblemStill = () => !!(_tier && (_tier.renderPath === "static" || (_tier.compute && _tier.compute.saveData)));

// ── CEREMONY BEATS — the boot's own beacons (HOLO-BOOT-CEREMONY-PROMPT B0). performance.mark always;
// holo-life's strand when present. Fail-open no-ops everywhere — measurement never touches choreography. ──
const beat = (n) => {
  try { performance.mark("holo:ceremony:" + n); } catch {}
  try { const L = window.HoloLife; if (L && L.mark) L.mark("ceremony:" + n); } catch {}
};
// FIRST-PACKET (P2): the hero pays for the device — watch the holo-pin cache from module eval; when a
// worker CONTROLS and the SIGNED release + closure + world root are all device-pinned, this device boots
// offline forever after -> beat "device-provisioned". Observability only: read-only probes, fail-soft,
// the poller dies quietly at 60s; it never gates the reveal.
(() => { try {
  if (!("caches" in window) || !("serviceWorker" in navigator)) return;
  let n = 0;
  const iv = setInterval(async () => { try {
    if (++n > 120) { clearInterval(iv); return; }
    if (!navigator.serviceWorker.controller) return;
    const pin = await caches.open("holo-pin");
    const keys = await pin.keys();
    const path = (k) => { try { return new URL(k.url).pathname; } catch { return ""; } };
    const relKey = keys.find((k) => path(k).endsWith("/release.json"));
    if (!relKey || !keys.some((k) => path(k).endsWith("/os-closure.json"))) return;
    const rel = await (await pin.match(relKey)).json();
    const wk = (rel["holstr:payload"] || {}).world;
    if (/^[0-9a-f]{64}$/.test(wk || "") && !keys.some((k) => path(k).endsWith("/b/" + wk))) return;
    clearInterval(iv);
    beat("device-provisioned");
  } catch {} }, 500);
} catch {} })();

// ── the player: ONE facade, two backends, the same choreography ────────────────────────────────────────
// Poses are draw-space (crisp at any scale — CSS transforms would blur the canvas):
//   boot   — dead-center HERO, up to 95vmin / 1.35× natural: the machine booting, larger than life
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
// ── THE φ TABLE — every ceremony constant, one place, one derivation (HOLO-BOOT-CEREMONY-PROMPT B2).
//   φ = 1.618. Base unit u = clamp(16px, 1.7vmin, 19px) (holo-signin/app.html); g1 = u·φ; g2 = u·φ².
//   identity line   61.8vh  = 100/φ        (the lower golden line — avatar centre)
//   emblem centre   38.2vh  = 100/φ²       (the upper golden line — greet pose lands here by anchor math)
//   hero            centre 50vh (power symmetry: boot and power-off share the screen's axis), cap .95vmin,
//                   up 1.5 — bounded upscale (a touch past √φ for a more confident hero; a soft render
//                   still never turns to mush). MUST agree with app.html's baseline min(800px,95vmin).
//   emblem topGap   6vh ≈ 38.2/φ⁴          greet cap ≤ avatar.bottom − topGap, ≤ 90% width (anchorTarget)
//   short screens   56vh ≈ 61.8·0.9        (identity lifts one notch when the column would overflow)
//   beats           hold 5000–5600ms · glide ≈750ms (exp, k=dt·5.5) · reveal 600ms · defog 720ms · flare 620ms
const POSES = {
  // boot is the HERO: dead-centre of the screen, larger than life. `up` lets the sprite grow past its
  // natural size (bounded, so a soft render never turns to mush) — both players EASE it like cap, so the
  // hand-off to greet is ONE continuous shrink-and-glide, never a snap.
  boot:   { cx: 0.5, cy: 0.5, cap: 0.95, up: 1.5 },
  greet:  { cx: 0.5, cy: 0.36, cap: 0.50, anchor: true, mult: 10, up: 1.5 },
  verify: { cx: 0.5, cy: 0.36, cap: 0.54, anchor: true, mult: 10, up: 1.5 },
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
        const topGap = Math.round(window.innerHeight * 0.05);        // golden breathing room above the emblem
        const cap = Math.max(r.width, Math.min(r.width * (p.mult || 8), r.bottom - topGap, window.innerWidth * 0.9, window.innerHeight * 0.62));
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
// ── LIVING MOTION — the emblem is a hologram suspended in space: it breathes with a slow AUTONOMOUS float,
// a tiny px offset folded into the pose TARGET, so the player's existing ease smooths it for free. Under
// reduced motion it holds perfectly still. Works on both backends (GPU worker via send(), 2D via liveTarget).
// (Pointer parallax was REMOVED by request 2026-07-10: the emblem must never move in relation to the mouse —
// its life is its own breath, not a reaction to the operator's hand.) ─
function posOffset() {                                        // px offset added to an ANCHORED pose's centre
  if (reducedMotion()) return { x: 0, y: 0 };
  let fx = 0, fy = 0;
  try { const t = performance.now() / 1000; fx = Math.sin(t * 0.55) * 6; fy = Math.cos(t * 0.42) * 7.5; } catch {}
  return { x: fx, y: fy };
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
  let dpr = emblemDpr();        // tier-capped (lite=1 … ultra=3) — the loop picks up an async tier refine
  let lastRect = null;          // last painted rect (CSS px) — the DIRTY RECT: clear only where the emblem was/is
  let parked = false, settleN = 0;   // static-tier poster: once the pose settles, the loop PARKS (zero steady cost)
  // MOBILE FLICKER FIX: a phone's dynamic address bar fires `resize` in a storm during boot, and setting
  // canvas.width — even to the SAME value — instantly blanks the backing store (the wallpaper flashes
  // through until the next rAF repaints). Guard: only reallocate when the backing dimensions actually
  // change, so a no-op resize can never blank the emblem.
  function size() {
    const nd = emblemDpr(), w = Math.round(innerWidth * nd), h = Math.round(innerHeight * nd);
    if (w === canvas.width && h === canvas.height && nd === dpr) return;
    dpr = nd; canvas.width = w; canvas.height = h; lastRect = null; unpark();
  }
  size(); addEventListener("resize", size);
  function unpark() { if (parked && alive) { parked = false; settleN = 0; raf = requestAnimationFrame(loop); } }
  // anchored poses resolve to the avatar slot's live rect (panel rise/resize tracked every frame)
  function liveTarget() {
    if (!target.anchor) return target;
    const cw = canvas.width / dpr, ch = canvas.height / dpr, vmin = Math.min(cw, ch);
    const px = anchorTarget(overlay, target, null);
    if (!px) return target;
    const o = emblemStill() ? { x: 0, y: 0 } : posOffset();   // a static poster holds perfectly still (it must settle to park)
    return { cx: (px.cx + o.x) / cw, cy: (px.cy + o.y) / ch, cap: px.cap / vmin };
  }
  function draw(idx, nxt, phase) {
    const img = images[idx]; if (!img) return;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    const vmin = Math.min(cw, ch);
    // Plymouth centers the sprite at its natural size; the pose caps it (boot = hero, greet = emblem).
    // pose.up (eased) bounds how far past natural size the sprite may grow — 1 everywhere but the boot hero.
    const s = Math.min(pose.up || 1, (vmin * pose.cap) / Math.max(iw, ih));
    const w = iw * s, h = ih * s;
    const cx = cw * pose.cx, cy = ch * pose.cy;
    // DIRTY RECT: the wallpaper behind the emblem is static — clear only the union of the previous and the
    // new sprite rect (a small box), never the whole viewport backing store. On a dpr-3 phone this is the
    // difference between repainting ~9 Mpx and ~0.7 Mpx every frame — the measured mobile jank, gone.
    const pad = 6;
    const r = { x: cx - w / 2 - pad, y: cy - h / 2 - pad, w: w + pad * 2, h: h + pad * 2 };
    // Clear in DEVICE pixels, snapped OUTWARD to whole pixels: a fractional-dpr clear (balanced tier = 1.5×)
    // or the breathing sub-pixel drift would otherwise leave a 1px anti-aliased rim of the previous frame
    // uncleared → a shifting shimmer at the emblem's edge. Whole-device-pixel bounds erase it cleanly.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (lastRect) {
      const x0 = Math.min(r.x, lastRect.x), y0 = Math.min(r.y, lastRect.y);
      const x1 = Math.max(r.x + r.w, lastRect.x + lastRect.w), y1 = Math.max(r.y + r.h, lastRect.y + lastRect.h);
      const dx = Math.floor(x0 * dpr), dy = Math.floor(y0 * dpr);
      ctx.clearRect(dx, dy, Math.ceil(x1 * dpr) - dx, Math.ceil(y1 * dpr) - dy);
    } else ctx.clearRect(0, 0, canvas.width, canvas.height);
    lastRect = r;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The loop now always passes phase 0 (crossfade retired — it shimmered the moving dots). This optional
    // two-frame blend path is kept as a no-op so `pose(name)` under reduced motion can still request it if
    // ever needed; with phase 0 it collapses to a single crisp drawImage.
    const nimg = (phase > 0 && nxt != null && nxt !== idx) ? images[nxt] : null;
    if (nimg) {
      ctx.globalAlpha = 1 - phase;
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
      ctx.globalAlpha = phase;
      ctx.drawImage(nimg, cx - w / 2, cy - h / 2, w, h);
      ctx.globalAlpha = 1;
    } else ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  }
  function loop(now) {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden || prefix === 0) { last = now; return; }
    if (!t0) t0 = now;
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (dpr !== emblemDpr()) size();                       // async tier refine landed → re-cap the backing store
    // glide the pose toward its target (exp ease ≈ 750ms settle); reduced motion snaps
    const tgt = liveTarget();
    const k = reducedMotion() ? 1 : Math.min(1, dt * 5.5);
    pose.cx += (tgt.cx - pose.cx) * k;
    pose.cy += (tgt.cy - pose.cy) * k;
    pose.cap += (tgt.cap - pose.cap) * k;
    pose.up = (pose.up || 1) + ((tgt.up || 1) - (pose.up || 1)) * k;
    // STATIC POSTER (tier `lite` / Save-Data): the sealed frame-0 stands as the emblem — no sprite cycle.
    // Once the pose has settled the loop parks entirely; pose()/resize un-park it. Reduced-motion is NOT
    // this gate (it keeps the contained in-place cycle — see the "static emblem on mobile" bug note above).
    const still = emblemStill();
    const tt = (now - t0) / (1000 / FPS);
    const idx = still ? 0 : Math.floor(tt) % Math.max(prefix, 1);
    // Play the TRUE 25 fps frames — no sub-frame crossfade. Averaging two frames of a sparse dot-torus
    // renders any dot that moves between them at half opacity/brightness mid-phase, so every dot pulses at
    // 25 Hz — a shimmer that reads as flicker (worst at low DPR, i.e. on mobile). Stepping is clean. Pose
    // glide + the breathing float still move per-rAF, so the emblem's overall motion stays smooth.
    draw(idx, idx, 0);
    if (still) {
      const eps = 0.0006;
      if (Math.abs(tgt.cx - pose.cx) < eps && Math.abs(tgt.cy - pose.cy) < eps && Math.abs(tgt.cap - pose.cap) < eps * 8) {
        if (++settleN > 12) { parked = true; cancelAnimationFrame(raf); }
      } else settleN = 0;
    }
  }
  function wake() {
    while (images[prefix]) prefix++;
    if (!started && prefix > 0) {                          // first drawable frame → the splash is alive
      started = true;
      try { onLive(); } catch {}
      const t = liveTarget(); pose.cx = t.cx; pose.cy = t.cy; pose.cap = t.cap; pose.up = t.up || 1;   // snap to the current pose…
      draw(0);                                             // …and paint frame 0 NOW (instant first paint, even before rAF)
      // ALWAYS run the sprite cycle — a contained in-place loop, like a loading spinner. Under reduced motion
      // the loop SNAPS the pose (no glide across the screen), so the emblem still LIVES without jarring motion.
      // (Gating the whole loop on reduced motion was the "static emblem on mobile" bug: many phones enable it.)
      raf = requestAnimationFrame(loop);
    }
  }
  // KEYING BUDGET: chroma-keying (getImageData) is main-thread work. A warm boot delivers all ~156 frames
  // near-instantly from the κ-store — keying them in one burst hitches the hero float. Queue decoded images
  // and key ≤2 per animation frame instead: the playable prefix still grows far faster than the 25 fps
  // playhead consumes it, and the hero never drops a beat. Frame 0 keys synchronously on arrival (first
  // paint keeps its zero-delay path).
  const keyQ = [];
  let pumping = false;
  function pump() {
    if (!alive) { keyQ.length = 0; pumping = false; return; }
    for (let n = 0; n < 2 && keyQ.length; n++) { const j = keyQ.shift(); images[j.i] = keyBlack(j.img, inkOn); }
    wake();
    if (keyQ.length) requestAnimationFrame(pump); else pumping = false;
  }
  return {
    mode: "2d",
    frame(i, bytes) {
      const img = new Image();
      img.onload = () => { try { URL.revokeObjectURL(img.src); } catch {} if (!alive) return; keyQ.push({ i, img }); if (!pumping) { pumping = true; pump(); } };
      img.onerror = () => { try { URL.revokeObjectURL(img.src); } catch {} };
      img.src = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    },
    pose(name) { target = POSES[name] || POSES.greet; unpark(); if (reducedMotion()) { const t = liveTarget(); pose.cx = t.cx; pose.cy = t.cy; pose.cap = t.cap; pose.up = t.up || 1; if (images[0]) draw(0); } },
    ink(on) { const flip = inkOn !== !!on; inkOn = !!on; return flip && started; },   // true → frames need a re-key (caller replays)
    reset() { images.length = 0; keyQ.length = 0; prefix = 0; t0 = 0; started = false; },
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
  "var pose={cx:0,cy:0,cap:0,up:1},target=null,ink=0;\n" +
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
  " else if(d.t==='pose'){target={cx:d.cx,cy:d.cy,cap:d.cap,up:d.up||1};if(!pose.cap){pose.cx=d.cx;pose.cy=d.cy;pose.cap=d.cap;pose.up=target.up;}if(reduced&&started){pose.cx=d.cx;pose.cy=d.cy;pose.cap=d.cap;pose.up=target.up;render(0,0,0.016,0);}}\n" +
  " else if(d.t==='ink'){ink=d.on?1:0;if(reduced&&started)render(0,0,0.016,0);}\n" +
 " else if(d.t==='resize'){var nw=Math.max(1,Math.round(d.w*d.dpr)),nh=Math.max(1,Math.round(d.h*d.dpr));if(canvas&&(canvas.width!==nw||canvas.height!==nh)){dpr=d.dpr;cw=d.w;chh=d.h;canvas.width=nw;canvas.height=nh;}}\n" +
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
  " render(idx,idx,dt,0);\n" +
  "}\n" +
  "function render(idx,nxt,dt,phase){\n" +
  " var a=tex[idx];if(!a||!ctx||!pipeline)return;\n" +
  " var b=tex[nxt]||a;\n" +
  " if(target){var k=reduced?1:Math.min(1,(dt||0.016)*5.5);\n" +
  "  pose.cx+=(target.cx-pose.cx)*k;pose.cy+=(target.cy-pose.cy)*k;pose.cap+=(target.cap-pose.cap)*k;pose.up+=((target.up||1)-pose.up)*k;}\n" +
  " var s=Math.min(pose.up||1,pose.cap/Math.max(a.w,a.h));\n" +
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
  const dpr = () => emblemDpr();                          // tier-capped (holo-device-tier): high=2, ultra=3
  worker.postMessage({ t: "init", canvas: off, w: innerWidth, h: innerHeight, dpr: dpr(), reduced: reducedMotion() }, [off]);
  worker.addEventListener("message", (e) => { if (e.data && e.data.t === "first") { try { onLive(); } catch {} } });
  let target = POSES.boot, watch = 0, last = null;
  const send = () => {
    const p = target, cw = innerWidth, ch = innerHeight, vmin = Math.min(cw, ch);
    let t = { cx: cw * p.cx, cy: ch * p.cy, cap: vmin * p.cap, up: p.up || 1 };
    if (p.anchor) { t = anchorTarget(overlay, p, t); const o = posOffset(); t = { cx: t.cx + o.x, cy: t.cy + o.y, cap: t.cap, up: 1 }; }
    if (!last || Math.abs(t.cx - last.cx) > 0.25 || Math.abs(t.cy - last.cy) > 0.25 || Math.abs(t.cap - last.cap) > 0.25 || Math.abs((t.up || 1) - (last.up || 1)) > 0.001) {
      last = t;
      try { worker.postMessage({ t: "pose", cx: t.cx, cy: t.cy, cap: t.cap, up: t.up || 1 }); } catch {}
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
  try { if (!localStorage.getItem(KEY)) { if (state.theme === DEFAULT_THEME && !state.firstFrame) { state.firstFrame = DEFAULT_FF; state.ffKeyed = true; } writeState(state); } } catch {}
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
      beat("emblem-alive");
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
    // The emblem IS the identity mark from the very first instant — the enclosed avatar circle never
    // paints while a splash is on (any device). Frame-0 below makes the slot's paint immediate, so
    // claiming it here never leaves it empty; only an explicit "Off" pick brings the circle back.
    overlay.classList.add("hlp-anchor");
    // INSTANT first paint (zero network): feed the cached/seeded frame-0 the moment we start — so a first-EVER
    // boot's emblem materialises with the module (no wait for the cold CDN), then the streamed frames continue
    // the animation. The default theme falls back to the embedded DEFAULT_FF even before it is sealed.
    let seeded = false;
    try {
      const s = readState();
      const ff = (s.theme === theme && s.firstFrame) ? s.firstFrame : (theme === DEFAULT_THEME ? DEFAULT_FF : null);
      if (ff) { const b = Uint8Array.from(atob(ff.split(",").pop()), (c) => c.charCodeAt(0)); if (b.length) { player.frame(0, b); seeded = true; } }
    } catch {}
    loadFrames(theme, (i, bytes) => { if (my === gen) player.frame(i, bytes); }, () => my !== gen)
      .catch(() => { if (my === gen && state.on && !seeded) { layer.classList.remove("on"); overlay.classList.remove("hlp-anchor"); } });   // NOTHING painted (no frame-0, no stream) → wallpaper + circle return; a seeded frame-0 keeps the emblem standing
  }
  // the host baseline (app.html) may have painted a synchronous frame-0 still; remove it once live
  function dropBaseline() { try { const b = document.getElementById("hl-plymouth-base"); if (b) { b.style.opacity = "0"; setTimeout(() => b.remove(), 900); } } catch {} }

  // THE BOOT BEAT — lean, readiness-gated. The panel rises the instant the emblem is alive, after a crisp
  // minimum flash and NEVER longer than a hard cap — no fixed multi-second wait. Skippable by any tap/key.
  // A supercomputer is ready when it is ready, not on a timer. Counted from the baseline's 0-ms frame
  // (window.__hlBootT0) so the beat measures REAL boot latency, not module-load time.
  // A deliberate HERO: the emblem holds large, dead-centre, for ~5s — a real machine powering up — THEN
  // shrinks slightly and glides into the identity slot as the ENTIRE login (panel · Manifesto · wordmark ·
  // the ⋯ door) reveals in one beat. Runs on every device (the hold is stillness, not motion — under
  // reduced motion the pose SNAPS instead of gliding, so nothing sweeps the screen). Skippable by any
  // tap/key; the hard cap protects a slow network from holding the machine hostage.
  // LOCK HANDSHAKE (power symmetry, B7): a same-tab return from Lock & Sign Out plays a SHORT hero (~1.2s)
  // — re-entering mid-sitting must be light; only a true cold boot earns the full five seconds. The power
  // ritual stamps the flag (sessionStorage = per-tab, exactly the right lifetime); reading it clears it.
  let shortHero = false;
  try { shortHero = sessionStorage.getItem("holo.ceremony.short") === "1"; if (shortHero) sessionStorage.removeItem("holo.ceremony.short"); } catch {}
  // RETURNING = RECOGNITION (INSTANT-RETURN W1, same law as ARRIVAL A3): an operator or guest this device
  // already knows re-enters on the SHORT hero too — the full five seconds is the FIRST impression; the
  // second visit is a greeting, not a ceremony. Skippability and the hard cap are unchanged.
  // RETURNING = FAST (by request: as quick as possible for returning users): a device we already know
  // re-enters on the SHORT hero (~1.2s) — the full 3-second hero is the FIRST impression only. First-timers
  // still get the cinematic 3s; the same-tab Lock & Sign Out handshake stays short too.
  try { if (!shortHero && (localStorage.getItem("holo.lastOperator") || localStorage.getItem("holo-messenger/id-secret"))) shortHero = true; } catch {}
  const BOOT_MIN = shortHero ? 1200 : 3000, BOOT_MAX = shortHero ? 1600 : 3400;
  // PHONE-INSTANT: a returning device on a PHONE compresses the hold further (500–900ms from the seed's
  // first paint) — with a warm SW the hero effectively reveals at once. First visit keeps the full hold;
  // desktop keeps the canonical clock above (witness law L2) on every path.
  let _phFast = false; try { _phFast = shortHero && document.documentElement.hasAttribute("data-holo-phone"); } catch {}
  const HOLD_MIN = _phFast ? 500 : BOOT_MIN, HOLD_MAX = _phFast ? 900 : BOOT_MAX;
  // FIRST-PACKET (P1): the hero clock starts at the SEED's first paint (sessionStorage handshake) — the
  // welcome already watched during the network chain counts toward the hold. Consume-on-read; a stamp that
  // is stale (>15s) or from the future is ignored, so a direct app.html open keeps today's clock exactly.
  const bootT0 = (() => { try {
    let t0 = window.__hlBootT0 || Date.now();
    try { const s = Number(sessionStorage.getItem("holo.ceremony.t0")); sessionStorage.removeItem("holo.ceremony.t0");
      if (s > 0 && s <= t0 && (t0 - s) < 15000) t0 = s; } catch {}
    return t0;
  } catch { return Date.now(); } })();
  let bootDone = false, bootTimer = 0;
  const endBoot = () => {
    if (bootDone) return; bootDone = true; clearTimeout(bootTimer);
    try { overlay.classList.remove("hl-boot"); overlay.classList.add("hlp-reveal"); if (layer) { layer.classList.add("greet"); player.pose("greet"); } dropBaseline(); } catch {}
    beat("gate-reveal");
  };
  const panelEl = overlay.querySelector("#holo-login-panel");
  const bootable = overlay.classList.contains("hl-boot") || !panelEl || !panelEl.childElementCount;
  if (state.on && bootable) {
    overlay.classList.add("hl-boot");
    // the module OWNS the beat from here — the host baseline's module-never-arrived fallback must not
    // lift hl-boot mid-hero (it fired at 1.5s and popped the panel while the emblem was still centre-stage)
    try { clearTimeout(window.__hlBootFallback); } catch {}
    bootTimer = setTimeout(endBoot, Math.max(250, HOLD_MAX - (Date.now() - bootT0)));   // hard cap — never stall on a slow network
    onEmblemLive = () => { if (bootDone) return; clearTimeout(bootTimer); bootTimer = setTimeout(endBoot, Math.max(0, HOLD_MIN - (Date.now() - bootT0))); };   // alive → hold the hero, then one reveal
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
    complete() { try { endBoot(); if (layer) { layer.classList.remove("verify"); layer.classList.add("done"); } beat("boot-complete"); setTimeout(() => api.destroy(), 900); } catch {} },   // overlay is removed right after — stop the loop with it
    destroy() { gen++; try { player && player.destroy(); } catch {} },
  };
  try { window.HoloPlymouth = { open: () => btn.click(), set: (n) => api.setTheme(n), themes: CATALOG.map((t) => t.name), state: readState, mode: () => (player ? player.mode() : "none") }; } catch {}
  return api;
}
export default attachPlymouth;
