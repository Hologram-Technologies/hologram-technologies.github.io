// holo-home-boot.mjs — P2-NATIVE SURFACE WIRING. Composes the witnessed Holo Home logic layer (holo-home
// {,-front,-apps,-ask}) into the LIVE shell: binds window.HoloHome over the encrypted κ-store, registers
// the Ask surface, and renders the four sections (Files · Apps · Ask · Spaces) into a self-contained panel,
// routing every open through window.HoloOpen (the one open path, shell.html:5786). Self-mounting and fail-
// soft: one <script> line in shell.html is the only tracked-file change. Beauty pass is P8; this is the wire.
//
// NOTE: the manifest lives client-side in the SAME AES-GCM-encrypted IndexedDB pattern as holo-strand
// (sovereign vault key via holo-session.activeCipher; locked ⇒ never plaintext), under its own "holo-home"
// store. The served module tree is hot-reloadable, so a reseal updates this surface live (~400ms, no relaunch).

import { makeHome } from "./holo-home.mjs";
import { homeView, openHomeItem } from "./holo-home-front.mjs";
import { appsModel } from "./holo-home-apps.mjs";
import { makeHomeAsk } from "./holo-home-ask.mjs";
import { route as resolveRoute } from "./holo-omni-resolve.mjs";   // the hero omnibox resolves locally — self-sufficient even before shell-main wires window.HoloResolve

// All user-facing copy in ONE place — plain words only, jargon-gated by holo-home-journey-witness.
// "open" not "install", "your stuff" not "manifest"/"κ". If a line here trips the gate, the gate wins.
export const BOOT_COPY = Object.freeze({
  rootLabel: "Your stuff",
  notReady: "Your stuff isn't ready yet.",
  files: "Files", apps: "Apps", spaces: "Spaces", ask: "Ask",
  askHint: "Ask about your stuff.",
});

const te = new TextEncoder();
const td = new TextDecoder();

// the encrypted κ-store backend (mirrors holo-strand's idbBackend, store name "holo-home"). Locked / no key
// ⇒ load returns [] and save is a no-op (never writes plaintext). Fail-soft everywhere.
function idbBackend() {
  const KEY = "holo.home.v1", DB = "holo-home", STORE = "kv";
  const open = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const s = t.objectStore(STORE); const rq = fn(s); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); };
  const cipher = async () => { try { const m = await import("./holo-session.mjs"); return m.activeCipher ? (await m.activeCipher()).cipher : null; } catch (e) { return null; } };
  return {
    load: async () => {
      try {
        const raw = await tx("readonly", (s) => s.get(KEY)); if (!raw) return [];
        if (raw.v === 1 && raw.blob) { const c = await cipher(); if (!c) return []; const pt = await c.open(raw.blob); return pt ? JSON.parse(td.decode(pt)) : []; }
        return [];
      } catch (e) { return []; }
    },
    save: async (recs) => { try { const c = await cipher(); if (!c) return null; const blob = await c.seal(te.encode(JSON.stringify(recs))); return tx("readwrite", (s) => s.put({ v: 1, blob }, KEY)); } catch (e) { return null; } },
  };
}

// best-effort: attach the unlocked operator as the manifest signer (authorship). Absent ⇒ still hash-links.
async function liveSigner() {
  try { const m = await import("./holo-session.mjs"); const p = m.activePrincipal && (await m.activePrincipal()); if (p && p.kappa && typeof p.sign === "function") return p; } catch (e) {}
  try { if (window.HoloOperator && window.HoloOperator.kappa) return window.HoloOperator; } catch (e) {}
  return null;
}

