// holo-mail-onboard-ui.mjs - the onboarding SURFACE. One calm screen: type your address, we recognize the
// provider and show the exact steps + a deep link, you paste the app-password, and the inbox connects with a
// live backfill bar. Self-contained, hm-onb-prefixed/root-scoped so it drops into the messenger safely.
//   mountOnboard(root, { onboarding, onLinked, foot }) - onboarding = holo-mail-onboard.makeOnboarding(...)

const CSS = `
.hm-onb{--bg:#f6f7f9;--panel:#fff;--ink:#0d1117;--muted:#5b6472;--faint:#8b93a1;--line:#e7e9ee;--accent:#3b6ef5;--accent-soft:#eaf0ff;--ok:#0e9f6e;--err:#e6462e;--shadow:0 1px 2px rgba(13,17,23,.05),0 10px 30px rgba(13,17,23,.08);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;color:var(--ink);height:100%;width:100%;display:grid;place-items:center;background:var(--bg);padding:24px}
@media (prefers-color-scheme:dark){.hm-onb{--bg:#0b0d10;--panel:#131720;--ink:#e9edf3;--muted:#9aa4b2;--faint:#6b7482;--line:#232a35;--accent:#5b86ff;--accent-soft:#182238;--shadow:0 1px 2px rgba(0,0,0,.4),0 12px 34px rgba(0,0,0,.4)}}
.hm-onb *{box-sizing:border-box}
.hm-onb .card{width:min(440px,100%);background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:26px 24px}
.hm-onb .logo{width:40px;height:40px;border-radius:11px;background:linear-gradient(135deg,var(--accent),#8a4fd6);margin:0 auto 14px;box-shadow:var(--shadow)}
.hm-onb h1{margin:0 0 4px;font-size:19px;letter-spacing:-.02em;text-align:center}
.hm-onb .sub{margin:0 0 20px;color:var(--muted);text-align:center;font-size:13px}
.hm-onb label{display:block;font-size:12px;color:var(--muted);margin:0 0 5px;font-weight:600}
.hm-onb input{width:100%;border:1px solid var(--line);border-radius:10px;padding:11px 13px;font:inherit;background:var(--bg);color:var(--ink);outline:none}
.hm-onb input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.hm-onb .field{margin-bottom:14px}
.hm-onb .prov{display:flex;align-items:center;gap:8px;margin:-6px 0 14px;font-size:12.5px;color:var(--muted)}
.hm-onb .prov b{color:var(--ink)}
.hm-onb .dot{width:8px;height:8px;border-radius:50%;background:var(--ok)}
.hm-onb .steps{list-style:none;margin:0 0 12px;padding:12px 14px;background:var(--bg);border:1px solid var(--line);border-radius:10px;font-size:12.5px;color:var(--muted);counter-reset:s}
.hm-onb .steps li{position:relative;padding:3px 0 3px 24px;counter-increment:s}
.hm-onb .steps li::before{content:counter(s);position:absolute;left:0;top:3px;width:17px;height:17px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-weight:700;font-size:10.5px;display:grid;place-items:center}
.hm-onb .hosts{display:none;gap:8px}.hm-onb .hosts.on{display:grid;grid-template-columns:1fr 84px;margin-bottom:14px}
.hm-onb .row2{display:grid;grid-template-columns:1fr 84px;gap:8px}
.hm-onb .btn{width:100%;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:10px;padding:11px;font:inherit;font-weight:650;cursor:pointer}
.hm-onb .btn.pri{background:var(--accent);border-color:var(--accent);color:#fff;margin-top:4px}
.hm-onb .btn.pri:disabled{opacity:.5;cursor:default}
.hm-onb .btn.link{background:transparent;border-style:dashed;color:var(--accent);margin-bottom:12px;font-weight:600}
.hm-onb .err{margin-top:12px;padding:10px 12px;border-radius:10px;background:#fdecea;color:var(--err);font-size:12.5px}
.hm-onb .err b{display:block}
@media (prefers-color-scheme:dark){.hm-onb .err{background:#3a201c}}
.hm-onb .prog{margin-top:16px;text-align:center;color:var(--muted);font-size:13px}
.hm-onb .bar{height:6px;border-radius:20px;background:var(--bg);overflow:hidden;margin-top:10px;border:1px solid var(--line)}
.hm-onb .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--accent),#8a4fd6);transition:width .4s}
.hm-onb .foot{margin-top:18px;text-align:center;color:var(--faint);font-size:11px}
`;

