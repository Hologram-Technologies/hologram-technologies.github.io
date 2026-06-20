// holo-plus-ambient.mjs — "THE + EVERYWHERE" (A0). The ambient layer that puts a small, near-invisible "+" on
// the omni search bar AND every text input across the whole OS — injected by usr/share/frame/shell.html into
// EVERY document, exactly like holo-sound.mjs, with ZERO per-app edits. Clicking the "+" (A1 fills this in) opens
// the upload / link / holo-object intake; A0's job is only to make the affordance appear correctly, everywhere,
// once, additively, and never disturb the input it sits beside.
//
// DESIGN MIRRORS holo-sound: one per-document router, a MutationObserver for late-mounted inputs, armed only
// AFTER a user gesture (no layout thrash on load; invisible until wanted), idempotent (never two "+" on one box),
// and additive (an absolutely-positioned overlay button — it never wraps, reflows, or steals focus from the input).
//
// PURE CORE (isEligibleInput, the attach registry, the arm guard) is dependency-injected so it is Node-witnessable
// without a real DOM; the browser auto-init at the bottom binds it to the live document. Law L2: one canonical wire.

// ── pure: is this element an eligible text surface for the "+"? ─────────────────────────────────────
// Eligible: <textarea>, text-like <input> (text/search/url/email/tel/number or no type), and [contenteditable].
// Skipped: password/hidden/checkbox/radio/file/submit/button inputs, our own "+" button, anything opted out
// with [data-holo-plus-skip], and elements inside the "+" popover (data-holo-plus-ui).
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel", "number", "", null, undefined]);
// attr(el, n) — the raw attribute value, or null if ABSENT. Must NOT coalesce ""→null: an empty-string flag
// (data-holo-plus-skip="", data-omni="") is PRESENT, and presence is what these checks test (Law: be literal).
const attrOf = (el, n) => {
  const v = (typeof el.getAttribute === "function") ? el.getAttribute(n) : (el.attributes ? el.attributes[n] : undefined);
  return v === undefined ? null : v;
};
export function isEligibleInput(el) {
  if (!el || typeof el !== "object") return false;
  const tag = String(el.tagName || "").toLowerCase();
  const attr = (n) => attrOf(el, n);
  if (attr("data-holo-plus-skip") != null || attr("data-holo-plus-ui") != null || attr("data-holo-plus") != null) return false;
  if (tag === "textarea") return true;
  if (el.isContentEditable === true || attr("contenteditable") === "" || String(attr("contenteditable")).toLowerCase() === "true") return true;
  if (tag === "input") {
    const type = (attr("type") || "").toLowerCase();
    return TEXT_INPUT_TYPES.has(type);
  }
  return false;
}

// classifyAnchor — the omni search bar gets the "+" on the LEFT (the mockup); ordinary inputs get it on the RIGHT.
// Detected by role=search / type=search / a data-omni marker — advisory only (placement, never eligibility).
export function anchorSide(el) {
  const attr = (n) => attrOf(el, n);
  const isOmni = attr("data-omni") != null || (attr("type") || "").toLowerCase() === "search" || attr("role") === "search";
  return isOmni ? "left" : "right";
}

