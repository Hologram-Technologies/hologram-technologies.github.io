// holo-manage.js — ONE drop-in self-management affordance for every holospace.
//
// Drop-in, zero config:   <script src="_shared/holo-manage.js" defer></script>
//
// It gives every holospace a small, self-descriptive icon at the TOP-RIGHT of its frame
// that opens a compact **self-management dashboard** — so each holospace is, in the user's
// words, **self-verifying and self-managing**: it is "a container", and this is its panel.
//
// The dashboard is Holo Container, scoped to THIS holospace:
//   • IDENTITY — name + the OCI-style image ref `holospace/<name>:latest` + status.
//   • SELF-VERIFICATION (Law L5) — re-derive this page's own bytes and compare to its
//     PINNED κ in boot/boot-manifest.json (the content-addressed analog of Secure Boot):
//     ✓ κ verified / ✗ κ MISMATCH. Falls back to a self-attested holo://κ if unpinned.
//   • MANAGEMENT — Reload (restart), Copy κ, Share (teleport link), and "Manage all
//     containers" → the full Holo Container panel (container.html). A machine holospace
//     can expose richer actions (checkpoint/stop/stats) via window.HoloManageHost.
//
// Self-contained: vanilla JS + CSS, no deps, no CDN — uses fetch + crypto.subtle (the same
// σ-axis sha256 κ the substrate uses). Works standalone; uses window.HoloPodman.FLEET for
// nicer names when present. Isomorphic enough for a Node selftest. Exposes window.HoloManage.

