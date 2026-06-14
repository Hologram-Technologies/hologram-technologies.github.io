// holo-prov-ui.js — Holo Prov (ADR-0082) SHELL BINDING: provenance is a core, BINDING feature of
// every holospace shell. The shell mounts each holospace; this module — imported ONCE by the shell
// (the twin of holo-own-ui.js) — reads each mounted holospace's manifest + version chain, attaches a
// provenance cue to its window titlebar, and maintains the live PROVENANCE HYPERGRAPH: every
// holospace's evolving version chain (prov:wasRevisionOf) ⊕ the cross-app remix edges
// (prov:wasDerivedFrom). One binding point, no per-app code, no per-app relock.
//
// This is the FOUNDATION for Holo Indexer — the substrate's answer to a blockchain indexer.
// Subscribe with on(cb) to MONITOR and BROADCAST the hypergraph of evolving objects as it changes;
// graph() returns the current node/edge set; chainOf(appId) the per-holospace audit trail. Each
// holospace's chain is self-verifying (Law L5), so the indexer broadcasts truth it can re-derive,
// never a feed it must trust. Pure browser ESM, same-origin reads.

import { walkLineage, reDeriveClosure } from "/_shared/holo-prov.js";

const REG = new Map();            // appId → record { id, name, dir, manifest, chain, head, derivedFrom, versions }
const subs = new Set();           // hypergraph subscribers (Holo Indexer et al.)

const j = (u) => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

// derive the app's served directory from a window node (src = the iframe landing, or …?app=<id>)
function dirOf(node) {
  const src = String((node && node.src) || "");
  const m = src.match(/[?&]app=([^&#]+)/);
  if (m) return "/apps/" + decodeURIComponent(m[1]).replace(/^.*\//, "");
  const path = src.split(/[?#]/)[0];
  return path.replace(/\/[^/]*$/, "");                                  // /apps/x/index.html → /apps/x
}

// register(node, el) — called by the shell when it mounts a holospace window. Reads that holospace's
// manifest + version chain, sets the titlebar provenance cue, records it in the hypergraph, broadcasts.
export async function register(node, el) {
  if (!node || node.kind !== "app") return;
  const id = node.appId || node.appDid || dirOf(node);
  if (!id) return;
  if (REG.has(id)) { cue(el, REG.get(id)); return; }                   // already known → just (re)cue the new window
  const dir = dirOf(node);
  const [manifest, chainDoc] = await Promise.all([j(dir + "/holospace.json"), j(dir + "/holospace.prov.json")]);
  if (!manifest && !chainDoc) return;                                  // not a content-addressed holospace we can read
  const graphArr = (chainDoc && chainDoc["@graph"]) || [];
  const rec = {
    id, name: (manifest && manifest.name) || node.title || id, dir, manifest, chain: chainDoc,
    head: chainDoc && chainDoc.head, versions: graphArr.length,
    derivedFrom: (manifest && (manifest["prov:wasDerivedFrom"] || manifest["prov:wasRevisionOf"])) || null,
  };
  REG.set(id, rec);
  cue(el, rec);
  broadcast();
}

// the titlebar cue (mirrors refreshOwnTitle): append a provenance marker to the window title — a chain
// glyph + version count, with ↩ when the holospace is a remix of another. Hover reveals it; no shadow piercing.
function cue(el, rec) {
  if (!el || !rec || !el.getAttribute) return;
  const tag = `  ·  ⛓ v${rec.versions || 1}${rec.derivedFrom ? " ↩" : ""}`;
  const cur = el.getAttribute("title") || "";
  if (!cur.includes("⛓")) el.setAttribute("title", cur + tag);
}

// graph() → the live provenance HYPERGRAPH the indexer broadcasts. Nodes = holospaces (with their
// head version + version count). Edges = cross-app remix (wasDerivedFrom) + each per-app version step
// (wasRevisionOf). This is the evolving object graph, content-addressed end to end.
export function graph() {
  const nodes = [];
  const edges = [];
  for (const r of REG.values()) {
    nodes.push({ id: r.id, name: r.name, head: r.head, versions: r.versions });
    if (r.derivedFrom) edges.push({ from: r.id, to: r.derivedFrom, rel: "wasDerivedFrom", app: r.id });
    for (const entry of (r.chain && r.chain["@graph"]) || [])
      for (const l of entry.links || []) if (l.rel === "prov:wasRevisionOf") edges.push({ from: entry.id, to: l.id, rel: "wasRevisionOf", app: r.id });
  }
  return { nodes, edges, holospaces: nodes.length, generatedFrom: "holospace.prov.json (Law L5)" };
}

export const chainOf = (appId) => { const r = REG.get(appId); return r ? r.chain : null; };
export const recordOf = (appId) => REG.get(appId) || null;

// on(cb) → subscribe to hypergraph updates (the broadcast hook). Fires immediately with the current
// graph, then on every newly-registered holospace. Returns an unsubscribe fn.
export function on(cb) {
  subs.add(cb);
  try { cb(graph()); } catch {}
  return () => subs.delete(cb);
}
function broadcast() { const g = graph(); for (const cb of subs) try { cb(g); } catch {} }

// expose the verification primitives too — the indexer / a window badge can re-derive, not trust.
export { walkLineage, reDeriveClosure };

if (typeof window !== "undefined") window.HoloProv = Object.assign(window.HoloProv || {}, { register, graph, chainOf, recordOf, on });
