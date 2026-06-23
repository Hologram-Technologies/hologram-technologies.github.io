// holo-continue-ui.mjs — "Continue watching" for Hologram. The streaming front door: your recent apps and
// spaces as a poster rail you tap to resume — exactly the Netflix mental model, on any device. Built on the
// recents memory you already have (holo-omni-index.recents) + the one open path (κ-Open). No new vocabulary,
// no save/sync; if there's nothing recent yet, it renders nothing (a new user sees the clean welcome, like a
// fresh Netflix account has no Continue Watching row). Pure model (buildContinueModel) is node-witnessable;
// renderContinueRail is the responsive DOM (horizontal scroll + snap = a swipe rail on mobile, a row on desktop).

// buildContinueModel(recents, { limit, profileTerms }) → the cards to show. Filters to the STREAMABLE titles
// (apps + spaces); recents is pre-ranked by recency × frequency × authority. When profileTerms is given (your
// private standing interests, window.HoloProfile.terms()), applies a GENTLE, BOUNDED affinity nudge — your
// interests lift matching titles a few slots, but recency still leads ("Continue watching," ranked to you).
export function buildContinueModel(recents = [], { limit = 12, kinds = ["app", "holospace"], profileTerms = null } = {}) {
  const items = [];
  for (const r of recents) {
    if (!r || !r.addr) continue;
    if (kinds && kinds.indexOf(r.kind || "") < 0) continue;
    const title = String(r.title || r.input || r.addr).split("  ·  ")[0].trim() || "Untitled";
    items.push({ addr: r.addr, kind: r.kind || "", title, kappa: r.kappa || null });
  }
  const terms = Array.isArray(profileTerms) ? profileTerms.filter((t) => typeof t === "string" && t.length > 2).map((t) => t.toLowerCase()) : [];
  if (terms.length && items.length) {
    const N = items.length;
    const scored = items.map((it, i) => {
      const hay = (it.title + " " + it.kind).toLowerCase();
      const aff = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
      return { it, s: (N - i) + Math.min(aff, 3) * 1.5 };   // base = recency position; + a bounded interest lift
    });
    scored.sort((a, b) => b.s - a.s);                        // stable → equal scores keep recency order
    return scored.slice(0, limit).map((x) => x.it);
  }
  return items.slice(0, limit);
}

// a deterministic, content-derived poster: a calm gradient seeded by the title/κ (so the same title always
// gets the same colour — recognizable at a glance), with the name and a kind glyph. No images to fetch.
const GLYPH = { app: "▶", holospace: "⬡", web: "◍", web3: "◆", video: "►", audio: "♪", file: "▭", cid: "⬢" };
function hashHue(s) { let h = 0; s = String(s); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; }
function posterStyle(item) {
  const h = hashHue(item.kappa || item.title);
  const h2 = (h + 38) % 360;
  return `background:radial-gradient(130% 130% at 24% 18%, hsl(${h} 70% 30%), hsl(${h2} 64% 14%) 64%, #06080e);`;
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// renderContinueRail({ items, onOpen, title }) → an HTMLElement (the whole section), or null if nothing to show.
//   onOpen(item) — resume it (the shell routes apps→openHolospaceApp, spaces→openHolospace; one tap = play).
export function renderContinueRail({ items = [], onOpen, title = "Continue watching", posterFor = null } = {}) {
  if (typeof document === "undefined" || !items.length) return null;
  injectStyles();
  const sec = document.createElement("section"); sec.className = "cw"; sec.setAttribute("aria-label", title);
  const cards = items.map((it, i) => {
    const poster = (posterFor && posterFor(it)) || "";
    const inner = poster
      ? `<span class="cw-art">${poster}</span>`
      : `<span class="cw-art" style="${posterStyle(it)}"><span class="cw-glyph">${GLYPH[it.kind] || "▶"}</span></span>`;
    return `<button class="cw-card" data-i="${i}" style="--d:${i * 45}ms" title="Resume ${esc(it.title)}">${inner}<span class="cw-nm">${esc(it.title)}</span></button>`;
  }).join("");
  sec.innerHTML = `<h2 class="cw-h">${esc(title)}</h2><div class="cw-rail">${cards}</div>`;
  sec.querySelectorAll(".cw-card").forEach((b) => b.onclick = () => { const it = items[+b.dataset.i]; if (it && onOpen) try { onOpen(it); } catch (e) {} });
  return sec;
}

function injectStyles() {
  if (typeof document === "undefined" || document.getElementById("cw-styles")) return;
  const s = document.createElement("style"); s.id = "cw-styles";
  s.textContent = `
  .cw{width:min(1320px,92vw);margin:0 auto;text-align:left;pointer-events:auto;animation:cw-in .5s cubic-bezier(.2,.8,.2,1) both}
  @keyframes cw-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  .cw-h{margin:0 0 clamp(10px,1.4vmin,16px);font-size:clamp(18px,2.1vmin,24px);font-weight:680;letter-spacing:-.01em;color:#f4f8ff}
  .cw-rail{display:flex;gap:clamp(12px,1.4vmin,20px);overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding:4px 2px 14px;scrollbar-width:none}
  .cw-rail::-webkit-scrollbar{display:none}
  .cw-card{flex:0 0 auto;width:clamp(150px,38vw,236px);scroll-snap-align:start;display:flex;flex-direction:column;gap:9px;
    border:0;background:transparent;color:#eaf2ff;cursor:pointer;padding:0;font:inherit;text-align:left;
    animation:cw-card-in .5s cubic-bezier(.2,.8,.2,1) both;animation-delay:var(--d)}
  @keyframes cw-card-in{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
  .cw-art{position:relative;display:grid;place-items:center;aspect-ratio:16/10;border-radius:14px;overflow:hidden;
    box-shadow:0 10px 30px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.06);transition:transform .16s cubic-bezier(.2,.8,.2,1),box-shadow .16s}
  .cw-art svg,.cw-art img{width:100%;height:100%;object-fit:cover;display:block}
  .cw-glyph{font-size:clamp(30px,4vmin,46px);color:rgba(255,255,255,.9);text-shadow:0 2px 14px rgba(0,0,0,.5)}
  .cw-card:hover .cw-art,.cw-card:focus-visible .cw-art{transform:translateY(-4px) scale(1.02);box-shadow:0 18px 44px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.12)}
  .cw-card:focus-visible{outline:none}
  .cw-art::after{content:"▶";position:absolute;inset:0;display:grid;place-items:center;font-size:clamp(22px,3vmin,34px);color:#fff;
    background:rgba(0,0,0,.28);opacity:0;transition:opacity .16s;text-shadow:0 2px 10px rgba(0,0,0,.6)}
  .cw-card:hover .cw-art::after,.cw-card:focus-visible .cw-art::after{opacity:1}
  .cw-nm{font-size:clamp(14px,1.5vmin,17px);font-weight:600;color:#dfe8f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  @media (prefers-reduced-motion: reduce){.cw,.cw-card{animation:none}}`;
  document.head.appendChild(s);
}

if (typeof window !== "undefined") window.HoloContinueUI = { buildContinueModel, renderContinueRail };
export default { buildContinueModel, renderContinueRail };
