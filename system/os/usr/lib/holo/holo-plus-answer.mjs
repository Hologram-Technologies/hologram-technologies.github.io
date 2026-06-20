// holo-plus-answer.mjs — "The + Everywhere" A5: OMNI-BAR FIRST-CLASS. A drop in the home omni search bar isn't a
// side panel — it surfaces as a PROACTIVE Q ANSWER (the "AI Mode" analog in the mockup), already ranked to what you
// typed, every line click-through to evidence, and it ALSO grounds Q (A4) so you can just keep talking. The omni
// bar is detected by the same left-anchor signal the "+" used (A0), so no new wiring. Pure render-model + browser
// renderer; the answer object is what the home surface paints. Reuses anchorSide (A0) and groundingFrom (A4).

import { anchorSide } from "./holo-plus-ambient.mjs";
import { groundingFrom } from "./holo-plus-q.mjs";

// isOmniSurface(el) — the omni bar is exactly the surface that anchors the "+" on the LEFT (A0's rule).
export const isOmniSurface = (el) => anchorSide(el) === "left";

// asQAnswer(result, { context, max }) → the proactive-answer render-model. Lines are already in the result's
// context-ranked order (A3), so the most relevant insight leads. answeredWithoutQuery flags the magic: no query
// was typed — the act of dropping produced the answer.
export function asQAnswer(result = {}, { context = null, max = 6 } = {}) {
  const items = (result.brief && result.brief["holo:items"]) || result.insights || [];
  const lines = items.slice(0, max).map((i) => ({
    text: i["schema:text"], kind: i["holo:kind"], confidence: i["holo:confidence"] || 0,
    relevance: i["holo:relevance"] || 0, insight: i["@id"], evidence: i["holo:evidence"] || [], sources: i["prov:wasDerivedFrom"] || [],
  }));
  const n = items.length;
  const subj = (context && context.inputText) ? ` about “${String(context.inputText).slice(0, 60)}”` : "";
  const lead = n
    ? `Here's what I found${subj}: ${n} thing${n > 1 ? "s" : ""} worth your attention, most relevant first:`
    : `I ingested what you added (${result.graph ? result.graph["holo:stats"].entities : 0} entities) but found nothing yet worth flagging.`;
  return {
    "@type": ["holo:QAnswer"], via: "the+/omni",
    title: (result.brief && result.brief["schema:name"]) || "What the + found",
    lead, lines,
    investigation: (result.investigation && result.investigation["holo:root"]) || null,
    brief: (result.brief && result.brief["@id"]) || null,
    answeredWithoutQuery: true,
  };
}

// ── browser renderer: paint the answer card, click-through evidence, into a home slot below the omni bar ──
const ESC = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
export function renderAnswer(host, answer) {
  if (!host) return;
  host.innerHTML = `<div class="holo-plus-answer" data-holo-plus-ui="1">
    <div class="lead">${ESC(answer.lead)}</div>
    ${answer.lines.map((l, n) => `<div class="ans-ln ${l.kind === "single-source-risk" ? "risk" : ""}">
        <span class="i">${n + 1}.</span> ${ESC(l.text)}
        <span class="meta" data-ev="${n}">${(l.confidence * 100) | 0}% · ${l.sources.length} src · trace ▸</span>
        <div class="ev" hidden>${l.evidence.map((k) => `<div>${ESC(k)}</div>`).join("")}</div>
      </div>`).join("")}
    ${answer.investigation ? `<div class="foot">one pinnable investigation · <span class="holo-k" data-holo-kappa="${answer.investigation}">${ESC(answer.investigation.slice(0, 24))}…</span></div>` : ""}
  </div>`;
  host.querySelectorAll(".meta[data-ev]").forEach((m) => m.addEventListener("click", () => { const ev = m.parentElement.querySelector(".ev"); if (ev) ev.hidden = !ev.hidden; }));
}

// ── self-init: an omni-bar drop → render the proactive answer in the home answer slot + ground Q ────
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const W = window;
  if (!W.HoloPlusAnswer) {
    W.HoloPlusAnswer = { asQAnswer, isOmniSurface, renderAnswer };
    document.addEventListener("holo-plus-result", async (e) => {
      const d = e.detail || {}; const target = d.target;
      if (!target || !isOmniSurface(target)) return;                 // only the omni bar gets the answer-card treatment
      const answer = asQAnswer(d.result, { context: d.result && d.result.context });
      // find (or create) the home answer slot directly below the omni bar
      let slot = document.getElementById("holo-plus-answer-slot");
      if (!slot) { slot = document.createElement("div"); slot.id = "holo-plus-answer-slot"; (target.closest("form, .omni, header, body") || document.body).appendChild(slot); }
      renderAnswer(slot, answer);
      // A4: a proactive answer is also grounding — keep talking to Q about it
      try { const { fuseToQ, detectQBus } = await import("./holo-plus-q.mjs"); await fuseToQ({ result: d.result, context: d.result && d.result.context, qBus: detectQBus(W) }); } catch {}
    });
  }
}

export default { asQAnswer, isOmniSurface, renderAnswer };
