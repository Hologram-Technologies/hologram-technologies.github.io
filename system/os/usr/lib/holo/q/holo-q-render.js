// holo-q-render.js — the κ-ADDRESSED RENDERER: the layer that turns the fabric's streamed, content-κ
// output into live on-screen content, and reuses identical fragments instead of re-rendering them
// (ADR-0085's deferred render piece). Compute once, address it, render once, replay.
//
// It consumes the fabric's run() event stream: { phase:"delta", partial } paints incrementally (the
// streaming-LLM feel — the preview assembles as tokens arrive); { phase:"final", value, kappa } seals
// the fragment and caches its built node by κ. The NEXT time an identical output (same κ) appears it
// is reused in O(1) with NO rebuild — the render twin of the fabric's compute memo. Together they make
// a prompt → live preview loop where repeats are instant.
//
// SAFE by construction: it builds DOM from a STRUCTURED spec (tag/text/style/children), never raw
// innerHTML, so a model's output can't inject script (the substrate renders untrusted holospaces in a
// sandboxed frame; this is the in-frame builder). Pure-ish: the DOM is injected (a real document in
// the browser, a tiny mock in the witness), so the reuse logic is testable in Node.

// inline-style sanitizer: reject any value that can fetch/execute (url() · javascript: · expression ·
// @import · angle brackets), then require a conservative char allowlist. Returns "" when unsafe.
const STYLE_FORBID = /url\(|javascript:|expression|@import|[<>]/i;
const STYLE_OK = /^[-\w\s:#.,%/!;]*$/;
function safeStyle(s) { s = String(s); return (!STYLE_FORBID.test(s) && STYLE_OK.test(s)) ? s : ""; }

// buildNode(doc, spec) — spec: string | { tag?, text?, style?, class?, children?[] }. Structured only.
export function buildNode(doc, spec) {
  if (spec == null) return doc.createTextNode("");
  if (typeof spec === "string" || typeof spec === "number") return doc.createTextNode(String(spec));
  const el = doc.createElement(spec.tag || "div");
  if (spec.class) el.className = String(spec.class);
  if (spec.style) { const ss = safeStyle(spec.style); if (ss) el.style.cssText = ss; }
  if (spec.text != null) el.textContent = String(spec.text);
  for (const child of spec.children || []) el.appendChild(buildNode(doc, child));
  return el;
}

// createRenderer({ target, doc }) — paints fabric streams into `target`, reusing nodes by κ.
export function createRenderer({ target, doc } = {}) {
  const D = doc || (typeof document !== "undefined" ? document : null);
  if (!D) throw new Error("holo-q-render: no document (inject `doc` in a witness)");
  const root = target;
  const cache = new Map();                                           // κ → a detached template node
  const stats = { painted: 0, reused: 0, deltas: 0, lastMs: 0 };
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const finalSubs = new Set();                                       // observers of each painted fragment (Holo Perception)

  // paint one finalized fragment by its content κ — reuse if seen, else build + cache.
  function paintFinal(kappa, value, into, live) {
    let node, reused = false;
    if (kappa != null && cache.has(kappa)) { node = cache.get(kappa).cloneNode(true); reused = true; stats.reused++; }
    else { node = buildNode(D, value); if (kappa != null) cache.set(kappa, node.cloneNode(true)); stats.painted++; }
    if (live && live.parentNode === into) into.replaceChild(node, live);
    else into.appendChild(node);
    return { node, reused };
  }

  // paintStream(events, { into, id }) — consume a fabric run() async-iterable; returns a summary.
  // `id` is the logical object's stable identity; on each final fragment, onFinal subscribers fire
  // with { id, kappa, node } so Holo Perception can track the VISUAL face of that object (ADR-0086).
  async function paintStream(events, { into = root, id = null } = {}) {
    const t0 = now(); let live = null; let result = null;
    for await (const e of events) {
      if (e.phase === "delta") {                                     // streaming: grow a live text node
        if (!live) { live = D.createElement("div"); live.className = "holo-q-live"; into.appendChild(live); }
        live.textContent = typeof e.partial === "string" ? e.partial : String(e.partial ?? "");
        stats.deltas++;
      } else if (e.phase === "final") {
        result = paintFinal(e.kappa, e.value, into, live);
        result.kappa = e.kappa; result.cached = e.cached; live = null;
        for (const fn of finalSubs) { try { fn({ id, kappa: e.kappa, node: result.node, cached: e.cached }); } catch (er) {} }
      }
    }
    stats.lastMs = +(now() - t0).toFixed(2);
    return { ...result, ms: stats.lastMs, renderReused: !!(result && result.reused) };
  }
  const onFinal = (fn) => { finalSubs.add(fn); return () => finalSubs.delete(fn); };

  const clearView = () => { if (root) while (root.firstChild) root.removeChild(root.firstChild); };  // DOM only — KEEPS the κ cache (so a repeat reuses)
  return {
    paintStream, onFinal, buildNode: (spec) => buildNode(D, spec),
    stats: () => ({ ...stats, cached: cache.size }),
    clearView,
    clear: () => { cache.clear(); clearView(); },                   // DOM + κ cache
  };
}

export function describeRenderer() {
  return {
    role: "κ-addressed renderer — paints the fabric's streamed output live, reuses identical fragments by content κ (O(1) render)",
    streaming: "delta events grow a live node (the assembling preview); a final event seals + caches the built node by κ",
    safety: "structured DOM only (tag/text/style/children) — never raw innerHTML; untrusted output stays sandboxed",
    pairs: "the render twin of the fabric compute memo (ADR-0085) — compute once + render once, replay both",
  };
}

export default { buildNode, createRenderer, describeRenderer };
