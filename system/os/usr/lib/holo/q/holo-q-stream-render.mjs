// holo-q-stream-render.mjs — the streaming-safe renderer for Create's "watch it build" (S1). The coder
// streams an HTML document token-by-token; to show it assembling SMOOTHLY (not in closing-tag chunks) the
// preview must render a SAFE, well-formed document at EVERY increment. This is the forgiving normalizer that
// makes that safe: given any PREFIX of an HTML document (mid-tag, mid-attribute, mid-script), it returns a
// balanced, renderable document — incomplete trailing markup dropped, every open tag auto-closed, and a
// half-written <script>/<style> DEFERRED (never rendered partially, so nothing executes broken or flashes).
//
//   streamSafeDocument(partialHtml) -> string   (a balanced doc safe to mount at this instant)
//   tagStructure(html) -> { balanced:boolean, openLeft:string[], incompleteRaw:boolean, text:string }
//
// Pure string transform — Node-witnessed. The browser layer mounts each snapshot (or diff-patches the live
// DOM); this guarantees the snapshot is never corrupt. Properties the witness enforces: (1) every prefix
// normalizes to a BALANCED doc; (2) a mid-script prefix contains NO <script> (deferred); (3) the full doc is
// preserved (identity); (4) visible text grows MONOTONICALLY in stream order (no flicker/regress).

const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const RAW = new Set("script style textarea title".split(" "));   // raw-text: '<' inside is literal until the close

// find a tag's closing '>' while respecting quoted attribute values (so `<a title="a>b">` isn't cut early).
function findTagEnd(s, lt) {
  let q = null;
  for (let i = lt + 1; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === ">") return i;
  }
  return -1;
}

// core scan, shared by the normalizer and the validator. cb gets each event; returns the open-tag stack and
// whether the tail was an incomplete tag/comment/raw block (which the normalizer drops).
function scan(s, onText, onTag) {
  const stack = [];
  let i = 0, incompleteTail = false;
  const n = s.length;
  while (i < n) {
    const lt = s.indexOf("<", i);
    if (lt === -1) { onText(s.slice(i)); break; }
    if (lt > i) onText(s.slice(i, lt));
    if (s.startsWith("<!--", lt)) {                          // comment
      const end = s.indexOf("-->", lt + 4);
      if (end === -1) { incompleteTail = true; break; }
      onTag({ kind: "comment", raw: s.slice(lt, end + 3) }); i = end + 3; continue;
    }
    if (s.startsWith("<!", lt)) {                            // doctype / declaration
      const gt = findTagEnd(s, lt);
      if (gt === -1) { incompleteTail = true; break; }
      onTag({ kind: "decl", raw: s.slice(lt, gt + 1) }); i = gt + 1; continue;
    }
    const gt = findTagEnd(s, lt);
    if (gt === -1) { incompleteTail = true; break; }          // incomplete tag at the tail → drop it
    const raw = s.slice(lt, gt + 1);
    const m = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(raw);
    if (!m) { onText(raw); i = gt + 1; continue; }            // stray '<' that isn't a tag → treat as text
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const selfClose = /\/\s*>$/.test(raw) || VOID.has(tag);
    if (closing) {                                            // scan owns the stack: pop to the match, report what closed
      const idx = stack.lastIndexOf(tag);
      let closed = [];
      if (idx !== -1) { closed = stack.slice(idx).reverse(); stack.length = idx; }   // this tag + any implicitly-open descendants, in close order
      onTag({ kind: "close", tag, closed, raw }); i = gt + 1; continue;
    }
    if (RAW.has(tag)) {                                       // raw-text element: need its matching close
      const closeRe = new RegExp("</\\s*" + tag + "\\s*>", "i");
      const rest = s.slice(gt + 1);
      const cm = closeRe.exec(rest);
      if (!cm) { incompleteTail = true; break; }              // half a <script>/<style> → defer (drop)
      onTag({ kind: "raw", tag, raw: raw + rest.slice(0, cm.index + cm[0].length) });
      i = gt + 1 + cm.index + cm[0].length; continue;
    }
    onTag({ kind: "open", tag, raw, selfClose, stack });
    if (!selfClose) stack.push(tag);
    i = gt + 1;
  }
  return { stack, incompleteTail };
}

export function streamSafeDocument(partialHtml) {
  const s = String(partialHtml == null ? "" : partialHtml);
  let out = "";
  const { stack } = scan(
    s,
    (text) => { out += text; },
    (ev) => {
      if (ev.kind === "close") { for (const t of ev.closed) out += "</" + t + ">"; }   // scan computed the closers; stray close → empty → dropped
      else out += ev.raw;                                     // open/void/raw/comment/decl emit verbatim
    }
  );
  for (let k = stack.length - 1; k >= 0; k--) out += "</" + stack[k] + ">";   // auto-close everything still open
  return out;
}

// validator for witnesses: re-scan and report whether `html` is balanced (no open tags left, no incomplete tail).
export function tagStructure(html) {
  let text = "";
  const { stack, incompleteTail } = scan(String(html || ""), (t) => { text += t; }, (ev) => { if (ev.kind === "raw" || ev.kind === "open" || ev.kind === "comment" || ev.kind === "decl") {/* structural */} });
  return { balanced: stack.length === 0 && !incompleteTail, openLeft: stack.slice(), incompleteRaw: incompleteTail, text };
}

// visibleText(html) — the rendered text content (tags stripped, raw script/style bodies removed) — for the
// monotonicity witness: as the stream grows, visible text must only grow, in order.
export function visibleText(html) {
  let text = "";
  scan(String(html || ""), (t) => { text += t; }, (ev) => { /* tags + raw bodies contribute no visible text */ });
  return text.replace(/\s+/g, " ").trim();
}

export default { streamSafeDocument, tagStructure, visibleText };
