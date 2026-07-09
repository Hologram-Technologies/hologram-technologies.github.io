// core/semantic.js — the SEMANTIC SKIN (gap C2): every κ-object the substrate produces carries an
// open-semantic-web type, so humans, agents, and W3C validators all read it the same way. Closes the
// weakest audit axis (κ names objects, but few declared a W3C @type). Two W3C standards, both native:
//   • JSON-LD / schema.org  — WHAT a thing is (a skill is a schema:HowTo; a file is a schema:DigitalDocument)
//   • PROV-O                — HOW it came to be (the κ-chain becomes prov:wasRevisionOf links)
// Pure, dependency-free, browser+node. The result round-trips through any JSON-LD/RDF tool.

export const HOLO_CONTEXT = {
  schema: "https://schema.org/",
  prov: "http://www.w3.org/ns/prov#",
  holo: "https://hologram.foundation/ns/",
  "@vocab": "https://schema.org/",
};

// schema.org type for a substrate object kind (the canonical mapping, L2 — fixed at the ingest boundary)
const TYPE_FOR = {
  skill: "HowTo",            // a reusable procedure = schema:HowTo (steps + when-to-use)
  file: "DigitalDocument",
  app: "SoftwareApplication",
  model: "SoftwareSourceCode",
  conversation: "Conversation",
  receipt: "CreativeWork",    // a sealed work record: schema:CreativeWork that is also a prov:Entity
};

// wrap any object as a typed, content-addressed JSON-LD node. `kappa` is its did:holo (the @id —
// content IS the identity, Law L1). `prov` is the κ-chain → prov:wasRevisionOf links (PROV-O).
export function asLinkedData({ kind, kappa, props = {}, prov = [] }) {
  const t = TYPE_FOR[kind] || "Thing";
  const node = {
    "@context": HOLO_CONTEXT,
    "@id": kappa,                                  // content-derived identity (no location — Law L1)
    "@type": Array.isArray(t) ? t : ["schema:" + t, "prov:Entity"],   // schema kind + PROV entity
    ...props,
  };
  if (prov.length >= 2) {                          // the version chain → PROV-O revision links
    const cur = prov[prov.length - 1], parent = prov[prov.length - 2];
    node["prov:wasRevisionOf"] = { "@id": parent.kappa };
    node["holo:version"] = cur.v;
  }
  node["prov:wasDerivedFrom"] = prov.length ? prov.map((p) => ({ "@id": p.kappa })) : undefined;
  return node;
}

// a skill → schema:HowTo (steps become schema:HowToStep), with its PROV-O revision chain.
export function skillAsHowTo({ name, description, instructions, kappa, prov = [] }) {
  const steps = String(instructions || "").split("\n").map((s) => s.trim()).filter(Boolean)
    .map((text, i) => ({ "@type": "schema:HowToStep", "schema:position": i + 1, "schema:text": text.replace(/^\d+[.)]\s*/, "") }));
  return asLinkedData({ kind: "skill", kappa, prov, props: { "schema:name": name, "schema:description": description, "schema:step": steps } });
}

// extension → IANA media type (schema:encodingFormat). Small, common set; default text/plain.
const MEDIA = { html: "text/html", htm: "text/html", js: "text/javascript", mjs: "text/javascript", json: "application/json", jsonld: "application/ld+json", css: "text/css", md: "text/markdown", txt: "text/plain", py: "text/x-python", svg: "image/svg+xml", wasm: "application/wasm", gz: "application/gzip" };
const mediaOf = (name) => MEDIA[String(name).toLowerCase().split(".").pop()] || "text/plain";

// a workspace file → schema:DigitalDocument (name + media type + byte size), content-addressed (L1).
export function fileAsDocument({ path, kappa, bytes = 0, mediaType, prov = [] }) {
  const name = String(path).split("/").filter(Boolean).pop() || String(path);
  return asLinkedData({ kind: "file", kappa, prov, props: {
    "schema:name": name, "schema:identifier": kappa,
    "schema:encodingFormat": mediaType || mediaOf(name), "schema:contentSize": bytes } });
}

// a built app → schema:SoftwareApplication (a self-contained WebGPU/Web app object).
export function appAsSoftware({ name, kappa, bytes = 0, prov = [] }) {
  return asLinkedData({ kind: "app", kappa, prov, props: {
    "schema:name": String(name).replace(/\.html$/i, ""), "schema:identifier": kappa,
    "schema:applicationCategory": "WebApplication", "schema:operatingSystem": "Any (WebGPU/Web)",
    "schema:fileSize": bytes } });
}

// a loaded model → schema:SoftwareSourceCode (the κ-object that runs on the GPU).
export function modelAsSource({ name, kappa, family, params, format, prov = [] }) {
  return asLinkedData({ kind: "model", kappa, prov, props: {
    "schema:name": name, "schema:identifier": kappa, "schema:programmingLanguage": "WGSL/WebGPU",
    "holo:family": family, "holo:parameters": params, "holo:format": format } });
}

// one dispatcher so any producer can type any κ-object: linkedDataFor("app", {...}) etc.
export function linkedDataFor(kind, props = {}) {
  switch (kind) {
    case "skill": return skillAsHowTo(props);
    case "file": return fileAsDocument(props);
    case "app": return appAsSoftware(props);
    case "model": return modelAsSource(props);
    default: return asLinkedData({ kind, kappa: props.kappa, prov: props.prov || [], props: props.props || props });
  }
}

// VERIFY (the gate): an object is semantically valid iff it has @context, an @id (κ), and a @type
// carrying both a schema.org kind and PROV-O lineage. Returns { ok, types, hasId, hasContext }.
export function verifySemantic(node) {
  const types = [].concat(node && node["@type"] || []);
  const hasSchema = types.some((t) => /^schema:|^https:\/\/schema\.org\//.test(t));
  const hasProv = types.some((t) => /^prov:/.test(t)) || !!node["prov:wasDerivedFrom"];
  const hasId = typeof node?.["@id"] === "string" && node["@id"].startsWith("did:holo:");
  const hasContext = !!node?.["@context"];
  return { ok: hasSchema && hasId && hasContext, hasSchema, hasProv, hasId, hasContext, types };
}
