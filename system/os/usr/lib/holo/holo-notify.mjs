// holo-notify.mjs — the ONE notification surface for Hologram OS: a quiet, obvious-but-not-intrusive
// toast that ALWAYS files itself into a persistent, openable Notification Center, and the home for Q's
// notes (read like Messages). It unifies the two ad-hoc surfaces that came before — the ephemeral
// #toast and the bespoke "Secure your account" banner — so every alert reads as one coherent piece.
//
//   holo.notify({ title, body?, actions?, sender?, severity?, deepLink?, icon?, transient?, sticky? })
//     → shows a transient toast AND (unless transient) records it durably + badges the bell.
//
// The Center is the shared right side-carriage (createAside — the same dock · slide · drag-resize the
// Create / Play / Share verbs wear), so it docks the canvas instead of overlaying it. History is
// per-operator and survives reload + re-sign-in: it lives on the same localStorage axis the OS already
// uses for per-operator UI state (holo.theme.v1, holo.aside.w …) — notifications are UI state, not
// substrate objects, so this is the honest, lightest durable store (no κ-seal abuse of the session
// manifest). Tokens + golden-ratio throughout; reduced-motion honored; sound is never used.
//
// Mount once from the shell:
//   import { mountNotifications } from "/_shared/holo-notify.mjs";
//   mountNotifications(document.getElementById("notif-btn"), { getOperator, onDeepLink });
// After mount, window.HoloNotify.{ notify, toast, q, open, close, markAllRead, clear, unread } is live.

import { createAside } from "./holo-aside.mjs";

const STORE_V = "holo.notify.v1.";          // per-operator key prefix
const CAP = 200;                            // keep the most recent N (history, not a log)
const SENDERS = ["Q", "Backup", "System"];  // canonical order; any other sender is appended as itself

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

// the κ-glyph alphabet — the OS's own braille marks; a short run shimmers on a freshly-filed item, the
// same visual vocabulary the boot/login screens speak, so an arrival reads as "sealed", not "popped".
const KAPPA_GLYPHS = "⠂⠁⠄⠆⠇⠋⠙⠸⠴⠦⠧⠿⡇⢸⣿";
const kappaRun = (n = 6) => { let s = ""; for (let i = 0; i < n; i++) s += KAPPA_GLYPHS[(i * 7 + n) % KAPPA_GLYPHS.length]; return s; };

function relTime(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  const m = s / 60; if (m < 60) return Math.round(m) + "m";
  const h = m / 60; if (h < 24) return Math.round(h) + "h";
  const d = h / 24; if (d < 7) return Math.round(d) + "d";
  try { return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return Math.round(d) + "d"; }
}

const ICON = { Q: "✶", Backup: "🔑", System: "◉" };
const sevIcon = (sev) => ({ ok: "✓", warn: "⚠", danger: "✕", info: "" }[sev] || "");

