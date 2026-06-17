// holo-object.mjs — the UOR object envelope (ADR-025): EVERYTHING is a self-verifying
// linked-data object. A UOR object is a canonical JSON-LD document whose IDENTITY is the
// hash of its own content (a content-derived did:holo) and that LINKS to other UOR objects
// by their content address — forming a self-verifying Merkle-DAG of linked data. Resolve
// any link → re-derive its hash → verify (Law L5), recursively, at every level.
//
// One object carries MANY vocabularies at once (@type / @context arrays): it is, on the
// same content-addressed identity, both a schema.org thing (web3 + AI) AND an ecosystem
// thing (web2 drop-in) — zero loss. UOR is the missing STRUCTURAL piece (self-verifying
// identity + composition); W3C/JSON-LD is the SEMANTIC piece (interpretable meaning). On
// the same object: a self-verifying, interpretable, serverless object graph. This is
// IPLD + RDF + DID unified. Pure + dependency-free (SHA-256 via node:crypto).

// Content addressing comes from ONE primitive (holo-uor.mjs) — Law L2, no per-file re-derivation.
// Re-exported for the many importers that read these off holo-object.
import { jcs, sha256hex, sriOf, mbSha256 } from "./holo-uor.mjs";
export { jcs, sriOf, mbSha256 };
const hexOf = (did) => String(did).split(":").pop();

// The base envelope @context: identity (did/v1) + integrity (data-integrity/v2) + the
// mint-nothing vocab. A `links` edge is a schema:hasPart to another content-addressed
// object; `rel` names the relation in schema.org's own additionalType term. Append more
// (ecosystem) contexts per object for multi-vocabulary linked data.
export const UOR_CONTEXT = Object.freeze([
  "https://www.w3.org/ns/did/v1",
  "https://w3id.org/security/data-integrity/v2",
  {
    schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", dcterms: "http://purl.org/dc/terms/",
    rel: "schema:additionalType",
    links: { "@id": "schema:hasPart", "@container": "@set" },
  },
]);

// address(obj): the object's self-verifying identity = did:holo:sha256:H(content), where
// `content` is the canonical object with its own `id` removed — it is "addressed by its
// self-verifying attributes". The hash commits to `links` too, so a child's address is
// part of its parent's address: a Merkle-DAG, acyclic by construction (a cycle would need
// an object's hash to depend on itself — pre-image-impossible).
export function address(obj) {
  const { id, ...content } = obj;
  return `did:holo:sha256:${sha256hex(Buffer.from(jcs(content), "utf8"))}`;
}
export const seal = (obj) => ({ ...obj, id: address(obj) });        // stamp the derived id
export const verify = (obj) => obj.id === address(obj);             // Law L5: re-derive, compare

// A content-addressed store: hex → canonical bytes. put() seals + stores the EXACT bytes a
// link's digest commits to and that resolve() returns (so re-derivation is byte-stable).
export function put(store, obj) {
  const sealed = seal(obj);
  store.set(hexOf(sealed.id), Buffer.from(jcs(sealed), "utf8"));
  return sealed;
}
export const resolve = (store, did) => { const b = store.get(hexOf(did)); return b ? JSON.parse(b.toString("utf8")) : null; };

// linkTo(store, rel, child): a typed, content-addressed, integrity-checked edge (SRI +
// multihash) — the open-web-verifiable Merkle link to another UOR object.
export function linkTo(store, rel, child) {
  const bytes = store.get(hexOf(child.id));
  return { id: child.id, rel, "@type": child["@type"], digestSRI: sriOf(bytes), digestMultibase: mbSha256(bytes) };
}

// contentLink(rel, kappa): a leaf edge to RAW content already addressed elsewhere (a file
// in the κ-store), by its existing sha256 κ — Law-L5 continuity. Derivable from the κ hex
// alone (no bytes); verified at resolve time by re-hashing the raw bytes to the address.
export function contentLink(rel, kappa, type = "schema:MediaObject") {
  const hex = String(kappa).split(":").pop();
  const digest = Buffer.from(hex, "hex");                         // the raw 32-byte sha-256
  return { id: `did:holo:sha256:${hex}`, rel, "@type": type, leaf: true,
    digestSRI: "sha256-" + digest.toString("base64"),
    digestMultibase: "u" + Buffer.concat([Buffer.from([0x12, 0x20]), digest]).toString("base64url") };
}

// verifyDeep(store, obj): re-derive + verify the WHOLE DAG top-to-bottom (Law L5 at every
// level). A tampered byte anywhere → refused, and the refusal propagates to the root.
export function verifyDeep(store, obj, depth = 0) {
  if (!verify(obj)) return { ok: false, at: obj.id, why: "id does not re-derive", depth };
  let maxDepth = depth;
  for (const link of obj.links || []) {
    const bytes = store.get(hexOf(link.id));
    if (!bytes) return { ok: false, at: link.id, why: "unresolved link", depth };
    if (sriOf(bytes) !== link.digestSRI) return { ok: false, at: link.id, why: "link digest mismatch", depth };
    if (link.leaf) {                                   // raw content-addressed blob, not a UOR object
      if (sha256hex(bytes) !== hexOf(link.id)) return { ok: false, at: link.id, why: "content hash mismatch", depth };
      maxDepth = Math.max(maxDepth, depth + 1);        // re-derived to its address (Law L5); no envelope to recurse
      continue;
    }
    const child = JSON.parse(bytes.toString("utf8"));
    if (child.id !== link.id) return { ok: false, at: link.id, why: "id/link mismatch", depth };
    const r = verifyDeep(store, child, depth + 1);
    if (!r.ok) return r;
    maxDepth = Math.max(maxDepth, r.depth);
  }
  return { ok: true, depth: maxDepth };
}

// makeObject(store, {type, context, links, ...props}): build a UOR object with the base
// context + any ecosystem vocab, then seal + store it. Seal children first, linkTo() them,
// then pass as `links` — the parent's address then commits to the children (Merkle).
export function makeObject(store, { type, context = [], links = [], ...props }) {
  const obj = { "@context": [...UOR_CONTEXT, ...context], "@type": type, ...props, ...(links.length ? { links } : {}) };
  return put(store, obj);
}

// Render contract (S1): the vocab + pure read-side helpers live in a DEPENDENCY-FREE module (no node:crypto)
// so the browser service worker can import them. Here we add makeRenderable, which seals (needs crypto).
// Re-exported so existing importers/witnesses read them off holo-object.
export { RENDER_CONTEXT, RENDER_KINDS, renderContract, kindOfContentType, selectRender } from "./holo-render-contract.mjs";
import { RENDER_CONTEXT as _RC, renderContract as _renderContract } from "./holo-render-contract.mjs";

// makeRenderable(store, {render, ...}) — a UOR object carrying a render contract. The render context is
// appended HERE (not to UOR_CONTEXT), so existing non-renderable objects are unchanged (byte-stable κ).
// `render` may be a built contract or the plain {kind,contentType,entry} args.
export function makeRenderable(store, { type, context = [], links = [], render, ...props }) {
  const contract = render && render["@type"] === "holo:RenderContract" ? render : _renderContract(render || {});
  return makeObject(store, { type, context: [_RC, ...context], links, render: contract, ...props });
}
