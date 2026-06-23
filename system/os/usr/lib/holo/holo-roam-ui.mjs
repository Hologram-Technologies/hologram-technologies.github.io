// holo-roam-ui.mjs — "⇄ Roam" toggle: mirror your OPEN WINDOWS across your other tabs (and, with a WAN
// transport, your other devices) over a real BroadcastChannel. A click-testable surface for Phase E: flip
// it on in two tabs, edit an app in one, watch it update in the other — verify-before-trust, live.
//
// Why a thin mirror over makeRoamNet's reconcile: same-origin tabs SHARE storage, so the chains are already
// equal and reconcileRemote would say "in-sync" (nothing to adopt) — yet the other tab's open FRAME hasn't
// re-rendered. So the mirror always applies a VERIFIED incoming state to the live frame, with CONTENT
// dedup (not head dedup — re-capture re-stamps the time, changing the head but not the value) to kill echo
// loops. Durable convergence (host.adopt) still rides underneath for the cross-device case. Fail-soft.

const sj = (x) => { try { return JSON.stringify(x ?? null); } catch (e) { return ""; } };

// makeRoamMirror({ post, getActiveHost, getOpenApps, applyAdopted, openShared, self }) — the transport-
// injected core (node/browser testable with a fake hub). post(msg) → peers; openShared(bundle) → verified
// state | null (inject holo-workspace-share.openSharedWorkspace). Returns { advertiseAll, onMessage }.
export function makeRoamMirror({ post = () => {}, getActiveHost, getOpenApps, applyAdopted, openShared, self = null } = {}) {
  const seen = new Map();   // appκ → last state JSON applied/advertised (CONTENT dedup → no echo loop)

  async function advertiseAll() {
    let host = null; try { host = await getActiveHost(); } catch (e) {} if (!host) return 0;
    let apps = []; try { apps = (await getOpenApps()) || []; } catch (e) {}
    let sent = 0;
    for (const a of apps) {
      const app = a && a.appKappa; if (!app) continue;
      let bundle = null; try { bundle = await host.workspace(app).bundle(); } catch (e) {}
      if (!bundle || !bundle.entries.length) continue;
      let state = null; try { state = await host.workspace(app).resume(); } catch (e) {}
      const j = sj(state); if (seen.get(app) === j) continue;          // unchanged → don't spam
      seen.set(app, j);
      try { await post({ from: self, app, bundle }); sent++; } catch (e) {}   // await so a sync transport (tests) settles
    }
    return sent;
  }

  async function onMessage(msg) {
    if (!msg || (msg.from != null && msg.from === self)) return null;
    if (msg.want) { await advertiseAll(); return { outcome: "served-want" }; }
    if (!msg.app || !msg.bundle) return null;
    let res = null; try { res = await openShared(msg.bundle); } catch (e) {}   // verify-before-trust
    if (!res || !res.ok || res.state == null) return { outcome: "rejected" };
    const j = sj(res.state); if (seen.get(msg.app) === j) return { outcome: "already-have" };   // echo guard
    seen.set(msg.app, j);
    try { applyAdopted && applyAdopted(msg.app, res.state); } catch (e) {}     // refresh the LIVE frame
    try { const host = await getActiveHost(); if (host) await host.workspace(msg.app).adopt(msg.bundle.entries); } catch (e) {}   // durable (cross-device)
    return { outcome: "applied" };
  }

  return { advertiseAll, onMessage, _seen: seen };
}

// mountRoamToggle(anchor, { getActiveHost, getOpenApps, applyAdopted, name }) — insert the ⇄ Roam pill and
// wire it to a BroadcastChannel. Idempotent + fail-soft. Exposes window.__holoRoam.advertiseAll() so the
// shell's save tick can push changes. Returns the toggle element.
export function mountRoamToggle(strip, { getActiveHost, getOpenApps, applyAdopted, name = "holo-workspace-roam" } = {}) {
  if (typeof document === "undefined" || !strip || document.getElementById("roam-toggle")) return null;
  if (typeof BroadcastChannel === "undefined") return null;
  injectStyles();
  const btn = document.createElement("button");
  btn.id = "roam-toggle"; btn.className = "roam-pill"; btn.type = "button";
  btn.title = "Show your open windows on your other tabs";   // demoted: a quiet icon, not a dev toggle (S4 makes it automatic)
  btn.innerHTML = `<span class="roam-ic">⇄</span>`;
  const pill = document.getElementById("wks-switch");                  // sit just right of the workspace pill
  if (pill) pill.insertAdjacentElement("afterend", btn); else strip.insertBefore(btn, strip.firstChild);

  const self = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : String(Date.parse ? (new Date(0)).getTime() + Object.keys({}).length : 0);
  let bc = null, mirror = null, on = false;
  const openShared = async (bundle) => { try { const WS = await import("./holo-workspace-share.mjs"); return WS.openSharedWorkspace(bundle); } catch (e) { return null; } };

  async function enable() {
    bc = new BroadcastChannel(name);
    mirror = makeRoamMirror({ self, getActiveHost, getOpenApps, applyAdopted, openShared, post: (m) => { try { bc.postMessage(m); } catch (e) {} } });
    bc.onmessage = (e) => { mirror.onMessage(e.data); };
    window.__holoRoam = { advertiseAll: () => mirror.advertiseAll(), enabled: () => on };
    on = true; btn.classList.add("on");
    try { bc.postMessage({ from: self, want: true }); } catch (e) {}   // ask peers for their current windows
    await mirror.advertiseAll();                                        // and offer ours
  }
  function disable() { on = false; btn.classList.remove("on"); try { bc && bc.close(); } catch (e) {} bc = null; mirror = null; window.__holoRoam = { advertiseAll: () => {}, enabled: () => false }; }

  window.__holoRoam = { advertiseAll: () => {}, enabled: () => false };   // safe default before first enable
  btn.addEventListener("click", () => { on ? disable() : enable(); });
  return btn;
}

function injectStyles() {
  if (typeof document === "undefined" || document.getElementById("roam-styles")) return;
  const s = document.createElement("style"); s.id = "roam-styles";
  s.textContent = `
  .roam-pill{flex:0 0 auto;display:flex;align-items:center;gap:6px;align-self:center;height:28px;margin:0 4px;padding:0 10px;border:0;border-radius:8px;cursor:pointer;
    background:color-mix(in srgb,var(--holo-ink,#e8eef9) 9%,transparent);color:color-mix(in srgb,var(--holo-ink,#e8eef9) 70%,transparent);font:600 12px var(--holo-font-sans,system-ui)}
  .roam-pill:hover{background:color-mix(in srgb,var(--holo-ink,#e8eef9) 15%,transparent);color:var(--holo-ink,#e8eef9)}
  .roam-pill .roam-ic{font-size:13px}
  .roam-pill.on{background:color-mix(in srgb,var(--holo-accent,#5b8cff) 24%,transparent);color:var(--holo-ink,#e8eef9);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--holo-accent,#5b8cff) 55%,transparent)}
  .roam-pill.on .roam-ic{color:var(--holo-accent,#7aa2ff);animation:roam-pulse 1.6s ease-in-out infinite}
  @keyframes roam-pulse{0%,100%{opacity:.6}50%{opacity:1}}`;
  document.head.appendChild(s);
}

if (typeof window !== "undefined") window.HoloRoamUI = { mountRoamToggle, makeRoamMirror };
export default { mountRoamToggle, makeRoamMirror };
