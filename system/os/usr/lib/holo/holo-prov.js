// _shared/holo-prov.js — Holo Prov (ADR-0082) IN-TAB twin: a holospace shows its own LINEAGE
// badge live. It reads this app's provenance edge (prov:wasDerivedFrom / prov:wasRevisionOf),
// resolves each ancestor through the content-addressed app index, and RE-DERIVES each ancestor's
// closure in your tab (Law L5) — the same verify-in-tab rigor as Holo Atlas. A forged parent is
// caught: it resolves to no indexed app, or its bytes do not re-hash to their κ. A genesis app
// (no parent) shows nothing. Mints nothing.
//
// Isomorphic by design: the verification CORE (walkLineage / reDeriveClosure) is a pure function
// of injectable resolvers, so the Node witness exercises the SAME logic the browser runs. When a
// `window` is present this module also wires real fetch/WebCrypto resolvers, exposes
// window.HoloProv, and auto-mounts the live badge (opt out with <meta name="holo-prov" content="off">).

const DERIVED = "prov:wasDerivedFrom", REVISION = "prov:wasRevisionOf";
const hexOf = (k) => String(k).split(":").pop();
const parentOf = (m) => (m && (m[DERIVED] || m[REVISION])) || null;
const relOf = (m) => (m && (m[DERIVED] ? "wasDerivedFrom" : m[REVISION] ? "wasRevisionOf" : null)) || null;

// reDeriveClosure(lock, getBytes, sha256hex) → re-hash every closure file to its κ (Law L5).
// ok ⇔ every file is present AND its bytes re-derive to the κ the lock commits to.
export async function reDeriveClosure(lock, getBytes, sha256hex) {
  const entries = Object.entries((lock && lock.closure) || {});
  const bad = [];
  let checked = 0;
  for (const [path, meta] of entries) {
    const want = hexOf(meta && meta.kappa != null ? meta.kappa : meta);
    try {
      const got = hexOf(await sha256hex(await getBytes(path)));
      checked++;
      if (got !== want) bad.push(path);
    } catch { bad.push(path); }
  }
  return { ok: bad.length === 0 && checked === entries.length, checked, total: entries.length, bad };
}

// walkLineage(selfManifest, R) → the verified chain from this app to genesis. R = resolvers:
//   sha256hex(u8)->hex · folderForKappa(κ)->folder|null · getLock(folder)->lock ·
//   getManifest(folder)->manifest · getBytes(path)->Uint8Array
// Each hop asserts the edge (parent.lock.root === the κ the child claims) AND re-derives the
// parent's closure. ok ⇔ every hop verifies. Acyclic by construction; a `seen` guard is belt-and-braces.
export async function walkLineage(selfManifest, R) {
  const chain = [];
  const seen = new Set();
  let m = selfManifest;
  while (m && !seen.has(m.id)) {
    seen.add(m.id);
    const parent = parentOf(m);
    const node = { id: m.id, name: m.name || m.id, rel: relOf(m), parent };
    if (!parent) { chain.push(node); break; }                       // genesis
    const folder = await R.folderForKappa(parent);
    if (!folder) { node.parentResolved = false; chain.push(node); break; }   // forged: no such app
    const lock = await R.getLock(folder);
    node.parentResolved = true;
    node.edgeOk = !!lock && lock.root === parent;                   // the edge points at THIS app's root
    node.integrity = await reDeriveClosure(lock, R.getBytes, R.sha256hex);
    chain.push(node);
    m = await R.getManifest(folder);
  }
  const ok = chain.every((n) => !n.parent || (n.parentResolved && n.edgeOk && n.integrity && n.integrity.ok));
  return { ok, chain, hops: chain.filter((n) => n.parent).length, genesis: chain.length ? chain[chain.length - 1].id : null };
}

