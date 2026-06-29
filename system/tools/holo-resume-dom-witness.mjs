// holo-resume-dom-witness.mjs — pure pathOf keying witness (no real DOM). Run: node tools/holo-resume-dom-witness.mjs
// capture()/apply() are DOM glue → verified in a real browser (dev server); here we pin the path keying that
// must round-trip through querySelector, since a wrong path = silently-lost deep state.
import { pathOf } from "../os/usr/lib/holo/holo-resume-dom.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.error("  ✗ " + n); } };

// minimal fake element: nodeType/tagName/id/previousElementSibling/parentElement (the surface pathOf uses)
function el(tag, { id = "", parent = null, prev = [] } = {}) {
  const e = { nodeType: 1, tagName: tag.toUpperCase(), id, parentElement: parent, previousElementSibling: null };
  // chain prev siblings (same array order = DOM order)
  let last = null; for (const p of prev) { p.parentElement = parent; last = p; }
  return e;
}
// helper to wire an ordered sibling list under a parent
function siblings(parent, ...kids) { for (let i = 0; i < kids.length; i++) { kids[i].parentElement = parent; kids[i].previousElementSibling = i ? kids[i - 1] : null; } return kids; }

ok("null → null", pathOf(null) === null);
ok("text node → null", pathOf({ nodeType: 3 }) === null);

// id wins immediately
ok("id-anchored", pathOf({ nodeType: 1, tagName: "DIV", id: "editor" }) === "#editor");

// nth-of-type chain up to an id ancestor
const root = { nodeType: 1, tagName: "MAIN", id: "app", parentElement: null };
const [d1, d2, d3] = siblings(root, el("div"), el("div"), el("div"));
const ta = el("textarea"); siblings(d2, ta);
ok("chain stops at id ancestor", pathOf(ta) === "#app>div:nth-of-type(2)>textarea:nth-of-type(1)");
ok("nth-of-type counts only same tag", pathOf(d3) === "#app>div:nth-of-type(3)");

// mixed tags: nth-of-type is per-tag
const r2 = { nodeType: 1, tagName: "SECTION", id: "s", parentElement: null };
const [p1, dA, p2] = siblings(r2, el("p"), el("div"), el("p"));
ok("p2 is nth-of-type(2) despite a div between", pathOf(p2) === "#s>p:nth-of-type(2)");
ok("dA is div nth-of-type(1)", pathOf(dA) === "#s>div:nth-of-type(1)");

// stops at HTML (no id anywhere) — bounded, ends at body-ish
const html = { nodeType: 1, tagName: "HTML", parentElement: null };
const body = el("body"); siblings(html, body);
const sec = el("section"); siblings(body, sec);
ok("path ends below HTML", pathOf(sec) === "body:nth-of-type(1)>section:nth-of-type(1)");

console.log(`holo-resume-dom-witness: ${pass}/${pass + fail} green`);
process.exit(fail ? 1 : 0);
