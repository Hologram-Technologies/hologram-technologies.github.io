// _shared/holo-object.js — browser-side UOR object verifier (ADR-025). Async (Web Crypto),
// isomorphic (also runs in Node 20+ for its witness). Mirrors holo-object.mjs's canonical
// form + address EXACTLY, so the user-facing app self-verifies: re-derive an object's did
// from its own content (Law L5) and bind the bytes it plays to that linked-data object.

export const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
  : JSON.stringify(v);

export async function sha256hex(u8) {
  const d = await crypto.subtle.digest("SHA-256", u8);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// the object's self-verifying identity = did:holo:sha256:H(content with `id` removed).
export async function address(obj) {
  const { id, ...content } = obj;
  return "did:holo:sha256:" + await sha256hex(new TextEncoder().encode(jcs(content)));
}
export async function verify(obj) { return obj.id === await address(obj); }           // Law L5

export const audioLink = (obj) => ((obj && obj.links) || []).find((l) => l.rel === "audio");

// index a library.uor.json @graph by subsonic:id, so the player can find a song's UOR object.
export function graphBySubsonicId(doc) {
  const m = {};
  for (const o of (doc && doc["@graph"]) || []) if (o && o["subsonic:id"]) m[o["subsonic:id"]] = o;
  return m;
}

// verifyPlayback(obj, kappa): the user-facing self-verification on play — the object
// re-derives to its own did AND its audio link commits to exactly the κ being played, so
// the audio is bound to a self-verifying linked-data object, not just a bare hash. Returns
// true / false, or null when there is no UOR object (the κ-byte check then stands alone).
export async function verifyPlayback(obj, kappa) {
  if (!obj) return null;
  const idOk = await verify(obj);
  const al = audioLink(obj);
  const bound = !!al && al.id === "did:holo:sha256:" + String(kappa).replace(/^sha256:/, "");
  return idOk && bound;
}

if (typeof window !== "undefined") window.HoloObject = { jcs, sha256hex, address, verify, audioLink, graphBySubsonicId, verifyPlayback };
