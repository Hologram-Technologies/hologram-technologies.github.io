// holo-home-files.mjs — FILES, the Home pillar. CasaOS gives you a drive-and-file manager over physical
// disks; Holo Home gives you a navigable view over the manifest's owned file index, where a file's NAME is
// the address of its bytes (content κ) and its HISTORY is a signed entry on the spine. There are no drives,
// no locations, no "free up space" — identical bytes are one κ everywhere. Three things this module owns:
//
//   • navigation — turn the manifest's flat {ref,name,parent} list into folders + breadcrumbs.
//   • open with integrity — resolve a file's bytes from the content store AND re-derive its address,
//     refusing on mismatch (file-level Law L5: a compromised store cannot hand you the wrong bytes).
//   • provenance you can prove — who/when, from the signed ingest entry on the strand.
//
// Anchored on: holo-home (the file index, projected) + the KappaStore contract (holo-opfs-kappastore:
// get(κ)→bytes, content κ = "<axis>:<hex>") + holo-strand-provenance (provenanceOf). The content store is
// INJECTED (adapter), so this is node-witnessable with an in-memory store and works unchanged over OPFS.

import { provenanceOf } from "./holo-strand-provenance.mjs";

// the content-address form the KappaStore uses: "<axis>:<hex>", default sha256. did:holo:sha256:<hex>
// carries the same hex. parse() lifts the hex either way (mirrors the store's own parser, which is private).
const parseKappa = (kappa) => { const p = String(kappa).split(":"); const hex = p.pop(); const axis = p.pop() || "sha256"; return { axis, hex }; };
async function sha256hex(u8) {
  const h = await (globalThis.crypto || crypto).subtle.digest("SHA-256", u8 instanceof Uint8Array ? u8 : new Uint8Array(u8));
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

// listFolder(files, folderRef=null) — the entries directly inside a folder (root when folderRef is null).
export function listFolder(files = [], folderRef = null) {
  return files.filter((f) => (f.parent ?? null) === (folderRef ?? null));
}

// folderTree(files) — { root, byParent } so a surface can render lazily without re-scanning.
export function folderTree(files = []) {
  const byParent = new Map();
  for (const f of files) { const k = f.parent ?? null; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(f); }
  return { root: byParent.get(null) || [], byParent };
}

// breadcrumb(files, folderRef) — the path from root down to folderRef (inclusive). A folder is just a ref
// that other files name as parent; its own display entry (if the manifest lists it) supplies the name.
export function breadcrumb(files = [], folderRef = null) {
  if (folderRef == null) return [];
  const byRef = new Map(files.map((f) => [f.ref, f]));
  const path = []; const seen = new Set(); let cur = folderRef;
  while (cur != null && !seen.has(cur)) {
    seen.add(cur);
    const e = byRef.get(cur);
    path.unshift(e ? { ref: e.ref, name: e.name } : { ref: cur, name: cur });
    cur = e ? (e.parent ?? null) : null;
  }
  return path;
}

// resolveFile(ref, store) — open a file: fetch its bytes from the content store and RE-DERIVE the address,
// refusing on mismatch (file-level Law L5). Fail-closed on a compromised/buggy store; honest "not-found"
// when the bytes simply aren't held locally (a peer fetch is the surface's job, not a silent zero).
//   { ok:true, bytes, size }                       — held and content-verified
//   { ok:false, why:"not-found" }                  — not in this store
//   { ok:false, why:"integrity", expected, got }   — bytes do NOT hash to the ref → REFUSED
export async function resolveFile(ref, store) {
  if (!ref || !store || typeof store.get !== "function") return { ok: false, why: "no-store" };
  let bytes = null;
  try { bytes = await store.get(ref); } catch (e) { return { ok: false, why: "store-threw" }; }
  if (!bytes) return { ok: false, why: "not-found" };
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const { hex } = parseKappa(ref);
  const got = await sha256hex(u8);
  if (got !== hex) return { ok: false, why: "integrity", expected: hex, got };
  return { ok: true, bytes: u8, size: u8.byteLength };
}

// fileProvenance(strand, ref) — the signed ingest entry that introduced this file (who/when), or null if it
// was never recorded on the spine (honestly unprovenanced, not faked). Delegates to the existing seam.
export function fileProvenance(strand, ref) {
  if (!strand || typeof strand.replay !== "function") return null;
  return provenanceOf(strand, ref);
}

export default { listFolder, folderTree, breadcrumb, resolveFile, fileProvenance };
