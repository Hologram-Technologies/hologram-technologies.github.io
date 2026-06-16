// holo-forge-bundle.mjs — the FORGE bundler class for Holo Import (ADR-0092/0093): a CLIENT-BUNDLE repo
// (Vite / webpack / React / Rollup — a real source tree, not a single HTML) becomes ONE self-contained,
// content-addressed Holo app via an IN-BROWSER esbuild κ-transform. This is the rung above the static
// class: it widens "paste a URL → it runs" toward ANY browser-renderable repo.
//
// THE κ-TRANSFORM (Holo Forge idiom, ADR-0051):  κ(repo sources) ⊕ κ(esbuild) ⊕ κ(flags) ⊕ κ(deps) →
// κ(bundle).  esbuild is DETERMINISTIC (identical inputs → identical bytes — proven), so the bundle
// re-derives (Law L5). The bundler is INJECTED — Node gets the real `esbuild` API, the browser gets
// `esbuild-wasm` — exactly like holo-forge.mjs injects its Zig toolchain (pure · isomorphic · the witness
// runs the real transform). The RESULT inlines everything → 0-network at runtime (serverless); the only
// network is at BUILD time (the dep ingest boundary, Law L4).
//
// HONEST about dependencies: a fresh GitHub repo ships NO node_modules. A relative-only repo bundles
// hermetically. A repo with BARE imports (`react`) resolves them through an injected `resolveBare(spec)` —
// the CDN ingest boundary (esm.sh / a κ-mirror), governed, and pinned for re-derivation. With no
// resolveBare a bare import is a HONEST build error (named, never a fake bundle), surfaced like any gap.

import { forgeReceipt, jcs } from "./holo-forge/holo-forge.mjs";   // reuse the re-derivable build-receipt shape
import { ensureMobileHead } from "./holo-mobile-defaults.mjs";     // every bundled app is mobile + PWA-ready at birth

