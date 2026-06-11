// holo-realization.mjs — THE kernel. Everything in Hologram OS is a Realization:
// a (type-IRI, ordered operand κ-refs, payload) triple. Identity is the κ of its
// canonical form (Law L1). JSON-LD is the editable projection (CC-63), never the
// identity-bearing form — you edit the JSON-LD, re-canonicalize, get a new κ.
//
// Converges OS2 onto upstream holospaces addressing: the canonical form is the
// upstream SPINE-2 SHELL — `IRI\0 | u32LE refcount | refs… | u32LE len | payload`.
// Two pieces are substrate-internal and consumed by reference (ADR-006), so they
// are SEAMS, not reimplemented here:
//   • hash        — BLAKE3 over the canonical bytes (the substrate's default axis)
//   • kappaCodec  — the exact KappaLabel71 byte layout of a κ-ref
// Pass the substrate's pair to get byte-identical κ. The defaults below are
// STRUCTURAL (sound + reversible, not substrate-parity): κ-parity is an expected-RED
// conformance target until the seam points at the real substrate.
//
// Dual-env ESM (browser World shell + Node witness). No node-only imports.

const KAPPA_RE = /^(?:did:holo:)?[a-z0-9-]+:[0-9a-f]{32,}$/i;  // axis:digest (≥32 hex) — tight enough not to catch literal "word:hexish" values
const te = new TextEncoder();
const td = new TextDecoder();

// RFC 8785 JSON Canonicalization Scheme — the deterministic form of the payload object.
export const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
  : JSON.stringify(v);

