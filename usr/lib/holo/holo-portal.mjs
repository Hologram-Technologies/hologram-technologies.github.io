// holo-portal.mjs — the SEAL side of the κ-Portal (in-image). Turns a real holospace/app (its files, or its
// existing holospace.lock.json) into ONE portal κ — a closure .holo (holo-dotholo) that the seed loader
// (holo-seed) cold-boots in any browser — and mints the server-blind share link. Pure + isomorphic: no fs, no
// Buffer, browser-safe. The build/share path calls this; the loader path is holo-seed. ──────────────────────
import { sealClosureHolo } from "./holo-dotholo.mjs";
import { blake3hex } from "./holo-blake3.mjs";
import { build as portalLink } from "./holo-portal-link.mjs";   // the ONE link codec

const enc = (s) => new TextEncoder().encode(s);
const b3hex = (bytes) => blake3hex(typeof bytes === "string" ? enc(bytes) : bytes);
const pickEntry = (paths, given) => given || paths.find((p) => /(^|\/)index\.html$/.test(p)) || paths.find((p) => /\.html$/.test(p)) || paths.find((p) => /holospace\.json$/.test(p)) || paths[0];

// closureFromFiles(files, opts) → { kappa, manifest, result, members, blobs }. Seals actual bytes: each file's
// blake3 becomes its member κ; `blobs` (hex→bytes) is what the content-blind fabric serves. This is the honest
// seal — the portal κ is derived from the CURRENT bytes, so it can never disagree with what is streamed.
export function closureFromFiles(files, { entry = null, worker = null, workerPath = null, name = null, repo = "holo-os", tier = "R1" } = {}) {
  const paths = Object.keys(files);
  if (!paths.length) throw new Error("closureFromFiles: no files");
  const members = {}, blobs = {};
  for (const p of paths) { const bytes = typeof files[p] === "string" ? enc(files[p]) : files[p]; const hex = b3hex(bytes); members[p] = "did:holo:blake3:" + hex; blobs[hex] = bytes; }
  const wk = worker || (workerPath && members[workerPath]) || null;
  const sealed = sealClosureHolo({ repo, provider: "closure", tier, entry: pickEntry(paths, entry), members, worker: wk, name });
  return { ...sealed, blobs };
}

// closureFromLock(lock, opts) → { kappa, manifest, result, members }. Turns an EXISTING sealed holospace
// (holospace.lock.json) into a portal κ WITHOUT re-reading bytes — it reuses the lock's recorded κ, preferring
// the blake3 (σ-axis) alsoKnownAs so the portal is blake3-canonical. Deterministic: same lock → same portal κ.
export function closureFromLock(lock, { entry = null } = {}) {
  const clo = lock && lock.closure;
  if (!clo || typeof clo !== "object") throw new Error("closureFromLock: lock has no closure map");
  const members = {};
  for (const p of Object.keys(clo)) {
    const v = clo[p];
    const b3 = Array.isArray(v.alsoKnownAs) ? v.alsoKnownAs.find((k) => /^did:holo:blake3:/.test(k)) : null;
    members[p] = b3 || v.kappa;
  }
  const sealed = sealClosureHolo({ repo: "holo-os", provider: "closure", tier: "R1", entry: pickEntry(Object.keys(members), entry), members, name: lock.identifier || null });
  return sealed;
}

// portalWire(sealed) → the browser-friendly .holo the loader fetches (no Buffer/base64). ──────────────────────
export const portalWire = (sealed) => ({ kappa: sealed.kappa, manifest: sealed.manifest, result: sealed.result });

// portalLink — the ONE shareable link, built by the ONE codec (holo-portal-link, imported at top as portalLink).
// The format lives in exactly one place; this module just re-exports it under the seal side's stable name.
export { portalLink };

export function describePortal() {
  return { is: "the seal side of the κ-Portal — a real holospace/app → ONE portal κ (closure .holo) + a server-blind share link",
    from: "closureFromFiles (current bytes, honest) or closureFromLock (an already-sealed holospace)",
    opens: "with the holo-seed loader in any cold browser; verify-before-project (L5) end to end" };
}

export default { closureFromFiles, closureFromLock, portalWire, portalLink, describePortal };
