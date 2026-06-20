// holo-cid-boot.mjs — COLD-DEVICE, DEAD-ORIGIN boot from a single shareable link …/#<root-CID>.
// (decentralized-boot delta A, the last piece.) The fragment carries the κ of the boot ROOT
// (os-closure.json) as a CIDv1 — a sha-256 κ IS a CIDv1(sha2-256). On a fresh device whose origin may
// be unreachable (GitHub Pages down / censored), resolve that root BY ITS κ from the NON-ORIGIN
// recovery chain (the device's own κ-store · IPFS Trustless Gateways · mesh peers), RE-DERIVE it
// (Law L5: sha-256(bytes) === κ — never trust the source), then hand the verified closure to boot so
// the Service Worker serves the rest content-addressed. Composes the already-witnessed recovery
// transports (holo-peers · holo-sources) — no new trust. The page reads the fragment (the SW can't:
// its self.location is the worker URL), seeds the result, then registers the SW.
//
// Pure + injectable: the caller passes the ordered `sources`; this module owns only the fragment
// parsing + the L5 re-derivation gate, so it is unit-witnessable with a simulated swarm offline.

// Relative (not "/usr/lib/holo/…") so this resolves in the browser (against the served /lib/ URL), on a
// subpath deploy, AND in Node for the witness — one import that works everywhere, no reroot shim needed.
import { cidToKappa } from "../usr/lib/holo/holo-ipfs.js";

// rootKappaFromHash(hash) → 64-hex κ | null. Accepts #<cid>, #root=<cid>, #cid=<cid>, or
// #k=<cid | κ | did:holo:sha256:…> — the same `#` channel the share convention already rides.
export function rootKappaFromHash(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  let v = params.get("root") || params.get("k") || params.get("cid") || raw.split("&")[0];
  if (!v) return null;
  v = decodeURIComponent(v).trim();
  const hex = v.replace(/^did:holo:/, "").replace(/^sha256:/, "");
  if (/^[0-9a-f]{64}$/i.test(hex)) return hex.toLowerCase();      // already a bare κ / did:holo
  try { return cidToKappa(v); } catch { return null; }            // a CID → its sha-256 κ
}

const sha256hex = async (bytes) => [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

// coldBootRoot({ hash, sources, requireFragment }) → { kappa, bytes, source } | null
// sources: ordered [{ name, get:(hex)=>Promise<Uint8Array|null> }] — the recovery chain (store → ipfs →
// mesh; origin is just one optional entry). Each candidate is RE-DERIVED before acceptance, so the
// source is a latency choice, never a trust one — a wrong/tampered byte from ANY source loses.
export async function coldBootRoot({ hash, sources = [], requireFragment = false } = {}) {
  const kappa = rootKappaFromHash(hash);
  if (!kappa) { if (requireFragment) throw new Error("coldBootRoot: no root CID/κ in fragment"); return null; }
  if (!(globalThis.crypto && globalThis.crypto.subtle)) return null;   // no Web Crypto → cannot re-derive; stay out of the way
  for (const s of sources) {
    let bytes = null;
    try { bytes = await s.get(kappa); } catch { bytes = null; }    // a dead/failed source is skipped, never fatal
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) continue;
    if ((await sha256hex(bytes)) !== kappa) continue;              // Law L5: refuse a non-re-deriving copy
    return { kappa, bytes, source: s.name || "?" };
  }
  return null;                                                     // no source served a κ-verified root
}

export const HoloCidBoot = { rootKappaFromHash, coldBootRoot };
export default HoloCidBoot;
