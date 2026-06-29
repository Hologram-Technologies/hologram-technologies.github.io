// holo-roam-choose.mjs — the ONE-TAP divergence chooser for Session Roam (P4). When your session diverged
// (both devices changed while apart), roam never auto-clobbers — it surfaces a quiet banner letting you OPEN
// the other device's session or keep what you have. No jargon (no κ/sync/manifest), one decision, dismissible.
// Self-contained DOM + scoped style (same pattern as holo-lock-ui). See [[holo-session-roam]].

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let _cssDone = false;
function injectStyle() {
  if (_cssDone || (typeof document !== "undefined" && document.getElementById("holo-roam-css"))) { _cssDone = true; return; }
  _cssDone = true;
  const s = document.createElement("style");
  s.id = "holo-roam-css";
  s.textContent = `
  .holo-roam-banner{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(8px);z-index:2147482000;
    display:flex;align-items:center;gap:14px;padding:12px 14px 12px 18px;border-radius:14px;opacity:0;
    font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:#f4f7fc;background:rgba(22,26,38,.92);
    border:1px solid rgba(125,239,201,.28);box-shadow:0 18px 50px rgba(0,0,0,.5);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);
    animation:holoRoamIn .22s cubic-bezier(.4,0,.2,1) forwards;}
  @keyframes holoRoamIn{to{opacity:1;transform:translateX(-50%) translateY(0);}}
  .holo-roam-banner.out{animation:holoRoamOut .16s ease forwards;} @keyframes holoRoamOut{to{opacity:0;transform:translateX(-50%) translateY(8px);}}
  .holo-roam-banner .hrb-msg{font-size:.95rem;}
  .holo-roam-banner .hrb-go{border:0;border-radius:9px;cursor:pointer;font:inherit;font-weight:600;padding:8px 16px;color:#06140f;background:linear-gradient(135deg,#7defc9,#34d3a6);}
  .holo-roam-banner .hrb-go:hover{filter:brightness(1.05);}
  .holo-roam-banner .hrb-x{border:0;background:none;color:rgba(231,237,250,.8);font:inherit;cursor:pointer;padding:8px 10px;border-radius:9px;}
  .holo-roam-banner .hrb-x:hover{color:#fff;}
  @media (prefers-reduced-motion:reduce){.holo-roam-banner,.holo-roam-banner.out{animation:none;opacity:1;}}
  `;
  document.head.appendChild(s);
}

// offerRoamResume({ label, onResume, onDismiss }) → close(). Quiet banner; OPEN resumes the other device's
// session, "Not now" keeps the current one. Single instance (a new offer replaces any pending one).
export function offerRoamResume({ label, onResume, onDismiss } = {}) {
  if (typeof document === "undefined") return () => {};
  injectStyle();
  try { const ex = document.getElementById("holo-roam-banner"); if (ex) ex.remove(); } catch (e) {}
  const el = document.createElement("div");
  el.id = "holo-roam-banner"; el.className = "holo-roam-banner";
  el.setAttribute("role", "status");
  el.innerHTML = `<span class="hrb-msg">Your session from ${esc(label || "another device")} is ready</span>
    <button class="hrb-go" id="hrb-go">Open</button><button class="hrb-x" id="hrb-x">Not now</button>`;
  const close = () => { try { el.classList.add("out"); } catch (e) {} const go = () => { try { el.remove(); } catch (e) {} }; let f = false; const once = () => { if (f) return; f = true; go(); }; try { el.addEventListener("animationend", once, { once: true }); } catch (e) {} setTimeout(once, 200); };
  el.querySelector("#hrb-go").onclick = () => { close(); try { onResume && onResume(); } catch (e) {} };
  el.querySelector("#hrb-x").onclick = () => { close(); try { onDismiss && onDismiss(); } catch (e) {} };
  document.body.appendChild(el);
  return close;
}

export default { offerRoamResume };
