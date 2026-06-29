// holo-device-graph.mjs — Plane 2 (MEANING), structural floor. Turns the device κ-index
// (device-closure.json: path → {blake3, bytes, mtime, volume}) into the SAME κ-hypergraph shape
// holo-map produces, so it composes with content-extracted graphs via mergeGraphs and Q reasons over
// it uniformly. This layer is DETERMINISTIC and NO-LLM — the always-works floor (MemPalace spatial +
// Hyper-Extract n-ary/temporal/spatial). Content extraction (entities from inside files via runPlus +
// Q) layers on top later; this gives an instant, exhaustive, navigable map the moment the scan lands.
//
// N-ary hyperedges, RDF-correctly: a Folder / Volume / Day / FileType / Content is an ENTITY HUB that
// many files point at. "Everything in folder X" / "files changed on day D" / "all copies of this
// content" is then ONE hop (membersByPredicate) — a reified hyperedge, not an N-way join. Every node
// and edge is κ-identified; every claim cites the file's content κ as provenance (Law L5 evidence).

import { extractGraph, mergeGraphs } from "./holo-map.mjs";

const basename = (p) => String(p).split("/").pop() || String(p);
// the parent folder of an absolute, forward-slashed path; a top-level item folds to its volume root.
function folderOf(p) {
  const i = String(p).lastIndexOf("/");
  if (i <= 0) return "/";
  const head = p.slice(0, i);
  return head.length ? head : "/";
}
const volumeOf = (p, fallback) => fallback || (/^[A-Za-z]:/.test(p) ? p.slice(0, 2) : "/");
const extOf = (name) => { const m = /\.([A-Za-z0-9]+)$/.exec(name); return m ? m[1].toLowerCase() : ""; };
const dayOf = (mtimeSec) => {
  if (!mtimeSec || mtimeSec <= 0) return null;
  // deterministic UTC YYYY-MM-DD (no locale) — the temporal hub.
  return new Date(mtimeSec * 1000).toISOString().slice(0, 10);
};
const hexOf = (k) => String(k || "").split(":").pop();

// ONE file's structural neighbourhood, as the {entities, relationships} extractGraph consumes. The
// hub entities (Folder/Volume/Day/FileType/Content) dedup across files by their identity κ, so the
// merged graph is the whole device's spatial+temporal+type+dedup hypergraph.
export function fileExtract(path, meta = {}) {
  const name = basename(path);
  const folder = folderOf(path);
  const vol = volumeOf(path, meta.volume);
  const ext = extOf(name);
  const day = dayOf(meta.mtime);
  const contentHex = hexOf(meta.blake3 || meta.kappa);

  const entities = [
    { name: path, type: "File", attributes: {
        // identity (schema:name on the node) is the full PATH so two same-named files stay distinct;
        // the display basename is its own attribute claim.
        "holo:basename": name,
        "holo:bytes": meta.bytes != null ? String(meta.bytes) : "",
        "holo:mtime": meta.mtime != null ? String(meta.mtime) : "",
        "holo:contentKappa": meta.blake3 || meta.kappa || "",
      } },
    { name: folder, type: "Folder", attributes: {} },
    { name: vol, type: "Volume", attributes: {} },
  ];
  const relationships = [
    { subject: path, subjectType: "File", predicate: "holo:inFolder", object: folder, objectType: "Folder" },
    { subject: folder, subjectType: "Folder", predicate: "holo:onVolume", object: vol, objectType: "Volume" },
  ];
  if (contentHex) {
    entities.push({ name: contentHex, type: "Content", attributes: {} });
    relationships.push({ subject: path, subjectType: "File", predicate: "holo:hasContent", object: contentHex, objectType: "Content" });
  }
  if (ext) {
    entities.push({ name: ext, type: "FileType", attributes: {} });
    relationships.push({ subject: path, subjectType: "File", predicate: "holo:hasType", object: ext, objectType: "FileType" });
  }
  if (day) {
    entities.push({ name: day, type: "Day", attributes: {} });
    relationships.push({ subject: path, subjectType: "File", predicate: "holo:modifiedOn", object: day, objectType: "Day" });
  }
  return { entities, relationships };
}

