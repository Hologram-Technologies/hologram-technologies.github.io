// holo-tile.js — a canonical SHELL object: the clickable tile (icon · title · subtitle · trailing).
// First-party Holo primitive, authored self-contained (only `react`, linker-rewritten) exactly like
// box.js — parameterized by props, themed ENTIRELY by --holo-* tokens (so every app's tiles look the
// same and follow the OS theme live). Rendered from its κ by holo-render.js; no compile on the hot path.
//   props: { icon?:htmlString, title, subtitle?, trailing?, onClick? }
import * as React from "react";

const h = React.createElement;

export function Tile(props) {
  const p = props || {};
  return h("div", {
    onClick: p.onClick,
    role: p.onClick ? "button" : undefined,
    "data-holo-shell": "tile",
    style: {
      display: "flex", alignItems: "center", gap: "13px", padding: "15px", minWidth: 0,
      width: "100%", boxSizing: "border-box",
      background: "var(--holo-surface, #121826)",
      border: "1px solid var(--holo-border, #222c3d)",
      borderRadius: "var(--holo-radius-lg, 13px)",
      cursor: p.onClick ? "pointer" : "default",
      color: "var(--holo-ink, #e6ecf5)",
      transition: "border-color .12s ease, background .12s ease, transform .12s ease",
    },
  },
    h("span", {
      style: {
        width: "40px", height: "40px", flex: "0 0 auto", display: "grid", placeItems: "center",
        borderRadius: "var(--holo-radius, 10px)",
        background: "var(--holo-bg, #0c1220)",
        border: "1px solid var(--holo-border, #222c3d)",
        color: "var(--holo-accent, #3aa0ff)",
      },
      dangerouslySetInnerHTML: p.icon ? { __html: p.icon } : undefined,
    }),
    h("div", { style: { minWidth: 0, flex: 1 } },
      h("div", { style: { fontWeight: 600, fontSize: "var(--holo-text-sm, 1rem)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, p.title),
      p.subtitle ? h("div", { style: { marginTop: "2px", fontSize: "var(--holo-text-sm, 1rem)", color: "var(--holo-muted, #9aa7bd)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, p.subtitle) : null,
    ),
    p.trailing ? h("span", { style: { marginLeft: "auto", flex: "0 0 auto", color: "var(--holo-muted, #9aa7bd)", fontFamily: "var(--holo-mono, ui-monospace, monospace)", fontSize: "var(--holo-text-sm, 1rem)" } }, p.trailing) : null,
  );
}

export default Tile;
