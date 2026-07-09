// holo-mail-ui.mjs - the Intelligent Inbox SURFACE, as one reusable mount. Both the demo and the in-app
// overlay call mountMailUI(root, { engine, source }). All classes are hm-prefixed and root-scoped so it can
// drop into the messenger without colliding with its styles. The engine (holo-mail-engine) supplies the
// intelligence; `source` supplies the raw threads. No model, no network here.
//
//   source: { ids(): string[],  meta(jid): { who, subj, msgs:[{fromMe,fromName,from,date,text}] } }
//   engine: { prime(), enrich(jid), draftFor(jid) }
//   opts:   { onSend(jid,text), now, foot, defaultLane }

const HM_CSS = `
.hm-root{--bg:#f6f7f9;--panel:#fff;--ink:#0d1117;--muted:#5b6472;--faint:#8b93a1;--line:#e7e9ee;--accent:#3b6ef5;--accent-soft:#eaf0ff;--toreply:#e6462e;--awaiting:#b8860b;--fyi:#5b6472;--cold:#8a4fd6;--team:#0e9f6e;--shadow:0 1px 2px rgba(13,17,23,.05),0 8px 24px rgba(13,17,23,.06);--r:12px;
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;color:var(--ink);height:100%;width:100%}
@media (prefers-color-scheme:dark){.hm-root{--bg:#0b0d10;--panel:#131720;--ink:#e9edf3;--muted:#9aa4b2;--faint:#6b7482;--line:#232a35;--accent:#5b86ff;--accent-soft:#182238;--shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.35)}}
.hm-root *{box-sizing:border-box}
.hm-app{display:grid;grid-template-columns:220px minmax(300px,400px) minmax(0,1fr);height:100%;width:100%;max-width:100%;overflow:hidden;background:var(--bg)}
.hm-side,.hm-list,.hm-read{min-width:0;min-height:0}
.hm-side{border-right:1px solid var(--line);padding:14px 10px;display:flex;flex-direction:column;gap:2px;background:var(--panel)}
.hm-brand{display:flex;align-items:center;gap:9px;padding:6px 8px 14px;font-weight:650;letter-spacing:-.01em}
.hm-dot{width:22px;height:22px;border-radius:7px;background:linear-gradient(135deg,var(--accent),#8a4fd6);box-shadow:var(--shadow)}
.hm-lane{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;color:var(--muted);cursor:pointer;user-select:none}
.hm-lane:hover{background:var(--bg)}
.hm-lane.on{background:var(--accent-soft);color:var(--ink);font-weight:600}
.hm-lane .ic{width:16px;text-align:center}
.hm-lane .ct{margin-left:auto;font-size:12px;color:var(--faint);background:var(--bg);border-radius:20px;padding:1px 8px;min-width:22px;text-align:center}
.hm-foot{margin-top:auto;padding:8px;color:var(--faint);font-size:11px;line-height:1.4}
.hm-list{border-right:1px solid var(--line);overflow-y:auto;overflow-x:hidden;background:var(--panel)}
.hm-h2{position:sticky;top:0;background:var(--panel);margin:0;padding:15px 16px 11px;font-size:15px;letter-spacing:-.01em;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px}
.hm-h2 .k{margin-left:auto;font-size:11px;color:var(--faint);border:1px solid var(--line);border-radius:6px;padding:2px 6px}
.hm-row{display:grid;grid-template-columns:34px minmax(0,1fr);gap:11px;padding:12px 16px;border-bottom:1px solid var(--line);cursor:pointer}
.hm-row>div{min-width:0}
.hm-row:hover{background:var(--bg)}
.hm-row.sel{background:var(--accent-soft)}
.hm-row.gone{opacity:0;transform:translateX(8px);transition:all .18s}
.hm-av{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:650;font-size:13px;position:relative;overflow:hidden}
.hm-av-face{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .18s ease;background:inherit}
.hm-av-face.holo-face{opacity:1}
.hm-top{display:flex;align-items:baseline;gap:8px}
.hm-who{font-weight:620;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hm-when{margin-left:auto;color:var(--faint);font-size:12px;white-space:nowrap}
.hm-subj{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.hm-sum{display:flex;align-items:center;gap:7px;margin-top:4px;color:var(--muted);font-size:12.5px}
.hm-sum .q{font-size:11px;color:var(--accent);flex:none}
.hm-sum .txt{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-style:italic}
.hm-chip{flex:none;font-size:10.5px;font-weight:700;letter-spacing:.02em;padding:2px 7px;border-radius:20px;white-space:nowrap;text-transform:uppercase}
.hm-chip.toreply{background:#fdece8;color:var(--toreply)}.hm-chip.awaiting{background:#fbf3e0;color:var(--awaiting)}
.hm-chip.fyi{background:var(--bg);color:var(--fyi)}.hm-chip.cold{background:#f2e9fb;color:var(--cold)}
@media (prefers-color-scheme:dark){.hm-chip.toreply{background:#3a201c}.hm-chip.awaiting{background:#332a12}.hm-chip.cold{background:#2a1f3d}}
.hm-read{overflow:auto;padding:0;background:var(--bg)}
.hm-hd{position:sticky;top:0;background:var(--bg);padding:18px 26px 14px;border-bottom:1px solid var(--line)}
.hm-hd h1{margin:0 0 8px;font-size:19px;letter-spacing:-.02em}
.hm-qsum{display:flex;gap:9px;align-items:flex-start;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 13px;color:var(--muted);box-shadow:var(--shadow)}
.hm-qsum .q{color:var(--accent);font-weight:700;font-size:12px;margin-top:1px}
.hm-msg{padding:16px 26px;border-bottom:1px solid var(--line)}
.hm-mhd{display:flex;align-items:center;gap:9px;margin-bottom:6px}
.hm-mhd .nm{font-weight:620}.hm-mhd .ad{color:var(--faint);font-size:12px}.hm-mhd .tm{margin-left:auto;color:var(--faint);font-size:12px}
.hm-body{white-space:pre-wrap}
.hm-draft{margin:18px 26px 32px;border:1px solid var(--accent);border-radius:var(--r);overflow:hidden;box-shadow:var(--shadow);background:var(--panel)}
.hm-dhd{display:flex;align-items:center;gap:8px;padding:9px 13px;background:var(--accent-soft);color:var(--accent);font-weight:650;font-size:12.5px}
.hm-dhd .sp{margin-left:auto;font-weight:500;color:var(--muted);font-size:11.5px}
.hm-draft textarea{width:100%;border:0;outline:0;resize:vertical;min-height:104px;padding:14px;font:inherit;color:var(--ink);background:transparent}
.hm-dft{display:flex;gap:8px;padding:10px 13px;border-top:1px solid var(--line)}
.hm-btn{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:8px;padding:7px 13px;font:inherit;font-weight:600;cursor:pointer}
.hm-btn.pri{background:var(--accent);border-color:var(--accent);color:#fff}
.hm-btn .kk{opacity:.6;font-weight:500;margin-left:6px;font-size:12px}
.hm-empty{height:100%;display:grid;place-items:center;color:var(--faint)}
.hm-empty .box{text-align:center;line-height:1.5}
.hm-empty .ei{font-size:34px;color:var(--accent);opacity:.45;margin-bottom:8px}
.hm-empty .et{font-size:15px;color:var(--muted);font-weight:600}
.hm-empty .eh{font-size:12.5px;margin-top:4px}.hm-empty .eh b{color:var(--muted)}
.hm-scrim{position:fixed;inset:0;background:rgba(6,9,14,.42);display:none;align-items:flex-start;justify-content:center;padding-top:14vh;z-index:2147483000}
.hm-scrim.on{display:flex}
.hm-pal{width:min(560px,92vw);background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);overflow:hidden}
.hm-pal input{width:100%;border:0;outline:0;padding:16px 18px;font:inherit;font-size:16px;background:transparent;color:var(--ink);border-bottom:1px solid var(--line)}
.hm-opt{display:flex;align-items:center;gap:11px;padding:11px 18px;cursor:pointer;color:var(--ink)}
.hm-opt.hi,.hm-opt:hover{background:var(--accent-soft)}
.hm-opt .kk{margin-left:auto;color:var(--faint);font-size:12px;border:1px solid var(--line);border-radius:6px;padding:1px 6px}
.hm-back{display:none}
@media (max-width:900px){
  .hm-app{grid-template-columns:1fr}
  .hm-side{display:none}
  .hm-read{display:none;position:absolute;inset:0;z-index:5}
  .hm-root.reading .hm-list{display:none}
  .hm-root.reading .hm-read{display:block}
  .hm-back{display:inline-flex;align-items:center;gap:6px;margin:12px 0 0 16px;color:var(--accent);cursor:pointer;font-weight:600}
}`;

