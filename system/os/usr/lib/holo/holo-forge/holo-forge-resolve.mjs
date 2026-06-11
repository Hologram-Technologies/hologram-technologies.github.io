// holo-forge-resolve.mjs — the content-addressed library resolver + linker for Holo Forge
// (ADR-0051). Pure, isomorphic, zero-dependency (no crypto here — Law L2: canonicalize once,
// hash elsewhere). Given a content-addressed registry of Holo-C libraries (each with a κ and a
// declared dependency list), it resolves the TRANSITIVE dependency closure, DEDUPLICATES shared
// libraries (Law L3 — a library pulled by two dependents is linked exactly once), and produces a
// single deterministic linked source unit. Identical inputs ⇒ identical link ⇒ identical artifact
// κ, so a whole dependency graph re-derives byte-for-byte with no server (Law L5) — a verifiable
// package universe, the supply chain as a self-verifying Merkle-DAG.
//
// A registry is { libraries: [ { name, version, deps:[name…], exports:[…], source, sourceKappa } ] }.

export const RESOLVE_VERSION = "holo-forge-resolve/1.0.0";

const byName = (registry) => { const m = new Map(); for (const l of registry.libraries || []) m.set(l.name, l); return m; };

// resolveClosure(registry, requested) → [lib…] in dependency order (deps before dependents),
// each appearing once. Deterministic: requested names are sorted, then post-order DFS over deps.
export function resolveClosure(registry, requested) {
  const libs = byName(registry);
  const order = [];        // resolved libs, deps-first
  const seen = new Set();  // dedup (Law L3)
  const stack = new Set(); // cycle guard
  const visit = (name, from) => {
    const lib = libs.get(name);
    if (!lib) throw new Error(`unknown library '${name}'${from ? ` (required by '${from}')` : ""}`);
    if (seen.has(name)) return;
    if (stack.has(name)) throw new Error(`dependency cycle at '${name}'`);
    stack.add(name);
    for (const d of [...(lib.deps || [])].sort()) visit(d, name);   // deps first
    stack.delete(name);
    seen.add(name); order.push(lib);
  };
  for (const n of [...new Set(requested)].sort()) visit(n, null);
  return order;
}

// linkedSource(orderedLibs, programSource) → one Holo-C compilation unit. Libraries are concatenated
// in dependency order, the program last; the existing compiler compiles the unit unchanged (so the
// compiler κ never moves). Cross-library calls resolve because every definition is in one unit.
export function linkedSource(orderedLibs, programSource = "") {
  const parts = orderedLibs.map((l) => `// ── holo-std/${l.name}@${l.version || "0"} · ${l.sourceKappa} ──\n${l.source.replace(/\s*$/,"")}\n`);
  if (programSource.trim()) parts.push(`// ── program ──\n${programSource.replace(/\s*$/,"")}\n`);
  return parts.join("\n");
}

// linkReceipt(fields) → the canonical multi-input build receipt (WITHOUT its id). A PROV-O activity
// that links every library κ + the program κ → the linked artifact κ, via the compiler κ. The
// caller seals it (hashes jcs() bytes) with its platform crypto. prov:used is sorted by @id so the
// object — and therefore its did:holo — is identical on every platform.
export function linkReceipt({ libs = [], programKappa = null, compilerKappa, flagsKappa, artifactKappa, exports = [] }) {
  const used = libs.map((l) => ({ "@id": l.kappa, "@type": ["prov:Entity", "schema:SoftwareSourceCode"], "schema:name": `holo-std/${l.name}`, "hosc:role": "library", ...(l.deps && l.deps.length ? { "hosc:dependsOn": [...l.deps].sort() } : {}) }));
  if (programKappa) used.push({ "@id": programKappa, "@type": ["prov:Entity", "schema:SoftwareSourceCode"], "schema:name": "program", "hosc:role": "program" });
  used.sort((a, b) => (a["@id"] < b["@id"] ? -1 : a["@id"] > b["@id"] ? 1 : 0));
  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", hosc: "https://hologram.os/ns/conformance#" },
    ],
    "@type": ["prov:Activity", "hosc:LinkedCompilation", "schema:CreateAction"],
    "schema:name": "Holo Forge linked compilation",
    "hosc:tool": { "@id": compilerKappa, "schema:name": "holo-forge", "schema:softwareVersion": RESOLVE_VERSION },
    "hosc:flags": flagsKappa,
    "prov:used": used,
    "prov:generated": { "@id": artifactKappa, "@type": ["prov:Entity", "schema:SoftwareApplication"], "schema:encodingFormat": "application/wasm" },
    "schema:result": [...exports].map((e) => (typeof e === "string" ? e : e.name)).sort(),
  };
}
