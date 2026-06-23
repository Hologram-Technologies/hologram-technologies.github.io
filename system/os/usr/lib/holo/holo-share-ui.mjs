// holo-share-ui.mjs — Share, rendered in the shared right side-carriage (holo-aside.mjs) so Create, Play,
// and Share open with one identical chrome. This module owns the Share CONTENT + flow; the carriage owns
// the dock, slide, header, and close.
//
// One clean, space-filling flow tuned to feel like the Holo Wallet: pick what travels (this holospace /
// everything); the link seals instantly as a hyper-real white sticker — the real Hologram mark centred in
// a LIVE, brand-tinted QR. Then keep it any way: copy, native share, save a file, or publish worldwide.
//
// THE QR, made honest. A self-contained `#wks=` link carries the whole holospace in the URL fragment — but
// a QR tops out near ~2.3 KB, so a holospace with apps overflows it. So: when the serverless link FITS, the
// QR carries it directly (scan anywhere, no server). When it doesn't, one tap publishes the sealed CAR to
// public IPFS (holo-workspace-sync.pinShareToCloud — the credential stays server-side) and the QR carries a
// short `#car=<cid>` link that re-derives the exact snapshot on any device worldwide (L5). Nothing here
// claims a reach it does not have. The sealer + holo-qr are dynamic-imported; the theme is the OS `--holo-*`
// tokens, so Share reads in the same voice as the rest of the shell.

import { createAside } from "/_shared/holo-aside.mjs";

const SEALER = "/sbin/holo-workspace-sync.mjs";
let _ws = null, _qr = null;
const sealer = async () => (_ws ||= await import(SEALER));
const qrlib = async () => (_qr ||= await import("/_shared/holo-qr.js"));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const SHELL_PATH = () => { try { return location.pathname || "/shell.html"; } catch { return "/shell.html"; } };

// the REAL Hologram mark (the dot constellation, os_hologram.svg), inlined for the QR centre — no fetch.
const HOLO_MARK = `<svg viewBox="-104 -104 208 208" fill="currentColor" aria-hidden="true"><g><circle cx="0.20" cy="-97.39" r="2.61"/><circle cx="-22.86" cy="-86.55" r="2.71"/><circle cx="22.54" cy="-86.32" r="2.81"/><circle cx="-0.03" cy="-76.01" r="2.71"/><circle cx="45.26" cy="-75.92" r="7.80"/><circle cx="-45.82" cy="-75.86" r="2.61"/><circle cx="68.34" cy="-65.13" r="7.70"/><circle cx="-68.83" cy="-65.00" r="2.61"/><circle cx="-22.91" cy="-64.90" r="2.61"/><circle cx="22.71" cy="-64.88" r="2.51"/><circle cx="91.24" cy="-54.34" r="2.61"/><circle cx="-45.94" cy="-54.25" r="7.83"/><circle cx="-91.17" cy="-54.19" r="2.71"/><circle cx="-0.03" cy="-54.19" r="2.71"/><circle cx="45.35" cy="-54.19" r="7.80"/><circle cx="-22.86" cy="-43.64" r="2.71"/><circle cx="22.71" cy="-43.49" r="2.51"/><circle cx="68.29" cy="-43.47" r="7.73"/><circle cx="-68.60" cy="-43.37" r="7.73"/><circle cx="-45.85" cy="-32.63" r="7.77"/><circle cx="45.36" cy="-32.60" r="7.80"/><circle cx="-91.26" cy="-32.55" r="2.71"/><circle cx="0.10" cy="-32.51" r="2.61"/><circle cx="91.24" cy="-32.51" r="2.61"/><circle cx="68.22" cy="-21.95" r="7.83"/><circle cx="22.67" cy="-21.84" r="7.87"/><circle cx="-22.86" cy="-21.82" r="2.71"/><circle cx="-68.57" cy="-21.80" r="7.80"/><circle cx="45.45" cy="-11.06" r="7.73"/><circle cx="-0.19" cy="-11.04" r="7.87"/><circle cx="91.35" cy="-11.01" r="2.81"/><circle cx="-91.54" cy="-10.97" r="2.51"/><circle cx="-45.87" cy="-10.87" r="7.73"/><circle cx="22.71" cy="-0.27" r="8.06"/><circle cx="-22.89" cy="-0.21" r="7.90"/><circle cx="68.28" cy="-0.15" r="7.87"/><circle cx="-68.62" cy="-0.11" r="8.00"/><circle cx="-0.06" cy="10.98" r="7.87"/><circle cx="45.54" cy="11.00" r="7.83"/><circle cx="-45.85" cy="11.02" r="7.77"/><circle cx="-91.26" cy="11.10" r="2.71"/><circle cx="91.24" cy="11.13" r="2.61"/><circle cx="22.71" cy="21.64" r="2.71"/><circle cx="-68.74" cy="21.66" r="7.87"/><circle cx="-22.86" cy="21.67" r="7.87"/><circle cx="68.28" cy="21.67" r="7.87"/><circle cx="-91.54" cy="32.46" r="2.61"/><circle cx="0.15" cy="32.46" r="2.71"/><circle cx="-45.72" cy="32.50" r="7.73"/><circle cx="45.54" cy="32.59" r="7.83"/><circle cx="91.35" cy="32.63" r="2.81"/><circle cx="-23.01" cy="43.23" r="2.61"/><circle cx="68.25" cy="43.31" r="7.83"/><circle cx="-68.71" cy="43.34" r="7.83"/><circle cx="22.71" cy="43.37" r="2.90"/><circle cx="91.39" cy="53.92" r="2.71"/><circle cx="45.48" cy="53.95" r="7.87"/><circle cx="-45.86" cy="53.97" r="7.80"/><circle cx="-91.34" cy="53.99" r="2.61"/><circle cx="0.20" cy="54.09" r="2.61"/><circle cx="-68.57" cy="64.90" r="7.80"/><circle cx="-22.86" cy="64.92" r="2.71"/><circle cx="68.28" cy="64.92" r="2.71"/><circle cx="22.54" cy="65.15" r="2.81"/><circle cx="-45.88" cy="75.56" r="7.80"/><circle cx="0.10" cy="75.62" r="2.61"/><circle cx="45.32" cy="75.62" r="2.61"/><circle cx="22.53" cy="86.47" r="2.71"/><circle cx="-22.86" cy="86.75" r="2.71"/><circle cx="-0.03" cy="97.29" r="2.71"/></g></svg>`;

