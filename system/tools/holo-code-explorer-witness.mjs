// holo-code-explorer-witness.mjs — Stage C proof (#code-kappa-tree): Code mode's file tree IS the app's κ-object
// tree (the κ-lens), laid out as a familiar src/ layout; opening a file reads-through-κ (verify, refuse tamper);
// the governed save route is correct per group (manifest→version, projection→editAtPath, data→view/proposal).
// Composes the REAL full-stack builder. Pure Node. Run: node holo-code-explorer-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const { explorerModel, openFile, saveDescriptor } = await imp("../os/usr/lib/holo/q/holo-code-explorer.mjs");
const { renderExplorerHTML, renderTabsHTML, EXPLORER_CSS } = await imp("../os/usr/lib/holo/q/holo-code-explorer-ui.mjs");
const { buildFullStackApp } = await imp("../os/usr/lib/holo/q/holo-q-app-agent.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

const plan = async () => ({ name: "Flat Expenses", identity: "required", ui: { type: "page", children: [{ type: "hero", props: { title: "Flat Expenses" } }, { type: "form", props: { fields: [{ label: "What", name: "title", type: "text" }], submit: "add" } }] }, collections: [{ name: "expenses", kind: "expense", fields: [{ name: "title", type: "string" }] }], capabilities: [{ collection: "expenses", ops: ["read", "write"] }] });
const build = await buildFullStackApp("a shared expense tracker", { plan, pricing: { expenses: { amount: 5 } } });
const model = explorerModel(build);

console.log("\nholo-code-explorer — the file tree IS the κ-object tree (#code-kappa-tree)\n");

// 1) the explorer is the human-meaningful κ-object tree (index.html — not 19 Merkle fragments — + manifest/reducer/data)
console.log("explorer = meaningful κ-files:");
{
  ok(model.files.some((f) => f.name === "index.html" && f.path === "src/index.html"), "index.html at src/ (the projection SOURCE — ONE file, not the DAG fragments)");
  ok(model.files.filter((f) => f.group === "projection").length === 1, "the projection is collapsed to a single editable document (fragments stay in the Dev κ-panel)");
  ok(model.files.some((f) => f.name === "manifest.json" && f.path === "src/manifest.json"), "manifest.json at src/ (the identity)");
  ok(model.files.some((f) => f.name === "reducer.js" && f.path === "src/reducer.js"), "reducer.js at src/ (the logic)");
  ok(model.files.some((f) => f.name === "expenses.json" && f.path === "data/expenses.json"), "the collection is data/expenses.json");
  ok(model.files.every((f) => f.kappa && f.lang), "every file is addressed by a κ + carries a language");
  ok(model.api.some((e) => e.kind === "rest" && /\/expenses\/access/.test(e.name)), "REST/MCP surface listed as a read-only API section (incl. the priced route)");
}

// 2) opening a file reads-through-κ (verify) and gives editor-ready text
console.log("\nopen = read-through-κ (verify-before-show):");
{
  const idx = model.files.find((f) => f.name === "index.html");
  const o = openFile(idx, build.sealed.store);
  ok(o.verified === true && /<!doctype html>/i.test(o.content), "index.html opens, re-derives to its κ, returns the real source");
  ok(o.lang === "html", "language is set for syntax highlight (html)");
  const mf = model.files.find((f) => f.group === "manifest");
  ok(openFile(mf, build.sealed.store).lang === "json", "manifest opens from the store as json");
}

// 3) a tampered / missing κ is REFUSED on open (red read-only)
console.log("\ntamper-refuse on open (L5/SEC-1):");
{
  const idx = model.files.find((f) => f.name === "index.html");
  let refusedSrc = false; try { openFile(Object.assign({}, idx, { content: idx.content + "<!--EVIL-->" }), build.sealed.store); } catch (e) { refusedSrc = /L5 REFUSE/.test(e.message); }
  ok(refusedSrc, "a tampered SOURCE file (content ≠ κ) is REFUSED on open");
  const mf = model.files.find((f) => f.group === "manifest");
  const bad = Object.assign({}, build.sealed.store); bad[mf.kappa] = (bad[mf.kappa] || "").replace("Flat Expenses", "EVIL");
  let refused = false; try { openFile(mf, bad); } catch (e) { refused = /L5 REFUSE/.test(e.message); }
  ok(refused, "a tampered STORE κ-object is REFUSED on open");
  let missed = false; try { openFile({ kappa: "deadbeef", lang: "json" }, build.sealed.store); } catch (e) { missed = /MISSING/.test(e.message); }
  ok(missed, "a missing κ fails loudly");
}

// 4) the governed SAVE route is correct per group — no second sealer, no autonomous data write
console.log("\ngoverned save route (the ONE liveEdit, never autonomous):");
{
  ok(saveDescriptor(model.files.find((f) => f.group === "manifest")).kind === "version", "manifest save → a new version κ");
  ok(saveDescriptor(model.files.find((f) => f.name === "index.html")).kind === "reseal", "index.html save → reseal via the one liveEdit primitive");
  const data = model.files.find((f) => f.group === "collection");
  ok(data.readOnly === true && saveDescriptor(data).editable === false, "a data file is view-only here (a write is a PROPOSAL §2.9 — never an autonomous edit)");
}

// 5) shape-agnostic: works on the publish shape too (no empty explorer after Publish)
console.log("\nshape-agnostic (build AND publish-sealed):");
{
  const asPublish = { compiled: build.app, sealed: build.sealed, api: build.api };
  const mp = explorerModel(asPublish);
  ok(mp.files.length === model.files.length && mp.manifestK === model.manifestK, "the publish shape yields the same file tree");
}

// 6) the VS Code-style sidebar renders the tree (groups · verify dots · RO badges · API section · --holo-* theme)
console.log("\nVS Code chrome renders (pure HTML):");
{
  const mf = model.files.find((f) => f.group === "manifest");
  const html = renderExplorerHTML(model, { activeId: mf.kappa });
  ok(/hx-grp-h">src</.test(html) && /hx-grp-h">data</.test(html), "renders the familiar src/ + data/ groups");
  ok(html.includes('data-k="' + mf.kappa + '"') && /hx-file on/.test(html), "the active file is highlighted (data-k = its κ)");
  ok((html.match(/hx-dot ok/g) || []).length === model.files.filter((f) => f.verified).length, "a green verify dot per re-deriving file (L5 at a glance)");
  ok(/hx-ro"/.test(html), "data/capability files carry a view-only (RO) badge");
  ok(/API · read-only/.test(html) && /hx-api/.test(html), "the REST/MCP API section renders read-only");
  const tabs = renderTabsHTML([{ id: mf.kappa, name: "manifest.json", lang: "json", kappa: mf.kappa }], { activeId: mf.kappa });
  ok(/hx-tab on/.test(tabs) && /manifest\.json/.test(tabs) && /hx-x/.test(tabs), "the editor tab strip renders the open file with a close affordance");
  ok(/--holo-/.test(EXPLORER_CSS), "the chrome themes to --holo-* tokens (reads as Hologram, not generic VS Code)");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
