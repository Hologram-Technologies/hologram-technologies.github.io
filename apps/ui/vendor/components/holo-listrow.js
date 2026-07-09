// holo-listrow.js — canonical SHELL object: one selectable list row (icon · label · meta · trailing).
// Self-contained, token-themed. The atom of every list/table; component-wired click/dblclick/contextmenu.
//   props: { icon?:html, iconColor?, label, meta?, trailing?, selected?, onClick?, onDblClick?, onContextMenu?, style? }
import * as React from "react";
const h = React.createElement;

let styled = false;
function css() {
  if (styled || typeof document === "undefined") return; styled = true;
  const s = document.createElement("style"); s.id = "holo-shell-listrow-css";
  s.textContent = '[data-holo-shell="listrow"]{transition:background .1s}'
    + '[data-holo-shell="listrow"]:hover{background:var(--holo-hover,#1b2433)}'
    + '[data-holo-shell="listrow"].on{background:var(--holo-selected,#1f3553)}';
  document.head.appendChild(s);
}
export function ListRow(props) {
  css(); const p = props || {};
  return h("div", { "data-holo-shell": "listrow", className: p.selected ? "on" : "",
    onClick: p.onClick, onDoubleClick: p.onDblClick, onContextMenu: p.onContextMenu,
    style: { display: "flex", alignItems: "center", gap: "10px", padding: "6px 9px", borderRadius: "7px", cursor: "default", fontSize: "var(--holo-text-sm, 1rem)", color: "var(--holo-ink, #e6ecf5)", ...(p.style || {}) } },
    h("span", { style: { width: "18px", height: "18px", flex: "0 0 auto", display: "grid", placeItems: "center", color: p.iconColor || "var(--holo-accent, #3aa0ff)" }, dangerouslySetInnerHTML: p.icon ? { __html: p.icon } : undefined }),
    h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 } }, p.label),
    p.meta != null ? h("span", { style: { marginLeft: "auto", flex: "0 0 auto", color: "var(--holo-faint, #6b7890)", fontFamily: "var(--holo-mono, ui-monospace, monospace)", fontSize: "var(--holo-text-sm, 1rem)" } }, p.meta) : null,
    p.trailing != null ? h("span", { style: { flex: "0 0 auto", color: "var(--holo-muted, #9aa7bd)" } }, p.trailing) : null,
  );
}
export default ListRow;