const LANES = [["important","Important","✦"],["reply","Reply","↩"],["team","Team","◎"],["news","News","≋"],["cold","Cold","✳"]];
const AVCOL = ["#3b6ef5","#0e9f6e","#e6462e","#8a4fd6","#b8860b","#0891b2"];
const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const initials = (n) => (n || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

// Living faces: the shared OS resolver turns a sender email → the company logo (brand address) or
// the person's photo (personal address). Loaded lazily + defensively so the inbox renders exactly as
// before if the lib isn't served (e.g. a standalone demo harness) - the initials stay as the fallback.
let _faceLib = null;
function faceLib() { if (!_faceLib) _faceLib = import("../../../usr/lib/holo/holo-face.mjs").then((m) => m.default || m).catch(() => null); return _faceLib; }
const senderEmailOf = (v) => { const s = ((v && v.meta && v.meta.msgs) || []).find((m) => !m.fromMe) || {}; return s.from || ""; };

function injectCSS() {
  if (typeof document === "undefined" || document.getElementById("hm-ui-css")) return;
  const s = document.createElement("style"); s.id = "hm-ui-css"; s.textContent = HM_CSS; document.head.appendChild(s);
}

export function mountMailUI(root, { engine, source, onSend = null, now = () => new Date(), foot = "On-device Q · sovereign κ", defaultLane = "reply" } = {}) {
  injectCSS();
  root.classList.add("hm-root");
  root.innerHTML = `
    <div class="hm-app">
      <nav class="hm-side"><div class="hm-brand"><span class="hm-dot"></span> Holo Mail</div><div class="hm-lanes"></div><div class="hm-foot">${foot}</div></nav>
      <section class="hm-list"><h2 class="hm-h2"><span class="hm-title">Reply</span> <span class="k">⌘K</span></h2><div class="hm-rows"></div></section>
      <main class="hm-read"><div class="hm-empty"></div></main>
    </div>
    <div class="hm-scrim"><div class="hm-pal"><input class="hm-palin" placeholder="Type a command…  (reply, archive, switch lane)" /><div class="hm-pallist"></div></div></div>`;
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const state = { lane: defaultLane, sel: null, model: new Map(), archived: new Set() };

  const fmtTime = (d) => { const dt = new Date(d), n = now(); return (n - dt < 864e5) ? dt.toTimeString().slice(0, 5) : dt.toISOString().slice(5, 10); };
  const laneCount = (lane) => [...state.model.values()].filter((v) => !state.archived.has(v.id) && v.e.lane === lane).length;

  function renderLanes() {
    $(".hm-lanes").innerHTML = LANES.map(([id, label, ic]) =>
      `<div class="hm-lane${id === state.lane ? " on" : ""}" data-lane="${id}"><span class="ic">${ic}</span>${label}<span class="ct">${laneCount(id)}</span></div>`).join("");
    $$(".hm-lane").forEach((el) => el.onclick = () => selectLane(el.dataset.lane));
  }
  function showEmpty(txt) {
    $(".hm-read").innerHTML = `<div class="hm-empty"><div class="box"><div class="ei">✦</div><div class="et">${esc(txt || "You're all caught up")}</div><div class="eh">Select a conversation · <b>⌘K</b> for commands</div></div></div>`;
  }
  function selectLane(lane) {
    state.lane = lane; $(".hm-title").textContent = LANES.find((l) => l[0] === lane)[1];
    renderLanes(); renderList();
    if (window.innerWidth > 900) { const first = $(".hm-row"); if (first) openThread(first.dataset.id); else showEmpty("Nothing here. Inbox zero"); }
  }
  function renderList() {
    const items = [...state.model.values()].filter((v) => !state.archived.has(v.id) && v.e.lane === state.lane)
      .sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate));
    const rows = $(".hm-rows");
    if (!items.length) { rows.innerHTML = `<div class="hm-empty" style="height:200px">Nothing here. Inbox zero ✨</div>`; return; }
    rows.innerHTML = items.map((v, i) => {
      const c = v.e.cold ? ["cold", "Cold"] : v.e.status === "TO_REPLY" ? ["toreply", "Reply"] : v.e.status === "AWAITING_REPLY" ? ["awaiting", "Awaiting"] : ["fyi", "FYI"];
      return `<div class="hm-row${state.sel === v.id ? " sel" : ""}" data-id="${esc(v.id)}">
        <div class="hm-av" style="background:${AVCOL[i % AVCOL.length]}">${esc(initials(v.meta.who))}<img class="hm-av-face" alt="" loading="lazy"></div>
        <div><div class="hm-top"><span class="hm-who">${esc(v.meta.who)}</span><span class="hm-when">${fmtTime(v.lastDate)}</span></div>
        <div class="hm-subj">${esc(v.meta.subj)}</div>
        <div class="hm-sum"><span class="q">✦ Q</span><span class="txt">${esc(v.e.summary || "…")}</span><span class="hm-chip ${c[0]}">${c[1]}</span></div></div></div>`;
    }).join("");
    $$(".hm-row").forEach((el) => el.onclick = () => openThread(el.dataset.id));
    // Paint real brand logos / sender photos over the initials of THIS render pass (cache-first, so
    // a re-render is instant). Async and best-effort: a miss just leaves the initials showing.
    const rowEls = $$(".hm-row");
    faceLib().then((HF) => { if (!HF) return; items.forEach((v, i) => { const img = rowEls[i] && rowEls[i].querySelector(".hm-av-face"); if (img) HF.attachFace(img, { name: v.meta.who, email: senderEmailOf(v) }); }); });
  }
  async function openThread(id) {
    state.sel = id; root.classList.add("reading"); renderList();
    const v = state.model.get(id);
    $(".hm-read").innerHTML = `
      <div class="hm-hd"><span class="hm-back">‹ Inbox</span><h1>${esc(v.meta.subj)}</h1>
        <div class="hm-qsum"><span class="q">✦ Q</span><span>${esc(v.e.summary || "…")}</span></div></div>
      ${v.meta.msgs.map((m) => `<div class="hm-msg"><div class="hm-mhd"><span class="nm">${m.fromMe ? "You" : esc(m.fromName)}</span><span class="ad">${esc(m.from)}</span><span class="tm">${fmtTime(m.date)}</span></div><div class="hm-body">${esc(m.text)}</div></div>`).join("")}
      <div class="hm-slot"></div>`;
    $(".hm-back").onclick = () => root.classList.remove("reading");
    const d = await engine.draftFor(id);
    const slot = $(".hm-slot");
    if (d && d.text) {
      slot.innerHTML = `<div class="hm-draft"><div class="hm-dhd"><span>✦ Ready reply, in your voice</span><span class="sp">edit or send · ⌘↵</span></div>
        <textarea class="hm-dtext">${esc(d.text)}</textarea>
        <div class="hm-dft"><button class="hm-btn pri hm-send">Send<span class="kk">⌘↵</span></button><button class="hm-btn hm-arch">Archive<span class="kk">E</span></button></div></div>`;
      $(".hm-send").onclick = () => { const t = $(".hm-dtext").value; if (onSend) { try { onSend(id, t); } catch {} } toast("Sent ✓"); archive(id); };
      $(".hm-arch").onclick = () => archive(id);
    } else {
      slot.innerHTML = `<div style="margin:18px 26px;color:var(--faint)">No reply owed. You're all caught up on this thread.</div>`;
    }
  }
  function archive(id) {
    const el = $$(".hm-row").find((r) => r.dataset.id === id); if (el) el.classList.add("gone");
    setTimeout(() => { state.archived.add(id); state.sel = null; root.classList.remove("reading"); renderLanes(); renderList();
      if (window.innerWidth > 900) { const first = $(".hm-row"); if (first) openThread(first.dataset.id); else showEmpty(); } else showEmpty(); }, 160);
  }
  function toast(t) { const d = document.createElement("div"); d.textContent = t;
    d.style.cssText = "position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#0d1117;color:#fff;padding:9px 16px;border-radius:10px;z-index:2147483001;font-weight:600;font-family:inherit";
    document.body.appendChild(d); setTimeout(() => d.remove(), 1400); }

  // command palette
  const CMDS = LANES.map(([id, label]) => [`Go to ${label}`, `→ ${label}`, () => selectLane(id)])
    .concat([["Reply to selected", "R", () => { const ta = $(".hm-dtext"); if (ta) ta.focus(); }], ["Archive selected", "E", () => { if (state.sel) archive(state.sel); }]]);
  let palHi = 0;
  const scrim = $(".hm-scrim"), palin = $(".hm-palin");
  const palMatches = (q) => CMDS.filter((c) => c[0].toLowerCase().includes(q.toLowerCase()));
  function renderPal(q) { const m = palMatches(q); palHi = Math.max(0, Math.min(palHi, m.length - 1));
    $(".hm-pallist").innerHTML = m.map((c, i) => `<div class="hm-opt${i === palHi ? " hi" : ""}" data-i="${i}">${c[0]}<span class="kk">${c[1]}</span></div>`).join("");
    $$(".hm-opt").forEach((el) => el.onclick = () => { palMatches(palin.value)[+el.dataset.i][2](); closePal(); }); }
  const openPal = () => { scrim.classList.add("on"); palin.value = ""; palHi = 0; renderPal(""); palin.focus(); };
  const closePal = () => scrim.classList.remove("on");
  palin.addEventListener("input", (e) => renderPal(e.target.value));
  scrim.addEventListener("click", (e) => { if (e.target === scrim) closePal(); });

  function onKey(e) {
    if (!root.isConnected) return;
    const pal = scrim.classList.contains("on");
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); pal ? closePal() : openPal(); return; }
    if (pal) { const m = palMatches(palin.value);
      if (e.key === "ArrowDown") { e.preventDefault(); palHi = (palHi + 1) % m.length; renderPal(palin.value); }
      if (e.key === "ArrowUp") { e.preventDefault(); palHi = (palHi - 1 + m.length) % m.length; renderPal(palin.value); }
      if (e.key === "Enter" && m[palHi]) { m[palHi][2](); closePal(); }
      if (e.key === "Escape") closePal(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { const s = $(".hm-send"); if (s) { e.preventDefault(); s.click(); } return; }
    const tag = e.target.tagName; if (tag === "TEXTAREA" || tag === "INPUT") return;
    const rows = $$(".hm-row"), cur = rows.findIndex((r) => r.dataset.id === state.sel);
    if (e.key === "j") { e.preventDefault(); const n = rows[Math.min(rows.length - 1, cur + 1)]; if (n) openThread(n.dataset.id); }
    if (e.key === "k") { e.preventDefault(); const n = rows[Math.max(0, cur - 1)]; if (n) openThread(n.dataset.id); }
    if (e.key === "e" && state.sel) { e.preventDefault(); archive(state.sel); }
    if (e.key === "r") { const ta = $(".hm-dtext"); if (ta) { e.preventDefault(); ta.focus(); } }
  }
  document.addEventListener("keydown", onKey);

  async function boot() {
    try { await engine.prime(); } catch {}
    const ids = await source.ids();
    for (const id of ids) {
      let meta, e;
      try { meta = await source.meta(id); } catch { continue; }
      if (!meta || !meta.msgs || !meta.msgs.length) continue;
      try { e = await engine.enrich(id); } catch { e = null; }
      e = e || { summary: null, status: null, cold: false, category: null, lane: "important" };
      state.model.set(id, { id, meta, e, lastDate: meta.msgs[meta.msgs.length - 1].date });
    }
    renderLanes(); selectLane(state.lane);
  }
  boot();

  return { destroy() { document.removeEventListener("keydown", onKey); root.innerHTML = ""; root.classList.remove("hm-root", "reading"); }, refresh: boot };
}

export default { mountMailUI };
