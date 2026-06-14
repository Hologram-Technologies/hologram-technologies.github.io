#!/usr/bin/env node
// holo-rank-build.mjs — make HoloRank BITE. The authority signal the search was missing needs a
// reference-edge corpus; the substrate already has one for free: the ES-module IMPORT GRAPH. An
// `import X from Y` is a CITATION (Y is depended-upon by X) — exactly HoloRank's `cites` edge. We
// derive those edges over the OS runtime modules (each addressed by its κ from substrate-index.json),
// run the real engine (holo-rank.mjs personalRank = forward-push personalized PageRank, seed = all
// nodes → global authority), and emit etc/holo-rank.json { hex → authority }. The result is itself
// re-derivable (Law L5): anyone re-runs the same edges and gets the same ranks. Google's secret rank
// cannot offer that. find.html folds this authority into local-object ranking.
//
//   node tools/holo-rank-build.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeEdge, personalRank } from "../os/usr/lib/holo/holo-rank.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS2 = join(here, "../os");

// rel (path under system/os) → sha256 hex, for every OS-runtime JS/MJS object in the substrate index.
const relToHex = new Map();
const si = JSON.parse(readFileSync(join(OS2, "etc/substrate-index.json"), "utf8"));
for (const [key, v] of Object.entries(si.objects || {})) {
  const m = key.match(/^os2\/system\/os\/(.+\.(?:js|mjs))$/);
  if (!m) continue;
  const hex = String((v && (v.sha256 || v.did)) || "").split(":").pop();
  if (/^[0-9a-f]{64}$/.test(hex)) relToHex.set(m[1], hex);
}

// resolve an import specifier (in the served URL space) to a substrate rel-path under system/os.
const norm = (p) => { const out = []; for (const seg of p.split("/")) { if (seg === "" || seg === ".") continue; if (seg === "..") out.pop(); else out.push(seg); } return out.join("/"); };
function resolveSpec(importerRel, spec) {
  if (/^(?:https?:|data:|node:|blob:)/.test(spec)) return null;
  let rel;
  if (spec.startsWith("./") || spec.startsWith("../")) rel = norm(importerRel.replace(/[^/]+$/, "") + spec);
  else if (/^\/?_shared\//.test(spec)) rel = "usr/lib/holo/" + spec.replace(/^\/?_shared\//, "");
  else if (spec.startsWith("/")) rel = spec.slice(1);            // absolute served path ≈ physical (sbin/ · usr/ · lib/ …)
  else return null;                                              // bare specifier → external package, not a substrate edge
  if (relToHex.has(rel)) return rel;
  for (const ext of [".js", ".mjs", "/index.js", "/index.mjs"]) if (relToHex.has(rel + ext)) return rel + ext;
  return null;
}

// extract every `from "X"` (static import/export) and `import("X")` (dynamic) specifier.
const FROM_RE = /\bfrom\s*["']([^"']+)["']/g, DYN_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const store = new Map(), edges = [], nodes = new Set();
let scanned = 0, miss = 0;
for (const [rel, hex] of relToHex) {
  let src; try { src = readFileSync(join(OS2, rel), "utf8"); } catch { continue; }
  scanned++;
  const fromDid = "did:holo:sha256:" + hex;
  const specs = new Set();
  let m; FROM_RE.lastIndex = 0; while ((m = FROM_RE.exec(src))) specs.add(m[1]);
  DYN_RE.lastIndex = 0; while ((m = DYN_RE.exec(src))) specs.add(m[1]);
  for (const spec of specs) {
    const tRel = resolveSpec(rel, spec);
    if (!tRel) { if (/^[./]/.test(spec)) miss++; continue; }
    const tHex = relToHex.get(tRel);
    if (!tHex || tHex === hex) continue;
    edges.push(makeEdge(store, { rel: "cites", from: fromDid, to: "did:holo:sha256:" + tHex, by: "did:holo:local:substrate" }));
    nodes.add(fromDid); nodes.add("did:holo:sha256:" + tHex);
  }
}

const r = personalRank(edges, [...nodes]);                       // seed = all nodes → global PageRank authority
const max = r.ranking.reduce((a, x) => Math.max(a, x.score), 0) || 1;
const ranks = {};
for (const { node, score } of r.ranking) ranks[node.split(":").pop()] = +(score / max).toFixed(6);

const doc = {
  "@context": ["https://schema.org/", { prov: "http://www.w3.org/ns/prov#" }],
  "@type": ["prov:Entity", "schema:Dataset"],
  name: "HoloRank — substrate module authority (import graph)",
  algorithm: "forward-push-ppr", note: "ranks = κ-hex → authority (0..1), derived from the ES-module import graph; re-derivable (Law L5)",
  nodes: nodes.size, edges: edges.length, ranks,
};
writeFileSync(join(OS2, "etc/holo-rank.json"), JSON.stringify(doc));

const relOf = (hex) => { for (const [k, v] of relToHex) if (v === hex) return k; return hex.slice(0, 12); };
console.log(`HoloRank: scanned ${scanned} modules · ${edges.length} cites edges · ${nodes.size} nodes · ${r.ranking.length} ranked (converged=${r.converged}, ${miss} unresolved local specifiers)`);
console.log("top authorities (most depended-upon = canonical):");
for (const { node, score } of r.ranking.slice(0, 14)) console.log(`  ${(score / max).toFixed(3)}  ${relOf(node.split(":").pop())}`);
