// holo-runtime-manage.mjs — §6: the ONE management plane for every runtime portal. A holospace tab, a web
// machine, and a native-accelerated VM are DIFFERENT tiers but ONE managed object: you see them in one list,
// and snapshot / suspend / resume / stop them through one interface. Management is operating on κ — a snapshot
// IS a content-addressed object (BLAKE3, holospace-lifecycle) and resume is verify-before-use (fail-closed).
// Real telemetry passes through from the daemon; a tier with none returns null (never a fake number).
//
// Pure orchestration — the tier BACKENDS are injected (residency/lifecycle for holospaces, a daemon client for
// VMs), so the plane is node-witnessed before any shell/DOM wiring. The shell renders list()/status() and binds
// the verbs to buttons; Q drives the SAME plane (Q.open opens; a runtime manager verb snapshots/resumes).
//
//   makeRuntimeManager({ backends }) → { list, status, snapshot, suspend, resume, stop, telemetry }
//   holospaceBackend(residency, { ctx }) → a backend over holo-residency (evict=snapshot→κ, open=resume, close=stop)
//   vmBackend(daemon) → a backend over a HoloVirt daemon client (savevm/stop/start/migrate + real telemetry)
//
// A backend is: { list()→[{id,state,snapshotKappa?,telemetry?}], snapshot(id), suspend(id), resume(id), stop(id) }
// Each control verb returns { ok, kappa? , reason? } — fail-closed: unknown/unsupported → { ok:false, reason }.

export function makeRuntimeManager({ backends = {} } = {}) {
  const tiers = () => Object.entries(backends).filter(([, b]) => b && typeof b.list === "function");

  // list() — the unified view across every tier. Each runtime is tagged with its tier; a tier's list() failing
  // must never sink the whole view (one broken daemon ≠ no runtimes), so each is guarded.
  function list() {
    const out = [];
    for (const [tier, b] of tiers()) {
      let rows = []; try { rows = b.list() || []; } catch (e) { rows = []; }
      for (const r of rows) out.push({ tier, id: String(r.id), state: r.state || "unknown", snapshotKappa: r.snapshotKappa || null, telemetry: r.telemetry || null });
    }
    return out;
  }
  function status(id) { return list().find((r) => r.id === String(id)) || null; }
  function backendOf(id) { const r = status(id); return r ? backends[r.tier] : null; }

  // route a control verb to the tier that owns the id; fail-closed on unknown id or unsupported verb.
  async function verb(name, id) {
    const b = backendOf(id);
    if (!b) return { ok: false, reason: "unknown runtime: " + id };
    if (typeof b[name] !== "function") return { ok: false, reason: `${name} not supported for this tier` };
    try { const r = await b[name](String(id)); return (r && typeof r === "object") ? r : { ok: r !== false }; }
    catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
  }

  return {
    list, status,
    snapshot: (id) => verb("snapshot", id),   // capture κ (BLAKE3), no unload where the tier supports it
    suspend:  (id) => verb("suspend", id),    // snapshot → κ + unload (resumable)
    resume:   (id) => verb("resume", id),     // restore from κ (verify-before-use; fail-closed → clean state)
    stop:     (id) => verb("stop", id),
    // real telemetry only — a tier without a daemon returns null (honest; the UI hides rather than invents).
    telemetry: (id) => { const r = status(id); return r ? (r.telemetry || null) : null; },
  };
}

// ── holospace tier — over holo-residency (warm LRU + snapshot-on-evict + resume). A snapshot IS a κ
//    (residency.evict → holospace-lifecycle.snapshot → kappo(sealed blob)); resume is fail-closed (a refused
//    /tampered snapshot cold-mounts clean, never wrong state). Holospaces have no daemon → telemetry is null. ──
export function holospaceBackend(residency, { ctx = undefined } = {}) {
  if (!residency) throw new Error("holospaceBackend needs a residency");
  return {
    list() {
      const warm = (residency.warmKeys && residency.warmKeys()) || [];
      const snap = (residency.snapshotKeys && residency.snapshotKeys()) || [];
      return [
        ...warm.map((id) => ({ id, state: "resident" })),
        ...snap.filter((id) => !warm.includes(id)).map((id) => ({ id, state: "suspended", snapshotKappa: id })),
      ];
    },
    // holospaces have no snapshot-in-place primitive; snapshot ≡ suspend (evict → κ). Honest about the tier.
    async snapshot(id) { const k = await residency.evict(id); return { ok: !!k, kappa: k || null, reason: k ? undefined : "nothing to snapshot" }; },
    async suspend(id)  { const k = await residency.evict(id); return { ok: !!k, kappa: k || null, reason: k ? undefined : "not resident" }; },
    async resume(id)   { const r = await residency.open(id, ctx); const ok = !!(r && r.handle); return { ok, hit: r && r.hit, resumed: !!(r && r.hit === "resume"), reason: ok ? undefined : "could not open" }; },
    async stop(id)     { const closed = residency.close ? residency.close(id) : false; return { ok: !!closed, reason: closed ? undefined : "not resident" }; },
  };
}

