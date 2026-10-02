// holo-wallpaper-gallery.mjs — the NATIVE CEF wallpaper gallery, ported 1:1 from the OS shell
// (holo-os/system/os/usr/share/frame/shell-main.mjs → openWallpapers + its κ plumbing, CSS from shell.html).
// Same look, same preloaded set (Original · UOR · Developer · Asanoha · the curated Unsplash five), same
// behavior: every wallpaper is a content-addressed object sealed into the SAME durable κ store the desktop
// uses (/_shared/holo-store.js → IndexedDB "holo/kappa"), and the gallery state is the SAME localStorage row
// ("holo:wallpapers") — so wallpapers you import here appear in the native desktop's gallery and vice versa.
//
// What the host provides: openWallpaperGallery({ apply, current }) —
//   apply(item, { persistValue, objURL })  called on every pick; persistValue is the durable, cross-surface
//     reference (a local /usr path for seeded photos, a κ route when the origin resolves /.holo, else the
//     import's source URL). The messenger writes it to holo.theme.v1 so home + chats + desktop + sign-in
//     all repaint (the proven shared-wallpaper chain).
//   current() → the persistValue currently worn, so the matching tile shows the ✓.
// Rendering of the procedural κ-seeds (Original/Developer/Asanoha) stays a DESKTOP concern — picking one
// here still selects it in holo:wallpapers (the native desktop adopts it), and apply() is told kind≠image.

const WALL_KEY = "holo:wallpapers", WALL_DIR = new URL("../../usr/share/wallpapers/", import.meta.url).pathname, SEED_V = 13;
const _wallMaxDim = (Math.max(screen.width || 0, screen.height || 0) || 1920) * (window.devicePixelRatio || 1);
const WALL_SEED = WALL_DIR + (_wallMaxDim <= 2560 ? "uor-2560.jpg" : "uor-8k.jpg");
const WALL_DEPTH = WALL_DIR + "uor-depth.png";
const CURATED = [
  { file: "earth-nasa.jpg",    name: "Crescent Earth", by: "NASA",             byLink: "https://unsplash.com/@nasa" },
  { file: "galaxy.jpg",        name: "Galaxy",         by: "Tiago Ferreira",   byLink: "https://unsplash.com/@tiago_f_ferreira" },
  { file: "aurora.jpg",        name: "Aurora",         by: "Lightscape",       byLink: "https://unsplash.com/@lightscape" },
  { file: "lioness.jpg",       name: "Lioness",        by: "Jaliya Rasaputra", byLink: "https://unsplash.com/@jaliya" },
  { file: "mountain-lake.jpg", name: "Mountain Lake",  by: "Luca Bravo",       byLink: "https://unsplash.com/@lucabravo" },
];
const ORIGINAL_DESC = JSON.stringify({ "@type": "hosc:Wallpaper", style: "original", name: "Original" });
const DEV_DESC = JSON.stringify({ "@type": "hosc:Wallpaper", style: "developer", name: "Developer" });
const ASANOHA_DESC = JSON.stringify({ "@type": "hosc:Wallpaper", style: "asanoha", name: "Asanoha" });

// ── the SAME durable κ store the native shell builds (holo-store.js · IDB "holo/kappa" · sha256 axis) ──
let _storeP = null;
function store() {
  if (_storeP) return _storeP;
  _storeP = import("../../_shared/holo-store.js").then(({ makeStore, idbBackend }) => makeStore({
    axis: "sha256", backend: idbBackend(),
    hash: async (u8) => { const d = await crypto.subtle.digest("SHA-256", u8); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); },
  })).catch(() => {   // store module unreachable → same contract in-memory (session-scoped, never breaks the gallery)
    const m = new Map();
    const hash = async (u8) => { const d = await crypto.subtle.digest("SHA-256", u8); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); };
    return { async put(b) { const k = "sha256:" + await hash(b); m.set(k, b); return k; }, async get(k) { return m.get(k) || null; } };
  });
  return _storeP;
}
const putWall = async (b) => (await store()).put(b instanceof Uint8Array ? b : new TextEncoder().encode(b));

const _wallURL = new Map();   // κ → objectURL (revoke-free for the session)
const wallRead = () => { try { const s = JSON.parse(localStorage.getItem(WALL_KEY)); if (s && Array.isArray(s.items) && s.items.length) return s; } catch {} return null; };
const wallWrite = (s) => { try { localStorage.setItem(WALL_KEY, JSON.stringify(s)); } catch {} };
const liveOn = () => { try { return localStorage.getItem("holo:wall-live") === "1"; } catch { return false; } };
const parallaxOn = () => { try { return localStorage.getItem("holo:wall-parallax") === "1"; } catch { return false; } };

