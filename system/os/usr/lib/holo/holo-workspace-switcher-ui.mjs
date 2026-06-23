// holo-workspace-switcher-ui.mjs — THE DESKTOP IS THE SET OF WORKSPACES (Phase C surface). Named desktop
// arrangements ("Main", "Research", "Trading") you switch between like rooms. Switching auto-saves the
// current arrangement and restores the target — no save button, no κ, no jargon; the user just picks a name.
//
// A "workspace" here = a whole-desktop experience (all tabs + their windows). It is stored as a manifest on
// that workspace's OWN per-app chain (holo-workspaces → the reserved DESKTOP_KEY), so each named workspace
// gets the SAME deterministic, signed, never-destroyed history as everything else — and switching is just
// resume on its chain. Pure assembly over holo-workspaces; the shell supplies three closures (get/apply/
// fresh the experience manifest) so this module stays generic and node-witnessable.
//
// SIMPLICITY BAR: zero app code, one pill in the tab strip, auto-save on switch, fail-soft (no registry ⇒
// today's single-desktop behaviour, unchanged).

import "./holo-workspaces.mjs";   // ensure window.HoloWorkspaces (the registry + scoped per-app chains)

const DESKTOP_KEY = "holo://workspace-desktop";   // the reserved "app" whose state IS the whole arrangement
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// makeSwitcher({ sets, getManifest, applyManifest, freshManifest }) — the logic (no DOM), injectable.
//   sets          : a holo-workspaces instance (list/create/rename/activate/active/host).
//   getManifest   : async () => the CURRENT desktop's experience manifest (fresh app state folded in).
//   applyManifest : async (manifest) => rebuild the desktop from a manifest (the shell's applyBody + refresh).
//   freshManifest : async () => a clean starting manifest (e.g. just Home) for a brand-new workspace.
export function makeSwitcher({ sets, getManifest, applyManifest, freshManifest } = {}) {
  if (!sets) throw new Error("holo-workspace-switcher: a holo-workspaces instance is required");
  const desk = (id) => sets.host(id).workspace(DESKTOP_KEY);

  // saveCurrent — fold the live desktop into the active workspace's chain (lazy; the chain dedups).
  async function saveCurrent() {
    const cur = await sets.active(); if (!cur) return null;
    let m = null; try { m = await getManifest(); } catch (e) {}
    if (m) { try { await desk(cur).save(m); } catch (e) {} }
    return cur;
  }

  // ensureSeed — on first use, name the CURRENT desktop as workspace #1 so there's always an active one.
  async function ensureSeed(name = "Main") {
    const { workspaces, active } = await sets.list();
    if (!workspaces.length) {
      const w = await sets.create(name); await sets.activate(w.id);
      let m = null; try { m = await getManifest(); } catch (e) {}
      if (m) { try { await desk(w.id).save(m); } catch (e) {} }
      return w.id;
    }
    if (!active) { await sets.activate(workspaces[0].id); return workspaces[0].id; }
    return active;
  }

  // switchTo — save current, activate target, restore the target's stored arrangement. No-op if already there.
  async function switchTo(id) {
    const cur = await sets.active(); if (cur === id) return false;
    await saveCurrent();
    await sets.activate(id);
    let m = null; try { m = await desk(id).resume(); } catch (e) {}
    if (m) { try { await applyManifest(m); } catch (e) {} return true; }
    return false;   // target had no stored desktop (shouldn't happen post-seed) → leave the screen as-is
  }

  // createWorkspace — save current, create + activate a new one, then open a FRESH desktop (visible feedback).
  async function createWorkspace(name = "New workspace") {
    await saveCurrent();
    const w = await sets.create(name); await sets.activate(w.id);
    let m = null; try { m = freshManifest ? await freshManifest() : await getManifest(); } catch (e) {}
    if (m) { try { await desk(w.id).save(m); } catch (e) {} try { await applyManifest(m); } catch (e) {} }
    return w;
  }

  const rename = (id, name) => sets.rename(id, name);
  const list = () => sets.list();
  const active = () => sets.active();
  return { saveCurrent, ensureSeed, switchTo, createWorkspace, rename, list, active };
}

