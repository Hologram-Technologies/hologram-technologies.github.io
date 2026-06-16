// holo-play-ui.mjs — Play, as an immersive BROWSE RAIL in the shared right side-carriage (holo-aside.mjs).
//
// Like a video site's side list: a row of category chips at the top, then a clean, golden-ratio list of
// holospaces (a rich thumbnail · title · source · a concise description). Picking one launches it LIVE in
// the main holospace to the left, while the rail stays open to browse on. Self-contained: it reads the
// served app catalogue (/apps/index.jsonld — name · description · applicationCategory · icon · landing).
//
// createAside owns the dock, slide, drag-resize, toggle, and single-open; this module owns the content.

import { createAside } from "/_shared/holo-aside.mjs";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hue = (id) => { let h = 0; const s = String(id || ""); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };   // a stable colour per holospace
// humanize a schema.org applicationCategory ("MultimediaApplication" → "Multimedia", "GameApplication" → "Games")
const CAT_NAME = { MultimediaApplication: "Multimedia", GameApplication: "Games", DeveloperApplication: "Developer", BusinessApplication: "Productivity", UtilitiesApplication: "Utilities", SocialNetworkingApplication: "Social", FinanceApplication: "Finance", SecurityApplication: "Security", EducationalApplication: "Learn", DesignApplication: "Design", CommunicationApplication: "Communication", BrowserApplication: "Web" };
const catLabel = (c) => CAT_NAME[c] || String(c || "App").replace(/Application$/, "").replace(/([a-z])([A-Z])/g, "$1 $2") || "App";