// self-healing fetch: durable κ store first; absent bytes re-fetch the bundled source and re-seal (Law L5)
async function wallBytes(item) {
  let bytes = await (await store()).get(item.k); if (bytes) return bytes;
  if (item.src) { try { const r = await fetch(item.src, { cache: "force-cache" }); if (r.ok) { bytes = new Uint8Array(await r.arrayBuffer()); await putWall(bytes); return bytes; } } catch {} }
  return null;
}
async function wallObjURL(item) {
  if (_wallURL.has(item.k)) return _wallURL.get(item.k);
  const bytes = await wallBytes(item); if (!bytes) return null;
  const url = URL.createObjectURL(new Blob([bytes], { type: item.mime || "image/png" })); _wallURL.set(item.k, url); return url;
}
async function seedItems({ curated = true } = {}) {
  const items = [{ k: await putWall(ORIGINAL_DESC), name: "Original", kind: "gradient", seed: true }];
  try { const r = await fetch(WALL_SEED, { cache: "force-cache" });
    if (r.ok) { const buf = new Uint8Array(await r.arrayBuffer()); items.push({ k: await putWall(buf), name: "UOR", kind: "image", mime: "image/jpeg", src: WALL_SEED, depthSrc: WALL_DEPTH, seed: true }); } } catch {}
  try { items.push({ k: await putWall(DEV_DESC), name: "Developer", kind: "grid", seed: true }); } catch {}
  try { items.push({ k: await putWall(ASANOHA_DESC), name: "Asanoha", kind: "shader", seed: true }); } catch {}
  if (curated) for (const w of CURATED) await sealCurated(items, w);
  return items;
}
async function sealCurated(items, w) {
  if (items.some((i) => i.seed && i.name === w.name)) return false;
  try { const r = await fetch(WALL_DIR + w.file, { cache: "force-cache" });
    if (r.ok) { const buf = new Uint8Array(await r.arrayBuffer()); items.push({ k: await putWall(buf), name: w.name, kind: "image", mime: "image/jpeg", src: WALL_DIR + w.file, depthSrc: WALL_DIR + w.file.replace(/\.jpg$/, "-depth.png"), by: w.by, byLink: w.byLink, seed: true }); return true; } } catch {}
  return false;
}
async function ensureCurated(s) {
  let added = false;
  for (const w of CURATED) { if (await sealCurated(s.items, w)) added = true; }
  if (added) wallWrite(s);
  return s;
}
const defaultWallK = (items) => (items.find((i) => i.seed && i.name === "UOR") || items[1] || items[0]).k;
async function seedWall() { const items = await seedItems({ curated: false }); const s = { seedV: SEED_V, current: defaultWallK(items), items }; wallWrite(s); return s; }
async function ensureWall() {
  const cur = wallRead(); if (!cur) return await seedWall();
  if (cur.seedV === SEED_V) return cur;
  const fresh = await seedItems({ curated: false });
  const seen = new Set(fresh.map((i) => i.k));
  const userItems = cur.seedV ? (cur.items || []).filter((i) => !i.seed && !seen.has(i.k)) : [];
  const items = [...fresh, ...userItems];
  const keptOwnPick = cur.seedV && cur.current && (cur.items || []).some((i) => i.k === cur.current && !i.seed) && items.some((i) => i.k === cur.current);
  const current = keptOwnPick ? cur.current : defaultWallK(items);
  const s = { seedV: SEED_V, current, items }; wallWrite(s); return s;
}
// Pre-warm off the click path: the import itself pays the module parse; this pays the first-run κ-seed
// sealing (fetch + hash + IndexedDB of the seed/curated set). After it, openWallpaperGallery()'s own
// ensureCurated(ensureWall()) is a pure cache hit — "Change wallpaper…" opens instantly. Idempotent.
let _warmed = null;
export function warmWallpaperGallery() {
  return (_warmed = _warmed || ensureWall().then(ensureCurated).then(() => true).catch(() => { _warmed = null; return false; }));
}

// the durable cross-surface reference for a pick: local path → κ route (when this origin resolves /.holo) → source URL
let _kappaRouteOk = null;
async function kappaRouteWorks(k) {
  if (_kappaRouteOk !== null) return _kappaRouteOk;
  try { const hex = String(k).split(":").pop(); const r = await fetch(new URL("../../.holo/sha256/", import.meta.url).pathname + hex, { method: "HEAD" }); _kappaRouteOk = r.ok; } catch { _kappaRouteOk = false; }
  return _kappaRouteOk;
}
async function persistValueFor(item) {
  if (item.kind !== "image") return null;
  if (item.src) return item.src;
  if (await kappaRouteWorks(item.k)) return item.k;   // the host's κ→/.holo resolver route
  return item.remote || null;
}

