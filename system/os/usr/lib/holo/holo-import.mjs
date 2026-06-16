// holo-import.mjs — Holo Import (ADR-0092): paste a GitHub URL, get a running, content-addressed
// Holo app. The repo address goes in; a live, governed, interoperable holospace comes out — 100%
// serverless, in-browser. This module is the PURE, isomorphic CORE (Node + the browser run identical
// logic; the witness drives it headless). It NEVER fetches and NEVER hashes by itself — the network is
// an INGEST BOUNDARY (Law L4: a `fetchRepo` thunk is injected, brokered through holo-gov in the browser)
// and the address layer is injected (`hash` — WebCrypto in the browser, the pure sha256 of the repo in
// Node), exactly like holo-forge.mjs and holo-scene.mjs.
//
// THE LOAD-BEARING FINDING (why this is small, not a new runtime): once a repo is reduced to ONE
// self-contained HTML source string, it seals through the SAME `publishSource` UOR envelope the Create
// studio already uses (holo-blocks-repo.mjs) — so an imported app's κ is BYTE-IDENTICAL to a hand-built
// app's κ for the same source. Import is therefore NOT a new kind of object; it is a DETERMINISTIC
// ENCODER that produces a source the substrate already renders · links · remixes · shares · traces.
// Faithful by construction (no model, no hallucination — Law L5: same repo@commit → same app κ).
//
// HONEST SCOPE (the build-locus, decided per class — never papered over):
//   • static / client-SPA       → DIRECT here: inline assets into one HTML, seal. Runs now.
//   • needs a bundler            → FORGE: a re-derivable κ-transform (esbuild-wasm) — STAGED, classified
//                                  here, not executed (named, not faked).
//   • SSR / backend / DB / CLI   → OUT OF SCOPE v1: classified + the reason SURFACED in the result, so
//                                  "we don't run this yet" is visible, never a silently-empty app.
//
// Composition: Holo Q (ADR-0091, the import rides Q.create as task "import") · Holo Forge (ADR-0051, the
// staged bundler transform) · Holo Scene (ADR-0089, the app is one scene κ) · Holo Prov (ADR-0082, the
// receipt's wasDerivedFrom walks to GitHub forever) · holo-gov / Holo Q Remote (ADR-0090, the governed
// ingest fetch) · Holo Cosmos (ADR-0080, κ-streamed heavy assets). Grounded in Laws L1/L3/L4/L5.

export const VERSION = "holo-import/0.1.0";

// ── the UOR app envelope — mirrors holo-blocks-repo.mjs publishSource() EXACTLY so an imported app's κ
//    equals a studio-built app's κ for identical source bytes (the κ-parity that makes import first-class). ──
const UOR_CONTEXT = ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/data-integrity/v2",
  { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", dcterms: "http://purl.org/dc/terms/",
    rel: "schema:additionalType", links: { "@id": "schema:hasPart", "@container": "@set" } }];

// RFC 8785 JCS (sorted keys) — identical to holo-blocks-repo / holo-forge so one κ, every engine.
export const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
  : JSON.stringify(v);

import { ensureMobileHead } from "./holo-mobile-defaults.mjs";   // every imported app is mobile + PWA-ready at birth

// appEnvelope(name, source) → the exact object publishSource seals (minus its `id`). Sealing it with the
// injected `hash` over jcs() yields the SAME did:holo the studio would. derivedFrom (lineage) is metadata
// — it does not change the content address (Law L5 content-convergence, ADR-0088), matching publishSource.
export function appEnvelope(name, source, derivedFrom = null) {
  return { "@context": UOR_CONTEXT, "@type": ["schema:SoftwareSourceCode", "schema:WebApplication"],
    "schema:name": name, "schema:programmingLanguage": "HTML", "schema:text": source,
    ...(derivedFrom ? { "prov:wasDerivedFrom": derivedFrom } : {}) };
}
// sealApp({ name, source, hash, derivedFrom? }) → { id, bytes } — id is byte-identical to publishSource(.).id.
export function sealApp({ name, source, hash, derivedFrom = null }) {
  if (typeof hash !== "function") throw new Error("sealApp needs an injected hash(str)->hex (Law L2: hash elsewhere)");
  const env = appEnvelope(name, source, derivedFrom);
  return { id: "did:holo:sha256:" + hash(jcs(env)), bytes: jcs(env) };
}
const kappaOf = (bytesOrStr, hash) => "did:holo:sha256:" + hash(bytesOrStr);

