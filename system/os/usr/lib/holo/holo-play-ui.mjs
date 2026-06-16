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

  // Refetch on open until we actually have items: if the very first open raced an empty/not-yet-ready
  // catalogue, a later open recovers without a full page reload (instead of sticking on "Nothing yet").
  async function openPlay() { aside.open(); if (!_loaded || _items.length === 0) await load(); }
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
  // One golden system, applied throughout. φ = 1.618 governs every proportion:
  //   · the row split — thumbnail : text = 1 : φ  (38.2% / 61.8%)
  //   · the thumbnail — a golden RECTANGLE (φ : 1)
  //   · spacing — a Fibonacci scale (5·8·13·21·34), each step ≈ ×φ of the last
  //   · type — a φ-stepped scale (13 → 16 caption→title)
  // The result reads as one calm, seamless surface that squeezes the live holospace beside it.
  s.textContent = `
  .ply{--phi:1.618;--s1:5px;--s2:8px;--s3:13px;--s4:21px;--s5:34px;
    flex:1 1 auto;display:flex;flex-direction:column;min-height:0;
    font:16px/1.55 var(--win-font,ui-sans-serif,system-ui);color:#e9e9ee;
    background:radial-gradient(135% 78% at 50% -12%, #14141f 0%, #0c0c10 44%, #0a0a0b 100%)}
  .ply-load{margin:auto;max-width:34ch;padding:var(--s5) var(--s4);color:#8a8a92;font-size:16px;line-height:1.6;text-align:center}

  /* category rail — pill chips, horizontal scroll, soft fade where they run off-frame */
  .ply-cats{flex:0 0 auto;display:flex;gap:var(--s2);overflow-x:auto;padding:var(--s3) var(--s4);scrollbar-width:none;
    -webkit-mask:linear-gradient(90deg,#000 calc(100% - 34px),transparent);mask:linear-gradient(90deg,#000 calc(100% - 34px),transparent)}
  .ply-cats::-webkit-scrollbar{display:none}
  .ply-chip{flex:0 0 auto;border:1px solid rgba(255,255,255,.10);border-radius:999rem;background:rgba(255,255,255,.045);
    color:#bdbdc6;font:600 14px var(--win-font,system-ui);padding:7px 15px;cursor:pointer;transition:.16s;white-space:nowrap}
  .ply-chip:hover{background:rgba(255,255,255,.09);color:#f1f1f5}
  .ply-chip.on{background:#f4f4f6;color:#0a0a0b;border-color:#f4f4f6}
  .ply-chip:focus-visible{outline:2px solid color-mix(in srgb,var(--accent,#5b8cff) 60%,transparent);outline-offset:2px}

  /* the browse list — a thin, quiet scrollbar; generous tail so the last row clears the edge */
  .ply-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:var(--s2) var(--s3) var(--s5);
    display:flex;flex-direction:column;gap:var(--s1);scrollbar-width:thin;scrollbar-color:#26262d transparent;scroll-behavior:smooth}
  .ply-list::-webkit-scrollbar{width:11px}
  .ply-list::-webkit-scrollbar-thumb{background:#26262d;border:3px solid transparent;background-clip:content-box;border-radius:999px}
  .ply-list::-webkit-scrollbar-thumb:hover{background:#3a3a44;background-clip:content-box}

  .ply-item{position:relative;display:flex;gap:var(--s3);align-items:center;width:100%;text-align:left;border:0;background:transparent;
    color:inherit;cursor:pointer;padding:var(--s2);border-radius:16px;transition:background .16s,transform .12s}
  .ply-item:hover{background:rgba(255,255,255,.05)}
  .ply-item:active{transform:scale(.99)}
  .ply-item:focus-visible{outline:none;background:rgba(255,255,255,.06)}
  .ply-item:focus-visible::before,.ply-item.playing::before{content:"";position:absolute;inset:0;border-radius:16px;pointer-events:none;
    box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent,#5b8cff) 55%,transparent)}
  .ply-item.playing{background:color-mix(in srgb,var(--accent,#5b8cff) 15%,transparent)}

  /* golden-rectangle thumbnail (φ:1), occupying the 1 part of the 1:φ row split */
  .ply-thumb{position:relative;flex:0 0 38.2%;aspect-ratio:var(--phi) / 1;border-radius:13px;overflow:hidden;display:grid;place-items:center;
    background:radial-gradient(125% 130% at 28% 14%, hsl(var(--h) 82% 60%), hsl(calc(var(--h) + 42) 78% 26%) 64%, #0a0a10 100%);
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.09), 0 8px 22px -14px #000}
  .ply-thumb img{width:52%;height:52%;object-fit:contain;filter:drop-shadow(0 3px 7px rgba(0,0,0,.5))}
  .ply-play{position:absolute;right:7px;bottom:7px;width:27px;height:27px;border-radius:50%;display:grid;place-items:center;
    font-size:10px;padding-left:2px;color:#fff;background:rgba(8,8,12,.5);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);
    opacity:0;transform:scale(.82) translateY(3px);transition:.16s;box-shadow:0 3px 9px -3px #000}
  .ply-item:hover .ply-play,.ply-item:focus-visible .ply-play{opacity:1;transform:none}
  .ply-item.playing .ply-play{opacity:1;transform:none;background:color-mix(in srgb,var(--accent,#5b8cff) 82%,#000)}

  /* the φ part of the split — title · source · description, each clamped so a row never overflows the frame */
  .ply-meta{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:var(--s1)}
  .ply-title{font-weight:660;font-size:16px;line-height:1.3;color:#f4f4f8;letter-spacing:-.005em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ply-sub{font-size:13px;color:#85858f;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ply-desc{font-size:14px;line-height:1.5;color:#9b9ba4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  @media (max-width:600px){ .ply-cats,.ply-list{padding-left:var(--s3);padding-right:var(--s3)} .ply-thumb{flex-basis:42%} }`;
  document.head.appendChild(s);
}

export default { mountPlay };