// best-effort app catalog (display names/icons for pinned apps); empty ⇒ apps render by ref. Same source the
// service shim uses (apps/index.jsonld → dcat:dataset).
async function loadCatalog() {
  // relative first (works on the holo://os origin AND the http dev mirror), then absolute. The catalog is
  // JSON-LD: titles under schema:name, icon under schema:image, three-words under holo:words.
  for (const url of ["/apps/index.jsonld", "holo://os/apps/index.jsonld"]) {
    try {
      const j = await (await fetch(url, { cache: "no-store" })).json();
      return (j["dcat:dataset"] || []).map((d) => ({ id: d["@id"] || d.id, did: d.did, name: d["schema:name"] || d["dcterms:title"] || d.name, icon: d["schema:image"] || d.icon, words: d["holo:words"] || d["schema:alternateName"] || d.words }));
    } catch (e) { /* try next */ }
  }
  return [];
}

// DEMO SEAM (dev only) — populate a fresh Home with sample files/apps/spaces so the surface can be SEEN
// without a logged-in operator. Gated by ?holohome=demo (or window.HOLO_HOME_DEMO). Uses the REAL manifest
// API (genuine append-only entries) and REAL catalog κs, so click-to-open actually opens the apps.
async function seedDemo(home) {
  await home.init({ owner: "did:holo:sha256:" + "d".repeat(64), title: "Demo Home" });
  const TRAVEL = "did:holo:sha256:" + "7".repeat(64);
  await home.addFile("did:holo:sha256:" + "1".repeat(64), "welcome.md");
  await home.addFile("did:holo:sha256:" + "2".repeat(64), "budget.xlsx");
  await home.addFile(TRAVEL, "Travel");                                  // a folder
  await home.addFile("did:holo:sha256:" + "3".repeat(64), "rome.jpg", TRAVEL);
  // real catalog apps (content κs) → clicking a tile opens the actual app through window.HoloOpen
  await home.pinApp("did:holo:sha256:d624fed1772dc7078ad196e319e95ddce6023a98406d48da8d8598b2a371dc09", "kappa"); // Holo Atlas
  await home.pinApp("did:holo:sha256:bb5fde48d9dc00c97ba68c42088538d660c2a0509d60210a934eb4a4ab1d0c36", "kappa"); // Holo Amp
  await home.pinApp("did:holo:sha256:18a46e721bab6d9a36645fecb95b0a79ae6ff10487237b413f39195785459972", "kappa"); // Holo Guide
  await home.addSpace("holo://space/demo-work", "Work");
}

const el = (tag, attrs = {}, kids = []) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v); } for (const c of [].concat(kids)) if (c) n.appendChild(c); return n; };

const hueOf = (s) => [...String(s || "?")].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
const IMG_RE = /\.(svg|png|webp|jpe?g|gif|ico)$/i;

