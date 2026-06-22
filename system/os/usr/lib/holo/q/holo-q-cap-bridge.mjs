// holo-q-cap-bridge.mjs — Stage B: the capability-scoped bridge between an app's PROJECTION (untrusted UI,
// run in a sandboxed iframe/worker) and its data. The projection can reach NOTHING ambiently; it speaks only
// through this bridge, which admits EXACTLY the manifest's declared capabilities and nothing more (SEC-2,
// object-capabilities, attenuate-never-escalate). Reads are gated; WRITES are only PROPOSED — the bridge never
// authors an event on the user's key (§2.9: "an app never authors events autonomously"). Pure + injected
// effects → Node-witnessed; the browser mounts the projection as <iframe sandbox="allow-scripts"> (NO
// allow-same-origin → no parent DOM/cookies) and routes postMessage through serveBridge().
//
//   createCapBridge({ capabilities, read }) -> { admits, request, attenuate, capabilities, serve }
//     admits(collection, op)            -> bool
//     request({ op, collection, payload }) -> { ok, value? } | { ok:true, proposal } | { ok:false, refused }
//     attenuate(narrowerCaps)           -> a sub-bridge whose caps ⊆ this bridge's (escalation refused)
//     serve()                           -> (msg) => response   // the postMessage handler for the sandbox

const list = (v) => Array.isArray(v) ? v : (v == null ? [] : [v]);
const VALID_OPS = new Set(["read", "write", "admin"]);

// normalize capabilities to a Map<collection, Set<op>>, dropping anything malformed.
function capMap(capabilities) {
  const m = new Map();
  for (const c of list(capabilities)) {
    if (!c || !c.collection) continue;
    const ops = new Set(list(c.ops).filter((o) => VALID_OPS.has(o)));
    if (ops.size) m.set(String(c.collection), ops);
  }
  return m;
}
const toCaps = (m) => [...m.entries()].map(([collection, ops]) => ({ collection, ops: [...ops] }));

export function createCapBridge({ capabilities = [], read = null } = {}) {
  const caps = capMap(capabilities);                         // the SOLE authority this bridge confers

  const admits = (collection, op) => { const o = caps.get(String(collection)); return !!(o && o.has(op)); };

  function request(req) {
    const op = req && req.op, collection = req && req.collection;
    if (!VALID_OPS.has(op)) return { ok: false, refused: "bad-op" };
    if (!admits(collection, op)) return { ok: false, refused: "capability" };   // SEC-2: outside the set → refused
    if (op === "read") {
      let value = null; try { value = read ? read(collection) : null; } catch (e) { return { ok: false, refused: "read-error" }; }
      return { ok: true, value };
    }
    // write / admin: NEVER autonomously authored — returned as a PROPOSAL that must be authorized + signed (§2.9, Stage E).
    return { ok: true, proposal: { kind: op === "admin" ? "membership" : (collection + "-record"), collection, op, payload: req.payload == null ? null : req.payload, needsAuth: true } };
  }

  // attenuate: a sub-bridge can only NARROW — caps ⊆ this bridge's. A request for an undeclared collection or a
  // wider op set is clamped to the intersection (never granted). Escalation is structurally impossible.
  function attenuate(narrowerCaps) {
    const want = capMap(narrowerCaps), out = [];
    for (const [collection, ops] of want) {
      const held = caps.get(collection); if (!held) continue;                   // can't grant a collection we don't hold
      const granted = [...ops].filter((o) => held.has(o));                      // ops ∩ held
      if (granted.length) out.push({ collection, ops: granted });
    }
    return createCapBridge({ capabilities: out, read });
  }

  // the postMessage handler for the sandboxed projection: every message is just a request, validated identically.
  const serve = () => (msg) => request(msg || {});

  return { admits, request, attenuate, serve, capabilities: toCaps(caps) };
}

export default { createCapBridge };
