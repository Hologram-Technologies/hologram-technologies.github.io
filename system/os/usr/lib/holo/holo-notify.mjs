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

// THE THREE CATEGORIES — the spine. One axis: what does this ask of YOU? It routes everything below —
// whether the canvas pill persists or fades, and which Inbox filter it lands under. Self-describing by name.
//   action — Needs you. Requires your decision or input. The pill PERSISTS and stacks until you act.
//   update — Updates.   Something finished or changed; nothing to do. The pill APPEARS then fades.
//   letter — From Q.    Q's proactive insight. Filed always, surfaced gently, never demands.
const CATEGORY = {
  action: { label: "Needs you", icon: "◆" },
  update: { label: "Updates", icon: "◉" },
  letter: { label: "From Q", icon: "✶" },
};
const CAT_ORDER = ["action", "update", "letter"];
// Derive when a caller omits it: anything carrying a decision (its own actions, or sticky) is "action";
// a note from Q is a "letter"; everything else is a quiet "update". Explicit category always wins.
function deriveCategory(o) {
  if (o.category && CATEGORY[o.category]) return o.category;
  if (o.sticky || (Array.isArray(o.actions) && o.actions.length > 0)) return "action";
  if (o.sender === "Q") return "letter";
  return "update";
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

// A concern's STABLE identity — the one key both the durable store and the live filer collapse on, so a
// recurring note is ONE living copy, never a pile. It MUST NOT include the body: a recurring concern carries
// a live scalar in its body (e.g. "4 objects can't be recovered" → "3" → "1"), so any body-sensitive key
// reads each tick as a brand-new note (the duplication this guards against). Priority:
//   1. deepLink kind:value — the note's navigation target. Stable, body-independent, and still subject-
//      specific (per-app errors / per-row gate failures get distinct values), so it never over-merges.
//   2. a caller-supplied stable id (e.g. the backup nudge) — collapses re-files of the same id.
//   3. content (sender · title · body) — last resort for legacy ad-hoc notes with neither of the above.
function concernKey(r) {
  if (!r || typeof r !== "object") return "";
  const dl = r.deepLink;
  if (dl && dl.kind && dl.value != null) return "dl:" + dl.kind + ":" + dl.value;
  const id = r.id != null ? String(r.id) : "";
  if (id) return "id:" + id;
  return "ct:" + (r.sender || "System") + "|" + (r.title || "") + "|" + (r.body || "");
}

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

// Context-aware Inbox ordering (PRESENTATION ONLY — never mutates `items`, the durable store, or any κ;
// it reorders a copy for display). With NO profile signal it is the identity — the list reads exactly as
// before (newest-first), so a brand-new operator sees zero change. Given the operator's own interest terms
// (window.HoloProfile.terms(), distilled on-device, never egressed) it floats unresolved "needs-you" items
// to the top and gently lifts notes that match what you care about, keeping the original recency order as a
// STABLE tiebreaker so nothing is shuffled arbitrarily. Pure + deterministic so it witnesses headless.
export function rankInbox(view, terms = [], catOf = (r) => (r && r.category) || "update") {
  if (!Array.isArray(view)) return [];
  if (view.length < 2) return view.slice();
  const ws = (Array.isArray(terms) ? terms : []).map((t) => String(t).toLowerCase()).filter((w) => w.length > 2);
  if (!ws.length) return view.slice();                       // graceful identity — zero change without context
  const rel = (r) => { const hay = ((r.title || "") + " " + (r.body || "") + " " + (r.sender || "")).toLowerCase(); let s = 0; for (const w of ws) if (hay.includes(w)) s++; return s; };
  return view
    .map((r, i) => ({ r, i, score: (catOf(r) === "action" && !r.read ? 1e6 : 0) + rel(r) }))
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))      // relevance/urgency first; recency holds ties (stable)
    .map((x) => x.r);
}

