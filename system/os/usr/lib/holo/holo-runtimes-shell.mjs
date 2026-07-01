// holo-runtimes-shell.mjs — §6 shell wiring: assemble the ONE runtime-management plane from the shell's REAL
// backends and surface it. Self-contained so shell-main only calls installRuntimesSurface(...) once — the plane,
// the Q binding, the telemetry poll, and the panel render all live here (small, testable, isolated).
//
//   runtimesModel(list) → rows for render (pure — which controls apply per tier/state; honest telemetry text)
//   installRuntimesSurface({ residency, daemonBase, fetch, Q, doc, mount, pollMs }) →
//       { manager, refresh, render, start, stop, model }   — builds manager, sets window.HoloRuntimes,
//       Q.configureRuntimes(manager), polls the daemon, renders list()+verb buttons into `mount`.
//
// The manager + adapters (holo-runtime-manage) are node-witnessed; this module's PURE parts (model + assembly)
// are witnessed too. Only the DOM render touches the document (guarded) — the last, thin, host-only mile.

import { makeRuntimeManager, holospaceBackend, vmBackend, daemonClient } from "./holo-runtime-manage.mjs";

// runtimesModel — PURE. Turn the unified list into display rows: a human state, honest telemetry text (only the
// metrics a tier actually has — no fabricated zeros), and WHICH verbs apply (a resident/running runtime can be
// snapshot/suspend/stop'd; a suspended/stopped one can be resumed). The render and the witness share this.
export function runtimesModel(list = []) {
  return (list || []).map((r) => {
    const t = r.telemetry || null;
    const telemetry = t
      ? [t.cpu != null ? `CPU ${t.cpu}%` : null, t.ram != null ? `RAM ${t.ram}MB` : null, t.io != null ? `IO ${t.io}MB/s` : null].filter(Boolean).join(" · ")
      : "";                                                          // no daemon for this tier → blank, never fake
    const live = r.state === "resident" || r.state === "running";
    const actions = live ? ["snapshot", "suspend", "stop"] : ["resume"];
    return { id: r.id, tier: r.tier, state: r.state, telemetry, actions };
  });
}

export function installRuntimesSurface({
  residency = null, daemonBase = "", fetch: f = (typeof fetch !== "undefined" ? fetch : null),
  Q = (typeof window !== "undefined" ? window.Q : null),
  doc = (typeof document !== "undefined" ? document : null), mount = null, pollMs = 3000,
} = {}) {
  const backends = {};
  if (residency) backends.holospace = holospaceBackend(residency);
  let dc = null;
  if (daemonBase || f) { dc = daemonClient({ base: daemonBase, fetch: f }); backends.vm = vmBackend(dc); }
  const manager = makeRuntimeManager({ backends });

  if (typeof window !== "undefined") window.HoloRuntimes = manager;    // the ONE plane, reachable anywhere
  if (Q && typeof Q.configureRuntimes === "function") { try { Q.configureRuntimes(manager); } catch (e) {} }   // Q operates it

  const model = () => runtimesModel(manager.list());

  function render() {
    if (!doc || !mount) return model();                              // node/headless → return the model (witnessable)
    mount.textContent = "";
    const rows = model();
    if (!rows.length) { const e = doc.createElement("div"); e.className = "hrt-empty"; e.textContent = "No runtimes."; mount.appendChild(e); return rows; }
    for (const r of rows) {
      const row = doc.createElement("div"); row.className = "hrt-row"; row.dataset.id = r.id; row.dataset.tier = r.tier;
      const label = doc.createElement("span"); label.className = "hrt-label"; label.textContent = `${r.id} · ${r.tier} · ${r.state}${r.telemetry ? " · " + r.telemetry : ""}`;
      row.appendChild(label);
      for (const verb of r.actions) {
        const b = doc.createElement("button"); b.className = "hrt-btn"; b.dataset.verb = verb; b.textContent = verb;
        b.addEventListener("click", async () => { b.disabled = true; try { await manager[verb](r.id); } catch (e) {} await refresh(); });
        row.appendChild(b);
      }
      mount.appendChild(row);
    }
    return rows;
  }

  async function refresh() { if (dc) { try { await dc.refresh(); } catch (e) {} } return render(); }

  let timer = null;
  function start() { if (dc && pollMs && typeof setInterval !== "undefined") timer = setInterval(refresh, pollMs); refresh(); return api; }
  function stop() { if (timer && typeof clearInterval !== "undefined") clearInterval(timer); timer = null; }

  const api = { manager, model, render, refresh, start, stop };
  return api;
}

export default { runtimesModel, installRuntimesSurface };