// ── makeAmbient — the driver. DOM ops are injected (mkButton/mount/origin/now) so the core is witnessable. ──
// onInvoke(el, { side }) is called on "+" activation (A1 supplies the popover; A0's default just emits an event).
export function makeAmbient({
  doc = (typeof document !== "undefined" ? document : null),
  win = (typeof window !== "undefined" ? window : null),
  onInvoke = null,
  mkButton = null,     // () => buttonEl   (injected in the witness)
  mount = null,        // (inputEl, buttonEl, side) => void
  armed = false,       // post-gesture guard; the browser path arms on first gesture
} = {}) {
  const attached = new Set();        // input elements that already carry a "+"
  let _armed = armed;

  const defaultMkButton = () => {
    const b = doc.createElement("button");
    b.type = "button"; b.textContent = "+"; b.className = "holo-plus-btn";
    b.setAttribute("data-holo-plus-ui", "1"); b.setAttribute("aria-label", "Add — upload, link, or attach a holo object");
    b.tabIndex = -1;   // additive: never in the input's tab order
    return b;
  };
  const defaultMount = (input, btn, side) => {
    // additive overlay: position:absolute relative to the input's offset parent, no wrapping, no reflow.
    btn.style.cssText = `position:absolute;z-index:2147483600;width:22px;height:22px;display:grid;place-items:center;`
      + `border:0;border-radius:7px;background:transparent;color:var(--holo-accent,#ff5c8a);font:900 16px/1 ui-sans-serif;`
      + `opacity:.35;cursor:pointer;transition:opacity .12s;`;
    btn.addEventListener("pointerenter", () => (btn.style.opacity = "1"));
    btn.addEventListener("pointerleave", () => (btn.style.opacity = ".35"));
    const place = () => {
      const r = input.getBoundingClientRect ? input.getBoundingClientRect() : { top: 0, left: 0, right: 0, bottom: 0, height: 22, width: 0 };
      const sx = win.scrollX || 0, sy = win.scrollY || 0;
      btn.style.top = (sy + r.top + (r.height - 22) / 2) + "px";
      btn.style.left = (side === "left" ? sx + r.left + 6 : sx + r.right - 28) + "px";
    };
    (doc.body || doc.documentElement).appendChild(btn);
    place();
    win.addEventListener("scroll", place, { passive: true });
    win.addEventListener("resize", place, { passive: true });
  };

  const _mkButton = mkButton || defaultMkButton;
  const _mount = mount || defaultMount;

  function attach(el) {
    if (!_armed) return false;                         // guard: nothing before a user gesture
    if (!isEligibleInput(el)) return false;
    if (attached.has(el)) return false;                // idempotent: never a second "+"
    if (typeof el.setAttribute === "function") el.setAttribute("data-holo-plus", "1");
    const side = anchorSide(el);
    const btn = _mkButton(el, side);
    const invoke = (e) => { if (e && e.preventDefault) e.preventDefault(); fire(el, side); };
    if (btn && typeof btn.addEventListener === "function") btn.addEventListener("click", invoke);
    _mount(el, btn, side);
    attached.add(el);
    return true;
  }

  function fire(el, side) {
    if (typeof onInvoke === "function") return onInvoke(el, { side });
    // A0 default: emit a DOM event A1 (the popover) will listen for — keeps A0 free of intake UI.
    if (win && typeof win.CustomEvent === "function" && el.dispatchEvent)
      el.dispatchEvent(new win.CustomEvent("holo-plus-invoke", { bubbles: true, detail: { side } }));
  }

  // scan(root) — adorn every currently-eligible input under root. Returns how many NEW "+" were attached.
  function scan(root) {
    root = root || doc;
    if (!root || typeof root.querySelectorAll !== "function") return 0;
    let n = 0;
    for (const el of root.querySelectorAll("textarea, input, [contenteditable]")) if (attach(el)) n++;
    return n;
  }

  function arm() { _armed = true; return scan(); }     // call on first gesture → adorn what's already there
  function observe(root) {                              // adorn late-mounted inputs (SPA navigations, etc.)
    root = root || doc;
    if (!win || typeof win.MutationObserver !== "function") return null;
    const mo = new win.MutationObserver((muts) => { if (_armed) for (const m of muts) for (const node of m.addedNodes || []) {
      if (node && node.querySelectorAll) scan(node);
      if (node && isEligibleInput(node)) attach(node);
    } });
    mo.observe(root.body || root.documentElement || root, { childList: true, subtree: true });
    return mo;
  }

  return { attach, scan, arm, observe, fire, attached, isEligibleInput, get armed() { return _armed; } };
}

// ── browser auto-init: one per document, armed on first gesture, observing for late inputs (like holo-sound) ──
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const W = window;
  if (!W.HoloPlus) {
    const ambient = makeAmbient({});
    W.HoloPlus = ambient;
    const armOnce = () => { ambient.arm(); ambient.observe(); ["pointerdown", "keydown", "touchstart"].forEach((e) => W.removeEventListener(e, armOnce, true)); };
    ["pointerdown", "keydown", "touchstart"].forEach((e) => W.addEventListener(e, armOnce, true));
  }
}

export default { isEligibleInput, anchorSide, makeAmbient };