export function mountNotifications(bellEl, { getOperator = () => null, onDeepLink = () => {} } = {}) {
  injectStyles();

  // ── durable per-operator history ────────────────────────────────────────────────────────────────
  const opKey = () => { const op = getOperator() || ""; return STORE_V + (op ? op.split(":").pop().slice(0, 16) : "guest"); };
  let items = [];
  function load() { try { const r = JSON.parse(localStorage.getItem(opKey()) || "[]"); items = Array.isArray(r) ? r : []; } catch { items = []; } }
  let saveT = 0;
  function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(opKey(), JSON.stringify(items.slice(0, CAP))); } catch {} }, 200); }
  load();

  // ── the Center — the shared right side-carriage (createAside) ─────────────────────────────────────
  const aside = createAside({ id: "notify", title: "Notifications", defaultW: 420, minW: 360, maxW: 620 });
  aside.el.classList.add("hn-aside");
  const bellLogo = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
  const logoSlot = aside.el.querySelector(".ha-logo"); if (logoSlot) logoSlot.innerHTML = bellLogo;
  aside.body.innerHTML = `
    <div class="hn-bar">
      <div class="hn-filters" id="hn-filters"></div>
      <div class="hn-tools">
        <button class="hn-tool" type="button" data-act="read" title="Mark everything read">Mark read</button>
        <button class="hn-tool" type="button" data-act="clear" title="Clear the current view">Clear</button>
      </div>
    </div>
    <div class="hn-list" id="hn-list" role="list"></div>`;
  const listEl = aside.body.querySelector("#hn-list");
  const filtersEl = aside.body.querySelector("#hn-filters");
  let filter = "All";

  aside.body.querySelector(".hn-tools").addEventListener("click", (e) => {
    const act = e.target?.dataset?.act; if (!act) return;
    if (act === "read") markAllRead();
    else if (act === "clear") clear(filter === "All" ? null : filter);
  });

  // ── toast stack — bottom-centre, the transient FACE of a recorded notification ───────────────────
  let toastWrap = document.getElementById("hn-toasts");
  if (!toastWrap) { toastWrap = document.createElement("div"); toastWrap.id = "hn-toasts"; toastWrap.setAttribute("aria-live", "polite"); document.body.appendChild(toastWrap); }

  // ── bell badge ───────────────────────────────────────────────────────────────────────────────────
  let badge = bellEl && bellEl.querySelector(".hn-badge");
  if (bellEl && !badge) { badge = document.createElement("span"); badge.className = "hn-badge"; badge.hidden = true; bellEl.appendChild(badge); }
  const unread = () => items.reduce((n, r) => n + (r.read ? 0 : 1), 0);
  function refreshBadge(pulse) {
    const n = unread();
    if (badge) { badge.textContent = n > 99 ? "99+" : String(n); badge.hidden = n === 0; }
    if (bellEl) { bellEl.classList.toggle("has-unread", n > 0); if (pulse && !reduced()) { bellEl.classList.remove("ring"); void bellEl.offsetWidth; bellEl.classList.add("ring"); } }
  }
  if (bellEl) bellEl.addEventListener("click", () => aside.toggle());
  aside._aside && (aside._open = aside.open);

  // ── render ───────────────────────────────────────────────────────────────────────────────────────
  function presentSenders() {
    const set = new Set(items.map((r) => r.sender || "System"));
    const ordered = [...SENDERS.filter((s) => set.has(s)), ...[...set].filter((s) => !SENDERS.includes(s))];
    return ordered;
  }
  function renderFilters() {
    const senders = presentSenders();
    const chip = (name) => {
      const u = name === "All" ? unread() : items.reduce((n, r) => n + ((r.sender || "System") === name && !r.read ? 1 : 0), 0);
      return `<button class="hn-chip${filter === name ? " on" : ""}" type="button" data-f="${esc(name)}">${esc(name)}${u ? `<i class="hn-dot"></i>` : ""}</button>`;
    };
    filtersEl.innerHTML = [chip("All"), ...senders.map(chip)].join("");
    filtersEl.querySelectorAll(".hn-chip").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.f; renderFilters(); renderList(); }));
  }
  function renderList() {
    const view = items.filter((r) => filter === "All" || (r.sender || "System") === filter);
    if (!view.length) { listEl.innerHTML = `<div class="hn-empty"><div class="hn-empty-mark">${esc(kappaRun(8))}</div><div>You're all caught up.</div><div class="hn-empty-sub">Alerts and Q's notes will gather here.</div></div>`; return; }
    listEl.innerHTML = view.map((r) => {
      const sev = r.severity && r.severity !== "info" ? ` hn-sev-${esc(r.severity)}` : "";
      const sIcon = sevIcon(r.severity);
      const ic = r.icon || ICON[r.sender] || ICON.System;
      return `<div class="hn-item${r.read ? "" : " unread"}${sev}${r.deepLink ? " hn-link" : ""}" role="listitem" data-id="${esc(r.id)}">
        <div class="hn-ic">${esc(ic)}</div>
        <div class="hn-main">
          <div class="hn-row"><span class="hn-title">${esc(r.title)}</span><span class="hn-time">${esc(relTime(r.ts))}</span></div>
          ${r.body ? `<div class="hn-body">${esc(r.body)}</div>` : ""}
          <div class="hn-meta"><span class="hn-sender">${esc(r.sender || "System")}</span>${sIcon ? `<span class="hn-sevmark">${esc(sIcon)}</span>` : ""}</div>
        </div>
        ${r.read ? "" : `<span class="hn-unreaddot" aria-label="unread"></span>`}
      </div>`;
    }).join("");
    listEl.querySelectorAll(".hn-item").forEach((el) => el.addEventListener("click", () => {
      const r = items.find((x) => x.id === el.dataset.id); if (!r) return;
      if (!r.read) { r.read = true; save(); refreshBadge(false); el.classList.remove("unread"); el.querySelector(".hn-unreaddot")?.remove(); renderFilters(); }
      if (r.deepLink) { try { onDeepLink(r.deepLink, r); } catch (e) {} aside.close(); }
    }));
  }
  function render() { renderFilters(); renderList(); }

  // ── the toast face ───────────────────────────────────────────────────────────────────────────────
  function showToast(rec, opts) {
    if (opts.silent) return;
    const t = document.createElement("div");
    t.className = "hn-toast" + (rec.severity && rec.severity !== "info" ? " hn-sev-" + rec.severity : "") + (opts.transient ? " hn-transient" : "");
    const ic = rec.icon || ICON[rec.sender] || ICON.System;
    t.innerHTML = `
      <div class="hn-ic">${esc(ic)}</div>
      <div class="hn-main">
        <div class="hn-title">${esc(rec.title)}</div>
        ${rec.body ? `<div class="hn-body">${esc(rec.body)}</div>` : ""}
        <div class="hn-acts"></div>
      </div>
      <button class="hn-toast-x" type="button" aria-label="Dismiss">✕</button>
      <span class="hn-shimmer" aria-hidden="true">${esc(kappaRun(7))}</span>`;
    const actsEl = t.querySelector(".hn-acts");
    const actions = Array.isArray(opts.actions) ? opts.actions : [];
    for (const a of actions) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "hn-act" + (a.primary ? " primary" : "");
      b.textContent = a.label;
      b.addEventListener("click", (e) => { e.stopPropagation(); try { a.run && a.run(); } catch (x) {} if (a.close !== false) dismiss(); });
      actsEl.appendChild(b);
    }
    if (!actions.length) actsEl.remove();
    let gone = false;
    const dismiss = () => { if (gone) return; gone = true; clearTimeout(tm); t.classList.add("out"); setTimeout(() => t.remove(), reduced() ? 0 : 240); };
    t.querySelector(".hn-toast-x").addEventListener("click", dismiss);
    // tapping the toast body opens the Center (its permanent home) unless it carries its own actions
    t.addEventListener("click", () => { if (!actions.length) { aside.open(); dismiss(); } });
    toastWrap.appendChild(t);
    requestAnimationFrame(() => t.classList.add("in"));
    const ttl = opts.sticky ? 0 : (opts.transient ? 3400 : (actions.length ? 9000 : 5600));
    const tm = ttl ? setTimeout(dismiss, ttl) : 0;
  }

  // ── the primitive ────────────────────────────────────────────────────────────────────────────────
  let seq = 0;
  function normalize(o) {
    return {
      id: o.id || ("n_" + Date.now().toString(36) + "_" + (seq++).toString(36)),
      ts: o.ts || Date.now(),
      sender: o.sender || "System",
      title: String(o.title == null ? "" : o.title),
      body: o.body ? String(o.body) : "",
      severity: o.severity || "info",
      read: false,
      deepLink: o.deepLink || null,
      icon: o.icon || null,
    };
  }
  function notify(opts = {}) {
    if (typeof opts === "string") opts = { title: opts };
    const rec = normalize(opts);
    showToast(rec, opts);
    if (opts.transient) return rec;          // pure status — shown, never filed (keeps history meaningful)
    items.unshift(rec); if (items.length > CAP) items.length = CAP;
    save();
    if (aside.isOpen()) render(); else renderFilters();
    refreshBadge(true);
    return rec;
  }
  const toast = (m, opts = {}) => notify({ title: m, transient: true, ...opts });
  const q = (textOrOpts) => notify(typeof textOrOpts === "string" ? { sender: "Q", title: textOrOpts } : { sender: "Q", ...textOrOpts });
  const markAllRead = () => { items.forEach((r) => (r.read = true)); save(); render(); refreshBadge(false); };
  const clear = (sender) => { items = sender ? items.filter((r) => (r.sender || "System") !== sender) : []; if (sender) { /* keep filter */ } else filter = "All"; save(); render(); refreshBadge(false); };

  // re-key history when the operator changes (sign-in / sign-out), so each operator sees only their own.
  function rebindOperator() { load(); render(); refreshBadge(false); }

  render(); refreshBadge(false);

  const api = { notify, toast, q, open: aside.open, close: aside.close, toggle: aside.toggle, isOpen: aside.isOpen, markAllRead, clear, unread, rebindOperator, aside };
  try { window.HoloNotify = api; } catch (e) {}
  return api;
}

