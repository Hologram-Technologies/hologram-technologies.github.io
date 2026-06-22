// holo-q-canvas-edit.mjs — direct manipulation on the live canvas (S3), unified with prompt editing. A gesture
// on a rendered element (edit its text inline, restyle it with a --holo-* token, drag/resize it) is a PURE
// transform that yields new element HTML, fed through the SAME κ-DAG mutation as a follow-up prompt
// (holo-q-app-dag.editAtPath). So both edit doors — speak or touch — converge on the identical new κ; they are
// one operation, interchangeable mid-build. Restyle gestures accept ONLY design tokens (beauty stays an
// invariant). Undo/redo is just walking the immutable root-κ history (old versions never leave the store, L3).
// Pure + sync → Node-witnessed; the browser layer attaches the handles and calls these.
//
//   applyGesture(root, store, path, gesture) -> { root, store, edited }   // gesture: (elHtml)->elHtml'
//   gestureSetText(html, text)               -> html'                     // inline text edit
//   gestureSetStyle(html, decls)             -> html'                     // {prop:tokenValue,…}, tokens only
//   gestureMove(html, x, y) / gestureResize(html, w, h)                   // drag / resize → transform/size
//   createHistory(rootκ)                     -> { root, push, undo, redo, … }
//   kAtPath(root, store, path)               -> κ at that path

import { recompose, editAtPath } from "./holo-q-app-dag.mjs";

const escapeText = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// a restyle value must be a design token — var(--holo-*), or a holo-token keyword/number-with-unit — never a
// raw hex/rgb. This keeps direct manipulation on-brand (Part 3.D: beauty by construction).
const TOKEN_RE = /^(var\(--holo-[\w-]+\)|--holo-[\w-]+|[\d.]+(px|rem|em|%|deg|fr|vh|vw)|0|translate\(-?[\d.]+px,\s*-?[\d.]+px\)|none|auto)$/;
const isToken = (v) => TOKEN_RE.test(String(v).trim());

function tagEnd(s, lt) { let q = null; for (let i = lt + 1; i < s.length; i++) { const c = s[i]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === ">") return i; } return -1; }

// split a single element's html into { open, inner, close, selfClose } — quote-aware, so attrs with '>' are safe.
function splitElement(html) {
  const s = String(html);
  if (s[0] !== "<") return null;
  const ge = tagEnd(s, 0); if (ge === -1) return null;
  const open = s.slice(0, ge + 1);
  if (/\/\s*>$/.test(open)) return { open, inner: null, close: "", selfClose: true };
  const cm = /<\/[a-zA-Z][\w:-]*\s*>\s*$/.exec(s);
  if (!cm) return { open, inner: null, close: "", selfClose: true };   // void-like / no close → treat as no inner
  return { open, inner: s.slice(ge + 1, s.length - cm[0].length), close: cm[0], selfClose: false };
}

function setStyleOnOpenTag(open, decls) {
  const styleRe = /\sstyle\s*=\s*"([^"]*)"/i;
  const cur = styleRe.test(open) ? styleRe.exec(open)[1] : "";
  const map = {};
  cur.split(";").forEach((d) => { const c = d.indexOf(":"); if (c > 0) map[d.slice(0, c).trim()] = d.slice(c + 1).trim(); });
  for (const k of Object.keys(decls)) map[k] = decls[k];
  const serial = Object.keys(map).map((k) => `${k}:${map[k]}`).join(";");
  if (styleRe.test(open)) return open.replace(styleRe, ` style="${serial}"`);
  const sc = /\/>$/.test(open);
  return open.slice(0, open.length - (sc ? 2 : 1)) + ` style="${serial}"` + (sc ? "/>" : ">");
}

export function gestureSetText(html, text) {
  const p = splitElement(html);
  if (!p || p.inner === null) return html;              // self-close/void → nothing to retext
  return p.open + escapeText(text) + p.close;
}

export function gestureSetStyle(html, decls) {
  for (const [k, v] of Object.entries(decls)) if (!isToken(v)) throw new Error(`restyle rejected: ${k}:${v} is not a --holo-* token (beauty stays an invariant)`);
  const p = splitElement(html);
  if (!p) return html;
  return setStyleOnOpenTag(p.open, decls) + (p.inner || "") + p.close;
}

export const gestureMove = (html, x, y) => gestureSetStyle(html, { transform: `translate(${x}px, ${y}px)` });
export const gestureResize = (html, w, h) => gestureSetStyle(html, { width: w, height: h });

export function kAtPath(root, store, path) {
  let k = root;
  for (const i of path) { const d = store[k]; if (!d || !d.k) return null; k = d.k[i]; }
  return k;
}

// the ONE mutation both doors share: resolve the element, run the gesture, edit the DAG. A prompt that produces
// the same element HTML calls editAtPath directly with that HTML — identical result κ. Speak == touch.
export function applyGesture(root, store, path, gesture) {
  const k = kAtPath(root, store, path);
  if (k == null) throw new Error("no node at path " + JSON.stringify(path));
  const after = gesture(recompose(k, store));
  return editAtPath(root, store, path, after);
}

// immutable root-κ history: every version is a re-derivable root; undo/redo just move the cursor. Old roots
// stay in the store (Law L3) — undo never loses anything, redo re-derives the exact same bytes.
export function createHistory(initialRoot) {
  const past = [initialRoot]; let idx = 0;
  return {
    root: () => past[idx],
    push: (root) => { past.length = idx + 1; past.push(root); idx = past.length - 1; return root; },
    undo: () => { if (idx > 0) idx--; return past[idx]; },
    redo: () => { if (idx < past.length - 1) idx++; return past[idx]; },
    canUndo: () => idx > 0,
    canRedo: () => idx < past.length - 1,
    versions: () => past.slice(),
  };
}

export default { applyGesture, gestureSetText, gestureSetStyle, gestureMove, gestureResize, kAtPath, createHistory };
