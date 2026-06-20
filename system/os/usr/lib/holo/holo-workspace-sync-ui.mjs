// holo-workspace-sync-ui.mjs — Share Holospace (ADR-0105), the in-shell affordance: ONE icon beside the
// omnibar that shares THE CURRENT holospace — isolated, app-carrying, serverless. Mirrors holo-egress-
// connect's shape (a small button + a popover card, idempotent). The heavy sealer (os/sbin/holo-workspace-
// sync.mjs) and Holo Session are dynamic-imported on first use, so boot stays lean.
//
// ISOLATION: the share captures ONLY this holospace — its world (every open window, with each AUTHORED
// app's own bytes + saved state) and ONLY this holospace's widget board. No other holospace's data, no
// operator/device/global settings. Selective sharing, anchored to one holospace instance.
//
// APPS RUN ON IMPORT: an authored app (a Create/pasted/imported surface — its bytes are in the node) runs
// fully anywhere with no origin; a built-in app resolves on any Hologram by its κ; a live web surface
// reloads from its origin (or its commons snapshot). The UI accounts for each honestly — never overclaims.
//
// THREE destinations, all sovereign over the SAME sealed κ-DAG + self-verifying root CID:
//   • Local device   — the bundle file downloads to disk. (transport: file)
//   • Sovereign cloud — blocks published to your κ-store commons; the gateway resolves the CID, no file. (pin)
//   • Share as a link — the whole holospace in a URL #fragment that never reaches a server. (link)

const SEALER = "/sbin/holo-workspace-sync.mjs";
let _ws = null;
const sealer = async () => (_ws ||= await import(SEALER));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const human = (n) => { n = +n || 0; if (n < 1024) return n + " B"; if (n < 1048576) return (n / 1024).toFixed(1) + " KB"; return (n / 1048576).toFixed(1) + " MB"; };

// restoreAny(ws, rootCid, source) → { manifest } | null — a holospace bundle first (this feature), else a
// legacy session bundle (the earlier whole-workspace export). Both re-derive every block (L5).
async function restoreAny(ws, rootCid, source) {
  return (await ws.restoreHolospace(rootCid, source)) || (await ws.restoreWorkspace(rootCid, source));
}

// resolveBootResume() → a manifest body | null. Called by the shell at boot: if the page was opened from a
// Share link (#wks=…) or a cloud token (?wks=<cid>), resolve it (verified, L5) and strip it from the URL.
export async function resolveBootResume() {
  try {
    const hash = location.hash || "", query = location.search || "";
    const carM = (hash + "&" + query).match(/car=([A-Za-z0-9]+)/);   // a worldwide pinned link (#car=<cid> / ?car=<cid>)
    if (!/wks=/.test(hash) && !/wks=/.test(query) && !carM) return null;
    const ws = await sealer();
    if (carM) {   // pull the pinned CAR back from a public gateway, then re-derive every block (L5)
      const got = await ws.openCarByCid(carM[1]);
      if (got && got.roots[0]) {
        const r = await restoreAny(ws, got.roots[0], ws.verifiedBlockSource(got.blocks));
        history.replaceState(null, "", location.pathname);
        return r ? r.manifest : null;
      }
    }
    if (/wks=/.test(hash)) {
      const got = ws.decodeResumeLink(hash);
      if (got && got.roots[0]) {
        const r = await restoreAny(ws, got.roots[0], ws.verifiedBlockSource(got.blocks));
        history.replaceState(null, "", location.pathname + location.search);
        return r ? r.manifest : null;
      }
    }
    const qm = query.match(/wks=([^&]+)/);
    if (qm) {
      const r = await restoreAny(ws, decodeURIComponent(qm[1]), ws.cloudBlockSource());
      history.replaceState(null, "", location.pathname);
      return r ? r.manifest : null;
    }
  } catch (e) { console.warn("share-holospace boot resume:", e); }
  return null;
}

