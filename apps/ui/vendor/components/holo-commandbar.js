// holo-commandbar.js — canonical SHELL object: the top action bar (left actions · flexible center · right actions).
// Self-contained Holo primitive (only `react`, linker-rewritten), themed by --holo-* tokens. Actions are
// structured + component-wired (so handlers survive, unlike pasting HTML); the center is an htmlString slot
// for static content (a wired input stays native and is NOT passed here — the omnibar lesson).
//   props: { left?:[Action], right?:[Action], centerHtml?, style? }   Action = { icon?:html, label?, title?, onClick?, active? }
import * as React from "react";
const h = React.createElement;

let styled = false;
function css() {
  if (styled || typeof document === "undefined") return; styled = true;
  const s = document.createElement("style"); s.id = "holo-shell-commandbar-css";
  s.textContent = '[data-holo-shell="commandbar"] button{transition:background .12s,color .12s,border-color .12s}'
    + '[data-holo-shell="commandbar"] button:not([data-active="1"]):hover{background:var(--holo-hover,#1b2433);color:var(--holo-ink,#e6ecf5)}';
  document.head.appendChild(s);
}
function Btn(a, i) {
  return h("button", { key: i, type: "button", title: a.title || a.label || "", onClick: a.onClick, "data-active": a.active ? "1" : undefined,
    style: { display: "inline-flex", alignItems: "center", gap: a.label ? "6px" : "0", justifyContent: "center",
      height: "30px", padding: a.label ? "0 11px" : "0", width: a.label ? undefined : "30px",
      borderRadius: "var(--holo-radius-sm, 8px)", border: "1px solid " + (a.active ? "var(--holo-accent, #3aa0ff)" : "transparent"),
      background: a.active ? "var(--holo-accent, #3aa0ff)" : "transparent", color: a.active ? "var(--holo-accent-ink, #fff)" : "var(--holo-muted, #9aa7bd)",
      font: "inherit", cursor: "pointer" } },
    a.icon ? h("span", { style: { width: "17px", height: "17px", display: "grid", placeItems: "center" }, dangerouslySetInnerHTML: { __html: a.icon } }) : null,
    a.label ? h("span", null, a.label) : null,
  );
}
export function CommandBar(props) {
  css(); const p = props || {};
  const grp = (arr) => (arr && arr.length) ? h("div", { style: { display: "flex", alignItems: "center", gap: "2px", flex: "0 0 auto" } }, ...arr.map(Btn)) : null;
  return h("div", { "data-holo-shell": "commandbar", style: {
    display: "flex", alignItems: "center", gap: "8px", height: "46px", padding: "7px 10px", boxSizing: "border-box",
    background: "var(--holo-surface, #0e131d)", borderBottom: "1px solid var(--holo-border, #222c3d)", color: "var(--holo-ink, #e6ecf5)", ...(p.style || {}) } },
    grp(p.left),
    h("div", { style: { flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center" }, dangerouslySetInnerHTML: p.centerHtml ? { __html: p.centerHtml } : undefined }),
    grp(p.right),
  );
}
export default CommandBar;