// mountSwitcher(strip, { getManifest, applyManifest, freshManifest }) — insert the pill into the tab strip
// (as a non-".tab" first child, so renderTabs never removes it). Idempotent + fail-soft. Returns the API.
export async function mountSwitcher(strip, { getManifest, applyManifest, freshManifest } = {}) {
  if (typeof document === "undefined" || !strip || document.getElementById("wks-switch")) return null;
  let sets = null;
  for (let i = 0; i < 25; i++) { if (window.HoloWorkspaces && window.HoloWorkspaces.list) { sets = window.HoloWorkspaces; break; } await wait(120); }
  if (!sets) return null;   // registry never wired → fail-soft to single-desktop
  const sw = makeSwitcher({ sets, getManifest, applyManifest, freshManifest });
  try { await sw.ensureSeed(); } catch (e) {}
  injectStyles();

  const wrap = document.createElement("div"); wrap.id = "wks-switch"; wrap.className = "wsw";
  wrap.innerHTML = `<button class="wsw-pill" title="Switch workspace"><span class="wsw-ico">⬣</span><span class="wsw-name">Main</span><span class="wsw-cv">▾</span></button><div class="wsw-pop" hidden></div>`;
  strip.insertBefore(wrap, strip.firstChild);
  const pill = wrap.querySelector(".wsw-pill"), nameEl = wrap.querySelector(".wsw-name"), pop = wrap.querySelector(".wsw-pop");

  async function paintPill() { try { const { workspaces, active } = await sw.list(); const a = workspaces.find((w) => w.id === active); nameEl.textContent = (a && a.name) || (workspaces[0] && workspaces[0].name) || "Main"; } catch (e) {} }

  async function paintPop() {
    const { workspaces, active } = await sw.list();
    pop.innerHTML =
      `<div class="wsw-h">Workspaces</div>` +
      workspaces.map((w) => `<button class="wsw-row${w.id === active ? " on" : ""}" data-id="${w.id}"><span class="wsw-dot"></span><span class="wsw-rn" data-id="${w.id}">${esc(w.name)}</span>${w.id === active ? `<span class="wsw-cur">current</span>` : ``}</button>`).join("") +
      `<div class="wsw-new"><input class="wsw-in" placeholder="New workspace…" maxlength="40"/><button class="wsw-add" title="Create">＋</button></div>`;
    // switch
    pop.querySelectorAll(".wsw-row").forEach((b) => b.onclick = async (e) => {
      if (e.target.closest(".wsw-rn") && e.detail === 2) return;   // let dblclick rename win
      const id = b.dataset.id; await sw.switchTo(id); await paintPill(); close();
    });
    // rename (dblclick the name)
    pop.querySelectorAll(".wsw-rn").forEach((nm) => nm.ondblclick = (e) => {
      e.stopPropagation(); const id = nm.dataset.id; const cur = nm.textContent;
      const inp = document.createElement("input"); inp.className = "wsw-in wsw-ren"; inp.value = cur; inp.maxLength = 40;
      nm.replaceWith(inp); inp.focus(); inp.select();
      const commit = async () => { const v = inp.value.trim(); if (v && v !== cur) { await sw.rename(id, v); } await paintPill(); await paintPop(); };
      inp.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); commit(); } else if (ev.key === "Escape") paintPop(); };
      inp.onblur = commit;
    });
    // create
    const add = pop.querySelector(".wsw-add"), input = pop.querySelector(".wsw-in");
    const create = async () => { const v = (input.value || "").trim() || ("Workspace " + (workspaces.length + 1)); await sw.createWorkspace(v); await paintPill(); close(); };
    if (add) add.onclick = create;
    if (input) input.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); create(); } };
  }

  const close = () => { pop.hidden = true; };
  const open = async () => { document.querySelectorAll(".wsw-pop").forEach((p) => (p.hidden = true)); await paintPop(); pop.hidden = false; _openedAt = Date.now(); };
  let _openedAt = 0;
  pill.onclick = (e) => { e.stopPropagation(); pop.hidden ? open() : close(); };
  document.addEventListener("pointerdown", (e) => { if (pop.hidden) return; if (Date.now() - _openedAt < 60) return; if (!wrap.contains(e.target)) close(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) close(); }, true);

  await paintPill();
  const api = { ...sw, paint: paintPill, el: wrap };
  window.HoloWorkspaceSwitcher = api;   // reachable by agents / Q
  return api;
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function injectStyles() {
  if (typeof document === "undefined" || document.getElementById("wsw-styles")) return;
  const s = document.createElement("style"); s.id = "wsw-styles";
  s.textContent = `
  .wsw{flex:0 0 auto;display:flex;align-items:center;align-self:center;margin:0 6px 0 2px;position:relative;z-index:62}
  .wsw-pill{display:flex;align-items:center;gap:6px;height:28px;padding:0 9px;border:0;border-radius:8px;cursor:pointer;
    background:color-mix(in srgb,var(--holo-ink,#e8eef9) 9%,transparent);color:var(--holo-ink,#e8eef9);font:600 12px var(--holo-font-sans,system-ui)}
  .wsw-pill:hover{background:color-mix(in srgb,var(--holo-ink,#e8eef9) 15%,transparent)}
  .wsw-ico{color:var(--holo-accent,#a78bfa);font-size:13px} .wsw-name{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .wsw-cv{opacity:.6;font-size:9px}
  .wsw-pop{position:absolute;top:34px;left:0;width:236px;z-index:200;background:var(--holo-surface,#0c111b);color:var(--holo-ink,#e8eef9);
    border:1px solid color-mix(in srgb,var(--holo-ink,#e8eef9) 14%,transparent);border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,.5);padding:7px;font:13px/1.4 var(--holo-font-sans,system-ui)}
  .wsw-h{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:color-mix(in srgb,var(--holo-ink,#e8eef9) 48%,transparent);padding:5px 8px 7px}
  .wsw-row{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:0;cursor:pointer;padding:8px 9px;border-radius:8px;background:transparent;color:var(--holo-ink,#e8eef9);font:inherit}
  .wsw-row:hover{background:color-mix(in srgb,var(--holo-ink,#e8eef9) 8%,transparent)}
  .wsw-row.on{background:color-mix(in srgb,var(--holo-accent,#5b8cff) 16%,transparent)}
  .wsw-dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:color-mix(in srgb,var(--holo-ink,#e8eef9) 30%,transparent)}
  .wsw-row.on .wsw-dot{background:var(--holo-accent,#5b8cff)}
  .wsw-rn{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .wsw-cur{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:color-mix(in srgb,var(--holo-ink,#e8eef9) 46%,transparent)}
  .wsw-new{display:flex;gap:6px;margin-top:6px;padding-top:7px;border-top:1px solid color-mix(in srgb,var(--holo-ink,#e8eef9) 10%,transparent)}
  .wsw-in{flex:1;min-width:0;background:rgba(0,0,0,.25);border:1px solid color-mix(in srgb,var(--holo-ink,#e8eef9) 14%,transparent);border-radius:7px;color:var(--holo-ink,#e8eef9);padding:6px 8px;font:12px var(--holo-font-sans,system-ui);outline:none}
  .wsw-in:focus{border-color:var(--holo-accent,#5b8cff)}
  .wsw-add{flex:0 0 auto;border:0;border-radius:7px;background:var(--holo-accent,#5b8cff);color:#fff;width:30px;cursor:pointer;font-size:15px;line-height:1}
  .wsw-add:hover{filter:brightness(1.08)}
  .wsw-ren{width:100%}`;
  document.head.appendChild(s);
}

if (typeof window !== "undefined") window.HoloWorkspaceSwitcherUI = { makeSwitcher, mountSwitcher };
export default { makeSwitcher, mountSwitcher };
