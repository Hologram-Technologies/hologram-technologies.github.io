// holo-q-app-dag.mjs — an app is not one opaque HTML blob; it is a κ-DAG of addressable elements (S2). This
// decomposes a generated HTML document into a Merkle DAG where EVERY node (the app, each element, each text /
// script block) is content-addressed by its own κ (Law L1, via the substrate hash), identical subtrees are
// stored ONCE (Law L2), and the κ-store IS the app's memory + full version history (Law L3). Editing one
// element mints a NEW κ for it and re-links only its ancestors — immutable, forkable, re-derivable; siblings
// are structurally shared (untouched κ). recompose is byte-IDENTICAL to the source (exact bytes preserved per
// node), and every node re-derives to its κ (Law L5). Pure + sync → Node-witnessed; the κ are first-class
// substrate objects (same kappa() the rest of Hologram uses).
//
//   decompose(html)                  -> { root, store }          // store: { [κhex]: descriptor }
//   recompose(κ, store)              -> html                     // byte-identical for the root
//   verify(store)                    -> { ok, checked, bad[] }   // L5: every node re-derives to its κ
//   findPaths(root, store, targetκ)  -> number[][]               // index-paths where targetκ occurs
//   editAtPath(root, store, path, newHtml) -> { root, store, edited:κ }   // mint new node + re-link ancestors
//   stats(store, root)               -> { nodes, unique, dedup } // L2 dedup measured
//   kid(κhex)                        -> did:holo:blake3:<κ>      // the substrate identity form (§1.2)

import { sha256hex, jcs, didHolo } from "../holo-uor.mjs";   // sha256hex kept for legacy dual-read only
import { blake3hex } from "../holo-blake3.mjs";              // the ONE canonical κ hash (§1.2)
const b3 = (s) => blake3hex(typeof s === "string" ? new TextEncoder().encode(s) : s);

const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const RAW = new Set("script style textarea title".split(" "));

function findTagEnd(s, lt) {
  let q = null;
  for (let i = lt + 1; i < s.length; i++) { const c = s[i]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === ">") return i; }
  return -1;
}

