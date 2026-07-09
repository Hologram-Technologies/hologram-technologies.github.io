// holo-dialog.js — canonical SHELL object: a modal dialog (overlay · titled card · body · footer actions).
// Self-contained, token-themed. Body is an htmlString slot for static content (interactive content should
// be passed as wired actions, or kept native); footer actions are structured + component-wired.
//   props: { open?, title?, bodyHtml?, message?, actions?:[{label, variant?, onClick}], onClose?, style? }
import * as React from "react";
const h = React.createElement;

let styled = false;
function css() {
  if (styled || typeof document === "undefined") return; styled = true;
  const s = document.createElement("style"); s.id = "holo-shell-dialog-css";
  s.textContent = '[data-holo-shell="dialog-overlay"]{position:fixed;inset:0;z-index:80;display:grid;place-items:center;padding:5vh 5vw;background:#06080cdd;backdrop-filter:blur(7px)}'
    + '[data-holo-shell="dialog"] .hd-btn{transition:background .12s,filter .12s}'
    + '[data-holo-shell="dialog"] .hd-btn.ghost:hover{background:var(--holo-hover,#1b2433)}'
    + '[data-holo-shell="dialog"] .hd-btn.primary:hover{filter:brightness(1.08)}';
  document.head.appendChild(s);
}
function Action(a, i) {
  const primary = (a.variant || "default") === "default" || a.variant === "primary";
  return h("button", { key: i, type: "button", className: "hd-btn " + (primary ? "primary" : "ghost"), onClick: a.onClick, style: {
    display: "inline-flex", alignItems: "center", gap: "6px", padding: "9px 14px", borderRadius: "var(--holo-radius, 9px)", font: "inherit", cursor: "pointer",
    border: "1px solid " + (primary ? "var(--holo-accent, #3aa0ff)" : "var(--holo-border, #2c3850)"),
    background: primary ? "var(--holo-accent, #3aa0ff)" : "var(--holo-surface-2, #161d2c)",
    color: primary ? "var(--holo-accent-ink, #fff)" : "var(--holo-ink, #e6ecf5)", fontWeight: primary ? 600 : 400 } }, a.label);
}
export function Dialog(props) {
  css(); const p = props || {};
  if (p.open === false) return null;
  return h("div", { "data-holo-shell": "dialog-overlay", onClick: (e) => { if (e.target === e.currentTarget && p.onClose) p.onClose(); } },
    h("div", { "data-holo-shell": "dialog", style: {
      width: "min(560px, 92vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", boxSizing: "border-box",
      background: "var(--holo-surface, #121826)", border: "1px solid var(--holo-border, #2c3850)", borderRadius: "var(--holo-radius-lg, 16px)",
      color: "var(--holo-ink, #e6ecf5)", boxShadow: "0 30px 90px #000b", ...(p.style || {}) } },
      p.title ? h("div", { style: { padding: "16px 18px", borderBottom: "1px solid var(--holo-border, #222c3d)", fontWeight: 650, fontSize: "var(--holo-text-md, 1.05rem)" } }, p.title) : null,
      h("div", { style: { padding: "16px 18px", overflow: "auto", lineHeight: 1.55, color: "var(--holo-muted, #9aa7bd)" }, dangerouslySetInnerHTML: p.bodyHtml ? { __html: p.bodyHtml } : undefined }, p.bodyHtml ? undefined : (p.message || null)),
      (p.actions && p.actions.length) ? h("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", padding: "12px 16px", borderTop: "1px solid var(--holo-border, #222c3d)" } }, ...p.actions.map(Action)) : null,
    ),
  );
}
export default Dialog;
