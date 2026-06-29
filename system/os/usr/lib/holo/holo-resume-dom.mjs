// holo-resume-dom.mjs — Deep Resume: GENERIC per-app deep-state capture, ZERO per-app code.
//
// The Holo Session manifest already restores which apps/tabs are open + their order/route. The remaining
// promise ("land exactly where you left off") is per-app DEEP state — scroll position + unsaved drafts. The
// opt-in handshake (holo-session-client) exists but NO app implements it, so deep state was universally lost.
//
// Because holo app frames are sandboxed with `allow-same-origin` on the holo://os origin, the shell already
// has same-origin DOM access to them (it injects Q / Sound / + ambiently the same way). So we capture the
// high-value, low-risk deep state DIRECTLY from the frame's document — no in-frame script, no per-app edit:
//   • scroll position (reading position) of the root + any scrolled element
//   • drafts: <textarea> values + [contenteditable] HTML
// Plain <input> values are deliberately SKIPPED in v1 (lower value, higher clobber risk; an app that wants
// richer/opt-out behaviour provides its own holo-session-client state, which the shell prefers over this).
//
// Cross-origin / no-same-origin frames throw on document access → capture returns null (honest boundary,
// never faked). The blob rides the SAME encrypted session manifest as everything else (holo-session).

const MAX_SCROLLS = 60;        // cap scrolled-element entries (scan is bounded)
const MAX_TEXTS = 40;          // cap draft fields
const MAX_TEXT_LEN = 200000;   // skip a single field larger than 200KB (don't bloat the manifest)
const TOTAL_CAP = 1000000;     // ~1MB total draft budget per surface

// pathOf(el) — a stable-ish selector path: id-anchored where possible, else an nth-of-type chain up to the
// nearest id or <body>. Round-trips through document.querySelector (byPath). Pure: only reads tagName / id /
// previousElementSibling / parentElement, so it is node-witnessable with plain fakes.
export function pathOf(el) {
  if (!el || el.nodeType !== 1) return null;
  const esc = (s) => (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  if (el.id) return "#" + esc(el.id);
  const seg = [];
  let e = el, hops = 0;
  while (e && e.nodeType === 1 && e.tagName !== "HTML" && hops < 40) {
    if (e.id) { seg.unshift("#" + esc(e.id)); break; }
    const tag = String(e.tagName || "").toLowerCase();
    if (!tag) break;
    let i = 1, s = e;
    while ((s = s.previousElementSibling)) { if (s.tagName === e.tagName) i++; }
    seg.unshift(tag + ":nth-of-type(" + i + ")");
    e = e.parentElement; hops++;
  }
  return seg.length ? seg.join(">") : null;
}

function byPath(doc, path) {
  try { if (path === "") return doc.scrollingElement || doc.documentElement; return doc.querySelector(path); } catch (e) { return null; }
}

// capture(win) → { v, scroll?, text? } | null. Wrapped: cross-origin access throws → null.
export function capture(win) {
  try {
    const doc = win && win.document; if (!doc) return null;
    const out = { v: 1 };
    const se = doc.scrollingElement || doc.documentElement;
    const scroll = [];
    if (se && ((se.scrollTop | 0) > 0 || (se.scrollLeft | 0) > 0)) scroll.push(["", se.scrollTop | 0, se.scrollLeft | 0]);
    let n = 0;
    const all = doc.querySelectorAll("*");
    for (const el of all) {
      if (n >= MAX_SCROLLS) break;
      if (el === se) continue;
      const t = el.scrollTop | 0, l = el.scrollLeft | 0;
      if (t > 0 || l > 0) { const p = pathOf(el); if (p) { scroll.push([p, t, l]); n++; } }
    }
    if (scroll.length) out.scroll = scroll;

    const text = []; let total = 0, m = 0;
    const fields = doc.querySelectorAll('textarea, [contenteditable=""], [contenteditable="true"]');
    for (const el of fields) {
      if (m >= MAX_TEXTS || total >= TOTAL_CAP) break;
      const isTa = el.tagName === "TEXTAREA";
      const val = isTa ? (el.value || "") : (el.innerHTML || "");
      if (!val || val.length > MAX_TEXT_LEN) continue;
      const p = pathOf(el); if (!p) continue;
      text.push([p, isTa ? "ta" : "ce", val]); total += val.length; m++;
    }
    if (text.length) out.text = text;

    return (out.scroll || out.text) ? out : null;
  } catch (e) { return null; }   // no same-origin access → honest null
}

// apply(win, snap) → boolean. Drafts FIRST (so scroll targets exist), then scroll. Defensive: only fill a
// draft field that is currently EMPTY (never clobber content the app itself restored or the user is typing).
export function apply(win, snap) {
  try {
    const doc = win && win.document; if (!doc || !snap) return false;
    if (Array.isArray(snap.text)) for (const [p, kind, val] of snap.text) {
      const el = byPath(doc, p); if (!el) continue;
      try {
        if (kind === "ta") { if (el.value == null || el.value === "") el.value = val; }
        else { if (!String(el.innerHTML || "").trim()) el.innerHTML = val; }
      } catch (e) {}
    }
    if (Array.isArray(snap.scroll)) for (const [p, t, l] of snap.scroll) {
      try { const el = byPath(doc, p); if (el) { el.scrollTop = t | 0; el.scrollLeft = l | 0; } } catch (e) {}
    }
    return true;
  } catch (e) { return false; }
}

export default { pathOf, capture, apply };
