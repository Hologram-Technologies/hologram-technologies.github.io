// holo-plus-route.mjs — "The + Everywhere" A6: RESULT ROUTING. Where does what the "+" found actually go? The
// locked behavior: a drop in the OMNI bar becomes a proactive answer card (A5); a drop in an ORDINARY text input
// becomes a lightweight context CHIP inserted beside the box (with "see full brief"); a VOICE "add this" GROUNDS Q
// (A4). The invariant that makes it feel native: routing NEVER mutates or blocks the input — the chip is additive,
// the typing flow is untouched. Intent-routed, pure + injectable sinks → Node-witnessable; browser binds the sinks.

import { isOmniSurface, asQAnswer } from "./holo-plus-answer.mjs";
import { groundingFrom } from "./holo-plus-q.mjs";

// decideRoute(target, { intent }) → "answer" | "chip" | "ground".
//   omni bar                    → "answer"  (A5 proactive card)
//   explicit ground intent      → "ground"  (voice "add this" → Q grounding, A4)
//   any other text input        → "chip"    (additive context chip; the default, least-disruptive)
export function decideRoute(target, { intent = null } = {}) {
  if (intent === "ground") return "ground";
  if (target && isOmniSurface(target)) return "answer";
  return "chip";
}

// chipModel(result, context) → the lightweight inline chip. Names the count + the most-relevant finding, and
// carries the brief κ + investigation root so "see full brief" / pin can open the whole thing. Tiny by design.
export function chipModel(result = {}, context = null) {
  const items = (result.brief && result.brief["holo:items"]) || result.insights || [];
  const n = items.length;
  const top = items[0] || null;
  const label = n ? `+ ${n} insight${n > 1 ? "s" : ""} ready` : `+ added · ${result.graph ? result.graph["holo:stats"].entities : 0} entities`;
  return {
    "@type": ["holo:ContextChip"], label,
    brief: (result.brief && result.brief["@id"]) || null,
    investigation: (result.investigation && result.investigation["holo:root"]) || null,
    insightCount: n, top: top && top["schema:text"], via: "the+",
  };
}

// routeResult({ target, result, context, intent, sinks }) → { mode, payload }. Dispatches the payload to the
// matching sink (sinks.answer | sinks.chip | sinks.ground). PURE w.r.t. the input — it never reads or writes
// target.value, so the user's typing is never disturbed (the chip/answer render adjacent; grounding goes to Q).
export function routeResult({ target = null, result = {}, context = null, intent = null, sinks = {} } = {}) {
  const mode = decideRoute(target, { intent });
  const payload =
    mode === "answer" ? asQAnswer(result, { context }) :
    mode === "ground" ? groundingFrom(result, context) :
    chipModel(result, context);
  const sink = sinks[mode];
  if (typeof sink === "function") { try { sink(payload, { target, result, context, mode }); } catch { /* a sink failure never blocks the input */ } }
  return { mode, payload };
}

// ── browser: render the additive context chip beside an ordinary input; "see full brief" opens the brief ──
const ESC = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
export function renderChip(target, chip, { doc = document, win = window } = {}) {
  if (!target || !doc) return null;
  const el = doc.createElement("span");
  el.className = "holo-plus-chip"; el.setAttribute("data-holo-plus-ui", "1");
  el.style.cssText = "position:absolute;z-index:2147483600;display:inline-flex;align-items:center;gap:.4rem;"
    + "background:color-mix(in srgb,var(--holo-accent,#ff5c8a) 16%,var(--holo-surface,#11141c));color:var(--holo-ink,#e8ecf5);"
    + "border:1px solid var(--holo-border,#222838);border-radius:999px;padding:.15rem .5rem;font:600 .76rem ui-sans-serif;cursor:pointer;max-width:60vw;";
  el.innerHTML = `<b style="color:var(--holo-accent,#ff5c8a)">${ESC(chip.label)}</b>${chip.top ? `<span style="opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ESC(chip.top)}</span>` : ""}<span style="opacity:.6">· brief ▸</span>`;
  const r = target.getBoundingClientRect ? target.getBoundingClientRect() : { bottom: 30, left: 8 };
  el.style.top = ((win.scrollY || 0) + r.bottom + 4) + "px";
  el.style.left = ((win.scrollX || 0) + (r.left || 8)) + "px";
  el.addEventListener("click", () => target.dispatchEvent(new win.CustomEvent("holo-plus-open-brief", { bubbles: true, detail: { brief: chip.brief, investigation: chip.investigation } })));
  (doc.body || doc.documentElement).appendChild(el);
  return el;   // additive overlay — the input's value/focus are never touched
}

// ── self-init: route NON-omni results to a chip (A5 already handles omni → answer). One listener, clean split. ──
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const W = window;
  if (!W.HoloPlusRoute) {
    W.HoloPlusRoute = { decideRoute, chipModel, routeResult, renderChip };
    document.addEventListener("holo-plus-result", (e) => {
      const d = e.detail || {}; const target = d.target;
      if (!target || isOmniSurface(target)) return;                  // omni → A5's answer card; here we do the chip
      routeResult({ target, result: d.result, context: d.result && d.result.context, sinks: { chip: (chip) => renderChip(target, chip) } });
    });
  }
}

export default { decideRoute, chipModel, routeResult, renderChip };
