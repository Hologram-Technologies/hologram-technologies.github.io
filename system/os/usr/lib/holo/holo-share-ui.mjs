// holo-share-ui.mjs — Share, rendered inside the shared right side-carriage (holo-aside.mjs), so Create,
// Play, and Share all open with one identical chrome, animation, and feel. This module owns only the
// Share CONTENT + flow; the carriage owns the dock, slide, header, drag-resize, toggle, and close.
//
// One clean, no-scroll flow: pick what travels (this holospace / everything), then the link is ready as a
// hyper-real sticker (the real Hologram mark centred, big tinted tiles spelling H, a live QR). Copy it,
// share it to any app, save a file, or back it up to the sovereign cloud. No new substrate: the sealer
// (holo-workspace-sync.mjs) and the QR (holo-qr.js) are dynamic-imported. Serverless and sovereign: the
// link carries its own bytes in the URL fragment, and everything restored re-derives to its address (L5).

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
export function mountShare(trigger, { getHolospace, getWorkspace, onImport, requireEverythingAuth } = {}) {
  injectStyles();
  const aside = createAside({ id: "share", title: "Share", logo: HOLO_MARK, defaultW: 460, minW: 380, maxW: 620 });
  const body = aside.body;
  const file = document.createElement("input"); file.type = "file"; file.accept = ".car,application/vnd.ipld.car"; file.style.display = "none"; aside.el.appendChild(file);
  let _scope = "holospace", _sealed = null, _view = "share", _gated = false;

  async function openShare() { aside.open(); await seal(); }
  function bindTrigger() { if (!trigger) return; trigger.setAttribute("aria-expanded", "false"); trigger.addEventListener("click", (e) => { e.preventDefault(); if (aside.isOpen()) aside.close(); else openShare(); trigger.setAttribute("aria-expanded", aside.isOpen() ? "true" : "false"); }); }

  async function seal() {
    if (_scope === "workspace" && requireEverythingAuth) { let ok = true; try { ok = await requireEverythingAuth(); } catch (e) { ok = false; } if (!ok) { _scope = "holospace"; _gated = true; } }
    _view = "share"; renderBusy();
    try {
      const ws = await sealer(); let bundle, manifest;
      if (_scope === "workspace") { manifest = getWorkspace ? await getWorkspace() : null; if (!manifest) throw new Error("nothing to share yet"); bundle = await ws.sealWorkspace({ manifest, transport: "link", now: () => new Date().toISOString() }); }
      else { const hs = (getHolospace && getHolospace()) || { title: "Holospace", addr: "", snap: { world: [] }, board: [] }; manifest = ws.buildHolospaceManifest(hs); bundle = await ws.sealHolospace({ manifest, transport: "link", now: () => new Date().toISOString() }); }
      const link = `${location.origin}${SHELL_PATH()}#wks=${ws.encodeResumeLink(bundle.rootCid, bundle.blocks)}`;
      _sealed = { ws, bundle, manifest, link, travels: travelLine(_scope, manifest, ws) };
    } catch (e) { _sealed = { error: (e && e.message) || String(e) }; }
    render(); if (_sealed && _sealed.link) paintQR(_sealed.link);
  }

  // Custom QR: big soft rounded tiles (scan from a distance), tiles inside an H stencil tinted with the
  // brand gradient (spells H, stays dark-luminance so it still scans, ecc M backstops), centre left for
  // the real logo. Pure vector → razor-sharp at 8K / retina.
  async function paintQR(link) {
    try {
      const m = await qrlib(); const { size, modules } = m.toMatrix(link, { ecc: "M" });
      const N = size - 1, margin = 1, dim = size + margin * 2, gap = 0.085, s = 1 - gap * 2, rr = +(s * 0.3).toFixed(3), arm = +(s - 2 * rr).toFixed(3);
      const inH = (r, c) => { const nx = c / N, ny = r / N; return (((nx >= 0.17 && nx <= 0.31) || (nx >= 0.69 && nx <= 0.83)) || (ny >= 0.45 && ny <= 0.55 && nx >= 0.17 && nx <= 0.83)); };
      const tile = (c, r) => { const x = +(c + margin + gap).toFixed(3), y = +(r + margin + gap).toFixed(3); return `M${x + rr} ${y}h${arm}a${rr} ${rr} 0 0 1 ${rr} ${rr}v${arm}a${rr} ${rr} 0 0 1 -${rr} ${rr}h-${arm}a${rr} ${rr} 0 0 1 -${rr} -${rr}v-${arm}a${rr} ${rr} 0 0 1 ${rr} -${rr}z`; };
      let dark = "", hh = "";
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) { if (!modules[r][c]) continue; if (inH(r, c)) hh += tile(c, r); else dark += tile(c, r); }
      const box = body.querySelector(".shx-qr"); if (!box) return;
      box.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="geometricPrecision" role="img" aria-label="QR code"><defs><linearGradient id="hsHg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#be185d"/></linearGradient></defs><path d="${dark}" fill="#0b0b16"/><path d="${hh}" fill="url(#hsHg)"/></svg>`;
    } catch (e) {}
  }

  function renderBusy() { body.innerHTML = `<div class="shx"><div class="shx-mid"><div class="shx-bloom"></div></div></div>`; bind(); }
  function render() {
    if (_view === "open") return renderOpen();
    if (_sealed && _sealed.error) { body.innerHTML = `<div class="shx"><div class="shx-mid"><div class="shx-empty">Could not seal this yet.<br>${esc(_sealed.error)}</div></div><div class="shx-bot"><button class="shx-primary" data-act="retry">Try again</button></div></div>`; bind(); return; }
    const s = _sealed || {}, ws = _scope === "workspace";
    const big = s.link && s.link.length > 32000;
    const cid = s.bundle ? String(s.bundle.did || s.bundle.rootCid).split(":").pop().slice(0, 14) : "";
    body.innerHTML = `<div class="shx">
      <div class="shx-top">
        <div class="shx-intro">
          <div class="shx-why">Your holospace is one living link.</div>
          <div class="shx-how">Every byte proves its own address, so it opens anywhere with no server.</div>
          <div class="shx-what">Send the link, keep a file, or save it to your sovereign cloud.</div>
        </div>
        <div class="shx-seg" role="tablist">
          <button class="shx-seg-b${ws ? "" : " on"}" data-scope="holospace" role="tab">This holospace</button>
          <button class="shx-seg-b${ws ? " on" : ""}" data-scope="workspace" role="tab">Everything</button>
        </div>
        ${_gated ? `<div class="shx-gate">Confirm with your device unlock, then choose Everything again.</div>` : ``}
      </div>
      <div class="shx-mid">
        <div class="shx-qrcard">
          <div class="shx-qrwrap"><div class="shx-qr" aria-label="Scan to open on a phone"></div><div class="shx-qrlogo">${HOLO_MARK}</div></div>
          <div class="shx-qrcap">Built with&nbsp;<b>HOLOGRAM</b></div>
        </div>
      </div>
      <div class="shx-bot">
        <div class="shx-linkrow"><input class="shx-link" readonly value="${esc(s.link || "")}" aria-label="Link" /><button class="shx-mini" data-act="copy">Copy</button></div>
        <button class="shx-primary" data-act="share">Share link</button>
        ${big ? `<div class="shx-gate">Large for a link. Save a file or use the cloud.</div>` : ``}
        <div class="shx-dests">
          <button class="shx-dest" data-act="file"><span class="shx-di">⤓</span><span>Save a file</span></button>
          <button class="shx-dest" data-act="cloud"><span class="shx-di">☁</span><span>Sovereign cloud</span></button>
        </div>
        <div class="shx-proof"><span class="shx-tick">✓</span><span>Re&#8202;derives to its address. No server.</span>${cid ? `<span class="shx-cid">${esc(cid)}</span>` : ``}<button class="shx-open" data-act="openview">Open a link</button></div>
      </div></div>`;
    _gated = false; bind();
  }
  function renderOpen() {
    body.innerHTML = `<div class="shx"><div class="shx-top">
      <div class="shx-intro"><div class="shx-why">Open a shared holospace.</div><div class="shx-how">From a link, a token, or a bundle file. It lands right here.</div></div>
      <button class="shx-primary" data-act="pickfile">Choose a bundle file</button>
      <div class="shx-or">or paste a link or token</div>
      <div class="shx-linkrow"><input class="shx-paste" placeholder="https://…  or  did:holo:sha256:…" aria-label="Paste" /><button class="shx-mini" data-act="gopaste">Open</button></div>
    </div><div class="shx-bot"><button class="shx-dest wide" data-act="backshare"><span>Back to sharing</span></button></div></div>`;
    bind();
  }

  async function doShare() { const link = _sealed && _sealed.link; if (!link) return; try { if (navigator.share) { await navigator.share({ title: "A Hologram holospace", text: "Open this, it runs instantly.", url: link }); return; } } catch (e) { if (e && e.name === "AbortError") return; } doCopy(); }
  function doCopy() { const l = _sealed && _sealed.link; if (!l) return; try { navigator.clipboard.writeText(l); } catch (e) {} flash('[data-act="copy"]', "Copied"); }
  async function doFile() { if (!_sealed || !_sealed.bundle) return; try { const ws = _sealed.ws, b = _sealed.bundle; const short = String(b.did || b.rootCid).split(":").pop().slice(0, 10); const name = (_scope === "workspace" ? `holo-workspace-${short}` : `holospace-${short}`) + ".car"; const url = URL.createObjectURL(new Blob([ws.exportCar(b.rootCid, b.blocks)], { type: "application/vnd.ipld.car" })); const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); flash('[data-act="file"]', "Saved"); } catch (e) {} }
  async function doCloud() { if (!_sealed || !_sealed.bundle) return; flash('[data-act="cloud"]', "Publishing"); try { const ws = _sealed.ws, b = _sealed.bundle; let n = 0; try { n = await ws.publishToCloud(b.blocks); } catch (e) {} if (n > 0) { const tokenLink = `${location.origin}${SHELL_PATH()}?wks=${encodeURIComponent(String(b.did || b.rootCid))}`; const inp = body.querySelector(".shx-link"); if (inp) inp.value = tokenLink; if (_sealed) _sealed.link = tokenLink; paintQR(tokenLink); flash('[data-act="cloud"]', "On your cloud"); } else flash('[data-act="cloud"]', "Unavailable here"); } catch (e) { flash('[data-act="cloud"]', "Could not publish"); } }
  async function doImport(buf, pasted) {
    try { const ws = await sealer(); let rootCid = null, source = null;
      if (buf) { const { roots, blocks } = ws.importCar(buf instanceof Uint8Array ? buf : new Uint8Array(buf)); rootCid = roots[0]; source = ws.verifiedBlockSource(blocks); }
      else if (pasted && ws.looksLikeToken(pasted)) { rootCid = pasted.trim(); source = ws.cloudBlockSource(); }
      else if (pasted) { const got = ws.decodeResumeLink(pasted); if (got && got.roots[0]) { rootCid = got.roots[0]; source = ws.verifiedBlockSource(got.blocks); } }
      if (!rootCid || !source) { flash('[data-act="gopaste"]', "Not a link"); return; }
      const restored = (await ws.restoreHolospace(rootCid, source)) || (await ws.restoreWorkspace(rootCid, source));
      if (!restored) { flash('[data-act="gopaste"]', "Could not verify"); return; }
      const ok = onImport && onImport(restored.manifest); if (ok) aside.close();
    } catch (e) { flash('[data-act="gopaste"]', "Could not open"); }
  }
  function flash(sel, text) { const b = body.querySelector(sel); if (!b) return; const o = b.textContent; b.textContent = text; setTimeout(() => { try { b.textContent = o; } catch (e) {} }, 1200); }

  function bind() {
    file.onchange = async () => { const f = file.files && file.files[0]; if (!f) return; const buf = await f.arrayBuffer(); file.value = ""; doImport(buf); };
    body.querySelectorAll("[data-scope]").forEach((b) => b.onclick = () => { const sc = b.getAttribute("data-scope"); if (sc !== _scope) { _scope = sc; seal(); } });
    body.querySelectorAll("[data-act]").forEach((b) => b.onclick = () => {
      const a = b.getAttribute("data-act");
      if (a === "share") doShare(); else if (a === "copy") doCopy(); else if (a === "file") doFile(); else if (a === "cloud") doCloud();
      else if (a === "openview") { _view = "open"; renderOpen(); } else if (a === "backshare") { _view = "share"; render(); }
      else if (a === "retry") seal(); else if (a === "pickfile") file.click();
      else if (a === "gopaste") { const inp = body.querySelector(".shx-paste"); doImport(null, inp && inp.value); }
    });
  }

  bindTrigger();
  return { open: openShare, close: () => aside.close(), toggle: () => (aside.isOpen() ? aside.close() : openShare()) };
}

function injectStyles() {
  if (document.getElementById("holo-share-styles")) return;
  const s = document.createElement("style"); s.id = "holo-share-styles";
  s.textContent = `
  .shx{flex:1 1 auto;display:flex;flex-direction:column;justify-content:space-between;gap:18px;padding:22px 18px 92px;min-height:0;overflow:hidden}
  .shx-top{display:flex;flex-direction:column;gap:18px}
  .shx-mid{display:flex;align-items:center;justify-content:center;flex:1 1 auto;min-height:0}
  .shx-bot{display:flex;flex-direction:column;gap:13px}
  .shx-intro{display:flex;flex-direction:column;gap:8px}
  .shx-why{font-size:21px;font-weight:680;letter-spacing:-.015em;line-height:1.25;color:#e7e7ea}
  .shx-how,.shx-what{font-size:16px;line-height:1.45;color:#9a9aa2}
  .shx-seg{display:flex;gap:4px;padding:3px;border-radius:11px;background:#161619;border:1px solid #232327}
  .shx-seg-b{flex:1;border:0;border-radius:8px;background:transparent;color:#9a9aa2;font:600 16px var(--win-font,system-ui);padding:10px 8px;cursor:pointer;transition:.12s}
  .shx-seg-b.on{background:#2563eb;color:#fff}
  .shx-seg-b:not(.on):hover{color:#e7e7ea;background:#202026}
  .shx-qrcard{position:relative;isolation:isolate;background:linear-gradient(158deg,#ffffff 0%,#eef0f6 100%);border-radius:24px;padding:17px 17px 14px;display:flex;flex-direction:column;align-items:center;gap:12px;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.95), inset 0 0 0 1px rgba(255,255,255,.5), 0 2px 5px rgba(10,10,20,.22), 0 26px 56px -20px rgba(10,10,20,.7), 0 0 0 .5px rgba(10,10,20,.06);animation:shx-pop .5s cubic-bezier(.2,.9,.25,1.05)}
  .shx-qrcard::before{content:"";position:absolute;inset:0;border-radius:24px;pointer-events:none;z-index:2;background:linear-gradient(133deg,rgba(255,255,255,.85) 0%,rgba(255,255,255,0) 30%, rgba(255,255,255,0) 78%, rgba(255,255,255,.4) 100%)}
  .shx-qrcard::after{content:"";position:absolute;right:0;bottom:0;width:38%;height:38%;border-radius:0 0 24px 0;pointer-events:none;z-index:1;background:radial-gradient(130% 130% at 100% 100%, rgba(10,10,20,.16), rgba(10,10,20,0) 62%)}
  .shx-qrwrap{position:relative;z-index:3;width:min(300px,48vh,72vw);aspect-ratio:1/1}
  .shx-qr,.shx-qr svg{width:100%;height:100%;display:block}
  .shx-qrlogo{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:23%;height:23%;background:radial-gradient(120% 120% at 30% 20%,#ffffff,#eceef4);border-radius:26%;display:grid;place-items:center;color:#6d28d9;box-shadow:inset 0 1px 0 rgba(255,255,255,.9), 0 2px 7px rgba(10,10,20,.28), 0 0 0 1.5px #fff}
  .shx-qrlogo svg{width:74%;height:74%;display:block}
  .shx-qrcap{position:relative;z-index:3;font-size:15px;letter-spacing:.04em;color:#16161c}
  .shx-qrcap b{font-weight:800;letter-spacing:.08em;background:linear-gradient(135deg,#7c3aed,#be185d);-webkit-background-clip:text;background-clip:text;color:transparent}
  .shx-linkrow{display:flex;gap:8px}
  .shx-link,.shx-paste{flex:1;min-width:0;background:#161619;border:1px solid #232327;border-radius:10px;color:#c7c7cf;padding:12px 13px;font:15px ui-monospace,Menlo,Consolas,monospace;outline:none}
  .shx-paste{font-family:var(--win-font,system-ui);font-size:16px}
  .shx-link:focus,.shx-paste:focus{border-color:#2563eb}
  .shx-mini{flex:0 0 auto;border:1px solid #2a2a31;border-radius:10px;background:#161619;color:#e7e7ea;font:600 16px var(--win-font,system-ui);padding:0 16px;cursor:pointer;transition:.12s}
  .shx-mini:hover{background:#202026}
  .shx-primary{width:100%;border:0;border-radius:11px;background:#2563eb;color:#fff;font:700 16px var(--win-font,system-ui);padding:14px;cursor:pointer;transition:.12s}
  .shx-primary:hover{background:#1d5fe0}
  .shx-dests{display:flex;gap:13px}
  .shx-dest{flex:1;display:flex;align-items:center;justify-content:center;gap:9px;border:1px solid #232327;border-radius:11px;background:#131316;color:#e7e7ea;font:600 16px var(--win-font,system-ui);padding:13px;cursor:pointer;transition:.12s}
  .shx-dest.wide{width:100%}
  .shx-dest:hover{background:#1c1c20;border-color:#2f2f37}
  .shx-di{font-size:18px;opacity:.85}
  .shx-proof{display:flex;align-items:center;gap:9px;flex-wrap:wrap;color:#8a8a92;font-size:15px;line-height:1.4}
  .shx-tick{color:#3fb950;font-weight:700}
  .shx-cid{font:14px ui-monospace,Menlo,Consolas,monospace;color:#6b6b73}
  .shx-open{margin-left:auto;border:0;background:transparent;color:#7c9cff;font:600 15px var(--win-font,system-ui);cursor:pointer;padding:2px 4px}
  .shx-open:hover{text-decoration:underline}
  .shx-or{text-align:center;color:#8a8a92;font-size:15px;margin:4px 0}
  .shx-gate{color:#fbbf24;font-size:15px;line-height:1.4;text-align:center}
  .shx-empty{color:#9a9aa2;font-size:16px;line-height:1.5;text-align:center}
  .shx-bloom{width:208px;height:208px;margin:auto;border-radius:24px;background:#141417;animation:shx-pulse 1.1s ease-in-out infinite}
  @keyframes shx-pop{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:none}}
  @keyframes shx-pulse{0%,100%{opacity:.4}50%{opacity:.8}}
  @media (prefers-reduced-motion: reduce){ .shx-qrcard,.shx-bloom{animation:none} }`;
  document.head.appendChild(s);
}

export default { mountShare };
