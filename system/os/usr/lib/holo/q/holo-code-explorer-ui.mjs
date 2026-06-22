// holo-code-explorer-ui.mjs — the VS Code-familiar EXPLORER + TABS chrome for Code mode, rendered around the
// existing vendored CodeMirror 6 (no Monaco — CM6 already gives the editing; this adds the file-tree/tabs that
// make it read like VS Code). The tree IS the app's κ-object tree (holo-code-explorer → the κ-lens): src/
// (manifest·reducer), src/ui/ (projection elements), data/ (collections), and a read-only API section. A verify
// dot per file (green re-derives / red refused, L5). Click → open-through-κ. Pure render → Node-witnessed;
// mount() is the browser wire. Themed to --holo-* so it reads as Hologram, not generic VS Code.
//
//   renderExplorerHTML(model, {activeId}) -> string     // the sidebar (pure)
//   renderTabsHTML(openTabs, {activeId})  -> string     // the editor tab strip (pure)
//   EXPLORER_CSS                                        // the VS Code-ish styling (--holo-* tokens)
//   mountExplorer(container, build, opts) -> model      // render + wire clicks (browser)

import { explorerModel, openFile, saveDescriptor } from "./holo-code-explorer.mjs";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ICON = { json: "{ }", javascript: "JS", html: "<>", text: "·" };
const short = (k) => { const h = String(k).split(":").pop(); return h.length > 10 ? h.slice(0, 8) + "…" : h; };

// the familiar src/ tree, grouped like a VS Code explorer
function tree(files) {
  const groups = [
    { label: "src", match: (f) => f.path.startsWith("src/") && !f.path.startsWith("src/ui/") },
    { label: "src/ui", match: (f) => f.path.startsWith("src/ui/") },
    { label: "data", match: (f) => f.path.startsWith("data/") },
  ];
  return groups.map((g) => ({ label: g.label, files: files.filter(g.match) })).filter((g) => g.files.length);
}

function fileRow(f, activeId) {
  return `<div class="hx-file${f.id === activeId ? " on" : ""}" role="treeitem" tabindex="0" data-k="${esc(f.id)}" data-lang="${esc(f.lang)}" title="${esc(f.kappa)}">`
    + `<span class="hx-ic hx-${esc(f.lang)}">${ICON[f.lang] || "·"}</span>`
    + `<span class="hx-name">${esc(f.name)}</span>`
    + `<span class="hx-dot ${f.verified ? "ok" : "bad"}" title="${f.verified ? "re-derives to its κ (L5)" : "does NOT re-derive — refused"}"></span>`
    + (f.readOnly ? `<span class="hx-ro" title="view-only — a write is a proposal (§2.9)">RO</span>` : "")
    + `</div>`;
}

export function renderExplorerHTML(model = { files: [], api: [] }, { activeId = null } = {}) {
  const groups = tree(model.files).map((g) =>
    `<div class="hx-grp"><div class="hx-grp-h">${esc(g.label)}</div>${g.files.map((f) => fileRow(f, activeId)).join("")}</div>`).join("");
  const api = (model.api && model.api.length)
    ? `<div class="hx-grp hx-api-grp"><div class="hx-grp-h">API · read-only</div>`
      + model.api.map((e) => `<div class="hx-file hx-api"><span class="hx-ic">${e.kind === "rest" ? "⇄" : "⚙"}</span><span class="hx-name">${esc(e.name)}</span>${e.gated ? `<span class="hx-ro" title="token-gated">🔒</span>` : ""}</div>`).join("")
      + `</div>` : "";
  return `<div class="hx-tree" role="tree" aria-label="κ-object explorer">${groups || `<div class="hx-empty">one source · holo://${esc(short(model.manifestK || ""))}</div>`}${api}</div>`;
}

// the editor tab strip (open files) — VS Code tabs
export function renderTabsHTML(openTabs = [], { activeId = null } = {}) {
  if (!openTabs.length) return "";
  return `<div class="hx-tabs" role="tablist">` + openTabs.map((t) =>
    `<div class="hx-tab${t.id === activeId ? " on" : ""}" role="tab" data-k="${esc(t.id)}" title="${esc(t.kappa)}">`
    + `<span class="hx-ic hx-${esc(t.lang)}">${ICON[t.lang] || "·"}</span><span class="hx-tabname">${esc(t.name)}</span>`
    + `<span class="hx-x" data-close="${esc(t.id)}" title="close">×</span></div>`).join("") + `</div>`;
}