// analyzeWorkspace(manifest) → an honest count for a WHOLE-experience backup (holo:SessionManifest):
// how many holospaces, how many apps across them, and how many settings travel.
function analyzeWorkspace(manifest) {
  const exp = (manifest && manifest["holo:experience"]) || {};
  const tabs = Array.isArray(exp.tabs) ? exp.tabs : [];
  let surfaces = 0, withState = 0;
  for (const t of tabs) for (const n of ((t.snap && t.snap.world) || [])) { if (n && n.kind === "app") { surfaces++; if (n.appState != null) withState++; } }
  return { workspace: true, holospaces: tabs.length, surfaces, withState, settings: Object.keys(exp.settings || {}).length };
}

// mountWorkspaceSync(anchor, { getHolospace, getWorkspace, onImport }) — insert the icon after `anchor`. Idempotent.
//   getHolospace() → { title, addr, snap, board }   for THE CURRENT holospace ONLY (the isolated share).
//   getWorkspace() → a holo:SessionManifest          for the WHOLE experience (all holospaces + settings).
//   onImport(manifest) → applies a SessionManifest (resume) or a HolospaceShare (new tab); truthy on success.
// `trigger` (optional) — an EXISTING element (e.g. the ❤️ Share button) that opens the card. In that
// ENCLOSED mode we render no button of our own; the card drops from the top-right under the host control.
export function mountWorkspaceSync(anchor, { getHolospace, getWorkspace, onImport, trigger, requireEverythingAuth } = {}) {
  if ((!anchor && !trigger) || document.getElementById("wks-sync")) return null;
  injectStyles();
  const wrap = document.createElement("div"); wrap.id = "wks-sync"; wrap.className = "wks" + (trigger ? " wks-enclosed" : "");
  wrap.innerHTML = (trigger ? "" : `
    <button class="wks-btn" title="Share this holospace (sovereign, serverless)" aria-label="Share this holospace">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>
    </button>`) + `<div class="wks-card" hidden></div>`;
  if (trigger) document.body.appendChild(wrap); else anchor.insertAdjacentElement("afterend", wrap);
  const btn = trigger || wrap.querySelector(".wks-btn"), card = wrap.querySelector(".wks-card");
  const file = document.createElement("input"); file.type = "file"; file.accept = ".car,application/vnd.ipld.car"; file.style.display = "none"; wrap.appendChild(file);

  let _sealed = null, _scope = "holospace";   // "holospace" = this tab (isolated) · "workspace" = the whole experience
  async function seal() {
    const ws = await sealer();
    if (_scope === "workspace") {
      const manifest = getWorkspace ? await getWorkspace() : null;
      if (!manifest) throw new Error("nothing to back up");
      _sealed = await ws.sealWorkspace({ manifest, transport: null, now: () => new Date().toISOString() });
      _sealed.analysis = analyzeWorkspace(manifest);
      _sealed._title = "workspace";
    } else {
      const hs = (getHolospace && getHolospace()) || { title: "Holospace", addr: "", snap: { world: [] }, board: [] };
      const manifest = ws.buildHolospaceManifest(hs);
      _sealed = await ws.sealHolospace({ manifest, transport: null, now: () => new Date().toISOString() });
      _sealed._title = hs.title || "Holospace";
    }
    return _sealed;
  }
  // honest, human account of what travels
  const appLine = (a) => {
    if (a && a.workspace) return `${a.holospaces} holospace${a.holospaces === 1 ? "" : "s"} · ${a.surfaces} app${a.surfaces === 1 ? "" : "s"} · all your settings`;
    const parts = [];
    if (a.selfContained) parts.push(`${a.selfContained} app${a.selfContained === 1 ? "" : "s"} fully inside (run anywhere)`);
    if (a.linkedApp) parts.push(`${a.linkedApp} built-in (runs on any Hologram)`);
    if (a.web) parts.push(`${a.web} web tab${a.web === 1 ? "" : "s"} (reloads from source)`);
    if (a.widgets) parts.push(`${a.widgets} widget${a.widgets === 1 ? "" : "s"}`);
    return parts.length ? parts.join(" · ") : "an empty holospace";
  };

  const home = () => {
    const ws = _scope === "workspace";
    card.innerHTML = `
      <div class="wks-h"><span class="wks-glyph">⬡</span> Back up or share</div>
      <div class="wks-seg" role="tablist">
        <button class="wks-seg-b${ws ? "" : " on"}" data-scope="holospace" role="tab">This holospace</button>
        <button class="wks-seg-b${ws ? " on" : ""}" data-scope="workspace" role="tab">Everything</button>
      </div>
      <div class="wks-sub">${ws
        ? `Back up <b>your entire experience</b> — every holospace, your layout + settings, and the apps you built — into one content-addressed bundle you can resume on another device.`
        : `Bundle <b>just this holospace</b> — its windows, the apps you built in it, and its board. Nothing from your other holospaces or your settings travels.`}</div>
      <button class="wks-opt" data-act="local"><span class="wks-oi">🖥️</span><span class="wks-ot"><b>Local device</b><i>Download a bundle file you keep.</i></span></button>
      <button class="wks-opt" data-act="cloud"><span class="wks-oi">☁️</span><span class="wks-ot"><b>Sovereign cloud (IPFS)</b><i>Saved to your commons — open by token, no file.</i></span></button>
      <button class="wks-opt" data-act="link"><span class="wks-oi">🔗</span><span class="wks-ot"><b>Share as a link</b><i>The whole ${ws ? "experience" : "holospace"} in one link. Open it anywhere.</i></span></button>
      ${ws ? `<div class="wks-note">🔓 A backup is <b>portable, so it travels unencrypted by design</b> — anyone with the file, token, or link can open it. Your on-device copy stays encrypted under your sign-in; keep a workspace backup private, and re-sign-in on the new device to re-secure it there.</div>` : ``}
      <div class="wks-div"></div>
      <button class="wks-cta sec" data-act="open">↓ Open a backup or shared holospace</button>`;
  };

  async function doLocal() {
    busy("Sealing this holospace…");
    try {
      const ws = await sealer(); const s = await seal();
      const car = ws.exportCar(s.rootCid, s.blocks);
      const short = String(s.did || s.rootCid).split(":").pop().slice(0, 10);
      const blob = new Blob([car], { type: "application/vnd.ipld.car" });
      const url = URL.createObjectURL(blob);
      const fname = (_scope === "workspace" ? `holo-workspace-${short}` : `holospace-${slug(s._title)}-${short}`) + ".car";
      const a = document.createElement("a"); a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      done(_scope === "workspace" ? "Your whole experience bundled to your device" : "Holospace bundled to your device", s, `<span class="wks-mono">${esc(fname)}</span>`, "Carry the file anywhere and choose Open.");
    } catch (e) { fail(e); }
  }
  async function doCloud() {
    busy("Publishing to your sovereign commons…");
    try {
      const ws = await sealer(); const s = await seal();
      let n = 0; try { n = await ws.publishToCloud(s.blocks); } catch (e) {}
      const ok = n > 0;
      done(ok ? "Holospace saved to your sovereign cloud" : "Sealed (commons unavailable here)", s,
        ok ? `${s.receipt["holo:blockCount"]} blocks in your κ-store commons` : `Couldn't reach the κ-store in this context — use Local device or Share as a link.`,
        ok ? "Open on this device by token, no file. Other devices reach it once a peer pins the token (or use Share as a link)." : "");
    } catch (e) { fail(e); }
  }
  async function doLink() {
    busy("Encoding this holospace into a link…");
    try {
      const ws = await sealer(); const s = await seal();
      const link = `${location.origin}${location.pathname}#wks=${ws.encodeResumeLink(s.rootCid, s.blocks)}`;
      const big = link.length > 32000;
      card.innerHTML = `
        <div class="wks-h"><span class="wks-st on">●</span> Shareable link ready</div>
        <div class="wks-sub">${esc(appLine(s.analysis))}. The link carries the holospace — sovereign (the part after # never reaches a server).</div>
        <div class="wks-token"><input class="wks-tok" readonly value="${esc(link)}" /><button class="wks-copy" data-act="copylink">Copy</button></div>
        ${big ? `<div class="wks-note" style="color:#fbbf24">Large for a URL (${human(link.length)}) — may exceed some browsers' limits; prefer Sovereign cloud for heavy holospaces.</div>` : `<div class="wks-note">Open this link on any device — the holospace opens in a new tab, its apps running. Every byte re-derives to its address (Law L5).</div>`}
        <button class="wks-cta sec" data-act="home">← Back</button>`;
      const inp = card.querySelector(".wks-tok"); if (inp) inp.dataset.link = link;
    } catch (e) { fail(e); }
  }

  async function doImport(buf, pasted) {
    busy("Verifying shared holospace…");
    try {
      const ws = await sealer();
      let rootCid = null, source = null;
      if (buf) { const { roots, blocks } = ws.importCar(buf instanceof Uint8Array ? buf : new Uint8Array(buf)); rootCid = roots[0]; source = ws.verifiedBlockSource(blocks); }
      else if (pasted && ws.looksLikeToken(pasted)) { rootCid = pasted.trim(); source = ws.cloudBlockSource(); }
      else if (pasted) { const got = ws.decodeResumeLink(pasted); if (got && got.roots[0]) { rootCid = got.roots[0]; source = ws.verifiedBlockSource(got.blocks); } }
      if (!rootCid || !source) { openView("That isn't a holospace bundle, token, or link."); return; }
      const restored = await restoreAny(ws, rootCid, source);
      if (!restored) { card.innerHTML = `<div class="wks-h"><span class="wks-st err">●</span> Couldn't verify</div><div class="wks-sub">The bundle is incomplete, altered, or not reachable here — no byte that fails its content address is trusted (Law L5). A cloud token only resolves where its blocks are pinned.</div><button class="wks-cta sec" data-act="open">Try again</button> <button class="wks-cta sec" data-act="home">Home</button>`; return; }
      const isWs = Array.isArray(restored.manifest["@type"]) && restored.manifest["@type"].includes("holo:SessionManifest");
      const ok = onImport && onImport(restored.manifest);
      if (ok) { const a = isWs ? analyzeWorkspace(restored.manifest) : ws.analyzeHolospace(restored.manifest); card.innerHTML = `<div class="wks-h"><span class="wks-st on">●</span> ${isWs ? "Workspace resumed" : "Holospace opened"}</div><div class="wks-sub">${esc(appLine(a))} — ${isWs ? "your full experience, restored on this device." : "opened in a new tab."}</div><button class="wks-cta sec" data-act="done">Done</button>`; }
      else fail(new Error("This client can't open that here."));
    } catch (e) { fail(e); }
  }

  const openView = (msg) => {
    card.innerHTML = `
      <div class="wks-h"><span class="wks-glyph">⬡</span> Open a shared holospace</div>
      ${msg ? `<div class="wks-sub" style="color:#fbbf24">${esc(msg)}</div>` : `<div class="wks-sub">Open one from a file, a cloud token, or a shared link — it lands in a new tab.</div>`}
      <button class="wks-cta" data-act="pickfile">📄 Choose a bundle file</button>
      <label class="wks-lbl">…or paste a token / link</label>
      <div class="wks-token"><input class="wks-tok wks-paste" placeholder="did:holo:sha256:…  or  https://…#wks=…" /><button class="wks-copy" data-act="gopaste">Open</button></div>
      <button class="wks-cta sec" data-act="home">← Back</button>`;
  };

  const slug = (s) => String(s || "holospace").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "holospace";
  const busy = (m) => { card.innerHTML = `<div class="wks-h"><span class="wks-glyph spin">⬡</span> ${esc(m)}</div><div class="wks-sub">One content-addressed step…</div>`; };
  const fail = (e) => { card.innerHTML = `<div class="wks-h"><span class="wks-st err">●</span> Something went wrong</div><div class="wks-sub">${esc((e && e.message) || String(e))}</div><button class="wks-cta sec" data-act="home">← Back</button>`; };
  const done = (title, s, detail, note) => {
    card.innerHTML = `
      <div class="wks-h"><span class="wks-st on">●</span> ${esc(title)}</div>
      <div class="wks-sub">${esc(appLine(s.analysis))}${detail ? " · " + detail : ""}</div>
      <label class="wks-lbl">Resume token (self-verifying)</label>
      <div class="wks-token"><input class="wks-tok" readonly value="${esc(s.did || s.rootCid)}" /><button class="wks-copy" data-act="copy">Copy</button></div>
      ${note ? `<div class="wks-note">${note}</div>` : ""}
      <button class="wks-cta sec" data-act="home">Done</button>`;
  };

  file.addEventListener("change", async () => { const f = file.files && file.files[0]; if (!f) return; const buf = await f.arrayBuffer(); file.value = ""; doImport(buf); });
  card.addEventListener("click", async (e) => {
    const scopeBtn = e.target.closest("[data-scope]");
    if (scopeBtn) {
      const next = scopeBtn.getAttribute("data-scope");
      // "Everything" exports the whole OS (every holospace + settings) → re-verify it's you (signed-in
      // users only; the gate is a no-op for guests). Denied/cancelled → stay on the isolated holospace.
      if (next === "workspace" && _scope !== "workspace" && requireEverythingAuth) {
        busy("Confirm it's you…");
        let okAuth = false; try { okAuth = await requireEverythingAuth(); } catch (e2) {}
        if (!okAuth) { _scope = "holospace"; home(); return; }
      }
      _scope = next; home(); return;
    }   // switch scope, re-render
    const act = e.target.closest("[data-act]"); if (!act) return;
    const a = act.getAttribute("data-act");
    if (a === "local") doLocal();
    else if (a === "cloud") doCloud();
    else if (a === "link") doLink();
    else if (a === "open") openView();
    else if (a === "pickfile") file.click();
    else if (a === "gopaste") { const inp = card.querySelector(".wks-paste"); doImport(null, inp && inp.value); }
    else if (a === "copy") { const inp = card.querySelector(".wks-tok"); copy(inp && inp.value, act); }
    else if (a === "copylink") { const inp = card.querySelector(".wks-tok"); copy(inp && (inp.dataset.link || inp.value), act); }
    else if (a === "home") home();
    else if (a === "done") card.hidden = true;
  });
  function copy(text, act) { if (!text) return; try { navigator.clipboard.writeText(text); } catch {} const o = act.textContent; act.textContent = "Copied"; setTimeout(() => (act.textContent = o), 1200); }

  let _openedAt = 0;
  const openCard = (e) => { if (e && e.preventDefault) e.preventDefault(); const open = card.hidden; document.querySelectorAll(".wks-card, .egc-card").forEach((c) => (c.hidden = true)); if (open) { _scope = "holospace"; home(); card.hidden = false; _openedAt = Date.now(); } };   // always reopen on the isolated default → "Everything" needs a fresh authenticated toggle
  if (trigger) { try { trigger.onclick = openCard; } catch (e) {} }   // ENCLOSED: the host's Share button opens the card (the Playground facade forwards orig.click() here too)
  else btn.addEventListener("click", openCard);
  // close on an outside click — but ignore the very click that opened it (the facade dispatches a second
  // bubbling event on the hidden original), and ignore clicks on the trigger itself.
  document.addEventListener("click", (e) => { if (card.hidden) return; if (Date.now() - _openedAt < 60) return; if (wrap.contains(e.target)) return; if (trigger && (e.target === trigger || (trigger.contains && trigger.contains(e.target)))) return; card.hidden = true; });
  return wrap;
}