export function mountNotifications(bellEl, { getOperator = () => null, onDeepLink = () => {} } = {}) {
  injectStyles();

  // ── durable per-operator history ────────────────────────────────────────────────────────────────
  const opKey = () => { const op = getOperator() || ""; return STORE_V + (op ? op.split(":").pop().slice(0, 16) : "guest"); };
  let items = [];
  // Collapse true duplicates — the SAME concern filed more than once (e.g. the recovery nudge re-raised every
  // tick as its unrecovered count moves, or the backup nudge re-filed each session). Items are newest-first,
  // so the FIRST occurrence of a concernKey is the one we keep (the live count is the current one); the rest
  // are dropped. concernKey is body-INDEPENDENT (see its definition), so a moving scalar never reads as a new
  // note. Genuinely distinct concerns — distinct deepLink / id / content — are never merged.
  function dedupe(arr) {
    const seen = new Set(); const out = [];
    for (const r of arr) {
      if (!r || typeof r !== "object") continue;
      const k = concernKey(r);
      if (seen.has(k)) continue;
      seen.add(k); out.push(r);
    }
    return out;
  }
  function load() { try { const r = JSON.parse(localStorage.getItem(opKey()) || "[]"); const raw = Array.isArray(r) ? r : []; items = dedupe(raw); if (items.length !== raw.length) save(); } catch { items = []; } }
  let saveT = 0;
  function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(opKey(), JSON.stringify(items.slice(0, CAP))); } catch {} }, 200); }
  load();

  // ── the Center — the shared right side-carriage (createAside) ─────────────────────────────────────
  const aside = createAside({ id: "notify", title: "Inbox" });   // golden scale + collapse chevron from the shared template
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
  let filter = "all";   // "all" | a category key

  aside.body.querySelector(".hn-tools").addEventListener("click", (e) => {
    const act = e.target?.dataset?.act; if (!act) return;
    if (act === "read") markAllRead();
    else if (act === "clear") clear(filter === "all" ? null : filter);
  });

  // ── pill stack — TOP-RIGHT, INSIDE the holospace canvas (#world), so an alert rides the tab you're in
  // rather than floating over the chrome. #world is one reused canvas across tabs, so it lands correctly on
  // every tab. Resolved lazily (the canvas may mount after us) and re-homed if #world appears later.
  function pillStack() {
    let w = document.getElementById("hn-toasts");
    if (!w) { w = document.createElement("div"); w.id = "hn-toasts"; w.setAttribute("aria-live", "polite"); }
    const host = document.getElementById("world") || document.body;
    if (w.parentElement !== host) host.appendChild(w);
    return w;
  }

  // ── bell badge ───────────────────────────────────────────────────────────────────────────────────
  let badge = bellEl && bellEl.querySelector(".hn-badge");
  if (bellEl && !badge) { badge = document.createElement("span"); badge.className = "hn-badge"; badge.hidden = true; bellEl.appendChild(badge); }
  const unread = () => items.reduce((n, r) => n + (r.read ? 0 : 1), 0);
  // The badge shows the REAL number of messages in the inbox (the count of items in the list), so the chip on
  // the bell always equals what you see when you open it. Unread still drives the brighten + arrival pulse.
  function refreshBadge(pulse) {
    const total = items.length;
    const hasUnread = unread() > 0;
    if (badge) { badge.textContent = total > 99 ? "99+" : String(total); badge.hidden = total === 0; }
    if (bellEl) { bellEl.classList.toggle("has-unread", hasUnread); if (pulse && !reduced()) { bellEl.classList.remove("ring"); void bellEl.offsetWidth; bellEl.classList.add("ring"); } }
  }
  if (bellEl) bellEl.addEventListener("click", () => toggleCenter());
  aside._aside && (aside._open = aside.open);

  // ── render ───────────────────────────────────────────────────────────────────────────────────────
  const catOf = (r) => (r.category && CATEGORY[r.category] ? r.category : "update");
  // the filter rail IS the three categories (plus All) — the same axis the pills speak: Needs you · Updates · From Q.
  function renderFilters() {
    const chip = (key, label) => {
      const u = key === "all" ? unread() : items.reduce((n, r) => n + (catOf(r) === key && !r.read ? 1 : 0), 0);
      return `<button class="hn-chip${filter === key ? " on" : ""}" type="button" data-f="${esc(key)}">${esc(label)}${u ? `<i class="hn-dot"></i>` : ""}</button>`;
    };
    filtersEl.innerHTML = [chip("all", "All"), ...CAT_ORDER.map((k) => chip(k, CATEGORY[k].label))].join("");
    filtersEl.querySelectorAll(".hn-chip").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.f; renderFilters(); renderList(); }));
  }
  // the operator's distilled interest terms, read lazily + defensively from the one private-context seam
  // (window.HoloProfile, set by holo-profile-context). Absent/empty -> rankInbox is the identity.
  const profileTerms = () => { try { const t = window.HoloProfile && window.HoloProfile.terms && window.HoloProfile.terms(); return Array.isArray(t) ? t : []; } catch { return []; } };
  function renderList() {
    const view = rankInbox(items.filter((r) => filter === "all" || catOf(r) === filter), profileTerms(), catOf);
    if (!view.length) { listEl.innerHTML = `<div class="hn-empty"><div class="hn-empty-mark">${esc(kappaRun(8))}</div><div>You're all caught up.</div><div class="hn-empty-sub">Q's letters and alerts gather here.</div></div>`; return; }
    listEl.innerHTML = view.map((r) => {
      const cat = catOf(r);
      const sev = r.severity && r.severity !== "info" ? ` hn-sev-${esc(r.severity)}` : "";
      const sIcon = sevIcon(r.severity);
      const ic = r.icon || ICON[r.sender] || (CATEGORY[cat] && CATEGORY[cat].icon) || ICON.System;
      const acts = actionsFor(r);
      // a Q letter reads richer than a system row — its mark, its full message, room to breathe.
      return `<div class="hn-item hn-cat-${esc(cat)}${r.read ? "" : " unread"}${sev}${r.deepLink ? " hn-link" : ""}" role="listitem" data-id="${esc(r.id)}">
        <div class="hn-ic">${esc(ic)}</div>
        <div class="hn-main">
          <div class="hn-row"><span class="hn-title">${esc(r.title)}</span><span class="hn-time">${esc(relTime(r.ts))}</span></div>
          ${r.body ? `<div class="hn-body">${esc(r.body)}</div>` : ""}
          <div class="hn-meta"><span class="hn-sender">${esc(r.sender || "System")}</span>${sIcon ? `<span class="hn-sevmark">${esc(sIcon)}</span>` : ""}</div>
          ${acts.length ? `<div class="hn-acts">${acts.map((a, i) => `<button class="hn-act${a.primary ? " primary" : ""}" type="button" data-act-i="${i}">${esc(a.label)}</button>`).join("")}</div>` : ""}
        </div>
        ${r.read ? "" : `<span class="hn-unreaddot" aria-label="unread"></span>`}
      </div>`;
    }).join("");
    const markRead = (r, el) => { if (!r.read) { r.read = true; save(); refreshBadge(false); el.classList.remove("unread"); el.querySelector(".hn-unreaddot")?.remove(); renderFilters(); } };
    const fire = (r, link) => { try { onDeepLink(link, r); } catch (e) {} aside.close(); };
    listEl.querySelectorAll(".hn-item").forEach((el) => {
      const r = items.find((x) => x.id === el.dataset.id); if (!r) return;
      const acts = actionsFor(r);
      // each action point is a real, wired button — it marks the note read and routes its deepLink
      el.querySelectorAll(".hn-act").forEach((b) => b.addEventListener("click", (e) => {
        e.stopPropagation();
        const a = acts[+b.dataset.actI]; if (!a) return;
        markRead(r, el); fire(r, a.deepLink);
      }));
      // a click on the body still opens the note's primary destination (or just marks it read)
      el.addEventListener("click", () => { markRead(r, el); if (r.deepLink) fire(r, r.deepLink); });
    });
  }
  function render() { renderFilters(); renderList(); }

  // Open the Center and ALWAYS paint the current list first. Notes that arrive while the carriage is closed
  // only refresh the badge + filter chips (renderList is skipped to avoid churning a hidden list), so without
  // this the carriage would open onto a stale list — the bug where unread items showed in the badge but the
  // list read "all caught up". Every open path (bell, a pill tap, the public api) routes through here.
  function openCenter() { render(); aside.open(); }
  function toggleCenter() { if (aside.isOpen()) aside.close(); else openCenter(); }

  // ── the pill — ONE row, the transient FACE of a recorded notification ────────────────────────────
  // Light by design: a rounded pill, hairline border, no body text. The title alone is the "what"; the
  // full message lives on tap and in the Inbox. Category decides its lifetime: "action" persists until
  // resolved, "update"/"letter" appear then fade. Severity shows as a single accent on the icon, never a
  // loud fill. At most ONE inline quick action (the primary) — the rest live in the expanded view.
  function resolveItem(rec) {
    const r = items.find((x) => x.id === rec.id);
    if (r && !r.read) { r.read = true; save(); refreshBadge(false); if (aside.isOpen()) render(); else renderFilters(); }
  }
  function showToast(rec, opts) {
    if (opts.silent) return;
    const cat = rec.category || "update";
    const t = document.createElement("div");
    t.className = "hn-pill hn-cat-" + cat + (rec.severity && rec.severity !== "info" ? " hn-sev-" + rec.severity : "") + (opts.transient ? " hn-status" : "");
    const ic = rec.icon || ICON[rec.sender] || (CATEGORY[cat] && CATEGORY[cat].icon) || ICON.System;
    // the single quick action: a live runtime action if the caller passed one, else the record's own
    // primary (derived from its serializable actions / deepLink), which routes through onDeepLink.
    const runtime = Array.isArray(opts.actions) ? opts.actions : [];
    const primary = runtime.find((a) => a && a.primary) || runtime[0] || null;
    const serial = !primary ? (actionsFor(rec)[0] || null) : null;
    const quick = primary || serial;
    const showTime = !opts.transient;
    t.innerHTML = `
      <span class="hn-ic">${esc(ic)}</span>
      <span class="hn-title">${esc(rec.title)}</span>
      ${quick ? `<button class="hn-quick" type="button">${esc(quick.label)}</button>` : ""}
      ${showTime ? `<span class="hn-time">${esc(relTime(rec.ts))}</span>` : ""}
      <button class="hn-x" type="button" aria-label="Dismiss">✕</button>
      <span class="hn-shimmer" aria-hidden="true">${esc(kappaRun(7))}</span>`;
    let gone = false;
    const dismiss = () => { if (gone) return; gone = true; clearTimeout(tm); t.classList.add("out"); setTimeout(() => t.remove(), reduced() ? 0 : 220); };
    t.querySelector(".hn-x").addEventListener("click", (e) => { e.stopPropagation(); dismiss(); });
    const qb = t.querySelector(".hn-quick");
    if (qb) qb.addEventListener("click", (e) => {
      e.stopPropagation();
      if (primary) { try { primary.run && primary.run(); } catch (x) {} }
      else if (serial) { resolveItem(rec); try { onDeepLink(serial.deepLink, rec); } catch (x) {} }
      dismiss();   // acting on it resolves the pill (it remains in the Inbox)
    });
    // tapping the pill body opens the Inbox (its permanent home) to read the full message
    t.addEventListener("click", () => { resolveItem(rec); openCenter(); if (cat !== "action") dismiss(); });
    const stack = pillStack();
    // ONE LIVING PILL PER CONCERN — collapse on the SAME concernKey the durable store uses (body-independent),
    // so a recurring concern (re-raised across ticks / reloads / frames — e.g. the recovery nudge) UPDATES its
    // single pill in place instead of stacking an identical duplicate. "action" pills never auto-fade (ttl 0),
    // so without this guard a re-send piles a second, third … copy of the same alert. We drop EVERY prior pill
    // for the key (clearing its pending timer) and insert this fresh one — the pill mirrors the inbox's "never a
    // pile". Genuinely distinct concerns carry distinct keys (distinct deepLink / id / content) and never merge.
    const key = concernKey(rec);
    if (key) for (const el of [...stack.children]) { if (el.__hnKey === key) { try { clearTimeout(el.__hnTimer); } catch (e) {} el.remove(); } }
    t.__hnKey = key;
    stack.insertBefore(t, stack.firstChild);   // newest on top; "action" pills accumulate downward beneath
    requestAnimationFrame(() => t.classList.add("in"));
    // lifetime by category: action persists (0); a Q letter lingers a little longer; an update is brief.
    const ttl = (cat === "action" || opts.sticky) ? 0 : opts.transient ? 3200 : cat === "letter" ? 6800 : 4200;
    const tm = ttl ? setTimeout(dismiss, ttl) : 0;
    t.__hnTimer = tm;
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
      category: deriveCategory(o),   // the one axis that routes pill lifetime + Inbox filter
      read: false,
      deepLink: o.deepLink || null,
      icon: o.icon || null,
      // Serializable action points so the persistent Center can render real, working buttons (toast
      // actions are functions and can't survive a reload; a deepLink can). actionLabel relabels the
      // single deepLink button; actions[] carries several, each {label, deepLink|kind/value, primary}.
      actionLabel: o.actionLabel ? String(o.actionLabel) : null,
      actions: Array.isArray(o.actions)
        ? o.actions
            .map((a) => (a && a.label ? { label: String(a.label), deepLink: a.deepLink || (a.kind ? { kind: a.kind, value: a.value } : null), primary: !!a.primary } : null))
            .filter((a) => a && a.deepLink)
        : null,
    };
  }
  // The action points a record exposes in the Center — explicit serializable actions if present, else a
  // single button derived from its deepLink, labelled by kind so every actionable note reads as a verb.
  const DEFAULT_ACTION_LABEL = { backup: "Back up now", q: "Open Q", coherence: "Look with Q", address: "Open", run: "Run" };
  function actionsFor(r) {
    if (Array.isArray(r.actions) && r.actions.length) return r.actions;
    if (r.deepLink) return [{ label: r.actionLabel || DEFAULT_ACTION_LABEL[r.deepLink.kind] || "Open", deepLink: r.deepLink, primary: true }];
    return [];
  }
  function notify(opts = {}) {
    if (typeof opts === "string") opts = { title: opts };
    const rec = normalize(opts);
    showToast(rec, opts);
    if (opts.transient) return rec;          // pure status — shown, never filed (keeps history meaningful)
    // A recurring concern (e.g. the recovery nudge whose count moves, or the backup nudge that re-fires each
    // session) updates its ONE message in place — never a growing pile — and carries the prior read state, so
    // it stops nagging once seen. We collapse on concernKey (body-independent), and clear EVERY prior copy of
    // it (not just the first), so any duplicates a past build left collapse to this single living note.
    const key = concernKey(rec);
    const prior = items.find((x) => concernKey(x) === key);
    if (prior) rec.read = prior.read;
    items = items.filter((x) => concernKey(x) !== key);
    items.unshift(rec); if (items.length > CAP) items.length = CAP;
    save();
    if (aside.isOpen()) render(); else renderFilters();
    refreshBadge(!rec.read);                  // swing/pulse only on a genuine unread arrival
    return rec;
  }
  const toast = (m, opts = {}) => notify({ title: m, transient: true, ...opts });
  const q = (textOrOpts) => notify(typeof textOrOpts === "string" ? { sender: "Q", title: textOrOpts } : { sender: "Q", ...textOrOpts });
  const markAllRead = () => { items.forEach((r) => (r.read = true)); save(); render(); refreshBadge(false); };
  const clear = (cat) => { items = cat ? items.filter((r) => catOf(r) !== cat) : []; if (!cat) filter = "all"; save(); render(); refreshBadge(false); };

  // re-key history when the operator changes (sign-in / sign-out), so each operator sees only their own.
  function rebindOperator() { load(); render(); refreshBadge(false); }

  render(); refreshBadge(false);

  const api = { notify, toast, q, open: openCenter, close: aside.close, toggle: toggleCenter, isOpen: aside.isOpen, markAllRead, clear, unread, rebindOperator, aside };
  try { window.HoloNotify = api; } catch (e) {}
  return api;
}