function travelLine(scope, manifest, sealerMod) {
  if (scope === "app") return "This app opens RUNNING for anyone — fullscreen, no sign-in. One tap remixes it back into their own desktop.";
  if (scope === "workspace") {
    const exp = (manifest && manifest["holo:experience"]) || {}; const tabs = Array.isArray(exp.tabs) ? exp.tabs : [];
    let apps = 0; for (const t of tabs) for (const n of ((t.snap && t.snap.world) || [])) if (n && n.kind === "app") apps++;
    return `${tabs.length} holospace${tabs.length === 1 ? "" : "s"}, ${apps} app${apps === 1 ? "" : "s"}, and all your settings travel together.`;
  }
  const a = (sealerMod && sealerMod.analyzeHolospace && sealerMod.analyzeHolospace(manifest)) || {};
  const parts = [];
  if (a.selfContained) parts.push(`${a.selfContained} app${a.selfContained === 1 ? "" : "s"} that run anywhere`);
  if (a.linkedApp) parts.push(`${a.linkedApp} built in app${a.linkedApp === 1 ? "" : "s"}`);
  if (a.web) parts.push(`${a.web} web tab${a.web === 1 ? "" : "s"} that reload from the source`);
  if (a.widgets) parts.push(`${a.widgets} widget${a.widgets === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") + " travel inside the link." : "An empty holospace, ready to fill.";
}

// mountShare(trigger, { getHolospace, getWorkspace, onImport, requireEverythingAuth }) — the trigger (the
// ❤️ Share verb) toggles the carriage. Content renders into the shared aside's body.
export function mountShare(trigger, { getHolospace, getWorkspace, getApp, onImport, requireEverythingAuth, onLinkDevice } = {}) {
  injectStyles();
  const aside = createAside({ id: "share", title: "Share", logo: HOLO_MARK });   // golden scale + collapse chevron from the shared template
  const body = aside.body;
  const file = document.createElement("input"); file.type = "file"; file.accept = ".car,application/vnd.ipld.car"; file.style.display = "none"; aside.el.appendChild(file);
  const hasApp = typeof getApp === "function";          // the finest grain (share-to-run) is wired in
  let _scope = "holospace", _sealed = null, _view = "share", _gated = false, _publishing = false;

  // Open contextually: if an app is focused, default to sharing THAT app (the most common, most magical
  // act — hand someone a running app). Otherwise the holospace. Recomputed each open so the carriage
  // always reflects what's in front of you.
  async function openShare() { aside.open(); if (_scope !== "workspace") { let live = false; try { live = !!(hasApp && getApp()); } catch (e) {} _scope = live ? "app" : "holospace"; } await seal(); }
  function bindTrigger() { if (!trigger) return; trigger.setAttribute("aria-expanded", "false"); trigger.addEventListener("click", (e) => { e.preventDefault(); if (aside.isOpen()) aside.close(); else openShare(); trigger.setAttribute("aria-expanded", aside.isOpen() ? "true" : "false"); }); }

  async function seal() {
    // ── SHARE-TO-RUN (the finest grain): the focused app as a #k= link. No CAR to seal — the app's bytes
    //    are delivered + re-derived (Law L5) by the runtime, so the link is short (always fits a QR) and
    //    opens the app RUNNING, fullscreen, with the viral chrome. Falls back to holospace if nothing's
    //    focused, so the scope never strands the user on an empty share.
    if (_scope === "app") {
      let cap = null; try { cap = getApp && getApp(); } catch (e) {}
      if (cap && cap.link) {
        _view = "share"; _publishing = false; _gated = false;
        // CC-56: AUTO-ATTEST the share-to-run link so it self-verifies on arrival (embedded, non-prompting, fail-soft).
        let link = cap.link;
        if (cap.kappa && /^did:holo:sha256:/.test(String(cap.kappa))) {
          try { const A = await import("./holo-attest.mjs"); link = await A.attestShareLink(cap.link, String(cap.kappa)); } catch (e) {}
        }
        let travels = travelLine("app", cap, null);
        // Phase D: fold THIS app's LIVE workspace (its current state, verified) into the link when it fits a
        // QR — so the recipient opens it EXACTLY as you left it. Fail-soft: no live state ⇒ unchanged share-to-run.
        try {
          if (cap.appKappa && window.HoloWorkspaceBridge && window.HoloWorkspaceBridge.activeHost) {
            const WS = await import("./holo-workspace-share.mjs");
            const host = await window.HoloWorkspaceBridge.activeHost();
            const wb = host && await WS.shareLinkPayload(cap.appKappa, host);
            if (wb) { const enc = WS.encodeWorkspaceShare(wb); if (enc.qrFits) { link += (link.indexOf("#") >= 0 ? "&" : "#") + "ws=" + enc.token; travels = "Opens for them EXACTLY as you left it — your live window, verified. One tap remixes it into their desktop."; } }
          }
        } catch (e) {}
        _sealed = { app: true, link, world: null, name: cap.name || "App", kappa: cap.kappa || "", travels };
        render(); paintCurrentQR(); return;
      }
      _scope = "holospace";   // nothing shareable focused → degrade gracefully
    }
    if (_scope === "workspace" && requireEverythingAuth) { let ok = true; try { ok = await requireEverythingAuth(); } catch (e) { ok = false; } if (!ok) { _scope = "holospace"; _gated = true; } }
    _view = "share"; _publishing = false; renderBusy();
    try {
      const ws = await sealer(); let bundle, manifest;
      if (_scope === "workspace") { manifest = getWorkspace ? await getWorkspace() : null; if (!manifest) throw new Error("nothing to share yet"); bundle = await ws.sealWorkspace({ manifest, transport: "link", now: () => new Date().toISOString() }); }
      else { const hs = (getHolospace && getHolospace()) || { title: "Holospace", addr: "", snap: { world: [] }, board: [] }; manifest = ws.buildHolospaceManifest(hs); bundle = await ws.sealHolospace({ manifest, transport: "link", now: () => new Date().toISOString() }); }
      const link = `${location.origin}${SHELL_PATH()}#wks=${ws.encodeResumeLink(bundle.rootCid, bundle.blocks)}`;
      _sealed = { ws, bundle, manifest, link, world: null, travels: travelLine(_scope, manifest, ws) };
    } catch (e) { _sealed = { error: (e && e.message) || String(e) }; }
    render(); paintCurrentQR();
  }

  // the link the QR + native share + copy carry right now: a published worldwide link if we have one, else
  // the self-contained `#wks=` link.
  function currentLink() { return (_sealed && (_sealed.world || _sealed.link)) || ""; }

  async function paintCurrentQR() {
    if (!_sealed || _sealed.error) return;
    const target = _sealed.world || _sealed.link;
    const ok = await paintQR(target);
    if (!ok && !_sealed.world) markQrOverflow();   // self-contained link too big for a code → invite publish
  }

  // Custom QR: big soft rounded tiles (scan from a distance), tiles inside an H stencil tinted with the
  // brand gradient (spells H, stays dark-luminance so it still scans, ecc M backstops), centre left for the
  // real logo. Pure vector → razor-sharp at any size. Returns false if the payload won't fit a QR.
  async function paintQR(link) {
    try {
      const m = await qrlib(); const { size, modules } = m.toMatrix(link, { ecc: "M" });
      const N = size - 1, margin = 1, dim = size + margin * 2, gap = 0.085, s = 1 - gap * 2, rr = +(s * 0.3).toFixed(3), arm = +(s - 2 * rr).toFixed(3);
      const inH = (r, c) => { const nx = c / N, ny = r / N; return (((nx >= 0.17 && nx <= 0.31) || (nx >= 0.69 && nx <= 0.83)) || (ny >= 0.45 && ny <= 0.55 && nx >= 0.17 && nx <= 0.83)); };
      const tile = (c, r) => { const x = +(c + margin + gap).toFixed(3), y = +(r + margin + gap).toFixed(3); return `M${x + rr} ${y}h${arm}a${rr} ${rr} 0 0 1 ${rr} ${rr}v${arm}a${rr} ${rr} 0 0 1 -${rr} ${rr}h-${arm}a${rr} ${rr} 0 0 1 -${rr} -${rr}v-${arm}a${rr} ${rr} 0 0 1 ${rr} -${rr}z`; };
      let dark = "", hh = "";
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) { if (!modules[r][c]) continue; if (inH(r, c)) hh += tile(c, r); else dark += tile(c, r); }
      const box = body.querySelector(".shx-qr"); if (!box) return false;
      box.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="geometricPrecision" role="img" aria-label="QR code"><defs><linearGradient id="hsHg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#be185d"/></linearGradient></defs><path d="${dark}" fill="#0b0b16"/><path d="${hh}" fill="url(#hsHg)"/></svg>`;
      const card = body.querySelector(".shx-qrcard"); if (card) card.classList.remove("overflow");
      return true;
    } catch (e) { return false; }
  }
  // the holospace is too rich for an offline code — swap the QR face for a tap-to-publish prompt.
  function markQrOverflow() {
    const box = body.querySelector(".shx-qr"); const card = body.querySelector(".shx-qrcard");
    if (card) card.classList.add("overflow");
    if (box) box.innerHTML = `<button class="shx-qrpub" data-act="publish"><span class="shx-qrpub-i">${HOLO_MARK}</span><b>Make a scannable code</b><i>Publish to the sovereign cloud · opens worldwide</i></button>`;
    bind();
  }

  function renderBusy() { body.innerHTML = `<div class="shx"><div class="shx-mid"><div class="shx-bloom"></div></div></div>`; bind(); }
  function render() {
    if (_view === "open") return renderOpen();
    if (_sealed && _sealed.error) { body.innerHTML = `<div class="shx"><div class="shx-mid"><div class="shx-empty">Could not seal this yet.<br>${esc(_sealed.error)}</div></div><div class="shx-bot"><button class="shx-primary" data-act="retry">Try again</button></div></div>`; bind(); return; }
    const s = _sealed || {};
    const link = s.world || s.link || "";
    const why = s.app ? "Hand someone this app, running." : _scope === "workspace" ? "Your whole workspace, one link." : "Your holospace is one living link.";
    const cid = s.app ? String(s.kappa || "").split(":").pop().slice(0, 14) : (s.bundle ? String(s.bundle.did || s.bundle.rootCid).split(":").pop().slice(0, 14) : "");
    const reach = s.app
      ? `<span class="shx-tick world">◉</span><span>Opens running, fullscreen. No sign-in.</span>`
      : s.world
        ? `<span class="shx-tick world">◉</span><span>Published to IPFS. Opens worldwide.</span>`
        : `<span class="shx-tick">✓</span><span>Re&#8202;derives to its address. No server.</span>`;
    const qrcap = s.app ? `Scan to open · <b>running</b>` : s.world ? `Scan to open worldwide` : `Scan to open · <b>no server</b>`;
    const seg = `<div class="shx-seg" role="tablist">` +
      (hasApp ? `<button class="shx-seg-b${_scope === "app" ? " on" : ""}" data-scope="app" role="tab">This app</button>` : ``) +
      `<button class="shx-seg-b${_scope === "holospace" ? " on" : ""}" data-scope="holospace" role="tab">This holospace</button>` +
      `<button class="shx-seg-b${_scope === "workspace" ? " on" : ""}" data-scope="workspace" role="tab">Everything</button></div>`;
    const dests = s.app
      ? `<button class="shx-dest wide" data-act="openlink"><span class="shx-di">↗</span><span>Preview as a guest</span></button>`
      : `<button class="shx-dest" data-act="file"><span class="shx-di">⤓</span><span>Save a file</span></button>` +
        `<button class="shx-dest${s.world ? " done" : ""}" data-act="publish"${_publishing ? " disabled" : ""}><span class="shx-di">${s.world ? "◉" : "☁"}</span><span>${_publishing ? "Publishing…" : s.world ? "Published" : "Sovereign cloud"}</span></button>`;
    body.innerHTML = `<div class="shx">
      <div class="shx-top">
        <div class="shx-intro">
          <div class="shx-why">${why}</div>
          <div class="shx-how">${esc(s.travels || "Every byte proves its own address, so it opens anywhere with no server.")}</div>
        </div>
        ${seg}
        ${_gated ? `<div class="shx-gate">Confirm with your device unlock, then choose Everything again.</div>` : ``}
      </div>
      <div class="shx-mid">
        <div class="shx-qrcard">
          <div class="shx-qrwrap"><div class="shx-qr" aria-label="Scan to open on a phone"></div><div class="shx-qrlogo">${HOLO_MARK}</div></div>
          <div class="shx-qrcap">${qrcap}</div>
        </div>
      </div>
      <div class="shx-bot">
        <div class="shx-linkrow"><input class="shx-link" id="shx-link" readonly value="${esc(link)}" aria-label="Link" /><button class="shx-mini" data-act="copy">Copy</button></div>
        <button class="shx-primary" data-act="share"><span class="shx-pi">↗</span>Share link</button>
        <div class="shx-dests">${dests}</div>
        <div class="shx-proof">${reach}${cid ? `<span class="shx-cid">${esc(cid)}</span>` : ``}<button class="shx-open" data-act="openview">Open a link</button><button class="shx-open" data-act="linkdevice" title="Add another device to your Hologram">Link a device</button></div>
      </div></div>`;
    _gated = false; bind();
  }
  function renderOpen() {
    body.innerHTML = `<div class="shx"><div class="shx-top">
      <div class="shx-intro"><div class="shx-why">Open a shared holospace.</div><div class="shx-how">From a link, a token, or a bundle file. It lands right here.</div></div>
      <button class="shx-primary" data-act="pickfile"><span class="shx-pi">⤒</span>Choose a bundle file</button>
      <div class="shx-or">or paste a link or token</div>
      <div class="shx-linkrow"><input class="shx-paste" placeholder="https://…  or  did:holo:sha256:…" aria-label="Paste" /><button class="shx-mini" data-act="gopaste">Open</button></div>
    </div><div class="shx-bot"><button class="shx-dest wide" data-act="backshare"><span>Back to sharing</span></button></div></div>`;
    bind();
  }

  async function doShare() { const link = currentLink(); if (!link) return; try { if (navigator.share) { await navigator.share({ title: "A Hologram holospace", text: "Open this, it runs instantly.", url: link }); return; } } catch (e) { if (e && e.name === "AbortError") return; } doCopy(); }
  function doCopy() { const l = currentLink(); if (!l) return; try { navigator.clipboard.writeText(l); } catch (e) {} flash('[data-act="copy"]', "Copied"); }
  async function doFile() { if (!_sealed || !_sealed.bundle) return; try { const ws = _sealed.ws, b = _sealed.bundle; const short = String(b.did || b.rootCid).split(":").pop().slice(0, 10); const name = (_scope === "workspace" ? `holo-workspace-${short}` : `holospace-${short}`) + ".car"; const url = URL.createObjectURL(new Blob([ws.exportCar(b.rootCid, b.blocks)], { type: "application/vnd.ipld.car" })); const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); flash('[data-act="file"]', "Saved"); } catch (e) {} }

  // publish — the WORLDWIDE reach. Pin the sealed CAR to public IPFS (credential server-side), mint a short
  // `#car=<cid>` link that re-derives the exact snapshot on any device, and re-aim the QR + link at it.
  async function doPublish() {
    if (!_sealed || !_sealed.bundle || _publishing) return;
    _publishing = true; render();
    try {
      const ws = _sealed.ws, b = _sealed.bundle;
      const res = await ws.pinShareToCloud(b.rootCid, b.blocks);
      _publishing = false;
      if (res && res.carCid) {
        _sealed.world = `${location.origin}${SHELL_PATH()}#car=${res.carCid}`;
        render(); paintCurrentQR();
        flash('[data-act="copy"]', "Worldwide link ready");
      } else { render(); paintCurrentQR(); flash('[data-act="publish"]', "Cloud unavailable here"); }
    } catch (e) { _publishing = false; render(); paintCurrentQR(); flash('[data-act="publish"]', "Could not publish"); }
  }

  async function doImport(buf, pasted) {
    try { const ws = await sealer(); let rootCid = null, source = null;
      if (buf) { const { roots, blocks } = ws.importCar(buf instanceof Uint8Array ? buf : new Uint8Array(buf)); rootCid = roots[0]; source = ws.verifiedBlockSource(blocks); }
      else if (pasted) {
        // a SHARE-TO-RUN link (#k= / holospace.html?app=) opens the app RUNNING as a guest, not an import
        // into this shell — so route it straight to its landing in a new view.
        if (/#k=|holospace\.html\?app=/.test(String(pasted))) { window.open(String(pasted).trim(), "_blank", "noopener"); aside.close(); return; }
        const carM = String(pasted).match(/car=([A-Za-z0-9]+)/);                         // a worldwide pinned link
        if (carM) { const got = await ws.openCarByCid(carM[1]); if (got && got.roots[0]) { rootCid = got.roots[0]; source = ws.verifiedBlockSource(got.blocks); } }
        else if (ws.looksLikeToken(pasted)) { rootCid = pasted.trim(); source = ws.cloudBlockSource(); }
        else { const got = ws.decodeResumeLink(pasted); if (got && got.roots[0]) { rootCid = got.roots[0]; source = ws.verifiedBlockSource(got.blocks); } }
      }
      if (!rootCid || !source) { flash('[data-act="gopaste"]', "Not a link"); return; }
      const restored = (await ws.restoreHolospace(rootCid, source)) || (await ws.restoreWorkspace(rootCid, source));
      if (!restored) { flash('[data-act="gopaste"]', "Could not verify"); return; }
      const ok = onImport && onImport(restored.manifest); if (ok) aside.close();
    } catch (e) { flash('[data-act="gopaste"]', "Could not open"); }
  }
  function flash(sel, text) { const b = body.querySelector(sel); if (!b) return; const span = b.querySelector("span:last-child") || b; const o = span.textContent; span.textContent = text; setTimeout(() => { try { span.textContent = o; } catch (e) {} }, 1300); }

  function bind() {
    file.onchange = async () => { const f = file.files && file.files[0]; if (!f) return; const buf = await f.arrayBuffer(); file.value = ""; doImport(buf); };
    body.querySelectorAll("[data-scope]").forEach((b) => b.onclick = () => { const sc = b.getAttribute("data-scope"); if (sc !== _scope) { _scope = sc; seal(); } });
    body.querySelectorAll("[data-act]").forEach((b) => b.onclick = () => {
      const a = b.getAttribute("data-act");
      if (a === "share") doShare(); else if (a === "copy") doCopy(); else if (a === "file") doFile(); else if (a === "publish") doPublish();
      else if (a === "openlink") { const l = currentLink(); if (l) window.open(l, "_blank", "noopener"); }
      else if (a === "openview") { _view = "open"; renderOpen(); } else if (a === "backshare") { _view = "share"; render(); paintCurrentQR(); }
      else if (a === "retry") seal(); else if (a === "pickfile") file.click();
      else if (a === "gopaste") { const inp = body.querySelector(".shx-paste"); doImport(null, inp && inp.value); }
      else if (a === "linkdevice") { try { onLinkDevice ? onLinkDevice() : window.open(location.origin + "/pair.html", "_blank", "noopener"); } catch (e) {} }   // S4: scan a new device's QR to link it (verified, scoped, revocable — holo-pair)
    });
  }

  bindTrigger();
  return { open: openShare, close: () => aside.close(), toggle: () => (aside.isOpen() ? aside.close() : openShare()) };
}

