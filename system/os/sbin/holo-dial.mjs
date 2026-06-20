// holo-dial.mjs — ADR-0113 (Holo Dial) S1: the dial-by-κ PEER ORCHESTRATOR. Hold a set of live channels
// (WebRTC peers), run a κ-block mesh over each, and answer askMesh(κ) by fanning the `want` across ALL
// peers and returning the FIRST re-derived block. The resolver re-derives again on receipt (Law L5), so a
// peer is a latency source, never a trust one — a wrong block from any peer loses. This is the object that
// replaces the `const askMesh = async () => null;` stub in holo-heal-boot.mjs.
//
// SAFE TO WIRE: with ZERO peers, askMesh(κ) → null — byte-for-byte the old stub's behaviour — so attaching
// this to the heal/boot loop changes nothing until a channel is actually present. S3 supplies channels
// (serverless rendezvous); a Meet room's live link, or a manual holo-webrtc-link, can supply them today.
//
// Also SERVES: getLocalBlock(cid) is backed by the device's durable κ-store, so any κ this device has healed
// is offered to peers — "can recover" → "will recover", now for others too. Transport-agnostic: addChannel
// adapts a real RTCDataChannel (dataChannelWire); addWire takes an already-adapted { send, onMessage } wire
// (a mock pair in the witness, the SW↔client bridge in S2). Isomorphic: imports cleanly in Node and the SW.

import { createMeshBlocks, dataChannelWire } from "./holo-mesh-blocks.mjs";
import { kappaToCid } from "./holo-peers.mjs";

// makeDial({ ipfs, getLocalBlock?, timeoutMs? }) → { addChannel, addWire, askMesh, peerCount }.
//   ipfs          : the holo-ipfs module (κ → CIDv1 mapping for the bitswap-lite protocol).
//   getLocalBlock : (cidStr) → Uint8Array|null — what THIS device serves to peers (the κ-store). Omit = fetch-only.
//   timeoutMs     : per-peer want timeout (a tampered/silent peer never settles → drops to null after this).
export function makeDial({ ipfs, getLocalBlock = null, timeoutMs = 8000 } = {}) {
  const peers = new Set();                                        // each: { mesh }

  // addWire(wire) → detach() : attach an already-adapted transport. Returns a detacher.
  function addWire(wire) {
    const peer = { mesh: createMeshBlocks(wire, { getLocalBlock, timeoutMs }) };
    peers.add(peer);
    return () => peers.delete(peer);
  }

  // addChannel(dc) → detach() : attach a live RTCDataChannel (from holo-webrtc-link / holo-rtc / S3).
  function addChannel(dc) {
    const detach = addWire(dataChannelWire(dc));
    try { dc.addEventListener && dc.addEventListener("close", detach); } catch {}
    return detach;
  }

  // askMesh(κ) → Uint8Array|null : fan the want across every peer; the FIRST non-null (already L5-verified at
  // the mesh receipt) wins; null if no peer serves it. With no peers, returns null WITHOUT touching ipfs —
  // exactly the old stub, so wiring this in is behaviour-preserving until a channel exists.
  async function askMesh(kappa) {
    if (peers.size === 0) return null;
    const cid = kappaToCid(kappa, ipfs);
    return firstNonNull([...peers].map((p) => p.mesh.wantBlock(cid)));
  }

  return { addChannel, addWire, askMesh, peerCount: () => peers.size };
}

// firstNonNull(promises) → first resolved truthy value, else null once ALL have settled. wantBlock never
// rejects (it resolves null), so this races for the first peer that actually holds the κ — the honest peer
// settles promptly while a liar's want only times out, so the lie can never delay the truth.
function firstNonNull(promises) {
  return new Promise((resolve) => {
    let pending = promises.length;
    if (!pending) return resolve(null);
    for (const p of promises) Promise.resolve(p).then(
      (v) => { if (v) resolve(v); else if (--pending === 0) resolve(null); },
      () => { if (--pending === 0) resolve(null); },
    );
  });
}

export default { makeDial };
