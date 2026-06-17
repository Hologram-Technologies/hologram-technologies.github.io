// holo-did.mjs — the did:holo DID method (S6 / Agentic-Web identity). A UOR object's identity is already a
// W3C DID (did:holo:<axis>:<hex>, content-derived); this resolves it to a W3C DID Document and validates the
// method syntax. DEPENDENCY-FREE (pure JSON + string ops) → SW-safe. Authority: W3C DID Core (did-core).
//
// did:holo method: the DID is the κ — a self-certifying identifier whose authority is re-derivation (Law L5),
// not a registry. A DID Document MAY bind verification material (an ed25519 Multikey) for authentication and
// assertion (e.g. signing Verifiable Credentials — holo-vc.mjs).

const DID_RE = /^did:holo:(sha256|blake3):([0-9a-f]{64})$/i;

// parseDid(did) → { method:"holo", axis, hex } | null.
export function parseDid(did) {
  const m = DID_RE.exec(String(did || ""));
  return m ? { method: "holo", axis: m[1].toLowerCase(), hex: m[2].toLowerCase() } : null;
}
export const isDid = (did) => DID_RE.test(String(did || ""));

// didDocument(did, {publicKeyMultibase}) → a W3C DID Document (DID Core). If a key is supplied it is bound as
// an Ed25519 Multikey usable for authentication + assertionMethod; otherwise the document is the minimal
// self-certifying record (the controller IS the subject — no external authority).
export function didDocument(did, { publicKeyMultibase } = {}) {
  const parsed = parseDid(did);
  if (!parsed) throw new Error("not a did:holo DID: " + did);
  const doc = {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
    id: did,
    controller: did,                                  // self-controlled: authority is the κ, not a registry
  };
  if (publicKeyMultibase) {
    const vmId = `${did}#key-1`;
    doc.verificationMethod = [{ id: vmId, type: "Multikey", controller: did, publicKeyMultibase }];
    doc.authentication = [vmId];
    doc.assertionMethod = [vmId];
  }
  return doc;
}

// validateDidDocument(doc) → { ok, why? } — structural conformance to DID Core: a valid did:holo `id`, a
// `controller`, and every verificationMethod referenced by authentication/assertionMethod actually present.
export function validateDidDocument(doc) {
  if (!doc || !isDid(doc.id)) return { ok: false, why: "missing/invalid did:holo id" };
  if (!doc["@context"] || !(Array.isArray(doc["@context"]) ? doc["@context"] : [doc["@context"]]).includes("https://www.w3.org/ns/did/v1")) return { ok: false, why: "missing DID Core @context" };
  if (!doc.controller) return { ok: false, why: "missing controller" };
  const vmIds = new Set((doc.verificationMethod || []).map((v) => v.id));
  for (const rel of ["authentication", "assertionMethod"]) {
    for (const ref of doc[rel] || []) {
      const id = typeof ref === "string" ? ref : ref && ref.id;
      if (!vmIds.has(id)) return { ok: false, why: `${rel} references unknown verificationMethod ${id}` };
    }
  }
  return { ok: true };
}
