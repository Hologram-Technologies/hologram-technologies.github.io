// _shared/holo-atlas.js — Holo Atlas (ADR-0043): the PURE, isomorphic runtime that builds the
// content-addressed MAP of every holospace from the canonical sources. Like an ecosystem atlas
// (hermesatlas.com) but inverted to the UOR substrate: instead of ranking projects by popularity
// (stars/forks), it maps CONTENT TRUTH — each holospace's identity is its did:holo (the hash of its
// own closure), its size is the bytes that κ commits to, its place on the map is the real
// shared-dependency graph the store dedups (Law L3), and its conformance is the specs it proves.
//
// Discovery, indexing and monitoring are all reads of what already exists (Law L4 — no parallel
// store): apps/index.jsonld (the content-addressed app catalog) joined to each holospace.json (the
// manifest) + holospace.lock.json (the closure) + the agent-door indices (NANDA/A2A/Skills + the MCP
// roster) + apps-witness.result.json (the integrity proof). atlasModel(sources) → { stats, apps, graph }
// is a DETERMINISTIC function of those bytes, so a whole atlas is content-addressable (the sealing
// lives in holo-atlas.mjs / the in-tab self-verification uses holo-object.js). Pure + dependency-free.

const isArr = Array.isArray;
const arr = (v) => (isArr(v) ? v : v == null ? [] : [v]);
const dirOfLanding = (lp) => (String(lp || "").match(/^apps\/([^/]+)\//) || [])[1] || null;

// the constitution gate every closure carries (ADR-033) — excluded from the dependency GRAPH (it is
// the constitutional baseline of EVERY app, so it would draw a meaningless complete graph), but still
// counted in a record's integrity (carriesConstitution).
export const CONSCIENCE = "holo-conscience.js";

// the four agent "doors" are NOT symmetric: NANDA + A2A are per-app projections (each holospace gets
// its own AgentFacts / AgentCard), so they JOIN to an app — NANDA by schema:isBasedOn == the app's
// root κ (holo-nanda.mjs), A2A by card.name == the app's schema:name (an A2A card carries no app id).
// Skills + MCP are OS-WIDE (one roster), so they are a single shared door, present for every app.
const nandaFactsOf = (nanda) => arr(nanda && nanda["@graph"]).filter((o) => o && o["schema:isBasedOn"]);
const a2aCardsOf = (a2a) => arr(a2a && a2a["@graph"]).filter((o) => o && isArr(o.supportedInterfaces));

// atlasRecord(d, sources) — one unified per-app record, joined across the canonical sources. `d` is a
// dcat:dataset entry from apps/index.jsonld; the rest is looked up by the app's directory.
export function atlasRecord(d, sources) {
  const doors = (sources && sources.doors) || {};
  const root = d["@id"];
  const id = d["schema:identifier"];
  const name = d["schema:name"];
  const dir = dirOfLanding(d["dcat:landingPage"]);
  const app = ((sources && sources.apps) || {})[dir] || {};
  const def = app.def || {};
  const lock = app.lock || {};
  const closureObj = lock.closure || {};
  const closure = Object.entries(closureObj)
    .map(([path, e]) => ({ path, kappa: e.kappa, sri: e.sri, bytes: e.bytes || 0 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const bytes = closure.reduce((s, e) => s + (e.bytes || 0), 0);
  // declared shared deps drive the dependency edges (drop the constitutional baseline)
  const shared = (arr(d["schema:softwareRequirements"]).length ? arr(d["schema:softwareRequirements"]) : arr(def.shared))
    .filter((x) => x !== CONSCIENCE).slice().sort();
  const specs = arr(def.conforms && def.conforms.specs).slice().sort();
  const releases = arr(def.releases);
  const witnessRec = arr(sources && sources.witness && sources.witness.apps).find((w) => w.id === dir) || null;
  const nandaFacts = nandaFactsOf(doors.nanda).find((f) => f["schema:isBasedOn"] === root) || null;
  const a2aCard = a2aCardsOf(doors.a2a).find((c) => c.name === name) || null;
  const skillsRoot = (doors.skills && doors.skills.root) || null;
  const mcp = doors.mcp || null;
  return {
    id, root, dir, name,
    summary: d["schema:description"] || def.summary || "",
    type: arr(d["@type"]).length ? arr(d["@type"]) : ["schema:SoftwareApplication"],
    category: d["schema:applicationCategory"] || def.applicationCategory || "Application",
    landingPage: d["dcat:landingPage"] || (dir ? `apps/${dir}/index.html` : ""),
    files: lock.files || closure.length,
    bytes,
    closure,
    ownFiles: closure.filter((e) => dir && e.path.startsWith(`apps/${dir}/`)).length,
    sharedFiles: closure.filter((e) => e.path.startsWith("_shared/")).length,
    specs, specCount: specs.length,
    shared,
    developer: def.developer || null,
    license: def.license || null,
    homepage: def.homepage || null,
    keywords: arr(def.keywords),
    categories: arr(def.categories),
    releases,
    version: (releases[releases.length - 1] || {}).version || "1.0",
    accent: def.accent || null,
    carriesConstitution: !!closureObj[`_shared/${CONSCIENCE}`],
    witnessOk: witnessRec ? witnessRec.ok === true : null,
    doors: {
      nanda: { present: !!nandaFacts, agent_name: nandaFacts ? nandaFacts.agent_name : null, facts: nandaFacts ? nandaFacts.id : null },
      a2a: { present: !!a2aCard, card: a2aCard ? a2aCard.id : null },
      skills: { present: !!skillsRoot, indexRoot: skillsRoot },
      mcp: { present: !!mcp, tools: arr(def.tools).map((t) => t.name) },
    },
    // filled in the browser by the live re-derivation badge (Law L5); null elsewhere.
    live: { reDerives: null, checked: 0, total: closure.length },
  };
}

// atlasModel(sources) → { stats, apps, graph }. PURE + deterministic (apps sorted by root κ), so the
// whole model — and its seal — is reproducible and content-addressable.
export function atlasModel(sources = {}) {
  const dataset = arr(sources.index && sources.index["dcat:dataset"]);
  const apps = dataset.map((d) => atlasRecord(d, sources)).sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0));
  const specSet = new Set();
  for (const a of apps) for (const s of a.specs) specSet.add(s);
  const known = apps.filter((a) => a.witnessOk !== null);
  const stats = {
    holospaces: apps.length,
    totalBytes: apps.reduce((s, a) => s + a.bytes, 0),
    totalFiles: apps.reduce((s, a) => s + a.files, 0),
    totalSpecs: specSet.size,
    witnessedGreenPct: known.length ? Math.round((100 * known.filter((a) => a.witnessOk).length) / known.length) : null,
    doors: {
      nanda: apps.filter((a) => a.doors.nanda.present).length,
      a2a: apps.filter((a) => a.doors.a2a.present).length,
      skills: apps.filter((a) => a.doors.skills.present).length,
      mcp: arr(sources.doors && sources.doors.mcp && sources.doors.mcp.tools).length,
    },
  };
  return { stats, apps, graph: buildGraph(apps) };
}

// buildGraph(apps) → { nodes, edges, depEdges, specEdges }. A node is a holospace; an edge joins two
// holospaces that share ≥1 declared dependency (kind:"dep", the Law-L3 closure graph) or ≥1
// conformance spec (kind:"spec", the conformance-community graph). Edge weight is the intersection
// size. Deterministic (everything sorted) so the graph is part of the re-derivable model.
export function buildGraph(apps) {
  const nodes = apps.map((a) => ({
    id: a.id, root: a.root, label: a.name, category: a.category,
    size: a.bytes, files: a.files, color: a.accent || "#7c83ff", specCount: a.specCount,
  }));
  // A dep shared by almost everyone (holo-theme.js, holo-mobile.css) carries no discriminating signal —
  // it would draw a near-complete graph. So dependency edges use only DISTINCTIVE shared deps (present in
  // < 70% of apps); the constellation then shows real clusters (apps that share holo-collab, holo-blocks,
  // …), not a hairball. Deterministic (frequency over the sorted app set).
  const freq = new Map();
  for (const a of apps) for (const d of a.shared) freq.set(d, (freq.get(d) || 0) + 1);
  const ubiquitousAt = Math.max(2, Math.ceil(apps.length * 0.7));
  const distinctive = (a) => a.shared.filter((d) => (freq.get(d) || 0) < ubiquitousAt);
  const distMap = new Map(apps.map((a) => [a.id, distinctive(a)]));
  const inter = (x, y) => { const sy = new Set(y); return x.filter((v) => sy.has(v)); };
  const edges = [];
  for (let i = 0; i < apps.length; i++) {
    for (let j = i + 1; j < apps.length; j++) {
      const A = apps[i], B = apps[j];
      const dep = inter(distMap.get(A.id), distMap.get(B.id));
      if (dep.length) edges.push({ a: A.id, b: B.id, kind: "dep", weight: dep.length, shared: dep.slice().sort() });
      const spec = inter(A.specs, B.specs);
      if (spec.length) edges.push({ a: A.id, b: B.id, kind: "spec", weight: spec.length, shared: spec.slice().sort() });
    }
  }
  edges.sort((e1, e2) => (e1.a + e1.b + e1.kind).localeCompare(e2.a + e2.b + e2.kind));
  return {
    nodes, edges,
    depEdges: edges.filter((e) => e.kind === "dep").length,
    specEdges: edges.filter((e) => e.kind === "spec").length,
  };
}

if (typeof window !== "undefined") window.HoloAtlas = { atlasModel, atlasRecord, buildGraph, CONSCIENCE };
