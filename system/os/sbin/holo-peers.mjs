// holo-peers.mjs — LIVE transport adapters for the κ-resolver source seam (ADR-026). Each turns a
// real content-addressed network into a `peerSource` (kappa → bytes | null) for holo-sources.mjs.
// The resolver re-derives every byte (Law L5), so an adapter NEVER needs to trust its transport —
// a wrong block from any gateway or peer is refused. This is what makes the OS gateway-free: deny
// the origin and the same verified bytes still arrive from the IPFS network or a mesh neighbour.
//
// Transports wired:
//   • IPFS   — a sha-256 κ IS a CIDv1 (sha2-256, raw), so we race the IETF Trustless Gateways for
//              the raw block and accept the first that re-derives to the CID (holo-ipfs.verifyBlock).
//   • mesh   — holo-rtc's content-blind κ pub/sub: sync.fetch(kappa, {verify}) pulls the block from
//              whichever WebRTC-mesh peer holds it. `sync` is page-injected (the same object the
//              Meet room builds); in the Service Worker it is reached via the SW↔client bridge.
//   • hypercore — a READY SEAM: supply getByKappa(kappa) → bytes|null and it joins the chain. (No
//              Hypercore/holepunch P2P log ships in this repo today — holo-hypercore.js is the
//              Hyperliquid source — so this is wired, not yet a live transport.)
//
// Isomorphic: importable in the Service Worker and in Node (its witness). Holo-ipfs supplies the
// multiformats CID + verify primitives (witnessed vs official vectors — see the `holo-ipfs` row).

import { hexOf } from "./holo-resolver.mjs";
import { peerSource } from "./holo-sources.mjs";

// the default IETF Trustless Gateways (the set ipfs-worker.js races); the gateway is never trusted.
export const IPFS_GATEWAYS = [
  "https://trustless-gateway.link", "https://ipfs.io", "https://dweb.link", "https://w3s.link",
];

// kappaToCid(kappa, ipfs) → CIDv1(raw, sha2-256) base32 — a sha-256 κ expressed as a CID. Pure;
// `ipfs` is the holo-ipfs module (fromHex/makeCIDv1/cidToString/CODEC/HASH).
export function kappaToCid(kappa, ipfs) {
  const digest = ipfs.fromHex(hexOf(kappa));                       // the raw 32-byte sha-256
  return ipfs.cidToString(ipfs.makeCIDv1(ipfs.CODEC.RAW, ipfs.HASH.SHA2_256, digest), "base32");
}

// ipfsPeer({ gateways, fetchImpl, ipfs }) — race the gateways for the κ's raw block; return the FIRST
// that re-derives to the CID (verifyBlock), else null. A wrong/tampered gateway simply loses the race.
export function ipfsPeer({ gateways = IPFS_GATEWAYS, fetchImpl, ipfs } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  return peerSource("ipfs", async (kappa) => {
    if (!f || !ipfs) return null;
    const cid = kappaToCid(kappa, ipfs);
    const tasks = gateways.map(async (g) => {
      const r = await f(`${g.replace(/\/$/, "")}/ipfs/${cid}?format=raw`, { headers: { accept: "application/vnd.ipld.raw" } });
      if (!r || !r.ok) throw new Error("gateway " + (r && r.status));
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (!(await ipfs.verifyBlock(cid, bytes))) throw new Error("cid mismatch — gateway not trusted");
      return bytes;
    });
    try { return await Promise.any(tasks); } catch { return null; }
  });
}

// meshPeer(sync, { verify }) — fetch the κ from whichever WebRTC-mesh peer holds it (holo-rtc content-
// blind κ pub/sub). `sync.fetch(label, {verify})` returns the sealed bytes; the resolver re-derives.
export function meshPeer(sync, { verify } = {}) {
  return peerSource("mesh", async (kappa) => {
    if (!sync || typeof sync.fetch !== "function") return null;
    const bytes = await sync.fetch("sha256:" + hexOf(kappa), verify ? { verify } : undefined);
    return bytes ? (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) : null;
  });
}

// bridgePeer(name, ask) — a peer whose transport lives in another realm (e.g. the mesh `sync` in the
// page, reached from the Service Worker). `ask(kappa) → bytes|null` is the cross-realm request.
export function bridgePeer(name, ask) { return peerSource(name, async (kappa) => (await ask(kappa)) || null); }

// hypercorePeer(getByKappa) — the ready seam for a Hypercore/holepunch (or any κ-store) transport.
export function hypercorePeer(getByKappa) { return peerSource("hypercore", getByKappa); }

// livePeers(cfg) — assemble the configured live peer chain (order = preference); absent transports
// dropped. cfg: { ipfs?: true|{...}, mesh?: sync|{sync,opts}, bridge?: {name,ask}, hypercore?: fn }.
export function livePeers(cfg = {}) {
  const out = [];
  if (cfg.ipfs) out.push(ipfsPeer(cfg.ipfs === true ? {} : cfg.ipfs));
  if (cfg.mesh) out.push(meshPeer(cfg.mesh.sync || cfg.mesh, cfg.mesh.opts));
  if (cfg.bridge) out.push(bridgePeer(cfg.bridge.name || "bridge", cfg.bridge.ask));
  if (cfg.hypercore) out.push(hypercorePeer(cfg.hypercore));
  return out;
}