function injectStyles() {
  if (document.getElementById("wks-styles")) return;
  const s = document.createElement("style"); s.id = "wks-styles";
  s.textContent = `
  .wks{position:relative;display:flex;align-items:center;flex:0 0 auto}
  .wks-enclosed{position:fixed;top:0;right:0;width:0;height:0;z-index:130}
  .wks-enclosed .wks-card{position:fixed;top:46px;right:14px}
  .wks-btn{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:9px;background:transparent;color:var(--holo-ink,#e8eef9);opacity:.62;cursor:pointer;transition:.12s}
  .wks-btn:hover{opacity:1;background:color-mix(in srgb,var(--holo-ink,#e8eef9) 10%,transparent)}
  .wks-card{position:absolute;top:40px;right:0;width:336px;z-index:120;background:var(--holo-surface,#0c111b);color:var(--holo-ink,#e8eef9);border:1px solid color-mix(in srgb,var(--holo-ink,#e8eef9) 14%,transparent);border-radius:14px;padding:15px 16px 16px;box-shadow:0 18px 48px rgba(0,0,0,.5);font:13px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .wks-h{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:650;letter-spacing:-.01em}
  .wks-glyph{color:var(--holo-accent,#a78bfa)} .wks-glyph.spin{animation:wks-pulse 1.1s ease-in-out infinite}
  @keyframes wks-pulse{0%,100%{opacity:.45}50%{opacity:1}}
  .wks-st{font-size:9px;line-height:1} .wks-st.on{color:#34d399} .wks-st.err{color:#f87171}
  .wks-sub{color:color-mix(in srgb,var(--holo-ink,#e8eef9) 62%,transparent);margin:6px 0 12px}
  .wks-seg{display:flex;gap:4px;margin-top:11px;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--holo-ink,#e8eef9) 7%,transparent)}
  .wks-seg-b{flex:1;border:0;border-radius:8px;background:transparent;color:color-mix(in srgb,var(--holo-ink,#e8eef9) 60%,transparent);font:600 12px system-ui;padding:7px 6px;cursor:pointer;transition:.12s}
  .wks-seg-b.on{background:var(--holo-accent,#5b8cff);color:#fff}
  .wks-seg-b:not(.on):hover{color:var(--holo-ink,#e8eef9);background:color-mix(in srgb,var(--holo-ink,#e8eef9) 8%,transparent)}
  .wks-opt{display:flex;align-items:center;gap:11px;width:100%;text-align:left;padding:10px 12px;margin-top:8px;border:1px solid color-mix(in srgb,var(--holo-ink,#e8eef9) 12%,transparent);border-radius:11px;background:color-mix(in srgb,var(--holo-ink,#e8eef9) 4%,transparent);color:var(--holo-ink,#e8eef9);cursor:pointer;transition:.12s}
  .wks-opt:hover{background:color-mix(in srgb,var(--holo-accent,#5b8cff) 16%,transparent);border-color:color-mix(in srgb,var(--holo-accent,#5b8cff) 40%,transparent)}
  .wks-oi{font-size:18px;flex:0 0 auto;width:22px;text-align:center}
  .wks-ot{display:flex;flex-direction:column;min-width:0} .wks-ot b{font-weight:620} .wks-ot i{font-style:normal;font-size:11.5px;color:color-mix(in srgb,var(--holo-ink,#e8eef9) 52%,transparent)}
  .wks-div{height:1px;background:color-mix(in srgb,var(--holo-ink,#e8eef9) 10%,transparent);margin:13px 0 4px}
  .wks-cta{display:block;width:100%;text-align:center;padding:9px 12px;margin-top:8px;border:0;border-radius:10px;background:var(--holo-accent,#5b8cff);color:#fff;font:600 13px system-ui;cursor:pointer;transition:.12s}
  .wks-cta:hover{filter:brightness(1.08)}
  .wks-cta.sec{background:color-mix(in srgb,var(--holo-ink,#e8eef9) 10%,transparent);color:var(--holo-ink,#e8eef9)}
  .wks-lbl{display:block;margin:12px 0 5px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:color-mix(in srgb,var(--holo-ink,#e8eef9) 50%,transparent)}
  .wks-token{display:flex;gap:6px}
  .wks-tok{flex:1;min-width:0;background:rgba(0,0,0,.28);border:1px solid color-mix(in srgb,var(--holo-ink,#e8eef9) 14%,transparent);border-radius:8px;color:var(--holo-ink,#e8eef9);padding:7px 9px;font:11px ui-monospace,Menlo,Consolas,monospace}
  .wks-copy{flex:0 0 auto;border:0;border-radius:8px;background:color-mix(in srgb,var(--holo-ink,#e8eef9) 12%,transparent);color:var(--holo-ink,#e8eef9);padding:0 12px;font:600 12px system-ui;cursor:pointer}
  .wks-mono{font:11px ui-monospace,Menlo,Consolas,monospace;color:color-mix(in srgb,var(--holo-ink,#e8eef9) 80%,transparent)}
  .wks-note{margin-top:11px;font-size:11px;color:color-mix(in srgb,var(--holo-ink,#e8eef9) 46%,transparent)}`;
  document.head.appendChild(s);
}

export default { mountWorkspaceSync, resolveBootResume };
