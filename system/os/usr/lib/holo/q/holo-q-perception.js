// holo-q-perception.js — HOLO PERCEPTION: a live, content-addressed view of the WHOLE holospace for
// the Holo Mind orchestrator (ADR-0081). It does NOT screenshot the screen and run a vision model to
// recover structure (the substrate never lost the structure). It READS the κ-graph the OS already
// produces: every object is content-addressed, and the renderer (ADR-0085) already stamps every
// on-screen fragment with a render-κ. Perception is a JOIN over what already exists — deterministic,
// sub-millisecond, serverless.
//
// THE TWO FACES (covers code AND on-screen visuals): each scene entry is one logical object with a
// `code` κ (its source/state/compute output) and a `visual` κ (its rendered fragment). A change in
// either emits a delta tagged with the AXIS that moved (code · visual · both). "DRIFT" — code changed
// but the screen has not caught up (codeSeq > visualSeq) — is the real-time feedback signal the
// orchestrator's self-improvement loop acts on; "coherent" — both faces fresh — is the goal state.
//
// LOW LATENCY by construction: every check is an O(1) compare of content addresses the substrate
// already computed (no pixels, no VLM in the hot loop); a whole-scene κ lets the orchestrator skip
// instantly when nothing changed. 100% SERVERLESS: it reads the in-tab graph; the only place pixels
// ever enter is the RASTER EDGE (non-κ content — an external iframe, an image), handled on demand by
// the mux "vision" specialist (a small on-device VLM, ADR-0084), whose output is sealed back as a new
// κ-object so the interior stays deterministic. DOM-free, dependency-free; Web Crypto for the scene κ.

function canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}
async function sha256hex(str) {
  const c = (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) || null;
  if (c) { const h = await c.digest("SHA-256", new TextEncoder().encode(str)); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
  let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}

// ── the scene ──────────────────────────────────────────────────────────────────────────────────────
// createScene() → the orchestrator's perception of one holospace. Every κ-object registers via
// observe(); the orchestrator subscribes to the delta stream and reads snapshot()/feedback().
export function createScene() {
  const entries = new Map();     // id → { id, code, visual, kind, source, codeSeq, visualSeq }
  const subs = new Set();
  let seq = 0, dirty = true, sceneK = null;
  const stats = { observes: 0, noops: 0, deltas: 0 };

  const emit = (d) => { stats.deltas++; for (const fn of subs) { try { fn(d); } catch (e) {} } };

  // observe(id, patch) — patch may carry { code, visual, kind, source }. Merges; emits a delta ONLY on
  // an actual change (an unchanged re-observe is an O(1) no-op — free). `axis` names what moved.
  function observe(id, patch = {}) {
    stats.observes++;
    const prev = entries.get(id);
    const codeChanged = patch.code !== undefined && (!prev || patch.code !== prev.code);
    const visualChanged = patch.visual !== undefined && (!prev || patch.visual !== prev.visual);
    if (prev && !codeChanged && !visualChanged) { stats.noops++; return prev; }   // ← the hot path: nothing moved
    const next = {
      id, kind: patch.kind || (prev && prev.kind) || "object", source: patch.source || (prev && prev.source) || null,
      code: patch.code !== undefined ? patch.code : (prev ? prev.code : null),
      visual: patch.visual !== undefined ? patch.visual : (prev ? prev.visual : null),
      codeSeq: codeChanged ? ++seq : (prev ? prev.codeSeq : 0),
      visualSeq: visualChanged ? ++seq : (prev ? prev.visualSeq : 0),
    };
    entries.set(id, next); dirty = true;
    const axis = codeChanged && visualChanged ? "both" : codeChanged ? "code" : visualChanged ? "visual" : "none";
    emit({ type: prev ? "changed" : "added", id, axis, code: next.code, visual: next.visual, kind: next.kind });
    return next;
  }
  const observeCode = (id, codeKappa, meta = {}) => observe(id, { ...meta, code: codeKappa });
  const observeVisual = (id, visualKappa, meta = {}) => observe(id, { ...meta, visual: visualKappa });
  function remove(id) { if (entries.delete(id)) { dirty = true; emit({ type: "removed", id }); } }

  const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
  const snapshot = () => [...entries.values()].map((e) => ({ id: e.id, code: e.code, visual: e.visual, kind: e.kind, source: e.source }));

  // sceneKappa() — a content address of the WHOLE scene. Unchanged scene → same κ (cached, O(1)) → the
  // orchestrator skips an entire perception pass when nothing moved. Recomputed only when `dirty`.
  async function sceneKappa() {
    if (!dirty && sceneK) return sceneK;
    sceneK = await sha256hex(canon(snapshot().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))));
    dirty = false; return sceneK;
  }

  // feedback() — the real-time self-improvement signal. Per entry: coherent (both faces fresh) ·
  // codeOnly (computed, not yet on screen) · visualOnly (on screen, no tracked code) · DRIFT (code is
  // newer than the visual → the screen hasn't caught up). Deterministic (seq-ordered, no clocks).
  function feedback() {
    const out = { total: entries.size, coherent: 0, codeOnly: 0, visualOnly: 0, drift: [] };
    for (const e of entries.values()) {
      const hasC = e.code != null, hasV = e.visual != null;
      if (hasC && hasV) { out.coherent++; if (e.codeSeq > e.visualSeq) out.drift.push(e.id); }
      else if (hasC) out.codeOnly++;
      else if (hasV) out.visualOnly++;
    }
    return out;
  }

  // attachRenderer(renderer) — auto-observe the VISUAL face: the renderer fires onFinal({id, kappa})
  // on every painted fragment, which becomes observeVisual. (The CODE face is fed by the fabric /
  // orchestrator dispatch — observeCode with the compute output κ.)
  function attachRenderer(renderer) {
    if (renderer && typeof renderer.onFinal === "function") renderer.onFinal(({ id, kappa }) => observeVisual(id, kappa));
    return scene;
  }

  const scene = {
    observe, observeCode, observeVisual, remove, subscribe, snapshot, sceneKappa, feedback,
    attachRenderer, stats: () => ({ ...stats, objects: entries.size }), clear: () => { entries.clear(); dirty = true; sceneK = null; },
  };
  return scene;
}

export function describePerception() {
  return {
    role: "the orchestrator's live, content-addressed view of the whole holospace — reads the κ-graph, never screenshots",
    faces: "each object has a CODE κ (source/state) and a VISUAL κ (rendered fragment); deltas name the axis that moved",
    feedback: "DRIFT (code newer than visual) is the real-time signal; coherent = both faces fresh — the self-improvement loop's input",
    latency: "O(1) compares of content addresses the substrate already computed; a whole-scene κ skips an unchanged pass instantly",
    serverless: "reads the in-tab graph; pixels enter ONLY at the raster edge via the mux 'vision' specialist (small on-device VLM), sealed back as a κ-object",
  };
}

export default { createScene, describePerception };
