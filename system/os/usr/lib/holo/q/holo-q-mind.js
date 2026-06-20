// holo-q-mind.js — the MIND view: Q revealing which minds it runs, glance-first. The visual mirror of the
// conversational steer (holo-q-model-steer) — same registry (holo-q-mux), same writes, two doors. Lives on
// Q's identity surface, not in a settings app: this is "who Q is right now", not a knob panel. Design law:
// abstract complexity, deliver simplicity — one honest line by default, the per-faculty grid only on demand.
//
//   mountMind(el, { mux, bridge, steer, onSpeak? }) → { refresh, destroy }
// Deps are injected (the shell passes the live mux/bridge/steer; a demo/witness passes the same modules), so
// the component is pure UI over the registry and can be verified outside the shell. DOM + OS --holo-* tokens.

const CORE = [
  ["respond", "Respond", "Chat & reasoning"],
  ["listen",  "Listen",  "Speech → text"],
  ["speak",   "Speak",   "Text → speech"],
  ["code",    "Code",    "Agentic coding"],
];
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const CSS = `
.qmind{font:13px/1.5 var(--holo-font,system-ui,sans-serif);color:var(--holo-fg,#e8e8ef);--ok:var(--holo-accent,#6ea8fe)}
.qmind .glance{display:flex;align-items:center;gap:.6em;padding:.5em 0}
.qmind .dot{width:.6em;height:.6em;border-radius:50%;background:var(--ok);box-shadow:0 0 .5em var(--ok);flex:0 0 auto}
.qmind .glance .lead{font-weight:600}
.qmind .glance .sub{opacity:.62}
.qmind .toggle{margin-left:auto;background:none;border:1px solid var(--holo-line,#ffffff22);color:inherit;border-radius:999px;padding:.18em .7em;cursor:pointer;font:inherit;opacity:.8}
.qmind .toggle:hover{opacity:1;border-color:var(--ok)}
.qmind .body{display:none;margin-top:.4em;border-top:1px solid var(--holo-line,#ffffff14);padding-top:.6em}
.qmind.open .body{display:block}
.qmind .row{display:flex;align-items:center;gap:.7em;padding:.5em 0;border-bottom:1px solid var(--holo-line,#ffffff0d)}
.qmind .row:last-child{border-bottom:0}
.qmind .row .name{font-weight:600;min-width:5.2em}
.qmind .row .job{opacity:.55;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qmind .badge{font-size:.85em;padding:.1em .55em;border-radius:.5em;background:var(--holo-chip,#ffffff12);white-space:nowrap}
.qmind .badge.you{background:color-mix(in srgb,var(--ok) 28%,transparent)}
.qmind select{font:inherit;color:inherit;background:var(--holo-chip,#ffffff12);border:1px solid var(--holo-line,#ffffff22);border-radius:.5em;padding:.12em .3em;cursor:pointer}
.qmind .ask{display:flex;gap:.5em;margin-top:.7em}
.qmind .ask input{flex:1;font:inherit;color:inherit;background:var(--holo-chip,#ffffff0d);border:1px solid var(--holo-line,#ffffff22);border-radius:.6em;padding:.4em .7em}
.qmind .ask input::placeholder{opacity:.5}
.qmind .say{margin-top:.5em;opacity:.85;min-height:1.2em;font-style:italic}
.qmind .helpers{margin-top:.7em;opacity:.6;font-size:.92em}
`;

export function mountMind(el, deps) {
  const { mux, bridge, steer, onSpeak } = deps || {};
  if (!el || !mux || !bridge) throw new Error("mountMind needs (el, {mux, bridge, steer})");
  if (!document.getElementById("qmind-css")) { const s = document.createElement("style"); s.id = "qmind-css"; s.textContent = CSS; document.head.appendChild(s); }
  const wrap = document.createElement("div"); wrap.className = "qmind"; el.appendChild(wrap);
  let open = false, lastSay = "";

  function current(faculty) { const r = mux.resolveModel(faculty); return { id: r.source === "pinned" ? r.spec.instant.id : r.id, you: r.source === "override" }; }

  function coreRow([id, name, job]) {
    const cur = current(id), tiers = bridge.tiersFor(id);
    const opts = [`<option value="__auto__">Auto</option>`].concat(tiers.map((t) =>
      `<option value="${esc(t.id)}"${!cur.you && false ? "" : (cur.you && cur.id === t.id ? " selected" : "")}>${esc(t.id)}${t.tier === "upgrade" ? " · best" : ""}</option>`));
    if (!cur.you) opts[0] = `<option value="__auto__" selected>Auto</option>`;
    const sel = tiers.length > 1 || (tiers.length === 1 && cur.you)
      ? `<select data-fac="${esc(id)}">${opts.join("")}</select>`
      : `<span class="badge">on-device</span>`;
    return `<div class="row"><span class="name">${esc(name)}</span><span class="job">${esc(job)}</span>`
      + `<span class="badge${cur.you ? " you" : ""}">${esc(cur.id)}${cur.you ? " · you chose" : " · auto"}</span>${sel}</div>`;
  }

  function render() {
    const helpers = mux.describeMux().tasks.filter((t) => !t.pinned && !t.deterministic).map((t) => t.id);
    wrap.innerHTML =
      `<div class="glance"><span class="dot"></span>`
      + `<span><span class="lead">Q runs on your device</span><span class="sub">, picking the best mind per task. Private.</span></span>`
      + `<button class="toggle">${open ? "Hide" : "Faculties ›"}</button></div>`
      + `<div class="body">${CORE.map(coreRow).join("")}`
      + `<div class="helpers">+ ${helpers.length} helper skills (${esc(helpers.slice(0, 4).join(", "))}…), auto-managed by Q.</div>`
      + (steer ? `<div class="ask"><input type="text" placeholder="Tell Q in plain words: “use a bigger brain for coding”"></div><div class="say">${esc(lastSay)}</div>` : "")
      + `</div>`;
    wrap.classList.toggle("open", open);
    wrap.querySelector(".toggle").onclick = () => { open = !open; render(); };
    wrap.querySelectorAll("select[data-fac]").forEach((s) => { s.onchange = () => onChange(s.getAttribute("data-fac"), s.value); });
    const ask = wrap.querySelector(".ask input");
    if (ask) { ask.onkeydown = (e) => { if (e.key === "Enter") onAsk(ask.value); }; if (lastSay) setTimeout(() => ask.focus(), 0); }
  }

  function onChange(faculty, value) {
    if (value === "__auto__") mux.bindSpecialist(faculty, null);
    else { const spec = bridge.specById(value); if (spec) mux.bindSpecialist(faculty, { id: value, faculty, source: "user", kappa: spec.kappa }); }
    lastSay = value === "__auto__" ? `${faculty} → auto.` : `${faculty} → ${value}.`;
    if (onSpeak) onSpeak(lastSay);
    render();
  }
  function onAsk(text) {
    if (!steer) return; const r = steer(text, { mux, bridge });
    lastSay = r.handled ? (r.say || "") : "That's not a model change. Ask Q normally.";
    if (onSpeak && r.handled) onSpeak(lastSay);
    render();
  }

  render();
  return { refresh: render, destroy: () => { wrap.remove(); } };
}

if (typeof window !== "undefined") window.HoloQMind = { mountMind };
export default { mountMind };
