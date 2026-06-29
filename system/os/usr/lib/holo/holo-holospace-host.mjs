// holo-holospace-host.mjs — the STANDALONE holospace document (Phase 2.0).
//
// A holospace has only ever existed INSIDE the shell (openHolospace tiles members via geomFor). For a real
// CEF tab to BE a holospace, a holospace must boot on its own from a κ URL — one document that renders one
// space full-window, no shell chrome (the tab is the frame). This is that document. Once a κ URL boots a
// whole surface standalone, "open it in a real tab" (P2.1) is just LoadURL.
//
//   planHost(space) → { ok, layout, members:[{ kind, ref, url, rect }] }   — PURE, node-witnessable
//   mountHost(space, root)                                                  — DOM: tile the members as iframes
//   boot()                                                                  — read ?ref / ?s, load+verify, mount (fail-closed)
//
// The member URL grammar is single-sourced from holo-omni-resolve.DEST (an app member → holo://<κ>/, a nested
// space → holo://space/<κ>), so the resolver and the host agree on what a κ URL means. The space itself is
// loaded + L5-verified before anything paints; a tampered space paints an honest empty surface, never a wrong
// arrangement (Law L5 on the composition — holo-spaces.verify / store.get re-derive the κ).

import { DEST } from "./holo-omni-resolve.mjs";

const PREFIX = "did:holo:sha256:";
const SPACES_URL = "/apps/spaces/holo-spaces.mjs";   // the space model, served (browser only; the witness imports it directly)

// hexOf(any-κ-form) → 64-hex | "" (mirrors holo-spaces.hexOf; kept inline so planHost stays dependency-light).
export function hexOf(s) { const m = String(s || "").match(/[0-9a-f]{64}/i); return m ? m[0].toLowerCase() : ""; }

// orderMembers — the identity ordering: by position, then κ; drop members with no resolvable κ (mirrors
// holo-spaces.identity so the host tiles members in the SAME order the κ is derived from).
function orderMembers(members) {
  return (members || [])
    .map((m, i) => ({ kind: m.kind === "space" ? "space" : "app", root: hexOf(m.root), pos: m.position == null ? i : m.position | 0 }))
    .filter((m) => m.root)
    .sort((a, b) => a.pos - b.pos || a.root.localeCompare(b.root));
}

// layoutRects(layout, n) → n non-overlapping rects in PERCENT (the host fills the whole tab), except "stack"
// which intentionally overlaps (z-stacked). Ports the shell's tiling vocabulary (geomFor / SHELL_LAYOUTS).
export function layoutRects(layout, n) {
  if (n <= 0) return [];
  if (n === 1 || layout === "single") return [{ left: 0, top: 0, width: 100, height: 100 }];
  switch (layout) {
    case "split-h": { const w = 100 / n; return Array.from({ length: n }, (_, i) => ({ left: i * w, top: 0, width: w, height: 100 })); }
    case "split-v": { const h = 100 / n; return Array.from({ length: n }, (_, i) => ({ left: 0, top: i * h, width: 100, height: h })); }
    case "primary-rail": {
      const rail = n - 1, rh = 100 / rail;
      return [{ left: 0, top: 0, width: 68, height: 100 }, ...Array.from({ length: rail }, (_, i) => ({ left: 68, top: i * rh, width: 32, height: rh }))];
    }
    case "stack": return Array.from({ length: n }, () => ({ left: 0, top: 0, width: 100, height: 100 }));   // overlapping by design (z-index in mountHost)
    case "grid-2x2":
    default: {   // a generalized grid (honeycomb falls here for v1 — a hex wall is a later refinement)
      const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), w = 100 / cols, h = 100 / rows;
      return Array.from({ length: n }, (_, i) => ({ left: (i % cols) * w, top: Math.floor(i / cols) * h, width: w, height: h }));
    }
  }
}

// the bootable κ URL for a member: an app → holo://<κ>/ ; a nested space → holo://space/<κ> (the host doc again).
const memberUrl = (m) => (m.kind === "space" ? DEST.space(m.root) : DEST.kappa(m.root));

// planHost(space) — PURE. Members → ordered bootable URLs + tile rects for the space's layout. ok:false for a
// non-object. An empty members list yields an empty plan (the caller paints an honest empty surface).
export function planHost(space) {
  if (!space || typeof space !== "object") return { ok: false, layout: "single", members: [] };
  const layout = typeof space.layout === "string" ? space.layout : "single";
  const ordered = orderMembers(space.members);
  const rects = layoutRects(layout, ordered.length);
  const members = ordered.map((m, i) => ({ kind: m.kind, ref: PREFIX + m.root, url: memberUrl(m), rect: rects[i] }));
  return { ok: true, layout, members };
}

