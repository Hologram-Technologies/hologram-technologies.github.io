// holo-own.mjs — Holo Own (ADR-053): verifiable, self-sovereign OWNERSHIP on the content-
// addressable substrate. Separates TITLE (who controls a κ — solved natively, self-verifying)
// from SCARCITY (global ordering — anchored to an existing chain by reference, never minted).
//
// Genesis comes in two ADDITIVE kinds: a PROVENANCE Title (mint{ owned }) over a pre-existing κ,
// and an ISSUER-BOUND ASSET Title (mint{ asset }) whose κ commits to the creator's key — a different
// issuer ⇒ a different κ, so no one can mint a competing genesis to the *same* asset κ (originator
// authenticity, closed at creation). Neither delivers EXCLUSIVITY: two genesis for one κ, like two
// conflicting transfers, are forks resolved only by the SCARCITY anchor (detectForks ⊕ anchor-wins).
//
// A Title is a content-addressed, signed Realization: owner (a principal's σ-axis κ) ⊕ owned κ
// ⊕ prior Title (lineage); its identity is its κ (substrate-parity blake3, via holo-realization
// + holo-blake3); the head κ proves the whole PROV-O history. Transfer is a capability op signed
// by the current owner OR a delegate it authorized (a minimal UCAN-shaped attenuation — the seam
// where ADR-042 Delegate plugs in); a non-owner or an escalation is REFUSED (Law L5 / SEC-2).
// Scarcity is anchored by reference (the chain kit); forks are detected, "anchor wins". Value
// settles against a re-derivable Title (ADR-048). Pure + isomorphic (browser + Node witness);
// real WebCrypto signatures, no mock identity.

import { blake3hex } from "./holo-blake3.mjs";
import { makeAddress, substrateSeam } from "./holo-realization.mjs";
import { sha256Hex } from "./holo-identity.mjs";

const VOCAB = "https://hologram.os/ns/own#";
const TITLE_IRI = VOCAB + "Title";
const DELEG_IRI = VOCAB + "Delegation";
const ASSET_IRI = VOCAB + "Asset";
const te = new TextEncoder();
const SUB = globalThis.crypto?.subtle || (await import("node:crypto")).webcrypto.subtle;
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// substrate-parity κ for any realization: blake3 of its SPINE-2 canonical form, 71-byte refs
// (the blessed wiring — owner/owned/prior refs come out byte-identical to the hologram substrate).
const addr = makeAddress(substrateSeam(blake3hex));

// a principal's identity κ as a 71-byte σ-axis ref (`sha256:<hex>`) — the same address
// holo-identity mints as `did:holo:sha256:<hex>`, minus the W3C DID method prefix.
const keyRef = (p) => (typeof p === "string" ? p : p.kappa).replace(/^did:holo:/, "");
export const toDid = (ref) => "did:holo:" + ref;                       // the W3C projection
async function pubRef(pub_b64) { return "sha256:" + (await sha256Hex(unb64(pub_b64))); }

async function verifySig(pub_b64, alg, sig_b64, str) {
  const kp = alg === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" };
  const sp = alg === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" };
  try { const k = await SUB.importKey("raw", unb64(pub_b64), kp, false, ["verify"]); return SUB.verify(sp, k, unb64(sig_b64), te.encode(str)); }
  catch { return false; }
}

// seal: compute the Realization κ of an unsigned body, have `principal` sign that κ, attach both.
async function seal(body, principal) {
  const kappa = await addr.address(body);                              // κ commits to the whole body
  const sig = await principal.sign(kappa);                            // the authority signs the κ
  return { ...body, "@id": kappa, sig };
}