// ── vm tier — over a HoloVirt daemon CLIENT (injected; the real one talks HTTP to holovirt-daemon :8620). The
//    client supplies real telemetry (/proc·QGA·QMP) and control (savevm/stop/start/migrate). All methods are
//    optional — a missing one surfaces as "unsupported" (fail-closed), never a fabricated success. ──
export function vmBackend(daemon) {
  if (!daemon) throw new Error("vmBackend needs a daemon client");
  const call = async (fn, id) => { if (typeof daemon[fn] !== "function") return { ok: false, reason: fn + " unsupported by daemon" }; const r = await daemon[fn](id); return (r && typeof r === "object") ? { ok: r.ok !== false, ...r } : { ok: r !== false }; };
  return {
    list() { return (daemon.list && daemon.list()) || []; },   // [{ id, state, snapshotKappa?, telemetry:{cpu,ram,io}|null }]
    snapshot: (id) => call("snapshot", id),
    suspend:  (id) => call("suspend", id),
    resume:   (id) => call("resume", id),
    stop:     (id) => call("stop", id),
  };
}

// ── daemonClient — the REAL HoloVirt daemon backend (HTTP → holovirt-daemon, default :8620). The daemon
//    PUSHES telemetry, so we cache the latest frame (refresh() polls GET /telemetry.json) and list() reads it
//    SYNChronously (matching vmBackend's sync list()). Control maps to the daemon's real verbs: snapshot = QMP
//    savevm; the daemon has no pause/cont, so suspend = snapshot+stop and resume = start. fetch is injected
//    (the witness passes a mock; the shell passes the WSL-discovered base). Every call is fail-closed. ──
export function daemonClient({ base = "", fetch: f = (typeof fetch !== "undefined" ? fetch : null), name = "snap" } = {}) {
  let frame = null;
  const num = (x) => (x == null ? null : (Number.isFinite(+x) ? +x : null));   // honest: absent → null, never 0-as-fake
  const req = async (method, path, bodyObj) => {
    if (!f) return { ok: false, reason: "no fetch bound" };
    try {
      const opt = { method };
      if (bodyObj) { opt.headers = { "content-type": "application/json" }; opt.body = JSON.stringify(bodyObj); }
      const r = await f(base + path, opt);
      if (!r || !r.ok) return { ok: false, reason: "http " + (r && r.status) };
      let j = {}; try { j = await r.json(); } catch (e) { j = {}; }
      return { ok: j.ok !== false, ...j };
    } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
  };
  return {
    async refresh() { const r = await req("GET", "/telemetry.json"); if (r && r.ok !== false && (r.vms || r.nodes || r.fleet)) frame = r; return !!frame; },
    list() {
      return ((frame && frame.vms) || []).map((v) => ({
        id: String(v.id),
        state: v.status || (v.running ? "running" : "stopped"),
        telemetry: { cpu: num(v.cpuPct), ram: num(v.memMiB), io: num(v.diskIoMBs) },
      }));
    },
    snapshot: (id) => req("POST", `/vm/${id}/snapshot`, { name }),
    async suspend(id) {
      const s = await req("POST", `/vm/${id}/snapshot`, { name });
      if (!s.ok) return s;                                                  // snapshot failed → don't stop (fail-closed)
      const st = await req("POST", `/vm/${id}/stop`, {});
      return { ok: st.ok, kappa: s.kappa || s.name || null, reason: st.reason };
    },
    resume: (id) => req("POST", `/vm/${id}/start`, {}),
    stop: (id) => req("POST", `/vm/${id}/stop`, {}),
  };
}

export default { makeRuntimeManager, holospaceBackend, vmBackend, daemonClient };
