// holo-emptystate.js — canonical SHELL object: the centered empty / zero state (icon · title · message · action).
// Self-contained, token-themed. Low-frequency, purely one-way → an ideal canonical object.
//   props: { icon?:html, title, message?, actionLabel?, onAction?, style? }
import * as React from "react";
const h = React.createElement;

let styled = false;
function css() {
  if (styled || typeof document === "undefined") return; styled = true;
  const s = document.createElement("style"); s.id = "holo-shell-empty-css";
  s.textContent = '[data-holo-shell="emptystate"] .he-btn{transition:filter .12s}[data-holo-shell="emptystate"] .he-btn:hover{filter:brightness(1.08)}';
  document.head.appendChild(s);
}
export function EmptyState(props) {
  css(); const p = props || {};
  return h("div", { "data-holo-shell": "emptystate", style: {
    display: "grid", placeContent: "center", justifyItems: "center", textAlign: "center", gap: "14px", padding: "30px",
    color: "var(--holo-faint, #6b7890)", ...(p.style || {}) } },
    p.icon ? h("span", { style: { width: "46px", height: "46px", display: "grid", placeItems: "center", color: "var(--holo-muted, #9aa7bd)", opacity: .8 }, dangerouslySetInnerHTML: { __html: p.icon } }) : null,
    h("div", { style: { fontSize: "var(--holo-text-md, 1.05rem)", color: "var(--holo-ink, #e6ecf5)" } }, p.title),
    p.message ? h("div", { style: { maxWidth: "30ch", lineHeight: 1.5 } }, p.message) : null,
    p.actionLabel ? h("button", { className: "he-btn", type: "button", onClick: p.onAction, style: {
      display: "inline-flex", alignItems: "center", gap: "8px", padding: "9px 16px", borderRadius: "var(--holo-radius, 9px)",
      border: "1px solid var(--holo-accent, #3aa0ff)", background: "var(--holo-accent, #3aa0ff)", color: "var(--holo-accent-ink, #fff)", fontWeight: 600, font: "inherit", cursor: "pointer" } }, p.actionLabel) : null,
  );
}
export default EmptyState;
