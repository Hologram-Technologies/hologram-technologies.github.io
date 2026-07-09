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
// IPLD + RDF + DID unified. Pure + dependency-free — the ONE isomorphic substrate envelope
// (SHA-256 via holo-uor's pure-JS axis; runs in Node, browser, and the gateway Service Worker).

// Content addressing comes from ONE primitive (holo-uor.mjs) — Law L2, no per-file re-derivation.
// Re-exported for the many importers that read these off holo-object.
import { jcs, sha256hex, sriOf, mbSha256, didHolo } from "./holo-uor.mjs";
import { blake3hex } from "./holo-blake3.mjs";
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
  const { id, alsoKnownAs, ...content } = obj;   // alsoKnownAs is a derived alias, never part of identity
  // sha256hex accepts a string (UTF-8-encoded internally) — byte-identical to Buffer.from(...,"utf8"),
  // but Buffer-free so address()/verify() run in the browser + Service Worker too (the L4 serverless path).
  return `did:holo:sha256:${sha256hex(jcs(content))}`;
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

// ── Dual-axis convergence: the SAME canonical content addressed on BOTH the open-web sha256
// σ-axis (the did:holo id) AND the hologram substrate's blake3 σ-axis. blake3hex(canonical) is
// byte-identical to the substrate's address_bytes (proven: holo-blake3 + holo-realization-parity
// witnesses), so the object RESOLVES on the shared UOR substrate while keeping its did:holo:sha256
// as a W3C DID Core `alsoKnownAs` alias. Additive + reversible: sha256 stays the identity, blake3
// is gained, nothing is lost — the path the corpus rides onto upstream addressing without a rewrite.
const canonBytes = (obj) => { const { id, alsoKnownAs, ...content } = obj; return Buffer.from(jcs(content), "utf8"); };
export const blakeLabel = (obj) => `blake3:${blake3hex(canonBytes(obj))}`;             // the bare 71-byte substrate κ
export const blakeDid = (obj) => didHolo("blake3", blake3hex(canonBytes(obj)));        // its did:holo form
// sealDual: stamp the sha256 id AND the blake3 alias, both over identical canonical content.
export const sealDual = (obj) => {
  const base = { ...obj }; delete base.alsoKnownAs;                                     // recompute the alias fresh
  const id = address(base);
  const others = (obj.alsoKnownAs || []).filter((x) => !String(x).startsWith("did:holo:blake3:"));
  return { ...base, id, alsoKnownAs: [...others, blakeDid(base)] };
};
export const verifyDualAxis = (obj) => verify(obj) && (obj.alsoKnownAs || []).includes(blakeDid(obj));
// putDual: index the bytes under BOTH axes' hex → a fetch on EITHER κ finds them; L5 re-derives
// from the stripped canonical content on whichever axis was asked (mirrors the sha256 put()).
export function putDual(store, obj) {
  const sealed = sealDual(obj);
  const bytes = Buffer.from(jcs(sealed), "utf8");
  store.set(hexOf(sealed.id), bytes);                                                  // sha256 hex
  store.set(blake3hex(canonBytes(sealed)), bytes);                                     // blake3 hex (same content)
  return sealed;
}

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
  // Buffer-free (browser + Service Worker too, like address()/verify() above). Byte-identical output:
  // hex → raw 32 bytes → base64 (SRI) and 0x12 0x20 multihash prefix → base64url (multibase "u").
  const digest = new Uint8Array((hex.match(/.{2}/g) || []).map((b) => parseInt(b, 16)));
  const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
  const mh = new Uint8Array(digest.length + 2); mh[0] = 0x12; mh[1] = 0x20; mh.set(digest, 2);
  return { id: `did:holo:sha256:${hex}`, rel, "@type": type, leaf: true,
    digestSRI: "sha256-" + b64(digest),
    digestMultibase: "u" + b64(mh).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") };
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