function injectCSS() {
  if (typeof document === "undefined" || document.getElementById("hm-onb-css")) return;
  const s = document.createElement("style"); s.id = "hm-onb-css"; s.textContent = CSS; document.head.appendChild(s);
}
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function mountOnboard(root, { onboarding, onLinked, foot = "Your credentials never leave this device." } = {}) {
  injectCSS();
  root.className = "hm-onb";
  root.innerHTML = `<div class="card">
    <div class="logo"></div>
    <h1>Connect your email</h1>
    <p class="sub">Any provider. It just connects, and stays on your device.</p>
    <div class="field"><label>Email address</label><input class="hm-email" type="email" inputmode="email" placeholder="you@example.com" autofocus /></div>
    <div class="hm-detail"></div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const email = $(".hm-email");
  const detail = $(".hm-detail");
  let guide = null;

  function renderDetail() {
    const g = onboarding.guide(email.value);
    guide = g && g.valid ? g : null;
    if (!guide) { detail.innerHTML = `<button class="btn pri" disabled>Continue</button>`; return; }

    if (guide.auth === "oauth") {
      detail.innerHTML = `
        <div class="prov"><span class="dot"></span>Recognized <b>${esc(guide.name)}</b></div>
        <ul class="steps">${guide.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
        <button class="btn pri hm-oauth">Sign in with ${esc(guide.name)}</button>`;
      $(".hm-oauth").onclick = () => flashErr("Secure sign-in is coming next", `We're finishing secure sign-in for ${esc(guide.name)}.`);
      return;
    }

    detail.innerHTML = `
      <div class="prov"><span class="dot"></span>Recognized <b>${esc(guide.name)}</b></div>
      <ul class="steps">${guide.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      ${guide.appPwUrl ? `<button class="btn link hm-open">Open ${esc(guide.name)} app-passwords ↗</button>` : ""}
      <div class="field"><label>App-password</label><input class="hm-pw" type="password" placeholder="paste it here" /></div>
      <div class="hosts ${guide.needsHostFields ? "on" : ""}">
        ${guide.needsHostFields ? `<input class="hm-imaph" placeholder="imap.host" /><input class="hm-imapp" placeholder="993" />` : ""}
      </div>
      <button class="btn pri hm-connect" disabled>Connect</button>
      <div class="hm-msg"></div>`;
    if (guide.appPwUrl) $(".hm-open").onclick = () => { try { window.open(guide.appPwUrl, "_blank", "noopener"); } catch {} };
    const pw = $(".hm-pw"), btn = $(".hm-connect");
    pw.addEventListener("input", () => { btn.disabled = !pw.value.trim(); });
    pw.addEventListener("keydown", (e) => { if (e.key === "Enter" && pw.value.trim()) doConnect(); });
    btn.onclick = doConnect;
  }

  function flashErr(reason, fix) {
    const box = $(".hm-msg") || detail;
    box.innerHTML = `<div class="err"><b>${esc(reason)}</b>${esc(fix || "")}</div>`;
  }

  async function doConnect() {
    const pw = $(".hm-pw"); if (!pw) return;
    const args = { email: email.value.trim(), password: pw.value.trim() };
    if (guide.needsHostFields) { const h = $(".hm-imaph"), p = $(".hm-imapp"); if (h && h.value) args.imapHost = h.value.trim(); if (p && p.value) args.imapPort = p.value.trim(); }
    detail.innerHTML = `<div class="prog">Connecting to <b>${esc(guide.name)}</b>…<div class="bar"><i class="hm-i"></i></div></div>`;
    const r = await onboarding.connect(args);
    if (!r.ok) { renderDetail(); flashErr(r.reason, r.fix); const pw2 = $(".hm-pw"); if (pw2) pw2.value = args.password; return; }
    // linked → show backfill, then hand off
    const bar = $(".hm-i");
    const res = await onboarding.waitLinked({ onProgress: (p) => { if (bar) bar.style.width = Math.max(4, p) + "%"; } });
    if (bar) bar.style.width = "100%";
    if (res.linked && onLinked) { try { onLinked(res); } catch {} }
    else if (!res.linked) { renderDetail(); flashErr("Still connecting…", "Your inbox is syncing. This can take a moment on first connect."); }
  }

  email.addEventListener("input", renderDetail);
  renderDetail();
  // append foot once
  const f = document.createElement("div"); f.className = "foot"; f.innerHTML = foot; root.querySelector(".card").appendChild(f);
  return { destroy() { root.innerHTML = ""; root.className = ""; } };
}

export default { mountOnboard };