// buildDeviceGraph(closure) → ONE merged κ-hypergraph over every file in the device closure. Each
// file's source κ (its blake3) is the provenance anchor for its structural claims. Composable with
// content graphs (mergeGraphs) and re-derivable (closure is order-invariant).
export function buildDeviceGraph(closure, { hash } = {}) {
  const opts = hash ? { hash } : {};
  const graphs = [];
  for (const [path, meta] of Object.entries(closure || {})) {
    const src = (meta && (meta.blake3 || meta.kappa)) || ("path:" + path);
    graphs.push(extractGraph({ text: "", sourceKappa: src, extract: () => fileExtract(path, meta || {}) }, opts));
  }
  return mergeGraphs(graphs, opts);
}

// ── query helpers — the n-ary hyperedge traversals the Explorer search/atlas lenses use ────────────

// the identity κ of a (name, entityType) hub already present in the graph (null if absent).
export function entityKappa(graph, name, type) {
  const k = String(name).trim().toLowerCase();
  const e = (graph["holo:entities"] || []).find(
    (n) => n["holo:entityType"] === type && String(n["schema:name"]).trim().toLowerCase() === k,
  );
  return e ? e["@id"] : null;
}

// every subject κ whose claim is (subject)-[predicate]->(objectKappa) — ONE-hop hyperedge membership.
export function membersByPredicate(graph, predicate, objectKappa) {
  return (graph["holo:claims"] || [])
    .filter((c) => c["holo:objectKind"] === "entity" && c["holo:predicate"] === predicate && c["holo:object"] === objectKappa)
    .map((c) => c["holo:subject"]);
}

export const filesInFolder = (graph, folderPath) => {
  const fk = entityKappa(graph, folderPath, "Folder");
  return fk ? membersByPredicate(graph, "holo:inFolder", fk) : [];
};
export const filesModifiedOn = (graph, day) => {
  const dk = entityKappa(graph, day, "Day");
  return dk ? membersByPredicate(graph, "holo:modifiedOn", dk) : [];
};
export const filesOfType = (graph, ext) => {
  const tk = entityKappa(graph, String(ext).toLowerCase(), "FileType");
  return tk ? membersByPredicate(graph, "holo:hasType", tk) : [];
};
// all File κs sharing one content κ (the dedup hyperedge — "every copy of this object").
export const filesWithContent = (graph, contentHexOrKappa) => {
  const ck = entityKappa(graph, hexOf(contentHexOrKappa), "Content");
  return ck ? membersByPredicate(graph, "holo:hasContent", ck) : [];
};

// the entity node for a File path (carries its name/bytes/mtime/contentKappa attributes as claims).
export const fileNode = (graph, path) => {
  const fk = entityKappa(graph, path, "File");
  return fk ? (graph["holo:entities"] || []).find((n) => n["@id"] === fk) : null;
};

// ── searchDevice — Tier A "talk to your disk": deterministic, NO-LLM keyword ranking over the device
// closure (the always-works floor; Q reranking/NL is Tier B). Operates directly on the closure (cheap,
// no graph build), so a 84k-file disk still answers in a single fast pass. Returns ranked file hits with
// their content κ for one-click open/verify. basename match ≫ path match; recency breaks ties. ─────────
export function searchDevice(query, closure, { limit = 50 } = {}) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const [path, meta] of Object.entries(closure || {})) {
    const lp = path.toLowerCase();
    const name = basename(path).toLowerCase();
    let score = 0;
    if (name === q) score = 120;
    else if (name.startsWith(q)) score = 100;
    else if (name.includes(q)) score = 60;
    else if (lp.includes(q)) score = 30;
    if (score) out.push({ path, kappa: (meta && (meta.blake3 || meta.kappa)) || "", bytes: meta && meta.bytes, mtime: meta && meta.mtime, score });
  }
  out.sort((a, b) => b.score - a.score || (b.mtime || 0) - (a.mtime || 0) || a.path.localeCompare(b.path));
  return out.slice(0, limit);
}

export default { buildDeviceGraph, fileExtract, entityKappa, membersByPredicate, filesInFolder, filesModifiedOn, filesOfType, filesWithContent, fileNode, searchDevice };