export function mountPlay(trigger, { launch } = {}) {
  injectStyles();
  const aside = createAside({ id: "play", title: "Play", defaultW: 560, minW: 440, maxW: 1100 });
  const body = aside.body;
  let _loaded = false, _items = [], _cat = "All", _activeId = null;

  async function openPlay() { aside.open(); if (!_loaded) await load(); }
  if (trigger) { trigger.setAttribute("aria-expanded", "false"); trigger.addEventListener("click", (e) => { e.preventDefault(); if (aside.isOpen()) aside.close(); else openPlay(); }); }

  async function load() {
    body.innerHTML = `<div class="ply"><div class="ply-load">Gathering holospaces…</div></div>`;
    try {
      const idx = await fetch("/apps/index.jsonld", { cache: "no-store" }).then((r) => r.json());
      _items = (idx["dcat:dataset"] || []).map((a) => ({
        id: a["schema:identifier"], did: a["@id"], name: a["schema:name"] || a["schema:identifier"],
        desc: a["schema:description"] || "", cat: catLabel(a["schema:applicationCategory"]),
        landing: String(a["dcat:landingPage"] || "").replace(/^apps\//, "/apps/"),
        icon: String(a["schema:image"] || "").replace(/^apps\//, "/apps/"),
      })).filter((a) => a.id && a.landing);
      _loaded = true; render();
    } catch (e) { body.innerHTML = `<div class="ply"><div class="ply-load">The holospace catalogue is not available offline.</div></div>`; }
  }

  function cats() { const seen = new Set(); const out = ["All"]; for (const it of _items) if (it.cat && !seen.has(it.cat)) { seen.add(it.cat); out.push(it.cat); } return out; }
  function shown() { return _cat === "All" ? _items : _items.filter((it) => it.cat === _cat); }

  function render() {
    const chips = cats().map((c) => `<button class="ply-chip${c === _cat ? " on" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
    const rows = shown().map((it) => `
      <button class="ply-item${it.id === _activeId ? " playing" : ""}" data-id="${esc(it.id)}" title="${esc(it.name)}">
        <span class="ply-thumb" style="--h:${hue(it.id)}">${it.icon ? `<img src="${esc(it.icon)}" alt="" loading="lazy" onerror="this.style.display='none'"/>` : ""}<span class="ply-play">▶</span></span>
        <span class="ply-meta">
          <span class="ply-title">${esc(it.name)}</span>
          <span class="ply-sub">${esc(it.cat)} · Hologram</span>
          ${it.desc ? `<span class="ply-desc">${esc(it.desc)}</span>` : ""}
        </span>
      </button>`).join("");
    body.innerHTML = `<div class="ply">
      <div class="ply-cats" role="tablist" aria-label="Categories">${chips}</div>
      <div class="ply-list">${rows || `<div class="ply-load">Nothing in this category yet.</div>`}</div>
    </div>`;
    bind();
  }

  function bind() {
    body.querySelectorAll("[data-cat]").forEach((b) => b.onclick = () => { _cat = b.getAttribute("data-cat"); render(); const l = body.querySelector(".ply-list"); if (l) l.scrollTop = 0; });
    body.querySelectorAll("[data-id]").forEach((b) => b.onclick = () => {
      const id = b.getAttribute("data-id"); const it = _items.find((x) => x.id === id); if (!it) return;
      _activeId = id;
      try { launch && launch(it); } catch (e) {}
      body.querySelectorAll(".ply-item.playing").forEach((x) => x.classList.remove("playing")); b.classList.add("playing");
    });
  }

  return { open: openPlay, close: () => aside.close(), toggle: () => (aside.isOpen() ? aside.close() : openPlay()) };
}

function injectStyles() {
  if (document.getElementById("holo-play-styles")) return;
  const s = document.createElement("style"); s.id = "holo-play-styles";
  // golden-ratio rhythm: chips row · list; each item thumbnail:text ≈ 1:φ.
  s.textContent = `
  .ply{flex:1 1 auto;display:flex;flex-direction:column;min-height:0;font:16px/1.5 var(--win-font,ui-sans-serif,system-ui);color:#e7e7ea}
  .ply-load{margin:auto;padding:40px 24px;color:#8a8a92;font-size:16px;text-align:center}
  .ply-cats{flex:0 0 auto;display:flex;gap:8px;overflow-x:auto;padding:14px 16px;border-bottom:1px solid #16161a;scrollbar-width:none}
  .ply-cats::-webkit-scrollbar{display:none}
  .ply-chip{flex:0 0 auto;border:1px solid #2a2a31;border-radius:999rem;background:#161619;color:#c7c7cf;font:600 15px var(--win-font,system-ui);padding:8px 16px;cursor:pointer;transition:.14s;white-space:nowrap}
  .ply-chip:hover{background:#202026;color:#e7e7ea}
  .ply-chip.on{background:#fff;color:#0a0a0b;border-color:#fff}
  .ply-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:14px 12px 22px;display:flex;flex-direction:column;gap:6px}
  .ply-item{display:flex;gap:14px;align-items:flex-start;width:100%;text-align:left;border:0;background:transparent;color:inherit;cursor:pointer;padding:8px;border-radius:14px;transition:background .14s,transform .14s}
  .ply-item:hover{background:#141417}
  .ply-item:active{transform:scale(.992)}
  .ply-item.playing{background:color-mix(in srgb,#2563eb 18%,transparent);outline:1px solid color-mix(in srgb,#2563eb 50%,transparent)}
  .ply-thumb{position:relative;flex:0 0 38.2%;aspect-ratio:16/9;border-radius:12px;overflow:hidden;display:grid;place-items:center;
    background:radial-gradient(120% 130% at 25% 12%, hsl(var(--h) 85% 62%), hsl(calc(var(--h) + 38) 80% 24%) 70%, #08080c);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08), 0 6px 18px -10px #000}
  .ply-thumb img{width:54%;height:54%;object-fit:contain;filter:drop-shadow(0 2px 6px rgba(0,0,0,.45))}
  .ply-play{position:absolute;right:7px;bottom:6px;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:11px;color:#fff;
    background:rgba(8,8,12,.55);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);opacity:0;transform:scale(.8);transition:.14s}
  .ply-item:hover .ply-play{opacity:1;transform:scale(1)}
  .ply-meta{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px;padding-top:1px}
  .ply-title{font-weight:680;font-size:16px;line-height:1.3;color:#f2f2f5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .ply-sub{font-size:14px;color:#8a8a92}
  .ply-desc{font-size:15px;line-height:1.45;color:#a0a0a8;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:1px}
  @media (max-width:600px){ .ply-thumb{flex-basis:42%} }`;
  document.head.appendChild(s);
}

export default { mountPlay };