// ── DOM (browser) ─────────────────────────────────────────────────────────────────────────
// Immersive, responsive, beautiful — and themed from the space itself (its accent). Edge-to-edge, no
// scrollbars on wide screens; gapped rounded panes with an accent seam + soft depth; a faint ambient field
// behind them; a staggered entrance; and a graceful collapse to a single scrolling column on narrow screens.
// All scoped under #holospace-host so it never leaks. Honors prefers-reduced-motion + light/dark.
const HOST_STYLE = `
#holospace-host{--hsh-accent:#5b8cff;position:fixed;inset:0;overflow:hidden;color-scheme:dark light;
  background:
    radial-gradient(1200px 800px at 18% -10%, color-mix(in oklab,var(--hsh-accent) 22%,transparent), transparent 60%),
    radial-gradient(1000px 700px at 110% 120%, color-mix(in oklab,var(--hsh-accent) 16%,transparent), transparent 55%),
    #07070c;}
#holospace-host::before{content:"";position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(140% 120% at 50% 0%, transparent 60%, color-mix(in oklab,#000 55%,transparent));}
#holospace-host .hsh-cell{position:absolute;left:var(--l);top:var(--t);width:var(--w);height:var(--h);
  padding:7px;box-sizing:border-box;animation:hsh-in .52s cubic-bezier(.2,.8,.2,1) both;animation-delay:var(--d,0ms);}
#holospace-host .hsh-pane{display:block;width:100%;height:100%;border:0;border-radius:15px;background:#0b0b12;
  box-shadow:0 14px 40px -16px #000c, 0 0 0 1px color-mix(in oklab,var(--hsh-accent) 26%,transparent),
    inset 0 0 0 1px color-mix(in oklab,#fff 5%,transparent);
  transition:box-shadow .22s ease, transform .22s ease;}
#holospace-host .hsh-cell:hover .hsh-pane{box-shadow:0 22px 60px -18px #000d,
    0 0 0 1px color-mix(in oklab,var(--hsh-accent) 60%,transparent), 0 0 26px -6px color-mix(in oklab,var(--hsh-accent) 45%,transparent);}
#holospace-host[data-stack="1"] .hsh-cell{padding:0;}
#holospace-host[data-stack="1"] .hsh-pane{border-radius:0;}
#holospace-host .hsh-empty{position:absolute;inset:0;display:grid;place-items:center;
  color:color-mix(in oklab,#fff 45%,transparent);font:14px/1.5 system-ui;letter-spacing:.01em;}
@keyframes hsh-in{from{opacity:0;transform:translateY(10px) scale(.985);}to{opacity:1;transform:none;}}
/* responsive: collapse any multi-pane layout to a single scrolling column on a narrow viewport */
@media (max-width:720px){
  #holospace-host{overflow-y:auto;overflow-x:hidden;}
  #holospace-host .hsh-cell{position:relative!important;left:0!important;top:0!important;width:100%!important;height:74vh!important;padding:8px;}
}
@media (prefers-reduced-motion:reduce){#holospace-host .hsh-cell{animation:none;}#holospace-host .hsh-pane{transition:none;}}`;
function injectHostStyle(doc = document) { if (doc.getElementById("holospace-host-style")) return; const s = doc.createElement("style"); s.id = "holospace-host-style"; s.textContent = HOST_STYLE; (doc.head || doc.documentElement).appendChild(s); }

// the space's accent (Law L1 identity carries it) → the theme. Falls back to the Hologram blue.
const accentOf = (space) => { const a = space && space.accent; return (typeof a === "string" && /^#[0-9a-f]{3,8}$/i.test(a)) ? a : "#5b8cff"; };

// mountHost(space, root) — tile the members as themed, gapped, animated panes. Returns the plan (tests/telemetry).
export function mountHost(space, root, doc = document) {
  const plan = planHost(space);
  root.textContent = "";
  root.style.setProperty("--hsh-accent", accentOf(space));
  root.toggleAttribute("data-stack", plan.layout === "stack");
  if (!plan.ok || !plan.members.length) { const e = doc.createElement("div"); e.className = "hsh-empty"; e.textContent = "Nothing here yet."; root.appendChild(e); return plan; }
  plan.members.forEach((m, i) => {
    const r = m.rect;
    const cell = doc.createElement("div");
    cell.className = "hsh-cell";
    cell.style.cssText = `--l:${r.left}%;--t:${r.top}%;--w:${r.width}%;--h:${r.height}%;--d:${i * 60}ms;` + (plan.layout === "stack" ? `z-index:${i + 1};` : "");
    const f = doc.createElement("iframe");
    f.className = "hsh-pane";
    f.src = m.url;
    f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-modals");
    f.setAttribute("loading", "lazy");
    cell.appendChild(f);
    root.appendChild(cell);
  });
  return plan;
}

// boot() — read the space ref from the URL, load + L5-verify, mount. Two forms:
//   ?ref=<space-κ>            → resolve from the holo-spaces κ-store (store.get re-derives, refuses drift).
//   ?s=<b64url>[&k=<hex>]     → self-contained (the canonical bytes in the link); if k is given, verify first.
// Either failure paints an empty surface (fail-closed), never a wrong or partial arrangement.
async function boot() {
  if (typeof document === "undefined") return;
  injectHostStyle();
  let root = document.getElementById("holospace-host");
  if (!root) { root = document.createElement("div"); root.id = "holospace-host"; (document.body || document.documentElement).appendChild(root); }
  try {
    const p = new URLSearchParams(location.search);
    const SP = await import(SPACES_URL);
    let space = null;
    if (p.get("s")) {
      space = SP.decode(p.get("s"));
      const expect = p.get("k") || (location.hash.match(/k=([0-9a-f]{64})/) || [])[1] || null;
      if (expect && !(await SP.verify(space, expect))) space = null;   // tampered self-contained link → refuse
    } else if (p.get("ref")) {
      space = await SP.makeStore().get(p.get("ref"));                   // store.get already L5-verifies
    }
    if (!space) { const e = document.createElement("div"); e.className = "hsh-empty"; e.textContent = "Couldn't open this space."; root.appendChild(e); return; }
    mountHost(space, root);
  } catch (e) { const x = document.createElement("div"); x.className = "hsh-empty"; x.textContent = "Couldn't open this space."; root.appendChild(x); }
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}

export default { planHost, mountHost, layoutRects, hexOf };
