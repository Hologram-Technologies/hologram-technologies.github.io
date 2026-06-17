// holo-uri.mjs — the URI⇄κ binding (S3 Linked Data): a κ-address is expressible as a W3C URI, and a URI
// in any object maps back to a concrete κ. This makes the content-addressed object graph a NAVIGABLE
// web of data: follow a URI → recover its κ → resolve + re-derive the object (Law L5, in holo-graph).
//
// DEPENDENCY-FREE of node:crypto (holo-ipfs.js is isomorphic; makeCIDv1/parseCID/cidToString are pure
// encoders), so this is safe in the browser service worker as well as Node.
//
// A sha-256 κ IS a CIDv1 sha2-256 (IPFS adopted, not bridged), so one κ has several equivalent URI forms:
//   did   — did:holo:sha256:<hex>     the canonical identity URI (a W3C DID; ALWAYS valid for any κ)
//   ipfs  — ipfs://<cidv1>            the decentralized-web URI
//   path  — /ipfs/<cidv1>             dereferenceable through the S1 verified gateway
//   route — /.holo/sha256/<hex>       the substrate content route
// NOTE: ipfs/path/route forms address RAW content bytes; they are directly dereferenceable for leaf/content
// κ. A UOR *object* did hashes its content-without-id, so an object is dereferenced by its DID via the
// resolver (holo-graph.deref), not by fetching a raw block. The string transform here is a clean bijection
// regardless — uriToKappa(kappaToUri(k, form)) === k for every form.

import { parseCID, cidToString, makeCIDv1, toHex, HASH, CODEC } from "../usr/lib/holo/holo-ipfs.js";

const HEX64 = /^[0-9a-f]{64}$/i;
export const hexOf = (k) => String(k).split(":").pop().toLowerCase();
const hexToBytes = (hex) => { const u = new Uint8Array(hex.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(hex.substr(i * 2, 2), 16); return u; };

// kappaToCid(κ) → the CIDv1 (base32, raw, sha2-256) string for a κ's hex digest (no hashing — we already
// hold the digest). The inverse of reading a CID's digest back out.
export function kappaToCid(kappa) {
  const hex = hexOf(kappa);
  if (!HEX64.test(hex)) throw new Error("not a sha256 κ: " + kappa);
  return cidToString(makeCIDv1(CODEC.RAW, HASH.SHA2_256, hexToBytes(hex)));
}

export const URI_FORMS = Object.freeze(["did", "ipfs", "path", "route"]);

// kappaToUri(κ, form="did") → one URI form for a κ. Throws on an unknown form / non-sha256 κ.
export function kappaToUri(kappa, form = "did") {
  const hex = hexOf(kappa);
  if (!HEX64.test(hex)) throw new Error("not a sha256 κ: " + kappa);
  switch (form) {
    case "did": return `did:holo:sha256:${hex}`;
    case "ipfs": return `ipfs://${kappaToCid(kappa)}`;
    case "path": return `/ipfs/${kappaToCid(kappa)}`;
    case "route": return `/.holo/sha256/${hex}`;
    default: throw new Error("unknown URI form: " + form);
  }
}
// kappaForms(κ) → { did, ipfs, path, route } — every equivalent URI for a κ.
export const kappaForms = (kappa) => Object.fromEntries(URI_FORMS.map((f) => [f, kappaToUri(kappa, f)]));

// uriToKappa(uri) → the canonical κ (did:holo:sha256:<hex>) for any supported URI form, or null. A CID must
// be sha2-256 (the open-web κ axis) to bind — any other multihash is not a κ and returns null.
export function uriToKappa(uri) {
  const s = String(uri || "").trim();
  let m;
  if ((m = s.match(/^did:holo:sha256:([0-9a-f]{64})$/i)) || (m = s.match(/^sha256:([0-9a-f]{64})$/i))) return `did:holo:sha256:${m[1].toLowerCase()}`;
  if ((m = s.match(/^\/?\.holo\/sha256\/([0-9a-f]{64})$/i))) return `did:holo:sha256:${m[1].toLowerCase()}`;
  let cidStr = null;
  if ((m = s.match(/^ipfs:\/\/([^/?#]+)/i))) cidStr = m[1];
  else if ((m = s.match(/^\/ipfs\/([^/?#]+)/i))) cidStr = m[1];
  else if (/^(b[a-z2-7]+|Qm[1-9A-HJ-NP-Za-km-z]+|z[1-9A-HJ-NP-Za-km-z]+)$/.test(s)) cidStr = s;
  if (cidStr) {
    try { const c = parseCID(cidStr); if (c.hashCode === HASH.SHA2_256) return `did:holo:sha256:${toHex(c.digest)}`; } catch { /* not a CID */ }
  }
  return null;
}

// isKappaUri(uri) → does this URI bind to a κ (any supported form)?
export const isKappaUri = (uri) => uriToKappa(uri) != null;
