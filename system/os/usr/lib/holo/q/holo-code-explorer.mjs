// holo-code-explorer.mjs — Code mode's VS Code-familiar FILE TREE. The files are the app's HUMAN-meaningful
// κ-objects: src/index.html (the projection SOURCE — one editable document, byte-identical to its κ), src/
// manifest.json (identity), src/reducer.js (logic), data/<collection>.json (state), and a read-only API section
// (the derived REST/MCP). NOTE the deliberate granularity split: Code shows index.html as ONE file; the Dev
// κ-panel (lensFor) shows every internal κ-fragment of the projection DAG — same substrate, the altitude that
// fits the tool. Opening a file READS-THROUGH-κ (re-derive + verify; a tampered/missing κ → refused, red/read-
// only — L5/SEC-1). Saving routes through the GOVERNED path only (index.html/source → reseal via the one
// liveEdit; manifest → a new version κ; data/capability → view-only, a write is a proposal §2.9). Editor-
// agnostic: returns {content, lang} that CodeMirror consumes. Pure → Node-witnessed.
//
//   explorerModel(build) -> { manifestK, files:[file], api:[endpoint] }
//   openFile(file, store) -> { content, lang, kappa, verified }            // refuses a tampered κ
//   saveDescriptor(file)  -> { kind, note, editable }                       // the governed save route (no sealer here)

import { sha256hex, jcs } from "../holo-uor.mjs";
import { inspectKappa } from "../devtools/holo-devtools-kappa-lens.mjs";

const LANG = { html: "html", json: "json", javascript: "javascript" };

function file(name, path, kappa, group, lang, opts = {}) {
  return { id: kappa || path, name, path, kappa: kappa || null, group, lang,
    content: opts.content != null ? opts.content : null,          // inline content (source files); else load via store
    verified: opts.verified !== false, readOnly: !!opts.readOnly };
}

// explorerModel(build) — the human-meaningful file tree. build = buildFullStackApp/buildFromIntent ({app}) OR
// sealBuiltApp ({compiled}) OR a single-source holospace ({source:"<html>"} / a raw html string).
export function explorerModel(build = {}) {
  const app = build.app || build.compiled || (build && build.manifestK ? build : null);
  const files = [], api = [];

  if (app) {
    if (app.projectionHtml != null) {
      const k = app.projectionK || sha256hex(app.projectionHtml);
      files.push(file("index.html", "src/index.html", k, "projection", "html",
        { content: app.projectionHtml, verified: sha256hex(app.projectionHtml) === k }));
    }
    if (app.manifest) files.push(file("manifest.json", "src/manifest.json", app.manifestK, "manifest", "json"));
    if (app.reducer != null) files.push(file("reducer.js", "src/reducer.js", app.reducerK, "reducer", "javascript"));
    for (const c of (app.collections || [])) {
      const k = c.genesisK || (c.genesis && sha256hex(jcs(c.genesis)));
      files.push(file((c.name || "data") + ".json", "data/" + (c.name || "data") + ".json", k, "collection", "json", { readOnly: true }));
    }
    const a = build.api || {};
    for (const r of (a.routes || [])) api.push({ name: `${r.method} ${r.path}`, kind: "rest", gated: !!r.gated, price: r.price || null });
    for (const t of (a.tools || [])) api.push({ name: t.name, kind: "mcp" });
    return { manifestK: app.manifestK || null, files, api };
  }

  // single-source holospace: one editable document
  const src = typeof build === "string" ? build : (build.source != null ? build.source : null);
  if (src != null) {
    const k = sha256hex(src);
    files.push(file("index.html", "src/index.html", k, "projection", "html", { content: src, verified: true }));
  }
  return { manifestK: files[0] ? files[0].kappa : null, files, api };
}

// openFile — read-through-κ. Source files carry inline content (re-derive sha256===κ); store-backed κ-objects
// resolve via inspectKappa (which throws MISSING / L5 REFUSE on tamper). Returns editor-ready text + language.
export function openFile(file = {}, store = {}) {
  if (file.content != null) {
    if (file.kappa && sha256hex(file.content) !== file.kappa) throw new Error("L5 REFUSE " + file.kappa);
    return { content: file.content, lang: file.lang || "text", kappa: file.kappa, verified: true };
  }
  const r = inspectKappa(file.kappa, store);                       // MISSING / L5 REFUSE on tamper
  const content = typeof r.content === "string" ? r.content : JSON.stringify(r.content, null, 2);
  return { content, lang: file.lang || "text", kappa: r.kappa, verified: true };
}

// saveDescriptor — the GOVERNED route a save takes (executed by the live shell's liveEdit / version flow — NOT
// here; no second sealer). Tells the UI whether the file is editable and how it re-seals.
export function saveDescriptor(file = {}) {
  if (file.readOnly) return { kind: "view", editable: false, note: "data/capability — a write is a proposal (§2.9)" };
  if (file.group === "manifest") return { kind: "version", editable: true, note: "save → a new manifest κ (versions immutable)" };
  return { kind: "reseal", editable: true, note: "save → a new κ via the one liveEdit primitive" };
}

export default { explorerModel, openFile, saveDescriptor };
