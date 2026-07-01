// holo-q-app-seal.mjs — Stage G: seal an app to a single κ, address + share + open it anywhere, serverless. The
// app's CODE (manifest + reducer + projection, per the holo-apps standard) is sealed into a κ-keyed block store;
// the app's identity IS the manifest κ. Opening it — in any browser, from peer/IPFS/cache — RE-DERIVES every
// block to its κ (SEC-1/L5/SEC-6) and REFUSES any byte that doesn't match (the cold-start gateway is untrusted);
// no server holds the content (SEC-5). Sharing is just the manifest κ. A version/fork is a NEW manifest κ; the
// origin κ still opens to the original (immutable). Data (collections) is NOT in the app seal — it is runtime
// content synced separately. Pure + sync → Node-witnessed; in-browser, serverless.
//
//   sealApp(compiled) -> { manifestK, store }          // the κ-keyed app bundle
//   openApp(manifestK, store) -> { manifest, reducer, projectionHtml }   // re-derived on load (refuses tamper)
//   shareLink(κ) / parseShareLink(link) / openFromLink(link, store)
//   mergeStores(a, b) -> store                         // union by κ (dedup); both versions resolvable

import { sha256hex, jcs } from "../holo-uor.mjs";
import { blake3hex } from "../holo-blake3.mjs";   // the ONE canonical κ hash (§1.2)

const PREFIX = "holo://blake3/";                  // canonical share prefix (new seals are BLAKE3)
const LEGACY_PREFIX = "holo://sha256/";           // still parsed so old app links keep opening (transition)
const b3 = (s) => blake3hex(typeof s === "string" ? new TextEncoder().encode(s) : s);
// dual-read L5: a block is its κ iff BLAKE3 (canonical) OR sha256 (legacy, transition) re-derives to k.
const matches = (bytes, k) => b3(bytes) === k || sha256hex(bytes) === k;

export function sealApp(compiled) {
  const store = {};
  store[compiled.manifestK] = jcs(compiled.manifest);                  // the app identity block
  store[compiled.reducerK] = jcs(compiled.reducer);                    // the logic
  store[compiled.projectionK] = compiled.projectionHtml;               // the UI bundle
  if (compiled.projectionDAG && compiled.projectionDAG.store)          // + the element κ-DAG (every element addressable + streamable)
    for (const [k, desc] of Object.entries(compiled.projectionDAG.store)) store[k] = jcs(desc);
  return { manifestK: compiled.manifestK, store };
}

// open by κ, re-deriving EVERY block on the way (manifest → reducer → projection). A tampered/absent block is
// refused, not trusted — there is no trusted intermediary to subvert (SEC-1).
export function openApp(manifestK, store) {
  const get = (k) => {
    const bytes = store ? store[k] : undefined;
    if (bytes == null) throw new Error("MISSING block " + k);
    if (!matches(bytes, k)) throw new Error("L5 REFUSE " + k);         // SEC-1/SEC-6: verify against κ on receipt (dual-read)
    return bytes;
  };
  const manifest = JSON.parse(get(manifestK));
  const reducer = JSON.parse(get(manifest.reducer));
  const projectionHtml = get(manifest.projection);
  return { manifest, manifestK, reducer, projectionHtml };
}

export const shareLink = (k) => PREFIX + String(k);
export const parseShareLink = (link) => {
  const s = String(link || "");
  if (s.startsWith(PREFIX)) return s.slice(PREFIX.length);              // canonical blake3 link
  if (s.startsWith(LEGACY_PREFIX)) return s.slice(LEGACY_PREFIX.length);// legacy sha256 link still opens (transition)
  return /^[0-9a-f]{64}$/.test(s) ? s : null;                          // bare hex (axis-agnostic)
};
export function openFromLink(link, store) { const k = parseShareLink(link); if (!k) throw new Error("not a holo app link: " + link); return openApp(k, store); }

// union two app stores by κ — identical blocks (e.g. an unchanged reducer across versions) collapse to one.
export const mergeStores = (a, b) => Object.assign({}, a, b);

export default { sealApp, openApp, shareLink, parseShareLink, openFromLink, mergeStores };