// ── styles: the shell.html wallpaper-gallery CSS verbatim, scoped under .holo-wallgal (the scrim) ──
const CSS = `
.holo-wallgal { position: fixed; inset: 0; z-index: 230; background: #010409aa; display: block;
  --accent:#1f6feb; --fs-meta:0.75rem; --win-font:system-ui,-apple-system,"Segoe UI",sans-serif; --holo-radius:12px; --holo-text-sm:0.813rem; }
.holo-wallgal .sheet { position: absolute; left: 50%; top: 18%; transform: translateX(-50%); width: min(40rem, 92vw);
  background: #0d1117; border: 1px solid #30363d; border-radius: var(--holo-radius, 14px); box-shadow: 0 24px 60px #000a; overflow: hidden; }
.holo-wallgal .sheet.wall-sheet { width: min(56rem, 94vw); top: 9%; max-height: 82vh; overflow: hidden; }
.holo-wallgal .wall-srch { display: flex; gap: 8px; align-items: center; padding: 2px 16px 10px; position: sticky; top: 0; }
.holo-wallgal .wall-srch input { flex: 1; background: #010409; border: 1px solid #21262d; border-radius: 999rem; padding: 9px 14px; color: #c9d1d9; font: inherit; outline: none; }
.holo-wallgal .wall-srch input:focus { border-color: var(--accent, #1f6feb); }
.holo-wallgal .wall-srch .us { font: var(--fs-meta) ui-monospace, monospace; color: #6e7681; white-space: nowrap; }
.holo-wallgal .wall-srch .us a { color: #58a6ff; text-decoration: none; }
.holo-wallgal .wall-chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 13px; }
.holo-wallgal .wall-chip { border: 1px solid #21262d; background: #0d1117; color: #9fb3d0; border-radius: 999rem; padding: 6px 14px; font: var(--fs-meta) system-ui, sans-serif; cursor: pointer; transition: border-color .12s, color .12s, background .12s; }
.holo-wallgal .wall-chip:hover { border-color: var(--accent, #1f6feb); color: #eef3fb; background: color-mix(in srgb, var(--accent, #1f6feb) 12%, transparent); }
.holo-wallgal .wall-chip.on { border-color: var(--accent, #1f6feb); color: #fff; background: color-mix(in srgb, var(--accent, #1f6feb) 22%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent, #1f6feb) 40%, transparent); }
.holo-wallgal .wall-tile.ready { border-color: color-mix(in srgb, #3fb950 55%, #21262d); }
.holo-wallgal .wall-tile.ready .wall-k { color: #3fb950; }
.holo-wallgal .wall-tile.skel { pointer-events: none; }
.holo-wallgal .wall-tile.skel .wall-prev, .holo-wallgal .wall-tile.skel .wall-name, .holo-wallgal .wall-tile.skel .wall-k { background: linear-gradient(100deg, #0d1117 28%, #1b222c 50%, #0d1117 72%); background-size: 200% 100%; animation: holoWallShimmer 1.15s ease-in-out infinite; }
.holo-wallgal .wall-tile.skel .wall-name { display: block; height: .72em; width: 62%; border-radius: 4px; }
.holo-wallgal .wall-tile.skel .wall-k { display: block; height: .6em; width: 38%; border-radius: 4px; }
@keyframes holoWallShimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .holo-wallgal .wall-tile.skel .wall-prev, .holo-wallgal .wall-tile.skel .wall-name, .holo-wallgal .wall-tile.skel .wall-k { animation: none; } }
.holo-wallgal .wall-note { font: var(--fs-meta)/1.5 system-ui, sans-serif; color: #8b949e; padding: 0 18px 10px; }
.holo-wallgal .wall-note a { color: #58a6ff; } .holo-wallgal .wall-note b { color: #c9d1d9; }
.holo-wallgal .wall-note input { width: min(20rem, 55%); margin-left: 6px; background: #010409; border: 1px solid #21262d; border-radius: 8px; padding: 6px 10px; color: #c9d1d9; font: inherit; }
.holo-wallgal .wall-note button { margin-left: 6px; background: #238636; border: 1px solid #2ea043; color: #fff; border-radius: 8px; padding: 6px 12px; cursor: pointer; font: inherit; }
.holo-wallgal .wall-secq { font: 600 var(--fs-meta) system-ui, sans-serif; color: #8b949e; text-transform: uppercase; letter-spacing: .04em; padding: 4px 18px; }
.holo-wallgal .wall-prev .wall-by { position: absolute; left: 0; right: 0; bottom: 0; padding: 4px 8px; font: var(--fs-meta) system-ui, sans-serif; color: #eaf2ff; background: linear-gradient(transparent, #000a); opacity: 0; transition: opacity .12s; }
.holo-wallgal .wall-tile:hover .wall-by { opacity: 1; }
.holo-wallgal .wall-busy { grid-column: 1 / -1; padding: 18px; text-align: center; color: #8b949e; font: var(--holo-text-sm, 0.813rem) system-ui, sans-serif; }
.holo-wallgal .sheet.wall-sheet.drop { outline: 2px dashed var(--accent, #1f6feb); outline-offset: -8px; }
.holo-wallgal .wall-head { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #21262d; }
.holo-wallgal .wall-live { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; border: 0; background: none; font: var(--fs-meta) system-ui, sans-serif; color: #9fb3d0; cursor: pointer; user-select: none; }
.holo-wallgal .wall-live .sw { width: 34px; height: 18px; border-radius: 999rem; background: #30363d; position: relative; transition: background .15s; flex: 0 0 auto; }
.holo-wallgal .wall-live .sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #c9d1d9; transition: transform .15s, background .15s; }
.holo-wallgal .wall-live.on .sw { background: var(--accent, #1f6feb); } .holo-wallgal .wall-live.on .sw::after { transform: translateX(16px); background: #fff; }
.holo-wallgal .wall-title { font: 600 1.05rem var(--win-font); color: #e6edf3; }
.holo-wallgal .wall-sub { font: var(--holo-text-sm, 1rem) var(--win-font); color: #6e7681; }
.holo-wallgal .wall-x { margin-left: 12px; width: 30px; height: 30px; border: 0; border-radius: 50%; background: #21262d; color: #c9d1d9; cursor: pointer; font-size: 16px; }
.holo-wallgal .wall-x:hover { background: #30363d; }
.holo-wallgal .wall-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: 14px; padding: 16px; max-height: 66vh; overflow: auto; }
.holo-wallgal .wall-tile { display: flex; flex-direction: column; padding: 0; border: 1px solid #21262d; border-radius: var(--holo-radius, 12px); overflow: hidden; cursor: pointer; background: #0b0f17; color: inherit; text-align: left; transition: transform .1s, border-color .1s; }
.holo-wallgal .wall-tile:hover { transform: translateY(-2px); border-color: var(--accent, #1f6feb); }
.holo-wallgal .wall-tile.sel { border-color: var(--accent, #1f6feb); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent, #1f6feb) 55%, transparent); }
.holo-wallgal .wall-prev { height: 130px; background-color: #010409; background-size: cover; background-position: center; position: relative; }
.holo-wallgal .wall-prev.orig { background-image:
    radial-gradient(700px 480px at 72% -12%, rgba(31,111,235,.45), transparent 60%),
    radial-gradient(520px 420px at -8% 112%, rgba(45,212,191,.3), transparent 60%),
    radial-gradient(rgba(255,255,255,.10) 1px, transparent 1px), linear-gradient(#0a0e16, #05070c);
  background-size: auto, auto, 16px 16px, auto; }
.holo-wallgal .wall-prev.space { background:
    radial-gradient(60% 50% at 70% 20%, rgba(120,90,255,.35), transparent 70%),
    radial-gradient(40% 40% at 25% 80%, rgba(45,160,255,.3), transparent 70%),
    radial-gradient(1px 1px at 30% 40%, #fff, transparent), radial-gradient(1px 1px at 60% 60%, #fff, transparent),
    radial-gradient(1px 1px at 80% 30%, #cde, transparent), linear-gradient(#05060f, #01020a); position: relative; }
.holo-wallgal .wall-prev.dev { background-color: #0a0b0f; background-image:
    linear-gradient(90deg, rgba(255,255,255,.085) 1px, transparent 1px),
    linear-gradient(rgba(255,255,255,.085) 1px, transparent 1px),
    radial-gradient(120% 90% at 50% -12%, rgba(108,99,255,.22), transparent 62%);
  background-size: 22px 22px, 22px 22px, cover; background-position: center; position: relative; }
.holo-wallgal .wall-prev .wall-badge { position: absolute; left: 8px; bottom: 8px; font: 600 var(--holo-text-sm, 1rem) ui-monospace, monospace; color: #cfe3ff; background: #0008; padding: 2px 7px; border-radius: 999rem; }
.holo-wallgal .wall-prev.add { display: grid; place-content: center; background: #0b0f17; }
.holo-wallgal .wall-prev.add span { font-size: 30px; color: #6e7681; }
.holo-wallgal .wall-tile.sel .wall-prev::after { content: "\\2713"; position: absolute; top: 8px; right: 8px; width: 22px; height: 22px; border-radius: 50%; background: var(--accent, #1f6feb); color: #fff; display: grid; place-content: center; font-size: 16px; }
.holo-wallgal .wall-meta { padding: 9px 11px; display: flex; flex-direction: column; gap: 2px; }
.holo-wallgal .wall-name { font: 600 var(--holo-text-sm, 1rem) var(--win-font); color: #e6edf3; }
.holo-wallgal .wall-k { font: var(--holo-text-sm, 1rem) ui-monospace, monospace; color: #3fb950; }
.holo-wallgal .wall-toast { position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%); background: #161b22; color: #e6edf3; border: 1px solid #30363d; border-radius: 999rem; padding: 8px 16px; font: var(--holo-text-sm, 0.875rem) var(--win-font); box-shadow: 0 10px 30px #000a; z-index: 1; animation: holoWallToast 2.4s ease both; pointer-events: none; }
@keyframes holoWallToast { 0% { opacity: 0; transform: translate(-50%, 8px); } 10%, 82% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; } }
`;
function ensureCSS() {
  if (document.getElementById("holo-wallgal-css")) return;
  const st = document.createElement("style"); st.id = "holo-wallgal-css"; st.textContent = CSS; document.head.appendChild(st);
}

