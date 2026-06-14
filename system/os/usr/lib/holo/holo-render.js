// holo-render.js — THE canonical render path for every UOR object in the Hologram substrate.
//
// One entry, one law:  render(κ) → display.  Given any content-derived address, resolve the bytes
// (arena → cache → importmap/holo-route), verify by re-derivation (Law L5), and mount — with NO
// compiler on the hot path. The κ already *is* the compiled bytes; rendering never recompiles.
//
// Every object is atomic and addressed by κ. A "bundle" is itself a UOR object that references child
// κ's; rendering composes them (shared children resolve once — Law L3 dedup), and any child can be
// pulled back out by its own κ and rendered standalone. Objects bundle and unbundle into new objects
// infinitely, all addressed and rendered from a single content-derived κ.
//
// Lean: zero hard dependencies. React is imported lazily, and ONLY when a component is actually
// rendered — an image/text/json view never loads it, and nothing ever loads the TypeScript compiler.

const te = new TextEncoder();
const ARENA = new Map();     // κ → Uint8Array        (resident bytes, zero-copy reuse — the L1 arena)
const MODS = new Map();      // κ → ESM module        (parsed once, then O(1) rebind)
const ELS = new Map();       // κ → resolved kind     (sniff once)
const stats = { resolved: 0, refused: 0, hits: 0, arena: () => ARENA.size, mods: () => MODS.size };

let IMPORTMAP = null;        // { imports:{ "holo://sha256:κ": path }, integrity:{ path: sri } }
let BASE = "/ui/";           // where the registry/vendor tree is served
let REACT = null;            // lazily-imported shared runtime
let RESOLVER = null;         // the substrate's CANONICAL resolveByKappa(κ)→bytes (holo-resolver.mjs):
                             // already multi-source + L5. Injected by the shell so this renderer rides
                             // the ONE resolution spine instead of carrying its own (no duplicate).
let ROUTE = null;            // κ-hex → URL for module import / fallback fetch. Defaults to BASE-relative;
                             // the OS2 shell passes the substrate κ-route ((h)=>"/.holo/sha256/"+h).

