// holo-mesh-blocks.mjs — the connectivity foundation: bitswap-lite over a P2P channel. Serve + fetch
// κ-blocks by CID between Hologram instances, RE-DERIVING every block (Law L5 — a peer can't lie, the block
// is content-addressed). Backed by the κ-store; the returned getBlock is a DROP-IN for the IPFS gateway's
// resolveIpfsPath, so a PEER's sealed snapshot resolves through the SAME path — the local commons becomes the
// shared one. Transport-agnostic: a `wire` is { send(obj), onMessage(cb) }. The Node witness drives it with a
// mock pair; a real RTCDataChannel is adapted by dataChannelWire(). The signaling + relay (how two browsers
// FIND + connect, serverlessly via a public Circuit-Relay/pubsub) is the live-only layer above this.

import * as holoIpfs from "../usr/lib/holo/holo-ipfs.js";

// createMeshBlocks(wire, { getLocalBlock?, timeoutMs? }) → { wantBlock, getBlock }.
//   getLocalBlock(cidStr) → Uint8Array|null : what THIS peer can serve (the κ-store). Omit to be fetch-only.
//   wantBlock(cidStr) → Promise<Uint8Array|null> : ask peers; resolves the FIRST re-derived copy (or null).
export function createMeshBlocks(wire, { getLocalBlock = null, timeoutMs = 8000 } = {}) {
  const pending = new Map();   // cidStr → Set(resolve)
  wire.onMessage(async (m) => {
    if (!m || !m.t) return;
    if (m.t === "want") {                                   // a peer wants a block we might hold → serve or decline
      let bytes = null; try { bytes = getLocalBlock ? await getLocalBlock(m.cid) : null; } catch {}
      try { wire.send(bytes ? { t: "block", cid: m.cid, bytes } : { t: "dont", cid: m.cid }); } catch {}
    } else if (m.t === "block") {                           // a peer sent a block → accept ONLY if it re-derives (L5)
      const u = m.bytes instanceof Uint8Array ? m.bytes : new Uint8Array(m.bytes);
      let ok = false; try { ok = await holoIpfs.verifyBlock(m.cid, u); } catch {}
      if (ok) settle(m.cid, u);                             // a wrong byte from any peer is silently ignored (nothing laundered)
    } else if (m.t === "dont") {
      settle(m.cid, null);
    }
  });
  function settle(cid, v) { const s = pending.get(cid); if (s) { pending.delete(cid); for (const r of s) r(v); } }
  function wantBlock(cid) {
    return new Promise((resolve) => {
      let done = false; const fin = (v) => { if (done) return; done = true; const s = pending.get(cid); if (s) s.delete(fin); resolve(v); };
      let s = pending.get(cid); if (!s) { s = new Set(); pending.set(cid, s); } s.add(fin);
      try { wire.send({ t: "want", cid }); } catch { fin(null); }
      setTimeout(() => fin(null), timeoutMs);
    });
  }
  return { wantBlock, getBlock: wantBlock };
}

// pairWires() — two linked in-memory wires (witness). Each .send delivers (async) to the other's handler.
export function pairWires() {
  let aCb = null, bCb = null;
  return [
    { send: (m) => { Promise.resolve().then(() => bCb && bCb(m)); }, onMessage: (cb) => { aCb = cb; } },
    { send: (m) => { Promise.resolve().then(() => aCb && aCb(m)); }, onMessage: (cb) => { bCb = cb; } },
  ];
}

// dataChannelWire(dc) — adapt a real RTCDataChannel (binary frames: [type(1) | cidLen(2) | cid | bytes]).
// Real-transport adapter; not exercised by the Node witness.
export function dataChannelWire(dc) {
  let cb = null; const enc = new TextEncoder(), dec = new TextDecoder();
  try { dc.binaryType = "arraybuffer"; } catch {}
  dc.addEventListener("message", (e) => {
    try { const b = new Uint8Array(e.data); const clen = (b[1] << 8) | b[2]; const cid = dec.decode(b.subarray(3, 3 + clen));
      if (cb) cb({ t: b[0] === 0 ? "want" : b[0] === 1 ? "block" : "dont", cid, bytes: b.subarray(3 + clen) }); } catch {}
  });
  return {
    send: (m) => { const c = enc.encode(m.cid), body = m.bytes || new Uint8Array(0), out = new Uint8Array(3 + c.length + body.length);
      out[0] = m.t === "want" ? 0 : m.t === "block" ? 1 : 2; out[1] = (c.length >> 8) & 255; out[2] = c.length & 255; out.set(c, 3); out.set(body, 3 + c.length);
      try { dc.send(out.buffer); } catch {} },
    onMessage: (fn) => { cb = fn; },
  };
}

export default { createMeshBlocks, pairWires, dataChannelWire };