export const EXPLORER_CSS = `
.hx-wrap{display:flex;height:100%;min-height:0;background:var(--holo-surface,#1a1d23);color:var(--holo-ink,#e8eef5);font:13px/1.5 var(--holo-font,ui-sans-serif,system-ui)}
.hx-side{width:200px;min-width:160px;max-width:40%;overflow:auto;border-right:1px solid var(--holo-line,#2a2f37);padding:6px 0;flex:0 0 auto}
.hx-tree{user-select:none}
.hx-grp{margin-bottom:4px}
.hx-grp-h{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--holo-ink-3,#8a97a8);padding:4px 10px}
.hx-file{display:flex;align-items:center;gap:7px;padding:3px 10px 3px 16px;cursor:pointer;border-radius:4px;margin:0 4px}
.hx-file:hover{background:var(--holo-surface-2,rgba(255,255,255,.05))}
.hx-file.on{background:var(--holo-accent-soft,rgba(124,92,255,.18))}
.hx-ic{font:600 10px/1 ui-monospace,monospace;width:18px;text-align:center;color:var(--holo-ink-3,#8a97a8);flex:0 0 auto}
.hx-html{color:#e2777a}.hx-json{color:#cbbf6a}.hx-javascript{color:#6db3f2}
.hx-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hx-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.hx-dot.ok{background:var(--holo-ok,#34d399)}.hx-dot.bad{background:var(--holo-bad,#f87171)}
.hx-ro{font:600 9px/1 ui-monospace,monospace;color:var(--holo-ink-3,#8a97a8);border:1px solid var(--holo-line,#2a2f37);border-radius:3px;padding:1px 3px}
.hx-api .hx-name{color:var(--holo-ink-2,#aab6c6);font-size:12px}
.hx-empty{padding:10px;color:var(--holo-ink-3,#8a97a8);font-size:12px}
.hx-main{flex:1;min-width:0;display:flex;flex-direction:column}
.hx-tabs{display:flex;overflow-x:auto;border-bottom:1px solid var(--holo-line,#2a2f37);background:var(--holo-surface,#1a1d23);flex:0 0 auto}
.hx-tab{display:flex;align-items:center;gap:6px;padding:6px 10px;border-right:1px solid var(--holo-line,#2a2f37);cursor:pointer;white-space:nowrap;color:var(--holo-ink-2,#aab6c6)}
.hx-tab.on{background:var(--holo-bg,#0f1216);color:var(--holo-ink,#e8eef5)}
.hx-tabname{max-width:160px;overflow:hidden;text-overflow:ellipsis}
.hx-x{opacity:.5;padding:0 2px;border-radius:3px}.hx-x:hover{opacity:1;background:var(--holo-surface-2,rgba(255,255,255,.08))}
.hx-edit{flex:1;min-height:0;position:relative}
.hx-banner{padding:6px 12px;background:var(--holo-bad-soft,rgba(248,113,113,.16));color:var(--holo-bad,#f87171);font-size:12px}
`;

// mountExplorer(container, build, {store,onOpen,activeId}) — render the sidebar + wire click → open-through-κ.
// onOpen(file, opened|null, err|null): opened = {content,lang,verified} or null + err when a κ refuses (red).
export function mountExplorer(container, build, { store = {}, onOpen = () => {}, activeId = null } = {}) {
  const model = explorerModel(build);
  container.innerHTML = renderExplorerHTML(model, { activeId });
  container.querySelectorAll(".hx-file[data-k]").forEach((el) => {
    el.addEventListener("click", () => {
      const k = el.getAttribute("data-k");
      const file = model.files.find((f) => f.id === k);
      if (!file) return;
      let opened = null, err = null;
      try { opened = openFile(file, store); } catch (e) { err = String((e && e.message) || e); }
      container.querySelectorAll(".hx-file.on").forEach((n) => n.classList.remove("on"));
      el.classList.add("on");
      onOpen(Object.assign({ save: saveDescriptor(file) }, file), opened, err);
    });
  });
  return model;
}

export default { renderExplorerHTML, renderTabsHTML, EXPLORER_CSS, mountExplorer };
