// holo-code-diff-witness.mjs — Stage D proof (#code-audit): the version-history diff. Any two κ-versions → a
// correct +/- line diff (LCS), with stats, rendered to the audit pane. Pure Node. Run: node holo-code-diff-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const { lineDiff, diffStat, renderDiffHTML, DIFF_CSS } = await import(pathToFileURL(resolve(HERE, "../os/usr/lib/holo/q/holo-code-diff.mjs")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

console.log("\nholo-code-diff — version-history diff (#code-audit)\n");

// 1) a real edit: one line changed, one added
{
  const a = "<h1>Hello</h1>\n<p>old</p>";
  const b = "<h1>Hello</h1>\n<p>new</p>\n<footer>x</footer>";
  const d = lineDiff(a, b);
  ok(d.find((x) => x.type === "same" && x.text === "<h1>Hello</h1>"), "the unchanged line is 'same'");
  ok(d.find((x) => x.type === "del" && x.text === "<p>old</p>"), "the replaced line shows as a deletion");
  ok(d.find((x) => x.type === "add" && x.text === "<p>new</p>"), "the new content shows as an addition");
  ok(d.find((x) => x.type === "add" && x.text === "<footer>x</footer>"), "the appended line is an addition");
  const st = diffStat(d);
  ok(st.added === 2 && st.removed === 1, "stats: +2 / −1");
}

// 2) identical versions → no changes
{
  const s = "line1\nline2\nline3";
  const d = lineDiff(s, s);
  ok(d.every((x) => x.type === "same") && d.length === 3, "identical source → every line 'same', nothing changed");
  ok(diffStat(d).added === 0 && diffStat(d).removed === 0, "stats: +0 / −0");
}

// 3) pure insertion / deletion at the ends
{
  ok(diffStat(lineDiff("", "a\nb")).added === 2, "empty → content = all additions");
  ok(diffStat(lineDiff("a\nb", "")).removed === 2, "content → empty = all deletions");
}

// 4) renders to the audit pane, themed
{
  const html = renderDiffHTML(lineDiff("a\nb", "a\nc"));
  ok(/hd-add/.test(html) && /hd-del/.test(html) && /hd-same/.test(html), "renders +/−/context lines");
  ok(/\+1/.test(html) && /−1/.test(html), "the stat header shows +1 / −1");
  ok(/--holo-/.test(DIFF_CSS), "the diff themes to --holo-* tokens");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