// P8 beauty: one self-contained, scoped stylesheet injected once. Calm, content-first, one accent, soft
// motion, dark/light via color-scheme. Scoped under #holo-home-root so it never leaks into the host shell.
const STYLE = `
#holo-home-root{--hh-accent:#7cc4ff;--hh-card:color-mix(in oklab,canvastext 6%,transparent);--hh-bd:color-mix(in oklab,canvastext 12%,transparent);
  display:grid;gap:34px;max-width:1040px;margin:0 auto;padding:8px 0 64px;color-scheme:dark light;
  font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}
#holo-home-root .holo-home-section h2{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  opacity:.5;margin:0 0 14px;}
#holo-home-root .holo-home-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(184px,1fr));gap:12px;}
#holo-home-root .holo-home-tile{display:flex;align-items:center;gap:12px;padding:13px 15px;border:1px solid var(--hh-bd);
  border-radius:16px;background:var(--hh-card);color:inherit;font:inherit;cursor:pointer;text-align:left;width:100%;
  transition:transform .12s ease,background .18s ease,border-color .18s ease,box-shadow .18s ease;}
#holo-home-root .holo-home-tile:hover{transform:translateY(-2px);background:color-mix(in oklab,canvastext 11%,transparent);
  border-color:color-mix(in oklab,var(--hh-accent) 45%,transparent);box-shadow:0 8px 28px -14px color-mix(in oklab,var(--hh-accent) 60%,transparent);}
#holo-home-root .holo-home-tile:active{transform:translateY(0);}
#holo-home-root .holo-home-tile:focus-visible{outline:2px solid var(--hh-accent);outline-offset:2px;}
#holo-home-root .holo-home-tile[data-untrusted]{border-color:color-mix(in oklab,#f5a623 55%,transparent);}
#holo-home-root .hh-icon{flex:0 0 auto;width:38px;height:38px;border-radius:11px;display:grid;place-items:center;
  font-size:15px;font-weight:600;color:#0b0b12;overflow:hidden;
  background:linear-gradient(135deg,hsl(var(--hh-hue,210) 70% 66%),hsl(calc(var(--hh-hue,210) + 38) 72% 56%));}
#holo-home-root .hh-icon img{width:100%;height:100%;object-fit:cover;}
#holo-home-root .hh-icon[data-kind=folder]{background:linear-gradient(135deg,#ffd479,#f5a623);}
#holo-home-root .hh-label{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#holo-home-root .holo-home-tile[data-untrusted] .hh-label::after{content:"unverified";display:block;font-size:10px;font-weight:600;
  letter-spacing:.04em;text-transform:uppercase;color:#f5a623;opacity:.85;}
#holo-home-root .holo-home-ask .hh-ask{display:flex;align-items:center;gap:12px;padding:16px 18px;border-radius:16px;
  border:1px solid var(--hh-bd);background:var(--hh-card);}
#holo-home-root .holo-home-ask .hh-ask .hh-dot{width:9px;height:9px;border-radius:50%;background:var(--hh-accent);
  box-shadow:0 0 0 4px color-mix(in oklab,var(--hh-accent) 22%,transparent);}
#holo-home-root .hh-hint{opacity:.65;margin:0;}
@property --hh-spin{syntax:"<angle>";inherits:false;initial-value:0deg;}
@keyframes hh-spin{to{--hh-spin:360deg;}}
#holo-home-root .hh-hero{margin:0 0 6px;}
#holo-home-root .hh-omni{position:relative;display:flex;align-items:center;gap:10px;height:48px;padding:0 8px 0 16px;
  border:1.5px solid transparent;border-radius:999rem;
  background:linear-gradient(color-mix(in oklab,canvas 92%,canvastext),color-mix(in oklab,canvas 92%,canvastext)) padding-box,
   conic-gradient(from var(--hh-spin),#ff3b6b,#ff9e2c,#ffe24a,#46e08a,#2bd4ff,#5b8cff,#c77bff,#ff3b6b) border-box;
  transition:box-shadow .2s ease;}
#holo-home-root .hh-omni:focus-within{box-shadow:0 0 28px -8px color-mix(in oklab,#5b8cff 65%,transparent);animation:hh-spin 7s linear infinite;}
#holo-home-root .hh-omni-mark{flex:0 0 auto;width:18px;height:18px;border-radius:5px;opacity:.9;
  background:conic-gradient(from var(--hh-spin),#ff3b6b,#ff9e2c,#ffe24a,#46e08a,#2bd4ff,#5b8cff,#c77bff,#ff3b6b);}
#holo-home-root .hh-omni-in{flex:1;min-width:0;background:none;border:0;outline:0;color:inherit;font:15px/1.4 inherit;}
#holo-home-root .hh-omni-go{flex:0 0 auto;width:32px;height:32px;border:0;border-radius:50%;cursor:pointer;color:#fff;
  display:grid;place-items:center;font-size:15px;line-height:1;
  background:radial-gradient(130% 130% at 32% 22%,rgba(255,255,255,.5),rgba(255,255,255,0) 46%),
   conic-gradient(from var(--hh-spin),#ff3b6b,#ff9e2c,#ffe24a,#46e08a,#2bd4ff,#5b8cff,#c77bff,#ff3b6b);
  box-shadow:0 2px 9px rgba(120,140,255,.42),inset 0 0 0 1px rgba(255,255,255,.24);transition:filter .14s ease,transform .12s ease;}
#holo-home-root .hh-omni-go:hover{filter:saturate(1.14) brightness(1.06);transform:translateY(-1px);}
#holo-home-root .hh-omni-go:active{transform:translateY(0) scale(.92);}
#holo-home-root .hh-omni-hint{min-height:15px;margin:6px 0 0 18px;font-size:12px;opacity:.55;}
#holo-home-root .holo-home-empty{opacity:.6;}
@media (prefers-reduced-motion:reduce){#holo-home-root .holo-home-tile{transition:none;}}
`;
function injectStyles() {
  if (document.getElementById("holo-home-style")) return;
  const s = el("style", { id: "holo-home-style" }); s.textContent = STYLE;
  (document.head || document.documentElement).appendChild(s);
}