// parse a COMPLETE html string into a node tree, preserving exact bytes so recompose is byte-identical.
// node: { t:"frag"|"el", tag?, open?, close?, children:[] } | { t:"txt"|"raw", v }
function parseTree(html) {
  const s = String(html == null ? "" : html);
  const root = { t: "frag", children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let i = 0; const n = s.length;
  while (i < n) {
    const lt = s.indexOf("<", i);
    if (lt === -1) { if (i < n) top().children.push({ t: "txt", v: s.slice(i) }); break; }
    if (lt > i) top().children.push({ t: "txt", v: s.slice(i, lt) });
    if (s.startsWith("<!--", lt)) { const e = s.indexOf("-->", lt + 4); const end = e === -1 ? n : e + 3; top().children.push({ t: "raw", v: s.slice(lt, end) }); i = end; continue; }
    if (s.startsWith("<!", lt)) { const gt = findTagEnd(s, lt); const end = gt === -1 ? n : gt + 1; top().children.push({ t: "raw", v: s.slice(lt, end) }); i = end; continue; }
    const gt = findTagEnd(s, lt);
    if (gt === -1) { top().children.push({ t: "txt", v: s.slice(lt) }); break; }
    const raw = s.slice(lt, gt + 1);
    const m = /^<\s*(\/?)\s*([a-zA-Z][\w:-]*)/.exec(raw);
    if (!m) { top().children.push({ t: "txt", v: raw }); i = gt + 1; continue; }
    const closing = m[1] === "/", tag = m[2].toLowerCase(), selfClose = /\/\s*>$/.test(raw) || VOID.has(tag);
    if (closing) {
      let idx = -1;
      for (let k = stack.length - 1; k >= 1; k--) if (stack[k].tag === tag) { idx = k; break; }
      if (idx !== -1) { while (stack.length - 1 > idx) stack.pop(); const el = stack.pop(); el.close = raw; }   // matched el closes; intermediates keep close=""
      i = gt + 1; continue;
    }
    if (RAW.has(tag)) {
      const cm = new RegExp("</\\s*" + tag + "\\s*>", "i").exec(s.slice(gt + 1));
      const block = cm ? raw + s.slice(gt + 1, gt + 1 + cm.index + cm[0].length) : s.slice(lt);
      top().children.push({ t: "raw", v: block });
      i = cm ? gt + 1 + cm.index + cm[0].length : n; continue;
    }
    const el = { t: "el", tag, open: raw, close: "", children: [] };
    top().children.push(el);
    if (!selfClose) stack.push(el);
    i = gt + 1;
  }
  return root;
}

const put = (desc, store) => { const k = b3(jcs(desc)); store[k] = desc; return k; };   // content address (L1, BLAKE3) + store (L3); identical desc → same k (L2)

// content-address a parsed tree bottom-up → returns the node's κ, filling `store`.
function address(node, store) {
  if (node.t === "txt") return put({ t: "txt", v: node.v }, store);
  if (node.t === "raw") return put({ t: "raw", v: node.v }, store);
  const k = node.children.map((c) => address(c, store));
  return put(node.t === "frag" ? { t: "frag", k } : { t: "el", o: node.open, c: node.close, k }, store);
}

export function decompose(html) {
  const store = {};
  const root = address(parseTree(html), store);
  return { root, store };
}

export function recompose(k, store) {
  const d = store[k];
  if (!d) throw new Error("κ not in store: " + k);
  if (d.t === "txt" || d.t === "raw") return d.v;
  return (d.o || "") + d.k.map((c) => recompose(c, store)).join("") + (d.c || "");
}

// L5: re-derive every node's κ from its descriptor and confirm it equals its store key.
export function verify(store) {
  const bad = []; let checked = 0;
  for (const k of Object.keys(store)) { checked++; const j = jcs(store[k]); if (b3(j) !== k && sha256hex(j) !== k) bad.push(k); }   // dual-read L5 (BLAKE3 canonical | legacy sha256)
  return { ok: bad.length === 0, checked, bad };
}

export function findPaths(root, store, targetK) {
  const out = [];
  (function walk(k, path) {
    if (k === targetK) out.push(path.slice());
    const d = store[k];
    if (d && d.k) d.k.forEach((ck, i) => walk(ck, path.concat(i)));
  })(root, []);
  return out;
}

// edit the node at `path` (array of child indices from root) to the content of `newHtml`. Mints a new κ for the
// new content and RE-LINKS each ancestor (new κ up the path); siblings keep their κ (structural sharing). The
// old κ remain in the store = immutable version history (L3) — old root still recomposes to the original.
export function editAtPath(root, store, path, newHtml) {
  const subFrag = parseTree(newHtml);
  const edited = subFrag.children.length === 1 ? address(subFrag.children[0], store) : address(subFrag, store);
  const rebuild = (k, depth) => {
    if (depth === path.length) return edited;
    const d = store[k]; const i = path[depth];
    const nk = d.k.slice(); nk[i] = rebuild(d.k[i], depth + 1);
    return put(d.t === "frag" ? { t: "frag", k: nk } : { t: "el", o: d.o, c: d.c, k: nk }, store);
  };
  return { root: rebuild(root, 0), store, edited };
}

export function stats(store, root) {
  let nodes = 0;
  (function walk(k) { nodes++; const d = store[k]; if (d && d.k) d.k.forEach(walk); })(root);
  const unique = new Set(); (function walk(k) { unique.add(k); const d = store[k]; if (d && d.k) d.k.forEach(walk); })(root);
  return { nodes, unique: unique.size, dedup: nodes - unique.size };   // dedup = node instances saved by L2 sharing
}

export const kid = (khex) => didHolo("blake3", khex);

export default { decompose, recompose, verify, findPaths, editAtPath, stats, kid };
