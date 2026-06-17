// holo-graph.mjs — Linked-Data traversal (S3): walk the content-addressed object graph ACROSS SOURCES,
// re-deriving every hop (Law L5). This generalizes holo-object.verifyDeep (which verifies a DAG already
// resident in one store) to follow links through an INJECTED resolver — local cache, peer, gateway, or any
// source — so the κ-object graph becomes one navigable, verifiable web of data. A link target that does not
// re-derive is REFUSED mid-traversal; the refusal carries the offending κ. Trust is in the math, not the
// source (the same discipline as holo-resolver).
//
// UOR object verification re-hashes the canonical content-without-id (verify()), synchronous via the ONE
// isomorphic substrate (holo-uor's pure-JS SHA-256 — Node + browser + SW, byte-identical to node:crypto);
// the URI⇄κ binding it builds on (holo-uri.mjs) is already isomorphic/SW-safe.

import { verify, sriOf } from "../usr/lib/holo/holo-object.mjs";   // the one isomorphic substrate (Node + browser + SW)
import { sha256hex } from "../usr/lib/holo/holo-uor.mjs";
import { uriToKappa, hexOf } from "./holo-uri.mjs";

const toU8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
const tryObj = (u) => { try { const o = JSON.parse(new TextDecoder("utf-8", { fatal: false }).decode(u)); return (o && o["@context"] && typeof o.id === "string" && o.id.startsWith("did:holo:")) ? o : null; } catch { return null; } };

// verifyHop(kappa, bytes, link?) → { ok, kind:"object"|"leaf", obj?, bytes? } | { ok:false, at, why }.
// The SAME two L5 cases as verifyDeep: a UOR object re-derives via verify() (content-without-id); a raw leaf
// re-derives via sha256hex(bytes). When a link is given, its SRI digest must also match the exact bytes
// (edge integrity) and a `leaf` link must be raw / a non-leaf link must be an object whose id equals the κ.
export function verifyHop(kappa, bytes, link = null) {
  const u = toU8(bytes);
  const hex = hexOf(kappa);
  if (link && link.digestSRI && sriOf(u) !== link.digestSRI) return { ok: false, at: kappa, why: "link digest mismatch (SRI)" };
  const wantLeaf = link ? !!link.leaf : null;
  if (wantLeaf === true) {
    if (sha256hex(u) !== hex) return { ok: false, at: kappa, why: "leaf hash mismatch (Law L5)" };
    return { ok: true, kind: "leaf", bytes: u };
  }
  const obj = tryObj(u);
  if (obj) {
    if (obj.id !== kappa) return { ok: false, at: kappa, why: "object id != requested κ" };
    if (!verify(obj)) return { ok: false, at: kappa, why: "object does not re-derive (Law L5)" };
    return { ok: true, kind: "object", obj };
  }
  if (wantLeaf === false) return { ok: false, at: kappa, why: "expected UOR object, got non-object bytes" };
  // root with no link hint and not an object → treat as a raw leaf
  if (sha256hex(u) !== hex) return { ok: false, at: kappa, why: "leaf hash mismatch (Law L5)" };
  return { ok: true, kind: "leaf", bytes: u };
}

// deref(uriOrKappa, {resolve}) → resolve a single URI/κ to its verified object or leaf (Law L5). `resolve`
// is an injected async (κ) → bytes|null (the caller wires holo-resolver sources / a cache).
export async function deref(uriOrKappa, { resolve } = {}) {
  const s = String(uriOrKappa);
  const kappa = uriToKappa(s) || (s.startsWith("did:holo:") ? s : null);
  if (!kappa) return { ok: false, why: "not a κ-bound URI: " + s };
  let bytes; try { bytes = await resolve(kappa); } catch (e) { return { ok: false, at: kappa, why: "resolve threw: " + ((e && e.message) || e) }; }
  if (!bytes) return { ok: false, at: kappa, why: "unresolved — no source served a κ-verified copy" };
  return verifyHop(kappa, bytes, null);
}

// traverse(root, {resolve, maxHops}) → walk the whole reachable object graph, every hop re-derived (L5).
// Returns { ok, hops, visited:Set<hex>, nodes:[...] } or { ok:false, at, why, hops, visited } on a refused
// hop. Acyclic by construction (a Merkle child's κ is part of its parent's κ), but hops are bounded anyway.
export async function traverse(root, { resolve, maxHops = 256 } = {}) {
  const r0 = await deref(root, { resolve });
  if (!r0.ok) return { ok: false, at: r0.at, why: r0.why, hops: 0, visited: new Set() };
  if (r0.kind === "leaf") return { ok: true, hops: 0, visited: new Set([hexOf(uriToKappa(String(root)) || root)]), nodes: [r0] };
  const visited = new Set([hexOf(r0.obj.id)]);
  const nodes = [r0];
  const queue = [r0.obj];
  let hops = 0;
  while (queue.length) {
    const node = queue.shift();
    for (const link of node.links || []) {
      if (++hops > maxHops) return { ok: false, why: "hop budget exceeded", hops, visited };
      let bytes; try { bytes = await resolve(link.id); } catch { bytes = null; }
      if (!bytes) return { ok: false, at: link.id, why: "unresolved link", hops, visited };
      const v = verifyHop(link.id, bytes, link);
      if (!v.ok) return { ok: false, at: v.at, why: v.why, hops, visited };   // tamper REFUSED mid-traversal
      const h = hexOf(link.id);
      if (visited.has(h)) continue;
      visited.add(h);
      nodes.push(v);
      if (v.kind === "object") queue.push(v.obj);
    }
  }
  return { ok: true, hops, visited, nodes };
}