// ── browser wiring + live badge ──────────────────────────────────────────────────────────────────
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sha256hex = async (u8) => {
    if (window.HoloObject && window.HoloObject.sha256hex) return window.HoloObject.sha256hex(u8);
    const d = await crypto.subtle.digest("SHA-256", u8);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const j = async (url) => { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error("fetch " + url); return r.json(); };
  const getBytes = async (path) => new Uint8Array(await (await fetch("/" + String(path).replace(/^\//, ""), { cache: "no-cache" })).arrayBuffer());
  let indexP = null;
  const folderForKappa = async (k) => {
    indexP = indexP || j("/apps/index.jsonld").catch(() => null);
    const idx = await indexP; if (!idx) return null;
    const d = (idx["dcat:dataset"] || []).find((e) => e["@id"] === k);
    const lp = d && d["dcat:landingPage"];
    return lp ? lp.replace(/\/[^/]*$/, "") : null;                  // "apps/notepad/index.html" → "apps/notepad"
  };
  const R = { sha256hex, folderForKappa, getBytes, getLock: (f) => j("/" + f + "/holospace.lock.json"), getManifest: (f) => j("/" + f + "/holospace.json") };

  const lineage = async () => { const self = await j("./holospace.json").catch(() => null); return self ? walkLineage(self, R) : null; };
  const versionCount = async () => { const c = await j("./holospace.prov.json").catch(() => null); return c && c["@graph"] ? c["@graph"].length : 0; };

  function render(res, versions) {
    if (document.getElementById("holo-prov-badge")) return;
    const hops = res ? res.hops : 0;
    if (!hops && !versions) return;                                                // truly no provenance → no badge
    const ok = res ? res.ok : true, accent = ok ? "#3ad29f" : "#ff6b6b";
    const el = document.createElement("div");
    el.id = "holo-prov-badge";
    el.setAttribute("role", "status");
    el.tabIndex = 0;
    el.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483000;display:flex;flex-direction:column;gap:6px;" +
      "font:var(--holo-text-sm,1rem)/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif;color:var(--holo-fg,#e8e8ea);" +
      "background:var(--holo-surface,rgba(18,18,26,.88));-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);" +
      "border:1px solid var(--holo-border,rgba(255,255,255,.12));border-radius:var(--holo-radius-2,10px);" +
      "padding:7px 11px;max-width:min(92vw,380px);box-shadow:0 6px 22px rgba(0,0,0,.32);cursor:pointer;user-select:none";
    const glyph = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>';
    const vtag = versions ? ` · v${versions}` : "";
    const label = !ok ? "Lineage check failed"
      : hops ? `Lineage verified · ${hops} hop${hops > 1 ? "s" : ""}${vtag}`
      : `Provenance${vtag || " · genesis"}`;
    const chain = (res ? res.chain : []).map((n, i) => {
      const mark = !n.parent ? '<span style="opacity:.6">● genesis</span>'
        : (n.parentResolved && n.edgeOk && n.integrity && n.integrity.ok) ? `<span style="color:#3ad29f">✓</span>`
        : `<span style="color:#ff6b6b">✗</span>`;
      return `${i ? '<span style="opacity:.45"> ← </span>' : ""}<b>${esc(n.name)}</b> ${mark}`;
    }).join("");
    el.innerHTML =
      `<div style="display:flex;align-items:center;gap:7px"><span style="color:${accent};display:inline-flex">${glyph}</span>` +
      `<span>${label}</span><span style="opacity:.4;margin-left:auto" aria-hidden="true">▾</span></div>` +
      `<div data-detail style="display:none;font-size:var(--holo-text-sm,1rem);opacity:.9;word-break:break-word">${chain}` +
      `<div style="opacity:.5;margin-top:4px">Holo Prov (ADR-0082) — re-derived in your tab (Law L5)</div></div>`;
    const toggle = () => { const d = el.querySelector("[data-detail]"); d.style.display = d.style.display === "none" ? "block" : "none"; };
    el.addEventListener("click", toggle);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    document.body.appendChild(el);
  }

  async function mount() {
    if (document.querySelector('meta[name="holo-prov"][content="off"]')) return;
    try {
      const [res, versions] = await Promise.all([lineage().catch(() => null), versionCount().catch(() => 0)]);
      render(res, versions);
    } catch { /* badge is best-effort; never block the app */ }
  }

  window.HoloProv = {
    lineage, walkLineage: (m) => walkLineage(m, R),
    reDeriveClosure: (lock) => reDeriveClosure(lock, getBytes, sha256hex), badge: mount,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
}