// build the leading icon chip for a tile: a served image when the catalog gives one, else a tinted
// letter chip (folders get a distinct warm chip). Pure presentation.
function tileIcon(it) {
  const chip = el("span", { class: "hh-icon" });
  const isFolder = it.kind !== "app" && !/\.[a-z0-9]+$/i.test(String(it.label || "")) && it.section === "files";
  if (it.icon && IMG_RE.test(it.icon)) { const img = el("img"); img.src = it.icon; img.alt = ""; chip.appendChild(img); }
  else if (isFolder) { chip.setAttribute("data-kind", "folder"); chip.textContent = (String(it.label || "?")[0] || "?").toUpperCase(); }
  else { chip.style.setProperty("--hh-hue", String(hueOf(it.ref || it.label))); chip.textContent = (String(it.label || it.ref || "?").trim()[0] || "?").toUpperCase(); }
  return chip;
}

function mountRoot() {
  let root = document.getElementById("holo-home-root");
  if (!root) { root = el("section", { id: "holo-home-root", "aria-label": BOOT_COPY.rootLabel }); (document.body || document.documentElement).appendChild(root); }
  return root;
}

// The home hero: the signature spectrum omnibox, as page content (Strategy A — it lives on the home surface,
// not the native toolbar). Submit goes through the ONE open path (window.HoloOpen → omniGo), so every input
// class works on web + native unchanged; a live preview reflects the resolver's destination NAME as you type.
// Plain words only (the home surface is jargon-gated — no κ/manifest/anchor/strand on screen).
function heroOmni() {
  const input = el("input", { class: "hh-omni-in", type: "text", placeholder: "Search the web, or open your stuff", autocomplete: "off", spellcheck: "false", "aria-label": "Search" });
  const go = el("button", { class: "hh-omni-go", type: "submit", "aria-label": "Go", text: "→" });
  const omni = el("div", { class: "hh-omni" }, [el("span", { class: "hh-omni-mark" }), input, go]);
  const hint = el("div", { class: "hh-omni-hint" });
  const form = el("form", { class: "hh-hero", role: "search" }, [omni, hint]);
  // Name/three-word resolution needs the RAW catalog doc (dcat:landingPage). Fetch it once; until it lands,
  // web/κ/text still resolve. Post-login, window.HoloResolve already holds the raw catalog (shell-main fed it).
  let rawCat = [];
  (async () => { try { rawCat = await (await fetch("/apps/index.jsonld", { cache: "no-store" })).json(); } catch (e) {} })();
  const decide = (v) => { try { return (window.HoloResolve && window.HoloResolve.route) ? window.HoloResolve.route(v) : resolveRoute(v, { catalog: rawCat }); } catch (e) { return null; } };
  input.addEventListener("input", () => {
    const v = input.value.trim();
    const a = v ? decide(v) : null;
    hint.textContent = a ? (a.action === "open" ? "look it up" : (a.name ? "→ " + a.name : "")) : "";
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.trim(); if (!v) return;
    try {
      if (window.HoloOpen) { window.HoloOpen(v); return; }                 // the ONE open path (omniGo) when the shell is wired — web + native
      const a = decide(v);                                                 // else navigate by the resolver's own decision (pre-login / standalone)
      if (a && a.action === "navigate") location.href = a.url;
      else location.href = "holo://os/find.html?q=" + encodeURIComponent(v);
    } catch (err) {}
  });
  return form;
}