function injectStyles() {
  if (document.getElementById("holo-notify-styles")) return;
  const s = document.createElement("style"); s.id = "holo-notify-styles";
  s.textContent = `
  /* bell + unread badge — a quiet chrome affordance that brightens only on arrival */
  #notif-btn{position:relative;display:inline-grid;place-items:center;flex:0 0 auto}
  #notif-btn .hn-badge{position:absolute;top:-2px;right:-2px;min-width:16px;height:16px;padding:0 4px;border-radius:9px;
    background:var(--holo-accent,#5b8cff);color:#fff;font:600 11px/16px var(--holo-font-sans,system-ui);text-align:center;
    box-shadow:0 0 0 2px var(--holo-bg,#0a0e16);pointer-events:none}
  #notif-btn.has-unread{color:var(--holo-accent,#5b8cff)}
  #notif-btn.ring::after{content:"";position:absolute;inset:-3px;border-radius:50%;border:2px solid var(--holo-accent,#5b8cff);
    animation:hn-ring .6s cubic-bezier(.2,.8,.2,1)}
  @keyframes hn-ring{from{transform:scale(.7);opacity:.8}to{transform:scale(1.5);opacity:0}}

  /* the Center body — tokens + golden-ratio spacing throughout */
  .hn-aside .ha-body{background:var(--holo-bg,#0a0e16)}
  .hn-bar{flex:0 0 auto;display:flex;align-items:center;gap:var(--holo-size-xs,.618rem);padding:var(--holo-size-xs,.618rem) var(--holo-size-s,1rem);
    border-bottom:1px solid var(--holo-border,#1d1d21)}
  .hn-filters{display:flex;align-items:center;gap:var(--holo-size-2xs,.382rem);flex:1 1 auto;min-width:0;overflow-x:auto;scrollbar-width:none}
  .hn-filters::-webkit-scrollbar{display:none}
  .hn-chip{position:relative;flex:0 0 auto;border:1px solid var(--holo-border,#1d1d21);background:var(--holo-surface,#141417);color:var(--holo-ink-dim,#9a9aa2);
    border-radius:999px;padding:var(--holo-size-3xs,.236rem) var(--holo-size-xs,.618rem);font:600 16px/1 var(--holo-font-sans,system-ui);cursor:pointer;transition:.14s}
  .hn-chip:hover{color:var(--holo-ink,#e7e7ea)}
  .hn-chip.on{background:var(--holo-accent,#5b8cff);border-color:var(--holo-accent,#5b8cff);color:#fff}
  .hn-chip .hn-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--holo-accent,#5b8cff);margin-left:5px;vertical-align:middle}
  .hn-chip.on .hn-dot{background:#fff}
  .hn-tools{display:flex;gap:var(--holo-size-2xs,.382rem);flex:0 0 auto}
  .hn-tool{border:0;background:transparent;color:var(--holo-ink-dim,#9a9aa2);font:600 16px/1 var(--holo-font-sans,system-ui);cursor:pointer;
    padding:var(--holo-size-3xs,.236rem) var(--holo-size-2xs,.382rem);border-radius:8px;white-space:nowrap;transition:.12s}
  .hn-tool:hover{color:var(--holo-ink,#e7e7ea);background:var(--holo-surface,#141417)}

  .hn-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:var(--holo-size-2xs,.382rem) 0}
  .hn-item{position:relative;display:flex;gap:var(--holo-size-xs,.618rem);align-items:flex-start;
    padding:var(--holo-size-xs,.618rem) var(--holo-size-s,1rem);cursor:default;transition:background .12s}
  .hn-item.hn-link{cursor:pointer}
  .hn-item:hover{background:var(--holo-surface,#141417)}
  .hn-item.unread{background:color-mix(in srgb,var(--holo-accent,#5b8cff) 7%,transparent)}
  .hn-item .hn-ic{flex:0 0 auto;width:32px;height:32px;border-radius:10px;display:grid;place-items:center;font-size:17px;
    background:var(--holo-surface-2,#1c1c20);color:var(--holo-ink,#e7e7ea)}
  .hn-item.hn-sev-warn .hn-ic{color:var(--holo-warn,#e2b341)}
  .hn-item.hn-sev-danger .hn-ic{color:var(--holo-danger,#e5484d)}
  .hn-item.hn-sev-ok .hn-ic{color:var(--holo-ok,#3ecf8e)}
  .hn-main{flex:1 1 auto;min-width:0}
  .hn-row{display:flex;align-items:baseline;gap:var(--holo-size-xs,.618rem)}
  .hn-title{flex:1 1 auto;min-width:0;color:var(--holo-ink,#e7e7ea);font:600 16px/1.35 var(--holo-font-sans,system-ui);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .hn-time{flex:0 0 auto;color:var(--holo-ink-dim,#9a9aa2);font:500 13px/1 var(--holo-font-sans,system-ui)}
  .hn-body{color:var(--holo-ink-dim,#c8c8cf);font:400 16px/1.45 var(--holo-font-sans,system-ui);margin-top:3px;
    overflow-wrap:anywhere}
  .hn-meta{display:flex;align-items:center;gap:var(--holo-size-2xs,.382rem);margin-top:5px}
  .hn-sender{color:var(--holo-ink-dim,#9a9aa2);font:600 12px/1 var(--holo-font-sans,system-ui);letter-spacing:.04em;text-transform:uppercase;opacity:.8}
  .hn-sevmark{color:var(--holo-warn,#e2b341);font-size:12px}
  .hn-item.hn-sev-danger .hn-sevmark{color:var(--holo-danger,#e5484d)}
  .hn-item.hn-sev-ok .hn-sevmark{color:var(--holo-ok,#3ecf8e)}
  .hn-unreaddot{position:absolute;top:50%;right:var(--holo-size-2xs,.382rem);transform:translateY(-50%);width:7px;height:7px;border-radius:50%;
    background:var(--holo-accent,#5b8cff);box-shadow:0 0 8px color-mix(in srgb,var(--holo-accent,#5b8cff) 70%,transparent)}

  .hn-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--holo-size-2xs,.382rem);
    padding:var(--holo-size-xl,4.236rem) var(--holo-size-m,1.618rem);text-align:center;color:var(--holo-ink-dim,#9a9aa2);
    font:400 16px/1.5 var(--holo-font-sans,system-ui)}
  .hn-empty-mark{font:400 22px/1 ui-monospace,monospace;color:color-mix(in srgb,var(--holo-accent,#5b8cff) 60%,var(--holo-ink-dim,#9a9aa2));letter-spacing:3px;opacity:.7}
  .hn-empty-sub{font-size:14px;opacity:.7}

  /* toast stack — bottom-centre, the transient face; obvious yet calm, never steals focus */
  #hn-toasts{position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:99990;
    display:flex;flex-direction:column-reverse;gap:var(--holo-size-2xs,.382rem);width:min(560px,calc(100vw - 32px));pointer-events:none}
  .hn-toast{position:relative;overflow:hidden;display:flex;align-items:flex-start;gap:var(--holo-size-xs,.618rem);pointer-events:auto;
    background:var(--holo-surface,#141417);border:1px solid var(--holo-border,#26262c);border-radius:14px;
    padding:var(--holo-size-xs,.618rem) var(--holo-size-s,1rem);box-shadow:0 18px 50px rgba(0,0,0,.45);color:var(--holo-ink,#e7e7ea);
    opacity:0;transform:translateY(10px) scale(.98);transition:opacity .26s var(--ease,ease),transform .26s var(--ease,ease)}
  .hn-toast.in{opacity:1;transform:none}
  .hn-toast.out{opacity:0;transform:translateY(8px) scale(.98)}
  .hn-toast .hn-ic{flex:0 0 auto;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-size:18px;
    background:var(--holo-surface-2,#1c1c20)}
  .hn-toast.hn-sev-warn{border-color:color-mix(in srgb,var(--holo-warn,#e2b341) 45%,var(--holo-border,#26262c))}
  .hn-toast.hn-sev-warn .hn-ic{color:var(--holo-warn,#e2b341)}
  .hn-toast.hn-sev-danger{border-color:color-mix(in srgb,var(--holo-danger,#e5484d) 50%,var(--holo-border,#26262c))}
  .hn-toast.hn-sev-danger .hn-ic{color:var(--holo-danger,#e5484d)}
  .hn-toast.hn-sev-ok .hn-ic{color:var(--holo-ok,#3ecf8e)}
  .hn-toast .hn-main{flex:1 1 auto;min-width:0}
  .hn-toast .hn-title{color:var(--holo-ink,#e7e7ea);font:600 16px/1.35 var(--holo-font-sans,system-ui)}
  .hn-toast .hn-body{color:var(--holo-ink-dim,#c8c8cf);font:400 16px/1.45 var(--holo-font-sans,system-ui);margin-top:2px}
  .hn-toast.hn-transient{padding:var(--holo-size-2xs,.382rem) var(--holo-size-s,1rem)}
  .hn-toast.hn-transient .hn-ic{display:none}
  .hn-acts{display:flex;gap:var(--holo-size-2xs,.382rem);margin-top:var(--holo-size-2xs,.382rem);flex-wrap:wrap}
  .hn-act{border:1px solid var(--holo-border,#2a2a31);background:transparent;color:var(--holo-ink-dim,#c8c8cf);
    border-radius:10px;padding:7px 13px;font:600 16px/1 var(--holo-font-sans,system-ui);cursor:pointer;transition:.12s}
  .hn-act:hover{color:var(--holo-ink,#e7e7ea);border-color:var(--holo-ink-dim,#6a6a72)}
  .hn-act.primary{background:var(--holo-accent,#5b8cff);border-color:var(--holo-accent,#5b8cff);color:#fff}
  .hn-act.primary:hover{filter:brightness(1.06)}
  .hn-toast-x{flex:0 0 auto;width:26px;height:26px;border:0;border-radius:8px;background:transparent;color:var(--holo-ink-dim,#9a9aa2);
    font-size:13px;cursor:pointer;display:grid;place-items:center;transition:.12s}
  .hn-toast-x:hover{background:var(--holo-surface-2,#1c1c20);color:var(--holo-ink,#e7e7ea)}
  /* κ-glyph shimmer — a sealed-byte sweep across a fresh arrival */
  .hn-shimmer{position:absolute;left:0;right:0;bottom:0;height:2px;color:transparent;overflow:hidden;
    background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--holo-accent,#5b8cff) 90%,transparent),transparent);
    background-size:240% 100%;animation:hn-sweep 1.1s ease-out 1}
  @keyframes hn-sweep{from{background-position:120% 0}to{background-position:-120% 0}}

  @media (prefers-reduced-motion: reduce){
    .hn-toast{transition:opacity .12s}.hn-toast.in{transform:none}
    .hn-shimmer{animation:none;opacity:.5}#notif-btn.ring::after{animation:none;opacity:0}
  }
  @media (max-width:600px){
    #hn-toasts{width:calc(100vw - 24px)}
    .hn-tool{min-height:40px}
  }`;
  document.head.appendChild(s);
}

export default { mountNotifications };
