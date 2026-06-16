// holo-egress-connect.mjs — the in-shell "Connect the web" affordance: a small icon beside the omnibar that
// shows LIVE connection status to the holospaces router extension and the simplest install path.
//
// HONEST CONSTRAINT: a web page CANNOT auto-install an extension (Chrome removed inline install in 2018), so
// the only true one-click is the Chrome Web Store "Add to Brave" button. This component wires that (the
// instant a listing exists) + a clean developer "load unpacked" fallback for now, with live status from the
// extension's own presence beacon (its content.js sets `data-holospaces-egress` = the extension id on the
// operator origin). Once connected, Hologram can reach ANY site CORS-free, streamed, κ-anchored.

const CWS_URL = "";   // ← set to the holospaces router Chrome Web Store listing URL once published → true 1-click.
const PROBE_URL = "/usr/share/holo-web-recorder/egress-probe.html";

export const egressId = () => { try { return document.documentElement.getAttribute("data-holospaces-egress") || null; } catch { return null; } };
export const egressConnected = () => !!egressId();

// mountEgressConnect(anchor, opts) — insert the icon right after `anchor` (the omnibar). Idempotent.
export function mountEgressConnect(anchor, { cwsUrl = CWS_URL } = {}) {
  if (!anchor || document.getElementById("egress-connect")) return null;
  injectStyles();
  const wrap = document.createElement("div"); wrap.id = "egress-connect"; wrap.className = "egc";
  wrap.innerHTML = `
    <button class="egc-btn" title="Connect the web (egress)" aria-label="Connect the web">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v3"/><path d="M9 7h6"/><rect x="6" y="7" width="12" height="6" rx="2"/><path d="M12 13v4a4 4 0 0 1-4 4H6"/></svg>
      <span class="egc-dot"></span>
    </button>
    <div class="egc-card" hidden></div>`;
  anchor.insertAdjacentElement("afterend", wrap);
  const btn = wrap.querySelector(".egc-btn"), card = wrap.querySelector(".egc-card");

  const renderCard = () => {
    const id = egressId();
    if (id) {
      card.innerHTML = `
        <div class="egc-h"><span class="egc-st on">●</span> Web connected</div>
        <div class="egc-sub">Hologram can reach any site — CORS-free, streamed, every byte κ-anchored. <span class="egc-mono">ext ${esc(id.slice(0, 12))}…</span></div>
        <a class="egc-cta sec" href="${esc(PROBE_URL)}" target="_blank" rel="noopener">Test it ↗</a>`;
    } else {
      card.innerHTML = `
        <div class="egc-h"><span class="egc-st">○</span> Connect the web</div>
        <div class="egc-sub">Install the Hologram router once — then any URL, IPFS, or web3 object streams in, content-addressed, with no server.</div>
        ${cwsUrl
          ? `<a class="egc-cta" href="${esc(cwsUrl)}" target="_blank" rel="noopener">＋ Add to your browser — one click</a>`
          : `<div class="egc-cta dim" title="Publish the router to the Chrome Web Store for one-click install">＋ One-click install — coming to the Web Store</div>`}
        <details class="egc-dev"><summary>Install from disk (developer)</summary>
          <ol><li>Open <span class="egc-mono">chrome://extensions</span> → enable <b>Developer mode</b>.</li>
          <li><b>Load unpacked</b> → select the <span class="egc-mono">holospaces router</span> extension folder.</li>
          <li>Reload Hologram. The dot turns green.</li></ol>
          <div class="egc-note">A browser won't let a page install an extension — the genuine one-click is the Web Store button above.</div>
        </details>`;
    }
  };
  const refresh = () => {
    const on = egressConnected();
    wrap.classList.toggle("on", on);
    btn.title = on ? "Web connected (egress)" : "Connect the web (egress)";
    if (!card.hidden) renderCard();
  };
  btn.addEventListener("click", () => { const open = card.hidden; document.querySelectorAll(".egc-card").forEach((c) => (c.hidden = true)); if (open) { renderCard(); card.hidden = false; } });
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) card.hidden = true; });
  refresh(); setInterval(refresh, 1500);   // poll the beacon → live status
  return { refresh };
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function injectStyles() {
  if (document.getElementById("egc-style")) return;
  const s = document.createElement("style"); s.id = "egc-style";
  s.textContent = `
  .egc{position:relative;display:inline-flex;align-items:center}
  .egc-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:0;border-radius:50%;background:transparent;color:var(--holo-ink-dim,#7d8aa6);cursor:pointer;transition:background .12s,color .12s}
  .egc-btn:hover{background:color-mix(in srgb,var(--holo-ink,#c9d1d9) 10%,transparent);color:var(--holo-ink,#e8eef9)}
  .egc.on .egc-btn{color:#34d399}
  .egc-dot{position:absolute;top:7px;right:7px;width:6px;height:6px;border-radius:50%;background:#56607a;box-shadow:0 0 0 2px var(--holo-bg,#0a0e16)}
  .egc.on .egc-dot{background:#34d399;box-shadow:0 0 0 2px var(--holo-bg,#0a0e16),0 0 7px #34d399}
  .egc-card{position:absolute;top:42px;right:0;z-index:300;width:288px;background:var(--holo-surface,#0c111b);border:1px solid var(--holo-border,#1d2840);border-radius:14px;padding:14px 15px;box-shadow:0 18px 50px rgba(0,0,0,.6);font:13px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--holo-ink,#e8eef9)}
  .egc-card[hidden]{display:none}
  .egc-h{font-weight:650;font-size:14px;display:flex;gap:8px;align-items:center} .egc-st{color:#56607a;font-size:11px} .egc-st.on{color:#34d399}
  .egc-sub{color:var(--holo-ink-dim,#7d8aa6);font-size:12px;margin:5px 0 12px}
  .egc-mono{font:11px ui-monospace,Menlo,Consolas,monospace;color:#8ea6cf}
  .egc-cta{display:block;text-align:center;text-decoration:none;font-weight:650;font-size:13px;color:#0a0f1a;background:#a78bfa;border-radius:10px;padding:10px;cursor:pointer}
  .egc-cta:hover{filter:brightness(1.06)} .egc-cta.sec{color:#d6c8ff;background:#140f24;border:1px solid #3b2f63} .egc-cta.dim{color:#7d8aa6;background:#0e1726;border:1px dashed #2a313c;cursor:default;font-weight:500}
  .egc-dev{margin-top:11px} .egc-dev summary{color:var(--holo-ink-dim,#7d8aa6);font-size:12px;cursor:pointer} .egc-dev summary:hover{color:var(--holo-ink,#e8eef9)}
  .egc-dev ol{margin:8px 0 0;padding-left:18px;color:#cbd6ea;font-size:12px} .egc-dev li{margin:3px 0} .egc-dev b{color:#fff}
  .egc-note{color:#4a5573;font-size:11px;margin-top:8px;line-height:1.5}`;
  document.head.appendChild(s);
}

export default { mountEgressConnect, egressConnected, egressId };
