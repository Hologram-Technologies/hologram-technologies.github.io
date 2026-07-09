// holo-together-doc.mjs - shared state for "work together": a convergent LWW-Map CRDT synced over the Together control
// channel. Every field carries a Lamport clock + origin peer; concurrent writes resolve DETERMINISTICALLY (higher
// (clock, peer) wins), so every peer converges to the exact same state with no central authority. This is the
// foundation for co-editing a doc, a shared whiteboard/form, presence cursors - anything where peers share live state.
//
// Wiring: feed the mesh's incoming control messages to onMessage(); pass the mesh's broadcast/send as `broadcast`.
// On the HOST (star topology) also re-broadcast viewer ops to the other viewers (relay) so everyone converges.

export function makeSharedDoc({ peerId = "p" + Math.random().toString(36).slice(2, 8), broadcast = () => {}, onChange = () => {}, relay = null } = {}) {
  const state = new Map();   // key → { value, clock, peer }
  let clock = 0;

  function _bump(remote = 0) { clock = Math.max(clock, remote) + 1; return clock; }

  // LWW: an op wins iff its (clock, peer) is strictly greater than what we hold for that key.
  function _apply(op) {
    const cur = state.get(op.key);
    if (!cur || op.clock > cur.clock || (op.clock === cur.clock && op.peer > cur.peer)) {
      state.set(op.key, { value: op.value, clock: op.clock, peer: op.peer });
      try { onChange(op.key, op.value, op.peer); } catch {}
      return true;
    }
    return false;
  }

  // local edit → stamp, apply, broadcast
  function set(key, value) {
    const op = { key, value, clock: _bump(clock), peer: peerId };
    _apply(op); try { broadcast({ t: "doc", op }); } catch {}
    return op;
  }

  // a control message arrived from a peer → apply doc op(s), advance our clock (+ relay on the host)
  function onMessage(m) {
    if (!m) return false;
    if (m.t === "doc" && m.op) {
      _bump(m.op.clock);
      const changed = _apply(m.op);
      if (relay) try { relay({ t: "doc", op: m.op }, m._from); } catch {}   // host re-broadcasts to the other viewers
      return changed;
    }
    // a late joiner asked for current state → send it back as a full snapshot (preserves each field's clock+peer)
    if (m.t === "doc-hello") { if (state.size) try { broadcast({ t: "doc-snap", ops: ops() }); } catch {} return false; }
    // a snapshot arrived → ingest every field with LWW (so we don't clobber newer local edits)
    if (m.t === "doc-snap" && Array.isArray(m.ops)) { let any = false; for (const op of m.ops) { _bump(op.clock); if (_apply(op)) any = true; } return any; }
    return false;
  }

  function ops() { const a = []; for (const [k, v] of state) a.push({ key: k, value: v.value, clock: v.clock, peer: v.peer }); return a; }
  function snapshot() { const o = {}; for (const [k, v] of state) o[k] = v.value; return o; }
  return { peerId, set, get: (k) => { const v = state.get(k); return v ? v.value : undefined; }, snapshot, ops, onMessage, clockNow: () => clock };
}
