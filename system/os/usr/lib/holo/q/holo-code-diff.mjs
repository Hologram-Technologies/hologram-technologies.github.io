// holo-code-diff.mjs — the "audit" half of Code mode: a familiar +/- line diff between any two versions. Every
// edit is already a content-addressed κ in studio.history (Lovable-style version history, free from the
// substrate); this turns any two of those versions into a VS Code-style diff, rendered into the read-only audit
// pane (#cs-fileview). LCS-based, deterministic, editor-agnostic → Node-witnessed.
//
//   lineDiff(oldStr, newStr) -> [{ type:'same'|'add'|'del', text }]
//   diffStat(diff)           -> { added, removed }
//   renderDiffHTML(diff)     -> string         // shown in the audit pane; DIFF_CSS styles it (--holo-*)

export function lineDiff(oldStr = "", newStr = "") {
  const a = String(oldStr).split("\n"), b = String(newStr).split("\n");
  const n = a.length, m = b.length;
  // LCS length table (bounded; source files are small) — backtracked into a minimal add/del script
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: "same", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "del", text: a[i] }); i++; }
    else { out.push({ type: "add", text: b[j] }); j++; }
  }
  while (i < n) out.push({ type: "del", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}

export function diffStat(diff = []) {
  return { added: diff.filter((d) => d.type === "add").length, removed: diff.filter((d) => d.type === "del").length };
}

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function renderDiffHTML(diff = []) {
  const st = diffStat(diff);
  const rows = diff.map((d) => {
    const sign = d.type === "add" ? "+" : d.type === "del" ? "−" : " ";
    return `<div class="hd-line hd-${d.type}"><span class="hd-sign">${sign}</span>${esc(d.text) || "&nbsp;"}</div>`;
  }).join("");
  return `<div class="hd-wrap"><div class="hd-stat"><span class="hd-add">+${st.added}</span> <span class="hd-del">−${st.removed}</span> changed</div>${rows}</div>`;
}

export const DIFF_CSS = `
.hd-wrap{font:0.78rem/1.5 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word}
.hd-stat{position:sticky;top:0;padding:4px 10px;background:var(--holo-surface,#161a26);border-bottom:1px solid var(--holo-line,#2a2f37);color:var(--holo-ink-3,#8a97a8)}
.hd-add{color:var(--holo-ok,#34d399)}.hd-del{color:var(--holo-bad,#f87171)}
.hd-line{padding:0 10px}.hd-sign{display:inline-block;width:1.4ch;opacity:.7}
.hd-line.hd-add{background:rgba(52,211,153,.10)}.hd-line.hd-del{background:rgba(248,113,113,.10)}
`;

export default { lineDiff, diffStat, renderDiffHTML, DIFF_CSS };
