// holo-derive.mjs — THE PORTAL VERB (OS-tree canonical copy).
//
// `derive(ref)` is the single door for every holographic projection. It resolves a
// κ-addressed object (a runtime/machine snapshot, an image, a video, an audio clip, a
// 3D scene, raw bytes), VERIFIES the bytes against their κ (Law L5 — a tampered byte never
// projects), then routes them to a projector by `kind`. One path; the tab is just a verifying
// lens. "derive becomes a portal": a CEF tab's content IS whatever derive(κ) resolves+projects.
//
// A κ-object is referenced by a tiny descriptor:  { kappa, kind, meta }
//   kappa : BLAKE3 hex of the payload (the ONE canonical content address — the boundary that encodes the whole)
//   kind  : machine | image | video | audio | scene | bytes   (how to project it)
//   meta  : free-form (engine, dims, mime, name, …) — a projection hint, never a trust input
// The descriptor is itself content-addressable.
//
// Transport + projectors are injected via ctx, so the SAME verb works in node, the browser,
// over a peer (content_net), or a URL — and projects a runtime exactly like it projects a film.
// This file is byte-for-byte the proven lab verb (holo-derive.test 11/11), lifted into the OS
// tree so a real tab can route through it; the divergent HoloOpen/space paths fold onto it.

import { blake3hex } from "./holo-blake3.mjs";

export const KINDS = ["space", "machine", "image", "video", "audio", "scene", "bytes"];   // `space` = a composition (its projector tiles members); every kind flows through the ONE verb

// The canonical κ hash is BLAKE3 (Law §1.2) — the ONE axis every κ is minted and verified on, matching the
// substrate's trust root + content route (/.holo/blake3/). `blake3hex(bytes)` → 64-hex; re-exported so every
// consumer addresses on the one hash. SHA-256 survives ONLY as a NAMED foreign bridge (holo-uor.shaBridge:
// IPFS CIDs / SRI / GitHub asset names) — never a κ.
export { blake3hex };

export async function derive(ref, ctx = {}) {
  const hash = ctx.hash || blake3hex;

  // 1) resolve ref → descriptor (ref may be a descriptor object, a bare κ, or a name)
  const desc = await resolveDescriptor(ref, ctx);
  if (!desc || !desc.kappa) return { ok: false, error: "unresolved", ref };

  // 2) fetch the payload bytes by κ (store / peer / url — whatever ctx provides)
  let bytes;
  try { bytes = await fetchBytes(desc.kappa, ctx); }
  catch (e) { return { ok: false, error: "fetch-failed", kappa: desc.kappa, detail: String(e && e.message || e) }; }
  if (!bytes) return { ok: false, error: "not-found", kappa: desc.kappa };

  // 3) VERIFY-BEFORE-PROJECT (L5): the bytes must hash to the claimed κ, or we refuse. Default is the ONE
  // canonical hash (BLAKE3). A kind MAY inject ctx.verify(bytes, κ)→bool for a TRANSITION dual-read — e.g. a
  // `space` still addressable by its legacy sha256 κ resolves through the SAME verb (ctx.verify = the space
  // store's dual-read). ctx.verify must be a real verifier (fail-closed); the default path stays BLAKE3-only.
  const okV = (typeof ctx.verify === "function") ? await ctx.verify(bytes, desc.kappa) : ((await hash(bytes)) === desc.kappa);
  if (!okV) return { ok: false, error: "kappa-mismatch", expect: desc.kappa, kind: desc.kind };

  // 4) route by kind to a projector (the lens). Verified, then — and only then — projected. An explicit
  // descriptor kind wins; otherwise the verified bytes self-identify by content (ctx.sniff — magic numbers),
  // so a BARE κ with no declared kind still routes to the right lens. This is what lets one address —
  // holo://space/<κ> — be the door for ANY κ (a space, an image, a video, a machine), not a kind-per-URL.
  let k = desc.kind;
  if ((!k || k === "bytes") && typeof ctx.sniff === "function") { try { k = ctx.sniff(bytes) || k; } catch (e) { /* keep declared */ } }
  const kind = KINDS.includes(k) ? k : "bytes";
  const out = { ok: true, kind, kappa: desc.kappa, bytes, meta: desc.meta || {}, verified: true };
  const projector = ctx.projectors && ctx.projectors[kind];
  if (projector) out.projection = await projector(bytes, desc, ctx);
  else out.projection = { action: "none", reason: `no projector for kind '${kind}'` };
  return out;
}

async function resolveDescriptor(ref, ctx) {
  if (ref && typeof ref === "object" && ref.kappa) return ref;             // already a descriptor
  if (typeof ref === "string") {
    if (ctx.resolve) { const d = await ctx.resolve(ref); if (d) return d; } // name → descriptor
    if (/^[0-9a-f]{64}$/i.test(ref)) return { kappa: ref.toLowerCase(), kind: ctx.defaultKind || "bytes" };
  }
  return null;
}

async function fetchBytes(kappa, ctx) {
  if (ctx.fetchBytes) return await ctx.fetchBytes(kappa);
  if (ctx.peer && ctx.peer.fetch) return await ctx.peer.fetch(kappa);      // content_net (verifies too)
  if (ctx.store && ctx.store.get) { const b = ctx.store.get(kappa); return b ? new Uint8Array(b) : null; }
  if (ctx.baseUrl) { const r = await fetch(ctx.baseUrl + kappa + ".bin"); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; }
  return null;
}

// Built-in projector descriptors (pure — they return a PLAN; the host enacts it on its lens).
// The host wires real engines: machine→v86/runtime resume; image/video→the κ super-res pipeline.
export const defaultProjectors = {
  machine: (bytes, d) => ({ action: "resume", engine: d.meta?.engine || "v86", bytes: bytes.length, guest: d.meta?.guest }),
  image:   (bytes, d) => ({ action: "render", media: "image", bytes: bytes.length, dims: d.meta?.dims }),
  video:   (bytes, d) => ({ action: "stream", media: "video", bytes: bytes.length, dims: d.meta?.dims }),
  audio:   (bytes, d) => ({ action: "play",   media: "audio", bytes: bytes.length }),
  scene:   (bytes, d) => ({ action: "render", media: "scene", bytes: bytes.length }),
};

export default { KINDS, blake3hex, derive, defaultProjectors };
