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
import { derive } from "./holo-derive.mjs";
import { blake3hex } from "./holo-blake3.mjs";   // the ONE canonical κ hash (Law §1.2)

const PREFIX = "did:holo:blake3:";   // canonical κ DID label (§1.2) for member refs
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

// spaceRefFromLocation(loc) — PURE. Derive WHICH space this tab mounts from the URL, in three forms
// (precedence). This is what makes the host position-independent: the SAME document boots whether it
// was reached by a query link or by navigating the clean κ URL `holo://space/<κ>` (P2.1 — "open it in
// a real tab is just LoadURL"), and the nested-space member iframes (memberUrl → holo://space/<κ>) hit
// the exact same path form.
//   ?s=<b64url>[&k=<hex>|#k=<hex>]  → self-contained: the canonical bytes ride in the link, so it resolves
//                                     in ANY origin with no store; k (if given) is the κ to verify against.
//   ?ref=<κ>                        → resolve from the holo-spaces κ-store (store.get re-derives, L5).
//   path form  holo://space/<κ>     → host="space", pathname="/<κ>"; the segment IS the ref (the clean URL).
// Returns { payload, expect } | { ref } | null (nothing addressable → the caller paints an empty surface).
export function spaceRefFromLocation(loc = (typeof location !== "undefined" ? location : null)) {
  if (!loc) return null;
  const p = new URLSearchParams(loc.search || "");
  if (p.get("s")) {
    const k = p.get("k") || ((String(loc.hash || "").match(/k=([0-9a-f]{64})/i) || [])[1]) || "";
    return { payload: p.get("s"), expect: hexOf(k) || null };
  }
  if (p.get("ref")) { const r = hexOf(p.get("ref")); return r ? { ref: r } : null; }
  // path form. holo://space/<κ> commits host="space" + pathname="/<κ>"; also accept a "/space/<κ>" path
  // anywhere (e.g. a same-origin OS serve), so both the per-origin and OS-origin wirings resolve identically.
  const host = String(loc.host || "").toLowerCase();
  const path = String(loc.pathname || "");
  let seg = "";
  if (host === "space") seg = path.replace(/^\/+/, "").split(/[/?#]/)[0];
  else { const m = path.match(/\/space\/([^/?#]+)/i); if (m) seg = m[1]; }
  const ref = hexOf(seg);
  return ref ? { ref } : null;
}

// spaceTabUrl({ kappa, payload }) — the INVERSE of spaceRefFromLocation: build the URL a tab (or a nested-space
// iframe) LoadURLs to open a space, single-sourced so the chrome and the host agree on what a space tab means
// (like memberUrl for members). Bare `holo://space/<κ>` when the bytes are resolvable (published to the content
// route); the self-contained `holo://space/<κ>?s=<bytes>` cold path when they are not (works in any origin, no
// store). Round-trips: spaceRefFromLocation(new URL(spaceTabUrl(x))) recovers x. Returns null for a non-κ input.
export function spaceTabUrl({ kappa, payload } = {}) {
  const hex = hexOf(kappa);
  if (!hex) return null;
  const base = "holo://space/" + hex;
  return payload ? base + "?s=" + payload : base;
}

// loadSpace(SP, sel, store) — PURE-ish (only the store touches I/O). Turn a selector from spaceRefFromLocation
// into a verified space object, or null (fail-closed). The store is injectable: the browser default is the
// per-origin OPFS κ-store (SP.makeStore()), but a per-origin `space` tab supplies a content-addressed backend
// (fetch by κ over the origin's /.holo route) so a bare `holo://space/<κ>` resolves cross-origin, and the
// witness injects an in-memory one. Either way store.get re-derives on read (L5) — drift is refused, not shown.
export async function loadSpace(SP, sel, store = null) {
  if (!sel) return null;
  if (sel.payload != null) {
    let space; try { space = SP.decode(sel.payload); } catch { return null; }
    // Verify the RAW link bytes (dual-read: BLAKE3 canonical OR legacy sha256) — prefix-agnostic + legacy-safe,
    // so an old self-contained link still opens while new links are BLAKE3. Falls back to object-verify if the
    // build predates verifyBytes (older holo-spaces).
    if (sel.expect) {
      const raw = SP.payloadBytes ? SP.payloadBytes(sel.payload) : null;
      const ok = (raw && SP.verifyBytes) ? await SP.verifyBytes(raw, sel.expect) : await SP.verify(space, sel.expect);
      if (!ok) return null;                                                  // tampered self-contained link → refuse
    }
    return space || null;
  }
  if (sel.ref) return await (store || SP.makeStore()).get(sel.ref);         // store.get already L5-verifies
  return null;
}

// storeForLocation(SP, loc) — pick the κ-store a `?ref`/bare-κ space resolves through, BY ORIGIN. A
// `holo://space/<κ>` tab has an empty per-origin OPFS (it did not author the space), so it reads the published
// bytes via the content route (SP.contentBackend over /.holo/sha256/<hex>, re-derived on read, L5); anywhere
// else (the OS origin / a dev embed) the default OPFS store applies. The self-contained `?s=` form bypasses the
// store entirely, so it is unaffected either way.
export function storeForLocation(SP, loc = (typeof location !== "undefined" ? location : null)) {
  const host = String((loc && loc.host) || "").toLowerCase();
  return host === "space" && SP.contentBackend ? SP.makeStore(SP.contentBackend()) : SP.makeStore();
}

// ── The derive-portal (slice 8a): a tab is a portal for ANY κ, not only a space ─────────────────────
// A holospace (a COMPOSITION of member surfaces) is one kind of κ. A machine snapshot, an image, a video,
// a scene are OTHER kinds — a single κ-object, projected by a lens. Both enter this ONE document; both are
// admitted by verify-before-project (L5). So the tab is the universal portal the master brief describes:
// its content = whatever derive(κ) resolves. `space` stays the composition path (below); every other kind
// routes through the ONE verb `derive()`. The URL carries the projection hint (kind + meta); the bytes still
// come by κ and are verified — the hint is never a trust input, only a routing choice.
//
//   descriptorFromLocation(loc) → { kappa, kind, meta } | null    — PURE (null ⇒ the space/composition path)
//   deriveTab(desc, ctx)        → derive(desc, ctx)                — the ONE verb, DI-seamed for the witness
//   projectPortal(desc, root, ctx) → derive + attach the projection to the tab (browser)
const PORTAL_KINDS = new Set(["machine", "image", "video", "audio", "scene", "bytes"]);

// descriptorFromLocation — read WHICH single κ-object this tab projects, and HOW, from the URL alone. A
// `?kind=<k>` names a projected kind (machine/image/video/audio/scene/bytes); its absence (or `kind=space`)
// means the tab is a composition → return null so boot() takes the proven space path. The κ comes from
// `?ref=<κ>` (OS origin) or the clean path `holo://space/<κ>` (host="space", "/<κ>"), same as a space tab —
// so ONE native route (holo://space/<κ>[?kind=…&meta…], query forwarded verbatim) serves every kind, no host
// change. Remaining query params are the projection meta (dims, mime, engine, guest, name, …). Fail-soft:
// an unknown kind or a non-κ segment → null (boot() paints an honest surface), never a wrong projection.
// metaFromQuery(loc) — the projection hints carried in the URL (everything but the routing keys). PURE.
export function metaFromQuery(loc = (typeof location !== "undefined" ? location : null)) {
  const meta = {}; if (!loc) return meta;
  for (const [k, v] of new URLSearchParams(loc.search || "").entries()) if (k !== "kind" && k !== "ref" && k !== "s" && k !== "k") meta[k] = v;
  return meta;
}

export function descriptorFromLocation(loc = (typeof location !== "undefined" ? location : null)) {
  if (!loc) return null;
  const p = new URLSearchParams(loc.search || "");
  const kind = String(p.get("kind") || "").toLowerCase();
  if (!kind || kind === "space") return null;            // a composition (or unspecified) → the space path
  if (!PORTAL_KINDS.has(kind)) return null;              // an unknown kind → fall through (fail-soft)
  let seg = p.get("ref") || "";
  if (!seg) {
    const host = String(loc.host || "").toLowerCase();
    const path = String(loc.pathname || "");
    if (host === "space") seg = path.replace(/^\/+/, "").split(/[/?#]/)[0];
    else { const m = path.match(/\/space\/([^/?#]+)/i); if (m) seg = m[1]; }
  }
  const kappa = hexOf(seg);
  if (!kappa) return null;
  return { kappa, kind, meta: metaFromQuery(loc) };
}

// deriveTab — the ONE verb, thin. Kept as its own seam so boot() reads clean and the witness drives derive()
// with injected transport + projectors exactly as the browser does (same code path, faithful stubs).
export function deriveTab(desc, ctx) { return derive(desc, ctx); }

// ── browser lens (guarded: never runs under node/SSR, so the module imports cleanly in the witness) ──────
// A content-addressed DEVICE CACHE (OPFS) in front of the content route: a κ opened before on this
// device returns with ZERO network — "boot once per planet" at the ONE derive door, for EVERY kind
// (machine/image/video/…), not just one app. A κ is immutable (κ IS its hash), so a cached blob is valid
// forever; verify-before-cache keeps a bad byte off disk, and derive() re-verifies on read either way
// (L5). Fully guarded: no OPFS — or any error — falls through to the plain content-route fetch (the exact
// prior behavior). Exported (`portalFetchBytes`) for isolation testing.
let _kdirP = null;
function _kcacheDir() {
  if (_kdirP) return _kdirP;
  _kdirP = (async () => {
    try {
      try { await navigator.storage.persist?.(); } catch (e) {}   // ask the browser NOT to evict — makes "0-net on return" DURABLE
      const root = await navigator.storage.getDirectory();
      return await root.getDirectoryHandle("holo-kappa-cache", { create: true });
    } catch (e) { return null; }
  })();
  return _kdirP;
}
async function _kcacheGet(kappa) {
  try { const d = await _kcacheDir(); if (!d) return null; const fh = await d.getFileHandle(kappa); return new Uint8Array(await (await fh.getFile()).arrayBuffer()); }
  catch (e) { return null; }                                  // not cached (or OPFS off) → miss
}
async function _sha256hex(bytes) { const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)); let x = ""; for (let i = 0; i < h.length; i++) x += h[i].toString(16).padStart(2, "0"); return x; }
async function _kcachePut(kappa, bytes) {
  try {
    const d = await _kcacheDir(); if (!d) return;
    // verify-before-cache (L5): persist ONLY bytes that hash to their κ. Prefer canonical BLAKE3 (§1.2);
    // accept the legacy sha256 alias too, so a κ addressed on either axis is cached correctly, never a bad byte.
    let match = false;
    try { match = blake3hex(bytes) === kappa; } catch (e) {}
    if (!match) { try { match = (await _sha256hex(bytes)) === kappa; } catch (e) {} }
    if (!match) return;
    try { await d.getFileHandle(kappa); return; } catch (e) {}                    // already on device → dedup
    const fh = await d.getFileHandle(kappa, { create: true }); const w = await fh.createWritable(); await w.write(bytes); await w.close();
  } catch (e) {}                                              // eviction/quota/etc. → best-effort, never throws into the fetch path
}
async function _routeFetch(url) {
  try { const r = await fetch(url); if (!r || !r.ok) return null; return new Uint8Array(await r.arrayBuffer()); }
  catch (e) { return null; }
}
export function portalFetchBytes(kappa) {
  return (async () => {
    const cached = await _kcacheGet(kappa);
    if (cached) return cached;                                                    // device hit → 0 network (derive re-verifies)
    // canonical BLAKE3 route first (§1.2); fall back to the legacy sha256 bridge-alias (migration-resilient).
    // derive() re-verifies the bytes against the descriptor κ (L5) either way, so a wrong axis fails closed.
    let bytes = await _routeFetch("/.holo/blake3/" + kappa);
    if (!bytes) bytes = await _routeFetch("/.holo/sha256/" + kappa);
    if (!bytes) return null;
    _kcachePut(kappa, bytes);                                                     // fire-and-forget: cache for next open
    return bytes;
  })();
}

// b64url → bytes (URL-safe, no padding). The self-contained transport: the whole κ-object rides in the link's
// boundary (holographic principle #1), so a portal resolves with NO store, NO cache — in any origin. derive()
// still hashes the decoded bytes and refuses a mismatch (L5), so an inline blob is exactly as safe as a fetched
// one. Mirrors the space `?s=` self-contained form for single κ-objects.
export function b64urlToBytes(s) {
  const b64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// sniffKind(bytes) — identify a verified κ-object by its content (magic numbers), so a BARE κ with no declared
// kind still routes to the right lens. Dependency-free + pure → node-witnessable. Unknown → "bytes".
export function sniffKind(bytes) {
  const b = bytes; if (!b || b.length < 4) return "bytes";
  if (b[0] === 0x7b) {                                                                                   // '{' → maybe a space (JSON identity tuple)
    try { const o = JSON.parse(new TextDecoder().decode(b)); if (o && typeof o === "object" && Array.isArray(o.members) && ("layout" in o || "v" in o)) return "space"; } catch (e) { /* not JSON → fall through */ }
  }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image";                 // PNG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image";                                   // JPEG
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image";                                   // GIF
  if (b.length >= 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image"; // RIFF…WEBP
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "video";   // MP4/MOV ftyp
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video";                  // EBML (WEBM/MKV)
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return "audio";                                   // MP3 ID3
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return "audio";                  // OGG
  if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) return "audio";                  // FLAC
  if (b.length >= 12 && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45) return "audio";  // RIFF…WAVE
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "audio";                                           // MPEG audio frame
  return "bytes";
}

// makeBrowserProjectors(root) — the real lenses derive() routes verified bytes to. Each attaches its surface
// full-window to `root` and returns a small plan (telemetry). Media renders now (8a); the κ super-res lens
// (holo-canvas/holo-superres) is the drop-in fidelity upgrade owned by slice 8c. `machine` delegates to a
// runtime host if one is wired (ctx.machineHost — the v86/devcontainer resume path); absent ⇒ an honest
// verified surface (the κ is proven; the resume host is the next increment), never a fake.
function makeBrowserProjectors(root) {
  const fill = (el) => { el.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;background:#000;border:0"; root.appendChild(el); return el; };
  return {
    // a space is a composition: its verified bytes ARE the canonical identity tuple (JSON); the projector decodes
    // and tiles the members (each member URL re-enters this same portal). One verb — a space is just a `kind`.
    space: async (bytes, desc) => {
      let space; try { space = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { return { action: "space-parse-failed", error: String(e && e.message || e) }; }
      mountHost(space, root);
      return { action: "tiled", media: "space", layout: space.layout || "single", members: Array.isArray(space.members) ? space.members.length : 0 };
    },
    image: async (bytes, desc) => {
      const cv = fill(document.createElement("canvas"));
      const dims = String(desc.meta?.dims || "");
      const m = dims.match(/^(\d+)x(\d+)$/);
      if (m && bytes.length >= (+m[1]) * (+m[2]) * 4) {                 // raw RGBA (W*H*4)
        const w = +m[1], h = +m[2]; cv.width = w; cv.height = h;
        cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, w * h * 4), w, h), 0, 0);
        return { action: "rendered", media: "image", src: `${w}x${h}` };
      }
      const bmp = await createImageBitmap(new Blob([bytes], { type: desc.meta?.mime || "image/png" }));  // encoded
      cv.width = bmp.width; cv.height = bmp.height; cv.getContext("2d").drawImage(bmp, 0, 0);
      return { action: "rendered", media: "image", src: `${bmp.width}x${bmp.height}` };
    },
    video: async (bytes, desc) => {
      const v = fill(document.createElement("video"));
      v.src = URL.createObjectURL(new Blob([bytes], { type: desc.meta?.mime || "video/mp4" }));
      v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true;
      await new Promise((res) => { v.onloadeddata = res; v.onerror = res; });
      await v.play().catch(() => {});
      return { action: "streaming", media: "video", src: `${v.videoWidth}x${v.videoHeight}`, stop: () => { try { URL.revokeObjectURL(v.src); } catch {} } };
    },
    audio: async (bytes, desc) => {
      const a = document.createElement("audio"); a.src = URL.createObjectURL(new Blob([bytes], { type: desc.meta?.mime || "audio/mpeg" }));
      a.autoplay = true; a.controls = true; a.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)"; root.appendChild(a);
      await a.play().catch(() => {});
      return { action: "playing", media: "audio" };
    },
    machine: async (bytes, desc, ctx) => {
      if (ctx && ctx.machineHost && typeof ctx.machineHost.resume === "function") return await ctx.machineHost.resume(bytes, desc, root);
      try {
        const host = await import("./holo-machine-host.mjs");                 // lazy: v86 only for a machine κ
        return await host.resume(bytes, desc, root);
      } catch (e) {
        const el = document.createElement("div"); el.className = "hsh-empty";
        el.textContent = `Runtime κ verified — ${(bytes.length / 1048576).toFixed(1)} MB (${desc.meta?.engine || "runtime"}); lens: ${(e && e.message) || e}`;
        root.appendChild(el);
        return { action: "resume-failed", engine: desc.meta?.engine || "v86", bytes: bytes.length, error: String((e && e.message) || e) };
      }
    },
  };
}

// makePortalCtx(root, desc) — the browser ctx for derive(): transport + the real lenses. Transport prefers the
// self-contained inline bytes (meta.bytes = b64url, whole-object-on-the-boundary) and otherwise reads by κ over
// the content route. The witness builds its own ctx (injected fetchBytes + fake projectors) and calls deriveTab
// directly, so this is never reached under node.
function makePortalCtx(root, desc) {
  const inline = desc && desc.meta && desc.meta.bytes;
  const fetchBytes = inline ? (async () => b64urlToBytes(inline)) : portalFetchBytes;
  return { fetchBytes, sniff: sniffKind, projectors: makeBrowserProjectors(root), machineHost: (typeof window !== "undefined" ? window.HoloMachineHost : null) };
}

// projectPortal(desc, root, ctx) — run the ONE verb and let its projector paint the tab. Returns derive()'s
// result (ok + kind + projection, or the refusal). Fail-closed: a refusal paints an honest surface upstream.
export async function projectPortal(desc, root, ctx) {
  const r = await deriveTab(desc, ctx || makePortalCtx(root, desc));
  return r;
}

// dual-read verify for the space-door (transition): a space still addressable by its LEGACY sha256 κ opens, while
// a BLAKE3 object κ also passes (a superset — blake3 is checked first). Uses the space model's own verifyBytes when
// reachable (browser); else falls back to BLAKE3-only. Keeps derive() BLAKE3-only by DEFAULT (§1.2) — only this
// one ambiguous door injects the transition dual-read via ctx.verify.
async function spaceAwareVerify(bytes, kappa) {
  try { const SP = await import(SPACES_URL); if (SP && SP.verifyBytes) return await SP.verifyBytes(bytes, kappa); } catch (e) { /* browser-only import; fall back */ }
  return blake3hex(bytes) === (hexOf(kappa) || String(kappa));
}

// boot() — the tab is a portal, and there is exactly ONE verb. Every URL resolves to a derive() call that
// verifies (L5) then projects by kind — a media/machine/scene κ, a SPACE composition, or a bare κ that
// self-identifies by content (sniff). No separate composition path: a space is just `kind:"space"`. Fail-closed.
async function boot() {
  if (typeof document === "undefined") return;
  injectHostStyle();
  let root = document.getElementById("holospace-host");
  if (!root) { root = document.createElement("div"); root.id = "holospace-host"; (document.body || document.documentElement).appendChild(root); }
  const fail = (msg) => { const e = document.createElement("div"); e.className = "hsh-empty"; e.textContent = msg; root.appendChild(e); };

  // (1) explicit-kind portal — the one verb, STRICT BLAKE3 verify (a declared media/machine/scene κ).
  const desc = descriptorFromLocation(location);
  if (desc) {
    let r; try { r = await projectPortal(desc, root); } catch (e) { r = { ok: false, error: "project-failed" }; }
    if (r && r.ok) return;
    fail(r && r.error === "kappa-mismatch" ? "Refused: this object failed verification." : "Couldn't open this object.");
    return;   // fail-closed: an explicitly-typed κ that refuses never falls back to a wrong projection
  }

  // (2) the space-door — holo://space/<κ>, ?kind=space, or a self-contained ?s= link. THE SAME VERB: derive →
  // dual-read verify (BLAKE3 canonical | legacy sha256, so old spaces still open) → sniff (a space composition OR
  // a bare κ-object: image/video/audio/machine) → project. Spaces and single objects share one path; the URL
  // never had to declare which. (Branch (2) replaces the old loadSpace+mountHost composition path.)
  const sel = spaceRefFromLocation(location);
  if (sel && (sel.ref || sel.payload != null)) {
    const meta = metaFromQuery(location);
    const desc2 = (sel.payload != null)
      ? { kappa: sel.expect || "", kind: undefined, meta: { ...meta, bytes: sel.payload } }
      : { kappa: sel.ref, kind: undefined, meta };
    if (desc2.kappa) {
      const ctx = makePortalCtx(root, desc2);
      ctx.verify = spaceAwareVerify;                              // the transition dual-read, injected only here
      let r; try { r = await deriveTab(desc2, ctx); } catch (e) { r = { ok: false, error: "project-failed" }; }
      if (r && r.ok) return;
      fail(r && r.error === "kappa-mismatch" ? "Refused: this failed verification." : "Couldn't open this.");
      return;
    }
    // a self-contained link with NO expected κ (no &k) → nothing to verify against; trust the boundary bytes + tile.
    if (sel.payload != null) {
      try { const space = JSON.parse(new TextDecoder().decode(b64urlToBytes(sel.payload))); mountHost(space, root); return; } catch (e) { /* not a space payload */ }
    }
  }
  fail("Couldn't open this.");
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}

export default { planHost, mountHost, layoutRects, hexOf, spaceRefFromLocation, spaceTabUrl, loadSpace, storeForLocation, descriptorFromLocation, metaFromQuery, sniffKind, deriveTab, projectPortal };
