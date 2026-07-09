// holo-statusbar.js — a canonical SHELL object: the app status bar (count · selection · spacer · trust).
// First-party Holo primitive, self-contained (only `react`, linker-rewritten), themed by --holo-* tokens
// so every app's status bar is identical and theme-following. The trust marker is intrinsic — a status
// bar in this OS ALWAYS states that its objects are content-addressed. Re-rendered from its κ on demand
// (warm rebind is sub-ms), so apps just pass current data; no DOM mutation, no per-app styling.
//   props: { items?, folders?, files?, sel?, selKappa?, badge?="content-addressed", shield?:htmlString }
import * as React from "react";

const h = React.createElement;
const muted = "var(--holo-muted, #9aa7bd)";

export function StatusBar(props) {
  const p = props || {};
  const count = (p.items != null) ? h("span", { key: "c" },
    h("b", { style: { color: "var(--holo-ink, #e6ecf5)", fontWeight: 600 } }, String(p.items)),
    " items · " + (p.folders || 0) + " folders · " + (p.files || 0) + " files",
  ) : null;
  const sel = p.sel ? h("span", { key: "s" }, "selected ",
    h("b", { style: { color: "var(--holo-ink, #e6ecf5)", fontWeight: 600 } }, p.sel),
    p.selKappa ? h("span", { style: { color: "var(--holo-accent, #3aa0ff)", fontFamily: "var(--holo-mono, ui-monospace, monospace)" } }, " · " + p.selKappa) : null,
  ) : null;
  return h("div", {
    "data-holo-shell": "statusbar",
    style: {
      display: "flex", alignItems: "center", gap: "14px", height: "26px", padding: "0 12px",
      flex: "1 1 auto", boxSizing: "border-box",
      background: "var(--holo-surface, #0e131d)",
      borderTop: "1px solid var(--holo-border, #222c3d)",
      color: muted,
      font: "var(--holo-text-sm, 1rem) var(--holo-sans, system-ui, sans-serif)",
    },
  },
    count, sel,
    h("span", { key: "sp", style: { marginLeft: "auto" } }),
    h("span", { key: "b", style: { display: "inline-flex", alignItems: "center", gap: "5px", color: "var(--holo-ok, #34d399)" } },
      p.shield ? h("span", { style: { width: "12px", height: "12px", display: "inline-grid", placeItems: "center" }, dangerouslySetInnerHTML: { __html: p.shield } }) : null,
      p.badge || "content-addressed",
    ),
  );
}

export default StatusBar;