function injectStyles() {
  if (document.getElementById("holo-share-styles")) return;
  const s = document.createElement("style"); s.id = "holo-share-styles";
  s.textContent = `
  /* Share wears the OS theme tokens (the Holo Wallet palette + φ rhythm), not bespoke hex. */
  .shx{--ink:var(--holo-ink,#e9eef7);--dim:color-mix(in srgb,var(--holo-ink,#e9eef7) 60%,transparent);
    --line:var(--holo-border,rgba(255,255,255,.12));--surface:color-mix(in srgb,var(--holo-ink,#e9eef7) 5%,transparent);
    --surface2:color-mix(in srgb,var(--holo-ink,#e9eef7) 9%,transparent);--acc:var(--holo-accent,#5b8cff);--ok:var(--holo-ok,#3fb950);
    flex:1 1 auto;display:flex;flex-direction:column;gap:clamp(12px,2.2vh,22px);padding:clamp(14px,2.4vh,24px) 18px 20px;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;color:var(--ink)}
  .shx-top{display:flex;flex-direction:column;gap:clamp(10px,1.8vh,14px);flex:0 0 auto}
  /* the QR stage holds a scannable floor so it can never collapse to nothing; if a panel is genuinely too
     short for the floor + the controls, the body scrolls (above) rather than overlap or clip a control. */
  .shx-mid{display:flex;align-items:center;justify-content:center;flex:1 1 auto;min-height:168px;overflow:hidden;container-type:size}
  .shx-bot{display:flex;flex-direction:column;gap:11px;flex:0 0 auto}
  .shx-intro{display:flex;flex-direction:column;gap:7px}
  .shx-why{font-size:clamp(19px,2.5vh,22px);font-weight:680;letter-spacing:-.015em;line-height:1.22;color:var(--ink)}
  .shx-how{font-size:15px;line-height:1.45;color:var(--dim)}
  .shx-seg{display:flex;gap:4px;padding:3px;border-radius:11px;background:var(--surface);border:1px solid var(--line)}
  .shx-seg-b{flex:1;border:0;border-radius:8px;background:transparent;color:var(--dim);font:600 15px var(--win-font,system-ui);padding:9px 8px;cursor:pointer;transition:.12s}
  .shx-seg-b.on{background:var(--acc);color:#fff}
  .shx-seg-b:not(.on):hover{color:var(--ink);background:var(--surface2)}
  /* the hero white sticker — a square that FITS the space left between the intro and the actions, sized to
     the CARRIAGE (container query units), never the viewport. It shrinks on a short panel so it can never
     overflow onto the text/links, and caps at 360px so it never bloats on a tall one. clamp floor keeps the
     code scannable. This is what makes Share read clean at any screen size. */
  .shx-qrcard{position:relative;isolation:isolate;background:linear-gradient(158deg,#ffffff 0%,#eef0f6 100%);border-radius:clamp(16px,3cqi,24px);padding:clamp(10px,3cqi,18px);display:flex;flex-direction:column;align-items:center;gap:clamp(7px,2cqi,12px);box-sizing:border-box;
    width:clamp(120px,min(100cqi,calc(100cqb - 2.4rem)),360px);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.95), inset 0 0 0 1px rgba(255,255,255,.5), 0 2px 5px rgba(10,10,20,.22), 0 26px 56px -20px rgba(10,10,20,.7), 0 0 0 .5px rgba(10,10,20,.06);animation:shx-pop .5s cubic-bezier(.2,.9,.25,1.05)}
  .shx-qrcard::before{content:"";position:absolute;inset:0;border-radius:24px;pointer-events:none;z-index:2;background:linear-gradient(133deg,rgba(255,255,255,.85) 0%,rgba(255,255,255,0) 30%, rgba(255,255,255,0) 78%, rgba(255,255,255,.4) 100%)}
  .shx-qrcard::after{content:"";position:absolute;right:0;bottom:0;width:38%;height:38%;border-radius:0 0 24px 0;pointer-events:none;z-index:1;background:radial-gradient(130% 130% at 100% 100%, rgba(10,10,20,.16), rgba(10,10,20,0) 62%)}
  .shx-qrwrap{position:relative;z-index:3;width:100%;aspect-ratio:1/1}
  .shx-qr,.shx-qr svg{width:100%;height:100%;display:block}
  .shx-qrcard.overflow .shx-qrlogo{display:none}
  .shx-qrlogo{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:23%;height:23%;background:radial-gradient(120% 120% at 30% 20%,#ffffff,#eceef4);border-radius:26%;display:grid;place-items:center;color:#6d28d9;box-shadow:inset 0 1px 0 rgba(255,255,255,.9), 0 2px 7px rgba(10,10,20,.28), 0 0 0 1.5px #fff}
  .shx-qrlogo svg{width:74%;height:74%;display:block}
  .shx-qrcap{position:relative;z-index:3;font-size:14px;letter-spacing:.03em;color:#16161c}
  .shx-qrcap b{font-weight:800;color:#6d28d9}
  /* tap-to-publish face when the holospace is too rich for an offline code */
  .shx-qrpub{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border:2px dashed rgba(109,40,217,.35);border-radius:18px;background:rgba(124,58,237,.04);color:#3a2a66;cursor:pointer;text-align:center;padding:18px;transition:.14s}
  .shx-qrpub:hover{background:rgba(124,58,237,.1);border-color:rgba(109,40,217,.6)}
  .shx-qrpub-i{width:34%;color:#6d28d9}.shx-qrpub-i svg{width:100%;height:100%}
  .shx-qrpub b{font-size:16px;font-weight:750;color:#1b1430}.shx-qrpub i{font-style:normal;font-size:13px;color:#5b4b7a;line-height:1.35}
  .shx-linkrow{display:flex;gap:8px}
  .shx-link,.shx-paste{flex:1;min-width:0;background:var(--surface);border:1px solid var(--line);border-radius:10px;color:var(--ink);padding:11px 13px;font:14px ui-monospace,Menlo,Consolas,monospace;outline:none;text-overflow:ellipsis}
  .shx-paste{font-family:var(--win-font,system-ui);font-size:15px}
  .shx-link:focus,.shx-paste:focus{border-color:var(--acc)}
  .shx-mini{flex:0 0 auto;border:1px solid var(--line);border-radius:10px;background:var(--surface2);color:var(--ink);font:600 15px var(--win-font,system-ui);padding:0 16px;cursor:pointer;transition:.12s}
  .shx-mini:hover{filter:brightness(1.12)}
  .shx-primary{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;border:0;border-radius:11px;background:var(--acc);color:#fff;font:700 15px var(--win-font,system-ui);padding:13px;cursor:pointer;transition:.12s}
  .shx-primary:hover{filter:brightness(1.08)} .shx-pi{font-size:16px;opacity:.95}
  .shx-dests{display:flex;gap:11px}
  .shx-dest{flex:1;display:flex;align-items:center;justify-content:center;gap:9px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--ink);font:600 15px var(--win-font,system-ui);padding:12px;cursor:pointer;transition:.12s}
  .shx-dest.wide{width:100%}
  .shx-dest:hover{background:var(--surface2);border-color:color-mix(in srgb,var(--acc) 40%,var(--line))}
  .shx-dest.done{border-color:color-mix(in srgb,var(--ok) 55%,var(--line));color:var(--ok)}
  .shx-dest:disabled{opacity:.6;cursor:default}
  .shx-di{font-size:17px;opacity:.9}
  .shx-proof{display:flex;align-items:center;gap:9px;flex-wrap:wrap;color:var(--dim);font-size:14px;line-height:1.4}
  .shx-tick{color:var(--ok);font-weight:700}.shx-tick.world{color:var(--acc)}
  .shx-cid{font:13px ui-monospace,Menlo,Consolas,monospace;color:color-mix(in srgb,var(--ink) 42%,transparent)}
  .shx-open{margin-left:auto;border:0;background:transparent;color:var(--acc);font:600 14px var(--win-font,system-ui);cursor:pointer;padding:2px 4px}
  .shx-open:hover{text-decoration:underline}
  .shx-or{text-align:center;color:var(--dim);font-size:14px;margin:2px 0}
  .shx-gate{color:var(--holo-warn,#fbbf24);font-size:14px;line-height:1.4;text-align:center}
  .shx-empty{color:var(--dim);font-size:15px;line-height:1.5;text-align:center}
  .shx-bloom{width:clamp(120px,min(100cqi,calc(100cqb - 2rem)),320px);aspect-ratio:1/1;margin:auto;border-radius:24px;background:linear-gradient(158deg,rgba(255,255,255,.9),rgba(238,240,246,.9));animation:shx-pulse 1.1s ease-in-out infinite}
  @keyframes shx-pop{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:none}}
  @keyframes shx-pulse{0%,100%{opacity:.45}50%{opacity:.85}}
  @media (prefers-reduced-motion: reduce){ .shx-qrcard,.shx-bloom{animation:none} }`;
  document.head.appendChild(s);
}

export default { mountShare };
