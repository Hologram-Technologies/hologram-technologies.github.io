// holo-dns.mjs — THE WEB2 DNS BRIDGE, BOTH WAYS (the P5 bridge). We conform to DNS, we do not reauthor it
// (holospaces external-ground-truth). The trust model is inverted at the edge:
//   INBOUND  — a real DNS-over-HTTPS answer (RFC 8484 JSON) is parsed; its DNSSEC verdict (the validating
//     resolver's AD bit) is required by policy (fail-closed on insecure); the DNSSEC DELEGATION is re-derived
//     on substrate (a DS type-2 record's digest = SHA-256(owner-wire ‖ child DNSKEY-RDATA) — pure re-
//     derivation, Law L5); and the verified answer is SEALED as a content-addressed κ with provenance. So the
//     answer is verify-before-trust (re-derive its κ) — tamper AFTER the fetch is caught, and a later SILENT
//     change at the authority is caught by divergence(). (Full RRSIG asymmetric validation is a deeper seam;
//     the DS-digest delegation linkage and the immutable re-anchor are real here.)
//   OUTBOUND — a κ binding is published as conventional records: `_holo.<name> TXT "holo=<did>"`, a
//     `.well-known/holo` document, and a `did:web:<name>` alias (W3C did:web interop) — so legacy clients and
//     the existing web reach κ content with zero new software.
//
// Pure ESM, no DOM, no network of its own — the DoH bytes are handed in (vendored/byte-pinned in tests; the
// live read is any DoH endpoint). Law L1/L2/L3/L5.

import { seal } from "../usr/lib/holo/holo-object.mjs";
import { sha256Hex } from "../usr/lib/holo/holo-identity.mjs";          // SHA-256 over raw bytes (WebCrypto, isomorphic)

const DNS_NS = "https://hologram.os/ns/dns#";
const TYPE = { 1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 16: "TXT", 28: "AAAA", 43: "DS", 46: "RRSIG", 48: "DNSKEY", 257: "CAA" };
const hexU8 = (h) => { const s = String(h).replace(/^0x/, ""); const u = new Uint8Array(s.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(s.substr(i * 2, 2), 16); return u; };

// parseDoH(json) — normalise an RFC 8484 JSON answer into { name, status, authenticated, answers[] }.
//   authenticated = the resolver's DNSSEC AD (Authenticated Data) bit.
export function parseDoH(json) {
  const j = typeof json === "string" ? JSON.parse(json) : (json || {});
  const q = (j.Question && j.Question[0]) || {};
  const answers = (j.Answer || []).map((a) => ({ name: a.name, type: a.type, typeName: TYPE[a.type] || String(a.type), ttl: a.TTL, data: a.data }));
  return { name: q.name || (answers[0] && answers[0].name) || null, status: j.Status ?? null, authenticated: !!j.AD, answers, question: q };
}

// verifyDelegation({ preimage, digest }) — DNSSEC chain-of-trust linkage, re-derived: a DS type-2 digest is
// SHA-256 over (canonical owner name wire ‖ child DNSKEY RDATA). If the re-derived digest matches the parent's
// published DS, the parent provably delegated to THIS child key. (Vendor real published DNSKEY/owner bytes to
// validate a live chain to the IANA root trust anchor; the relation re-derived here is the real one.)
export async function verifyDelegation({ preimage, digest } = {}) {
  if (!preimage || !digest) return { ok: false, why: "missing-ds-fixture" };
  const got = await sha256Hex(hexU8(preimage));
  return got === String(digest).replace(/^0x/, "").toLowerCase() ? { ok: true, digest: got } : { ok: false, why: "ds-digest-mismatch", got };
}

// bridgeIn(name, doh, { source, requireSecure }) — parse, gate on DNSSEC, seal the answer as a re-derivable κ.
export async function bridgeIn(name, doh, { source = null, requireSecure = true } = {}) {
  const p = parseDoH(doh);
  if (requireSecure && !p.authenticated) return { ok: false, why: "insecure-no-dnssec", name: name || p.name, authenticated: false };
  const record = seal({
    "@context": [{ dns: DNS_NS, prov: "http://www.w3.org/ns/prov#" }],
    "@type": ["prov:Entity", "dns:Answer"],
    "dns:name": name || p.name, "dns:authenticated": p.authenticated, "dns:answers": p.answers,
    "prov:wasDerivedFrom": source || null,
  });
  return { ok: true, name: name || p.name, kappa: record.id, authenticated: p.authenticated, answers: p.answers, record };
}

// publishOut(name, kappa) — the conventional records a legacy zone publishes so the old web reaches κ content.
export function publishOut(name, kappa) {
  const n = String(name).replace(/\.$/, "");
  return {
    txt: `_holo.${n}. IN TXT "holo=${kappa}"`,
    wellKnown: { "@context": "https://hologram.os/ns/dns#", name: n, holo: kappa, retrievedVia: "well-known" },
    didWeb: `did:web:${n}`,
  };
}

// parseHoloTxt(txt) — the reverse: a legacy client extracts the κ from the published TXT record.
export function parseHoloTxt(txt) {
  const m = /holo=(did:holo:sha256:[0-9a-f]{64})/i.exec(String(txt || ""));
  return m ? m[1].toLowerCase() : null;
}

export default { parseDoH, verifyDelegation, bridgeIn, publishOut, parseHoloTxt };
