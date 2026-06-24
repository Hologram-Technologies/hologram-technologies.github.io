// holo-ens.mjs — WEB3 NAMES INTO THE κ SUBSTRATE (the P6 bridge). ENS maps a name to content through an
// on-chain registry; we do NOT reimplement the chain (holospaces discipline: reference + verify, never
// reauthor). We VERIFY the linkage and re-anchor it, so only the on-chain read is trusted and everything
// downstream is verify-before-trust:
//   1. namehash(name) re-derives the on-chain node (REAL keccak via holo-eth) — the name maps to the very
//      node the resolver answered for; a mismatch is refused (you can't claim a name resolves to a node it doesn't).
//   2. the EIP-1577 contenthash decodes to an IPFS CID (holo-ipfs.decodeContenthash).
//   3. the CID IS a κ (holo-cid: sha2-256 ≡ CIDv1) — a shorter spelling of the same content address.
//   4. the CONTENT re-derives to that κ (Law L5) — so a gateway cannot serve bytes that don't match.
// mirrorEns() turns the verified result into a zone binding (vitalik.eth → its content κ), so a web3 name
// resolves through the SAME one door + holo-root, and works OFFLINE from the mirror once cached. IPNS — a
// key-owned mutable pointer — maps onto a holo-zone directly (same shape); that wiring is a thin follow-on.
//
// Pure ESM, no DOM, no network of its own — the on-chain proof (node, contenthash, block) is handed in
// (vendored/byte-pinned in tests; the live read is holo-omni-web3.ensResolve). Law L1/L2/L3/L5.

import { namehash } from "../usr/lib/holo/holo-eth.js";
import { decodeContenthash } from "../usr/lib/holo/holo-ipfs.js";
import { cidToKappa } from "../usr/lib/holo/holo-cid.mjs";
import { seal } from "../usr/lib/holo/holo-object.mjs";
import { sha256hex } from "../usr/lib/holo/holo-uor.mjs";

const ENS_NS = "https://hologram.os/ns/ens#";
const hexOf = (k) => String(k).split(":").pop().toLowerCase();
const lc0x = (s) => String(s || "").toLowerCase();

// bridgeEns(name, proof, { content }) — verify the ENS linkage and seal a re-anchored mirror record.
//   proof : the on-chain read { node, contenthash, chainId?, block?, resolver? } (vendored in tests; live = ensResolve).
//   content : the actual bytes the CID names (optional) — when present, they MUST re-derive to the κ (L5).
export function bridgeEns(name, proof = {}, { content = null } = {}) {
  const nh = namehash(String(name));                              // REAL keccak ENS namehash
  if (proof.node && lc0x(nh) !== lc0x(proof.node)) return { ok: false, why: "namehash-mismatch", name, node: nh };
  const ch = proof.contenthash ? decodeContenthash(proof.contenthash) : null;
  if (!ch || !ch.cid) return { ok: false, why: "no-contenthash", name, node: nh };
  const kappa = cidToKappa(ch.cid);
  if (!kappa) return { ok: false, why: "cid-not-sha256", name, cid: ch.cid, note: "dag-pb (codec 0x70) is the general case — same digest principle, decode seam" };
  let contentVerified = false;
  if (content != null) {
    if (sha256hex(content) !== hexOf(kappa)) return { ok: false, why: "content-mismatch", name, kappa };
    contentVerified = true;
  }
  const target = ch.protocol + "://" + ch.cid;                    // ipfs://bafkrei…  (a follow-able object ref)
  const record = seal({
    "@context": [{ ens: ENS_NS, prov: "http://www.w3.org/ns/prov#", schema: "https://schema.org/" }],
    "@type": ["prov:Entity", "ens:Mirror"],
    "ens:name": String(name), "ens:node": nh, "ens:protocol": ch.protocol, "ens:cid": ch.cid,
    "schema:url": target, "ens:kappa": kappa,
    "prov:wasDerivedFrom": { chainId: proof.chainId ?? 1, block: proof.block ?? null, resolver: proof.resolver ?? null },
  });
  return { ok: true, name, node: nh, protocol: ch.protocol, cid: ch.cid, target, kappa, contentVerified, record };
}

// mirrorEns(zone, name, proof, { content }) — verify then BIND the web3 name into a zone (verify-before-trust),
// so it resolves through the one door + holo-root and offline thereafter. Binds name → content κ.
export async function mirrorEns(zone, name, proof = {}, { content = null } = {}) {
  const b = bridgeEns(name, proof, { content });
  if (!b.ok) return b;
  const r = await zone.bind(String(name), b.kappa);
  return r.ok ? { ...b, bound: true, name: String(name), via: zone.qualified(String(name)) } : { ok: false, why: "bind:" + r.why, name };
}

export default { bridgeEns, mirrorEns };