const isKappa = (v) => typeof v === "string" && KAPPA_RE.test(v);
const u32le = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const rdU32le = (b, o) => new DataView(b.buffer, b.byteOffset).getUint32(o, true);
const concat = (parts) => { let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// ── Canonical form (SPINE-2 shell) ───────────────────────────────────────────
// SEAM kappaCodec: default = length-prefixed UTF-8 κ string (reversible, NOT 71B).
//   Swap in the substrate's fixed-width KappaLabel71 codec for byte-parity.
const defaultKappaCodec = {
  enc: (k) => { const s = te.encode(k); return concat([u32le(s.length), s]); },
  dec: (b, o) => { const n = rdU32le(b, o); return { kappa: td.decode(b.subarray(o + 4, o + 4 + n)), next: o + 4 + n }; },
};

// SUBSTRATE PARITY: a κ-ref is the full 71-byte ASCII κ-label (`blake3:`+64 hex), fixed-width,
// NO length prefix — exactly the substrate's KappaLabel71 operand encoding. Use with
// { hash: blake3 (holo-blake3.mjs), axis: "blake3", codec: kappaCodec71 } and the κ a realization
// mints is byte-identical to the hologram substrate's (proven: holo-blake3-witness).
export const kappaCodec71 = {
  enc: (k) => { const s = te.encode(k); if (s.length !== 71) throw new Error("kappaCodec71: κ-ref must be 71 bytes (blake3 axis): " + k); return s; },
  dec: (b, o) => ({ kappa: td.decode(b.subarray(o, o + 71)), next: o + 71 }),
};

export function encode(iri, refs, payload, codec = defaultKappaCodec) {
  const iriB = te.encode(iri);
  return concat([iriB, new Uint8Array([0]), u32le(refs.length), ...refs.map(codec.enc), u32le(payload.length), payload]);
}

export function decode(bytes, codec = defaultKappaCodec) {
  let o = bytes.indexOf(0);              // IRI ends at the NUL
  const iri = td.decode(bytes.subarray(0, o)); o += 1;
  const refc = rdU32le(bytes, o); o += 4;
  const refs = [];
  for (let i = 0; i < refc; i++) { const r = codec.dec(bytes, o); refs.push(r.kappa); o = r.next; }
  const len = rdU32le(bytes, o); o += 4;
  return { iri, refs, payload: bytes.subarray(o, o + len) };
}

// ── JSON-LD ⇄ canonical-form bijection (CC-63 projection) ────────────────────
// @id-valued (κ) properties become ordered operand refs; literals become payload.
// refKeys is carried in the payload so the projection round-trips exactly.
export function toCanonical(obj) {
  const { "@id": _id, "@context": _ctx, "@type": iri, ...props } = obj;
  if (!iri) throw new Error("realization needs @type (the IRI)");
  const refKeys = Object.keys(props).filter((k) => isKappa(props[k])).sort();
  const data = {}; for (const k of Object.keys(props).sort()) if (!isKappa(props[k])) data[k] = props[k];
  const refs = refKeys.map((k) => props[k]);
  const payload = te.encode(jcs({ refKeys, data }));
  return { iri, refs, payload };
}

export function toJsonld({ iri, refs, payload }, kappa) {
  const { refKeys, data } = JSON.parse(td.decode(payload));
  const out = { "@context": "https://uor.foundation/holospaces/vocab#", "@type": iri };
  if (kappa) out["@id"] = kappa;
  refKeys.forEach((k, i) => { out[k] = refs[i]; });
  return Object.assign(out, data);
}

// ── Addressing seam ──────────────────────────────────────────────────────────
// makeAddress({ hash, codec }) — hash: (Uint8Array)=>Promise<hexString> on the κ axis.
//   axis "blake3" is the substrate default; supply the substrate's BLAKE3 for parity.
export function makeAddress({ hash, axis = "blake3", codec = defaultKappaCodec }) {
  const canon = (obj) => { const { iri, refs, payload } = toCanonical(obj); return encode(iri, refs, payload, codec); };
  const address = async (obj) => `${axis}:${await hash(canon(obj))}`;
  const verify = async (obj) => { const id = obj["@id"]; return !!id && id === await address(obj); };
  return { canon, address, verify };
}

// substrateSeam(hash) — the ONE blessed parity wiring. Pass holo-blake3's `blake3hex` and every
// κ this kernel mints is byte-identical to the hologram substrate's (blake3 axis + KappaLabel71
// operand codec; proven: holo-realization-parity-witness). Spread it into makeAddress / memStore /
// makeKernel so a caller never re-states the axis/codec pair (and can't drift off-parity):
//   const seam = substrateSeam(blake3hex);
//   const address = makeAddress(seam);
//   const k = makeKernel({ store: memStore(seam), address, codec: seam.codec });
export const substrateSeam = (hash) => ({ hash, axis: "blake3", codec: kappaCodec71 });

// ── The kernel: read/write over a κ store ────────────────────────────────────
// store: { get(κ)->Uint8Array|null, put(bytes)->κ (re-derives), has(κ)->bool }
// policy: { admits(iri, caps)->bool } enforces SEC-2 (authority attenuates only).
const allowAll = { admits: () => true };

export function makeKernel({ store, address, codec = defaultKappaCodec, policy = allowAll }) {
  // WRITE — canonicalize → store (store re-derives κ, Law L5) → stamp @id.
  async function write(obj, caps) {
    if (!policy.admits(obj["@type"], caps)) throw new Error("refused: capability does not admit " + obj["@type"]);
    const bytes = address.canon(obj);
    const kappa = await store.put(bytes);          // re-derives on write; throws on mismatch
    return kappa;
  }
  // RESOLVE — store.get → verify by re-derivation (L5) → project to JSON-LD.
  async function resolve(kappa) {
    const bytes = await store.get(kappa);            // await — stores may be async (IndexedDB)
    if (!bytes) throw new Error("κ not resolvable: " + kappa);
    if (!(await store.verify(kappa, bytes))) throw new Error("refused: κ does not re-derive (tampered)");
    return toJsonld(decode(bytes, codec), kappa);
  }
  // FORK — edit the JSON-LD, mint a new κ; lineage is a separate provenance edge
  // (identity stays content-pure, mirroring upstream Manifest.parent).
  async function fork(kappa, edit, caps) {
    const obj = await resolve(kappa); delete obj["@id"];
    const next = await edit(obj) || obj;
    const k2 = await write(next, caps);
    return { kappa: k2, provenance: { "@type": "https://www.w3.org/ns/prov#wasRevisionOf", subject: k2, parent: kappa } };
  }
  // SPLIT — lift a literal property into its own child object; replace it with a ref.
  async function split(kappa, prop, caps, childType = "https://uor.foundation/holospaces/realization/fragment") {
    const obj = await resolve(kappa); delete obj["@id"];
    if (!(prop in obj) || isKappa(obj[prop])) throw new Error("split: " + prop + " is not an inlinable literal");
    const childKappa = await write({ "@context": obj["@context"], "@type": childType, value: obj[prop] }, caps);
    obj[prop] = childKappa;                        // the literal is now an edge
    const parentKappa = await write(obj, caps);
    return { kappa: parentKappa, child: childKappa, provenance: { subject: parentKappa, parent: kappa } };
  }
  // FUSE — inline a referenced child's value back into the parent payload.
  async function fuse(kappa, prop, caps) {
    const obj = await resolve(kappa); delete obj["@id"];
    if (!isKappa(obj[prop])) throw new Error("fuse: " + prop + " is not a ref");
    const child = await resolve(obj[prop]);
    if (!("value" in child)) throw new Error("fuse: child is not a fragment (no inlinable value)");
    obj[prop] = child.value;                       // the edge is now a literal
    const parentKappa = await write(obj, caps);
    return { kappa: parentKappa, provenance: { subject: parentKappa, parent: kappa } };
  }
  return { write, resolve, fork, split, fuse };
}

// ── Reference in-memory store (Node witness / tests). Browser uses an IndexedDB
//    adapter with the SAME shape. Both re-derive on put + verify on get (Law L5).
export function memStore({ hash, axis = "blake3", codec = defaultKappaCodec }) {
  const m = new Map();
  const kappaOf = async (bytes) => `${axis}:${await hash(bytes)}`;
  return {
    async put(bytes) { const k = await kappaOf(bytes); m.set(k, bytes); return k; },
    get(k) { return m.get(k) || null; },
    has(k) { return m.has(k); },
    async verify(k, bytes) { return k === await kappaOf(bytes); },
  };
}