export async function openWallpaperGallery(opts = {}) {
  ensureCSS();
  const apply = opts.apply || (() => {});
  const currentValue = (typeof opts.current === "function" ? opts.current() : "") || "";
  const s = await ensureCurated(await ensureWall());
  // the ✓ follows what this surface actually WEARS: match the host's current value back to an item
  let selK = s.current;
  if (currentValue) { for (const it of s.items) { if (it.src === currentValue || it.k === currentValue || it.remote === currentValue) { selK = it.k; break; } } }

  const scrim = document.createElement("div"); scrim.className = "holo-wallgal";
  const sheet = document.createElement("div"); sheet.className = "sheet wall-sheet";
  const toast = (msg) => { const t = document.createElement("div"); t.className = "wall-toast"; t.textContent = msg; scrim.appendChild(t); setTimeout(() => t.remove(), 2400); };
  const head = document.createElement("div"); head.className = "wall-head";
  head.innerHTML = '<span class="wall-title">Wallpaper</span><span class="wall-sub">every wallpaper is a content-addressed object · did:holo (Law L5)</span>';
  const live = document.createElement("button"); live.type = "button"; live.className = "wall-live" + (liveOn() ? " on" : ""); live.title = "Live depth & motion — animated 2.5-D parallax on the native desktop (off = crisp static image)";
  live.innerHTML = '<span class="sw"></span><span>Live depth</span>';
  live.onclick = () => { const on = !liveOn(); try { localStorage.setItem("holo:wall-live", on ? "1" : "0"); } catch {} live.classList.toggle("on", on); toast(on ? "Live depth & motion on" : "Static wallpaper"); };
  head.appendChild(live);
  const par = document.createElement("button"); par.type = "button"; par.className = "wall-live" + (parallaxOn() ? " on" : ""); par.title = "Parallax — the wallpaper drifts with your pointer for depth (off = still)";
  par.innerHTML = '<span class="sw"></span><span>Parallax</span>';
  par.onclick = () => { const on = !parallaxOn(); try { localStorage.setItem("holo:wall-parallax", on ? "1" : "0"); } catch {} par.classList.toggle("on", on); toast(on ? "Parallax on" : "Parallax off"); };
  head.appendChild(par);
  const x = document.createElement("button"); x.className = "wall-x"; x.textContent = "✕"; head.appendChild(x);
  const grid = document.createElement("div"); grid.className = "wall-grid";
  // ── Unsplash discovery: search → import any photo, sealed to its own κ wallpaper ──
  const srch = document.createElement("div"); srch.className = "wall-srch";
  const sIn = document.createElement("input"); sIn.type = "search"; sIn.placeholder = "Search wallpapers — nature, cities, space…"; sIn.spellcheck = false;
  const sCredit = document.createElement("span"); sCredit.className = "us"; sCredit.textContent = "free · sealed to κ";
  srch.append(sIn, sCredit);
  const note = document.createElement("div"); note.className = "wall-note"; note.style.display = "none";
  const usLabel = document.createElement("div"); usLabel.className = "wall-secq"; usLabel.style.display = "none"; usLabel.textContent = "Unsplash results";
  const usGrid = document.createElement("div"); usGrid.className = "wall-grid"; usGrid.style.display = "none";
  const mineLabel = document.createElement("div"); mineLabel.className = "wall-secq"; mineLabel.style.display = "none"; mineLabel.textContent = "Your wallpapers";
  const chips = document.createElement("div"); chips.className = "wall-chips";
  const CAT_Q = { Nature: "nature landscape", Space: "galaxy nebula space", Animals: "wildlife animal", Cities: "city skyline", Patterns: "abstract pattern texture", Minimal: "minimal gradient" };
  ["Nature", "Space", "Animals", "Cities", "Patterns", "Minimal"].forEach((cat) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "wall-chip"; b.textContent = cat;
    b.onclick = () => { sIn.value = cat; runSearch(CAT_Q[cat] || cat, b); };
    chips.appendChild(b);
  });
  sheet.append(head, srch, chips, note, usLabel, usGrid, mineLabel, grid); scrim.appendChild(sheet); document.body.appendChild(scrim);
  const done = () => { scrim.remove(); document.removeEventListener("keydown", esc, true); };
  const esc = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); done(); } };
  document.addEventListener("keydown", esc, true);
  scrim.addEventListener("pointerdown", (ev) => { if (ev.target === scrim) done(); });
  x.onclick = done;

  // a pick: persist selection in the SHARED gallery state + hand the durable value to the host
  async function setWall(item) {
    s.current = item.k; selK = item.k; wallWrite(s);
    const persistValue = await persistValueFor(item);
    const objURL = item.kind === "image" ? await wallObjURL(item) : null;
    try { apply(item, { persistValue, objURL }); } catch {}
  }

  // ── Unsplash: key (one-time, serverless) · search · import → seal κ ──
  const UNS_KEY = "holo:unsplash-key";
  const uKey = () => { try { return localStorage.getItem(UNS_KEY) || ""; } catch { return ""; } };
  function askKey(prefix) {
    note.style.display = ""; note.innerHTML = (prefix || "") + 'Unsplash needs a free <b>Access Key</b> — <a href="https://unsplash.com/oauth/applications" target="_blank" rel="noopener">create an app ↗</a>, then paste it:';
    const ki = document.createElement("input"); ki.type = "text"; ki.placeholder = "Unsplash Access Key";
    const kb = document.createElement("button"); kb.textContent = "Save";
    const save = () => { const v = (ki.value || "").trim(); if (!v) return; try { localStorage.setItem(UNS_KEY, v); } catch {} note.style.display = "none"; note.innerHTML = ""; if (sIn.value.trim()) runSearch(sIn.value.trim()); };
    kb.onclick = save; ki.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
    note.append(ki, kb); ki.focus();
  }
  async function fetchBytes(url) {
    try { const r = await fetch(url, { mode: "cors" }); if (r.ok) return new Uint8Array(await r.arrayBuffer()); } catch {}
    try { const r = await fetch("/web?url=" + encodeURIComponent(url)); if (r.ok) return new Uint8Array(await r.arrayBuffer()); } catch {}
    return null;
  }
  let searchSeq = 0, activeChip = null;
  const safe = (t) => (t || "").replace(/[<>&]/g, "");
  function setChip(el) { if (activeChip) activeChip.classList.remove("on"); activeChip = el || null; if (el) el.classList.add("on"); }
  function showSkeleton(n) { let h = ""; for (let i = 0; i < (n || 9); i++) h += '<div class="wall-tile skel"><div class="wall-prev"></div><div class="wall-meta"><span class="wall-name"></span><span class="wall-k"></span></div></div>'; usGrid.innerHTML = h; }
  // keyless, themed source — Wikimedia Commons (open API, CORS); κ-memoized when HoloCompute is present
  async function commonsSearch(q, n) {
    const fetchPage = async () => {
      const url = "https://commons.wikimedia.org/w/api.php?origin=*&format=json&action=query&generator=search"
        + "&gsrsearch=" + encodeURIComponent(q + " filetype:bitmap") + "&gsrnamespace=6&gsrlimit=" + (n || 30)
        + "&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=560";
      const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const pages = (j.query && j.query.pages) ? Object.values(j.query.pages) : [];
      return pages.map((p) => {
        const ii = p.imageinfo && p.imageinfo[0]; if (!ii || !ii.thumburl) return null;
        if (ii.width && ii.height && ii.width < ii.height * 1.1) return null;           // landscape only
        const md = ii.extmetadata || {};
        const by = ((md.Artist && md.Artist.value) || "Wikimedia").replace(/<[^>]+>/g, "").trim().slice(0, 40) || "Wikimedia";
        return { src: "commons", thumb: ii.thumburl, full: ii.url, name: (p.title || "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""), by };
      }).filter(Boolean);
    };
    try { if (window.HoloCompute) return await window.HoloCompute.memo(["wall-commons-v2", q, n || 30], fetchPage); } catch (e) {}
    return fetchPage();
  }
  async function unsplashSearch(q, key) {
    const url = "https://api.unsplash.com/search/photos?per_page=24&orientation=landscape&content_filter=high&query=" + encodeURIComponent(q) + "&client_id=" + encodeURIComponent(key);
    const r = await fetch(url);
    if (r.status === 401 || r.status === 403) return "BADKEY";
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    return (data.results || []).map((ph) => ({ src: "unsplash", raw: ph }));
  }
  async function runSearch(q, chipEl) {
    const seq = ++searchSeq; setChip(chipEl);
    usLabel.style.display = ""; mineLabel.style.display = ""; usGrid.style.display = "";
    usLabel.textContent = "Results · " + q; showSkeleton();
    const key = uKey();
    try {
      let items;
      if (key) {
        items = await unsplashSearch(q, key);
        if (items === "BADKEY") { askKey("That key was rejected — browsing free photos instead. "); items = null; }
        else usLabel.textContent = "Unsplash · " + q;
      }
      if (!items) { items = await commonsSearch(q); usLabel.textContent = "Results · " + q; }
      if (seq !== searchSeq) return;
      if (!items.length) { usGrid.innerHTML = '<div class="wall-busy">No photos for “' + safe(q) + '”. Try another search.</div>'; return; }
      usGrid.innerHTML = "";
      for (const it of items) usGrid.appendChild(it.src === "unsplash" ? usTile(it.raw) : genTile(it));
    } catch (e) { if (seq === searchSeq) usGrid.innerHTML = '<div class="wall-busy">Couldn’t load images — check your connection.</div>'; }
  }
  // hover-warm → seal the remote photo into the κ store BEFORE the click (the click then applies a LOCAL κ)
  const _wallPrefetch = new Map();   // url → Promise<κ>
  async function sealFromUrl(url) { const bytes = await fetchBytes(url); if (!bytes) throw new Error("fetch failed"); return await putWall(bytes); }
  function prefetchWall(url) {
    if (!url) return null;
    let f; try { f = window.HoloFidelity && window.HoloFidelity.current(); } catch (e) {}
    if (f && f.prefetch === "off") return null;
    if (_wallPrefetch.has(url)) return _wallPrefetch.get(url);
    const p = sealFromUrl(url).catch(() => { _wallPrefetch.delete(url); return null; });
    _wallPrefetch.set(url, p); return p;
  }
  function genTile(it) {
    const tile = document.createElement("button"); tile.type = "button"; tile.className = "wall-tile";
    const prev = document.createElement("div"); prev.className = "wall-prev"; prev.style.backgroundImage = 'url("' + it.thumb + '")';
    const by = document.createElement("div"); by.className = "wall-by"; by.textContent = "📷 " + (it.by || "Wikimedia"); prev.appendChild(by);
    const meta = document.createElement("div"); meta.className = "wall-meta";
    const nm = document.createElement("span"); nm.className = "wall-name"; nm.textContent = (it.name || "Photo").slice(0, 28);
    const kk = document.createElement("span"); kk.className = "wall-k"; kk.textContent = "import → seal to κ";
    meta.append(nm, kk); tile.append(prev, meta);
    let hoverT = 0;                                                // hover-intent (140ms): warm a deliberate hover, not a sweep
    tile.addEventListener("pointerenter", () => { clearTimeout(hoverT); hoverT = setTimeout(() => { const p = prefetchWall(it.full); if (p) p.then((k) => { if (k && kk.textContent === "import → seal to κ") { kk.textContent = "κ ready ✓"; tile.classList.add("ready"); } }); }, 140); }, { passive: true });
    tile.addEventListener("pointerleave", () => clearTimeout(hoverT), { passive: true });
    tile.onclick = () => importGeneric(it, kk);
    return tile;
  }
  async function importGeneric(it, kk) {
    const prev0 = kk.textContent; kk.textContent = "importing…";
    try {
      let k = null; const pf = _wallPrefetch.get(it.full); if (pf) k = await pf;   // hover already sealed it → local, instant
      if (!k) k = await sealFromUrl(it.full);
      const name = (it.name || "Photo").slice(0, 28);
      if (!s.items.some((i) => i.k === k)) { s.items.push({ k, name, kind: "image", mime: "image/jpeg", by: it.by || null, remote: it.full }); wallWrite(s); }
      await setWall(s.items.find((i) => i.k === k)); draw();
      toast("Imported · fingerprint " + k.split(":").pop().slice(0, 10) + "…");
    } catch (e) { kk.textContent = prev0; toast("Import failed — try another"); }
  }
  function usTile(ph) {
    const tile = document.createElement("button"); tile.type = "button"; tile.className = "wall-tile";
    const prev = document.createElement("div"); prev.className = "wall-prev";
    prev.style.backgroundImage = 'url("' + (ph.urls.small || ph.urls.thumb) + '")';
    const by = document.createElement("div"); by.className = "wall-by"; by.textContent = "📷 " + ((ph.user && ph.user.name) || "Unsplash");
    prev.appendChild(by);
    const meta = document.createElement("div"); meta.className = "wall-meta";
    const nm = document.createElement("span"); nm.className = "wall-name"; nm.textContent = (ph.description || ph.alt_description || "Unsplash photo").slice(0, 28);
    const kk = document.createElement("span"); kk.className = "wall-k"; kk.textContent = "import → seal to κ";
    meta.append(nm, kk); tile.append(prev, meta);
    tile.onclick = () => importUnsplash(ph, kk);
    return tile;
  }
  async function importUnsplash(ph, kk) {
    const key = uKey(); const prev0 = kk.textContent; kk.textContent = "importing…";
    try {
      if (ph.links && ph.links.download_location) fetch(ph.links.download_location + "&client_id=" + encodeURIComponent(key)).catch(() => {});   // Unsplash API: trigger download
      const raw = ph.urls.raw || ph.urls.full || ph.urls.regular;
      const hi = raw + (raw.includes("?") ? "&" : "?") + "w=3840&q=82&fm=jpg&fit=max";
      const bytes = await fetchBytes(hi); if (!bytes) throw new Error("fetch failed");
      const k = await putWall(bytes);
      const name = (ph.description || ph.alt_description || ("Photo · " + ((ph.user && ph.user.name) || "Unsplash"))).slice(0, 28);
      if (!s.items.some((i) => i.k === k)) {
        s.items.push({ k, name, kind: "image", mime: "image/jpeg", by: (ph.user && ph.user.name) || null, byLink: (ph.user && ph.user.links && ph.user.links.html) || null, unsplashId: ph.id, remote: hi });
        wallWrite(s);
      }
      await setWall(s.items.find((i) => i.k === k)); draw();
      toast("Imported · 📷 " + ((ph.user && ph.user.name) || ("κ " + k.split(":").pop().slice(0, 10) + "…")));
    } catch (e) { kk.textContent = prev0; toast("Unsplash import failed"); }
  }
  let dTimer = 0;
  sIn.addEventListener("input", () => { clearTimeout(dTimer); const q = sIn.value.trim(); if (!q) { usGrid.style.display = usLabel.style.display = mineLabel.style.display = "none"; usGrid.innerHTML = ""; return; } dTimer = setTimeout(() => runSearch(q), 450); });
  sIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(dTimer); const q = sIn.value.trim(); if (q) runSearch(q); } });
  async function addWallFile(file) {
    if (!file || !/^image\//.test(file.type || "")) { toast("Pick an image file"); return; }
    const k = await putWall(new Uint8Array(await file.arrayBuffer()));
    if (!s.items.some((i) => i.k === k)) { s.items.push({ k, name: (file.name || "Wallpaper").replace(/\.[^.]+$/, "").slice(0, 28) || "Wallpaper", kind: "image", mime: file.type }); wallWrite(s); }
    draw(); toast("Added wallpaper · fingerprint " + k.split(":").pop().slice(0, 10) + "…");
  }
  async function draw() {
    grid.innerHTML = "";
    for (const item of s.items) {
      const tile = document.createElement("button"); tile.type = "button"; tile.className = "wall-tile" + (item.k === selK ? " sel" : "");
      const prev = document.createElement("div"); prev.className = "wall-prev" + (item.kind === "gradient" ? " orig" : item.kind === "space" ? " space" : item.kind === "grid" ? " dev" : "");
      if (item.kind === "image") { const url = item.src || await wallObjURL(item); if (url) prev.style.backgroundImage = 'url("' + url + '")'; }
      else if (item.kind === "space") { prev.innerHTML = '<span class="wall-badge">✦ live · κ-seed</span>'; }
      else if (item.kind === "grid") { prev.innerHTML = '<span class="wall-badge">⌗ developer · κ-seed</span>'; }
      else if (item.kind === "shader") { prev.style.background = "radial-gradient(circle at 50% 45%, #2a2f38 0%, #1c1f24 70%)"; prev.innerHTML = '<span class="wall-badge">✦ asanoha · WebGPU · κ-seed</span>'; }
      const meta = document.createElement("div"); meta.className = "wall-meta";
      const nm = document.createElement("span"); nm.className = "wall-name"; nm.textContent = item.name;
      const kk = document.createElement("span"); kk.className = "wall-k"; kk.title = "fingerprint"; kk.textContent = "holo://" + item.k.split(":").pop().slice(0, 12) + "…";
      meta.append(nm, kk); tile.append(prev, meta);
      tile.onclick = async () => { await setWall(item); toast("Wallpaper set · " + item.name); done(); };
      grid.appendChild(tile);
    }
    const add = document.createElement("button"); add.type = "button"; add.className = "wall-tile";
    add.innerHTML = '<div class="wall-prev add"><span>＋</span></div><div class="wall-meta"><span class="wall-name">Add image…</span><span class="wall-k">→ sealed to κ</span></div>';
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.hidden = true; add.appendChild(inp);
    add.onclick = () => inp.click();
    inp.onchange = async () => { const f = inp.files && inp.files[0]; if (f) await addWallFile(f); };
    grid.appendChild(add);
  }
  draw();
  sheet.addEventListener("dragover", (ev) => { ev.preventDefault(); sheet.classList.add("drop"); });
  sheet.addEventListener("dragleave", (ev) => { if (ev.target === sheet) sheet.classList.remove("drop"); });
  sheet.addEventListener("drop", async (ev) => { ev.preventDefault(); sheet.classList.remove("drop"); const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]; if (f) await addWallFile(f); });
  return { close: done };
}