// ── Title ────────────────────────────────────────────────────────────────────
// mint: a genesis Title — the minter asserts initial ownership of `owned` (self-signed).
export async function mint({ asset, owned, rights = {}, issuedAt = "", nonce = "" }, owner) {
  // ISSUER-BINDING (optional): when `asset` is given, the asset's κ commits to its creator's key —
  // a different issuer ⇒ a different κ, so no one can mint a competing genesis to the same asset κ.
  // When `asset` is absent, this is a legacy provenance Title over the caller-supplied `owned` κ.
  let assetDescriptor;
  if (asset) {
    const issuerRef = await pubRef(owner.pub);
    assetDescriptor = { "@type": ASSET_IRI, ...asset, issuer: issuerRef };
    owned = await addr.address(assetDescriptor);                       // owned IS the bound asset κ
  }
  const body = { "@context": VOCAB, "@type": TITLE_IRI, owner: keyRef(owner), owned,
    issuer: { pub: owner.pub, alg: owner.alg }, rights, issuedAt, nonce,
    ...(assetDescriptor ? { assetDescriptor } : {}) };
  return seal(body, owner);                                            // genesis has no `prior`
}

// transfer: mint a new Title (prior = the current head) naming `to` as owner. Authorized iff
// `by` is the current owner OR carries a delegation proof the current owner signed (attenuated).
// admit: optional conscience seam (ADR-033) — return false to refuse. proof: an optional
// Delegation `by` acts under (UCAN-style, carried with the invocation so verification is closed).
export async function transfer({ title, to, rights = {}, issuedAt = "", nonce = "" }, by, { admit, proof } = {}) {
  const byRef = keyRef(by);
  const ok = byRef === title.owner || (proof && await delegationCovers(proof, { aud: byRef, owned: title.owned, to: keyRef(to), grantor: title.owner }));
  if (!ok) throw new Error("own: refused — " + byRef + " is neither the owner nor an authorized delegate (SEC-2)");
  if (admit && !(await admit({ title, to: keyRef(to) }))) throw new Error("own: refused — conscience gate (ADR-033)");
  const body = { "@context": VOCAB, "@type": TITLE_IRI, owner: keyRef(to), owned: title.owned, prior: title["@id"],
    issuer: { pub: by.pub, alg: by.alg }, rights, issuedAt, nonce };
  if (proof) body.proof = proof["@id"];                               // commit to the authority used
  return seal(body, by);
}

// verify a full ownership chain (genesis → head). Returns { ok, owner, errors }.
export async function verifyChain(titles, { delegations = {} } = {}) {
  const errors = [];
  for (let i = 0; i < titles.length; i++) {
    const t = titles[i];
    const { ["@id"]: id, sig, ...body } = t;
    if (!id || !sig) { errors.push(`#${i}: unsigned`); continue; }
    if ((await addr.address(body)) !== id) { errors.push(`#${i}: κ does not re-derive (L5)`); continue; }
    const issuerRef = await pubRef(t.issuer.pub);
    if (!(await verifySig(t.issuer.pub, t.issuer.alg, sig, id))) { errors.push(`#${i}: bad signature`); continue; }
    if (i === 0) {
      if (t.prior) errors.push(`#0: genesis must have no prior`);
      if (issuerRef !== t.owner) errors.push(`#0: genesis not self-signed by its owner`);
      // ISSUER-BINDING (optional, additive): a genesis that carries an asset descriptor MUST
      // re-derive to `owned` AND be issued by the genesis signer. Absent ⇒ legacy provenance Title.
      if (t.assetDescriptor) {
        if ((await addr.address(t.assetDescriptor)) !== t.owned) errors.push(`#0: owned does not re-derive from its asset descriptor`);
        if (t.assetDescriptor.issuer !== issuerRef) errors.push(`#0: asset not issued by the genesis owner (issuer-binding)`);
      }
    } else {
      const prev = titles[i - 1];
      if (t.prior !== prev["@id"]) { errors.push(`#${i}: prior does not link the chain`); continue; }
      // the signer must have been authorized AT prev: the owner, or a delegate prev.owner granted.
      let authorized = issuerRef === prev.owner;
      if (!authorized) {
        const proof = (delegations[t.proof]) || null;
        authorized = !!proof && await delegationCovers(proof, { aud: issuerRef, owned: t.owned, to: t.owner, grantor: prev.owner });
      }
      if (!authorized) errors.push(`#${i}: transfer not authorized by the current owner (SEC-2)`);
    }
  }
  const head = titles[titles.length - 1];
  return { ok: errors.length === 0, owner: head && head.owner, ownerDid: head && toDid(head.owner), errors };
}

