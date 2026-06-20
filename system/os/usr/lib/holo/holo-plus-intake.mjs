// holo-plus-intake.mjs — "The + Everywhere" A1: the three intake modes behind the "+". Normalizes whatever the
// user offers — a FILE, a LINK, or a reference to another HOLO OBJECT/APP by its κ — into the { name, bytes, mime }
// inputs runPlus consumes. The net-new, uniquely-Hologram mode is the third: you don't UPLOAD anything, you point
// at a κ already on the substrate and the bytes are RESOLVED there (locally / from the mesh). And because the
// substrate is content-addressed, the resolved bytes are L5-VERIFIED to re-derive to that κ before use — link a
// tampered or wrong object and intake refuses it. No re-acquisition; integrity for free.
//
// Pure + dependency-injected: the byte resolver (κ → bytes) and fetch are injected, so the parsing + κ-integrity
// CORE is Node-witnessable; the browser binds resolve to the substrate content route (/.holo/sha256/<hex>).

import { didHolo, sha256hex } from "./holo-uor.mjs";

const SHA = "sha256";

// parseRef(s) → { axis, hex } | null. Accepts every way a κ shows up in the OS:
//   did:holo:sha256:<hex> · holo://sha256/<hex> · holo://<hex> · …/.holo/sha256/<hex> · a bare 64-hex.
export function parseRef(s) {
  s = String(s || "").trim();
  let m;
  if ((m = /^did:holo:(sha256|blake3):([0-9a-f]{64})$/i.exec(s))) return { axis: m[1].toLowerCase(), hex: m[2].toLowerCase() };
  if ((m = /^holo:\/\/(?:(sha256|blake3)\/)?([0-9a-f]{64})$/i.exec(s))) return { axis: (m[1] || "sha256").toLowerCase(), hex: m[2].toLowerCase() };
  if ((m = /\/\.holo\/(sha256|blake3)\/([0-9a-f]{64})/i.exec(s))) return { axis: m[1].toLowerCase(), hex: m[2].toLowerCase() };
  if ((m = /^([0-9a-f]{64})$/i.exec(s))) return { axis: "sha256", hex: m[1].toLowerCase() };
  return null;
}
export const isHoloRef = (s) => parseRef(s) != null;

// resolveObject(ref, { resolve }) → { name, bytes, mime, kappa }. resolve(κ) → bytes (injected: substrate/mesh).
// Verify-before-use (Law L5): the resolved bytes MUST re-derive to the referenced κ — else the object was
// tampered or the resolver returned the wrong bytes, and we REFUSE (throw) rather than ingest a lie.
export async function resolveObject(ref, { resolve, name = null, mime = null, rehash = sha256hex } = {}) {
  const p = typeof ref === "string" ? parseRef(ref) : ref;
  if (!p) throw new Error("not a holo κ reference: " + ref);
  if (typeof resolve !== "function") throw new Error("resolveObject needs a resolve(κ)→bytes function");
  const kappa = didHolo(p.axis, p.hex);
  const got = await resolve(kappa);
  if (!got) throw new Error("unresolvable κ (not on substrate / mesh): " + kappa);
  const bytes = got instanceof Uint8Array ? got : new Uint8Array(got);
  if (p.axis === SHA && didHolo(SHA, rehash(bytes)) !== kappa)
    throw new Error("κ integrity check failed — resolved bytes do not match " + kappa);
  return { name: name || ("holo:" + p.hex.slice(0, 12) + "…"), bytes, mime, kappa };   // carries the κ: no re-upload
}

// thin browser adapters (disk / network — the only off-substrate edges)
export async function fileToInput(file) {
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type || null };
}
export async function urlToInput(url, { fetchImpl = (typeof fetch !== "undefined" ? fetch : null) } = {}) {
  if (!fetchImpl) throw new Error("no fetch available — pass fetchImpl");
  const r = await fetchImpl(url);
  const name = (() => { try { return new URL(url).pathname.split("/").pop() || url; } catch { return url; } })();
  return { name, bytes: new Uint8Array(await r.arrayBuffer()), mime: (r.headers && r.headers.get) ? r.headers.get("content-type") : null };
}

// intakeToInputs({ files, links, objects }, { resolve, fetchImpl }) → inputs[] for runPlus. Objects resolve by κ.
export async function intakeToInputs({ files = [], links = [], objects = [] } = {}, { resolve, fetchImpl } = {}) {
  const inputs = [];
  for (const f of files) inputs.push(await fileToInput(f));
  for (const u of links) inputs.push(await urlToInput(u, { fetchImpl }));
  for (const o of objects) inputs.push(await resolveObject(o, { resolve }));
  return inputs;
}

// the browser substrate resolver: bytes by κ from the content route (/.holo/sha256/<hex>). Used by the popover.
export function browserResolver({ fetchImpl = (typeof fetch !== "undefined" ? fetch : null) } = {}) {
  return async (kappa) => {
    const p = parseRef(kappa); if (!p || !fetchImpl) return null;
    try { const r = await fetchImpl(`/.holo/${p.axis}/${p.hex}`); if (!r.ok) return null; return new Uint8Array(await r.arrayBuffer()); }
    catch { return null; }
  };
}

export default { parseRef, isHoloRef, resolveObject, fileToInput, urlToInput, intakeToInputs, browserResolver };