// ── parse a GitHub reference — accepts a full URL, owner/repo, or a /tree/<ref> deep link. PURE. ────────
// The COMMIT is NOT resolved here (that is the fetcher's job — the pin happens at the ingest boundary):
// a bare branch ref is mutable, so `fetchRepo` MUST return the resolved commit SHA and we address THAT.
export function parseRepoRef(input) {
  const s = String(input || "").trim();
  let m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\.git)?(?:\/tree\/([^/\s#?]+))?/i);
  if (!m) m = s.match(/^(?:git@github\.com:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:@([\w./-]+))?$/);
  if (!m) return null;
  const owner = m[1], repo = m[2].replace(/\.git$/, ""), ref = m[3] || null;
  if (!owner || !repo) return null;
  return { owner, repo, ref, host: "github.com", url: `https://github.com/${owner}/${repo}` };
}

// ── classify the repo by CONTENT (package.json + the file listing), not guesswork. Returns the class, the
//    build-locus PATH, an honest reason, and whether it runs in v1. This is the gate that makes the feature
//    honest: every repo gets a truthful verdict, and the non-runnable ones say so. ──────────────────────
const BUNDLERS = ["vite", "webpack", "rollup", "parcel", "esbuild", "snowpack", "@vitejs/plugin-react"];
const SSR_FRAMEWORKS = ["next", "nuxt", "@remix-run/dev", "@remix-run/node", "astro", "@sveltejs/kit", "gatsby"];
const SERVER_DEPS = ["express", "fastify", "koa", "hapi", "@nestjs/core", "socket.io", "ws", "http-server-only"];
const DB_DEPS = ["pg", "mysql", "mysql2", "mongodb", "mongoose", "prisma", "@prisma/client", "sqlite3", "better-sqlite3", "redis", "ioredis", "typeorm", "sequelize"];

// HEADLINES — the one human line a person sees first (the machinery rides in `reason`, one tap deeper).
const HEADLINES = {
  static: "This one runs here — making it mine.",
  "client-bundle": "It needs building first — that path is coming.",
  ssr: "It renders on a server — that path is coming.",
  backend: "It needs a server. Hologram runs only what's truly mine.",
  cli: "A command-line tool — there's no app to open.",
  library: "A library, not an app — there's nothing to open.",
  monorepo: "Many apps in here — point me at the one I want.",
  unknown: "I couldn't find an app to open in here.",
};

export function classify(probe = {}) {
  const files = (probe.files || []).map((f) => String(f).replace(/^\.?\//, ""));
  const has = (re) => files.some((f) => re.test(f));
  const pkg = probe.pkg || null;
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};
  const depNames = Object.keys(deps);
  const dep = (list) => depNames.some((d) => list.includes(d));
  const scripts = (pkg && pkg.scripts) || {};
  const scriptText = Object.values(scripts).join(" ; ");
  const rootIndex = files.includes("index.html") || files.includes("public/index.html") || files.includes("docs/index.html") || files.includes("dist/index.html");

  const verdict = (cls, path, runs, reason, coverage = null) => ({ class: cls, headline: HEADLINES[cls] || null, path, runs, reason, coverage, entry: probe.entry || (rootIndex ? files.find((f) => /(^|\/)index\.html$/.test(f)) : null) });

  // 1) a non-JS / backend stack is out of scope v1 — a serverless device can't host a server or a DB.
  const nonJsServer = has(/(^|\/)(requirements\.txt|Pipfile|pyproject\.toml|go\.mod|Cargo\.toml|Gemfile|composer\.json|pom\.xml)$/i);
  if (dep(DB_DEPS)) return verdict("backend", "out-of-scope-v1", false, "depends on a database (" + depNames.filter((d) => DB_DEPS.includes(d)).join(", ") + ") — a serverless device has no server-side DB; translate persistence to the κ-store (ADR follow-on) or it cannot run faithfully.");
  if (dep(SERVER_DEPS)) return verdict("backend", "out-of-scope-v1", false, "runs an application server (" + depNames.filter((d) => SERVER_DEPS.includes(d)).join(", ") + ") — there is no server to run it on; the serverless line ends here in v1.");
  if (nonJsServer && !rootIndex) return verdict("backend", "out-of-scope-v1", false, "non-JS runtime (Python/Go/Rust/Ruby/PHP/Java) with no static entry — out of scope for the in-browser serverless target in v1.");

  // 2) SSR frameworks render on a server by default — staged (a static-export path may exist, but not faked here).
  if (dep(SSR_FRAMEWORKS)) return verdict("ssr", "translate-or-forge", false, "SSR framework (" + depNames.filter((d) => SSR_FRAMEWORKS.includes(d)).join(", ") + ") — renders server-side by default; a static-export/forge path is STAGED, not run in v1.");

  // 3) a client bundle (a bundler + a browser app, no server) → FORGE: bundle-in-browser as a re-derivable
  //    κ-transform (ADR-0051). Classified + named here; the transform execution is the staged follow-on.
  if (dep(BUNDLERS) || /\b(vite|webpack|rollup|parcel|esbuild)\b/.test(scriptText)) {
    return verdict("client-bundle", "forge", false, "a client-side bundle (" + (depNames.filter((d) => BUNDLERS.includes(d))[0] || "bundler in scripts") + ") — runs serverless AFTER an in-browser bundle (Holo Forge κ-transform, ADR-0051); STAGED as the next class up.", "the largest runnable class beyond static — esbuild-wasm in-browser, cached as a κ");
  }

  // 4) static / client SPA with a real HTML entry and no build step → DIRECT, runs NOW.
  if (rootIndex) return verdict("static", "direct", true, "a static site / client SPA with an HTML entry and no build step — inlined into one self-contained app κ and run directly.", "~static sites, hand-rolled SPAs, CDN-only apps");

  // 5) a library or CLI with no browser entry — nothing to render serverlessly in v1.
  if (pkg && (pkg.bin || (pkg.main && !rootIndex))) return verdict(pkg.bin ? "cli" : "library", "out-of-scope-v1", false, (pkg.bin ? "a CLI (bin entry)" : "a library (no app entry)") + " — no browser-renderable surface; nothing to run as a holospace in v1.");

  // 6) unknown / monorepo — needs a target chosen before it can be classified.
  if (pkg && (pkg.workspaces || has(/(^|\/)(pnpm-workspace\.yaml|lerna\.json|turbo\.json)$/))) return verdict("monorepo", "needs-target", false, "a monorepo (workspaces) — pick a single package/app to import; the repo root is not one app.");
  return verdict("unknown", "out-of-scope-v1", false, "no HTML entry and no recognized app manifest — cannot classify a runnable serverless surface; surfaced rather than guessed.");
}

// ── encodeStatic — faithfully inline a static/SPA repo into ONE self-contained HTML. FIDELITY-FIRST:
//    relative same-origin <link rel=stylesheet> and <script src> are inlined VERBATIM (byte-preserved);
//    ABSOLUTE / cross-origin / API refs are NOT inlined — they are recorded in `externalRefs` and SURFACED
//    (the "log what we don't run" rule: a backend call can't be served serverlessly, so we never pretend it
//    is — we show the gap). Pure: `files` is a Map<path, {text}|{bytes→text}>; nothing is fetched here. ──
const isRelative = (u) => u && !/^(?:[a-z][\w+.-]*:)?\/\//i.test(u) && !/^data:/i.test(u) && !/^#/.test(u) && !/^mailto:/i.test(u);
const normPath = (base, u) => String(u).replace(/^\.?\//, "").split(/[?#]/)[0]; // drop ./ and query/hash
const dirOf = (p) => { const i = String(p).lastIndexOf("/"); return i < 0 ? "" : String(p).slice(0, i); };
// resolve a relative ref against the entry's directory — so a repo whose index.html lives in public/ or
// dist/ and references "style.css" looks up "public/style.css" (handles "./", "../", and root-"/" refs).
function resolveRel(baseDir, u) {
  let s = String(u).split(/[?#]/)[0];
  if (s.startsWith("/")) return s.replace(/^\/+/, "");                          // root-relative → repo root
  const parts = (baseDir ? baseDir.split("/") : []).concat(s.split("/"));
  const out = []; for (const seg of parts) { if (seg === "" || seg === ".") continue; if (seg === "..") out.pop(); else out.push(seg); }
  return out.join("/");
}

export function encodeStatic({ name = "app", entry = "index.html", files, hash, baseDir = null }) {
  if (!files || typeof files.get !== "function") throw new Error("encodeStatic needs a files Map");
  const entryFile = files.get(entry) || files.get(normPath("", entry));
  if (!entryFile) throw new Error("encodeStatic: entry '" + entry + "' not in the repo files");
  const base = baseDir != null ? baseDir : dirOf(entry);                        // refs resolve against the entry's dir
  let html = entryFile.text != null ? entryFile.text : "";
  const inlined = [], externalRefs = [], missing = [], assetKappas = {};
  const lookup = (p) => files.get(p) || files.get(normPath("", p)) || null;

  // <link rel="stylesheet" href="X"> (rel/href in either order) → <style>…</style>
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const m = tag.match(/href\s*=\s*["']([^"']+)["']/i); if (!m) return tag;
    const href = m[1];
    if (!isRelative(href)) { externalRefs.push({ kind: "stylesheet", ref: href }); return tag; }
    const p = resolveRel(base, href); const f = lookup(p);
    if (!f) { missing.push({ kind: "stylesheet", ref: href }); return tag; }
    const css = f.text != null ? f.text : "";
    if (hash) assetKappas[p] = kappaOf(css, hash);
    inlined.push({ kind: "stylesheet", ref: href });
    return '<style data-holo-inlined="' + href + '">\n' + css + '\n</style>';
  });

  // <script src="X" …></script> → <script …>…</script> (preserve type=module + other attrs, drop src)
  html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, pre, src, post) => {
    if (!isRelative(src)) { externalRefs.push({ kind: "script", ref: src }); return tag; }
    const p = resolveRel(base, src); const f = lookup(p);
    if (!f) { missing.push({ kind: "script", ref: src }); return tag; }
    const js = f.text != null ? f.text : "";
    if (hash) assetKappas[p] = kappaOf(js, hash);
    inlined.push({ kind: "script", ref: src });
    const attrs = (pre + " " + post).replace(/\s+/g, " ").trim();
    return "<script" + (attrs ? " " + attrs : "") + ' data-holo-inlined="' + src + '">\n' + js + "\n</script>";
  });

  // surface remaining same-origin asset refs (img/href/fetch targets) WITHOUT inlining them — they become
  // κ-streamed objects later (Holo Cosmos LOD), but we record them so coverage is honest, never silent.
  const assetRefs = [];
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const u = m[1];
    if (isRelative(u) && !/\.(css|js|mjs)(\?|#|$)/i.test(u) && lookup(resolveRel(base, u))) assetRefs.push(u);
  }

  // Mobile + PWA at birth: ensure the imported app carries viewport-fit, the mobile layer, the container
  // surface marker, and PWA-standalone metas — only adds what the repo lacked (idempotent → κ stays deterministic).
  html = ensureMobileHead(html);
  return { name, html, inlined, externalRefs, missing, assetRefs, assetKappas,
    selfContained: externalRefs.length === 0 && missing.length === 0 };
}

// ── the import receipt — a PROV-O activity linking the GitHub source (repo@commit) → the app κ, so a remote
//    import carries honest lineage FOREVER and slots into Holo Prov walkLineage (ADR-0082). Mirrors the
//    forgeReceipt shape; the SOURCE is the pinned commit (git+url@sha), the GENERATED is the sealed app. ──
export function importReceipt({ repoUrl, commit, classification, sourceKappa, appKappa, name = "app", externalRefs = [] }) {
  return {
    "@context": ["https://www.w3.org/ns/did/v1",
      { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", hosc: "https://hologram.os/ns/conformance#" }],
    "@type": ["prov:Activity", "hosc:Import", "schema:CreateAction"],
    "schema:name": "Holo Import — " + name,
    "hosc:tool": { "schema:name": "holo-import", "schema:softwareVersion": VERSION },
    "hosc:class": classification && classification.class,
    "hosc:buildLocus": classification && classification.path,
    "prov:used": { "@id": "git+" + repoUrl + (commit ? "@" + commit : ""), "@type": ["prov:Entity", "schema:SoftwareSourceCode"],
      "schema:codeRepository": repoUrl, "schema:version": commit || null },
    "prov:generated": { "@id": appKappa, "@type": ["prov:Entity", "schema:WebApplication"] },
    ...(sourceKappa ? { "hosc:sourceManifest": sourceKappa } : {}),
    // honest: anything we could NOT serve serverlessly is named in the receipt, not hidden.
    ...(externalRefs.length ? { "hosc:unservedExternalRefs": externalRefs.map((r) => r.ref) } : {}),
  };
}

// ── makeGovernedFetch — the network as a GOVERNED INGEST BOUNDARY (Law L4). Every outbound fetch the
//    import does (the GitHub repo bytes, a CDN dependency, the build tool) passes the conscience BEFORE it
//    happens, and every accepted fetch mints a re-derivable PROV-O ingest receipt (who · url · host ·
//    purpose · contentκ). FAIL-CLOSED: with a conscience present, a red-line verdict (P5 PII / P6 / P7,
//    ADR-0033) REFUSES the fetch; with NO conscience and no explicit host opt-in, an ingest is denied by
//    default (the same shape as Q.agent). `conscience` may be an object ({evaluate?,evaluateText?}) or a
//    thunk (resolved per call → load-order safe); `fetch` + `hash` injected → Node-witnessable. ──
export function makeGovernedFetch({ conscience = null, fetch: rawFetch, allowUngoverned = false, hash = null, caller = "holo-import", now = () => 0 } = {}) {
  if (typeof rawFetch !== "function") throw new Error("makeGovernedFetch needs an injected fetch");
  const gate = () => (typeof conscience === "function" ? conscience() : conscience);
  return async function governedFetch(url, opts = {}) {
    const u = String(url); const host = (u.match(/^[a-z]+:\/\/([^/]+)/i) || [])[1] || "";
    const C = gate();
    if (C && (typeof C.evaluate === "function" || typeof C.evaluateText === "function")) {
      const decision = { verb: "import.ingest", caller, host, purpose: opts.purpose || "import" };
      let verdict;
      try { verdict = typeof C.evaluateText === "function" ? C.evaluateText(u, { decision }) : C.evaluate(decision); }
      catch (e) { return { ok: false, refused: true, reason: "gate error: " + ((e && e.message) || e), host }; }
      if (verdict && verdict.outcome === "block") return { ok: false, refused: true, reason: verdict.reason || (verdict.blocked || []).join(",") || "refused by conscience", host, blocked: verdict.blocked };
    } else if (!allowUngoverned) {
      return { ok: false, refused: true, reason: "no conscience gate — ingest is fail-closed (Law L4)", host };
    }
    const response = await rawFetch(u, opts.init || undefined);
    let receipt = null;
    if (typeof hash === "function") {
      let contentKappa = null;
      if (opts.body != null) contentKappa = "did:holo:sha256:" + hash(typeof opts.body === "string" ? opts.body : jcs(opts.body));
      receipt = { "@context": { prov: "http://www.w3.org/ns/prov#", hosc: "https://hologram.os/ns/conformance#" },
        "@type": ["prov:Activity", "hosc:Ingest"], "hosc:caller": caller, "prov:used": u, "hosc:host": host,
        "hosc:purpose": opts.purpose || "import", "hosc:at": now(), ...(contentKappa ? { "prov:generated": contentKappa } : {}) };
    }
    return { ok: true, response, receipt, host };
  };
}

// ── importRepo — the SPINE. URL → (governed) fetch → classify → encode → seal → receipt. The ONE async
//    entry the studio/Q call. `fetchRepo({owner,repo,ref}) → { commit, files: Map, entry? }` is INJECTED
//    (the ingest boundary; browser = a holo-gov-brokered fetch to raw.github / a κ-mirror / IPFS, witness =
//    a mock). `hash(str)->hex` is injected. For a non-static class it returns a runnable:false verdict with
//    the honest reason — never a fake app. ───────────────────────────────────────────────────────────────
export async function importRepo({ input, fetchRepo, hash, bundle = null }) {
  const ref = parseRepoRef(input);
  if (!ref) return { ok: false, reason: "not a GitHub repo reference: " + input };
  if (typeof fetchRepo !== "function") throw new Error("importRepo needs an injected fetchRepo (Law L4: the network is a boundary)");
  if (typeof hash !== "function") throw new Error("importRepo needs an injected hash");

  const fetched = await fetchRepo({ owner: ref.owner, repo: ref.repo, ref: ref.ref });
  const files = fetched.files, commit = fetched.commit || null;
  const fileList = [...files.keys()];
  let pkg = null; const pf = files.get("package.json"); if (pf && pf.text) { try { pkg = JSON.parse(pf.text); } catch { /* malformed → treated as no manifest */ } }

  const classification = classify({ files: fileList, pkg, entry: fetched.entry });
  const base = { ok: true, repo: ref, commit, classification };
  const sourceManifestKappa = kappaOf(jcs({ commit, files: fileList.sort() }), hash); // a manifest of WHAT was imported

  // FORGE class — a client-bundle repo runs ONLY if a bundler (esbuild) is injected (holo-forge-bundle).
  // No bundler → the honest staged notice (runnable:false). The bundle is the re-derivable κ-transform.
  if (classification.path === "forge") {
    if (typeof bundle !== "function") return { ...base, runnable: false, reason: classification.reason };
    let built; try { built = await bundle({ files, name: ref.repo, sourceKappa: sourceManifestKappa }); }
    catch (e) { return { ...base, runnable: false, reason: "forge bundle failed: " + ((e && e.message) || e), buildError: String((e && e.message) || e) }; }
    const app = sealApp({ name: ref.repo, source: built.html, hash });
    const receipt = importReceipt({ repoUrl: ref.url, commit, classification, sourceKappa: sourceManifestKappa,
      appKappa: app.id, name: ref.repo, externalRefs: (built.unresolved || []).map((s) => ({ kind: "dependency", ref: s })) });
    return { ...base, runnable: true, app, html: built.html, receipt, built: { entry: built.entry, receipt: built.receipt },
      externalRefs: (built.unresolved || []).map((s) => ({ kind: "dependency", ref: s })), selfContained: !!built.selfContained };
  }

  if (!classification.runs) {
    // honest stop: classified, reason surfaced, NOTHING faked.
    return { ...base, runnable: false, reason: classification.reason };
  }

  // the runnable (static/SPA) path — faithful encode → seal exactly like publishSource → mint the receipt.
  const enc = encodeStatic({ name: ref.repo, entry: classification.entry || fetched.entry || "index.html", files, hash });
  const app = sealApp({ name: ref.repo, source: enc.html, hash });
  const receipt = importReceipt({ repoUrl: ref.url, commit, classification, sourceKappa: sourceManifestKappa,
    appKappa: app.id, name: ref.repo, externalRefs: enc.externalRefs });

  return { ...base, runnable: true, app, html: enc.html, encode: enc, receipt,
    externalRefs: enc.externalRefs, selfContained: enc.selfContained };
}

// ── bindImporter — wire import onto the Holo Q spine as a DETERMINISTIC specialist (task "import"), so
//    `Q.create(repoUrl, { task: "import" })` rides the SAME κ-memo path as every other build: a repeat is
//    O(1) (cached "hot") and the encoder/fetcher is NOT re-run (the ingest happens once — Law L3). The
//    studio adopts the yielded HTML through its existing publishSource flow, so the studio app κ === the
//    import app κ. Returns the importer for direct calls too. `mux.bindSpecialist(task, {id, generate})`. ──
export function bindImporter(mux, { fetchRepo, hash, onResult = null, bundle = null } = {}) {
  const id = "holo-import";
  const generate = async function* (prompt) {
    const r = await importRepo({ input: prompt, fetchRepo, hash, bundle });   // bundle (esbuild) enables the FORGE class
    if (onResult) { try { onResult(r); } catch { /* observer must not break the build */ } }
    if (!r.ok) { yield { replace: noticeCard("I couldn't read that repo.", r.reason) }; return; }
    if (!r.runnable) { yield { replace: noticeCard((r.classification && r.classification.headline) || "Imported — but it can't run here yet.", r.classification.class + " · " + r.reason) }; return; }
    yield { replace: r.html };
  };
  mux.bindSpecialist("import", { id, generate });
  return { importRepo: (input) => importRepo({ input, fetchRepo, hash, bundle }) };
}
const notice = (msg) => '<!doctype html><meta charset="utf-8"><body style="margin:0;font:15px/1.5 system-ui;background:#0b0d12;color:#e7e9ee;display:grid;place-items:center;height:100vh"><div style="max-width:42ch;padding:2rem;white-space:pre-wrap;opacity:.92">' + msg.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])) + "</div></body>";

// noticeCard — two-tier disclosure: the human headline leads; the technical detail rides behind "Why".
const escNotice = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
const noticeCard = (headline, detail) => '<!doctype html><meta charset="utf-8"><body style="margin:0;font:15px/1.6 system-ui;background:#0b0d12;color:#e7e9ee;display:grid;place-items:center;height:100vh"><div style="max-width:44ch;padding:2rem;text-align:center"><div style="font-size:1.18rem;font-weight:600;line-height:1.4">' + escNotice(headline) + '</div>' + (detail ? '<details style="margin-top:1.15rem;font-size:.85rem"><summary style="cursor:pointer;opacity:.6;list-style:none">Why</summary><div style="margin-top:.7rem;opacity:.72;white-space:pre-wrap;line-height:1.55;text-align:left">' + escNotice(detail) + '</div></details>' : '') + '</div></body>';

export function describeImport() {
  return {
    is: "paste a GitHub URL → a running, content-addressed Holo app; import is a DETERMINISTIC encoder onto the existing publishSource/Q spine, not a new runtime",
    fidelity: "static/SPA repos are inlined VERBATIM into one app κ (byte-preserved, no model); same repo@commit → same κ (Law L5)",
    honest: "only the static/SPA class runs in v1; bundle→Forge, SSR/backend/DB/CLI are classified + their reason SURFACED, never faked; unserved external refs are named in the receipt",
    governance: "the fetch is an injected ingest boundary (holo-gov-brokered, Law L4); imported code is untrusted and stays sandboxed + conscience-gated (ADR-0033)",
  };
}

export default { VERSION, parseRepoRef, classify, encodeStatic, appEnvelope, sealApp, importReceipt, importRepo, bindImporter, makeGovernedFetch, describeImport, jcs };
