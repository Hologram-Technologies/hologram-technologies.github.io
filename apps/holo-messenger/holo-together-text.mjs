// holo-together-text.mjs - TRUE collaborative text: an RGA sequence CRDT + a <textarea> binding. Unlike line-level
// LWW (which loses one side when two people edit the same line), this converges CHARACTER by character: every char has
// a unique id and is inserted AFTER a reference char; concurrent inserts at the same spot order deterministically by id,
// so all peers reach the exact same document and each person's run stays intact. Deletions are tombstones. Rides the
// same Together control channel; a late joiner pulls a snapshot. Caret is anchored to content so remote edits don't jump it.

// ── RGA core ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function makeRGA({ peerId = "p" + Math.random().toString(36).slice(2, 8) } = {}) {
  const nodes = new Map();      // id -> { id, ch, del, parent }   id = "<counter>@<peer>", parent = id | "" (root)
  const childrenOf = new Map(); // parentId -> [childId]
  const pending = [];           // ops whose parent isn't integrated yet (out-of-order delivery)
  let ctr = 0, cache = null;

  function _cmp(a, b) { const [ca, pa] = a.split("@"), [cb, pb] = b.split("@"); const na = +ca, nb = +cb; if (na !== nb) return nb - na; return pa < pb ? 1 : pa > pb ? -1 : 0; } // desc by (counter, peer)
  function _addChild(parent, id) { const a = childrenOf.get(parent) || []; a.push(id); childrenOf.set(parent, a); cache = null; }
  function _bumpFrom(id) { const c = +id.split("@")[0]; if (c > ctr) ctr = c; }

  function _integrate(node) {
    if (nodes.has(node.id)) return false;
    if (node.parent && !nodes.has(node.parent)) { pending.push({ k: "ins", ...node }); return false; }   // parent not here yet - buffer
    nodes.set(node.id, node); _addChild(node.parent || "", node.id); _bumpFrom(node.id);
    _drainPending();
    return true;
  }
  function _drainPending() {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let i = pending.length - 1; i >= 0; i--) {
        const op = pending[i];
        if (op.k === "ins" && (!op.parent || nodes.has(op.parent)) && !nodes.has(op.id)) {
          nodes.set(op.id, { id: op.id, ch: op.ch, del: !!op.del, parent: op.parent || "" }); _addChild(op.parent || "", op.id); _bumpFrom(op.id);
          pending.splice(i, 1); progressed = true;
        } else if (op.k === "del" && nodes.has(op.id)) { nodes.get(op.id).del = true; cache = null; pending.splice(i, 1); progressed = true; }
      }
    }
  }

  function materialize() {
    if (cache) return cache;
    const text = [], ids = [];
    const walk = (parent) => { const a = (childrenOf.get(parent) || []).slice().sort(_cmp); for (const id of a) { const n = nodes.get(id); if (!n.del) { text.push(n.ch); ids.push(id); } walk(id); } };
    walk("");
    cache = { text: text.join(""), ids };
    return cache;
  }

  function localInsert(parent, ch) { const id = (++ctr) + "@" + peerId; const n = { id, ch, del: false, parent: parent || "" }; nodes.set(id, n); _addChild(parent || "", id); return { k: "ins", id, ch, parent: parent || "" }; }
  function localDelete(id) { const n = nodes.get(id); if (n && !n.del) { n.del = true; cache = null; } return { k: "del", id }; }
  function applyRemote(op) { if (!op) return false; if (op.k === "ins") { _bumpFrom(op.id); return _integrate({ id: op.id, ch: op.ch, del: !!op.del, parent: op.parent || "" }); } if (op.k === "del") { const n = nodes.get(op.id); if (n) { if (!n.del) { n.del = true; cache = null; return true; } } else pending.push(op); return false; } return false; }

  function snapshot() { const a = []; for (const [, n] of nodes) a.push({ k: "ins", id: n.id, ch: n.ch, parent: n.parent, del: n.del }); return a; }
  function ingest(ops) { let any = false; for (const op of ops || []) if (applyRemote(op)) any = true; _drainPending(); return any; }

  // diff the current text against `next` and produce the minimal insert/delete ops to become `next`
  function applyLocalText(next) {
    const { text: cur, ids } = materialize();
    if (next === cur) return [];
    let p = 0; const max = Math.min(cur.length, next.length);
    while (p < max && cur[p] === next[p]) p++;
    let s = 0; while (s < cur.length - p && s < next.length - p && cur[cur.length - 1 - s] === next[next.length - 1 - s]) s++;
    const ops = [];
    for (let i = p; i < cur.length - s; i++) ops.push(localDelete(ids[i]));          // removed run → tombstones
    let after = p > 0 ? ids[p - 1] : "";
    for (let i = p; i < next.length - s; i++) { const op = localInsert(after, next[i]); ops.push(op); after = op.id; }   // inserted run → chained
    return ops;
  }

  return { peerId, materialize, applyLocalText, applyRemote, snapshot, ingest, text: () => materialize().text };
}

// ── <textarea> binding ────────────────────────────────────────────────────────────────────────────────────────────
// Same surface as the line-level binder (broadcast/relay/onMessage/requestState/destroy) so together-view.html can swap.
export function bindTextarea(textarea, { peerId, broadcast = () => {}, relay = null } = {}) {
  const rga = makeRGA({ peerId });
  let applying = false;

  function onInput() {
    if (applying) return;
    const ops = rga.applyLocalText(textarea.value);   // textarea already shows the new text - we only emit ops
    if (!ops.length) return;
    try { broadcast({ t: "txt", ops }); } catch {}
  }

  let timer = 0;
  function scheduleRender() { if (timer) return; timer = setTimeout(() => { timer = 0; render(); }, 0); }   // setTimeout, NOT rAF (rAF freezes in hidden tabs)
  function render() {
    const before = rga.materialize();                 // capture caret anchor (the id to the left of the caret)
    const sel = textarea.selectionStart, anchorId = sel > 0 ? before.ids[sel - 1] : "";
    const next = before.text;
    if (next === textarea.value) return;
    applying = true;
    textarea.value = next;
    try { const idx = anchorId ? before.ids.indexOf(anchorId) : -1; const car = idx >= 0 ? idx + 1 : Math.min(sel, next.length); textarea.setSelectionRange(car, car); } catch {}
    applying = false;
  }

  function onMessage(m) {
    if (!m) return false;
    if (m.t === "txt" && Array.isArray(m.ops)) { let any = false; for (const op of m.ops) if (rga.applyRemote(op)) any = true; if (relay) try { relay({ t: "txt", ops: m.ops }, m._from); } catch {} if (any) scheduleRender(); return any; }
    if (m.t === "txt-hello") { try { broadcast({ t: "txt-snap", ops: rga.snapshot() }); } catch {} return false; }
    if (m.t === "txt-snap") { const any = rga.ingest(m.ops); if (any) scheduleRender(); return any; }
    return false;
  }
  function requestState() { try { broadcast({ t: "txt-hello" }); } catch {} }

  textarea.addEventListener("input", onInput);
  render();
  return { rga, onMessage, requestState, render, text: () => rga.text(), destroy() { try { textarea.removeEventListener("input", onInput); } catch {} } };
}
