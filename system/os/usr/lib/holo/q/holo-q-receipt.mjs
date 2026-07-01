// holo-q-receipt.mjs — the InferenceReceipt minter (ADR-0090). Every remote-model inference is
// admitted to the substrate ONLY as a content-addressed PROV-O receipt: a witnessed record of
// { request κ, response κ, engine κ, usage, cost, timing, conscience verdict } sealed to a did:holo.
//
// This is the boundary object that reconciles a non-local LLM call with the Laws. The remote call
// itself is untrusted I/O at the ingest boundary; what crosses INTO the store is this receipt and the
// response κ — both re-derivable (Law L5), held as κ-labels not live objects (Law L2). The receipt is
// MANDATORY: P2 (Provenance, ADR-0033) makes "no receipt" an audit-trail violation, so a remote answer
// with no receipt is never admitted. Identical response bytes → identical response κ (dedup, Law L3).
//
// Isomorphic + dependency-free: it mints with the SAME canonicalization as _shared/holo-conscience.js
// (RFC 8785 JCS + BLAKE3 — the ONE canonical content hash, §1.2), so a receipt κ re-derives
// byte-identically in the browser host and in the Node witness. Pure — no fetch, no keys, no DOM.

import { blake3hex } from "../holo-blake3.mjs";

// ── canonical form (byte-identical to holo-conscience.js / holo-object.mjs) ────────────────────────
const UOR_CONTEXT = [
  "https://www.w3.org/ns/did/v1",
  "https://w3id.org/security/data-integrity/v2",
  { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", dcterms: "http://purl.org/dc/terms/",
    rel: "schema:additionalType", links: { "@id": "schema:hasPart", "@container": "@set" } },
];
const HOLOQ = { holoq: "https://hologram.os/ns/q#" };

// RFC 8785 JCS — identical to holo-conscience.js (sorted keys, arrays in order).
export const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
  : JSON.stringify(v);
// legacy dual-read: the pre-§1.2 SHA-256 reader, kept ONLY so verifyReceipt can still open EXISTING
// sha256-addressed receipts. Never used to MINT — new κ are BLAKE3 (§1.2).
export async function sha256hex(u8) {
  const d = await crypto.subtle.digest("SHA-256", u8);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
const enc = (s) => new TextEncoder().encode(s);
// address(doc): self-verifying identity = did:holo:blake3:H(canonical content), §1.2. The `id` field (if
// any) is excluded from the content it names — mirror of holo-object.mjs's address/seal.
export async function address(doc) {
  const { id, ...content } = doc || {};
  return "did:holo:blake3:" + blake3hex(enc(jcs(content)));
}
// legacy dual-read: re-derive the OLD sha256 address for a doc, so an existing sha256-minted receipt
// still verifies. Used ONLY in verifyReceipt's accept-either match — never to mint.
async function sha256Address(doc) {
  const { id, ...content } = doc || {};
  return "did:holo:sha256:" + await sha256hex(enc(jcs(content))); // legacy dual-read
}

// ── content addresses for the two operands the receipt names ───────────────────────────────────────
// responseKappa(text|bytes): the raw response is addressed as a bare leaf κ, so identical generations
// converge to one κ in the store (Law L3). This is the byte→κ admission Law L5 requires.
export async function responseKappa(textOrBytes) {
  const u8 = typeof textOrBytes === "string" ? enc(textOrBytes) : textOrBytes;
  return "did:holo:blake3:" + blake3hex(u8);
}
// requestKappa({ model, messages, params }): the request is content-addressed too — a deterministic κ
// over exactly what was sent, so the receipt names an immutable request, not a mutable object.
export async function requestKappa({ model, messages, params = {} }) {
  return await address({ "@type": "holoq:Request", "holoq:modelId": model, "holoq:messages": messages, "holoq:params": params });
}
// providerKappa({ wireFormat, modelId }): the ENGINE identity is the κ of its DESCRIPTOR — content, not
// a URL (Law L1). The endpoint URL + key never appear here; they live only in the host vault.
export async function providerKappa({ wireFormat, modelId }) {
  return await address({ "@type": "holoq:Provider", "holoq:wireFormat": wireFormat, "holoq:modelId": modelId });
}

// ── the receipt ────────────────────────────────────────────────────────────────────────────────────
// mintReceipt(args) → { id, body } sealed to a did:holo (the q-witness receipt shape). All operands are
// κ-labels; `conscience` is the egress verdict (accept|caveat); `cost`/`usage` are honest accounting.
export async function mintReceipt({
  requestK, responseK, providerK, wireFormat, modelId,
  usage = {}, cost = null, meta = {}, startedAt, endedAt, conscience = {}, app = null, tier = "remote",
} = {}) {
  // an aggregator (OpenRouter, ADR-0102) routes a requested slug to a real upstream — `meta` names what
  // ACTUALLY ran + native cost. requestK still names what was ASKED; the served fields name what ran. BOTH
  // sit inside the canonicalized body, so tampering EITHER (incl. the served provider) breaks the address (L5).
  const m = meta || {};
  const effectiveCost = cost || m.cost || null;
  const body = {
    "@context": [...UOR_CONTEXT, HOLOQ],
    "@type": ["prov:Activity", "holoq:InferenceReceipt"],
    "prov:used": [
      { "@id": requestK, "holoq:role": "request" },
      { "@id": providerK, "holoq:role": "engine" },
    ],
    "prov:generated": { "@id": responseK },
    "holoq:tier": tier,
    "holoq:provider": { "@id": providerK, "holoq:wireFormat": wireFormat, "holoq:modelId": modelId },
    ...(m.servedModel ? { "holoq:servedModel": m.servedModel } : {}),
    ...(m.servedProvider ? { "holoq:servedProvider": m.servedProvider } : {}),
    "holoq:usage": { "holoq:promptTokens": usage.promptTokens || 0, "holoq:completionTokens": usage.completionTokens || 0 },
    ...(effectiveCost ? { "holoq:cost": { "holoq:currency": effectiveCost.currency || "USD", "holoq:amount": effectiveCost.amount } } : {}),
    "prov:startedAtTime": startedAt,
    "prov:endedAtTime": endedAt,
    "holoq:conscience": { "holoq:outcome": conscience.outcome || "accept", "holoq:caveats": conscience.caveats || [], "holoq:sealed": conscience.sealed !== false },
    ...(app ? { "prov:wasAssociatedWith": app } : {}),
  };
  return { id: await address(body), body };
}

// verifyReceipt(rec): Law L5 — re-derive the body's address and compare to the claimed id. A single
// altered byte (tier, model, usage, conscience verdict, …) changes the address and is refused.
export async function verifyReceipt(rec) {
  if (!rec || !rec.body || !rec.id) return { ok: false, why: "malformed receipt" };
  const got = await address(rec.body);
  // legacy dual-read: new receipts are BLAKE3 (§1.2), but an EXISTING receipt sealed under sha256 must
  // still verify. Re-derive the old axis only when the id isn't the blake3 address, and accept either.
  if (got === rec.id) return { ok: true, claimed: rec.id, derived: got };
  const legacy = await sha256Address(rec.body);
  return { ok: legacy === rec.id, claimed: rec.id, derived: got };
}

export default { mintReceipt, verifyReceipt, responseKappa, requestKappa, providerKappa, address, jcs, sha256hex };
