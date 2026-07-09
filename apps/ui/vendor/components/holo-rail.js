// holo-rail.js — canonical SHELL object: the sidebar / navigation rail (grouped, selectable items).
// Self-contained, token-themed. Data-driven (groups → items), component-wired onSelect — so it carries
// the app's navigation without per-app CSS.
//   props: { groups?:[{label?, items:[Item]}], onSelect?, style? }   Item = { id, icon?:html, label, meta?, active? }
import * as React from "react";
const h = React.createElement;

let styled = false;
function css() {
  if (styled || typeof document === "undefined") return; styled = true;
  const s = document.createElement("style"); s.id = "holo-shell-rail-css";
  s.textContent = '[data-holo-shell="rail"] .hr-item{transition:background .12s}'
    + '[data-holo-shell="rail"] .hr-item:hover{background:var(--holo-hover,#1b2433)}'
    + '[data-holo-shell="rail"] .hr-item.on{background:var(--holo-selected,#1f3553)}'
    + '[data-holo-shell="rail"] .hr-item.on .hr-ic{color:var(--holo-accent,#3aa0ff)}';
  document.head.appendChild(s);
}
function Item(it, i, onSelect) {
  return h("div", { key: it.id != null ? it.id : i, className: "hr-item" + (it.active ? " on" : ""), onClick: onSelect ? () => onSelect(it.id, it) : undefined,
    style: { display: "flex", alignItems: "center", gap: "9px", padding: "7px 9px", borderRadius: "var(--holo-radius-sm, 8px)", cursor: "pointer", fontSize: "var(--holo-text-sm, 1rem)" } },
    h("span", { className: "hr-ic", style: { width: "18px", height: "18px", flex: "0 0 auto", display: "grid", placeItems: "center", color: "var(--holo-muted, #9aa7bd)" }, dangerouslySetInnerHTML: it.icon ? { __html: it.icon } : undefined }),
    h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.label),
    it.meta != null ? h("small", { style: { marginLeft: "auto", color: "var(--holo-faint, #6b7890)", fontFamily: "var(--holo-mono, ui-monospace, monospace)" } }, it.meta) : null,
  );
}
export function Rail(props) {
  css(); const p = props || {};
  return h("nav", { "data-holo-shell": "rail", style: {
    width: "var(--holo-rail-w, 236px)", flex: "0 0 auto", overflowY: "auto", padding: "8px 8px 20px", boxSizing: "border-box",
    background: "var(--holo-surface, #0e131d)", borderRight: "1px solid var(--holo-border, #222c3d)", color: "var(--holo-ink, #e6ecf5)", ...(p.style || {}) } },
    ...(p.groups || []).map((g, gi) => h(React.Fragment, { key: gi },
      g.label ? h("div", { style: { margin: "6px 4px 4px", fontSize: "var(--holo-text-sm, 1rem)", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--holo-faint, #6b7890)" } }, g.label) : null,
      ...(g.items || []).map((it, i) => Item(it, i, p.onSelect)),
    )),
  );
}
export default Rail;