function injectStyles() {
  if (document.getElementById("holo-notify-styles")) return;
  const s = document.createElement("style"); s.id = "holo-notify-styles";
  s.textContent = `
  /* crisp type everywhere in the surface — grayscale-smoothed, kerned, optically sized, with the
     real OS face. This is what makes the rail read "sharp": subpixel off, hinting honored, figures aligned. */
  .hn-aside,#hn-toasts{font-family:var(--holo-font-sans,system-ui);-webkit-font-smoothing:antialiased;
    -moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;font-optical-sizing:auto;
    font-feature-settings:"kern" 1,"liga" 1,"calt" 1}

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
  .hn-aside .ha-body{background:transparent}
  .hn-bar{flex:0 0 auto;display:flex;align-items:center;gap:var(--holo-size-xs,.618rem);padding:var(--holo-size-xs,.618rem) var(--holo-size-s,1rem);
    border-bottom:1px solid var(--holo-border,#1d1d21)}
  .hn-filters{display:flex;align-items:center;gap:var(--holo-size-2xs,.382rem);flex:1 1 auto;min-width:0;overflow-x:auto;scrollbar-width:none}
  .hn-filters::-webkit-scrollbar{display:none}
  .hn-chip{position:relative;flex:0 0 auto;border:1px solid var(--holo-border,#1d1d21);background:var(--holo-surface,#141417);color:var(--holo-ink-dim,#9a9aa2);
    border-radius:999px;padding:.32rem .66rem;font:600 13px/1 var(--holo-font-sans,system-ui);letter-spacing:-.003em;cursor:pointer;transition:.14s}
  .hn-chip:hover{color:var(--holo-ink,#e7e7ea)}
  .hn-chip.on{background:var(--holo-accent,#5b8cff);border-color:var(--holo-accent,#5b8cff);color:#fff}
  .hn-chip .hn-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--holo-accent,#5b8cff);margin-left:5px;vertical-align:middle}
  .hn-chip.on .hn-dot{background:#fff}
  .hn-tools{display:flex;gap:var(--holo-size-2xs,.382rem);flex:0 0 auto}
  .hn-tool{border:0;background:transparent;color:var(--holo-ink-dim,#9a9aa2);font:600 13px/1 var(--holo-font-sans,system-ui);letter-spacing:-.003em;cursor:pointer;
    padding:.32rem .44rem;border-radius:8px;white-space:nowrap;transition:.12s}
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
  .hn-title{flex:1 1 auto;min-width:0;color:var(--holo-ink,#e7e7ea);font:650 14px/1.3 var(--holo-font-sans,system-ui);letter-spacing:-.006em;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .hn-time{flex:0 0 auto;color:var(--holo-ink-dim,#9a9aa2);font:500 12px/1 var(--holo-font-sans,system-ui);letter-spacing:.01em;font-variant-numeric:tabular-nums}
  .hn-body{color:var(--holo-ink-dim,#c8c8cf);font:400 13px/1.5 var(--holo-font-sans,system-ui);margin-top:3px;
    overflow-wrap:anywhere}
  .hn-meta{display:flex;align-items:center;gap:var(--holo-size-2xs,.382rem);margin-top:5px}
  .hn-sender{color:var(--holo-ink-dim,#9a9aa2);font:600 11px/1 var(--holo-font-sans,system-ui);letter-spacing:.06em;text-transform:uppercase;opacity:.8}
  .hn-sevmark{color:var(--holo-warn,#e2b341);font-size:12px}
  .hn-item.hn-sev-danger .hn-sevmark{color:var(--holo-danger,#e5484d)}
  .hn-item.hn-sev-ok .hn-sevmark{color:var(--holo-ok,#3ecf8e)}
  .hn-unreaddot{position:absolute;top:50%;right:var(--holo-size-2xs,.382rem);transform:translateY(-50%);width:7px;height:7px;border-radius:50%;
    background:var(--holo-accent,#5b8cff);box-shadow:0 0 8px color-mix(in srgb,var(--holo-accent,#5b8cff) 70%,transparent)}

  .hn-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--holo-size-2xs,.382rem);
    padding:var(--holo-size-xl,4.236rem) var(--holo-size-m,1.618rem);text-align:center;color:var(--holo-ink-dim,#9a9aa2);
    font:400 14px/1.5 var(--holo-font-sans,system-ui)}
  .hn-empty-mark{font:400 22px/1 ui-monospace,monospace;color:color-mix(in srgb,var(--holo-accent,#5b8cff) 60%,var(--holo-ink-dim,#9a9aa2));letter-spacing:3px;opacity:.7}
  .hn-empty-sub{font-size:13px;opacity:.7}

  /* a Q letter in the Inbox reads richer — a faint accent edge and a fuller body */
  .hn-item.hn-cat-letter{border-left:2px solid color-mix(in srgb,var(--holo-accent,#5b8cff) 55%,transparent)}
  .hn-item.hn-cat-letter .hn-body{color:var(--holo-ink,#e7e7ea)}

  /* ── the pill stack — TOP-RIGHT, INSIDE the holospace canvas (#world), so an alert rides the tab you're
     in, never the chrome. The wrap is click-through; only a pill itself takes the pointer. Sits below the
     chrome (z 60) and above the canvas content. */
  #hn-toasts{position:absolute;top:var(--holo-size-s,1rem);right:var(--holo-size-s,1rem);z-index:59;
    display:flex;flex-direction:column;gap:var(--holo-size-2xs,.382rem);
    width:min(360px,calc(100% - 2rem));max-width:360px;pointer-events:none}
  /* the pill — ONE row, rounded, hairline, soft shadow. Light, precise, non-invasive. */
  .hn-pill{position:relative;overflow:hidden;display:flex;align-items:center;gap:var(--holo-size-2xs,.5rem);pointer-events:auto;
    background:var(--holo-surface,#141417);border:1px solid var(--holo-border,#26262c);border-radius:999px;
    padding:var(--holo-size-3xs,.3rem) var(--holo-size-xs,.55rem);box-shadow:0 6px 18px rgba(0,0,0,.22);color:var(--holo-ink,#e7e7ea);
    opacity:0;transform:translateY(-6px) scale(.98);transition:opacity .22s var(--ease,ease),transform .22s var(--ease,ease);cursor:pointer;max-width:100%}
  .hn-pill.in{opacity:1;transform:none}
  .hn-pill.out{opacity:0;transform:translateY(-6px) scale(.98)}
  .hn-pill .hn-ic{flex:0 0 auto;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:12px;
    background:var(--holo-surface-2,#1c1c20);color:var(--holo-ink-dim,#c8c8cf)}
  .hn-pill .hn-title{flex:1 1 auto;min-width:0;color:var(--holo-ink,#e7e7ea);font:600 13px/1.25 var(--holo-font-sans,system-ui);letter-spacing:-.006em;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .hn-pill .hn-time{flex:0 0 auto;color:var(--holo-ink-dim,#9a9aa2);font:500 12px/1 var(--holo-font-sans,system-ui);font-variant-numeric:tabular-nums}
  .hn-pill .hn-quick{flex:0 0 auto;border:0;border-radius:999px;background:var(--holo-accent,#5b8cff);color:#fff;
    font:600 12px/1 var(--holo-font-sans,system-ui);letter-spacing:-.003em;padding:.34rem .62rem;cursor:pointer;white-space:nowrap;transition:filter .12s}
  .hn-pill .hn-quick:hover{filter:brightness(1.08)}
  .hn-pill .hn-x{flex:0 0 auto;width:20px;height:20px;border:0;border-radius:50%;background:transparent;color:var(--holo-ink-dim,#9a9aa2);
    font-size:11px;cursor:pointer;display:grid;place-items:center;transition:.12s}
  .hn-pill .hn-x:hover{background:var(--holo-surface-2,#1c1c20);color:var(--holo-ink,#e7e7ea)}
  /* severity + category — a single accent on the icon, never a loud fill */
  .hn-pill.hn-sev-warn .hn-ic{color:var(--holo-warn,#e2b341)}
  .hn-pill.hn-sev-danger .hn-ic{color:var(--holo-danger,#e5484d)}
  .hn-pill.hn-sev-ok .hn-ic{color:var(--holo-ok,#3ecf8e)}
  .hn-pill.hn-cat-action .hn-ic{color:var(--holo-accent,#5b8cff)}
  .hn-pill.hn-cat-letter{border-color:color-mix(in srgb,var(--holo-accent,#5b8cff) 32%,var(--holo-border,#26262c))}
  .hn-pill.hn-cat-letter .hn-ic{color:var(--holo-accent,#5b8cff)}
  .hn-pill.hn-status{background:color-mix(in srgb,var(--holo-surface,#141417) 90%,transparent)}
  .hn-pill.hn-status .hn-ic{display:none}

  /* the Inbox action buttons (the expanded view) */
  .hn-acts{display:flex;gap:var(--holo-size-2xs,.382rem);margin-top:var(--holo-size-2xs,.382rem);flex-wrap:wrap}
  .hn-act{border:1px solid var(--holo-border,#2a2a31);background:transparent;color:var(--holo-ink-dim,#c8c8cf);
    border-radius:10px;padding:7px 14px;font:600 13px/1 var(--holo-font-sans,system-ui);letter-spacing:-.003em;cursor:pointer;transition:.12s}
  .hn-act:hover{color:var(--holo-ink,#e7e7ea);border-color:var(--holo-ink-dim,#6a6a72)}
  .hn-act.primary{background:var(--holo-accent,#5b8cff);border-color:var(--holo-accent,#5b8cff);color:#fff}
  .hn-act.primary:hover{filter:brightness(1.06)}
  /* κ-glyph shimmer — a sealed-byte sweep across a fresh arrival (a pill reads as "sealed", not "popped") */
  .hn-shimmer{position:absolute;left:0;right:0;bottom:0;height:2px;color:transparent;overflow:hidden;
    background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--holo-accent,#5b8cff) 90%,transparent),transparent);
    background-size:240% 100%;animation:hn-sweep 1.1s ease-out 1}
  @keyframes hn-sweep{from{background-position:120% 0}to{background-position:-120% 0}}

  @media (prefers-reduced-motion: reduce){
    .hn-pill{transition:opacity .12s}.hn-pill.in{transform:none}
    .hn-shimmer{animation:none;opacity:.5}#notif-btn.ring::after{animation:none;opacity:0}
  }
  @media (max-width:600px){
    #hn-toasts{width:calc(100% - 1.2rem);max-width:none;top:.6rem;right:.6rem}
    .hn-tool{min-height:40px}
  }`;
  document.head.appendChild(s);
}

export default { mountNotifications };