export async function resolveOwner(titles) { const r = await verifyChain(titles); return r.ok ? r.owner : null; }

// ── delegation (minimal UCAN-shaped attenuation; ADR-042 is the full engine) ───
export async function grant({ to, owned, toOnly = null, nonce = "" }, owner) {
  const body = { "@context": VOCAB, "@type": DELEG_IRI, iss: keyRef(owner), aud: keyRef(to),
    can: "own/transfer", with: owned, constraints: { toOnly }, issuer: { pub: owner.pub, alg: owner.alg }, nonce };
  return seal(body, owner);
}
// covers(req): the delegation authorizes `aud` to transfer `owned` to `to`, was issued by
// `grantor` (the current owner), re-derives, and is correctly signed. Escalation ⇒ false.
async function delegationCovers(d, { aud, owned, to, grantor }) {
  const { ["@id"]: id, sig, ...body } = d || {};
  if (!id || !sig) return false;
  if ((await addr.address(body)) !== id) return false;                // L5
  if (!(await verifySig(d.issuer.pub, d.issuer.alg, sig, id))) return false;
  if ((await pubRef(d.issuer.pub)) !== d.iss) return false;           // signer is the issuer it claims
  if (d.iss !== grantor) return false;                                // must be granted BY the current owner
  if (d.can !== "own/transfer" || d.with !== owned) return false;     // capability + resource must match (no widening)
  if (d.aud !== aud) return false;                                    // delegated to THIS actor only
  if (d.constraints?.toOnly && !d.constraints.toOnly.includes(to)) return false; // recipient constraint
  return true;
}
export { delegationCovers };

// ── scarcity: anchor by reference (never mint a chain — Law L4) ────────────────
// A scarce Title's head κ is committed to an EXISTING chain; "anchor wins" resolves forks.
// The rail is consumed by reference (prism-btc · holo-eth · holo-solana · wdk); mocked offline.
export async function anchor(headKappa, chain = "bitcoin", rail = null) {
  if (rail) return rail.commit(headKappa, chain);                     // real chain via the wallet seam
  const txid = "mock:" + chain + ":" + (await blake3hex(te.encode("anchor|" + chain + "|" + headKappa)));
  return { "@type": VOCAB + "Anchor", chain, headKappa, txid };       // offline witness commitment
}
// detect forks: ≥2 valid Titles sharing one `prior` (or two genesis for one `owned`).
export function detectForks(titles) {
  const byPrior = new Map(); const forks = [];
  for (const t of titles) { const k = t.prior || ("genesis:" + t.owned); const arr = byPrior.get(k) || []; arr.push(t["@id"]); byPrior.set(k, arr); }
  for (const [k, ids] of byPrior) if (ids.length > 1) forks.push({ prior: k, heads: ids });
  return forks;
}
// resolve a fork by anchoring: the head with a chain commitment is canonical.
export function resolveForkByAnchor(heads, anchorsByHead) {
  const anchored = heads.filter((h) => anchorsByHead[h]);
  return anchored.length ? anchored[0] : null;                        // anchor wins; none anchored ⇒ unresolved
}

// ── settlement: value releases only against a re-derivable Title (composes ADR-048) ──
export async function settle({ order, chain }, payerSig) {
  const r = await verifyChain(chain.titles, { delegations: chain.delegations || {} });
  if (!r.ok) return null;                                             // unproven title pays nothing
  const head = chain.titles[chain.titles.length - 1];
  if (order.subject !== head["@id"]) return null;                     // order must commit to the proven head
  const voucher = { "@context": VOCAB, "@type": VOCAB + "Voucher", order: order["@id"] || (await addr.address({ "@context": VOCAB, "@type": VOCAB + "Order", ...order })), subject: head["@id"], amount: order.amount, payee: head.owner };
  voucher["@id"] = await addr.address(voucher);                       // voucher κ = the (idempotent) txId
  return voucher;
}

export const ns = { VOCAB, TITLE_IRI, DELEG_IRI, ASSET_IRI };