(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  if (W.HoloManage) return;
  const isBrowser = typeof document !== "undefined" && typeof location !== "undefined";

  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  async function sha256Hex(u8) { const d = await (W.crypto || crypto).subtle.digest("SHA-256", u8 instanceof Uint8Array ? u8 : new Uint8Array(u8)); return hex(d); }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const shortK = (k) => { const [a, h] = String(k).split(":"); return h ? a + ":" + h.slice(0, 12) + "…" : String(k).slice(0, 14) + "…"; };

  // ── identity ────────────────────────────────────────────────────────────────────
  const loaderOf = () => (location.pathname.split("/").pop() || "index.html");
  function appName() {
    const meta = document.querySelector('meta[name="holo-app"]');
    if (meta && meta.content) return meta.content;
    const fleet = (W.HoloPodman && W.HoloPodman.FLEET) || [];
    const f = fleet.find((x) => x.loader === loaderOf());
    if (f) return f.title;
    return (document.title || "holospace").replace(/\s+[—·|–-]\s+(holospaces?|hologram os)\s*$/i, "").replace(/\s+·\s+on hologram$/i, "").trim() || "holospace";
  }
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  function imageRef() {
    const fleet = (W.HoloPodman && W.HoloPodman.FLEET) || [];
    const f = fleet.find((x) => x.loader === loaderOf());
    return "holospace/" + (f ? f.name : slug(loaderOf().replace(/\.html$/, "")) || "holospace") + ":latest";
  }

  // ── Law-L5 self-verification: re-derive my bytes, compare to the boot-manifest pin ─
  async function verify() {
    const out = { kappa: "", state: "unknown", detail: "" };
    try {
      const bytes = new Uint8Array(await (await fetch(location.pathname, { cache: "no-store" })).arrayBuffer());
      out.kappa = "sha256:" + (await sha256Hex(bytes));
      // pinned κ: prefer the boot manifest (Secure-Boot pin), then a meta tag
      let pin = "";
      try { const mf = await (await fetch("boot/boot-manifest.json", { cache: "no-store" })).json(); pin = (mf.loaders && mf.loaders[loaderOf()]) || ""; } catch {}
      if (!pin) { const m = document.querySelector('meta[name="holo-kappa"]'); pin = (m && m.content) || ""; }
      if (pin) { out.state = pin === out.kappa ? "verified" : "mismatch"; out.detail = pin === out.kappa ? "matches the boot-manifest pin (Law L5)" : "differs from the boot-manifest pin"; out.pin = pin; }
      else { out.state = "attested"; out.detail = "self-attested — this page re-derives to its content hash (Law L5)"; }
    } catch (e) { out.state = "error"; out.detail = String(e && e.message || e); }
    return out;
  }

  // ── UI ────────────────────────────────────────────────────────────────────────────
  const CSS = `
  /* DOCKED: lives inside the app's own top bar (currentColor so it inherits the bar). */
  #holo-manage-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex:0 0 auto;
    border-radius:8px;border:1px solid transparent;background:transparent;color:currentColor;cursor:pointer;opacity:.78;padding:0;
    transition:opacity .15s,border-color .15s,color .15s}
  #holo-manage-btn:hover{opacity:1;border-color:#892ca0}
  #holo-manage-btn svg{width:18px;height:18px;display:block}
  /* FLOATING fallback when a page has no detectable top bar: position:fixed;top:8px;right:8px. */
  #holo-manage-btn.float{position:fixed;top:8px;right:8px;z-index:2147482000;width:34px;height:34px;background:#0d1117cc;
    border-color:#2a3340;color:#9fb0bd;backdrop-filter:blur(6px);box-shadow:0 4px 14px rgba(0,0,0,.4)}
  #holo-manage-backdrop{position:fixed;inset:0;z-index:2147482001;background:transparent;display:none}
  #holo-manage-backdrop.on{display:block}
  #holo-manage-panel{position:fixed;top:48px;right:8px;z-index:2147482002;width:min(340px,92vw);display:none;
    background:#0d1117;color:#e6edf3;border:1px solid #28323d;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.55);
    font:var(--holo-text-sm, 1rem)/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}
  #holo-manage-panel.on{display:block}
  #holo-manage-panel .hd{display:flex;align-items:center;gap:9px;padding:11px 13px;border-bottom:1px solid #1b2128;background:#11161d}
  #holo-manage-panel .hd .ic{color:#b07cc6;flex:0 0 auto}
  #holo-manage-panel .hd .nm{font-weight:700;letter-spacing:.01em}
  #holo-manage-panel .hd .sub{color:#8b949e;font:var(--holo-text-sm, 1rem) ui-monospace,monospace}
  #holo-manage-panel .bd{padding:12px 13px;display:flex;flex-direction:column;gap:11px}
  #holo-manage-panel .krow{display:flex;align-items:center;gap:8px;font:var(--holo-text-sm, 1rem) ui-monospace,monospace}
  #holo-manage-panel .chip{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;border:1px solid #28323d;color:#9fb0bd;font:var(--holo-text-sm, 1rem) ui-monospace,monospace;white-space:nowrap}
  #holo-manage-panel .chip.ok{color:#7ee787;border-color:#1d4427;background:#0c1f14}
  #holo-manage-panel .chip.bad{color:#fca5a5;border-color:#5c2222;background:#1f0f0f}
  #holo-manage-panel .chip.info{color:#79c0ff;border-color:#1d3a5e}
  #holo-manage-panel .meta{color:#8b949e;font:var(--holo-text-sm, 1rem) ui-monospace,monospace;display:flex;flex-direction:column;gap:3px}
  #holo-manage-panel .meta b{color:#c9d1d9;font-weight:600}
  #holo-manage-panel .acts{display:grid;grid-template-columns:1fr 1fr;gap:7px}
  #holo-manage-panel .acts.full{grid-template-columns:1fr}
  #holo-manage-panel button.act{font:var(--holo-text-sm, 1rem) ui-sans-serif;min-height:38px;padding:0 11px;border-radius:8px;border:1px solid #28323d;
    background:#161b22;color:#c9d1d9;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}
  #holo-manage-panel button.act:hover{border-color:#3a4452;color:#fff}
  #holo-manage-panel button.act.cta{color:#f0d2ff;border-color:#5a2c66;background:#2a1530}
  #holo-manage-panel .ft{padding:9px 13px;border-top:1px solid #1b2128;color:#6e7681;font:var(--holo-text-sm, 1rem) ui-monospace,monospace;display:flex;justify-content:space-between;gap:8px}
  #holo-manage-toast{position:fixed;top:88px;right:8px;z-index:2147482003;background:#11181c;color:#e6edf3;border:1px solid #243038;
    border-radius:9px;padding:8px 12px;font:var(--holo-text-sm, 1rem) system-ui;box-shadow:0 10px 30px rgba(0,0,0,.5);opacity:0;transition:opacity .16s;pointer-events:none;max-width:92vw}
  #holo-manage-toast.in{opacity:1}
  @media (max-width:520px){#holo-manage-panel{left:8px;right:8px;width:auto;top:50px}}
  @media print{#holo-manage-btn,#holo-manage-panel,#holo-manage-backdrop{display:none!important}}`;

  // a self-descriptive glyph: a container/box with a verification check
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7.5" width="18" height="11" rx="1.5"/><path d="M7 7.5v11M11 7.5v11M15 7.5v11M3 7.5l2-2.5h14l2 2.5"/><path d="M15.5 13.2l1.6 1.6 3-3.2" stroke="#7ee787"/></svg>';

  let panelEl, btnEl, backdropEl, toastT, mountEl = null;
  function toast(m) { let t = document.getElementById("holo-manage-toast"); if (!t) { t = document.createElement("div"); t.id = "holo-manage-toast"; document.body.appendChild(t); } t.textContent = m; t.classList.add("in"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("in"), 2400); }

  // ── find the app's existing TOP BAR to dock into ───────────────────────────────────
  // Priority: an explicit slot the page provides → a meta/window selector → auto-detect a
  // top bar (the holospaces convention is <div id="bar"> / <header>) → null (float).
  function resolveMount() {
    const explicit = document.querySelector("[data-holo-manage-slot]"); if (explicit) return explicit;
    const meta = document.querySelector('meta[name="holo-manage-mount"]'); if (meta && meta.content) { const el = document.querySelector(meta.content); if (el) return el; }
    if (typeof W.HoloManageMount === "string") { const el = document.querySelector(W.HoloManageMount); if (el) return el; }
    else if (W.HoloManageMount && W.HoloManageMount.appendChild) return W.HoloManageMount;
    for (const sel of ["#bar", "header", '[role="banner"]', "#topbar", "#toolbar", ".titlebar", ".topbar", "#chrome", "#appbar"]) {
      const el = document.querySelector(sel); if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= Math.min(320, innerWidth * 0.5) && r.top <= 14 && r.height >= 16 && r.height <= 140) return el;
    }
    return null;
  }

  function inject() {
    if (document.getElementById("holo-manage-btn")) return;
    const style = document.createElement("style"); style.id = "holo-manage-css"; style.textContent = CSS; document.head.appendChild(style);
    btnEl = document.createElement("button"); btnEl.id = "holo-manage-btn"; btnEl.type = "button";
    btnEl.setAttribute("aria-label", "Manage this holospace (κ-verified)"); btnEl.title = "Manage this holospace — self-verify & self-manage";
    btnEl.setAttribute("aria-haspopup", "dialog"); btnEl.setAttribute("aria-expanded", "false"); btnEl.innerHTML = ICON;
    backdropEl = document.createElement("div"); backdropEl.id = "holo-manage-backdrop";
    panelEl = document.createElement("div"); panelEl.id = "holo-manage-panel"; panelEl.setAttribute("role", "dialog"); panelEl.setAttribute("aria-label", "Holospace self-management");
    document.body.append(backdropEl, panelEl);

    mountEl = resolveMount();
    if (mountEl) {
      mountEl.appendChild(btnEl);
      // right-align: if the bar's trailing content already sits at the right edge (a spacer),
      // append after it; otherwise push our icon to the far right with an auto margin.
      try { const br = mountEl.getBoundingClientRect(); const prev = btnEl.previousElementSibling; const pr = prev && prev.getBoundingClientRect(); if (!prev || (br.right - (pr ? pr.right : br.left)) > 56) btnEl.style.marginLeft = "auto"; } catch {}
      // if the app rebuilds its bar, re-dock the button (keep the affordance present).
      try { const mo = new MutationObserver(() => { if (mountEl && !mountEl.contains(btnEl)) { mountEl.appendChild(btnEl); } }); mo.observe(mountEl, { childList: true }); } catch {}
    } else { btnEl.classList.add("float"); document.body.appendChild(btnEl); }

    btnEl.addEventListener("click", toggle);
    backdropEl.addEventListener("click", close);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && panelEl.classList.contains("on")) close(); });
    addEventListener("resize", () => { if (panelEl.classList.contains("on")) place(); });

    // Sibling affordance: every holospace frame also gets the Holo Capture quick-launch — a
    // small camera icon (docked just left of this one) that opens the full tool. Loaded from
    // THIS module's own _shared/ base so it resolves from root pages AND apps/<id>/ pages; the
    // launcher self-skips on capture.html (no self-launch). One drop-in, two affordances.
    try {
      const meSrc = document.querySelector('script[src*="holo-manage.js"]');
      const sib = (name) => meSrc ? meSrc.src.replace(/holo-manage\.js(\?.*)?$/, name) : "_shared/" + name;
      const loadSib = (name, id) => { if (document.getElementById(id)) return; const s = document.createElement("script"); s.id = id; s.src = sib(name); s.defer = true; document.head.appendChild(s); };
      // Holo Capture quick-launch (a camera icon) — on every frame except Capture itself.
      if (!/capture\.html$/i.test(loaderOf())) loadSib("holo-capture-launch.js", "holo-capture-launch-js");
      // Holo Stream quick-launch (a broadcast icon, docked to the RIGHT of the camera icon) —
      // on every frame except Stream itself. Loaded AFTER capture so it docks capture→stream→manage.
      if (!/stream\.html$/i.test(loaderOf())) loadSib("holo-stream-launch.js", "holo-stream-launch-js");
      // Holo Theme dashboard quick-launch (a palette icon, docked next to the Stream icon) —
      // the single place to control the whole OS look. Loaded AFTER stream → capture→stream→theme→manage.
      if (!/theme\.html$/i.test(loaderOf())) loadSib("holo-theme-launch.js", "holo-theme-launch-js");
      // Holo Record — the ONE always-on recorder of your entire activity (the capture layer behind
      // your Holo Notepad sovereign daily graph): it senses what you do AND owns the screen/camera
      // recorder, both feeding the same content-addressed graph. Loaded on EVERY frame so your day is
      // recorded even when Notepad is closed; it self-skips probing on shells/Notepad. Loaded BEFORE
      // the Notepad launcher so HoloRecord is present when the launcher boots.
      loadSib("holo-record.js", "holo-record-js");
      // Holo Notepad quick-launch (a brain icon) — your ubiquitous second brain on EVERY frame:
      // one key (Ctrl/Cmd-Shift-K) to capture or recall. The launcher is pure UI; Holo Record does
      // the capturing. Skips on notepad.html itself.
      if (!/notepad\.html$/i.test(loaderOf())) loadSib("holo-notepad-launch.js", "holo-notepad-launch-js");
    } catch {}
  }
  // anchor the panel directly under the icon (works whether docked or floating)
  function place() {
    const r = btnEl.getBoundingClientRect();
    const mobile = innerWidth <= 520;
    panelEl.style.top = Math.round(r.bottom + 6) + "px";
    if (mobile) { panelEl.style.left = "8px"; panelEl.style.right = "8px"; panelEl.style.width = "auto"; }
    else { panelEl.style.left = "auto"; panelEl.style.right = Math.max(8, Math.round(innerWidth - r.right)) + "px"; panelEl.style.width = "min(340px,92vw)"; }
  }
  const open = () => { renderPanel(); place(); panelEl.classList.add("on"); backdropEl.classList.add("on"); btnEl.setAttribute("aria-expanded", "true"); refresh(); };
  const close = () => { panelEl.classList.remove("on"); backdropEl.classList.remove("on"); btnEl.setAttribute("aria-expanded", "false"); };
  const toggle = () => (panelEl.classList.contains("on") ? close() : open());

  const startedAt = Date.now();
  const uptime = () => { const s = Math.floor((Date.now() - startedAt) / 1000); return s < 60 ? s + "s" : Math.floor(s / 60) + "m " + (s % 60) + "s"; };
  const heap = () => { const m = performance && performance.memory; return m ? (m.usedJSHeapSize / 1e6).toFixed(0) + " MB JS heap" : ""; };

  function renderPanel() {
    const name = appName(), img = imageRef(); const host = W.HoloManageHost || null;
    panelEl.innerHTML =
      `<div class="hd"><span class="ic">${ICON}</span><div><div class="nm">${esc(name)}</div><div class="sub">self-managing container</div></div></div>
      <div class="bd">
        <div class="krow"><span class="chip info" id="hm-kchip">κ checking…</span><button class="act" id="hm-reverify" style="min-height:28px;padding:0 9px">re-verify</button></div>
        <div class="meta">
          <div>image · <b>${esc(img)}</b></div>
          <div>κ · <b id="hm-kaddr">holo://…</b></div>
          <div>status · <b style="color:#7ee787">running</b> · <span id="hm-stats">up ${uptime()}${heap() ? " · " + heap() : ""}</span></div>
        </div>
        <div class="acts">
          <button class="act" id="hm-reload">↻ Restart</button>
          <button class="act" id="hm-copy">⧉ Copy κ</button>
          <button class="act" id="hm-share">↗ Share</button>
          ${host && host.checkpoint ? '<button class="act" id="hm-checkpoint">◉ Checkpoint</button>' : '<button class="act" id="hm-snapshot">◉ Persist</button>'}
        </div>
        <div class="acts full"><button class="act cta" id="hm-all">▣ Manage all containers — Holo Container</button></div>
        ${host && host.stop ? '<div class="acts full"><button class="act" id="hm-stop">■ Stop container</button></div>' : ""}
      </div>
      <div class="ft"><span>Holo Container · Law L5</span><span>${esc(loaderOf())}</span></div>`;
    panelEl.querySelector("#hm-reload").onclick = () => location.reload();
    panelEl.querySelector("#hm-reverify").onclick = refresh;
    panelEl.querySelector("#hm-copy").onclick = async () => { try { await navigator.clipboard.writeText(lastKappa || ""); toast("κ copied"); } catch { toast(lastKappa || ""); } };
    panelEl.querySelector("#hm-share").onclick = () => { if (W.HoloTeleport && W.HoloTeleport.share) W.HoloTeleport.share({ title: appName() + " · on hologram" }); else { navigator.clipboard && navigator.clipboard.writeText(location.href); toast("link copied"); } };
    panelEl.querySelector("#hm-all").onclick = openManager;
    const snap = panelEl.querySelector("#hm-snapshot"); if (snap) snap.onclick = () => toast("state persists in OPFS (the store is the memory · Law L3)");
    const cp = panelEl.querySelector("#hm-checkpoint"); if (cp) cp.onclick = async () => { try { await host.checkpoint(); toast("checkpointed (κ-snapshot)"); } catch (e) { toast("checkpoint: " + (e.message || e)); } };
    const st = panelEl.querySelector("#hm-stop"); if (st) st.onclick = () => { try { host.stop(); toast("stopping…"); } catch {} };
    // live-ish stats tick while open
    clearInterval(panelEl._tick); panelEl._tick = setInterval(() => { const el = panelEl.querySelector("#hm-stats"); if (el && panelEl.classList.contains("on")) el.textContent = "up " + uptime() + (heap() ? " · " + heap() : ""); else clearInterval(panelEl._tick); }, 1000);
  }

  // Open the full Holo Container panel for this holospace. Nested → ask the parent to
  // mount it (so it lands in the frame); top-level → a new tab (non-destructive).
  function openManager() {
    try {
      if (W.parent && W.parent !== W) { W.parent.postMessage({ type: "holo-open", loader: "container.html", from: loaderOf() }, "*"); toast("opening Holo Container…"); return; }
    } catch {}
    W.open("container.html", "_blank", "noopener");
  }

  let lastKappa = "";
  async function refresh() {
    const chip = panelEl.querySelector("#hm-kchip"), kaddr = panelEl.querySelector("#hm-kaddr"); if (!chip) return;
    chip.className = "chip info"; chip.textContent = "κ checking…";
    const v = await verify(); lastKappa = v.kappa;
    if (kaddr) { kaddr.textContent = "holo://" + shortK(v.kappa); kaddr.title = "holo://" + v.kappa; }
    const map = { verified: ["ok", "✓ κ verified"], attested: ["ok", "✓ κ self-attested"], mismatch: ["bad", "✗ κ MISMATCH"], error: ["bad", "κ error"], unknown: ["info", "κ —"] };
    const [cls, label] = map[v.state] || map.unknown; chip.className = "chip " + cls; chip.textContent = label; chip.title = v.detail || "";
    // reflect on the button too (self-verifying at a glance)
    if (btnEl) btnEl.style.borderColor = v.state === "mismatch" ? "#f85149" : v.state === "verified" || v.state === "attested" ? "#2a3340" : "#2a3340";
  }

  // a parent (e.g. the Holo Container fleet frame, or home) can honor child "holo-open"
  // requests; provided here so any holospace that mounts another gets it for free.
  function installParentBridge() {
    W.addEventListener("message", (e) => {
      const m = e.data || {}; if (m.type !== "holo-open" || !m.loader) return;
      // default behavior: navigate the first in-page holospace iframe, if any, else open a tab
      const frame = document.querySelector("iframe");
      if (frame) { try { frame.src = "./" + m.loader; return; } catch {} }
      W.open(m.loader, "_blank", "noopener");
    });
  }

  function boot() {
    if (!isBrowser) return;
    inject(); installParentBridge();
    // If we fell back to floating because the bar wasn't laid out yet (some apps build
    // their chrome after load), retry docking once the bar appears.
    if (btnEl && btnEl.classList.contains("float")) {
      let tries = 0;
      const iv = setInterval(() => {
        tries++; const m = resolveMount();
        if (m) { mountEl = m; btnEl.classList.remove("float"); btnEl.style.marginLeft = ""; m.appendChild(btnEl); try { const br = m.getBoundingClientRect(); const prev = btnEl.previousElementSibling; const pr = prev && prev.getBoundingClientRect(); if (!prev || (br.right - (pr ? pr.right : br.left)) > 56) btnEl.style.marginLeft = "auto"; } catch {} try { new MutationObserver(() => { if (mountEl && !mountEl.contains(btnEl)) mountEl.appendChild(btnEl); }).observe(m, { childList: true }); } catch {} clearInterval(iv); }
        else if (tries >= 8) clearInterval(iv);
      }, 250);
    }
  }
  if (isBrowser) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }

  // ── selftest (Node-friendly; verifies the pure helpers) ──────────────────────────
  async function selftest() {
    const r = {};
    r.icon = /svg/.test(ICON) && /rect/.test(ICON) && /#7ee787/.test(ICON); // a container glyph + a check
    r.shortK = shortK("sha256:" + "a".repeat(64)) === "sha256:aaaaaaaaaaaa…";
    try { const h = await sha256Hex(new TextEncoder().encode("abc")); r.sha256 = h === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"; } catch (e) { r.sha256 = false; }
    r.slug = slug("Holo Container!") === "holo-container";
    r.ok = Object.values(r).every((v) => v === true);
    return r;
  }

  W.HoloManage = { open: () => isBrowser && open(), close: () => isBrowser && close(), verify, imageRef, appName, selftest, version: "1.0.0" };
  if (typeof module !== "undefined" && module.exports) module.exports = W.HoloManage;
})();