// ── identity ────────────────────────────────────────────────────────────────────────────────
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function sha256hex(bytes) { return hex(await crypto.subtle.digest("SHA-256", bytes)); }
const norm = (k) => String(k).replace(/^did:holo:/, "").replace(/^holo:\/\//, "").replace(/^sha256:/, "");
const holoKey = (k) => "holo://sha256:" + norm(k);          // importmap key form
export function canonicalize(v) {                            // stable JSON — Node and browser agree on κ
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  if (v && typeof v === "object")
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalize(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
export const kappaOfBytes = async (b) => "did:holo:sha256:" + await sha256hex(b instanceof Uint8Array ? b : te.encode(b));
export const kappaOfObject = async (o) => kappaOfBytes(te.encode(canonicalize(o)));

// ── config / resolution surface ───────────────────────────────────────────────────────────────
export async function configure({ importmap, base, resolver, route, bare, stream } = {}) {
  if (base) BASE = base.endsWith("/") ? base : base + "/";
  if (resolver) RESOLVER = resolver;          // hand in holo-resolver.mjs's resolveByKappa to unify
  if (route) ROUTE = route;                   // hand in the substrate κ-route (e.g. /.holo/sha256/<hex>)
  if (bare) Object.assign(BARE, bare);        // override/extend the shared-runtime bare→κ link map
  // an importmap is OPTIONAL — most apps have none; resolution rides ROUTE/RESOLVER. Never throw on a
  // missing/non-JSON map (a 404 resolves with a text body, so guard r.ok AND the parse).
  if (importmap) IMPORTMAP = importmap;
  else if (!IMPORTMAP) { try { const r = await fetch(BASE + "vendor/importmap.json"); IMPORTMAP = r.ok ? await r.json() : { imports: {}, integrity: {} }; } catch { IMPORTMAP = { imports: {}, integrity: {} }; } }
  if (stream !== false) { try { autoStream(); } catch (e) {} }   // every configured surface streams the scene ahead (idle-time, deduped)
  return IMPORTMAP;
}
function urlForKappa(k) {
  const key = holoKey(k);
  const p = IMPORTMAP?.imports?.[key];
  if (p) return new URL(p.replace(/^\.\//, ""), location.origin + BASE).pathname;   // mapped object
  if (ROUTE) return ROUTE(norm(k));                                                  // substrate κ-route
  return BASE + "holo/sha256/" + norm(k);                                            // BASE-relative fallback
}

// ── resolve: bytes by κ, L5-verified, arena-cached ──────────────────────────────────────────────
// The ARENA is this page's L1 (resident, zero-copy reuse). The actual fetch+verify is the substrate's
// ONE canonical resolver (RESOLVER, from holo-resolver.mjs) when wired — multi-source, already L5. The
// inline path below is only the STANDALONE fallback (single origin source + the same re-derive law), so
// the renderer never carries a second resolution policy: same contract, one authority.
async function originSource(k) { try { const r = await fetch(urlForKappa(k), { cache: "force-cache" }); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } }
// OPFS durable κ-store: a remix (stash) is written here keyed by its κ, so it SURVIVES reload and
// resolves with no server — verified on read (Law L5). Per-origin, in-browser, low-latency.
let OPFS;
async function opfsDir() { if (OPFS !== undefined) return OPFS; try { OPFS = await (await navigator.storage.getDirectory()).getDirectoryHandle(".holo-store", { create: true }); } catch { OPFS = null; } return OPFS; }
async function opfsGet(hex) { const d = await opfsDir(); if (!d) return null; try { return new Uint8Array(await (await (await d.getFileHandle(hex)).getFile()).arrayBuffer()); } catch { return null; } }
async function opfsPut(hex, bytes) { const d = await opfsDir(); if (!d) return; try { const w = await (await d.getFileHandle(hex, { create: true })).createWritable(); await w.write(bytes); await w.close(); } catch {} }
export async function resolve(k) {
  const id = norm(k);
  if (ARENA.has(id)) { stats.hits++; return ARENA.get(id); }      // L1: page fault hit — already verified
  const durable = await opfsGet(id);                              // L2: durable remix store (survives reload)
  if (durable && await sha256hex(durable) === id) { ARENA.set(id, durable); stats.hits++; return durable; }
  let bytes;
  if (RESOLVER) {                                                 // canonical spine: multi-source + L5
    bytes = await RESOLVER("did:holo:sha256:" + id);
  } else {                                                        // standalone fallback: one source, same law
    bytes = await originSource(k);
    if (!bytes || await sha256hex(bytes) !== id) { stats.refused++; throw new Error(`L5 REFUSED: ${id.slice(0, 12)}… not served as a κ-verified copy`); }
  }
  ARENA.set(id, bytes); stats.resolved++;
  return bytes;
}

// ── module by κ: a content-addressed LINKER ──────────────────────────────────────────────────────
// A component object imports the shared runtime by BARE specifier ("react", "motion/react", …). Rather
// than require a per-app <script type=importmap> to resolve those, the renderer resolves the WHOLE bare
// graph itself: it rewrites each bare specifier to a LINKED blob of that dependency (resolved by κ,
// recursively), so the entire graph collapses to ONE content-addressed instance. A React object then
// renders in ANY app with NO importmap — the renderer IS the linker. react.js / motion-react.js are
// re-derived (Law L5) before linking; the rewrite only re-points imports to their own κ-addressed bytes.
let BARE = {                                          // bare specifier → the shared-runtime object's κ
  "react": "holo://sha256:74436b47124b30450006656e08ce12276cf5883a6f23f7a95377242c0d6a1760",
  "react/jsx-runtime": "holo://sha256:74436b47124b30450006656e08ce12276cf5883a6f23f7a95377242c0d6a1760",
  "react-dom": "holo://sha256:74436b47124b30450006656e08ce12276cf5883a6f23f7a95377242c0d6a1760",
  "react-dom/client": "holo://sha256:74436b47124b30450006656e08ce12276cf5883a6f23f7a95377242c0d6a1760",
  "motion/react": "holo://sha256:ce28f32e6d4598a27e10541ac446c659bf67603b1d4b0dc6f922cec0d7ad2db6",
};
const BLOBS = new Map();                              // κ → linked blob URL (bare deps resolved), built once
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
async function linkBlob(k) {
  const id = norm(k);
  if (BLOBS.has(id)) return BLOBS.get(id);
  let code = new TextDecoder().decode(await resolve(k));            // L5-verified bytes
  for (const spec of Object.keys(BARE)) {
    const pat = '((?:from|import)\\s*\\(?\\s*)(["\'])' + reEsc(spec) + '\\2';   // from"x" · import"x" · import("x")
    if (!new RegExp(pat).test(code)) continue;
    const dep = await linkBlob(BARE[spec]);                         // resolve the dependency to its linked blob
    code = code.replace(new RegExp(pat, "g"), '$1$2' + dep + '$2');
  }
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  BLOBS.set(id, url); return url;
}
export async function module(k) {
  const id = norm(k);
  if (MODS.has(id)) { stats.hits++; return MODS.get(id); }
  const mod = await import(/* @vite-ignore */ await linkBlob(k));   // import the linked module (one react instance)
  MODS.set(id, mod);
  return mod;
}
// the host React = the SAME linked instance the components use (so hooks/context match — one React)
async function react() { return REACT || (REACT = await import(/* @vite-ignore */ await linkBlob(BARE["react"]))); }

// ── kind detection (sniff once) ─────────────────────────────────────────────────────────────────
async function kindOf(k) {
  const id = norm(k);
  if (ELS.has(id)) return ELS.get(id);
  let kind;
  const mapped = IMPORTMAP?.imports?.[holoKey(k)];
  // minified ESM reliably carries `export{…}` / `import…` but NOT in its first bytes — scan a real window.
  const isEsm = (t) => /(^|[;}\s,)])(export|import)\s*[\s{*('"]/.test(t);
  if (mapped?.endsWith(".js")) kind = "module";
  else if (mapped?.endsWith(".json")) kind = "json-mapped";   // resolve to decide bundle vs plain json below
  if (!kind || kind === "json-mapped") {
    const b = await resolve(k);
    if (b[0] === 0x89 && b[1] === 0x50) kind = "png";
    else if (b[0] === 0xff && b[1] === 0xd8) kind = "jpeg";
    else {
      const text = new TextDecoder().decode(b.length > 65536 ? b.slice(0, 65536) : b);
      const head = text.trimStart();
      if (head.startsWith("<svg") || head.startsWith("<?xml")) kind = "svg";
      else if (head[0] === "{" || head[0] === "[") { try { const j = JSON.parse(new TextDecoder().decode(b)); kind = (j && j["@type"] === "holo:Bundle") ? "bundle" : "json"; } catch { kind = isEsm(text) ? "module" : "text"; } }
      else if (isEsm(text)) kind = "module";
      else kind = "text";
    }
  }
  ELS.set(id, kind); return kind;
}

// ── element builder: turn any spec into a React element (the composition primitive) ──────────────
// spec forms (all JSON-serialisable, all κ-interoperable):
//   "holo://sha256:κ"                        → render that object's primary export / view
//   { kappa, export?, props?, children? }    → a component object, with props + (κ|spec|text) children
//   { tag, props?, children? }               → a raw host element (div/span/…) for layout glue
//   "literal string"                          → a text node
export async function element(spec, key) {
  const { createElement: h } = await react();
  if (spec == null) return null;
  if (typeof spec === "string") return /^(holo:\/\/|did:holo:|sha256:)/.test(spec) ? element({ kappa: spec }, key) : spec;
  if (Array.isArray(spec)) return Promise.all(spec.map((s, i) => element(s, i)));
  if (spec.text != null) return spec.text;
  if (spec.bundle) return bundleElement(spec.bundle);    // embed another bundle object (nest κ's)
  let type, props = { ...(spec.props || {}), key: spec.key ?? key };
  if (spec.tag) type = spec.tag;
  else if (spec.kappa) {
    const mod = await module(spec.kappa);
    type = spec.export ? mod[spec.export] : (mod.default || Object.values(mod).find((v) => typeof v === "function"));
    if (!type) throw new Error("no renderable export in " + norm(spec.kappa).slice(0, 12));
  } else throw new Error("element: spec needs kappa or tag");
  const kids = spec.children == null ? [] : await element(Array.isArray(spec.children) ? spec.children : [spec.children]);
  return h(type, props, ...(Array.isArray(kids) ? kids : [kids]));
}

// ── render: the canonical entry — mount ANY κ (or spec) into a target element ────────────────────
export async function render(target, kOrSpec, ctx = {}) {
  const t0 = performance.now();
  const el = typeof target === "string" ? document.querySelector(target) : target;
  const spec = (typeof kOrSpec === "string") ? kOrSpec : kOrSpec;
  let kind, node;
  if (typeof spec === "string" && /^(holo:\/\/|did:holo:|sha256:)/.test(spec)) {
    if (el) el.setAttribute("data-holo-kappa", "holo://sha256:" + norm(spec));   // tag the object so it is editable/copyable by its κ (remix layer)
    kind = await kindOf(spec);
    if (kind === "module") node = await element({ kappa: spec, export: ctx.export, props: ctx.props, children: ctx.children });
    else if (kind === "bundle") node = await bundleElement(spec);
    else { mountRaw(el, kind, await resolve(spec)); return done(el, kind, t0); }
  } else { kind = "spec"; node = await element(spec); }            // an inline composition spec
  const { createRoot } = await react();
  const root = el.__holoRoot || (el.__holoRoot = createRoot(el));
  root.render(node);
  return done(el, kind, t0);
}
function done(el, kind, t0) { return { kind, ms: +(performance.now() - t0).toFixed(2), arena: ARENA.size, mods: MODS.size }; }

function mountRaw(el, kind, bytes) {
  if (kind === "png" || kind === "jpeg") { const u = URL.createObjectURL(new Blob([bytes], { type: "image/" + kind })); el.innerHTML = `<img src="${u}" style="max-width:100%">`; }
  else if (kind === "svg") el.innerHTML = new TextDecoder().decode(bytes);
  else { const pre = document.createElement("pre"); pre.style.cssText = "white-space:pre-wrap;word-break:break-word;margin:0"; pre.textContent = new TextDecoder().decode(bytes); el.replaceChildren(pre); }
}

// ── bundles: a UOR object that composes child κ's; resolves to one React element ─────────────────
export async function bundle(k) { return JSON.parse(new TextDecoder().decode(await resolve(k))); }
async function bundleElement(k) {
  const { createElement: h } = await react();
  const b = await bundle(k);
  const kids = await element(b.children || []);
  const layouts = { row: { display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" },
    col: { display: "flex", flexDirection: "column", gap: "12px" },
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "12px" }, stack: {} };
  return h("div", { "data-holo-bundle": norm(k).slice(0, 12), style: { ...(layouts[b.layout] || {}), ...(b.style || {}) } }, ...(Array.isArray(kids) ? kids : [kids]));
}
// unbundle: list the child κ's an object composes (each is itself a standalone renderable object)
export async function unbundle(k) { const b = await bundle(k); return (b.children || []).flatMap(childKappas); }
function childKappas(c) { const out = []; if (typeof c === "string" && /sha256:/.test(c)) out.push(norm(c)); if (c && c.kappa) out.push(norm(c.kappa)); if (c && c.bundle) out.push(norm(c.bundle)); if (c && c.children) out.push(...[].concat(c.children).flatMap(childKappas)); return out; }

// ── remix: an edit IS a new object ───────────────────────────────────────────────────────────────
// source(κ) → the object's bytes as text (for an editor). stash(bytes) → mint a NEW content-addressed
// object from edited bytes: hash → its κ, hold it resident (arena), and return the κ. Re-rendering from
// that κ shows the remix live; the κ re-derives, so the edit is a shareable, self-verifying object —
// not a mutation of the original (Law L1/L5). Persisting it beyond the session (OPFS / κ-route) is a
// thin add on top of this. caches for the new κ are fresh (distinct id), so it sniffs/links correctly.
export async function source(k) { return new TextDecoder().decode(await resolve(k)); }
export async function stash(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes));
  const id = await sha256hex(u);
  ARENA.set(id, u); ELS.delete(id); MODS.delete(id); BLOBS.delete(id);   // resident + fresh derivation caches
  await opfsPut(id, u);                                                    // durable: the remix survives reload (auto)
  return "did:holo:sha256:" + id;
}

// ── streaming: warm κ objects ahead of need ──────────────────────────────────────────────────────
// warm(κ[]) PREFETCHES objects into the resident arena (L1) — and, for components, pre-LINKS them
// (compiled module + React graph ready) — so the subsequent render is a zero-fetch, zero-compile rebind
// (sub-ms, frame-rate). This is the streaming primitive: pull the next scene's κ-objects while the
// current frame shows, exactly like a video player buffers ahead or a game preloads assets — except the
// unit is a self-verifying content address, so a warmed object is already L5-verified. Returns per-κ ok.
export async function warm(ks, opts = {}) {
  const arr = Array.isArray(ks) ? ks : [ks];
  return Promise.all(arr.map(async (k) => {
    try { await resolve(k); if (opts.link !== false) { try { await linkBlob(k); } catch (e) {} } return true; } catch (e) { return false; }
  }));
}

// ── scene-prefetch driver: predict-and-stream the NEXT objects ───────────────────────────────────
// Streams κ-objects into the resident arena BEFORE they are needed, during idle time, so the eventual
// render is a 0.04ms rebind. Two predict signals, both content-addressed: (1) any element carrying a κ
// (data-holo-kappa) or an explicit hint (data-holo-warm="holo://κ" — an object NOT yet rendered) that is
// within a few screens of the viewport (IntersectionObserver) → warm it; (2) a rendered bundle → warm
// its child κ's. Deduped by the arena (resident ⇒ no-op), drained on requestIdleCallback. Like a video
// player buffering ahead, but the unit is a self-verifying object — so prefetch never trusts, it verifies.
const _q = new Set(); let _io = null, _draining = false; const idle = (typeof globalThis !== "undefined" && globalThis.requestIdleCallback) || ((f) => setTimeout(f, 1));
function _enqueue(k) { const id = norm(k); if (!id || ARENA.has(id) || _q.has(id)) return; _q.add(id); _drain(); }
function _drain() {
  if (_draining || !_q.size) return; _draining = true;
  const step = () => { const it = _q.values().next(); if (it.done) { _draining = false; return; } const id = it.value; _q.delete(id);
    warm(["did:holo:sha256:" + id]).catch(() => {}).then(() => idle(step)); };
  idle(step);
}
export function prefetch(ks) { (Array.isArray(ks) ? ks : [ks]).forEach(_enqueue); return _q.size; }
export function autoStream(opts = {}) {
  if (_io || typeof IntersectionObserver === "undefined" || typeof document === "undefined") return _io;
  _io = new IntersectionObserver((ents) => { for (const e of ents) if (e.isIntersecting) { const k = e.target.getAttribute("data-holo-warm") || e.target.getAttribute("data-holo-kappa"); if (k) _enqueue(k); } },
    { rootMargin: opts.rootMargin || "300% 0px" });                       // warm within ~3 screens of the viewport
  const scan = () => { try { document.querySelectorAll("[data-holo-warm],[data-holo-kappa]").forEach((el) => { if (!el.__holoObs) { el.__holoObs = 1; _io.observe(el); } }); } catch (e) {} };
  scan(); try { new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  return _io;
}

export const HoloRender = { configure, resolve, module, element, render, bundle, unbundle, source, stash, warm, prefetch, autoStream, kappaOfBytes, kappaOfObject, canonicalize, stats };
export default HoloRender;