async function render(home, catalog) {
  injectStyles();
  const root = mountRoot();
  const view = await homeView(home);
  root.textContent = "";
  root.appendChild(heroOmni());   // the search hero is always present — independent of whether the personal-cloud manifest is ready
  if (!view.ok) { root.appendChild(el("p", { class: "holo-home-empty", text: BOOT_COPY.notReady })); return; }

  const openOne = async (item) => { const open = (typeof window !== "undefined" && window.HoloOpen) ? window.HoloOpen : null; return openHomeItem(item, open); };

  // Files · Spaces from the view; Apps via appsModel (catalog join + class→open strategy)
  const apps = await appsModel(home, catalog);
  const sections = [
    { id: "files", title: BOOT_COPY.files, items: ((view.sections.find((s) => s.id === "files") || {}).items || []).map((i) => ({ ...i, section: "files" })) },
    { id: "apps", title: BOOT_COPY.apps, items: apps.ok ? apps.apps.map((a) => ({ ref: a.ref, label: a.label, icon: a.icon, kind: "app", appClass: a.class, trusted: a.trusted, section: "apps" })) : [] },
    { id: "spaces", title: BOOT_COPY.spaces, items: ((view.sections.find((s) => s.id === "spaces") || {}).items || []).map((i) => ({ ...i, section: "spaces" })) },
  ];

  for (const sec of sections) {
    if (!sec.items.length) continue;   // never render a lonely section header (FILES/APPS/SPACES) over an empty section
    const list = el("div", { class: "holo-home-grid" });
    for (const it of sec.items) {
      const btn = el("button", { class: "holo-home-tile", type: "button", title: it.label || it.ref });
      if (it.trusted === false) btn.setAttribute("data-untrusted", "1");   // surfaced, not silently opened
      btn.appendChild(tileIcon(it));
      btn.appendChild(el("span", { class: "hh-label", text: it.label || it.name || it.ref }));
      btn.addEventListener("click", () => { openOne(it); });
      list.appendChild(btn);
    }
    root.appendChild(el("div", { class: "holo-home-section" }, [el("h2", { text: sec.title }), list]));
  }
  // Ask remains registered into the agent registry below; its on-screen entry point is intentionally not rendered.
}

async function boot() {
  try {
    if (window.HoloHome) return;
    // Only open the encrypted idb store when a vault cipher is actually available (a logged-in operator);
    // otherwise an in-memory backend so the surface still boots reliably (http dev mirror / pre-login) —
    // an idb store you can't decrypt is useless and its open can stall over plain http.
    let backend = null;
    try { const ms = await import("./holo-session.mjs"); const c = ms.activeCipher ? (await ms.activeCipher()).cipher : null; if (c && typeof indexedDB !== "undefined") backend = idbBackend(); } catch (e) {}
    const signer = await liveSigner();
    const home = makeHome({ backend, now: () => new Date().toISOString(), signer });
    await home.ready();
    window.HoloHome = home;

    // dev demo seam: if asked and the Home is empty (no operator/manifest yet), seed sample content.
    try {
      const demo = (typeof location !== "undefined") && (/[?&]holohome=demo\b/.test(location.search) || window.HOLO_HOME_DEMO === true);
      if (demo) { const p = await home.project(); if (p.ok && p.files.length === 0 && p.apps.length === 0) await seedDemo(home); }
    } catch (e) {}

    // register the Ask surface into the unified agent registry, if present (fail-soft).
    try {
      const ask = makeHomeAsk({ home, open: window.HoloOpen || null });
      if (window.HoloAgents && typeof window.HoloAgents.register === "function") window.HoloAgents.register("home", ask);
      window.HoloHomeAsk = ask;
    } catch (e) {}

    const catalog = await loadCatalog();
    await render(home, catalog);
    // hot-reload friendliness: re-render when the manifest changes (a reseal / a roam adopt fires this).
    document.documentElement.addEventListener("holo-home-changed", () => render(home, catalog).catch(() => {}));
    document.documentElement.dispatchEvent(new Event("holo-home-ready"));
  } catch (e) { /* fail-soft: leave the rest of the shell untouched */ }
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}

export default { boot };
