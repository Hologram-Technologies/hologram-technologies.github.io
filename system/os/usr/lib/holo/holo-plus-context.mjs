// holo-plus-context.mjs — "The + Everywhere" A2: CONTEXT CAPTURE. When you invoke the "+", what you get back
// should be ranked to what you are doing RIGHT NOW — not a generic brief. This assembles the LOCAL SURFACE context
// the "+" hands to runPlus: which app you're in, the text already in the box, your current Q turn, the route. A3
// uses it to rank insights; the same source dropped in two places then surfaces two different things.
//
// LOCKED SCOPE (the privacy decision): the default context is the LOCAL surface only. User memory / history is an
// OPT-IN upgrade — passed explicitly via { memory } — never collected by default. Pure + injectable (win/doc/target
// and the app/Q resolvers are parameters) so it is Node-witnessable and never throws on missing globals.

// where am I? — the active app id, resolved from the most specific signal available, else null (never throws).
export function defaultAppOf(win, doc) {
  try {
    if (win && win.HoloApp && win.HoloApp.id) return String(win.HoloApp.id);
    if (win && win.HoloShell && win.HoloShell.activeApp) return String(win.HoloShell.activeApp);
    const path = (win && win.location && win.location.pathname) || "";
    const m = /\/apps\/([^/]+)/.exec(path);
    if (m) return m[1];
    if (doc && doc.title) return String(doc.title);
  } catch { /* fall through */ }
  return null;
}

// which Q conversation is focused? — null when Q isn't present (graceful; voice + text share this id in A4).
export function defaultQOf(win) {
  try {
    const q = win && (win.Q || win.HoloQ);
    if (!q) return null;
    return q.conversationId || (q.activeConversation && q.activeConversation.id) || (q.conversation && q.conversation.id) || null;
  } catch { return null; }
}

// the text already in the invoking box (input value, or contenteditable text), trimmed + capped.
function readInputText(target, maxText) {
  if (!target) return "";
  let t = "";
  try {
    if (target.isContentEditable === true || (typeof target.getAttribute === "function" && target.getAttribute("contenteditable") != null)) t = target.textContent || "";
    else t = target.value != null ? String(target.value) : (target.textContent || "");
  } catch { t = ""; }
  return String(t).trim().slice(0, maxText);
}

// captureContext({ target, win, doc, appOf, qOf, memory, maxText }) → the local-surface context object.
// memory (OPT-IN): pass a memory handle/summary to enrich ranking with history; omitted → context.memory stays null.
export function captureContext({
  target = null,
  win = (typeof window !== "undefined" ? window : null),
  doc = (typeof document !== "undefined" ? document : null),
  appOf = defaultAppOf, qOf = defaultQOf, memory = null, maxText = 2000,
} = {}) {
  const tag = target ? String(target.tagName || "").toLowerCase() : null;
  return {
    activeApp: appOf(win, doc),
    route: (win && win.location && win.location.pathname) || null,
    inputText: readInputText(target, maxText),
    inputKind: tag,
    qConversationId: qOf(win),
    memory: memory || null,         // null unless the caller opts in — the local surface is the default
    surface: "local",
  };
}

// contextTerms(ctx) → a deduped, lowercased keyword set drawn from the surface (app + input text + memory hints).
// This is the cheap, deterministic relevance signal A3's baseline ranker scores insights against (Q does it better).
export function contextTerms(ctx) {
  if (!ctx) return [];
  const bag = [];
  if (ctx.activeApp) bag.push(String(ctx.activeApp));
  if (ctx.inputText) bag.push(ctx.inputText);
  if (ctx.memory && typeof ctx.memory === "string") bag.push(ctx.memory);
  if (ctx.memory && Array.isArray(ctx.memory)) bag.push(ctx.memory.join(" "));
  const words = bag.join(" ").toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || [];
  return [...new Set(words)];
}

// ── A3 · CONTEXT-AWARE RANKING ──────────────────────────────────────────────────────────────────────
// rankByContext(insights, context, { scorer }) → the SAME insights, re-ordered by relevance to what the user is
// doing now, each annotated with holo:relevance ∈ [0,1]. CRUCIAL: relevance is PRESENTATION metadata — it is NOT
// part of an insight's κ identity (κ = H{kind,text,evidence}), so ranking never changes @id, never breaks
// provenance (S5), and a re-rank under a different context yields the SAME insight κs in a different order.
// No context → returned unchanged (so confidence order, applied by composeBrief, is preserved — backward compatible).
// scorer is the swappable seam: the deterministic baseline (term overlap) here; Q scores relevance in production.
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function baselineRelevance(insight, context) {
  const terms = contextTerms(context);
  if (!terms.length) return 0;
  const hay = (String(insight["schema:text"] || "") + " " + String(insight["holo:kind"] || "")).toLowerCase();
  const hits = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
  // normalise against a small cap so a couple of strong hits already mean "relevant" (not diluted by long contexts).
  return clamp01(hits / Math.min(terms.length, 4));
}

export function rankByContext(insights, context, { scorer = baselineRelevance } = {}) {
  if (!context || !Array.isArray(insights) || insights.length === 0) return insights;
  const scored = insights.map((i) => ({ i, r: clamp01(Number(scorer(i, context)) || 0) }));
  scored.sort((a, b) => (b.r - a.r) || ((b.i["holo:confidence"] || 0) - (a.i["holo:confidence"] || 0)) || (a.i["@id"] < b.i["@id"] ? -1 : 1));
  return scored.map(({ i, r }) => ({ ...i, "holo:relevance": r }));   // a COPY with relevance; κ/@id untouched
}

export default { captureContext, defaultAppOf, defaultQOf, contextTerms, rankByContext, baselineRelevance };