const EXT_LOADER = { js: "js", mjs: "js", cjs: "js", jsx: "jsx", ts: "ts", tsx: "tsx", json: "json", css: "css", svg: "text", txt: "text" };
const TRY_EXT = ["", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".json", ".css", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
const clean = (p) => String(p).replace(/^\.?\//, "").split(/[?#]/)[0];
const loaderOf = (p) => EXT_LOADER[(p.split(".").pop() || "").toLowerCase()] || "text";
const dirOf = (p) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };
// join a relative spec against the importer's dir, collapsing ./ and ../
function joinRel(importerDir, spec) {
  const parts = (importerDir ? importerDir.split("/") : []).concat(clean(spec).split("/"));
  const out = []; for (const s of parts) { if (s === "" || s === ".") continue; if (s === "..") out.pop(); else out.push(s); }
  return out.join("/");
}

// findEntry(files) → the bundler entry module path. Vite/SPA: index.html's `<script type=module src>`;
// else package.json `module`/`main`; else a conventional src/main.* / src/index.*. Returns { entry, html }.
export function findEntry(files) {
  const has = (p) => files.has(p) ? p : null;
  const indexPath = ["index.html", "public/index.html", "src/index.html"].find((p) => files.has(p)) || null;
  let html = indexPath ? (files.get(indexPath).text || "") : null;
  if (html) {
    const m = html.match(/<script\b[^>]*\btype\s*=\s*["']module["'][^>]*\bsrc\s*=\s*["']([^"']+)["']/i)
      || html.match(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+\.[jt]sx?)["'][^>]*>/i);
    if (m && !/^(?:[a-z]+:)?\/\//i.test(m[1])) {
      const cand = clean(m[1]);
      for (const e of TRY_EXT) if (files.has(cand + e)) return { entry: cand + e, html, indexPath };
      if (files.has(cand)) return { entry: cand, html, indexPath };
    }
  }
  let pkg = null; const pf = files.get("package.json"); if (pf && pf.text) { try { pkg = JSON.parse(pf.text); } catch {} }
  const fromPkg = pkg && (pkg.module || pkg.main);
  const guesses = [fromPkg && clean(fromPkg), "src/main.tsx", "src/main.jsx", "src/main.ts", "src/main.js", "src/index.tsx", "src/index.jsx", "src/index.ts", "src/index.js"].filter(Boolean);
  for (const g of guesses) for (const e of TRY_EXT) if (files.has(g + e)) return { entry: g + e, html, indexPath };
  return { entry: null, html, indexPath };
}

// the esbuild virtual-FS plugin — resolves relative imports against `files`, bare imports via resolveBare.
function virtualPlugin(files, resolveBare, unresolved) {
  return {
    name: "holo-virtual-fs",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (a) => {
        if (a.kind === "entry-point") return { path: clean(a.path), namespace: "holo" };
        const spec = a.path;
        if (/^(?:[a-z]+:)?\/\//i.test(spec) || spec.startsWith("data:")) return { path: spec, external: true };   // absolute → external (runtime CDN, surfaced)
        if (spec.startsWith(".") || spec.startsWith("/")) {                                                        // relative → the repo files
          const base = joinRel(dirOf(a.importer === "<stdin>" ? "" : a.importer), spec);
          for (const e of TRY_EXT) if (files.has(base + e)) return { path: base + e, namespace: "holo" };
          return { errors: [{ text: "relative import not found in repo: " + spec + " (from " + a.importer + ")" }] };
        }
        // bare import (a dependency) → the injected CDN ingest boundary, or an honest error
        if (resolveBare) { const r = await resolveBare(spec); if (r && (r.contents != null || r.path)) return r.path ? { path: r.path, external: true } : { path: "bare:" + spec, namespace: "holo-bare", pluginData: r.contents }; }
        unresolved.push(spec);
        return { errors: [{ text: "bare dependency '" + spec + "' has no resolver — wire resolveBare (the CDN ingest boundary) to bundle it" }] };
      });
      build.onLoad({ filter: /.*/, namespace: "holo" }, (a) => {
        const f = files.get(a.path); if (!f) return { errors: [{ text: "load miss: " + a.path }] };
        return { contents: f.text != null ? f.text : "", loader: loaderOf(a.path), resolveDir: dirOf(a.path) };
      });
      build.onLoad({ filter: /.*/, namespace: "holo-bare" }, (a) => ({ contents: a.pluginData || "", loader: "js" }));
    },
  };
}

// bundleRepo({ files, entry, esbuild, resolveBare }) → { js, css, unresolved, warnings }. DETERMINISTIC
// (no minify/sourcemap host paths) → identical inputs yield identical bytes (re-derivable, Law L5).
export async function bundleRepo({ files, entry, esbuild, resolveBare = null, jsx = "automatic", format = "iife", globalName = undefined, define = {} }) {
  if (!files || typeof files.get !== "function") throw new Error("bundleRepo needs a files Map");
  if (!entry) throw new Error("bundleRepo needs an entry (use findEntry)");
  if (!esbuild || typeof esbuild.build !== "function") throw new Error("bundleRepo needs an injected esbuild (Node: esbuild; browser: esbuild-wasm)");
  const unresolved = [];
  const res = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format, platform: "browser",
    ...(globalName ? { globalName } : {}),
    jsx, minify: false, sourcemap: false, legalComments: "none", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"', ...define },
    plugins: [virtualPlugin(files, resolveBare, unresolved)],
  });
  let js = "", css = "";
  for (const o of res.outputFiles || []) { if (o.path.endsWith(".css")) css += o.text; else js += o.text; }
  return { js, css, unresolved, warnings: (res.warnings || []).map((w) => w.text) };
}

// encodeBundle({ html, indexPath, js, css }) → one self-contained HTML: the entry's module <script src> is
// replaced by the inlined bundle, the bundle CSS inlined as <style>. No index.html → a minimal wrapper.
export function encodeBundle({ html, js, css, mount = "root" }) {
  const style = css ? "<style>\n" + css + "\n</style>" : "";
  const script = "<script>\n" + js + "\n</script>";
  if (html && /<\/body>/i.test(html)) {
    let out = html.replace(/<script\b[^>]*\btype\s*=\s*["']module["'][^>]*><\/script>/i, "")   // drop the module entry tag
                  .replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+\.[jt]sx?["'][^>]*><\/script>/i, "");
    if (style && /<\/head>/i.test(out)) out = out.replace(/<\/head>/i, style + "\n</head>");
    else if (style) out = style + out;
    out = out.replace(/<\/body>/i, script + "\n</body>");
    return ensureMobileHead(out);   // mobile + PWA at birth (idempotent — only adds what's missing)
  }
  return ensureMobileHead('<!doctype html><html lang="en"><head><meta charset="utf-8">' + style + '</head><body><div id="' + mount + '"></div>' + script + "</body></html>");
}

// makeBundler({ esbuild, resolveBare, hash }) → a `bundle({ files, name })` ready to INJECT into
// holo-import.importRepo for the `forge` class: finds the entry, bundles, encodes, mints a forge receipt.
// Returns { html, entry, receipt, unresolved, selfContained }. Throws an honest error if no entry / a bare
// dep can't resolve (surfaced, never a fake bundle).
export function makeBundler({ esbuild, resolveBare = null, hash = null } = {}) {
  return async function bundle({ files, name = "app", sourceKappa = null }) {
    const { entry, html } = findEntry(files);
    if (!entry) throw new Error("forge: no bundler entry found (no index.html module script, no package.json main, no src/main.*)");
    const { js, css, unresolved, warnings } = await bundleRepo({ files, entry, esbuild, resolveBare });
    const out = encodeBundle({ html, js, css });
    let receipt = null;
    if (typeof hash === "function") {
      const enc = (s) => (typeof s === "string" ? s : jcs(s));
      receipt = forgeReceipt({
        sourceKappa: sourceKappa || ("did:holo:sha256:" + hash(enc(jcs([...files.keys()].sort())))),
        compilerKappa: "esbuild",   // the browser/Node injects the pinned esbuild κ; named here
        flagsKappa: "did:holo:sha256:" + hash(enc(jcs({ bundle: true, format: "iife", jsx: "automatic" }))),
        artifactKappa: "did:holo:sha256:" + hash(out), lang: "esbuild-bundle", exports: [],
      });
    }
    return { html: out, entry, receipt, unresolved, warnings, selfContained: unresolved.length === 0 };
  };
}

export function describeBundle() {
  return {
    is: "the FORGE bundler class — a client-bundle repo (Vite/webpack/React) → ONE self-contained content-addressed app via an in-browser esbuild κ-transform",
    rederive: "esbuild is deterministic → κ(sources⊕esbuild⊕flags⊕deps) → κ(bundle) re-derives (Law L5); the result is 0-network at runtime (serverless)",
    deps: "relative imports bundle hermetically; bare deps resolve through an injected resolveBare (the CDN ingest boundary, governed + pinned) or are an HONEST build error — never a fake bundle",
    injected: "esbuild is injected (Node: esbuild; browser: esbuild-wasm), the same pattern as holo-forge's Zig toolchain — pure + isomorphic + witnessed with the real transform",
  };
}

export default { findEntry, bundleRepo, encodeBundle, makeBundler, describeBundle };
