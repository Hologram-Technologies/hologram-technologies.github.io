// holo-rewind-ui.mjs — REWIND, NOT VERSION CONTROL (Phase B surface). The per-app time-travel that the
// source chain already gives every window (holo-workspace: versions / preview / revert), shown as a small
// timeline in PLAIN TIME. The user never sees a version number, a commit hash, or a κ — they see "just now",
// "2 minutes ago", and a list they can scrub. Click a past point to PREVIEW it live in the window
// (read-only — the head never moves); "Restore" appends a new point that brings it back (history intact,
// monotonic law). Close without restoring and the window snaps back to where it was.
//
// Drives the live host (holo-workspace-host → per-app chain) and re-uses the SAME `holo-session:restore`
// message the shell already speaks to apps, so previewing/restoring needs ZERO app code. Fail-soft: an app
// with no saved history shows a gentle empty state. Pure helpers (relTime / describeVersions) are exported
// for node witnessing; openRewind is the DOM surface the window chrome opens.

// relTime(iso, nowMs) → a plain, human "… ago" — no clocks, no precision theatre.
export function relTime(iso, nowMs) {
  const t = Date.parse(iso); if (isNaN(t)) return "earlier";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return s + " seconds ago";
  const m = Math.round(s / 60); if (m < 60) return m === 1 ? "a minute ago" : m + " minutes ago";
  const h = Math.round(m / 60); if (h < 24) return h === 1 ? "an hour ago" : h + " hours ago";
  const d = Math.round(h / 24); if (d < 7) return d === 1 ? "yesterday" : d + " days ago";
  const w = Math.round(d / 7); if (w < 5) return w === 1 ? "a week ago" : w + " weeks ago";
  const mo = Math.round(d / 30); if (mo < 12) return mo === 1 ? "a month ago" : mo + " months ago";
  const y = Math.round(d / 365); return y === 1 ? "a year ago" : y + " years ago";
}

// describeVersions(versions, nowMs) → the timeline rows the panel renders, NEWEST FIRST. Each row is a
// plain point in time; a revert is marked so the story stays honest ("restored from earlier").
export function describeVersions(versions, nowMs) {
  return (versions || []).map((v) => ({ n: v.n, when: relTime(v.at, nowMs), isRevert: v.revertOf != null }))
    .reverse();
}

// openRewind({ appKappa, host, applyState, label, onRestore }) — open the timeline popover for one window.
//   host       : window.HoloWorkspaceHost (per-app chain).
//   applyState : (state) => void — the shell posts it to the live app frame (preview / restore). Required.
//   label      : the window's human name (header only).
//   onRestore  : optional () => void — the shell may toast / refresh after a restore.
export async function openRewind({ appKappa, host, applyState, label = "this window", onRestore } = {}) {
  if (typeof document === "undefined") return null;
  injectStyles();
  document.querySelectorAll(".rw-pop").forEach((p) => p.remove());        // single-open
  const pop = document.createElement("div"); pop.className = "rw-pop"; pop.setAttribute("role", "dialog");
  pop.innerHTML = `<div class="rw-h"><span class="rw-clock">↺</span><span class="rw-title"></span><button class="rw-x" title="Close" aria-label="Close">✕</button></div><div class="rw-body"><div class="rw-empty">Reading history…</div></div>`;
  pop.querySelector(".rw-title").textContent = "Rewind · " + label;
  document.body.appendChild(pop);

  const body = pop.querySelector(".rw-body");
  const ws = (appKappa && host && host.workspace) ? host.workspace(appKappa) : null;
  let headState = null, previewing = false, restored = false;

  const close = () => {
    if (previewing && !restored && applyState) { try { applyState(headState); } catch (e) {} }   // snap back
    pop.remove(); document.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", onOut, true);
  };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const onOut = (e) => { if (!pop.contains(e.target)) close(); };
  pop.querySelector(".rw-x").onclick = close;
  document.addEventListener("keydown", onKey, true);
  setTimeout(() => document.addEventListener("pointerdown", onOut, true), 0);   // not the opening click

  if (!ws) { body.innerHTML = `<div class="rw-empty">This window has nothing saved to rewind.</div>`; return pop; }
  let versions = [];
  try { headState = await ws.resume(); versions = await ws.versions(); } catch (e) {}
  if (!versions.length) { body.innerHTML = `<div class="rw-empty">No history yet.<br><span class="rw-dim">As you work in this window, points you can rewind to appear here.</span></div>`; return pop; }

  const rows = describeVersions(versions, Date.now());
  const render = (activeN) => {
    body.innerHTML =
      `<button class="rw-row rw-now${activeN == null ? " on" : ""}" data-now="1"><span class="rw-dot"></span><span class="rw-when">Now</span><span class="rw-tag">current</span></button>` +
      rows.map((r) => `<button class="rw-row${activeN === r.n ? " on" : ""}" data-n="${r.n}"><span class="rw-dot"></span><span class="rw-when">${r.when}</span>${r.isRevert ? `<span class="rw-tag">restored</span>` : ``}</button>`).join("") +
      `<div class="rw-foot"><button class="rw-restore" disabled>Restore this point</button><div class="rw-hint">Previewing is safe — nothing changes until you restore.</div></div>`;
    const restoreBtn = body.querySelector(".rw-restore");
    body.querySelectorAll(".rw-row").forEach((b) => b.onclick = async () => {
      if (b.dataset.now) { previewing = false; try { applyState(headState); } catch (e) {} render(null); return; }
      const n = +b.dataset.n;
      let st = null; try { st = await ws.preview(n); } catch (e) {}
      previewing = true; try { applyState(st); } catch (e) {}
      render(n);
      const rb = body.querySelector(".rw-restore"); if (rb) { rb.disabled = false; rb.dataset.n = n; }
    });
    if (restoreBtn) restoreBtn.onclick = async () => {
      const n = +restoreBtn.dataset.n; if (isNaN(n)) return;
      try { await ws.revert(n); headState = await ws.resume(); applyState(headState); } catch (e) {}
      restored = true; previewing = false;
      try { onRestore && onRestore(); } catch (e) {}
      close();
    };
  };
  render(null);
  return pop;
}

function injectStyles() {
  if (typeof document === "undefined" || document.getElementById("rw-styles")) return;
  const s = document.createElement("style"); s.id = "rw-styles";
  s.textContent = `
  .rw-pop{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:300px;max-height:70vh;display:flex;flex-direction:column;z-index:1400;
    background:var(--holo-surface,#0c111b);color:var(--holo-ink,#e8eef9);border:1px solid color-mix(in srgb,var(--holo-ink,#e8eef9) 14%,transparent);
    border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.55);font:13px/1.45 var(--holo-font-sans,system-ui,sans-serif);overflow:hidden}
  .rw-h{display:flex;align-items:center;gap:9px;padding:13px 14px 11px;border-bottom:1px solid color-mix(in srgb,var(--holo-ink,#e8eef9) 10%,transparent)}
  .rw-clock{color:var(--holo-accent,#a78bfa);font-size:16px}
  .rw-title{flex:1;font-weight:650;letter-spacing:-.01em;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rw-x{border:0;background:transparent;color:color-mix(in srgb,var(--holo-ink,#e8eef9) 55%,transparent);cursor:pointer;font-size:13px;padding:2px 4px;border-radius:6px}
  .rw-x:hover{background:color-mix(in srgb,var(--holo-ink,#e8eef9) 12%,transparent);color:var(--holo-ink,#e8eef9)}
  .rw-body{overflow:auto;padding:7px}
  .rw-empty{padding:26px 16px;text-align:center;color:color-mix(in srgb,var(--holo-ink,#e8eef9) 60%,transparent)}
  .rw-dim{color:color-mix(in srgb,var(--holo-ink,#e8eef9) 42%,transparent);font-size:12px}
  .rw-row{position:relative;display:flex;align-items:center;gap:11px;width:100%;text-align:left;border:0;cursor:pointer;
    padding:9px 11px;border-radius:9px;background:transparent;color:var(--holo-ink,#e8eef9);font:inherit}
  .rw-row:hover{background:color-mix(in srgb,var(--holo-ink,#e8eef9) 8%,transparent)}
  .rw-row.on{background:color-mix(in srgb,var(--holo-accent,#5b8cff) 18%,transparent)}
  .rw-dot{flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:color-mix(in srgb,var(--holo-ink,#e8eef9) 32%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--holo-ink,#e8eef9) 7%,transparent)}
  .rw-row.on .rw-dot,.rw-now .rw-dot{background:var(--holo-accent,#5b8cff)}
  .rw-when{flex:1}
  .rw-tag{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:color-mix(in srgb,var(--holo-ink,#e8eef9) 48%,transparent)}
  .rw-foot{margin-top:8px;padding:9px 4px 4px;border-top:1px solid color-mix(in srgb,var(--holo-ink,#e8eef9) 10%,transparent)}
  .rw-restore{display:block;width:100%;padding:9px;border:0;border-radius:9px;background:var(--holo-accent,#5b8cff);color:#fff;font:600 13px var(--holo-font-sans,system-ui);cursor:pointer}
  .rw-restore:disabled{opacity:.4;cursor:default}
  .rw-restore:not(:disabled):hover{filter:brightness(1.08)}
  .rw-hint{margin-top:7px;text-align:center;font-size:11px;color:color-mix(in srgb,var(--holo-ink,#e8eef9) 44%,transparent)}`;
  document.head.appendChild(s);
}

if (typeof window !== "undefined") window.HoloRewindUI = { openRewind, relTime, describeVersions };
export default { openRewind, relTime, describeVersions };
